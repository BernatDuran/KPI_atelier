import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPbiApi } from '../scripts/pbi_api.mjs';
import { createBridgeTransport } from '../scripts/pbi_transport.mjs';
import { MAX_BODY_BYTES, isAllowedHost, isAllowedOrigin } from '../scripts/pbi_http.mjs';

const validMeasure = {server:'localhost:54321',database:'model-id',tableName:'Measures',measureName:'Revenue card',daxExpression:'RETURN "OK"',expectedExpression:null};
async function fixture(t, bridge = async () => ({success:true,instances:[]})) {
  const api = createPbiApi({bridge,pollMs:10});
  const server = http.createServer((req,res) => api.handle(req,res,new URL(req.url,'http://localhost')));
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => { api.shutdown(); server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  return {port, request(path, {method='GET',headers={},body} = {}) {
    return new Promise((resolve,reject) => {
      const req = http.request({host:'127.0.0.1',port,path,method,headers,setHost:headers.host !== ''},res => {
        let text=''; res.on('data',chunk => {text+=chunk;}); res.on('end',() => resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));
      }); req.on('error',reject); if (body !== undefined) req.write(body); req.end();
    });
  }};
}
test('local boundary rejects null, foreign ports, HTTPS and rebinding hosts', () => {
  assert.equal(isAllowedHost('localhost:8080',8080),true);
  for (const host of ['evil.test:8080','127.0.0.1.evil.test:8080','localhost:8090','localhost','user@localhost:8080']) assert.equal(isAllowedHost(host,8080),false);
  assert.equal(isAllowedOrigin('http://localhost:8080','localhost:8080'),true);
  for (const origin of ['null','http://localhost:8090','https://localhost:8080','http://evil.test']) assert.equal(isAllowedOrigin(origin,'localhost:8080'),false);
});
test('actual server exposes versioned health and protects static pages against rebinding', async t => {
  const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const server=spawn(process.execPath,[fileURLToPath(new URL('../scripts/serve.mjs',import.meta.url)),String(port)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(()=>server.kill());
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw new Error('Local server failed to start');})]);
  const health=await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.deepEqual(await health.json(),{app:'kpi-atelier',version:'1.4.0',protocol:1});
  const page=await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self';/);
  const response=await new Promise((resolve,reject)=>{
    const request=http.get({host:'127.0.0.1',port,path:'/',headers:{host:`evil.test:${port}`}},res=>{res.resume();resolve(res.statusCode);});request.on('error',reject);
  });
  assert.equal(response,403);
});
test('HTTP rejects hostile origins and wrong methods before calling bridge', async t => {
  let calls=0; const app=await fixture(t,async()=>{calls++;return {success:true};});
  for (const headers of [{origin:'null'},{origin:'http://localhost:9999'},{host:'rebind.test:8080'},{host:''},{'sec-fetch-site':'cross-site'}]) assert.equal((await app.request('/api/pbi/discover',{headers})).status,403);
  assert.equal((await app.request('/api/pbi/discover',{method:'POST'})).status,405);
  assert.equal((await app.request('/api/pbi/measure')).status,405);
  assert.equal(calls,0);
});
test('HTTP validates JSON types, bounds, local server and explicit write destination', async t => {
  let calls=0; const app=await fixture(t,async()=>{calls++;return {success:true};});
  const post=body=>app.request('/api/pbi/measure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  for (const body of [null,[],{...validMeasure,daxExpression:34},{...validMeasure,server:'remote:1234'},{...validMeasure,database:''},{...validMeasure,tableName:''},{...validMeasure,expectedExpression:undefined},{...validMeasure,configAnnotation:[]},{...validMeasure,configAnnotation:{width:-1}},{...validMeasure,configAnnotation:{elements:{value:{frame:{left:NaN,width:-1}}}}}]) assert.equal((await post(body)).status,400);
  assert.equal((await app.request('/api/pbi/measure',{method:'POST',body:'{}'})).status,415);
  assert.equal((await app.request('/api/pbi/measure',{method:'POST',headers:{'content-type':'application/json'},body:'{'})).status,400);
  assert.equal((await app.request('/api/pbi/measure',{method:'POST',headers:{'content-type':'application/json'},body:' '.repeat(MAX_BODY_BYTES+1)})).status,413);
  assert.equal(calls,0);
});
test('HTTP preserves reviewed expression exactly and reports conflicts and uncertain writes', async t => {
  let received;
  const app=await fixture(t,async args=>{received=args;return {success:true};});
  const expression='\r\nSUM(\'Ventas\'[€])';
  const result=await app.request('/api/pbi/measure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...validMeasure,expectedExpression:expression})});
  assert.equal(result.status,200);
  assert.equal(received[received.indexOf('-ExpectedState')+1],'present');
  assert.equal(Buffer.from(received[received.indexOf('-ExpectedExpressionBase64')+1],'base64').toString('utf8'),expression);
  for (const [code,status,outcomeUnknown] of [['CONFLICT',409,false],['BRIDGE_TIMEOUT',504,true]]) {
    const failing=await fixture(t,async()=>{throw Object.assign(new Error('Revisa el modelo'),{code,outcomeUnknown});});
    const response=await failing.request('/api/pbi/discover');
    assert.equal(response.status,status); assert.equal(response.body.outcomeUnknown,outcomeUnknown);
  }
});
function fakeProcess(onRequest, ready = true) {
  const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
  child.stdin=new Writable({write(chunk,_encoding,done){try {onRequest(JSON.parse(chunk.toString()),child);done();} catch(e){done(e);}}});
  child.kill=()=>{queueMicrotask(()=>child.emit('close',1));return true;};
  if (ready) queueMicrotask(()=>child.stdout.write('{"ready":true}\n'));
  return child;
}
test('transport serializes requests, drains stderr and correlates responses', async t => {
  let concurrent=0,peak=0;
  const transport=createBridgeTransport({spawnProcess:()=>fakeProcess((request,child)=>{
    peak=Math.max(peak,++concurrent); child.stderr.write('diagnostic\n'.repeat(5000));
    setTimeout(()=>{concurrent--;child.stdout.write(JSON.stringify({success:true,requestId:request.requestId,value:request.action})+'\n');},5);
  })}); t.after(()=>transport.shutdown());
  const results=await Promise.all(['one','two','three'].map(action=>transport.request({action})));
  assert.equal(peak,1);assert.deepEqual(results.map(r=>r.value),['one','two','three']);
});
test('transport bounds startup and rejects process exit before readiness', async () => {
  for (const factory of [()=>fakeProcess(()=>{},false),()=>{const child=fakeProcess(()=>{},false);queueMicrotask(()=>child.emit('close',1));return child;}]) {
    const transport=createBridgeTransport({spawnProcess:factory,startupMs:20});
    await assert.rejects(transport.request({action:'discover'}));transport.shutdown();
  }
});
test('timed-out write is never retried and cancels queued work', async () => {
  let spawns=0,sends=0;
  const transport=createBridgeTransport({spawnProcess:()=>{spawns++;return fakeProcess(()=>{sends++;});},operationMs:20});
  const results=await Promise.allSettled([transport.request({action:'inject-measure'}),transport.request({action:'discover'})]);
  assert.equal(results[0].reason.code,'BRIDGE_TIMEOUT');assert.equal(results[0].reason.outcomeUnknown,true);
  assert.equal(results[1].reason.outcomeUnknown,false);assert.equal(spawns,1);assert.equal(sends,1);transport.shutdown();
});
test('mismatched response ID cannot resolve the active request', async () => {
  const transport=createBridgeTransport({spawnProcess:()=>fakeProcess((request,child)=>child.stdout.write(JSON.stringify({success:true,requestId:request.requestId+1})+'\n'))});
  await assert.rejects(transport.request({action:'inject-measure'}),err=>err.code==='BRIDGE_PROTOCOL'&&err.outcomeUnknown);transport.shutdown();
});
test('SSE discovery never overlaps and stops after client disconnect', async t => {
  let active=0,peak=0,calls=0;
  const app=await fixture(t,async()=>{calls++;peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,20));active--;return {instances:[]};});
  const req=http.get({host:'127.0.0.1',port:app.port,path:'/api/pbi/events'});
  const [res]=await once(req,'response');
  await new Promise(resolve=>{let events=0;res.on('data',chunk=>{if(chunk.toString().includes('data:')&&++events===3)resolve();});});
  req.destroy();await new Promise(r=>setTimeout(r,40));const afterClose=calls;await new Promise(r=>setTimeout(r,40));
  assert.equal(peak,1);assert.equal(calls,afterClose);
});
test('new SSE subscribers receive fresh discovery instead of a stale disconnection snapshot', async t => {
  let current=[];
  const app=await fixture(t,async()=>({instances:current}));
  async function snapshot() {
    const req=http.get({host:'127.0.0.1',port:app.port,path:'/api/pbi/events'});
    t.after(()=>req.destroy());
    const [res]=await once(req,'response');
    return new Promise(resolve=>{
      let buffer='';res.on('data',chunk=>{
        buffer+=chunk;
        const match=/data: ([^\n]+)\n\n/.exec(buffer);
        if(match){req.destroy();resolve(JSON.parse(match[1]));}
      });
    });
  }
  assert.deepEqual((await snapshot()).instances,[]);
  current=[{server:'localhost:1234'}];
  assert.deepEqual((await snapshot()).instances,current);
});
test('PowerShell target and version guards fail closed without loading TOM', {skip:process.platform!=='win32'}, () => {
  const file=fileURLToPath(new URL('../scripts/pbi_bridge.ps1',import.meta.url));
  const script=`$ErrorActionPreference='Stop'
$names=@('Resolve-Database','Throw-Conflict','Assert-MeasureVersion','Invoke-BridgeAction')
@($env:KPI_BRIDGE_TEST,(Join-Path (Split-Path $env:KPI_BRIDGE_TEST) 'pbi_connection.ps1')) | ForEach-Object {
 $ast=[System.Management.Automation.Language.Parser]::ParseFile($_,[ref]$null,[ref]$null)
 $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in $names},$true) | ForEach-Object { Invoke-Expression $_.Extent.Text }
}
$db=[pscustomobject]@{ID='id-1';Name='Model'}
$srv=[pscustomobject]@{Databases=@($db)}
if ((Resolve-Database $srv 'id-1' $true).ID -ne 'id-1') {throw 'wrong db'}
foreach($identity in @('missing','')) {try { Resolve-Database $srv $identity $true; throw 'accepted wrong destination' } catch {if($_.Exception.Message -eq 'accepted wrong destination'){throw}}}
$measure=[pscustomobject]@{Expression='SUM([Revenue])'}
$table=[pscustomobject]@{Name='Measures'}
$base64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($measure.Expression))
Assert-MeasureVersion $measure $table 'Measures' 'present' $base64
Assert-MeasureVersion $null $null 'Measures' 'absent' ''
foreach($scenario in 1..4) {
 try {
  switch($scenario) {
   1 {Assert-MeasureVersion $measure $table 'Measures' 'absent' ''}
   2 {Assert-MeasureVersion $null $null 'Measures' 'present' $base64}
   3 {Assert-MeasureVersion $measure $table 'Wrong' 'present' $base64}
   4 {Assert-MeasureVersion $measure $table 'Measures' 'present' 'MQ=='}
  }
  throw 'conflict accepted'
 } catch {if($_.Exception.Data['code'] -ne 'CONFLICT'){throw}}
}
$script:saveCount=0
$storedMeasure=[pscustomobject]@{Name='Card';Expression='SUM([Revenue])'}
$storedTable=[pscustomobject]@{Name='Measures';Measures=@($storedMeasure)}
$model=[pscustomobject]@{Tables=@($storedTable)}
$model | Add-Member -MemberType ScriptMethod -Name SaveChanges -Value {$script:saveCount++}
$database=[pscustomobject]@{ID='id-1';Name='Model';Model=$model}
$script:fakeServer=[pscustomobject]@{Databases=@($database)}
$script:fakeServer | Add-Member -MemberType ScriptMethod -Name Disconnect -Value {}
function Connect-Server {return $script:fakeServer}
foreach($scenario in 1..3) {
 $destination=if($scenario -eq 1){'missing'}else{'id-1'}
 $target=if($scenario -eq 2){'MissingTable'}else{'Measures'}
 $expected=if($scenario -eq 3){'MQ=='}else{$base64}
 try {
  Invoke-BridgeAction -Action 'inject-measure' -Server 'localhost:12345' -Database $destination -TableName $target -MeasureName 'Card' -Expression 'RETURN 123' -ExpectedState 'present' -ExpectedExpressionBase64 $expected
  throw 'write guard accepted invalid state'
 } catch {if($_.Exception.Message -eq 'write guard accepted invalid state'){throw}}
 if($script:saveCount -ne 0 -or $storedMeasure.Expression -ne 'SUM([Revenue])'){throw 'guard modified model'}
}
$written=Invoke-BridgeAction -Action 'inject-measure' -Server 'localhost:12345' -Database 'id-1' -TableName 'Measures' -MeasureName 'Card' -Expression 'RETURN 123' -ExpectedState 'present' -ExpectedExpressionBase64 $base64
if(-not $written.success -or $script:saveCount -ne 1 -or $storedMeasure.Expression.Trim() -ne 'RETURN 123'){throw 'valid update failed'}
Write-Output 'guards-ok'`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',env:{...process.env,KPI_BRIDGE_TEST:file},timeout:15000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/guards-ok/);
});
