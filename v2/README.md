# v2 — 框架站实验（Vite + React + TS + motion）

「中国当代文学史 · 数字长卷」的框架化重构实验，方案见 [`../docs/动效升级计划书.md`](../docs/动效升级计划书.md)。
**只存在于 `v2-framework` 分支**，全部新代码收在 `v2/` 子目录；仓库根目录的旧版纯静态站（`index.html` / `css/` / `js/` / `lib/`）原样保留作移植参照，`main` 分支与线上部署不受影响，本分支**只提交、不 push**。

## 架构：React 外壳 + 命令式视图岛

```
v2/
├── index.html                  # Vite 入口（#root + /src/main.tsx）
├── vite.config.ts              # react 插件 + legacyFonts 插件 + @ 别名 + fs.allow 仓库根
└── src/
    ├── main.tsx                # 入口；先副作用引入 data/store 接通数据，勿加 StrictMode
    ├── App.tsx                 # 外壳组装
    ├── data/store.ts           # 数据桥接（v2 唯一数据入口，见下「数据管线」）
    ├── styles/
    │   ├── tokens.css          # 设计令牌（含 §8/§9 动效令牌：--ease-* / --dur-*）
    │   ├── shell.css           # 外壳样式
    │   └── motionTokens.ts     # 动效令牌 JS 侧镜像（motion transition 无法引用 CSS 变量）
    ├── shell/                  # React 全局外壳
    │   ├── router.ts           # hash 路由，协议与旧版完全一致：#/view?key=val
    │   ├── state.ts / uiStore.ts  # 应用状态 + 轻量 store
    │   ├── keyboard.ts         # 键盘事件集中分发（延续旧版 js/keyboard.js 约定）
    │   ├── api.ts              # 跨层 API：renderMarkdown / ensureBodyData / prefersReducedMotion 等
    │   ├── TopBar / Drawer / CommandPalette / Toast / HelpOverlay / Curtain
    │   └── views/
    │       ├── registry.tsx    # 五视图注册表：React.lazy 按需分块
    │       └── ViewHost.tsx    # keep-alive 容器：首激活才挂载，之后常驻只切 active
    └── views/                  # 五个视图岛
        ├── timeline/  graph/  map/  puzzle/   # 引擎岛
        └── wiki/                              # 唯一完全 React 化的视图
```

两条铁律（源自动效升级计划书「架构决策」表）：

1. **四个图表引擎逐字移植为命令式模块**。timeline / graph / map / puzzle 约 3100 行手调
   canvas/SVG 引擎（`src/views/*/engine.ts`，自旧版 `js/*.js` 移植）不进 React 状态——
   React 只在 `useEffect` 里挂载/卸载（如 `src/views/timeline/index.tsx`），引擎状态
   （pan/zoom/拖拽）不进组件树，外壳 keep-alive 下切视图不丢状态、非激活视图照旧
   `display:none`。旧版钦定决策（时间轴固定文档模型等）一律不动。
2. **Wiki 是唯一 React 重写的视图**（纯 DOM，重写收益最大）：`engine.ts` 只做
   「数据 → 渲染模型」纯转换，`index / WikiTree / WikiArticle` 声明式消费，动效全在组件层。

接线约定：路由参数经 `useViewParams()` 单路投递给引擎 `onShow(params)`（深链对位），编年口径变化经
`useAppContext()` 触发引擎 `onSourceChange()`；引擎不自注册 `window.Views`，但 `window.TL` /
`MAP` / `GRAPH` / `PUZZLE` 全局 API 照旧挂在 window 上供键盘层调用。引擎为命令式挂载，故
`main.tsx` **刻意不加 `React.StrictMode`**（dev 双调用会二次初始化引擎）。

字体：`vite.config.ts` 的 `legacyFonts` 插件——dev 由中间件直读仓库根 `lib/fonts`（零复制），
build 后 `closeBundle` 递归复制到 `dist/fonts`（产物不入库）。

## 常用命令

Node ≥ 18；依赖走 npmmirror 镜像（本环境官方源不通）：

```bash
# 安装依赖（仅首次；失败则重试，间隔递增）
npm --prefix v2 install --registry=https://registry.npmmirror.com

npm --prefix v2 run dev        # 开发服务器（Vite 默认 5173）
npm --prefix v2 run build      # 产物出 v2/dist/（含字体复制）
npm --prefix v2 run preview    # 本地预览构建产物
```

仓库根的旧版命令不受影响：`node tools/build-data.mjs`（重建数据）、`node tools/serve.mjs 8080`（旧站预览）。
v2 无测试、无 lint；验收靠 `build` 门禁 + 浏览器渲染走查（browser-accept：1440 桌面 + 375 窄屏、console 零报错、reduced-motion 直跳终态）。

## 数据管线（零改动，复用仓库根）

```
Obsidian Vault ──node tools/build-data.mjs──▶ js/data.js（勿手改）      静态 import
                                              js/config.js              静态 import
                                              js/data-body.js           动态 import（惰性分块）
```

- **`js/data.js` → `window.DATA`**：`src/data/store.ts` 以副作用方式直接
  `import '../../../js/data.js'`（`js/config.js` 同理 → `window.APP_CONFIG`），全部视图经
  `requireData()` / `requireConfig()` 运行时读取——取不到立即显式报错而非静默空数据。
  管线（`tools/build-data.mjs`）与本分支零改动；数据修正仍去 Vault 原卡或 `tools/curated.json` 后重跑管线。
- **`js/data-body.js` 保持惰性语义**：不在入口静态引入，而是 `src/shell/api.ts` 的
  `ensureBodyData()` 用动态 `import()` 按需补载（模块副作用写 `window.DATA_BODY`，失败可重试）。
  Vite 将其打成独立惰性 chunk（构建产物中的 `data-body-*.js`），Wiki 章节/正文首次需要时才加载。
- **内容安全**：正文敏感，v2 新代码一律经 window 运行时全局访问数据，不把数据文件内容
  抄进源码/会话/提交信息；代理亦不读取 `js/data.js`、`js/data-body.js`、`tools/curated.json`、
  `tools/sensitive-terms.txt`（脱敏流程见仓库根 AGENTS.md「敏感词降噪」节）。

## 动效清单摘要

目标「大厂官网水准」，全程 `prefers-reduced-motion` 双层降级（MotionConfig + CSS 兜底直跳终态）。

**Shell 全局层**（React + motion）：

- 顶栏 Tab：`layoutId` 墨条共享元素弹簧滑动 + 宽度形变；`whileHover` 墨染 / `whileTap` 按压回弹
- 视图切换：`AnimatePresence mode="wait"`——旧视图 150ms 淡出下潜，新视图容器淡入上浮 +
  面板（`data-vpanel`）错峰显影；带 `focus` 等内容参数的深链跳过容器节拍直达内容
- 详情抽屉：弹簧滑入 + 纸色 scrim + `drag="x"` 甩关 + 标题逐字显影 + 动作按钮 stagger
- 命令面板（Ctrl+K）：0.96→1 弹簧缩放 + 背景模糊 + 结果 18ms/条 stagger + 高亮条 `layoutId` 滑动
- Toast 弹簧浮入 + 进度线 + 队列退场；帮助浮层卡片缩放 + 分组 stagger
- 开幕卷轴顺滑化（不加时长，保留 `__curtainOpening` 时序契约）；focus-visible 全局朱砂外环

**五视图**：

| 视图 | 形态 | 动效 |
|---|---|---|
| 时间轴 | 引擎岛 | 卡片光标邻近墨染高亮（rAF 节流）；聚焦虚线环呼吸旋转；图例浮层 stagger（18ms/条） |
| Wiki | React | 目录树弹簧折叠 + 条目 stagger；文章交叉过渡（标题逐字 + 段落 stagger）；`useInView` 滚动显影；阅读进度墨线；目录 scrollspy |
| 图谱 | 引擎岛 | 节点按度数序渐显材质化；悬停光环呼吸；邻居边虚线流动（dash offset） |
| 地图 | 引擎岛 | 钉入场 elasticOut 回弹；年份数字滚轮翻页；播放钮 ▶/⏸ 形变 + 脉冲；图例滑杆入场编排 |
| 拼图 | 引擎岛 | 卡片上板落地弹簧（scale 过冲 + 阴影收敛）；新连线 stroke-dashoffset 描线生长；卡片库分组展开 stagger |

**性能红线**：只动 transform/opacity/color；canvas 引擎状态不进 React；stagger ≤24 条；
echarts 动态 import 按需分块；时间轴每帧单 transform 不变。

## 与根目录静态版的关系

- 同一仓库、同一数据的**两套前端**：根目录 = 线上在用的零构建静态站（`main` 分支形态）；
  `v2/` = `v2-framework` 分支上的框架化实验，自 main 切出，可随时对照/回退。
- 根目录文件在 v2 下只作移植参照与数据源（`js/data*.js`、`lib/fonts`），**不改动**；
  新代码全部进 `v2/`。
- 分支策略：实验期只提交不 push；若定稿合入，另行评审（数据管线与 `index.html` 深链协议
  两边兼容，合入成本集中在部署脚本与根站取舍）。
