// 도우 인스타 승인함 (사장님·제문이형 폰용)
// 모든 승인/수정/취소는 서버 DB 함수가 검사함. 이 화면은 버튼만 보여줌.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SB_URL, SB_ANON } from "./config.js?v=3";
import QRCode from "https://esm.sh/qrcode@1.5.4";

const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $app = document.getElementById("app");
const TABS = [
 { key: "approval", label: "승인 대기", states: ["approval"] },
 { key: "revision", label: "수정 중", states: ["revision", "failed", "unknown", "review"] },
 { key: "scheduled", label: "예약됨", states: ["scheduled", "publishing"] },
 { key: "published", label: "게시 완료", states: ["published"] }
];
const STATE_KO = {review:"1차 검토 중",approval:"승인 대기",revision:"수정 중",scheduled:"예약됨",publishing:"올리는 중",published:"게시 완료",failed:"올리기 실패",unknown:"확인 필요",cancelled:"취소됨"};
let me=null, status=null, posts=[], audits=[], tab="approval", busy=false, loading=false, pending=false, loadError="";
const drafts = new Map();
const slideIndex = new Map();
const publishNotices = new Map();
let publishPoll=null;
const PROCESSING_TEXT="인스타에서 영상을 처리 중이에요. 완료되면 자동으로 게시돼요.";
const PUBLISH_CAUTION="게시 결과를 확인해야 해요. 중복 게시를 막기 위해 다시 게시하지 말고 인스타와 최신 상태를 확인해 주세요.";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const kst = iso => iso ? new Date(iso).toLocaleString("ko-KR", {timeZone:"Asia/Seoul",month:"long",day:"numeric",weekday:"short",hour:"numeric",minute:"2-digit"}) : "승인 후 서버에서 결정";
const errMsg = e => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, "");
const owner = () => me?.role === "owner" && !me?.is_admin;
const rowOf = data => Array.isArray(data) ? data[0] : data;
function putRow(row) { if (!row?.id) return; const i=posts.findIndex(p=>p.id===row.id); if(i>=0) posts[i]=row; else posts.push(row); }
async function boot() {
 try {
  const {data:{session},error} = await sb.auth.getSession(); if(error) throw error;
  if(!session) return renderLogin();
  const {data:prof,error:pe}=await sb.from("profiles").select("role,display_name,is_admin").eq("user_id",session.user.id).single();
  if(pe || !prof) { await sb.auth.signOut(); return renderLogin("이 계정은 등록되지 않았어요."); }
  me={...prof,id:session.user.id};
  if(location.hash.includes("access_token")) history.replaceState(null,"",location.pathname);
  await load();
  sb.channel("posts").on("postgres_changes",{event:"*",schema:"public",table:"posts"},()=>load()).subscribe();
  setInterval(()=>load(),60000);
 } catch(e) { renderLogin("불러오지 못했어요: "+errMsg(e)); }
}
function isPlaying() { return [...$app.querySelectorAll('video[data-reel]')].some(v=>!v.paused&&!v.ended); }
function pendingText() {
 if(isPlaying()) return "영상 재생을 유지하고 있어요. 일시정지·재생 종료 후 새로고침하거나 다음 자동 갱신을 기다려 주세요.";
 if(drafts.size) return "작성 중인 내용은 유지돼요. 저장하거나 새로고침하면 최신 목록을 확인해요.";
 return "새 목록이 대기 중이에요. 새로고침하거나 다음 자동 갱신을 기다려 주세요.";
}
function updatePendingNotice() {
 const n=document.getElementById("refresh-note"), banner=document.getElementById("pending-refresh");
 if(n&&pending) n.textContent=pendingText();
 if(banner) {banner.hidden=!pending;banner.textContent=pending?"새로고침 대기 · "+pendingText():"";}
}
function markPending() { pending=true; updatePendingNotice(); }
function schedulePublishPoll() {
 clearTimeout(publishPoll); publishPoll=null;
 if(posts.some(p=>p.state==="publishing") || [...publishNotices.values()].some(n=>n.kind==="processing")) {
  publishPoll=setTimeout(async()=>{await load();schedulePublishPoll();},10000);
 }
}
function syncPublishNotices() {
 posts.forEach(p=>{
  if(p.state==="published") publishNotices.delete(p.id);
  else if(publishNotices.has(p.id)&&["failed","unknown"].includes(p.state)) publishNotices.set(p.id,{kind:"caution",text:PUBLISH_CAUTION});
 });
}
async function load() {
 if(busy || drafts.size || loading || isPlaying()) { markPending(); return; }
 loading=true;
 try {
  const [p,a,st]=await Promise.all([
   sb.from("posts").select("*").neq("state","cancelled").order("scheduled_at",{ascending:true,nullsFirst:true}).order("id"),
   sb.from("audit").select("post_id,actor_label,action,detail,at").order("at",{ascending:false}).limit(200),
   me.is_admin ? sb.functions.invoke("admin",{body:{action:"status"}}) : Promise.resolve({data:null})
  ]);
  if(p.error) throw p.error; if(a.error) throw a.error;
  if(busy || drafts.size || isPlaying()) { markPending(); return; }
  posts=p.data || []; audits=a.data || []; status=st.error || st.data?.error ? null : st.data;
  loadError=st.error || st.data?.error ? "관리 설정 상태를 불러오지 못했어요. 새로고침해 주세요." : "";
  syncPublishNotices(); pending=false; render();
 } catch(e) { loadError="목록을 불러오지 못했어요: "+errMsg(e); if(!drafts.size&&!busy&&!isPlaying()) render(); else markPending(); }
 finally { loading=false; schedulePublishPoll(); }
}
function renderLogin(msg) {
  const ADMIN = location.hash === "#admin";
  const email = ADMIN ? "hong5277@naver.com" : "sajangnim@doufabric.com";
  $app.innerHTML = `<div class="center">
    <h2>도우 인스타 승인함</h2>
    ${msg ? `<p class="banner bad">${esc(msg)}</p>` : ""}
    <p><b>비밀번호를 넣어주세요</b>${ADMIN ? " (관리자)" : ""}</p>
    <input type="password" id="pw" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" style="font-size:26px;text-align:center">
    <div class="btns"><button class="btn ok" id="go">들어가기</button></div>
    <p class="small">한 번 들어가면 이 폰에서는 계속 로그인돼 있어요.</p>
    <p style="margin-top:48px"><a class="small" href="${ADMIN ? "#" : "#admin"}" id="sw">${ADMIN ? "사장님 로그인으로" : "관리자"}</a></p>
  </div>`;
  document.getElementById("sw").onclick = () => setTimeout(() => renderLogin(), 0);
  const go = document.getElementById("go");
  const submit = async () => {
    const pw = document.getElementById("pw").value;
    if (!pw) return;
    go.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: pw });
    if (error) return renderLogin("비밀번호가 맞지 않아요. 다시 넣어주세요.");
    location.hash = ""; location.reload();
  };
  go.onclick = submit;
  document.getElementById("pw").onkeydown = (e) => { if (e.key === "Enter") submit(); };
  setTimeout(() => document.getElementById("pw").focus(), 50);
}


function banners() {
 const out=[];
 if(loadError) out.push('<div class="banner bad">'+esc(loadError)+'</div>');
 if(posts.some(p=>p.state==="unknown")) out.push('<div class="banner warn">게시 결과 확인이 필요한 글이 있어요. 확인 전 다시 게시하지 마세요.</div>');
 if(me.is_admin && status && !status.publish_enabled) out.push('<div class="banner warn">자동 게시가 꺼져 있어요. 예약·지금 게시 모두 실제 게시되지 않아요.</div>');
 if(me.is_admin && status?.token_expires_at && new Date(status.token_expires_at)-Date.now()<14*864e5) out.push('<div class="banner warn">인스타 연결 만료가 가까워요. 관리 설정을 확인해 주세요.</div>');
 return out.join("");
}
const contentType = p => p?.content_type==="REELS" ? "REELS" : "PHOTO";
const contentLabel = p => contentType(p)==="REELS" ? "릴스 동영상" : "사진";
function httpsMedia(value) { try {const u=new URL(value);return u.protocol==="https:"?u.href:"";} catch {return "";} }
function videoMetaText(meta) {
 if(!meta||typeof meta!=="object") return "영상 정보가 아직 없어요.";
 const parts=[], positive=v=>Number.isFinite(Number(v))&&Number(v)>0;
 if(positive(meta.duration)) parts.push("길이 "+Number(meta.duration).toLocaleString("ko-KR",{maximumFractionDigits:1})+"초");
 if(positive(meta.width)&&positive(meta.height)) parts.push("해상도 "+Number(meta.width)+" × "+Number(meta.height));
 return parts.join(" · ")||"영상 정보가 아직 없어요.";
}
function reelPreview(p) {
 const src=httpsMedia(p.video_url), cover=httpsMedia(p.cover_url);
 return '<div class="reel-preview">'+(src?'<video data-reel="'+p.id+'" controls playsinline preload="metadata"'+(cover?' poster="'+esc(cover)+'"':'')+' src="'+esc(src)+'" aria-label="릴스 동영상 미리보기"></video>':'')+'<p class="reel-error err" role="status"'+(src?' hidden':'')+'>영상을 미리 볼 수 없어요. AI에게 영상 재생 확인·재생성을 요청해 주세요. 직접 다시 게시하지 마세요.</p></div><div class="reel-details"><p class="small video-meta">'+esc(videoMetaText(p.video_meta))+'</p>'+(p.cover_url?'<figure class="reel-cover">'+(cover?'<img loading="lazy" src="'+esc(cover)+'" alt="릴스 대표 이미지" data-reel-cover>':'')+'<figcaption>릴스 대표 이미지</figcaption><p class="small cover-error"'+(cover?' hidden':'')+'>대표 이미지를 볼 수 없어요. AI에게 확인을 요청해 주세요.</p></figure>':'')+'</div>';
}
function publishNotice(p) {
 const notice=publishNotices.get(p.id);
 if(p.state==="published") return "";
 if(notice) return '<div class="note" role="status">'+esc(notice.text)+'</div>';
 if(contentType(p)==="REELS"&&p.publish_phase==="sending") return '<div class="note" role="status">'+PROCESSING_TEXT+'</div>';
 if(contentType(p)==="REELS"&&p.publish_phase==="preparing") return '<div class="note" role="status">영상 준비 중이에요.</div>';
 if(contentType(p)==="REELS"&&p.publish_phase==="ready") return '<p class="small">영상 준비 완료</p>';
 return "";
}
function publishLocked(p) { return publishNotices.has(p.id)||p.state==="publishing"||p.publish_phase==="sending"; }

function changes(p) {
 const o=p.prev_snapshot, note=p.boss_revision_note || o?.note || p.revision_note;
 if(!o) return note ? '<div class="note"><b>수정 요청</b><div>'+esc(note)+'</div></div>' : "";
 if(!["review","approval","revision"].includes(p.state)) return note ? '<div class="note">'+esc(note)+'</div>' : "";
 const rows=["title","caption","hashtags"].filter(k=>(o[k]||"")!==(p[k]||"")).map(k=>'<div class="diff"><b>'+({title:"제목",caption:"본문",hashtags:"해시태그"}[k])+'</b><div class="before"><small>이전</small><div>'+esc(o[k]||"(없음)")+'</div></div><div class="after"><small>현재</small><div>'+esc(p[k]||"(없음)")+'</div></div></div>');
 for(const k of ["content_type","video_url","cover_url"]) {
  const before=k==="content_type"?contentType(o):(o[k]||""), after=k==="content_type"?contentType(p):(p[k]||"");
  if(before===after) continue;
  const label={content_type:"콘텐츠 유형",video_url:"릴스 동영상",cover_url:"릴스 대표 이미지"}[k];
  const value=(row,current)=>k==="content_type"?contentLabel(row):(row[k]?(current?"새 파일 있음":"이전 파일 있음"):"없음");
  rows.push('<div class="diff"><b>'+label+'</b><div class="before"><small>이전</small><div>'+value(o,false)+'</div></div><div class="after"><small>현재</small><div>'+value(p,true)+'</div></div></div>');
 }
 if(JSON.stringify(o.media||[])!==JSON.stringify(p.media||[])) rows.push('<div>사진 변경: '+(o.media||[]).length+'장 → '+(p.media||[]).length+'장</div>');
 return '<div class="note"><b>'+(p.boss_revision_note?'사장님 수정 요청':'형 수정 요청')+'</b><div>'+esc(note||"기록 없음")+'</div><details'+(me.is_admin && p.state==="review"?' open':'')+'><summary>변경 전·후 비교 (v'+esc(o.version??"이전")+' → v'+esc(p.version)+')</summary>'+ (rows.join("")||'<p>현재까지 바뀐 내용이 없어요.</p>')+'</details></div>';
}
const actKo=a=>({create:"초안 등록",edit:"수정",review:"1차 검토",review_submit:"승인대기로 이동",review_edit:"텍스트 수정",admin_revision:"AI 수정 요청",approve:"승인",request_revision:"수정 요청",cancel_schedule:"예약 취소",claim:"올리기 시작",published:"게시 완료",failed:"실패",unknown:"확인 필요",blocked:"게시 막음",device_link:"폰 연결",set_publish:"자동게시 설정",revoke_sessions:"기기 로그아웃",token_refreshed:"인스타 연결 연장",token_refresh_failed:"연결 연장 실패"}[a]||a);
function card(p) {
 const editable=me.is_admin && p.state==="review" && tab==="admin";
 const d=drafts.get(p.id)||p, media=p.media||[], at=Math.min(slideIndex.get(p.id)||0,Math.max(0,media.length-1));
 const button=(action,text,cls="")=>'<button class="btn '+cls+'" data-act="'+action+'" data-id="'+p.id+'">'+text+'</button>';
 let btns="";
 if(editable) btns=button("admin-revise","AI에게 수정 요청","warn")+button("submit-review","승인대기로 이동","ok");
 if(owner()&&p.state==="approval"&&!publishLocked(p)) btns=button("revise","수정 요청","warn")+button("approve","승인","ok")+button("now","지금 게시","ghost");
 if(owner()&&p.state==="scheduled") btns=button("cancel-schedule","예약 취소","warn");
 const log=audits.filter(a=>a.post_id===p.id).slice(0,4).map(a=>'<div>'+kst(a.at)+' · '+esc(a.actor_label||"")+' · '+esc(actKo(a.action))+(a.detail?' · '+esc(typeof a.detail==="object"?JSON.stringify(a.detail):a.detail):'')+'</div>').join("");
 const fields=editable ? '<div class="inline-editor" data-editor="'+p.id+'"><label>제목<input data-field="title" value="'+esc(d.title)+'" maxlength="500"></label><label>본문<textarea data-field="caption">'+esc(d.caption)+'</textarea></label><label>해시태그<textarea class="tag-input" data-field="hashtags">'+esc(d.hashtags)+'</textarea></label><p class="small draft-note">'+(drafts.has(p.id)?'저장하지 않은 수정 내용이 있어요.':'제목·본문·해시태그만 수정할 수 있어요.')+'</p></div>' : (p.title?'<div class="title">'+esc(p.title)+'</div>':'')+'<div class="cap">'+esc(p.caption)+'</div>'+(p.hashtags?'<div class="tags">'+esc(p.hashtags)+'</div>':'');
 return '<article class="card" data-post="'+p.id+'"><div class="ig-head"><div class="avatar">DOU</div><div class="ig-name"><b>도우패브릭 공식</b><span>'+esc(p.title||"인스타 게시글")+'</span></div><span class="version">v'+esc(p.version)+'</span></div>'+ (contentType(p)==="REELS"?reelPreview(p):media.length?'<div class="media"><div class="pics" data-pics="'+p.id+'">'+media.map((u,i)=>'<img loading="lazy" src="'+esc(u)+'" alt="게시 사진 '+(i+1)+' / '+media.length+'">').join('')+'</div>'+(media.length>1?'<button class="arrow prev" data-slide="-1" aria-label="이전 사진">‹</button><button class="arrow next" data-slide="1" aria-label="다음 사진">›</button>':'')+'<span class="counter">'+(at+1)+'/'+media.length+'</span></div>':'')+'<div class="body"><span class="content-type">'+contentLabel(p)+'</span><span class="state s-'+p.state+'">'+esc(p.state==="review"&&!me.is_admin?"수정 중":STATE_KO[p.state]||p.state)+'</span>'+publishNotice(p)+fields+'<div class="meta">'+(p.state==="published"?'게시 시간: '+kst(p.published_at):'게시 예정: '+kst(p.scheduled_at))+'</div>'+changes(p)+(["revision","review"].includes(p.state)&&!me.is_admin?'<div class="note">수정 중이에요. 수정이 끝나면 다시 승인 대기에 올라와요.</div>':'')+(p.error&&p.state!=="published"?'<div class="err">'+esc(p.error)+'</div>':'')+(p.ig_permalink?'<a class="perm" href="'+esc(p.ig_permalink)+'" target="_blank" rel="noopener noreferrer">인스타에서 보기</a>':'')+'<div class="btns">'+btns+'</div>'+(log?'<div class="log">'+log+'</div>':'')+'</div></article>';
}
function inTab(p,t) { return t.states.includes(p.state) && (p.state!=="review" || p.boss_visible===true); }
function render() {
 if(!me) return;
 if(isPlaying()) {markPending();return;}
 if(tab==="admin"&&!me.is_admin) tab="approval";
 const cur=TABS.find(t=>t.key===tab);
 const list=cur ? posts.filter(p=>inTab(p,cur)) : [];
 if(tab==="published") list.reverse();
 const review=posts.filter(p=>["review","revision","failed","unknown"].includes(p.state));
 $app.innerHTML='<header><h1>DOU SNS 승인센터</h1><div class="who">도우패브릭 공식</div></header><nav>'+TABS.map(t=>'<button data-tab="'+t.key+'" class="'+(tab===t.key?'on':'')+'">'+t.label+'<span class="n">'+posts.filter(p=>inTab(p,t)).length+'</span></button>').join('')+(me.is_admin?'<button data-tab="admin" class="'+(tab==="admin"?'on':'')+'">관리 <span class="n">'+review.length+'</span></button>':'')+'</nav><main><div class="refreshbar"><span id="refresh-note">'+(drafts.size?'저장하지 않은 내용이 있어요.':pending?pendingText():'한국시간 기준 · 예약은 서버에서 결정')+'</span><button id="refresh" class="refresh">새로고침</button></div><div id="pending-refresh" class="banner warn" role="status"'+(pending?'':' hidden')+'>'+ (pending?'새로고침 대기 · '+esc(pendingText()):'')+'</div>'+banners()+(tab==="admin"?'<h2 class="section-title">1차 검토 관리</h2><p class="small">검토 중인 글만 수정할 수 있어요. 최종 승인·게시는 사장님이 진행해요.</p>'+(review.length?review.map(card).join(''):'<div class="empty">검토할 글이 없어요.</div>')+'<h2 class="section-title">관리 설정</h2>'+adminView():list.length?list.map(card).join(''):'<div class="empty">'+(tab==="approval"?'승인할 글이 없어요.':'글이 없어요.')+'</div>')+'</main>';
 $app.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{if(busy)return;$app.querySelectorAll("video[data-reel]").forEach(v=>v.pause());tab=b.dataset.tab;render();scrollTo(0,0);});
 document.getElementById("refresh").onclick=async()=>{if(busy)return;if(isPlaying()){markPending();return;}if(drafts.size&&!confirm("저장하지 않은 수정을 버리고 새로고침할까요?"))return;drafts.clear();await load();};
 $app.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>act(b.dataset.act,Number(b.dataset.id)));
 $app.querySelectorAll('[data-editor]').forEach(el=>el.querySelectorAll('[data-field]').forEach(input=>input.oninput=()=>{
  const id=Number(el.dataset.editor), p=posts.find(x=>x.id===id);
  const d=drafts.get(id)||{title:p.title||"",caption:p.caption||"",hashtags:p.hashtags||"",version:p.version};
  d[input.dataset.field]=input.value; drafts.set(id,d); el.querySelector('.draft-note').textContent="저장하지 않은 수정 내용이 있어요.";
  document.getElementById('refresh-note').textContent="작성 중인 내용은 자동 새로고침으로 지워지지 않아요.";
 }));
 $app.querySelectorAll('[data-pics]').forEach(el=>{
  const id=Number(el.dataset.pics), box=el.parentElement, n=el.children.length;
  el.scrollLeft=(slideIndex.get(id)||0)*el.clientWidth;
  const update=()=>{const i=Math.max(0,Math.min(n-1,Math.round(el.scrollLeft/(el.clientWidth||1))));slideIndex.set(id,i);box.querySelector('.counter').textContent=(i+1)+'/'+n;};
  el.onscroll=update;
  box.querySelectorAll('[data-slide]').forEach(b=>b.onclick=()=>{const i=Math.max(0,Math.min(n-1,(slideIndex.get(id)||0)+Number(b.dataset.slide)));el.scrollTo({left:i*el.clientWidth,behavior:'smooth'});});
 });
 $app.querySelectorAll('video[data-reel]').forEach(video=>{
  video.onpause=video.onended=()=>updatePendingNotice();
  video.onplay=()=>updatePendingNotice();
  video.onerror=()=>{video.parentElement.querySelector('.reel-error').hidden=false;};
  if(video.error) video.onerror();
 });
 $app.querySelectorAll('[data-reel-cover]').forEach(img=>{
  img.onerror=()=>{img.hidden=true;img.parentElement.querySelector('.cover-error').hidden=false;};
  if(img.complete&&!img.naturalWidth) img.onerror();
 });
 if(tab==="admin") bindAdmin();
}

async function rpcRow(name,args) {
 const {data,error}=await sb.rpc(name,args); if(error) throw error;
 let r=rowOf(data);
 if(!r?.id || r.version==null) { const checked=await sb.from("posts").select("*").eq("id",args.p_id).single(); if(checked.error) throw checked.error; r=checked.data; }
 if(!r?.id || r.version==null) throw new Error("서버 응답을 확인하지 못했어요. 새로고침해 상태를 확인하고, 중복 실행하지 마세요.");
 putRow(r); return r;
}
async function saveReview(p,submit) {
 const d=drafts.get(p.id)||p;
 const r=await rpcRow("review_post",{p_id:p.id,p_version:d.version,p_title:d.title||"",p_caption:d.caption||"",p_hashtags:d.hashtags||"",p_submit:submit});
 drafts.delete(p.id); return r;
}
async function act(kind,id) {
 if(busy) return;
 let p=posts.find(x=>x.id===id); if(!p)return;
 const adminAction=["save-review","submit-review","admin-revise"].includes(kind);
 if(adminAction?(!me.is_admin||p.state!=="review"):!owner()) return;
 if(["now","approve","revise"].includes(kind)&&publishLocked(p)) {alert(publishNotices.get(id)?.text||PROCESSING_TEXT);return;}
 let note="";
 if(["revise","admin-revise"].includes(kind)) {note=prompt("어떻게 고칠까요? 수정할 내용을 적어주세요.")?.trim();if(!note)return;}
 if(kind==="now"&&!confirm("지금 바로 인스타에 올릴까요?"))return;
 if(kind==="approve"&&!confirm("승인하고 예약할까요?\n한국시간 13시 전 승인: 오늘 13~20시 정각\n13시 이후 승인: 다음 날 13~20시 정각\n빈 예약 시간은 서버에서 결정해요."))return;
 if(kind==="cancel-schedule"&&!confirm("이 글의 예약을 취소할까요?"))return;
 busy=true; $app.querySelectorAll('button,input,textarea').forEach(b=>b.disabled=true);
 try {
  if(kind==="save-review" || kind==="submit-review") {const r=await saveReview(p,kind==="submit-review");if(r.state!==(kind==="submit-review"?"approval":"review"))throw new Error("예상한 상태가 아니에요. 현재 목록을 확인해 주세요.");alert(kind==="submit-review"?"승인 대기로 이동했어요.":"내용을 저장했어요.");}
  else if(kind==="admin-revise" || kind==="revise") {
   if(kind==="admin-revise"&&drafts.has(id)) p=await saveReview(p,false);
   const r=await rpcRow("request_revision",{p_id:id,p_version:p.version,p_note:note});
   if(r.state!=="revision")throw new Error("수정 요청 상태를 확인하지 못했어요.");alert("수정 요청을 보냈어요.");
  } else if(kind==="approve"&&p.state==="approval") {
   const r=await rpcRow("approve_post",{p_id:id,p_version:p.version});
   if(r.state!=="scheduled"||!r.scheduled_at)throw new Error("예약 결과를 확인하지 못했어요. 목록에서 상태를 확인해 주세요.");alert("예약했어요.\n"+kst(r.scheduled_at));
  } else if(kind==="cancel-schedule"&&p.state==="scheduled") {
   const r=await rpcRow("cancel_schedule",{p_id:id,p_version:p.version});
   if(r.state!=="approval")throw new Error("예약 취소 후 상태를 확인해 주세요.");alert("예약을 취소하고 승인 대기로 이동했어요.");
  } else if(kind==="now"&&p.state==="approval") {
   try {
    const {data,error}=await sb.functions.invoke("publish-due",{body:{action:"now",id,version:p.version}});
    if(!error&&data?.ok===true&&data.result==="processing") {
     publishNotices.set(id,{kind:"processing",text:PROCESSING_TEXT});
     alert(PROCESSING_TEXT);
    } else if(error||!data?.ok||data.error||["unknown","failed"].includes(data.result)) {
     publishNotices.set(id,{kind:"caution",text:PUBLISH_CAUTION});
     alert(PUBLISH_CAUTION);
    } else {
     // Treat any accepted but unconfirmed response conservatively until the row confirms publication.
     publishNotices.set(id,{kind:"caution",text:PUBLISH_CAUTION});
    }
    const {data:current,error:ce}=await sb.from("posts").select("*").eq("id",id).single();
    if(!ce&&current) {
     putRow(current);
     if(current.state==="published") {publishNotices.delete(id);alert("인스타에 게시됐어요.");}
     else if(!error&&data?.ok&&data.result!=="processing"&&!["unknown","failed"].includes(data.result)) alert(PUBLISH_CAUTION);
    } else if(publishNotices.get(id)?.kind!=="processing") alert(PUBLISH_CAUTION);
   } catch(e) {
    if(publishNotices.get(id)?.kind==="processing") alert(PROCESSING_TEXT);
    else {publishNotices.set(id,{kind:"caution",text:PUBLISH_CAUTION});alert(PUBLISH_CAUTION);}
   }
   schedulePublishPoll();
  }
 } catch(e) {alert("완료하지 못했어요: "+errMsg(e));}
 finally {busy=false;$app.querySelectorAll("button,input,textarea").forEach(b=>b.disabled=false);render();await load();}
}
window.addEventListener("beforeunload",e=>{if(drafts.size){e.preventDefault();e.returnValue="";}});
function adminView() {
  const exp = status?.token_expires_at ? new Date(status.token_expires_at).toLocaleDateString("ko-KR") : "모름";
  return `<div class="card"><div class="body">
    <div class="title">자동 게시</div>
    <p>지금: <b>${status?.publish_enabled ? "켜짐 (승인된 글이 시간 되면 올라감)" : "꺼짐 (아무것도 안 올라감)"}</b></p>
    <div class="btns"><button class="btn ${status?.publish_enabled ? "bad" : "ok"}" id="tog">${status?.publish_enabled ? "자동 게시 끄기" : "자동 게시 켜기"}</button></div>
    <p class="small">인스타 연결 만료일: ${exp} (매주 월요일 자동 연장)</p>
  </div></div>
  <div class="card"><div class="body">
    <div class="title">폰 연결 링크</div>
    <p>링크를 그 사람 폰에서 한 번 열면 계속 로그인돼요. 링크는 1시간 안에 한 번만 쓸 수 있어요.</p>
    <div class="btns"><button class="btn" data-link="사장님">사장님 폰 연결 링크 만들기</button><button class="btn ghost" data-link="제문이형">내 다른 폰 연결 링크</button></div>
    <div id="lk"></div>
    <div class="btns" style="margin-top:18px"><button class="btn bad" data-revoke="사장님">사장님 폰 전부 로그아웃 (분실·교체 때)</button></div>
  </div></div>
  <div class="card"><div class="body"><div class="title">최근 기록</div><div class="log">${audits.slice(0, 15).map((a) => `<div>${kst(a.at)} · ${esc(a.actor_label || "")} · ${esc(actKo(a.action))}${a.detail ? " · " + esc(a.detail) : ""}</div>`).join("")}</div>
  <div class="btns"><button class="btn ghost" id="out">이 폰 로그아웃</button></div></div></div>`;
}
function bindAdminUnsafe() {
  document.getElementById("tog").onclick = async () => {
    const on = !status?.publish_enabled;
    if (!confirm(on ? "자동 게시를 켤까요? 승인된 글이 예약 시간에 실제로 인스타에 올라갑니다." : "자동 게시를 끌까요?")) return;
    const { data, error } = await sb.functions.invoke("admin", { body: { action: "set_publish", enabled: on } });
    if (error || data?.error || typeof data?.publish_enabled !== "boolean") return alert("실패: " + errMsg(error || data?.error || "설정 결과를 확인하지 못했어요."));
    status = {...status, publish_enabled:data.publish_enabled}; render();
  };
  document.querySelectorAll("[data-link]").forEach((b) => (b.onclick = async () => {
    const { data, error } = await sb.functions.invoke("admin", { body: { action: "device_link", name: b.dataset.link } });
    const lk = document.getElementById("lk");
    if (error || !data?.link) { lk.innerHTML = `<p class="banner bad">실패: ${esc(errMsg(error || data?.error))}</p>`; return; }
    const qr = await QRCode.toDataURL(data.link, { width: 320, margin: 1 });
    lk.innerHTML = `<p><b>${esc(data.name)}</b> 폰 카메라로 이 QR을 찍어서 열어주세요. (1시간 안에 한 번만)</p><img src="${qr}" style="width:100%;max-width:320px;display:block;margin:10px auto" alt="QR"><p class="small">카톡·문자로 보내지 마세요. 미리보기가 링크를 먼저 써버릴 수 있어요.</p><div class="btns"><button class="btn ghost" id="copy">링크 복사(직접 열 때만)</button></div>`;
    document.getElementById("copy").onclick = async () => { await navigator.clipboard.writeText(data.link); alert("복사했어요."); };
  }));
  document.querySelectorAll("[data-revoke]").forEach((b) => (b.onclick = async () => {
    if (!confirm(b.dataset.revoke + " 계정의 모든 폰을 로그아웃할까요? 다시 쓰려면 QR 연결을 새로 해야 해요.")) return;
    const { data, error } = await sb.functions.invoke("admin", { body: { action: "revoke_sessions", name: b.dataset.revoke } });
    alert(error || data?.error || typeof data?.count !== "number" ? "실패: " + errMsg(error || data?.error || "결과 확인 필요") : `로그아웃 완료 (${data.count}개 기기, 최대 1시간 안에 완전히 끊김)`);
  }));
  document.getElementById("out").onclick = async () => { if (confirm("이 폰에서 로그아웃할까요?")) { await sb.auth.signOut(); location.reload(); } };
}


function bindAdmin() {
 bindAdminUnsafe();
 const toggle=document.getElementById("tog"); if(!status) {toggle.disabled=true;toggle.textContent="설정 상태 확인 필요 · 새로고침";}
 $app.querySelectorAll('#tog,[data-link],[data-revoke],#out').forEach(b=>{const run=b.onclick;b.onclick=async e=>{if(busy)return;b.disabled=true;try{await run(e);}catch(error){alert("실패: "+errMsg(error));}finally{b.disabled=false;}};});
}
boot();
