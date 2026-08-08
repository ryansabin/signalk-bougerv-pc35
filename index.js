'use strict';
/*
 * signalk-bougerv-pc35 — SignalK plugin to monitor & control a BougeRV PC35 Pro AC over BLE.
 *
 * Install:
 *   cd ~/.signalk/node_modules   (or your SK server plugin dir)
 *   mkdir signalk-bougerv-pc35 && cp index.js package.json pc35-ble.js signalk-bougerv-pc35/
 *   cd signalk-bougerv-pc35 && npm install
 *   restart SignalK, enable the plugin in the admin UI.
 *
 * Needs BLE permission for node:
 *   sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))
 *
 * Exposes (under configurable base path, default electrical.airConditioner.pc35):
 *   .power           bool     PUT: true/false or 1/0
 *   .temperatureSet  Kelvin   PUT: value in °C (16..31) OR Kelvin (>=200)
 *   .mode            string   PUT: eco|cool|breeze|fan|dehumidify|strongcool|sleep|turbo|heat
 *   .fanSpeed        string   PUT: low|med|high
 *   .remainingTime   seconds
 */

const { connect, CMD, MODES, FANS } = require('./pc35-ble');

module.exports = function (app) {
  let dev = null;
  let stopped = false;
  let pollTimer = null;
  let reconnectTimer = null;

  const plugin = {
    id: 'signalk-bougerv-pc35',
    name: 'BougeRV PC35 Pro AC',
    schema: {
      type: 'object',
      properties: {
        basePath: { type: 'string', title: 'SignalK base path', default: 'electrical.airConditioner.pc35' },
        address:  { type: 'string', title: 'BLE address (optional, e.g. 03:bb:53:1a:ac:79)', default: '' },
        namePrefix: { type: 'string', title: 'BLE name prefix', default: 'PC35' },
        pollSeconds: { type: 'number', title: 'Status poll interval (s)', default: 30 },
      },
    },
  };

  const log = (...a) => console.log('[pc35]', ...a);   // journald-visible lifecycle logging
  const K = c => c + 273.15;            // °C -> Kelvin
  const cFromK = k => k - 273.15;

  function emit(base, s) {
    const values = [
      { path: `${base}.power`,          value: s.power },
      { path: `${base}.temperatureSet`, value: K(s.tempSetC) },
      { path: `${base}.mode`,           value: s.mode },
      { path: `${base}.fanSpeed`,       value: s.fan },
      { path: `${base}.drainage`,       value: s.drainage },
      { path: `${base}.lighting`,       value: s.lighting },
    ];
    if (s.remainingMin != null) values.push({ path: `${base}.remainingTime`, value: s.remainingMin * 60 });
    app.handleMessage(plugin.id, { updates: [{ values }] });
  }

  async function ensureConnected(opts) {
    if (dev) return dev;
    if (opts.address) process.env.PC35_ADDR = opts.address;
    if (opts.namePrefix) process.env.PC35_NAME = opts.namePrefix;
    app.setPluginStatus('Scanning for PC35…');
    log('scanning for AC (namePrefix=' + (opts.namePrefix||'PC35') + ', address=' + (opts.address||'any') + ')');
    dev = await connect({ timeoutMs: 30000 });
    app.setPluginStatus(`Connected to ${dev.name} [${dev.addr}]`);
    log('CONNECTED to', dev.name, dev.addr);
    dev.onStatus(s => { log('status', JSON.stringify(s).slice(0,160)); emit(opts.basePath, s); });
    dev.onDisconnect(() => {
      app.setPluginStatus('AC disconnected — will retry');
      log('disconnected — will retry in 5s');
      dev = null;
      if (!stopped) reconnectTimer = setTimeout(() => ensureConnected(opts).catch(logErr), 5000);
    });
    await dev.send(CMD.status());
    return dev;
  }

  function logErr(e){ app.error(e.message); app.setPluginError(e.message); }

  async function put(opts, kind, value) {
    const d = await ensureConnected(opts);
    let buf;
    switch (kind) {
      case 'power': buf = CMD.power(value === true || value === 1 || value === 'true' || value === 'on'); break;
      case 'temperatureSet': {
        let c = Number(value);
        if (c >= 200) c = cFromK(c);            // accept Kelvin or °C
        buf = CMD.temp(Math.round(c)); break;
      }
      case 'mode': buf = CMD.mode(MODES[value] ?? Number(value)); break;
      case 'fanSpeed': buf = CMD.fan(FANS[value] ?? Number(value)); break;
      default: throw new Error('unknown control ' + kind);
    }
    await d.send(buf);
    await d.send(CMD.status());                 // refresh reported state
    return { state: 'COMPLETED', statusCode: 200 };
  }

  plugin.start = function (options) {
    stopped = false;
    const opts = Object.assign({ basePath: 'electrical.airConditioner.pc35', namePrefix: 'PC35', pollSeconds: 30 }, options);

    const controls = ['power', 'temperatureSet', 'mode', 'fanSpeed'];
    for (const c of controls) {
      app.registerPutHandler('vessels.self', `${opts.basePath}.${c}`, (ctx, path, value, cb) => {
        put(opts, c, value)
          .then(res => cb(res))
          .catch(e => { logErr(e); cb({ state: 'COMPLETED', statusCode: 502, message: e.message }); });
        return { state: 'PENDING' };
      });
    }

    ensureConnected(opts).catch(logErr);
    if (opts.pollSeconds > 0) {
      pollTimer = setInterval(() => { if (dev) dev.send(CMD.status()).catch(()=>{}); }, opts.pollSeconds * 1000);
    }
  };

  plugin.stop = function () {
    stopped = true;
    clearInterval(pollTimer); clearTimeout(reconnectTimer);
    if (dev) { dev.disconnect().catch(()=>{}); dev = null; }
    app.setPluginStatus('Stopped');
  };

  return plugin;
};
