/**
 * state.ts — 应用状态：路由快照 + 编年口径（来源模式）
 * ------------------------------------------------------------
 * 移植 app.js「来源模式(编年口径)」节：localStorage 键 wenxue-src、
 * zhu/hong/compare 三态、eventVisible 判定、setSource 联动 toast 与 hash 同步。
 * React 侧经 AppContext 下发：当前视图 / params / source / setSource。
 *
 * 对 toast / 关抽屉 / 重建搜索索引 / hash 同步的联动经 ShellHooks 由 api.ts 注册
 * （避免 state ↔ api 循环依赖）。
 */
import { createContext, useContext, useSyncExternalStore } from 'react'

/* ---------------- 视图与参数类型 ---------------- */
export type ViewId = 'timeline' | 'wiki' | 'graph' | 'map' | 'puzzle'
export const VIEW_IDS: ViewId[] = ['timeline', 'wiki', 'graph', 'map', 'puzzle']

export type Params = Record<string, string | number>

export interface AppState {
  view: ViewId
  params: Params
  source: string
}

export interface AppContextValue {
  view: ViewId
  params: Params
  source: string
  setSource: (m: string) => void
}

/* ---------------- Shell 联动钩子（api.ts 注册） ---------------- */
export interface ShellHooks {
  toast(msg: string, ms?: number): void
  closeDrawer(): void
  rebuildSearchIndex(): void
  syncSourceHash(m: string): void
}
let hooks: ShellHooks | null = null
export function registerShellHooks(h: ShellHooks): void {
  hooks = h
}
function H(): ShellHooks {
  if (!hooks) throw new Error('[v2] shell hooks 未注册（api.ts 应在初始化时 registerShellHooks）')
  return hooks
}

/* ---------------- 来源模式（编年口径） ----------------
   编年是两套(朱栋霖大事记 / 洪子诚年表),模式只切换编年轨;
   词条卡恒显示全部,并排两书"各自怎么说"的口径对照块。 */
const SRC_KEY = 'wenxue-src'
const SRC_TOAST: Record<string, string> = {
  zhu: '全局口径:朱栋霖(时间轴编年 + Wiki 分期导航)',
  hong: '全局口径:洪子诚(时间轴编年 + Wiki 分期导航)',
  compare: '比对模式:时间轴双轨并置;Wiki 并置两版分期',
}

export function srcModes(): { id: string; label: string; title?: string }[] {
  const cfg = (window as any).APP_CONFIG
  return (cfg && cfg.sources && cfg.sources.modes) || []
}

/** 口径元信息（色 / 短名）；未配置时回退淡墨 */
export function srcMeta(s: string): { label: string; short: string; color: string } {
  const cfg = (window as any).APP_CONFIG
  return (
    (cfg && cfg.sources && cfg.sources.meta && cfg.sources.meta[s]) ||
    { label: s, short: s, color: 'var(--ink-3)' }
  )
}

function initSource(): string {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(SRC_KEY)
  } catch {
    /* file:// 下可能禁用 */
  }
  if (saved === 'all') saved = 'zhu' // 旧值迁移
  return srcModes().some((m) => m.id === saved) ? (saved as string) : 'zhu'
}

/* ---------------- 外部 store（route + source） ---------------- */
let state: AppState = { view: 'timeline', params: {}, source: initSource() }
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((fn) => fn())
}

export function getAppState(): AppState {
  return state
}

export function subscribeApp(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const sameParams = (a: Params, b: Params): boolean => JSON.stringify(a) === JSON.stringify(b)

/** 路由落地：视图与参数均未变化时跳过（load 二次路由幂等） */
export function applyRoute(view: ViewId, params: Params): void {
  if (state.view === view && sameParams(state.params, params)) return
  state = { view, params, source: state.source }
  notify()
}

/** 当前编年口径 */
export function srcMode(): string {
  return state.source
}

/** 编年事件在当前模式下是否可见（app.js eventVisible 原样移植） */
export function eventVisible(ev: any): boolean {
  const m = srcMode()
  if (m === 'compare') return !(ev.src === 'curated' && ev.hongMatched)
  if (m === 'hong') {
    if (ev.src === 'curated' && ev.hongMatched) return false
    return ev.src === 'hong' || ev.src === 'curated'
  }
  return ev.src === 'zhu' || ev.src === 'curated' // zhu(默认)
}

/** 切换编年口径（app.js setSource 原样移植；toast/关抽屉/索引重建/hash 同步走 hooks） */
export function setSource(m: string, opts: { fromHash?: boolean; silent?: boolean } = {}): void {
  if (!srcModes().some((x) => x.id === m)) return
  state = { ...state, source: m }
  try {
    localStorage.setItem(SRC_KEY, m)
  } catch {
    /* 忽略 */
  }
  H().rebuildSearchIndex()
  if (!opts.fromHash) {
    // 同步 hash(保留视图与其它参数),不触发重复路由
    H().syncSourceHash(m)
  }
  H().closeDrawer()
  // 通知视图：旧版 window.Views.onSourceChange 照旧；React 岛走自定义事件
  for (const mod of Object.values((window as any).Views || {})) {
    const modAny = mod as any
    if (modAny && typeof modAny.onSourceChange === 'function') modAny.onSourceChange()
  }
  window.dispatchEvent(new CustomEvent('wl:sourcechange', { detail: { source: m } }))
  if (!opts.silent) H().toast(SRC_TOAST[m] || m, 2200)
  notify()
}

/** 循环切换口径（keyboard 的 S 键用） */
export function cycleSource(): void {
  const modes = srcModes()
  const i = modes.findIndex((x) => x.id === srcMode())
  setSource(modes[(i + 1) % modes.length].id)
}

/* ---------------- React Context ---------------- */
export const AppContext = createContext<AppContextValue | null>(null)

/** 订阅应用状态（App.tsx 用它取 Provider value） */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribeApp, getAppState)
}

/** 供类型收窄：从 Context 取值（api.ts 的 useAppContext 包装） */
export function useAppContextValue(): AppContextValue {
  const v = useContext(AppContext)
  if (!v) throw new Error('[v2] useAppContext 必须在 AppContext.Provider 内使用')
  return v
}
