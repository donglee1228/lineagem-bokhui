// 복희섭 장비보유현황 - 엑셀풍 표 + Firebase(Firestore) 실시간 저장
// 읽기·쓰기 모두 누구나(비번 없음). 저장할 때 자동으로 익명 로그인합니다.
// 허용 컬렉션/필드/글자 수 제한은 Firebase 보안 규칙이 서버에서 검사합니다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, collection, onSnapshot, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

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
const settingsRef = doc(db, "settings", "main");
const ME_KEY = "복희섭_내아이디";

// ---------- 상태 ----------
const S = { cols: [], members: [], posts: [], editAll: false, me: "" };
const loaded = { settings: false, members: false };
try { S.me = localStorage.getItem(ME_KEY) || ""; } catch (e) { /* 저장소 막힘 */ }

// ---------- 도우미 ----------
const $ = (id) => document.getElementById(id);
const arr = (v) => Array.isArray(v) ? v : [];
const str = (v) => (v === undefined || v === null) ? "" : String(v).trim();
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
const tsMs = (t) => (t && typeof t.toMillis === "function") ? t.toMillis() : 0;
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const hhmm = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16);
function cleanName(v) { return str(v).replace(/\//g, "／").replace(/\s+/g, " ").slice(0, 30); }
function badName(n) { return !n || n === "." || n === ".." || /^__.*__$/.test(n); }
function errText(e) {
  const c = e && e.code ? String(e.code) : "";
  if (c.includes("permission-denied")) return "저장이 거부되었습니다(글자 수가 너무 길거나 허용되지 않는 내용).";
  if (c.includes("unavailable") || c.includes("network")) return "인터넷 연결을 확인해 주세요.";
  return "저장하지 못했습니다 (" + (c || (e && e.message) || "오류") + ")";
}
async function ensureAuth() { if (!auth.currentUser) await signInAnonymously(auth); }
function saveState(text, cls) { const el = $("saveState"); el.textContent = text; el.className = "save" + (cls ? " " + cls : ""); }

// ---------- 표 그리기 ----------
let needRender = false;
const sheetBody = $("sheetBody");
const pending = new Map(); // rowId -> {field: value}
function sheetFocused() { const a = document.activeElement; return !!(a && a.closest && a.closest("#sheetBody") && a.tagName === "INPUT"); }
function render() {
  // 입력 중이면 커서 위치를 기억했다가 다시 그린 뒤 복원 (다른 사람 변경도 바로 보이게)
  let keep = null;
  if (sheetFocused()) {
    const a = document.activeElement, tr = a.closest("tr[data-row]");
    if (tr) keep = { row: tr.dataset.row, f: a.dataset.f, v: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  needRender = false;
  renderMe();
  if (!loaded.settings || !loaded.members) return;
  const pv = (m, f, base) => { const p = pending.get(m.id); return p && f in p ? p[f] : base; };
  const q = $("q").value.trim().toLowerCase();
  const cols = S.cols;
  const mine = S.members.find((m) => m.name === S.me);
  let rows = S.members.filter((m) => m !== mine && (!q || m.name.toLowerCase().includes(q) || m.cls.toLowerCase().includes(q)));
  if (mine) rows = [mine].concat(rows);

  let h = '<table class="xl"><thead><tr><th class="rn">#</th><th class="nm">아이디</th><th>클래스</th>';
  cols.forEach((c) => { h += '<th class="colh" data-col="' + esc(c.id) + '" title="눌러서 이름 변경·삭제">' + esc(c.name) + '<span class="pen">✎</span></th>'; });
  h += '<th class="add"><button class="btn sm" type="button" data-addcol>+ 칸</button></th></tr></thead><tbody>';
  if (!rows.length) {
    h += '<tr><td class="rn"></td><td colspan="' + (cols.length + 3) + '"><div class="empty"><b>' +
         (S.members.length ? "검색 결과가 없습니다" : "아직 아무도 없습니다") + '</b>' +
         (S.members.length ? "검색어를 바꿔 보세요." : "위에 내 아이디를 입력하고 '내 줄 열기'를 누르세요.") + '</div></td></tr>';
  }
  rows.forEach((m, i) => {
    const isMine = m === mine, editable = isMine || S.editAll;
    h += '<tr class="' + (isMine ? "mine" : "") + '" data-row="' + esc(m.id) + '"><td class="rn">' + (isMine ? "나" : i + 1) + '</td>' +
         '<td class="nm" title="' + esc(m.name) + '">' + esc(m.name) +
         (S.editAll ? '<button class="del" type="button" data-delrow="' + esc(m.id) + '" title="줄 삭제" aria-label="줄 삭제">✕</button>' : '') + '</td>';
    if (editable) {
      h += '<td class="edit"><input data-f="cls" maxlength="20" list="clsList" value="' + esc(pv(m, "cls", m.cls)) + '" placeholder="클래스" aria-label="클래스"></td>';
      cols.forEach((c) => {
        h += '<td class="edit"><input data-f="' + esc(c.id) + '" maxlength="20" value="' + esc(pv(m, c.id, m.cells[c.id] || "")) + '" placeholder="-" aria-label="' + esc(c.name) + '"></td>';
      });
    } else {
      h += '<td class="cls">' + (m.cls ? esc(m.cls) : '<span class="e">·</span>') + '</td>';
      cols.forEach((c) => {
        const v = str(m.cells[c.id]);
        h += '<td class="c">' + (v ? '<span class="v">' + esc(v) + '</span>' : '<span class="e">·</span>') + '</td>';
      });
    }
    h += '<td></td></tr>';
  });
  h += '</tbody></table><datalist id="clsList">' +
       ["군주", "기사", "요정", "마법사", "다크엘프", "용기사", "전사", "검사", "창기사", "총사", "투사", "광전사", "뇌신", "신성검사", "암흑기사"].map((c) => '<option value="' + c + '">').join("") +
       '</datalist>';
  const sc = $("scroll"), top = sc.scrollTop, left = sc.scrollLeft;
  $("sheetBody").innerHTML = h;
  sc.scrollTop = top; sc.scrollLeft = left;
  if (keep) {
    const tr = [...sheetBody.querySelectorAll("tr[data-row]")].find((t) => t.dataset.row === keep.row);
    const inp = tr && [...tr.querySelectorAll("input[data-f]")].find((i) => i.dataset.f === keep.f);
    if (inp) { inp.value = keep.v; inp.focus({ preventScroll: true }); try { inp.setSelectionRange(keep.s, keep.e); } catch (e) { /* 무시 */ } }
  }
  $("footCount").textContent = S.editAll ? "전체 편집 중 — 모든 줄을 고칠 수 있어요" : "내 줄만 바로 고칠 수 있어요";
}

function renderMe() {
  const has = !!S.me;
  $("meForm").hidden = has; $("meWho").hidden = !has;
  $("meName").textContent = S.me;
}

function renderPosts() {
  const body = $("noticeBody");
  if (!S.posts.length) { body.innerHTML = '<div class="panel"><div class="empty">아직 공지가 없습니다.</div></div>'; return; }
  body.innerHTML = '<div class="posts">' + S.posts.map((p) =>
    '<article class="post">' + (p.date ? '<time>' + esc(p.date) + '</time>' : '') + '<h3>' + esc(p.title) + '</h3><div class="body">' + esc(p.body) + '</div>' +
    '<div class="pact"><button class="btn sm" type="button" data-editpost="' + esc(p.id) + '">수정</button>' +
    '<button class="btn sm red" type="button" data-delpost="' + esc(p.id) + '">삭제</button></div></article>').join("") + '</div>';
}

// ---------- 실시간 구독 ----------
function loadErr(e) { $("sheetBody").innerHTML = '<div class="empty"><b>불러오지 못했습니다</b>' + esc(errText(e)) + '</div>'; }
onSnapshot(settingsRef, (snap) => {
  const d = snap.exists() ? snap.data() : {};
  S.cols = arr(d.cols).filter((c) => c && str(c.id) && str(c.name)).map((c) => ({ id: str(c.id), name: str(c.name) }));
  loaded.settings = true; render();
}, loadErr);
onSnapshot(collection(db, "clanMembers"), (qs) => {
  S.members = qs.docs.map((d) => {
    const v = d.data();
    return { id: d.id, name: str(v.name) || d.id, cls: str(v.cls), cells: (v.cells && typeof v.cells === "object") ? v.cells : {} };
  }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  loaded.members = true; render();
}, loadErr);
onSnapshot(collection(db, "posts"), (qs) => {
  S.posts = qs.docs.map((d) => { const v = d.data(); return { id: d.id, date: str(v.date), title: str(v.title), body: v.body == null ? "" : String(v.body), t: tsMs(v.updatedAt) }; })
    .filter((p) => p.title).sort((a, b) => b.date.localeCompare(a.date) || b.t - a.t);
  renderPosts();
}, () => {});

// ---------- 셀 편집 → 자동 저장 ----------
let timer = null;
function queue(rowId, f, v) {
  if (!pending.has(rowId)) pending.set(rowId, {});
  pending.get(rowId)[f] = v;
  saveState("저장 중…");
  clearTimeout(timer); timer = setTimeout(flush, 700);
}
async function flush() {
  clearTimeout(timer);
  if (!pending.size) return;
  const jobs = [...pending.entries()]; pending.clear();
  try {
    await ensureAuth();
    for (const [rowId, fields] of jobs) {
      const up = { updatedAt: serverTimestamp() };
      Object.entries(fields).forEach(([f, v]) => { up[f === "cls" ? "cls" : "cells." + f] = v; });
      await updateDoc(doc(db, "clanMembers", rowId), up);
    }
    if (!pending.size) saveState("저장됨 ✓ " + hhmm(), "ok");
  } catch (e) { saveState(errText(e), "err"); }
}
sheetBody.addEventListener("input", (e) => {
  const inp = e.target.closest("input[data-f]"); if (!inp) return;
  const tr = inp.closest("tr[data-row]");
  queue(tr.dataset.row, inp.dataset.f, inp.value.trim().slice(0, 20));
});
sheetBody.addEventListener("keydown", (e) => {
  const inp = e.target.closest("input[data-f]"); if (!inp || e.key !== "Enter") return;
  e.preventDefault();
  const all = [...inp.closest("tr").querySelectorAll("input[data-f]")];
  const nx = all[all.indexOf(inp) + 1];
  if (nx) nx.focus(); else inp.blur();
});
sheetBody.addEventListener("focusout", () => { flush(); });
window.addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });

// ---------- 내 아이디 ----------
function scrollToMine(focus) {
  const tr = sheetBody.querySelector("tr.mine"); if (!tr) return;
  const sc = $("scroll"); sc.scrollTop = 0;
  tr.scrollIntoView({ block: "nearest" });
  if (focus) { const i = tr.querySelector("input"); if (i) i.focus({ preventScroll: true }); }
}
async function openMine(name) {
  saveState("내 줄 여는 중…");
  try {
    await ensureAuth();
    const ref = doc(db, "clanMembers", name);
    const snap = await getDoc(ref);
    if (!snap.exists()) await setDoc(ref, { name, cls: "", cells: {}, updatedAt: serverTimestamp() });
    S.me = name;
    try { localStorage.setItem(ME_KEY, name); } catch (e) { /* 무시 */ }
    saveState(snap.exists() ? "내 줄을 불러왔습니다" : "새 줄을 만들었습니다", "ok");
    render(); scrollToMine(true);
  } catch (e) { saveState(errText(e), "err"); }
}
$("meForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = cleanName($("meId").value);
  if (badName(n)) { saveState("아이디를 입력하세요", "err"); $("meId").focus(); return; }
  openMine(n);
});
$("meGo").addEventListener("click", () => {
  if (S.members.some((m) => m.name === S.me)) scrollToMine(true); else openMine(S.me);
});
$("meChange").addEventListener("click", () => {
  flush(); S.me = ""; try { localStorage.removeItem(ME_KEY); } catch (e) { /* 무시 */ }
  $("meId").value = ""; render(); $("meId").focus();
});

$("q").addEventListener("input", render);
$("btnEditAll").addEventListener("click", () => {
  flush(); S.editAll = !S.editAll;
  $("btnEditAll").classList.toggle("on", S.editAll); $("btnEditAll").setAttribute("aria-pressed", String(S.editAll));
  $("btnEditAll").textContent = S.editAll ? "전체 편집 끝" : "전체 편집";
  render();
});

// ---------- 모달 ----------
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
const newId = () => "c" + Math.random().toString(36).slice(2, 8);
async function changeCols(fn) {
  await runTransaction(db, async (tx) => {
    const s = await tx.get(settingsRef);
    const cols = arr(s.exists() ? s.data().cols : []).filter((c) => c && c.id && c.name);
    tx.set(settingsRef, { cols: fn(cols), updatedAt: serverTimestamp() }, { merge: true });
  });
}

// 장비 칸 추가
function addColDlg() {
  openModal('<h3>장비 칸 추가</h3><form id="fCol"><label class="fld"><span>칸 이름 (예: 집행검, 진명황, 반역자의 방패)</span>' +
    '<input id="colName" maxlength="20" autocomplete="off" autofocus></label><div class="msg"></div>' +
    '<div class="acts"><button class="btn gold grow" type="submit">추가</button><button class="btn" type="button" data-close>취소</button></div></form>');
  dlg.querySelector("#fCol").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = str(dlg.querySelector("#colName").value).slice(0, 20);
    if (!n) { msg("이름을 입력하세요."); return; }
    if (S.cols.some((c) => c.name === n)) { msg("이미 있는 칸입니다."); return; }
    if (S.cols.length >= 60) { msg("칸은 60개까지입니다."); return; }
    busy(async () => { await changeCols((cols) => cols.concat([{ id: newId(), name: n }])); closeModal(); saveState("칸 추가됨 ✓", "ok"); });
  });
}
$("btnAddCol").addEventListener("click", addColDlg);

// 칸 이름 변경/삭제
function colDlg(id) {
  const c = S.cols.find((x) => x.id === id); if (!c) return;
  openModal('<h3>장비 칸 수정</h3><form id="fCol"><label class="fld"><span>칸 이름</span>' +
    '<input id="colName" maxlength="20" value="' + esc(c.name) + '" autocomplete="off" autofocus></label><div class="msg"></div>' +
    '<div class="acts"><button class="btn gold grow" type="submit">이름 저장</button><button class="btn red" type="button" id="colDel">칸 삭제</button>' +
    '<button class="btn" type="button" data-close>취소</button></div></form>');
  dlg.querySelector("#fCol").addEventListener("submit", (e) => {
    e.preventDefault();
    const n = str(dlg.querySelector("#colName").value).slice(0, 20);
    if (!n) { msg("이름을 입력하세요."); return; }
    if (S.cols.some((x) => x.name === n && x.id !== id)) { msg("이미 있는 칸 이름입니다."); return; }
    busy(async () => { await changeCols((cols) => cols.map((x) => x.id === id ? { id, name: n } : x)); closeModal(); });
  });
  dlg.querySelector("#colDel").addEventListener("click", () => {
    if (!confirm("'" + c.name + "' 칸을 삭제할까요? (모든 혈원의 이 칸 내용이 안 보이게 됩니다)")) return;
    busy(async () => { await changeCols((cols) => cols.filter((x) => x.id !== id)); closeModal(); });
  });
}

// 표 안 버튼들
sheetBody.addEventListener("click", async (e) => {
  if (e.target.closest("[data-addcol]")) { addColDlg(); return; }
  const th = e.target.closest("th.colh"); if (th) { colDlg(th.dataset.col); return; }
  const del = e.target.closest("[data-delrow]");
  if (del) {
    const id = del.dataset.delrow;
    if (!confirm("'" + id + "' 줄을 삭제할까요?")) return;
    try { await ensureAuth(); await deleteDoc(doc(db, "clanMembers", id)); saveState("줄 삭제됨", "ok"); } catch (err) { saveState(errText(err), "err"); }
  }
});

// ---------- 공지 ----------
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
    busy(async () => { if (isNew) await addDoc(collection(db, "posts"), data); else await setDoc(doc(db, "posts", p.id), data); closeModal(); });
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
