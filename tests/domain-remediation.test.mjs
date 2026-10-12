import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE,THEMES,sanitizeConfig,goalReached} from '../dist/model.mjs';
import {restoreElement,restorationIssue,resetElement,updateElement,elementSize} from '../dist/elements.mjs';
import {elementColor,elementBackground} from '../dist/appearance.mjs';
import {sampleData,cardHTML,renderTrend} from '../dist/cards.mjs';
import {generateDAX} from '../dist/dax.mjs';
import {validateImportedJSON,validateCardConfig,sanitizeModelCatalog} from '../dist/schema.mjs';
import {parseTmdl,scanDirectoryHandle,scanFileList} from '../dist/pbip.mjs';
import {contrastRatio} from '../dist/colors.mjs';

test('Meeting a goal is successful in either direction, consistently in principal, copies and DAX',()=>{
 for(const direction of ['up','down','neutral'])for(const value of [90,100,110]){
  const c=sanitizeConfig({...BASE,type:'target',comparison:'none',showTrend:false,direction,
   targetMeasure:'100',sampleValue:value,sampleTarget:900,format:'number',unit:'none',decimals:0,
   elements:{value_copy1:{measure:'Other'},progress_copy1:{},progressLabel_copy1:{},goalLabel_copy1:{}}
  });
  const d=sampleData(c),success=direction==='down'?value<=100:value>=100;
  const expected=direction==='neutral'?c.accent:success?c.positive:c.warning;
  assert.equal(goalReached(value,100,direction),success);
  assert.equal(d.goalColor,expected);
  assert.equal(d.goalColor_progress_copy1,expected);
  assert.equal(d.goalColor_progressLabel_copy1,expected);
  assert.equal(d.goalColor_goalLabel_copy1,expected);
  assert.equal(d.progress_progress_copy1,d.progress);
  assert.equal(d.targettext,'100','A numeric objective is exact, regardless of the illustrative target sample');
  assert.equal(d.val_goalLabel_copy1,d.targettext);
  const dax=generateDAX(c);
  const op=direction==='down'?'<=':'>=';
  if(direction==='neutral')assert.match(dax,/VAR __goalColor = .*__Cfg_ColorAccent/);
  else{
   assert.ok(dax.includes(`IF ( __Current ${op} __Target, __Cfg_ColorGood, __Cfg_ColorWarn )`));
   assert.ok(dax.includes(`IF ( __Cur_progress_copy1 ${op} __Target_progress_copy1, __Cfg_ColorGood, __Cfg_ColorWarn )`));
  }
 }
 for(const patch of [{sampleScenario:'empty'},{targetMeasure:'0'},{targetMeasure:'-10'},{targetMeasure:''}]){
  const c=sanitizeConfig({...BASE,type:'target',comparison:'none',showTrend:false,sampleValue:100,targetMeasure:'100',elements:{progress_copy1:{}},...patch});
  const d=sampleData(c);
  assert.equal(d.goalColor,c.muted);assert.equal(d.goalColor_progress_copy1,c.muted);
  assert.equal(d.progress,'—');assert.equal(d.progress_progress_copy1,'—');
  assert.equal(d.progressWidth,'0');assert.equal(d.progressWidth_progress_copy1,'0');
 }
});

test('Reset affects only its copy and keeps every kind of restored size importable',()=>{
 const c=sanitizeConfig({...BASE,titleSize:22,elements:{title:{x:17,y:9},title_copy1:{text:'Changed',size:38,x:80},title_copy2:{text:'Unaffected',size:29}}});
 const before=structuredClone(c),next=resetElement(c,'title_copy1',BASE);
 assert.equal(next.titleSize,22);assert.deepEqual(next.elements.title,before.elements.title);
 assert.deepEqual(next.elements.title_copy2,before.elements.title_copy2);
 assert.equal(elementSize(next,'title_copy1'),BASE.titleSize);
 assert.deepEqual(c,before,'The reset is immutable');
 const inactive=sanitizeConfig({...BASE,showSubtitle:false,elements:{subtitle_copy1:{text:'Copy',size:23,hidden:true}}});
 const resetInactive=resetElement(inactive,'subtitle_copy1',BASE);
 assert.equal(resetInactive.showSubtitle,false,'Resetting a copy must not enable the original shared toggle');
 assert.equal(resetInactive.elements.subtitle_copy1.hidden,false);
 for(const base of ['title','icon','trend','progress']){
  const id=base+'_copy1',configured=sanitizeConfig({...BASE,elements:{[id]:{size:30,x:10}}});
  const reset=resetElement(configured,id,BASE);
  assert.equal(elementSize(reset,id),elementSize(BASE,base));
  assert.equal(validateCardConfig(reset).valid,true,id);
  const imported=validateImportedJSON({config:reset});assert.equal(imported.valid,true,id);
  assert.equal(imported.config.elements[id].size,elementSize(BASE,base),id);
 }
 assert.equal(sanitizeConfig({...BASE,elements:{progress_copy1:{size:1}}}).elements.progress_copy1.size,2);
 assert.equal(sanitizeConfig({...BASE,elements:{progress_copy1:{size:100}}}).elements.progress_copy1.size,40);
});

test('Every restore path respects total and per-type copy limits without losing deleted contents',()=>{
 const elements=Object.fromEntries(['title','value','icon','footer'].flatMap(base=>[1,2].map(n=>[`${base}_copy${n}`,{}])));
 elements.subtitle_copy1={deleted:true,text:'Recover me',x:31};
 let c=sanitizeConfig({...BASE,elements});
 assert.match(restorationIssue(c,'subtitle_copy1'),/máximo 8/);
 assert.equal(restoreElement(c,'subtitle_copy1'),c);
 assert.equal(updateElement(c,'subtitle_copy1',{deleted:false}),c);
 assert.equal(resetElement(c,'subtitle_copy1',BASE),c);
 assert.equal(c.elements.subtitle_copy1.text,'Recover me');
 c=updateElement(c,'footer_copy2',{deleted:true});
 const restored=restoreElement(c,'subtitle_copy1');
 assert.equal(restored.elements.subtitle_copy1.deleted,false);assert.equal(restored.elements.subtitle_copy1.x,31);
 assert.equal(validateImportedJSON(restored).valid,true);
 c=sanitizeConfig({...BASE,elements:{title_copy1:{},title_copy2:{},title_copy3:{deleted:true,text:'Third'}}});
 assert.match(restorationIssue(c,'title_copy3'),/máximo 2/);
 assert.equal(restoreElement(c,'title_copy3'),c);
 c=updateElement(c,'title_copy1',{deleted:true});
 assert.equal(restorationIssue(c,'title_copy3'),null);
 assert.equal(validateImportedJSON(restoreElement(c,'title_copy3')).valid,true);
});

test('Shared-calendar legacy migration is explicit and normalization returns a stable importable contract',()=>{
 const raw={...BASE,title:'T'.repeat(180),measure:'M'.repeat(130),suffix:'S'.repeat(60),unknownOption:'old',
  elements:{value_copy1:{measure:'Other'},trend_copy1:{measure:'Metric',dateTable:'OldDates',dateColumn:'OldDay',granularity:'month'},
   delta_copy1:{measure:'OldMetric',targetMeasure:'250',comparison:'target'},progress_copy1:{targetMeasure:'OldGoal'}}};
 const before=structuredClone(raw),result=validateImportedJSON({config:raw});
 assert.equal(result.valid,true);assert.deepEqual(raw,before,'Inspecting import must not mutate its input');
 assert.equal(result.config.elements.trend_copy1.measure,undefined);
 assert.equal(result.config.elements.trend_copy1.granularity,'month');
 assert.equal(result.config.elements.trend_copy1.dateTable,undefined);
 assert.equal(result.config.elements.trend_copy1.dateColumn,undefined);
 assert.equal(result.config.elements.delta_copy1.measure,undefined);
 assert.equal(result.config.elements.progress_copy1.targetMeasure,'OldGoal');
 assert.equal(result.config.measure.length,120);assert.equal(result.config.suffix.length,40);
 assert.ok(result.warnings.some(w=>w.includes('calendario compartido')&&w.includes('trend_copy1')));
 assert.ok(result.warnings.some(w=>w.includes('valor asociado')&&w.includes('OldMetric')&&w.includes('Other')));
 assert.ok(result.warnings.some(w=>w.includes('objetivo de su grupo')&&w.includes('delta_copy1')));
 assert.ok(result.warnings.some(w=>w.includes("'measure'")&&w.includes('120')));
 assert.ok(result.warnings.some(w=>w.includes('unknownOption')));
 const roundtrip=validateImportedJSON({config:result.config});
 assert.equal(roundtrip.valid,true);assert.deepEqual(roundtrip.config,result.config);assert.deepEqual(roundtrip.warnings,[]);
 assert.doesNotMatch(generateDAX(result.config),/OldDates|OldDay|OldMetric/);
 assert.match(generateDAX(result.config),/\[OldGoal\]/);
 const donut=validateImportedJSON({...BASE,chartKind:'donut',elements:{trend_copy1:{measure:'UnusedOldMetric'}}});
 assert.equal(donut.config.elements.trend_copy1.measure,'UnusedOldMetric');
 assert.ok(!donut.warnings.some(w=>w.includes('UnusedOldMetric')&&w.includes('valor asociado')));
 const catalog=sanitizeModelCatalog({modelName:'Demo',tables:['Measures'],dateTables:[],measures:[{name:'KPI',table:'Measures',configAnnotation:raw,configWarnings:[23,{text:'invalid'}]}]});
 assert.deepEqual(catalog.measures[0].configWarnings,result.warnings);
 assert.deepEqual(sanitizeModelCatalog(catalog).measures[0].configWarnings,result.warnings,'A cache reload must retain the migration explanation');
});

test('Copied progress labels follow the matching bar and every progress track uses muted independently of goal color',()=>{
 const c=sanitizeConfig({...BASE,elements:{progress:{colorMode:'custom',color:'#111111'},progress_copy1:{colorMode:'custom',color:'#123456'},progressLabel_copy1:{colorMode:'linked'},goalLabel_copy1:{colorMode:'custom',color:'#112233'}}});
 const d={goalColor:c.warning,goalColor_progress_copy1:c.positive};
 assert.equal(elementColor(c,'progressLabel_copy1',d),'#123456');
 assert.equal(elementBackground(c,'progress_copy1',d),elementBackground(c,'progress',d));
 assert.equal(elementColor(updateElement(c,'progress_copy1',{deleted:true}),'progressLabel_copy1',d),'#111111');
 assert.match(cardHTML(c,undefined,true),/data-element="goalLabel_copy1"[^>]*>Objetivo <span style="color:#112233">/);
 const reference=sanitizeConfig({...BASE,type:'comparison',format:'currency',elements:{referenceValue_copy1:{measure:'Other',format:'number',unit:'none',decimals:0,suffix:'uds'}}});
 const line=generateDAX(reference).match(/VAR __val_referenceValue_copy1 = ([^\n]+)/)[1];
 assert.match(line,/uds/);assert.doesNotMatch(line,/€/);
});

test('Flat and single-point minimum labels and negative area fills agree between sample and export',()=>{
 const c=sanitizeConfig({...BASE,showMin:true,showMax:false,trendStyle:'area',sampleSeries:'10,10,10',elements:{trend_copy1:{measure:'Other',showMin:true,showMax:false}}});
 assert.match(renderTrend(c,[10,10,10]),/Mín\./);
 assert.match(sampleData(c).trend_trend_copy1,/Mín\./);
 const annotations=[...generateDAX(c).matchAll(/VAR __chartAnnotations(?:_trend_copy1)? = ([^\n]+)/g)].map(m=>m[1]);
 assert.equal(annotations.length,2);
 for(const line of annotations){assert.match(line,/Mín\./);assert.doesNotMatch(line,/IF \( MINX/);}
 assert.match(renderTrend(c,[10]),/Mín\./);
 assert.doesNotMatch(renderTrend(c,[-10,-5]),/<path[^>]+fill="url\(#/);
 assert.doesNotMatch(renderTrend(c,[10]),/<path[^>]+fill="url\(#/);
 assert.match(renderTrend(c,[10,20]),/<path[^>]+fill="url\(#/);
});

test('TMDL file discovery and parser accept the same case, quoted identifiers, tabs and spaces',async()=>{
 const text="TABLE 'Sales ''Model'''\n    COLUMN Date\n        DATATYPE: DateTime\n        ISKEY: true\n    DATACATEGORY: Time\n    MEASURE 'Revenue Total' = 1";
 const file={name:'Sales.TMDL',webkitRelativePath:'Demo.SemanticModel/definition/tables/Sales.TMDL',size:text.length,text:async()=>text};
 const direct=parseTmdl(text),list=await scanFileList([file]);
 const handle={kind:'directory',name:'Demo.SemanticModel',async *values(){yield {kind:'file',name:file.name,getFile:async()=>file};}};
 const directory=await scanDirectoryHandle(handle);
 for(const catalog of [list,directory]){
  assert.deepEqual(catalog.tables,[direct.table]);
  assert.equal(catalog.measures[0].name,'Revenue Total');
  assert.equal(catalog.dateTables[0].primaryDateColumn,'Date');
  assert.equal(catalog.dateTables[0].isMarkedDateTable,true);
 }
});

test('Preset text and semantic badges meet 4.5:1 contrast, without modifying imported custom palettes',()=>{
 const mix=(foreground,background,alpha)=>'#'+foreground.slice(1).match(/../g).map((hex,i)=>Math.round(parseInt(hex,16)*alpha+parseInt(background.slice(1).match(/../g)[i],16)*(1-alpha)).toString(16).padStart(2,'0')).join('');
 for(const [name,palette] of Object.entries(THEMES)){
  for(const role of ['text','muted','accent','positive','negative','warning'])assert.ok(contrastRatio(palette[role],palette.background)>=4.5,`${name}.${role}`);
  for(const role of ['positive','negative','warning'])assert.ok(contrastRatio(palette[role],mix(palette[role],palette.background,Math.round(10*255/100)/255))>=4.5,`${name}.${role} badge`);
 }
 const custom={...BASE,theme:'custom',background:'#fefefe',muted:'#cccccc',positive:'#aaaaaa'};
 const imported=validateImportedJSON(custom);
 assert.equal(imported.config.muted,custom.muted);assert.equal(imported.config.positive,custom.positive);
});
