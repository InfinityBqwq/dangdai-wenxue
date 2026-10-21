/**
 * uiStore.ts — 极简外部 store + React 绑定
 * ------------------------------------------------------------
 * 抽屉 / 命令面板 / 帮助 / Toast 等 UI 状态走 useSyncExternalStore：
 * 引擎等命令式代码经 api.ts 直接 set（不经过 React 事件系统）也能驱动更新。
 */
import { useSyncExternalStore } from 'react'

export interface Store<T> {
  get(): T
  set(v: T): void
  subscribe(fn: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      value = v
      listeners.forEach((fn) => fn())
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get)
}

/* ---------------- 抽屉 ---------------- */
export type DrawerItem =
  | { kind: 'entity'; name: string; version: number }
  | { kind: 'note'; name: string; version: number }
  | { kind: 'event'; ev: any; version: number }

export const drawerStore = createStore<DrawerItem | null>(null)

/* ---------------- 命令面板 ---------------- */
export interface PaletteState {
  open: boolean
  q: string
}
export const paletteStore = createStore<PaletteState>({ open: false, q: '' })

/* ---------------- 帮助浮层 ---------------- */
export const helpStore = createStore<boolean>(false)

/* ---------------- Toast 队列 ---------------- */
export interface ToastItem {
  id: number
  msg: string
  ms: number
}
export const toastStore = createStore<ToastItem[]>([])
