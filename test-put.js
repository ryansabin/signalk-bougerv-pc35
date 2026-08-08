'use strict';
/*
 * End-to-end test THROUGH the SignalK PUT API (exercises the live plugin's PUT
 * handlers over HTTP, verifies via GET, restores). Needs SK_TOKEN env (a token
 * for an admin/readwrite principal).
 *
 *   SK_TOKEN=<jwt> node test-put.js
 */
const BASE = 'http://localhost/signalk/v1/api/vessels/self/electrical/airConditioner/pc35';
const H = { 'Authorization': 'Bearer ' + process.env.SK_TOKEN, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function put(path, value) {
  const r = await fetch(`${BASE}/${path}`, { method: 'PUT', headers: H, body: JSON.stringify({ value }) });
  return r.status;
}
async function getv(path) {
  const r = await fetch(`${BASE}/${path}`, { headers: H });
  if (!r.ok) return `(HTTP ${r.status})`;
  return (await r.json()).value;
}
const results = [];
function check(name, got, expected) {
  const ok = got === expected;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, got ${got})`);
}

(async () => {
  const base = { mode: await getv('mode'), temp: await getv('temperatureSet'), fan: await getv('fanSpeed'), power: await getv('power') };
  console.log('baseline (via SignalK):', JSON.stringify(base), '\n');

  console.log('PUT mode=cool ->', await put('mode', 'cool'));               await sleep(3500);
  check('mode == cool', await getv('mode'), 'cool');
  console.log('PUT temperatureSet=22 (C) ->', await put('temperatureSet', 22)); await sleep(3500);
  check('temperatureSet == 295.15K (22C)', await getv('temperatureSet'), 295.15);
  console.log('PUT fanSpeed=high ->', await put('fanSpeed', 'high'));       await sleep(3500);
  check('fanSpeed == high', await getv('fanSpeed'), 'high');
  console.log('PUT power=false ->', await put('power', false));             await sleep(3500);
  check('power == false', await getv('power'), false);
  console.log('PUT power=true ->', await put('power', true));               await sleep(3500);
  check('power == true', await getv('power'), true);

  console.log('\nrestoring baseline via PUT…');
  await put('fanSpeed', base.fan);        await sleep(2500);
  await put('temperatureSet', base.temp); await sleep(2500);
  await put('mode', base.mode);           await sleep(2500);
  await put('power', base.power);         await sleep(2500);
  console.log('restored:', JSON.stringify({ mode: await getv('mode'), temp: await getv('temperatureSet'), fan: await getv('fanSpeed'), power: await getv('power') }));

  const passed = results.filter(r => r.ok).length;
  console.log(`\n===== ${passed}/${results.length} PUT tests PASSED =====`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
