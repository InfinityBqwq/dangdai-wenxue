/**
 * Drawer.tsx — 详情抽屉
 * ------------------------------------------------------------
 * 弹簧滑入（物理回弹）+ 纸色 scrim 点击关闭 + drag=x 甩关（拖把手区）+
 * 标题逐字显影 + 动作钮 stagger；内容换装 = 按 model.key 重挂载三段错峰。
 * 渲染逻辑（口径对照块/来源徽章/另一史对照/词条与事件动作）见 drawerContent.ts。
 */
import { useMemo } from 'react'
import { AnimatePresence, motion, useDragControls } from 'motion/react'
import { drawerStore } from './uiStore'
import { useStore } from './uiStore'
import { buildEntityModel, buildEventModel, buildNoteModel } from './drawerContent'
import type { DrawerModel } from './drawerContent'
import { closeDrawer, openPalette, switchView } from './api'
import { EASE_APPEAR } from '@/styles/motionTokens'

const SLIDE_SPRING = { type: 'spring', stiffness: 320, damping: 30 } as const
const EXIT_SPRING = { type: 'spring', stiffness: 420, damping: 38 } as const

/** 标题逐字显影：延迟按字递增，24 字封顶（stagger 性能红线） */
const CHAR_CAP = 24
const CHAR_GAP = 0.026

function DrawerActions({
  model,
  onAct,
}: {
  model: DrawerModel
  onAct: (e: React.MouseEvent<HTMLDivElement>) => void
}) {
  return (
    <motion.div
      className="drawer-actions"
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: 0.045, delayChildren: 0.08 } } }}
      onClick={onAct}
    >
      {model.actions.map((a, i) => (
        <motion.button
          key={i}
          data-act={a.act}
          {...Object.fromEntries(Object.entries(a.attrs).map(([k, v]) => [`data-${k}`, v]))}
          variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
          transition={{ duration: 0.28, ease: EASE_APPEAR }}
        >
          {a.label}
        </motion.button>
      ))}
    </motion.div>
  )
}

export default function Drawer() {
  const item = useStore(drawerStore)
  const dragControls = useDragControls()
  const model = useMemo<DrawerModel | null>(() => {
    if (!item) return null
    if (item.kind === 'entity') return buildEntityModel(item.name)
    if (item.kind === 'event') return buildEventModel(item.ev)
    return buildNoteModel(item.name)
  }, [item])

  /** 抽屉动作按钮（app.js drawer-actions 点击处理器原样移植） */
  const onAct = (e: React.MouseEvent<HTMLDivElement>) => {
    const btn = (e.target as HTMLElement).closest('button')
    if (!btn) return
    const act = btn.dataset.act || ''
    const name = btn.dataset.name || ''
    if (act === 'wiki') {
      closeDrawer()
      switchView('wiki', { name })
    } else if (act === 'timeline-year') {
      // 词条 → 时间轴:聚焦锚点年并自动展开中心事件
      closeDrawer()
      switchView('timeline', { focus: +btn.dataset.year! })
    } else if (act === 'search-name') {
      // 打开命令面板并预填词条名（延迟到 click 冒泡结束，避免被外点关闭顶掉）
      closeDrawer()
      window.setTimeout(() => openPalette(name), 0)
    } else if (act === 'graph') {
      switchView('graph', { node: name })
    } else if (act === 'locate') {
      switchView('map', { person: name })
    } else if (act === 'puzzle') {
      closeDrawer()
      // 上拼图白板:词条按名,编年事件按 id
      switchView('puzzle', btn.dataset.add ? { add: btn.dataset.add } : { addev: btn.dataset.addev || '' })
    } else if (act === 'obsidian') {
      window.open(btn.dataset.uri, '_blank')
    }
  }

  return (
    <AnimatePresence>
      {item && model && (
        <>
          <motion.div
            key="scrim"
            className="drawer-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={closeDrawer}
          />
          <motion.aside
            key="panel"
            id="drawer"
            className="open"
            role="dialog"
            aria-label={model.title}
            initial={{ x: '112%' }}
            animate={{ x: 0 }}
            exit={{ x: '114%', transition: EXIT_SPRING }}
            transition={SLIDE_SPRING}
            drag="x"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ right: 0.85, left: 0 }}
            onDragEnd={(_e, info) => {
              if (info.offset.x > 110 || info.velocity.x > 520) closeDrawer()
            }}
          >
            <button className="drawer-close" title="关闭" onClick={closeDrawer}>
              ✕
            </button>
            <div
              key={model.key + ':head'}
              className="drawer-head"
              onPointerDown={(e) => dragControls.start(e)}
              style={{ touchAction: 'pan-y' }}
            >
              <div
                className="drawer-kicker"
                dangerouslySetInnerHTML={{ __html: model.kickerHtml }}
              />
              <div className="drawer-title">
                {[...model.title].map((ch, i) => (
                  <motion.span
                    key={i}
                    className="dt-char"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(i, CHAR_CAP) * CHAR_GAP,
                      duration: 0.3,
                      ease: EASE_APPEAR,
                    }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </div>
              <div className="drawer-sub">{model.sub}</div>
            </div>
            <div
              key={model.key + ':body'}
              className="drawer-body"
              dangerouslySetInnerHTML={{ __html: model.bodyHtml }}
            />
            <DrawerActions key={model.key + ':actions'} model={model} onAct={onAct} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
