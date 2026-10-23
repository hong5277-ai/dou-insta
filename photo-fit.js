// Local-only photo fitting. Original files are never modified or uploaded here.
export function fitCanvas(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('사진 크기를 확인하지 못했습니다.');
 const ratio=Math.max(.8,Math.min(1.91,width/height));
 return {width:1080,height:Math.max(566,Math.min(1350,Math.round(1080/ratio)))};
}
export function containPhoto(sw,sh,cw,ch){
 if(![sw,sh,cw,ch].every(n=>Number.isFinite(n)&&n>0))throw Error('사진 크기를 확인하지 못했습니다.');
 const scale=Math.min(1,cw/sw,ch/sh),width=sw*scale,height=sh*scale;
 return {x:(cw-width)/2,y:(ch-height)/2,width,height};
}
export async function fitPhotoFiles(files,isCurrent=()=>true){
 const prepared=[];let frame=null;
 for(const file of files){
  if(!isCurrent())throw Error('사진 선택이 변경되었습니다.');
  const url=URL.createObjectURL(file);let canvas;
  try{
   const image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('이 사진을 열지 못했습니다. JPG 또는 PNG 사진을 선택해 주세요.'));im.src=url;});
   if(!isCurrent())throw Error('사진 선택이 변경되었습니다.');
   const sw=image.naturalWidth,sh=image.naturalHeight;if(!frame)frame=fitCanvas(sw,sh);
   canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('사진 자동 맞춤을 사용할 수 없습니다.');
   ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
   const rect=containPhoto(sw,sh,canvas.width,canvas.height);ctx.drawImage(image,rect.x,rect.y,rect.width,rect.height);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));
   if(!blob||blob.type!=='image/jpeg'||blob.size>8388608)throw Error('8MB 이하 JPEG 사진으로 준비하지 못했습니다.');
   prepared.push({file:new File([blob],'photo-'+(prepared.length+1)+'.jpg',{type:'image/jpeg'}),source:{width:sw,height:sh,name:file.name,bytes:file.size},frame:{...frame},rect});
  }finally{URL.revokeObjectURL(url);if(canvas){canvas.width=1;canvas.height=1;}}
 }
 return prepared;
}
