// 오늘의 조각 3장 — 하루에 한 번 정해지고, 그날은 바뀌지 않는다.
// 규칙(최대 3개): random(무작위) / ago(1년 전·한 달 전 오늘) / tag(특정 태그에서)
// 최근 7일 안에 이미 보여 준 조각은 다시 꺼내지 않는다.
import { dayKey } from './memo.js?v=202610041102';

export const DEFAULT_RULES = [{ type: 'random' }, { type: 'ago' }, { type: 'random' }];
export const MIN_POOL = 5; // 이만큼 쌓여야 회고가 의미 있다

function seeded(seedStr) {
  let h = 2166136261;
  for (const ch of seedStr) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
}

function shiftDay(key, { years = 0, months = 0 }) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y + years, m - 1 + months, d).getTime());
}

// memos: 지워지지 않은 전체 조각, reviews: 지난 회고 기록 배열
export function buildReview(today, memos, reviews, rules = DEFAULT_RULES) {
  const recent = new Set();
  for (const r of reviews) {
    const diff = (Date.parse(today) - Date.parse(r.date)) / 86400000;
    if (diff > 0 && diff <= 7) r.items.forEach((it) => recent.add(it.id));
  }
  // 오늘 쓴 조각은 회고 대상이 아니다
  const pool = memos.filter((m) => !m.deletedAt && dayKey(m.createdAt) < today && !recent.has(m.id));
  const rand = seeded(today);
  const used = new Set();
  const pick = (cands) => {
    const left = cands.filter((m) => !used.has(m.id));
    if (!left.length) return null;
    const m = left[Math.floor(rand() * left.length)];
    used.add(m.id);
    return m;
  };

  const items = [];
  for (const rule of rules.slice(0, 3)) {
    let m = null;
    let why = '무작위로 꺼낸 조각';
    if (rule.type === 'ago') {
      for (const [shift, label] of [[{ years: -1 }, '1년 전 오늘'], [{ years: -2 }, '2년 전 오늘'], [{ months: -1 }, '한 달 전 오늘'], [{ months: -3 }, '석 달 전 오늘']]) {
        const k = shiftDay(today, shift);
        m = pick(pool.filter((x) => dayKey(x.createdAt) === k));
        if (m) { why = label; break; }
      }
    } else if (rule.type === 'tag' && rule.tag) {
      m = pick(pool.filter((x) => x.tags.some((t) => t === rule.tag || t.startsWith(rule.tag + '/'))));
      if (m) why = `#${rule.tag}에서 꺼낸 조각`;
    }
    if (!m) { m = pick(pool); why = '무작위로 꺼낸 조각'; }
    if (m) items.push({ id: m.id, why });
  }
  return { date: today, items, openedAt: null, continued: 0 };
}
