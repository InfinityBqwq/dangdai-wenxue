/* ============================================================
   wiki.js — WIKI 视图：左侧分类树 + 右侧卡片阅读
   树顶部为分期导航:综述 + 教材分期(骨架来自《原文》章文件名,
   由 build-data.mjs 生成于 D.periodizations)。
   分期导航随顶栏口径**全局联动**(用户钦定):朱/洪模式只显示对应一版,
   比对模式两版并置;实现 onSourceChange 重建树。
   章节行页内阅读原文(正文+每章 AI 总结在惰性包 DATA_BODY.__chapters,
   总结置顶作导读),Obsidian 仅为拓展入口。
   其后按实体类型分组;词条卡恒全量(不按编年口径拆分)。
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
  let inited = false;   // 首路由前 setSource(fromHash) 不触发建树(init 尚未跑)

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

  /* 分期导航:综述 + 教材分期(随顶栏口径全局联动,比对模式并置两版) */
  function visibleSchemes() {
    const m = window.APP_STATE && window.APP_STATE.srcMode();
    return m === 'zhu' ? ['zhu'] : m === 'hong' ? ['hong'] : ['zhu', 'hong'];
  }
  function buildPeriodNav(tree) {
    const PZ = D.periodizations;
    if (!PZ) return;
    if (PZ.overview && PZ.overview.length) {
      const inner = collapsible(tree, gheadHtml('#8a8272', '综述 · 长卷 · 目录', PZ.overview.length));
      inner.innerHTML = PZ.overview.map(noteBtn).join('');
      inner.querySelectorAll('.wt-item').forEach(b =>
        b.addEventListener('click', () => show(b.dataset.name)));
    }
    const colorOf = { zhu: 'var(--src-zhu)', hong: 'var(--src-hong)' };
    for (const key of visibleSchemes()) {
      const pz = PZ[key];
      if (!pz) continue;
      const vis = pz.periods.filter(p => !p.hidden);
      const chapN = vis.reduce((a, p) => a + p.chapters.length, 0);
      const noteN = vis.reduce((a, p) => a + p.notes.length, 0);
      const inner = collapsible(tree,
        gheadHtml(colorOf[key], pz.label, `${chapN}章${noteN ? ' · ' + noteN + '笔记' : ''}`, `${pz.label} · ${pz.book}`), 'wt-scheme');
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
            <span><span class="count">${p.chapters.length}章${p.notes.length ? ' · ' + p.notes.length + '篇' : ''}</span> <span class="arrow">▶</span></span></div>
          <div class="wt-items"><div class="wt-inner">
            ${p.chapters.map(c => `<button class="wt-chap" data-path="${escAttr(c.path)}" title="打开原文(页内阅读)">${c.title}</button>`
              + (c.sum ? `<button class="wt-sum" data-path="${escAttr(c.path)}" title="${escAttr(c.sum)}">AI 总结</button>` : '')).join('')}
            ${p.notes.map(noteBtn).join('')}
          </div></div>`;
        per.querySelector('.wt-phead').addEventListener('click', () => per.classList.toggle('open'));
        const chapByPath = new Map(p.chapters.map(c => [c.path, c]));
        const openChap = path => showChapter(chapByPath.get(path), pz);
        per.querySelectorAll('.wt-chap, .wt-sum').forEach(b =>
          b.addEventListener('click', () => openChap(b.dataset.path)));
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
    // 默认展开:综述 + 首个方案块
    tree.querySelectorAll('.wt-group').forEach((g, i) => { if (i < 2) g.classList.add('open'); });
    // 口径切换重建后,重放当前选中(章节或词条)并展开其所在分组
    if (currentPath) {
      const b = [...tree.querySelectorAll('.wt-chap')].find(x => x.dataset.path === currentPath);
      if (b) { b.classList.add('current'); openUp(b); }
    } else if (currentName) {
      const b = [...tree.querySelectorAll('.wt-item')].find(x => x.dataset.name === currentName);
      if (b) { b.classList.add('current'); openUp(b); }
    }
  }
  function openUp(el) {
    el.closest('.wt-period')?.classList.add('open');
    el.closest('.wt-group')?.classList.add('open');
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
    currentPath = '';
    const box = document.getElementById('wiki-content');
    // 树高亮
    document.querySelectorAll('.wt-item').forEach(b =>
      b.classList.toggle('current', b.dataset.name === name));
    document.querySelectorAll('.wt-chap').forEach(b => b.classList.remove('current'));
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
      else if (act === 'puzzle') window.switchView('puzzle', { add: item.name });
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

  /* 教材章原文页内阅读(用户钦定:网页内展示是基本,Obsidian 跳转只是拓展)。
     正文与每章 AI 总结在惰性包 DATA_BODY.__chapters(路径 → {body, sum}),
     总结置顶作导读缓解整章阅读压力;包未载则 ensureBodyData 后重渲染。 */
  let currentPath = '';
  function showChapter(ch, pz) {
    if (!ch) return;
    currentName = '';
    currentPath = ch.path;
    const box = document.getElementById('wiki-content');
    document.querySelectorAll('.wt-item').forEach(b => b.classList.remove('current'));
    document.querySelectorAll('.wt-chap').forEach(b =>
      b.classList.toggle('current', b.dataset.path === ch.path));
    document.getElementById('wiki-sidebar')?.classList.remove('open');
    const rec = window.DATA_BODY && window.DATA_BODY.__chapters
      ? window.DATA_BODY.__chapters[ch.path] : null;
    const raw = rec ? rec.body : '';
    const sum = rec ? rec.sum.replace(/^#\s+[^\n]*\r?\n?/, '') : '';  // 剥总结自带大标题,与盒标题去重
    const sumHtml = sum
      ? `<details class="chap-sum" open>
           <summary>AI 总结 · 本章导读</summary>
           <div class="chap-sum-body">${window.renderWikiStripped(window.stripTitleHeading(sum, ch.title))}</div>
         </details>`
      : '';
    box.innerHTML = `
      <h1>${ch.title}</h1>
      <div class="fm-badges">
        <span class="badge solid" style="background:var(--ink-2)">教材原文</span>
        <span class="badge solid" style="background:${pz.id === 'hong' ? 'var(--src-hong)' : 'var(--src-zhu)'}">${pz.label}</span>
      </div>
      ${sumHtml}
      <div style="margin-top:18px" class="wiki-article">${raw
        ? window.renderWikiStripped(window.stripTitleHeading(raw, ch.title))
        : '（原文加载中…）'}</div>
      <div class="wiki-links-bar" id="wiki-actions">
        <span class="wlb-label">关联入口</span>
        <button data-act="obsidian" data-uri="${escAttr(obsidianUri(ch.path))}">✎ Obsidian 打开</button>
      </div>`;
    box.querySelector('#wiki-actions')?.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (btn && btn.dataset.act === 'obsidian') window.open(btn.dataset.uri, '_blank');
    });
    if (!(window.prefersReducedMotion && window.prefersReducedMotion())) {
      box.classList.remove('in');
      void box.offsetWidth;
      box.classList.add('in');
    }
    document.getElementById('wiki-main').scrollTop = 0;
    if (!raw && !window.DATA_BODY && window.ensureBodyData) {
      window.ensureBodyData().then(() => {
        if (currentPath === ch.path) showChapter(ch, pz);
      }).catch(() => { /* 保持加载中提示 */ });
    }
  }

  window.Views.wiki = {
    init() {
      inited = true;
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
        <p style="color:var(--ink-3)">全库共 ${D.entities.length} 张知识卡片 + ${D.notes.length} 篇分期笔记与综述。分期导航随顶栏口径全局联动:朱栋霖 / 洪子诚模式显示对应一版的原文章节与总结笔记,「比对」并置两版;章节原文可在页内阅读,每章附 AI 总结导读。<br>
        词条卡片正文中恒并排两书说法。</p>`;
    },
    onShow(params) {
      if (params && params.name) show(params.name);
    },
    onSourceChange() {
      if (inited) buildTree();
    },
  };
})();
