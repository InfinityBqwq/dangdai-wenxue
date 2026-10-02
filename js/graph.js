/* ============================================================
   graph.js — 图谱视图：类 Obsidian 双链力导向图（canvas 渲染）
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const D = window.DATA;
  const canvas = document.getElementById('graph-canvas');
  const ctx = canvas.getContext('2d');

  const impSet = new Set(D.important || []);

  /* ---------- 图数据 ---------- */
  const nodes = [];          // {id,name,type,deg,x,y,imp}
  const nodeById = new Map();
  const links = [];          // {s:node, t:node}
  const deg = new Map();

  const typeByKey = new Map();
  D.entities.forEach(e => typeByKey.set(e.name, e.type));

  function ensureNode(name) {
    let n = nodeById.get(name);
    if (n) return n;
    const type = typeByKey.get(name) || 'other';
    n = { id: name, name, type, deg: 0, imp: impSet.has(name), placeholder: false };
    const e = D.entities.find(x => x.name === name);
    if (e && e.placeholder) n.placeholder = true;
    nodes.push(n); nodeById.set(name, n);
    return n;
  }
  D.edges.forEach(ed => {
    const s = ensureNode(ed.s), t = ensureNode(ed.t);
    s.deg++; t.deg++;
    links.push({ source: s, target: t });
  });
  nodes.forEach(n => { if (!deg.has(n.id)) deg.set(n.id, 0); });

  // 节点数过多时：只保留连接数 >= 2 或 重要/占位节点？773 全量可以
  const RADIUS = n => Math.min(4 + Math.sqrt(n.deg) * 1.6, 16) * (n.imp ? 1.15 : 1);

  /* ---------- 视图变换 ---------- */
  const view = { k: 0.55, x: 0, y: 0 };   // screen = world * k + offset
  let W = 0, H = 0;

  /* ---------- 力模拟 ---------- */
  const simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(42).strength(0.35))
    .force('charge', d3.forceManyBody().strength(-42))
    .force('center', d3.forceCenter(0, 0))
    .force('collide', d3.forceCollide().radius(n => RADIUS(n) + 2).iterations(1))
    .alphaDecay(0.028)
    .velocityDecay(0.42)
    .stop();

  // 预热（页面空闲时）
  function warm(iter = 160) {
    simulation.alpha(1);
    for (let i = 0; i < iter; i++) simulation.tick();
    draw();
  }

  /* ---------- 过滤 ---------- */
  const typeOn = new Map(Object.keys(CFG.types).map(t => [t, true]));
  function nodeVisible(n) { return typeOn.get(n.type); }
  function linkVisible(l) { return nodeVisible(l.source) && nodeVisible(l.target); }

  /* ---------- 悬停 ---------- */
  let hover = null;
  const adjacency = new Map();
  links.forEach(l => {
    if (!adjacency.has(l.source.id)) adjacency.set(l.source.id, new Set());
    if (!adjacency.has(l.target.id)) adjacency.set(l.target.id, new Set());
    adjacency.get(l.source.id).add(l.target.id);
    adjacency.get(l.target.id).add(l.source.id);
  });

  /* ---------- 渲染 ---------- */
  let raf = null;
  function requestDraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; draw(); });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

    const css = getComputedStyle(document.documentElement);
    const cInk3 = css.getPropertyValue('--ink-3').trim() || '#8a8272';
    const cInk0 = css.getPropertyValue('--ink-0').trim() || '#1a1712';
    const paper = css.getPropertyValue('--paper-0').trim() || '#f3ecdc';

    // 边
    ctx.lineWidth = 1 / view.k;
    for (const l of links) {
      if (!linkVisible(l)) continue;
      const isNeighbor = hover && (l.source === hover || l.target === hover);
      if (hover && !isNeighbor) continue;
      ctx.strokeStyle = isNeighbor ? 'rgba(179, 52, 46, .55)' : 'rgba(92, 86, 74, .16)';
      ctx.lineWidth = (isNeighbor ? 1.4 : 1) / view.k;
      ctx.beginPath();
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.stroke();
    }

    // 节点
    const labelLimit = view.k > 1.15 ? 9999 : 14;   // 缩放大时全部标注
    const labeled = [];
    for (const n of nodes) {
      if (!nodeVisible(n)) continue;
      if (hover && n !== hover && !adjacency.get(hover.id)?.has(n.id)) continue;
      const r = RADIUS(n);
      const color = (CFG.types[n.type] || CFG.types.other).color;
      // 墨晕
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3, 0, 6.284);
      ctx.fillStyle = color + (hover ? '33' : '18');
      ctx.fill();
      // 本体
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 6.284);
      ctx.fillStyle = color;
      ctx.fill();
      if (n === hover) {
        ctx.strokeStyle = cInk0; ctx.lineWidth = 2 / view.k;
        ctx.stroke();
      }
      if (n.deg > labelLimit || n.imp || n === hover) labeled.push(n);
    }

    // 标签（纸色描边保证可读）
    ctx.font = '11px "LXGW WenKai", "KaiTi", serif';
    ctx.textAlign = 'center';
    for (const n of labeled) {
      const label = n.name.length > 8 ? n.name.slice(0, 7) + '…' : n.name;
      ctx.lineWidth = 3.2 / view.k;
      ctx.strokeStyle = paper;
      const y = n.y + RADIUS(n) + 11;
      ctx.strokeText(label, n.x, y);
      ctx.fillStyle = n === hover ? '#b3342e' : cInk0;
      ctx.fillText(label, n.x, y);
    }
    ctx.restore();
  }

  simulation.on('tick', requestDraw);

  /* ---------- 交互 ---------- */
  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return [(clientX - rect.left - view.x) / view.k, (clientY - rect.top - view.y) / view.k];
  }

  function pick(mx, my) {
    const [wx, wy] = toWorld(mx, my);
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      if (!nodeVisible(n)) continue;
      const dx = n.x - wx, dy = n.y - wy;
      const d = dx * dx + dy * dy;
      const rr = Math.max(RADIUS(n) + 6, 10 / view.k) ** 2;
      if (d < rr && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  let dragging = false, moved = false, lx = 0, ly = 0;
  canvas.addEventListener('mousedown', e => {
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
  });
  window.addEventListener('mousemove', e => {
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      view.x += dx; view.y += dy;
      lx = e.clientX; ly = e.clientY;
      requestDraw();
    } else {
      const rect = canvas.getBoundingClientRect();
      const n = pick(e.clientX - rect.left, e.clientY - rect.top);
      if (n !== hover) { hover = n; requestDraw(); canvas.style.cursor = n ? 'pointer' : 'grab'; }
    }
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('click', e => {
    if (moved) return;
    const rect = canvas.getBoundingClientRect();
    const n = pick(e.clientX - rect.left, e.clientY - rect.top);
    if (n) window.openDrawerEntity(n.name);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const k = Math.max(0.12, Math.min(6, view.k * factor));
    view.x = mx - (mx - view.x) * (k / view.k);
    view.y = my - (my - view.y) * (k / view.k);
    view.k = k;
    requestDraw();
  }, { passive: false });
  // 双击空白回位
  canvas.addEventListener('dblclick', e => {
    if (!pick(e.clientX - canvas.getBoundingClientRect().left, e.clientY - canvas.getBoundingClientRect().top)) {
      view.k = 0.55; view.x = W / 2; view.y = H / 2 - 20;
      requestDraw();
    }
  });

  /* ---------- 工具栏 ---------- */
  function buildToolbar() {
    const bar = document.getElementById('graph-toolbar');
    bar.innerHTML = '';
    const defs = ['person', 'work', 'movement', 'event', 'policy', 'theory', 'org'];
    for (const t of defs) {
      const meta = CFG.types[t];
      const chip = document.createElement('button');
      chip.className = 'gchip on';
      chip.style.background = 'transparent';
      chip.innerHTML = `<span class="dot" style="background:${meta.color}"></span>${meta.label}`;
      chip.addEventListener('click', () => {
        typeOn.set(t, !typeOn.get(t));
        chip.classList.toggle('on');
        chip.style.background = typeOn.get(t) ? meta.color : 'transparent';
        chip.style.color = typeOn.get(t) ? '#fff' : '';
        draw();
      });
      bar.appendChild(chip);
    }
    const restart = document.createElement('button');
    restart.className = 'gchip';
    restart.textContent = '↻ 重新布局';
    restart.addEventListener('click', () => { warm(220); toast('已重新布局'); });
    bar.appendChild(restart);
  }

  /* ---------- 聚焦 ---------- */
  function focusNode(name) {
    const n = nodeById.get(name);
    if (!n) { toast('图谱中未找到：' + name); return; }
    // 只显示邻居
    hover = n;
    view.k = 1.6;
    view.x = W / 2 - n.x * view.k;
    view.y = H / 2 - n.y * view.k;
    draw();
  }
  window.GraphFocus = focusNode;

  /* ---------- 键盘 API ---------- */
  window.GRAPH = {
    panBy(dx, dy) { view.x += dx; view.y += dy; requestDraw(); },
    zoomBy(f) {
      const k = Math.max(0.12, Math.min(6, view.k * f));
      view.x = W / 2 - (W / 2 - view.x) * (k / view.k);
      view.y = H / 2 - (H / 2 - view.y) * (k / view.k);
      view.k = k;
      requestDraw();
    },
    reset() { view.k = 0.55; view.x = W / 2; view.y = H / 2 - 10; hover = null; requestDraw(); },
    relayout() { warm(220); },
  };

  let centered = false;
  function onResize() {
    W = canvas.parentElement.clientWidth;
    H = canvas.parentElement.clientHeight;
    if (!centered && W > 0) {          // 初始把图群放到画布中央
      centered = true;
      view.x = W / 2; view.y = H / 2 - 10;
    }
    canvas.width = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    requestDraw();
  }

  let inited = false;
  window.Views.graph = {
    init() {
      if (inited) return;
      inited = true;
      onResize();
      buildToolbar();
      // 初始布局：以度数排序放置，收敛更快
      nodes.forEach((n, i) => {
        const a = i * 2.39996, r = 14 * Math.sqrt(i + 1);
        n.x = Math.cos(a) * r; n.y = Math.sin(a) * r;
      });
      setTimeout(() => warm(260), 60);
      window.addEventListener('resize', onResize);
    },
    onShow(params) {
      requestDraw();
      if (params && params.node) setTimeout(() => focusNode(params.node), 80);
    },
  };
})();
