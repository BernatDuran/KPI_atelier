// Geometry in card pixels: independent of zoom and pointer-event implementation.
export function alignmentGuides(box,card,peers=[],padding=0,tolerance=3){
 const lines=[],seen=new Set();
 const add=(axis,position,kind,label,exact=false,peer=null)=>{const key=axis+':'+position;if(!seen.has(key)){seen.add(key);lines.push({axis,position,kind,label,exact,peer});}};
 for(const axis of ['x','y']){
  const size=axis==='x'?'width':'height',start=axis==='x'?'left':'top';
  const anchors=[box[start],box[start]+box[size]/2,box[start]+box[size]];
  const targets=[{p:0,kind:'edge',label:'Borde'},{p:card[size],kind:'edge',label:'Borde'},
   {p:padding,kind:'margin',label:'Margen'},{p:card[size]-padding,kind:'margin',label:'Margen'},
   {p:card[size]/2,kind:'center',label:'Centro'},
   ...peers.flatMap(peer=>[peer[start],peer[start]+peer[size]/2,peer[start]+peer[size]].map(p=>({p,kind:'peer',label:peer.label?`Alineación (${peer.label})`:'Alineación',peer})))];
  // Edges and margins win over equivalent peer lines.
  for(const target of targets){
   if(target.p>=0&&target.p<=card[size]){
    const matching=anchors.find(p=>Math.abs(p-target.p)<=tolerance);
    if(matching!==undefined){
     const diff=Math.abs(matching-target.p);
     const exact=diff<=0.5;
     const label=exact?(target.kind==='center'?'Centro exacto':`${target.label} exacto${diff<0.05?' (0 px)':''}`):target.label;
     add(axis,target.p,target.kind,label,exact,target.peer||null);
    }
   }
  }
 }
 const overflow={left:Math.max(0,-box.left),top:Math.max(0,-box.top),right:Math.max(0,box.left+box.width-card.width),bottom:Math.max(0,box.top+box.height-card.height)};
 for(const key of Object.keys(overflow))overflow[key]=overflow[key]<.5?0:Math.round(overflow[key]);

 const boxRight=box.left+box.width, boxBottom=box.top+box.height;
 const xAnchors=[box.left, box.left+box.width/2, boxRight];
 const yAnchors=[box.top, box.top+box.height/2, boxBottom];

 const edgeSnaps={
  left:xAnchors.some(p=>Math.abs(p)<=0.5),
  top:yAnchors.some(p=>Math.abs(p)<=0.5),
  right:xAnchors.some(p=>Math.abs(p-card.width)<=0.5),
  bottom:yAnchors.some(p=>Math.abs(p-card.height)<=0.5)
 };
 edgeSnaps.exact=Object.values(edgeSnaps).some(Boolean);

 const marginSnaps={
  left:xAnchors.some(p=>Math.abs(p-padding)<=0.5),
  top:yAnchors.some(p=>Math.abs(p-padding)<=0.5),
  right:xAnchors.some(p=>Math.abs(p-(card.width-padding))<=0.5),
  bottom:yAnchors.some(p=>Math.abs(p-(card.height-padding))<=0.5)
 };
 marginSnaps.exact=Object.values(marginSnaps).some(Boolean);

 const marginBreach={
  left:box.left<padding-0.5&&box.left>=-0.5?Math.round(padding-box.left):0,
  top:box.top<padding-0.5&&box.top>=-0.5?Math.round(padding-box.top):0,
  right:boxRight>card.width-padding+0.5&&boxRight<=card.width+0.5?Math.round(boxRight-(card.width-padding)):0,
  bottom:boxBottom>card.height-padding+0.5&&boxBottom<=card.height+0.5?Math.round(boxBottom-(card.height-padding)):0
 };
 marginBreach.active=Object.values(marginBreach).some(v=>typeof v==='number'&&v>0);

 const overlaps=[];
 for(const peer of peers){
  const pRight=peer.left+peer.width, pBottom=peer.top+peer.height;
  const interLeft=Math.max(box.left,peer.left);
  const interTop=Math.max(box.top,peer.top);
  const interRight=Math.min(boxRight,pRight);
  const interBottom=Math.min(boxBottom,pBottom);
  const interW=interRight-interLeft, interH=interBottom-interTop;
  if(interW>0.5&&interH>0.5){
   overlaps.push({
    peer,
    rect:{left:interLeft,top:interTop,width:interW,height:interH}
   });
  }
 }

 return {
  lines,
  overflow,
  outside:Object.values(overflow).some(Boolean),
  edgeSnaps,
  marginSnaps,
  marginBreach,
  overlaps
 };
}
