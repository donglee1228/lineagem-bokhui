// 복희섭 장비보유현황 - 엑셀풍 표 + Firebase(Firestore) 실시간 저장
// 읽기: 누구나 / 줄 만들기·수정: 누구나(모든 줄, 익명 로그인 자동)
// 댓글: 누구나 쓰기 / 줄 삭제·초기화·댓글 삭제·'서버 기초' 글쓰기: 관리자(구글 로그인 dldmsdnr1228@gmail.com)만 — 서버 보안 규칙이 강제합니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, writeBatch, query, orderBy, limit
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
    { id: "hyeongma", name: "용인형", need: 2 } // 칸 id는 옛 형마 그대로(저장된 수량 유지)
  ] }
];
const COLS = GROUPS.flatMap((g) => g.cols);
const CLASSES = ["군주", "요정", "마법사", "기사"];
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

// ---------- 상태 ----------
const S = { members: [], comments: [], posts: [], postEdit: null, uid: "", admin: false, loaded: false, editing: new Set() };

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
  if (c.includes("permission-denied")) return "권한이 없습니다(허용되지 않는 값이거나 관리자 전용).";
  if (c.includes("unavailable") || c.includes("network")) return "인터넷 연결을 확인해 주세요.";
  if (c.includes("popup")) return "로그인 창이 닫혔거나 막혔습니다.";
  return "실패했습니다 (" + (c || (e && e.message) || "오류") + ")";
}
async function ensureAuth() { if (!auth.currentUser) await signInAnonymously(auth); S.uid = auth.currentUser.uid; }
function saveState(text, cls) { const el = $("saveState"); el.textContent = text; el.className = "save" + (cls ? " " + cls : ""); }

// ---------- 표 그리기 ----------
const sheetBody = $("sheetBody");
const pending = new Map(); // rowId -> {field: value}
let lastHtml = "";
const pv = (m, f, base) => { const p = pending.get(m.id); return p && f in p ? p[f] : base; };

function render() {
  // 입력 중이면 커서를 기억했다가 다시 그린 뒤 복원
  let keep = null;
  const a = document.activeElement;
  if (a && a.closest && a.closest("#sheetBody") && (a.tagName === "INPUT" || a.tagName === "SELECT")) {
    const tr = a.closest("tr[data-row]");
    if (tr) keep = { row: tr.dataset.row, f: a.dataset.f, v: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  renderAdmin();
  if (!S.loaded) return;
  const rows = S.members;

  let h = '<table class="xl"><thead><tr class="grp"><th class="rn"></th><th class="nm"></th><th></th>';
  GROUPS.forEach((g) => { h += '<th class="g" colspan="' + g.cols.length + '">' + esc(g.name) + '</th>'; });
  h += '<th></th></tr><tr class="hd"><th class="rn">#</th><th class="nm">아이디<small>본캐 / 부캐</small></th><th>클래스</th>';
  COLS.forEach((c) => { h += '<th class="colh">' + esc(c.name) + '<small>×' + c.need + '</small></th>'; });
  h += '<th>수정</th></tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td class="rn"></td><td colspan="' + (COLS.length + 3) + '"><div class="empty"><b>' +
         "아직 아무도 없습니다</b>위의 '아이디 추가하기'를 눌러 아이디를 추가하세요.</div></td></tr>";
  }
  rows.forEach((m, i) => {
    const ed = S.editing.has(m.id);
    const sub = pv(m, "sub", m.sub), cls = pv(m, "cls", m.cls);
    h += '<tr class="' + (ed ? "mine" : "") + '" data-row="' + esc(m.id) + '"><td class="rn">' + (i + 1) + '</td>';
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
    COLS.forEach((c) => {
      const n = Math.min(Number(pv(m, c.id, qtyOf(m, c))) || 0, c.need);
      const st = n >= c.need ? "full" : n > 0 ? "part" : "zero";
      h += '<td class="q ' + st + (ed ? " ed" : "") + '" data-c="' + c.id + '">' +
           (ed ? '<button class="stp" type="button" data-step="-1" aria-label="' + esc(c.name) + ' 줄이기">−</button>' : '') +
           '<span class="n">' + n + '/' + c.need + '</span>' +
           (ed ? '<button class="stp" type="button" data-step="1" aria-label="' + esc(c.name) + ' 늘리기">+</button>' : '') + '</td>';
    });
    h += '<td class="act"><button class="btn sm' + (ed ? " gold" : "") + '" type="button" data-edit="' + esc(m.id) + '">' + (ed ? "완료" : "수정하기") + '</button></td></tr>';
  });
  h += '</tbody></table>';
  $("footCount").textContent = S.admin ? "관리자: 줄 삭제·초기화 가능" : "누구나 추가·수정할 수 있어요";
  // 화면이 그대로면 다시 그리지 않음(연속으로 누르는 도중 버튼이 갈아끼워져 누름이 씹히는 것 방지)
  if (h === lastHtml) return;
  lastHtml = h;
  const sc = $("scroll"), top = sc.scrollTop, left = sc.scrollLeft;
  sheetBody.innerHTML = h;
  sc.scrollTop = top; sc.scrollLeft = left;
  if (keep) {
    const tr = [...sheetBody.querySelectorAll("tr[data-row]")].find((t) => t.dataset.row === keep.row);
    const el = tr && [...tr.querySelectorAll("[data-f]")].find((i) => i.dataset.f === keep.f);
    if (el) { el.value = keep.v; el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* select */ } }
  }
}

function renderAdmin() { $("adminBar").hidden = !S.admin; $("adminLink").textContent = S.admin ? "관리자 로그인됨" : "관리"; }

const CMT_KEY = "복희섭_댓글아이디";
const fmtTime = (ms) => ms ? new Date(ms + 9 * 3600e3).toISOString().slice(5, 16).replace("T", " ") : "";
function renderComments() {
  $("cmtCount").textContent = S.comments.length;
  const box = $("cmtList");
  if (!S.comments.length) { box.innerHTML = '<div class="empty">아직 댓글이 없습니다.</div>'; return; }
  box.innerHTML = S.comments.map((c) =>
    '<div class="cm" data-cm="' + esc(c.id) + '"><div class="ch"><b>' + esc(c.name) + '</b><time>' + esc(fmtTime(c.t)) + '</time>' +
    (S.admin ? '<button class="del" type="button" data-delcm="' + esc(c.id) + '" title="댓글 삭제" aria-label="댓글 삭제">✕</button>' : '') +
    '</div><div class="cb">' + esc(c.body) + '</div></div>').join("");
}

// ---------- 서버 기초(글) ----------
function renderBasic() {
  $("btnAddPost").hidden = !S.admin || S.postEdit !== null;
  $("postForm").hidden = !S.admin || S.postEdit === null;
  const box = $("postList");
  if (!S.posts.length) {
    box.innerHTML = '<div class="panel"><div class="empty"><b>아직 글이 없습니다</b>' +
      (S.admin ? "위의 [+ 글쓰기]로 첫 글을 적어 보세요." : "글은 관리자 로그인(맨 아래 '관리') 후 쓸 수 있습니다.") + '</div></div>';
    return;
  }
  box.innerHTML = '<div class="posts">' + S.posts.map((p) =>
    '<article class="post" data-post="' + esc(p.id) + '"><h3>' + esc(p.title) + '</h3><div class="body">' + esc(p.body) + '</div>' +
    (S.admin ? '<div class="pact"><button class="btn sm" type="button" data-editpost="' + esc(p.id) + '">수정</button>' +
               '<button class="btn sm red" type="button" data-delpost="' + esc(p.id) + '">삭제</button></div>' : '') + '</article>').join("") + '</div>';
}

// ---------- 실시간 구독 ----------
onSnapshot(collection(db, "clanMembers"), (qs) => {
  S.members = qs.docs.map((d) => {
    const v = d.data();
    return { id: d.id, name: str(v.name) || d.id, sub: str(v.sub), cls: str(v.cls), uid: str(v.uid),
             cells: (v.cells && typeof v.cells === "object") ? v.cells : {} };
  }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  S.loaded = true; render();
}, (e) => { lastHtml = ""; sheetBody.innerHTML = '<div class="empty"><b>불러오지 못했습니다</b>' + esc(errText(e)) + '</div>'; });
onSnapshot(query(collection(db, "comments"), orderBy("createdAt", "desc"), limit(200)), (qs) => {
  S.comments = qs.docs.map((d) => { const v = d.data({ serverTimestamps: "estimate" });
    return { id: d.id, name: str(v.name), body: v.body == null ? "" : String(v.body), t: tsMs(v.createdAt) }; });
  renderComments();
}, () => {});

onSnapshot(collection(db, "posts"), (qs) => {
  S.posts = qs.docs.map((d) => { const v = d.data({ serverTimestamps: "estimate" });
    return { id: d.id, uid: str(v.uid), date: str(v.date), title: str(v.title), body: v.body == null ? "" : String(v.body),
             order: Number(v.order) || tsMs(v.updatedAt) }; })
    .filter((p) => p.title).sort((a, b) => a.order - b.order);
  renderBasic();
}, () => {});

onAuthStateChanged(auth, (u) => {
  S.uid = u ? u.uid : "";
  S.admin = !!(u && !u.isAnonymous && u.email === ADMIN_EMAIL && u.emailVerified);
  if (!S.admin) S.postEdit = null;
  render(); renderComments(); renderBasic();
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
function bump(btn) {
  const td = btn.closest("td[data-c]"), tr = td.closest("tr[data-row]"), m = S.members.find((x) => x.id === tr.dataset.row);
  const c = COLS.find((x) => x.id === td.dataset.c); if (!m || !c || !S.editing.has(m.id)) return;
  const cur = Math.min(Number(pv(m, c.id, qtyOf(m, c))) || 0, c.need);
  const nx = Math.max(0, Math.min(c.need, cur + Number(btn.dataset.step)));
  if (nx === cur) return;
  queue(m.id, c.id, nx, 450);
  render();
}
sheetBody.addEventListener("keydown", (e) => {
  const el = e.target.closest("input[data-f]");
  if (el && e.key === "Enter") { e.preventDefault(); el.blur(); }
});
sheetBody.addEventListener("focusout", () => { flush(); });
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

// ---------- 아이디 추가하기 ----------
function scrollToRow(id) {
  const tr = [...sheetBody.querySelectorAll("tr[data-row]")].find((t) => t.dataset.row === id);
  if (tr) tr.scrollIntoView({ block: "center" });
}
function showAdd(on) {
  $("btnAddId").hidden = on; $("meForm").hidden = !on;
  if (on) { $("meId").value = ""; $("meId").focus(); }
}
async function addId(name) {
  saveState("추가하는 중…");
  try {
    await ensureAuth();
    const ref = doc(db, "clanMembers", name);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      saveState("이미 있는 아이디입니다: " + name, "err");
    } else {
      await setDoc(ref, { name, sub: "", cls: "", cells: {}, uid: auth.currentUser.uid, updatedAt: serverTimestamp() });
      saveState("추가됨 ✓ " + name, "ok");
      S.editing.add(name); // 새 줄은 바로 개수를 고칠 수 있게
    }
    showAdd(false); render(); scrollToRow(name);
  } catch (e) { saveState(errText(e), "err"); }
}
$("btnAddId").addEventListener("click", () => showAdd(true));
$("meCancel").addEventListener("click", () => showAdd(false));
$("meForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = cleanName($("meId").value);
  if (badName(n)) { saveState("아이디를 입력하세요", "err"); $("meId").focus(); return; }
  addId(n);
});

// 표 클릭: 수량 −/+ / 수정하기·완료 / 줄 삭제(관리자)
sheetBody.addEventListener("click", async (e) => {
  const stp = e.target.closest("[data-step]"); if (stp) { bump(stp); return; }
  const eb = e.target.closest("[data-edit]");
  if (eb) {
    const id = eb.dataset.edit;
    if (S.editing.has(id)) { S.editing.delete(id); flush(); } else S.editing.add(id);
    render(); return;
  }
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

// ---------- 댓글 ----------
try { $("cmtName").value = localStorage.getItem(CMT_KEY) || ""; } catch (e) { /* 저장소 막힘 */ }
function cmtMsg(t, okay) { const m = $("cmtMsg"); m.textContent = t; m.className = "cmsg" + (okay ? " ok" : ""); }
$("cmtForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = cleanName($("cmtName").value), body = $("cmtBody").value.trim().slice(0, 500);
  if (!name) { cmtMsg("아이디를 입력하세요."); $("cmtName").focus(); return; }
  if (!body) { cmtMsg("댓글 내용을 입력하세요."); $("cmtBody").focus(); return; }
  const btn = $("cmtForm").querySelector("button[type=submit]"); btn.disabled = true;
  try {
    await ensureAuth();
    await addDoc(collection(db, "comments"), { name, body, uid: auth.currentUser.uid, createdAt: serverTimestamp() });
    $("cmtBody").value = ""; cmtMsg("댓글을 올렸습니다 ✓", true);
    try { localStorage.setItem(CMT_KEY, name); } catch (err) { /* 무시 */ }
  } catch (err) { cmtMsg(errText(err)); } finally { btn.disabled = false; }
});
$("cmtList").addEventListener("click", async (e) => {
  const dl = e.target.closest("[data-delcm]");
  if (dl && S.admin && confirm("이 댓글을 삭제할까요?")) {
    try { await deleteDoc(doc(db, "comments", dl.dataset.delcm)); } catch (err) { alert(errText(err)); }
  }
});

// ---------- 탭 ----------
function showTab(basic) {
  $("tabGear").hidden = basic; $("tabBasic").hidden = !basic;
  $("tabBtnGear").classList.toggle("on", !basic); $("tabBtnBasic").classList.toggle("on", basic);
  $("tabBtnGear").setAttribute("aria-selected", String(!basic)); $("tabBtnBasic").setAttribute("aria-selected", String(basic));
  try { history.replaceState(null, "", basic ? "#기초" : location.pathname + location.search); } catch (e) { /* 무시 */ }
}
$("tabBtnGear").addEventListener("click", () => showTab(false));
$("tabBtnBasic").addEventListener("click", () => showTab(true));
let hash0 = ""; try { hash0 = decodeURIComponent(location.hash); } catch (e) { /* 무시 */ }
showTab(hash0 === "#기초");

// ---------- 서버 기초 글쓰기(관리자) ----------
function openPostForm(p) {
  S.postEdit = p ? p.id : "new";
  $("postTitle").value = p ? p.title : ""; $("postBody").value = p ? p.body : "";
  $("postFormTitle").textContent = p ? "글 수정" : "글쓰기"; $("postMsg").textContent = "";
  renderBasic(); $("postForm").scrollIntoView({ block: "nearest" }); $("postTitle").focus();
}
function closePostForm() { S.postEdit = null; renderBasic(); }
$("btnAddPost").addEventListener("click", () => openPostForm(null));
$("postCancel").addEventListener("click", closePostForm);
$("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!S.admin) return;
  const title = str($("postTitle").value).slice(0, 100), body = $("postBody").value.replace(/\s+$/, "").slice(0, 20000);
  if (!title) { $("postMsg").textContent = "제목을 입력하세요."; $("postTitle").focus(); return; }
  const btn = $("postForm").querySelector("button[type=submit]"); btn.disabled = true;
  try {
    const old = S.posts.find((x) => x.id === S.postEdit);
    if (old) await setDoc(doc(db, "posts", old.id), { date: old.date, title, body, uid: old.uid, order: old.order, updatedAt: serverTimestamp() });
    else await addDoc(collection(db, "posts"), { date: today(), title, body, uid: auth.currentUser.uid, order: Date.now(), updatedAt: serverTimestamp() });
    closePostForm();
  } catch (err) { $("postMsg").textContent = errText(err); } finally { btn.disabled = false; }
});
$("postList").addEventListener("click", async (e) => {
  if (!S.admin) return;
  const ed = e.target.closest("[data-editpost]");
  if (ed) { const p = S.posts.find((x) => x.id === ed.dataset.editpost); if (p) openPostForm(p); return; }
  const dl = e.target.closest("[data-delpost]");
  if (dl && confirm("이 글을 삭제할까요?")) {
    try { await deleteDoc(doc(db, "posts", dl.dataset.delpost)); } catch (err) { alert(errText(err)); }
  }
});

render(); renderComments(); renderBasic();
