/* 临时验证脚本：镜像 timeline.js 的圆点串珠防撞算法(统一 10px 层级)，断言轴上所有点两两不撞。只输出数字。 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/data.js', import.meta.url), 'utf8');
const sandboxWindow = {};
new Function('window', src)(sandboxWindow);
const D = sandboxWindow.DATA;

const PXY = 46;
const X0_YEAR = 1949 - 1.5;
const docX = y => (y - X0_YEAR) * PXY;
const eventYear = ev => ev.year + ((ev.month || 6) - 0.5) / 12;
const visible = (ev, m) => {
  if (m === 'compare') return !(ev.src === 'curated' && ev.hongMatched);
  if (m === 'hong') {
    if (ev.src === 'curated' && ev.hongMatched) return false;
    return ev.src === 'hong' || ev.src === 'curated';
  }
  return ev.src === 'zhu' || ev.src === 'curated';
};
const MIN = 6.9, MAJMIN = 7.9, MAJMAJ = 9.9;   // 最小间距断言阈值(r3+r3 / r5+r3 / r5+r5)

for (const mode of ['zhu', 'hong', 'compare']) {
  const hongTrack = mode !== 'zhu';
  const hongAnchor = mode === 'compare';
  const evs = D.events.filter(e => visible(e, mode));
  let majors = evs.filter(e => e.priority === 1)
    .sort((a, b) => a.year - b.year || (a.month || 6) - (b.month || 6));
  if (hongAnchor) majors = majors.filter(e => e.src !== 'hong');
  const minors = evs.filter(e => e.priority !== 1)
    .sort((a, b) => a.year - b.year || (a.month || 6) - (b.month || 6));

  const dotEvs = minors.filter(ev => !(hongTrack && ev.src === 'hong'));

  // 串珠列:里程碑先入列(互让 10px),次要点入列门槛 8.5px,列内 10px/级
  const cols = [];
  for (const m of majors) {
    const X = docX(eventYear(m));
    let col = cols.find(c => Math.abs(c.x - X) < 10);
    if (!col) { col = { x: X, n: 0, maj: true }; cols.push(col); }
    m._dotX = col.x; m._dotRow = col.n++;
  }
  for (const ev of dotEvs) {
    const X = docX(eventYear(ev));
    let col = cols.find(c => Math.abs(c.x - X) < 8.5);
    if (!col) { col = { x: X, n: 0 }; cols.push(col); }
    ev._dotX = col.x; ev._dotRow = col.n++;
  }
  for (const c of cols) c.rows = c.n;

  const dots = [
    ...majors.map(m => ({ x: m._dotX, y: -(m._dotRow || 0) * 10, r: 5, kind: 'maj' })),
    ...dotEvs.map(e => ({ x: e._dotX, y: -(e._dotRow || 0) * 10, r: 3, kind: 'min' })),
  ];
  let worst = Infinity, worstPair = '', badMinor = 0, badMajMin = 0, badMajMaj = 0;
  for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
    const a = dots[i], b = dots[j];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d < worst) { worst = d; worstPair = `${a.kind}(${a.x.toFixed(1)},${a.y})-${b.kind}(${b.x.toFixed(1)},${b.y})`; }
    if (a.kind === 'min' && b.kind === 'min' && d < MIN) badMinor++;
    if (a.kind !== b.kind && d < MAJMIN) badMajMin++;
    if (a.kind === 'maj' && b.kind === 'maj' && d < MAJMAJ) badMajMaj++;
  }
  const maxRows = Math.max(0, ...cols.map(c => c.n));
  const trackBars = minors.length - dotEvs.length;
  console.log(`[${mode}] 轴上点 ${dots.length}(${majors.length}大+${dotEvs.length}次) | 密度轨 ${trackBars} 条`);
  console.log(`  串珠列 ${cols.length} 列, 最高 ${maxRows} 珠(=${(maxRows - 1) * 10}px) | 最近点对 ${worst.toFixed(2)}px [${worstPair}]`);
  console.log(`  违规: 次要-次要<${MIN} ${badMinor} | 大-次<${MAJMIN} ${badMajMin} | 大-大<${MAJMAJ} ${badMajMaj}`);
}
