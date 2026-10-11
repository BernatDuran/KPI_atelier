import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE,TEMPLATES,THEMES,sanitizeConfig,checks,needsDate,needsTrend,isValidMeasureName} from '../dist/model.mjs';
import {sampleData,cardHTML,renderTrend,formatNumber,icon} from '../dist/cards.mjs';
import {generateDAX,generateDAXBody,measureRef,tableRef,validateDAX,isNumericLiteral,targetRef} from '../dist/dax.mjs';
import {ELEMENT_IDS,ELEMENTS,elementState,elementSize,moveElement,resizeElement,updateElement,restoreElement,elementVisible} from '../dist/elements.mjs';
import {hexToHSV,hsvToHex,contrastRatio,sanitizePalette,paletteFrom} from '../dist/colors.mjs';
import {ICON_OPTIONS} from '../dist/icons.mjs';

// Static syntax checks are not a substitute for evaluation by the Power BI engine.
function lexDax(code){
 let clean='',paren=0;
 for(let i=0;i<code.length;i++){
  const ch=code[i];
  if(ch==='/'&&code[i+1]==='/'){while(i<code.length&&code[i]!=='\n')i++;continue;}
  if(ch==='"'||ch==="'"||ch==='['){const end=ch==='['?']':ch;let closed=false;for(i++;i<code.length;i++){if(code[i]===end){if(code[i+1]===end){i++;continue;}closed=true;break;}}assert.ok(closed,'Unclosed string/identifier');clean+=' ';continue;}
  if(ch==='(')paren++;if(ch===')')paren--;assert.ok(paren>=0,'Unexpected close parenthesis');clean+=ch;
 }
 assert.equal(paren,0,'Unbalanced parentheses');
 const declared=new Set([...clean.matchAll(/VAR\s+(__\w+)/g)].map(x=>x[1]));
 const refs=[...clean.matchAll(/\b(__\w+)\b/g)].map(x=>x[1]);
 for(const v of refs)assert.ok(declared.has(v),'Undefined scalar '+v);
 return clean;
}
test('All 18 templates produce complete escaped HTML and statically consistent DAX',()=>{
 assert.equal(TEMPLATES.length,18);
 for(const t of TEMPLATES){assert.deepEqual(checks(t.config).filter(x=>x.level==='error'),[]);const html=cardHTML(t.config),dax=generateDAX(t.config);assert.ok(html.includes(t.config.title));assert.doesNotMatch(html,/NaN|undefined|Infinity|@@/);assert.doesNotMatch(dax,/@@|undefined|NaN/);lexDax(dax);}
});
test('Every comparison, trend and direction combination produces resolved DAX variables',()=>{
 for(const comparison of ['none','custom','yoy','mom','previous','target'])for(const trendStyle of ['area','line','bars'])for(const direction of ['up','down','neutral'])for(const granularity of ['auto','day','week','month']){
  const conf={...BASE,comparison,trendStyle,direction,granularity};lexDax(generateDAX(conf));
 }
});
test('Lower-is-better is independent from numerical arrow direction',()=>{
 const d=sampleData({...BASE,direction:'down',sampleValue:80,samplePrevious:100,comparison:'custom'});assert.equal(d.deltaColor,BASE.positive);assert.equal(d.arrow,'↘');assert.match(d.delta,/-20/);
 const neutral=sampleData({...BASE,direction:'neutral'});assert.equal(neutral.deltaColor,BASE.muted);
});
test('Missing data, zero reference and negative numbers remain finite',()=>{
 const empty=sampleData({...BASE,sampleScenario:'empty'});assert.equal(empty.value,'—');assert.equal(empty.delta,'—');assert.equal(empty.progress,'—');assert.equal(empty.status,'Sin datos');
 const zeroRef=sampleData({...BASE,samplePrevious:0,comparison:'custom'});assert.equal(zeroRef.delta,'—');
 const zero=sampleData({...BASE,sampleScenario:'zero'});assert.notEqual(zero.value,'—');assert.equal(zero.progress,'0 %');
 const negative=sampleData({...BASE,sampleScenario:'negative'});assert.ok(negative.value.startsWith('-'));assert.equal(negative.progressWidth,'0');
});
test('Goal has a capped visual bar, uncapped label and explicit invalid-target behavior',()=>{
 const d=sampleData({...BASE,sampleValue:150,sampleTarget:100});assert.equal(d.progressWidth,'100');assert.match(d.progress,/150/);
 assert.equal(sampleData({...BASE,sampleTarget:0}).progress,'—');
 assert.equal(sampleData({...BASE,sampleTarget:-100}).progress,'—');
 assert.equal(sampleData({...BASE,sampleTarget:100,sampleValue:80,direction:'down'}).goalColor,BASE.positive);
});
test('Threshold boundaries work in both directions',()=>{
 let conf={...BASE,type:'status',sampleValue:.95,goodThreshold:.95,warnThreshold:.8};assert.equal(sampleData(conf).status,BASE.statusGood);
 assert.equal(sampleData({...conf,sampleValue:.8}).status,BASE.statusWarn);
 assert.equal(sampleData({...conf,sampleValue:.79}).status,BASE.statusBad);
 conf={...conf,direction:'down',goodThreshold:.03,warnThreshold:.05};assert.equal(sampleData({...conf,sampleValue:.03}).status,BASE.statusGood);assert.equal(sampleData({...conf,sampleValue:.05}).status,BASE.statusWarn);
 assert.ok(checks({...conf,goodThreshold:1}).some(x=>x.level==='error'));
});
test('Percent point deltas do not confuse ratios and points',()=>{
 const conf={...BASE,format:'percent',unit:'none',deltaMode:'pp',comparison:'custom',sampleValue:.25,samplePrevious:.20};assert.match(sampleData(conf).delta,/\+5 pp/);assert.match(generateDAX(conf),/__Difference \* 100/);
 assert.ok(checks({...conf,format:'number'}).some(x=>x.level==='error'));
});
test('Flat, one-point, negative and empty trends produce finite coordinates',()=>{
 for(const values of [[],[5],[5,5,5],[-5,-2,-4],[-3,0,3]])for(const trendStyle of ['line','area','bars'])for(const zeroBase of [true,false]){const html=renderTrend({...BASE,trendStyle,zeroBase},values);assert.doesNotMatch(html,/NaN|Infinity|undefined/);}
});
test('Simple KPI can export without a date dependency or objective',()=>{
 const c={...BASE,type:'basic',comparison:'none',dateTable:'',dateColumn:'',targetMeasure:'',showGoal:false,showTrend:false};assert.equal(needsDate(c),false);assert.equal(needsTrend(c),false);assert.doesNotMatch(generateDAX(c),/VALUES|TREATAS|Calendario/);
});
test('Identifiers, text and imports cannot inject HTML, CSS or template tokens',()=>{
 assert.equal(tableRef("Date's"),"'Date''s'");assert.equal(measureRef('Revenue] Actual'),'[Revenue]] Actual]');assert.equal(measureRef('[Revenue]] Actual]'),'[Revenue]] Actual]');
 const c=sanitizeConfig({...BASE,title:'<script>alert(1)</script> @@value@@ "quoted"',background:'red;position:fixed',width:99999,font:'Arial;display:none',theme:'bad',decimals:100});assert.equal(c.background,BASE.background);assert.equal(c.width,800);assert.equal(c.font,BASE.font);assert.equal(c.decimals,3);
 const html=cardHTML(c);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/@@value@@/);lexDax(generateDAX(c));
});
test('Export validation rejects incomplete model mappings',()=>{
 for(const c of [{...BASE,measure:''},{...BASE,dateTable:''},{...BASE,measureName:'=broken'},{...BASE,comparison:'custom',compareMeasure:''},{...BASE,targetMeasure:''}])assert.throws(()=>generateDAX(c));
});
test('Direct manipulation uses exact 1/5px deltas and preserves original configuration',()=>{
 const c=sanitizeConfig({...BASE,elements:{value:{x:3,y:-7}}});
 const fine=moveElement(c,'value',1,-1,1),coarse=moveElement(c,'value',5,5,5);
 assert.deepEqual([fine.elements.value.x,fine.elements.value.y],[4,-8]);assert.deepEqual([coarse.elements.value.x,coarse.elements.value.y],[8,-2]);
 assert.deepEqual([c.elements.value.x,c.elements.value.y],[3,-7]);
 const bigger=resizeElement(c,'value',5,'size',100,5);assert.equal(bigger.valueSize,53);
 const wider=resizeElement(c,'value',5,'width',187,5);assert.equal(wider.elements.value.width,192);assert.equal(wider.valueSize,c.valueSize);
});
test('Moved and resized elements survive JSON and match exported DAX style',()=>{
 let c=moveElement(BASE,'title',17,-9);c=resizeElement(c,'title',6);c=updateElement(c,'title',{width:240});
 const restored=sanitizeConfig(JSON.parse(JSON.stringify(c)));assert.deepEqual(restored.elements,c.elements);assert.equal(restored.titleSize,20);
 const html=cardHTML(restored);assert.match(html,/translate\(17px,-9px\)/);assert.match(html,/width:240px;font-size:20px/);
 const dax=generateDAX(restored);assert.match(dax,/translate\(17px,-9px\)/);assert.match(dax,/width:240px;font-size:20px/);assert.doesNotMatch(dax,/data-element|editable-element|resize-handle/);lexDax(dax);
});
test('Hide reserves the element; delete removes it; restore retains its position',()=>{
 for(const template of TEMPLATES)for(const id of ELEMENT_IDS){
  let c=updateElement(template.config,id,{x:5,y:10,hidden:true});let html=cardHTML(c,undefined,true);lexDax(generateDAX(c));
  if(html.includes(`data-element="${id}"`))assert.match(html,/visibility:hidden/);
  c=updateElement(c,id,{deleted:true});html=cardHTML(c,undefined,true);assert.ok(!html.includes(`data-element="${id}"`));lexDax(generateDAX(c));
  c=restoreElement(c,id);assert.equal(elementState(c,id).x,5);assert.equal(elementState(c,id).y,10);assert.equal(elementState(c,id).deleted,false);
 }
});
test('Removing every trend and comparison element removes date dependencies',()=>{
 let c={...BASE,type:'spark',dateTable:'',dateColumn:''};
 for(const id of ['trend','delta','compareLabel'])c=updateElement(c,id,{deleted:true});
 assert.equal(needsDate(c),false);assert.doesNotMatch(generateDAX(c),/VAR __Dates/);
 const hidden=updateElement(BASE,'trend',{hidden:true});assert.ok(needsTrend(hidden));lexDax(generateDAX(hidden));
});
test('Legacy designs migrate and malformed geometry cannot inject styles',()=>{
 const old={...BASE};delete old.elements;delete old.subtitleSize;const migrated=sanitizeConfig(old);assert.deepEqual(migrated.elements,{});assert.equal(migrated.subtitleSize,11);
 const c=sanitizeConfig({...BASE,elements:{title:{x:'1;position:fixed',y:Infinity,width:-20,hidden:'true'},rogue:{x:10}}});assert.equal(c.elements.title.x,0);assert.equal(c.elements.title.y,0);assert.equal(c.elements.title.width,0);assert.equal(c.elements.title.hidden,false);assert.ok(!('rogue'in c.elements));
});
test('All 47 icon choices have distinct valid SVG and survive the schema',()=>{
 assert.equal(ICON_OPTIONS.length,47);const rendered=new Set();for(const [id]of ICON_OPTIONS){const c=sanitizeConfig({...BASE,icon:id,iconSize:64});assert.equal(c.icon,id);const svg=icon(id,64,c.accent);assert.match(svg,/width="64"/);rendered.add(svg);assert.ok(cardHTML(c).includes(svg));}assert.equal(rendered.size,47);
});
test('Color-map conversion, contrast and palette validation cover boundary colors',()=>{
 assert.equal(Object.keys(THEMES).length,11);
 for(const color of Object.values(paletteFrom(THEMES.marble)))assert.match(color,/^#([0-9a-f]{2})\1\1$/i);
 for(const theme of Object.values(THEMES))for(const color of Object.values(paletteFrom(theme))){const {h,s,v}=hexToHSV(color);assert.equal(hsvToHex(h,s,v),color.toLowerCase());}
 for(const color of ['#000000','#ffffff','#ff0000','#00ff00','#0000ff']){const {h,s,v}=hexToHSV(color);assert.equal(hsvToHex(h,s,v),color);}
 assert.equal(hsvToHex(360,1,1),'#ff0000');assert.equal(contrastRatio('#000000','#ffffff'),21);assert.equal(contrastRatio('#ffffff','#ffffff'),1);assert.equal(sanitizePalette({...THEMES.paper,text:'url(fake)'}),null);
});

// Version 1.2: configurable appearance, export parity and alignment geometry.
import {appearance,elementColor,elementBackground,alphaColor,trendFill,SURFACE_EFFECTS,surfaceStyles} from '../dist/appearance.mjs';
import {alignmentGuides} from '../dist/guides.mjs';
const elementMarkup=(html,id)=>{const start=html.indexOf(`data-element="${id}"`);assert.ok(start>=0,id+' must be rendered');const next=html.indexOf('data-element=',start+14+id.length);return html.slice(start,next===-1?undefined:next);};
test('Every theme controls the progress bar and linked percentage; semantic mode remains opt-in',()=>{
 for(const theme of Object.values(THEMES)){
  let c=sanitizeConfig({...BASE,...theme}),data=sampleData(c);
  assert.equal(elementColor(c,'progress',data),theme.accent);assert.equal(elementColor(c,'progressLabel',data),theme.accent);
  const html=cardHTML(c,undefined,true);assert.ok(elementMarkup(html,'progress').includes('background:'+theme.accent+';'));assert.ok(elementMarkup(html,'progressLabel').includes('color:'+theme.accent+';'));
  c=updateElement(c,'progress',{colorMode:'semantic'});assert.equal(elementColor(c,'progress',data),data.goalColor);assert.equal(elementColor(c,'progressLabel',data),data.goalColor);
  c=updateElement(c,'progress',{colorMode:'custom',color:'#2233cc'});assert.equal(elementColor(c,'progressLabel',data),'#2233cc');
  c=updateElement(c,'progressLabel',{colorMode:'custom',color:'#331122'});assert.equal(elementColor(c,'progressLabel',data),'#331122');assert.equal(elementColor(c,'progress',data),'#2233cc');
 }
});
test('All sixteen elements support independent color and opacity in HTML and DAX',()=>{
 for(const id of ELEMENT_IDS){
  const c=sanitizeConfig(updateElement({...BASE,type:id==='status'?'status':id.startsWith('reference')?'comparison':'executive'},id,{colorMode:'custom',color:'#1234ab',opacity:43}));
  const markup=elementMarkup(cardHTML(c,undefined,true),id);assert.ok(markup.includes('color:#1234ab;opacity:0.43;'),id);
  const dax=generateDAX(c);assert.match(dax,/color:#1234ab;opacity:0.43;/);lexDax(dax);
  if(id==='icon')assert.match(markup,/stroke="#1234ab"/);
  if(id==='progress')assert.match(markup,/background:#1234ab;/);
  if(id==='status')assert.match(markup,/font-weight:600;color:#1234ab/);
  assert.deepEqual(sanitizeConfig(JSON.parse(JSON.stringify(c))).elements,c.elements);
 }
});
test('Chip, status, icon and progress track have independent background color and alpha, including zero',()=>{
 assert.equal(alphaColor('#123456',0),'#12345600');assert.equal(alphaColor('#123456',50),'#12345680');assert.equal(alphaColor('#123456',100),'#123456ff');
 for(const id of ['delta','status','icon','progress'])for(const opacity of [0,28,100]){
  const c=sanitizeConfig(updateElement({...BASE,type:id==='status'?'status':'executive'},id,{backgroundMode:'custom',backgroundColor:'#654321',backgroundOpacity:opacity}));
  const color=alphaColor('#654321',opacity);assert.equal(elementBackground(c,id,sampleData(c)),color);
  assert.ok(elementMarkup(cardHTML(c,undefined,true),id).includes('background:'+color));assert.ok(generateDAX(c).includes('background:'+color));
  const noBackground=updateElement(c,id,{backgroundMode:'none'});assert.equal(elementBackground(noBackground,id),'transparent');
 }
 const c=updateElement(BASE,'delta',{backgroundOpacity:50}),dax=generateDAX(c);assert.match(dax,/__deltaColor\s*&\s*"80;/);lexDax(dax);
});
test('Custom sparkline colors are used by line, dots, bars and independently colored area in exports',()=>{
 for(const trendStyle of ['area','line','bars']){
  const c=sanitizeConfig(updateElement({...BASE,trendStyle,areaFill:'solid',fillOpacity:.87},'trend',{colorMode:'custom',color:'#124578',fillMode:'custom',fillColor:'#987654'}));
  assert.equal(trendFill(c),'#987654');const html=renderTrend(c,[2,4,3]),dax=generateDAX(c);assert.ok(html.includes('#124578'));assert.ok(dax.includes('#124578'));lexDax(dax);
  if(trendStyle==='area'){assert.match(html,/fill="#987654" opacity="0.87"/);assert.match(dax,/fill=""#987654"" opacity=""0.87""/);}
 }
});
test('Surface effects preserve text opacity and export inline without editor guides or external assets',()=>{
 for(const [surfaceEffect]of SURFACE_EFFECTS)for(const effectIntensity of [0,35,100]){
  const c=sanitizeConfig({...BASE,surfaceEffect,effectIntensity,effectColorMode:'custom',effectColor:'#123456',glassOpacity:45,glassBlur:22});
  const style=surfaceStyles(c),html=cardHTML(c),dax=generateDAX(c);assert.ok(html.includes(style));assert.ok(dax.includes(style));assert.doesNotMatch(style,/NaN|undefined|url\(|(?:^|;)opacity:/);assert.doesNotMatch(dax,/smart-guide|selection-overlay|data-card-surface/);lexDax(dax);
  if(surfaceEffect==='glass'){assert.match(style,/backdrop-filter:blur\(22px\)/);assert.ok(style.includes(alphaColor(c.background,45)));}
 }
});
test('Appearance migration and malicious imports retain safe defaults, bounds and valid colors only',()=>{
 const old={...BASE};delete old.surfaceEffect;const migrated=sanitizeConfig(old);assert.equal(migrated.surfaceEffect,'solid');assert.equal(appearance(migrated,'progress').colorMode,'theme');
 const bad=sanitizeConfig({...BASE,surfaceEffect:'url(bad)',effectColor:'red;position:fixed',glassBlur:200,glassOpacity:-1,elements:{value:{colorMode:'semantic',color:'red"/><script>',opacity:Infinity},progressLabel:{colorMode:'linked'},delta:{backgroundColor:'#AaBbCc',backgroundOpacity:400,fillMode:'url(bad)'}}});
 assert.equal(bad.surfaceEffect,'solid');assert.equal(bad.effectColor,BASE.effectColor);assert.equal(bad.glassBlur,40);assert.equal(bad.glassOpacity,10);assert.equal(appearance(bad,'value').colorMode,'theme');assert.equal(appearance(bad,'value').opacity,100);assert.equal(bad.elements.delta.backgroundColor,'#aabbcc');assert.equal(bad.elements.delta.backgroundOpacity,100);
 assert.doesNotMatch(cardHTML(bad),/<script>|url\(bad\)|Infinity|NaN/);lexDax(generateDAX(bad));
});
test('Alignment guides detect borders, padding, centers and peers in card coordinates',()=>{
 const card={width:440,height:320};
 const border=alignmentGuides({left:0,top:0,width:80,height:40},card,[],28,0);assert.equal(border.outside,false);assert.ok(border.lines.some(l=>l.axis==='x'&&l.position===0&&l.kind==='edge'));assert.ok(border.lines.some(l=>l.axis==='y'&&l.position===0));
 const margin=alignmentGuides({left:28,top:28,width:100,height:40},card,[],28,0);assert.ok(margin.lines.some(l=>l.axis==='x'&&l.position===28&&l.kind==='margin'));
 const center=alignmentGuides({left:180,top:140,width:80,height:40},card,[],28,0);assert.ok(center.lines.some(l=>l.axis==='x'&&l.position===220));assert.ok(center.lines.some(l=>l.axis==='y'&&l.position===160));
 const peer=alignmentGuides({left:73,top:43,width:50,height:35},card,[{left:73,top:100,width:110,height:20}],28,0);assert.ok(peer.lines.some(l=>l.position===73&&l.kind==='peer'));
 const near=alignmentGuides({left:4,top:43,width:50,height:35},card,[],28,6);assert.ok(near.lines.some(l=>l.axis==='x'&&l.position===0));
 const far=alignmentGuides({left:4,top:43,width:50,height:35},card,[],28,2);assert.ok(!far.lines.some(l=>l.axis==='x'&&l.position===0));
});
test('Guides report four-sided overflow for movement and enlargement without mutating geometry',()=>{
 const box={left:-7,top:-5,width:460,height:338},card={width:440,height:320};
 const result=alignmentGuides(box,card,[],28,3);assert.deepEqual(result.overflow,{left:7,top:5,right:13,bottom:13});assert.equal(result.outside,true);assert.deepEqual(box,{left:-7,top:-5,width:460,height:338});
 const inside=alignmentGuides({left:0,top:0,width:440,height:320},card,[],28,3);assert.equal(inside.outside,false);assert.equal(new Set(inside.lines.map(l=>l.axis+':'+l.position)).size,inside.lines.length);
});

// Version 1.3: detached layout slots and true, cross-group layer ordering.
import {DEFAULT_LAYER_ORDER,frameFromBounds,detachElement,releaseElement,sanitizeFrame,layerOrder,layerZIndex,moveLayer,reorderLayer,elementAvailable} from '../dist/elements.mjs';
const frame={left:28,top:65.625,width:190.375,height:53.75};
const renderedConfig=id=>sanitizeConfig({...BASE,geometryVersion:1,type:id==='status'?'status':id.startsWith('reference')?'comparison':'executive'});
const visualStart=(html,id)=>html.indexOf(`<div data-element="${id}"`);
const visualStyle=(html,id)=>{
 const match=html.slice(visualStart(html,id)).match(/^<div[^>]*style="([^"]*)"/);assert.ok(match,id+' rendered style');return match[1];
};
test('Capture of independent positions accounts for zoom, borders and existing offsets without a jump',()=>{
 for(const scale of [.5,.83,1,1.5])for(const borderWidth of [0,1,4]){
  const c=updateElement({...BASE,borderWidth},'value',{x:17,y:-9});
  const surface={left:101,top:76,width:c.width*scale,height:400*scale};
  const box={left:surface.left+(borderWidth+frame.left+17)*scale,top:surface.top+(borderWidth+frame.top-9)*scale,width:frame.width*scale,height:frame.height*scale};
  const captured=frameFromBounds(c,'value',box,surface,scale);assert.deepEqual(captured,frame);
  const detached=detachElement(c,'value',captured);assert.deepEqual(elementState(detached,'value').frame,frame);assert.equal(elementState(detached,'value').x,17);assert.equal(elementState(detached,'value').y,-9);
  assert.equal(detachElement(detached,'value',{...frame,left:999}),detached,'Later edits must not recapture the original slot');
 }
 assert.equal(frameFromBounds(BASE,'value',{}, {},0),null);
});
test('Moving and resizing every element leaves the rest of its composition unchanged',()=>{
 for(const id of ELEMENT_IDS){
  const initial=renderedConfig(id),moved=moveElement(initial,id,15,-10,5,frame);
  assert.deepEqual(elementState(moved,id).frame,frame);
  const original=cardHTML(moved,undefined,true),flowBefore=original.slice(0,visualStart(original,id));
  assert.ok(flowBefore.includes(`data-layout-slot="${id}"`),id+' retains a layout slot');
  for(const changed of [resizeElement(moved,id,12),resizeElement(moved,id,80,'width',frame.width),{...moved,[ELEMENTS[id].sizeKey]:elementSize(moved,id)+7}]){
   const html=cardHTML(changed,undefined,true);
   assert.equal(html.slice(0,visualStart(html,id)),flowBefore,id+': siblings and original layout slot must not change');
   const style=visualStyle(html,id);assert.match(style,/position:absolute;left:28px;top:65.625px;margin:0;/);assert.match(style,/translate\(15px,-10px\)/);
   assert.deepEqual(elementState(changed,id).frame,frame);assert.deepEqual(initial.elements,{});
   const dax=generateDAX(changed);assert.match(dax,/position:absolute;left:28px;top:65.625px;margin:0;/);assert.doesNotMatch(dax,/data-layout-slot|data-element/);lexDax(dax);
  }
 }
});
test('Clicks or zero snapped movement retain automatic layout; moved objects stay independent at zero offset',()=>{
 const clicked=moveElement(BASE,'value',0,0,1,frame);assert.equal(elementState(clicked,'value').frame,undefined);
 const substep=moveElement(BASE,'value',1,1,5,frame);assert.equal(elementState(substep,'value').frame,undefined);
 const moved=moveElement(BASE,'value',5,5,5,frame),returned=moveElement(moved,'value',-5,-5,5,frame);
 assert.deepEqual(elementState(returned,'value').frame,frame);assert.equal(elementState(returned,'value').x,0);assert.equal(elementState(returned,'value').y,0);
 const auto=resizeElement(BASE,'value',12);assert.match(cardHTML(auto,undefined,true),/position:absolute/);assert.doesNotMatch(cardHTML(auto,undefined,true),/data-layout-slot/);
});
test('Independent position, slot size and layer order survive save/import, hide/delete/restore and undo snapshots',()=>{
 let c=moveElement({...BASE,geometryVersion:1},'icon',20,35,5,{...frame,width:20,height:20});c=resizeElement(c,'icon',15);c=reorderLayer(c,'icon','period','before');
 const snapshot=structuredClone(c),roundTrip=sanitizeConfig(JSON.parse(JSON.stringify(c)));assert.deepEqual(roundTrip,c);
 const html=cardHTML(roundTrip,undefined,true);assert.match(visualStyle(html,'icon'),/width:35px;font-size:35px/);assert.match(html,/data-layout-slot="icon"[^>]*width:20px;height:20px/);
 for(const flag of ['hidden','deleted']){const changed=updateElement(c,'icon',{[flag]:true}),restored=restoreElement(changed,'icon');assert.deepEqual(restored.elements.icon.frame,c.elements.icon.frame);assert.deepEqual(restored.layerOrder,c.layerOrder);}
 const edited=resizeElement(c,'icon',30);assert.deepEqual(c,snapshot);assert.notEqual(edited.iconSize,snapshot.iconSize);
 const released=releaseElement(c,'icon');assert.equal(released.elements.icon.frame,undefined);assert.equal(released.elements.icon.x,0);assert.equal(released.iconSize,c.iconSize);assert.deepEqual(released.layerOrder,c.layerOrder);
});
test('Layer ordering changes only paint order across automatic and independent elements',()=>{
 const start=moveElement(BASE,'icon',20,35,5,frame),front=reorderLayer(start,'icon','period','before');
 assert.equal(layerOrder(front)[0],'icon');assert.ok(layerZIndex(front,'icon')>layerZIndex(front,'period'));
 assert.deepEqual(front.elements,start.elements);
 assert.equal(cardHTML(front).replace(/z-index:\d+;/g,''),cardHTML(start).replace(/z-index:\d+;/g,''));
 const html=cardHTML(front,undefined,true);assert.match(visualStyle(html,'icon'),/z-index:16;/);assert.ok(generateDAX(front).includes(visualStyle(html,'icon')));
 const back=reorderLayer(front,'icon','eyebrow','after');assert.equal(layerOrder(back).at(-1),'icon');assert.equal(layerZIndex(back,'icon'),1);
 assert.equal(cardHTML(back).replace(/z-index:\d+;/g,''),cardHTML(start).replace(/z-index:\d+;/g,''));lexDax(generateDAX(back));
 assert.equal(reorderLayer(back,'icon','icon'),back);assert.equal(reorderLayer(back,'rogue','value'),back);
});
test('Layer arrows skip unavailable elements, respect bounds and keep hidden and deleted layers reorderable',()=>{
 let c=sanitizeConfig({...BASE,type:'basic',comparison:'none'});const available=layerOrder(c).filter(id=>elementAvailable(c,id)),last=available.at(-1),first=available[0];
 assert.equal(moveLayer(c,first,-1),c);assert.equal(moveLayer(c,last,1),c);
 c=updateElement(c,available[1],{hidden:true});const next=moveLayer(c,available[1],-1);assert.equal(layerOrder(next).filter(id=>elementAvailable(next,id))[0],available[1]);assert.equal(next.elements[available[1]].hidden,true);
 c=updateElement(next,available[1],{deleted:true});const down=moveLayer(c,available[1],1);assert.equal(layerOrder(down).filter(id=>elementAvailable(down,id))[1],available[1]);assert.equal(down.elements[available[1]].deleted,true);
 assert.equal(layerOrder(down).length,ELEMENT_IDS.length);assert.ok(layerOrder(down).includes('progress'));
});
test('Invalid imported frames and layer orders cannot inject CSS or lose elements',()=>{
 const c=sanitizeConfig({...BASE,layerOrder:['value','value','<script>','progress'],elements:{value:{frame:{left:'1;position:fixed',top:0,width:100,height:30}},icon:{frame:{left:1,top:0,width:-1,height:30}},title:{frame:{left:Infinity,top:0,width:100,height:30}}}});
 assert.equal(c.elements.value.frame,undefined);assert.equal(c.elements.icon.frame,undefined);assert.equal(c.elements.title.frame,undefined);
 assert.deepEqual(c.layerOrder.slice(0,2),['value','progress']);assert.equal(new Set(c.layerOrder).size,ELEMENT_IDS.length);assert.equal(c.layerOrder.length,ELEMENT_IDS.length);
 assert.deepEqual(sanitizeConfig({...BASE,layerOrder:null}).layerOrder,DEFAULT_LAYER_ORDER);assert.equal(sanitizeFrame({left:0,top:0,width:100,height:NaN}),null);
 assert.doesNotMatch(cardHTML(c),/<script>|Infinity|NaN/);lexDax(generateDAX(c));
});

// v1.4: exact canvas bounds, independent visual geometry and chart parity.
import {CARD_LIMITS,presetFrames,elementFrame,freezeLayout,resizeCard,applyLayout,chartDimensions} from '../dist/layout.mjs';
import {chartGeometry,chartPoints,linePath,extrema,renderDonut} from '../dist/charts.mjs';
test('Every template shares a 200px minimum and an exact clipped canvas',()=>{
 for(const t of TEMPLATES){
  const c=sanitizeConfig({...t.config,width:1,height:0}),html=cardHTML(c,undefined,true);
  assert.equal(c.width,200);assert.equal(c.height,200);assert.match(html,/width:200px;/);assert.match(html,/height:200px;overflow:hidden;/);assert.doesNotMatch(html,/min-height:/);
  const resized=resizeCard(t.config,-200,-500);assert.equal(resized.width,200);assert.equal(resized.height,200);
  const capped=resizeCard(t.config,5000,5000);assert.deepEqual([capped.width,capped.height],[800,650]);
  assert.match(generateDAX(c),/height:200px;overflow:hidden;/);
 }
});
test('Resizing unmoved or moved objects changes no peer geometry or canvas dimensions',()=>{
 for(const id of ELEMENT_IDS)for(const layout of ['stacked','chart-left','chart-right'])for(const moved of [false,true]){
  let c=sanitizeConfig({...BASE,layout,type:id==='status'?'status':id.startsWith('reference')?'comparison':'executive'});
  if(moved)c=moveElement(c,id,21,-13,1,elementFrame(c,id));
  const before=cardHTML(c,undefined,true);
  for(const next of [resizeElement(c,id,11),resizeElement(c,id,43,'width',elementFrame(c,id).width)]){
   const after=cardHTML(next,undefined,true);assert.deepEqual([next.width,next.height],[c.width,c.height]);
   assert.equal(after.slice(0,after.indexOf('>')),before.slice(0,before.indexOf('>')));
   for(const peer of ELEMENT_IDS.filter(p=>p!==id&&elementAvailable(c,p)))assert.equal(visualStyle(after,peer),visualStyle(before,peer),id+' altered '+peer);
  }
 }
});
test('Card resize freezes contents; applying distribution explicitly resets only geometry',()=>{
 let c=updateElement(BASE,'value',{x:17,y:-9,colorMode:'custom',color:'#123456',hidden:true,width:210});
 c=reorderLayer(c,'icon','value','before');
 const before=cardHTML(c,undefined,true),small=resizeCard(c,200,200,false),large=resizeCard(small,780,620,false);
 for(const id of ELEMENT_IDS.filter(id=>elementAvailable(c,id))){assert.equal(visualStyle(cardHTML(small,undefined,true),id),visualStyle(before,id));assert.equal(visualStyle(cardHTML(large,undefined,true),id),visualStyle(before,id));}
 assert.deepEqual(chartDimensions(c),chartDimensions(small));
 const horizontal=applyLayout(large,'chart-left');assert.equal(horizontal.width,780);assert.equal(horizontal.height,620);assert.equal(horizontal.elements.value.x,0);assert.equal(horizontal.elements.value.frame,undefined);assert.equal(horizontal.elements.value.width,0);assert.equal(horizontal.elements.value.color,'#123456');assert.equal(horizontal.elements.value.hidden,true);assert.deepEqual(horizontal.layerOrder,c.layerOrder);
 assert.ok(elementFrame(horizontal,'trend').left<elementFrame(horizontal,'value').left);
 const right=applyLayout(c,'chart-right');assert.ok(elementFrame(right,'trend').left>elementFrame(right,'value').left);
});
test('Smooth, straight and stepped paths are finite, bounded and use matching aspect ratios',()=>{
 for(const trendCurve of ['smooth','linear','step'])for(const values of [[],[3],[3,3,3],[-8,12,-3,7],[0,0],[NaN,Infinity,4]])for(const size of [24,75,160,240]){
  const c={...BASE,trendCurve,trendHeight:size,showMin:true,showMax:true},points=chartPoints(c,values),g=chartGeometry(c),path=linePath(points,trendCurve),html=renderTrend(c,values);
  assert.doesNotMatch(path+html,/NaN|Infinity|undefined|preserveAspectRatio="none"/);
  for(const p of points){assert.ok(p.x>=g.left&&p.x<=g.right);assert.ok(p.y>=g.top&&p.y<=g.bottom);}
  if(points.length>1)assert.ok(path.includes(trendCurve==='smooth'?'C':trendCurve==='step'?'H':'L'));
  lexDax(generateDAX(c));
 }
});
test('Min/max labels handle ties, flat/empty series, tiny charts and escaped values',()=>{
 const c={...BASE,showMin:true,showMax:true,showDot:false,trendHeight:120,showMarkerGuides:true};
 const pts=chartPoints(c,[3,8,8,-2,-2]);assert.equal(extrema(pts).max,pts[1]);assert.equal(extrema(pts).min,pts[3]);
 const regular=renderTrend(c,[3,8,-2]);assert.match(regular,/Máx\./);assert.match(regular,/Mín\./);assert.match(regular,/stroke-dasharray="2 4"/);
 const flat=renderTrend(c,[3,3,3]);assert.equal((flat.match(/<text /g)||[]).length,1);assert.match(flat,/Máx\./);
 assert.doesNotMatch(renderTrend(c,[]),/<text/);assert.doesNotMatch(renderTrend({...c,trendHeight:24},[1,4]),/<text/);
 assert.match(renderTrend({...c,suffix:'<test>'},[2,4]),/&lt;test&gt;/);
 const dax=generateDAX(c);assert.match(dax,/VAR __MaxPoint = TOPN/);assert.match(dax,/VAR __MinPoint = TOPN/);assert.match(dax,/Máx\./);assert.match(dax,/Mín\./);lexDax(dax);
});
test('Gradient and solid area settings preserve color and opacity in sample and DAX exports',()=>{
 for(const areaFill of ['gradient','solid'])for(const fillOpacity of [0,.35,1]){
  const c=updateElement({...BASE,areaFill,fillOpacity},'trend',{fillMode:'custom',fillColor:'#aabbcc',colorMode:'custom',color:'#112233'}),html=renderTrend(c,[2,5,3]),dax=generateDAX(c);
  assert.ok(html.includes('#aabbcc'));assert.ok(dax.includes('#aabbcc'));assert.ok(html.includes('#112233'));assert.ok(dax.includes('#112233'));
  if(areaFill==='gradient'){assert.match(html,/<linearGradient/);assert.ok(html.includes(`stop-opacity="${fillOpacity}"`));assert.match(html,/offset="100%" stop-color="#aabbcc" stop-opacity="0"/);assert.match(dax,/<linearGradient/);}
  else{assert.doesNotMatch(html,/<linearGradient/);assert.match(html,new RegExp('opacity="'+fillOpacity+'"'));}
  lexDax(dax);
 }
});
test('Donut exports dynamic progress with no unnecessary trend/calendar dependency',()=>{
 const base=sanitizeConfig({...BASE,type:'target',chartKind:'donut',comparison:'none',dateTable:'',dateColumn:'',sampleValue:150,sampleTarget:100});
 assert.equal(needsTrend(base),false);assert.equal(needsDate(base),false);
 const html=cardHTML(base,undefined,true),dax=generateDAX(base);
 assert.match(html,/stroke-dasharray="100 100"/);assert.match(html,/150/);assert.doesNotMatch(html,/data-element="progress"/);assert.doesNotMatch(dax,/VAR __Dates|VAR __Series/);assert.match(dax,/__progressWidth/);assert.match(dax,/__progress/);lexDax(dax);
 for(const sampleTarget of [0,-1]){const conf={...base,sampleTarget},data=sampleData(conf);assert.equal(data.progress,'—');assert.match(renderDonut(conf,data),/stroke-dasharray="0 100"/);}
 const empty=sampleData({...base,sampleScenario:'empty'});assert.equal(empty.progress,'—');assert.equal(empty.progressWidth,'0');
 assert.throws(()=>generateDAX({...base,targetMeasure:''}));
 const colored=updateElement(base,'trend',{colorMode:'custom',color:'#112233',backgroundMode:'custom',backgroundColor:'#aabbcc',backgroundOpacity:35});
 assert.ok(cardHTML(colored).includes('stroke="#aabbcc59"'));assert.ok(generateDAX(colored).includes('#aabbcc59'));assert.ok(cardHTML(colored).includes('stroke="#112233"'));
});
test('Legacy geometry is explicitly detected and new fields survive malformed imports safely',()=>{
 const old={...BASE};delete old.geometryVersion;assert.equal(sanitizeConfig(old).geometryVersion,1);assert.equal(sanitizeConfig(BASE).geometryVersion,2);
 const c=sanitizeConfig({...BASE,width:0,height:99,layout:'url(bad)',chartKind:'html',trendCurve:'script',areaFill:'bad',trendGrid:'bad',donutThickness:400,showMin:'true'});
 assert.equal(c.layout,'stacked');assert.equal(c.chartKind,'trend');assert.equal(c.trendCurve,'smooth');assert.equal(c.areaFill,'gradient');assert.equal(c.donutThickness,28);assert.equal(c.showMin,false);assert.deepEqual([c.width,c.height],[200,200]);
 assert.deepEqual(sanitizeConfig(JSON.parse(JSON.stringify(c))),c);assert.doesNotMatch(cardHTML(c),/bad|script|undefined|NaN/);
});
test('SPEC-001: REQ-001 declares __Target and __targettext without colliding __target',()=>{
 const dax=generateDAX(BASE);
 assert.match(dax,/VAR\s+__Target\s*=/);
 assert.match(dax,/VAR\s+__targettext\s*=/);
 assert.doesNotMatch(dax,/VAR\s+__target\s*=/);
 lexDax(dax);
});
test('SPEC-001: REQ-002 applies REMOVEFILTERS and TREATAS in __RawSeries with configured names',()=>{
 const daxDefault=generateDAX(BASE);
 assert.match(daxDefault,/REMOVEFILTERS\s*\(\s*'Calendario'\s*\)/);
 assert.match(daxDefault,/TREATAS\s*\(\s*__GroupDates,\s*'Calendario'\[Fecha\]\s*\)/);
 assert.doesNotMatch(daxDefault,/KEEPFILTERS\s*\(\s*__GroupDates\s*\)/);

 const custom=sanitizeConfig({
  ...BASE,
  measure:'Sales Amount',
  dateTable:'DimDate',
  dateColumn:'FullDateAlternateKey',
  comparison:'yoy'
 });
 const daxCustom=generateDAX(custom);
 assert.match(daxCustom,/REMOVEFILTERS\s*\(\s*'DimDate'\s*\)/);
 assert.match(daxCustom,/TREATAS\s*\(\s*__GroupDates,\s*'DimDate'\[FullDateAlternateKey\]\s*\)/);
 assert.doesNotMatch(daxCustom,/KEEPFILTERS\s*\(\s*__GroupDates\s*\)/);
 lexDax(daxCustom);
});
test('SPEC-001: REQ-003 serializes trend coordinates with 0.000 and en-US',()=>{
 const dax=generateDAX({...BASE,showMax:true,showMin:true});
 assert.doesNotMatch(dax,/0\.###/);
 assert.match(dax,/VAR __chartFirst = FORMAT \( MINX \( __Coordinates, \[__X\] \), "0\.000", "en-US" \)/);
 assert.match(dax,/VAR __chartLast = FORMAT \( MAXX \( __Coordinates, \[__X\] \), "0\.000", "en-US" \)/);
 const fmtCalls=[...dax.matchAll(/FORMAT\s*\([^,]+,\s*"0\.000",\s*"en-US"\s*\)/g)];
 assert.ok(fmtCalls.length>=14,'All dynamic SVG coordinates use 0.000 en-US');
 lexDax(dax);
});

test('Fase A: DAX exposes top configuration variables for quick Power BI customization',()=>{
 const dax=generateDAX(BASE);
 assert.match(dax,/VAR __Cfg_Locale = "es-ES"/);
 assert.match(dax,/VAR __Cfg_ColorText = "#ffffff"/);
 assert.match(dax,/VAR __Cfg_ColorMuted = "#a4b5b5"/);
 assert.match(dax,/VAR __Cfg_ColorAccent = "#c3ec83"/);
 assert.match(dax,/VAR __Cfg_ColorGood = "#96daa7"/);
 assert.match(dax,/VAR __Cfg_ColorWarn = "#e8c373"/);
 assert.match(dax,/VAR __Cfg_ColorBad = "#ff9a98"/);
 assert.match(dax,/VAR __Cfg_HigherIsBetter = TRUE \(\)/);
 assert.match(dax,/\/\/ - Medida de negocio principal: \[Total Ventas\]/);
 assert.match(dax,/\/\/ - Tabla calendario: 'Calendario'/);
 assert.match(dax,/\/\/ - Columna de fechas: 'Calendario'\[Fecha\]/);
 lexDax(dax);
});

test('Fase A: Calendar filter detection, rolling 12m fallback, and discontinuous date indicator',()=>{
 const dax=generateDAX(BASE);
 assert.match(dax,/VAR __HasCalendarFilter = ISFILTERED \( 'Calendario' \)/);
 assert.match(dax,/LASTNONBLANK \( 'Calendario'\[Fecha\], \[Total Ventas\] \)/);
 assert.match(dax,/EDATE \( __LastDataDate, -12 \) \+ 1/);
 assert.match(dax,/VAR __IsDiscontinuous = __HasDates && __DateCount <> __Span/);
 assert.match(dax,/IF \( __IsDiscontinuous, " \*", "" \)/);
 assert.match(dax,/TREATAS \( __Dates, 'Calendario'\[Fecha\] \)/);
 lexDax(dax);
});

test('Fase A: YoY leap year handling uses DISTINCT EDATE set and validates calendar existence',()=>{
 const dax=generateDAX({...BASE,comparison:'yoy'});
 assert.match(dax,/VAR __ShiftedDates = DISTINCT \( SELECTCOLUMNS \( __Dates, "__ShiftedDate", EDATE \( 'Calendario'\[Fecha\], -12 \) \) \)/);
 assert.match(dax,/VAR __AvailablePriorDates = SELECTCOLUMNS \( CALCULATETABLE \( VALUES \( 'Calendario'\[Fecha\] \), REMOVEFILTERS \( 'Calendario' \) \), "__ShiftedDate", 'Calendario'\[Fecha\] \)/);
 assert.match(dax,/VAR __PriorDateCount = COUNTROWS \( INTERSECT \( __ShiftedDates, __AvailablePriorDates \) \)/);
 assert.match(dax,/VAR __ComparableDates = __HasDates && __PriorDateCount = COUNTROWS \( __ShiftedDates \)/);
 lexDax(dax);
});

test('Fase B: Window limits to 24 buckets before measure evaluation with granularity breakpoints',()=>{
 const dax=generateDAX({...BASE,granularity:'auto'});
 assert.match(dax,/SWITCH \( TRUE \(\), __Span <= 24, 1, __Span <= 161, 2, 3 \)/);
 assert.match(dax,/VAR __WindowStart = IF \( __HasDates, SWITCH \( __Granularity, 1, __LastBucket - 23, 2, __LastBucket - 23 \* 7, EDATE \( __LastBucket, -23 \) \) \)/);
 assert.match(dax,/FILTER \( __Dates, __HasDates && 'Calendario'\[Fecha\] >= __WindowStart \)/);
 assert.match(dax,/VAR __TrendClipped = __HasDates && __Start < __WindowStart/);
 lexDax(dax);
});

test('Fase B: Gap separation with M command and gap-sensitive chart area fill',()=>{
 const dax=generateDAX(BASE);
 assert.match(dax,/NOT __Adjacent,\s*"M" & FORMAT/);
 assert.match(dax,/VAR __HasGaps = __N <> __BucketCount \|\| CONTAINSSTRING \( __chartPath, " M" \)/);
 assert.match(dax,/VAR __chartArea = IF \( __N > 1 && NOT \( __HasGaps \) && __Min >= 0,/);
 lexDax(dax);
});

test('Cross-domain: Incidents/Tickets KPI has descending semantics, no sales terms or EUR hardcoded',()=>{
 const incidentConfig=sanitizeConfig({
  ...BASE,
  type:'status',
  title:'Tickets abiertos',
  subtitle:'Helpdesk IT',
  measure:'Incidencias Abiertas',
  measureName:'KPI_Tickets_HTML',
  dateTable:'DimCalendario',
  dateColumn:'IdFecha',
  format:'number',
  unit:'none',
  currency:'USD',
  suffix:'tickets',
  direction:'down',
  comparison:'previous',
  goodThreshold:20,
  warnThreshold:50,
  showTrend:true,
  trendStyle:'bars'
 });
 const dax=generateDAX(incidentConfig);
 assert.match(dax,/VAR __Cfg_HigherIsBetter = FALSE \(\)/);
 assert.match(dax,/VAR __Cfg_GoodThreshold = 20/);
 assert.match(dax,/VAR __Cfg_WarnThreshold = 50/);
 assert.match(dax,/\[Incidencias Abiertas\]/);
 assert.match(dax,/'DimCalendario'\[IdFecha\]/);
 assert.match(dax,/tickets/);
 assert.doesNotMatch(dax,/Sales Amount|DimDate|FullDateAlternateKey|Total Ventas|€/);
 lexDax(dax);
});

test('Power BI measure names support symbols (#, %, (), €), bracketed DAX headers and numeric targets',()=>{
 // 1. Measure name validation
 assert.equal(isValidMeasureName('# Clientes'),true);
 assert.equal(isValidMeasureName('% Margen'),true);
 assert.equal(isValidMeasureName('Ventas (PY)'),true);
 assert.equal(isValidMeasureName('Margen €'),true);
 assert.equal(isValidMeasureName('Coste / Ud'),true);
 assert.equal(isValidMeasureName('KPI_Ventas'),true);
 assert.equal(isValidMeasureName('=broken'),false);
 assert.equal(isValidMeasureName('[corchetes]'),false);
 assert.equal(isValidMeasureName('con"comillas'),false);
 assert.equal(isValidMeasureName('con\'comillas'),false);
 assert.equal(isValidMeasureName(''),false);

 // 2. DAX header formatting
 const confPound=sanitizeConfig({...BASE,measureName:'# Clientes'});
 assert.match(generateDAX(confPound),/^\[# Clientes\]\s*=/);

 const confPercent=sanitizeConfig({...BASE,measureName:'% Margen'});
 assert.match(generateDAX(confPercent),/^\[% Margen\]\s*=/);

 const confSimple=sanitizeConfig({...BASE,measureName:'KPI_Ventas'});
 assert.match(generateDAX(confSimple),/^KPI_Ventas\s*=/);

 // 3. Target as numeric literal
 const confNumericTarget=sanitizeConfig({...BASE,targetMeasure:'0'});
 const daxZero=generateDAX(confNumericTarget);
 assert.match(daxZero,/VAR __Target = 0/);
 assert.doesNotMatch(daxZero,/VAR __Target = \[0\]/);

 const confTarget100=sanitizeConfig({...BASE,targetMeasure:'1000'});
 const dax1000=generateDAX(confTarget100);
 assert.match(dax1000,/VAR __Target = 1000/);
 assert.doesNotMatch(dax1000,/VAR __Target = \[1000\]/);

 lexDax(daxZero);
 lexDax(dax1000);
});

test('Encoding resilience: healCorruptedText and sanitizeConfig repair Unicode replacement characters and corrupted Spanish accents', () => {
 const corrupted = {
  subtitle: 'Visi\uFFFDn de negocio',
  footer: 'Rendimiento del per\uFFFDodo',
  statusBad: 'Requiere atenci\uFFFDn'
 };
 const healed = sanitizeConfig(corrupted);
 assert.equal(healed.subtitle, 'Visión de negocio');
 assert.equal(healed.footer, 'Rendimiento del período');
 assert.equal(healed.statusBad, 'Requiere atención');

 // Test question mark corruption from old ASCII / OEM conversions
 const questionMarkCorrupted = {
  subtitle: 'Visi?n de negocio',
  footer: 'Rendimiento del per?odo',
  statusBad: 'Requiere atenci?n'
 };
 const healedQM = sanitizeConfig(questionMarkCorrupted);
 assert.equal(healedQM.subtitle, 'Visión de negocio');
 assert.equal(healedQM.footer, 'Rendimiento del período');
 assert.equal(healedQM.statusBad, 'Requiere atención');

 // Test JSON string input parsing
 const jsonStr = JSON.stringify(corrupted);
 const healedJson = sanitizeConfig(jsonStr);
 assert.equal(healedJson.subtitle, 'Visión de negocio');
 assert.equal(healedJson.footer, 'Rendimiento del período');
});

test('Multi-visual and duplicate DAX generation: isolated trends, independent deltas, pure DAX, variable integrity', () => {
 // 1. Multi-chart card: trend (Sales) + trend_copy1 (Cost)
 const multiChartConf = sanitizeConfig({
  ...BASE,
  measure: 'Total Ventas',
  dateTable: 'Calendario',
  dateColumn: 'Fecha',
  elements: {
   trend_copy1: {
    measure: 'Coste Total',
    dateTable: 'Calendario',
    dateColumn: 'Fecha',
    chartKind: 'trend',
    trendStyle: 'area',
    deleted: false
   }
  }
 });
 const daxMultiChart = generateDAX(multiChartConf);
 assert.ok(daxMultiChart.includes('VAR __trend ='), 'Must declare original trend');
 assert.ok(daxMultiChart.includes('VAR __trend_trend_copy1 ='), 'Must declare duplicate trend variable');
 assert.ok(daxMultiChart.includes('// SERIE TEMPORAL: TREND_COPY1'), 'Must generate scoped time series for trend_copy1');
 assert.ok(daxMultiChart.includes('CALCULATE ( [Coste Total]'), 'trend_copy1 time series must evaluate configured measure [Coste Total]');
 assert.ok(daxMultiChart.includes('CALCULATE ( [Total Ventas]'), 'base trend time series must evaluate [Total Ventas]');

 const valMultiChart = validateDAX(daxMultiChart);
 assert.equal(valMultiChart.valid, true);
 assert.deepEqual(valMultiChart.undeclared, []);
 lexDax(daxMultiChart);

 // 2. Multi-KPI card with independent metrics and deltas:
 // KPI 1: [Total Ventas], YoY, direction 'up'
 // KPI 2: [Coste Total], MoM, direction 'down' (deltaMode: relative)
 const multiKPIConf = sanitizeConfig({
  ...BASE,
  measure: 'Total Ventas',
  comparison: 'yoy',
  direction: 'up',
  dateTable: 'Calendario',
  dateColumn: 'Fecha',
  elements: {
   value_copy1: {
    measure: 'Coste Total',
    format: 'currency',
    currency: 'EUR',
    deleted: false
   },
   delta_copy1: {
    measure: 'Coste Total',
    comparison: 'mom',
    deltaMode: 'relative',
    direction: 'down',
    deleted: false
   }
  }
 });
 const daxMultiKPI = generateDAX(multiKPIConf);

 // Verify no cross-metric comparison ([Total Ventas] - [Coste Total] must never occur)
 assert.ok(!daxMultiKPI.includes('[Total Ventas] - [Coste Total]'));
 assert.ok(!daxMultiKPI.includes('__Current - [Coste Total]'));
 assert.ok(!daxMultiKPI.includes('__Current - __Ref_delta_copy1'));

 // Verify delta_copy1 calculates Coste Total current vs previous month
 assert.ok(daxMultiKPI.includes('VAR __Cur_delta_copy1 ='), 'Must declare current value of duplicate metric');
 assert.ok(daxMultiKPI.includes('VAR __Ref_delta_copy1 ='), 'Must declare reference value of duplicate metric');
 assert.ok(daxMultiKPI.includes('VAR __Diff_delta_copy1 = IF ( NOT ISBLANK ( __Cur_delta_copy1 ) && NOT ISBLANK ( __Ref_delta_copy1 ), __Cur_delta_copy1 - __Ref_delta_copy1 )'));
 assert.ok(daxMultiKPI.includes('VAR __delta_delta_copy1 ='));
 assert.ok(daxMultiKPI.includes('VAR __arrow_delta_copy1 ='));
 assert.ok(daxMultiKPI.includes('VAR __deltaColor_delta_copy1 ='));
 // Direction 'down' means higher is worse: ( __Diff > 0 ) = FALSE ()
 assert.ok(daxMultiKPI.includes('( __Diff_delta_copy1 > 0 ) = FALSE ()'));

 const valMultiKPI = validateDAX(daxMultiKPI);
 assert.equal(valMultiKPI.valid, true);
 assert.deepEqual(valMultiKPI.undeclared, []);
 lexDax(daxMultiKPI);

 // 3. Shared calculations when elements are identical
 const sharedConf = sanitizeConfig({
  ...BASE,
  measure: 'Total Ventas',
  comparison: 'yoy',
  elements: {
   value_copy1: {
    deleted: false, measure: 'Total Ventas'
   },
   delta_copy1: {
    deleted: false, measure: 'Total Ventas'
   }
  }
 });
 const daxShared = generateDAX(sharedConf);
 assert.ok(daxShared.includes('VAR __val_value_copy1 = __value'), 'Must reuse __value calculation when identical');
 assert.ok(daxShared.includes('VAR __Diff_delta_copy1 = __Difference'), 'Must reuse __Difference calculation when identical');
 assert.ok(daxShared.includes('VAR __delta_delta_copy1 = __delta'), 'Must reuse __delta calculation when identical');
 assert.ok(daxShared.includes('VAR __arrow_delta_copy1 = __arrow'), 'Must reuse __arrow calculation when identical');
 assert.ok(daxShared.includes('VAR __deltaColor_delta_copy1 = __deltaColor'), 'Must reuse __deltaColor calculation when identical');
 const valShared = validateDAX(daxShared);
 assert.equal(valShared.valid, true);
 assert.deepEqual(valShared.undeclared, []);
 lexDax(daxShared);

 // 4. Pure DAX verification: no markdown backticks or escaped markers
 assert.equal(valMultiChart.hasMarkdownEscapes, false);
 assert.equal(valMultiChart.hasBackticks, false);
 assert.equal(valMultiKPI.hasMarkdownEscapes, false);
 assert.equal(valMultiKPI.hasBackticks, false);
 assert.equal(valShared.hasMarkdownEscapes, false);
 assert.equal(valShared.hasBackticks, false);
});
test('Variation delta and comparison label twin synchronization, propagation and validation', () => {
  // 1. Twin synchronization between delta_copy1 and compareLabel_copy1
  const initial = sanitizeConfig({
    ...BASE,
    comparison: 'yoy',
    elements: {
      delta_copy1: { comparison: 'yoy', measure: BASE.measure },
      compareLabel_copy1: { comparison: 'yoy' }
    }
  });

  // Updating delta_copy1 automatically syncs compareLabel_copy1
  const syncFromDelta = updateElement(initial, 'delta_copy1', { comparison: 'mom' });
  assert.equal(syncFromDelta.elements.delta_copy1.comparison, 'mom');
  assert.equal(syncFromDelta.elements.compareLabel_copy1.comparison, 'mom', 'compareLabel_copy1 must synchronize to mom');

  // Updating compareLabel_copy1 automatically syncs delta_copy1
  const syncFromLabel = updateElement(syncFromDelta, 'compareLabel_copy1', { comparison: 'previous' });
  assert.equal(syncFromLabel.elements.compareLabel_copy1.comparison, 'previous');
  assert.equal(syncFromLabel.elements.delta_copy1.comparison, 'previous', 'delta_copy1 must synchronize to previous');

  // Base element sync keeps root c.comparison in sync
  const syncBase = updateElement(initial, 'delta', { comparison: 'mom' });
  assert.equal(syncBase.comparison, 'mom', 'c.comparison must synchronize to mom');
  assert.equal(syncBase.elements.compareLabel.comparison, 'mom');

  // 2. Automatic label rendering vs custom text override
  const autoHtml = cardHTML(syncFromDelta);
  assert.ok(autoHtml.includes('vs. mes anterior'), 'Automatic label must reflect mom');

  const customOverride = updateElement(syncFromDelta, 'compareLabel_copy1', { text: 'vs. Presupuesto Q3' });
  const customHtml = cardHTML(customOverride);
  assert.ok(customHtml.includes('vs. Presupuesto Q3'), 'Custom text override must be respected in display');
  assert.equal(customOverride.elements.delta_copy1.comparison, 'mom', 'Delta math remains mom');

  // 3. DAX propagation for duplicate delta
  const daxMom = generateDAX(syncFromDelta);
  assert.ok(daxMom.includes('EDATE'), 'MoM comparison generates EDATE shift');
  const valMom = validateDAX(daxMom);
  assert.equal(valMom.valid, true);

  // 4. Validation in checks(c): detects missing compareMeasure on duplicate even when main card is yoy
  const customDup = sanitizeConfig({
    ...BASE,
    comparison: 'yoy',
    compareMeasure: '',
    elements: {
      delta_copy1: { comparison: 'custom' },
      compareLabel_copy1: { comparison: 'custom' }
    }
  });
  const errCustom = checks(customDup).filter(x => x.level === 'error');
  assert.ok(errCustom.some(x => x.field === 'delta_copy1'), 'Must flag missing reference measure for custom delta copy');

  // Providing compareMeasure resolves the error
  const fixedCustom = sanitizeConfig({
    ...customDup,
    elements: {
      ...customDup.elements,
      delta_copy1: { ...customDup.elements.delta_copy1, compareMeasure: 'Presupuesto' }
    }
  });
  const errFixed = checks(fixedCustom).filter(x => x.field === 'delta_copy1');
  assert.equal(errFixed.length, 0, 'Providing compareMeasure clears error');
});

test('Incomplete DAX exports require explicit opt-in and do not substitute a main measure for empty copies',()=>{
 const c=sanitizeConfig({...BASE,elements:{value_copy1:{},delta_copy1:{comparison:'custom'},trend_copy1:{}}});
 assert.throws(()=>generateDAX(c),/asigna su medida propia/);
 const dax=generateDAX(c,{allowIncomplete:true});
 assert.doesNotMatch(dax,/VAR __val_value_copy1 = __value|VAR __Diff_delta_copy1 = __Difference/);
 assert.match(dax,/VAR __trend_trend_copy1 = ""/);
 assert.match(dax,/VAR __Cur_value_copy1 = .*BLANK \(\)/);
 lexDax(dax);
});

test('Duplicate objectives and donut charts calculate with their explicit references, including blank exports',()=>{
 const c=sanitizeConfig({...BASE,elements:{goalLabel_copy1:{targetMeasure:'Plan propio'},progressLabel_copy1:{targetMeasure:'250'},progress_copy1:{targetMeasure:'Plan propio'},trend_copy1:{chartKind:'donut',measure:'Unidades'}}});
 const dax=generateDAX(c);
 assert.match(dax,/VAR __Target_goalLabel_copy1 = IF \( __HasDates, CALCULATE \( \[Plan propio\]/);
 assert.match(dax,/VAR __Target_progressLabel_copy1 = 250/);
 assert.match(dax,/VAR __Cur_trend_copy1 = IF \( __HasDates, CALCULATE \( \[Unidades\]/);
 assert.match(dax,/__progressWidth_progress_copy1/);
 assert.match(dax,/__progressWidth_trend_copy1/);
 lexDax(dax);
 c.elements.goalLabel_copy1.targetMeasure='';c.elements.trend_copy1.measure='';
 const incomplete=generateDAX(c,{allowIncomplete:true});
 assert.match(incomplete,/VAR __Target_goalLabel_copy1 = BLANK \(\)/);
 assert.match(incomplete,/VAR __Cur_trend_copy1 = BLANK \(\)/);
 c.measureName='Plan propio';
 assert.ok(checks(c).some(x=>x.field==='measureName'&&x.text.includes('circular')));
});


test('Each copied trend owns dates, extent and rolling data window for its own calendar',()=>{
 const c=sanitizeConfig({...BASE,elements:{trend_copy1:{measure:'Coste',dateTable:'Fechas costes',dateColumn:'Dia'},trend_copy2:{measure:'Pedidos',dateTable:'Fechas pedidos',dateColumn:'Fecha'}}});
 const dax=generateDAX(c);
 for(const [id,table,col,metric] of [['trend_copy1','Fechas costes','Dia','Coste'],['trend_copy2','Fechas pedidos','Fecha','Pedidos']]){
  assert.ok(dax.includes(`VAR __HasCalendarFilter_${id} = ISFILTERED ( '${table}' )`));
  assert.ok(dax.includes(`LASTNONBLANK ( '${table}'[${col}], [${metric}] )`));
  assert.ok(dax.includes(`VAR __Start_${id} = MINX ( __Dates_${id}, '${table}'[${col}] )`));
  assert.ok(dax.includes(`FILTER ( __Dates_${id}, __HasDates_${id} && '${table}'[${col}] >= __WindowStart_${id} )`));
  assert.ok(dax.includes(`SWITCH ( TRUE (), __Span_${id} <= 24`));
 }
 lexDax(dax);
});

test('Copied status exports dynamic measure-driven labels and opacities with BLANK support',()=>{
 const c=sanitizeConfig({...BASE,type:'status',elements:{status_copy1:{measure:'SLA propio',direction:'down',goodThreshold:.03,warnThreshold:.05,statusGood:'Correcto propio',statusWarn:'Alerta propia',statusBad:'Error propio'}}});
 const dax=generateDAX(c);
 assert.match(dax,/VAR __StatusValue_status_copy1 = IF \( __HasDates, CALCULATE \( \[SLA propio\]/);
 assert.match(dax,/ISBLANK \( __StatusValue_status_copy1 \), 0, __StatusValue_status_copy1 <= 0.03, 3/);
 assert.match(dax,/VAR __status_status_copy1 = SWITCH \( __StatusCode_status_copy1, 3, "Correcto propio"/);
 assert.match(dax,/VAR __statusGoodOpacity_status_copy1 = IF \( __StatusCode_status_copy1 = 3/);
 assert.ok(dax.slice(dax.indexOf('RETURN\n')).includes('__status_status_copy1'));
 const sample=sampleData({...c,sampleScenario:'empty'});
 assert.equal(sample.status_status_copy1,'Sin datos');
 assert.equal(sample.statusGoodOpacity_status_copy1,.2);
 lexDax(dax);
});

test('Calendar-bound goals and custom references use the same exact selected dates as current values',()=>{
 const dax=generateDAX({...BASE,comparison:'custom'});
 assert.match(dax,/VAR __Target = IF \( __HasDates, CALCULATE \( \[Objetivo Ventas\], REMOVEFILTERS \( 'Calendario' \), TREATAS \( __Dates, 'Calendario'\[Fecha\] \) \) \)/);
 assert.match(dax,/VAR __Reference = IF \( __HasDates, CALCULATE \( \[Ventas Periodo Anterior\]/);
 assert.match(generateDAX({...BASE,targetMeasure:'100'}),/VAR __Target = 100\n/);
 const previous=generateDAX({...BASE,comparison:'previous'});
 assert.match(previous,/__ComparableDates = __HasDates && NOT __IsDiscontinuous && COUNTROWS \( __PreviousDates \) = __Span/);
});

test('Only finite decimal DAX numeric literals are emitted as constants',()=>{
 for(const input of [Infinity,-Infinity,NaN,'Infinity','-Infinity','1e999','0x10','',null])assert.equal(isNumericLiteral(input),false,String(input));
 for(const input of [0,-12,'0','.5','+10','1e3','-1.2e-3'])assert.equal(isNumericLiteral(input),true,String(input));
 assert.equal(targetRef('Infinity'),'[Infinity]');
 assert.equal(targetRef('1e3'),'1000');
});

test('Exported gradient opacity is applied once, consistently with preview SVG',()=>{
 const dax=generateDAX({...BASE,areaFill:'gradient',fillOpacity:.2});
 const area=dax.split('\n').find(line=>line.startsWith('VAR __chartArea ='));
 assert.ok(area.includes('opacity=""1""'));
 const solid=generateDAX({...BASE,areaFill:'solid',fillOpacity:.2}).split('\n').find(line=>line.startsWith('VAR __chartArea ='));
 assert.ok(solid.includes('opacity=""0.2""'));
});


test('Duplicated status rejects invalid or directionless thresholds before DAX export',()=>{
 for(const state of [{direction:'neutral'},{direction:'down',goodThreshold:10,warnThreshold:5},{goodThreshold:Infinity}]){
  const c={...BASE,type:'status',elements:{status_copy1:state}};
  assert.ok(checks(c).some(x=>x.level==='error'&&x.elementId==='status_copy1'));
  assert.throws(()=>generateDAX(c),/umbrales/);
 }
});


test('DAX bodies remove bracketed display names and lexical checks reject malformed strings',()=>{
 const body=generateDAXBody({...BASE,measureName:'KPI Margen (%)'});
 assert.ok(body.startsWith('//'));assert.doesNotMatch(body,/^\[KPI/);
 assert.equal(validateDAX('VAR __x = "unterminated').valid,false);
 assert.equal(validateDAX(') (').valid,false);
});
