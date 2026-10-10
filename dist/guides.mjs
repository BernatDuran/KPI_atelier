// Geometry in card pixels: independent of zoom and pointer-event implementation.
export function alignmentGuides(box,card,peers=[],padding=0,tolerance=3){
 const lines=[],seen=new Set();
 const add=(axis,position,kind,label)=>{const key=axis+':'+position;if(!seen.has(key)){seen.add(key);lines.push({axis,position,kind,label});}};
 for(const axis of ['x','y']){
  const size=axis==='x'?'width':'height',start=axis==='x'?'left':'top';
  const anchors=[box[start],box[start]+box[size]/2,box[start]+box[size]];
  const targets=[{p:0,kind:'edge',label:'Borde'},{p:card[size],kind:'edge',label:'Borde'},
   {p:padding,kind:'margin',label:'Margen'},{p:card[size]-padding,kind:'margin',label:'Margen'},
   {p:card[size]/2,kind:'center',label:'Centro'},
   ...peers.flatMap(peer=>[peer[start],peer[start]+peer[size]/2,peer[start]+peer[size]].map(p=>({p,kind:'peer',label:'Alineación'})))];
  // Edges and margins win over equivalent peer lines.
  for(const target of targets)if(target.p>=0&&target.p<=card[size]&&anchors.some(p=>Math.abs(p-target.p)<=tolerance))add(axis,target.p,target.kind,target.label);
 }
 const overflow={left:Math.max(0,-box.left),top:Math.max(0,-box.top),right:Math.max(0,box.left+box.width-card.width),bottom:Math.max(0,box.top+box.height-card.height)};
 for(const key of Object.keys(overflow))overflow[key]=overflow[key]<.5?0:Math.round(overflow[key]);
 return {lines,overflow,outside:Object.values(overflow).some(Boolean)};
}
