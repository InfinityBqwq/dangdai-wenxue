/**
 * index.tsx — 地图岛包装（MapView）
 * ------------------------------------------------------------
 * 静态骨架照抄旧 index.html #view-map 一节（id/class 原名，引擎依赖）；
 * 引擎（engine.ts，js/map.js 逐字移植）在 useEffect 挂载一次，外壳 keep-alive
 * 不随切视图卸载。动效落点（动效升级计划书·地图，全部 React 层 motion）：
 *  · 图例 / 滑杆条首次入场错峰显影（transform+opacity，--ease-appear 节拍）；
 *  · 年份数字滚轮翻页（YearOdometer：镜像引擎直写的 .yr，数字位竖向滑条弹簧滚动）；
 *  · 播放钮 ▶/⏸ 图标 motion 形变 + 播放中激活脉冲（PlayGlyph：镜像引擎直写的
 *    #map-play 文本；引擎 startPlay/stopPlay 一字未动）。
 * reduced-motion：入场 initial=false 直跳终态、脉冲不渲染、形变零时长；
 * 引擎侧动画与 flyGeo 由 window.prefersReducedMotion 硬切（引擎原逻辑）。
 *
 * 挂载时序：外壳 ViewHost 切换有 ~150ms 淡出节拍（.active 延迟落地），而旧版
 * onShow 的语义是「section 可见时调用」（chart.resize 依赖可见尺寸）——因此
 * init/onShow 以 #view-map.active 落地为触发点（MutationObserver 观测 class），
 * 未激活期间到达的 params 由观察器在激活瞬间补发。数据一律运行时经
 * window.DATA / window.APP_CONFIG 访问（engine.ts），本层不触碰任何数据文件。
 */
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useAppContext, useViewParams } from '@/shell/api'
import { initMap, onShow } from './engine'
import './map.css'

/* --ease-appear（tokens.css 第 9 节）的 motion 侧等价贝塞尔 */
const EASE_APPEAR: [number, number, number, number] = [0.16, 1, 0.3, 1]
const SPRING = { type: 'spring', stiffness: 520, damping: 30 } as const

export default function MapView() {
  const { source } = useAppContext()
  const params = useViewParams()
  const reduce = !!useReducedMotion()

  /* 最新 params 引用：激活观察器触发时取当下值 */
  const latestParams = useRef(params)
  useEffect(() => {
    latestParams.current = params
  }, [params])

  /* 激活门控：.active 落地 → init（幂等，引擎自带 inited 守卫）+ onShow。
     useViewParams() 订阅路由参数；useAppContext() 订阅 view/source。 */
  useEffect(() => {
    const sec = document.getElementById('view-map')
    if (!sec) return
    const fire = () => {
      if (!sec.classList.contains('active')) return
      initMap()
      onShow(latestParams.current || {})
    }
    const mo = new MutationObserver(fire)
    mo.observe(sec, { attributes: true, attributeFilter: ['class'] })
    if (sec.classList.contains('active')) fire() // 挂载即激活（首载深链 / 首视图）
    return () => mo.disconnect()
  }, [])

  /* 已激活状态下 params 变化（同视图深链 person=…）→ 立即 onShow；
     未激活时此处不触发，由上方观察器在激活瞬间补发 latestParams */
  useEffect(() => {
    const sec = document.getElementById('view-map')
    if (sec && sec.classList.contains('active')) onShow(params || {})
  }, [params])

  /* 来源变化：旧版 map.js 没有 onSourceChange——地点钉恒全量、编年口径不拆
     地图钉（js/map.js「地点数据」节注释）。按岛契约守卫式转发，引擎未实现
     时为零操作（行为与旧版一致）。 */
  useEffect(() => {
    const mod = (window as any).Views && (window as any).Views.map
    if (mod && typeof mod.onSourceChange === 'function') mod.onSourceChange()
  }, [source])

  return (
    <>
      {/* ECharts 容器（引擎懒加载占位也写在这里） */}
      <div id="map-chart" />

      {/* 图例：首次入场显影（x 保持 -50% 无关；此面板无居中位移） */}
      <motion.div
        id="map-legend"
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18, ease: EASE_APPEAR }}
      >
        <div className="lg-row">
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--type-person)', display: 'inline-block' }} />
          {' '}人物（朱砂印钉）
        </div>
        <div className="lg-row">
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--type-movement)', display: 'inline-block' }} />
          {' '}群体 / 流派（墨钉）
        </div>
        <div className="lg-row">
          <span style={{ width: 10, height: 10, background: 'var(--type-work)', display: 'inline-block', transform: 'rotate(45deg)' }} />
          {' '}刊物 / 机构
        </div>
      </motion.div>

      {/* 滑杆条：错峰显影。CSS 用 translateX(-50%) 居中，motion 以 x 组合项
          接管同一偏移，避免覆盖居中 transform */}
      <motion.div
        id="map-slider-wrap"
        initial={reduce ? false : { opacity: 0, x: '-50%', y: 16 }}
        animate={{ opacity: 1, x: '-50%', y: 0 }}
        transition={{ duration: 0.5, delay: 0.32, ease: EASE_APPEAR }}
      >
        <div className="ms-years"><span>1949</span><span>2018</span></div>
        <div id="map-year-display">
          {/* .yr 引擎每帧直写（视觉隐藏），滚轮镜像滚动 */}
          <span className="yr">1949</span>
          <YearOdometer />{' '}年
        </div>
        {/* 受控权在引擎（setupChart 置 step=0.01、播放时回写 value），React 用非受控初值 */}
        <input type="range" id="map-slider" min={1949} max={2018} defaultValue={1949} step={1} />
        <span className="map-play-wrap">
          {/* 引擎照旧写 ▶/⏸ 文本（视觉隐藏），点击监听在引擎 */}
          <button id="map-play" title="播放">▶</button>
          <PlayGlyph />
        </span>
      </motion.div>
    </>
  )
}

/* ---------------- 年份数字滚轮（odometer） ----------------
   引擎 setYear 每帧直写 #map-year-display .yr 的 textContent（逐字保留），
   此处 MutationObserver 镜像文本 → 逐位驱动竖向滑条 translateY（只动
   transform）；位变化才写样式，React 不进帧循环。初始 transform 由首帧
   年份直接内联，避免挂载闪动。 */
const YEAR_LEN = 4
const INIT_YEAR = '1949'

function YearOdometer() {
  const strips = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    const yr = document.querySelector('#map-year-display .yr')
    if (!yr) return
    const apply = (text: string) => {
      const s = (text || '').trim()
      for (let i = 0; i < YEAR_LEN; i++) {
        const strip = strips.current[i]
        if (!strip) continue
        const ch = s[i]
        const d = ch && ch >= '0' && ch <= '9' ? +ch : null
        const col = strip.parentElement as HTMLSpanElement
        if (d === null) {
          col.style.opacity = '0'
          continue
        }
        col.style.opacity = '1'
        strip.style.transform = `translateY(${(-d * 10).toString()}%)` // 滑条 10 位 → 每位 10%
      }
    }
    apply(yr.textContent || '')
    const mo = new MutationObserver(() => apply(yr.textContent || ''))
    mo.observe(yr, { childList: true, characterData: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  return (
    <span className="odo" aria-hidden="true">
      {Array.from({ length: YEAR_LEN }, (_, i) => (
        <span className="odo-col" key={i}>
          <span
            className="odo-strip"
            ref={(el) => {
              strips.current[i] = el
            }}
            style={{ transform: `translateY(${-(+INIT_YEAR[i]) * 10}%)` }}
          >
            {Array.from({ length: 10 }, (_, d) => (
              <span className="odo-digit" key={d}>
                {d}
              </span>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}

/* ---------------- 播放钮 ▶/⏸ 形变 + 激活脉冲 ----------------
   引擎 startPlay/stopPlay 直接写 #map-play 的 textContent（逐字保留），
   MutationObserver 镜像 ▶/⏸ 驱动 React 形变图标；真实按钮接收全部点击。 */
function PlayGlyph() {
  const [playing, setPlaying] = useState(false)
  const reduce = !!useReducedMotion()

  useEffect(() => {
    const btn = document.getElementById('map-play')
    if (!btn) return
    const sync = () => setPlaying(btn.textContent === '⏸')
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(btn, { childList: true, characterData: true, subtree: true })
    return () => mo.disconnect()
  }, [])

  return (
    <span className="play-fx" aria-hidden="true">
      {playing && !reduce && (
        <motion.span
          className="play-pulse"
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.6, opacity: 0 }}
          transition={{ duration: 1.2, ease: 'easeOut', repeat: Infinity }}
        />
      )}
      <motion.span className="play-glyph">
        <motion.span
          className="pg-tri"
          animate={playing ? { scale: 0.4, opacity: 0 } : { scale: 1, opacity: 1 }}
          transition={reduce ? { duration: 0 } : SPRING}
        />
        <span className="pg-bars">
          <motion.span
            className="pg-bar"
            animate={playing ? { scaleY: 1, opacity: 1 } : { scaleY: 0.15, opacity: 0 }}
            transition={reduce ? { duration: 0 } : SPRING}
          />
          <motion.span
            className="pg-bar"
            animate={playing ? { scaleY: 1, opacity: 1 } : { scaleY: 0.15, opacity: 0 }}
            transition={reduce ? { duration: 0 } : { ...SPRING, delay: 0.05 }}
          />
        </span>
      </motion.span>
    </span>
  )
}
