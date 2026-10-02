# AGENTS.md

中国当代文学史（1949—2018）水墨长卷可视化网站：纯静态单页，时间轴 / Wiki / 图谱 / 地图四个视图。零构建、零 npm 依赖；d3 / echarts / marked / 中国 GeoJSON / 霞鹜文楷字体全部本地化在 `lib/`（离线可用）。仓库语言为中文，注释与提交信息沿用中文。

## 常用命令

- 重建数据：`node tools/build-data.mjs` — 扫描 Obsidian Vault `D:\Doc\Vault\MARKING\中国文学史` → 生成 `js/data.js`。Node ≥18 零依赖；本机无 Python。
- 本地预览：`node tools/serve.mjs 8080` → http://localhost:8080
- 用户入口（勿删）：`启动网页.bat`（重建+起服务+开浏览器）、`重建数据.bat`
- 脱敏读写：`node tools/scrub.mjs check|scrub|restore …` — 词条替换为 `〔S##〕` 占位符的脱敏副本，见下「敏感词降噪」节
- 无 package.json、无测试、无 lint；验证靠浏览器手动检查。`.review/` 存放历次视觉审查截图。

## 硬性规则

- `js/data.js` 由管线生成，**勿手改**。数据修正去两处：Vault 原始卡片，或 `tools/curated.json`（人工策展层：里程碑 / 人物印章名单 / 流派带 / 生卒 / 地图钉），改完重跑管线生效。
- 设计令牌双处同步：`css/theme.css`（CSS 变量，含暗色主题占位）与 `js/config.js`（分期 / 类型色 / 缩放阈值 / 编年口径）。组件样式只引用变量，改肤只动这两处。
- 无模块系统：全部 `<script>` 按序加载（data → config → app → timeline → wiki → graph → map → keyboard）。新增脚本须同步 `index.html`；`app.js` 首次路由已推迟到 window load，别提前。
- 视图模块只暴露全局 API（`window.TL` / `MAP` / `GRAPH`），键盘事件一律经 `js/keyboard.js` 集中分发，勿在视图里自行监听。

## 用户钦定的设计决策（勿改回、勿"优化"）

- 时间轴 = **固定文档模型**：长卷约 3300px 定宽，所有卡片尺寸与位置静态排定，永不随缩放重排；左右拖动浏览，滚轮 = 屏幕放大镜（锚定光标），放大超 1.7 倍自动聚焦视口中心事件（虚线环 + 抽屉）。早期"时间比例缩放 + 浓淡 LOD 显影"模型已被用户明确否决。
- 编年双口径：朱栋霖（默认）/ 洪子诚 / 比对 三种编年模式（`config.js` 的 `sources`），模式只切换编年轨，词条卡恒显两书说法。
- 用户设计偏好：可读性优先——厌烦内容拥堵、无语义的颜色、浪费空间的图形；每种颜色必须有图例解释；卡片必须零重叠。

## 敏感词降噪（防内容过滤中断）

词条原文只应存在于数据层（Vault 原卡 → `js/data.js`；`tools/curated.json`）。模型上下文里出现的原文越少，因内容过滤误伤（[1301] 等）导致的调用中断越少：

- 术语表 `tools/sensitive-terms.txt` 由用户人工维护；**代理勿读取、勿改写该文件，也勿在会话 / 提交信息 / 注释里复述其中的词**——一律用占位符 `〔S##〕` 或年份段（如"1966—1976 年段"）指代。
- 读大体量内容文件（`js/data.js`、Vault 卡片、`curated.json`）前先 `node tools/scrub.mjs check <file>`（退出码 2 = 有命中）：命中则 `node tools/scrub.mjs scrub <file>` 生成 `.scrub` 脱敏副本，读副本；配套的 `.scrub.map` 是还原映射，**永不读入上下文**。
- 在脱敏副本上做编辑必须原样保留 `〔S##〕` 占位符，改完 `node tools/scrub.mjs restore <file>.scrub.map <file>.scrub <out>` 还原；数据修正优先直接改 Vault 原卡或 `curated.json` 对应 id 字段，不在文本层补丁。
- 能"算"就不"看"：布局 / 重叠 / 对齐问题优先用页面内几何断言（bounding box 数值 dump 成 JSON 给代理读）代替截图送视觉审查；确需截图送审时沿用小图分批兜底。
- 单次调用的原文体量尽量小、git 提交勤：过滤中断时损失的是一次调用而不是一段工作；重试时改用脱敏副本，勿原样重发被拦内容。

## 踩坑速查

- `tools/serve.mjs` 无缓存头：改 JS 后浏览器可能用旧脚本，需强制刷新。
- d3：`.join()` 之后 `.attr('class', …)` 会覆盖选择器依赖的 class（曾致时期题字堆在原点）；forceLink 的边必须用 `source`/`target` 键。
- ECharts 地图性能：canvas 渲染器显式声明 + `animation:false` + setOption 前先比对可见钉集合签名（集合未变零更新）；播放用 rAF 推进浮点年。
- `KeyboardEvent.target` 可能是 `document`（无 `.matches`），判输入焦点需 `target instanceof Element` 防护。
- 测试时序假象：rAF 异步渲染后须等两帧再读 transform；非激活视图（display:none）下子元素尺寸全为 0×0，勿据此断言 bug。
- ZCode 会话中断会杀掉后台 node 服务器，恢复时重启 `node tools/serve.mjs 8080` 并重开浏览器标签。
- 视觉审查：截图含 文革 / 反右 等历史词时，视觉审查代理可能被内容过滤器拦截（[1301]），兜底改用人工逐页核查或小图分批送审；前置预防见「敏感词降噪」节。
