import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE,sanitizeConfig,checks} from '../dist/model.mjs';
import {goalBinding,valueBinding,updateElement} from '../dist/elements.mjs';
import {directBindingFields,directBindingElements} from '../dist/bindings.mjs';
import {reviewMeasure} from '../dist/preflight.mjs';
import {generateDAX,validateDAX} from '../dist/dax.mjs';
import {sampleData} from '../dist/cards.mjs';
import {copyElementData,pasteElementData} from '../dist/editor-clipboard.mjs';

const family=()=>sanitizeConfig({...BASE,measure:'Sales',targetMeasure:'100',measureName:'Card',elements:{
 value_copy1:{measure:'Cost',format:'number',decimals:1,unit:'none'},trend_copy1:{measure:'Ignored chart metric'},
 goalLabel_copy1:{targetMeasure:'200'},progress_copy1:{},progressLabel_copy1:{},delta_copy1:{comparison:'target'},
 value_copy2:{measure:'Sales'},progress_copy2:{targetMeasure:'Target 2'}
}});
const model={tables:['Measures','Calendario'],measures:['Sales','Cost','Target 2'].map(name=>({name,table:'Measures'})),dateTables:[{name:'Calendario',dateColumns:['Fecha']}]};

test('A copy family has one value and one objective across UI, preview, review and DAX',()=>{
 const c=family(),goal=goalBinding(c,'progress_copy1');
 assert.equal(c.elements.trend_copy1.measure,undefined);
 assert.equal(valueBinding(c,'trend_copy1').measure,'Cost');
 assert.equal(goal.field,'goalLabel_copy1__targetMeasure');
 assert.equal(goal.measure,'200');
 assert.deepEqual(directBindingFields(c,'trend_copy1'),['value_copy1','dateTable','dateColumn','granularity']);
 assert.ok(directBindingElements(c,'value_copy1').includes('trend_copy1'));
 for(const id of ['goalLabel_copy1','progress_copy1','progressLabel_copy1','delta_copy1'])assert.ok(directBindingFields(c,id).includes(goal.field));
 assert.ok(!directBindingElements(c,'targetMeasure').includes('progress_copy1'));
 const review=reviewMeasure(c,model);
 assert.equal(review.valid,true);
 assert.equal(review.references.filter(r=>r.field===goal.field).length,1);
 assert.equal(review.fields.progress_copy2__targetMeasure.status,'ok');
 assert.equal(review.fields.trend_copy1__measure,undefined);
 const sample=sampleData({...c,sampleValue:100});
 assert.equal(sample.progress_progress_copy1,'50 %');
 assert.equal(sample.progressWidth_progress_copy1,'50');
 const dax=generateDAX(c);
 assert.match(dax,/VAR __Objective_goalLabel_copy1 = 200/);
 assert.match(dax,/VAR __Target_progress_copy1 = __Objective_goalLabel_copy1/);
 assert.match(dax,/VAR __Dates_trend_copy1 = __Dates/);
 assert.match(dax,/CALCULATE \( \[Cost\], REMOVEFILTERS/);
 assert.doesNotMatch(dax,/Ignored chart metric/);
 assert.equal(validateDAX(dax).valid,true);
});

test('Empty, missing and circular copied objectives block instead of falling back to the principal target',()=>{
 let c=family();
 for(const objective of ['', 'Missing', 'Card']){
  c=updateElement(c,'goalLabel_copy1',{targetMeasure:objective});
  assert.equal(goalBinding(c,'progress_copy1').measure,objective);
  assert.equal(reviewMeasure(c,model).valid,false);
  if(objective==='Card')assert.ok(checks(c).some(i=>i.text.includes('circular')));
 }
 c=updateElement(c,'goalLabel_copy1',{targetMeasure:''});
 assert.equal(reviewMeasure(c,model).fields.goalLabel_copy1__targetMeasure.empty,true);
 assert.match(generateDAX(c,{allowIncomplete:true}),/VAR __Objective_goalLabel_copy1 = BLANK \(\)/);
 c=updateElement(family(),'value_copy1',{measure:''});
 assert.equal(valueBinding(c,'trend_copy1').measure,'');
 assert.equal(reviewMeasure(c,model).fields.value_copy1.status,'error');
 assert.match(generateDAX(c,{allowIncomplete:true}),/VAR __trend_trend_copy1 = ""/);
});

test('Removing a goal label and copying it preserves the family objective without changing the original',()=>{
 const original=family(),removed=updateElement(original,'goalLabel_copy1',{deleted:true});
 assert.equal(goalBinding(removed,'progress_copy1').measure,'200');
 assert.equal(goalBinding(removed,'progress_copy1').field,'progress_copy1__targetMeasure');
 assert.equal(original.elements.goalLabel_copy1.deleted,false);
 const pasted=pasteElementData(removed,[copyElementData(removed,'goalLabel')]).config;
 assert.equal(goalBinding(pasted,'progress_copy1').measure,'100');
 assert.equal(reviewMeasure(removed,model).valid,true);
});

test('Copied thresholds are declared with editable configuration and technical numbers keep a fixed locale',()=>{
 const c=sanitizeConfig({...BASE,type:'status',locale:'es-ES',elements:{status_copy1:{measure:BASE.measure,goodThreshold:7.5,warnThreshold:5.5}}});
 const dax=generateDAX(c);
 assert.ok(dax.indexOf('VAR __Cfg_GoodThreshold_status_copy1 = 7.5')<dax.indexOf('VAR __Current'));
 assert.match(dax,/__StatusValue_status_copy1 >= __Cfg_GoodThreshold_status_copy1/);
 assert.equal([...dax.matchAll(/"en-US"/g)].length,1);
 assert.match(dax,/VAR __Svg_Locale = "en-US"/);
 assert.match(dax,/FORMAT \( __Start, "dd\/MM\/yy", __Cfg_Locale \)/);
 assert.equal(validateDAX(dax).valid,true);
});

test('Copies without a numbered value keep explicit measures across hover, validation and DAX',()=>{
 const c=sanitizeConfig({...BASE,type:'executive',measure:'Sales',measureName:'Card',targetMeasure:'100',elements:{
  trend_copy1:{measure:'Cost'},delta_copy1:{measure:'Cost',comparison:'custom',compareMeasure:'Sales'},
  progress_copy1:{measure:'Cost',targetMeasure:'200'},progressLabel_copy1:{measure:'Sales'},status_copy1:{measure:'Cost'}
 }});
 for(const id of ['trend_copy1','delta_copy1','progress_copy1','progressLabel_copy1']){
  assert.equal(valueBinding(c,id).id,id);
  assert.ok(directBindingFields(c,id).includes(id+'__measure'));
  assert.ok(!directBindingElements(c,'measure').includes(id));
  assert.equal(reviewMeasure(c,model).fields[id+'__measure'].status,'ok');
 }
 const dax=generateDAX(c);
 const status={...c,type:'status'};
 assert.match(generateDAX(status),/VAR __StatusValue_status_copy1 = IF \( __HasDates, CALCULATE \( \[Cost\]/);
 assert.equal(reviewMeasure(status,model).fields.status_copy1__measure.status,'ok');
 assert.match(dax,/VAR __Cur_progress_copy1 = IF \( __HasDates, CALCULATE \( \[Cost\]/);
 assert.match(dax,/VAR __Cur_delta_copy1 = IF \( __HasDates, CALCULATE \( \[Cost\]/);
 assert.equal(validateDAX(dax).valid,true);
 for(const id of ['trend_copy1','delta_copy1','progress_copy1','progressLabel_copy1']){
  const empty=updateElement(c,id,{measure:''});
  assert.equal(reviewMeasure(empty,model).fields[id+'__measure'].empty,true);
  assert.equal(reviewMeasure(empty,model).valid,false);
 }
});

test('A missing paired value exposes an unconfigured measure and copying a linked chart captures its actual source',()=>{
 const linked=sanitizeConfig({...BASE,measure:'Sales',measureName:'Card',elements:{value_copy1:{measure:'Cost'},trend_copy1:{},delta_copy1:{comparison:'yoy'}}});
 const orphan=updateElement(linked,'value_copy1',{deleted:true});
 assert.equal(valueBinding(orphan,'trend_copy1').field,'trend_copy1__measure');
 assert.equal(valueBinding(orphan,'trend_copy1').measure,'');
 assert.equal(reviewMeasure(orphan,model).fields.trend_copy1__measure.status,'error');
 const pasted=pasteElementData(linked,[copyElementData(linked,'trend_copy1')]);
 assert.deepEqual(pasted.ids,['trend_copy2']);
 assert.equal(pasted.config.elements.trend_copy2.measure,'Cost');
 assert.equal(valueBinding(pasted.config,'trend_copy2').id,'trend_copy2');
 const rebound=sanitizeConfig({...pasted.config,elements:{...pasted.config.elements,value_copy2:{measure:'Sales'}}});
 assert.equal(rebound.elements.trend_copy2.measure,undefined);
 assert.equal(valueBinding(rebound,'trend_copy2').measure,'Sales');
});
