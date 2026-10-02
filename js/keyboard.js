/* ============================================================
   keyboard.js — 全站快捷键
   ------------------------------------------------------------
   全局   1/2/3/4 切换视图 · Ctrl+K 或 / 搜索 · ? 帮助 · Esc 逐层关闭
   时间轴 ←/→ 平移(Shift×4) · ↑/↓ 或 +/- 缩放 · Home/End 首末年
          PgUp/PgDn 时期跳转 · [ / ] 上/下一里程碑(自动聚焦)
          O 全览
   地图   ←/→ 年份±1(Shift×5) · Space 播放/暂停 · Home/End 首末年
   图谱   方向键平移 · +/- 缩放 · 0 复位 · R 重新布局
   ============================================================ */
(function () {
  'use strict';

  const isTyping = e => {
    const t = e.target;
    if (!t || !(t instanceof Element)) return false;
    return t.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
  };

  /* ---------------- 帮助浮层 ---------------- */
  let helpEl = null;
  const GROUPS = [
    ['全局', [
      ['1 2 3 4', '切换 时间轴 / Wiki / 图谱 / 地图'],
      ['S', '切换编年 朱栋霖 / 洪子诚 / 双轨比对'],
      ['Ctrl K 或 /', '全局搜索'],
      ['Esc', '逐层关闭（帮助 → 浮层 → 抽屉）'],
      ['?', '本帮助'],
    ]],
    ['时间轴', [
      ['← →', '左右平移（Shift 加速）'],
      ['↑ ↓ / + −', '屏幕缩放'],
      ['Home / End', '跳到 1949 / 2018'],
      ['PgUp / PgDn', '上一 / 下一时期'],
      ['[ 或 ]', '上一 / 下一里程碑（自动聚焦展开）'],
      ['O', '全览整卷'],
    ]],
    ['地图', [
      ['← →', '年份 ±1（Shift ×5）'],
      ['Space', '播放 / 暂停'],
      ['Home / End', '跳到 1949 / 2018'],
    ]],
    ['图谱', [
      ['方向键', '平移画布'],
      ['+ −', '缩放'],
      ['0', '复位视图'],
      ['R', '重新布局'],
    ]],
  ];

  function buildHelp() {
    helpEl = document.createElement('div');
    helpEl.id = 'kbd-help';
    helpEl.innerHTML = `
      <div class="kh-card">
        <div class="kh-head">快捷键 <span class="kh-esc">Esc 关闭</span></div>
        <div class="kh-grid">
          ${GROUPS.map(([g, rows]) => `
            <div class="kh-group">
              <div class="kh-gtitle">${g}</div>
              ${rows.map(([k, d]) => `<div class="kh-row"><span class="kh-keys">${k.split(' ').map(w =>
                `<kbd>${w}</kbd>`).join(' ')}</span><span class="kh-desc">${d}</span></div>`).join('')}
            </div>`).join('')}
        </div>
      </div>`;
    document.body.appendChild(helpEl);
    helpEl.addEventListener('click', e => { if (e.target === helpEl) toggleHelp(false); });
  }
  function toggleHelp(force) {
    if (!helpEl) buildHelp();
    const show = force === undefined ? !helpEl.classList.contains('open') : force;
    helpEl.classList.toggle('open', show);
  }
  window.toggleKbdHelp = toggleHelp;

  /* ---------------- Esc 逐层关闭 ---------------- */
  function handleEsc() {
    if (helpEl && helpEl.classList.contains('open')) { toggleHelp(false); return true; }
    if (window.closeMapPop) { /* 地图名录浮层 */ const p = document.querySelector('.map-pop'); if (p) { window.closeMapPop(); return true; } }
    const sp = document.getElementById('search-pop');
    if (sp && sp.classList.contains('open')) {
      sp.classList.remove('open');
      document.getElementById('search-input').blur();
      return true;
    }
    const drawer = document.getElementById('drawer');
    if (drawer.classList.contains('open')) { drawer.classList.remove('open'); return true; }
    if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    return false;
  }

  /* ---------------- 各视图路由 ---------------- */
  function routeTimeline(e) {
    const TL = window.TL; if (!TL) return false;
    const step = (window.innerWidth / TL.zoom()) * 0.4;
    switch (e.key) {
      case 'ArrowLeft': TL.panBy(-(e.shiftKey ? step * 4 : step)); return true;
      case 'ArrowRight': TL.panBy(e.shiftKey ? step * 4 : step); return true;
      case 'ArrowUp': case '+': case '=': TL.setZoom(TL.zoom() * 1.3); return true;
      case 'ArrowDown': case '-': case '_': TL.setZoom(TL.zoom() / 1.3); return true;
      case 'Home': TL.goYear(1949); return true;
      case 'End': TL.goYear(2018); return true;
      case 'PageDown': TL.periodJump(1); return true;
      case 'PageUp': TL.periodJump(-1); return true;
      case ']': TL.nextEvent(1); return true;
      case '[': TL.nextEvent(-1); return true;
      case 'o': case 'O': TL.overview(); return true;
    }
    return false;
  }

  function routeMap(e) {
    const M = window.MAP; if (!M) return false;
    switch (e.key) {
      case 'ArrowLeft': M.nudge(e.shiftKey ? -5 : -1); return true;
      case 'ArrowRight': M.nudge(e.shiftKey ? 5 : 1); return true;
      case ' ': M.togglePlay(); return true;
      case 'Home': M.nudge(-999); return true;
      case 'End': M.nudge(999); return true;
    }
    return false;
  }

  function routeGraph(e) {
    const G = window.GRAPH; if (!G) return false;
    switch (e.key) {
      case 'ArrowLeft': G.panBy(60, 0); return true;
      case 'ArrowRight': G.panBy(-60, 0); return true;
      case 'ArrowUp': G.panBy(0, 60); return true;
      case 'ArrowDown': G.panBy(0, -60); return true;
      case '+': case '=': G.zoomBy(1.25); return true;
      case '-': case '_': G.zoomBy(0.8); return true;
      case '0': case 'Home': G.reset(); return true;
      case 'r': case 'R': G.relayout(); return true;
    }
    return false;
  }

  /* ---------------- 总入口 ---------------- */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (handleEsc()) e.preventDefault(); return; }
    if (isTyping(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') return;   // app.js 已处理
    if (e.altKey) return;

    // 帮助
    if (e.key === '?') { toggleHelp(); e.preventDefault(); return; }
    // 搜索
    if (e.key === '/') {
      const si = document.getElementById('search-input');
      si.focus(); si.select();
      e.preventDefault(); return;
    }
    // 视图切换
    if (['1', '2', '3', '4'].includes(e.key)) {
      const v = ['timeline', 'wiki', 'graph', 'map'][+e.key - 1];
      window.switchView(v);
      e.preventDefault(); return;
    }
    // 来源切换(S)
    if (e.key === 's' || e.key === 'S') {
      if (window.cycleSource) { window.cycleSource(); e.preventDefault(); }
      return;
    }

    const view = window.getView ? window.getView() : 'timeline';
    const handled =
      view === 'timeline' ? routeTimeline(e) :
      view === 'map' ? routeMap(e) :
      view === 'graph' ? routeGraph(e) : false;
    if (handled) e.preventDefault();
  });

  // 顶栏帮助按钮（app.js 渲染后挂载）
  window.addEventListener('load', () => {
    const btn = document.getElementById('help-btn');
    if (btn) btn.addEventListener('click', () => toggleHelp());
  });
})();
