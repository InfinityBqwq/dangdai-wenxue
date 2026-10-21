/**
 * search.ts — 全局搜索索引与打分（app.js「全局搜索」节原样移植）
 * ------------------------------------------------------------
 * 索引随来源模式重建（entity 恒可搜；event 按 eventVisible 过滤）。
 * 打分规则逐字保留：前缀 100 / 包含 60 / 全文 25，entity +4，取前 24 条。
 */
import { eventVisible } from './state'
import { norm } from './indexes'

export interface SearchItem {
  kind: 'entity' | 'note' | 'event'
  name: string
  title?: string
  meta: string
  text: string
}

let searchIndex: SearchItem[] = []

function typeMeta(t: string): { label: string } {
  const cfg = (window as any).APP_CONFIG
  return (cfg && cfg.types && cfg.types[t]) || (cfg && cfg.types && cfg.types.other) || { label: t }
}

/** 重建索引（setSource 联动；数据未就绪时静默跳过，installGlobals 会再补一次） */
export function rebuildSearchIndex(): void {
  const D = (window as any).DATA
  if (!D) return
  const out: SearchItem[] = []
  D.entities.forEach((e: any) => {
    // 词条卡恒可搜(不按来源拆分)
    out.push({
      kind: 'entity',
      name: e.name,
      meta:
        typeMeta(e.type).label +
        (e.birth ? ' · ' + e.birth + (e.death ? '—' + e.death : '') : ''),
      text: e.name + ' ' + (e.tags || []).join(' ') + ' ' + (e.summary || ''),
    })
  })
  D.notes.forEach((n: any) =>
    out.push({
      kind: 'note',
      name: n.name,
      meta: '分期笔记',
      text: n.name + ' ' + (n.tags || []).join(' ') + ' ' + (n.summary || ''),
    }),
  )
  D.events.forEach((ev: any) => {
    if (!eventVisible(ev)) return
    const srcTag = ev.src === 'hong' ? ' · 洪年表' : ev.src === 'curated' ? ' · 策展' : ''
    out.push({
      kind: 'event',
      name: ev.id,
      title: ev.title || ev.label,
      meta: ev.year + ' 年' + (ev.month ? ev.month + ' 月' : '') + srcTag,
      text: (ev.title || '') + ' ' + ev.label + ' ' + (ev.blurb || ''),
    })
  })
  searchIndex = out
}

/** 打分搜索（runSearch 原样移植；上限 24 条 = stagger 性能红线） */
export function runSearch(q: string): SearchItem[] {
  q = q.trim()
  if (q.length < 1) return []
  const nq = norm(q)
  const scored: { item: SearchItem; score: number }[] = []
  for (const item of searchIndex) {
    const nameN = norm(item.title || item.name)
    let score = -1
    if (nameN.startsWith(nq)) score = 100
    else if (nameN.includes(nq)) score = 60
    else if (norm(item.text).includes(nq)) score = 25
    if (item.kind === 'entity') score += 4
    if (score > 0) scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 24).map((s) => s.item)
}
