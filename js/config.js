/* ============================================================
   config.js — JS 侧设计令牌与分期定义
   与 css/theme.css 对应：换主题时两处一起改。
   ============================================================ */

window.APP_CONFIG = {
  /* ---------- 时间范围 ---------- */
  YEAR_MIN: 1949,
  YEAR_MAX: 2018,

  /* ---------- 五时期（与 theme.css --period-N 对应） ---------- */
  periods: [
    { id: 'p1', name: '十七年文学', short: '十七年', from: 1949, to: 1966,
      theme: '一体化形成与强化', color: '#a4522f' },
    { id: 'p2', name: '文革文学', short: '文革', from: 1966, to: 1976,
      theme: '一体化极端化', color: '#5d5a63' },
    { id: 'p3', name: '新时期文学', short: '新时期', from: 1976, to: 1989,
      theme: '一体化解体与多元探索', color: '#3f7048' },
    { id: 'p4', name: '九十年代文学', short: '九十年代', from: 1990, to: 1999,
      theme: '多元化与市场化', color: '#37638a' },
    { id: 'p5', name: '新世纪文学', short: '新世纪', from: 2000, to: 2018,
      theme: '全媒体时代的多元格局', color: '#7d5391' },
  ],

  /* ---------- 实体类型 ---------- */
  /* kind: timeline 上人物生涯条等使用的归类 */
  types: {
    person:   { label: '人物', color: '#8f3b2c', glyph: '人', kind: 'person' },
    work:     { label: '作品', color: '#a06a2a', glyph: '作', kind: 'work' },
    org:      { label: '组织', color: '#4a6d3f', glyph: '组', kind: 'group' },
    movement: { label: '思潮', color: '#37638a', glyph: '潮', kind: 'group' },
    policy:   { label: '政策', color: '#7d5391', glyph: '政', kind: 'policy' },
    event:    { label: '事件', color: '#b3342e', glyph: '事', kind: 'event' },
    theory:   { label: '理论', color: '#5c8a75', glyph: '论', kind: 'group' },
    other:    { label: '其他', color: '#8a8272', glyph: '条', kind: 'group' },
  },

  /* ---------- 时间轴布局（固定文档模型） ----------
     卡片在长卷上有固定尺寸与位置（像超宽网页，左右拖动）；
     滚轮缩放是对屏幕的放大镜：放大越过 focusZoom 后，
     视口中心的事件自动聚焦并在抽屉中展开详情。 */
  layout: {
    pxy: 46,        // 每年像素宽（文档坐标，固定不变）
    focusZoom: 1.7, // 达到该放大倍数即聚焦中心事件
    maxZoom: 4,     // 最大放大倍数
  },

  /* ---------- 地图默认中心 ---------- */
  map: { center: [104.5, 36.2], zoom: 4 },

  /* ---------- Obsidian 库路径（生成 obsidian:// URI 用） ---------- */
  obsidianVault: 'MARKING',
};
