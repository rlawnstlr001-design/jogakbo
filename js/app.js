// 조각보 — 짧게 적고, 매일 아침 다시 만난다
import * as db from './db.js?v=202610041102';
import {
  parseTags, tagColor, memoColor, dayKey, todayKey, prettyDay, timeOf, matches, tagTree, allTagPaths,
  newId, esc, renderBody, PALETTE, topTag,
} from './memo.js?v=202610041102';
import { buildReview, DEFAULT_RULES, MIN_POOL } from './review.js?v=202610041102';
import { dayPatches, patchStyle, monthCells, monthImage } from './patch.js?v=202610041102';
import { track } from './track.js?v=202610041102';
import { isApp, haptic, shareFile, scheduleReview, initNative } from './native.js?v=202610041102';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const input = $('#input');
const PAGE = 80;
const TRASH_DAYS = 30;

const S = {
  memos: [],
  reviews: [],
  settings: { rules: DEFAULT_RULES, reviewTime: '08:00', notify: null, colors: {} }, // notify: null=아직 안 물어봄
  filter: { include: [], exclude: [], q: '', day: null },
  quoteId: null,
  editId: null,
  shown: PAGE,
  bo: null, // { y, m }
};

const live = () => S.memos.filter((m) => !m.deletedAt);
const byId = (id) => S.memos.find((m) => m.id === id);
const colors = () => S.settings.colors;

// ---------- 알림 ----------
let toastTimer;
function toast(msg, { action, onAction, ms = 2200 } = {}) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-act">${esc(action)}</button>` : ''}`;
  t.classList.add('on');
  if (action) t.querySelector('.toast-act').onclick = () => { t.classList.remove('on'); onAction?.(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), action ? 5000 : ms);
}

let closeSheet = null;
function openSheet(html, { onClose, cls = '' } = {}) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-back" data-close></div>
    <section class="sheet ${cls}" role="dialog" aria-modal="true">
      <span class="sheet-grip" aria-hidden="true"></span>${html}</section>`;
  root.classList.add('on');
  const close = () => { root.classList.remove('on'); root.innerHTML = ''; closeSheet = null; onClose?.(); };
  closeSheet = close;
  // 시트 내용을 다시 그려도 닫기 버튼이 살아 있게 위임으로 건다
  root.querySelector('.sheet-back').addEventListener('click', close);
  root.querySelector('.sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  return { root, close };
}

// ---------- 저장 ----------
async function addMemo(content) {
  const now = Date.now();
  const m = {
    id: newId(), content, tags: parseTags(content), createdAt: now, updatedAt: now,
    deletedAt: null, pinned: false, refs: S.quoteId ? [S.quoteId] : [], source: 'app',
  };
  S.memos.push(m);
  await db.put('memos', m);
  track('memo');
  if (S.quoteId) {
    const r = todayReview();
    if (r && r.items.some((it) => it.id === S.quoteId)) {
      r.continued = (r.continued ?? 0) + 1;
      await db.put('reviews', r);
      track('continue');
    }
  }
  return m;
}

async function updateMemo(id, content) {
  const m = byId(id);
  if (!m) return;
  m.content = content;
  m.tags = parseTags(content);
  m.updatedAt = Date.now();
  await db.put('memos', m);
}

async function removeMemo(id) {
  const m = byId(id);
  if (!m) return;
  m.deletedAt = Date.now();
  await db.put('memos', m);
  render();
  toast('조각을 떼어 냈어요', {
    action: '되돌리기',
    onAction: async () => { m.deletedAt = null; await db.put('memos', m); render(); },
  });
}

async function togglePin(id) {
  const m = byId(id);
  m.pinned = !m.pinned;
  await db.put('memos', m);
  render();
}

async function saveSettings() { await db.put('kv', S.settings, 'settings'); }

// ---------- 오늘의 조각 ----------
function todayReview() { return S.reviews.find((r) => r.date === todayKey()) ?? null; }

async function ensureTodayReview() {
  let r = todayReview();
  if (r && r.items.length) return r;
  const pool = live().filter((m) => dayKey(m.createdAt) < todayKey());
  if (pool.length < MIN_POOL) return null;
  r = buildReview(todayKey(), live(), S.reviews, S.settings.rules);
  if (!r.items.length) return null;
  S.reviews = S.reviews.filter((x) => x.date !== r.date).concat(r);
  await db.put('reviews', r);
  return r;
}

function updateDot() {
  const r = todayReview();
  $('#today-dot').hidden = !(r && r.items.length && !r.openedAt);
}

// ---------- 조각들 ----------
function filterActive() {
  const f = S.filter;
  return f.include.length || f.exclude.length || f.q || f.day;
}

function visibleMemos() {
  const f = S.filter;
  let list = S.memos.filter((m) => matches(m, f) && (!f.day || dayKey(m.createdAt) === f.day));
  list.sort((a, b) => b.createdAt - a.createdAt);
  if (!filterActive()) list = [...list.filter((m) => m.pinned), ...list.filter((m) => !m.pinned)];
  return list;
}

function memoCard(m, { inReview = false } = {}) {
  const refs = (m.refs ?? []).map(byId).filter((r) => r && !r.deletedAt);
  const refHtml = refs.map((r) => `<button class="ref" data-goto="${r.id}">↳ ${esc(r.content.slice(0, 60))}${r.content.length > 60 ? '…' : ''}</button>`).join('');
  return `<article class="memo${m.pinned ? ' pinned' : ''}" data-id="${m.id}" style="--c:${memoColor(m, colors())}">
    ${refHtml}
    <div class="memo-body">${renderBody(m.content, colors())}</div>
    <div class="memo-foot">
      <span>${m.pinned && !inReview ? '<b class="pin">고정</b> · ' : ''}${inReview ? esc(prettyDay(dayKey(m.createdAt))) : timeOf(m.createdAt)}${m.updatedAt - m.createdAt > 60000 ? ' · 고침' : ''}</span>
      ${inReview ? '' : `<button class="more" data-more="${m.id}" aria-label="조각 메뉴">⋯</button>`}
    </div>
  </article>`;
}

function filterBar(count) {
  const f = S.filter;
  if (!filterActive()) return '';
  const chips = [
    ...f.include.map((t) => `<button class="chip inc" data-unf="inc:${esc(t)}" style="--c:${tagColor(t, colors())}">#${esc(t)} ✕</button>`),
    ...f.exclude.map((t) => `<button class="chip exc" data-unf="exc:${esc(t)}">#${esc(t)} 빼고 ✕</button>`),
    f.q ? `<button class="chip" data-unf="q">“${esc(f.q)}” ✕</button>` : '',
    f.day ? `<button class="chip" data-unf="day">${esc(prettyDay(f.day))} ✕</button>` : '',
  ].join('');
  return `<div class="filterbar"><div class="chips">${chips}</div><span class="fcount">${count}개</span><button class="text-btn" data-unf="all">모두 풀기</button></div>`;
}

function renderList() {
  const list = visibleMemos();
  if (!live().length) {
    view.innerHTML = `<section class="empty">
      <div class="empty-bo" aria-hidden="true">${['jjok', 'chija', 'hong', 'ok', 'songhwa', 'ja'].map((k) => `<i style="background:${PALETTE.find((p) => p.key === k).hex}"></i>`).join('')}</div>
      <h2>첫 조각을 붙여 보세요</h2>
      <p>정리하지 않아도 됩니다. 떠오른 것을 짧게 적고, 원하면 <b>#태그</b>를 붙이세요. 태그마다 천 색이 정해집니다.</p>
      <p>조각이 다섯 개를 넘으면 <b>매일 아침 지난 조각 세 장</b>을 꺼내 드려요.</p>
    </section>`;
    return;
  }
  let html = filterBar(list.length);
  let lastDay = null;
  let pinnedOpen = false;
  const shown = list.slice(0, S.shown);
  for (const m of shown) {
    if (m.pinned && !filterActive()) {
      if (!pinnedOpen) { html += '<h3 class="day">고정한 조각</h3>'; pinnedOpen = true; }
    } else {
      const k = dayKey(m.createdAt);
      if (k !== lastDay) { html += `<h3 class="day">${esc(prettyDay(k))}</h3>`; lastDay = k; }
    }
    html += memoCard(m);
  }
  if (!list.length) html += '<p class="none">맞는 조각이 없어요.</p>';
  if (list.length > S.shown) html += '<div class="more-sentinel" id="sentinel">더 불러오는 중…</div>';
  view.innerHTML = `<section class="list">${html}</section>`;
  const sent = $('#sentinel');
  if (sent) {
    new IntersectionObserver((ents, ob) => {
      if (ents[0].isIntersecting) { ob.disconnect(); S.shown += PAGE; renderList(); }
    }).observe(sent);
  }
}

view.addEventListener('click', async (e) => {
  const tag = e.target.closest('.tag');
  if (tag) {
    e.preventDefault();
    const t = tag.dataset.tag;
    if (!S.filter.include.includes(t)) S.filter.include.push(t);
    S.shown = PAGE;
    if (location.hash !== '#/' && location.hash !== '') location.hash = '#/'; else render();
    return;
  }
  const more = e.target.closest('[data-more]');
  if (more) { memoMenu(more.dataset.more); return; }
  const go = e.target.closest('[data-goto]');
  if (go) { showMemo(go.dataset.goto); return; }
  const unf = e.target.closest('[data-unf]');
  if (unf) {
    const v = unf.dataset.unf;
    if (v === 'all') S.filter = { include: [], exclude: [], q: '', day: null };
    else if (v === 'q') { S.filter.q = ''; $('#q').value = ''; }
    else if (v === 'day') S.filter.day = null;
    else {
      const [kind, t] = [v.slice(0, 3), v.slice(4)];
      if (kind === 'inc') S.filter.include = S.filter.include.filter((x) => x !== t);
      else S.filter.exclude = S.filter.exclude.filter((x) => x !== t);
    }
    S.shown = PAGE;
    render();
  }
});

function memoMenu(id) {
  const m = byId(id);
  if (!m) return;
  const { root, close } = openSheet(`
    <div class="menu">
      <p class="menu-preview">${esc(m.content.slice(0, 80))}${m.content.length > 80 ? '…' : ''}</p>
      <button data-a="edit">고치기</button>
      <button data-a="quote">이어 꿰매기 <small>이 조각을 인용해 새로 쓰기</small></button>
      <button data-a="pin">${m.pinned ? '고정 풀기' : '맨 위에 고정'}</button>
      <button data-a="copy">본문 복사</button>
      <button data-a="del" class="danger">떼어 내기</button>
    </div>`);
  root.querySelector('.menu').addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    close();
    if (a === 'edit') startEdit(id);
    else if (a === 'quote') startQuote(id);
    else if (a === 'pin') togglePin(id);
    else if (a === 'copy') { try { await navigator.clipboard.writeText(m.content); toast('복사했어요'); } catch { toast('복사하지 못했어요'); } }
    else if (a === 'del') removeMemo(id);
  });
}

function showMemo(id) {
  const m = byId(id);
  if (!m) return;
  openSheet(`<div class="memo-solo">${memoCard(m, { inReview: true })}</div>`);
}

// ---------- 입력창 ----------
function growInput() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
  $('#send').disabled = !input.value.trim();
}

function currentTagToken() {
  const before = input.value.slice(0, input.selectionStart);
  const m = before.match(/#([^\s#]*)$/);
  return m ? m[1] : null;
}

function updateSuggest() {
  const box = $('#suggest');
  const tok = currentTagToken();
  if (tok == null) { box.hidden = true; return; }
  const cands = allTagPaths(S.memos).filter((t) => t.startsWith(tok) && t !== tok).slice(0, 8);
  if (!cands.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = cands.map((t) => `<button data-sug="${esc(t)}" style="--c:${tagColor(t, colors())}">#${esc(t)}</button>`).join('');
}

$('#suggest').addEventListener('mousedown', (e) => e.preventDefault()); // 입력창 포커스 유지
$('#suggest').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sug]');
  if (!b) return;
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos).replace(/#([^\s#]*)$/, `#${b.dataset.sug} `);
  input.value = before + input.value.slice(pos);
  input.setSelectionRange(before.length, before.length);
  input.focus();
  updateSuggest();
  growInput();
});

input.addEventListener('input', () => { growInput(); updateSuggest(); });
input.addEventListener('click', updateSuggest);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  if (e.key === 'Escape' && (S.editId || S.quoteId)) cancelCompose();
});
$('#send').addEventListener('click', submit);

function drawQuote() {
  const q = $('#quote');
  if (S.editId) {
    q.hidden = false;
    q.innerHTML = '<span>조각 고치는 중</span><button class="text-btn" id="q-cancel">그만두기</button>';
  } else if (S.quoteId) {
    const m = byId(S.quoteId);
    q.hidden = false;
    q.innerHTML = `<span>↳ ${esc(m?.content.slice(0, 50) ?? '')}${(m?.content.length ?? 0) > 50 ? '…' : ''}</span><button class="text-btn" id="q-cancel">빼기</button>`;
  } else { q.hidden = true; q.innerHTML = ''; }
  $('#q-cancel')?.addEventListener('click', cancelCompose);
  $('#send').textContent = S.editId ? '고치기' : '붙이기';
}

function cancelCompose() {
  if (S.editId) input.value = '';
  S.editId = null;
  S.quoteId = null;
  drawQuote();
  growInput();
}

function startEdit(id) {
  const m = byId(id);
  S.quoteId = null;
  S.editId = id;
  input.value = m.content;
  drawQuote();
  growInput();
  input.focus();
}

function startQuote(id) {
  S.editId = null;
  S.quoteId = id;
  drawQuote();
  if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
  setTimeout(() => input.focus(), 60);
}

async function submit() {
  const text = input.value.trim();
  if (!text) return;
  if (S.editId) {
    await updateMemo(S.editId, text);
    toast('고쳤어요');
  } else {
    await addMemo(text);
    haptic();
    if (S.quoteId) toast('이어 꿰맸어요');
  }
  input.value = '';
  S.editId = null;
  S.quoteId = null;
  drawQuote();
  growInput();
  $('#suggest').hidden = true;
  S.shown = PAGE;
  render();
  view.scrollTo?.(0, 0);
  window.scrollTo(0, 0);
}

// ---------- 오늘의 조각 ----------
async function renderToday() {
  const r = await ensureTodayReview();
  if (!r) {
    const n = live().filter((m) => dayKey(m.createdAt) < todayKey()).length;
    view.innerHTML = `<section class="today-wait">
      <h2>조각이 조금 더 모이면</h2>
      <p>어제까지 붙인 조각이 ${MIN_POOL}개가 되면, 다음 날 아침부터 지난 조각 세 장을 꺼내 드려요.</p>
      <div class="progress" aria-label="조각 ${n}/${MIN_POOL}">${Array.from({ length: MIN_POOL }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
      <p class="sub">지금 ${Math.min(n, MIN_POOL)} / ${MIN_POOL} · 오늘 쓴 조각은 내일부터 셉니다</p>
    </section>`;
    return;
  }
  if (!r.openedAt) {
    r.openedAt = Date.now();
    await db.put('reviews', r);
    track('review_open');
    updateDot();
  }
  const cards = r.items.map((it, i) => {
    const m = byId(it.id);
    if (!m || m.deletedAt) return '';
    return `<div class="rcard" style="--c:${memoColor(m, colors())}">
      <p class="why">${i + 1} / ${r.items.length} · ${esc(it.why)}</p>
      <div class="rcard-body">${renderBody(m.content, colors())}</div>
      <p class="rdate">${esc(prettyDay(dayKey(m.createdAt)))} ${timeOf(m.createdAt)}</p>
      <div class="ractions">
        <button class="btn btn-main" data-quote="${m.id}">이어 꿰매기</button>
        ${i < r.items.length - 1 ? '<button class="btn" data-next>다음 장</button>' : ''}
      </div>
    </div>`;
  }).join('');
  const ask = isApp && S.settings.notify == null
    ? `<div class="ask"><p>매일 아침 <b>${S.settings.reviewTime}</b>에 세 장이 꺼내졌다고 알려 드릴까요?</p>
        <div class="ask-row"><button class="btn btn-main" id="ask-yes">알림 받기</button><button class="btn" id="ask-no">괜찮아요</button></div></div>`
    : '';
  view.innerHTML = `<section class="today">${ask}
    <h2 class="today-title">오늘의 조각 <small>${new Date().getMonth() + 1}월 ${new Date().getDate()}일</small></h2>
    <div class="rail" id="rail">${cards}</div>
    <p class="today-foot">내일 아침 새 세 장이 꺼내집니다. 다시 읽고 떠오른 것이 있으면 이어 꿰매 보세요.</p>
  </section>`;
  $('#ask-yes')?.addEventListener('click', async () => {
    const ok = await scheduleReview(S.settings.reviewTime);
    S.settings.notify = ok;
    await saveSettings();
    toast(ok ? `매일 ${S.settings.reviewTime}에 알려 드릴게요` : '알림 권한이 없어 켜지 못했어요. 설정에서 다시 켤 수 있어요');
    $('.ask')?.remove();
  });
  $('#ask-no')?.addEventListener('click', async () => { S.settings.notify = false; await saveSettings(); $('.ask')?.remove(); });
  const rail = $('#rail');
  rail.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quote]');
    if (q) { startQuote(q.dataset.quote); return; }
    if (e.target.closest('[data-next]')) rail.scrollBy({ left: rail.clientWidth, behavior: 'smooth' });
  });
}

// ---------- 조각보 달력 ----------
function renderBo() {
  const now = new Date();
  if (!S.bo) S.bo = { y: now.getFullYear(), m: now.getMonth() };
  const { y, m } = S.bo;
  const patches = dayPatches(S.memos, colors());
  const cells = monthCells(y, m);
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
  const monthMemos = live().filter((x) => dayKey(x.createdAt).startsWith(prefix));
  const daysWritten = new Set(monthMemos.map((x) => dayKey(x.createdAt))).size;
  const tagCount = new Map();
  monthMemos.forEach((x) => [...new Set(x.tags.map(topTag))].forEach((t) => tagCount.set(t, (tagCount.get(t) ?? 0) + 1)));
  const topT = [...tagCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const today = todayKey();
  const isFuture = (k) => k > today;

  view.innerHTML = `<section class="bo">
    <div class="bo-head">
      <button class="icon-btn" id="bo-prev" aria-label="이전 달">‹</button>
      <h2>${y}년 ${m + 1}월의 조각보</h2>
      <button class="icon-btn" id="bo-next" aria-label="다음 달" ${y === now.getFullYear() && m === now.getMonth() ? 'disabled' : ''}>›</button>
    </div>
    <div class="bo-week">${'일월화수목금토'.split('').map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="bo-grid">
      ${cells.map((k) => (k
        ? `<button class="patch${k === today ? ' today' : ''}${isFuture(k) ? ' future' : ''}${patches.get(k) ? ' filled' : ''}" data-day="${k}" style="${patchStyle(patches.get(k))}" ${isFuture(k) ? 'disabled' : ''} aria-label="${k} 조각 ${patches.get(k)?.count ?? 0}개"><span>${Number(k.slice(8))}</span></button>`
        : '<span class="patch blank"></span>')).join('')}
    </div>
    <dl class="bo-stats">
      <div><dt>이달의 조각</dt><dd>${monthMemos.length}</dd></div>
      <div><dt>쓴 날</dt><dd>${daysWritten}</dd></div>
      <div><dt>가장 많이</dt><dd class="small">${topT ? `<span style="color:${tagColor(topT, colors())}">#${esc(topT)}</span>` : '—'}</dd></div>
    </dl>
    <button class="btn btn-main btn-wide" id="bo-save" ${monthMemos.length ? '' : 'disabled'}>이달의 조각보 이미지로 간직하기</button>
    <p class="bo-note">색은 그날 붙인 태그의 천 색이고, 많이 쓴 날일수록 진해집니다. 두 가지 태그가 섞인 날은 대각선으로 이어 붙여요. 칸을 누르면 그날 조각을 봅니다.</p>
  </section>`;
  $('#bo-prev').onclick = () => { S.bo = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }; renderBo(); };
  $('#bo-next').onclick = () => { S.bo = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }; renderBo(); };
  view.querySelector('.bo-grid').addEventListener('click', (e) => {
    const p = e.target.closest('[data-day]');
    if (!p || !patches.get(p.dataset.day)) return;
    S.filter = { include: [], exclude: [], q: '', day: p.dataset.day };
    S.shown = PAGE;
    location.hash = '#/';
  });
  $('#bo-save').onclick = async () => {
    const blob = await monthImage(y, m, patches, { total: monthMemos.length, topTagName: topT });
    if (isApp) { shareFile(blob, `jogakbo-${prefix}.png`, `${m + 1}월의 조각보`); return; }
    const file = new File([blob], `jogakbo-${prefix}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: `${m + 1}월의 조각보` }); return; } catch (err) { if (err?.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('이미지를 저장했어요');
  };
}

// ---------- 태그 실타래 ----------
function showTags() {
  const draw = () => {
    const tree = tagTree(S.memos);
    const state = (p) => (S.filter.include.includes(p) ? 'inc' : S.filter.exclude.includes(p) ? 'exc' : '');
    const row = (n, depth) => `<li>
        <div class="trow ${state(n.path)}" style="--d:${depth}">
          ${depth === 0 ? `<button class="swatch" data-color="${esc(n.path)}" style="background:${tagColor(n.path, colors())}" aria-label="천 색 바꾸기"></button>` : '<span class="thread" aria-hidden="true"></span>'}
          <button class="tname" data-cycle="${esc(n.path)}">#${esc(n.name)}</button>
          <span class="tcount">${n.count}</span>
          <span class="tstate">${state(n.path) === 'inc' ? '골라 봄' : state(n.path) === 'exc' ? '빼고 봄' : ''}</span>
        </div>
        ${n.children.length ? `<ul>${n.children.map((c) => row(c, depth + 1)).join('')}</ul>` : ''}
      </li>`;
    return tree.length
      ? `<h2 class="sheet-title">태그 실타래</h2>
         <p class="sheet-sub">누를 때마다 <b>골라 봄 → 빼고 봄 → 해제</b>. 여러 개를 고르면 모두 붙은 조각만 보여요. 왼쪽 천을 누르면 색이 바뀝니다.</p>
         <ul class="ttree">${tree.map((n) => row(n, 0)).join('')}</ul>
         <button class="btn btn-main btn-wide" data-close>조각 보기</button>`
      : '<h2 class="sheet-title">아직 태그가 없어요</h2><p class="sheet-sub">조각에 <b>#태그</b>를 붙이면 여기 실타래처럼 모입니다. <b>#일/회의</b>처럼 / 로 하위 태그도 만들 수 있어요.</p>';
  };
  const { root } = openSheet(`<div id="tags-body">${draw()}</div>`, { onClose: () => { S.shown = PAGE; if (location.hash !== '#/' && location.hash !== '') location.hash = '#/'; else render(); } });
  // 시트 안쪽에만 건다 (#sheet-root는 계속 남는 요소라 여기에 걸면 열 때마다 쌓인다)
  root.querySelector('.sheet').addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cycle]');
    const sw = e.target.closest('[data-color]');
    if (c) {
      const p = c.dataset.cycle;
      if (S.filter.include.includes(p)) { S.filter.include = S.filter.include.filter((x) => x !== p); S.filter.exclude.push(p); }
      else if (S.filter.exclude.includes(p)) S.filter.exclude = S.filter.exclude.filter((x) => x !== p);
      else S.filter.include.push(p);
    } else if (sw) {
      const top = sw.dataset.color;
      const cur = PALETTE.findIndex((x) => x.hex === tagColor(top, colors()));
      S.settings.colors[top] = PALETTE[(cur + 1) % PALETTE.length].key;
      await saveSettings();
    } else return;
    $('#tags-body').innerHTML = draw();
  });
}

// ---------- 검색 ----------
$('#btn-search').addEventListener('click', () => {
  const bar = $('#searchbar');
  bar.hidden = false;
  if (location.hash !== '#/' && location.hash !== '') location.hash = '#/';
  setTimeout(() => $('#q').focus(), 30);
});
let qTimer;
$('#q').addEventListener('input', () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { S.filter.q = $('#q').value.trim(); S.shown = PAGE; render(); }, 180);
});
$('#q-close').addEventListener('click', () => { $('#searchbar').hidden = true; $('#q').value = ''; S.filter.q = ''; render(); });
$('#btn-tags').addEventListener('click', showTags);

// ---------- 설정 ----------
function download(name, text, type) {
  if (isApp) { shareFile(new Blob([text], { type }), name, '조각보 내보내기'); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function exportJson() {
  const data = { app: 'jogakbo', version: 1, exportedAt: new Date().toISOString(), memos: S.memos.filter((m) => !m.deletedAt), reviews: S.reviews, settings: S.settings };
  download(`jogakbo-${todayKey()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

function exportMd() {
  const list = live().sort((a, b) => a.createdAt - b.createdAt);
  let md = `# 조각보 내보내기 (${todayKey()})\n\n`;
  let last = null;
  for (const m of list) {
    const k = dayKey(m.createdAt);
    if (k !== last) { md += `\n## ${k}\n\n`; last = k; }
    md += `### ${timeOf(m.createdAt)}\n\n${m.content}\n\n`;
  }
  download(`jogakbo-${todayKey()}.md`, md, 'text/markdown');
}

async function importJson(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'jogakbo' || !Array.isArray(data.memos)) throw new Error('형식');
    const added = [];
    for (const m of data.memos) {
      if (!m.id || typeof m.content !== 'string' || !m.createdAt) continue;
      if (byId(m.id)) continue;
      const clean = { id: m.id, content: m.content, tags: parseTags(m.content), createdAt: m.createdAt, updatedAt: m.updatedAt ?? m.createdAt, deletedAt: null, pinned: !!m.pinned, refs: Array.isArray(m.refs) ? m.refs : [], source: m.source ?? 'import' };
      S.memos.push(clean);
      added.push(clean);
    }
    if (added.length) await db.putMany('memos', added);
    toast(`조각 ${added.length}개를 가져왔어요`);
    render();
  } catch { toast('조각보 내보내기 파일이 아니에요'); }
}

function showSettings() {
  const tags = allTagPaths(S.memos).filter((t) => !t.includes('/'));
  const ruleSel = (r, i) => `<label class="rule">${i + 1}번째 장
      <select data-rule="${i}">
        <option value="random" ${r.type === 'random' ? 'selected' : ''}>무작위</option>
        <option value="ago" ${r.type === 'ago' ? 'selected' : ''}>1년 전·한 달 전 오늘</option>
        ${tags.map((t) => `<option value="tag:${esc(t)}" ${r.type === 'tag' && r.tag === t ? 'selected' : ''}>#${esc(t)}에서</option>`).join('')}
      </select></label>`;
  const trash = S.memos.filter((m) => m.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  const { root } = openSheet(`
    <h2 class="sheet-title">설정</h2>
    <h3 class="set-h">오늘의 조각 고르는 법</h3>
    <div class="rules">${S.settings.rules.map(ruleSel).join('')}</div>
    <p class="sheet-sub">바꾼 규칙은 내일 아침부터 적용돼요. 최근 7일 안에 본 조각은 다시 꺼내지 않습니다.</p>
    ${isApp ? `<h3 class="set-h">아침 알림</h3>
    <label class="rule">알림 시각
      <select id="notify-time">
        <option value="">받지 않음</option>
        ${['06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '12:00', '21:00', '22:00'].map((t) => `<option value="${t}" ${S.settings.notify && S.settings.reviewTime === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>` : ''}
    <h3 class="set-h">내 조각 꺼내 가기</h3>
    <div class="set-row"><button class="btn" id="ex-md">글(Markdown)</button><button class="btn" id="ex-json">백업 파일(JSON)</button></div>
    <label class="btn btn-file">백업 파일 가져오기<input type="file" id="im-json" accept="application/json,.json" hidden></label>
    <p class="sheet-sub">조각은 이 기기 안에만 저장됩니다. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업 파일을 받아 두세요.</p>
    <h3 class="set-h">떼어 낸 조각 <small>${TRASH_DAYS}일 뒤 완전히 지워져요</small></h3>
    ${trash.length ? `<ul class="trash">${trash.slice(0, 30).map((m) => `<li><span>${esc(m.content.slice(0, 40))}</span><button class="text-btn" data-restore="${m.id}">되살리기</button></li>`).join('')}</ul>` : '<p class="sheet-sub">없음</p>'}
    <p class="fine"><a href="privacy.html">개인정보처리방침</a> · 버전 ${esc(window.APP_VERSION ?? 'web')}</p>`);
  root.querySelectorAll('[data-rule]').forEach((sel) => sel.addEventListener('change', async () => {
    const i = Number(sel.dataset.rule);
    const v = sel.value;
    S.settings.rules[i] = v.startsWith('tag:') ? { type: 'tag', tag: v.slice(4) } : { type: v };
    await saveSettings();
    toast('내일부터 적용돼요');
  }));
  root.querySelector('#notify-time')?.addEventListener('change', async (e) => {
    const t = e.target.value;
    if (t) S.settings.reviewTime = t;
    const ok = await scheduleReview(t || null);
    S.settings.notify = t ? ok : false;
    await saveSettings();
    toast(!t ? '아침 알림을 껐어요' : ok ? `매일 ${t}에 알려 드릴게요` : '알림 권한이 필요해요 (휴대폰 설정 → 앱 → 조각보 → 알림)');
  });
  root.querySelector('#ex-md').onclick = exportMd;
  root.querySelector('#ex-json').onclick = exportJson;
  root.querySelector('#im-json').onchange = (e) => e.target.files[0] && importJson(e.target.files[0]);
  root.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    const m = byId(b.dataset.restore);
    m.deletedAt = null;
    await db.put('memos', m);
    b.closest('li').remove();
    toast('되살렸어요');
    render();
  }));
}
$('#btn-settings').addEventListener('click', showSettings);

// ---------- 라우터 ----------
function currentTab() {
  const h = location.hash || '#/';
  if (h.startsWith('#/today')) return 'today';
  if (h.startsWith('#/bo')) return 'bo';
  return 'list';
}

function render() {
  const tab = currentTab();
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  if (tab === 'today') renderToday();
  else if (tab === 'bo') renderBo();
  else renderList();
  updateDot();
}

window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });

// ---------- 시작 ----------
async function init() {
  const [memos, reviews, settings] = await Promise.all([db.getAll('memos'), db.getAll('reviews'), db.get('kv', 'settings')]);
  S.memos = memos;
  S.reviews = reviews;
  if (settings) S.settings = { ...S.settings, ...settings, colors: settings.colors ?? {} };
  // 떼어 낸 지 30일 지난 조각은 완전히 지운다
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  for (const m of S.memos.filter((x) => x.deletedAt && x.deletedAt < cutoff)) await db.del('memos', m.id);
  S.memos = S.memos.filter((x) => !(x.deletedAt && x.deletedAt < cutoff));
  await ensureTodayReview();
  initNative({
    onBack: () => {
      if (closeSheet) { closeSheet(); return true; }
      if (S.editId || S.quoteId) { cancelCompose(); return true; }
      if (!$('#searchbar').hidden) { $('#q-close').click(); return true; }
      if (currentTab() !== 'list') { location.hash = '#/'; return true; }
      if (filterActive()) { S.filter = { include: [], exclude: [], q: '', day: null }; render(); return true; }
      return false;
    },
    onOpenHash: (h) => { location.hash = h; },
  });
  if (S.settings.notify) scheduleReview(S.settings.reviewTime);
  render();
  track('visit');
  db.askPersist();
}
init();
