/**
 * motionTokens.ts — motion 侧共享时长/缓动常量
 * ------------------------------------------------------------
 * tokens.css §8/§9 动效令牌的 JS 侧镜像（设计令牌双处同步原则）：
 * CSS 过渡一律引用 var() 令牌；motion 的 transition 对象
 * （duration 数值 / 贝塞尔数组）无法引用 CSS 变量，跨组件复用的
 * 字面量收编在此。各组件局部弹簧（TAB_SPRING / SLIDE_SPRING 等）
 * 属局部手感调校，仍留在组件文件内命名常量。
 */

/** --ease-appear / --ease-out-soft 镜像：快出缓收（显影 / 错峰入场） */
export const EASE_APPEAR: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** 减动效直跳终态：MotionConfig reducedMotion="user" 会保留的 opacity
 *  微过渡压到不可感（0.01s，与 CSS 全局兜底的 .01ms 同语义量级） */
export const T_INSTANT = { duration: 0.01 }
