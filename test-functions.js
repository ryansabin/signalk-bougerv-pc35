'use strict';
/*
 * Integration test — exercises every PC35 command against the real AC and
 * verifies each via status readback, then restores the original state.
 *
 *   (stop signalk first so the adapter/AC is free)
 *   PC35_ADDR=03:BB:53:1A:AC:79 node test-functions.js
 */
const { connect, CMD, MODES, FANS } = require('./pc35-ble');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, got, expected) {
  const ok = got === expected;
  results.push({ name, ok, got, expected });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, got ${got})`);
}

(async () => {
  const dev = await connect({ timeoutMs: 30000 });
  console.log(`connected to ${dev.name} [${dev.addr}]\n`);
  let latest = null;
  dev.onStatus(s => { latest = s; });

  async function readFresh() {
    latest = null;
    await dev.send(CMD.status());
    const t0 = Date.now();
    while (!latest && Date.now() - t0 < 5000) await sleep(200);
    return latest;
  }
  async function apply(buf) { await dev.send(buf); await sleep(1000); return await readFresh(); }

  // baseline
  const base = await readFresh();
  if (!base) { console.error('no baseline status'); process.exit(1); }
  console.log('baseline:', JSON.stringify({ power: base.power, tempSetC: base.tempSetC, mode: base.mode, fan: base.fan, drainage: base.drainage, lighting: base.lighting, unit: base.displayUnit }), '\n');

  try {
    // temperature
    check('temperature -> 22C', (await apply(CMD.temp(22))).tempSetC, 22);
    check('temperature -> 26C', (await apply(CMD.temp(26))).tempSetC, 26);
    // mode
    check('mode -> cool',  (await apply(CMD.mode(MODES.cool))).mode, 'cool');
    check('mode -> fan',   (await apply(CMD.mode(MODES.fan))).mode, 'fan');
    check('mode -> heat',  (await apply(CMD.mode(MODES.heat))).mode, 'heat');
    // fan speed
    check('fan -> high',   (await apply(CMD.fan(FANS.high))).fan, 'high');
    check('fan -> med',    (await apply(CMD.fan(FANS.med))).fan, 'med');
    check('fan -> low',    (await apply(CMD.fan(FANS.low))).fan, 'low');
    // lighting
    check('lighting -> 0', (await apply(CMD.lighting(0))).lighting, 0);
    check('lighting -> 1', (await apply(CMD.lighting(1))).lighting, 1);
    // drainage
    check('drainage -> open',  (await apply(CMD.drainage(true))).drainage, 'open');
    check('drainage -> close', (await apply(CMD.drainage(false))).drainage, 'close');
    // temperature unit (display)
    check('unit -> C', (await apply(CMD.tempUnit(0))).displayUnit, 'C');
    check('unit -> F', (await apply(CMD.tempUnit(1))).displayUnit, 'F');
    // power (do last)
    check('power -> off', (await apply(CMD.power(false))).power, false);
    check('power -> on',  (await apply(CMD.power(true))).power, true);
  } catch (e) {
    console.error('test error:', e.message);
  }

  // restore baseline
  console.log('\nrestoring baseline…');
  await dev.send(CMD.power(base.power));                          await sleep(600);
  await dev.send(CMD.temp(base.tempSetC));                        await sleep(600);
  await dev.send(CMD.mode(MODES[base.mode] || 7));               await sleep(600);
  await dev.send(CMD.fan(FANS[base.fan] || 1));                   await sleep(600);
  await dev.send(CMD.lighting(base.lighting));                    await sleep(600);
  await dev.send(CMD.drainage(base.drainage === 'open'));         await sleep(600);
  await dev.send(CMD.tempUnit(base.displayUnit === 'F' ? 1 : 0)); await sleep(600);
  const after = await readFresh();
  console.log('restored:', JSON.stringify({ power: after.power, tempSetC: after.tempSetC, mode: after.mode, fan: after.fan, drainage: after.drainage, lighting: after.lighting, unit: after.displayUnit }));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n===== ${passed}/${results.length} PASSED =====`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.log('FAILED:', failed.map(f => f.name).join(', '));

  await dev.disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
