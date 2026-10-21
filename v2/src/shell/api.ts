/**
 * api.ts — Shell 跨层 API（视图岛唯一入口）
 * ------------------------------------------------------------
 * openDrawerEntity / openDrawerEvent / openDrawerNote / openWikiPage /
 * switchView / toast / ensureBodyData / renderMarkdown / stripTitleHeading /
 * useAppContext / useViewParams / prefersReducedMotion，
 * 另含面板（命令面板 / 帮助 / 抽屉）的命令式开闭，供 keyboard.ts 与引擎移植代码调用。
 */
import { marked } from 'marked'
import {
  registerShellHooks,
  useAppContextValue,
} from './state'
import type { AppContextValue, Params, ViewId } from './state'
import { drawerStore, helpStore, paletteStore, toastStore, useStore } from './uiStore'
import type { DrawerItem } from './uiStore'
import { switchView } from './router'
import { syncSourceHash } from './router'
import { rebuildSearchIndex } from './search'
import { entityByName, noteByName, resolveName } from './indexes'
import { esc } from './util'

export { switchView, getView } from './router'
export { prefersReducedMotion } from './util'
export { esc, cssVar } from './util'
export { resolveName, entityByName, noteByName, eventById } from './indexes'
export type { AppContextValue, Params, ViewId }
export type { DrawerItem }

/* ---------------- React Context hooks ---------------- */
export function useAppContext(): AppContextValue {
  return useAppContextValue()
}

/** 当前视图参数（视图岛用） */
export function useViewParams(): Params {
  return useAppContextValue().params
}

/* ---------------- Toast（队列化） ---------------- */
let toastSeq = 0
export function toast(msg: string, ms = 1800): void {
  const id = ++toastSeq
  toastStore.set([...toastStore.get(), { id, msg, ms }])
  window.setTimeout(() => {
    toastStore.set(toastStore.get().filter((t) => t.id !== id))
  }, ms)
}
export function useToasts() {
  return useStore(toastStore)
}
export { toastStore, paletteStore, helpStore, drawerStore }

/* ---------------- 命令面板 ---------------- */
export function openPalette(q = ''): void {
  paletteStore.set({ open: true, q })
}
export function closePalette(): void {
  paletteStore.set((paletteStore.get().open ? { open: false, q: '' } : paletteStore.get()))
}
export function isPaletteOpen(): boolean {
  return paletteStore.get().open
}
/** Ctrl+K 在面板已开时：聚焦并全选输入框（等价旧版 focus+select） */
export function focusPaletteInput(): void {
  const el = document.getElementById('cmdk-input') as HTMLInputElement | null
  if (el) {
    el.focus()
    el.select()
  }
}

/* ---------------- 帮助浮层 ---------------- */
export function toggleHelp(force?: boolean): void {
  const cur = helpStore.get()
  helpStore.set(force === undefined ? !cur : force)
}
export function isHelpOpen(): boolean {
  return helpStore.get()
}

/* ---------------- 抽屉 ---------------- */
export function isDrawerOpen(): boolean {
  return drawerStore.get() !== null
}

export function closeDrawer(): void {
  drawerStore.set(null)
}

function setDrawer(item: DrawerItem): void {
  drawerStore.set(item)
}

/** 补载后版本 +1：Drawer 组件据此重算内容（三段换装） */
function bumpDrawer(): void {
  const cur = drawerStore.get()
  if (cur) drawerStore.set({ ...cur, version: cur.version + 1 })
}

/**
 * 正文惰性包（data-body.js）——动态 import 保持惰性分块语义。
 * 模块副作用写入 window.DATA_BODY；失败时清空 promise 允许重试。
 */
let bodyPromise: Promise<void> | null = null
export function ensureBodyData(): Promise<void> {
  if ((window as any).DATA_BODY) return Promise.resolve()
  if (!bodyPromise) {
    // @ts-ignore 旧版零构建脚本无类型声明；vite 将其打包为独立惰性 chunk（模块副作用写 window.DATA_BODY）
    bodyPromise = import('../../../js/data-body.js')
      .then(() => undefined)
      .catch((err) => {
        bodyPromise = null
        throw err
      })
  }
  return bodyPromise
}

/** 正文补载后若抽屉仍开着且还是这个条目，换装重渲染（app.js hydrateDrawer 移植） */
function hydrateDrawer(name: string): void {
  ensureBodyData()
    .then(() => {
      const full = (window as any).DATA_BODY && (window as any).DATA_BODY[name]
      const e = entityByName().get(name) || noteByName().get(name)
      if (full && e) {
        e.body = full.body
        if (full.cmp) e.cmp = full.cmp
      }
      const cur = drawerStore.get()
      const stillOpen =
        cur &&
        ((cur.kind === 'entity' && entityByName().get(name)?.title === e?.title) ||
          (cur.kind === 'note' && cur.name === name))
      if (stillOpen) bumpDrawer()
    })
    .catch(() => {
      /* 加载失败:抽屉停留在摘要 */
    })
}

export function openDrawerEntity(name: string): void {
  const e = entityByName().get(name)
  if (!e) return
  setDrawer({ kind: 'entity', name, version: 0 })
  if (!e.body) {
    if ((window as any).DATA_BODY) {
      // 包已就绪:该实体可能从未打开过,同步回填
      const full = (window as any).DATA_BODY[e.name]
      if (full) {
        e.body = full.body
        if (full.cmp) e.cmp = full.cmp
        bumpDrawer()
      }
    } else {
      hydrateDrawer(name) // 包未加载:异步补载后重渲染
    }
  }
}

export function openDrawerEvent(ev: any): void {
  if (!ev) return
  setDrawer({ kind: 'event', ev, version: 0 })
}

export function openDrawerNote(name: string): void {
  const n = noteByName().get(name)
  if (!n) return
  setDrawer({ kind: 'note', name, version: 0 })
  if (!n.body) {
    if ((window as any).DATA_BODY) {
      const full = (window as any).DATA_BODY[n.name]
      if (full) {
        n.body = full.body
        bumpDrawer()
      }
    } else {
      hydrateDrawer(name)
    }
  }
}

/** WIKI 视图内打开页面（旧版 openWikiPage 移植） */
export function openWikiPage(name: string): void {
  const canon = resolveName(name)
  if (!canon) {
    toast('未找到：' + name)
    return
  }
  if (entityByName().get(canon)) closeDrawer()
  switchView('wiki', { name: canon })
}

/* ---------------- Markdown 渲染（app.js renderWiki 原样移植） ----------------
   [[双链]] 先替换成占位符避免被 marked 破坏，渲染后还原成可点击 span。 */
marked.setOptions({ breaks: true })

export function stripTitleHeading(body: unknown, title?: unknown): string {
  const lines = String(body).split(/\r?\n/)
  if (lines.length && /^#\s+/.test(lines[0])) {
    const head = lines[0].replace(/^#\s+/, '').replace(/[\[\]《》]/g, '')
    const t = String(title || '').replace(/[\[\]《》]/g, '')
    if (!t || head.includes(t.slice(0, 4)) || t.includes(head.slice(0, 4))) lines.shift()
  }
  return lines.join('\n')
}

export function renderMarkdown(md: unknown): string {
  // 先把 [[...]] 替换成占位符，避免 marked 破坏
  const stash: { t: string; label: string }[] = []
  const stashed = String(md).replace(
    /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
    (_m: string, target: string, alias?: string) => {
      const t = target.trim()
      const label = (alias || t).trim()
      const idx = stash.push({ t, label }) - 1
      return `@@WL${idx}@@`
    },
  )
  let html = marked.parse(stashed, { breaks: true }) as string
  html = html.replace(/@@WL(\d+)@@/g, (_m: string, i: string) => {
    const { t, label } = stash[+i]
    const exists = resolveName(t) !== null
    return `<span class="wikilink${exists ? '' : ' missing'}" data-target="${esc(t)}">${esc(label)}</span>`
  })
  return html
}

/* ---------------- Shell 联动钩子注册（state.setSource 的副作用出口） ---------------- */
registerShellHooks({
  toast,
  closeDrawer,
  rebuildSearchIndex,
  syncSourceHash,
})
