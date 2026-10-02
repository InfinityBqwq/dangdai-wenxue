/* ============================================================
   app.js — 应用骨架：路由 / 详情抽屉 / 全局搜索 / 工具函数
   视图模块：timeline.js wiki.js graph.js map.js
   约定：各视图模块挂载在 window.Views 下，实现 init() 与可选的
   onShow(params)。
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const D = window.DATA;
  window.Views = window.Views || {};

  /* ---------------- 基础索引 ---------------- */
  const entityByName = new Map();
  const noteByName = new Map();
  const eventById = new Map();
  D.entities.forEach(e => entityByName.set(e.name, e));
  D.notes.forEach(n => noteByName.set(n.name, n));
  D.events.forEach(ev => eventById.set(ev.id, ev));

  // 名称模糊解析：去掉《》“”空格 后匹配
  const norm = s => String(s).replace(/[《》“”"'‘’\s]/g, '').trim();
  const normIndex = new Map();
  D.entities.forEach(e => normIndex.set(norm(e.name), e.name));
  D.notes.forEach(n => { if (!normIndex.has(norm(n.name))) normIndex.set(norm(n.name), n.name); });

  function resolveName(raw) {
    const n = norm(raw);
    return normIndex.get(n) || null;
  }

  /* ---------------- 工具 ---------------- */
  const $ = sel => document.querySelector(sel);

  function toast(msg, ms = 1800) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), ms);
  }
  window.toast = toast;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 去掉正文开头与标题重复的 "# 标题" 行 */
  function stripTitleHeading(body, title) {
    const lines = String(body).split(/\r?\n/);
    if (lines.length && /^#\s+/.test(lines[0])) {
      const head = lines[0].replace(/^#\s+/, '').replace(/[\[\]《》]/g, '');
      const t = String(title || '').replace(/[\[\]《》]/g, '');
      if (!t || head.includes(t.slice(0, 4)) || t.includes(head.slice(0, 4))) lines.shift();
    }
    return lines.join('\n');
  }

  /* Markdown 渲染：[[链接]] → 可点击 span，marked 处理其余语法 */
  function renderWiki(md) {
    // 先把 [[...]] 替换成占位符，避免 marked 破坏
    const stash = [];
    md = String(md).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
      const t = target.trim();
      const label = (alias || t).trim();
      const idx = stash.push({ t, label }) - 1;
      return `@@WL${idx}@@`;
    });
    let html = marked.parse(md, { breaks: true });
    html = html.replace(/@@WL(\d+)@@/g, (_, i) => {
      const { t, label } = stash[i];
      const exists = resolveName(t) !== null;
      return `<span class="wikilink${exists ? '' : ' missing'}" data-target="${esc(t)}">${esc(label)}</span>`;
    });
    return html;
  }

  // 抽屉/正文中 wikilink 点击（事件委托）
  document.addEventListener('click', e => {
    const wl = e.target.closest('.wikilink');
    if (wl) {
      const name = resolveName(wl.dataset.target);
      if (name) openWikiPage(name);
      else toast('知识库中没有这张卡片：' + wl.dataset.target);
    }
  });

  /* ---------------- 详情抽屉 ---------------- */
  const drawer = $('#drawer');
  const typeMeta = t => CFG.types[t] || CFG.types.other;

  function badge(text, color, solid) {
    return `<span class="badge${solid ? ' solid' : ''}" style="color:${solid ? color : 'var(--ink-2)'};${solid ? '' : `border-color:${color}55`}">${esc(text)}</span>`;
  }

  function crossActions(name, kind) {
    const obsidianUri = `obsidian://open?vault=${CFG.obsidianVault}&file=${encodeURIComponent(name)}`;
    return `
      <button data-act="wiki" data-name="${esc(name)}">📖 Wiki 阅读</button>
      <button data-act="graph" data-name="${esc(name)}">🕸 图谱查看</button>
      ${kind !== 'note' ? `<button data-act="locate" data-name="${esc(name)}">🗺 地图定位</button>` : ''}
      <button data-act="obsidian" data-uri="${esc(obsidianUri)}">✎ Obsidian 打开</button>`;
  }

  function openDrawerEntity(name) {
    const e = entityByName.get(name);
    if (!e) return;
    const tm = typeMeta(e.type);
    $('#drawer-kicker').innerHTML = badge(tm.label, tm.color, true) +
      (e.era ? badge(String(e.era).replace(/年代$/, '') + ' 年代', tm.color) : '') +
      (e.status ? badge(e.status, tm.color) : '');
    $('#drawer-title').textContent = e.title;
    const dates = [];
    if (e.birth) dates.push(e.birth + (e.death ? '—' + e.death : '—'));
    if (e.role) dates.push(e.role);
    $('#drawer-sub').textContent = dates.join(' · ');
    const body = stripTitleHeading(e.body || e.summary || '（占位卡片，尚未撰写正文）');
    $('#drawer-body').innerHTML = renderWiki(body);
    $('#drawer-actions').innerHTML = crossActions(e.name);
    drawer.classList.add('open');
  }

  function openDrawerEvent(ev) {
    const tm = typeMeta(ev.kind);
    $('#drawer-kicker').innerHTML = badge(ev.milestone ? '里程碑' : '编年事件', tm.color, true) +
      badge(ev.period ? (CFG.periods.find(p => p.id === ev.period) || {}).short || '' : '', tm.color);
    $('#drawer-title').textContent = ev.title || ev.label;
    const dateStr = `${ev.year} 年${ev.month ? ' ' + ev.month + ' 月' : ''}${ev.day ? ' ' + ev.day + ' 日' : ''}`;
    $('#drawer-sub').textContent = dateStr;
    // 里程碑：以策展说明为主，避免与编年原文重复；非里程碑：显示原文
    let html = '';
    if (ev.milestone && ev.blurb) {
      html += `<p style="color:var(--ink-1);font-weight:500">${esc(ev.blurb)}</p>`;
    } else {
      html += `<p>${renderWiki(ev.text)}</p>`;
    }
    if (ev.refs && ev.refs.length) {
      html += `<h3>相关条目</h3><p>${ev.refs.map(r => {
        const name = resolveName(r);
        return name ? `<span class="wikilink" data-target="${esc(r)}">${esc(r)}</span>` : esc(r);
      }).join('　')}</p>`;
    }
    $('#drawer-body').innerHTML = html;
    $('#drawer-actions').innerHTML = `
      <button data-act="timeline-focus" data-year="${ev.year}">⇲ 时间轴定位 ${ev.year}</button>
      ${crossActions(ev.title || ev.label, 'event').replace('📖 Wiki 阅读', '🔍 搜索同名卡片')}`;
    drawer.classList.add('open');
  }

  function openDrawerNote(name) {
    const n = noteByName.get(name);
    if (!n) return;
    $('#drawer-kicker').innerHTML = badge('分期笔记', CFG.types.other.color, true) +
      (n.from ? badge(`${n.from}${n.to ? '—' + n.to : ''}`, CFG.types.other.color) : '');
    $('#drawer-title').textContent = n.title;
    $('#drawer-sub').textContent = '';
    $('#drawer-body').innerHTML = renderWiki(n.body);
    $('#drawer-actions').innerHTML = crossActions(n.name, 'note');
    drawer.classList.add('open');
  }

  window.openDrawerEntity = openDrawerEntity;
  window.openDrawerEvent = openDrawerEvent;

  // 抽屉动作按钮
  $('#drawer-actions').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const act = btn.dataset.act;
    const name = btn.dataset.name;
    if (act === 'wiki') { drawer.classList.remove('open'); switchView('wiki', { name }); }
    else if (act === 'graph') { switchView('graph', { node: name }); }
    else if (act === 'locate') { switchView('map', { person: name }); }
    else if (act === 'timeline-focus') { switchView('timeline', { focus: +btn.dataset.year }); }
    else if (act === 'obsidian') { window.open(btn.dataset.uri, '_blank'); }
  });
  $('#drawer .drawer-close').addEventListener('click', () => drawer.classList.remove('open'));
  // Esc 关闭由 keyboard.js 统一分层处理（帮助 → 浮层 → 搜索 → 抽屉）

  // WIKI 视图内打开页面（wiki.js 也调用）
  function openWikiPage(name) {
    const canon = resolveName(name);
    if (!canon) { toast('未找到：' + name); return; }
    if (entityByName.get(canon)) { drawer.classList.remove('open'); }
    switchView('wiki', { name: canon });
  }
  window.openWikiPage = openWikiPage;

  // 供 wiki.js 使用
  window.renderWikiStripped = renderWiki;
  window.stripTitleHeading = stripTitleHeading;
  window.crossActionsForWiki = item => {
    const obsidianUri = `obsidian://open?vault=${CFG.obsidianVault}&file=${encodeURIComponent(item.path ? item.path.replace(/\.md$/, '') : item.name)}`;
    return `
      <button data-act="graph" data-name="${esc(item.name)}">🕸 图谱查看关联</button>
      ${item.type !== 'note' ? `<button data-act="locate" data-name="${esc(item.name)}">🗺 地图定位</button>` : ''}
      ${(item.birth || item.from) ? `<button data-act="timeline" data-name="${esc(item.name)}">⇲ 时间轴定位</button>` : ''}
      <button data-act="obsidian" data-uri="${esc(obsidianUri)}">✎ Obsidian 打开</button>`;
  };

  /* ---------------- 路由 ---------------- */
  let currentView = 'timeline';
  const switchView = (view, params = {}) => {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    document.querySelectorAll('#view-tabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    // 更新 hash（不触发重复路由）
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, v])
    ).toString();
    const newHash = '#/' + view + (q ? '?' + q : '');
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
    // 通知视图
    const mod = window.Views[view];
    if (mod && mod.onShow) mod.onShow(params);
    if (mod && !mod._inited) { mod.init(); mod._inited = true; if (mod.onShow) mod.onShow(params); }
  };
  window.switchView = switchView;
  window.getView = () => currentView;

  document.querySelectorAll('#view-tabs button').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.view)));

  function routeFromHash() {
    const m = /^#\/(\w+)(?:\?(.*))?$/.exec(location.hash);
    if (!m) { switchView('timeline', {}); return; }
    const params = {};
    if (m[2]) new URLSearchParams(m[2]).forEach((v, k) => params[k] = v);
    // 类型修正
    if (params.focus) params.focus = +params.focus;
    switchView(m[1], params);
  }
  window.addEventListener('hashchange', routeFromHash);

  /* ---------------- 全局搜索 ---------------- */
  const searchIndex = [];
  D.entities.forEach(e => searchIndex.push({
    kind: 'entity', name: e.name, type: e.type, meta: typeMeta(e.type).label + (e.birth ? ' · ' + e.birth + (e.death ? '—' + e.death : '') : ''),
    text: e.name + ' ' + (e.tags || []).join(' ') + ' ' + (e.summary || ''),
  }));
  D.notes.forEach(n => searchIndex.push({
    kind: 'note', name: n.name, type: 'note', meta: '分期笔记',
    text: n.name + ' ' + (n.tags || []).join(' ') + ' ' + (n.summary || ''),
  }));
  D.events.forEach(ev => searchIndex.push({
    kind: 'event', name: ev.id, title: ev.title || ev.label, meta: ev.year + ' 年' + (ev.month ? ev.month + ' 月' : ''),
    text: (ev.title || '') + ' ' + ev.label + ' ' + (ev.blurb || ''),
  }));

  const searchPop = $('#search-pop');
  const searchInput = $('#search-input');

  function runSearch(q) {
    q = q.trim();
    if (q.length < 1) { searchPop.classList.remove('open'); return; }
    const nq = norm(q);
    const scored = [];
    for (const item of searchIndex) {
      const nameN = norm(item.title || item.name);
      let score = -1;
      if (nameN.startsWith(nq)) score = 100;
      else if (nameN.includes(nq)) score = 60;
      else if (norm(item.text).includes(nq)) score = 25;
      if (item.kind === 'entity') score += 4;
      if (score > 0) scored.push({ item, score, nameN, nq });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 24);
    searchPop.innerHTML = top.length ? top.map(({ item, nq, nameN }, i) => {
      const title = item.title || item.name;
      const hl = t => esc(t).replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
      const snippet = item.text.length > 90 ? item.text.slice(0, 90) + '…' : item.text;
      return `<button class="sp-item" data-kind="${item.kind}" data-name="${esc(item.name)}" data-title="${esc(title)}">
        <div class="sp-title">${hl(title)}</div>
        <div class="sp-meta">${esc(item.meta)}</div>
        ${item.kind !== 'entity' ? `<div class="sp-snippet">${hl(snippet)}</div>` : ''}
      </button>`;
    }).join('') : '<div class="sp-empty">没有找到「' + esc(q) + '」相关的条目</div>';
    searchPop.classList.add('open');
  }

  searchInput.addEventListener('input', () => runSearch(searchInput.value));
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = searchPop.querySelector('.sp-item');
      if (first) first.click();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#search-pop') && !e.target.closest('#global-search')) {
      searchPop.classList.remove('open');
    }
  });
  searchPop.addEventListener('click', e => {
    const btn = e.target.closest('.sp-item');
    if (!btn) return;
    searchPop.classList.remove('open');
    searchInput.value = '';
    const { kind, name } = btn.dataset;
    if (kind === 'entity') {
      openDrawerEntity(name);           // 抽屉直接看，不打断当前视图
    } else if (kind === 'note') {
      openWikiPage(name);
    } else if (kind === 'event') {
      openDrawerEvent(eventById.get(name));
      switchView('timeline', { focus: eventById.get(name).year });
    }
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  /* ---------------- 启动 ---------------- */
  marked.setOptions({ breaks: true });
  // 首次路由推迟到 load：确保所有视图模块（后加载的 timeline/graph/map）已注册
  window.addEventListener('load', routeFromHash);
  window.addEventListener('DOMContentLoaded', routeFromHash);
})();
