'use strict';
/*
 * BougeRV PC35 Pro — BLE control library + CLI  (BlueZ / D-Bus via node-ble)
 *
 * Uses @naugehyde/node-ble so it coexists with bluetoothd and other BlueZ
 * consumers (e.g. bt-sensors-plugin-sk) on the same adapter — no raw HCI, no
 * cap_net_raw, no adapter takeover.
 *
 *   npm install
 *
 * CLI:
 *   PC35_ADDR=03:BB:53:1A:AC:79 node pc35-ble.js status
 *   PC35_ADDR=03:BB:53:1A:AC:79 node pc35-ble.js on|off|temp 22|mode cool|fan high|watch
 */

const { createBluetooth } = require('@naugehyde/node-ble');

const SVC       = '0000abf0-0000-1000-8000-00805f9b34fb';
const CH_WRITE  = '0000abf1-0000-1000-8000-00805f9b34fb';
const CH_NOTIFY = '0000abf3-0000-1000-8000-00805f9b34fb';
const NAME_PREFIX = process.env.PC35_NAME || 'PC35';
const ADDR = (process.env.PC35_ADDR || '').toUpperCase();

const MODES = { eco:1, cool:2, breeze:3, fan:4, dehumidify:5, strongcool:6, sleep:7, turbo:8, heat:9 };
const MODE_NAMES = Object.fromEntries(Object.entries(MODES).map(([k,v])=>[v,k]));
const FANS  = { low:1, med:2, medium:2, high:3 };
const FAN_NAMES = {1:'low',2:'med',3:'high'};

// ---- frame builders (validated against the app) -----------------------------
function frame(code, rw, val, header = [0x55, 0xAA]) {
  const b = Buffer.from([header[0], header[1], 0x01, code, 0x00, 0x05, code, rw, 0x00, 0x01, val & 0xff, 0]);
  let s = 0; for (let i = 0; i < 11; i++) s = (s + b[i]) & 0xff;
  b[11] = s;
  return b;
}
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n | 0));

const CMD = {
  power:  on   => frame(0x70, 1, on ? 1 : 0),
  temp:   c    => frame(0x71, 0, clamp(c, 16, 31)),           // Celsius
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

// ---- connection (BlueZ) -----------------------------------------------------
async function findByName(adapter, prefix, deadline) {
  while (Date.now() < deadline) {
    const addrs = await adapter.devices();
    for (const a of addrs) {
      try {
        const dev = await adapter.getDevice(a);
        const nm = await dev.getName().catch(() => null);
        if (nm && nm.startsWith(prefix)) return { dev, addr: a, name: nm };
      } catch (e) { /* device vanished */ }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

async function connect({ address = ADDR, namePrefix = NAME_PREFIX, timeoutMs = 30000 } = {}) {
  const { bluetooth, destroy } = createBluetooth();
  // defaultAdapter() can race D-Bus object enumeration at startup ("Adapter not found") — retry
  let adapter;
  for (let i = 0; ; i++) {
    try { adapter = await bluetooth.defaultAdapter(); break; }
    catch (e) { if (i >= 15) { try { destroy(); } catch (_) {} throw e; } await new Promise(r => setTimeout(r, 1000)); }
  }
  try { if (!(await adapter.isDiscovering())) await adapter.startDiscovery(); } catch (e) { /* already discovering (shared adapter) */ }

  let device, name = null, addr = (address || '').toUpperCase();
  if (addr) {
    device = await adapter.waitDevice(addr, timeoutMs);
    name = await device.getName().catch(() => null);
  } else {
    const found = await findByName(adapter, namePrefix, Date.now() + timeoutMs);
    if (!found) { try { destroy(); } catch (e) {} throw new Error('scan timeout — AC not found (on? app closed? in range?)'); }
    device = found.dev; addr = found.addr; name = found.name;
  }

  await device.connect();
  const gatt = await device.gatt();
  const service = await gatt.getPrimaryService(SVC);
  const wchar = await service.getCharacteristic(CH_WRITE);
  const nchar = await service.getCharacteristic(CH_NOTIFY);
  await nchar.startNotifications();
  if (process.env.PC35_DEBUG) nchar.on('valuechanged', d => console.error('RAW notify', d.length + 'B', d.toString('hex')));

  return {
    device, adapter, name, addr,
    async send(buf) { await wchar.writeValue(buf, { type: 'command' }); },   // write-without-response
    onStatus(cb) { nchar.on('valuechanged', d => { const s = parseStatus(d); if (s) cb(s, d); }); },
    onDisconnect(cb) { try { device.once('disconnect', cb); } catch (e) {} },
    async disconnect() { try { await device.disconnect(); } catch (e) {} try { destroy(); } catch (e) {} },
  };
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
    await dev.send(CMD.status());
    await once(6000);
    console.log(JSON.stringify(out || {note:'no status frame received'}, null, 2));
    await dev.disconnect();
    process.exit(0);
  })().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
