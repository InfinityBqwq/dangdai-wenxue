/**
 * engine.ts — WIKI 视图数据逻辑（js/wiki.js + app.js 相关函数移植，唯一 React 重写视图）
 * ------------------------------------------------------------
 * 这里只做「数据 → 渲染模型」的纯转换，React 组件（index/WikiTree/WikiArticle）
 * 消费模型做声明式渲染；动效一律在组件层用 motion 实现，不进本文件。
 * 移植对应关系：
 *   GROUPS / collect()          → buildTreeModel() 的类型分组段（原样）
 *   buildPeriodNav()            → buildTreeModel() 的分期导航段（原样）
 *   buildTree() 的 byName       → buildByName()（笔记先挂、实体覆盖，原样）
 *   badges() / show() 页头      → badgesHtml() / subLine() / buildEntryDoc()
 *   showChapter()               → buildChapterDoc()（DATA_BODY.__chapters 惰性包）
 *   splitArticle()              → 新增：把 marked 输出切成顶层块，供滚动显影与
 *                                 本页目录（scrollspy）使用；不改渲染结果本身
 * 正文/口径摘段一律运行时经 window.DATA / window.DATA_BODY /
 * api.ensureBodyData 访问，绝不读数据文件本身。
 */
import { renderMarkdown, stripTitleHeading, ensureBodyData } from '@/shell/api'

type AnyObj = Record<string, any>

const CFG = (): AnyObj => (window as any).APP_CONFIG || {}
const D = (): AnyObj => (window as any).DATA || {}

/* ---------------- 类型分组（wiki.js GROUPS 原样，颜色取自 config） ---------------- */
export function wikiGroups(): { key: string; label: string; color: string }[] {
  const T = CFG().types || {}
  return [
    { key: 'event', label: '事件 · 运动 · 论争', color: T.event.color },   // 分期笔记不再平铺成组,由分期导航承载
    { key: 'policy', label: '文艺政策', color: T.policy.color },
    { key: 'movement', label: '思潮 · 群体 · 流派', color: T.movement.color },
    { key: 'theory', label: '理论框架', color: T.theory.color },
    { key: 'person', label: '人物', color: T.person.color },
    { key: 'work', label: '作品 · 刊物', color: T.work.color },
    { key: 'org', label: '组织 · 机构', color: T.org.color },
  ]
}

const escAttr = (s: unknown): string => String(s).replace(/"/g, '&quot;')

/* Obsidian 深链（wiki.js obsidianUri 原样） */
export function obsidianUri(p: unknown): string {
  return `obsidian://open?vault=${CFG().obsidianVault}&file=${encodeURIComponent(String(p).replace(/\.md$/, ''))}`
}

/* ---------------- 名称索引（buildTree 头部 byName 原样：笔记先挂、实体覆盖） ---------------- */
export function buildByName(): Map<string, AnyObj> {
  const byName = new Map<string, AnyObj>()
  D().notes.forEach((n: AnyObj) => byName.set(n.name, n))
  D().entities.forEach((e: AnyObj) => byName.set(e.name, e))
  return byName
}

/* ---------------- 目录树模型（buildPeriodNav + collect 原样移植） ---------------- */
export interface TreeChapter {
  num?: number
  title: string
  path: string
  sum: string
}
export interface TreePeriod {
  id: string
  name: string
  hidden: boolean
  chapters: TreeChapter[]
  notes: string[]
}
export interface TreeScheme {
  id: string
  label: string
  book: string
  color: string
  countLabel: string
  periods: TreePeriod[]
}
export interface TreeGroupModel {
  key: string
  label: string
  color: string
  items: string[]
}
export interface TreeModel {
  overview: string[]
  schemes: TreeScheme[]
  groups: TreeGroupModel[]
}

/** 分期导航随顶栏口径全局联动（wiki.js visibleSchemes 原样）：朱/洪只显示对应一版，比对并置两版 */
export function visibleSchemes(m: string): string[] {
  return m === 'zhu' ? ['zhu'] : m === 'hong' ? ['hong'] : ['zhu', 'hong']
}

export function buildTreeModel(source: string): TreeModel {
  const PZ = D().periodizations
  const model: TreeModel = { overview: [], schemes: [], groups: [] }
  if (PZ) {
    if (PZ.overview && PZ.overview.length) model.overview = PZ.overview.slice()
    const colorOf: Record<string, string> = { zhu: 'var(--src-zhu)', hong: 'var(--src-hong)' }
    for (const key of visibleSchemes(source)) {
      const pz = PZ[key]
      if (!pz) continue
      const vis: AnyObj[] = pz.periods.filter((p: AnyObj) => !p.hidden)
      const chapN = vis.reduce((a: number, p: AnyObj) => a + p.chapters.length, 0)
      const noteN = vis.reduce((a: number, p: AnyObj) => a + p.notes.length, 0)
      model.schemes.push({
        id: pz.id,
        label: pz.label,
        book: pz.book,
        color: colorOf[key],
        countLabel: `${chapN}章${noteN ? ' · ' + noteN + '笔记' : ''}`,
        periods: pz.periods.map((p: AnyObj) => ({
          id: p.id,
          name: p.name,
          hidden: !!p.hidden,
          chapters: (p.chapters || []).map((c: AnyObj) => ({
            num: c.num, title: c.title, path: c.path, sum: c.sum || '',
          })),
          notes: (p.notes || []).slice(),
        })),
      })
    }
  }
  // 类型分组（collect() 原样：按类型收集 + 中文序排序，空组不渲染）
  const map = new Map<string, AnyObj[]>(wikiGroups().map((g) => [g.key, []]))
  D().entities.forEach((e: AnyObj) => { if (map.get(e.type)) map.get(e.type)!.push(e) })
  for (const g of wikiGroups()) {
    const items = map.get(g.key)!
    items.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    if (!items.length) continue
    model.groups.push({ key: g.key, label: g.label, color: g.color, items: items.map((e) => e.name) })
  }
  return model
}

/* ---------------- 选中态与默认展开 ---------------- */
export type Sel =
  | { kind: 'entry'; name: string }
  | { kind: 'chapter'; path: string; pzId: string }

/**
 * 默认展开键：综述 + 首个方案块（旧 buildTree「前两个 .wt-group 加 .open」）；
 * 口径切换重建后重放当前选中并展开其所在分组（openUp 原样语义）。
 * 键约定：ov=综述 · sc:<方案id>=方案块 · pg:<方案id>:<期id>=期内折叠 · g:<类型key>=类型组
 */
export function openKeysFor(tree: TreeModel, sel: Sel | null): Set<string> {
  const s = new Set<string>()
  if (tree.overview.length) s.add('ov')
  if (tree.schemes[0]) s.add('sc:' + tree.schemes[0].id)
  if (sel) {
    if (sel.kind === 'chapter') {
      const sc = tree.schemes.find((z) => z.id === sel.pzId)
      if (sc) {
        s.add('sc:' + sc.id)
        const per = sc.periods.find((p) => p.chapters.some((c) => c.path === sel.path))
        if (per) s.add('pg:' + sc.id + ':' + per.id)
      }
    } else {
      const g = tree.groups.find((x) => x.items.includes(sel.name))
      if (g) s.add('g:' + g.key)
      for (const sc of tree.schemes) {
        const per = sc.periods.find((p) => p.notes.includes(sel.name))
        if (per) {
          s.add('sc:' + sc.id)
          s.add('pg:' + sc.id + ':' + per.id)
          break
        }
      }
    }
  }
  return s
}

/* ---------------- 文章渲染模型（show / showChapter 原样移植） ---------------- */
export interface ArticleBlock {
  html: string
}
export interface TocEntry {
  id: string
  text: string
  level: 2 | 3
}
export interface ArticleModel {
  kind: 'entry' | 'chapter'
  key: string
  title: string
  badgesHtml: string
  sub: string
  /** 正文顶层块（marked 输出按顶层元素切开，内容不改写） */
  blocks: ArticleBlock[]
  toc: TocEntry[]
  /** 口径对照块 html（window.compareBlockHtml，词条页） */
  cmpHtml: string
  /** 页底关联入口条整行 html（含 wlb-label，window.crossActionsForWiki） */
  linksHtml: string
  /** 章节页 AI 总结导读正文 html（'' = 无） */
  sumHtml: string
}

/* badges() 原样：类型徽章 + 前 12 枚标签 */
function badgesHtml(item: AnyObj): string {
  const parts: string[] = []
  if (item.type !== 'note') {
    const tm = CFG().types[item.type] || CFG().types.other
    parts.push(`<span class="badge solid" style="background:${tm.color}">${tm.label}</span>`)
  } else {
    parts.push(`<span class="badge solid" style="background:var(--ink-2)">分期笔记</span>`)
  }
  ;(item.tags || []).slice(0, 12).forEach((t: string) => parts.push(`<span class="tag-chip">${t}</span>`))
  return parts.join('')
}

/* show() 页头副行原样：生卒 · 身份 · 年代 */
function subLine(item: AnyObj): string {
  const sub: string[] = []
  if (item.birth) sub.push(item.birth + (item.death ? '—' + item.death : '—'))
  if (item.role) sub.push(item.role)
  if (item.era) sub.push(item.era)
  return sub.join(' · ')
}

/**
 * 把 marked 输出切成顶层块：供 useInView 一次性显影与本页目录（h2/h3 锚点）。
 * 只包一层 wrapper / 补 id，不改写任何块内部 html。
 */
export function splitArticle(html: string): { blocks: ArticleBlock[]; toc: TocEntry[] } {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const blocks: ArticleBlock[] = []
  const toc: TocEntry[] = []
  let h = 0
  parsed.body.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent || ''
      if (t.trim()) blocks.push({ html: `<p>${t}</p>` })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    if (tag === 'h2' || tag === 'h3') {
      const id = 'wiki-h-' + ++h
      el.setAttribute('id', id)
      toc.push({ id, text: el.textContent || '', level: tag === 'h2' ? 2 : 3 })
    }
    blocks.push({ html: el.outerHTML })
  })
  return { blocks, toc }
}

/* 词条/笔记页（show() 原样；正文缺 → 加载中提示，由组件层触发补载） */
export function buildEntryDoc(byName: Map<string, AnyObj>, name: string): ArticleModel | null {
  const item = byName.get(name)
  if (!item) return null
  const bodyHtml = item.body
    ? renderMarkdown(stripTitleHeading(item.body, item.name))
    : '<p>（正文加载中…）</p>'
  const { blocks, toc } = splitArticle(bodyHtml)
  const w = window as any
  return {
    kind: 'entry',
    key: 'entry:' + name,
    title: item.name,
    badgesHtml: badgesHtml(item),
    sub: subLine(item),
    blocks,
    toc,
    cmpHtml: w.compareBlockHtml ? w.compareBlockHtml(item) : '',
    linksHtml: w.crossActionsForWiki
      ? `<span class="wlb-label">关联入口</span>` + w.crossActionsForWiki(item)
      : '',
    sumHtml: '',
  }
}

/* 惰性包章节记录（DATA_BODY.__chapters：路径 → {body, sum}） */
export function chapterRec(path: string): { body: string; sum: string } | null {
  const DB = (window as any).DATA_BODY
  return DB && DB.__chapters ? DB.__chapters[path] || null : null
}

/** 教材章节页（showChapter() 原样：总结置顶作导读，正文缺 → 加载中提示） */
export function buildChapterDoc(path: string, pzId: string): ArticleModel | null {
  const pz = (D().periodizations || {})[pzId]
  if (!pz) return null
  let ch: TreeChapter | null = null
  for (const p of pz.periods) {
    const hit = (p.chapters || []).find((c: AnyObj) => c.path === path)
    if (hit) { ch = hit; break }
  }
  if (!ch) return null
  const rec = chapterRec(path)
  const raw = rec ? rec.body : ''
  const sum = rec && rec.sum ? rec.sum.replace(/^#\s+[^\n]*\r?\n?/, '') : '' // 剥总结自带大标题,与盒标题去重
  const { blocks, toc } = splitArticle(
    raw ? renderMarkdown(stripTitleHeading(raw, ch.title)) : '<p>（原文加载中…）</p>',
  )
  return {
    kind: 'chapter',
    key: 'chapter:' + path,
    title: ch.title,
    badgesHtml:
      `<span class="badge solid" style="background:var(--ink-2)">教材原文</span>` +
      `<span class="badge solid" style="background:${pz.id === 'hong' ? 'var(--src-hong)' : 'var(--src-zhu)'}">${pz.label}</span>`,
    sub: '',
    blocks,
    toc,
    cmpHtml: '',
    sumHtml: sum ? renderMarkdown(stripTitleHeading(sum, ch.title)) : '',
    linksHtml:
      `<span class="wlb-label">关联入口</span>` +
      `<button data-act="obsidian" data-uri="${escAttr(obsidianUri(ch.path))}">✎ Obsidian 打开</button>`,
  }
}

/* ---------------- 正文惰性补载（show/showChapter 补载段原样语义） ----------------
   返回 true = 已就绪（含「包已载但该条确实没有」的终态，不再重复补载）；
   返回 false = 已发起异步补载，调用方在 resolve 后重算模型。 */
export function ensureEntryBody(item: AnyObj): boolean {
  if (item.body) return true
  const DB = (window as any).DATA_BODY
  if (DB) {
    const full = DB[item.name]
    if (full) {
      item.body = full.body
      if (full.cmp) item.cmp = full.cmp
    }
    return true
  }
  ensureBodyData()
    .then(() => {
      const full = (window as any).DATA_BODY && (window as any).DATA_BODY[item.name]
      if (full) {
        item.body = full.body
        if (full.cmp) item.cmp = full.cmp
      }
    })
    .catch(() => { /* 保持加载中提示 */ })
  return false
}

export function ensureChapterLoaded(): boolean {
  if ((window as any).DATA_BODY) return true
  ensureBodyData().catch(() => { /* 保持加载中提示 */ })
  return false
}

/* 首屏导读统计（init() 文案原样：全库共 N 张知识卡片 + N 篇分期笔记与综述） */
export function libraryStats(): { entities: number; notes: number } {
  return { entities: (D().entities || []).length, notes: (D().notes || []).length }
}
