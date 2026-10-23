// Server-side structural media inspection. No network, transcoding, or client metadata trust.
export function inspectJpeg(bytes) {
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes); if(b.length<12||b[0]!==255||b[1]!==216)throw Error('JPEG 사진 파일이 필요합니다.');
 const u16=p=>b[p]*256+b[p+1];let p=2;
 while(p+4<=b.length){if(b[p++]!==255)throw Error('JPEG 파일 구조가 올바르지 않습니다.');while(p<b.length&&b[p]===255)p++;const marker=b[p++];if(marker===217||marker===218)break;if(marker===1||(marker>=208&&marker<=215))continue;const len=u16(p);if(len<2||p+len>b.length)throw Error('사진 파일이 손상되었습니다.');if([192,193,194].includes(marker)){if(len<8)break;const height=u16(p+3),width=u16(p+5),components=b[p+7];if(width<1||height<1||![1,3].includes(components))throw Error('지원하지 않는 JPEG 색상 형식입니다.');if(width/height<.8||width/height>1.91)throw Error('사진 비율은 4:5부터 가로 1.91:1 사이로 준비해 주세요.');return {width,height,size_bytes:b.length,format:'jpeg'};}p+=len;}
 throw Error('JPEG 사진 크기를 확인하지 못했습니다.');
}
export function inspectMp4(bytes){
 const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes),v=new DataView(b.buffer,b.byteOffset,b.byteLength);let boxesRead=0;
 const need=(p,n)=>{if(p<0||n<0||p+n>b.length)throw Error('영상 파일 구조가 올바르지 않습니다.');};
 const u16=p=>{need(p,2);return v.getUint16(p);},u32=p=>{need(p,4);return v.getUint32(p);},i32=p=>{need(p,4);return v.getInt32(p);};
 const text=(p,n)=>{need(p,n);return String.fromCharCode(...b.subarray(p,p+n));};
 const u64=p=>{const n=u32(p)*4294967296+u32(p+4);if(!Number.isSafeInteger(n))throw Error('지원하지 않는 대형 영상 구조입니다.');return n;};
 function boxes(start,end){const out=[];let p=start;while(p<end){if(++boxesRead>20000||end-p<8)throw Error('영상 박스 구조가 손상되었습니다.');let size=u32(p),head=8;const type=text(p+4,4);if(size===1){if(end-p<16)throw Error('영상 박스가 손상되었습니다.');size=u64(p+8);head=16;}if(size===0)size=end-p;if(size<head||size>end-p)throw Error('영상 파일 길이가 올바르지 않습니다.');out.push({type,start:p,body:p+head,end:p+size,size});p+=size;}return out;}
 const one=(list,type)=>{const a=list.filter(x=>x.type===type);if(a.length!==1)throw Error('필수 영상 정보 '+type+'를 확인하지 못했습니다.');return a[0];};
 const top=boxes(0,b.length);if(top.some(x=>x.type==='moof'))throw Error('분할 MP4는 지원하지 않습니다. 일반 MP4로 저장해 주세요.');const ftyp=one(top,'ftyp');if(ftyp.size<16)throw Error('MP4 파일 형식이 올바르지 않습니다.');const brand=text(ftyp.body,4);if(brand==='qt  ')throw Error('MOV 영상은 MP4 H264로 저장해 주세요.');if(!top.some(x=>x.type==='mdat'&&x.size>8))throw Error('영상 데이터가 없습니다.');const moov=one(top,'moov');const tracks=boxes(moov.body,moov.end).filter(x=>x.type==='trak');let video=null,audio='none';let audioCount=0;
 for(const trak of tracks){const tc=boxes(trak.body,trak.end),mdia=one(tc,'mdia'),mc=boxes(mdia.body,mdia.end),hdlr=one(mc,'hdlr');need(hdlr.body,12);const handler=text(hdlr.body+8,4);if(!['vide','soun'].includes(handler))continue;const mdhd=one(mc,'mdhd');need(mdhd.body,24);const ver=b[mdhd.body];if(![0,1].includes(ver))throw Error('지원하지 않는 영상 시간 정보입니다.');const scale=u32(mdhd.body+(ver===1?20:12));if(!scale)throw Error('영상 시간 정보가 없습니다.');const minf=one(mc,'minf'),stbl=one(boxes(minf.body,minf.end),'stbl'),sc=boxes(stbl.body,stbl.end),stsd=one(sc,'stsd');if(u32(stsd.body+4)!==1)throw Error('다중 인코딩 영상은 지원하지 않습니다.');const entry=one(boxes(stsd.body+8,stsd.end),handler==='vide'?'avc1':'mp4a');
  if(handler==='vide'){
   if(video)throw Error('영상 트랙은 1개만 지원합니다.');if(entry.size<86)throw Error('H264 영상 정보가 손상되었습니다.');let width=u16(entry.start+32),height=u16(entry.start+34);const avcc=one(boxes(entry.start+86,entry.end),'avcC');if(avcc.end-avcc.body<7||b[avcc.body]!==1)throw Error('H264 설정을 확인하지 못했습니다.');
   const tkhd=one(tc,'tkhd'),tv=b[tkhd.body],matrix=tkhd.body+(tv===1?52:40);if(![0,1].includes(tv))throw Error('지원하지 않는 회전 정보입니다.');const a=i32(matrix),bb=i32(matrix+4),c=i32(matrix+12),d=i32(matrix+16);if(a===0&&d===0&&Math.abs(bb)===65536&&Math.abs(c)===65536){[width,height]=[height,width];}else if(!(Math.abs(a)===65536&&Math.abs(d)===65536&&bb===0&&c===0))throw Error('영상 회전 방식이 지원되지 않습니다.');
   const stts=one(sc,'stts'),count=u32(stts.body+4);if(!count||count>100000||stts.body+8+count*8>stts.end)throw Error('프레임 시간 정보를 확인하지 못했습니다.');let samples=0,ticks=0;for(let j=0;j<count;j++){const n=u32(stts.body+8+j*8),delta=u32(stts.body+12+j*8);if(!n||!delta)throw Error('영상 프레임 정보가 올바르지 않습니다.');samples+=n;ticks+=n*delta;}const stsz=one(sc,'stsz');if(u32(stsz.body+8)!==samples||!ticks)throw Error('영상 프레임 개수가 맞지 않습니다.');const duration=ticks/scale,fps=samples/duration;
   if(!width||!height||width>1920||height>3840||Math.abs(width/height-9/16)>.025)throw Error('영상은 세로 9:16, 최대 1920×3840 크기로 준비해 주세요.');if(duration<3||duration>90)throw Error('영상은 3~90초로 준비해 주세요.');if(fps<23||fps>60.01)throw Error('영상은 23~60fps로 준비해 주세요.');video={duration,width,height,fps:Math.min(fps,60),size_bytes:b.length,video_codec:'h264',audio_codec:'none',inspection:'server_mp4_structure_v1'};
  }else{
   if(++audioCount>1)throw Error('음성 트랙은 최대 1개입니다.');if(entry.size<36||u16(entry.start+16)!==0)throw Error('지원하지 않는 음성 형식입니다.');const esds=one(boxes(entry.start+36,entry.end),'esds');let p=esds.body+4;
   function descriptor(){if(p>=esds.end)throw Error('AAC 음성 정보가 손상되었습니다.');const tag=b[p++];let len=0,ended=false;for(let i=0;i<4;i++){if(p>=esds.end)break;const x=b[p++];len=len*128+(x&127);if(!(x&128)){ended=true;break;}}if(!ended||p+len>esds.end)throw Error('음성 설명자 길이가 올바르지 않습니다.');return {tag,len,start:p};}
   const es=descriptor();if(es.tag!==3||es.len<3)throw Error('AAC 음성 형식을 확인하지 못했습니다.');p+=2;const flags=b[p++];if(flags&128)p+=2;if(flags&64){if(p>=esds.end)throw Error('음성 정보 오류');p+=1+b[p];}if(flags&32)p+=2;const decoder=descriptor();if(decoder.tag!==4||decoder.len<13||b[p]!==64)throw Error('음성은 AAC 또는 무음만 지원합니다.');audio='aac';
  }
 }
 if(!video)throw Error('H264 영상 트랙이 없습니다. HEVC 영상은 H264 MP4로 저장해 주세요.');video.audio_codec=audio;return video;
}
