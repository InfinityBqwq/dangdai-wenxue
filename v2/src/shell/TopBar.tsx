/**
 * TopBar.tsx — 顶栏：品牌 + 五 Tab（layoutId 墨条）+ 来源切换三态钮 + 帮助 + 搜索入口
 * ------------------------------------------------------------
 * 墨条指示器：motion layoutId 共享元素，弹簧滑动 + 宽度形变；
 * 按钮 whileHover/whileTap 微交互；来源切换色点即图例（比对=双色对分）。
 */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { srcMeta, srcModes, useAppContextValue } from './state'
import { switchView } from './router'
import { cssVar } from './util'
import { openPalette, toggleHelp } from './api'
import { VIEW_IDS, VIEW_META } from './views/registry'

const TAB_SPRING = { type: 'spring', stiffness: 480, damping: 38 } as const
const TAP_SPRING = { type: 'spring', stiffness: 600, damping: 30 } as const

export default function TopBar() {
  const { view, source, setSource } = useAppContextValue()
  // 窗口尺寸变化后 layoutId 墨条位置需重新测量：bump 一次渲染
  const [, bump] = useState(0)
  useEffect(() => {
    const onResize = () => bump((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <header id="topbar">
      <div className="brand">
        <span className="title">当代文学史</span>
        <span className="subtitle">一九四九 — 二〇一八 · 数字长卷</span>
      </div>

      <nav id="view-tabs">
        {VIEW_IDS.map((id) => (
          <motion.button
            key={id}
            data-view={id}
            className={view === id ? 'active' : ''}
            onClick={() => switchView(id)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.96 }}
            transition={TAP_SPRING}
          >
            {VIEW_META[id].label}
            {view === id && (
              <motion.span
                layoutId="tab-ink"
                className="tab-ink"
                transition={TAB_SPRING}
              />
            )}
          </motion.button>
        ))}
      </nav>

      <div className="spacer" />

      {/* 来源切换三态（色点即图例：单源=源色，比对=双色对分） */}
      <div id="src-switch">
        {srcModes().map((m) => {
          const dot =
            m.id === 'hong' || m.id === 'zhu'
              ? cssVar(srcMeta(m.id).color)
              : `linear-gradient(90deg,${cssVar('--src-zhu')} 50%,${cssVar('--src-hong')} 50%)`
          return (
            <motion.button
              key={m.id}
              data-src={m.id}
              className={source === m.id ? 'active' : ''}
              title={m.title || m.label}
              onClick={() => setSource(m.id)}
              whileTap={{ scale: 0.95 }}
              transition={TAP_SPRING}
            >
              <span className="sdot" style={{ background: dot }} />
              <span className="sst">{m.label}</span>
            </motion.button>
          )
        })}
      </div>

      <motion.button
        id="help-btn"
        title="快捷键（按 ? 呼出）"
        onClick={() => toggleHelp()}
        whileTap={{ scale: 0.95 }}
        transition={TAP_SPRING}
      >
        ⌨ 快捷键
      </motion.button>

      {/* 搜索入口 → Ctrl+K 命令面板 */}
      <motion.button
        id="global-search"
        onClick={() => openPalette('')}
        whileTap={{ scale: 0.98 }}
        transition={TAP_SPRING}
      >
        <span className="gs-icon">⌕</span>
        <span className="gs-ph">搜索人物 / 事件 / 思潮…</span>
        <span className="kbd">Ctrl K</span>
      </motion.button>
    </header>
  )
}
