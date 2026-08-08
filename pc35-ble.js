'use strict';
/*
 * BougeRV PC35 Pro — BLE control library + CLI  (Linux/Raspberry Pi)
 *
 *   npm install @abandonware/noble
 *   sudo setcap cap_net_raw+eip $(eval readlink -f $(which node))   # or run as root
 *
 * CLI:
 *   node pc35-ble.js status
 *   node pc35-ble.js on            node pc35-ble.js off
 *   node pc35-ble.js temp 22       (°C)
 *   node pc35-ble.js mode cool     (eco|cool|breeze|fan|dehumidify|strongcool|sleep|turbo|heat)
 *   node pc35-ble.js fan high      (low|med|high)
 *   node pc35-ble.js watch         (subscribe and print every status frame)
 *
 * Match the AC by name prefix "PC35" (default) or set PC35_ADDR=03:bb:53:1a:ac:79
 */

const noble = require('@abandonware/noble');

const SVC     = 'abf0';                                  // 0000abf0-...
const CH_WRITE = 'abf1';                                 // 0000abf1-...
const CH_NOTIFY = 'abf3';                                // 0000abf3-...
const NAME_PREFIX = process.env.PC35_NAME || 'PC35';
const ADDR = (process.env.PC35_ADDR || '').toLowerCase();

const MODES = { eco:1, cool:2, breeze:3, fan:4, dehumidify:5, strongcool:6, sleep:7, turbo:8, heat:9 };
const MODE_NAMES = Object.fromEntries(Object.entries(MODES).map(([k,v])=>[v,k]));
const FANS  = { low:1, med:2, medium:2, high:3 };
const FAN_NAMES = {1:'low',2:'med',3:'high'};

// ---- frame builders ---------------------------------------------------------
function frame(code, rw, val, header = [0x55, 0xAA]) {
  const b = Buffer.from([header[0], header[1], 0x01, code, 0x00, 0x05, code, rw, 0x00, 0x01, val & 0xff, 0]);
  let s = 0; for (let i = 0; i < 11; i++) s = (s + b[i]) & 0xff;
  b[11] = s;
  return b;
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));

const CMD = {
  power:  on   => frame(0x70, 1, on ? 1 : 0),
  temp:   c    => frame(0x71, 0, clamp(c, 16, 31)),            // Celsius
  mode:   m    => frame(0x72, 0, m),
  fan:    f    => frame(0x73, 0, f),
  drainage: d  => frame(0x74, 1, d ? 1 : 0, [0xAA, 0xAA]),
  timing: h    => frame(0x75, 0, clamp(h, 0, 24)),
  lighting: x  => frame(0x78, 1, x),
  tempUnit: u  => frame(0x81, 1, u ? 1 : 0),
  status: ()   => { const b = Buffer.from([0x55,0xAA,0x01,0x20,0x00,0x00,0x00]);
                    let s=0; for(let i=0;i<6;i++) s=(s+b[i])&0xff; b[6]=s; return b; },
};

// ---- status parser ----------------------------------------------------------
function parseStatus(d) {
  if (!d || d.length < 51 || d[0] !== 0x55 || d[1] !== 0xAA) return null;
  const cToF = c => Math.round(c * 9 / 5 + 32);
  const tempC = d[15];
  return {
    power: d[10] === 1,
    tempSetC: tempC,
    tempSetF: cToF(tempC),
    mode: MODE_NAMES[d[20]] || d[20],
    fan: FAN_NAMES[d[25]] || d[25],
    drainage: d[30] === 1 ? 'open' : 'close',
    timingH: d[35],
    appointmentH: d[40],
    lighting: d[45],
    displayUnit: d[50] === 1 ? 'F' : 'C',
    remainingMin: d.length > 52 ? ((d[51] << 8) | d[52]) : null,
    raw: d.toString('hex'),
  };
}

// ---- connection -------------------------------------------------------------
function connect({ timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const to = setTimeout(() => { if (!done){ done=true; cleanup(); reject(new Error('scan timeout — is the AC on and no phone connected?')); } }, timeoutMs);

    function cleanup(){ noble.removeListener('discover', onDiscover); try{ noble.stopScanning(); }catch(e){} }

    async function onDiscover(p) {
      const name = (p.advertisement && p.advertisement.localName) || '';
      const addr = (p.address || '').toLowerCase();
      const match = (ADDR && addr === ADDR) || (!ADDR && name.startsWith(NAME_PREFIX));
      if (!match) return;
      done = true; clearTimeout(to); cleanup();
      try {
        await p.connectAsync();
        const { characteristics } = await p.discoverSomeServicesAndCharacteristicsAsync([SVC], [CH_WRITE, CH_NOTIFY]);
        const write  = characteristics.find(c => c.uuid.includes(CH_WRITE));
        const notify = characteristics.find(c => c.uuid.includes(CH_NOTIFY));
        if (!write || !notify) throw new Error('write/notify characteristic not found (uuids: '+characteristics.map(c=>c.uuid)+')');
        await notify.subscribeAsync();
        resolve({ peripheral: p, name, addr,
          async send(buf){ await write.writeAsync(buf, true); },   // write-without-response
          onStatus(cb){ notify.on('data', d => { const s = parseStatus(d); if (s) cb(s, d); }); },
          async disconnect(){ try{ await p.disconnectAsync(); }catch(e){} },
        });
      } catch (e) { reject(e); }
    }

    noble.on('discover', onDiscover);
    if (noble.state === 'poweredOn') noble.startScanning([], true);
    else noble.once('stateChange', s => { if (s === 'poweredOn') noble.startScanning([], true); });
  });
}

module.exports = { connect, CMD, parseStatus, frame, MODES, FANS };

// ---- CLI --------------------------------------------------------------------
if (require.main === module) {
  const [,, cmd, arg] = process.argv;
  (async () => {
    const dev = await connect();
    console.error(`connected to ${dev.name} [${dev.addr}]`);
    const once = ms => new Promise(r => setTimeout(r, ms));

    if (cmd === 'watch') { dev.onStatus(s => console.log(JSON.stringify(s))); return; }

    let out = null;
    dev.onStatus(s => { out = s; });
    switch (cmd) {
      case 'on':   await dev.send(CMD.power(true));  break;
      case 'off':  await dev.send(CMD.power(false)); break;
      case 'temp': await dev.send(CMD.temp(parseInt(arg,10))); break;
      case 'mode': await dev.send(CMD.mode(MODES[arg] ?? parseInt(arg,10))); break;
      case 'fan':  await dev.send(CMD.fan(FANS[arg] ?? parseInt(arg,10))); break;
      case 'status': default: break;
    }
    await dev.send(CMD.status());          // ask for fresh state
    await once(1500);
    console.log(JSON.stringify(out || {note:'no status frame received'}, null, 2));
    await dev.disconnect();
    process.exit(0);
  })().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
