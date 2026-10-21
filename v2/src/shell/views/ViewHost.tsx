/**
 * ViewHost.tsx — 视图容器与切换编排
 * ------------------------------------------------------------
 * keep-alive：五岛首次激活才挂载，之后常驻只切 active class（引擎状态不丢；
 * 非激活 display:none 与旧版一致）。
 * 切换节拍：旧视图加 leaving 类播 150ms 淡出下潜后再换 active；新视图容器
 * viewIn + 面板（data-vpanel）错峰显影（CSS 编排）。带 focus/node/person 等
 * 内容参数的深链跳过容器节拍直接显示。
 */
import { Suspense, useEffect, useRef, useState } from 'react'
import { useAppContextValue } from '../state'
import { VIEW_IDS } from '../state'
import type { Params, ViewId } from '../state'
import { VIEW_COMPONENTS } from './registry'

/** 内容深链参数：出现即跳过容器节拍（抽屉动作 / URL 深链直达内容） */
const DEEP_KEYS = ['focus', 'node', 'person', 'name', 'add', 'addev']
const hasDeepParam = (p: Params): boolean => DEEP_KEYS.some((k) => k in p && p[k] !== '')

const LEAVE_MS = 150 // 与 --dur-beat 对齐：旧视图淡出下潜节拍

export default function ViewHost() {
  const { view, params } = useAppContextValue()
  const [mounted, setMounted] = useState<ReadonlySet<ViewId>>(() => new Set<ViewId>([view]))
  const [shown, setShown] = useState<ViewId>(view)
  const [leaving, setLeaving] = useState<ViewId | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setMounted((m) => {
      if (m.has(view)) return m
      const n = new Set(m)
      n.add(view)
      return n
    })
    if (view === shown) return
    if (hasDeepParam(params)) {
      // 深链直达：跳过容器节拍
      window.clearTimeout(timer.current)
      setLeaving(null)
      setShown(view)
      return
    }
    // 常规切换：旧视图 leaving 淡出下潜 150ms，再换 active
    setLeaving(shown)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setShown(view)
      setLeaving(null)
    }, LEAVE_MS)
    return () => window.clearTimeout(timer.current)
    // params 参与深链判定；shown 变化后的重入由 view===shown 守卫
  }, [view, shown, params])

  return (
    <main id="views">
      {VIEW_IDS.map((id) => {
        const isLeaving = leaving === id
        const isShown = shown === id && !isLeaving
        const cls = 'view' + (isShown ? ' active' : '') + (isLeaving ? ' leaving' : '')
        return (
          <section key={id} id={'view-' + id} data-view={id} className={cls}>
            {mounted.has(id) && (
              <Suspense fallback={null}>
                {(() => {
                  const Island = VIEW_COMPONENTS[id]
                  return <Island params={params} />
                })()}
              </Suspense>
            )}
          </section>
        )
      })}
    </main>
  )
}
