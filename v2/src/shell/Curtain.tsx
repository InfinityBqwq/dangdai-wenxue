/**
 * Curtain.tsx — 开幕卷轴（顺滑化，不加时长）
 * ------------------------------------------------------------
 * 时序契约与旧版一致：900ms 加 gone（拉开）、1900ms 清 __curtainOpening、2800ms 卸载。
 * 升级点：两片幕布改弹簧物理缓动；题字在拉幕前先淡出（避免被门夹）；点击可跳过。
 * 减动效偏好：整个卷轴不渲染（旧版 CSS 同效）。
 */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { prefersReducedMotion } from './api'

/** 物理感弹簧：拉开 ~1.6s 收敛，轻微过冲（越过 -101% 后回稳，视觉上是一次"甩开"） */
const PULL_SPRING = { type: 'spring', stiffness: 50, damping: 12, mass: 1 } as const

export default function Curtain() {
  const [gone, setGone] = useState(false)
  const [markGone, setMarkGone] = useState(false)
  const [dead, setDead] = useState(false)
  const reduced = prefersReducedMotion()

  useEffect(() => {
    if (reduced) {
      setDead(true)
      return
    }
    const timers: number[] = []
    // 题字先淡出：620ms 开始、200ms 收尾，900ms 拉幕时已无字可夹
    timers.push(window.setTimeout(() => setMarkGone(true), 620))
    timers.push(
      window.setTimeout(() => {
        setGone(true)
        // 供时间轴首次显影仪式对齐：卷轴正在拉开
        ;(window as any).__curtainOpening = true
      }, 900),
    )
    timers.push(window.setTimeout(() => ((window as any).__curtainOpening = false), 1900))
    timers.push(window.setTimeout(() => setDead(true), 2800))
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, [reduced])

  if (reduced || dead) return null

  // 点击跳过：立即拉幕并结束开幕契约
  const skip = () => {
    if (gone) return
    setMarkGone(true)
    setGone(true)
    ;(window as any).__curtainOpening = false
    window.setTimeout(() => setDead(true), 700)
  }

  return (
    <div id="curtain" onClick={skip} style={{ pointerEvents: gone ? 'none' : 'auto' }}>
      <motion.div
        className="c-half l"
        initial={{ x: 0 }}
        animate={{ x: gone ? '-101%' : 0 }}
        transition={gone ? PULL_SPRING : { duration: 0 }}
      >
        <motion.div
          className="c-mark"
          initial={{ opacity: 0 }}
          animate={markGone ? { opacity: 0 } : { opacity: 0.9 }}
          transition={markGone ? { duration: 0.2, ease: 'easeOut' } : { delay: 0.3, duration: 1, ease: 'easeOut' }}
        >
          当代文学史
        </motion.div>
      </motion.div>
      <motion.div
        className="c-half r"
        initial={{ x: 0 }}
        animate={{ x: gone ? '101%' : 0 }}
        transition={gone ? PULL_SPRING : { duration: 0 }}
      />
    </div>
  )
}
