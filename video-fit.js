import {inspectMp4} from './media-probe.js?v=25';
export async function prepareVideo(file,{signal,onStatus=()=>{},onProgress=()=>{}}={}){
 if(file.size>209715200)throw Error('폰 메모리를 보호하기 위해 원본 200MB 이하·3~90초 영상만 자동 변환합니다.');
 if(signal?.aborted)throw new DOMException('변환 취소','AbortError');
 onStatus('영상 형식을 확인하고 있어요. 원본은 보존합니다.');
 let meta;try{meta=inspectMp4(new Uint8Array(await file.arrayBuffer()));}catch{}
 if(signal?.aborted)throw new DOMException('변환 취소','AbortError');
 if(meta&&file.size<=52428800&&meta.width===1080&&meta.height===1920&&Math.abs(meta.fps-30)<.05)return {file:new File([file],'reel.mp4',{type:'video/mp4'}),meta,converted:false};
 return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./video-fit-worker.js?v=28',import.meta.url));let ended=false;
  const finish=(error,result)=>{if(ended)return;ended=true;clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
  const cancel=()=>finish(new DOMException('변환 취소','AbortError'));
  const timer=setTimeout(()=>finish(Error('영상 준비 시간이 초과되었습니다. 서버에 저장하지 않았습니다.')),600000);
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
  worker.onerror=()=>finish(Error('이 브라우저에서 영상 변환 도구를 실행하지 못했습니다. 최신 Chrome 또는 Safari에서 다시 열어 주세요.'));
  worker.onmessage=({data})=>{
   if(data.type==='status')onStatus(data.text);else if(data.type==='progress')onProgress(data.value);
   else if(data.type==='error')finish(Error(data.message));
   else if(data.type==='done'){try{const checked=inspectMp4(data.bytes);if(checked.width!==1080||checked.height!==1920||Math.abs(checked.fps-30)>.05||Math.abs(checked.duration-data.sourceDuration)>.3)throw Error('변환 규격이나 전체 길이가 맞지 않아 저장하지 않았습니다.');finish(null,{file:new File([data.bytes],'reel-auto-fit.mp4',{type:'video/mp4'}),meta:checked,converted:true});}catch(e){finish(e);}}
  };
  worker.postMessage({file});
 });
}
