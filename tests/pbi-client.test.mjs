import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest, injectMeasureToLivePbi, fetchLivePbiModel } from '../dist/pbi-client.mjs';

test('client preserves optimistic write contract and sends JSON exactly once', async t => {
  const payload={server:'localhost:1234',database:'database-id',tableName:'Medidas',measureName:'Ingresos',daxExpression:'\r\nRETURN "€"',expectedExpression:'\r\nSUM(\'Ventas\'[Importe])'};
  let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.match(url,/\/api\/pbi\/measure$/);assert.equal(options.method,'POST');
    assert.equal(options.headers['Content-Type'],'application/json');assert.deepEqual(JSON.parse(options.body),payload);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({success:true,measureName:payload.measureName});
  });
  const result=await injectMeasureToLivePbi(payload);assert.equal(result.success,true);assert.equal(calls,1);
});
test('client retains conflict status and does not classify rejected writes as uncertain', async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({success:false,error:'La medida cambió',code:'CONFLICT',outcomeUnknown:false},{status:409});});
  await assert.rejects(injectMeasureToLivePbi({expectedExpression:null}),error=>error.status===409&&error.code==='CONFLICT'&&error.outcomeUnknown===false);
  assert.equal(calls,1);
});
test('client treats a lost write response as uncertain without retrying', async t => {
  let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw new TypeError('Network disconnected');});
  await assert.rejects(injectMeasureToLivePbi({expectedExpression:null}),error=>error.outcomeUnknown===true);
  assert.equal(calls,1);
  await assert.rejects(apiRequest('/api/pbi/discover'),error=>!error.outcomeUnknown);
  assert.equal(calls,2);
});
test('client retains backend uncertainty even when HTTP response is available', async t => {
  t.mock.method(globalThis,'fetch',async()=>Response.json({success:false,error:'Tiempo agotado',code:'BRIDGE_TIMEOUT',outcomeUnknown:true},{status:504}));
  await assert.rejects(injectMeasureToLivePbi({expectedExpression:null}),error=>error.status===504&&error.code==='BRIDGE_TIMEOUT'&&error.outcomeUnknown===true);
});
test('client bounds waiting with AbortController and distinguishes reads from writes', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let calls=0;
  t.mock.method(globalThis,'fetch',(_url,{signal})=>new Promise((_resolve,reject)=>{
    calls++;signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
  }));
  const write=assert.rejects(injectMeasureToLivePbi({expectedExpression:null}),error=>error.name==='AbortError'&&error.outcomeUnknown===true&&/tardado demasiado/.test(error.message));
  t.mock.timers.tick(60001);await write;
  const read=assert.rejects(apiRequest('/api/pbi/discover'),error=>error.name==='AbortError'&&!error.outcomeUnknown);
  t.mock.timers.tick(60001);await read;assert.equal(calls,2);
});
test('invalid write-response JSON is uncertain and success clears its timer', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(globalThis,'fetch',async()=>new Response('not JSON',{status:200}));
  await assert.rejects(injectMeasureToLivePbi({}),error=>error.outcomeUnknown===true);
  let capturedSignal;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{capturedSignal=options.signal;return Response.json({success:true});});
  await apiRequest('/api/pbi/discover');t.mock.timers.tick(60001);assert.equal(capturedSignal.aborted,false);
});
test('client validates live catalog and preserves exact reviewed expression', async t => {
  const expression='\r\nSUM(\'Ventas\'[Importe])';
  t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,server:'localhost:1234',database:'Model',databaseId:'id-1',modelName:'Reporte',tables:[{name:'Medidas'}],measures:[{name:'Ingresos',table:'Medidas',expression}],detectedDateTables:[]}));
  const model=await fetchLivePbiModel('localhost:1234','id-1');assert.equal(model.measures[0].expression,expression);
  t.mock.method(globalThis,'fetch',async()=>Response.json({success:true,server:'localhost:1234',database:'Model',tables:[{name:'Medidas'}],measures:[{name:42,table:'Medidas'}]}));
  await assert.rejects(fetchLivePbiModel('localhost:1234','id-1'),/catálogo recibido no es válido/);
});
