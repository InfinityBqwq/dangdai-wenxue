/**
 * engine.ts — 拼图白板引擎（js/puzzle.js 逐字 ESM 移植）
 * ------------------------------------------------------------
 * 无限白板：左侧卡片库 → 拖上无限画布；卡片移动 / 调大小 / 连线
 * （线型 × 箭头 × 颜色 + 标签）；便签（双击空白）、分组框（带动框内卡片）；
 * localStorage 防抖自动保存 + 导出 / 导入 JSON。交互统一 Pointer Events；
 * 滚轮锚定光标缩放；双指捏合。保存格式与交互逻辑与旧版一字不动。
 *
 *  - 对外仍挂 window.PUZZLE（键盘层 routePuzzle 调用）与
 *    window.Views.puzzle = { init, onShow }（旧版路由协议，switchView 照旧通知）；
 *    旧版协议 puzzle 无 onSourceChange（卡片库不随编年口径重建），故不新增；
 *  - window.APP_CONFIG / window.DATA / window.toast / window.openDrawerEntity /
 *    window.openDrawerEvent 由外壳 globals.ts 提供在 window 上；
 *  - 不依赖任何库（旧版也未用 d3/marked），无需 import。
 *
 * 与旧版的全部差异（除以下标注块外逐字一致）：
 *  ① v2 keep-alive 适配（非逻辑改动，等价旧版可观察行为）：旧版 init/onShow
 *     只在视图已 active（可见）时被路由调用；v2 岛可能挂载于切场 150ms 节拍内
 *     （容器仍 display:none），此时 getBoundingClientRect() 为 0——首次进入的
 *     世界居中与 ?add= 对位延迟到容器可见后执行（init 的 pendingCenter +
 *     onShow 的可见性重试，各一处，均已标注）。
 *  ② v2 动效新增（docs/动效升级计划书·拼图；全部走 CSS class / WAAPI，
 *     不动每帧渲染逻辑、不引入 React 状态；prefers-reduced-motion 直跳终态）：
 *     - addCard：新卡上板落地弹簧（.pz-land class → puzzle.css keyframes，
 *       scale 过冲 + 阴影收敛）；
 *     - addLink：新连线 stroke-dashoffset 描线生长 + 整组淡入
 *       （WAAPI 瞬态动画，结束即还原，不污染 dasharray 虚线语义）；
 *     - renderLib：卡片库分组展开条目 stagger（条目挂 --pz-i，
 *       puzzle.css 按 --stagger-gap 级联 delay，260ms 封顶）。
 *  ③ noUnusedLocals 规避：旧版遗留只写引用 root 保留赋值原样，补一行 void root。
 *
 * 旧版已知怪癖（本移植按"一字不动"原样保留，未修复，仅在此备案）：
 *  - js/puzzle.js:484+517：activeLinkDrag 先置 true 再赋 .cancel，严格模式下
 *    该赋值抛 TypeError（旧版同为 'use strict'，行为一致）——连线拖拽本身可用
 *    （监听先于抛错挂上），仅 Esc 中断连线拖拽（cancelDrag）失效；
 *  - js/puzzle.js:584：positionStylebar 的 sy 误用 v.y（应为 v.k），
 *    连线样式条纵向定位失准——原样保留。
 */

/* 卡片 / 连线 / 分组框结构（字段与旧版字面一致） */
interface PcCard {
  uid: string
  kind: 'entity' | 'event' | 'note'
  ref: string
  x: number
  y: number
  w: number
  h: number
  z: number
  text: string
}
interface PcLink {
  uid: string
  a: string
  b: string
  line: string
  arrow: string
  color: string
  label: string
}
interface PcGroup {
  uid: string
  title: string
  x: number
  y: number
  w: number
  h: number
}
/* 卡片库条目 / 分组（buildLibraryData 构造的字段） */
interface PcLibItem {
  kind: string
  ref: string
  title: string
  meta: string
  s: string
}
interface PcLibSection {
  id: string
  chip: string
  label: string
  color: string
  items: PcLibItem[]
}
/* 库列表条目元素：旧版借 _dragged 区分"拖动"与"点击" */
type LibItemEl = HTMLButtonElement & { _dragged?: boolean }

export interface PuzzleEngineHandle {
  init(): void
  onShow(params?: any): void
}

let booted = false

/**
 * 挂载引擎（岛 useEffect 调用，幂等）。内部即旧版 js/puzzle.js 的 IIFE 体，
 * 原句序执行一遍；返回旧版 window.Views.puzzle 同款协议对象。
 */
export function mountPuzzleEngine(): PuzzleEngineHandle {
  if (booted) return (window as any).Views.puzzle
  booted = true

  const w = window as any // 引擎引用的旧版全局（globals.ts 已装齐），统一走 any 别名
  /* ============================================================
     puzzle.js — 拼图白板视图（第五视图）
     ============================================================ */
  const CFG = w.APP_CONFIG
  const D = w.DATA
  const PCFG = CFG.puzzle

  /* ---------------- 工具 ---------------- */
  const esc = (s: any): string =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (ch: string) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
  const trunc = (s: any, n: number): string => {
    s = String(s || '')
    return [...s].length > n ? [...s].slice(0, n).join('') + '…' : s
  }
  const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
  const LINK_VAR: Record<string, string> = { ink: '--ink-2', cinnabar: '--cinnabar', gold: '--gold' }
  const LINK_LABEL: Record<string, string> = { ink: '墨', cinnabar: '朱砂', gold: '金' }
  const LINE_TYPES: [string, string][] = [['solid', '实线'], ['dash', '虚线'], ['dot', '点线']]
  const ARROW_TYPES: [string, string][] = [['none', '无'], ['ab', '→'], ['ba', '←'], ['both', '↔']]

  const entityByName = new Map<string, any>(D.entities.map((e: any) => [e.name, e]))
  const eventById = new Map<string, any>(D.events.map((ev: any) => [ev.id, ev]))

  /* ---------------- 状态 ---------------- */
  let inited = false
  const state: {
    cards: PcCard[]
    links: PcLink[]
    groups: PcGroup[]
    view: { k: number; x: number; y: number }
    seq: number
  } = {
    cards: [],   // {uid, kind:'entity'|'event'|'note', ref, x, y, w, h, z, text}
    links: [],   // {uid, a, b, line, arrow, color, label}
    groups: [],  // {uid, title, x, y, w, h}
    view: { k: 1, x: 0, y: 0 },
    seq: 1,
  }
  let sel: { type: 'card' | 'link' | 'group'; uid: string } | null = null // {type:'card'|'link'|'group', uid}
  let activeLinkDrag: any = null // 连线拖拽进行中(Esc 可取消)
  let pendingCenter = false      // v2 keep-alive 适配：init 时容器不可见，首次居中待 onShow 补做

  /* DOM 引用 */
  let root: HTMLElement, viewport: HTMLElement, board: HTMLElement, edgeSvg: SVGSVGElement, gEdges: SVGGElement, layerGroups: HTMLElement, layerCards: HTMLElement
  let libPanel: HTMLElement, libInput: HTMLInputElement, libChips: HTMLElement, libList: HTMLElement
  let toolbar: HTMLElement, stylebar: HTMLElement, emptyEl: HTMLElement, undoEl: HTMLElement, importFile: HTMLInputElement
  let zoomLabel: HTMLElement | null

  const cardByUid = (uid: string) => state.cards.find((c) => c.uid === uid)
  const groupByUid = (uid: string) => state.groups.find((g) => g.uid === uid)
  const linkByUid = (uid: string) => state.links.find((l) => l.uid === uid)

  /* ================= 初始化 ================= */
  function init(): void {
    if (inited) return
    inited = true
    try {
      root = document.getElementById('view-puzzle') as HTMLElement
      void root // 旧版遗留只写引用（TS noUnusedLocals 规避；逻辑零改动）
      buildLibraryData() // 先备好库数据：buildDOM 内的 bindLibrary 渲染 chips/列表依赖它
      buildDOM()
      load()
      renderAll()
      bindBoard()
      if (!load.savedView) { // 首次进入：世界原点置于屏幕中心
        const r = viewport.getBoundingClientRect()
        state.view = { k: 1, x: r.width / 2, y: r.height / 2 }
        // v2 keep-alive 适配：挂载先于 active（容器 display:none）时 rect 为 0，
        // 旧版不存在此路径（init 只在可见时被调）；延迟到 onShow 容器可见后补做居中
        if (!r.width) pendingCenter = true
      }
      applyView()
    } catch (err) {
      // init 在 DOMContentLoaded 路由时执行,若此处抛错,load 时的二次路由会被
      // 上面的 inited 守卫挡回——错误必须在这里显式暴露,否则视图静默残废
      inited = false
      w.__pzErr = String((err as Error)?.stack || err)
      throw err
    }
  }

  /* ---------------- DOM 骨架 ---------------- */
  function buildDOM(): void {
    libPanel = document.getElementById('pz-library') as HTMLElement
    viewport = document.getElementById('pz-viewport') as HTMLElement
    toolbar = document.getElementById('pz-toolbar') as HTMLElement
    stylebar = document.getElementById('pz-stylebar') as HTMLElement
    emptyEl = document.getElementById('pz-empty') as HTMLElement
    undoEl = document.getElementById('pz-undo') as HTMLElement
    zoomLabel = document.getElementById('pz-zoom')
    importFile = document.getElementById('pz-import-file') as HTMLInputElement

    // 库面板
    libPanel.innerHTML = `
      <div class="pz-lib-head">卡片库</div>
      <div class="pz-lib-search"><input id="pz-lib-input" type="text" placeholder="搜索卡片名 / 标签…" spellcheck="false"></div>
      <div id="pz-lib-chips"></div>
      <div id="pz-lib-list"></div>
      <div class="pz-lib-foot">卡色 = 词条类型（同图谱）<br>金底卡 = 自由便签 · 墨晕框 = 分组</div>`
    libInput = libPanel.querySelector('#pz-lib-input') as HTMLInputElement
    libChips = libPanel.querySelector('#pz-lib-chips') as HTMLElement
    libList = libPanel.querySelector('#pz-lib-list') as HTMLElement

    // 画布内容层：分组框(底) → 连线 SVG → 卡片(顶)
    board = document.createElement('div')
    board.id = 'pz-board'
    board.innerHTML = `
      <div id="pz-groups"></div>
      <svg id="pz-edges"></svg>
      <div id="pz-cards"></div>`
    viewport.insertBefore(board, viewport.firstChild)
    layerGroups = board.querySelector('#pz-groups') as HTMLElement
    edgeSvg = board.querySelector('#pz-edges') as SVGSVGElement
    layerCards = board.querySelector('#pz-cards') as HTMLElement
    gEdges = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    edgeSvg.appendChild(gEdges)

    buildToolbar()
    buildStylebar()
    bindLibrary()

    // 窄屏库面板开合
    const libBtn = document.getElementById('pz-lib-btn')
    if (libBtn) libBtn.addEventListener('click', () => libPanel.classList.toggle('open'))
  }

  /* ================= 视图变换（平移 / 缩放） ================= */
  function applyView(): void {
    const v = state.view
    board.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`
    const g = PCFG.grid * v.k
    viewport.style.backgroundSize = `${g}px ${g}px`
    viewport.style.backgroundPosition = `${v.x}px ${v.y}px`
    if (zoomLabel) zoomLabel.textContent = Math.round(v.k * 100) + '%'
    renderEdges()          // 箭头 / 虚线 / 命中域按 k 重算（保持屏幕恒宽）
    if (sel && sel.type === 'link') positionStylebar(linkByUid(sel.uid))
  }

  function screenToWorld(cx: number, cy: number): { x: number; y: number } {
    const r = viewport.getBoundingClientRect()
    const v = state.view
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k }
  }
  function centerWorld(): { x: number; y: number } {
    const r = viewport.getBoundingClientRect()
    return screenToWorld(r.left + r.width / 2, r.top + r.height / 2)
  }

  function zoomAt(factor: number, cx: number, cy: number): void { // cx/cy 为视口内坐标
    const v = state.view
    const k = clamp(v.k * factor, PCFG.zoomMin, PCFG.zoomMax)
    if (k === v.k) return
    v.x = cx - (cx - v.x) * (k / v.k)
    v.y = cy - (cy - v.y) * (k / v.k)
    v.k = k
    applyView()
    markDirty()
  }

  function fit(): void {
    const r = viewport.getBoundingClientRect()
    const items = [...state.cards, ...state.groups]
    if (!items.length) {
      state.view = { k: 1, x: r.width / 2, y: r.height / 2 }
      applyView(); markDirty(); return
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const it of items) {
      x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y)
      x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h)
    }
    const wd = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
    const k = clamp(Math.min((r.width - 100) / wd, (r.height - 140) / h), PCFG.zoomMin, 1.5)
    const v = state.view
    v.k = k
    v.x = r.width / 2 - (x0 + wd / 2) * k
    v.y = r.height / 2 - (y0 + h / 2) * k
    applyView()
    markDirty()
  }

  function focusCard(c: PcCard): void {
    const r = viewport.getBoundingClientRect()
    const v = state.view
    v.x = r.width / 2 - (c.x + c.w / 2) * v.k
    v.y = r.height / 2 - (c.y + c.h / 2) * v.k
    applyView()
    select('card', c.uid)
  }

  /* ================= 卡片 ================= */
  function cardMeta(c: any): any {
    if (c.kind === 'entity') {
      const e = entityByName.get(c.ref)
      if (!e) return null
      return e
    }
    if (c.kind === 'event') return eventById.get(c.ref) || null
    return c
  }
  function cardColor(c: PcCard): string {
    if (c.kind === 'note') return 'var(--gold)'
    const m = cardMeta(c)
    const t = m ? (m.type || (m.kind === 'work' || m.kind === 'policy' ? m.kind : 'event')) : 'other'
    return (CFG.types[t] || CFG.types.other).color
  }

  function addCard(kind: 'entity' | 'event' | 'note', ref: string, wx: number, wy: number, opts: { text?: string } = {}): PcCard | null {
    if (kind !== 'note' && !cardMeta({ kind, ref })) return null
    const size = PCFG.cardSize[kind] || PCFG.cardSize.entity
    const c: PcCard = {
      uid: 'u' + (state.seq++), kind, ref: ref || '',
      x: Math.round(wx - size[0] / 2), y: Math.round(wy - size[1] / 2),
      w: size[0], h: size[1], z: state.seq++,
      text: opts.text || '',
    }
    state.cards.push(c)
    renderCards()
    refreshLibMarks()
    markDirty()
    /* v2 动效新增：新卡片上板落地弹簧（scale 过冲 + 阴影收敛 keyframes，
       见 puzzle.css .pz-land；减动效偏好直跳终态，不加 class） */
    if (!(w.prefersReducedMotion && w.prefersReducedMotion())) {
      const el = layerCards.querySelector(`[data-uid="${c.uid}"]`)
      if (el) {
        el.classList.add('pz-land')
        el.addEventListener('animationend', () => el.classList.remove('pz-land'), { once: true })
      }
    }
    return c
  }

  function positionCard(el: HTMLElement, c: { x: number; y: number; w: number; h: number }): void {
    el.style.left = c.x + 'px'; el.style.top = c.y + 'px'
    el.style.width = c.w + 'px'; el.style.height = c.h + 'px'
  }

  function buildCardEl(c: PcCard): HTMLElement {
    const el = document.createElement('div')
    el.className = 'pz-card kind-' + c.kind
    el.dataset.uid = c.uid
    const color = cardColor(c)
    if (c.kind === 'note') {
      el.innerHTML = `
        <div class="pz-c-bar" style="background:${color}"></div>
        <div class="pz-c-drag" title="拖动便签">✎</div>
        <div class="pz-c-note" data-edit contenteditable="true" spellcheck="false">${esc(c.text)}</div>
        <div class="pz-resize" title="调整大小"></div>
        <div class="pz-ports"><i class="pz-port" data-p="n" title="拖出连线"></i><i class="pz-port" data-p="s" title="拖出连线"></i><i class="pz-port" data-p="w" title="拖出连线"></i><i class="pz-port" data-p="e" title="拖出连线"></i></div>`
      const body = el.querySelector('.pz-c-note') as HTMLElement
      body.addEventListener('input', () => { c.text = body.textContent || ''; markDirty() })
      body.addEventListener('pointerdown', (ev) => ev.stopPropagation())
      body.addEventListener('paste', (ev) => {   // 便签只收纯文本
        ev.preventDefault()
        const t = (ev as ClipboardEvent).clipboardData ? (ev as ClipboardEvent).clipboardData!.getData('text/plain') : ''
        document.execCommand('insertText', false, t)
      })
      ;(el.querySelector('.pz-c-drag') as HTMLElement).addEventListener('pointerdown', (ev) => startCardMove(ev, c, el))
    } else {
      const m = cardMeta(c)
      const t = CFG.types[m.type || (m.kind === 'work' || m.kind === 'policy' ? m.kind : 'event')] || CFG.types.other
      let title = '', sub = '', body = ''
      if (c.kind === 'entity') {
        title = m.name
        sub = m.birth ? `${m.birth}${m.death ? '—' + m.death : ''}` : (m.era || m.role || m.year || '')
        body = m.summary || ''
      } else {
        title = m.title || trunc(m.label, 20)
        sub = `${m.year}${m.month ? '.' + m.month : ''} · ${m.src === 'hong' ? '洪' : m.src === 'curated' ? '策' : '朱'}`
        body = m.title ? trunc(m.label, 60) : (m.blurb || '')
      }
      el.innerHTML = `
        <div class="pz-c-bar" style="background:${color}"></div>
        <div class="pz-c-main">
          <div class="pz-c-title" title="${esc(title)}">${esc(title)}</div>
          ${sub ? `<div class="pz-c-sub">${esc(sub)}</div>` : ''}
          ${body ? `<div class="pz-c-body">${esc(body)}</div>` : ''}
        </div>
        <span class="pz-c-glyph" style="color:${color};border-color:${color}">${t.glyph}</span>
        <button class="pz-c-info" title="查看详情">ⓘ</button>
        <div class="pz-resize" title="调整大小"></div>
        <div class="pz-ports"><i class="pz-port" data-p="n" title="拖出连线"></i><i class="pz-port" data-p="s" title="拖出连线"></i><i class="pz-port" data-p="w" title="拖出连线"></i><i class="pz-port" data-p="e" title="拖出连线"></i></div>`
      ;(el.querySelector('.pz-c-info') as HTMLElement).addEventListener('pointerdown', (ev) => ev.stopPropagation())
      ;(el.querySelector('.pz-c-info') as HTMLElement).addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (c.kind === 'entity') w.openDrawerEntity(c.ref)
        else w.openDrawerEvent(cardMeta(c))
      })
      el.addEventListener('dblclick', (ev) => {
        ev.stopPropagation()
        if (c.kind === 'entity') w.openDrawerEntity(c.ref)
        else w.openDrawerEvent(cardMeta(c))
      })
    }
    el.addEventListener('pointerdown', (ev) => onCardPointerDown(ev, c, el))
    positionCard(el, c)
    el.style.zIndex = String(10 + (c.z % 1000000))   // 分组框(1)与连线层(2)之上
    return el
  }

  function onCardPointerDown(e: PointerEvent, c: PcCard, el: HTMLElement): void {
    if (e.button !== 0) return
    const port = (e.target as Element).closest('.pz-port')
    if (port) { e.stopPropagation(); startLinkDrag(e, c, el, (port as HTMLElement).dataset.p!) ; return }
    if ((e.target as Element).closest('.pz-resize')) { e.stopPropagation(); startCardResize(e, c, el); return }
    if ((e.target as Element).closest('[data-edit]') || (e.target as Element).closest('.pz-c-info')) { e.stopPropagation(); return }
    e.stopPropagation()
    startCardMove(e, c, el)
  }

  function startCardMove(e: PointerEvent, c: PcCard, el: HTMLElement): void {
    c.z = state.seq++                       // 置顶
    el.style.zIndex = String(10 + (c.z % 1000000))
    const start = { px: e.clientX, py: e.clientY, cx: c.x, cy: c.y }
    let moved = false
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.px) / state.view.k
      const dy = (ev.clientY - start.py) / state.view.k
      if (!moved && Math.hypot(ev.clientX - start.px, ev.clientY - start.py) < 3) return
      moved = true
      c.x = start.cx + dx; c.y = start.cy + dy
      positionCard(el, c)
      updateAttachedLinks(c.uid)
    }
    const up = () => {
      el.removeEventListener('pointermove', mv)
      if (!moved) select('card', c.uid)
      else markDirty()
    }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up, { once: true })
    el.addEventListener('pointercancel', up, { once: true })
  }

  function startCardResize(e: PointerEvent, c: PcCard, el: HTMLElement): void {
    select('card', c.uid)
    const start = { px: e.clientX, py: e.clientY, w: c.w, h: c.h }
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => {
      c.w = Math.max(PCFG.cardMin.w, Math.round(start.w + (ev.clientX - start.px) / state.view.k))
      c.h = Math.max(PCFG.cardMin.h, Math.round(start.h + (ev.clientY - start.py) / state.view.k))
      positionCard(el, c)
      updateAttachedLinks(c.uid)
    }
    const up = () => { el.removeEventListener('pointermove', mv); markDirty() }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up, { once: true })
    el.addEventListener('pointercancel', up, { once: true })
  }

  function renderCards(): void {
    layerCards.innerHTML = ''
    for (const c of state.cards) layerCards.appendChild(buildCardEl(c))
    if (sel && sel.type === 'card') {
      const el = layerCards.querySelector(`[data-uid="${sel.uid}"]`)
      if (el) el.classList.add('sel')
    }
    updateEmpty()
  }

  /* ================= 连线 ================= */
  const SVGNS = 'http://www.w3.org/2000/svg'
  function anchor(c: { x: number; y: number; w: number; h: number }, side: string): [number, number] {
    switch (side) {
      case 'n': return [c.x + c.w / 2, c.y]
      case 's': return [c.x + c.w / 2, c.y + c.h]
      case 'w': return [c.x, c.y + c.h / 2]
      default:  return [c.x + c.w, c.y + c.h / 2]
    }
  }
  function linkGeom(l: PcLink): { p1: [number, number]; p2: [number, number]; c1: [number, number]; c2: [number, number]; mid: [number, number] } | null {
    const a = cardByUid(l.a), b = cardByUid(l.b)
    if (!a || !b) return null
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2)
    const dy = (b.y + b.h / 2) - (a.y + a.h / 2)
    const horiz = Math.abs(dx) > Math.abs(dy)
    const s1 = horiz ? (dx >= 0 ? 'e' : 'w') : (dy >= 0 ? 's' : 'n')
    const s2 = horiz ? (dx >= 0 ? 'w' : 'e') : (dy >= 0 ? 'n' : 's')
    const p1 = anchor(a, s1), p2 = anchor(b, s2)
    const off = clamp(Math.hypot(dx, dy) / 3, 24, 140)
    const c1: [number, number] = [p1[0] + (horiz ? (dx >= 0 ? off : -off) : 0), p1[1] + (horiz ? 0 : (dy >= 0 ? off : -off))]
    const c2: [number, number] = [p2[0] - (horiz ? (dx >= 0 ? off : -off) : 0), p2[1] - (horiz ? 0 : (dy >= 0 ? off : -off))]
    return { p1, p2, c1, c2, mid: [(p1[0] + 3 * c1[0] + 3 * c2[0] + p2[0]) / 8, (p1[1] + 3 * c1[1] + 3 * c2[1] + p2[1]) / 8] }
  }
  const pathD = (g: { p1: [number, number]; c1: [number, number]; c2: [number, number]; p2: [number, number] }): string =>
    `M${g.p1[0]},${g.p1[1]} C${g.c1[0]},${g.c1[1]} ${g.c2[0]},${g.c2[1]} ${g.p2[0]},${g.p2[1]}`
  function arrowD(tip: [number, number], from: [number, number]): string { // tip:终点; from:控制点(箭头指向 = from→tip)
    const k = state.view.k
    const L = 9 / k, Wd = 3.8 / k
    const dx = tip[0] - from[0], dy = tip[1] - from[1]
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    return `M${tip[0]},${tip[1]} L${tip[0] - ux * L - uy * Wd},${tip[1] - uy * L + ux * Wd} L${tip[0] - ux * L + uy * Wd},${tip[1] - uy * L - ux * Wd} Z`
  }
  function dashOf(l: PcLink): string {
    const k = state.view.k
    if (l.line === 'dash') return `${7 / k} ${5 / k}`
    if (l.line === 'dot') return `${2 / k} ${4.2 / k}`
    return ''
  }

  function addLink(aUid: string, bUid: string): PcLink | null {
    if (aUid === bUid) return null
    const l: PcLink = { uid: 'u' + (state.seq++), a: aUid, b: bUid, line: 'solid', arrow: 'ab', color: 'ink', label: '' }
    state.links.push(l)
    renderEdges()
    /* v2 动效新增：新连线描线生长（stroke-dashoffset 0→全长）+ 整组淡入。
       WAAPI 瞬态动画：结束即自动还原，不写内联样式、不改 dasharray 虚线语义，
       不触碰 renderEdges/updateLinkEl 的每帧重算逻辑；减动效直跳终态 */
    if (!(w.prefersReducedMotion && w.prefersReducedMotion())) {
      const g = gEdges.querySelector(`[data-uid="${l.uid}"]`)
      if (g) {
        const line = g.querySelector('.pz-l-line') as SVGPathElement | null
        if (line) {
          const len = line.getTotalLength()
          if (len > 0) {
            line.animate([
              { strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
              { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 },
            ], { duration: 480, easing: 'cubic-bezier(.22, .8, .3, 1)' })
          }
        }
        ;(g as SVGGElement).animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 240, easing: 'ease-out' })
      }
    }
    markDirty()
    return l
  }

  function buildLinkEl(l: PcLink): SVGGElement {
    const g = document.createElementNS(SVGNS, 'g')
    g.setAttribute('class', 'pz-link')
    g.dataset.uid = l.uid
    g.dataset.a = l.a
    g.dataset.b = l.b
    const hit = document.createElementNS(SVGNS, 'path')
    hit.setAttribute('class', 'pz-l-hit')
    const line = document.createElementNS(SVGNS, 'path')
    line.setAttribute('class', 'pz-l-line')
    line.setAttribute('vector-effect', 'non-scaling-stroke')
    const a1 = document.createElementNS(SVGNS, 'path') // b 端箭头
    a1.setAttribute('class', 'pz-l-arrow pz-l-ab')
    const a2 = document.createElementNS(SVGNS, 'path') // a 端箭头
    a2.setAttribute('class', 'pz-l-arrow pz-l-ba')
    const label = document.createElementNS(SVGNS, 'text')
    label.setAttribute('class', 'pz-l-label')
    label.setAttribute('text-anchor', 'middle')
    g.append(hit, line, a1, a2, label)
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      select('link', l.uid)
    })
    g.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      select('link', l.uid)
      const inp = stylebar.querySelector('.pz-sb-label') as HTMLInputElement | null
      if (inp) { inp.focus(); inp.select() }
    })
    updateLinkEl(g, l)
    return g
  }

  function updateLinkEl(g: SVGGElement, l: PcLink): void {
    const geo = linkGeom(l)
    const colorVar = `var(${LINK_VAR[l.color] || LINK_VAR.ink})`
    const k = state.view.k
    const hit = g.querySelector('.pz-l-hit') as SVGPathElement, line = g.querySelector('.pz-l-line') as SVGPathElement
    const a1 = g.querySelector('.pz-l-ab') as SVGPathElement, a2 = g.querySelector('.pz-l-ba') as SVGPathElement
    const label = g.querySelector('.pz-l-label') as SVGTextElement
    if (!geo) { g.style.display = 'none'; return }
    g.style.display = ''
    const d = pathD(geo)
    hit.setAttribute('d', d)
    hit.setAttribute('stroke-width', String(16 / k))
    line.setAttribute('d', d)
    line.style.stroke = colorVar
    line.setAttribute('stroke-dasharray', dashOf(l))
    const showAb = l.arrow === 'ab' || l.arrow === 'both'
    const showBa = l.arrow === 'ba' || l.arrow === 'both'
    a1.style.display = showAb ? '' : 'none'
    a2.style.display = showBa ? '' : 'none'
    if (showAb) { a1.setAttribute('d', arrowD(geo.p2, geo.c2)); a1.style.fill = colorVar }
    if (showBa) { a2.setAttribute('d', arrowD(geo.p1, geo.c1)); a2.style.fill = colorVar }
    label.setAttribute('x', String(geo.mid[0]))
    label.setAttribute('y', String(geo.mid[1]))
    label.setAttribute('font-size', String(12.5 / k))
    label.setAttribute('stroke-width', String(3.5 / k))
    label.textContent = l.label || ''
  }

  function renderEdges(): void {
    gEdges.innerHTML = ''
    for (const l of state.links) {
      const g = buildLinkEl(l)
      if (sel && sel.type === 'link' && sel.uid === l.uid) g.classList.add('sel')
      gEdges.appendChild(g)
    }
  }
  function updateAttachedLinks(cardUid: string): void {
    for (const g of Array.from(gEdges.children) as SVGGElement[]) {
      if (g.dataset.a === cardUid || g.dataset.b === cardUid) {
        const l = linkByUid(g.dataset.uid!)
        if (l) updateLinkEl(g, l)
      }
    }
  }

  /* 连线拖拽（从端口到目标卡） */
  function startLinkDrag(e: PointerEvent, c: PcCard, el: HTMLElement, side: string): void {
    const p1 = anchor(c, side)
    const temp = document.createElementNS(SVGNS, 'path')
    temp.setAttribute('class', 'pz-l-temp')
    temp.setAttribute('vector-effect', 'non-scaling-stroke')
    edgeSvg.appendChild(temp)
    let targetUid: string | null = null, targetEl: Element | null = null, dead = false
    activeLinkDrag = true
    el.setPointerCapture(e.pointerId)
    const cleanup = () => {
      dead = true
      activeLinkDrag = null
      temp.remove()
      if (targetEl) targetEl.classList.remove('target')
      el.removeEventListener('pointermove', mv)
    }
    const mv = (ev: PointerEvent) => {
      if (dead) return
      const wpt = screenToWorld(ev.clientX, ev.clientY)
      temp.setAttribute('d', `M${p1[0]},${p1[1]} C${p1[0]},${p1[1]} ${wpt.x},${wpt.y} ${wpt.x},${wpt.y}`)
      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY)
      const cardEl = hitEl && hitEl.closest ? hitEl.closest('.pz-card') : null
      if (cardEl !== targetEl) {
        if (targetEl) targetEl.classList.remove('target')
        targetEl = (cardEl && (cardEl as HTMLElement).dataset.uid !== c.uid) ? cardEl : null
        if (targetEl) targetEl.classList.add('target')
        targetUid = targetEl ? (targetEl as HTMLElement).dataset.uid! : null
      }
    }
    const up = () => {
      if (dead) return
      cleanup()
      if (targetUid) {
        const l = addLink(c.uid, targetUid)
        if (l) select('link', l.uid)
      }
    }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up, { once: true })
    el.addEventListener('pointercancel', up, { once: true })
    // 旧版原样：activeLinkDrag 此刻为 true（原始类型），严格模式下本赋值抛 TypeError
    //（旧版 'use strict' 行为一致——连线拖拽可用，仅 Esc 中断失效）；逐字保留，见文件头备案
    activeLinkDrag.cancel = () => {
      if (dead) return false
      cleanup()
      try { el.releasePointerCapture(e.pointerId) } catch (_) { /* 已释放 */ }
      return true
    }
  }

  /* ---------------- 连线样式条 ---------------- */
  function buildStylebar(): void {
    stylebar.innerHTML = `
      <div class="pz-sb-row"><span class="pz-sb-lab">线型</span>
        <div class="pz-sb-seg" data-k="line">${LINE_TYPES.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div></div>
      <div class="pz-sb-row"><span class="pz-sb-lab">箭头</span>
        <div class="pz-sb-seg" data-k="arrow">${ARROW_TYPES.map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div></div>
      <div class="pz-sb-row"><span class="pz-sb-lab">颜色</span>
        <div class="pz-sb-seg pz-sb-colors" data-k="color">${Object.keys(LINK_VAR).map((v) =>
          `<button data-v="${v}" title="${LINK_LABEL[v]}"><i style="background:var(${LINK_VAR[v]})"></i>${LINK_LABEL[v]}</button>`).join('')}</div></div>
      <div class="pz-sb-row pz-sb-last">
        <input class="pz-sb-label" type="text" placeholder="标签（如：影响 / 师承）" spellcheck="false">
        <button class="pz-sb-del" title="删除这条连线">✕ 删除</button>
      </div>`
    stylebar.addEventListener('pointerdown', (e) => e.stopPropagation())
    stylebar.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest('button[data-v]') as HTMLElement | null
      if (btn && sel && sel.type === 'link') {
        const l = linkByUid(sel.uid)
        if (l) {
          l[(btn.closest('.pz-sb-seg') as HTMLElement).dataset.k as 'line' | 'arrow' | 'color'] = btn.dataset.v!
          renderEdges()
          gEdges.querySelector(`[data-uid="${l.uid}"]`)?.classList.add('sel')
          refreshStylebar(l)
          markDirty()
        }
      }
      if ((e.target as Element).closest('.pz-sb-del') && sel && sel.type === 'link') deleteSelected()
    })
    const inp = stylebar.querySelector('.pz-sb-label') as HTMLInputElement
    inp.addEventListener('input', () => {
      if (sel && sel.type === 'link') {
        const l = linkByUid(sel.uid)
        if (l) { l.label = inp.value; updateAttachedLinks2(l.uid); markDirty() }
      }
    })
    inp.addEventListener('pointerdown', (e) => e.stopPropagation())
  }
  function updateAttachedLinks2(linkUid: string): void {
    const g = gEdges.querySelector(`[data-uid="${linkUid}"]`) as SVGGElement | null
    const l = linkByUid(linkUid)
    if (g && l) updateLinkEl(g, l)
  }
  function refreshStylebar(l?: PcLink | null): void {
    if (!l) { stylebar.classList.remove('open'); return }
    stylebar.classList.add('open')
    stylebar.querySelectorAll('.pz-sb-seg').forEach((seg) => {
      const key = (seg as HTMLElement).dataset.k!
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === l[key as keyof PcLink]))
    })
    const inp = stylebar.querySelector('.pz-sb-label') as HTMLInputElement
    if (inp && document.activeElement !== inp) inp.value = l.label || ''
  }
  function positionStylebar(l?: PcLink | null): void {
    if (!l) return
    const geo = linkGeom(l)
    if (!geo) { stylebar.classList.remove('open'); return }
    const v = state.view
    const r = viewport.getBoundingClientRect()
    const sx = geo.mid[0] * v.k + v.x, sy = geo.mid[1] * v.y + v.y // 旧版原样（sy 误用 v.y，备案于文件头）
    stylebar.classList.add('open')
    const bw = stylebar.offsetWidth || 250, bh = stylebar.offsetHeight || 150
    stylebar.style.left = clamp(sx - bw / 2, 8, r.width - bw - 8) + 'px'
    stylebar.style.top = clamp(sy + 16, 8, r.height - bh - 8) + 'px'
  }

  /* ================= 分组框 ================= */
  function addGroup(wx: number, wy: number): PcGroup {
    const [gw, gh] = PCFG.groupSize
    const g: PcGroup = { uid: 'u' + (state.seq++), title: '', x: Math.round(wx - gw / 2), y: Math.round(wy - gh / 2), w: gw, h: gh }
    state.groups.push(g)
    renderGroups()
    markDirty()
    select('group', g.uid)
    const tEl = layerGroups.querySelector(`[data-uid="${g.uid}"] .pz-g-title`) as HTMLElement | null
    if (tEl) { tEl.focus() }
    return g
  }

  function buildGroupEl(g: PcGroup): HTMLElement {
    const el = document.createElement('div')
    el.className = 'pz-group'
    el.dataset.uid = g.uid
    el.innerHTML = `
      <div class="pz-g-title" data-edit contenteditable="true" spellcheck="false" data-ph="分组…">${esc(g.title)}</div>
      <div class="pz-resize" title="调整分组框"></div>`
    positionCard(el, g)
    const title = el.querySelector('.pz-g-title') as HTMLElement
    title.addEventListener('input', () => { g.title = title.textContent || ''; markDirty() })
    title.addEventListener('pointerdown', (ev) => ev.stopPropagation())
    el.addEventListener('pointerdown', (e) => onGroupPointerDown(e, g, el))
    return el
  }

  function groupMembers(g: PcGroup): PcCard[] {
    return state.cards.filter((c) =>
      c.x + c.w / 2 >= g.x && c.x + c.w / 2 <= g.x + g.w &&
      c.y + c.h / 2 >= g.y && c.y + c.h / 2 <= g.y + g.h)
  }

  function onGroupPointerDown(e: PointerEvent, g: PcGroup, el: HTMLElement): void {
    if (e.button !== 0) return
    e.stopPropagation()
    if ((e.target as Element).closest('.pz-resize')) { startGroupResize(e, g, el); return }
    // 移动分组框：带动框内卡片
    const members = groupMembers(g).map((c) => ({ c, el: layerCards.querySelector(`[data-uid="${c.uid}"]`) as HTMLElement | null, ox: c.x - g.x, oy: c.y - g.y }))
    const start = { px: e.clientX, py: e.clientY, gx: g.x, gy: g.y }
    let moved = false
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.px, ev.clientY - start.py) < 3) return
      moved = true
      g.x = start.gx + (ev.clientX - start.px) / state.view.k
      g.y = start.gy + (ev.clientY - start.py) / state.view.k
      positionCard(el, g)
      for (const m of members) {
        if (!m.el) continue
        m.c.x = g.x + m.ox; m.c.y = g.y + m.oy
        positionCard(m.el, m.c)
        updateAttachedLinks(m.c.uid)
      }
    }
    const up = () => {
      el.removeEventListener('pointermove', mv)
      if (!moved) select('group', g.uid)
      else markDirty()
    }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up, { once: true })
    el.addEventListener('pointercancel', up, { once: true })
  }

  function startGroupResize(e: PointerEvent, g: PcGroup, el: HTMLElement): void {
    select('group', g.uid)
    const start = { px: e.clientX, py: e.clientY, w: g.w, h: g.h }
    el.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => {
      g.w = Math.max(140, Math.round(start.w + (ev.clientX - start.px) / state.view.k))
      g.h = Math.max(90, Math.round(start.h + (ev.clientY - start.py) / state.view.k))
      positionCard(el, g)
    }
    const up = () => { el.removeEventListener('pointermove', mv); markDirty() }
    el.addEventListener('pointermove', mv)
    el.addEventListener('pointerup', up, { once: true })
    el.addEventListener('pointercancel', up, { once: true })
  }

  function renderGroups(): void {
    layerGroups.innerHTML = ''
    for (const g of state.groups) layerGroups.appendChild(buildGroupEl(g))
    if (sel && sel.type === 'group') {
      const el = layerGroups.querySelector(`[data-uid="${sel.uid}"]`)
      if (el) el.classList.add('sel')
    }
  }

  /* ================= 选中 / 删除 / 撤销 ================= */
  function select(type: 'card' | 'link' | 'group', uid: string): void {
    deselect()
    sel = { type, uid }
    if (type === 'card' || type === 'group') {
      const layer = type === 'card' ? layerCards : layerGroups
      layer.querySelector(`[data-uid="${uid}"]`)?.classList.add('sel')
    } else if (type === 'link') {
      gEdges.querySelector(`[data-uid="${uid}"]`)?.classList.add('sel')
      const l = linkByUid(uid)
      refreshStylebar(l)
      positionStylebar(l)
    }
  }
  function deselect(): boolean {
    if (!sel) return false
    if (sel.type === 'card') layerCards.querySelector(`[data-uid="${sel.uid}"]`)?.classList.remove('sel')
    else if (sel.type === 'group') layerGroups.querySelector(`[data-uid="${sel.uid}"]`)?.classList.remove('sel')
    else if (sel.type === 'link') gEdges.querySelector(`[data-uid="${sel.uid}"]`)?.classList.remove('sel')
    refreshStylebar(null)
    sel = null
    return true
  }

  function deleteSelected(): boolean {
    if (!sel) return false
    let snap: { cards: PcCard[]; links: PcLink[]; groups: PcGroup[] } = { cards: [], links: [], groups: [] }
    if (sel.type === 'card') {
      const c = cardByUid(sel.uid)
      if (!c) { sel = null; return false }
      const links = state.links.filter((l) => l.a === c.uid || l.b === c.uid)
      state.cards = state.cards.filter((x) => x !== c)
      state.links = state.links.filter((l) => !links.includes(l))
      snap = { cards: [c], links, groups: [] }
    } else if (sel.type === 'link') {
      const l = linkByUid(sel.uid)
      if (!l) { sel = null; return false }
      state.links = state.links.filter((x) => x !== l)
      snap = { cards: [], links: [l], groups: [] }
    } else {
      const g = groupByUid(sel.uid)
      if (!g) { sel = null; return false }
      state.groups = state.groups.filter((x) => x !== g)
      snap = { cards: [], links: [], groups: [g] }
    }
    sel = null
    refreshStylebar(null)
    renderAll()
    markDirty()
    showUndo('已删除', snap)
    return true
  }

  function showUndo(msg: string, snap: { cards: PcCard[]; links: PcLink[]; groups: PcGroup[] }): void {
    undoEl.querySelector('.pz-undo-msg')!.textContent = msg
    undoEl.classList.add('show')
    clearTimeout((showUndo as any)._t)
    ;(showUndo as any)._t = setTimeout(() => undoEl.classList.remove('show'), 5000)
    ;(undoEl as any)._restore = () => {
      state.cards.push(...snap.cards)
      state.links.push(...snap.links)
      state.groups.push(...snap.groups)
      renderAll()
      markDirty()
      undoEl.classList.remove('show')
      w.toast && w.toast('已撤销', 1200)
    }
  }

  function clearBoard(): void {
    if (!state.cards.length && !state.links.length && !state.groups.length) return
    const snap = { cards: state.cards.slice(), links: state.links.slice(), groups: state.groups.slice() }
    state.cards = []; state.links = []; state.groups = []
    sel = null
    refreshStylebar(null)
    renderAll()
    markDirty()
    showUndo(`已清空 ${snap.cards.length} 卡 · ${snap.links.length} 线`, snap)
  }

  /* ================= 卡片库 ================= */
  let libSections: PcLibSection[] = []
  const libState = { q: '', chip: 'all', expanded: new Set<string>() }

  function buildLibraryData(): void {
    libSections = []
    const order = ['person', 'work', 'org', 'movement', 'policy', 'event', 'theory', 'other']
    for (const t of order) {
      const ents = D.entities.filter((e: any) => e.type === t)
      if (!ents.length) continue
      const meta = CFG.types[t]
      libSections.push({
        id: 't-' + t, chip: t, label: meta.label, color: meta.color,
        items: ents.map((e: any) => ({
          kind: 'entity', ref: e.name, title: e.name,
          meta: e.birth ? `${e.birth}${e.death ? '—' + e.death : ''}` : (e.era || e.role || e.year || ''),
          s: (e.name + ' ' + (e.tags || []).join(' ') + ' ' + (e.summary || '')).toLowerCase(),
        })),
      })
    }
    for (const p of CFG.periods) {
      const evs = D.events.filter((ev: any) => ev.period === p.id)
      if (!evs.length) continue
      libSections.push({
        id: 'p-' + p.id, chip: 'chron', label: `编年 · ${p.name}`, color: p.color,
        items: evs.map((ev: any) => ({
          kind: 'event', ref: ev.id, title: ev.title || trunc(ev.label, 26),
          meta: `${ev.year}${ev.month ? '.' + ev.month : ''} · ${ev.src === 'hong' ? '洪' : ev.src === 'curated' ? '策' : '朱'}`,
          s: ((ev.title || '') + ' ' + ev.label + ' ' + (ev.blurb || '')).toLowerCase(),
        })),
      })
    }
  }

  function bindLibrary(): void {
    libChips.innerHTML = `<button class="pz-chip on" data-chip="all">全部</button>` +
      ['person', 'work', 'org', 'movement', 'policy', 'event', 'theory', 'other']
        .filter((t) => libSections.some((sec) => sec.chip === t))
        .map((t) => `<button class="pz-chip" data-chip="${t}"><i style="background:${CFG.types[t].color}"></i>${CFG.types[t].label}</button>`)
        .join('') +
      (libSections.some((s) => s.chip === 'chron')
        ? `<button class="pz-chip" data-chip="chron"><i style="background:var(--gold)"></i>编年</button>` : '')
    libChips.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('.pz-chip')
      if (!b) return
      libState.chip = (b as HTMLElement).dataset.chip!
      libChips.querySelectorAll('.pz-chip').forEach((x) => x.classList.toggle('on', x === b))
      renderLib()
    })
    libInput.addEventListener('input', () => { libState.q = libInput.value.trim().toLowerCase(); renderLib() })
    renderLib()
    // 拖拽上板（鼠标）；点击 = 加到视口中心（触屏兜底）
    libList.addEventListener('pointerdown', (e) => {
      const item = (e.target as Element).closest('.pz-li') as LibItemEl | null
      if (!item || e.button !== 0 || e.pointerType === 'touch') return
      startLibDrag(e, item)
    })
    libList.addEventListener('click', (e) => {
      const item = (e.target as Element).closest('.pz-li') as LibItemEl | null
      if (!item || item._dragged) { item && (item._dragged = false); return }
      const cw = centerWorld()
      const c = addCard(item.dataset.kind as PcCard['kind'], item.dataset.ref!, cw.x, cw.y)
      if (c) { focusCard(c); w.toast && w.toast('已加到白板中心', 1200) }
    })
  }

  function startLibDrag(e: PointerEvent, item: LibItemEl): void {
    const start = { x: e.clientX, y: e.clientY }
    let ghost: HTMLElement | null = null, over = false
    item.setPointerCapture(e.pointerId)
    const ensureGhost = () => {
      if (ghost) return
      ghost = document.createElement('div')
      ghost.className = 'pz-ghost'
      ghost.innerHTML = item.innerHTML
      document.body.appendChild(ghost)
    }
    const mv = (ev: PointerEvent) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return
        ensureGhost()
        item._dragged = true
      }
      ghost!.style.left = ev.clientX + 10 + 'px'
      ghost!.style.top = ev.clientY + 8 + 'px'
      // 指针已被 item 捕获,ev.target 恒为 item,须按坐标命中检测
      const hitEl = document.elementFromPoint(ev.clientX, ev.clientY)
      const nowOver = !!(hitEl && (hitEl === viewport || (hitEl.closest && hitEl.closest('#pz-viewport'))))
      if (nowOver !== over) { over = nowOver; viewport.classList.toggle('drop', over) }
    }
    const up = (ev: PointerEvent) => {
      item.removeEventListener('pointermove', mv)
      viewport.classList.remove('drop')
      if (ghost) {
        ghost.remove()
        if (over) {
          const wpt = screenToWorld(ev.clientX, ev.clientY)
          const c = addCard(item.dataset.kind as PcCard['kind'], item.dataset.ref!, wpt.x, wpt.y)
          if (c) focusCard(c)
        }
      } else {
        item._dragged = false   // 未拖动：交回 click 处理
      }
    }
    item.addEventListener('pointermove', mv)
    item.addEventListener('pointerup', up, { once: true })
    item.addEventListener('pointercancel', up, { once: true })
  }

  function renderLib(): void {
    libList.innerHTML = ''
    if (libState.q) {
      // 搜索态：全库平铺 top 60
      const hits: PcLibItem[] = []
      for (const sec of libSections) for (const it of sec.items) {
        if (it.s.includes(libState.q) || it.title.toLowerCase().includes(libState.q)) hits.push(it)
      }
      hits.sort((a, b) => a.title.length - b.title.length)
      const box = document.createElement('div')
      box.className = 'pz-lg open'
      box.innerHTML = `<div class="pz-lg-head open"><span>搜索结果</span><span class="count">${Math.min(hits.length, 60)} / ${hits.length}</span></div>`
      const body = document.createElement('div')
      body.className = 'pz-lg-body'
      body.append(...hits.slice(0, 60).map((it) => buildLibItem(it)))
      box.appendChild(body)
      libList.appendChild(box)
    } else {
      const secs = libSections.filter((s) => libState.chip === 'all' || s.chip === libState.chip)
      for (const sec of secs) {
        const box = document.createElement('div')
        box.className = 'pz-lg' + (libState.expanded.has(sec.id) ? ' open' : '')
        box.dataset.sec = sec.id
        box.innerHTML = `<div class="pz-lg-head"><i class="dot" style="background:${sec.color}"></i><span>${esc(sec.label)}</span><span class="count">${sec.items.length}</span><span class="arrow">▸</span></div>`
        const body = document.createElement('div')
        body.className = 'pz-lg-body'
        box.appendChild(body)
        box.querySelector('.pz-lg-head')!.addEventListener('click', () => {
          const opening = !box.classList.contains('open')
          box.classList.toggle('open', opening)
          if (opening) {
            libState.expanded.add(sec.id)
            if (!body.childElementCount) body.append(...sec.items.map((it) => buildLibItem(it)))
            staggerItems(body) // v2 动效新增：展开条目 stagger
          } else libState.expanded.delete(sec.id)
        })
        if (libState.expanded.has(sec.id)) {
          body.append(...sec.items.map((it) => buildLibItem(it)))
          staggerItems(body) // v2 动效新增：重建后已展开组条目 stagger
        }
        libList.appendChild(box)
      }
    }
    refreshLibMarks()
  }

  /* v2 动效新增：条目按序挂 --pz-i，puzzle.css 据此级联 animation-delay
     （--stagger-gap 步进、260ms 封顶——超长分组的第 15 条起同步显影，
     守住"stagger ≤24 条"性能红线；只动 transform/opacity） */
  function staggerItems(body: HTMLElement): void {
    for (let i = 0; i < body.children.length; i++)
      (body.children[i] as HTMLElement).style.setProperty('--pz-i', String(i))
  }

  function buildLibItem(it: PcLibItem): LibItemEl {
    const b = document.createElement('button') as LibItemEl
    b.className = 'pz-li'
    b.dataset.kind = it.kind
    b.dataset.ref = it.ref
    b.innerHTML = `<span class="pz-li-title" title="${esc(it.title)}">${esc(it.title)}</span><span class="pz-li-meta">${esc(it.meta)}</span><span class="pz-li-on" title="已在白板">●</span>`
    return b
  }

  function refreshLibMarks(): void {
    const onBoard = new Set(state.cards.filter((c) => c.kind !== 'note').map((c) => c.kind + ':' + c.ref))
    libList.querySelectorAll<LibItemEl>('.pz-li').forEach((li) =>
      li.classList.toggle('onboard', onBoard.has(li.dataset.kind + ':' + li.dataset.ref)))
  }

  /* ================= 画布交互（平移 / 缩放 / 捏合 / 空白） ================= */
  function bindBoard(): void {
    const pointers = new Map<number, { id: number; x: number; y: number }>()
    let panP: { id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null = null
    let pinch: { d0: number; k0: number; mx0: number; my0: number; vx0: number; vy0: number } | null = null

    viewport.addEventListener('wheel', (e) => {
      e.preventDefault()
      const r = viewport.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top)
    }, { passive: false })

    viewport.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY })
      if (pointers.size === 2) {
        panP = null
        const [p1, p2] = [...pointers.values()]
        pinch = {
          d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), k0: state.view.k,
          mx0: (p1.x + p2.x) / 2, my0: (p1.y + p2.y) / 2,
          vx0: state.view.x, vy0: state.view.y,
        }
        for (const p of pointers.values()) {
          try { viewport.setPointerCapture(p.id) } catch (_) { /* 忽略 */ }
        }
      } else if (pointers.size === 1) {
        panP = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y, moved: false }
        viewport.setPointerCapture(e.pointerId)
      }
    })

    viewport.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY })
      if (pinch && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()]
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y)
        const r = viewport.getBoundingClientRect()
        const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top
        const k = clamp((pinch.k0 * d) / (pinch.d0 || 1), PCFG.zoomMin, PCFG.zoomMax)
        const wx = (pinch.mx0 - pinch.vx0) / pinch.k0, wy = (pinch.my0 - pinch.vy0) / pinch.k0
        state.view.k = k
        state.view.x = mx - wx * k
        state.view.y = my - wy * k
        applyView()
        viewport.classList.add('dragging')
      } else if (panP && e.pointerId === panP.id) {
        const dx = e.clientX - panP.sx, dy = e.clientY - panP.sy
        if (Math.abs(dx) + Math.abs(dy) > 3) { panP.moved = true; viewport.classList.add('dragging') }
        state.view.x = panP.vx + dx
        state.view.y = panP.vy + dy
        applyView()
      }
    })

    const endPointer = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinch = null
      if (panP && e.pointerId === panP.id) {
        if (!panP.moved) deselect()       // 点击空白：取消选中
        panP = null
      }
      if (!pointers.size) viewport.classList.remove('dragging')
    }
    viewport.addEventListener('pointerup', endPointer)
    viewport.addEventListener('pointercancel', endPointer)

    // 双击空白：加便签
    viewport.addEventListener('dblclick', (e) => {
      if ((e.target as Element).closest('.pz-card, .pz-group, .pz-link, #pz-toolbar, #pz-stylebar, #pz-undo')) return
      const wpt = screenToWorld(e.clientX, e.clientY)
      const c = addCard('note', '', wpt.x, wpt.y)
      if (c) {
        renderCards()
        select('card', c.uid)
        const body = layerCards.querySelector(`[data-uid="${c.uid}"] .pz-c-note`) as HTMLElement | null
        if (body) body.focus()
      }
    })
  }

  /* ================= 工具栏 ================= */
  function buildToolbar(): void {
    toolbar.innerHTML = `
      <button data-t="zo" title="缩小（−）">−</button>
      <span id="pz-zoom" class="pz-zoom" title="点击回到 100%">100%</span>
      <button data-t="zi" title="放大（＋）">＋</button>
      <span class="pz-tb-sep"></span>
      <button data-t="fit" title="适应全部内容（0 / F）">适</button>
      <button data-t="note" title="加便签（N）">✎ 便签</button>
      <button data-t="group" title="加分组框（G）">▣ 分组</button>
      <span class="pz-tb-sep"></span>
      <button data-t="export" title="导出 JSON 备份">⇩ 导出</button>
      <button data-t="import" title="导入 JSON">⇧ 导入</button>
      <button data-t="clear" class="pz-tb-clear" title="清空白板">清空</button>
      <input type="file" id="pz-import-file" accept=".json,application/json" hidden>`
    zoomLabel = toolbar.querySelector('#pz-zoom') as HTMLElement | null
    importFile = toolbar.querySelector('#pz-import-file') as HTMLInputElement
    zoomLabel!.addEventListener('click', () => {
      const r = viewport.getBoundingClientRect()
      zoomAt(1 / state.view.k, r.width / 2, r.height / 2)
    })
    toolbar.addEventListener('pointerdown', (e) => e.stopPropagation())
    let clearArmed = false, clearTimer: number | null = null
    toolbar.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest('button')
      if (!btn) return
      const t = (btn as HTMLElement).dataset.t
      const r = viewport.getBoundingClientRect()
      if (t === 'zo') zoomAt(0.8, r.width / 2, r.height / 2)
      else if (t === 'zi') zoomAt(1.25, r.width / 2, r.height / 2)
      else if (t === 'fit') fit()
      else if (t === 'note') {
        const cw = centerWorld()
        const c = addCard('note', '', cw.x, cw.y)
        if (c) {
          renderCards(); select('card', c.uid)
          ;(layerCards.querySelector(`[data-uid="${c.uid}"] .pz-c-note`) as HTMLElement | null)?.focus()
        }
      }
      else if (t === 'group') { const cw = centerWorld(); addGroup(cw.x, cw.y) }
      else if (t === 'export') exportJSON()
      else if (t === 'import') importFile.click()
      else if (t === 'clear') {
        if (!clearArmed) {
          clearArmed = true
          btn.classList.add('arm')
          btn.textContent = '确认清空？'
          clearTimer = window.setTimeout(() => { clearArmed = false; btn.classList.remove('arm'); btn.textContent = '清空' }, 3000)
        } else {
          clearTimeout(clearTimer!)
          clearArmed = false
          btn.classList.remove('arm')
          btn.textContent = '清空'
          clearBoard()
        }
      }
    })
    importFile.addEventListener('change', () => {
      const f = importFile.files && importFile.files[0]
      importFile.value = ''
      if (!f) return
      f.text().then((t) => {
        const data = JSON.parse(t)
        if (!data || !Array.isArray(data.cards)) throw new Error('bad')
        applySerialized(data)
        fit()
        w.toast && w.toast('已导入拼图', 1600)
      }).catch(() => w.toast && w.toast('导入失败：文件格式不对', 2200))
    })

    // 撤销条
    undoEl.innerHTML = `<span class="pz-undo-msg"></span><button>撤销</button>`
    undoEl.addEventListener('pointerdown', (e) => e.stopPropagation())
    undoEl.querySelector('button')!.addEventListener('click', () => (undoEl as any)._restore && (undoEl as any)._restore())
  }

  /* ================= 持久化 ================= */
  const LS_KEY = 'wenxue-puzzle'
  let saveTimer: number | null = null
  function serialize() {
    return {
      v: 1, seq: state.seq,
      view: { k: state.view.k, x: state.view.x, y: state.view.y },
      cards: state.cards.map((c) => ({ ...c })),
      links: state.links.map((l) => ({ ...l })),
      groups: state.groups.map((g) => ({ ...g })),
    }
  }
  function markDirty(): void {
    clearTimeout(saveTimer!)
    saveTimer = window.setTimeout(flushSave, 600)
  }
  function flushSave(): void {
    clearTimeout(saveTimer!)
    saveTimer = null
    try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())) } catch (_) { /* file:// 等环境可能抛错 */ }
  }

  function applySerialized(data: any): void {
    state.cards = []
    let dropped = 0
    for (const c of data.cards || []) {
      if (!c || typeof c !== 'object') continue
      if (c.kind === 'entity' && !entityByName.has(c.ref)) { dropped++; continue }
      if (c.kind === 'event' && !eventById.has(c.ref)) { dropped++; continue }
      state.cards.push({
        uid: String(c.uid || 'u' + state.seq++), kind: c.kind, ref: c.ref || '',
        x: +c.x || 0, y: +c.y || 0,
        w: Math.max(PCFG.cardMin.w, +c.w || 200), h: Math.max(PCFG.cardMin.h, +c.h || 100),
        z: +c.z || state.seq++, text: String(c.text || ''),
      })
    }
    const uids = new Set(state.cards.map((c) => c.uid))
    state.links = (data.links || []).filter((l: any) => l && uids.has(l.a) && uids.has(l.b)).map((l: any) => ({
      uid: String(l.uid || 'u' + state.seq++), a: l.a, b: l.b,
      line: ['solid', 'dash', 'dot'].includes(l.line) ? l.line : 'solid',
      arrow: ['none', 'ab', 'ba', 'both'].includes(l.arrow) ? l.arrow : 'ab',
      color: LINK_VAR[l.color] ? l.color : 'ink',
      label: String(l.label || ''),
    }))
    state.groups = (data.groups || []).filter((g: any) => g && typeof g === 'object').map((g: any) => ({
      uid: String(g.uid || 'u' + state.seq++), title: String(g.title || ''),
      x: +g.x || 0, y: +g.y || 0, w: Math.max(140, +g.w || 300), h: Math.max(90, +g.h || 200),
    }))
    // seq 恢复为新 uid 不与旧 uid 冲突
    let maxNum = Math.floor(+data.seq) || 0
    for (const arr of [state.cards, state.links, state.groups])
      for (const it of arr) {
        const n = parseInt(String(it.uid).replace(/^u/, ''), 10)
        if (n > maxNum) maxNum = n
      }
    state.seq = maxNum + 1
    state.view = data.view && isFinite(data.view.k)
      ? { k: clamp(+data.view.k, PCFG.zoomMin, PCFG.zoomMax), x: +data.view.x || 0, y: +data.view.y || 0 }
      : state.view
    sel = null
    renderAll()
    markDirty()
    if (dropped) w.toast && w.toast(`已忽略 ${dropped} 张失效卡片（数据已更新）`, 2600)
  }

  const load = (() => {
    load.savedView = false
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const data = JSON.parse(raw)
      if (!data || !Array.isArray(data.cards)) return
      applySerialized(data)
      load.savedView = !!(data.view && isFinite(data.view.k))
    } catch (_) { /* 损坏数据视为无存档 */ }
  }) as { (): void; savedView: boolean }

  function exportJSON(): void {
    flushSave()
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const d = new Date()
    a.download = `拼图-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
    w.toast && w.toast('已导出 JSON', 1400)
  }

  w.addEventListener('pagehide', () => { if (inited && saveTimer) flushSave() })

  /* ================= 汇总渲染 ================= */
  function renderAll(): void {
    renderGroups()
    renderCards()
    renderEdges()
    refreshLibMarks()
    updateEmpty()
    if (sel && sel.type === 'link') positionStylebar(linkByUid(sel.uid))
  }
  function updateEmpty(): void {
    if (!emptyEl) return
    emptyEl.style.display = (state.cards.length || state.groups.length) ? 'none' : ''
  }

  /* ================= 视图注册 ================= */
  function onShow(params: any = {}): void {
    if (!inited) return
    // v2 keep-alive 适配：有定位动作（首次居中 / ?add= 对位）但容器尚未 active
    //（切场 150ms 节拍内 rect 为 0）时，待可见后再执行；旧版不存在此路径
    if ((pendingCenter || params.add || params.addev) && !viewport.getBoundingClientRect().width) {
      setTimeout(() => onShow(params), 190)
      return
    }
    if (pendingCenter) { // v2 适配：补做 init 延迟的首次居中（等价 init 原居中 + applyView）
      pendingCenter = false
      const r = viewport.getBoundingClientRect()
      state.view = { k: 1, x: r.width / 2, y: r.height / 2 }
      applyView()
      markDirty()
    }
    if (params.add || params.addev) {
      const kind = params.add ? 'entity' : 'event'
      const ref = params.add || params.addev
      let c: PcCard | null | undefined = state.cards.find((x) => x.kind === kind && x.ref === ref)
      if (!c) {
        const cw = centerWorld()
        c = addCard(kind, ref, cw.x, cw.y)
        if (!c) { w.toast && w.toast('未找到该条目', 1800); return }
      }
      focusCard(c)
    }
  }

  w.Views = w.Views || {}
  w.Views.puzzle = { init, onShow }

  /* 键盘 API（keyboard.js 调用；事件一律经 keyboard.js 分发） */
  w.PUZZLE = {
    panBy(dx: number, dy: number) { state.view.x += dx; state.view.y += dy; applyView(); markDirty() },
    zoomBy(f: number) {
      const r = viewport.getBoundingClientRect()
      zoomAt(f, r.width / 2, r.height / 2)
    },
    zoom: () => state.view.k,
    fit,
    del: deleteSelected,
    deselect() { return deselect() },
    cancelDrag() {
      if (activeLinkDrag && activeLinkDrag.cancel) return activeLinkDrag.cancel()
      return false
    },
    esc() {
      if (w.PUZZLE.cancelDrag()) return true
      return deselect()
    },
    addNote() {
      const cw = centerWorld()
      const c = addCard('note', '', cw.x, cw.y)
      if (c) {
        renderCards(); select('card', c.uid)
        ;(layerCards.querySelector(`[data-uid="${c.uid}"] .pz-c-note`) as HTMLElement | null)?.focus()
      }
    },
    addGroup() { const cw = centerWorld(); addGroup(cw.x, cw.y) },
    clear: clearBoard,
  }

  /* ================== js/puzzle.js 逐字搬运结束 ================== */
  return w.Views.puzzle as PuzzleEngineHandle
}
