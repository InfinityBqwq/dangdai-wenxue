/**
 * App.tsx — 全局外壳
 * ------------------------------------------------------------
 * 装配：Curtain（开幕卷轴）→ TopBar → ViewHost（五岛 keep-alive）→
 * Drawer / CommandPalette / HelpOverlay / Toast 浮层组。
 * 初始化：兼容全局名 + hash 路由（load & hashchange）+ 键盘集中分发 + wikilink 事件委托。
 * 勿用 React.StrictMode：引擎为命令式挂载，避免 dev 下双初始化。
 */
import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { AppContext, useAppState, setSource } from './shell/state'
import { installGlobals } from './shell/globals'
import { initRouter } from './shell/router'
import { initKeyboard } from './shell/keyboard'
import { openDrawerEvent, openWikiPage, resolveName, toast } from './shell/api'
import { eventById } from './shell/indexes'
import Curtain from './shell/Curtain'
import TopBar from './shell/TopBar'
import ViewHost from './shell/views/ViewHost'
import Drawer from './shell/Drawer'
import CommandPalette from './shell/CommandPalette'
import HelpOverlay from './shell/HelpOverlay'
import ToastStack from './shell/Toast'

export default function App() {
  const app = useAppState()
  // Context 值：路由快照 + 来源切换入口
  const ctx = { view: app.view, params: app.params, source: app.source, setSource }

  useEffect(() => {
    installGlobals()
    initRouter()
    const offKeyboard = initKeyboard()

    // 抽屉/正文中 wikilink 点击 + 编年条目交叉引用（app.js 事件委托原样移植）
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t || !(t instanceof Element)) return
      const cx = t.closest('[data-cross]')
      if (cx) {
        const ev = eventById().get((cx as HTMLElement).dataset.cross || '')
        if (ev) openDrawerEvent(ev)
        return
      }
      const wl = t.closest('.wikilink')
      if (wl) {
        const name = (wl as HTMLElement).dataset.target || ''
        const canon = resolveName(name)
        if (canon) openWikiPage(canon)
        else toast('知识库中没有这张卡片：' + name)
      }
    }
    document.addEventListener('click', onClick)

    return () => {
      offKeyboard()
      document.removeEventListener('click', onClick)
    }
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <AppContext.Provider value={ctx}>
        <Curtain />
        <TopBar />
        <ViewHost />
        <Drawer />
        <CommandPalette />
        <HelpOverlay />
        <ToastStack />
      </AppContext.Provider>
    </MotionConfig>
  )
}
