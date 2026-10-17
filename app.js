// 도우 인스타 승인함 (사장님·제문이형 폰용)
// 모든 승인/수정/취소는 서버 DB 함수가 검사함. 이 화면은 버튼만 보여줌.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { SB_URL, SB_ANON } from "./config.js";

const sb = createClient(SB_URL, SB_ANON, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $app = document.getElementById("app");
const TABS = [
  { key: "approval", label: "승인 대기", states: ["approval"] },
  { key: "scheduled", label: "예약됨", states: ["scheduled", "publishing"] },
  { key: "revision", label: "수정 중", states: ["revision", "failed", "unknown"] },
  { key: "published", label: "게시 완료", states: ["published"] },
];
const STATE_KO = { approval: "승인 대기", revision: "수정 중", scheduled: "예약됨", publishing: "올리는 중", published: "게시 완료", failed: "올리기 실패", unknown: "확인 필요", cancelled: "취소됨" };
let me = null, status = null, posts = [], audits = [], tab = "approval";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kst = (iso) => {
  if (!iso) return "바로(승인 후 2분 뒤)";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" });
};
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600e3);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (v) => (v ? new Date(v + ":00+09:00").toISOString() : null);
const errMsg = (e) => (e?.message || String(e)).replace(/^.*?ERROR:\s*/, "");

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  const { data: prof } = await sb.from("profiles").select("role,display_name,is_admin").eq("user_id", session.user.id).single();
  if (!prof) { await sb.auth.signOut(); return renderLogin("이 계정은 등록되지 않았어요."); }
  me = { ...prof, id: session.user.id };
  if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname);
  await load();
  sb.channel("posts").on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => load()).subscribe();
  setInterval(load, 60000);
}

async function load() {
  const [{ data: p }, { data: a }, st] = await Promise.all([
    sb.from("posts").select("*").neq("state", "cancelled").order("scheduled_at", { ascending: true, nullsFirst: true }).order("id"),
    sb.from("audit").select("post_id,actor_label,action,detail,at").order("at", { ascending: false }).limit(200),
    sb.functions.invoke("admin", { body: { action: "status" } }).then((r) => r.data).catch(() => null),
  ]);
  posts = p || []; audits = a || []; status = st;
  render();
}

function renderLogin(msg) {
  $app.innerHTML = `<div class="center">
    <h2>도우 인스타 승인함</h2>
    ${msg ? `<p class="banner bad">${esc(msg)}</p>` : ""}
    <p>이 폰은 아직 연결되지 않았어요.<br><b>제문이형에게 "폰 연결 링크"</b>를 받아서 눌러주세요.</p>
    <p class="small" style="margin-top:40px">관리자 이메일 로그인</p>
    <input type="text" id="em" inputmode="email" placeholder="이메일" autocomplete="email">
    <button class="btn ghost" id="send" style="margin-top:10px">로그인 링크 받기</button>
    <p class="small" id="sent"></p></div>`;
  document.getElementById("send").onclick = async () => {
    const email = document.getElementById("em").value.trim();
    if (!email) return;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
    document.getElementById("sent").textContent = error ? "보내기 실패: " + errMsg(error) : "메일함에서 로그인 링크를 눌러주세요.";
  };
}

function banners() {
  const out = [];
  const bad = posts.filter((p) => p.state === "unknown").length;
  const fail = posts.filter((p) => p.state === "failed").length;
  if (bad) out.push(`<div class="banner bad">게시 결과 확인이 필요한 글 ${bad}건 (제문이형 확인)</div>`);
  if (fail) out.push(`<div class="banner warn">올리기 실패한 글 ${fail}건 → "수정 중" 탭</div>`);
  const tf = audits.find((a) => a.action === "token_refresh_failed" || a.action === "token_refreshed");
  if (tf?.action === "token_refresh_failed") out.push(`<div class="banner bad">인스타 연결 연장 실패. 제문이형 확인 필요</div>`);
  if (status && !status.publish_enabled && me?.is_admin) out.push(`<div class="banner warn">자동 게시가 꺼져 있어요. 승인해도 인스타에 안 올라갑니다.</div>`);
  if (status?.token_expires_at && me?.is_admin) {
    const days = Math.round((new Date(status.token_expires_at) - Date.now()) / 864e5);
    if (days < 14) out.push(`<div class="banner bad">인스타 연결이 ${days}일 뒤 만료돼요.</div>`);
  }
  return out.join("");
}

function card(p) {
  const pics = (p.media || []).map((u) => `<img loading="lazy" src="${esc(u)}" alt="">`).join("");
  const log = audits.filter((a) => a.post_id === p.id).slice(0, 4).map((a) => `<div>${kst(a.at)} · ${esc(a.actor_label || "")} · ${esc(actKo(a.action))}${a.detail ? " · " + esc(a.detail) : ""}</div>`).join("");
  const owner = me.role === "owner";
  let btns = "";
  if (p.state === "approval" && owner) btns += `<button class="btn ok" data-act="approve" data-id="${p.id}">승인하고 예약하기</button><button class="btn warn" data-act="revise" data-id="${p.id}">수정 요청</button>`;
  if (p.state === "scheduled" && owner) btns += `<button class="btn warn" data-act="revise" data-id="${p.id}">예약 멈추고 수정 요청</button>`;
  if (["approval", "revision", "failed"].includes(p.state)) btns += `<button class="btn ghost" data-act="edit" data-id="${p.id}">글·사진·시간 고치기</button>`;
  if (["approval", "revision", "failed"].includes(p.state) && me.is_admin) btns += `<button class="btn bad" data-act="cancel" data-id="${p.id}">이 글 버리기</button>`;
  return `<div class="card">
    ${pics ? `<div class="pics">${pics}</div>` : ""}${(p.media || []).length > 1 ? `<div class="picn">옆으로 넘기면 사진 ${(p.media || []).length}장</div>` : ""}
    <div class="body">
      <span class="state s-${p.state}">${STATE_KO[p.state] || p.state}</span>
      ${p.title ? `<div class="title">${esc(p.title)}</div>` : ""}
      <div class="cap">${esc(p.caption)}</div>
      ${p.hashtags ? `<div class="tags">${esc(p.hashtags)}</div>` : ""}
      <div class="meta">올릴 시간: <b>${kst(p.scheduled_at)}</b> · ${p.version}번째 버전</div>
      ${p.revision_note ? `<div class="note">수정 요청: ${esc(p.revision_note)}</div>` : ""}
      ${p.error && p.state !== "published" ? `<div class="err">${esc(p.error)}</div>` : ""}
      ${p.ig_permalink ? `<a class="perm" href="${esc(p.ig_permalink)}" target="_blank" rel="noopener">인스타에서 보기</a>` : ""}
      <div class="btns">${btns}</div>
      ${log ? `<div class="log">${log}</div>` : ""}
    </div></div>`;
}
const actKo = (a) => ({ create: "초안 등록", edit: "수정", approve: "승인", request_revision: "수정 요청", cancel: "버림", claim: "올리기 시작", published: "게시 완료", failed: "실패", unknown: "확인 필요", blocked: "게시 막음", device_link: "폰 연결", set_publish: "자동게시 설정" }[a] || a);

function render() {
  const counts = Object.fromEntries(TABS.map((t) => [t.key, posts.filter((p) => t.states.includes(p.state)).length]));
  const cur = TABS.find((t) => t.key === tab);
  const list = posts.filter((p) => cur.states.includes(p.state));
  if (tab === "published") list.reverse();
  $app.innerHTML = `
  <header><h1>도우 인스타 승인함</h1><div class="who">${esc(me.display_name)}님 · ${me.role === "owner" ? "승인 권한" : "작성 권한"}</div></header>
  <nav>${TABS.map((t) => `<button data-tab="${t.key}" class="${t.key === tab ? "on" : ""}">${t.label}<span class="n">${counts[t.key]}</span></button>`).join("")}${me.is_admin ? `<button data-tab="admin" class="${tab === "admin" ? "on" : ""}">관리</button>` : ""}</nav>
  <main>${banners()}${tab === "admin" ? adminView() : list.length ? list.map(card).join("") : `<div class="empty">${cur.key === "approval" ? "승인할 글이 없어요." : "글이 없어요."}</div>`}</main>
  ${tab !== "admin" ? `<button class="fab" id="new">＋ 새 글</button>` : ""}`;
  $app.querySelectorAll("nav button").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); scrollTo(0, 0); }));
  $app.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => act(b.dataset.act, Number(b.dataset.id), b)));
  const nb = document.getElementById("new"); if (nb) nb.onclick = () => editor(null);
  if (tab === "admin") bindAdmin();
}

async function act(kind, id, btn) {
  const p = posts.find((x) => x.id === id);
  if (!p) return;
  try {
    if (kind === "approve") {
      if (!confirm(`이 글을 승인할까요?\n\n${kst(p.scheduled_at)}에 인스타에 올라갑니다.`)) return;
      btn.disabled = true;
      const { error } = await sb.rpc("approve_post", { p_id: id, p_version: p.version });
      if (error) throw error;
      alert("승인했어요. 정해진 시간에 자동으로 올라갑니다.");
    } else if (kind === "revise") {
      const note = prompt("어떻게 고칠까요? (예: 사진 바꿔줘, 글 짧게)");
      if (!note || !note.trim()) return;
      btn.disabled = true;
      const { error } = await sb.rpc("request_revision", { p_id: id, p_version: p.version, p_note: note.trim() });
      if (error) throw error;
      alert("수정 요청을 보냈어요.");
    } else if (kind === "cancel") {
      if (!confirm("이 글을 버릴까요? (되돌릴 수 없어요)")) return;
      const { error } = await sb.rpc("cancel_post", { p_id: id });
      if (error) throw error;
    } else if (kind === "edit") {
      return editor(p);
    }
  } catch (e) { alert("안 됐어요: " + errMsg(e)); }
  await load();
}

// 인스타 허용 비율(세로 4:5 ~ 가로 1.91:1) 밖이면 흰 여백을 넣어 맞춤. JPEG로 변환.
async function toJpeg(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, 1440 / Math.max(w, h)); w = Math.round(w * scale); h = Math.round(h * scale);
  let cw = w, ch = h;
  if (w / h < 0.8) cw = Math.ceil(h * 0.8);
  if (w / h > 1.91) ch = Math.ceil(w / 1.91);
  const c = document.createElement("canvas"); c.width = cw; c.height = ch;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch); g.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
  return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
}

function editor(p) {
  let media = [...(p?.media || [])];
  const el = document.createElement("div"); el.className = "sheet";
  el.innerHTML = `<div class="in"><h2>${p ? "글 고치기" : "새 글 만들기"}</h2>
    ${p?.revision_note ? `<div class="note">수정 요청: ${esc(p.revision_note)}</div>` : ""}
    <label>사진 (1~10장, 순서대로 올라가요)</label>
    <div class="thumbs" id="th"></div>
    <input type="file" id="f" accept="image/*" multiple style="margin-top:8px;font-size:17px">
    <label>제목(메모용, 인스타엔 안 올라감)</label><input type="text" id="t" value="${esc(p?.title || "")}">
    <label>본문</label><textarea id="c">${esc(p?.caption || "")}</textarea>
    <label>해시태그</label><textarea id="h" style="min-height:70px">${esc(p?.hashtags || "")}</textarea>
    <label>올릴 시간 (비워두면 승인 2분 뒤)</label><input type="datetime-local" id="s" value="${toLocalInput(p?.scheduled_at)}">
    <div class="btns"><button class="btn" id="save">${p ? "고쳐서 다시 승인 요청" : "승인 요청하기"}</button><button class="btn ghost" id="close">닫기</button></div>
    <p class="small" id="msg"></p></div>`;
  document.body.appendChild(el);
  const th = el.querySelector("#th");
  const drawThumbs = () => { th.innerHTML = media.map((u, i) => `<div style="position:relative"><img src="${esc(u)}"><button data-i="${i}" style="position:absolute;top:2px;right:2px;border:0;border-radius:50%;width:28px;height:28px;background:#000a;color:#fff;font-size:16px">×</button></div>`).join(""); th.querySelectorAll("button").forEach((b) => (b.onclick = () => { media.splice(Number(b.dataset.i), 1); drawThumbs(); })); };
  drawThumbs();
  el.querySelector("#close").onclick = () => el.remove();
  el.querySelector("#f").onchange = async (ev) => {
    const msg = el.querySelector("#msg");
    for (const file of ev.target.files) {
      if (media.length >= 10) break;
      msg.textContent = "사진 올리는 중…";
      try {
        const blob = await toJpeg(file);
        const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error } = await sb.storage.from("media").upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw error;
        media.push(sb.storage.from("media").getPublicUrl(path).data.publicUrl);
        drawThumbs();
      } catch (e) { msg.textContent = "사진 올리기 실패: " + errMsg(e); return; }
    }
    msg.textContent = "";
  };
  el.querySelector("#save").onclick = async (ev) => {
    ev.target.disabled = true;
    const { error } = await sb.rpc("save_post", {
      p_id: p?.id ?? null, p_version: p?.version ?? 0,
      p_title: el.querySelector("#t").value, p_caption: el.querySelector("#c").value, p_hashtags: el.querySelector("#h").value,
      p_media: media, p_scheduled_at: fromLocalInput(el.querySelector("#s").value),
    });
    if (error) { ev.target.disabled = false; el.querySelector("#msg").textContent = "저장 안 됨: " + errMsg(error); return; }
    el.remove(); tab = "approval"; await load();
  };
}

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
  </div></div>
  <div class="card"><div class="body"><div class="title">최근 기록</div><div class="log">${audits.slice(0, 15).map((a) => `<div>${kst(a.at)} · ${esc(a.actor_label || "")} · ${esc(actKo(a.action))}${a.detail ? " · " + esc(a.detail) : ""}</div>`).join("")}</div>
  <div class="btns"><button class="btn ghost" id="out">이 폰 로그아웃</button></div></div></div>`;
}
function bindAdmin() {
  document.getElementById("tog").onclick = async () => {
    const on = !status?.publish_enabled;
    if (!confirm(on ? "자동 게시를 켤까요? 승인된 글이 예약 시간에 실제로 인스타에 올라갑니다." : "자동 게시를 끌까요?")) return;
    const { data, error } = await sb.functions.invoke("admin", { body: { action: "set_publish", enabled: on } });
    if (error) return alert("실패: " + errMsg(error));
    status.publish_enabled = data.publish_enabled; render();
  };
  document.querySelectorAll("[data-link]").forEach((b) => (b.onclick = async () => {
    const { data, error } = await sb.functions.invoke("admin", { body: { action: "device_link", name: b.dataset.link } });
    const lk = document.getElementById("lk");
    if (error || !data?.link) { lk.innerHTML = `<p class="banner bad">실패: ${esc(errMsg(error || data?.error))}</p>`; return; }
    lk.innerHTML = `<p><b>${esc(data.name)}</b> 폰에서 이 링크를 열어주세요.</p><div class="linkbox">${esc(data.link)}</div><div class="btns"><button class="btn" id="share">카톡 등으로 보내기</button><button class="btn ghost" id="copy">링크 복사</button></div>`;
    document.getElementById("copy").onclick = async () => { await navigator.clipboard.writeText(data.link); alert("복사했어요."); };
    document.getElementById("share").onclick = async () => { if (navigator.share) await navigator.share({ title: "도우 인스타 승인함 연결", text: "이 링크를 눌러주세요 (1시간 안에)", url: data.link }).catch(() => {}); else { await navigator.clipboard.writeText(data.link); alert("복사했어요. 카톡에 붙여넣어 보내주세요."); } };
  }));
  document.getElementById("out").onclick = async () => { if (confirm("이 폰에서 로그아웃할까요?")) { await sb.auth.signOut(); location.reload(); } };
}

boot();
