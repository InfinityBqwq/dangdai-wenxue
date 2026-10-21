/**
 * 旧版数据管线桥接（v2 唯一数据入口）
 * ------------------------------------------------------------
 * 副作用引入仓库根两个零构建脚本（普通 <script> 语义，非 ESM）：
 * - js/data.js    → window.DATA       （tools/build-data.mjs 生成，勿手改；正文敏感，本仓库新代码一律经 window 运行时读取，不进源码）
 * - js/config.js  → window.APP_CONFIG （分期口径 / 类型色 / 缩放阈值 / 编年双口径）
 * 注意：data-body.js 保持旧版动态注入的惰性语义，此处不引入（见 docs/动效升级计划书.md 架构决策）。
 */
import '../../../js/data.js'
import '../../../js/config.js'

export type LegacyData = Record<string, unknown>
export type LegacyConfig = Record<string, unknown>

declare global {
  interface Window {
    DATA: LegacyData
    APP_CONFIG: LegacyConfig
  }
}

/** 旧版全量数据（js/data.js 生成） */
export function getData(): LegacyData {
  return window.DATA
}

/** 全局配置（js/config.js） */
export function getConfig(): LegacyConfig {
  return window.APP_CONFIG
}

/** 带断言的取数：视图挂载时调用，管线未接通立即显式报错而非静默空数据 */
export function requireData(): LegacyData {
  if (!window.DATA) throw new Error('[v2] window.DATA 未就绪：检查 js/data.js 副作用引入是否生效')
  return window.DATA
}

export function requireConfig(): LegacyConfig {
  if (!window.APP_CONFIG) throw new Error('[v2] window.APP_CONFIG 未就绪：检查 js/config.js 副作用引入是否生效')
  return window.APP_CONFIG
}
