import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE,sanitizeConfig,checks,getCircularConflict} from '../dist/model.mjs';
import {unsupportedCopyDataProperties,updateElement} from '../dist/elements.mjs';
import {validateImportedJSON} from '../dist/schema.mjs';
import {reviewMeasure} from '../dist/preflight.mjs';
import {generateDAX} from '../dist/dax.mjs';
import {cardHTML,sampleData} from '../dist/cards.mjs';
import {parseTmdl,scanFileList,parseBim} from '../dist/pbip.mjs';

const catalog={modelName:'Demo',tables:['Measures','Calendar'],dateTables:[{name:'Calendar',dateColumns:['Date']}],measures:[{name:'Sales',table:'Measures'},{name:'Previous',table:'Measures'}]};
const config=patch=>({...BASE,type:'comparison',showTrend:false,showGoal:false,comparison:'custom',measure:'Sales',measureName:'KPI',compareMeasure:'Previous',targetMeasure:'100',dateTable:'Calendar',dateColumn:'Date',...patch});

test('Decorative copy data properties are explicitly removed without losing their text, icon or appearance',()=>{
 for(const base of ['eyebrow','icon','title','subtitle','compareLabel','referenceLabel','footer','period']){
  const id=base+'_copy1',state={text:'Keep this text',icon:'trend',colorMode:'custom',color:'#123456',x:23,y:17,frame:{left:10,top:20,width:100,height:30},
   measure:'MissingSensitive',targetMeasure:'MissingTarget',compareMeasure:'MissingRef',dateTable:'OldDates',dateColumn:'OldDate',
   format:'number',unit:'none',decimals:2,suffix:'old',deltaMode:'pp',direction:'down',comparison:'yoy',goodThreshold:10,chartKind:'donut'};
  const raw=config({elements:{[id]:state}}),original=structuredClone(raw),imported=validateImportedJSON(raw);
  assert.equal(imported.valid,true,id);assert.deepEqual(raw,original,id);
  assert.ok(imported.warnings.some(w=>w.includes(id)&&w.includes('decorativa')&&w.includes('measure')),id);
  const normalized=imported.config.elements[id];
  assert.equal(normalized.text,state.text,id);assert.equal(normalized.icon,state.icon,id);
  assert.equal(normalized.color,state.color,id);assert.equal(normalized.x,state.x,id);
  assert.deepEqual(normalized.frame,state.frame,id);
  assert.deepEqual(unsupportedCopyDataProperties(id,normalized),[],id);
  assert.equal(normalized.measure,undefined,id);assert.equal(normalized.targetMeasure,undefined,id);
  assert.equal(normalized.comparison,base==='compareLabel'?'yoy':undefined,id);
  assert.deepEqual(validateImportedJSON(imported.config).warnings,[],id);
  const review=reviewMeasure(raw,catalog);
  assert.equal(review.valid,true,id);assert.ok(review.issues.some(i=>i.level==='warning'&&i.elementId===id),id);
  assert.equal(review.fields[id],undefined,id);
  assert.equal(getCircularConflict({...raw,measureName:'MissingSensitive'}),null,id);
  for(const candidate of [raw,imported.config]){
   const dax=generateDAX(candidate);assert.doesNotMatch(dax,/MissingSensitive|MissingTarget|MissingRef|OldDates|OldDate/,id);
   assert.ok(!dax.includes(`VAR __val_${id} =`),id);
   assert.equal(sampleData(candidate)[`val_${id}`],undefined,id);
   if(base!=='icon')assert.ok(cardHTML(candidate).includes('Keep this text'),id);
  }
  assert.equal(updateElement(raw,id,{measure:'AnotherUnsupported'}).elements[id].measure,undefined,id);
 }
});

test('Numeric copies retain supported bindings and missing real measures still block model review',()=>{
 for(const base of ['value','referenceValue','status']){
  const id=base+'_copy1';
  const raw=config({type:base==='status'?'status':base==='trend'?'spark':'comparison',showTrend:base==='trend',elements:{[id]:{measure:'MissingReal',format:'number',decimals:0}}});
  const imported=validateImportedJSON(raw);
  assert.equal(imported.valid,true,id);assert.equal(imported.config.elements[id].measure,'MissingReal',id);
  assert.ok(!imported.warnings.some(w=>w.includes('decorativa')),id);
  assert.equal(reviewMeasure(imported.config,catalog).valid,false,id);
  assert.ok(reviewMeasure(imported.config,catalog).missing.some(r=>r.field===(base==='status'||base==='trend'?id+'__measure':id)),id);
  assert.match(generateDAX(imported.config),/\[MissingReal\]/,id);
 }
});

test('Measure and calendar column namespaces are distinct while actual circular measures remain rejected',()=>{
 const valid=sanitizeConfig(config({measureName:'Date',comparison:'yoy'}));
 assert.equal(getCircularConflict(valid),null);
 assert.equal(reviewMeasure(valid,catalog).valid,true);
 assert.doesNotThrow(()=>generateDAX(valid));
 assert.match(generateDAX(valid),/'Calendar'\[Date\]/);
 for(const patch of [{measure:'Date'},{targetMeasure:'Date',type:'target',showGoal:true},{compareMeasure:'Date',comparison:'custom'},
  {elements:{value_copy1:{measure:'Date'}}},{elements:{delta_copy1:{comparison:'custom',compareMeasure:'Date'}}}]){
  const circular=sanitizeConfig({...valid,...patch});assert.ok(getCircularConflict(circular),JSON.stringify(patch));
  assert.equal(reviewMeasure(circular,catalog).valid,false);assert.throws(()=>generateDAX(circular),/circular/);
 }
});

test('Percentage-point validation only blocks active variations and their actual inherited format',()=>{
 const base=config({type:'basic',comparison:'none',deltaMode:'pp',format:'currency'});
 for(const c of [base,{...base,comparison:'custom',showComparison:false},{...base,comparison:'custom',elements:{delta:{deleted:true}}},
  {...base,elements:{delta_copy1:{comparison:'none',deltaMode:'pp',format:'number'}}}]){
  assert.ok(!checks(c).some(i=>i.level==='error'&&i.text.includes('porcentuales')));
  assert.doesNotThrow(()=>generateDAX(c));assert.equal(reviewMeasure(c,catalog).valid,true);
 }
 const active={...base,comparison:'custom'};assert.throws(()=>generateDAX(active),/porcentuales/);
 const copy={...base,elements:{value_copy1:{measure:'Sales',format:'number'},delta_copy1:{comparison:'custom',compareMeasure:'Previous',deltaMode:'pp'}}};
 assert.throws(()=>generateDAX(copy),/porcentuales/);
 copy.elements.value_copy1.format='percent';assert.doesNotThrow(()=>generateDAX(copy));
 assert.equal(reviewMeasure(copy,catalog).valid,true);
});

test('TMDL scalar values preserve quoted text rules and official date metadata agrees with BIM',async()=>{
 const tmdl='table BusinessDates\n\tdataCategory: "Time"\n\tcolumn Date\n\t\tdataType: dateTime\n\t\tisKey: true\n\tmeasure Sales = 1';
 const parsed=parseTmdl(tmdl);
 assert.equal(parsed.isMarkedDateTable,true);assert.equal(parsed.primaryDateColumn,'Date');
 const file={name:'BusinessDates.tmdl',webkitRelativePath:'Demo.SemanticModel/definition/tables/BusinessDates.tmdl',size:tmdl.length,text:async()=>tmdl};
 const scanned=await scanFileList([file]);
 const bim=parseBim({name:'Demo',model:{tables:[{name:'BusinessDates',dataCategory:'Time',columns:[{name:'Date',dataType:'dateTime',isKey:true}],measures:[{name:'Sales'}]}]}});
 assert.deepEqual(scanned.dateTables,bim.dateTables);
 for(const category of ['Time','"Time"','tImE'])assert.equal(parseTmdl(tmdl.replace('"Time"',category)).isMarkedDateTable,true,category);
 for(const category of ['" Time "','"Ti""me"','"Time','"Time" trailing','Geography'])assert.equal(parseTmdl(tmdl.replace('"Time"',category)).isMarkedDateTable,false,category);
 assert.equal(parseTmdl(tmdl.replace('isKey: true','isKey: false')).primaryDateColumn,null);
 assert.equal(parseTmdl(tmdl.replace('isKey: true','isKey')).primaryDateColumn,'Date');
 const nested='table Transactions\n\tcolumn Date\n\t\tdataType: dateTime\n\t\tdataCategory: "Time"\n\tmeasure Html = ```\n\tdataCategory: "Time"\n```';
 assert.equal(parseTmdl(nested).isMarkedDateTable,false,'Quoted scalar support must retain table scope and opaque expressions');
});
