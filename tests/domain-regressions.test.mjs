import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE,sanitizeConfig,needsDate,needsTrend,needsGoal,checks} from '../dist/model.mjs';
import {activeDuplicateIds,elementEnabled} from '../dist/elements.mjs';
import {generateDAX} from '../dist/dax.mjs';
import {sampleData,cardHTML} from '../dist/cards.mjs';
import {validateImportedJSON,validateCardConfig,validateElementCustomization,MAX_CONFIG_BYTES} from '../dist/schema.mjs';
import {parseTmdl} from '../dist/pbip.mjs';

test('Inactive copies cannot change the main calculation window or export dependencies',()=>{
 const basic={...BASE,type:'basic',comparison:'none',showComparison:false,showGoal:false,showTrend:false};
 for(const state of [{},{deleted:true},{hidden:true}]){
  const c={...basic,elements:{trend_copy987:{measure:'InactiveMetric',dateTable:'InactiveCalendar',dateColumn:'Day',...state},delta_copy988:{measure:'InactiveDelta',comparison:'yoy',...state}}};
  assert.deepEqual(activeDuplicateIds(c),[]);
  assert.equal(needsDate(c),false);
  assert.equal(needsTrend(c),false);
  assert.equal(needsGoal(c),false);
  assert.deepEqual(checks(c).filter(x=>x.level==='error'),[]);
  const dax=generateDAX(c);
  assert.match(dax,/VAR __Current = \[Total Ventas\]/);
  assert.doesNotMatch(dax,/Inactive|__Dates|__Current_trend_copy|__Diff_delta_copy/);
 }
 const c={...BASE,elements:{trend_copy989:{measure:'OwnMetric',dateTable:'OwnCalendar',dateColumn:'Day',hidden:true}}};
 assert.equal(elementEnabled(c,'trend_copy989'),true,'resolution must precede toggle lookup');
 assert.deepEqual(activeDuplicateIds(c),['trend_copy989']);
 assert.match(generateDAX(c),/OwnMetric/,'hidden orphan charts retain their own measure');
 assert.match(generateDAX(c),/CALCULATE \( \[Total Ventas\]/);
 assert.doesNotMatch(generateDAX(c),/OwnCalendar/,'legacy copy calendars cannot override the card calendar');
 assert.equal(elementEnabled({...c,showTrend:false},'trend_copy990'),false);
});

test('Copies simulate their independent comparison mode, objective, formatting and direction',()=>{
 const c={...BASE,format:'number',unit:'none',decimals:0,sampleValue:80,samplePrevious:50,sampleTarget:100,elements:{
  delta_copy1:{measure:'Other',comparison:'target',targetMeasure:'100',deltaMode:'absolute',direction:'down'},
  delta_copy2:{measure:'Other',comparison:'custom',compareMeasure:'Previous',deltaMode:'relative',direction:'up'}
 }};
 const d=sampleData(c);
 assert.equal(d.delta,'+60,0 %');
 assert.equal(d.delta_delta_copy1,'-20');
 assert.equal(d.arrow_delta_copy1,'↘');
 assert.equal(d.deltaColor_delta_copy1,c.positive);
 assert.equal(d.delta_delta_copy2,d.delta);
 for(const scenario of ['empty','zero','negative']){
  const cc={...c,sampleScenario:scenario,elements:{value_copy1:{measure:'Other',format:'number',unit:'none',decimals:0}}};
  const dd=sampleData(cc);
  assert.equal(dd.val_value_copy1,dd.value);
  assert.ok(cardHTML(cc,dd,true).includes(`data-element="value_copy1"`));
 }
 const none=sampleData({...c,elements:{delta_copy1:{measure:'Other',comparison:'none'}}});
 assert.equal(none.delta_delta_copy1,'—');
 assert.equal(none.arrow_delta_copy1,'—');
 assert.equal(none.deltaColor_delta_copy1,c.muted);
 const pp=sampleData({...c,format:'percent',sampleValue:.8,samplePrevious:.5,elements:{delta_copy1:{measure:'Other',comparison:'custom',compareMeasure:'Previous',deltaMode:'pp'}}});
 assert.equal(pp.delta_delta_copy1,'+30 pp');
 const missing=sampleData({...c,elements:{value_copy1:{measure:''},delta_copy1:{measure:'Other',comparison:'target',targetMeasure:''}}});
 assert.equal(missing.val_value_copy1,'—');
 assert.equal(missing.delta_delta_copy1,'—');
});

test('Copy percentage-point validation agrees with the exported format',()=>{
 const c={...BASE,elements:{delta_copy1:{measure:'Other',comparison:'custom',compareMeasure:'Previous',deltaMode:'pp'}}};
 assert.ok(checks(c).some(x=>x.elementId==='delta_copy1'&&x.level==='error'));
 assert.throws(()=>generateDAX(c),/porcentuales/);
 assert.doesNotThrow(()=>generateDAX({...c,elements:{delta_copy1:{...c.elements.delta_copy1,format:'percent'}}}));
 const ownFormat={...BASE,comparison:'custom',deltaMode:'absolute',elements:{delta_copy1:{measure:BASE.measure,comparison:'custom',compareMeasure:BASE.compareMeasure,format:'number',unit:'none',decimals:0,suffix:'items'}}};
 const dax=generateDAX(ownFormat);
 assert.doesNotMatch(dax,/VAR __delta_delta_copy1 = __delta\n/,'matching references cannot bypass independent formatting');
 assert.match(dax,/items/);
});

test('Copy contracts preserve chart granularity and reject invalid appearance or excessive copies',()=>{
 const raw={...BASE,targetTable:'Destination',elements:{trend_copy1:{measure:'Other',dateTable:'Dates',dateColumn:'Day',granularity:'month',trendGrid:'dots'}}};
 const normalized=sanitizeConfig(raw);
 assert.equal(normalized.elements.trend_copy1.granularity,'month');
 assert.equal(normalized.elements.trend_copy1.dateTable,undefined);
 assert.equal(normalized.elements.trend_copy1.dateColumn,undefined);
 assert.equal(normalized.targetTable,'Destination');
 assert.equal(validateImportedJSON(JSON.stringify({config:normalized})).valid,true);
 assert.equal(validateElementCustomization('trend_copy1',{trendGrid:'invalid'}).valid,false);
 assert.equal(validateElementCustomization('trend_copy1',{colorMode:'invalid'}).valid,false);
 assert.equal(validateCardConfig({...BASE,elements:{title_copy1:{},title_copy2:{},title_copy3:{}}}).valid,false);
 const elements=Object.fromEntries(['title','value','subtitle','icon','footer'].flatMap(id=>[1,2].map(n=>[`${id}_copy${n}`,{text:'A'.repeat(160)}])));
 assert.equal(validateCardConfig({...BASE,elements}).valid,false);
 delete elements.footer_copy1;delete elements.footer_copy2;
 const c=sanitizeConfig({...BASE,elements});
 const json=JSON.stringify({schema:'kpi-atelier',version:1,config:c},null,2);
 assert.ok(new TextEncoder().encode(json).byteLength<MAX_CONFIG_BYTES);
 assert.equal(validateImportedJSON(json).valid,true);
 assert.equal(validateImportedJSON(' '.repeat(MAX_CONFIG_BYTES)+'{}').valid,false);
});

test('TMDL catalog extraction ignores DAX/M declarations and nested properties',()=>{
 const tmdl=[
  'table Real',
  '\tmeasure Html =',
  '\t\t\tVAR html = "',
  '\t\t\ttable Phantom',
  '\t\t\tmeasure Bogus = 0',
  '\t\t\tcolumn Fake',
  '\t\t\tdataCategory: Time',
  '\t\t\t" RETURN html',
  '\t\tdataCategory: Time',
  '\tcolumn ActualDate =',
  '\t\t\tTODAY ()',
  '\t\tdataType: dateTime',
  '\t\tvariation Nested',
  '\t\t\tisKey',
  '\t\t\tdataType: int64',
  '\tpartition Source = m',
  '\t\tmode: import',
  '\t\tsource = ```',
  'table FencedPhantom',
  '\tmeasure FencedBogus = 1',
  '```',
  '\tmeasure Final = 2',
 ].join('\n');
 const parsed=parseTmdl(tmdl);
 assert.equal(parsed.table,'Real');
 assert.deepEqual(parsed.measures.map(m=>m.name),['Html','Final']);
 assert.deepEqual(parsed.dateColumns,['ActualDate']);
 assert.equal(parsed.primaryDateColumn,null);
 assert.equal(parsed.isMarkedDateTable,false);
 const spaces=parseTmdl("table 'Real ''Table'''\n    column 'Date'\n        dataType: date\n        isKey: true\n    dataCategory: Time\n    measure 'Quoted ''Name''' = 1");
 assert.equal(spaces.table,"Real 'Table'");
 assert.equal(spaces.measures[0].name,"Quoted 'Name'");
 assert.equal(spaces.primaryDateColumn,'Date');
 assert.equal(spaces.isMarkedDateTable,true);
});
