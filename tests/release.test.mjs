import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {releaseFiles,prepareRelease,verifyRelease} from '../scripts/release.mjs';

test('Release inventory includes runtime and bridge and excludes workstation data; hashes detect tampering',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'kpi-release-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const files=await releaseFiles();
  for(const required of ['dist/app.mjs','scripts/pbi_http.mjs','scripts/pbi_bridge.ps1','scripts/launch.ps1','bin/Microsoft.AnalysisServices.Tabular.dll']) assert.ok(files.includes(required));
  assert.ok(files.every(f=>!f.includes('node_modules')&&!f.startsWith('releases/')&&!f.endsWith('.pbitool.json')));
  for(const file of files) await cp(new URL('../'+file,import.meta.url),path.join(root,file),{recursive:true});
  await prepareRelease(root);
  assert.ok((await verifyRelease(root,{exact:true})).count>50);
  const target=path.join(root,'dist/app.mjs'),original=await readFile(target);
  await writeFile(target,'changed');
  await assert.rejects(verifyRelease(root),/Hash distinto: dist\/app.mjs/);
  await writeFile(target,original);
  await writeFile(path.join(root,'unexpected.txt'),'unexpected');
  await assert.rejects(verifyRelease(root,{exact:true}),/inesperados/);
});
