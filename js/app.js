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

  /* ---------------- 来源模式(编年口径) ----------------
     编年是两套(朱栋霖大事记 / 洪子诚年表),模式只切换编年轨;
     词条卡恒显示全部,并排两书"各自怎么说"的口径对照块。 */
  const SRC_KEY = 'wenxue-src';
  const SRC_MODES = (CFG.sources && CFG.sources.modes) || [];
  const SRC_TOAST = {
    zhu: '编年:朱栋霖大事记(默认口径)',
    hong: '编年:洪子诚年表(1949—2000,逐月详编)',
    compare: '编年双轨:轴上朱记 · 轴下洪表(词条卡恒并排两书说法)',
  };
  window.APP_STATE = window.APP_STATE || {};
  {
    let saved = null;
    try { saved = localStorage.getItem(SRC_KEY); } catch (_) { /* file:// 下可能禁用 */ }
    if (saved === 'all') saved = 'zhu';                 // 旧值迁移
    window.APP_STATE.source = SRC_MODES.some(m => m.id === saved) ? saved : 'zhu';
  }
  const srcMode = () => window.APP_STATE.source;
  const srcMeta = s => (CFG.sources && CFG.sources.meta && CFG.sources.meta[s]) ||
    { label: s, short: s, color: 'var(--ink-3)' };
  /* 编年事件在当前模式下是否可见(洪/比对模式下,已被洪年表命中的策展独立卡隐藏,由洪侧同题卡代替) */
  function eventVisible(ev) {
    const m = srcMode();
    if (m === 'compare') return !(ev.src === 'curated' && ev.hongMatched);
    if (m === 'hong') {
      if (ev.src === 'curated' && ev.hongMatched) return false;
      return ev.src === 'hong' || ev.src === 'curated';
    }
    return ev.src === 'zhu' || ev.src === 'curated';       // zhu(默认)
  }
  window.APP_STATE.srcMode = srcMode;
  window.APP_STATE.eventVisible = eventVisible;
  window.APP_STATE.srcMeta = srcMeta;

  /* ---------------- 工具 ---------------- */
  const $ = sel => document.querySelector(sel);

  // 全站动画开关：减动效偏好下，JS 补间直接跳终态
  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.prefersReducedMotion = prefersReducedMotion;

  /* ---------------- 顶栏 Tab 墨条滑动指示器 ---------------- */
  function moveTabInk(animate) {
    const tabs = document.getElementById('view-tabs');
    if (!tabs) return;
    let ink = document.getElementById('tab-ink');
    if (!ink) {
      ink = document.createElement('div');
      ink.id = 'tab-ink';
      tabs.appendChild(ink);
    }
    const btn = tabs.querySelector('button.active');
    if (!btn) return;
    const tw = tabs.getBoundingClientRect();
    const bw = btn.getBoundingClientRect();
    const w = Math.max(16, Math.min(34, bw.width - 28));
    const first = !ink.style.transform;          // 首次定位不滑动
    if (animate && !first) ink.classList.add('moving'); else ink.classList.remove('moving');
    ink.style.width = w + 'px';
    ink.style.transform = `translateX(${bw.left - tw.left + (bw.width - w) / 2}px)`;
  }
  window.moveTabInk = moveTabInk;
  window.addEventListener('resize', () => moveTabInk(false));

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

  // 抽屉/正文中 wikilink 点击 + 编年条目交叉引用（事件委托）
  document.addEventListener('click', e => {
    const cx = e.target.closest('[data-cross]');
    if (cx) {
      const ev = eventById.get(cx.dataset.cross);
      if (ev) openDrawerEvent(ev);
      return;
    }
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

  // 内容换装：重触发三段错峰淡入
  function swapDrawer() {
    if (prefersReducedMotion()) return;
    drawer.classList.remove('swap');
    void drawer.offsetWidth;
    drawer.classList.add('swap');
  }

  function badge(text, color, solid) {
    return `<span class="badge${solid ? ' solid' : ''}" style="color:${solid ? color : 'var(--ink-2)'};${solid ? '' : `border-color:${color}55`}">${esc(text)}</span>`;
  }

  /* 词条 → 时间轴锚点(年):人物=印章所在期(birth+28) · 笔记=起始年 ·
     作品=workYear · 事件/思潮/运动等=编年中提及该词条的条目(优先里程碑,取最早)。
     供 Wiki 页底与词条抽屉的「时间轴定位」按钮使用。 */
  function timelineAnchor(e) {
    if (!e) return null;
    if (e.type === 'note' || e.note) return e.from ? +e.from : null;
    if (e.type === 'person') {
      if (!e.birth) return null;
      return Math.min(Math.max(+e.birth + 28, CFG.YEAR_MIN), CFG.YEAR_MAX);
    }
    if (e.workYear) return +e.workYear;
    const name = e.name;
    // 编年提及:双链 refs/同题优先;事件·思潮·运动类再放宽到正文含名
    // (年表条目不总是 [[链接]] 该词条,如寻根文学只出现在 1985 条目正文里)
    const chronType = ['event', 'policy', 'movement', 'org', 'theory'].includes(e.type);
    const evs = D.events.filter(ev =>
      (ev.title && resolveName(ev.title) === name) ||
      (ev.refs || []).some(r => resolveName(r) === name) ||
      (chronType && ev.text.includes(name)));
    if (!evs.length) return null;
    const sorted = evs.slice().sort((a, b) => a.year - b.year || (a.month || 0) - (b.month || 0));
    const best = sorted.find(ev => ev.priority === 1) || sorted[0];
    return best.year + ((best.month || 6) - 0.5) / 12;
  }

  function crossActions(name, kind) {
    const e = entityByName.get(name) || noteByName.get(name);
    const anchor = e ? timelineAnchor(e) : null;
    const obsidianUri = `obsidian://open?vault=${CFG.obsidianVault}&file=${encodeURIComponent(name)}`;
    return `
      ${anchor ? `<button data-act="timeline-year" data-year="${Math.round(anchor)}">⇲ 时间轴定位</button>` : ''}
      <button data-act="wiki" data-name="${esc(name)}">📖 Wiki 阅读</button>
      <button data-act="graph" data-name="${esc(name)}">🕸 图谱查看</button>
      ${kind !== 'note' ? `<button data-act="locate" data-name="${esc(name)}">🗺 地图定位</button>` : ''}
      <button data-act="obsidian" data-uri="${esc(obsidianUri)}">✎ Obsidian 打开</button>`;
  }

  /* ---------- 两书口径对照(抽屉 + Wiki 共用):同一个词条,两书原话并排 ---------- */
  function cmpColHtml(book, data, note, e) {
    const meta = srcMeta(book);
    const info = (D.books && D.books[book]) || {};
    const head = `${meta.label}《${info.title || ''}》`;
    if (!data || !data.n) {
      return `<div class="cmp-col">
        <div class="cmp-book"><span class="sdot" style="background:${meta.color}"></span>${esc(head)}</div>
        <div class="cmp-none">本书未提及「${esc(e.name)}」</div>
        ${note ? `<div class="cmp-note">${esc(note)}</div>` : ''}
      </div>`;
    }
    /* 原文摘段:这本书在哪几节着重讲,原话怎么说 */
    const ps = (data.ps || []).map(p => `
      <div class="cmp-passage">
        ${p.s ? `<div class="cmp-psect" style="color:${meta.color}">◈ ${p.s.split(' > ').map(esc).join(' <span class="cmp-sep">›</span> ')}</div>` : ''}
        <div class="cmp-ptext">${esc(p.t)}</div>
      </div>`).join('');
    /* 未入选摘段的其余章节,去重后收成一行"另见" */
    const seen = new Set((data.ps || []).map(p => p.s));
    const restChaps = [...new Set((data.chs || []).filter(c => !seen.has(c)).map(c => c.split(' > ')[0]))];
    return `<div class="cmp-col">
      <div class="cmp-book"><span class="sdot" style="background:${meta.color}"></span>${esc(head)}</div>
      <div class="cmp-stat">提及 ${data.n} 处 · ${data.sn} 个章节小节</div>
      ${ps}
      ${restChaps.length ? `<div class="cmp-more">另见:${restChaps.slice(0, 3).map(esc).join(' · ')}${restChaps.length > 3 ? ' 等' : ''}</div>` : ''}
      ${note ? `<div class="cmp-note">${esc(note)}</div>` : ''}
    </div>`;
  }
  function compareBlockHtml(e) {
    if (!e || e.type === 'note') return '';
    const cmp = e.cmp || {};
    const hasNote = cmp.note && (cmp.note.hong || cmp.note.zhu);
    if (!cmp.hong && !cmp.zhu && !hasNote && !(e.src || []).length) return '';
    const note = cmp.note || {};
    return `<div class="cmp-block">
      <div class="cmp-title"><span>两史口径对照</span><span class="cmp-hint">同一词条,两部文学史各自怎么讲</span></div>
      <div class="cmp-cols">${cmpColHtml('hong', cmp.hong, note.hong, e)}${cmpColHtml('zhu', cmp.zhu, note.zhu, e)}</div>
    </div>`;
  }
  window.compareBlockHtml = compareBlockHtml;

  /* 来源徽章:该卡片的引用出处(洪/朱);无笔记出处时回退用两书正文提及(cmp),
     标作"提及 n 处"以示口径不同(浩然等卡两书都在讲但无章节笔记出处) */
  function srcBadgesHtml(e) {
    const s = e.src || [];
    if (s.length) {
      return s.map(b => {
        const meta = srcMeta(b);
        return badge('● ' + meta.label, meta.color.startsWith('var') ? cssVar(meta.color) : meta.color);
      }).join('');
    }
    const c = e.cmp || {};
    let out = '';
    if (c.hong && c.hong.n) out += badge(`● 洪书提及 ${c.hong.n} 处`, cssVar('--src-hong'));
    if (c.zhu && c.zhu.n) out += badge(`● 朱书提及 ${c.zhu.n} 处`, cssVar('--src-zhu'));
    return out;
  }
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function srcRefsLine(e) {
    const refs = e.srcRefs || [];
    if (!refs.length) return '';
    return `<h3>卡片出处</h3><p>${refs.map(r =>
      `<span style="color:${cssVar(r.book === 'hong' ? '--src-hong' : '--src-zhu')}">◆</span> ${esc(r.label)}`).join('<br>')}</p>`;
  }

  function openDrawerEntity(name) {
    const e = entityByName.get(name);
    if (!e) return;
    const tm = typeMeta(e.type);
    $('#drawer-kicker').innerHTML = badge(tm.label, tm.color, true) +
      (e.era ? badge(String(e.era).replace(/年代$/, '') + ' 年代', tm.color) : '') +
      (e.status ? badge(e.status, tm.color) : '') + srcBadgesHtml(e);
    $('#drawer-title').textContent = e.title;
    const dates = [];
    if (e.birth) dates.push(e.birth + (e.death ? '—' + e.death : '—'));
    if (e.role) dates.push(e.role);
    $('#drawer-sub').textContent = dates.join(' · ');
    const body = stripTitleHeading(e.body || e.summary || '（占位卡片，尚未撰写正文）');
    $('#drawer-body').innerHTML = renderWiki(body) + srcRefsLine(e) + compareBlockHtml(e);
    $('#drawer-actions').innerHTML = crossActions(e.name);
    swapDrawer();
    drawer.classList.add('open');
  }

  /* 编年事件来源徽章 + 另一史年表交叉引用 */
  const EVENT_SRC = { hong: '洪子诚年表', zhu: '朱栋霖大事记', curated: '策展里程碑' };
  function eventSrcBadge(ev) {
    const label = EVENT_SRC[ev.src] || '编年事件';
    const meta = srcMeta(ev.src === 'zhu' ? 'zhu' : ev.src === 'hong' ? 'hong' : 'curated');
    return badge('● ' + label, cssVar(meta.color) || '#8a8272');
  }
  /* 另一史年表交叉引用:优先用构建期的里程碑配对（msTitle 相同 ⇔ 两书各命中一条），
     未配对时退化到同年 [[双链]]/《作品》词元重合；策展独立卡对照其洪侧同题条目 */
  function crossChronicle(ev) {
    if (!ev.src) return '';
    let entries = [];
    let srcLabel = '';
    if (ev.src === 'curated') {
      if (ev.hongMatched) {
        entries = D.events.filter(x => x.src === 'hong' && x.msTitle === ev.title);
        srcLabel = EVENT_SRC.hong;
      }
    } else {
      const other = ev.src === 'hong' ? 'zhu' : 'hong';
      srcLabel = EVENT_SRC[other];
      entries = D.events.filter(x => x.src === other && x.msTitle && x.msTitle === ev.msTitle && x.id !== ev.id);
      if (!entries.length) {
        const cands = D.events.filter(x => x.src === other && x.year === ev.year && x.id !== ev.id);
        const tokens = t => {
          const s = new Set();
          for (const m of String(t).matchAll(/\[\[([^\]|]+)/g)) s.add(m[1].trim());
          for (const m of String(t).matchAll(/《([^》]+)》/g)) s.add(m[1]);
          return s;
        };
        const a = tokens(ev.text);
        entries = cands.map(c => {
          const b = tokens(c.text);
          let sc = 0;
          for (const t of a) if (b.has(t)) sc++;
          return { c, sc };
        }).sort((x, y) => y.sc - x.sc).filter(x => x.sc > 0).slice(0, 2).map(x => x.c);
      }
    }
    if (!entries.length) return '';
    return `<h3>另一史对照 · ${esc(srcLabel)}</h3><p>${entries.slice(0, 2).map(c =>
      `<span class="wikilink" style="color:var(--cinnabar)" data-cross="${esc(c.id)}">${esc(c.year + '年' + (c.month ? c.month + '月' : '') + ' · ' + (c.title || c.label).slice(0, 32))}</span>`
    ).join('<br>')}</p>`;
  }

  function openDrawerEvent(ev) {
    const tm = typeMeta(ev.kind);
    $('#drawer-kicker').innerHTML = badge(ev.milestone ? '里程碑' : '编年事件', tm.color, true) +
      eventSrcBadge(ev) +
      badge(ev.period ? (CFG.periods.find(p => p.id === ev.period) || {}).short || '' : '', tm.color);
    $('#drawer-title').textContent = ev.title || ev.label;
    const dateStr = `${ev.year} 年${ev.month ? ' ' + ev.month + ' 月' : ''}${ev.day ? ' ' + ev.day + ' 日' : ''}`;
    $('#drawer-sub').textContent = dateStr;
    // 内容:里程碑=策展说明+编年原文(不再只给一句话);普通事件=编年原文
    let html = '';
    if (ev.milestone && ev.blurb) {
      html += `<p class="ev-blurb">${esc(ev.blurb)}</p>`;
      if (ev.text && ev.text !== ev.blurb)
        html += `<h3>编年原文 · ${esc(EVENT_SRC[ev.src] || '')}</h3><p>${renderWiki(ev.text)}</p>`;
    } else {
      html += `<p>${renderWiki(ev.text)}</p>`;
    }
    if (ev.refs && ev.refs.length) {
      html += `<h3>相关条目</h3><p>${ev.refs.map(r => {
        const name = resolveName(r);
        return name ? `<span class="wikilink" data-target="${esc(r)}">${esc(r)}</span>` : esc(r);
      }).join('　')}</p>`;
    }
    html += crossChronicle(ev);
    $('#drawer-body').innerHTML = html;
    // 按钮精简:搜索 / 图谱;标题能解析到词条卡时直达 Wiki(联动入口)
    const evName = ev.title || ev.label;
    const wikiName = resolveName(evName);
    $('#drawer-actions').innerHTML = `
      <button data-act="search-name" data-name="${esc(evName)}">🔍 搜索相关卡片</button>
      <button data-act="graph" data-name="${esc(evName)}">🕸 图谱查看</button>
      ${wikiName ? `<button data-act="wiki" data-name="${esc(wikiName)}">📖 Wiki 阅读</button>` : ''}`;
    swapDrawer();
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
    swapDrawer();
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
    else if (act === 'timeline-year') {   // 词条 → 时间轴:聚焦锚点年并自动展开中心事件
      drawer.classList.remove('open');
      switchView('timeline', { focus: +btn.dataset.year });
    }
    else if (act === 'search-name') {          // 打开全局搜索并预填词条名
      drawer.classList.remove('open');
      // 延迟到本轮 click 冒泡结束后,避免被全局"点击搜索框外即关闭"处理器顶掉
      setTimeout(() => {
        const si = document.getElementById('search-input');
        si.focus(); si.value = name;
        si.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    }
    else if (act === 'graph') { switchView('graph', { node: name }); }
    else if (act === 'locate') { switchView('map', { person: name }); }
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
  /* Wiki 页底「关联入口」按钮组(样式见 .wiki-links-bar):
     时间轴定位对全类型词条生效——事件/运动/论争锚到编年中最早提及它的条目 */
  window.crossActionsForWiki = item => {
    const obsidianUri = `obsidian://open?vault=${CFG.obsidianVault}&file=${encodeURIComponent(item.path ? item.path.replace(/\.md$/, '') : item.name)}`;
    const anchor = timelineAnchor(item);
    return `
      ${anchor ? `<button class="btn" data-act="timeline" data-year="${Math.round(anchor)}">⇲ 时间轴定位</button>` : ''}
      <button class="btn" data-act="graph" data-name="${esc(item.name)}">🕸 图谱查看关联</button>
      ${item.type !== 'note' ? `<button class="btn" data-act="locate" data-name="${esc(item.name)}">🗺 地图定位</button>` : ''}
      <button class="btn" data-act="obsidian" data-uri="${esc(obsidianUri)}">✎ Obsidian 打开</button>`;
  };

  /* ---------------- 路由 ---------------- */
  let currentView = 'timeline';
  const switchView = (view, params = {}) => {
    currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + view).classList.add('active');
    document.querySelectorAll('#view-tabs button').forEach(b =>
      b.classList.toggle('active', b.dataset.view === view));
    moveTabInk(true);
    // 重启动画（display:none→block 重新挂载时 animation 会自动重放，
    // 但同视图深链跳转不换 class，这里统一重触发一次）
    const viewEl = document.getElementById('view-' + view);
    if (!prefersReducedMotion()) {
      viewEl.style.animation = 'none';
      void viewEl.offsetWidth;
      viewEl.style.animation = '';
    }
    // 更新 hash（不触发重复路由）
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, v])
    ).toString();
    const newHash = '#/' + view + (q ? '?' + q : '');
    if (location.hash !== newHash) history.replaceState(null, '', newHash);
    // 通知视图(先 init 再 onShow:onShow 可能依赖 init 建立的状态,
    // 如时间轴 focusYear 需要 layout() 已算出的分区)
    const mod = window.Views[view];
    if (mod && !mod._inited) { mod.init(); mod._inited = true; }
    if (mod && mod.onShow) mod.onShow(params);
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
    // 来源深链(#/timeline?src=hong)
    if (params.src && params.src !== srcMode() && SRC_MODES.some(x => x.id === params.src))
      setSource(params.src, { fromHash: true });
    switchView(m[1], params);
  }
  window.addEventListener('hashchange', routeFromHash);

  /* ---------------- 全局搜索(随来源模式重建) ---------------- */
  let searchIndex = [];
  function buildSearchIndex() {
    searchIndex = [];
    D.entities.forEach(e => {                 // 词条卡恒可搜(不按来源拆分)
      searchIndex.push({
        kind: 'entity', name: e.name, type: e.type, meta: typeMeta(e.type).label + (e.birth ? ' · ' + e.birth + (e.death ? '—' + e.death : '') : ''),
        text: e.name + ' ' + (e.tags || []).join(' ') + ' ' + (e.summary || ''),
      });
    });
    D.notes.forEach(n => searchIndex.push({
      kind: 'note', name: n.name, type: 'note', meta: '分期笔记',
      text: n.name + ' ' + (n.tags || []).join(' ') + ' ' + (n.summary || ''),
    }));
    D.events.forEach(ev => {
      if (!eventVisible(ev)) return;
      const srcTag = ev.src === 'hong' ? ' · 洪年表' : ev.src === 'curated' ? ' · 策展' : '';
      searchIndex.push({
        kind: 'event', name: ev.id, title: ev.title || ev.label, meta: ev.year + ' 年' + (ev.month ? ev.month + ' 月' : '') + srcTag,
        text: (ev.title || '') + ' ' + ev.label + ' ' + (ev.blurb || ''),
      });
    });
  }
  buildSearchIndex();

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

  /* ---------------- 来源切换控件(顶栏) ---------------- */
  function buildSourceSwitch() {
    const bar = document.createElement('div');
    bar.id = 'src-switch';
    bar.innerHTML = SRC_MODES.map(m => {
      const dot = (m.id === 'hong' || m.id === 'zhu')
        ? `<span class="sdot" style="background:${cssVar(srcMeta(m.id).color)}"></span>` : '';
      return `<button data-src="${m.id}" title="${esc(m.title || m.label)}">${dot}${esc(m.label)}</button>`;
    }).join('');
    const spacer = document.querySelector('#topbar .spacer');
    if (spacer && spacer.parentNode) spacer.parentNode.insertBefore(bar, spacer.nextSibling);
    else document.getElementById('topbar').appendChild(bar);
    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) setSource(b.dataset.src);
    });
    syncSourceSwitch();
  }
  function syncSourceSwitch() {
    document.querySelectorAll('#src-switch button').forEach(b =>
      b.classList.toggle('active', b.dataset.src === srcMode()));
  }
  function setSource(m, opts = {}) {
    if (!SRC_MODES.some(x => x.id === m)) return;
    window.APP_STATE.source = m;
    try { localStorage.setItem(SRC_KEY, m); } catch (_) { /* 忽略 */ }
    syncSourceSwitch();
    buildSearchIndex();
    if (!opts.fromHash) {
      // 同步 hash(保留视图与其它参数),不触发重复路由
      const h = /^#\/(\w+)(?:\?(.*))?$/.exec(location.hash);
      const view = h ? h[1] : 'timeline';
      const params = new URLSearchParams(h && h[2] ? h[2] : '');
      params.set('src', m);
      history.replaceState(null, '', '#/' + view + '?' + params.toString());
    }
    document.getElementById('drawer').classList.remove('open');
    for (const mod of Object.values(window.Views || {}))
      if (mod.onSourceChange) mod.onSourceChange();
    if (!opts.silent) toast(SRC_TOAST[m] || m, 2200);
  }
  window.setSource = setSource;
  window.cycleSource = () => {
    const i = SRC_MODES.findIndex(x => x.id === srcMode());
    setSource(SRC_MODES[(i + 1) % SRC_MODES.length].id);
  };

  /* ---------------- 启动 ---------------- */
  marked.setOptions({ breaks: true });
  buildSourceSwitch();
  // 墨条初始定位（字体就绪后宽度可能变化，补一次）
  moveTabInk(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveTabInk(false));
  // 首次路由推迟到 load：确保所有视图模块（后加载的 timeline/graph/map）已注册
  window.addEventListener('load', routeFromHash);
  window.addEventListener('DOMContentLoaded', routeFromHash);
})();
