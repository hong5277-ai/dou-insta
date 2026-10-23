// DOU local conversion worker. Engine: ffmpeg.wasm core 0.12.10 (GPL-2.0-or-later), loaded from official documented CDN.
self.onmessage=async({data})=>{
 let core;
 try{
  const base='https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
  self.postMessage({type:'status',text:'영상 변환 도구를 준비하고 있어요. 최초 약 31MB 다운로드 · 영상은 전송하지 않습니다.'});
  importScripts(base+'/ffmpeg-core.js');
  core=await self.createFFmpegCore({mainScriptUrlOrBlob:base+'/ffmpeg-core.js#'+btoa(JSON.stringify({wasmURL:base+'/ffmpeg-core.wasm'}))});
  let logTail=[];core.setLogger(({message})=>{logTail.push(message);if(logTail.length>12)logTail.shift();});
  core.FS.mkdir('/input');core.FS.mount(core.FS.filesystems.WORKERFS,{files:[data.file]},'/input');
  const input='/input/'+data.file.name;
  core.setTimeout(30000);core.ffprobe('-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,pix_fmt,color_transfer,duration','-of','json','-o','/probe.json',input);
  let ret=core.ret;core.reset();if(ret>0)throw Error('영상 정보를 읽지 못했습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다.');
  const info=JSON.parse(core.FS.readFile('/probe.json',{encoding:'utf8'}));const video=info.streams?.find(s=>s.codec_type==='video');
  const duration=Number(info.format?.duration||video?.duration);if(!video||!Number.isFinite(duration)||duration<3||duration>90)throw Error('이 앱은 3~90초 영상을 지원합니다. 영상 길이를 확인해 주세요.');
  if(['smpte2084','arib-std-b67'].includes(video.color_transfer))throw Error('이 HDR 영상은 현재 자동 변환을 지원하지 않습니다. 색상을 바꾸지 않기 위해 중단했습니다. SDR 영상으로 선택해 주세요.');
  self.postMessage({type:'status',text:'1080×1920 · 30fps로 자동 맞춤 중입니다. 화면을 켜 두세요. 원본과 전체 길이를 보존합니다.'});
  core.setProgress(({time})=>self.postMessage({type:'progress',value:Math.min(99,Math.max(0,Math.round(Number(time)/1000000/duration*100)))}));
  core.setTimeout(540000);
  const filter="scale=w='trunc(min(1080,1920*dar)/2)*2':h='trunc(min(1920,1080/dar)/2)*2',setsar=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30";
  core.exec('-y','-i',input,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-vf',filter,'-c:v','libx264','-preset','ultrafast','-crf','23','-maxrate','3500k','-bufsize','7000k','-pix_fmt','yuv420p','-bf','0','-g','60','-c:a','aac','-b:a','128k','-ac','2','-ar','48000','-movflags','+faststart','-map_metadata','-1','/fitted.mp4');
  ret=core.ret;core.reset();if(ret!==0)throw Error('영상 자동 변환을 완료하지 못했습니다. 기기 메모리·처리 시간 또는 영상 형식을 확인해야 합니다.');
  const output=core.FS.readFile('/fitted.mp4');if(!output.length||output.length>52428800)throw Error('변환 결과가 앱의 50MB 한도를 넘습니다. 저장하지 않았습니다.');
  self.postMessage({type:'done',bytes:output,sourceDuration:duration},[output.buffer]);
 }catch(e){self.postMessage({type:'error',message:e.message||'영상 자동 변환에 실패했습니다.'});}
};
