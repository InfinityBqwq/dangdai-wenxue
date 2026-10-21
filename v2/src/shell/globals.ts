/**
 * globals.ts — 兼容全局名（供引擎移植代码原样引用）
 * ------------------------------------------------------------
 * 旧版无模块系统，引擎代码引用 window.APP_STATE / window.toast / window.marked 等。
 * v2 在应用初始化时把等价实现挂到 window，引擎逐字搬运时无需改动这些引用点。
 */
import { marked } from 'marked'
import { getAppState, setSource, srcMode, srcMeta, eventVisible, cycleSource } from './state'
import { getView, switchView } from './router'
import {
  toast,
  prefersReducedMotion,
  openDrawerEntity,
  openDrawerEvent,
  openDrawerNote,
  openWikiPage,
  closeDrawer,
  toggleHelp,
  ensureBodyData,
  renderMarkdown,
  stripTitleHeading,
} from './api'
import { compareBlockHtml, crossActionsForWiki } from './drawerContent'
import { rebuildSearchIndex } from './search'

export function installGlobals(): void {
  const w = window as any

  /* APP_STATE：source 用存取器代理到 React store（引擎读写都落到同一状态源） */
  w.APP_STATE = w.APP_STATE || {}
  Object.defineProperty(w.APP_STATE, 'source', {
    get: () => getAppState().source,
    set: (m: string) => setSource(m),
    configurable: true,
  })
  w.APP_STATE.srcMode = srcMode
  w.APP_STATE.eventVisible = eventVisible
  w.APP_STATE.srcMeta = srcMeta

  w.toast = toast
  w.prefersReducedMotion = prefersReducedMotion
  w.switchView = switchView
  w.getView = getView
  w.setSource = setSource
  w.cycleSource = cycleSource

  w.openDrawerEntity = openDrawerEntity
  w.openDrawerEvent = openDrawerEvent
  w.openDrawerNote = openDrawerNote
  w.openWikiPage = openWikiPage
  w.closeDrawer = closeDrawer

  w.renderWikiStripped = renderMarkdown
  w.stripTitleHeading = stripTitleHeading
  w.compareBlockHtml = compareBlockHtml
  w.crossActionsForWiki = crossActionsForWiki
  w.ensureBodyData = ensureBodyData
  w.toggleKbdHelp = toggleHelp

  /* npm marked 实例：引擎移植代码照旧 marked.parse / marked.setOptions */
  w.marked = marked

  /* 视图模块注册表（引擎岛初始化时可注册 init/onShow/onSourceChange，路由照旧通知） */
  w.Views = w.Views || {}

  /* 搜索索引冷启动就绪：data.js 经 main.tsx 静态副作用引入，此处 window.DATA 必已
     就绪（rebuildSearchIndex 自带 !D 守卫）。此前索引唯一重建点是 setSource（切编年
     口径），冷启动 Ctrl+K 恒为空结果——search.ts 头注释承诺的"installGlobals 会再
     补一次"在此兑现（浏览器验收发现的缺陷，2026-10-21）。 */
  rebuildSearchIndex()
}
