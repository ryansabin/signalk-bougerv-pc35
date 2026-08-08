'use strict';
/*
 * Integration test — exercises every PC35 command against the real AC and
 * verifies each via status readback, then restores the original state.
 * Respects mode-gating: temperature is only adjustable in Cool mode.
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
  async function apply(buf) { await dev.send(buf); await sleep(1200); return await readFresh(); }

  const base = await readFresh();
  if (!base) { console.error('no baseline status'); process.exit(1); }
  console.log('baseline:', JSON.stringify({ power: base.power, tempSetC: base.tempSetC, mode: base.mode, fan: base.fan, drainage: base.drainage, lighting: base.lighting, unit: base.displayUnit }), '\n');

  try {
    // power (works in any mode)
    check('power -> off', (await apply(CMD.power(false))).power, false);
    check('power -> on',  (await apply(CMD.power(true))).power, true);

    // modes (PC35 Pro: cool/rocket(turbo)/fan/dry/sleep)
    check('mode -> cool',       (await apply(CMD.mode(MODES.cool))).mode, 'cool');
    check('mode -> turbo(rkt)', (await apply(CMD.mode(MODES.turbo))).mode, 'turbo');
    check('mode -> fan',        (await apply(CMD.mode(MODES.fan))).mode, 'fan');
    check('mode -> dry',        (await apply(CMD.mode(MODES.dehumidify))).mode, 'dehumidify');

    // temperature — only adjustable in Cool mode, so switch first
    await apply(CMD.mode(MODES.cool));
    check('temp -> 22C (in cool)', (await apply(CMD.temp(22))).tempSetC, 22);
    check('temp -> 26C (in cool)', (await apply(CMD.temp(26))).tempSetC, 26);

    // fan speed (in cool mode)
    check('fan -> high', (await apply(CMD.fan(FANS.high))).fan, 'high');
    check('fan -> med',  (await apply(CMD.fan(FANS.med))).fan, 'med');
    check('fan -> low',  (await apply(CMD.fan(FANS.low))).fan, 'low');

    // lighting
    check('lighting -> 0', (await apply(CMD.lighting(0))).lighting, 0);
    check('lighting -> 1', (await apply(CMD.lighting(1))).lighting, 1);

    // temperature unit (display)
    check('unit -> C', (await apply(CMD.tempUnit(0))).displayUnit, 'C');
    check('unit -> F', (await apply(CMD.tempUnit(1))).displayUnit, 'F');

    // drainage — left at baseline (not toggled during test per user request)
  } catch (e) {
    console.error('test error:', e.message);
  }

  // restore baseline
  console.log('\nrestoring baseline…');
  await dev.send(CMD.mode(MODES[base.mode] || 7));               await sleep(800);
  await dev.send(CMD.temp(base.tempSetC));                        await sleep(800);
  await dev.send(CMD.fan(FANS[base.fan] || 1));                   await sleep(800);
  await dev.send(CMD.lighting(base.lighting));                    await sleep(800);
  await dev.send(CMD.tempUnit(base.displayUnit === 'F' ? 1 : 0)); await sleep(800);
  await dev.send(CMD.power(base.power));                          await sleep(800);
  const after = await readFresh();
  console.log('restored:', JSON.stringify({ power: after.power, tempSetC: after.tempSetC, mode: after.mode, fan: after.fan, drainage: after.drainage, lighting: after.lighting, unit: after.displayUnit }));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n===== ${passed}/${results.length} PASSED =====`);
  const failed = results.filter(r => !r.ok);
  if (failed.length) console.log('FAILED:', failed.map(f => f.name).join(', '));

  await dev.disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
