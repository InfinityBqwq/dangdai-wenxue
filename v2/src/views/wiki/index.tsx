/**
 * index.tsx — WIKI 岛（五视图中唯一完全 React 重写的视图）
 * ------------------------------------------------------------
 * 骨架与旧 index.html #view-wiki 一致（id/class 原样保留）：
 *   #wiki-toc-btn（移动端目录钮）· #wiki-sidebar（ws-head + #wiki-tree）·
 *   #wiki-main（阅读进度墨线 + #wiki-content + 本页目录 rail）。
 * 数据逻辑在 engine.ts（js/wiki.js 原样移植）；数据一律运行时经
 * window.DATA / window.DATA_BODY / api.ensureBodyData 访问。
 * 岛接线（外壳 keep-alive，挂载一次不随切视图卸载）：
 *   useViewParams() → onShow(params)（深链 #/wiki?name=… 自动打开）；
 *   useAppContext() 的 source 变化 → onSourceChange()（重建树 + 重放选中）。
 * 对外注册 window.WIKI / window.wikiShow（旧版同名全局）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { switchView, ensureBodyData } from '@/shell/api'
import { useAppContext, useViewParams } from '@/shell/api'
import { T_INSTANT } from '@/styles/motionTokens'
import {
  buildByName,
  buildChapterDoc,
  buildEntryDoc,
  buildTreeModel,
  ensureChapterLoaded,
  ensureEntryBody,
  libraryStats,
  openKeysFor,
} from './engine'
import type { ArticleModel, Sel, TreeChapter } from './engine'
import WikiTree from './WikiTree'
import { ProgressInk, TocRail, WikiArticle } from './WikiArticle'
import './wiki.css'

export default function WikiView() {
  const { source } = useAppContext()
  const params = useViewParams()
  const reduced = !!useReducedMotion()
  const mainRef = useRef<HTMLDivElement>(null)

  const [inited, setInited] = useState(false)
  const [sel, setSel] = useState<Sel | null>(null)
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set())
  const [bodyTick, setBodyTick] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  /* 基础索引与树模型（buildTree / buildPeriodNav 移植；口径切换重建树） */
  const byName = useMemo(() => buildByName(), [])
  const tree = useMemo(() => buildTreeModel(source), [source])
  const stats = useMemo(() => libraryStats(), [])

  const selRef = useRef<Sel | null>(null)
  selRef.current = sel

  /* ---- 动作（旧 show / showChapter / 折叠 toggle 的入口） ---- */
  const openEntry = (name: string): void => {
    if (!byName.get(name)) return
    setSel({ kind: 'entry', name })
    setSidebarOpen(false) // 移动端:选中条目后收起滑出目录
  }
  const openChapter = (ch: TreeChapter, pzId: string): void => {
    setSel({ kind: 'chapter', path: ch.path, pzId })
    setSidebarOpen(false)
  }
  const toggleKey = (key: string): void => {
    setOpenKeys((prev) => {
      const n = new Set(prev)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  }
  /* 页底「关联入口」条（旧 #wiki-actions 委托原样：跨视图切换 / Obsidian） */
  const onLinksClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const btn = (e.target as HTMLElement).closest('button')
    if (!btn) return
    const act = btn.dataset.act
    const curName = sel?.kind === 'entry' ? sel.name : ''
    if (act === 'timeline') switchView('timeline', { focus: +btn.dataset.year! })
    else if (act === 'graph') switchView('graph', { node: btn.dataset.name || curName })
    else if (act === 'locate') switchView('map', { person: btn.dataset.name || curName })
    else if (act === 'puzzle') switchView('puzzle', { add: btn.dataset.add || curName })
    else if (act === 'obsidian') window.open(btn.dataset.uri, '_blank')
  }
  const openEntryRef = useRef(openEntry)
  openEntryRef.current = openEntry

  /* ---- 文档模型：选中 + 惰性包就绪信号（bodyTick）驱动重算 ---- */
  const doc = useMemo<ArticleModel | null>(() => {
    if (!sel) return null
    void bodyTick
    if (sel.kind === 'entry') return buildEntryDoc(byName, sel.name)
    return buildChapterDoc(sel.path, sel.pzId)
  }, [sel, byName, bodyTick])

  /* ---- init（旧 Views.wiki.init）：注册全局 API + 首屏导读切换 ---- */
  useEffect(() => {
    setInited(true)
    const w = window as any
    w.WIKI = {
      show: (name: string) => openEntryRef.current(name),
      current: () => selRef.current,
    }
    w.wikiShow = w.WIKI.show
    return () => {
      delete w.WIKI
      delete w.wikiShow
    }
  }, [])

  /* ---- onSourceChange（旧版原样语义）：树随口径重建，重放当前选中并展开其分组 ---- */
  useEffect(() => {
    setOpenKeys(openKeysFor(tree, selRef.current))
  }, [tree])

  /* ---- onShow：深链 #/wiki?name=… 自动打开对应文章（旧 onShow 原样） ---- */
  useEffect(() => {
    if (params && params.name) openEntryRef.current(String(params.name))
  }, [params])

  /* ---- 正文/章节原文惰性补载（show/showChapter 补载段原样语义） ----
     「包就绪 → 重渲染」统一由 bodyTick 驱动，两条路都必须落 setState：
     - 异步路：包未载，ensureBodyData resolve 后 bump（doc 的 deps 含 bodyTick）；
     - 同步路：包已载但本轮 render 期 doc 仍是占位（doc.pending）——ensureEntryBody
       的回填发生在 effect 期（commit 之后），或包恰在 render→effect 的 microtask
       窗口才就绪，此处不 bump 就没有任何状态变化，页面停在「正文加载中」，只能
       靠切页改变 sel 才恢复（即线上反馈的 bug）。
     bump 后 doc 重算、pending 翻 false。deps 刻意不含 bodyTick/doc（闭包里的 doc
     即本轮 commit 的模型）：不含 bodyTick 则 bump 不会自触；不含 doc 则「包里确实
     无此条记录」的终态占位（pending 恒 true）不会因 doc 新对象反复重跑成死循环。 */
  useEffect(() => {
    if (!sel || !doc?.pending) return
    const ready =
      sel.kind === 'entry'
        ? (() => {
            const item = byName.get(sel.name)
            return item ? ensureEntryBody(item) : true
          })()
        : ensureChapterLoaded()
    if (ready) {
      setBodyTick((t) => t + 1) // 数据已就绪而模型还是占位：补一次重算
      return
    }
    let alive = true
    ensureBodyData()
      .then(() => {
        if (alive) setBodyTick((t) => t + 1)
      })
      .catch(() => {
        /* 保持加载中提示 */
      })
    return () => {
      alive = false
    }
  }, [sel, byName])

  /* ---- 切换文章后阅读位置归零（旧 show/showChapter 的 scrollTop = 0） ---- */
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [sel])

  return (
    <>
      <button
        id="wiki-toc-btn"
        title="打开目录"
        onClick={(e) => {
          e.stopPropagation()
          setSidebarOpen((o) => !o)
        }}
      >
        ☰ 目录
      </button>
      <aside id="wiki-sidebar" className={sidebarOpen ? 'open' : undefined}>
        <div className="ws-head">知识库目录</div>
        <WikiTree
          tree={tree}
          openKeys={openKeys}
          sel={sel}
          onToggle={toggleKey}
          onOpenEntry={openEntry}
          onOpenChapter={openChapter}
        />
      </aside>
      <div id="wiki-main" ref={mainRef} onClick={() => setSidebarOpen(false)}>
        <ProgressInk containerRef={mainRef} />
        <div id="wiki-content">
          {!inited ? (
            /* 静态骨架占位（旧 index.html 原样；init 后被首屏导读替换，与旧时序一致） */
            <div id="wiki-empty">← 从左侧选择一篇卡片开始阅读</div>
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {doc ? (
                <WikiArticle key={doc.key} model={doc} reduced={reduced} onLinksClick={onLinksClick} />
              ) : (
                <motion.div
                  key="intro"
                  className="wiki-doc"
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={
                    reduced
                      ? { opacity: 0, transition: T_INSTANT }
                      : { opacity: 0, pointerEvents: 'none', transition: { duration: 0.18, ease: 'easeOut' } }
                  }
                  transition={{ duration: 0.2 }}
                >
                  {/* 首屏导读（旧 init() 文案原样） */}
                  <h1 style={{ border: 'none', fontSize: 22, color: 'var(--ink-3)' }}>
                    选择左侧任意卡片开始阅读
                  </h1>
                  <p style={{ color: 'var(--ink-3)' }}>
                    全库共 {stats.entities} 张知识卡片 + {stats.notes} 篇分期笔记与综述。分期导航随顶栏口径全局联动:朱栋霖 / 洪子诚模式显示对应一版的原文章节与总结笔记,「比对」并置两版;章节原文可在页内阅读,每章附 AI 总结导读。
                    <br />
                    词条卡片正文中恒并排两书说法。
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
        {doc && doc.toc.length >= 3 && <TocRail key={doc.key} toc={doc.toc} containerRef={mainRef} />}
      </div>
    </>
  )
}
