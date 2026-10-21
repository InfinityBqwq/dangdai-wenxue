/**
 * registry.tsx — 视图注册表
 * ------------------------------------------------------------
 * 五个视图岛（timeline / wiki / graph / map / puzzle）经 React.lazy 按需分块；
 * 首次激活才加载并挂载（ViewHost keep-alive），之后常驻只切 active。
 */
import { lazy, type ComponentType } from 'react'
import type { ViewId, Params } from '../state'

export { VIEW_IDS } from '../state'

export interface IslandProps {
  params?: Params
}

export const VIEW_META: Record<ViewId, { label: string }> = {
  timeline: { label: '时间轴' },
  wiki: { label: 'Wiki' },
  graph: { label: '图谱' },
  map: { label: '地图' },
  puzzle: { label: '拼图' },
}

export const VIEW_COMPONENTS: Record<ViewId, ComponentType<IslandProps>> = {
  timeline: lazy(() => import('@/views/timeline')),
  wiki: lazy(() => import('@/views/wiki')),
  graph: lazy(() => import('@/views/graph')),
  map: lazy(() => import('@/views/map')),
  puzzle: lazy(() => import('@/views/puzzle')),
}
