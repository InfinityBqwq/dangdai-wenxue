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

  const typeByKey = new Map();
  const entityByName = new Map(D.entities.map(e => [e.name, e]));
  D.entities.forEach(e => typeByKey.set(e.name, e.type));

  function ensureNode(name) {
    let n = nodeById.get(name);
    if (n) return n;
    const type = typeByKey.get(name) || 'other';
    n = { id: name, name, type, deg: 0, imp: impSet.has(name), placeholder: false, src: [] };
    const e = entityByName.get(name);
    if (e) {
      if (e.placeholder) n.placeholder = true;
      // 比对模式外环:卡片出处优先;无笔记出处时回退用两书正文提及(cmp)
      n.src = (e.src && e.src.length) ? e.src
        : (e.cmp ? ['hong', 'zhu'].filter(b => e.cmp[b] && e.cmp[b].n) : []);
    }
    nodes.push(n); nodeById.set(name, n);
    return n;
  }
  D.edges.forEach(ed => {
    const s = ensureNode(ed.s), t = ensureNode(ed.t);
    s.deg++; t.deg++;
    links.push({ source: s, target: t });
  });

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

  /* ---------- 力度调节(节点排斥/连线吸引/向心聚拢) ---------- */
  const FORCE_DEFAULTS = { charge: -42, link: 0.35, center: 1 };
  const forces = { ...FORCE_DEFAULTS };
  function applyForces() {
    simulation.force('charge').strength(forces.charge);
    simulation.force('link').strength(forces.link);
    simulation.force('center').strength(forces.center);
  }

  // 布局：rAF 每帧 tick 一次，让力导向收敛过程可见（减动效时同步算完）
  // alpha:初始热度——整卷重排用 1,滑杆微调用 0.3(局部收敛,不整卷打散)
  let layoutRaf = null;
  function stopLayout() {
    if (layoutRaf) { cancelAnimationFrame(layoutRaf); layoutRaf = null; }
  }
  function runLayout(iter = 260, alpha = 1) {
    stopLayout();
    simulation.alpha(alpha);
    if (window.prefersReducedMotion && window.prefersReducedMotion()) {
      for (let i = 0; i < iter; i++) simulation.tick();
      requestDraw();
      return;
    }
    let ticks = 0;
    const step = () => {
      simulation.tick();
      ticks++;
      requestDraw();
      if (simulation.alpha() < 0.005 || ticks >= iter) { layoutRaf = null; return; }
      layoutRaf = requestAnimationFrame(step);
    };
    layoutRaf = requestAnimationFrame(step);
  }

  /* ---------- 过滤(节点恒全量,编年口径不拆词条) ---------- */
  const typeOn = new Map(Object.keys(CFG.types).map(t => [t, true]));
  const srcMode = () => (window.APP_STATE && window.APP_STATE.source) || 'zhu';
  function nodeVisible(n) { return typeOn.get(n.type); }
  function linkVisible(l) { return nodeVisible(l.source) && nodeVisible(l.target); }

  /* ---------- 悬停（墨晕渐显渐隐） ---------- */
  let hoverRef = null;      // 悬停节点（移出后保留引用，供淡出）
  let hoverA = 0;           // 悬停强度 0..1
  let hoverRaf = null;
  function setHover(n) {
    if (!n && hoverRef && hoverA > 0.01) {
      startHoverTween(0);          // 移出：保留引用渐隐，墨晕徐徐收拢
      return;
    }
    if (hoverRef === n) return;
    hoverRef = n;
    startHoverTween(n ? 1 : 0);
  }
  function startHoverTween(target) {
    if (hoverRaf) cancelAnimationFrame(hoverRaf);
    if (window.prefersReducedMotion && window.prefersReducedMotion()) {
      hoverA = target;
      if (target === 0) hoverRef = null;
      requestDraw(); return;
    }
    const step = () => {
      hoverA += (target - hoverA) * 0.22;
      requestDraw();
      if (Math.abs(target - hoverA) < 0.02) {
        hoverA = target;
        if (target === 0) hoverRef = null;   // 淡出完成才清引用
        hoverRaf = null;
        return;
      }
      hoverRaf = requestAnimationFrame(step);
    };
    hoverRaf = requestAnimationFrame(step);
  }
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

  /* ---------- 主题色(缓存;draw 每帧读 getComputedStyle 在布局期
     260 帧全量重绘下开销可观。换主题时由 MutationObserver 失效) ---------- */
  let themeCache = null;
  function themeColors() {
    if (themeCache) return themeCache;
    const css = getComputedStyle(document.documentElement);
    themeCache = {
      ink3: css.getPropertyValue('--ink-3').trim() || '#8a8272',
      ink0: css.getPropertyValue('--ink-0').trim() || '#1a1712',
      paper: css.getPropertyValue('--paper-0').trim() || '#f3ecdc',
      hong: css.getPropertyValue('--src-hong').trim() || '#bc621c',
      zhu: css.getPropertyValue('--src-zhu').trim() || '#2a6f77',
    };
    return themeCache;
  }
  if (window.MutationObserver) {
    new MutationObserver(() => { themeCache = null; })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  const LABEL_FONT = '11px "LXGW WenKai", "KaiTi", serif';

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

    const T = themeColors();
    const cInk3 = T.ink3, cInk0 = T.ink0, paper = T.paper;

    /* 视口裁剪:世界坐标可见包围盒,画布外的边/节点直接跳过
       (缩放放大时绘制量按可见比例下降) */
    const cullPad = 40 / view.k;
    const vx0 = -view.x / view.k - cullPad, vy0 = -view.y / view.k - cullPad;
    const vx1 = (W - view.x) / view.k + cullPad, vy1 = (H - view.y) / view.k + cullPad;
    const off = (x, y) => x < vx0 || x > vx1 || y < vy0 || y > vy1;

    const dimming = hoverRef && hoverA > 0.01;    // 悬停晕染是否生效
    /* 比对模式:单一来源节点画来源色外环(洪=赭橙,朱=青碧) */
    const srcRing = srcMode() === 'compare';

    // 边（晕染时：邻居朱红渐显，其余随墨晕隐去；两端均在视口外才跳过）
    for (const l of links) {
      if (!linkVisible(l)) continue;
      const s = l.source, t = l.target;
      if ((s.x < vx0 && t.x < vx0) || (s.x > vx1 && t.x > vx1) ||
          (s.y < vy0 && t.y < vy0) || (s.y > vy1 && t.y > vy1)) continue;
      if (dimming) {
        const isNeighbor = s === hoverRef || t === hoverRef;
        if (isNeighbor) {
          ctx.strokeStyle = `rgba(179, 52, 46, ${(0.15 + 0.4 * hoverA).toFixed(3)})`;
          ctx.lineWidth = (1 + 0.4 * hoverA) / view.k;
        } else {
          if (hoverA > 0.999) continue;
          ctx.strokeStyle = `rgba(92, 86, 74, ${(0.16 * (1 - hoverA * 0.82)).toFixed(3)})`;
          ctx.lineWidth = 1 / view.k;
        }
      } else {
        ctx.strokeStyle = 'rgba(92, 86, 74, .16)';
        ctx.lineWidth = 1 / view.k;
      }
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }

    // 节点（不透明度随 hoverA 洇开/收拢）
    const labelLimit = view.k > 1.15 ? 9999 : 14;   // 缩放大时全部标注
    const labeled = [];
    for (const n of nodes) {
      if (!nodeVisible(n)) continue;
      if (off(n.x, n.y)) continue;
      let a = 1;
      if (dimming) {
        const isNeighbor = n === hoverRef || adjacency.get(hoverRef.id)?.has(n.id);
        a = n === hoverRef ? 1 : isNeighbor ? 0.35 + 0.65 * hoverA : 1 - hoverA * 0.85;
        if (a < 0.03) continue;
      }
      const r = RADIUS(n);
      const color = (CFG.types[n.type] || CFG.types.other).color;
      ctx.globalAlpha = a;
      // 墨晕
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 3, 0, 6.284);
      ctx.fillStyle = color + (dimming ? '33' : '18');
      ctx.fill();
      // 本体
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 6.284);
      ctx.fillStyle = color;
      ctx.fill();
      // 来源外环(比对模式)
      if (srcRing && n.src && n.src.length === 1) {
        ctx.strokeStyle = n.src[0] === 'hong' ? T.hong : T.zhu;
        ctx.lineWidth = 1.8 / view.k;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2.8, 0, 6.284);
        ctx.stroke();
      }
      // 悬停描边（晕染到位后才浮现）
      if (n === hoverRef) {
        const ringA = Math.max(0, hoverA * 1.6 - 0.6);
        if (ringA > 0.02) {
          ctx.globalAlpha = ringA;
          ctx.strokeStyle = cInk0; ctx.lineWidth = 2 / view.k;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (n.deg > labelLimit || n.imp || n === hoverRef) labeled.push([n, a]);
    }

    // 标签（纸色描边保证可读）
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    for (const [n, a] of labeled) {
      if (off(n.x, n.y)) continue;
      const label = n.name.length > 8 ? n.name.slice(0, 7) + '…' : n.name;
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.lineWidth = 3.2 / view.k;
      ctx.strokeStyle = paper;
      const y = n.y + RADIUS(n) + 11;
      ctx.strokeText(label, n.x, y);
      ctx.fillStyle = n === hoverRef ? '#b3342e' : cInk0;
      ctx.fillText(label, n.x, y);
    }
    ctx.globalAlpha = 1;
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
    stopFly();
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
      if (n !== hoverRef) { setHover(n); canvas.style.cursor = n ? 'pointer' : 'grab'; }
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
    stopFly();
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
      flyTo(0.55, W / 2, H / 2 - 20);
    }
  });

  /* ---------- 触摸:单指平移 · 双指捏合缩放(锚定中点) · 轻点开卡片 ---------- */
  let tDrag = null;               // {x, y, moved, t0}
  let tPinch = null;              // {d0, k0, mx, my, vx0, vy0}
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length > 2) return;
    e.preventDefault();
    stopFly();
    if (e.touches.length === 1) {
      const t = e.touches[0];
      tDrag = { x: t.clientX, y: t.clientY, moved: false, t0: performance.now() };
      tPinch = null;
    } else {
      tDrag = null;
      const [a, b] = e.touches;
      tPinch = {
        d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        mx: (a.clientX + b.clientX) / 2, my: (a.clientY + b.clientY) / 2,
        vx0: view.x, vy0: view.y, k0: view.k,
      };
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    if (e.touches.length > 2) return;
    e.preventDefault();
    if (tDrag && e.touches.length === 1) {
      const t = e.touches[0];
      const dx = t.clientX - tDrag.x, dy = t.clientY - tDrag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) tDrag.moved = true;
      view.x += dx; view.y += dy;
      tDrag.x = t.clientX; tDrag.y = t.clientY;
      requestDraw();
    } else if (tPinch && e.touches.length === 2) {
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const rect = canvas.getBoundingClientRect();
      const mx = (a.clientX + b.clientX) / 2 - rect.left, my = (a.clientY + b.clientY) / 2 - rect.top;
      const k = Math.max(0.12, Math.min(6, tPinch.k0 * d / tPinch.d0));
      // 初始中点下的世界点,按新 k 投回当前中点(锚定缩放)
      const wx = (tPinch.mx - tPinch.vx0) / tPinch.k0, wy = (tPinch.my - tPinch.vy0) / tPinch.k0;
      view.k = k;
      view.x = mx - wx * k; view.y = my - wy * k;
      requestDraw();
    }
  }, { passive: false });
  canvas.addEventListener('touchend', e => {
    // 轻点(短按未拖动)→ 拾取节点开卡片
    if (tDrag && !tDrag.moved && performance.now() - tDrag.t0 < 350 && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const n = pick(t.clientX - rect.left, t.clientY - rect.top);
      if (n) window.openDrawerEntity(n.name);
    }
    tDrag = null; tPinch = null;
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
    restart.addEventListener('click', () => { runLayout(260); toast('已重新布局'); });
    bar.appendChild(restart);
  }

  /* ---------- 力度调节面板(右上角,可折叠) ---------- */
  function buildForcePanel() {
    const box = document.createElement('div');
    box.id = 'graph-forces';
    if (window.innerWidth <= 640) box.classList.add('collapsed');   // 窄屏默认折叠
    const rows = [
      { k: 'charge', label: '节点排斥力', min: -140, max: -6, step: 2, fmt: v => v.toFixed(0),
        tip: '越大越散开(团块展开)' },
      { k: 'link',   label: '连线吸引力', min: 0.05, max: 1, step: 0.05, fmt: v => v.toFixed(2),
        tip: '关联节点互相靠拢的力度' },
      { k: 'center', label: '向心聚拢',   min: 0.05, max: 1.5, step: 0.05, fmt: v => v.toFixed(2),
        tip: '整体收向画布中心的力度' },
    ];
    box.innerHTML = `
      <div class="gf-title gf-toggle">力度调节 <span class="gf-arrow">▾</span></div>
      <div class="gf-body">
        ${rows.map(r => `
          <label class="gf-row" title="${r.tip}">
            <span class="gf-label">${r.label}</span>
            <input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${forces[r.k]}" data-f="${r.k}">
            <span class="gf-val" data-v="${r.k}">${r.fmt(forces[r.k])}</span>
          </label>`).join('')}
        <button class="gf-reset">↺ 复位力度</button>
        <div class="gf-hint">节点堵成团时,调大排斥力即可展开;调节后即时重排。</div>
      </div>`;
    document.getElementById('view-graph').appendChild(box);
    box.querySelector('.gf-toggle').addEventListener('click', () => box.classList.toggle('collapsed'));
    const syncLabels = () => box.querySelectorAll('input[type=range]').forEach(inp => {
      const r = rows.find(x => x.k === inp.dataset.f);
      inp.value = forces[inp.dataset.f];
      box.querySelector(`.gf-val[data-v="${inp.dataset.f}"]`).textContent = r.fmt(forces[inp.dataset.f]);
    });
    box.querySelectorAll('input[type=range]').forEach(inp => {
      inp.addEventListener('input', () => {
        forces[inp.dataset.f] = +inp.value;
        box.querySelector(`.gf-val[data-v="${inp.dataset.f}"]`).textContent =
          rows.find(x => x.k === inp.dataset.f).fmt(+inp.value);
        applyForces();
        runLayout(160, 0.3);       // 局部收敛:不打散整体布局
      });
    });
    box.querySelector('.gf-reset').addEventListener('click', () => {
      Object.assign(forces, FORCE_DEFAULTS);
      applyForces(); syncLabels();
      runLayout(220, 0.8);
      toast('力度已复位');
    });
  }

  /* ---------- 视图飞行（聚焦/回位；滚轮/拖拽随时打断） ---------- */
  let flyRaf = null;
  function stopFly() { if (flyRaf) { cancelAnimationFrame(flyRaf); flyRaf = null; } }
  function flyTo(tk, tx, ty, ms = 650) {
    stopFly();
    if (window.prefersReducedMotion && window.prefersReducedMotion()) {
      view.k = tk; view.x = tx; view.y = ty; requestDraw(); return;
    }
    const k0 = view.k, x0 = view.x, y0 = view.y;
    const t0 = performance.now();
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      const e = easeOut(t);
      view.k = k0 + (tk - k0) * e;
      view.x = x0 + (tx - x0) * e;
      view.y = y0 + (ty - y0) * e;
      requestDraw();
      if (t < 1) flyRaf = requestAnimationFrame(step); else flyRaf = null;
    };
    flyRaf = requestAnimationFrame(step);
  }

  /* ---------- 聚焦 ---------- */
  function focusNode(name) {
    const n = nodeById.get(name);
    if (!n) { toast('图谱中未找到：' + name); return; }
    // 只亮邻居（墨晕随飞行渐显）
    setHover(n);
    const tk = 1.6;
    flyTo(tk, W / 2 - n.x * tk, H / 2 - n.y * tk);
  }
  window.GraphFocus = focusNode;

  /* ---------- 键盘 API ---------- */
  window.GRAPH = {
    panBy(dx, dy) { stopFly(); view.x += dx; view.y += dy; requestDraw(); },
    zoomBy(f) {
      stopFly();
      const k = Math.max(0.12, Math.min(6, view.k * f));
      view.x = W / 2 - (W / 2 - view.x) * (k / view.k);
      view.y = H / 2 - (H / 2 - view.y) * (k / view.k);
      view.k = k;
      requestDraw();
    },
    reset() {
      hoverRef = null; startHoverTween(0);
      flyTo(0.55, W / 2, H / 2 - 10);
    },
    relayout() { runLayout(260); },
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
  /* 位图与 CSS 盒同步:嵌入式 webview 调整窗格大小时可能不触发 window resize,
     位图被 CSS 拉缩后悬停命中区与绘制区错位(曾致"光标下移一段才聚焦")。
     ResizeObserver 直接盯画布盒尺寸,变化即重设位图。 */
  if (window.ResizeObserver) new ResizeObserver(() => onResize()).observe(canvas);

  let inited = false;
  window.Views.graph = {
    init() {
      if (inited) return;
      inited = true;
      onResize();
      buildToolbar();
      buildForcePanel();
      // 初始布局：以度数排序放置，收敛更快
      nodes.forEach((n, i) => {
        const a = i * 2.39996, r = 14 * Math.sqrt(i + 1);
        n.x = Math.cos(a) * r; n.y = Math.sin(a) * r;
      });
      setTimeout(() => runLayout(320), 60);
      window.addEventListener('resize', onResize);
    },
    onShow(params) {
      // 兜底:视图切回时若盒尺寸又变了(无 ResizeObserver 的环境)先重同步
      const r = canvas.getBoundingClientRect();
      if (Math.abs(r.width - W) > 1 || Math.abs(r.height - H) > 1) onResize();
      refreshSrcRings();               // 正文补载后 cmp 可用,来源环重推导
      requestDraw();
      if (params && params.node) setTimeout(() => focusNode(params.node), 80);
    },
    onSourceChange() { refreshSrcRings(); requestDraw(); },   // 比对外环显隐随编年口径
  };

  /* 来源环重推导:卡片出处优先,无出处回退两书正文提及(cmp 惰性补载后才有) */
  function refreshSrcRings() {
    for (const n of nodes) {
      const e = entityByName.get(n.id);
      if (!e) continue;
      n.src = (e.src && e.src.length) ? e.src
        : (e.cmp ? ['hong', 'zhu'].filter(b => e.cmp[b] && e.cmp[b].n) : []);
    }
  }
})();
