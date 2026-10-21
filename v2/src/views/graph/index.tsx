/**
 * index.tsx — 图谱岛包装
 * ------------------------------------------------------------
 * 静态骨架照抄旧 index.html #view-graph 分节（canvas / toolbar / hint，
 * id 原样——引擎与 CSS 按 id 取元素），useEffect 挂载引擎一次
 * （外壳 keep-alive：切视图不卸载，只切 active；引擎状态不丢）。
 * 路由参数变化（深链 ?node= 聚焦等）→ 引擎 onShow(params)；
 * 编年口径变化 → 引擎 onSourceChange()（比对外环显隐）。
 * 面板错峰显影走 shell.css 的 data-vpanel 编排（工具栏/提示条在骨架上
 * 标注，力度面板由引擎 buildForcePanel 标注）。
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { useAppContext, useViewParams } from '@/shell/api'
import { mountGraphEngine } from './engine'
import './graph.css'

export default function GraphView() {
  const params = useViewParams()
  const { view, source } = useAppContext()
  const engine = useRef<ReturnType<typeof mountGraphEngine> | null>(null)

  /* 挂载引擎一次（幂等；不随切视图卸载） */
  useEffect(() => {
    const eng = mountGraphEngine()
    eng.init()
    engine.current = eng
  }, [])

  /* 路由参数变化 → onShow（旧版协议：仅本视图被路由指向时；含首挂载）。
     keep-alive 节拍适配：切换进来时 section 可能仍处于旧视图 150ms 淡出期
     （display:none，盒为 0），此时 onShow 里 focusNode 会按 W=0 计算飞行目标
     （聚焦节点落到屏幕左缘）——盒就绪后再调，冷加载（盒已有尺寸）零延迟。 */
  useEffect(() => {
    if (view !== 'graph') return
    const eng = engine.current
    if (!eng) return
    const canvas = document.getElementById('graph-canvas')
    let ro: ResizeObserver | undefined
    let fallback = 0
    const fire = () => {
      window.clearTimeout(fallback)
      ro?.disconnect()
      eng.onShow(params)
    }
    if (canvas && canvas.getBoundingClientRect().width > 1) {
      fire()
      return
    }
    if (!canvas) return
    ro = new ResizeObserver(() => {
      if (canvas.getBoundingClientRect().width > 1) fire()
    })
    ro.observe(canvas)
    fallback = window.setTimeout(fire, 1200) // 兜底：盒迟迟不就绪也照旧调（退化为旧行为）
    return () => {
      window.clearTimeout(fallback)
      ro?.disconnect()
    }
  }, [view, params])

  /* 来源变化 → onSourceChange（旧版对全部视图广播，含隐藏态，开销一次重推导+合帧重绘） */
  useEffect(() => {
    engine.current?.onSourceChange()
  }, [source])

  return (
    <>
      <canvas id="graph-canvas" />
      <div id="graph-toolbar" data-vpanel="" style={{ '--vpanel-i': 0 } as CSSProperties} />
      {/* 提示条自带 translateX(-50%) 居中，避开 panelIn 的 transform 插值，不参加错峰 */}
      <div id="graph-hint">拖拽移动 · 滚轮缩放 · 悬停看邻居 · 点击看详情</div>
    </>
  )
}
