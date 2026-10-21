import { motion } from 'motion/react'

/**
 * v2 外壳占位：仅证明 React 18 + motion + 设计令牌 + 数据管线均已接通，
 * 外壳阶段（计划书阶段 2）会整体重写，勿在此累积真实 UI。
 */
export default function App() {
  return (
    <motion.main
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      style={{ padding: '48px 24px', color: 'var(--ink-1)', fontFamily: 'var(--font-body)' }}
    >
      <h1 style={{ fontFamily: 'var(--font-brush)', color: 'var(--ink-0)' }}>
        中国当代文学史 · 数字长卷
      </h1>
      <p>v2 脚手架就绪：Vite + React 18 + TypeScript + motion；数据经 src/data/store.ts（window.DATA / window.APP_CONFIG）接通。</p>
    </motion.main>
  )
}
