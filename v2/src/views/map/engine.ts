/**
 * engine.ts — 地图视图引擎：ECharts 中国地图 + 地图钉（性能重构版）
 * ------------------------------------------------------------
 * 由旧版 js/map.js 逐字移植为 ESM（v2 岛架构）。移植适配仅四处，其余一字未动：
 *  ① 加载器：IIFE → 模块作用域；echarts 改 `await import('echarts')`（npm 包按需分块，
 *     替代旧 injectScript 注入 lib/echarts.min.js）；中国 GeoJSON 改
 *     `await import('./china-geojson.js')`（副本副作用写 window.CHINA_GEOJSON，接原全局名，
 *     旧 injectScript 注入器随之移除；懒加载占位 / 失败允许重进重试的语义原样保留）。
 *  ② chartDom/slider/playBtn 的 getElementById 从模块求值期挪进导出入口 initMap()
 *     （旧版 <script> 在 DOM 就绪后求值；v2 引擎模块先于 React 骨架渲染求值；
 *     ensureLibs 的加载占位与 setupChart 均在 initMap 之后执行，赋值时序安全）。
 *  ③ 动效新增（docs/动效升级计划书·地图）：setYear 钉入场 animationEasing
 *     cubicOut → elasticOut 回弹（enter 时长保持 340ms；echarts enter/leave 共用此项）。
 *  ④ 对外 API 原样挂 window.MAP / window.closeMapPop / window.Views.map，供键盘层
 *     （js/keyboard.js → v2 keyboard.ts routeMap）照旧调用。
 * 保留的核心性能/正确性设计（勿动）：
 *  · 可见钉集合签名 diff：集合未变零 setOption，滑杆/播放期间其余帧零 ECharts 开销；
 *  · 数据项稳定 id（type:lng,lat）：enter/leave 按身份 diff，退场淡出的是"这颗"钉；
 *  · flyGeo 逐帧 setOption 显式 animation:false（防继承合并态动画），缩放走对数空间；
 *  · 播放 rAF 连续推进浮点年（每秒 2 年）；reduced-motion 时动画/浮层硬切。
 */
const CFG = (window as any).APP_CONFIG
const D = (window as any).DATA

let chartDom!: HTMLElement
let slider!: HTMLInputElement
let playBtn!: HTMLButtonElement
let chart: any = null
let year = 1949
let playRaf: number | null = null
let playLastT = 0
let lastKey = ''
const YPS = 2 // 播放速度：年/秒

const entityByName = new Map(D.entities.map((e: any) => [e.name, e]))
const YMIN = CFG.YEAR_MIN
const YMAX = CFG.YEAR_MAX

/* ---------- 地点数据(恒全量;编年口径不拆地图钉) ---------- */
const locs = (D.locations || []).filter((l: any) => l.x && l.y)
const locsAt = (y: number) => locs.filter((l: any) => (l.from ?? YMIN) <= y && y <= (l.to ?? YMAX))
const visibleKey = (list: any[]) => list.map((l) => l.n).join('¦')

function seriesData(list: any[]) {
  const byPos = new Map()
  for (const l of list) {
    const k = l.x.toFixed(2) + ',' + l.y.toFixed(2)
    if (!byPos.has(k)) byPos.set(k, { x: l.x, y: l.y, items: [] })
    byPos.get(k).items.push(l)
  }
  const out: Record<string, any[]> = { person: [], group: [], work: [] }
  for (const [k, g] of byPos as Map<string, any>) {
    const byType: Record<string, any[]> = { person: [], group: [], work: [] }
    g.items.forEach((l: any) => (byType[l.t] || byType.group).push(l))
    for (const [t, arr] of Object.entries(byType)) {
      if (!arr.length) continue
      out[t].push({
        id: t + ':' + k, // 稳定 id：diff 按身份匹配 → 退场淡出的是"这颗"钉
        name: arr[0].city,
        value: [g.x, g.y, arr.length],
        items: arr,
        count: arr.length,
      })
    }
  }
  return out
}

/* ---------- 样式 ---------- */
const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

/* ---------- 年份推进（核心：只在集合变化时才动 ECharts） ----------
   集合变化时开启短过渡：新钉 enter（放大淡入）、离场钉 leave
   （收缩淡出）、已有钉 update（尺寸/位置微调）。播放与滑杆与
   键盘步进共用同一套过渡；reduced-motion 时硬切。 */
function setYear(y: number, force?: boolean) {
  if (!chart) return // 库未就绪(懒加载中)
  year = Math.max(YMIN, Math.min(YMAX, y))
  const list = locsAt(year)
  const key = visibleKey(list)
  // 年份标签与滑杆：DOM 级更新，每帧都做也便宜
  ;(document.querySelector('#map-year-display .yr') as HTMLElement).textContent = String(Math.floor(year))
  if (Math.abs(+slider.value - year) > 0.02) slider.value = String(year)
  if (!force && key === lastKey) return // 可见集合未变 → 跳过 setOption
  lastKey = key
  const anim = !((window as any).prefersReducedMotion && (window as any).prefersReducedMotion())
  const data = seriesData(list)
  chart.setOption({
    animation: anim,
    animationDuration: 340, // enter/leave 共用（echarts 两态同读此项）
    animationEasing: 'elasticOut', // v2 动效新增：钉入场 elasticOut 回弹（时长仍 340ms）
    animationDurationUpdate: 240, // 已有钉的 count→尺寸变化等微调
    animationEasingUpdate: 'cubicOut',
    series: [
      { id: 'group', data: data.group },
      { id: 'work', data: data.work },
      { id: 'person', data: data.person },
    ],
  })
}

/* ---------- 播放（连续推进） ---------- */
function startPlay() {
  if (playRaf) return
  if (year >= YMAX) {
    setYear(YMIN, true)
  }
  playBtn.textContent = '⏸'
  playLastT = performance.now()
  const tick = (now: number) => {
    const dt = Math.min(0.1, (now - playLastT) / 1000)
    playLastT = now
    setYear(year + dt * YPS)
    if (year >= YMAX) {
      stopPlay()
      return
    }
    playRaf = requestAnimationFrame(tick)
  }
  playRaf = requestAnimationFrame(tick)
}
function stopPlay() {
  if (playRaf) cancelAnimationFrame(playRaf)
  playRaf = null
  playBtn.textContent = '▶'
}

/* ---------- 打开词条 ---------- */
function openEntry(l: any) {
  if (entityByName.has(l.n)) (window as any).openDrawerEntity(l.n)
  else (window as any).openWikiPage(l.n)
}

/* ---------- 多词条名录浮层 ---------- */
let pop: HTMLElement | null = null
function closePop() {
  if (!pop) return
  const el = pop
  pop = null
  if (((window as any).prefersReducedMotion && (window as any).prefersReducedMotion()) || !el.animate) {
    el.remove()
    return
  }
  el.classList.add('closing') // .map-pop.closing → 140ms 淡出
  setTimeout(() => el.remove(), 150)
}
function showPinPop(clientX: number, clientY: number, city: string, items: any[]) {
  closePop()
  pop = document.createElement('div')
  pop.className = 'map-pop'
  pop.innerHTML = `
      <div class="mp-head">📍 ${city} <span class="mp-count">${items.length} 条</span></div>
      ${items
        .map(
          (l, i) => `
        <button class="mp-item" data-i="${i}">
          <span class="mp-dot" style="background:${typeColor(l.t)}"></span>
          <span class="mp-name">${l.n}</span>
          <span class="mp-years">${l.from ?? ''}${l.to ? '–' + l.to : ''}</span>
        </button>`,
        )
        .join('')}`
  document.getElementById('view-map')!.appendChild(pop)
  pop.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation()
    const btn = (e.target as Element).closest('.mp-item')
    if (btn) {
      openEntry(items[+(btn as HTMLElement).dataset.i!])
      closePop()
    }
  })
  // 定位（钉附近，防溢出）——clientX/Y 是视口坐标，
  // 浮层是 #view-map 内 absolute 定位，须换算成容器相对坐标
  const rect = chartDom.getBoundingClientRect()
  const lx = clientX - rect.left
  const ly = clientY - rect.top
  pop.style.left = Math.max(8, Math.min(lx + 14, rect.width - 250)) + 'px'
  pop.style.top = Math.max(8, Math.min(ly - 10, rect.height - items.length * 34 - 70)) + 'px'
  setTimeout(() => document.addEventListener('click', closePopOnce, { once: true }))
}
function closePopOnce() {
  closePop()
}
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') closePop()
})

function typeColor(t: string) {
  return (CFG.types[t === 'group' ? 'movement' : t] || CFG.types.other).color
}

/* ---------- 初始化 ---------- */
function baseOption() {
  return {
    renderer: 'canvas', // GPU 合成路径
    animation: false, // 拖动/播放期间不做过渡动画（流畅的关键）
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(247,241,227,.97)',
      borderColor: '#d8c9a8',
      textStyle: { color: '#33302a', fontFamily: '"LXGW WenKai","KaiTi",serif', fontSize: 13 },
      formatter: (params: any) => {
        const d = params.data
        if (!d || !d.items) return params.name
        return (
          `<div style="font-weight:700;font-size:14px;margin-bottom:6px">📍 ${d.name}${d.count > 1 ? `（${d.count} 条，单击查看）` : '（单击查看详情）'}</div>` +
          d.items
            .slice(0, 8)
            .map(
              (l: any) =>
                `<div style="margin:3px 0;line-height:1.5">
                <span style="color:#b3342e;font-weight:600">${l.n}</span>
                <span style="color:#8a8272;font-size:11px"> ${l.from ?? ''}${l.to ? '–' + l.to : ''}</span>
              </div>`,
            )
            .join('') +
          (d.items.length > 8 ? `<div style="color:#8a8272;font-size:11px">…共 ${d.items.length} 条</div>` : '')
        )
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
        borderWidth: 0.7,
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
        id: 'group',
        name: '群体',
        type: 'scatter',
        coordinateSystem: 'geo',
        symbol: 'circle',
        symbolSize: (v: any) => 11 + (v ? v[2] : 1) * 3,
        itemStyle: { color: cssVar('--type-movement') || '#37638a', borderColor: '#f7f1e3', borderWidth: 1.2 },
        z: 20,
        data: [],
      },
      {
        id: 'work',
        name: '刊物',
        type: 'scatter',
        coordinateSystem: 'geo',
        symbol: 'diamond',
        symbolSize: (v: any) => 11 + (v ? v[2] : 1) * 2,
        itemStyle: { color: cssVar('--type-work') || '#a06a2a', borderColor: '#f7f1e3', borderWidth: 1.2 },
        z: 22,
        data: [],
      },
      {
        id: 'person',
        name: '人物',
        type: 'scatter',
        coordinateSystem: 'geo',
        symbol: 'pin',
        symbolSize: (v: any) => 17 + (v ? v[2] : 1) * 3,
        itemStyle: { color: cssVar('--type-person') || '#8f3b2c', borderColor: '#f7f1e3', borderWidth: 1.2 },
        z: 30,
        data: [],
      },
    ],
  }
}

/* ---------- 库与地图数据按需加载(echarts + GeoJSON 分块,首屏不加载) ---------- */
let echartsMod: any = null
let libsPromise: Promise<void> | null = null
function ensureLibs(): Promise<void> {
  if (echartsMod && (window as any).CHINA_GEOJSON) return Promise.resolve()
  if (libsPromise) return libsPromise
  chartDom.innerHTML = '<div class="map-loading">🗺 地图资源加载中…</div>'
  libsPromise = (async () => {
    try {
      if (!echartsMod) echartsMod = await import('echarts')
      // @ts-ignore 旧版零构建脚本无类型声明；动态 import 为副作用加载（写 window.CHINA_GEOJSON）
      if (!(window as any).CHINA_GEOJSON) await import('./china-geojson.js')
    } catch (err) {
      libsPromise = null // 允许下次进入重试
      chartDom.innerHTML = '<div class="map-loading">⚠ 地图资源加载失败,请检查 lib/ 目录后重进视图</div>'
      throw err
    }
  })()
  return libsPromise
}

/* ---------- 键盘 API ---------- */
;(window as any).MAP = {
  nudge(d: number) {
    if (!chart) return // 库未就绪(懒加载中)
    stopPlay()
    setYear(Math.floor(year) + (d > 0 ? Math.ceil(d) : Math.floor(d)), false)
  },
  togglePlay() {
    if (chart) (playRaf ? stopPlay() : startPlay())
  },
  playing: () => !!playRaf,
}
;(window as any).closeMapPop = closePop

/* ---------- 定位飞行（非播放路径：仅人物跳转；用户漫游即打断） ---------- */
let flyRaf: number | null = null
function stopFly() {
  if (flyRaf) {
    cancelAnimationFrame(flyRaf)
    flyRaf = null
  }
}
function flyGeo(center: number[], zoom: number, ms = 700) {
  stopFly()
  if ((window as any).prefersReducedMotion && (window as any).prefersReducedMotion()) {
    chart.setOption({ animation: false, geo: { center, zoom } })
    return
  }
  const g = chart.getOption().geo[0]
  const c0 = g.center || CFG.map.center
  const z0 = g.zoom || CFG.map.zoom
  const t0 = performance.now()
  const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms)
    const e = easeOut(t)
    chart.setOption({
      animation: false, // 飞行自行逐帧插值，勿再叠加 ECharts 过渡
      geo: {
        center: [c0[0] + (center[0] - c0[0]) * e, c0[1] + (center[1] - c0[1]) * e],
        zoom: Math.exp(Math.log(z0) + (Math.log(zoom) - Math.log(z0)) * e), // 缩放走对数空间
      },
    })
    if (t < 1) flyRaf = requestAnimationFrame(step)
    else flyRaf = null
  }
  flyRaf = requestAnimationFrame(step)
}

/* ---------- 模块接口 ---------- */
let inited = false
let pendingShow: any = null // 库就绪前收到的 onShow 参数
;(window as any).Views = (window as any).Views || {} // 外壳 globals.ts 已建，兜底同旧版语义
;(window as any).Views.map = {
  init() {
    if (inited) return
    inited = true
    ensureLibs()
      .then(() => {
        setupChart()
        if (pendingShow) {
          const p = pendingShow
          pendingShow = null
          this.onShow(p)
        }
      })
      .catch(() => {
        /* 占位错误已显示 */
      })
  },
  onShow(params: any) {
    if (!chart) {
      pendingShow = params || {}
      return
    }
    chart.resize()
    if (params && params.person) {
      const loc = locs.find((l: any) => l.n === params.person)
      if (loc) {
        closePop()
        setYear(Math.max(YMIN, Math.min(YMAX, loc.from ?? YMIN)), true)
        flyGeo([loc.x, loc.y + 3], 6) // 飞向人物活动地（非播放路径）
      }
    } else {
      setYear(year, true) // 视图切回时强制同步一次
    }
  },
}

/* 图表实际搭建(库就绪后执行;原 init 主体) */
function setupChart() {
  slider.step = '0.01'
  echartsMod.registerMap('china', (window as any).CHINA_GEOJSON)
  chart = echartsMod.init(chartDom, null, { renderer: 'canvas' })
  chart.setOption(baseOption())
  chart.on('click', (params: any) => {
    const d = params.data
    if (!d || !d.items) return
    if (d.items.length === 1) openEntry(d.items[0])
    else {
      const ev = (params.event && params.event.event) || params.event
      showPinPop(ev ? ev.clientX : 400, ev ? ev.clientY : 300, d.name, d.items)
    }
  })
  chart.on('georoam', stopFly) // 用户手动漫游 → 打断飞行
  slider.addEventListener('input', (e: Event) => {
    stopPlay()
    setYear(+(e.target as HTMLInputElement).value)
  })
  playBtn.addEventListener('click', () => (playRaf ? stopPlay() : startPlay()))
  window.addEventListener('resize', () => chart && chart.resize())
  setYear(YMIN, true)
}

/* ---------- 岛包装层调用入口（等价旧版 window.Views.map.init / onShow） ---------- */
export function initMap(): void {
  // 移植适配②：DOM 查找在挂载入口做（此时 React 骨架已渲染，等价旧版脚本求值时机）
  chartDom = document.getElementById('map-chart') as HTMLElement
  slider = document.getElementById('map-slider') as HTMLInputElement
  playBtn = document.getElementById('map-play') as HTMLButtonElement
  ;(window as any).Views.map.init()
}
export function onShow(params?: Record<string, string | number>): void {
  ;(window as any).Views.map.onShow(params)
}
