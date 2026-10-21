/**
 * WikiArticle.tsx — 文章阅读区（js/wiki.js show/showChapter 的 React 重写）+ 动效组件
 * ------------------------------------------------------------
 * 动效（计划书 §2）：
 * - 文章切换 AnimatePresence 交叉过渡（popLayout）：旧文淡出，新文标题逐字
 *   显影 + 首屏段落按序 stagger；减动效直跳终态。
 * - 正文顶层块 useInView 一次性显影（首屏前 9 块带序错峰，滚动进入即时显影）。
 * - 顶部阅读进度墨线：motion useScroll 绑定滚动容器，scaleX 随进度（减动效
 *   去弹簧直接绑定）。
 * - 本页目录（文章 h2/h3 锚点）：IntersectionObserver scrollspy 高亮 +
 *   layoutId 墨条滑动；点击平滑滚动（减动效改 auto）。
 * HTML 注入点（badges/口径对照/关联入口/AI 总结）与旧版 innerHTML 等价，
 * 数据来自运行时全局，组件不引入任何数据文件内容。
 */
import { forwardRef, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, Ref, RefObject } from 'react'
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react'
import type { ArticleModel } from './engine'

/** 标题逐字显影：与 Drawer 同拍（24 字封顶，性能红线） */
const CHAR_CAP = 24
const CHAR_GAP = 0.026

/** 正文块显影 */
function RevealBlock({ html, i, reduced }: { html: string; i: number; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '0px 0px -8% 0px' })
  if (reduced) {
    return <div ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
  }
  // 首屏前 9 块（≈一屏）按序错峰；滚动后进入的块即时显影（不背延迟）
  const delay = i < 9 ? i * 0.04 : 0
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: inView ? 1 : 0, y: inView ? 0 : 14 }}
      transition={{ delay: inView ? delay : 0, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** 顶部阅读进度墨线（useScroll 绑定 #wiki-main 滚动容器）。
 * 两个守卫：容器无溢出时不渲染（motion 无溢出时 progress 恒 1）；
 * progress≈0 时透明（transform 'none' 恒等态会让 scaleX 形同未缩放而全宽显形）。 */
export function ProgressInk({ containerRef }: { containerRef: RefObject<HTMLDivElement> }) {
  const reduced = !!useReducedMotion()
  const [scrollable, setScrollable] = useState(false)
  const { scrollYProgress } = useScroll({ container: containerRef })
  const smooth = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 })
  const opacity = useTransform(scrollYProgress, [0, 0.003], [0, 1])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 2)
    check()
    // 容器盒与内容列都观察：正文惰性补载后 scrollHeight 变化不触发容器自身 resize
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const content = document.getElementById('wiki-content')
    if (content) ro.observe(content)
    return () => ro.disconnect()
  }, [containerRef])

  if (!scrollable) return null
  return (
    <div className="wiki-progress-wrap" aria-hidden="true">
      <motion.div
        className="wiki-progress"
        style={{ scaleX: reduced ? scrollYProgress : smooth, opacity }}
      />
    </div>
  )
}

/** 本页目录：scrollspy 高亮 + layoutId 墨条（仅宽屏显示，见 wiki.css） */
export function TocRail({
  toc, containerRef,
}: { toc: ArticleModel['toc']; containerRef: RefObject<HTMLDivElement> }) {
  const reduced = !!useReducedMotion()
  const [cur, setCur] = useState<string>(toc[0]?.id || '')
  useEffect(() => {
    const root = containerRef.current
    if (!root) return
    const visible = new Set<string>()
    const io = new IntersectionObserver(
      (ents) => {
        for (const en of ents) {
          const id = (en.target as HTMLElement).id
          if (en.isIntersecting) visible.add(id)
          else visible.delete(id)
        }
        const first = toc.find((t) => visible.has(t.id))
        if (first) setCur(first.id)
      },
      { root, rootMargin: '-72px 0px -66% 0px', threshold: 0 },
    )
    for (const t of toc) {
      const el = document.getElementById(t.id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [toc, containerRef])

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <aside className="wiki-toc-rail" aria-label="本页目录">
      <div className="wiki-toc-head">§ 本页目录</div>
      {toc.map((t) => (
        <button
          key={t.id}
          className={'wiki-toc-item lvl-' + t.level + (cur === t.id ? ' current' : '')}
          title={t.text}
          onClick={() => jump(t.id)}
        >
          {cur === t.id && (
            <motion.span
              layoutId="wiki-toc-ink"
              className="wiki-toc-ink"
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span className="wiki-toc-txt">{t.text}</span>
        </button>
      ))}
    </aside>
  )
}

/**
 * 文章主体（AnimatePresence 的子元素）：
 * 旧文淡出退场（popLayout 脱离文档流，不挤压新文）；新文标题逐字 + 首屏段落错峰。
 * forwardRef：popLayout 退场测量需要把 ref 落到 motion.article 上。
 */
export const WikiArticle = forwardRef(function WikiArticle(
  {
    model, reduced, onLinksClick,
  }: {
    model: ArticleModel
    reduced: boolean
    onLinksClick: (e: ReactMouseEvent<HTMLDivElement>) => void
  },
  ref: Ref<HTMLElement>,
) {
  return (
    <motion.article
      ref={ref}
      className="wiki-doc"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={
        reduced
          ? { opacity: 0, pointerEvents: 'none', transition: { duration: 0.01 } }
          : { opacity: 0, pointerEvents: 'none', transition: { duration: 0.18, ease: 'easeOut' } }
      }
      transition={{ duration: 0.2 }}
    >
      <h1>
        {[...model.title].map((ch, i) =>
          reduced ? (
            <span key={i}>{ch}</span>
          ) : (
            <motion.span
              key={i}
              className="wiki-char"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, CHAR_CAP) * CHAR_GAP, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {ch}
            </motion.span>
          ),
        )}
      </h1>
      <div className="fm-badges" dangerouslySetInnerHTML={{ __html: model.badgesHtml }} />
      {model.sub ? <p className="wiki-sub">{model.sub}</p> : null}
      {model.sumHtml ? (
        <details className="chap-sum" open>
          <summary>AI 总结 · 本章导读</summary>
          <div className="chap-sum-body" dangerouslySetInnerHTML={{ __html: model.sumHtml }} />
        </details>
      ) : null}
      <div className="wiki-article">
        {model.blocks.map((b, i) => (
          <RevealBlock key={i} html={b.html} i={i} reduced={reduced} />
        ))}
      </div>
      {model.cmpHtml ? <div dangerouslySetInnerHTML={{ __html: model.cmpHtml }} /> : null}
      <div className="wiki-links-bar" id="wiki-actions" onClick={onLinksClick}
        dangerouslySetInnerHTML={{ __html: model.linksHtml }} />
    </motion.article>
  )
})
