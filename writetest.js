'use strict';
// Diagnostic: check abf1 write flags and test write-with-response vs without.
const { createBluetooth } = require('@naugehyde/node-ble');
const SVC='0000abf0-0000-1000-8000-00805f9b34fb', W='0000abf1-0000-1000-8000-00805f9b34fb', N='0000abf3-0000-1000-8000-00805f9b34fb';
const ADDR=(process.env.PC35_ADDR||'').toUpperCase();
function frame(code,rw,val,h=[0x55,0xAA]){const b=Buffer.from([h[0],h[1],1,code,0,5,code,rw,0,1,val&0xff,0]);let s=0;for(let i=0;i<11;i++)s=(s+b[i])&0xff;b[11]=s;return b;}
function statusCmd(){const b=Buffer.from([0x55,0xAA,1,0x20,0,0,0]);let s=0;for(let i=0;i<6;i++)s=(s+b[i])&0xff;b[6]=s;return b;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const {bluetooth,destroy}=createBluetooth();
  const ad=await bluetooth.defaultAdapter(); if(!await ad.isDiscovering()) await ad.startDiscovery();
  const dev=await ad.waitDevice(ADDR,30000); await dev.connect();
  const gatt=await dev.gatt(); const svc=await gatt.getPrimaryService(SVC);
  const w=await svc.getCharacteristic(W); const n=await svc.getCharacteristic(N);
  console.log('abf1 flags:', await w.getFlags());
  let latest=null;
  await n.startNotifications(); n.on('valuechanged',d=>{ if(d&&d.length>25) latest={temp:d[15],mode:d[20],fan:d[25],power:d[10]}; });
  async function read(){ latest=null; try{await w.writeValue(statusCmd(),{type:'request'});}catch(e){await w.writeValue(statusCmd(),{type:'command'});} const t=Date.now(); while(!latest&&Date.now()-t<4000) await sleep(200); return latest; }
  console.log('baseline:', await read());
  // WITH response
  try { await w.writeValue(frame(0x71,0,22),{type:'request'}); console.log('wrote temp22 type=request'); }
  catch(e){ console.log('request write threw:', e.message); }
  await sleep(2500); console.log('after temp22 (with-response):', await read());
  // WITHOUT response
  try { await w.writeValue(frame(0x71,0,20),{type:'command'}); console.log('wrote temp20 type=command'); }
  catch(e){ console.log('command write threw:', e.message); }
  await sleep(2500); console.log('after temp20 (without-response):', await read());
  // restore to 24
  try { await w.writeValue(frame(0x71,0,24),{type:'request'}); } catch(e){}
  await sleep(1500);
  await dev.disconnect(); try{destroy();}catch(e){}
  process.exit(0);
})().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
