/**
 * CommandPalette.tsx — Ctrl+K 全局搜索命令面板
 * ------------------------------------------------------------
 * 移植 app.js runSearch 打分与结果渲染（见 search.ts）；交互升级：
 * 0.96→1 弹簧入场 + 背景模糊 scrim；结果 18ms/条 stagger（仅结果集变化时重放）；
 * ↑↓ 键盘导航 + layoutId 高亮滑条 + Enter 直达（entity→抽屉 / note→Wiki / event→抽屉+时间轴聚焦）。
 */
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { paletteStore } from './uiStore'
import { useStore } from './uiStore'
import { runSearch } from './search'
import type { SearchItem } from './search'
import { closePalette, openDrawerEntity, openDrawerEvent, openWikiPage, switchView } from './api'
import { esc } from './util'
import { eventById } from './indexes'
import { EASE_APPEAR } from '@/styles/motionTokens'

const PANEL_SPRING = { type: 'spring', stiffness: 420, damping: 32 } as const
const CURSOR_SPRING = { type: 'spring', stiffness: 520, damping: 42 } as const

/** 查询词高亮（app.js hl 原样移植：先转义再替换，正则元字符转义） */
function hl(t: string, q: string): string {
  return esc(t).replace(
    new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
    '<mark>$1</mark>',
  )
}

export default function CommandPalette() {
  const pal = useStore(paletteStore)
  const open = pal.open
  const [text, setText] = useState('')
  const [items, setItems] = useState<SearchItem[]>([])
  const [active, setActive] = useState(0)
  const [setKey, setSetKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const sigRef = useRef('')

  // 打开：回填预填词（抽屉「搜索相关卡片」直达），聚焦全选
  useEffect(() => {
    if (!open) return
    setText(pal.q)
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 30)
  }, [open, pal.q])

  // 输入 → 打分搜索
  useEffect(() => {
    if (!open) return
    setItems(text.trim() ? runSearch(text) : [])
    setActive(0)
  }, [text, open])

  // 结果集签名：只有集合变化才 bump key → stagger 仅在结果集变化时重放
  const sig = items.map((i) => i.kind + ':' + i.name).join('|')
  useEffect(() => {
    if (sig !== sigRef.current) {
      sigRef.current = sig
      setSetKey((k) => k + 1)
    }
  }, [sig])

  // 高亮项保持可见
  useEffect(() => {
    const el = listRef.current?.children[active] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, setKey])

  const activate = (it: SearchItem | undefined) => {
    if (!it) return
    closePalette()
    if (it.kind === 'entity') {
      openDrawerEntity(it.name) // 抽屉直接看，不打断当前视图
    } else if (it.kind === 'note') {
      openWikiPage(it.name)
    } else if (it.kind === 'event') {
      const ev = eventById().get(it.name)
      if (ev) {
        openDrawerEvent(ev)
        switchView('timeline', { focus: ev.year })
      }
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(items.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      activate(items[active])
    }
  }

  const q = text.trim()

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="cmdk"
          className="cmdk"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closePalette()
          }}
        >
          <motion.div
            className="cmdk-panel"
            role="dialog"
            aria-label="全局搜索"
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6, transition: { duration: 0.14 } }}
            transition={PANEL_SPRING}
          >
            <div className="cmdk-inputrow">
              <span className="cmdk-glyph">⌕</span>
              <input
                id="cmdk-input"
                ref={inputRef}
                value={text}
                placeholder="搜索人物 / 事件 / 思潮…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <span className="kbd">Esc</span>
            </div>

            {q && items.length > 0 && (
              <motion.ul
                key={setKey}
                ref={listRef}
                className="pal-list"
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.018 } } }}
              >
                {items.map((it, i) => {
                  const title = it.title || it.name
                  const snippet = it.text.length > 90 ? it.text.slice(0, 90) + '…' : it.text
                  return (
                    <motion.li
                      key={it.kind + ':' + it.name}
                      className={'pal-item' + (i === active ? ' current' : '')}
                      variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
                      transition={{ duration: 0.22, ease: EASE_APPEAR }}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => activate(it)}
                    >
                      {i === active && (
                        <motion.div
                          layoutId="pal-cursor"
                          className="pal-cursor"
                          transition={CURSOR_SPRING}
                        />
                      )}
                      <div className="sp-title" dangerouslySetInnerHTML={{ __html: hl(title, q) }} />
                      <div className="sp-meta">{it.meta}</div>
                      {it.kind !== 'entity' && (
                        <div
                          className="sp-snippet"
                          dangerouslySetInnerHTML={{ __html: hl(snippet, q) }}
                        />
                      )}
                    </motion.li>
                  )
                })}
              </motion.ul>
            )}

            {q && items.length === 0 && (
              <div className="sp-empty">没有找到「{q}」相关的条目</div>
            )}
            {!q && (
              <div className="sp-empty">
                输入关键词搜索人物 / 事件 / 思潮 / 分期笔记
                <br />
                <span className="pal-hint">↑↓ 选择 · Enter 打开 · Esc 关闭</span>
              </div>
            )}

            <div className="cmdk-foot">
              <span>词条 → 详情抽屉</span>
              <span>事件 → 抽屉 + 时间轴聚焦</span>
              <span>笔记 → Wiki 阅读</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
