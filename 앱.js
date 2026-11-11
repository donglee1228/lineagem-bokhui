// 복희섭 장비보유현황 - 엑셀풍 표 + Firebase(Firestore) 실시간 저장
// 읽기: 누구나 / 쓰기: 자기 줄만(이 기기에서 만든 줄, 익명 로그인 uid로 확인)
// 삭제·초기화·남의 줄 수정: 관리자(구글 로그인 dldmsdnr1228@gmail.com)만 — 서버 보안 규칙이 강제합니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

// ===== 장비 목록 (그룹 → 칸). need = 필요 수량(본캐+부캐 2클라 기준) =====
// ※ need 를 바꾸거나 칸을 추가하면 파이어베이스설정\firestore.rules 의 cellsOk() 도 같이 고쳐서 배포해야 합니다.
const GROUPS = [
  { name: "클래스 공용", cols: [
    { id: "ring", name: "변반", need: 4 },
    { id: "book", name: "4대 법서", need: 2 },
    { id: "silpt", name: "실프티", need: 2 },
    { id: "ejabelt", name: "에자벨트", need: 2 },
    { id: "titanbelt", name: "타이탄벨트", need: 2 },
    { id: "sword3", name: "3차검", need: 2 },
    { id: "saengma", name: "생마", need: 2 },
    { id: "hyeongma", name: "형마", need: 2 }
  ] }
];
const COLS = GROUPS.flatMap((g) => g.cols);
const CLASSES = ["군주", "기사", "요정", "마법사", "다크엘프", "투사", "광전사", "총사", "신성검사", "암흑기사", "마검사", "사신", "뇌신"];
const ADMIN_EMAIL = "dldmsdnr1228@gmail.com";

const app = initializeApp({
  apiKey: "AIzaSyCOlahYKuxdep4BKtcolSZVYqw9TR4X5QQ",
  authDomain: "bokhui-gear-k7m2.firebaseapp.com",
  projectId: "bokhui-gear-k7m2",
  storageBucket: "bokhui-gear-k7m2.firebasestorage.app",
  messagingSenderId: "840387768009",
  appId: "1:840387768009:web:9deb52899139a78e47e718"
});
const auth = getAuth(app);
const db = getFirestore(app);
const ME_KEY = "복희섭_내아이디";

// ---------- 상태 ----------
const S = { members: [], posts: [], me: "", uid: "", admin: false, loaded: false };
try { S.me = localStorage.getItem(ME_KEY) || ""; } catch (e) { /* 저장소 막힘 */ }

// ---------- 도우미 ----------
const $ = (id) => document.getElementById(id);
const str = (v) => (v === undefined || v === null) ? "" : String(v).trim();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const tsMs = (t) => (t && typeof t.toMillis === "function") ? t.toMillis() : 0;
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const hhmm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16);
const cleanName = (v) => str(v).replace(/\//g, "／").replace(/\s+/g, " ").slice(0, 30);
const badName = (n) => !n || n === "." || n === ".." || /^__.*__$/.test(n);
const qtyOf = (m, c) => { const v = Number(m.cells[c.id]); return Number.isInteger(v) && v >= 0 ? Math.min(v, c.need) : 0; };
function errText(e) {
  const c = e && e.code ? String(e.code) : "";
  if (c.includes("permission-denied")) return "권한이 없습니다(내 줄이 아니거나 허용되지 않는 값).";
  if (c.includes("unavailable") || c.includes("network")) return "인터넷 연결을 확인해 주세요.";
  if (c.includes("popup")) return "로그인 창이 닫혔거나 막혔습니다.";
  return "실패했습니다 (" + (c || (e && e.message) || "오류") + ")";
}
async function ensureAuth() { if (!auth.currentUser) await signInAnonymously(auth); S.uid = auth.currentUser.uid; }
function saveState(text, cls) { const el = $("saveState"); el.textContent = text; el.className = "save" + (cls ? " " + cls : ""); }
const canEdit = (m) => !!m && (S.admin || (S.uid && m.uid === S.uid));

// ---------- 표 그리기 ----------
const sheetBody = $("sheetBody");
const pending = new Map(); // rowId -> {field: value}
const pv = (m, f, base) => { const p = pending.get(m.id); return p && f in p ? p[f] : base; };

function render() {
  // 입력 중이면 커서를 기억했다가 다시 그린 뒤 복원
  let keep = null;
  const a = document.activeElement;
  if (a && a.closest && a.closest("#sheetBody") && (a.tagName === "INPUT" || a.tagName === "SELECT")) {
    const tr = a.closest("tr[data-row]");
    if (tr) keep = { row: tr.dataset.row, f: a.dataset.f, v: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  renderMe(); renderAdmin();
  if (!S.loaded) return;
  const q = $("q").value.trim().toLowerCase();
  const mine = S.members.find((m) => m.name === S.me);
  let rows = S.members.filter((m) => m !== mine && (!q || (m.name + " " + m.sub + " " + m.cls).toLowerCase().includes(q)));
  if (mine) rows = [mine].concat(rows);

  let h = '<table class="xl"><thead><tr class="grp"><th class="rn"></th><th class="nm"></th><th></th>';
  GROUPS.forEach((g) => { h += '<th class="g" colspan="' + g.cols.length + '">' + esc(g.name) + '</th>'; });
  h += '<th></th></tr><tr class="hd"><th class="rn">#</th><th class="nm">아이디<small>본캐 / 부캐</small></th><th>클래스</th>';
  COLS.forEach((c) => { h += '<th class="colh">' + esc(c.name) + '<small>×' + c.need + '</small></th>'; });
  h += '<th>충족</th></tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td class="rn"></td><td colspan="' + (COLS.length + 3) + '"><div class="empty"><b>' +
         (S.members.length ? "검색 결과가 없습니다" : "아직 아무도 없습니다") + '</b>' +
         (S.members.length ? "검색어를 바꿔 보세요." : "위에 내 아이디를 입력하고 '내 줄 열기'를 누르세요.") + '</div></td></tr>';
  }
  rows.forEach((m, i) => {
    const isMine = m === mine, ed = canEdit(m);
    const sub = pv(m, "sub", m.sub), cls = pv(m, "cls", m.cls);
    h += '<tr class="' + (isMine ? "mine" : "") + '" data-row="' + esc(m.id) + '"><td class="rn">' + (isMine ? "나" : i + 1) + '</td>';
    h += '<td class="nm" title="' + esc(m.name + (sub ? " / " + sub : "")) + '">' + esc(m.name) +
         (S.admin ? '<button class="del" type="button" data-delrow="' + esc(m.id) + '" title="줄 삭제" aria-label="줄 삭제">✕</button>' : '');
    if (ed) h += '<small><input data-f="sub" maxlength="30" value="' + esc(sub) + '" placeholder="부캐 아이디" aria-label="부캐 아이디" style="all:unset;width:100%;color:var(--gold2);font-size:12px;border-bottom:1px dashed #555a66"></small>';
    else h += '<small>' + (sub ? esc(sub) : "&nbsp;") + '</small>';
    h += '</td>';
    if (ed) {
      h += '<td class="edit"><select data-f="cls" aria-label="클래스"><option value="">클래스</option>' +
           CLASSES.map((c) => '<option' + (c === cls ? " selected" : "") + '>' + c + '</option>').join("") +
           (cls && !CLASSES.includes(cls) ? '<option selected>' + esc(cls) + '</option>' : '') + '</select></td>';
    } else {
      h += '<td class="cls">' + (cls ? esc(cls) : '<span class="e">·</span>') + '</td>';
    }
    let full = 0;
    COLS.forEach((c) => {
      const n = Math.min(Number(pv(m, c.id, qtyOf(m, c))) || 0, c.need);
      const st = n >= c.need ? "full" : n > 0 ? "part" : "zero";
      if (st === "full") full++;
      h += '<td class="q ' + st + (ed ? " tap" : "") + '" data-c="' + c.id + '"' + (ed ? ' data-q="' + c.id + '" role="button" tabindex="0" aria-label="' + esc(c.name) + ' ' + n + '/' + c.need + '"' : '') +
           '><span class="n">' + n + '/' + c.need + '</span></td>';
    });
    h += '<td class="sum' + (full === COLS.length ? " all" : "") + '">' + full + '/' + COLS.length + '</td></tr>';
  });
  h += '</tbody></table>';
  const sc = $("scroll"), top = sc.scrollTop, left = sc.scrollLeft;
  sheetBody.innerHTML = h;
  sc.scrollTop = top; sc.scrollLeft = left;
  if (keep) {
    const tr = [...sheetBody.querySelectorAll("tr[data-row]")].find((t) => t.dataset.row === keep.row);
    const el = tr && [...tr.querySelectorAll("[data-f]")].find((i) => i.dataset.f === keep.f);
    if (el) { el.value = keep.v; el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* select */ } }
  }
  $("footCount").textContent = S.admin ? "관리자: 모든 줄 수정 가능" : "내 줄(금색)만 고칠 수 있어요";
}

function renderMe() {
  const has = !!S.me;
  $("meForm").hidden = has; $("meWho").hidden = !has;
  $("meName").textContent = S.me;
  const m = S.members.find((x) => x.name === S.me);
  const w = $("meWarn");
  if (has && S.loaded && m && !canEdit(m)) {
    w.textContent = "이 아이디는 다른 기기(브라우저)에서 등록되어 여기서는 고칠 수 없습니다. 처음 등록한 기기에서 고치거나, 관리자에게 줄 삭제를 요청한 뒤 다시 등록하세요.";
    w.hidden = false;
  } else w.hidden = true;
}
function renderAdmin() { $("adminBar").hidden = !S.admin; $("btnAddPost").hidden = !S.admin; $("adminLink").textContent = S.admin ? "관리자 로그인됨" : "관리"; }

function renderPosts() {
  const body = $("noticeBody");
  if (!S.posts.length) { body.innerHTML = '<div class="panel"><div class="empty">아직 공지가 없습니다.</div></div>'; return; }
  body.innerHTML = '<div class="posts">' + S.posts.map((p) => {
    const mineP = S.admin; // 공지는 관리자만 쓰기·수정·삭제
    return '<article class="post">' + (p.date ? '<time>' + esc(p.date) + '</time>' : '') + '<h3>' + esc(p.title) + '</h3><div class="body">' + esc(p.body) + '</div>' +
      (mineP ? '<div class="pact"><button class="btn sm" type="button" data-editpost="' + esc(p.id) + '">수정</button>' +
               '<button class="btn sm red" type="button" data-delpost="' + esc(p.id) + '">삭제</button></div>' : '') + '</article>';
  }).join("") + '</div>';
}

// ---------- 실시간 구독 ----------
onSnapshot(collection(db, "clanMembers"), (qs) => {
  S.members = qs.docs.map((d) => {
    const v = d.data();
    return { id: d.id, name: str(v.name) || d.id, sub: str(v.sub), cls: str(v.cls), uid: str(v.uid),
             cells: (v.cells && typeof v.cells === "object") ? v.cells : {} };
  }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  S.loaded = true; render();
}, (e) => { sheetBody.innerHTML = '<div class="empty"><b>불러오지 못했습니다</b>' + esc(errText(e)) + '</div>'; });
onSnapshot(collection(db, "posts"), (qs) => {
  S.posts = qs.docs.map((d) => { const v = d.data(); return { id: d.id, uid: str(v.uid), date: str(v.date), title: str(v.title), body: v.body == null ? "" : String(v.body), t: tsMs(v.updatedAt) }; })
    .filter((p) => p.title).sort((a, b) => b.date.localeCompare(a.date) || b.t - a.t);
  renderPosts();
}, () => {});

onAuthStateChanged(auth, (u) => {
  S.uid = u ? u.uid : "";
  S.admin = !!(u && !u.isAnonymous && u.email === ADMIN_EMAIL && u.emailVerified);
  render(); renderPosts();
});

// ---------- 셀 편집 → 자동 저장 ----------
let timer = null;
function queue(rowId, f, v, delay) {
  if (!pending.has(rowId)) pending.set(rowId, {});
  pending.get(rowId)[f] = v;
  saveState("저장 중…");
  clearTimeout(timer); timer = setTimeout(flush, delay == null ? 700 : delay);
}
async function flush() {
  clearTimeout(timer);
  if (!pending.size) return;
  const jobs = [...pending.entries()]; pending.clear();
  try {
    await ensureAuth();
    for (const [rowId, fields] of jobs) {
      const up = { updatedAt: serverTimestamp() };
      Object.entries(fields).forEach(([f, v]) => { up[(f === "cls" || f === "sub") ? f : "cells." + f] = v; });
      await updateDoc(doc(db, "clanMembers", rowId), up);
    }
    if (!pending.size) saveState("저장됨 ✓ " + hhmm(), "ok");
  } catch (e) { saveState(errText(e), "err"); render(); }
}
sheetBody.addEventListener("input", (e) => {
  const el = e.target.closest("input[data-f]"); if (!el) return;
  queue(el.closest("tr[data-row]").dataset.row, el.dataset.f, cleanName(el.value));
});
sheetBody.addEventListener("change", (e) => {
  const el = e.target.closest("select[data-f]"); if (!el) return;
  queue(el.closest("tr[data-row]").dataset.row, el.dataset.f, el.value.slice(0, 20), 0);
});
function bump(td) {
  const tr = td.closest("tr[data-row]"), m = S.members.find((x) => x.id === tr.dataset.row);
  const c = COLS.find((x) => x.id === td.dataset.q); if (!m || !c || !canEdit(m)) return;
  const cur = Math.min(Number(pv(m, c.id, qtyOf(m, c))) || 0, c.need);
  const nx = cur >= c.need ? 0 : cur + 1;
  queue(m.id, c.id, nx, 450);
  td.className = "q tap " + (nx >= c.need ? "full" : nx > 0 ? "part" : "zero");
  td.querySelector(".n").textContent = nx + "/" + c.need;
  td.setAttribute("aria-label", c.name + " " + nx + "/" + c.need);
  const sum = tr.querySelector("td.sum");
  const full = COLS.filter((x) => Math.min(Number(pv(m, x.id, qtyOf(m, x))) || 0, x.need) >= x.need).length;
  sum.textContent = full + "/" + COLS.length; sum.classList.toggle("all", full === COLS.length);
}
sheetBody.addEventListener("keydown", (e) => {
  const td = e.target.closest("td[data-q]");
  if (td && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); bump(td); return; }
  const el = e.target.closest("input[data-f]");
  if (el && e.key === "Enter") { e.preventDefault(); el.blur(); }
});
sheetBody.addEventListener("focusout", () => { flush(); });
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

// ---------- 내 아이디 ----------
function scrollToMine() {
  const tr = sheetBody.querySelector("tr.mine"); if (!tr) return;
  $("scroll").scrollTop = 0; tr.scrollIntoView({ block: "nearest" });
}
async function openMine(name, sub) {
  saveState("내 줄 여는 중…");
  try {
    await ensureAuth();
    const ref = doc(db, "clanMembers", name);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { name, sub: sub || "", cls: "", cells: {}, uid: auth.currentUser.uid, updatedAt: serverTimestamp() });
      saveState("새 줄을 만들었습니다", "ok");
    } else if (snap.data().uid === auth.currentUser.uid || S.admin) {
      if (sub && sub !== snap.data().sub) await updateDoc(ref, { sub, updatedAt: serverTimestamp() });
      saveState("내 줄을 불러왔습니다", "ok");
    } else {
      saveState("이미 등록된 아이디입니다(다른 기기에서 등록)", "err");
    }
    S.me = name;
    try { localStorage.setItem(ME_KEY, name); } catch (e) { /* 무시 */ }
    render(); scrollToMine();
  } catch (e) { saveState(errText(e), "err"); }
}
$("meForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = cleanName($("meId").value);
  if (badName(n)) { saveState("본캐 아이디를 입력하세요", "err"); $("meId").focus(); return; }
  openMine(n, cleanName($("meSub").value));
});
$("meGo").addEventListener("click", () => {
  if (S.members.some((m) => m.name === S.me)) scrollToMine(); else openMine(S.me, "");
});
$("meChange").addEventListener("click", () => {
  flush(); S.me = ""; try { localStorage.removeItem(ME_KEY); } catch (e) { /* 무시 */ }
  $("meId").value = ""; $("meSub").value = ""; render(); $("meId").focus();
});
$("q").addEventListener("input", render);

// 표 클릭: 수량 탭 / 줄 삭제(관리자)
sheetBody.addEventListener("click", async (e) => {
  const td = e.target.closest("td[data-q]"); if (td) { bump(td); return; }
  const del = e.target.closest("[data-delrow]");
  if (del && S.admin) {
    const id = del.dataset.delrow;
    if (!confirm("'" + id + "' 줄을 삭제할까요?")) return;
    try { await deleteDoc(doc(db, "clanMembers", id)); saveState("줄 삭제됨", "ok"); } catch (err) { saveState(errText(err), "err"); }
  }
});

// ---------- 관리자 ----------
$("adminLink").addEventListener("click", async () => {
  if (S.admin) return;
  try {
    flush();
    const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
    const r = await signInWithPopup(auth, p);
    if (r.user.email !== ADMIN_EMAIL) { await signOut(auth); alert("관리자 계정이 아닙니다."); }
  } catch (e) { alert(errText(e)); }
});
$("btnAdminOut").addEventListener("click", async () => { await signOut(auth); });
$("btnReset").addEventListener("click", async () => {
  if (!S.admin) return;
  if (!confirm("전체 혈원 " + S.members.length + "줄을 모두 삭제합니다. 계속할까요?")) return;
  const t = prompt("되돌릴 수 없습니다. 정말 지우려면  초기화  라고 입력하세요.");
  if (str(t) !== "초기화") { saveState("초기화 취소됨"); return; }
  try {
    saveState("초기화 중…");
    const qs = await getDocs(collection(db, "clanMembers"));
    for (let i = 0; i < qs.docs.length; i += 400) {
      const b = writeBatch(db);
      qs.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    saveState("초기화 완료 ✓", "ok");
  } catch (e) { saveState(errText(e), "err"); }
});

// ---------- 모달(공지) ----------
const modal = $("modal"), dlg = $("dlg");
function openModal(html) {
  dlg.innerHTML = html; modal.hidden = false; document.body.style.overflow = "hidden";
  const f = dlg.querySelector("[autofocus]"); if (f) setTimeout(() => f.focus(), 30);
}
function closeModal() { modal.hidden = true; dlg.innerHTML = ""; document.body.style.overflow = ""; }
modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest("[data-close]")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });
function msg(t) { const m = dlg.querySelector(".msg"); if (m) m.textContent = t; }
async function busy(fn) {
  const bs = dlg.querySelectorAll("button"); bs.forEach((b) => b.disabled = true);
  try { await ensureAuth(); await fn(); } catch (e) { msg(errText(e)); } finally { bs.forEach((b) => b.disabled = false); }
}
function postDlg(p) {
  const isNew = !p; p = p || { date: today(), title: "", body: "" };
  openModal('<h3>' + (isNew ? "공지 쓰기" : "공지 수정") + '</h3><form id="fPost">' +
    '<label class="fld"><span>날짜</span><input id="pDate" type="date" value="' + esc(p.date) + '"></label>' +
    '<label class="fld"><span>제목</span><input id="pTitle" maxlength="100" value="' + esc(p.title) + '" autocomplete="off"' + (isNew ? " autofocus" : "") + '></label>' +
    '<label class="fld"><span>내용</span><textarea id="pBody" maxlength="5000">' + esc(p.body) + '</textarea></label>' +
    '<div class="msg"></div><div class="acts"><button class="btn gold grow" type="submit">저장</button><button class="btn" type="button" data-close>취소</button></div></form>');
  dlg.querySelector("#fPost").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = { date: dlg.querySelector("#pDate").value.slice(0, 10), title: str(dlg.querySelector("#pTitle").value).slice(0, 100),
                   body: dlg.querySelector("#pBody").value.replace(/\s+$/, "").slice(0, 5000), updatedAt: serverTimestamp() };
    if (!data.title) { msg("제목을 입력하세요."); return; }
    busy(async () => {
      if (isNew) await addDoc(collection(db, "posts"), { ...data, uid: auth.currentUser.uid });
      else await setDoc(doc(db, "posts", p.id), { ...data, uid: p.uid });
      closeModal();
    });
  });
}
$("btnAddPost").addEventListener("click", () => postDlg(null));
$("noticeBody").addEventListener("click", async (e) => {
  const ed = e.target.closest("[data-editpost]");
  if (ed) { const p = S.posts.find((x) => x.id === ed.dataset.editpost); if (p) postDlg(p); return; }
  const dl = e.target.closest("[data-delpost]");
  if (dl && confirm("이 글을 삭제할까요?")) {
    try { await ensureAuth(); await deleteDoc(doc(db, "posts", dl.dataset.delpost)); } catch (err) { alert(errText(err)); }
  }
});

render(); renderPosts();
