/**
 * Toast.tsx — 通知队列
 * ------------------------------------------------------------
 * 弹簧浮入 + 细进度线（宽度 scaleX 1→0 线性走完即退场）+ 队列逐条退场。
 * 只动 transform/opacity。
 */
import { AnimatePresence, motion } from 'motion/react'
import { useToasts } from './api'

const POP_SPRING = { type: 'spring', stiffness: 380, damping: 28 } as const

export default function ToastStack() {
  const toasts = useToasts()
  return (
    <div id="toast-stack" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 0.94, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18, ease: 'easeOut' } }}
            transition={POP_SPRING}
          >
            <span className="toast-msg">{t.msg}</span>
            <motion.i
              className="toast-line"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: t.ms / 1000, ease: 'linear' }}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
