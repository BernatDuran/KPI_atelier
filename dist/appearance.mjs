// Appearance is shared by the canvas, HTML and DAX exports.
const HEX=/^#[0-9a-f]{6}$/i;
export const COLOR_SPEC={
 eyebrow:{role:'muted'},icon:{role:'accent',background:true},title:{role:'muted'},value:{role:'text'},subtitle:{role:'muted'},
 delta:{role:'accent',semantic:'deltaColor',mode:'semantic',background:true,backgroundOpacity:10},compareLabel:{role:'muted'},
 trend:{role:'accent',background:true,backgroundOpacity:12},goalLabel:{role:'muted'},progressLabel:{role:'accent',semantic:'goalColor',mode:'linked'},
 progress:{role:'accent',semantic:'goalColor',background:true,backgroundOpacity:15},
 status:{role:'accent',semantic:'statusColor',mode:'semantic',background:true,backgroundOpacity:7},
 referenceLabel:{role:'muted'},referenceValue:{role:'text'},footer:{role:'muted'},period:{role:'muted'}
};
export function colorModes(id){
 const baseId=id?.replace(/_copy\d+$/,'');
 const spec=COLOR_SPEC[id]||COLOR_SPEC[baseId];
 return ['theme',...(spec?.semantic?['semantic']:[]),...(id==='progressLabel'||baseId==='progressLabel'?['linked']:[]),'custom'];
}
export function sanitizeAppearance(raw,id){
 const out={};
 if(colorModes(id).includes(raw.colorMode))out.colorMode=raw.colorMode;
 for(const key of ['color','backgroundColor','fillColor'])if(HEX.test(raw[key]))out[key]=raw[key].toLowerCase();
 if(['auto','custom','none'].includes(raw.backgroundMode))out.backgroundMode=raw.backgroundMode;
 if(['linked','custom'].includes(raw.fillMode))out.fillMode=raw.fillMode;
 for(const key of ['opacity','backgroundOpacity'])if(raw[key]!==undefined&&Number.isFinite(Number(raw[key])))out[key]=Math.max(0,Math.min(100,Math.round(Number(raw[key]))));
 return out;
}
export function appearance(c,id){
 const baseId=id?.replace(/_copy\d+$/,'');
 const spec=COLOR_SPEC[id]||COLOR_SPEC[baseId]||{role:'text'};
 return {
 colorMode:spec.mode||'theme',color:c[spec.role],opacity:100,
 backgroundMode:id==='icon'||baseId==='icon'?'none':'auto',backgroundColor:c[id==='progress'||baseId==='progress'?'muted':'accent'],backgroundOpacity:spec.backgroundOpacity??12,
 fillMode:'linked',fillColor:c.accent,...c.elements?.[id]
};}
export function elementColor(c,id,data={}){
 const baseId=id?.replace(/_copy\d+$/,'');
 const p=appearance(c,id),spec=COLOR_SPEC[id]||COLOR_SPEC[baseId];
 if(p.colorMode==='custom')return p.color;
 if(p.colorMode==='linked'&&(id==='progressLabel'||baseId==='progressLabel'))return elementColor(c,'progress',data);
 if(p.colorMode==='semantic'&&spec?.semantic){const dupKey=(id&&id.includes('_copy'))?`${spec.semantic}_${id}`:spec.semantic;return data[dupKey]||data[spec.semantic]||c.accent;}
 return c[spec?.role||'text'];
}
// Retains a dynamic @@color@@ token so DAX concatenates its alpha suffix.
export const alphaColor=(color,opacity)=>color+Math.round(Math.max(0,Math.min(100,opacity))*255/100).toString(16).padStart(2,'0');
export function elementBackground(c,id,data={}){
 const p=appearance(c,id);if(p.backgroundMode==='none')return 'transparent';
 const color=p.backgroundMode==='custom'?p.backgroundColor:id==='progress'?c.muted:elementColor(c,id,data);
 return alphaColor(color,p.backgroundOpacity);
}
export function trendFill(c,elementId='trend'){const p=appearance(c,elementId);return p.fillMode==='custom'?p.fillColor:elementColor(c,elementId);}
export const SURFACE_EFFECTS=[['solid','Clásico'],['glass','Cristal'],['aurora','Aurora'],['glow','Halo'],['raised','Relieve suave']];
export function surfaceStyles(c){
 const effect=c.surfaceEffect||'solid',intensity=c.effectIntensity??35;
 const accent=c.effectColorMode==='custom'?c.effectColor:c.accent;
 const shadow=c.shadow==='strong'?'0 18px 40px #00000022':c.shadow==='soft'?'0 6px 18px #00000009':'none';
 let css=`background:${c.background};box-shadow:${shadow};`;
 if(effect==='glass')css+=`background:${alphaColor(c.background,c.glassOpacity??70)};background-image:linear-gradient(135deg,${alphaColor('#ffffff',intensity*.5)},${alphaColor(accent,intensity*.22)});backdrop-filter:blur(${c.glassBlur??16}px) saturate(140%);-webkit-backdrop-filter:blur(${c.glassBlur??16}px) saturate(140%);box-shadow:inset 0 1px 0 ${alphaColor('#ffffff',intensity)},0 12px 32px #00000012;`;
 if(effect==='aurora')css+=`background-image:radial-gradient(ellipse at 100% 0%,${alphaColor(accent,intensity)},${alphaColor(accent,0)} 70%),linear-gradient(145deg,${alphaColor('#ffffff',intensity*.3)},${alphaColor(accent,0)});`;
 if(effect==='glow')css+=`box-shadow:0 0 ${Math.round(12+intensity*.4)}px ${alphaColor(accent,intensity*.5)},inset 0 0 0 1px ${alphaColor(accent,intensity*.7)};`;
 if(effect==='raised')css+=`box-shadow:8px 10px 24px ${alphaColor('#000000',intensity*.25)},-6px -6px 20px ${alphaColor('#ffffff',intensity*.7)},inset 0 1px 0 ${alphaColor('#ffffff',intensity*.8)};`;
 return css;
}
