/* ============================================================
   wiki.js — WIKI 视图：左侧分类树 + 右侧卡片阅读
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const D = window.DATA;

  const GROUPS = [
    { key: 'note', label: '分期笔记 · 综述', color: '#8a8272' },
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
    D.notes.forEach(n => map.get('note').push(n));
    D.entities.forEach(e => { if (map.get(e.type)) map.get(e.type).push(e); });
    GROUPS.forEach(g => map.get(g.key).sort((a, b) => a.name.localeCompare(b.name, 'zh')));
    return map;
  }

  let byName = new Map();
  function buildTree() {
    const data = collect();
    byName = new Map();
    for (const arr of data.values()) arr.forEach(item => byName.set(item.name, item));
    const tree = document.getElementById('wiki-tree');
    tree.innerHTML = '';
    for (const g of GROUPS) {
      const items = data.get(g.key);
      if (!items.length) continue;
      const wrap = document.createElement('div');
      wrap.className = 'wt-group';
      wrap.innerHTML = `
        <div class="wt-ghead">
          <span><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${g.color};margin-right:7px;opacity:.8"></span>${g.label}</span>
          <span><span class="count">${items.length}</span> <span class="arrow">▶</span></span>
        </div>
        <div class="wt-items">${items.map(it =>
          `<button class="wt-item" data-name="${it.name.replace(/"/g, '&quot;')}">${it.name}</button>`).join('')}
        </div>`;
      wrap.querySelector('.wt-ghead').addEventListener('click', () => wrap.classList.toggle('open'));
      wrap.querySelectorAll('.wt-item').forEach(btn =>
        btn.addEventListener('click', () => show(btn.dataset.name)));
      tree.appendChild(wrap);
    }
    // 默认展开前两组
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
    const box = document.getElementById('wiki-content');
    // 树高亮
    document.querySelectorAll('.wt-item').forEach(b =>
      b.classList.toggle('current', b.dataset.name === name));
    const sub = [];
    if (item.birth) sub.push(item.birth + (item.death ? '—' + item.death : '—'));
    if (item.role) sub.push(item.role);
    if (item.era) sub.push(item.era);
    box.innerHTML = `
      <h1>${item.name}</h1>
      ${badges(item)}
      ${sub.length ? `<p style="color:var(--ink-3);font-size:13px;margin-top:10px">${sub.join(' · ')}</p>` : ''}
      <div style="margin-top:18px" class="wiki-article">${window.renderWikiStripped(window.stripTitleHeading(item.body || '（占位卡片：知识库中尚无正文。可从图谱/时间轴查看其关联。）', item.name))}</div>
      <hr style="margin-top:36px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px" id="wiki-actions">
        ${window.crossActionsForWiki ? window.crossActionsForWiki(item) : ''}
      </div>`;
    box.querySelector('#wiki-actions')?.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'graph') window.switchView('graph', { node: item.name });
      else if (act === 'locate') window.switchView('map', { person: item.name });
      else if (act === 'timeline') window.switchView('timeline', { focus: item.birth || item.from || '' });
      else if (act === 'obsidian') window.open(btn.dataset.uri, '_blank');
    });
    document.getElementById('wiki-main').scrollTop = 0;
  }
  window.wikiShow = show;

  window.Views.wiki = {
    init() {
      buildTree();
      const box = document.getElementById('wiki-content');
      box.innerHTML = `<h1 style="border:none;font-size:22px;color:var(--ink-3)">选择左侧任意卡片开始阅读</h1>
        <p style="color:var(--ink-3)">全库共 ${D.entities.length} 张知识卡片 + ${D.notes.length} 篇分期笔记与综述。<br>
        卡片正文中的 <span style="color:var(--cinnabar)">朱红双链</span> 可直接点击跳转。</p>`;
    },
    onShow(params) {
      if (params && params.name) show(params.name);
    },
  };
})();
