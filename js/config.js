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

  /* ---------- 编年口径(全局:两书年表切换) ---------- */
  /* 全局口径(用户钦定):切换时间轴的编年轨,也切换 Wiki 分期导航
     (单口径显示该版章节+笔记,比对并置两版);
     词条卡恒显示全部,并排两书"各自怎么说"。 */
  sources: {
    modes: [
      { id: 'zhu', label: '朱栋霖', title: '全局口径:朱栋霖——时间轴编年(大事记)+ Wiki 分期导航(默认)' },
      { id: 'hong', label: '洪子诚', title: '全局口径:洪子诚——时间轴编年(书后年表 1949—2000)+ Wiki 分期导航' },
      { id: 'compare', label: '比对', title: '比对:时间轴双轨并置;Wiki 并置两版分期' },
    ],
    meta: {
      hong: { label: '洪子诚', short: '洪', color: 'var(--src-hong)' },
      zhu:  { label: '朱栋霖', short: '朱', color: 'var(--src-zhu)' },
      curated: { label: '策展', short: '策', color: 'var(--gold)' },
    },
  },

  /* ---------- 两套教材分期(wiki 分期导航骨架) ----------
     分期划分以《原文》两目录的章文件名为准;口径定义只有这一份,
     管线(build-data.mjs)求值本文件后按 chapters:[起,止] 章号区间
     填充实际章节与笔记,前端 wiki 只消费生成结果。
     朱版按「年代段+文体」三段;洪版按专题章组分四段、不覆盖 2000 后。
     hideBefore:暂隐该年之前的朱版内容(临时措施,改掉此值重跑管线即恢复)。 */
  periodizations: {
    zhu: {
      id: 'zhu', label: '朱栋霖版', book: '《中国现代文学史1915—2018》下编',
      dir: '原文/中国现代文学史1915-2018',
      hideBefore: 1949,
      periods: [
        { id: 'zp0', name: '1915—1949 现代文学', from: 1915, to: 1949, hidden: true }, // 原文暂缺上编,仅笔记
        { id: 'zp1', name: '1949—1976 年文学', from: 1949, to: 1976, chapters: [1, 5] },
        { id: 'zp2', name: '80年代、90年代文学', from: 1976, to: 2000, chapters: [6, 13] },
        { id: 'zp3', name: '2000—2018 年文学', from: 2000, to: 2018, chapters: [14, 16] },
      ],
    },
    hong: {
      id: 'hong', label: '洪子诚版', book: '《中国当代文学史》',
      dir: '原文/中国当代文学史-洪子诚',
      periods: [
        { id: 'hp1', name: '文学的转折与一体化', from: 1949, to: 1966, chapters: [1, 12] },
        { id: 'hp2', name: '1966—1976 年段', from: 1966, to: 1976, chapters: [13, 15] },
        { id: 'hp3', name: '新时期文学', from: 1976, to: 1990, chapters: [16, 24] },
        { id: 'hp4', name: '90年代文学', from: 1990, to: 2000, chapters: [25, 27] },
      ],
    },
  },

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
    yearPad: 6,     // 长卷右端预留空白年数(向未来延伸;淡刻度提示)
  },

  /* ---------- 地图默认中心 ---------- */
  map: { center: [104.5, 36.2], zoom: 4 },

  /* ---------- 拼图白板 ---------- */
  puzzle: {
    grid: 24,                                  // 点阵背景间距（世界像素）
    zoomMin: 0.25, zoomMax: 3,                 // 画布缩放范围
    cardMin: { w: 130, h: 64 },                // 卡片最小尺寸
    cardSize: {                                // 各类卡片默认尺寸 [宽, 高]
      entity: [220, 120], event: [210, 104], note: [180, 130],
    },
    groupSize: [340, 220],                     // 分组框默认尺寸
  },

  /* ---------- Obsidian 库路径（生成 obsidian:// URI 用） ---------- */
  obsidianVault: 'MARKING',
};
