/* ============================================================
   wiki.js — WIKI 视图：左侧分类树 + 右侧卡片阅读
   树顶部为分期导航:综述 + 朱/洪两套教材分期(骨架来自《原文》章文件名,
   由 build-data.mjs 生成于 D.periodizations)。章节行跳 Obsidian 原文,
   笔记行开阅读抽屉;hidden 期只显示暂隐提示行。其后按实体类型分组。
   词条卡恒全量(不按编年口径拆分),分期导航恒显两套口径,不随顶栏切换。
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const D = window.DATA;

  const GROUPS = [   // 分期笔记不再平铺成组,由分期导航承载
    { key: 'event', label: '事件 · 运动 · 论争', color: CFG.types.event.color },
    { key: 'policy', label: '文艺政策', color: CFG.types.policy.color },
    { key: 'movement', label: '思潮 · 群体 · 流派', color: CFG.types.movement.color },
    { key: 'theory', label: '理论框架', color: CFG.types.theory.color },
    { key: 'person', label: '人物', color: CFG.types.person.color },
    { key: 'work', label: '作品 · 刊物', color: CFG.types.work.color },
    { key: 'org', label: '组织 · 机构', color: CFG.types.org.color },
  ];

  function collect() {
    const map = new Map(GROUPS.map(g => [g.key, []]));
    D.entities.forEach(e => { if (map.get(e.type)) map.get(e.type).push(e); });
    GROUPS.forEach(g => map.get(g.key).sort((a, b) => a.name.localeCompare(b.name, 'zh')));
    return map;
  }

  let byName = new Map();
  let currentName = '';

  const escAttr = s => String(s).replace(/"/g, '&quot;');
  const obsidianUri = p => `obsidian://open?vault=${CFG.obsidianVault}&file=${encodeURIComponent(String(p).replace(/\.md$/, ''))}`;
  const noteBtn = n => `<button class="wt-item" data-name="${escAttr(n)}">${n}</button>`;
  const gheadHtml = (color, label, count, title) =>
    `<span title="${escAttr(title || label)}"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:7px;opacity:.8"></span>${label}</span>
     <span><span class="count">${count}</span> <span class="arrow">▶</span></span>`;

  /* 折叠组:与 .wt-group 同构(ghead + grid-rows 过渡) */
  function collapsible(parent, headHtml, cls = '') {
    const wrap = document.createElement('div');
    wrap.className = `wt-group ${cls}`.trim();
    wrap.innerHTML = `<div class="wt-ghead">${headHtml}</div>
      <div class="wt-items"><div class="wt-inner"></div></div>`;
    wrap.querySelector('.wt-ghead').addEventListener('click', () => wrap.classList.toggle('open'));
    parent.appendChild(wrap);
    return wrap.querySelector('.wt-inner');
  }

  /* 分期导航:综述 + 两套教材分期(口径色沿用顶栏 --src-zhu / --src-hong) */
  function buildPeriodNav(tree) {
    const PZ = D.periodizations;
    if (!PZ) return;
    if (PZ.overview && PZ.overview.length) {
      const inner = collapsible(tree, gheadHtml('#8a8272', '综述 · 长卷 · 目录', PZ.overview.length));
      inner.innerHTML = PZ.overview.map(noteBtn).join('');
    }
    const colorOf = { zhu: 'var(--src-zhu)', hong: 'var(--src-hong)' };
    for (const key of ['zhu', 'hong']) {
      const pz = PZ[key];
      if (!pz) continue;
      const vis = pz.periods.filter(p => !p.hidden);
      const chapN = vis.reduce((a, p) => a + p.chapters.length, 0);
      const noteN = vis.reduce((a, p) => a + p.notes.length, 0);
      const inner = collapsible(tree,
        gheadHtml(colorOf[key], pz.label, `${chapN}章 · ${noteN}笔记`, `${pz.label} · ${pz.book}`), 'wt-scheme');
      for (const p of pz.periods) {
        if (p.hidden) {
          const muted = document.createElement('div');
          muted.className = 'wt-muted';
          muted.textContent = `${p.name} · 暂隐 ${p.notes.length} 篇`;
          inner.appendChild(muted);
          continue;
        }
        const per = document.createElement('div');
        per.className = 'wt-period';
        per.innerHTML = `
          <div class="wt-phead"><span>${p.name}</span>
            <span><span class="count">${p.chapters.length}章 · ${p.notes.length}篇</span> <span class="arrow">▶</span></span></div>
          <div class="wt-items"><div class="wt-inner">
            ${p.chapters.map(c => `<button class="wt-chap" data-path="${escAttr(c.path)}" title="在 Obsidian 中打开原文">${c.title}</button>`).join('')}
            ${p.notes.map(noteBtn).join('')}
          </div></div>`;
        per.querySelector('.wt-phead').addEventListener('click', () => per.classList.toggle('open'));
        per.querySelectorAll('.wt-chap').forEach(b =>
          b.addEventListener('click', () => window.open(obsidianUri(b.dataset.path), '_blank')));
        per.querySelectorAll('.wt-item').forEach(b =>
          b.addEventListener('click', () => show(b.dataset.name)));
        inner.appendChild(per);
      }
    }
  }

  function buildTree() {
    byName = new Map();
    D.notes.forEach(n => byName.set(n.name, n));
    D.entities.forEach(e => byName.set(e.name, e));
    const tree = document.getElementById('wiki-tree');
    tree.innerHTML = '';
    buildPeriodNav(tree);
    const data = collect();
    for (const g of GROUPS) {
      const items = data.get(g.key);
      if (!items.length) continue;
      const inner = collapsible(tree, gheadHtml(g.color, g.label, items.length));
      inner.innerHTML = items.map(it => noteBtn(it.name)).join('');
      inner.querySelectorAll('.wt-item').forEach(btn =>
        btn.addEventListener('click', () => show(btn.dataset.name)));
    }
    // 默认展开:综述 + 朱版
    tree.querySelectorAll('.wt-group').forEach((g, i) => { if (i < 2) g.classList.add('open'); });
  }

  function badges(item) {
    const parts = [];
    if (item.type !== 'note') {
      const tm = CFG.types[item.type] || CFG.types.other;
      parts.push(`<span class="badge solid" style="background:${tm.color}">${tm.label}</span>`);
    } else {
      parts.push(`<span class="badge solid" style="background:var(--ink-2)">分期笔记</span>`);
    }
    (item.tags || []).slice(0, 12).forEach(t =>
      parts.push(`<span class="tag-chip">${t}</span>`));
    return `<div class="fm-badges">${parts.join('')}</div>`;
  }

  function show(name) {
    const item = byName.get(name);
    if (!item) return;
    currentName = name;
    const box = document.getElementById('wiki-content');
    // 树高亮
    document.querySelectorAll('.wt-item').forEach(b =>
      b.classList.toggle('current', b.dataset.name === name));
    // 移动端:选中条目后收起滑出目录
    document.getElementById('wiki-sidebar')?.classList.remove('open');
    const sub = [];
    if (item.birth) sub.push(item.birth + (item.death ? '—' + item.death : '—'));
    if (item.role) sub.push(item.role);
    if (item.era) sub.push(item.era);
    const bodyHtml = item.body
      ? window.renderWikiStripped(window.stripTitleHeading(item.body, item.name))
      : '（正文加载中…）';
    box.innerHTML = `
      <h1>${item.name}</h1>
      ${badges(item)}
      ${sub.length ? `<p style="color:var(--ink-3);font-size:13px;margin-top:10px">${sub.join(' · ')}</p>` : ''}
      <div style="margin-top:18px" class="wiki-article">${bodyHtml}</div>
      ${window.compareBlockHtml ? window.compareBlockHtml(item) : ''}
      <div class="wiki-links-bar" id="wiki-actions">
        <span class="wlb-label">关联入口</span>
        ${window.crossActionsForWiki ? window.crossActionsForWiki(item) : ''}
      </div>`;
    box.querySelector('#wiki-actions')?.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'timeline') window.switchView('timeline', { focus: +btn.dataset.year });
      else if (act === 'graph') window.switchView('graph', { node: item.name });
      else if (act === 'locate') window.switchView('map', { person: item.name });
      else if (act === 'obsidian') window.open(btn.dataset.uri, '_blank');
    });
    // 正文换装淡入
    if (!(window.prefersReducedMotion && window.prefersReducedMotion())) {
      box.classList.remove('in');
      void box.offsetWidth;
      box.classList.add('in');
    }
    document.getElementById('wiki-main').scrollTop = 0;
    /* 正文/口径摘段在惰性包(data-body.js):包未载则异步补载后重渲染,
       已载但该条从未打开过则同步回填 */
    if (!item.body) {
      if (window.DATA_BODY) {
        const full = window.DATA_BODY[item.name];
        if (full) {
          item.body = full.body;
          if (full.cmp) item.cmp = full.cmp;
          if (item.body || item.cmp) { show(item.name); return; }
        }
      } else if (window.ensureBodyData) {
        window.ensureBodyData().then(() => {
          const full = window.DATA_BODY && window.DATA_BODY[item.name];
          if (!full || currentName !== item.name) return;
          item.body = full.body;
          if (full.cmp) item.cmp = full.cmp;
          if (item.body || item.cmp) show(item.name);
        }).catch(() => { /* 保持加载中提示 */ });
      }
    }
  }
  window.wikiShow = show;

  window.Views.wiki = {
    init() {
      buildTree();
      // 移动端滑出目录开关;点正文区收起
      const sb = document.getElementById('wiki-sidebar');
      document.getElementById('wiki-toc-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        sb.classList.toggle('open');
      });
      document.getElementById('wiki-main').addEventListener('click', () => sb.classList.remove('open'));
      const box = document.getElementById('wiki-content');
      box.innerHTML = `<h1 style="border:none;font-size:22px;color:var(--ink-3)">选择左侧任意卡片开始阅读</h1>
        <p style="color:var(--ink-3)">全库共 ${D.entities.length} 张知识卡片 + ${D.notes.length} 篇分期笔记与综述,按朱栋霖 / 洪子诚两套教材分期编目(分期骨架取自《原文》章名,章节可跳 Obsidian)。<br>
        卡片正文中并排两书说法;编年口径由顶栏切换。</p>`;
    },
    onShow(params) {
      if (params && params.name) show(params.name);
    },
  };
})();
