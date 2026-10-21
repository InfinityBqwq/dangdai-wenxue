/**
 * WikiTree.tsx — 知识库目录树（js/wiki.js buildPeriodNav/buildTree 的 React 重写）
 * ------------------------------------------------------------
 * 结构与类名对齐旧版：.wt-group/.wt-ghead/.wt-items/.wt-inner/.wt-item、
 * 分期导航 .wt-scheme/.wt-period/.wt-phead/.wt-chap/.wt-sum/.wt-muted。
 * 动效（计划书 §2）：分组/期内折叠 = motion 高度弹簧（旧 grid-rows 过渡升级），
 * 展开时条目 stagger 显影（≤24 条封顶，性能红线）；减动效直跳终态。
 */
import type { ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Transition } from 'motion/react'
import { EASE_APPEAR, T_INSTANT } from '@/styles/motionTokens'
import type { TreeModel, TreeScheme, TreeChapter } from './engine'
import type { Sel } from './engine'

/** 高度弹簧：展开/收起带回弹（旧 --ease-brush 过渡的 motion 升级版） */
const HEIGHT_SPRING: Transition = { type: 'spring', stiffness: 350, damping: 34 }
const FADE: Transition = { duration: 0.22, ease: 'easeOut' }

/** 条目 stagger：≤24 条封顶（性能红线），仅展开瞬间重放 */
function staggerDelay(i: number): number {
  return Math.min(i, 24) * 0.016
}

/** 分组头（gheadHtml 原样：色点图例 + 标签 + 计数 + 折叠箭头） */
function GHead({
  label, color, count, title,
}: { label: string; color: string; count: string | number; title?: string }) {
  return (
    <>
      <span title={title || label}>
        <span
          className="dot"
          style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 7, opacity: 0.8 }}
        />
        {label}
      </span>
      <span>
        <span className="count">{count}</span> <span className="arrow">▶</span>
      </span>
    </>
  )
}

/** 折叠容器：.wt-ghead + motion 高度弹簧 .wt-items（与旧 .wt-group 同构） */
function Collapsible({
  className, open, onToggle, head, children,
}: {
  className?: string
  open: boolean
  onToggle: () => void
  head: ReactNode
  children: ReactNode
}) {
  const reduced = !!useReducedMotion()
  return (
    <div className={('wt-group ' + (className || '')).trim() + (open ? ' open' : '')}>
      <div className="wt-ghead" onClick={onToggle}>{head}</div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="wt-items"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduced ? T_INSTANT : ({ height: HEIGHT_SPRING, opacity: FADE } as Transition)}
          >
            <div className="wt-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** 条目按钮：展开瞬间按序 stagger 显影（旧 noteBtn 的 motion 化） */
function TreeItemBtn({
  i, name, current, reduced, onOpen,
}: { i: number; name: string; current: boolean; reduced: boolean; onOpen: (name: string) => void }) {
  return (
    <motion.button
      className={'wt-item' + (current ? ' current' : '')}
      onClick={() => onOpen(name)}
      initial={reduced ? false : { opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: staggerDelay(i), duration: 0.25, ease: EASE_APPEAR }}
    >
      {name}
    </motion.button>
  )
}

/** 期（wt-period：phead + 章节行/总结行/笔记行，openUp 的折叠层级） */
function PeriodBlock({
  pzId, period, open, onToggle, sel, reduced, onOpenEntry, onOpenChapter,
}: {
  pzId: string
  period: TreeScheme['periods'][number]
  open: boolean
  onToggle: () => void
  sel: Sel | null
  reduced: boolean
  onOpenEntry: (name: string) => void
  onOpenChapter: (ch: TreeChapter, pzId: string) => void
}) {
  const chapN = period.chapters.length
  const noteN = period.notes.length
  return (
    <div className={'wt-period' + (open ? ' open' : '')}>
      <div className="wt-phead" onClick={onToggle}>
        <span>{period.name}</span>
        <span>
          <span className="count">{chapN}章{noteN ? ' · ' + noteN + '篇' : ''}</span> <span className="arrow">▶</span>
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="wt-items"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={reduced ? T_INSTANT : ({ height: HEIGHT_SPRING, opacity: FADE } as Transition)}
          >
            <div className="wt-inner">
              {period.chapters.map((c, i) => (
                <span key={c.path} className="wt-chap-row" style={{ display: 'block' }}>
                  <motion.button
                    className={'wt-chap' + (sel?.kind === 'chapter' && sel.path === c.path ? ' current' : '')}
                    title="打开原文(页内阅读)"
                    onClick={() => onOpenChapter(c, pzId)}
                    initial={reduced ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: staggerDelay(i), duration: 0.25, ease: EASE_APPEAR }}
                  >
                    {c.title}
                  </motion.button>
                  {c.sum ? (
                    <motion.button
                      className="wt-sum"
                      title={c.sum}
                      onClick={() => onOpenChapter(c, pzId)}
                      initial={reduced ? false : { opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: staggerDelay(i) + 0.02, duration: 0.25, ease: EASE_APPEAR }}
                    >
                      AI 总结
                    </motion.button>
                  ) : null}
                </span>
              ))}
              {period.notes.map((n, i) => (
                <TreeItemBtn
                  key={n}
                  i={i}
                  name={n}
                  current={sel?.kind === 'entry' && sel.name === n}
                  reduced={reduced}
                  onOpen={onOpenEntry}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function WikiTree({
  tree, openKeys, sel, onToggle, onOpenEntry, onOpenChapter,
}: {
  tree: TreeModel
  openKeys: Set<string>
  sel: Sel | null
  onToggle: (key: string) => void
  onOpenEntry: (name: string) => void
  onOpenChapter: (ch: TreeChapter, pzId: string) => void
}) {
  const reduced = !!useReducedMotion()
  return (
    <div id="wiki-tree">
      {/* 分期导航:综述（旧 buildPeriodNav overview 段原样） */}
      {tree.overview.length > 0 && (
        <Collapsible
          open={openKeys.has('ov')}
          onToggle={() => onToggle('ov')}
          head={<GHead label="综述 · 长卷 · 目录" color="#8a8272" count={tree.overview.length} />}
        >
          {tree.overview.map((n, i) => (
            <TreeItemBtn
              key={n}
              i={i}
              name={n}
              current={sel?.kind === 'entry' && sel.name === n}
              reduced={reduced}
              onOpen={onOpenEntry}
            />
          ))}
        </Collapsible>
      )}

      {/* 教材分期方案块（随顶栏口径全局联动；hidden 期 → wt-muted） */}
      {tree.schemes.map((sc) => (
        <Collapsible
          key={sc.id}
          className="wt-scheme"
          open={openKeys.has('sc:' + sc.id)}
          onToggle={() => onToggle('sc:' + sc.id)}
          head={
            <GHead label={sc.label} color={sc.color} count={sc.countLabel} title={`${sc.label} · ${sc.book}`} />
          }
        >
          {sc.periods.map((p) =>
            p.hidden ? (
              <div key={p.id} className="wt-muted">
                {p.name} · 暂隐 {p.notes.length} 篇
              </div>
            ) : (
              <PeriodBlock
                key={p.id}
                pzId={sc.id}
                period={p}
                open={openKeys.has('pg:' + sc.id + ':' + p.id)}
                onToggle={() => onToggle('pg:' + sc.id + ':' + p.id)}
                sel={sel}
                reduced={reduced}
                onOpenEntry={onOpenEntry}
                onOpenChapter={onOpenChapter}
              />
            ),
          )}
        </Collapsible>
      ))}

      {/* 7 类型分组折叠（buildTree 分组段原样，空组不渲染） */}
      {tree.groups.map((g) => (
        <Collapsible
          key={g.key}
          open={openKeys.has('g:' + g.key)}
          onToggle={() => onToggle('g:' + g.key)}
          head={<GHead label={g.label} color={g.color} count={g.items.length} />}
        >
          {g.items.map((name, i) => (
            <TreeItemBtn
              key={name}
              i={i}
              name={name}
              current={sel?.kind === 'entry' && sel.name === name}
              reduced={reduced}
              onOpen={onOpenEntry}
            />
          ))}
        </Collapsible>
      ))}
    </div>
  )
}
