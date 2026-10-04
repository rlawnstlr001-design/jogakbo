// 조각(메모) 다루기 — 태그 뽑기, 날짜, 필터, 태그 색
export const PALETTE = [
  { key: 'jjok', name: '쪽', hex: '#2F5D7C' },
  { key: 'hong', name: '홍', hex: '#B34A3C' },
  { key: 'chija', name: '치자', hex: '#E2A93B' },
  { key: 'ok', name: '옥', hex: '#7FA99B' },
  { key: 'songhwa', name: '송화', hex: '#C9B75E' },
  { key: 'ja', name: '자주', hex: '#7C4A6B' },
  { key: 'gal', name: '갈', hex: '#9A6A44' },
];
export const PLAIN = '#9C8F78'; // 태그 없는 조각 = 무명

// '#일/회의' 처럼 # 다음 공백 전까지. 끝의 문장부호는 뗀다.
const TAG_RE = /#([^\s#]+)/g;
export function parseTags(text) {
  const out = new Set();
  for (const m of text.matchAll(TAG_RE)) {
    const t = m[1].replace(/[.,!?)\]}'"”’…·]+$/u, '').replace(/^\/+|\/+$/g, '');
    if (t) out.add(t);
  }
  return [...out];
}

export const topTag = (path) => path.split('/')[0];

// 태그 색은 최상위 태그 이름으로 정해진다 (같은 태그는 언제나 같은 천)
export function tagColor(path, overrides = {}) {
  const top = topTag(path);
  if (overrides[top]) return PALETTE.find((p) => p.key === overrides[top])?.hex ?? PLAIN;
  let h = 0;
  for (const ch of top) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length].hex;
}

export function memoColor(memo, overrides) {
  return memo.tags.length ? tagColor(memo.tags[0], overrides) : PLAIN;
}

// ---- 날짜 (기기 현지 시간) ----
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const todayKey = () => dayKey(Date.now());

export function prettyDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = todayKey();
  const yest = dayKey(Date.now() - 86400000);
  const wd = '일월화수목금토'[dt.getDay()];
  if (key === today) return `오늘 · ${m}월 ${d}일 ${wd}`;
  if (key === yest) return `어제 · ${m}월 ${d}일 ${wd}`;
  const thisYear = new Date().getFullYear() === y;
  return `${thisYear ? '' : `${y}년 `}${m}월 ${d}일 ${wd}`;
}

export function timeOf(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- 필터: 포함 태그는 모두(AND), 제외 태그는 하나도(NOT), 검색어는 본문 포함 ----
function hasTag(memo, path) {
  return memo.tags.some((t) => t === path || t.startsWith(path + '/'));
}
export function matches(memo, { include = [], exclude = [], q = '' }) {
  if (memo.deletedAt) return false;
  if (include.some((t) => !hasTag(memo, t))) return false;
  if (exclude.some((t) => hasTag(memo, t))) return false;
  if (q && !memo.content.toLowerCase().includes(q.toLowerCase())) return false;
  return true;
}

// 태그 트리: { name, path, count, children[] } — 하위 태그 개수는 부모에도 더한다
export function tagTree(memos) {
  const counts = new Map();
  for (const m of memos) {
    if (m.deletedAt) continue;
    const seen = new Set();
    for (const t of m.tags) {
      const parts = t.split('/');
      for (let i = 1; i <= parts.length; i++) seen.add(parts.slice(0, i).join('/'));
    }
    for (const p of seen) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  const root = { children: [] };
  for (const path of [...counts.keys()].sort((a, b) => a.localeCompare(b, 'ko'))) {
    const parts = path.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts.slice(0, i + 1).join('/');
      let child = node.children.find((c) => c.path === p);
      if (!child) { child = { name: parts[i], path: p, count: counts.get(p) ?? 0, children: [] }; node.children.push(child); }
      node = child;
    }
  }
  return root.children;
}

export const allTagPaths = (memos) => [...new Set(memos.filter((m) => !m.deletedAt).flatMap((m) => m.tags))].sort((a, b) => a.localeCompare(b, 'ko'));

export const newId = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { esc };

// 본문 HTML: 태그는 천 조각 라벨로, 링크는 누를 수 있게, 줄바꿈 유지
// 링크 안의 '#'이 태그로 바뀌지 않게, 링크와 나머지 글을 나눠서 처리한다
export function renderBody(text, overrides) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  const html = parts.map((part, i) => {
    if (i % 2 === 1) return `<a href="${esc(part)}" target="_blank" rel="noopener">${esc(part)}</a>`;
    return esc(part).replace(/#([^\s#&<]+)/g, (m, t) => {
      const clean = t.replace(/[.,!?)\]}'"”’…·]+$/u, '');
      if (!clean) return m;
      const rest = t.slice(clean.length);
      return `<button class="tag" data-tag="${clean}" style="--c:${tagColor(clean, overrides)}">#${clean}</button>${rest}`;
    });
  }).join('');
  return html.replace(/\n/g, '<br>');
}
