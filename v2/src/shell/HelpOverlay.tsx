/**
 * HelpOverlay.tsx — 快捷键帮助浮层
 * ------------------------------------------------------------
 * 内容自旧版 js/keyboard.js 的 GROUPS 抄录；弹簧缩放入场 + 分组行 stagger。
 */
import { AnimatePresence, motion } from 'motion/react'
import { helpStore } from './uiStore'
import { useStore } from './uiStore'
import { toggleHelp } from './api'
import { EASE_APPEAR } from '@/styles/motionTokens'

const CARD_SPRING = { type: 'spring', stiffness: 380, damping: 30 } as const

/* 内容照抄 keyboard.js（勿在此增删快捷键——以 keyboard.ts 分发为准） */
const GROUPS: [string, [string, string][]][] = [
  ['全局', [
    ['1 - 5', '切换 时间轴 / Wiki / 图谱 / 地图 / 拼图'],
    ['S', '切换编年 朱栋霖 / 洪子诚 / 双轨比对'],
    ['Ctrl K 或 /', '全局搜索'],
    ['Esc', '逐层关闭（帮助 → 浮层 → 抽屉）'],
    ['?', '本帮助'],
  ]],
  ['时间轴', [
    ['← →', '左右平移（Shift 加速）'],
    ['↑ ↓ / + −', '屏幕缩放'],
    ['Home / End', '跳到 1949 / 2018'],
    ['PgUp / PgDn', '上一 / 下一时期'],
    ['[ 或 ]', '上一 / 下一里程碑（自动聚焦展开）'],
    ['O', '全览整卷'],
  ]],
  ['地图', [
    ['← →', '年份 ±1（Shift ×5）'],
    ['Space', '播放 / 暂停'],
    ['Home / End', '跳到 1949 / 2018'],
  ]],
  ['图谱', [
    ['方向键', '平移画布'],
    ['+ −', '缩放'],
    ['0', '复位视图'],
    ['R', '重新布局'],
  ]],
  ['拼图', [
    ['方向键', '平移画布（Shift 加速）'],
    ['+ −', '缩放'],
    ['0 / F', '适应全部内容'],
    ['Del', '删除选中的卡片 / 连线 / 分组框'],
    ['N', '加便签'],
    ['G', '加分组框'],
  ]],
]

export default function HelpOverlay() {
  const open = useStore(helpStore)
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="kbd-help"
          id="kbd-help"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) toggleHelp(false)
          }}
        >
          <motion.div
            className="kh-card"
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
            transition={CARD_SPRING}
          >
            <div className="kh-head">
              快捷键 <span className="kh-esc">Esc 关闭</span>
            </div>
            <motion.div
              className="kh-grid"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.05 } } }}
            >
              {GROUPS.map(([g, rows]) => (
                <motion.div
                  key={g}
                  className="kh-group"
                  variants={{ hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } }}
                  transition={{ duration: 0.3, ease: EASE_APPEAR }}
                >
                  <div className="kh-gtitle">{g}</div>
                  {rows.map(([k, d]) => (
                    <div className="kh-row" key={k}>
                      <span className="kh-keys">
                        {k.split(' ').map((w, i) => (
                          <kbd key={i}>{w}</kbd>
                        ))}
                      </span>
                      <span className="kh-desc">{d}</span>
                    </div>
                  ))}
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
