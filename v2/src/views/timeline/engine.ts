/* ============================================================
   engine.ts — 时间轴视图：数字长卷（v4 固定文档模型）
   ------------------------------------------------------------
   逐字移植自旧版 js/timeline.js（941 行，v2-framework 阶段 4）。
   长卷 = 一张固定宽度的"超宽网页"（文档坐标）：
   · 所有卡片/标签/印章/流派带的位置与尺寸一经排定即不变；
   · 左右拖动平移浏览（像拖动宽网页）；
   · 滚轮缩放 = 对屏幕的放大镜（整体等比缩放，锚定光标）；
   · 放大越过 focusZoom 后，视口中心的事件自动聚焦：
     事件卡套上聚焦环，抽屉同步展开其详情。
   颜色语义：点/卡左边条=类型色；底纹与群体带=时期色。

   v2 移植适配点（均为最小必要，其余逐字）：
   1. IIFE → ESM 模块作用域；d3 改为 `import * as d3 from 'd3'`；
   2. `#tl-svg` 的获取从模块求值期推迟到 init()——懒加载 chunk 求值时
      React 骨架尚未入 DOM，模块期 getElementById 会拿到 null；
   3. 抽屉自动收起（updateFocus）：v2 抽屉由 shell(Drawer.tsx) 以 React
      store 驱动，未开时 #drawer 不在 DOM、`drawer-title` 是 class 非 id——
      加空值防护，标题改取 .drawer-title，收起优先走 shell 的
      window.closeDrawer()（globals.ts 提供），无可用时回退旧版去 class；
   4. window.* 全局 API（openDrawerEvent / openWikiPage /
      prefersReducedMotion / APP_STATE.source / __curtainOpening / TL）
      保持同名引用（外壳 globals.ts / Curtain.tsx 已提供），TS 侧经
      (window as any) 访问；
   5. 对外接口：不再自注册 window.Views.timeline（Island 契约由包装层
      index.tsx 单路驱动 init/onShow/onSourceChange，避免 setSource 的
      Views 循环与 React 订阅双触发 onSourceChange 重复重建长卷）；
      window.TL 照旧挂在 window 上供键盘层（shell/keyboard.ts）调用；
   6. 动效新增（计划书 §五·时间轴）：
      a. 卡片光标邻近墨染高亮——rAF 节流 pointermove，只加/去 .ink-near
         class（色板响应在 timeline.css，只动 color/fill/stroke）；
      b. 聚焦虚线环呼吸 + 旋转——纯 CSS 动画加在原 .focus-ring 元素上
         （timeline.css），引擎零改动；
      c. animateTo 缓动升级——由二次/三次幂缓动换为指数收敛（临界阻尼
         弹簧式的物理滑移），函数签名与 ms 时长语义不变。
   固定文档模型一字未动：卡片静态排定，render() 每帧只写一个 transform。
   ============================================================ */
import * as d3 from 'd3'

const CFG: any = (window as any).APP_CONFIG
const D: any = (window as any).DATA
const YMIN = CFG.YEAR_MIN, YMAX = CFG.YEAR_MAX
const L = CFG.layout || {}
const PXY = L.pxy || 46
const FOCUS_Z = L.focusZoom || 1.7
const MAX_Z = L.maxZoom || 4

/* v2 适配点 2：svg 推迟到 init() 解析（懒加载 chunk 求值早于骨架入 DOM） */
let svg: HTMLElement | null = null
let W = 0, H = 0, axisY = 0
let zoneMajor: any, zoneMinor: any, zoneSeal: any, zoneBand: any

/* ---------- 文档坐标 ---------- */
const X0_YEAR = YMIN - 1.5;                            // 1947.5
const PAD_Y = L.yearPad || 0;                          // 右端预留空白年数(长卷向未来延伸)
const DOC_END = YMAX + PAD_Y;                          // 文档右端年份
const stripW = (DOC_END - X0_YEAR) * PXY;              // 长卷总宽
const docX = (y: number): number => (y - X0_YEAR) * PXY
const eventYear = (ev: any): number => ev.year + ((ev.month || 6) - 0.5) / 12

const state = { pan: 0, panY: 0, zoom: 1 };             // 屏幕X = (docX - pan) * zoom
const docH = () => axisY + 70;                          // 文档总高（含刻度标注）
const minZoom = () => Math.max(0.12, W / stripW);
const maxPan = () => Math.max(0, stripW - W / state.zoom);
const maxPanY = () => Math.max(0, docH() - H / state.zoom);
const clampPan = (p: number) => Math.max(0, Math.min(maxPan(), p));
const clampPanY = (p: number) => Math.max(0, Math.min(maxPanY(), p));

/* ================= 数据准备(来源相关部分可重算) ================= */
const impSet = new Set(D.important || []);
const impRank = new Map<string, number>((D.important || []).map((n: string, i: number) => [n, i] as [string, number]));
const periodColor = (year: number) =>
  (CFG.periods.find((p: any) => year >= p.from && year < p.to) || CFG.periods[0]).color;
const kindColor = (kind: string) => (CFG.types[kind] || CFG.types.event).color;
const trunc = (s: string, n: number) => [...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s;

const CARD_H = 38, CARD_GAP = 12, CARD_CHARS = 16;
const cardW = (t: string) => [...t].length * 14 + 26;
const MINOR_CHARS = 14;
const MINOR_LANES = 5;   // 次要标签道数(layout 的 zoneMinor 与 prepareData 共用)

const filterState: Record<string, boolean> = { event: true, policy: true, work: true, person: true, band: true };
const kindOK = (d: any) => d.kind === 'event' ? filterState.event : d.kind === 'policy' ? filterState.policy : filterState.work;

/* 编年口径:zhu=朱轨(默认) · hong=洪轨 · compare=双轨;词条印章恒全量 */
const srcMode = () => ((window as any).APP_STATE && (window as any).APP_STATE.source) || 'zhu';
const eventVisible = (ev: any) => {
  const m = srcMode();
  if (m === 'compare') {
    // 洪年表已命中同题里程碑 → 策展独立卡由洪侧匹配卡代替,避免重复
    return !(ev.src === 'curated' && ev.hongMatched);
  }
  if (m === 'hong') {
    if (ev.src === 'curated' && ev.hongMatched) return false;
    return ev.src === 'hong' || ev.src === 'curated';
  }
  return ev.src === 'zhu' || ev.src === 'curated';       // zhu(默认)
};
/* 洪子诚年表密度轨:洪模式与比对模式均在主轴下方(_lane=-2);
   比对模式另将洪侧里程碑降为轨上锚点(上方卡区让给朱版) */
const hongTrack = () => srcMode() !== 'zhu';
const hongAnchor = () => srcMode() === 'compare';
const HONG_TRACK_Y = () => axisY + 46;

let majors: any[] = [], minors: any[] = [];
const personsByPeriod = new Map<string, any[]>(CFG.periods.map((p: any) => [p.id, []]));

function prepareData() {
  for (const ev of D.events) { delete ev._lane; delete ev._t; delete ev._w; delete ev._x; delete ev._tx; delete ev._dotX; delete ev._dotRow; delete ev._col; delete ev._label; }
  const evs = D.events.filter(eventVisible);
  majors = evs.filter((e: any) => e.priority === 1)
    .sort((a: any, b: any) => a.year - b.year || (a.month || 6) - (b.month || 6));
  if (hongAnchor()) majors = majors.filter((e: any) => e.src !== 'hong');   // 比对模式:洪侧里程碑以轨下锚点呈现,不挤上方卡区
  minors = evs.filter((e: any) => e.priority !== 1)
    .sort((a: any, b: any) => a.year - b.year || (a.month || 6) - (b.month || 6));

  // 主要事件卡:道数贪心(文档坐标)。道数随视口高度在 layout() 动态给定
  // (矮窗口 3 道),超出 zoneMajor.lanes 的溢出卡只留轴上圆点——
  // 硬编码 5 道会在矮窗口把卡片挤进次要标签区(实测重叠)。
  {
    const mlanes = (zoneMajor && zoneMajor.lanes) || 5;   // 模块级首跑(未 layout)兜底 5
    const laneRight: number[] = [];
    for (const ev of majors) {
      const t = trunc(ev.title || ev.label, CARD_CHARS);
      const w = cardW(t);
      const X = docX(eventYear(ev));
      const cardX = Math.max(8, Math.min(X - 10, stripW - w - 8));
      let lane = -1;
      for (let li = 0; li < mlanes; li++) {
        if (!laneRight[li] || cardX > laneRight[li] + CARD_GAP) { lane = li; break; }
      }
      if (lane >= 0) laneRight[lane] = cardX + w;
      Object.assign(ev, { _t: t, _w: w, _x: cardX, _lane: lane });
    }
  }
  // 次要事件:标签道贪心,放不下的只留圆点;洪轨事件只画轴下密度柱(-2)
  {
    const laneRight: number[] = [];
    const dotEvs: any[] = [];
    for (const ev of minors) {
      if (hongTrack() && ev.src === 'hong') { ev._lane = -2; continue; }
      const X = docX(eventYear(ev));
      const label = trunc(ev.label, MINOR_CHARS);
      const lw = [...label].length * 11 + 14;
      let lane = -1;
      for (let li = 0; li < MINOR_LANES; li++) {
        if (!laneRight[li] || X + 7 > laneRight[li] + 10) { lane = li; break; }
      }
      if (lane >= 0) laneRight[lane] = X + 7 + lw;
      Object.assign(ev, { _label: label, _lane: lane, _tx: X });
      dotEvs.push(ev);
    }
    // 圆点统一防撞串珠(里程碑+次要):x 相近的点归入同列,列内自轴面
    // 以 10px 间距向上堆叠;里程碑互让 10px(r5+r5),次要入列门槛 8.5px。
    // (同年同月的点坐标完全相同,无此步会叠成一坨)
    const cols: any[] = [];
    for (const m of majors) {
      const X = docX(eventYear(m));
      let col = cols.find(c => Math.abs(c.x - X) < 10);
      if (!col) { col = { x: X, n: 0, maj: true }; cols.push(col); }
      m._dotX = col.x; m._dotRow = col.n++;
    }
    for (const ev of dotEvs) {
      let col = cols.find(c => Math.abs(c.x - ev._tx) < 8.5);
      if (!col) { col = { x: ev._tx, n: 0 }; cols.push(col); }
      ev._dotX = col.x; ev._dotRow = col.n++; ev._col = col;
    }
    for (const c of cols) c.rows = c.n;
  }
  // 人物印章:按时期静态排列(策展名单,恒全量——词条不按编年口径拆分)
  for (const k of personsByPeriod.keys()) personsByPeriod.set(k, []);
  {
    const clampY = (y: number) => Math.max(YMIN, Math.min(YMAX, y));
    const periodOf = (y: number) => CFG.periods.find((p: any) => y >= p.from && y < p.to) || (y < 1949 ? CFG.periods[0] : CFG.periods[4]);
    for (const e of D.entities) {
      if (e.type !== 'person' || !e.birth || !impSet.has(e.name)) continue;
      personsByPeriod.get(periodOf(clampY(+e.birth + 28)).id)!.push(e);   // 键已在上方按时期预置
    }
    for (const arr of personsByPeriod.values())
      arr.sort((a: any, b: any) => (impRank.get(a.name) ?? 999) - (impRank.get(b.name) ?? 999));
  }
}
prepareData();

// 群体带:3 道贪心(策展层,与来源无关)
const bands = (D.bands || []).slice().sort((a: any, b: any) => (a.from - b.from) || (b.to - a.to));
{
  const laneRight: number[] = [];
  for (const b of bands) {
    const X0 = docX(b.from);
    let lane = -1;
    for (let li = 0; li < 3; li++) {
      if (!laneRight[li] || X0 > laneRight[li] + 6) { lane = li; break; }
    }
    if (lane >= 0) laneRight[lane] = Math.max(docX(b.to), X0 + 6);
    b._lane = lane;
  }
}

/* ================= SVG 构建（全部使用文档坐标） ================= */
let gContent: any, gFocusRing: any;
let majorSel: any, minorSel: any, bandSel: any, periodSel: any;
let gWashes: any, gTicksEl: any, axisThinEl: any, axisThickEl: any, gMinorsEl: any;

function build() {
  if (!svg) return;
  try {
    const root = d3.select(svg);
    root.selectAll('*').remove();
    root.attr('width', W).attr('height', H);

    const defs = root.append('defs');
    const halo = defs.append('filter').attr('id', 'ink-halo')
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
    halo.append('feGaussianBlur').attr('stdDeviation', 2.4);
    defs.append('filter').attr('id', 'brush-wobble')
      .html('<feTurbulence type="fractalNoise" baseFrequency="0.012 0.9" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/>');

    gContent = root.append('g').attr('class', 'g-content');

    /* 时期底纹（g-washes：入场显影整体淡入） */
    gWashes = gContent.append('g').attr('class', 'g-washes');
    gWashes.selectAll('.wash').data(CFG.periods).join('rect')
      .attr('class', 'wash')
      .attr('x', (p: any) => docX(p.from)).attr('width', (p: any) => (p.to - p.from) * PXY)
      .attr('y', 0).attr('height', '100%')
      .attr('fill', (p: any) => p.color).attr('opacity', .05);

    /* ① 时期题字 */
    periodSel = gContent.selectAll('.period').data(CFG.periods).join('g').attr('class', 'period');
    periodSel.append('line')
      .attr('x1', (p: any) => docX(p.from)).attr('x2', (p: any) => docX(p.from))
      .attr('y1', 26).attr('y2', axisY)
      .attr('stroke', '#b3342e').attr('stroke-width', 1)
      .attr('stroke-dasharray', '1,6').attr('opacity', .5);
    periodSel.append('rect')
      .attr('x', (p: any) => docX(p.from)).attr('width', (p: any) => (p.to - p.from) * PXY)
      .attr('y', -2).attr('height', 4).attr('rx', 2)
      .attr('fill', (p: any) => p.color).attr('opacity', .3);
    periodSel.each(function (this: any, p: any) {
      const g = d3.select(this);
      const xT = docX(p.from) + 12;
      g.selectAll('.vp').data([...p.name.replace('文学', '')]).join('text')
        .attr('class', 'vp tl-period-label').attr('font-size', 24)
        .attr('x', xT).attr('y', (_d: string, i: number) => 64 + i * 29).text((d: string) => d);
      g.selectAll('.vtheme').data([...p.theme]).join('text')
        .attr('class', 'vtheme tl-period-theme').attr('font-size', 10)
        .attr('x', xT + 27).attr('y', (_d: string, i: number) => 64 + i * 13).text((d: string) => d);
      g.append('text').attr('font-size', 10.5)
        .attr('fill', p.color).attr('font-weight', 600)
        .attr('x', xT).attr('y', 20).text(p.from + ' – ' + p.to);
    });

    /* 主轴 + 年份刻度（每年一刻度；轴线/刻度分组建档，供入场显影） */
    const gAxis = gContent.append('g').attr('class', 'g-axis');
    axisThickEl = gAxis.append('line').attr('class', 'axis-line')
      .attr('x1', 0).attr('x2', stripW).attr('y1', axisY).attr('y2', axisY)
      .attr('filter', 'url(#brush-wobble)')
      .attr('stroke', 'var(--ink-1)').attr('stroke-width', 3).attr('stroke-linecap', 'round')
      .node();
    axisThinEl = gAxis.append('line')
      .attr('x1', 0).attr('x2', stripW).attr('y1', axisY).attr('y2', axisY)
      .attr('stroke', 'var(--ink-0)').attr('stroke-width', 1).attr('opacity', .55)
      .node();
    const gTicks = gContent.append('g').attr('class', 'g-ticks');
    gTicksEl = gTicks.node();
    const years = d3.range(YMIN, YMAX + 1);
    const tickG = gTicks.selectAll('.tick').data(years).join('g').attr('class', 'tick');
    tickG.append('line')
      .attr('x1', docX).attr('x2', docX)
      .attr('y1', axisY).attr('y2', (d: number) => axisY + (d % 10 === 0 ? 13 : 7))
      .attr('stroke', (d: number) => d % 10 === 0 ? 'var(--ink-1)' : 'var(--ink-3)')
      .attr('stroke-width', (d: number) => d % 10 === 0 ? 1.6 : 1);
    tickG.append('text')
      .attr('x', docX).attr('y', axisY + 28).attr('text-anchor', 'middle')
      .attr('font-size', (d: number) => d % 10 === 0 ? 13 : 10.5)
      .attr('class', (d: number) => 'tl-year-label' + (d % 10 === 0 ? ' decade' : ''))
      .text((d: number) => d);

    /* 右端预留空白年:淡刻度提示长卷可向未来延伸 */
    const fYears = d3.range(YMAX + 1, DOC_END + 1);
    const fTickG = gTicks.selectAll('.ftick').data(fYears).join('g').attr('class', 'ftick');
    fTickG.append('line')
      .attr('x1', docX).attr('x2', docX)
      .attr('y1', axisY).attr('y2', axisY + 7)
      .attr('stroke', 'var(--ink-4)').attr('stroke-width', 1).attr('stroke-dasharray', '2,3');

    /* ④ 群体带（静态） */
    bandSel = gContent.selectAll('.band').data(bands.filter((b: any) => b._lane >= 0)).join('g')
      .attr('class', 'band').style('cursor', 'pointer')
      .attr('transform', (b: any) => `translate(0,${zoneBand.bottom - b._lane * zoneBand.laneH - 14})`);
    bandSel.append('rect').attr('class', 'b-fill')
      .attr('x', (b: any) => docX(b.from)).attr('width', (b: any) => Math.max(6, (b.to - b.from) * PXY))
      .attr('height', 14).attr('rx', 7)
      .attr('fill', (b: any) => periodColor(b.from)).attr('opacity', .18);
    bandSel.append('rect').attr('class', 'b-stroke')
      .attr('x', (b: any) => docX(b.from)).attr('width', (b: any) => Math.max(6, (b.to - b.from) * PXY))
      .attr('height', 14).attr('rx', 7)
      .attr('fill', 'none').attr('stroke', (b: any) => periodColor(b.from)).attr('stroke-opacity', .4);
    bandSel.append('text').attr('class', 'b-label')
      .attr('font-size', 10.5)
      .attr('paint-order', 'stroke').attr('stroke', 'var(--paper-0)').attr('stroke-width', 3)
      .attr('y', 11);
    bandSel.each(function (this: any, b: any) {
      const g = d3.select(this);
      const X0 = docX(b.from), bandW = Math.max(6, (b.to - b.from) * PXY);
      const labelX = Math.max(X0 + 5, Math.min(X0 + bandW / 2 - b.name.length * 5.2, stripW - b.name.length * 10.5 - 4));
      g.select('.b-label')
        .attr('x', labelX)
        .attr('fill', periodColor(b.from))
        .attr('display', bandW > b.name.length * 10.5 + 14 ? null : 'none')
        .text(b.name);
    });

    /* ③ 人物印章（静态） */
    const sealG = gContent.selectAll('.period-seals').data(CFG.periods).join('g');
    sealG.each(function (this: any, p: any) {
      const g = d3.select(this);
      const list = personsByPeriod.get(p.id);
      if (!list || !list.length) return;
      const startX = docX(p.from) + 8;
      const availW = docX(p.to) - startX - 6;
      let cx = startX, row = 0;
      for (const person of list) {
        if (row >= 2) break;
        const cw = person.name.length * 11 + 14;
        if (cx + cw > startX + availW) { row++; cx = startX; if (row >= 2) break; continue; }
        const y = zoneSeal.bottom - (row + 1) * zoneSeal.rowH;
        const chip = g.append('g').attr('class', 'seal').style('cursor', 'pointer')
          .attr('transform', `translate(${cx},${y})`)
          .on('click', () => (window as any).openDrawerEntity(person.name));
        chip.append('rect')
          .attr('width', cw).attr('height', 18).attr('rx', 3)
          .attr('fill', 'var(--paper-1)')
          .attr('stroke', CFG.types.person.color).attr('stroke-opacity', .55);
        chip.append('text')
          .attr('x', cw / 2).attr('y', 13).attr('text-anchor', 'middle')
          .attr('font-size', 10.5).attr('fill', 'var(--ink-1)')
          .attr('font-family', 'var(--font-brush)')
          .text(person.name);
        cx += cw + 6;
      }
    });

    /* ② 次要事件（静态：标签或仅圆点；g-minors 整组建档）
       圆点带防撞串珠:_dotX 为列锚 x、_dotRow 为列内层级(每级上移 10px);
       洪/比对模式下洪子诚年表(_lane=-2)不进标签区,另行渲染为轴下密度轨 */
    const gMinors = gContent.append('g').attr('class', 'g-minors');
    gMinorsEl = gMinors.node();
    minorSel = gMinors.selectAll('.minor').data(minors.filter((ev: any) => ev._lane !== -2)).join('g')
      .attr('class', 'minor').style('cursor', 'pointer');
    minorSel.each(function (this: any, ev: any) {
      const g = d3.select(this);
      const DX = ev._dotX ?? docX(eventYear(ev));      // 列锚 x(防撞后)
      const rows = ev._col ? ev._col.rows : 1;
      const hasLabel = ev._lane >= 0;
      const ly = zoneMinor.bottom - ev._lane * zoneMinor.laneH;
      if (hasLabel) g.append('line')
        .attr('x1', DX).attr('x2', DX)
        .attr('y1', axisY - (rows - 1) * 10 - 6).attr('y2', ly + 4)
        .attr('stroke', 'var(--ink-3)').attr('stroke-width', .8).attr('stroke-dasharray', '2,3');
      g.append('circle').attr('r', 3)
        .attr('cx', DX).attr('cy', axisY - (ev._dotRow || 0) * 10)
        .attr('fill', kindColor(ev.kind)).attr('opacity', .85);
      if (hasLabel) g.append('text')
        .attr('x', DX + 7).attr('y', ly - 4)
        .attr('font-size', 11).attr('fill', 'var(--ink-2)')
        .attr('paint-order', 'stroke').attr('stroke', 'var(--paper-0)').attr('stroke-width', 3)
        .text(ev._label);
      g.append('title').text(ev.label + '（' + ev.year + '）');   // 原生悬停提示
    });

    /* ②b 洪/比对模式:洪子诚年表密度轨(轴下,赭橙)——
       900+ 逐条圆点在 46px/年 下会挤成实线,故按月聚合为密度细柱
       (柱高∝当月条数,点击开当月首条),比对模式里程碑另作轨上大号锚点 */
    const hongTrackEvs = minors.filter((ev: any) => ev._lane === -2);
    const hongMajors = hongAnchor() ? D.events.filter((ev: any) => ev.src === 'hong' && ev.priority === 1) : [];
    if (hongTrackEvs.length || hongMajors.length) {
      const ty = HONG_TRACK_Y();
      const tg = gMinors.append('g').attr('class', 'hong-track');
      tg.append('line').attr('class', 'hong-track-line')
        .attr('x1', docX(1949)).attr('x2', docX(2000.5))
        .attr('y1', ty).attr('y2', ty)
        .attr('stroke', 'var(--src-hong)').attr('stroke-opacity', .4);
      const byMonth = new Map();
      for (const ev of hongTrackEvs) {
        const k = ev.year + '-' + (ev.month || 0);
        const cur = byMonth.get(k) || { y: ev.year, m: ev.month || 0, n: 0, first: ev };
        cur.n++;
        byMonth.set(k, cur);
      }
      const hBars = tg.selectAll('.hong-bar').data([...byMonth.values()]).join('g')
        .attr('class', 'hong-bar').style('cursor', 'pointer')
        .on('click', (_e: any, d: any) => (window as any).openDrawerEvent(d.first));
      hBars.append('rect')
        .attr('x', (d: any) => docX(d.y + ((d.m || 6.5) - 0.5) / 12) - 1)
        .attr('y', ty + 2)
        .attr('width', 2)
        .attr('height', (d: any) => Math.min(3 + d.n * 1.6, 15))
        .attr('rx', 1)
        .attr('fill', 'var(--src-hong)').attr('fill-opacity', .5);
      hBars.append('title').text((d: any) => `${d.y} 年${d.m ? ' ' + d.m + ' 月' : ' 本年'} · ${d.n} 条 · ${d.first.label.slice(0, 24)}…`);
      const hAnchor = tg.selectAll('.hong-anchor').data(hongMajors).join('g')
        .attr('class', 'hong-anchor').style('cursor', 'pointer')
        .on('click', (_e: any, d: any) => (window as any).openDrawerEvent(d));
      hAnchor.append('circle').attr('r', 8)
        .attr('cx', (ev: any) => docX(eventYear(ev))).attr('cy', ty)
        .attr('fill', 'var(--src-hong)').attr('opacity', .22).attr('filter', 'url(#ink-halo)');
      hAnchor.append('circle').attr('r', 4.5)
        .attr('cx', (ev: any) => docX(eventYear(ev))).attr('cy', ty)
        .attr('fill', 'var(--src-hong)').attr('stroke', 'var(--paper-1)').attr('stroke-width', 1.2);
      hAnchor.append('title').text((ev: any) => `洪子诚年表 · ${ev.title || ev.label}（${ev.year}.${ev.month || ''}）`);
      tg.append('text').attr('class', 'hong-track-label')
        .attr('x', docX(1949)).attr('y', ty + 21)
        .attr('font-size', 10).attr('fill', 'var(--src-hong)')
        .attr('paint-order', 'stroke').attr('stroke', 'var(--paper-0)').attr('stroke-width', 3)
        .text(`▼ 洪子诚年表 ${hongTrackEvs.length} 条(逐月详编,止于 2000)· 柱高∝当月条数`);
    }

    /* ② 主要事件卡（静态） */
    majorSel = gContent.selectAll('.major').data(majors).join('g').attr('class', 'major')
      .style('cursor', 'pointer');
    majorSel.each(function (this: any, ev: any) {
      const g = d3.select(this);
      const X = ev._dotX ?? docX(eventYear(ev));            // 串珠列锚 x(防撞后)
      const dotY = axisY - (ev._dotRow || 0) * 10;          // 列内层级(10px/级)
      const hong = ev.src === 'hong';
      const accent = hong ? 'var(--src-hong)' : '#b3342e';   // 洪侧里程碑卡用洪源色
      const below = hong && hongAnchor();                     // 比对模式:洪侧锚点在轴下密度轨,不画轴上点
      if (!below) {
        g.append('line')
          .attr('x1', X).attr('x2', X)
          .attr('y1', dotY - 6)
          .attr('y2', ev._lane >= 0 ? zoneMajor.top + ev._lane * zoneMajor.laneH + CARD_H + 2 : dotY - 12)
          .attr('stroke', accent).attr('stroke-width', 1).attr('stroke-dasharray', '3,4').attr('opacity', .4);
        g.append('circle').attr('r', 8)
          .attr('cx', X).attr('cy', dotY)
          .attr('fill', accent).attr('opacity', .22).attr('filter', 'url(#ink-halo)');
        g.append('circle').attr('r', 5)
          .attr('cx', X).attr('cy', dotY)
          .attr('fill', accent).attr('stroke', 'var(--paper-1)').attr('stroke-width', 1.5);
      }
      if (ev._lane >= 0) {
        const cy = zoneMajor.top + ev._lane * zoneMajor.laneH;
        // v2 动效新增 a：卡纸/色条加 class 钩子，供 timeline.css 光标邻近墨染高亮
        g.append('rect')
          .attr('class', 'card-paper')
          .attr('x', ev._x).attr('y', cy).attr('width', ev._w).attr('height', CARD_H).attr('rx', 3)
          .attr('fill', 'var(--paper-1)').attr('stroke', 'var(--paper-edge)')
          .style('filter', 'drop-shadow(0 2px 5px var(--paper-shadow))');
        g.append('rect')
          .attr('class', 'card-accent')
          .attr('x', ev._x).attr('y', cy).attr('width', 3).attr('height', CARD_H).attr('rx', 1.5)
          .attr('fill', hong ? accent : kindColor(ev.kind));
        g.append('text')
          .attr('x', ev._x + 11).attr('y', cy + 16)
          .attr('font-size', 13.5).attr('fill', 'var(--ink-0)')
          .attr('font-family', 'var(--font-brush)')
          .text(ev._t);
        g.append('text')
          .attr('x', ev._x + 11).attr('y', cy + 30)
          .attr('font-size', 9.5).attr('fill', accent)
          .text(ev.year + (ev.month ? '.' + ev.month : ''));
      }
      g.append('title').text((hong ? '洪子诚年表 · ' : '') + (ev.title || ev.label) + '（' + ev.year + '.' + (ev.month || '') + '）');
    });

    /* 聚焦环（最上层；显隐走 .show 类的 opacity 过渡） */
    gFocusRing = gContent.append('g').attr('class', 'focus-ring');
    gFocusRing.append('rect')
      .attr('rx', 6).attr('fill', 'rgba(179,52,46,.06)')
      .attr('stroke', 'var(--cinnabar)').attr('stroke-width', 1.6)
      .attr('stroke-dasharray', '5,3');
    gFocusRing.append('circle')
      .attr('r', 9).attr('fill', 'none')
      .attr('stroke', 'var(--cinnabar)').attr('stroke-width', 1.6);

    bindInteractions();
    applyFilters();
    render();
  } catch (err) {
    (window as any).__tlBuildErr = String(err && (err as Error).stack || err);
    console.error('[timeline build]', err);
  }
}

/* ================= 分区（静态） ================= */
function layout() {
  axisY = Math.max(600, H * 0.8);
  zoneBand = { bottom: axisY - 6, laneH: 16, lanes: 3 };
  zoneSeal = { bottom: axisY - 10 - zoneBand.lanes * zoneBand.laneH - 6, rowH: 22 };
  zoneMinor = { bottom: zoneSeal.bottom - 2 * zoneSeal.rowH - 8, lanes: MINOR_LANES, laneH: 15 };
  const majorTop = 258;
  const majorBottom = zoneMinor.bottom - zoneMinor.lanes * zoneMinor.laneH - 10;
  const lanes = Math.max(3, Math.min(5, Math.floor((majorBottom - majorTop) / 46)));
  zoneMajor = { top: majorTop, bottom: majorBottom, lanes, laneH: (majorBottom - majorTop) / lanes };
}

/* ================= 渲染（仅变换 + 聚焦 + 缩略图） ================= */
let raf: number | null = null;
function requestRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = null; render(); });
}

function render() {
  const z = state.zoom;
  gContent.attr('transform', `scale(${z}) translate(${(-state.pan).toFixed(2)},${(-state.panY).toFixed(2)})`);
  updateFocus();
  inkSchedule();   // v2 动效新增 a：视口变化后重算邻近墨染（独立 rAF，只切 class）
}

/* ---------- 聚焦：放大越过阈值 → 视口中心事件入环 + 抽屉展开 ----------
   主要事件以圆点（真实时间位置）计距并强优先；次要事件仅在
   附近没有主要事件且高度居中时才聚焦。缩小退回阈值以下时，
   若抽屉仍显示聚焦事件则自动收起。 */
let focused: any = null;
function updateFocus() {
  if (state.zoom < FOCUS_Z) {
    if (focused) {
      focused = null;
      gFocusRing.classed('show', false);
      // v2 适配点 3：v2 抽屉未开时 #drawer 不在 DOM，drawer-title 是 class 非 id——
      // 加空值防护；收起优先走 shell 的 window.closeDrawer()，无则回退旧版去 class。
      const drawerEl = document.getElementById('drawer');
      const titleEl = drawerEl && (document.getElementById('drawer-title') || drawerEl.querySelector('.drawer-title'));
      if (drawerEl && titleEl && drawerEl.classList.contains('open') && titleEl.textContent === lastAutoTitle) {
        if ((window as any).closeDrawer) (window as any).closeDrawer();
        else drawerEl.classList.remove('open');
      }
    }
    return;
  }
  const cxD = state.pan + (W / 2) / state.zoom;
  let best: any = null, bestD = Infinity, bestIsMajor = false;
  for (const ev of majors) {
    if (ev._lane < 0) continue;
    const d = Math.abs(docX(eventYear(ev)) - cxD);
    if (d < bestD) { bestD = d; best = ev; bestIsMajor = true; }
  }
  for (const ev of minors) {
    const d = Math.abs(docX(eventYear(ev)) - cxD) * 2.2 + 30;
    if (d < bestD) { bestD = d; best = ev; bestIsMajor = false; }
  }
  const range = bestIsMajor ? 90 : 46;   // 次要事件需更居中才聚焦
  if (best && bestD < range) {
    if (best !== focused) {
      focused = best;
      if (bestIsMajor) {
        const cy = zoneMajor.top + best._lane * zoneMajor.laneH;
        gFocusRing.classed('show', true);
        gFocusRing.select('rect').attr('display', null)
          .attr('x', best._x - 5).attr('y', cy - 5)
          .attr('width', best._w + 10).attr('height', CARD_H + 10);
        gFocusRing.select('circle').attr('display', 'none');
      } else {
        gFocusRing.classed('show', true);
        gFocusRing.select('rect').attr('display', 'none');
        gFocusRing.select('circle').attr('display', null)
          .attr('cx', best._dotX ?? docX(eventYear(best)))
          .attr('cy', best._lane === -2 ? HONG_TRACK_Y() : axisY - (best._dotRow || 0) * 10)   // 串珠列内层级
          .attr('r', 10);
      }
      lastAutoTitle = best.title || best.label;
      (window as any).openDrawerEvent(best);
    }
  } else if (focused) {
    focused = null;
    gFocusRing.classed('show', false);
  }
}
let lastAutoTitle = '';

/* ================= 交互 ================= */

function applyFilters() {
  majorSel.classed('off', (d: any) => !kindOK(d));
  minorSel.classed('off', (d: any) => !kindOK(d));
  d3.selectAll('.band').classed('off', !filterState.band);
  d3.selectAll('.seal').classed('off', !filterState.person);
  d3.selectAll('.hong-track').classed('off', !filterState.event);
}

/* ---------- v2 动效新增 a：卡片光标邻近墨染高亮 ----------
   rAF 节流的 pointermove → 只加/去 .ink-near class（不碰样式、不进 React）。
   距离按屏幕像素计：卡片文档矩形经当前 zoom/pan 变换后与光标求距，
   邻近半径 INK_R 内的 .major 卡纸染墨（视觉响应在 timeline.css，只动色）。 */
const INK_R = 84;   // 屏幕像素邻近半径
const inkPtr = { x: -1e4, y: -1e4, has: false, raf: 0 };
function inkApply() {
  inkPtr.raf = 0;
  if (!majorSel) return;
  for (const node of majorSel.nodes() as SVGGElement[]) {
    const ev = d3.select(node).datum() as any;
    let near = false;
    if (ev && ev._lane >= 0) {
      const z = state.zoom;
      const rx = (ev._x - state.pan) * z;
      const ry = (zoneMajor.top + ev._lane * zoneMajor.laneH) * z;
      const dx = Math.max(rx - inkPtr.x, 0, inkPtr.x - (rx + ev._w * z));
      const dy = Math.max(ry - inkPtr.y, 0, inkPtr.y - (ry + CARD_H * z));
      near = inkPtr.has && Math.hypot(dx, dy) < INK_R;
    }
    if (near !== node.classList.contains('ink-near')) node.classList.toggle('ink-near', near);
  }
}
function inkSchedule() {
  if (!inkPtr.raf) inkPtr.raf = requestAnimationFrame(inkApply);
}

/* ---------- 鼠标拖拽状态（模块级单例；window 监听只注册一次，
       避免每次 build() 重建时重复绑定累积） ---------- */
const DRAG = { on: false, x0: 0, y0: 0, pan0: 0, panY0: 0, moved: false,
               velX: 0, velY: 0, lastT: 0, prevCX: 0, prevCY: 0 };

const sampleVel = (cx: number, cy: number, dt: number, store: any) => {
  if (dt >= 4 && dt < 120) {
    const k = 0.3;
    store.x = (1 - k) * store.x + k * (cx - store.px) / dt;
    store.y = (1 - k) * store.y + k * (cy - store.py) / dt;
    store.t = performance.now();
  } else if (dt >= 120) {
    store.x = 0; store.y = 0; store.t = performance.now();
  }
  store.px = cx; store.py = cy;
};
const flickVel = (store: any) => {
  if (performance.now() - store.t > 90) return null;
  const sp = Math.hypot(store.x, store.y);
  if (sp < 0.12) return null;
  const cap = Math.min(2.6, sp) / sp;      // 限幅，防过猛
  return [store.x * cap, store.y * cap];
};

window.addEventListener('mousemove', (e: MouseEvent) => {
  if (DRAG.on) {
    const dx = e.clientX - DRAG.x0, dy = e.clientY - DRAG.y0;
    if (Math.abs(dx) + Math.abs(dy) > 3) DRAG.moved = true;
    state.pan = clampPan(DRAG.pan0 - dx / state.zoom);
    state.panY = clampPanY(DRAG.panY0 - dy / state.zoom);
    const dt = performance.now() - DRAG.lastT;
    if (dt > 0) {
      DRAG.velX = 0.7 * DRAG.velX + 0.3 * (e.clientX - DRAG.prevCX) / dt;
      DRAG.velY = 0.7 * DRAG.velY + 0.3 * (e.clientY - DRAG.prevCY) / dt;
    }
    DRAG.lastT = performance.now(); DRAG.prevCX = e.clientX; DRAG.prevCY = e.clientY;
    requestRender();
  }
});
window.addEventListener('mouseup', () => {
  if (DRAG.on) {
    DRAG.on = false;
    document.getElementById('view-timeline')?.classList.remove('dragging');
    const f = flickVel({ x: DRAG.velX, y: DRAG.velY, px: DRAG.prevCX, py: DRAG.prevCY, t: DRAG.lastT });
    if (f) startInertia(f[0], f[1]);
  }
});

function bindInteractions() {
  const tlView = document.getElementById('view-timeline');
  if (!tlView) return;

  // 滚轮 = 屏幕缩放（锚定光标，横纵同时）
  tlView.onwheel = (e: WheelEvent) => {
    e.preventDefault();
    stopInertia(); cancelTween();
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const docAt = state.pan + sx / state.zoom;
    const docAtY = state.panY + sy / state.zoom;
    const nz = Math.max(minZoom(), Math.min(MAX_Z, state.zoom * Math.exp(-e.deltaY * 0.0014)));
    state.zoom = nz;
    state.pan = clampPan(docAt - sx / nz);
    state.panY = clampPanY(docAtY - sy / nz);
    requestRender();
  };

  // 拖拽 = 平移（横向 + 纵向），松手带惯性
  tlView.onmousedown = (e: MouseEvent) => {
    if ((e.target as Element).closest?.('#tl-filters')) return;
    stopInertia(); cancelTween();
    Object.assign(DRAG, { on: true, moved: false, x0: e.clientX, y0: e.clientY,
      pan0: state.pan, panY0: state.panY, velX: 0, velY: 0,
      lastT: performance.now(), prevCX: e.clientX, prevCY: e.clientY });
    tlView.classList.add('dragging');
  };

  // 触摸平移 + 双指缩放（单指松手带惯性）
  let tPrev: { x: number; y: number }[] | null = null;
  const tStore = { x: 0, y: 0, px: 0, py: 0, t: 0 };
  tlView.ontouchstart = (e: TouchEvent) => {
    stopInertia(); cancelTween();
    tPrev = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
    Object.assign(tStore, { x: 0, y: 0, px: tPrev[0] ? tPrev[0].x : 0, py: tPrev[0] ? tPrev[0].y : 0, t: performance.now() });
  };
  tlView.ontouchmove = (e: TouchEvent) => {
    e.preventDefault();
    const ts = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
    if (tPrev && tPrev.length === 1 && ts.length === 1) {
      state.pan = clampPan(state.pan - (ts[0].x - tPrev[0].x) / state.zoom);
      state.panY = clampPanY(state.panY - (ts[0].y - tPrev[0].y) / state.zoom);
      sampleVel(ts[0].x, ts[0].y, performance.now() - tStore.t, tStore);
    } else if (tPrev && tPrev.length === 2 && ts.length === 2) {
      const d0 = Math.hypot(tPrev[0].x - tPrev[1].x, tPrev[0].y - tPrev[1].y);
      const d1 = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
      const cx = (ts[0].x + ts[1].x) / 2;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const sx = cx - rect.left;
      const docAt = state.pan + sx / state.zoom;
      state.zoom = Math.max(minZoom(), Math.min(MAX_Z, state.zoom * d1 / d0));
      state.pan = clampPan(docAt - sx / state.zoom);
    }
    tPrev = ts;
    requestRender();
  };
  tlView.ontouchend = () => {
    const f = tPrev && tPrev.length === 1 ? flickVel(tStore) : null;
    if (f) startInertia(f[0], f[1]);
    tPrev = null;
  };

  // 光标邻近墨染：pointermove 记录坐标 + rAF 节流重算；离场清空（v2 动效新增 a）
  tlView.addEventListener('pointermove', (e: PointerEvent) => {
    inkPtr.x = e.clientX; inkPtr.y = e.clientY; inkPtr.has = true;
    inkSchedule();
  });
  tlView.addEventListener('pointerleave', () => {
    inkPtr.has = false; inkPtr.x = -1e4; inkPtr.y = -1e4;
    inkSchedule();
  });

  // 点击 → 详情抽屉
  majorSel.on('click', (_e: any, d: any) => { if (!DRAG.moved) (window as any).openDrawerEvent(d); });
  minorSel.on('click', (_e: any, d: any) => { if (!DRAG.moved) (window as any).openDrawerEvent(d); });
  bandSel.on('click', (_e: any, d: any) => { if (!DRAG.moved) (window as any).openWikiPage(d.name); });
}

/* ================= 图例·图层面板 ================= */
function buildFilters() {
  const box = document.getElementById('tl-filters');
  if (!box) return;
  const typeRows = [
    ['event', '事件', CFG.types.event.color],
    ['policy', '政策', CFG.types.policy.color],
    ['work', '作品·刊物', CFG.types.work.color],
    ['band', '群体·流派带', CFG.types.movement.color],
    ['person', '人物印章', CFG.types.person.color],
  ];
  const periodDots = CFG.periods.map((p: any) =>
    `<span style="display:inline-flex;align-items:center;gap:3px;margin:2px 4px 2px 0">
      <span style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
      <span style="font-size:11px">${p.short}</span></span>`).join('');
  const srcDots = [
    ['--src-hong', '洪子诚 · 年表密度轨/洪侧卡片'],
    ['--src-zhu', '朱栋霖 · 口径标识(徽章/图谱环)'],
  ].map(([v, label]) =>
    `<span style="display:inline-flex;align-items:center;gap:3px;margin:2px 6px 2px 0">
      <span style="width:8px;height:8px;border-radius:2px;background:var(${v})"></span>
      <span style="font-size:11px">${label}</span></span>`).join('');
  box.innerHTML = `
    <div class="fl-title fl-toggle">图 例 <span class="fl-arrow">▾</span></div>
    <div class="fl-body">
    ${typeRows.map(([key, label, color]) => `
      <label><input type="checkbox" checked data-key="${key}">
        <span class="dot" style="background:${color}"></span>${label}</label>`).join('')}
    <div class="fl-title" style="margin-top:8px">时期底色</div>
    <div>${periodDots}</div>
    <div class="fl-title" style="margin-top:8px">两史来源</div>
    <div>${srcDots}</div>
    <div class="fl-hint">洪子诚/比对模式:洪年表按月聚合为轴下密度柱(柱高∝当月条数,止于 2000);洪模式里程碑为大卡,比对模式为轨上锚点;朱栋霖大事记提要式,至 2018。长卷右端预留空白,可向未来延伸。</div>
    <div class="fl-hint">左右拖动浏览长卷 · 滚轮放大 → 聚焦中心事件</div>
    </div>`;
  box.querySelector('.fl-toggle')!.addEventListener('click', () => {
    box.classList.toggle('collapsed');
    if (box.classList.contains('collapsed')) box.style.height = '';   // 收起时不留空壳
    else if (!box.style.height) {
      try { const s = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
        if (s && s.h) box.style.height = s.h + 'px'; } catch (_) { /* 忽略 */ }
    }
  });
  box.querySelectorAll('input[type=checkbox]').forEach(cb =>
    cb.addEventListener('change', () => {
      filterState[(cb as HTMLInputElement).dataset.key as string] = (cb as HTMLInputElement).checked;
      applyFilters();
    }));

  /* 左下角拉伸把手:自由调宽高,尺寸记忆在 localStorage;双击复位 */
  const SIZE_KEY = 'tl-filters-size';
  try {
    const saved = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
    if (saved && saved.w) {
      box.style.width = Math.min(saved.w, window.innerWidth - 24) + 'px';
      if (saved.h) box.style.height = Math.min(saved.h, window.innerHeight - 90) + 'px';
    }
  } catch (_) { /* 忽略 */ }
  const grip = document.createElement('div');
  grip.className = 'fl-grip';
  grip.title = '拖拽调整大小 · 双击复位';
  box.appendChild(grip);
  grip.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const r = box.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      box.style.width = Math.max(170, Math.min(640, r.right - ev.clientX)) + 'px';
      box.style.height = Math.max(46, Math.min(window.innerHeight - 90, r.bottom - ev.clientY)) + 'px';
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem(SIZE_KEY, JSON.stringify({ w: box.offsetWidth, h: box.offsetHeight })); } catch (_) { /* 忽略 */ }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  grip.addEventListener('dblclick', () => {
    box.style.width = ''; box.style.height = '';
    try { localStorage.removeItem(SIZE_KEY); } catch (_) { /* 忽略 */ }
  });
}

/* ================= 平滑定位（搜索/深链/回位/键盘平移） =================
   v2 动效新增 c：缓动升级为指数收敛（临界阻尼弹簧式位移曲线——
   快出缓收、无过冲、能量单调耗散，比幂函数更接近物理滑移）。
   函数签名与 ms 时长语义不变，调用方零改动。 */
let tween: number | null = null;
function cancelTween() { if (tween) { cancelAnimationFrame(tween); tween = null; } }
function animateTo(targetPan: number, targetZoom: number, targetPanY = 0, ms = 600, easeKind = 'inout') {
  cancelTween(); stopInertia();
  const p0 = state.pan, z0 = state.zoom, y0 = state.panY;
  const t0 = performance.now();
  const easeInOut = (t: number) => t === 0 ? 0 : t === 1 ? 1
    : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;   // inOutExpo
  const easeOut = (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);             // outExpo
  const ease = easeKind === 'out' ? easeOut : easeInOut;
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    const k = ease(t);
    state.pan = clampPan(p0 + (clampPan(targetPan) - p0) * k);
    state.panY = clampPanY(y0 + (clampPanY(targetPanY) - y0) * k);
    state.zoom = z0 + (targetZoom - z0) * k;
    render();
    if (t < 1) tween = requestAnimationFrame(step); else tween = null;
  };
  tween = requestAnimationFrame(step);
}

/* ---------- 拖拽释放惯性（指数衰减，撞边界即停） ---------- */
let inertiaRaf: number | null = null;
function stopInertia() { if (inertiaRaf) { cancelAnimationFrame(inertiaRaf); inertiaRaf = null; } }
function startInertia(vx: number, vy: number) {           // 屏幕速度 px/ms（向右拖为正）
  if ((window as any).prefersReducedMotion && (window as any).prefersReducedMotion()) return;
  stopInertia();
  const tau = 325;
  let last = performance.now();
  const step = (now: number) => {
    const dt = Math.min(64, now - last); last = now;
    const decay = Math.exp(-dt / tau);
    vx *= decay; vy *= decay;
    const p0 = state.pan, y0 = state.panY;
    state.pan = clampPan(state.pan - vx * dt / state.zoom);
    state.panY = clampPanY(state.panY - vy * dt / state.zoom);
    requestRender();
    if (Math.hypot(vx, vy) < 0.02 || (state.pan === p0 && state.panY === y0)) {
      inertiaRaf = null; return;         // 速度耗尽或撞到边界
    }
    inertiaRaf = requestAnimationFrame(step);
  };
  inertiaRaf = requestAnimationFrame(step);
}

/* ================= 首次入场：长卷显影（一次性仪式） =================
   时期底纹淡入 → 主轴细线自左向右画出 → 粗笔落墨 → 年份刻度浮现
   → 时期题字错峰 → 群体带/事件卡按时间位置自右向左错峰显影。 */
let introPlayed = false;
function playIntro() {
  if (introPlayed || !gContent) return;
  introPlayed = true;
  if ((window as any).prefersReducedMotion && (window as any).prefersReducedMotion()) return;
  const BRUSH = 'cubic-bezier(.22,.8,.3,1)';
  const delayAt = (x: number) => Math.min(950, Math.max(0, x / stripW * 900));   // 按文档 x 错峰
  const anim = (node: any, kf: any[], opt: any) => {
    if (!node || !node.animate) return;
    const a = node.animate(kf, Object.assign({ easing: BRUSH, fill: 'both' }, opt));
    a.finished.then(() => a.cancel()).catch(() => {});   // 结束即清除，交还自然态
  };
  anim(gWashes && gWashes.node(), [{ opacity: 0 }, { opacity: 1 }], { duration: 600 });
  // 主轴：先画无滤镜细线（逐帧重算 feTurbulence 代价高），粗笔随后落墨
  if (axisThinEl) {
    axisThinEl.style.strokeDasharray = String(stripW);
    anim(axisThinEl,
      [{ strokeDashoffset: stripW + 'px' }, { strokeDashoffset: '0px' }],
      { duration: 1100, delay: 80, easing: 'cubic-bezier(.45,.05,.35,1)' });
  }
  anim(axisThickEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 450, delay: 950 });
  anim(gTicksEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 650 });
  if (periodSel) periodSel.each(function (this: any, _p: any, i: number) {
    anim(this, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
      { duration: 500, delay: 150 + i * 120 });
  });
  if (bandSel) bandSel.each(function (this: any, b: any) {
    anim(this, [{ opacity: 0 }, { opacity: 1 }],
      { duration: 450, delay: delayAt(docX(b.from)) });
  });
  d3.selectAll('.period-seals').each(function (this: any, _p: any, i: number) {
    d3.select(this).selectAll('.seal').each(function (this: any) {
      anim(this, [{ opacity: 0 }, { opacity: 1 }],
        { duration: 400, delay: 250 + i * 120 + Math.random() * 150 });
    });
  });
  if (majorSel) majorSel.each(function (this: any, ev: any) {
    anim(this, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
      { duration: 450, delay: 200 + delayAt(docX(eventYear(ev))) });
  });
  anim(gMinorsEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 1250 });
}
function maybePlayIntro() {
  if (introPlayed) return;
  // 卷轴已在拉开（或已移除）→ 立即显影；否则等它开始
  if ((window as any).__curtainOpening || !document.getElementById('curtain')) { playIntro(); return; }
  const t0 = Date.now();
  const poll = setInterval(() => {
    if ((window as any).__curtainOpening || !document.getElementById('curtain') || Date.now() - t0 > 2600) {
      clearInterval(poll);
      playIntro();
    }
  }, 100);
}

/* ================= 外部控制 ================= */
(window as any).TL = {
  focusYear(yearF: number, zoom = 2.1) {
    // yearF 为精确的分数年（如 1957.46 = 1957年6月中）
    const x = docX(yearF);
    let near: any = null, nd = Infinity;
    for (const ev of majors) {
      if (ev._lane < 0) continue;
      const d = Math.abs(docX(eventYear(ev)) - x);
      if (d < nd) { nd = d; near = ev; }
    }
    const cardCY = near
      ? zoneMajor.top + near._lane * zoneMajor.laneH + CARD_H / 2
      : zoneMajor.top + CARD_H / 2;
    animateTo(x - (W / 2) / zoom, zoom, cardCY - (H * 0.38) / zoom);
  },
  overview() { animateTo(0, minZoom(), 0); },
  setZoom(z: number) { animateTo(state.pan + (W / 2) / state.zoom - (W / 2) / z, z, state.panY, 350); },
  panBy(dx: number) { animateTo(state.pan + dx, state.zoom, state.panY, 220, 'out'); },
  goYear(y: number) { this.focusYear(y + 0.5, Math.max(state.zoom, 1)); },
  /* 下一个/上一个里程碑事件（自动聚焦并展开详情） */
  nextEvent(dir: number) {
    const cx = state.pan + (W / 2) / state.zoom;
    const evs = majors.filter(e => e._lane >= 0);
    let target: any = null;
    if (dir > 0) {
      target = evs.find(e => docX(eventYear(e)) > cx + 1) || evs[0];
    } else {
      for (let i = evs.length - 1; i >= 0; i--) {
        if (docX(eventYear(evs[i])) < cx - 1) { target = evs[i]; break; }
      }
      target = target || evs[evs.length - 1];
    }
    if (target) this.focusYear(eventYear(target), Math.max(state.zoom, FOCUS_Z + 0.05));
  },
  /* 跳到下一/上一时期起点 */
  periodJump(dir: number) {
    const cx = state.pan + (W / 2) / state.zoom;
    let p: any = null;
    if (dir > 0) p = CFG.periods.find((pp: any) => docX(pp.from) > cx - 2);
    else {
      for (let i = CFG.periods.length - 1; i >= 0; i--) {
        if (docX(CFG.periods[i].to) < cx + 2) { p = CFG.periods[i]; break; }
      }
    }
    if (p) this.focusYear(p.from + 1, Math.max(state.zoom, 1));
  },
  zoom() { return state.zoom; },
};

/* ================= 模块接口 =================
   Island 契约：不再自注册 window.Views.timeline，由包装层 index.tsx
   订阅路由参数/来源变化后单路调用（见文件头适配点 5）。 */
let inited = false;
let focusDone: string | number | null = null;

function onShow(params?: Record<string, string | number>) {
  if (params && params.focus) focusDone !== params.focus &&
    (focusDone = params.focus, (window as any).TL.focusYear(+(params.focus as number) + 0.5));
}

/* 来源切换:重排数据 + 重建长卷(prepareData 依赖 layout 分区) */
function onSourceChange() {
  if (!inited) return;             // 未 init 时由 init 按当前模式构建
  onResize();
}

function init() {
  if (inited) return;
  svg = document.getElementById('tl-svg');
  if (!svg) { console.error('[v2/timeline] #tl-svg 未入 DOM，引擎挂载中止'); return; }
  inited = true;
  onResize();          // 含 layout→prepareData(按当前来源模式,可能来自深链/本地存储)→build
  buildFilters();
  // 拖动窗口边框时 resize 连发几十次，防抖后再做全量重建（单次约 70ms）
  let resizeTimer: number | undefined;
  const scheduleResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(onResize, 150);
  };
  window.addEventListener('resize', scheduleResize);
  // 嵌入式 webview 调整窗格可能不触发 window resize,用 ResizeObserver 盯 svg 盒
  if (window.ResizeObserver) new ResizeObserver(scheduleResize).observe(svg);
  maybePlayIntro();    // 首次显影仪式（与卷轴开幕对齐，仅此一次）
}

function onResize() {
  if (!svg) return;
  W = svg.clientWidth || window.innerWidth;
  H = svg.clientHeight || window.innerHeight;
  layout();
  state.zoom = Math.max(minZoom(), Math.min(MAX_Z, state.zoom));
  state.pan = clampPan(state.pan);
  state.panY = clampPanY(state.panY);
  prepareData();         // 依赖 layout 分区(卡道数/标签道数随视口高度变化)
  build();
}

export { init, onShow, onSourceChange }
