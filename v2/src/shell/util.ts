/**
 * util.ts — Shell 小工具（移植 app.js 同名实现）
 */

/** HTML 转义（app.js esc 原样移植） */
export function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 读取主题 CSS 变量的当前计算值（app.js cssVar 原样移植） */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** 全站动画开关：减动效偏好下，JS 补间直接跳终态（app.js 原样移植） */
export function prefersReducedMotion(): boolean {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
}
