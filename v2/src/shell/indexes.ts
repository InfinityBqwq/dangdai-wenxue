/**
 * indexes.ts — 基础索引（app.js「基础索引」节原样移植）
 * 全部惰性构建：首次访问时从 window.DATA 建 Map（数据由 src/data/store.ts 副作用引入）。
 */

type AnyObj = Record<string, any>

interface DataIndex {
  entityByName: Map<string, AnyObj>
  noteByName: Map<string, AnyObj>
  eventById: Map<string, AnyObj>
  normIndex: Map<string, string>
}

let idx: DataIndex | null = null

/** 名称模糊解析用的归一化：去掉《》“”引号空格（app.js norm 原样移植） */
export function norm(s: unknown): string {
  // eslint-disable-next-line no-useless-escape
  return String(s).replace(/[《》“”"'‘’\s]/g, '').trim()
}

function build(): DataIndex {
  const D = (window as any).DATA
  if (!D) throw new Error('[v2] window.DATA 未就绪：检查 src/data/store.js 副作用引入是否生效')
  const entityByName = new Map<string, AnyObj>()
  const noteByName = new Map<string, AnyObj>()
  const eventById = new Map<string, AnyObj>()
  D.entities.forEach((e: AnyObj) => entityByName.set(e.name, e))
  D.notes.forEach((n: AnyObj) => noteByName.set(n.name, n))
  D.events.forEach((ev: AnyObj) => eventById.set(ev.id, ev))
  const normIndex = new Map<string, string>()
  D.entities.forEach((e: AnyObj) => normIndex.set(norm(e.name), e.name))
  D.notes.forEach((n: AnyObj) => {
    if (!normIndex.has(norm(n.name))) normIndex.set(norm(n.name), n.name)
  })
  return { entityByName, noteByName, eventById, normIndex }
}

function ensure(): DataIndex {
  if (!idx) idx = build()
  return idx
}

export function entityByName(): Map<string, AnyObj> {
  return ensure().entityByName
}

export function noteByName(): Map<string, AnyObj> {
  return ensure().noteByName
}

export function eventById(): Map<string, AnyObj> {
  return ensure().eventById
}

/** 名称模糊解析：归一化后查索引，未命中返回 null */
export function resolveName(raw: unknown): string | null {
  const n = norm(raw)
  return ensure().normIndex.get(n) || null
}
