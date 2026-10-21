/**
 * router.ts — hash 路由（app.js「路由」节移植）
 * ------------------------------------------------------------
 * 协议与旧版完全一致：#/view?key=val
 * - focus 参数转数字；
 * - ?src= 深链切来源（setSource fromHash，不再改写 hash）；
 * - load 与 hashchange 都要接（load 二次路由幂等：applyRoute 对相同路由跳过）；
 * - 程序化切换用 history.replaceState 更新 hash，不制造历史记录、不触发重复路由。
 */
import { VIEW_IDS, applyRoute, getAppState, setSource, srcMode, srcModes } from './state'
import type { Params, ViewId } from './state'

const HASH_RE = /^#\/(\w+)(?:\?(.*))?$/

/** 解析当前 hash；不匹配返回 null */
export function parseHash(): { view: string; params: Params } | null {
  const m = HASH_RE.exec(location.hash)
  if (!m) return null
  const params: Params = {}
  if (m[2]) new URLSearchParams(m[2]).forEach((v, k) => (params[k] = v))
  return { view: m[1], params }
}

/** 视图 + 参数 → hash（空值参数丢弃，与旧版 switchView 一致） */
export function serializeHash(view: string, params: Params): string {
  const q = new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString()
  return '#/' + view + (q ? '?' + q : '')
}

/**
 * 切换视图（旧版 switchView 移植；onShow 投递单路化）：
 * 先写 hash，再落地 React 状态。不再直发 window.Views[view].init/onShow——
 * 五岛统一由包装层订阅路由（useViewParams → 引擎 onShow）单路驱动；旧路直发
 * 会在 150ms 切场节拍内（section 尚 display:none、盒 0×0）打进引擎，造成
 * graph 画布 0 尺寸重排 / map resize 告警 / focus 双排程，与岛订阅叠加成双路。
 * window.Views 注册表本身保留（引擎兼容全局与键盘层不动）。
 */
export function switchView(view: ViewId, params: Params = {}): void {
  const newHash = serializeHash(view, params)
  if (location.hash !== newHash) history.replaceState(null, '', newHash)
  applyRoute(view, params)
}

/** hash → 路由（旧版 routeFromHash 原样移植） */
export function routeFromHash(): void {
  const parsed = parseHash()
  if (!parsed || !VIEW_IDS.includes(parsed.view as ViewId)) {
    switchView('timeline', {})
    return
  }
  const params: Params = { ...parsed.params }
  // 类型修正：focus 转数字
  if (params.focus !== undefined) params.focus = +params.focus
  // 来源深链(#/timeline?src=hong)
  const src = params.src
  if (typeof src === 'string' && src !== srcMode() && srcModes().some((x) => x.id === src)) {
    setSource(src, { fromHash: true })
  }
  switchView(parsed.view as ViewId, params)
}

let inited = false
/**
 * 接线路由：hashchange + 首路由（React 挂载即走，等价旧版 DOMContentLoaded）
 * + load（契约保留：资源就绪后再校正一次；applyRoute 幂等，不会重复动画）。
 */
export function initRouter(): void {
  if (inited) return
  inited = true
  window.addEventListener('hashchange', routeFromHash)
  routeFromHash()
  window.addEventListener('load', routeFromHash)
}

/** 当前视图（keyboard / 引擎移植代码用） */
export function getView(): ViewId {
  return getAppState().view
}

/** 来源切换时的 hash 同步：保留视图与其它参数，仅改写 src（app.js 原样移植） */
export function syncSourceHash(m: string): void {
  const h = HASH_RE.exec(location.hash)
  const view = h ? h[1] : 'timeline'
  const params = new URLSearchParams(h && h[2] ? h[2] : '')
  params.set('src', m)
  history.replaceState(null, '', '#/' + view + '?' + params.toString())
}
