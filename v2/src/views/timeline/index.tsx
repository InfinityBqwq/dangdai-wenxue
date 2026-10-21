/**
 * index.tsx — 时间轴岛（React 包装层）
 * ------------------------------------------------------------
 * 静态骨架自旧版 index.html「view-timeline」节抄入（保留原 id：
 * #tl-filters 图例面板容器 + #tl-svg 长卷画布；section 外壳由 ViewHost 渲染）。
 * 引擎（engine.ts，js/timeline.js 逐字移植）在 useEffect 挂载一次：
 * 外壳 keep-alive，本岛常驻不随切视图卸载，引擎状态（pan/zoom/拖拽）不丢。
 *
 * 订阅接线（Island 契约）：
 * · useViewParams() → 路由参数变化 → 引擎 onShow(params)（深链 ?focus= 对位）；
 * · useAppContext() → 编年口径变化 → 引擎 onSourceChange()（重排+重建长卷）。
 * 引擎不自注册 window.Views（避免 setSource 的 Views 循环与本订阅双触发）；
 * window.TL 由引擎挂在 window 上，键盘层（shell/keyboard.ts）照旧调用。
 *
 * 动效（React 层）：图例浮层内容 stagger 显影——init() 同步 buildFilters()
 * 后，用 motion 对 .fl-body 直接子行做 18ms/条 错峰显影（≤24 条红线内）；
 * 减动效偏好下跳过直跳终态。面板容器入场由 shell 的 data-vpanel 编排承担。
 */
import { useEffect, useRef } from 'react'
import { animate, stagger } from 'motion'
import { useViewParams, useAppContext, prefersReducedMotion } from '@/shell/api'
import { init as engineInit, onShow as engineOnShow, onSourceChange as engineOnSourceChange } from './engine'
import { EASE_APPEAR } from '@/styles/motionTokens'
import './timeline.css'

export default function TimelineView() {
  const params = useViewParams()
  const { source } = useAppContext()
  const booted = useRef(false)
  const paramsRef = useRef(params)
  paramsRef.current = params

  /* 挂载引擎：一次性（keep-alive 下本效应只跑一轮；booted 双保险） */
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    engineInit()
    // 首挂即按当前路由参数对位（深链 #/timeline?focus=… 与冷启动路由一致）
    engineOnShow(paramsRef.current)
    staggerLegend()
  }, [])

  /* 路由参数变化 → 引擎 onShow（focusDone 幂等，同参不重复飞行） */
  useEffect(() => {
    engineOnShow(params)
  }, [params])

  /* 编年口径变化 → 引擎 onSourceChange（重排数据 + 重建长卷） */
  useEffect(() => {
    engineOnSourceChange()
  }, [source])

  /* 静态骨架（旧 index.html #view-timeline 节原样；data-vpanel 交壳层错峰显影） */
  return (
    <>
      <div
        id="tl-filters"
        data-vpanel=""
        style={{ '--vpanel-i': 0 } as React.CSSProperties}
      />
      <svg id="tl-svg" role="img" aria-label="中国当代文学史 1949—2018 数字长卷（左右拖动浏览，滚轮缩放）" />
    </>
  )
}

/** 图例浮层内容 stagger 显影（motion，18ms/条；reduced-motion 直跳终态） */
function staggerLegend() {
  if (prefersReducedMotion()) return
  const rows = document.querySelectorAll('#tl-filters .fl-body > *')
  if (!rows.length) return
  animate(rows, { opacity: [0, 1], y: [7, 0] }, {
    duration: 0.28,
    delay: stagger(0.018),
    ease: EASE_APPEAR,
  })
}
