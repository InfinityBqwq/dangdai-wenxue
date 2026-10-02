/* ============================================================
   map.js — 地图视图：ECharts 中国地图 + 地图钉（性能重构版）
   ------------------------------------------------------------
   · 单词条钉：单击直接右侧抽屉展示详情
   · 多词条钉：单击弹出名录浮层，点名录中任一条再开抽屉
   · 性能：canvas 渲染器（GPU 合成）+ animation 关闭；
     只有"可见钉集合"变化时才 setOption，滑杆/播放期间
     其余帧零 ECharts 开销 → 播放连续流畅
   · 播放：requestAnimationFrame 连续推进年份（浮点年），
     每秒 2 年，钉在其实际活动年份边界出现/消失
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG;
  const D = window.DATA;

  const chartDom = document.getElementById('map-chart');
  const slider = document.getElementById('map-slider');
  const playBtn = document.getElementById('map-play');
  let chart = null;
  let year = 1949;
  let playRaf = null, playLastT = 0;
  let lastKey = '';
  const YPS = 2;                       // 播放速度：年/秒

  const entityByName = new Map(D.entities.map(e => [e.name, e]));
  const YMIN = CFG.YEAR_MIN, YMAX = CFG.YEAR_MAX;

  /* ---------- 地点数据(恒全量;编年口径不拆地图钉) ---------- */
  const locs = (D.locations || []).filter(l => l.x && l.y);
  const locsAt = y => locs.filter(l => (l.from ?? YMIN) <= y && y <= (l.to ?? YMAX));
  const visibleKey = list => list.map(l => l.n).join('¦');

  function seriesData(list) {
    const byPos = new Map();
    for (const l of list) {
      const k = l.x.toFixed(2) + ',' + l.y.toFixed(2);
      if (!byPos.has(k)) byPos.set(k, { x: l.x, y: l.y, items: [] });
      byPos.get(k).items.push(l);
    }
    const out = { person: [], group: [], work: [] };
    for (const g of byPos.values()) {
      const byType = { person: [], group: [], work: [] };
      g.items.forEach(l => (byType[l.t] || byType.group).push(l));
      for (const [t, arr] of Object.entries(byType)) {
        if (!arr.length) continue;
        out[t].push({
          name: arr[0].city,
          value: [g.x, g.y, arr.length],
          items: arr,
          count: arr.length,
        });
      }
    }
    return out;
  }

  /* ---------- 样式 ---------- */
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  /* ---------- 年份推进（核心：只在集合变化时才动 ECharts） ----------
     animate=true 时给钉子一次出现/平移短过渡——仅限离散跳年
     （键盘步进/人物定位）；播放与滑杆拖动保持硬切（性能红线）。 */
  let lastAnimT = 0;
  function setYear(y, force, animate) {
    year = Math.max(YMIN, Math.min(YMAX, y));
    const list = locsAt(year);
    const key = visibleKey(list);
    // 年份标签与滑杆：DOM 级更新，每帧都做也便宜
    document.querySelector('#map-year-display .yr').textContent = Math.floor(year);
    if (Math.abs(+slider.value - year) > 0.02) slider.value = year;
    if (!force && key === lastKey) return;      // 可见集合未变 → 跳过 setOption
    lastKey = key;
    let doAnim = !!animate && !(window.prefersReducedMotion && window.prefersReducedMotion());
    const now = performance.now();
    if (doAnim && now - lastAnimT < 140) doAnim = false;   // 连发跳年退化为硬切
    if (doAnim) lastAnimT = now;
    const data = seriesData(list);
    chart.setOption({
      animation: doAnim,
      animationDurationUpdate: 240,
      animationEasingUpdate: 'cubicOut',
      series: [
        { id: 'group', data: data.group },
        { id: 'work', data: data.work },
        { id: 'person', data: data.person },
      ],
    });
  }

  /* ---------- 播放（连续推进） ---------- */
  function startPlay() {
    if (playRaf) return;
    if (year >= YMAX) { setYear(YMIN, true); }
    playBtn.textContent = '⏸';
    playLastT = performance.now();
    const tick = now => {
      const dt = Math.min(0.1, (now - playLastT) / 1000);
      playLastT = now;
      setYear(year + dt * YPS);
      if (year >= YMAX) { stopPlay(); return; }
      playRaf = requestAnimationFrame(tick);
    };
    playRaf = requestAnimationFrame(tick);
  }
  function stopPlay() {
    if (playRaf) cancelAnimationFrame(playRaf);
    playRaf = null;
    playBtn.textContent = '▶';
  }

  /* ---------- 打开词条 ---------- */
  function openEntry(l) {
    if (entityByName.has(l.n)) window.openDrawerEntity(l.n);
    else window.openWikiPage(l.n);
  }

  /* ---------- 多词条名录浮层 ---------- */
  let pop = null;
  function closePop() {
    if (!pop) return;
    const el = pop;
    pop = null;
    if (window.prefersReducedMotion && window.prefersReducedMotion() || !el.animate) { el.remove(); return; }
    el.classList.add('closing');               // .map-pop.closing → 140ms 淡出
    setTimeout(() => el.remove(), 150);
  }
  function showPinPop(clientX, clientY, city, items) {
    closePop();
    pop = document.createElement('div');
    pop.className = 'map-pop';
    pop.innerHTML = `
      <div class="mp-head">📍 ${city} <span class="mp-count">${items.length} 条</span></div>
      ${items.map((l, i) => `
        <button class="mp-item" data-i="${i}">
          <span class="mp-dot" style="background:${typeColor(l.t)}"></span>
          <span class="mp-name">${l.n}</span>
          <span class="mp-years">${l.from ?? ''}${l.to ? '–' + l.to : ''}</span>
        </button>`).join('')}`;
    document.getElementById('view-map').appendChild(pop);
    pop.addEventListener('click', e => {
      e.stopPropagation();
      const btn = e.target.closest('.mp-item');
      if (btn) { openEntry(items[+btn.dataset.i]); closePop(); }
    });
    // 定位（钉附近，防溢出）——clientX/Y 是视口坐标，
    // 浮层是 #view-map 内 absolute 定位，须换算成容器相对坐标
    const rect = chartDom.getBoundingClientRect();
    const lx = clientX - rect.left, ly = clientY - rect.top;
    pop.style.left = Math.max(8, Math.min(lx + 14, rect.width - 250)) + 'px';
    pop.style.top = Math.max(8, Math.min(ly - 10, rect.height - items.length * 34 - 70)) + 'px';
    setTimeout(() => document.addEventListener('click', closePopOnce, { once: true }));
  }
  function closePopOnce() { closePop(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePop(); });

  function typeColor(t) {
    return (CFG.types[t === 'group' ? 'movement' : t] || CFG.types.other).color;
  }

  /* ---------- 初始化 ---------- */
  function baseOption() {
    return {
      renderer: 'canvas',             // GPU 合成路径
      animation: false,               // 拖动/播放期间不做过渡动画（流畅的关键）
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(247,241,227,.97)',
        borderColor: '#d8c9a8',
        textStyle: { color: '#33302a', fontFamily: '"LXGW WenKai","KaiTi",serif', fontSize: 13 },
        formatter: params => {
          const d = params.data;
          if (!d || !d.items) return params.name;
          return `<div style="font-weight:700;font-size:14px;margin-bottom:6px">📍 ${d.name}${d.count > 1 ? `（${d.count} 条，单击查看）` : '（单击查看详情）'}</div>` +
            d.items.slice(0, 8).map(l =>
              `<div style="margin:3px 0;line-height:1.5">
                <span style="color:#b3342e;font-weight:600">${l.n}</span>
                <span style="color:#8a8272;font-size:11px"> ${l.from ?? ''}${l.to ? '–' + l.to : ''}</span>
              </div>`).join('') +
            (d.items.length > 8 ? `<div style="color:#8a8272;font-size:11px">…共 ${d.items.length} 条</div>` : '');
        },
      },
      geo: {
        map: 'china',
        roam: true,
        center: CFG.map.center,
        zoom: CFG.map.zoom,
        scaleLimit: { min: 0.7, max: 12 },
        itemStyle: {
          areaColor: '#ece2cb',
          borderColor: '#a89a78',
          borderWidth: .7,
          shadowColor: 'rgba(88,62,34,.18)',
          shadowOffsetY: 6,
          shadowBlur: 14,
        },
        emphasis: {
          itemStyle: { areaColor: '#e2d4b2', borderColor: '#8a8272' },
          label: { show: false },
        },
        select: { itemStyle: { areaColor: '#ece2cb' }, label: { show: false } },
      },
      series: [
        {
          id: 'group', name: '群体', type: 'scatter', coordinateSystem: 'geo',
          symbol: 'circle', symbolSize: v => 11 + (v ? v[2] : 1) * 3,
          itemStyle: { color: cssVar('--type-movement') || '#37638a', borderColor: '#f7f1e3', borderWidth: 1.2 },
          z: 20, data: [],
        },
        {
          id: 'work', name: '刊物', type: 'scatter', coordinateSystem: 'geo',
          symbol: 'diamond', symbolSize: v => 11 + (v ? v[2] : 1) * 2,
          itemStyle: { color: cssVar('--type-work') || '#a06a2a', borderColor: '#f7f1e3', borderWidth: 1.2 },
          z: 22, data: [],
        },
        {
          id: 'person', name: '人物', type: 'scatter', coordinateSystem: 'geo',
          symbol: 'pin', symbolSize: v => 17 + (v ? v[2] : 1) * 3,
          itemStyle: { color: cssVar('--type-person') || '#8f3b2c', borderColor: '#f7f1e3', borderWidth: 1.2 },
          z: 30, data: [],
        },
      ],
    };
  }

  /* ---------- 键盘 API ---------- */
  window.MAP = {
    nudge(d) {
      stopPlay();
      setYear(Math.floor(year) + (d > 0 ? Math.ceil(d) : Math.floor(d)), false, true);
    },
    togglePlay() { playRaf ? stopPlay() : startPlay(); },
    playing: () => !!playRaf,
  };
  window.closeMapPop = closePop;

  /* ---------- 定位飞行（非播放路径：仅人物跳转；用户漫游即打断） ---------- */
  let flyRaf = null;
  function stopFly() { if (flyRaf) { cancelAnimationFrame(flyRaf); flyRaf = null; } }
  function flyGeo(center, zoom, ms = 700) {
    stopFly();
    if (window.prefersReducedMotion && window.prefersReducedMotion()) {
      chart.setOption({ geo: { center, zoom } });
      return;
    }
    const g = chart.getOption().geo[0];
    const c0 = g.center || CFG.map.center;
    const z0 = g.zoom || CFG.map.zoom;
    const t0 = performance.now();
    const easeOut = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      const t = Math.min(1, (now - t0) / ms);
      const e = easeOut(t);
      chart.setOption({
        geo: {
          center: [c0[0] + (center[0] - c0[0]) * e, c0[1] + (center[1] - c0[1]) * e],
          zoom: Math.exp(Math.log(z0) + (Math.log(zoom) - Math.log(z0)) * e),   // 缩放走对数空间
        },
      });
      if (t < 1) flyRaf = requestAnimationFrame(step); else flyRaf = null;
    };
    flyRaf = requestAnimationFrame(step);
  }

  /* ---------- 模块接口 ---------- */
  let inited = false;
  window.Views.map = {
    init() {
      if (inited) return;
      inited = true;
      if (!window.CHINA_GEOJSON) {
        chartDom.innerHTML = '<div style="padding:60px;text-align:center;color:var(--ink-3)">⚠ 地图数据缺失（lib/china-geojson.js）<br>重新运行 tools/download-libs.sh 下载</div>';
        return;
      }
      slider.step = '0.01';
      echarts.registerMap('china', window.CHINA_GEOJSON);
      chart = echarts.init(chartDom, null, { renderer: 'canvas' });
      chart.setOption(baseOption());
      chart.on('click', params => {
        const d = params.data;
        if (!d || !d.items) return;
        if (d.items.length === 1) openEntry(d.items[0]);
        else {
          const ev = params.event && params.event.event || params.event;
          showPinPop(ev ? ev.clientX : 400, ev ? ev.clientY : 300, d.name, d.items);
        }
      });
      chart.on('georoam', stopFly);              // 用户手动漫游 → 打断飞行
      slider.addEventListener('input', e => {
        stopPlay();
        setYear(+e.target.value);
      });
      playBtn.addEventListener('click', () => playRaf ? stopPlay() : startPlay());
      window.addEventListener('resize', () => chart && chart.resize());
      setYear(YMIN, true);
    },
    onShow(params) {
      if (!chart) return;
      chart.resize();
      if (params && params.person) {
        const loc = locs.find(l => l.n === params.person);
        if (loc) {
          closePop();
          setYear(Math.max(YMIN, Math.min(YMAX, loc.from ?? YMIN)), true, true);
          flyGeo([loc.x, loc.y + 3], 6);       // 飞向人物活动地（非播放路径）
        }
      } else {
        setYear(year, true);      // 视图切回时强制同步一次
      }
    },
  };
})();
