/**
 * drawerContent.ts — 详情抽屉内容生成（app.js「详情抽屉」节原样移植）
 * ------------------------------------------------------------
 * 口径对照块(compareBlockHtml) / 来源徽章(srcBadgesHtml) / 另一史对照(crossChronicle) /
 * wikiCandidatesForEvent / timelineAnchor / 动作按钮数组。
 * HTML 字符串经 dangerouslySetInnerHTML 注入，wikilink/data-cross 委托照旧生效。
 */
import { esc, cssVar } from './util'
import { entityByName, noteByName, eventById, resolveName, norm as normOf } from './indexes'
import { srcMeta } from './state'
import { renderMarkdown, stripTitleHeading } from './api'

type AnyObj = Record<string, any>

const CFG = (): AnyObj => (window as any).APP_CONFIG || {}
const D = (): AnyObj => (window as any).DATA || {}
const typeMeta = (t: string): AnyObj => CFG().types[t] || CFG().types.other

export interface DrawerAction {
  act: string
  label: string
  attrs: Record<string, string>
}

export interface DrawerModel {
  key: string
  kickerHtml: string
  title: string
  sub: string
  bodyHtml: string
  actions: DrawerAction[]
}

function badge(text: unknown, color: string, solid?: boolean): string {
  return `<span class="badge${solid ? ' solid' : ''}" style="color:${solid ? color : 'var(--ink-2)'};${solid ? '' : `border-color:${color}55`}">${esc(text)}</span>`
}

/** 词条 → 时间轴锚点(年)：人物=印章所在期(birth+28) · 笔记=起始年 ·
    作品=workYear · 事件/思潮/运动等=编年中提及该词条的条目(优先里程碑,取最早) */
export function timelineAnchor(e: AnyObj): number | null {
  if (!e) return null
  if (e.type === 'note' || e.note) return e.from ? +e.from : null
  if (e.type === 'person') {
    if (!e.birth) return null
    return Math.min(Math.max(+e.birth + 28, CFG().YEAR_MIN), CFG().YEAR_MAX)
  }
  if (e.workYear) return +e.workYear
  const name = e.name
  // 编年提及:双链 refs/同题优先;事件·思潮·运动类再放宽到正文含名
  const chronType = ['event', 'policy', 'movement', 'org', 'theory'].includes(e.type)
  const evs = D().events.filter(
    (ev: AnyObj) =>
      (ev.title && resolveName(ev.title) === name) ||
      (ev.refs || []).some((r: string) => resolveName(r) === name) ||
      (chronType && ev.text.includes(name)),
  )
  if (!evs.length) return null
  const sorted = evs.slice().sort((a: AnyObj, b: AnyObj) => a.year - b.year || (a.month || 0) - (b.month || 0))
  const best = sorted.find((ev: AnyObj) => ev.priority === 1) || sorted[0]
  return best.year + ((best.month || 6) - 0.5) / 12
}

export function crossActions(name: string, kind?: string): DrawerAction[] {
  const e = entityByName().get(name) || noteByName().get(name)
  const anchor = e ? timelineAnchor(e) : null
  const obsidianUri = `obsidian://open?vault=${CFG().obsidianVault}&file=${encodeURIComponent(name)}`
  const out: DrawerAction[] = []
  if (anchor != null) out.push({ act: 'timeline-year', label: '⇲ 时间轴定位', attrs: { year: String(Math.round(anchor)) } })
  out.push({ act: 'wiki', label: '📖 Wiki 阅读', attrs: { name } })
  out.push({ act: 'graph', label: '🕸 图谱查看', attrs: { name } })
  if (kind !== 'note') out.push({ act: 'locate', label: '🗺 地图定位', attrs: { name } })
  out.push({ act: 'puzzle', label: '🧩 加入拼图', attrs: { add: name } })
  out.push({ act: 'obsidian', label: '✎ Obsidian 打开', attrs: { uri: obsidianUri } })
  return out
}

/* ---------- 两书口径对照：同一个词条,两书原话并排 ---------- */
function cmpColHtml(book: string, data: AnyObj | undefined, note: string | undefined, e: AnyObj): string {
  const meta = srcMeta(book)
  const info = (D().books && D().books[book]) || {}
  const head = `${meta.label}《${info.title || ''}》`
  if (!data || !data.n) {
    return `<div class="cmp-col">
      <div class="cmp-book"><span class="sdot" style="background:${meta.color}"></span>${esc(head)}</div>
      <div class="cmp-none">本书未提及「${esc(e.name)}」</div>
      ${note ? `<div class="cmp-note">${esc(note)}</div>` : ''}
    </div>`
  }
  /* 原文摘段:这本书在哪几节着重讲,原话怎么说 */
  const ps = (data.ps || [])
    .map(
      (p: AnyObj) => `
    <div class="cmp-passage">
      ${p.s ? `<div class="cmp-psect" style="color:${meta.color}">◈ ${p.s.split(' > ').map(esc).join(' <span class="cmp-sep">›</span> ')}</div>` : ''}
      <div class="cmp-ptext">${esc(p.t)}</div>
    </div>`,
    )
    .join('')
  /* 未入选摘段的其余章节,去重后收成一行"另见" */
  const seen = new Set((data.ps || []).map((p: AnyObj) => p.s))
  const restChaps = [...new Set((data.chs || []).filter((c: string) => !seen.has(c)).map((c: string) => c.split(' > ')[0]))]
  return `<div class="cmp-col">
    <div class="cmp-book"><span class="sdot" style="background:${meta.color}"></span>${esc(head)}</div>
    <div class="cmp-stat">提及 ${data.n} 处 · ${data.sn} 个章节小节</div>
    ${ps}
    ${restChaps.length ? `<div class="cmp-more">另见:${restChaps.slice(0, 3).map(esc).join(' · ')}${restChaps.length > 3 ? ' 等' : ''}</div>` : ''}
    ${note ? `<div class="cmp-note">${esc(note)}</div>` : ''}
  </div>`
}

export function compareBlockHtml(e: AnyObj): string {
  if (!e || e.type === 'note') return ''
  const cmp = e.cmp || {}
  const hasNote = cmp.note && (cmp.note.hong || cmp.note.zhu)
  if (!cmp.hong && !cmp.zhu && !hasNote && !(e.src || []).length) return ''
  const note = cmp.note || {}
  return `<div class="cmp-block">
    <div class="cmp-title"><span>两史口径对照</span><span class="cmp-hint">同一词条,两部文学史各自怎么讲</span></div>
    <div class="cmp-cols">${cmpColHtml('hong', cmp.hong, note.hong, e)}${cmpColHtml('zhu', cmp.zhu, note.zhu, e)}</div>
  </div>`
}

/* 来源徽章：有笔记出处用出处；否则回退两书正文提及(cmp)标"提及 n 处" */
function srcBadgesHtml(e: AnyObj): string {
  const s = e.src || []
  if (s.length) {
    return s
      .map((b: string) => {
        const meta = srcMeta(b)
        return badge('● ' + meta.label, meta.color.startsWith('var') ? cssVar(meta.color) : meta.color)
      })
      .join('')
  }
  const c = e.cmp || {}
  let out = ''
  if (c.hong && c.hong.n) out += badge(`● 洪书提及 ${c.hong.n} 处`, cssVar('--src-hong'))
  if (c.zhu && c.zhu.n) out += badge(`● 朱书提及 ${c.zhu.n} 处`, cssVar('--src-zhu'))
  return out
}

function srcRefsLine(e: AnyObj): string {
  const refs = e.srcRefs || []
  if (!refs.length) return ''
  return `<h3>卡片出处</h3><p>${refs
    .map(
      (r: AnyObj) =>
        `<span style="color:${cssVar(r.book === 'hong' ? '--src-hong' : '--src-zhu')}">◆</span> ${esc(r.label)}`,
    )
    .join('<br>')}</p>`
}

/* 编年事件来源徽章 */
const EVENT_SRC: Record<string, string> = { hong: '洪子诚年表', zhu: '朱栋霖大事记', curated: '策展里程碑' }
function eventSrcBadge(ev: AnyObj): string {
  const label = EVENT_SRC[ev.src] || '编年事件'
  const meta = srcMeta(ev.src === 'zhu' ? 'zhu' : ev.src === 'hong' ? 'hong' : 'curated')
  return badge('● ' + label, cssVar(meta.color) || '#8a8272')
}

/* 另一史年表交叉引用：优先构建期里程碑配对(msTitle)，退化同年词元重合；策展卡对照洪侧同题 */
function crossChronicle(ev: AnyObj): string {
  if (!ev.src) return ''
  let entries: AnyObj[] = []
  let srcLabel = ''
  if (ev.src === 'curated') {
    if (ev.hongMatched) {
      entries = D().events.filter((x: AnyObj) => x.src === 'hong' && x.msTitle === ev.title)
      srcLabel = EVENT_SRC.hong
    }
  } else {
    const other = ev.src === 'hong' ? 'zhu' : 'hong'
    srcLabel = EVENT_SRC[other]
    entries = D().events.filter(
      (x: AnyObj) => x.src === other && x.msTitle && x.msTitle === ev.msTitle && x.id !== ev.id,
    )
    if (!entries.length) {
      const cands = D().events.filter((x: AnyObj) => x.src === other && x.year === ev.year && x.id !== ev.id)
      const tokens = (t: string) => {
        const s = new Set<string>()
        for (const m of String(t).matchAll(/\[\[([^\]|]+)/g)) s.add(m[1].trim())
        for (const m of String(t).matchAll(/《([^》]+)》/g)) s.add(m[1])
        return s
      }
      const a = tokens(ev.text)
      entries = cands
        .map((c: AnyObj) => {
          const b = tokens(c.text)
          let sc = 0
          for (const t of a) if (b.has(t)) sc++
          return { c, sc }
        })
        .sort((x: any, y: any) => y.sc - x.sc)
        .filter((x: any) => x.sc > 0)
        .slice(0, 2)
        .map((x: any) => x.c)
    }
  }
  if (!entries.length) return ''
  return `<h3>另一史对照 · ${esc(srcLabel)}</h3><p>${entries
    .slice(0, 2)
    .map(
      (c: AnyObj) =>
        `<span class="wikilink" style="color:var(--cinnabar)" data-cross="${esc(c.id)}">${esc(c.year + '年' + (c.month ? c.month + '月' : '') + ' · ' + (c.title || c.label).slice(0, 32))}</span>`,
    )
    .join('<br>')}</p>`
}

/* 时间轴事件卡 → 对应 Wiki 词条：标题精确 → 包含(最长优先) → refs 双链，取 0–2 个 */
export function wikiCandidatesForEvent(ev: AnyObj): string[] {  const title = String(ev.title || ev.label || '')
  const out: string[] = []
  const exact = resolveName(title)
  if (exact) out.push(exact)
  if (!out.length) {
    const nt = normOf(title)
    const contains: string[] = []
    for (const e of D().entities) {
      const n = normOf(e.name)
      if (n.length >= 2 && nt.includes(n)) contains.push(e.name)
    }
    contains.sort((a, b) => normOf(b).length - normOf(a).length)
    out.push(...contains.slice(0, 2))
  }
  if (!out.length) {
    const fromRefs = [...new Set((ev.refs || []).map((r: string) => resolveName(r)).filter(Boolean))] as string[]
    out.push(...fromRefs.slice(0, 2))
  }
  return [...new Set(out)].slice(0, 2)
}

/* ---------------- 三个 open* 的渲染模型 ---------------- */

export function buildEntityModel(name: string): DrawerModel | null {
  const e = entityByName().get(name)
  if (!e) return null
  const tm = typeMeta(e.type)
  const kickerHtml =
    badge(tm.label, tm.color, true) +
    (e.era ? badge(String(e.era).replace(/年代$/, '') + ' 年代', tm.color) : '') +
    (e.status ? badge(e.status, tm.color) : '') +
    srcBadgesHtml(e)
  const dates: string[] = []
  if (e.birth) dates.push(e.birth + (e.death ? '—' + e.death : '—'))
  if (e.role) dates.push(e.role)
  const body = stripTitleHeading(e.body || e.summary || '（占位卡片，尚未撰写正文）', e.title)
  return {
    key: 'entity:' + name,
    kickerHtml,
    title: e.title,
    sub: dates.join(' · '),
    bodyHtml: renderMarkdown(body) + srcRefsLine(e) + compareBlockHtml(e),
    actions: crossActions(e.name),
  }
}

export function buildEventModel(ev: AnyObj): DrawerModel {
  const tm = typeMeta(ev.kind)
  const kickerHtml =
    badge(ev.milestone ? '里程碑' : '编年事件', tm.color, true) +
    eventSrcBadge(ev) +
    badge(ev.period ? (CFG().periods.find((p: AnyObj) => p.id === ev.period) || {}).short || '' : '', tm.color)
  const dateStr = `${ev.year} 年${ev.month ? ' ' + ev.month + ' 月' : ''}${ev.day ? ' ' + ev.day + ' 日' : ''}`
  // 内容:里程碑=策展说明+编年原文(不再只给一句话);普通事件=编年原文
  let html = ''
  if (ev.milestone && ev.blurb) {
    html += `<p class="ev-blurb">${esc(ev.blurb)}</p>`
    if (ev.text && ev.text !== ev.blurb)
      html += `<h3>编年原文 · ${esc(EVENT_SRC[ev.src] || '')}</h3><p>${renderMarkdown(ev.text)}</p>`
  } else {
    html += `<p>${renderMarkdown(ev.text)}</p>`
  }
  if (ev.refs && ev.refs.length) {
    html += `<h3>相关条目</h3><p>${ev.refs
      .map((r: string) => {
        const name = resolveName(r)
        return name ? `<span class="wikilink" data-target="${esc(r)}">${esc(r)}</span>` : esc(r)
      })
      .join('　')}</p>`
  }
  html += crossChronicle(ev)
  // 按钮精简:Wiki 直达 / 搜索 / 图谱 / 拼图
  const evName = ev.title || ev.label
  const wikiNames = wikiCandidatesForEvent(ev)
  const actions: DrawerAction[] = wikiNames.map((n) => ({ act: 'wiki', label: `📖 Wiki · ${n}`, attrs: { name: n } }))
  actions.push({ act: 'search-name', label: '🔍 搜索相关卡片', attrs: { name: evName } })
  actions.push({ act: 'graph', label: '🕸 图谱查看', attrs: { name: evName } })
  actions.push({ act: 'puzzle', label: '🧩 加入拼图', attrs: { addev: ev.id } })
  return {
    key: 'event:' + ev.id,
    kickerHtml,
    title: ev.title || ev.label,
    sub: dateStr,
    bodyHtml: html,
    actions,
  }
}

export function buildNoteModel(name: string): DrawerModel | null {
  const n = noteByName().get(name)
  if (!n) return null
  const kickerHtml =
    badge('分期笔记', CFG().types.other.color, true) +
    (n.from ? badge(`${n.from}${n.to ? '—' + n.to : ''}`, CFG().types.other.color) : '')
  const body = n.body || '（正文加载中…）'
  return {
    key: 'note:' + name,
    kickerHtml,
    title: n.title,
    sub: '',
    bodyHtml: renderMarkdown(body),
    actions: crossActions(n.name, 'note'),
  }
}

/* ---------------- Wiki 页底「关联入口」按钮组（window.crossActionsForWiki） ---------------- */
export function crossActionsForWiki(item: AnyObj): string {
  const obsidianUri = `obsidian://open?vault=${CFG().obsidianVault}&file=${encodeURIComponent(
    item.path ? item.path.replace(/\.md$/, '') : item.name,
  )}`
  const anchor = timelineAnchor(item)
  return `
    ${anchor ? `<button class="btn" data-act="timeline" data-year="${Math.round(anchor)}">⇲ 时间轴定位</button>` : ''}
    <button class="btn" data-act="graph" data-name="${esc(item.name)}">🕸 图谱查看关联</button>
    ${item.type !== 'note' ? `<button class="btn" data-act="locate" data-name="${esc(item.name)}">🗺 地图定位</button>` : ''}
    <button class="btn" data-act="puzzle" data-add="${esc(item.name)}">🧩 加入拼图</button>
    <button class="btn" data-act="obsidian" data-uri="${esc(obsidianUri)}">✎ Obsidian 打开</button>`
}

/* eventById 供抽屉动作（data-cross → 事件） */
export { eventById as eventByIdMap }
