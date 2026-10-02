/* ============================================================
   timeline.js — 时间轴视图：数字长卷（v4 固定文档模型）
   ------------------------------------------------------------
   长卷 = 一张固定宽度的"超宽网页"（文档坐标）：
   · 所有卡片/标签/印章/流派带的位置与尺寸一经排定即不变；
   · 左右拖动平移浏览（像拖动宽网页）；
   · 滚轮缩放 = 对屏幕的放大镜（整体等比缩放，锚定光标）；
   · 放大越过 focusZoom 后，视口中心的事件自动聚焦：
     事件卡套上聚焦环，抽屉同步展开其详情。
   颜色语义：点/卡左边条=类型色；底纹与群体带=时期色。
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const D = window.DATA;
  const YMIN = CFG.YEAR_MIN, YMAX = CFG.YEAR_MAX;
  const L = CFG.layout || {};
  const PXY = L.pxy || 46;
  const FOCUS_Z = L.focusZoom || 1.7;
  const MAX_Z = L.maxZoom || 4;

  const svg = document.getElementById('tl-svg');
  let W = 0, H = 0, axisY = 0;
  let zoneMajor, zoneMinor, zoneSeal, zoneBand;

  /* ---------- 文档坐标 ---------- */
  const X0_YEAR = YMIN - 1.5;                            // 1947.5
  const stripW = (YMAX + 1.5 - X0_YEAR) * PXY;           // 长卷总宽
  const docX = y => (y - X0_YEAR) * PXY;
  const eventYear = ev => ev.year + ((ev.month || 6) - 0.5) / 12;

  const state = { pan: 0, panY: 0, zoom: 1 };             // 屏幕X = (docX - pan) * zoom
  const docH = () => axisY + 70;                          // 文档总高（含刻度标注）
  const minZoom = () => Math.max(0.12, W / stripW);
  const maxPan = () => Math.max(0, stripW - W / state.zoom);
  const maxPanY = () => Math.max(0, docH() - H / state.zoom);
  const clampPan = p => Math.max(0, Math.min(maxPan(), p));
  const clampPanY = p => Math.max(0, Math.min(maxPanY(), p));

  /* ================= 数据准备（一次性静态排布） ================= */
  const impSet = new Set(D.important || []);
  const impRank = new Map((D.important || []).map((n, i) => [n, i]));
  const majors = D.events.filter(e => e.priority === 1)
    .sort((a, b) => a.year - b.year || (a.month || 6) - (b.month || 6));
  const minors = D.events.filter(e => e.priority !== 1)
    .sort((a, b) => a.year - b.year || (a.month || 6) - (b.month || 6));
  const kindOK = d => d.kind === 'event' ? filterState.event : d.kind === 'policy' ? filterState.policy : filterState.work;
  const periodColor = year =>
    (CFG.periods.find(p => year >= p.from && year < p.to) || CFG.periods[0]).color;
  const kindColor = kind => (CFG.types[kind] || CFG.types.event).color;
  const trunc = (s, n) => [...s].length > n ? [...s].slice(0, n - 1).join('') + '…' : s;

  // 主要事件卡：5 道贪心（文档坐标）
  const CARD_H = 38, CARD_GAP = 12, CARD_CHARS = 16;
  const cardW = t => [...t].length * 14 + 26;
  {
    const laneRight = [];
    for (const ev of majors) {
      const t = trunc(ev.title || ev.label, CARD_CHARS);
      const w = cardW(t);
      const X = docX(eventYear(ev));
      const cardX = Math.max(8, Math.min(X - 10, stripW - w - 8));
      let lane = -1;
      for (let li = 0; li < 5; li++) {
        if (!laneRight[li] || cardX > laneRight[li] + CARD_GAP) { lane = li; break; }
      }
      if (lane >= 0) laneRight[lane] = cardX + w;
      Object.assign(ev, { _t: t, _w: w, _x: cardX, _lane: lane });
    }
  }
  // 次要事件：4 道标签贪心，放不下的只留圆点
  const MINOR_CHARS = 14;
  {
    const laneRight = [];
    for (const ev of minors) {
      const X = docX(eventYear(ev));
      const label = trunc(ev.label, MINOR_CHARS);
      const lw = [...label].length * 11 + 14;
      let lane = -1;
      for (let li = 0; li < 4; li++) {
        if (!laneRight[li] || X + 7 > laneRight[li] + 10) { lane = li; break; }
      }
      if (lane >= 0) laneRight[lane] = X + 7 + lw;
      Object.assign(ev, { _label: label, _lane: lane });
    }
  }
  // 人物印章：按时期静态排列（每时期两行，宽度放不下即止）
  const personsByPeriod = new Map(CFG.periods.map(p => [p.id, []]));
  {
    const clampY = y => Math.max(YMIN, Math.min(YMAX, y));
    const periodOf = y => CFG.periods.find(p => y >= p.from && y < p.to) || (y < 1949 ? CFG.periods[0] : CFG.periods[4]);
    for (const e of D.entities) {
      if (e.type !== 'person' || !e.birth || !impSet.has(e.name)) continue;
      personsByPeriod.get(periodOf(clampY(+e.birth + 28)).id).push(e);
    }
    for (const arr of personsByPeriod.values())
      arr.sort((a, b) => (impRank.get(a.name) ?? 999) - (impRank.get(b.name) ?? 999));
  }
  // 群体带：3 道贪心
  const bands = (D.bands || []).slice().sort((a, b) => (a.from - b.from) || (b.to - a.to));
  {
    const laneRight = [];
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
  let gContent, gFocusRing;
  let majorSel, minorSel, bandSel, periodSel;

  function build() {
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

      /* 时期底纹 */
      gContent.selectAll('.wash').data(CFG.periods).join('rect')
        .attr('class', 'wash')
        .attr('x', p => docX(p.from)).attr('width', p => (p.to - p.from) * PXY)
        .attr('y', 0).attr('height', '100%')
        .attr('fill', p => p.color).attr('opacity', .05);

      /* ① 时期题字 */
      periodSel = gContent.selectAll('.period').data(CFG.periods).join('g').attr('class', 'period');
      periodSel.append('line')
        .attr('x1', p => docX(p.from)).attr('x2', p => docX(p.from))
        .attr('y1', 26).attr('y2', axisY)
        .attr('stroke', '#b3342e').attr('stroke-width', 1)
        .attr('stroke-dasharray', '1,6').attr('opacity', .5);
      periodSel.append('rect')
        .attr('x', p => docX(p.from)).attr('width', p => (p.to - p.from) * PXY)
        .attr('y', -2).attr('height', 4).attr('rx', 2)
        .attr('fill', p => p.color).attr('opacity', .3);
      periodSel.each(function (p) {
        const g = d3.select(this);
        const xT = docX(p.from) + 12;
        g.selectAll('.vp').data([...p.name.replace('文学', '')]).join('text')
          .attr('class', 'vp tl-period-label').attr('font-size', 24)
          .attr('x', xT).attr('y', (d, i) => 64 + i * 29).text(d => d);
        g.selectAll('.vtheme').data([...p.theme]).join('text')
          .attr('class', 'vtheme tl-period-theme').attr('font-size', 10)
          .attr('x', xT + 27).attr('y', (d, i) => 64 + i * 13).text(d => d);
        g.append('text').attr('font-size', 10.5)
          .attr('fill', p.color).attr('font-weight', 600)
          .attr('x', xT).attr('y', 20).text(p.from + ' – ' + p.to);
      });

      /* 主轴 + 年份刻度（每年一刻度） */
      gContent.append('line').attr('class', 'axis-line')
        .attr('x1', 0).attr('x2', stripW).attr('y1', axisY).attr('y2', axisY)
        .attr('filter', 'url(#brush-wobble)')
        .attr('stroke', 'var(--ink-1)').attr('stroke-width', 3).attr('stroke-linecap', 'round');
      gContent.append('line')
        .attr('x1', 0).attr('x2', stripW).attr('y1', axisY).attr('y2', axisY)
        .attr('stroke', 'var(--ink-0)').attr('stroke-width', 1).attr('opacity', .55);
      const years = d3.range(YMIN, YMAX + 1);
      const tickG = gContent.selectAll('.tick').data(years).join('g').attr('class', 'tick');
      tickG.append('line')
        .attr('x1', docX).attr('x2', docX)
        .attr('y1', axisY).attr('y2', d => axisY + (d % 10 === 0 ? 13 : 7))
        .attr('stroke', d => d % 10 === 0 ? 'var(--ink-1)' : 'var(--ink-3)')
        .attr('stroke-width', d => d % 10 === 0 ? 1.6 : 1);
      tickG.append('text')
        .attr('x', docX).attr('y', axisY + 28).attr('text-anchor', 'middle')
        .attr('font-size', d => d % 10 === 0 ? 13 : 10.5)
        .attr('class', d => 'tl-year-label' + (d % 10 === 0 ? ' decade' : ''))
        .text(d => d);

      /* ④ 群体带（静态） */
      bandSel = gContent.selectAll('.band').data(bands.filter(b => b._lane >= 0)).join('g')
        .attr('class', 'band').style('cursor', 'pointer')
        .attr('transform', b => `translate(0,${zoneBand.bottom - b._lane * zoneBand.laneH - 14})`);
      bandSel.append('rect').attr('class', 'b-fill')
        .attr('x', b => docX(b.from)).attr('width', b => Math.max(6, (b.to - b.from) * PXY))
        .attr('height', 14).attr('rx', 7)
        .attr('fill', b => periodColor(b.from)).attr('opacity', .18);
      bandSel.append('rect').attr('class', 'b-stroke')
        .attr('x', b => docX(b.from)).attr('width', b => Math.max(6, (b.to - b.from) * PXY))
        .attr('height', 14).attr('rx', 7)
        .attr('fill', 'none').attr('stroke', b => periodColor(b.from)).attr('stroke-opacity', .4);
      bandSel.append('text').attr('class', 'b-label')
        .attr('font-size', 10.5)
        .attr('paint-order', 'stroke').attr('stroke', 'var(--paper-0)').attr('stroke-width', 3)
        .attr('y', 11);
      bandSel.each(function (b) {
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
      sealG.each(function (p) {
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
            .on('click', () => window.openDrawerEntity(person.name));
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

      /* ② 次要事件（静态：标签或仅圆点） */
      minorSel = gContent.selectAll('.minor').data(minors).join('g').attr('class', 'minor')
        .style('cursor', 'pointer');
      minorSel.each(function (ev) {
        const g = d3.select(this);
        const X = docX(eventYear(ev));
        const hasLabel = ev._lane >= 0;
        const ly = zoneMinor.bottom - ev._lane * 15;
        if (hasLabel) g.append('line')
          .attr('x1', X).attr('x2', X).attr('y1', axisY - 6).attr('y2', ly + 4)
          .attr('stroke', 'var(--ink-3)').attr('stroke-width', .8).attr('stroke-dasharray', '2,3');
        g.append('circle').attr('r', 3)
          .attr('cx', X).attr('cy', axisY)
          .attr('fill', kindColor(ev.kind)).attr('opacity', .85);
        if (hasLabel) g.append('text')
          .attr('x', X + 7).attr('y', ly - 4)
          .attr('font-size', 11).attr('fill', 'var(--ink-2)')
          .attr('paint-order', 'stroke').attr('stroke', 'var(--paper-0)').attr('stroke-width', 3)
          .text(ev._label);
        g.append('title').text(ev.label + '（' + ev.year + '）');   // 原生悬停提示
      });

      /* ② 主要事件卡（静态） */
      majorSel = gContent.selectAll('.major').data(majors).join('g').attr('class', 'major')
        .style('cursor', 'pointer');
      majorSel.each(function (ev) {
        const g = d3.select(this);
        const X = docX(eventYear(ev));
        g.append('line')
          .attr('x1', X).attr('x2', X)
          .attr('y1', axisY - 4)
          .attr('y2', ev._lane >= 0 ? zoneMajor.top + ev._lane * zoneMajor.laneH + CARD_H + 2 : axisY - 10)
          .attr('stroke', '#b3342e').attr('stroke-width', 1).attr('stroke-dasharray', '3,4').attr('opacity', .4);
        g.append('circle').attr('r', 8)
          .attr('cx', X).attr('cy', axisY)
          .attr('fill', '#b3342e').attr('opacity', .22).attr('filter', 'url(#ink-halo)');
        g.append('circle').attr('r', 5)
          .attr('cx', X).attr('cy', axisY)
          .attr('fill', '#b3342e').attr('stroke', 'var(--paper-1)').attr('stroke-width', 1.5);
        if (ev._lane >= 0) {
          const cy = zoneMajor.top + ev._lane * zoneMajor.laneH;
          g.append('rect')
            .attr('x', ev._x).attr('y', cy).attr('width', ev._w).attr('height', CARD_H).attr('rx', 3)
            .attr('fill', 'var(--paper-1)').attr('stroke', 'var(--paper-edge)')
            .style('filter', 'drop-shadow(0 2px 5px var(--paper-shadow))');
          g.append('rect')
            .attr('x', ev._x).attr('y', cy).attr('width', 3).attr('height', CARD_H).attr('rx', 1.5)
            .attr('fill', kindColor(ev.kind));
          g.append('text')
            .attr('x', ev._x + 11).attr('y', cy + 16)
            .attr('font-size', 13.5).attr('fill', 'var(--ink-0)')
            .attr('font-family', 'var(--font-brush)')
            .text(ev._t);
          g.append('text')
            .attr('x', ev._x + 11).attr('y', cy + 30)
            .attr('font-size', 9.5).attr('fill', '#b3342e')
            .text(ev.year + (ev.month ? '.' + ev.month : ''));
        }
        g.append('title').text((ev.title || ev.label) + '（' + ev.year + '.' + (ev.month || '') + '）');
      });

      /* 聚焦环（最上层） */
      gFocusRing = gContent.append('g').attr('class', 'focus-ring').attr('display', 'none');
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
      window.__tlBuildErr = String(err && err.stack || err);
      console.error('[timeline build]', err);
    }
  }

  /* ================= 分区（静态） ================= */
  function layout() {
    axisY = Math.max(600, H * 0.8);
    zoneBand = { bottom: axisY - 6, laneH: 16, lanes: 3 };
    zoneSeal = { bottom: axisY - 10 - zoneBand.lanes * zoneBand.laneH - 6, rowH: 22 };
    zoneMinor = { bottom: zoneSeal.bottom - 2 * zoneSeal.rowH - 8, lanes: 4 };
    const majorTop = 258;
    const majorBottom = zoneMinor.bottom - zoneMinor.lanes * 15 - 10;
    const lanes = Math.max(3, Math.min(5, Math.floor((majorBottom - majorTop) / 46)));
    zoneMajor = { top: majorTop, bottom: majorBottom, lanes, laneH: (majorBottom - majorTop) / lanes };
  }

  /* ================= 渲染（仅变换 + 聚焦 + 缩略图） ================= */
  let raf = null;
  function requestRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; render(); });
  }

  function render() {
    const z = state.zoom;
    gContent.attr('transform', `scale(${z}) translate(${(-state.pan).toFixed(2)},${(-state.panY).toFixed(2)})`);
    renderMinimap();
    updateFocus();
  }

  /* ---------- 聚焦：放大越过阈值 → 视口中心事件入环 + 抽屉展开 ----------
     主要事件以圆点（真实时间位置）计距并强优先；次要事件仅在
     附近没有主要事件且高度居中时才聚焦。缩小退回阈值以下时，
     若抽屉仍显示聚焦事件则自动收起。 */
  let focused = null;
  function updateFocus() {
    if (state.zoom < FOCUS_Z) {
      if (focused) {
        focused = null;
        gFocusRing.attr('display', 'none');
        const drawerEl = document.getElementById('drawer');
        const titleEl = document.getElementById('drawer-title');
        if (drawerEl.classList.contains('open') && titleEl.textContent === lastAutoTitle) {
          drawerEl.classList.remove('open');
        }
      }
      return;
    }
    const cxD = state.pan + (W / 2) / state.zoom;
    let best = null, bestD = Infinity, bestIsMajor = false;
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
          gFocusRing.attr('display', null);
          gFocusRing.select('rect').attr('display', null)
            .attr('x', best._x - 5).attr('y', cy - 5)
            .attr('width', best._w + 10).attr('height', CARD_H + 10);
          gFocusRing.select('circle').attr('display', 'none');
        } else {
          gFocusRing.attr('display', null);
          gFocusRing.select('rect').attr('display', 'none');
          gFocusRing.select('circle').attr('display', null)
            .attr('cx', docX(eventYear(best))).attr('cy', axisY)
            .attr('r', 10);
        }
        lastAutoTitle = best.title || best.label;
        window.openDrawerEvent(best);
      }
    } else if (focused) {
      focused = null;
      gFocusRing.attr('display', 'none');
    }
  }
  let lastAutoTitle = '';

  /* ================= 交互 ================= */
  const filterState = { event: true, policy: true, work: true, person: true, band: true };

  function applyFilters() {
    majorSel.attr('display', d => kindOK(d) ? null : 'none');
    minorSel.attr('display', d => kindOK(d) ? null : 'none');
    d3.selectAll('.band').attr('display', filterState.band ? null : 'none');
    d3.selectAll('.seal').attr('display', filterState.person ? null : 'none');
    // 父组（时期印章容器）不隐藏，由子元素控制
  }

  function bindInteractions() {
    const tlView = document.getElementById('view-timeline');

    // 滚轮 = 屏幕缩放（锚定光标，横纵同时）
    tlView.onwheel = e => {
      e.preventDefault();
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

    // 拖拽 = 平移（横向 + 纵向）
    let dragging = false, dragX = 0, dragY = 0, pan0 = 0, panY0 = 0, moved = false;
    tlView.onmousedown = e => {
      if (e.target.closest('#tl-filters') || e.target.closest('#tl-minimap')) return;
      dragging = true; moved = false;
      dragX = e.clientX; dragY = e.clientY;
      pan0 = state.pan; panY0 = state.panY;
      tlView.classList.add('dragging');
    };
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - dragX, dy = e.clientY - dragY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      state.pan = clampPan(pan0 - dx / state.zoom);
      state.panY = clampPanY(panY0 - dy / state.zoom);
      requestRender();
    });
    window.addEventListener('mouseup', () => { dragging = false; tlView.classList.remove('dragging'); });

    // 触摸平移 + 双指缩放
    let tPrev = null;
    tlView.ontouchstart = e => {
      tPrev = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
    };
    tlView.ontouchmove = e => {
      e.preventDefault();
      const ts = [...e.touches].map(t => ({ x: t.clientX, y: t.clientY }));
      if (tPrev && tPrev.length === 1 && ts.length === 1) {
        state.pan = clampPan(state.pan - (ts[0].x - tPrev[0].x) / state.zoom);
        state.panY = clampPanY(state.panY - (ts[0].y - tPrev[0].y) / state.zoom);
      } else if (tPrev && tPrev.length === 2 && ts.length === 2) {
        const d0 = Math.hypot(tPrev[0].x - tPrev[1].x, tPrev[0].y - tPrev[1].y);
        const d1 = Math.hypot(ts[0].x - ts[1].x, ts[0].y - ts[1].y);
        const cx = (ts[0].x + ts[1].x) / 2;
        const rect = svg.getBoundingClientRect();
        const sx = cx - rect.left;
        const docAt = state.pan + sx / state.zoom;
        state.zoom = Math.max(minZoom(), Math.min(MAX_Z, state.zoom * d1 / d0));
        state.pan = clampPan(docAt - sx / state.zoom);
      }
      tPrev = ts;
      requestRender();
    };
    tlView.ontouchend = () => { tPrev = null; };

    // 点击 → 详情抽屉
    majorSel.on('click', (e, d) => { if (!moved) window.openDrawerEvent(d); });
    minorSel.on('click', (e, d) => { if (!moved) window.openDrawerEvent(d); });
    bandSel.on('click', (e, d) => { if (!moved) window.openWikiPage(d.name); });
  }

  /* ================= 图例·图层面板 ================= */
  function buildFilters() {
    const box = document.getElementById('tl-filters');
    const typeRows = [
      ['event', '事件', CFG.types.event.color],
      ['policy', '政策', CFG.types.policy.color],
      ['work', '作品·刊物', CFG.types.work.color],
      ['band', '群体·流派带', CFG.types.movement.color],
      ['person', '人物印章', CFG.types.person.color],
    ];
    const periodDots = CFG.periods.map(p =>
      `<span style="display:inline-flex;align-items:center;gap:3px;margin:2px 4px 2px 0">
        <span style="width:8px;height:8px;border-radius:2px;background:${p.color}"></span>
        <span style="font-size:11px">${p.short}</span></span>`).join('');
    box.innerHTML = `
      <div class="fl-title fl-toggle">图 例 <span class="fl-arrow">▾</span></div>
      <div class="fl-body">
      ${typeRows.map(([key, label, color]) => `
        <label><input type="checkbox" checked data-key="${key}">
          <span class="dot" style="background:${color}"></span>${label}</label>`).join('')}
      <div class="fl-title" style="margin-top:8px">时期底色</div>
      <div>${periodDots}</div>
      <div class="fl-hint">左右拖动浏览长卷<br>滚轮放大 → 聚焦中心事件</div>
      </div>`;
    box.querySelector('.fl-toggle').addEventListener('click', () => box.classList.toggle('collapsed'));
    box.querySelectorAll('input[type=checkbox]').forEach(cb =>
      cb.addEventListener('change', () => {
        filterState[cb.dataset.key] = cb.checked;
        applyFilters();
      }));
  }

  /* ================= 缩略导航（书签刻度式） ================= */
  let mm = null, mmFrame, mmHandle, mmDimL, mmDimR, mmW = 0;
  function buildMinimap() {
    const wrap = document.getElementById('tl-minimap');
    wrap.innerHTML = '';
    mmW = wrap.clientWidth || (window.innerWidth - 32);
    const h = 46;
    const xOf = year => (year - X0_YEAR) / (YMAX + 1.5 - X0_YEAR) * mmW;

    mm = d3.select(wrap).append('svg');
    mm.attr('width', mmW).attr('height', h);

    // 视口外侧压暗（聚焦"阅读窗"）
    mmDimL = mm.append('rect').attr('y', 0).attr('height', h)
      .attr('fill', 'rgba(26,23,18,.09)').style('pointer-events', 'none');
    mmDimR = mm.append('rect').attr('y', 0).attr('height', h)
      .attr('fill', 'rgba(26,23,18,.09)').style('pointer-events', 'none');

    // 基线 + 时期色段（首尾相接，消除接缝）
    mm.append('line')
      .attr('x1', 0).attr('x2', mmW).attr('y1', 34).attr('y2', 34)
      .attr('stroke', 'var(--paper-edge)').attr('stroke-width', 1);
    mm.selectAll('.mm-p').data(CFG.periods).join('rect')
      .attr('x', (p, i) => xOf(p.from))
      .attr('width', (p, i) => Math.max(2, (i + 1 < CFG.periods.length ? xOf(CFG.periods[i + 1].from) : mmW) - xOf(p.from) - 1))
      .attr('y', 32.5).attr('height', 3).attr('rx', 1.5)
      .attr('fill', p => p.color).attr('opacity', .75);

    // 里程碑：竖向书签刻度（高低区分事件/政策/作品）
    mm.selectAll('.mm-t').data(majors).join('line')
      .attr('x1', ev => xOf(eventYear(ev))).attr('x2', ev => xOf(eventYear(ev)))
      .attr('y1', 33).attr('y2', ev => 33 - (ev.kind === 'event' ? 13 : ev.kind === 'policy' ? 10 : 7))
      .attr('stroke', '#b3342e').attr('stroke-width', 1.4)
      .attr('stroke-linecap', 'round').attr('opacity', .75);

    // 年份标注（顶行）
    mm.selectAll('.mm-y').data([1949, 1966, 1976, 1989, 2000, 2018]).join('text')
      .attr('x', y => Math.max(10, Math.min(mmW - 10, xOf(y))))
      .attr('y', 10).attr('font-size', 9).attr('text-anchor', 'middle')
      .attr('font-family', 'var(--font-mono)')
      .attr('fill', 'var(--ink-3)').text(y => y);

    // 阅读窗：墨线框 + 顶部把柄
    mmFrame = mm.append('rect')
      .attr('y', 4).attr('height', h - 9).attr('rx', 3)
      .attr('fill', 'none').attr('stroke', 'var(--ink-1)').attr('stroke-width', 1.2)
      .style('cursor', 'grab');
    mmHandle = mm.append('rect')
      .attr('y', 1.5).attr('width', 22).attr('height', 3).attr('rx', 1.5)
      .attr('fill', 'var(--ink-1)')
      .style('cursor', 'grab');

    const wrapEl = wrap;
    let mmDrag = false;
    const panToClient = clientX => {
      const r = wrapEl.getBoundingClientRect();
      const frac = (clientX - r.left) / r.width;
      const docTarget = frac * stripW;
      state.pan = clampPan(docTarget - (W / 2) / state.zoom);
      requestRender();
    };
    wrapEl.onmousedown = e => { mmDrag = true; panToClient(e.clientX); };
    window.addEventListener('mousemove', e => { if (mmDrag) panToClient(e.clientX); });
    window.addEventListener('mouseup', () => mmDrag = false);

    renderMinimap();   // 建完立即定位（build() 的渲染发生在此之前）
  }

  function renderMinimap() {
    if (!mmFrame || !mmW) return;
    const x0 = state.pan / stripW * mmW;
    const vw = Math.max(14, (W / state.zoom) / stripW * mmW);
    mmFrame.attr('x', x0).attr('width', vw);
    mmHandle.attr('x', x0 + vw / 2 - 11);
    mmDimL.attr('x', 0).attr('width', Math.max(0, x0));
    mmDimR.attr('x', x0 + vw).attr('width', Math.max(0, mmW - x0 - vw));
  }

  /* ================= 平滑定位（搜索/深链/回位） ================= */
  let tween = null;
  function animateTo(targetPan, targetZoom, targetPanY = 0, ms = 600) {
    if (tween) cancelAnimationFrame(tween);
    const p0 = state.pan, z0 = state.zoom, y0 = state.panY;
    const t0 = performance.now();
    const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const step = now => {
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

  /* ================= 外部控制 ================= */
  window.TL = {
    focusYear(yearF, zoom = 2.1) {
      // yearF 为精确的分数年（如 1957.46 = 1957年6月中）
      const x = docX(yearF);
      let near = null, nd = Infinity;
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
    setZoom(z) { animateTo(state.pan + (W / 2) / state.zoom - (W / 2) / z, z, state.panY, 350); },
    panBy(dx) { state.pan = clampPan(state.pan + dx); requestRender(); },
    goYear(y) { this.focusYear(y + 0.5, Math.max(state.zoom, 1)); },
    /* 下一个/上一个里程碑事件（自动聚焦并展开详情） */
    nextEvent(dir) {
      const cx = state.pan + (W / 2) / state.zoom;
      const evs = majors.filter(e => e._lane >= 0);
      let target = null;
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
    periodJump(dir) {
      const cx = state.pan + (W / 2) / state.zoom;
      let p = null;
      if (dir > 0) p = CFG.periods.find(pp => docX(pp.from) > cx - 2);
      else {
        for (let i = CFG.periods.length - 1; i >= 0; i--) {
          if (docX(CFG.periods[i].to) < cx + 2) { p = CFG.periods[i]; break; }
        }
      }
      if (p) this.focusYear(p.from + 1, Math.max(state.zoom, 1));
    },
    zoom() { return state.zoom; },
  };

  /* ================= 模块接口 ================= */
  let inited = false;
  window.Views.timeline = {
    init() {
      if (inited) return;
      inited = true;
      onResize();          // 含 build() 与 buildMinimap()
      buildFilters();
      window.addEventListener('resize', onResize);
    },
    onShow(params) {
      if (params && params.focus) this.focusDone !== params.focus &&
        (this.focusDone = params.focus, window.TL.focusYear(+params.focus + 0.5));
    },
  };

  function onResize() {
    W = svg.clientWidth || window.innerWidth;
    H = svg.clientHeight || window.innerHeight;
    layout();
    state.zoom = Math.max(minZoom(), Math.min(MAX_Z, state.zoom));
    state.pan = clampPan(state.pan);
    state.panY = clampPanY(state.panY);
    build();
    buildMinimap();
  }
})();
