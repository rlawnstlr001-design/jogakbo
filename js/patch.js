// 조각보 달력 — 하루가 천 조각 하나. 그날 쓴 태그 색으로 물들고, 쓴 만큼 진해진다.
// 두 가지 태그가 섞인 날은 대각선으로 두 천을 이어 붙인다.
import { dayKey, topTag, tagColor, PLAIN } from './memo.js?v=202610041032';

export const BASE = '#EAE3D4'; // 비어 있는 날 = 무명

// 'YYYY-MM-DD' → { count, colors: [주색, 보조색?] }
export function dayPatches(memos, overrides) {
  const map = new Map();
  for (const m of memos) {
    if (m.deletedAt) continue;
    const k = dayKey(m.createdAt);
    const e = map.get(k) ?? { count: 0, tags: new Map() };
    e.count += 1;
    const tops = m.tags.length ? [...new Set(m.tags.map(topTag))] : ['__plain'];
    for (const t of tops) e.tags.set(t, (e.tags.get(t) ?? 0) + 1);
    map.set(k, e);
  }
  const out = new Map();
  for (const [k, e] of map) {
    const ranked = [...e.tags.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => (t === '__plain' ? PLAIN : tagColor(t, overrides)));
    out.set(k, { count: e.count, colors: [...new Set(ranked)].slice(0, 2) });
  }
  return out;
}

// 쓴 양 → 진하기 (무명과 섞는 비율)
export const strength = (n) => (n >= 4 ? 1 : n >= 2 ? 0.86 : 0.7);

function mix(hex, amt) {
  const a = parseInt(hex.slice(1), 16);
  const b = parseInt(BASE.slice(1), 16);
  const ch = (sh) => Math.round(((a >> sh) & 255) * amt + ((b >> sh) & 255) * (1 - amt));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

export function patchStyle(p) {
  if (!p) return `background:${BASE}`;
  const s = strength(p.count);
  const c1 = mix(p.colors[0], s);
  if (p.colors.length < 2) return `background:${c1}`;
  const c2 = mix(p.colors[1], s);
  return `background:linear-gradient(135deg, ${c1} 0 50%, ${c2} 50% 100%)`;
}

// 한 달 칸 배열: 앞쪽 빈칸(요일 맞춤) + 날짜들
export function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: first.getDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(dayKey(new Date(year, month, d).getTime()));
  return cells;
}

// 이달의 조각보를 이미지로 (공유·저장용). 사진·본문은 넣지 않는다 — 색과 숫자만.
export async function monthImage(year, month, patches, { total, topTagName }) {
  const W = 1080, H = 1350, pad = 90;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#F3EFE6'; g.fillRect(0, 0, W, H);
  const serif = '"Gowun Batang", "Nanum Myeongjo", "AppleMyungjo", "Batang", serif';
  g.fillStyle = '#2A2724';
  g.font = `700 64px ${serif}`;
  g.fillText(`${month + 1}월의 조각보`, pad, 170);
  g.font = `400 34px ${serif}`;
  g.fillStyle = '#6E665B';
  g.fillText(`${year}년 · 조각 ${total}개${topTagName ? ` · 가장 많이 #${topTagName}` : ''}`, pad, 230);

  const cells = monthCells(year, month);
  const cols = 7;
  const rows = Math.ceil(cells.length / cols);
  const size = Math.floor((W - pad * 2) / cols);
  const top = Math.max(300, Math.round((H - rows * size) / 2) + 40); // 4:5 화면 가운데쯤
  const fillFor = (key) => {
    const p = patches.get(key);
    if (!p) return [BASE];
    const s = strength(p.count);
    return p.colors.map((c) => mix(c, s));
  };
  cells.forEach((key, i) => {
    if (!key) return;
    const x = pad + (i % cols) * size;
    const y = top + Math.floor(i / cols) * size;
    const [c1, c2] = fillFor(key);
    g.fillStyle = c1; g.fillRect(x, y, size, size);
    if (c2) {
      g.fillStyle = c2;
      g.beginPath(); g.moveTo(x + size, y); g.lineTo(x + size, y + size); g.lineTo(x, y + size); g.closePath(); g.fill();
    }
    // 바느질 땀
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3; g.setLineDash([10, 8]);
    g.strokeRect(x + 7, y + 7, size - 14, size - 14);
    g.setLineDash([]);
    g.strokeStyle = '#F3EFE6'; g.lineWidth = 4; g.strokeRect(x, y, size, size);
    g.fillStyle = 'rgba(42,39,36,.55)'; g.font = `400 24px ${serif}`;
    g.fillText(String(Number(key.slice(8))), x + 16, y + 38);
  });
  g.fillStyle = '#2A2724'; g.font = `700 36px ${serif}`;
  g.fillText('조각보', pad, H - 90);
  g.fillStyle = '#6E665B'; g.font = `400 28px ${serif}`;
  g.fillText('하루 한 조각, 매일 아침 세 장', pad + 140, H - 90);
  return new Promise((res) => cv.toBlob(res, 'image/png'));
}
