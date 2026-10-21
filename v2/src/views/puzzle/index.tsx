/**
 * index.tsx — 拼图白板岛（React 包装层）
 * ------------------------------------------------------------
 * 静态骨架自旧版 index.html「view-puzzle」节抄入（保留原 id/class：
 * #pz-lib-btn 库开合钮 + #pz-library 卡片库容器 + #pz-viewport 画布
 * （内含空态 / 工具栏 / 样式条 / 撤销条 / 提示条的空壳，内容由引擎
 * buildDOM/buildToolbar/buildStylebar 填充）；section 外壳由 ViewHost 渲染）。
 * 引擎（engine.ts，js/puzzle.js 逐字移植）在 useEffect 挂载一次：
 * 外壳 keep-alive，本岛常驻不随切视图卸载，白板内容与视图变换状态不丢。
 *
 * 订阅接线（Island 契约）：
 * · useViewParams() → 路由参数变化 → 引擎 onShow(params)
 *   （深链 ?add=词条 / ?addev=事件：已有则聚焦、没有则上板，引擎幂等）；
 * · 来源变化：旧版协议 puzzle 模块无 onSourceChange（卡片库不随编年口径
 *   重建，白板内容与口径无关），故不新增订阅、不虚构回调——与旧版行为一致。
 * 引擎自注册 window.Views.puzzle 与 window.PUZZLE（逐字保留；键盘层
 * shell/keyboard.ts routePuzzle 照旧调 window.PUZZLE）。
 *
 * 动效分工：卡片上板落地弹簧 / 连线描线生长 / 库分组展开 stagger 全在
 * 引擎与 puzzle.css（CSS class + WAAPI，不把 React 状态引进帧循环）；
 * React 层只负责面板错峰显影标注（data-vpanel：库面板 0 → 工具栏 1 →
 * 提示条 2，shell.css 编排；#pz-empty/#pz-stylebar/#pz-undo 不参与——
 * 空态由引擎按内容显隐，样式条/撤销条带定位 transform，避免编排动画
 * fill 与其定位 transform 抢写）。
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { useViewParams, useAppContext } from '@/shell/api'
import { mountPuzzleEngine } from './engine'
import './puzzle.css'

export default function PuzzleView() {
  const params = useViewParams()
  const { view } = useAppContext()
  const booted = useRef(false)
  const engine = useRef<ReturnType<typeof mountPuzzleEngine> | null>(null)

  /* 挂载引擎：一次性（keep-alive 下本效应只跑一轮；booted 双保险）。
     init 内含首次居中与 localStorage 存档恢复；容器尚在切场节拍内不可见时，
     引擎把定位动作延迟到 onShow 可见后（engine.ts v2 keep-alive 适配） */
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const eng = mountPuzzleEngine()
    eng.init()
    engine.current = eng
  }, [])

  /* 路由参数变化 → 引擎 onShow（旧版协议：仅本视图被路由指向时；含首挂载） */
  useEffect(() => {
    if (view !== 'puzzle') return
    engine.current?.onShow(params)
  }, [view, params])

  /* 静态骨架（旧 index.html #view-puzzle 节原样；data-vpanel 交壳层错峰显影） */
  return (
    <>
      <button id="pz-lib-btn" title="卡片库">☰ 卡片库</button>
      <aside id="pz-library" data-vpanel="" style={{ '--vpanel-i': 0 } as CSSProperties} />
      <div id="pz-viewport">
        <div id="pz-empty">
          <div className="pz-empty-title">拼 图 白 板</div>
          <div className="pz-empty-row">① 从左侧卡片库拖词条 / 编年事件上板</div>
          <div className="pz-empty-row">② 卡片边缘圆点拖出连线（线型 · 箭头 · 颜色 · 标签）</div>
          <div className="pz-empty-row">③ 双击空白加便签 · ▣ 建分组框圈住一组卡片</div>
          <div className="pz-empty-tip">拖动平移 · 滚轮缩放 · 内容自动保存</div>
        </div>
        <div id="pz-toolbar" data-vpanel="" style={{ '--vpanel-i': 1 } as CSSProperties} />
        <div id="pz-stylebar" />
        <div id="pz-undo"><span className="pz-undo-msg"></span><button>撤销</button></div>
        <div id="pz-hint" data-vpanel="" style={{ '--vpanel-i': 2 } as CSSProperties}>
          拖动平移 · 滚轮缩放 · 卡片圆点连线 · 双击空白加便签
        </div>
      </div>
    </>
  )
}
