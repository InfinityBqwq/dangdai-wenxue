/**
 * keyboard.ts — 全站快捷键（js/keyboard.js 原样移植，集中分发）
 * ------------------------------------------------------------
 * 全局   1-5 切换视图 · Ctrl+K 或 / 搜索(命令面板) · ? 帮助 · Esc 逐层关闭
 * 时间轴 ←/→ 平移(Shift×4) · ↑/↓ 或 +/- 缩放 · Home/End 首末年
 *        PgUp/PgDn 时期跳转 · [ / ] 上/下一里程碑(自动聚焦) · O 全览
 * 地图   ←/→ 年份±1(Shift×5) · Space 播放/暂停 · Home/End 首末年
 * 图谱   方向键平移 · +/- 缩放 · 0 复位 · R 重新布局
 * 拼图   方向键平移(Shift×4) · +/- 缩放 · 0/F 适应 · Del 删选中
 *        N 便签 · G 分组框
 * 引擎的 window.TL / MAP / GRAPH / PUZZLE API 照旧调用。
 */
import { VIEW_IDS } from './state'
import { cycleSource } from './state'
import { getView, switchView } from './router'
import {
  isHelpOpen,
  toggleHelp,
  isPaletteOpen,
  openPalette,
  closePalette,
  focusPaletteInput,
  isDrawerOpen,
  closeDrawer,
} from './api'

const isTyping = (e: KeyboardEvent): boolean => {
  const t = e.target
  if (!t || !(t instanceof Element)) return false
  return t.matches('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
}

/* ---------------- Esc 逐层关闭：帮助 → 地图浮层 → 命令面板 → 抽屉 → 拼图 → 输入框 ---------------- */
function handleEsc(): boolean {
  if (isHelpOpen()) {
    toggleHelp(false)
    return true
  }
  if ((window as any).closeMapPop) {
    /* 地图名录浮层 */
    const p = document.querySelector('.map-pop')
    if (p) {
      ;(window as any).closeMapPop()
      return true
    }
  }
  if (isPaletteOpen()) {
    closePalette()
    return true
  }
  if (isDrawerOpen()) {
    closeDrawer()
    return true
  }
  // 拼图白板：取消连线拖拽 / 取消选中
  const w = window as any
  if (getView() === 'puzzle' && w.PUZZLE && w.PUZZLE.esc()) return true
  const ae = document.activeElement
  if (ae && ae.tagName === 'INPUT') (ae as HTMLElement).blur()
  return false
}

/* ---------------- 各视图路由（引擎全局 API 照旧） ---------------- */
function routeTimeline(e: KeyboardEvent): boolean {
  const TL = (window as any).TL
  if (!TL) return false
  const step = (window.innerWidth / TL.zoom()) * 0.4
  switch (e.key) {
    case 'ArrowLeft': TL.panBy(-(e.shiftKey ? step * 4 : step)); return true
    case 'ArrowRight': TL.panBy(e.shiftKey ? step * 4 : step); return true
    case 'ArrowUp': case '+': case '=': TL.setZoom(TL.zoom() * 1.3); return true
    case 'ArrowDown': case '-': case '_': TL.setZoom(TL.zoom() / 1.3); return true
    case 'Home': TL.goYear(1949); return true
    case 'End': TL.goYear(2018); return true
    case 'PageDown': TL.periodJump(1); return true
    case 'PageUp': TL.periodJump(-1); return true
    case ']': TL.nextEvent(1); return true
    case '[': TL.nextEvent(-1); return true
    case 'o': case 'O': TL.overview(); return true
  }
  return false
}

function routeMap(e: KeyboardEvent): boolean {
  const M = (window as any).MAP
  if (!M) return false
  switch (e.key) {
    case 'ArrowLeft': M.nudge(e.shiftKey ? -5 : -1); return true
    case 'ArrowRight': M.nudge(e.shiftKey ? 5 : 1); return true
    case ' ': M.togglePlay(); return true
    case 'Home': M.nudge(-999); return true
    case 'End': M.nudge(999); return true
  }
  return false
}

function routeGraph(e: KeyboardEvent): boolean {
  const G = (window as any).GRAPH
  if (!G) return false
  switch (e.key) {
    case 'ArrowLeft': G.panBy(60, 0); return true
    case 'ArrowRight': G.panBy(-60, 0); return true
    case 'ArrowUp': G.panBy(0, 60); return true
    case 'ArrowDown': G.panBy(0, -60); return true
    case '+': case '=': G.zoomBy(1.25); return true
    case '-': case '_': G.zoomBy(0.8); return true
    case '0': case 'Home': G.reset(); return true
    case 'r': case 'R': G.relayout(); return true
  }
  return false
}

function routePuzzle(e: KeyboardEvent): boolean {
  const P = (window as any).PUZZLE
  if (!P) return false
  switch (e.key) {
    case 'ArrowLeft': P.panBy(e.shiftKey ? 320 : 80, 0); return true
    case 'ArrowRight': P.panBy(e.shiftKey ? -320 : -80, 0); return true
    case 'ArrowUp': P.panBy(0, e.shiftKey ? 320 : 80); return true
    case 'ArrowDown': P.panBy(0, e.shiftKey ? -320 : -80); return true
    case '+': case '=': P.zoomBy(1.25); return true
    case '-': case '_': P.zoomBy(0.8); return true
    case '0': case 'f': case 'F': case 'Home': P.fit(); return true
    case 'Delete': case 'Backspace': return P.del()
    case 'n': case 'N': P.addNote(); return true
    case 'g': case 'G': P.addGroup(); return true
  }
  return false
}

/* ---------------- 总入口 ---------------- */
export function initKeyboard(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (handleEsc()) e.preventDefault()
      return
    }
    if (isTyping(e)) return
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      if (isPaletteOpen()) focusPaletteInput()
      else openPalette('')
      return
    }
    if (e.altKey) return

    // 帮助
    if (e.key === '?') {
      toggleHelp()
      e.preventDefault()
      return
    }
    // 搜索（命令面板）
    if (e.key === '/') {
      openPalette('')
      e.preventDefault()
      return
    }
    // 视图切换
    if (['1', '2', '3', '4', '5'].includes(e.key)) {
      const v = VIEW_IDS[+e.key - 1]
      switchView(v)
      e.preventDefault()
      return
    }
    // 来源切换(S)
    if (e.key === 's' || e.key === 'S') {
      cycleSource()
      e.preventDefault()
      return
    }

    const view = getView()
    const handled =
      view === 'timeline' ? routeTimeline(e) :
      view === 'map' ? routeMap(e) :
      view === 'graph' ? routeGraph(e) :
      view === 'puzzle' ? routePuzzle(e) : false
    if (handled) e.preventDefault()
  }
  document.addEventListener('keydown', onKey)
  return () => document.removeEventListener('keydown', onKey)
}
