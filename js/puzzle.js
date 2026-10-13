/* ============================================================
   puzzle.js — 拼图白板视图（第五视图）
   ------------------------------------------------------------
   左侧卡片库（词条 8 类型 + 编年事件 5 时期）→ 拖上无限白板；
   卡片可移动 / 调大小 / 连线（线型 × 箭头 × 颜色 + 文字标签）；
   便签（双击空白）、分组框（拖动带动框内卡片）；
   localStorage 防抖自动保存 + 导出 / 导入 JSON。
   交互统一 Pointer Events；滚轮锚定光标缩放；双指捏合。
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG;
  const D = window.DATA;
  const PCFG = CFG.puzzle;

  /* ---------------- 工具 ---------------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const trunc = (s, n) => { s = String(s || ''); return [...s].length > n ? [...s].slice(0, n).join('') + '…' : s; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const LINK_VAR = { ink: '--ink-2', cinnabar: '--cinnabar', gold: '--gold' };
  const LINK_LABEL = { ink: '墨', cinnabar: '朱砂', gold: '金' };
  const LINE_TYPES = [['solid', '实线'], ['dash', '虚线'], ['dot', '点线']];
  const ARROW_TYPES = [['none', '无'], ['ab', '→'], ['ba', '←'], ['both', '↔']];

  const entityByName = new Map(D.entities.map(e => [e.name, e]));
  const eventById = new Map(D.events.map(ev => [ev.id, ev]));

  /* ---------------- 状态 ---------------- */
  let inited = false;
  const state = {
    cards: [],   // {uid, kind:'entity'|'event'|'note', ref, x, y, w, h, z, text}
    links: [],   // {uid, a, b, line, arrow, color, label}
    groups: [],  // {uid, title, x, y, w, h}
    view: { k: 1, x: 0, y: 0 },
    seq: 1,
  };
  let sel = null;            // {type:'card'|'link'|'group', uid}
  let activeLinkDrag = null; // 连线拖拽进行中(Esc 可取消)

  /* DOM 引用 */
  let root, viewport, board, edgeSvg, gEdges, layerGroups, layerCards;
  let libPanel, libInput, libChips, libList;
  let toolbar, stylebar, emptyEl, undoEl, importFile;
  let zoomLabel;

  const cardByUid = uid => state.cards.find(c => c.uid === uid);
  const groupByUid = uid => state.groups.find(g => g.uid === uid);
  const linkByUid = uid => state.links.find(l => l.uid === uid);

  /* ================= 初始化 ================= */
  function init() {
    if (inited) return;
    inited = true;
    try {
      root = document.getElementById('view-puzzle');
      buildLibraryData(); // 先备好库数据：buildDOM 内的 bindLibrary 渲染 chips/列表依赖它
      buildDOM();
      load();
      renderAll();
      bindBoard();
      if (!load.savedView) { // 首次进入：世界原点置于屏幕中心
        const r = viewport.getBoundingClientRect();
        state.view = { k: 1, x: r.width / 2, y: r.height / 2 };
      }
      applyView();
    } catch (err) {
      // init 在 DOMContentLoaded 路由时执行,若此处抛错,load 时的二次路由会被
      // 上面的 inited 守卫挡回——错误必须在这里显式暴露,否则视图静默残废
      inited = false;
      window.__pzErr = String(err && err.stack || err);
      throw err;
    }
  }

  /* ---------------- DOM 骨架 ---------------- */
  function buildDOM() {
    libPanel = document.getElementById('pz-library');
    viewport = document.getElementById('pz-viewport');
    toolbar = document.getElementById('pz-toolbar');
    stylebar = document.getElementById('pz-stylebar');
    emptyEl = document.getElementById('pz-empty');
    undoEl = document.getElementById('pz-undo');
    zoomLabel = document.getElementById('pz-zoom');
    importFile = document.getElementById('pz-import-file');

    // 库面板
    libPanel.innerHTML = `
      <div class="pz-lib-head">卡片库</div>
      <div class="pz-lib-search"><input id="pz-lib-input" type="text" placeholder="搜索卡片名 / 标签…" spellcheck="false"></div>
      <div id="pz-lib-chips"></div>
      <div id="pz-lib-list"></div>
      <div class="pz-lib-foot">卡色 = 词条类型（同图谱）<br>金底卡 = 自由便签 · 墨晕框 = 分组</div>`;
    libInput = libPanel.querySelector('#pz-lib-input');
    libChips = libPanel.querySelector('#pz-lib-chips');
    libList = libPanel.querySelector('#pz-lib-list');

    // 画布内容层：分组框(底) → 连线 SVG → 卡片(顶)
    board = document.createElement('div');
    board.id = 'pz-board';
    board.innerHTML = `
      <div id="pz-groups"></div>
      <svg id="pz-edges"></svg>
      <div id="pz-cards"></div>`;
    viewport.insertBefore(board, viewport.firstChild);
    layerGroups = board.querySelector('#pz-groups');
    edgeSvg = board.querySelector('#pz-edges');
    layerCards = board.querySelector('#pz-cards');
    gEdges = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    edgeSvg.appendChild(gEdges);

    buildToolbar();
    buildStylebar();
    bindLibrary();

    // 窄屏库面板开合
    const libBtn = document.getElementById('pz-lib-btn');
    if (libBtn) libBtn.addEventListener('click', () => libPanel.classList.toggle('open'));
  }

  /* ================= 视图变换（平移 / 缩放） ================= */
  function applyView() {
    const v = state.view;
    board.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    const g = PCFG.grid * v.k;
    viewport.style.backgroundSize = `${g}px ${g}px`;
    viewport.style.backgroundPosition = `${v.x}px ${v.y}px`;
    if (zoomLabel) zoomLabel.textContent = Math.round(v.k * 100) + '%';
    renderEdges();          // 箭头 / 虚线 / 命中域按 k 重算（保持屏幕恒宽）
    if (sel && sel.type === 'link') positionStylebar(linkByUid(sel.uid));
  }

  function screenToWorld(cx, cy) {
    const r = viewport.getBoundingClientRect();
    const v = state.view;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  }
  function centerWorld() {
    const r = viewport.getBoundingClientRect();
    return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  function zoomAt(factor, cx, cy) { // cx/cy 为视口内坐标
    const v = state.view;
    const k = clamp(v.k * factor, PCFG.zoomMin, PCFG.zoomMax);
    if (k === v.k) return;
    v.x = cx - (cx - v.x) * (k / v.k);
    v.y = cy - (cy - v.y) * (k / v.k);
    v.k = k;
    applyView();
    markDirty();
  }

  function fit() {
    const r = viewport.getBoundingClientRect();
    const items = [...state.cards, ...state.groups];
    if (!items.length) {
      state.view = { k: 1, x: r.width / 2, y: r.height / 2 };
      applyView(); markDirty(); return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of items) {
      x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y);
      x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h);
    }
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const k = clamp(Math.min((r.width - 100) / w, (r.height - 140) / h), PCFG.zoomMin, 1.5);
    const v = state.view;
    v.k = k;
    v.x = r.width / 2 - (x0 + w / 2) * k;
    v.y = r.height / 2 - (y0 + h / 2) * k;
    applyView();
    markDirty();
  }

  function focusCard(c) {
    const r = viewport.getBoundingClientRect();
    const v = state.view;
    v.x = r.width / 2 - (c.x + c.w / 2) * v.k;
    v.y = r.height / 2 - (c.y + c.h / 2) * v.k;
    applyView();
    select('card', c.uid);
  }

  /* ================= 卡片 ================= */
  function cardMeta(c) {
    if (c.kind === 'entity') {
      const e = entityByName.get(c.ref);
      if (!e) return null;
      return e;
    }
    if (c.kind === 'event') return eventById.get(c.ref) || null;
    return c;
  }
  function cardColor(c) {
    if (c.kind === 'note') return 'var(--gold)';
    const m = cardMeta(c);
    const t = m ? (m.type || (m.kind === 'work' || m.kind === 'policy' ? m.kind : 'event')) : 'other';
    return (CFG.types[t] || CFG.types.other).color;
  }

  function addCard(kind, ref, wx, wy, opts = {}) {
    if (kind !== 'note' && !cardMeta({ kind, ref })) return null;
    const size = PCFG.cardSize[kind] || PCFG.cardSize.entity;
    const c = {
      uid: 'u' + (state.seq++), kind, ref: ref || '',
      x: Math.round(wx - size[0] / 2), y: Math.round(wy - size[1] / 2),
      w: size[0], h: size[1], z: state.seq++,
      text: opts.text || '',
    };
    state.cards.push(c);
    renderCards();
    refreshLibMarks();
    markDirty();
    return c;
  }

  function positionCard(el, c) {
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
    el.style.width = c.w + 'px'; el.style.height = c.h + 'px';
  }

  function buildCardEl(c) {
    const el = document.createElement('div');
    el.className = 'pz-card kind-' + c.kind;
    el.dataset.uid = c.uid;
    const color = cardColor(c);
    if (c.kind === 'note') {
      el.innerHTML = `
        <div class="pz-c-bar" style="background:${color}"></div>
        <div class="pz-c-drag" title="拖动便签">✎</div>
        <div class="pz-c-note" data-edit contenteditable="true" spellcheck="false">${esc(c.text)}</div>
        <div class="pz-resize" title="调整大小"></div>
        <div class="pz-ports"><i class="pz-port" data-p="n" title="拖出连线"></i><i class="pz-port" data-p="s" title="拖出连线"></i><i class="pz-port" data-p="w" title="拖出连线"></i><i class="pz-port" data-p="e" title="拖出连线"></i></div>`;
      const body = el.querySelector('.pz-c-note');
      body.addEventListener('input', () => { c.text = body.textContent; markDirty(); });
      body.addEventListener('pointerdown', ev => ev.stopPropagation());
      body.addEventListener('paste', ev => {   // 便签只收纯文本
        ev.preventDefault();
        const t = ev.clipboardData ? ev.clipboardData.getData('text/plain') : '';
        document.execCommand('insertText', false, t);
      });
      el.querySelector('.pz-c-drag').addEventListener('pointerdown', ev => startCardMove(ev, c, el));
    } else {
      const m = cardMeta(c);
      const t = CFG.types[m.type || (m.kind === 'work' || m.kind === 'policy' ? m.kind : 'event')] || CFG.types.other;
      let title = '', sub = '', body = '';
      if (c.kind === 'entity') {
        title = m.name;
        sub = m.birth ? `${m.birth}${m.death ? '—' + m.death : ''}` : (m.era || m.role || m.year || '');
        body = m.summary || '';
      } else {
        title = m.title || trunc(m.label, 20);
        sub = `${m.year}${m.month ? '.' + m.month : ''} · ${m.src === 'hong' ? '洪' : m.src === 'curated' ? '策' : '朱'}`;
        body = m.title ? trunc(m.label, 60) : (m.blurb || '');
      }
      el.innerHTML = `
        <div class="pz-c-bar" style="background:${color}"></div>
        <div class="pz-c-main">
          <div class="pz-c-title" title="${esc(title)}">${esc(title)}</div>
          ${sub ? `<div class="pz-c-sub">${esc(sub)}</div>` : ''}
          ${body ? `<div class="pz-c-body">${esc(body)}</div>` : ''}
        </div>
        <span class="pz-c-glyph" style="color:${color};border-color:${color}">${t.glyph}</span>
        <button class="pz-c-info" title="查看详情">ⓘ</button>
        <div class="pz-resize" title="调整大小"></div>
        <div class="pz-ports"><i class="pz-port" data-p="n" title="拖出连线"></i><i class="pz-port" data-p="s" title="拖出连线"></i><i class="pz-port" data-p="w" title="拖出连线"></i><i class="pz-port" data-p="e" title="拖出连线"></i></div>`;
      el.querySelector('.pz-c-info').addEventListener('pointerdown', ev => ev.stopPropagation());
      el.querySelector('.pz-c-info').addEventListener('click', ev => {
        ev.stopPropagation();
        if (c.kind === 'entity') window.openDrawerEntity(c.ref);
        else window.openDrawerEvent(cardMeta(c));
      });
      el.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        if (c.kind === 'entity') window.openDrawerEntity(c.ref);
        else window.openDrawerEvent(cardMeta(c));
      });
    }
    el.addEventListener('pointerdown', ev => onCardPointerDown(ev, c, el));
    positionCard(el, c);
    el.style.zIndex = 10 + (c.z % 1000000);   // 分组框(1)与连线层(2)之上
    return el;
  }

  function onCardPointerDown(e, c, el) {
    if (e.button !== 0) return;
    const port = e.target.closest('.pz-port');
    if (port) { e.stopPropagation(); startLinkDrag(e, c, el, port.dataset.p); return; }
    if (e.target.closest('.pz-resize')) { e.stopPropagation(); startCardResize(e, c, el); return; }
    if (e.target.closest('[data-edit]') || e.target.closest('.pz-c-info')) { e.stopPropagation(); return; }
    e.stopPropagation();
    startCardMove(e, c, el);
  }

  function startCardMove(e, c, el) {
    c.z = state.seq++;                       // 置顶
    el.style.zIndex = 10 + (c.z % 1000000);
    const start = { px: e.clientX, py: e.clientY, cx: c.x, cy: c.y };
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const mv = ev => {
      const dx = (ev.clientX - start.px) / state.view.k;
      const dy = (ev.clientY - start.py) / state.view.k;
      if (!moved && Math.hypot(ev.clientX - start.px, ev.clientY - start.py) < 3) return;
      moved = true;
      c.x = start.cx + dx; c.y = start.cy + dy;
      positionCard(el, c);
      updateAttachedLinks(c.uid);
    };
    const up = () => {
      el.removeEventListener('pointermove', mv);
      if (!moved) select('card', c.uid);
      else markDirty();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  }

  function startCardResize(e, c, el) {
    select('card', c.uid);
    const start = { px: e.clientX, py: e.clientY, w: c.w, h: c.h };
    el.setPointerCapture(e.pointerId);
    const mv = ev => {
      c.w = Math.max(PCFG.cardMin.w, Math.round(start.w + (ev.clientX - start.px) / state.view.k));
      c.h = Math.max(PCFG.cardMin.h, Math.round(start.h + (ev.clientY - start.py) / state.view.k));
      positionCard(el, c);
      updateAttachedLinks(c.uid);
    };
    const up = () => { el.removeEventListener('pointermove', mv); markDirty(); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  }

  function renderCards() {
    layerCards.innerHTML = '';
    for (const c of state.cards) layerCards.appendChild(buildCardEl(c));
    if (sel && sel.type === 'card') {
      const el = layerCards.querySelector(`[data-uid="${sel.uid}"]`);
      if (el) el.classList.add('sel');
    }
    updateEmpty();
  }

  /* ================= 连线 ================= */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function anchor(c, side) {
    switch (side) {
      case 'n': return [c.x + c.w / 2, c.y];
      case 's': return [c.x + c.w / 2, c.y + c.h];
      case 'w': return [c.x, c.y + c.h / 2];
      default:  return [c.x + c.w, c.y + c.h / 2];
    }
  }
  function linkGeom(l) {
    const a = cardByUid(l.a), b = cardByUid(l.b);
    if (!a || !b) return null;
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2);
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    const horiz = Math.abs(dx) > Math.abs(dy);
    const s1 = horiz ? (dx >= 0 ? 'e' : 'w') : (dy >= 0 ? 's' : 'n');
    const s2 = horiz ? (dx >= 0 ? 'w' : 'e') : (dy >= 0 ? 'n' : 's');
    const p1 = anchor(a, s1), p2 = anchor(b, s2);
    const off = clamp(Math.hypot(dx, dy) / 3, 24, 140);
    const c1 = [p1[0] + (horiz ? (dx >= 0 ? off : -off) : 0), p1[1] + (horiz ? 0 : (dy >= 0 ? off : -off))];
    const c2 = [p2[0] - (horiz ? (dx >= 0 ? off : -off) : 0), p2[1] - (horiz ? 0 : (dy >= 0 ? off : -off))];
    return { p1, p2, c1, c2, mid: [(p1[0] + 3 * c1[0] + 3 * c2[0] + p2[0]) / 8, (p1[1] + 3 * c1[1] + 3 * c2[1] + p2[1]) / 8] };
  }
  const pathD = g => `M${g.p1[0]},${g.p1[1]} C${g.c1[0]},${g.c1[1]} ${g.c2[0]},${g.c2[1]} ${g.p2[0]},${g.p2[1]}`;
  function arrowD(tip, from) { // tip:终点; from:控制点(箭头指向 = from→tip)
    const k = state.view.k;
    const L = 9 / k, W = 3.8 / k;
    const dx = tip[0] - from[0], dy = tip[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    return `M${tip[0]},${tip[1]} L${tip[0] - ux * L - uy * W},${tip[1] - uy * L + ux * W} L${tip[0] - ux * L + uy * W},${tip[1] - uy * L - ux * W} Z`;
  }
  function dashOf(l) {
    const k = state.view.k;
    if (l.line === 'dash') return `${7 / k} ${5 / k}`;
    if (l.line === 'dot') return `${2 / k} ${4.2 / k}`;
    return '';
  }

  function addLink(aUid, bUid) {
    if (aUid === bUid) return null;
    const l = { uid: 'u' + (state.seq++), a: aUid, b: bUid, line: 'solid', arrow: 'ab', color: 'ink', label: '' };
    state.links.push(l);
    renderEdges();
    markDirty();
    return l;
  }

  function buildLinkEl(l) {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'pz-link');
    g.dataset.uid = l.uid;
    g.dataset.a = l.a;
    g.dataset.b = l.b;
    const hit = document.createElementNS(SVGNS, 'path');
    hit.setAttribute('class', 'pz-l-hit');
    const line = document.createElementNS(SVGNS, 'path');
    line.setAttribute('class', 'pz-l-line');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    const a1 = document.createElementNS(SVGNS, 'path'); // b 端箭头
    a1.setAttribute('class', 'pz-l-arrow pz-l-ab');
    const a2 = document.createElementNS(SVGNS, 'path'); // a 端箭头
    a2.setAttribute('class', 'pz-l-arrow pz-l-ba');
    const label = document.createElementNS(SVGNS, 'text');
    label.setAttribute('class', 'pz-l-label');
    label.setAttribute('text-anchor', 'middle');
    g.append(hit, line, a1, a2, label);
    g.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      select('link', l.uid);
    });
    g.addEventListener('dblclick', e => {
      e.stopPropagation();
      select('link', l.uid);
      const inp = stylebar.querySelector('.pz-sb-label');
      if (inp) { inp.focus(); inp.select(); }
    });
    updateLinkEl(g, l);
    return g;
  }

  function updateLinkEl(g, l) {
    const geo = linkGeom(l);
    const colorVar = `var(${LINK_VAR[l.color] || LINK_VAR.ink})`;
    const k = state.view.k;
    const hit = g.querySelector('.pz-l-hit'), line = g.querySelector('.pz-l-line');
    const a1 = g.querySelector('.pz-l-ab'), a2 = g.querySelector('.pz-l-ba');
    const label = g.querySelector('.pz-l-label');
    if (!geo) { g.style.display = 'none'; return; }
    g.style.display = '';
    const d = pathD(geo);
    hit.setAttribute('d', d);
    hit.setAttribute('stroke-width', 16 / k);
    line.setAttribute('d', d);
    line.style.stroke = colorVar;
    line.setAttribute('stroke-dasharray', dashOf(l));
    const showAb = l.arrow === 'ab' || l.arrow === 'both';
    const showBa = l.arrow === 'ba' || l.arrow === 'both';
    a1.style.display = showAb ? '' : 'none';
    a2.style.display = showBa ? '' : 'none';
    if (showAb) { a1.setAttribute('d', arrowD(geo.p2, geo.c2)); a1.style.fill = colorVar; }
    if (showBa) { a2.setAttribute('d', arrowD(geo.p1, geo.c1)); a2.style.fill = colorVar; }
    label.setAttribute('x', geo.mid[0]);
    label.setAttribute('y', geo.mid[1]);
    label.setAttribute('font-size', 12.5 / k);
    label.setAttribute('stroke-width', 3.5 / k);
    label.textContent = l.label || '';
  }

  function renderEdges() {
    gEdges.innerHTML = '';
    for (const l of state.links) {
      const g = buildLinkEl(l);
      if (sel && sel.type === 'link' && sel.uid === l.uid) g.classList.add('sel');
      gEdges.appendChild(g);
    }
  }
  function updateAttachedLinks(cardUid) {
    for (const g of gEdges.children) {
      if (g.dataset.a === cardUid || g.dataset.b === cardUid) {
        const l = linkByUid(g.dataset.uid);
        if (l) updateLinkEl(g, l);
      }
    }
  }

  /* 连线拖拽（从端口到目标卡） */
  function startLinkDrag(e, c, el, side) {
    const p1 = anchor(c, side);
    const temp = document.createElementNS(SVGNS, 'path');
    temp.setAttribute('class', 'pz-l-temp');
    temp.setAttribute('vector-effect', 'non-scaling-stroke');
    edgeSvg.appendChild(temp);
    let targetUid = null, targetEl = null, dead = false;
    activeLinkDrag = true;
    el.setPointerCapture(e.pointerId);
    const cleanup = () => {
      dead = true;
      activeLinkDrag = null;
      temp.remove();
      if (targetEl) targetEl.classList.remove('target');
      el.removeEventListener('pointermove', mv);
    };
    const mv = ev => {
      if (dead) return;
      const w = screenToWorld(ev.clientX, ev.clientY);
      temp.setAttribute('d', `M${p1[0]},${p1[1]} C${p1[0]},${p1[1]} ${w.x},${w.y} ${w.x},${w.y}`);
      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const cardEl = hitEl && hitEl.closest ? hitEl.closest('.pz-card') : null;
      if (cardEl !== targetEl) {
        if (targetEl) targetEl.classList.remove('target');
        targetEl = (cardEl && cardEl.dataset.uid !== c.uid) ? cardEl : null;
        if (targetEl) targetEl.classList.add('target');
        targetUid = targetEl ? targetEl.dataset.uid : null;
      }
    };
    const up = () => {
      if (dead) return;
      cleanup();
      if (targetUid) {
        const l = addLink(c.uid, targetUid);
        if (l) select('link', l.uid);
      }
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
    activeLinkDrag.cancel = () => {
      if (dead) return false;
      cleanup();
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* 已释放 */ }
      return true;
    };
  }

  /* ---------------- 连线样式条 ---------------- */
  function buildStylebar() {
    stylebar.innerHTML = `
      <div class="pz-sb-row"><span class="pz-sb-lab">线型</span>
        <div class="pz-sb-seg" data-k="line">${LINE_TYPES.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div></div>
      <div class="pz-sb-row"><span class="pz-sb-lab">箭头</span>
        <div class="pz-sb-seg" data-k="arrow">${ARROW_TYPES.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div></div>
      <div class="pz-sb-row"><span class="pz-sb-lab">颜色</span>
        <div class="pz-sb-seg pz-sb-colors" data-k="color">${Object.keys(LINK_VAR).map(v =>
          `<button data-v="${v}" title="${LINK_LABEL[v]}"><i style="background:var(${LINK_VAR[v]})"></i>${LINK_LABEL[v]}</button>`).join('')}</div></div>
      <div class="pz-sb-row pz-sb-last">
        <input class="pz-sb-label" type="text" placeholder="标签（如：影响 / 师承）" spellcheck="false">
        <button class="pz-sb-del" title="删除这条连线">✕ 删除</button>
      </div>`;
    stylebar.addEventListener('pointerdown', e => e.stopPropagation());
    stylebar.addEventListener('click', e => {
      const btn = e.target.closest('button[data-v]');
      if (btn && sel && sel.type === 'link') {
        const l = linkByUid(sel.uid);
        if (l) {
          l[btn.closest('.pz-sb-seg').dataset.k] = btn.dataset.v;
          renderEdges();
          gEdges.querySelector(`[data-uid="${l.uid}"]`)?.classList.add('sel');
          refreshStylebar(l);
          markDirty();
        }
      }
      if (e.target.closest('.pz-sb-del') && sel && sel.type === 'link') deleteSelected();
    });
    const inp = stylebar.querySelector('.pz-sb-label');
    inp.addEventListener('input', () => {
      if (sel && sel.type === 'link') {
        const l = linkByUid(sel.uid);
        if (l) { l.label = inp.value; updateAttachedLinks2(l.uid); markDirty(); }
      }
    });
    inp.addEventListener('pointerdown', e => e.stopPropagation());
  }
  function updateAttachedLinks2(linkUid) {
    const g = gEdges.querySelector(`[data-uid="${linkUid}"]`);
    const l = linkByUid(linkUid);
    if (g && l) updateLinkEl(g, l);
  }
  function refreshStylebar(l) {
    if (!l) { stylebar.classList.remove('open'); return; }
    stylebar.classList.add('open');
    stylebar.querySelectorAll('.pz-sb-seg').forEach(seg => {
      const key = seg.dataset.k;
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === l[key]));
    });
    const inp = stylebar.querySelector('.pz-sb-label');
    if (inp && document.activeElement !== inp) inp.value = l.label || '';
  }
  function positionStylebar(l) {
    if (!l) return;
    const geo = linkGeom(l);
    if (!geo) { stylebar.classList.remove('open'); return; }
    const v = state.view;
    const r = viewport.getBoundingClientRect();
    const sx = geo.mid[0] * v.k + v.x, sy = geo.mid[1] * v.y + v.y;
    stylebar.classList.add('open');
    const bw = stylebar.offsetWidth || 250, bh = stylebar.offsetHeight || 150;
    stylebar.style.left = clamp(sx - bw / 2, 8, r.width - bw - 8) + 'px';
    stylebar.style.top = clamp(sy + 16, 8, r.height - bh - 8) + 'px';
  }

  /* ================= 分组框 ================= */
  function addGroup(wx, wy) {
    const [w, h] = PCFG.groupSize;
    const g = { uid: 'u' + (state.seq++), title: '', x: Math.round(wx - w / 2), y: Math.round(wy - h / 2), w, h };
    state.groups.push(g);
    renderGroups();
    markDirty();
    select('group', g.uid);
    const tEl = layerGroups.querySelector(`[data-uid="${g.uid}"] .pz-g-title`);
    if (tEl) { tEl.focus(); }
    return g;
  }

  function buildGroupEl(g) {
    const el = document.createElement('div');
    el.className = 'pz-group';
    el.dataset.uid = g.uid;
    el.innerHTML = `
      <div class="pz-g-title" data-edit contenteditable="true" spellcheck="false" data-ph="分组…">${esc(g.title)}</div>
      <div class="pz-resize" title="调整分组框"></div>`;
    positionCard(el, g);
    const title = el.querySelector('.pz-g-title');
    title.addEventListener('input', () => { g.title = title.textContent; markDirty(); });
    title.addEventListener('pointerdown', ev => ev.stopPropagation());
    el.addEventListener('pointerdown', e => onGroupPointerDown(e, g, el));
    return el;
  }

  function groupMembers(g) {
    return state.cards.filter(c =>
      c.x + c.w / 2 >= g.x && c.x + c.w / 2 <= g.x + g.w &&
      c.y + c.h / 2 >= g.y && c.y + c.h / 2 <= g.y + g.h);
  }

  function onGroupPointerDown(e, g, el) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (e.target.closest('.pz-resize')) { startGroupResize(e, g, el); return; }
    // 移动分组框：带动框内卡片
    const members = groupMembers(g).map(c => ({ c, el: layerCards.querySelector(`[data-uid="${c.uid}"]`), ox: c.x - g.x, oy: c.y - g.y }));
    const start = { px: e.clientX, py: e.clientY, gx: g.x, gy: g.y };
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - start.px, ev.clientY - start.py) < 3) return;
      moved = true;
      g.x = start.gx + (ev.clientX - start.px) / state.view.k;
      g.y = start.gy + (ev.clientY - start.py) / state.view.k;
      positionCard(el, g);
      for (const m of members) {
        if (!m.el) continue;
        m.c.x = g.x + m.ox; m.c.y = g.y + m.oy;
        positionCard(m.el, m.c);
        updateAttachedLinks(m.c.uid);
      }
    };
    const up = () => {
      el.removeEventListener('pointermove', mv);
      if (!moved) select('group', g.uid);
      else markDirty();
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  }

  function startGroupResize(e, g, el) {
    select('group', g.uid);
    const start = { px: e.clientX, py: e.clientY, w: g.w, h: g.h };
    el.setPointerCapture(e.pointerId);
    const mv = ev => {
      g.w = Math.max(140, Math.round(start.w + (ev.clientX - start.px) / state.view.k));
      g.h = Math.max(90, Math.round(start.h + (ev.clientY - start.py) / state.view.k));
      positionCard(el, g);
    };
    const up = () => { el.removeEventListener('pointermove', mv); markDirty(); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', up, { once: true });
    el.addEventListener('pointercancel', up, { once: true });
  }

  function renderGroups() {
    layerGroups.innerHTML = '';
    for (const g of state.groups) layerGroups.appendChild(buildGroupEl(g));
    if (sel && sel.type === 'group') {
      const el = layerGroups.querySelector(`[data-uid="${sel.uid}"]`);
      if (el) el.classList.add('sel');
    }
  }

  /* ================= 选中 / 删除 / 撤销 ================= */
  function select(type, uid) {
    deselect();
    sel = { type, uid };
    if (type === 'card' || type === 'group') {
      const layer = type === 'card' ? layerCards : layerGroups;
      layer.querySelector(`[data-uid="${uid}"]`)?.classList.add('sel');
    } else if (type === 'link') {
      gEdges.querySelector(`[data-uid="${uid}"]`)?.classList.add('sel');
      const l = linkByUid(uid);
      refreshStylebar(l);
      positionStylebar(l);
    }
  }
  function deselect() {
    if (!sel) return false;
    if (sel.type === 'card') layerCards.querySelector(`[data-uid="${sel.uid}"]`)?.classList.remove('sel');
    else if (sel.type === 'group') layerGroups.querySelector(`[data-uid="${sel.uid}"]`)?.classList.remove('sel');
    else if (sel.type === 'link') gEdges.querySelector(`[data-uid="${sel.uid}"]`)?.classList.remove('sel');
    refreshStylebar(null);
    sel = null;
    return true;
  }

  function deleteSelected() {
    if (!sel) return false;
    let snap = { cards: [], links: [], groups: [] };
    if (sel.type === 'card') {
      const c = cardByUid(sel.uid);
      if (!c) { sel = null; return false; }
      const links = state.links.filter(l => l.a === c.uid || l.b === c.uid);
      state.cards = state.cards.filter(x => x !== c);
      state.links = state.links.filter(l => !links.includes(l));
      snap = { cards: [c], links, groups: [] };
    } else if (sel.type === 'link') {
      const l = linkByUid(sel.uid);
      if (!l) { sel = null; return false; }
      state.links = state.links.filter(x => x !== l);
      snap = { cards: [], links: [l], groups: [] };
    } else {
      const g = groupByUid(sel.uid);
      if (!g) { sel = null; return false; }
      state.groups = state.groups.filter(x => x !== g);
      snap = { cards: [], links: [], groups: [g] };
    }
    sel = null;
    refreshStylebar(null);
    renderAll();
    markDirty();
    showUndo('已删除', snap);
    return true;
  }

  function showUndo(msg, snap) {
    undoEl.querySelector('.pz-undo-msg').textContent = msg;
    undoEl.classList.add('show');
    clearTimeout(showUndo._t);
    showUndo._t = setTimeout(() => undoEl.classList.remove('show'), 5000);
    undoEl._restore = () => {
      state.cards.push(...snap.cards);
      state.links.push(...snap.links);
      state.groups.push(...snap.groups);
      renderAll();
      markDirty();
      undoEl.classList.remove('show');
      window.toast && window.toast('已撤销', 1200);
    };
  }

  function clearBoard() {
    if (!state.cards.length && !state.links.length && !state.groups.length) return;
    const snap = { cards: state.cards.slice(), links: state.links.slice(), groups: state.groups.slice() };
    state.cards = []; state.links = []; state.groups = [];
    sel = null;
    refreshStylebar(null);
    renderAll();
    markDirty();
    showUndo(`已清空 ${snap.cards.length} 卡 · ${snap.links.length} 线`, snap);
  }

  /* ================= 卡片库 ================= */
  let libSections = [];
  const libState = { q: '', chip: 'all', expanded: new Set() };

  function buildLibraryData() {
    libSections = [];
    const order = ['person', 'work', 'org', 'movement', 'policy', 'event', 'theory', 'other'];
    for (const t of order) {
      const ents = D.entities.filter(e => e.type === t);
      if (!ents.length) continue;
      const meta = CFG.types[t];
      libSections.push({
        id: 't-' + t, chip: t, label: meta.label, color: meta.color,
        items: ents.map(e => ({
          kind: 'entity', ref: e.name, title: e.name,
          meta: e.birth ? `${e.birth}${e.death ? '—' + e.death : ''}` : (e.era || e.role || e.year || ''),
          s: (e.name + ' ' + (e.tags || []).join(' ') + ' ' + (e.summary || '')).toLowerCase(),
        })),
      });
    }
    for (const p of CFG.periods) {
      const evs = D.events.filter(ev => ev.period === p.id);
      if (!evs.length) continue;
      libSections.push({
        id: 'p-' + p.id, chip: 'chron', label: `编年 · ${p.name}`, color: p.color,
        items: evs.map(ev => ({
          kind: 'event', ref: ev.id, title: ev.title || trunc(ev.label, 26),
          meta: `${ev.year}${ev.month ? '.' + ev.month : ''} · ${ev.src === 'hong' ? '洪' : ev.src === 'curated' ? '策' : '朱'}`,
          s: ((ev.title || '') + ' ' + ev.label + ' ' + (ev.blurb || '')).toLowerCase(),
        })),
      });
    }
  }

  function bindLibrary() {
    libChips.innerHTML = `<button class="pz-chip on" data-chip="all">全部</button>` +
      ['person', 'work', 'org', 'movement', 'policy', 'event', 'theory', 'other']
        .filter(t => libSections.some(sec => sec.chip === t))
        .map(t => `<button class="pz-chip" data-chip="${t}"><i style="background:${CFG.types[t].color}"></i>${CFG.types[t].label}</button>`)
        .join('') +
      (libSections.some(s => s.chip === 'chron')
        ? `<button class="pz-chip" data-chip="chron"><i style="background:var(--gold)"></i>编年</button>` : '');
    libChips.addEventListener('click', e => {
      const b = e.target.closest('.pz-chip');
      if (!b) return;
      libState.chip = b.dataset.chip;
      libChips.querySelectorAll('.pz-chip').forEach(x => x.classList.toggle('on', x === b));
      renderLib();
    });
    libInput.addEventListener('input', () => { libState.q = libInput.value.trim().toLowerCase(); renderLib(); });
    renderLib();
    // 拖拽上板（鼠标）；点击 = 加到视口中心（触屏兜底）
    libList.addEventListener('pointerdown', e => {
      const item = e.target.closest('.pz-li');
      if (!item || e.button !== 0 || e.pointerType === 'touch') return;
      startLibDrag(e, item);
    });
    libList.addEventListener('click', e => {
      const item = e.target.closest('.pz-li');
      if (!item || item._dragged) { item && (item._dragged = false); return; }
      const w = centerWorld();
      const c = addCard(item.dataset.kind, item.dataset.ref, w.x, w.y);
      if (c) { focusCard(c); window.toast && window.toast('已加到白板中心', 1200); }
    });
  }

  function startLibDrag(e, item) {
    const start = { x: e.clientX, y: e.clientY };
    let ghost = null, over = false;
    item.setPointerCapture(e.pointerId);
    const ensureGhost = () => {
      if (ghost) return;
      ghost = document.createElement('div');
      ghost.className = 'pz-ghost';
      ghost.innerHTML = item.innerHTML;
      document.body.appendChild(ghost);
    };
    const mv = ev => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        ensureGhost();
        item._dragged = true;
      }
      ghost.style.left = ev.clientX + 10 + 'px';
      ghost.style.top = ev.clientY + 8 + 'px';
      // 指针已被 item 捕获,ev.target 恒为 item,须按坐标命中检测
      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
      const nowOver = !!(hitEl && (hitEl === viewport || (hitEl.closest && hitEl.closest('#pz-viewport'))));
      if (nowOver !== over) { over = nowOver; viewport.classList.toggle('drop', over); }
    };
    const up = ev => {
      item.removeEventListener('pointermove', mv);
      viewport.classList.remove('drop');
      if (ghost) {
        ghost.remove();
        if (over) {
          const w = screenToWorld(ev.clientX, ev.clientY);
          const c = addCard(item.dataset.kind, item.dataset.ref, w.x, w.y);
          if (c) focusCard(c);
        }
      } else {
        item._dragged = false;   // 未拖动：交回 click 处理
      }
    };
    item.addEventListener('pointermove', mv);
    item.addEventListener('pointerup', up, { once: true });
    item.addEventListener('pointercancel', up, { once: true });
  }

  function renderLib() {
    libList.innerHTML = '';
    if (libState.q) {
      // 搜索态：全库平铺 top 60
      const hits = [];
      for (const sec of libSections) for (const it of sec.items) {
        if (it.s.includes(libState.q) || it.title.toLowerCase().includes(libState.q)) hits.push(it);
      }
      hits.sort((a, b) => a.title.length - b.title.length);
      const box = document.createElement('div');
      box.className = 'pz-lg open';
      box.innerHTML = `<div class="pz-lg-head open"><span>搜索结果</span><span class="count">${Math.min(hits.length, 60)} / ${hits.length}</span></div>`;
      const body = document.createElement('div');
      body.className = 'pz-lg-body';
      body.append(...hits.slice(0, 60).map(it => buildLibItem(it)));
      box.appendChild(body);
      libList.appendChild(box);
    } else {
      const secs = libSections.filter(s => libState.chip === 'all' || s.chip === libState.chip);
      for (const sec of secs) {
        const box = document.createElement('div');
        box.className = 'pz-lg' + (libState.expanded.has(sec.id) ? ' open' : '');
        box.dataset.sec = sec.id;
        box.innerHTML = `<div class="pz-lg-head"><i class="dot" style="background:${sec.color}"></i><span>${esc(sec.label)}</span><span class="count">${sec.items.length}</span><span class="arrow">▸</span></div>`;
        const body = document.createElement('div');
        body.className = 'pz-lg-body';
        box.appendChild(body);
        box.querySelector('.pz-lg-head').addEventListener('click', () => {
          const opening = !box.classList.contains('open');
          box.classList.toggle('open', opening);
          if (opening) {
            libState.expanded.add(sec.id);
            if (!body.childElementCount) body.append(...sec.items.map(it => buildLibItem(it)));
          } else libState.expanded.delete(sec.id);
        });
        if (libState.expanded.has(sec.id)) body.append(...sec.items.map(it => buildLibItem(it)));
        libList.appendChild(box);
      }
    }
    refreshLibMarks();
  }

  function buildLibItem(it) {
    const b = document.createElement('button');
    b.className = 'pz-li';
    b.dataset.kind = it.kind;
    b.dataset.ref = it.ref;
    b.innerHTML = `<span class="pz-li-title" title="${esc(it.title)}">${esc(it.title)}</span><span class="pz-li-meta">${esc(it.meta)}</span><span class="pz-li-on" title="已在白板">●</span>`;
    return b;
  }

  function refreshLibMarks() {
    const onBoard = new Set(state.cards.filter(c => c.kind !== 'note').map(c => c.kind + ':' + c.ref));
    libList.querySelectorAll('.pz-li').forEach(li =>
      li.classList.toggle('onboard', onBoard.has(li.dataset.kind + ':' + li.dataset.ref)));
  }

  /* ================= 画布交互（平移 / 缩放 / 捏合 / 空白） ================= */
  function bindBoard() {
    const pointers = new Map();
    let panP = null, pinch = null;

    viewport.addEventListener('wheel', e => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    viewport.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        panP = null;
        const [p1, p2] = [...pointers.values()];
        pinch = {
          d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), k0: state.view.k,
          mx0: (p1.x + p2.x) / 2, my0: (p1.y + p2.y) / 2,
          vx0: state.view.x, vy0: state.view.y,
        };
        for (const p of pointers.values()) {
          try { viewport.setPointerCapture(p.id); } catch (_) { /* 忽略 */ }
        }
      } else if (pointers.size === 1) {
        panP = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y, moved: false };
        viewport.setPointerCapture(e.pointerId);
      }
    });

    viewport.addEventListener('pointermove', e => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const r = viewport.getBoundingClientRect();
        const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top;
        const k = clamp(pinch.k0 * d / (pinch.d0 || 1), PCFG.zoomMin, PCFG.zoomMax);
        const wx = (pinch.mx0 - pinch.vx0) / pinch.k0, wy = (pinch.my0 - pinch.vy0) / pinch.k0;
        state.view.k = k;
        state.view.x = mx - wx * k;
        state.view.y = my - wy * k;
        applyView();
        viewport.classList.add('dragging');
      } else if (panP && e.pointerId === panP.id) {
        const dx = e.clientX - panP.sx, dy = e.clientY - panP.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) { panP.moved = true; viewport.classList.add('dragging'); }
        state.view.x = panP.vx + dx;
        state.view.y = panP.vy + dy;
        applyView();
      }
    });

    const endPointer = e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (panP && e.pointerId === panP.id) {
        if (!panP.moved) deselect();       // 点击空白：取消选中
        panP = null;
      }
      if (!pointers.size) viewport.classList.remove('dragging');
    };
    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', endPointer);

    // 双击空白：加便签
    viewport.addEventListener('dblclick', e => {
      if (e.target.closest('.pz-card, .pz-group, .pz-link, #pz-toolbar, #pz-stylebar, #pz-undo')) return;
      const w = screenToWorld(e.clientX, e.clientY);
      const c = addCard('note', '', w.x, w.y);
      if (c) {
        renderCards();
        select('card', c.uid);
        const body = layerCards.querySelector(`[data-uid="${c.uid}"] .pz-c-note`);
        if (body) body.focus();
      }
    });
  }

  /* ================= 工具栏 ================= */
  function buildToolbar() {
    toolbar.innerHTML = `
      <button data-t="zo" title="缩小（−）">−</button>
      <span id="pz-zoom" class="pz-zoom" title="点击回到 100%">100%</span>
      <button data-t="zi" title="放大（＋）">＋</button>
      <span class="pz-tb-sep"></span>
      <button data-t="fit" title="适应全部内容（0 / F）">适</button>
      <button data-t="note" title="加便签（N）">✎ 便签</button>
      <button data-t="group" title="加分组框（G）">▣ 分组</button>
      <span class="pz-tb-sep"></span>
      <button data-t="export" title="导出 JSON 备份">⇩ 导出</button>
      <button data-t="import" title="导入 JSON">⇧ 导入</button>
      <button data-t="clear" class="pz-tb-clear" title="清空白板">清空</button>
      <input type="file" id="pz-import-file" accept=".json,application/json" hidden>`;
    zoomLabel = toolbar.querySelector('#pz-zoom');
    importFile = toolbar.querySelector('#pz-import-file');
    zoomLabel.addEventListener('click', () => {
      const r = viewport.getBoundingClientRect();
      zoomAt(1 / state.view.k, r.width / 2, r.height / 2);
    });
    toolbar.addEventListener('pointerdown', e => e.stopPropagation());
    let clearArmed = false, clearTimer = null;
    toolbar.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const t = btn.dataset.t;
      const r = viewport.getBoundingClientRect();
      if (t === 'zo') zoomAt(0.8, r.width / 2, r.height / 2);
      else if (t === 'zi') zoomAt(1.25, r.width / 2, r.height / 2);
      else if (t === 'fit') fit();
      else if (t === 'note') {
        const w = centerWorld();
        const c = addCard('note', '', w.x, w.y);
        if (c) {
          renderCards(); select('card', c.uid);
          layerCards.querySelector(`[data-uid="${c.uid}"] .pz-c-note`)?.focus();
        }
      }
      else if (t === 'group') { const w = centerWorld(); addGroup(w.x, w.y); }
      else if (t === 'export') exportJSON();
      else if (t === 'import') importFile.click();
      else if (t === 'clear') {
        if (!clearArmed) {
          clearArmed = true;
          btn.classList.add('arm');
          btn.textContent = '确认清空？';
          clearTimer = setTimeout(() => { clearArmed = false; btn.classList.remove('arm'); btn.textContent = '清空'; }, 3000);
        } else {
          clearTimeout(clearTimer);
          clearArmed = false;
          btn.classList.remove('arm');
          btn.textContent = '清空';
          clearBoard();
        }
      }
    });
    importFile.addEventListener('change', () => {
      const f = importFile.files && importFile.files[0];
      importFile.value = '';
      if (!f) return;
      f.text().then(t => {
        const data = JSON.parse(t);
        if (!data || !Array.isArray(data.cards)) throw new Error('bad');
        applySerialized(data);
        fit();
        window.toast && window.toast('已导入拼图', 1600);
      }).catch(() => window.toast && window.toast('导入失败：文件格式不对', 2200));
    });

    // 撤销条
    undoEl.innerHTML = `<span class="pz-undo-msg"></span><button>撤销</button>`;
    undoEl.addEventListener('pointerdown', e => e.stopPropagation());
    undoEl.querySelector('button').addEventListener('click', () => undoEl._restore && undoEl._restore());
  }

  /* ================= 持久化 ================= */
  const LS_KEY = 'wenxue-puzzle';
  let saveTimer = null;
  function serialize() {
    return {
      v: 1, seq: state.seq,
      view: { k: state.view.k, x: state.view.x, y: state.view.y },
      cards: state.cards.map(c => ({ ...c })),
      links: state.links.map(l => ({ ...l })),
      groups: state.groups.map(g => ({ ...g })),
    };
  }
  function markDirty() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
  }
  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch (_) { /* file:// 等环境可能抛错 */ }
  }

  function applySerialized(data) {
    state.cards = [];
    let dropped = 0;
    for (const c of data.cards || []) {
      if (!c || typeof c !== 'object') continue;
      if (c.kind === 'entity' && !entityByName.has(c.ref)) { dropped++; continue; }
      if (c.kind === 'event' && !eventById.has(c.ref)) { dropped++; continue; }
      state.cards.push({
        uid: String(c.uid || 'u' + state.seq++), kind: c.kind, ref: c.ref || '',
        x: +c.x || 0, y: +c.y || 0,
        w: Math.max(PCFG.cardMin.w, +c.w || 200), h: Math.max(PCFG.cardMin.h, +c.h || 100),
        z: +c.z || state.seq++, text: String(c.text || ''),
      });
    }
    const uids = new Set(state.cards.map(c => c.uid));
    state.links = (data.links || []).filter(l => l && uids.has(l.a) && uids.has(l.b)).map(l => ({
      uid: String(l.uid || 'u' + state.seq++), a: l.a, b: l.b,
      line: ['solid', 'dash', 'dot'].includes(l.line) ? l.line : 'solid',
      arrow: ['none', 'ab', 'ba', 'both'].includes(l.arrow) ? l.arrow : 'ab',
      color: LINK_VAR[l.color] ? l.color : 'ink',
      label: String(l.label || ''),
    }));
    state.groups = (data.groups || []).filter(g => g && typeof g === 'object').map(g => ({
      uid: String(g.uid || 'u' + state.seq++), title: String(g.title || ''),
      x: +g.x || 0, y: +g.y || 0, w: Math.max(140, +g.w || 300), h: Math.max(90, +g.h || 200),
    }));
    // seq 恢复为新 uid 不与旧 uid 冲突
    let maxNum = Math.floor(+data.seq) || 0;
    for (const arr of [state.cards, state.links, state.groups])
      for (const it of arr) {
        const n = parseInt(String(it.uid).replace(/^u/, ''), 10);
        if (n > maxNum) maxNum = n;
      }
    state.seq = maxNum + 1;
    state.view = data.view && isFinite(data.view.k)
      ? { k: clamp(+data.view.k, PCFG.zoomMin, PCFG.zoomMax), x: +data.view.x || 0, y: +data.view.y || 0 }
      : state.view;
    sel = null;
    renderAll();
    markDirty();
    if (dropped) window.toast && window.toast(`已忽略 ${dropped} 张失效卡片（数据已更新）`, 2600);
  }

  const load = () => {
    load.savedView = false;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.cards)) return;
      applySerialized(data);
      load.savedView = !!(data.view && isFinite(data.view.k));
    } catch (_) { /* 损坏数据视为无存档 */ }
  };

  function exportJSON() {
    flushSave();
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `拼图-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    window.toast && window.toast('已导出 JSON', 1400);
  }

  window.addEventListener('pagehide', () => { if (inited && saveTimer) flushSave(); });

  /* ================= 汇总渲染 ================= */
  function renderAll() {
    renderGroups();
    renderCards();
    renderEdges();
    refreshLibMarks();
    updateEmpty();
    if (sel && sel.type === 'link') positionStylebar(linkByUid(sel.uid));
  }
  function updateEmpty() {
    if (!emptyEl) return;
    emptyEl.style.display = (state.cards.length || state.groups.length) ? 'none' : '';
  }

  /* ================= 视图注册 ================= */
  function onShow(params = {}) {
    if (!inited) return;
    if (params.add || params.addev) {
      const kind = params.add ? 'entity' : 'event';
      const ref = params.add || params.addev;
      let c = state.cards.find(x => x.kind === kind && x.ref === ref);
      if (!c) {
        const w = centerWorld();
        c = addCard(kind, ref, w.x, w.y);
        if (!c) { window.toast && window.toast('未找到该条目', 1800); return; }
      }
      focusCard(c);
    }
  }

  window.Views = window.Views || {};
  window.Views.puzzle = { init, onShow };

  /* 键盘 API（keyboard.js 调用；事件一律经 keyboard.js 分发） */
  window.PUZZLE = {
    panBy(dx, dy) { state.view.x += dx; state.view.y += dy; applyView(); markDirty(); },
    zoomBy(f) {
      const r = viewport.getBoundingClientRect();
      zoomAt(f, r.width / 2, r.height / 2);
    },
    zoom: () => state.view.k,
    fit,
    del: deleteSelected,
    deselect() { return deselect(); },
    cancelDrag() {
      if (activeLinkDrag && activeLinkDrag.cancel) return activeLinkDrag.cancel();
      return false;
    },
    esc() {
      if (window.PUZZLE.cancelDrag()) return true;
      return deselect();
    },
    addNote() {
      const w = centerWorld();
      const c = addCard('note', '', w.x, w.y);
      if (c) {
        renderCards(); select('card', c.uid);
        layerCards.querySelector(`[data-uid="${c.uid}"] .pz-c-note`)?.focus();
      }
    },
    addGroup() { const w = centerWorld(); addGroup(w.x, w.y); },
    clear: clearBoard,
  };
})();
