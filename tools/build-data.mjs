/* ============================================================
   build-data.mjs — 数据管线
   扫描 Vault → 解析 wiki 卡片 / 大事记 / 双链 → 合并策展层
   → 输出 js/data.js（以 <script> 方式注入，绕开 file:// 限制）

   用法: node tools/build-data.mjs
   库内容更新后重跑即可；策展数据在 tools/curated.json。
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const VAULT = 'D:/Doc/Vault/MARKING/中国文学史';
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT_FILE = path.join(HERE, '..', 'js', 'data.js');

/* ---------------- 小工具 ---------------- */
const normKey = s => String(s).replace(/[《》“”"'‘’\s]/g, '').trim();

// 简版 YAML frontmatter：key: value / key: [a, b, "c"]
function parseFM(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_\u4e00-\u9fa5-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      const inner = v.slice(1, -1).trim();
      // 引号感知切分:文件名自身含逗号(如 MinerU 扫描件)不被拆碎
      fm[k] = inner ? (inner.match(/"[^"]*"|'[^']*'|[^,]+/g) || [])
        .map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
    } else {
      fm[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return { fm, body: text.slice(m[0].length).trim() };
}

const readMd = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/* ---------------- 1. 实体卡片 ---------------- */
const TYPE_BY_DIR = {
  'entities/person': 'person', 'entities/work': 'work', 'entities/org': 'org',
  'concepts/movement': 'movement', 'concepts/theory': 'theory',
  'concepts/policy': 'policy', 'concepts/event': 'event',
};

const entities = [];
const aliasIndex = new Map();   // normKey -> canonical name
const byName = new Map();

function addAlias(name) { if (name) aliasIndex.set(normKey(name), name); }

for (const [dir, type] of Object.entries(TYPE_BY_DIR)) {
  const abs = path.join(VAULT, 'wiki', dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.md')) continue;
    const raw = readMd(path.join(abs, f));
    if (!raw.trim()) continue;                       // 空壳卡跳过正文，但保留占位
    const { fm, body } = parseFM(raw);
    const name = (fm.title || f.replace(/\.md$/, '')).trim();
    // 摘要 = 首个非标题非空段
    const paras = body.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
    const summary = (paras[0] || '').replace(/^\s*[-*]\s*/, '').trim();
    // 生卒年：柳青（1916—1978）/ 王蒙（1934—）/ (1934-)
    const lifeM = /（?\s*(1[89]\d{2}|20[012]\d)\s*[—–\-]\s*(1[89]\d{2}|20[012]\d)?\s*）?/.exec(summary);
    // 作品年份
    const yearM = /(?:出版|发表|创作|发表于|创刊|首演|问世)(?:于)?\s*((?:19|20)\d{2})/.exec(summary);
    const e = {
      id: name, name, type,
      title: name,
      tags: fm.tags || [], related: fm.related || [],
      sources: fm.sources || [], era: fm.era || '', role: fm.role || '',
      status: fm.status || '', year: fm.year || '',
      birth: lifeM ? +lifeM[1] : '', death: lifeM && lifeM[2] ? +lifeM[2] : '',
      workYear: yearM ? +yearM[1] : (String(fm.year || '').match(/^\d{4}$/) ? +fm.year : ''),
      summary, body, path: `wiki/${dir}/${f}`,
      empty: body.length < 40,
    };
    entities.push(e); byName.set(name, e); addAlias(name); addAlias(f.replace(/\.md$/, ''));
    if (e.tags.length) e.tags.forEach(addAlias);
  }
}

// 占位卡（0字节）：仅作为图谱节点存在，不出现在 WIKI 阅读里
const placeholders = [];
for (const [dir, type] of Object.entries(TYPE_BY_DIR)) {
  const abs = path.join(VAULT, 'wiki', dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs)) {
    if (!f.endsWith('.md')) continue;
    const name = f.replace(/\.md$/, '');
    if (byName.has(name)) continue;
    if (!readMd(path.join(abs, f)).trim()) {
      const p = { id: name, name, type, title: name, placeholder: true,
        tags: [], related: [], summary: '', body: '', birth: '', death: '', workYear: '' };
      placeholders.push(p); byName.set(name, p); addAlias(name);
    }
  }
}

/* ---------------- 1b. 来源归一化(洪子诚 / 朱栋霖 两部教材) ---------------- */
const BOOKS = {
  hong: { id: 'hong', author: '洪子诚', title: '中国当代文学史', year: 1999, coverTo: 2000 },
  zhu:  { id: 'zhu',  author: '朱栋霖 主编', title: '中国现代文学史 1915—2018(第4版)下册', year: 2018, coverTo: 2018 },
};
// 来源笔记的 venue(《中国当代文学史》/《中国现代文学史1915～2018》)作权威依据
const srcNoteVenue = new Map();
{
  const sdir = path.join(VAULT, 'wiki', 'sources');
  if (fs.existsSync(sdir)) {
    for (const f of fs.readdirSync(sdir)) {
      if (!f.endsWith('.md')) continue;
      const { fm } = parseFM(readMd(path.join(sdir, f)).replace(/^\uFEFF/, ''));
      if (fm.venue) srcNoteVenue.set(f, String(fm.venue));
    }
  }
}
/* 引用条目 → {book, label}(可读章节名);不属于两部教材的(研究笔记等)返回 null */
function classifySource(raw) {
  const f = String(raw).trim();
  if (!f) return null;
  const venue = srcNoteVenue.get(f) || '';
  if (venue.includes('现代文学史')) return { book: 'zhu', label: venue.replace(/[《》]/g, '') };
  if (venue.includes('当代文学史')) return { book: 'hong', label: venue.replace(/[《》]/g, '') };
  let m;
  // 洪:两位数字前缀章名 / 路径前缀 / 前言 / 原书扫描件
  if ((m = /^(?:中国当代文学史 洪子诚\/)?(\d{2}_(?:第.+?章_.+?|前言与序言))\.md$/.exec(f)))
    return { book: 'hong', label: m[1].replace(/^\d{2}_/, '').replace(/_/g, ' ') };
  if (f.startsWith('MinerU_markdown_中国当代文学史_')) return { book: 'hong', label: '《中国当代文学史》原书' };
  // 朱:章名带空格(含 -20260511 变体)/ 大事记附录 / 下编目录
  if ((m = /^(第[一二三四五六七八九十]+章 .+?)(?:-20260511)?\.md$/.exec(f)))
    return { book: 'zhu', label: m[1] };
  if (f.startsWith('中国当代文学大事记')) return { book: 'zhu', label: '附录·中国当代文学大事记' };
  if (/^目录[(（]下编/.test(f)) return { book: 'zhu', label: '目录(下编)' };
  return null;
}
function applySources(list) {
  for (const e of list) {
    const books = new Set(); const refs = []; const seen = new Set();
    for (const s of e.sources || []) {
      const c = classifySource(s);
      if (!c) continue;
      books.add(c.book);
      const k = c.book + '|' + c.label;
      if (!seen.has(k)) { seen.add(k); refs.push(c); }
    }
    e.src = [...books].sort();          // ['hong'] / ['zhu'] / 两书都有则二者
    e.srcRefs = refs;
  }
}
applySources(entities);

/* ---------------- 2. [[双链]] → 边 ---------------- */
const edges = [];
const edgeSeen = new Set();
function linkTargets(body) {
  const out = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(body))) out.push(m[1].trim());
  return out;
}
for (const e of [...entities]) {
  const targets = new Set([...linkTargets(e.body), ...e.related]);
  for (const t of targets) {
    const can = aliasIndex.get(normKey(t));
    if (can && can !== e.name) {
      const k = [e.name, can].sort().join('→');
      if (!edgeSeen.has(k)) { edgeSeen.add(k); edges.push({ s: e.name, t: can }); }
    }
  }
}

/* ---------------- 3. 大事记（编年骨架） ---------------- */
const chronFile = path.join(VAULT, '原文', '中国现代文学史1915-2018', '中国当代文学大事记（1949—2018）.md');
const chronRaw = readMd(chronFile);
const chronicle = [];
const secRe = /^##\s*(\d{4})\s*年?\s*$/gm;
const secs = [];
let sm;
while ((sm = secRe.exec(chronRaw))) secs.push({ year: +sm[1], start: sm.index + sm[0].length });
for (let i = 0; i < secs.length; i++) {
  const end = i + 1 < secs.length ? chronRaw.indexOf('##', secs[i].start) : chronRaw.length;
  const seg = chronRaw.slice(secs[i].start, end);
  const lines = seg.split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const em = /^(\d{1,2})月(?:(\d{1,2})日)?/.exec(t);
    if (em) {
      if (cur) chronicle.push(cur);
      cur = { year: secs[i].year, month: +em[1], day: em[2] ? +em[2] : '',
        text: t.slice(em[0].length).replace(/^[—–\-]?\d{0,2}日?[,，\s]+/, '').replace(/^[，,\s]+/, '') };
    } else if (cur) {
      cur.text += t;                                   // 换行续句
    }
  }
  if (cur) chronicle.push(cur);
}
for (const c of chronicle) {
  c.refs = linkTargets(c.text);
  // 显示标签:取到第一句,限 34 字
  let label = c.text.split(/[。；]/)[0].replace(/\[\[|\]\]/g, '');
  c.label = label.length > 34 ? label.slice(0, 33) + '…' : label;
  c.id = `c${c.year}-${String(c.month).padStart(2, '0')}-${c.label.slice(0, 12)}`;
}

/* ---------------- 3b. 洪子诚年表(书后附录,附于第二十七章文末) ----------------
   与朱栋霖《大事记》同为 "## YYYY 年" 分节;差异:条目除日期外还有
   同月/本年/同年 起头,且正文自带 [[双链]]。产出 src:'hong' 事件。 */
const hongChronicle = [];
{
  const hongFile = path.join(VAULT, '原文', '中国当代文学史-洪子诚', '27_第二十七章_90年代的小说.md');
  const raw = readMd(hongFile);
  const start = raw.indexOf('## 中国当代文学年表');
  if (start >= 0) {
    const seg = raw.slice(start);
    const secRe = /^##\s*(\d{4})\s*年?\s*$/gm;
    const secs = [];
    let sm;
    while ((sm = secRe.exec(seg))) secs.push({ year: +sm[1], start: sm.index + sm[0].length });
    for (let i = 0; i < secs.length; i++) {
      const end = i + 1 < secs.length ? seg.indexOf('\n##', secs[i].start) : seg.length;
      const lines = seg.slice(secs[i].start, end).split(/\r?\n/);
      let cur = null;
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const em = /^(\d{1,2})月(?:(\d{1,2})日)?/.exec(t);
        const im = /^(同月|是月)/.exec(t);
        const ym = /^(本年|年内|同年|年初|年底)/.exec(t);
        const pref = em ? em[0].length : im ? im[0].length : ym ? ym[0].length : 0;
        if (pref) {
          if (cur) hongChronicle.push(cur);
          cur = {
            year: secs[i].year,
            month: em ? +em[1] : im && cur ? cur.month : '',
            day: em && em[2] ? +em[2] : '',
            text: t.slice(pref).replace(/^[—–\-]?\d{0,2}日?[,，\s]*/, '').replace(/^[，,\s]+/, ''),
          };
        } else if (cur) {
          cur.text += t;                    // 换行续句
        }
      }
      if (cur) hongChronicle.push(cur);
    }
    for (const c of hongChronicle) {
      c.refs = linkTargets(c.text);
      let label = c.text.split(/[。；]/)[0].replace(/\[\[|\]\]/g, '');
      c.label = label.length > 34 ? label.slice(0, 33) + '…' : label;
      c.id = `h${c.year}-${String(c.month || 0).padStart(2, '0')}-${c.label.slice(0, 12)}`;
      c.src = 'hong'; c.kind = 'event'; c.priority = 2;
    }
  }
}

/* ---------------- 4. 分期笔记(notes/)纳入 WIKI ---------------- */
const notes = [];
const notesDir = path.join(VAULT, 'notes');
if (fs.existsSync(notesDir)) {
  for (const f of fs.readdirSync(notesDir)) {
    if (!f.endsWith('.md') || f.startsWith('_') || f.includes('目录')) continue;
    const raw = readMd(path.join(notesDir, f));
    if (!raw.trim()) continue;
    const { fm, body } = parseFM(raw);
    const name = f.replace(/\.md$/, '');
    const spanM = /((?:19|20)\d{2})\s*[—–\-～~至]\s*((?:19|20)\d{2})?/.exec(name);
    notes.push({
      id: name, name, type: 'note', title: name, note: true,
      tags: fm.tags || [], related: fm.related || [],
      from: spanM ? +spanM[1] : '', to: spanM && spanM[2] ? +spanM[2] : '',
      summary: (body.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))[0] || ''),
      body, path: `notes/${f}`,
    });
    byName.set(name, { ...notes[notes.length - 1] }); addAlias(name);
  }
}

/* ---------------- 4b. 镇卷页面：时间轴综述 + 逐年大事记 + 笔记目录 ----------------
   这三页是「综述」性质,不参与分期挂载,在 wiki 分期导航顶部单列。 */
const overviewNames = new Set();
const specialPages = [
  { file: path.join(VAULT, '中国当代文学史时间轴.md'), name: '中国当代文学史时间轴' },
  { file: path.join(VAULT, '原文', '中国现代文学史1915-2018', '中国当代文学大事记（1949—2018）.md'), name: '中国当代文学大事记（1949—2018）' },
  { file: path.join(VAULT, 'notes', '现代文学史笔记目录.md'), name: '现代文学史笔记目录' },
];
for (const sp of specialPages) {
  const raw = readMd(sp.file);
  if (!raw.trim()) continue;
  const { fm, body } = parseFM(raw);
  const page = {
    id: sp.name, name: sp.name, type: 'note', note: true, title: sp.name,
    tags: fm.tags || [], related: [],
    summary: (body.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'))[0] || ''),
    body, path: sp.file.slice(VAULT.length + 1),
  };
  notes.push(page);
  overviewNames.add(sp.name);
  byName.set(sp.name, page); addAlias(sp.name);
}

/* ---------------- 4c. 两套教材分期(wiki 分期导航骨架) ----------------
   分期划分以《原文》两目录的章文件名为准,口径定义只有 js/config.js 的
   APP_CONFIG.periodizations 一份(此处求值引入,避免双处维护)。
   每篇分期笔记按文件名年代段的中点年挂到两套口径各自的期;
   洪版只覆盖 1949—2000,新世纪笔记仅入朱版(忠实教材覆盖范围)。 */
const periodizations = { overview: [] };
{
  // js/config.js 是纯对象赋值脚本,直接求值取 APP_CONFIG
  const win = {};
  new Function('window', readMd(path.join(HERE, '..', 'js', 'config.js')))(win);
  const PERIZ = win.APP_CONFIG.periodizations;

  // 章号:朱「第十六章」中文数字 / 洪「27_」数字前缀
  const CN_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const cnNum = s => {
    if (s === '十') return 10;
    const m = /^([一二三四五六七八九]?)十([一二三四五六七八九])?$/.exec(s);
    return m ? (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[2] ? CN_DIGIT[m[2]] : 0) : (CN_DIGIT[s] || 0);
  };

  // 扫描章文件(与 5c 节同一过滤:朱排除大事记/目录/整册拆分件,洪排除前言/海报)
  const chaptersByBook = {};
  for (const key of Object.keys(PERIZ)) {
    const pz = PERIZ[key];
    const list = [];
    for (const f of fs.readdirSync(path.join(VAULT, pz.dir))) {
      if (!f.endsWith('.md')) continue;
      if (key === 'zhu' && !/^第.+章 /.test(f)) continue;
      if (key === 'hong' && !/^\d{2}_第.+章_/.test(f)) continue;
      let num = 0, title = '';
      const mz = /^第(.+?)章 (.+)\.md$/.exec(f);
      const mh = /^(\d{2})_第(.+?)章_(.+)\.md$/.exec(f);
      if (key === 'zhu' && mz) { num = cnNum(mz[1]); title = `第${mz[1]}章 ${mz[2]}`; }
      else if (key === 'hong' && mh) { num = +mh[1]; title = `第${mh[2]}章 ${mh[3].replace(/_/g, ' ')}`; }
      if (!num) continue;
      list.push({ num, title, file: f, path: `${pz.dir}/${f}` });
    }
    list.sort((a, b) => a.num - b.num);
    chaptersByBook[key] = list;
  }

  // 各期骨架(chapters 按章号区间填充;hidden 期照常携带数据,由前端决定不渲染)
  for (const key of Object.keys(PERIZ)) {
    const pz = PERIZ[key];
    periodizations[key] = {
      id: pz.id || key, label: pz.label, book: pz.book,
      hideBefore: pz.hideBefore || 0,
      periods: pz.periods.map(p => ({
        id: p.id, name: p.name, from: p.from, to: p.to, hidden: !!p.hidden,
        chapters: p.chapters
          ? chaptersByBook[key].filter(c => c.num >= p.chapters[0] && c.num <= p.chapters[1])
          : [],
        notes: [],
      })),
    };
  }

  // 笔记文件名年代段:覆盖连写年代(50-70年代 / 1950-60年代 / 80-90年代)、
  // 4 位年份段(1949—1976 / 2000-2018)、单年代(1920年代 / 1990年代 / 80年代)
  function noteSpan(name) {
    const cent = y => (y >= 50 && y <= 99 ? 1900 : 2000) + y;   // 两位年代 → 全年
    const full = y => (y >= 100 ? y : cent(y));
    let m = /((?:19|20)?\d{2})\s*[—–\-～~至]\s*(\d{2})\s*年代/.exec(name);
    if (m) return { from: full(+m[1]), to: cent(+m[2]) + 10 };
    m = /((?:19|20)\d{2})\s*[—–\-～~至]\s*((?:19|20)\d{2})?/.exec(name);
    if (m) return { from: +m[1], to: m[2] ? +m[2] : +m[1] + 10 };
    m = /((?:19|20)\d{2})\s*年代/.exec(name);
    if (m) return { from: +m[1], to: +m[1] + 10 };
    m = /(\d{2})\s*年代/.exec(name);
    if (m) return { from: cent(+m[1]), to: cent(+m[1]) + 10 };
    return null;
  }
  // 无纪年标题的少数笔记兜底(题意归段)
  const SPAN_FALLBACK = {
    '中国文学现代化': { from: 1915, to: 1949 },
    '五四革命文学的兴起与发展': { from: 1917, to: 1927 },
  };

  // 《现代文学史笔记目录.md》的编目顺序 = 分期笔记展示顺序;未编目者排末尾
  const tocOrder = [];
  const tocRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let tom;
  while ((tom = tocRe.exec(readMd(path.join(VAULT, 'notes', '现代文学史笔记目录.md'))))) {
    const nm = tom[1].trim();
    if (!tocOrder.includes(nm)) tocOrder.push(nm);
  }
  const tocIdx = nm => { const i = tocOrder.indexOf(nm); return i < 0 ? 1e4 : i; };

  // 挂载:年代段中点年落入哪个期就归哪期(综述页不挂载)
  const unspanned = [];
  for (const n of notes) {
    if (overviewNames.has(n.name)) { periodizations.overview.push(n.name); continue; }
    const span = noteSpan(n.name) || SPAN_FALLBACK[n.name];
    if (!span) { unspanned.push(n.name); continue; }
    if (!n.from) { n.from = span.from; n.to = span.to; }   // 回填基础解析漏掉的年代
    const mid = (span.from + span.to) / 2;
    for (const key of Object.keys(PERIZ)) {
      const p = periodizations[key].periods.find(p => mid >= p.from && mid < p.to);
      if (p) p.notes.push(n.name);
    }
  }
  for (const key of Object.keys(PERIZ))
    for (const p of periodizations[key].periods)
      p.notes.sort((a, b) => tocIdx(a) - tocIdx(b));
  // 解析失败者归入综述组兜底,保证不丢内容
  periodizations.overview.push(...unspanned);
  globalThis.__perizReport = { unspanned: unspanned.length };
}

/* ---------------- 5. 策展层合并 ---------------- */
const curated = JSON.parse(readMd(path.join(HERE, 'curated.json')));

// 5.1 人物生卒覆盖
for (const [name, life] of Object.entries(curated.people_life || {})) {
  const target = byName.get(name);
  if (target && target.type === 'person') {
    if (life[0]) target.birth = life[0];
    target.death = life[1] || '';
  }
}

// 5.2 流派/群体时间带（时间轴群体层）
const bands = (curated.bands || []).map(b => ({ ...b, id: normKey(b.name) + b.from }));
for (const b of bands) {
  const t = byName.get(b.name);
  if (t && !t.from) { t.from = b.from; t.to = b.to; }   // 回填同名实体
}

// 5.3 编年条目类型启发 + 里程碑 → 两套编年各自匹配
//    (洪侧仅匹配朱侧已命中的里程碑;未命中者以策展独立条目呈现,两模式都显示,避免重复卡片)
const milestones = curated.milestones || [];
const kindOfChron = t => {
  if (/《[^》]+》/.test(t) && /发表|出版|连载|首演|上映|问世|创刊|演出|刊出/.test(t)) return 'work';
  if (/批判|批评|论争|论战|商榷|决议|决定|指示|批示|讲话|报告|座谈|会议|大会|整风|运动|方针|号召|通知|文件|平反|复查|评奖|部署/.test(t)) return 'policy';
  return 'event';
};
function matchMilestones(list, srcTag, opts = {}) {
  const used = new Set();
  for (const c of list) {
    c.priority = 2; c.kind = kindOfChron(c.text); c.src = srcTag;
    for (const ms of milestones) {
      if (used.has(ms.title)) continue;                // 每个里程碑只标注最早命中的条目
      if (ms.year !== c.year) continue;
      // 洪年表常用"同月/本年"纪时,月份约束仅用于朱侧(月份精确)
      if (!opts.ignoreMonth && ms.month && ms.month !== c.month) continue;
      const hay = c.text;
      // allHit 仅在有 match 时成立(matchAny 专属里程碑不得因 match 缺省而恒真,
      // 否则会错锚到当年第一条条目)
      const allHit = ms.match ? ms.match.every(k => hay.includes(k)) : false;
      const anyHit = ms.matchAny ? ms.matchAny.some(k => hay.includes(k)) : false;
      const hit = allHit || anyHit;
      if (hit) {
        c.priority = 1; c.title = ms.title; c.blurb = ms.blurb || '';
        c.kind = ms.type || 'event'; c.milestone = true;
        c.msTitle = ms.title;          // 配对键:两套编年命中同一里程碑 ⇔ msTitle 相同
        used.add(ms.title);
        break;
      }
    }
  }
  return used;
}
const usedMilestone = matchMilestones(chronicle, 'zhu');
const usedHong = matchMilestones(hongChronicle, 'hong', { ignoreMonth: true });
for (const ms of milestones) {
  if (usedMilestone.has(ms.title)) continue;
  chronicle.push({ id: 'ms-' + ms.title, year: ms.year, month: ms.month || '', day: '',
    text: ms.blurb || ms.title, label: ms.title, title: ms.title, blurb: ms.blurb || '',
    kind: ms.type || 'event', priority: 1, milestone: true, refs: [], standalone: true,
    src: 'curated', msTitle: ms.title, hongMatched: usedHong.has(ms.title) });
}

// 5.4 主次/类型覆盖
for (const [name, ov] of Object.entries(curated.overrides || {})) {
  const t = byName.get(name);
  if (t) Object.assign(t, ov);
}

/* 5.4b(已移除): 曾为洪系实体计算 hongYear 年表首现锚点,前端无消费者,删除。
   若将来要在洪/比对模式渲染实体锚点,从 git 历史找回此块。 */

/* ---------------- 5c. 两书正文口径挖掘(cmp) ----------------
   对每个实体统计它在两部教材正文中的提及:次数、出现于哪些章·节、
   提及最密的前 3 节各摘一段原文。零提及 → 前端显示"本书未提及"。 */
{
  const bookDirs = {
    hong: path.join(VAULT, '原文', '中国当代文学史-洪子诚'),
    zhu:  path.join(VAULT, '原文', '中国现代文学史1915-2018'),
  };
  const SECT_MAX = 6, PS_MAX = 3, PASS_CAP = 280;
  // 每书拼接为一个大文本,标题处打标记,匹配位置二分归属章·节
  const bookBuf = {};
  for (const [book, dir] of Object.entries(bookDirs)) {
    let text = '';
    const marks = [];                     // {pos, label} 标题边界,升序
    let chapters = 0;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith('.md')) continue;
      if (book === 'zhu' && !/^第.+章 /.test(f)) continue;      // 跳过合并版/目录/大事记
      if (book === 'hong' && !/^\d{2}_第.+章_/.test(f)) continue; // 跳过前言/海报/年表载体以外文件
      let raw = readMd(path.join(dir, f));
      if (!raw.trim()) continue;
      if (book === 'hong') {                  // 第二十七章文末的年表不计入正文口径
        const ci = raw.indexOf('## 中国当代文学年表');
        if (ci >= 0) raw = raw.slice(0, ci);
      }
      const chM = /^#\s+(第.+?章[^\n]*)/.exec(raw);
      const ch = chM ? chM[1].trim() : f.replace(/\.md$/, '').replace(/^\d{2}_/, '').replace(/_/g, ' ');
      marks.push({ pos: text.length, label: ch });
      chapters++;
      const sectRe = /^#{2,3}\s+([^\n]+)/gm;  // 朱:节/小节;洪:小节
      let sm2;
      while ((sm2 = sectRe.exec(raw)))
        marks.push({ pos: text.length + sm2.index + sm2[0].length, label: ch + ' > ' + sm2[1].trim() });
      text += raw + '\n';
    }
    bookBuf[book] = { text, marks, chapters };
  }
  const sectAt = (bb, pos) => {               // 最近的前置标题
    let lo = 0, hi = bb.marks.length - 1, r = null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (bb.marks[mid].pos <= pos) { r = bb.marks[mid]; lo = mid + 1; } else hi = mid - 1; }
    return r;
  };
  const cleanSnip = s => String(s)
    .replace(/\[\[|\]\]/g, '')
    .replace(/[#*>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\[\^\d+\]\s*[:：]?\s*/, '')        // 脚注定义行首标记
    .replace(/^[）】》」』、,，;；:：\]]+/, '')      // 句窗起点落在括注/顿号后的残头
    .trim();
  for (const e of entities) {
    let name = String(e.name || '').replace(/[《》]/g, '').trim();
    if (name.length < 2) continue;
    const cmp = {};
    for (const book of ['hong', 'zhu']) {
      const bb = bookBuf[book];
      const needle = e.type === 'work' ? '《' + name + '》' : name;
      const positions = [];
      let p = bb.text.indexOf(needle);
      while (p >= 0) { positions.push(p); p = bb.text.indexOf(needle, p + 1); }
      if (!positions.length && e.type === 'work') {           // 作品退化为裸名匹配
        p = bb.text.indexOf(name);
        while (p >= 0) { positions.push(p); p = bb.text.indexOf(name, p + 1); }
      }
      if (!positions.length) continue;
      const chaps = []; const seenChap = new Set();
      for (const pos of positions) {
        const s = sectAt(bb, pos);
        const label = s ? s.label : '';
        if (!seenChap.has(label)) { seenChap.add(label); chaps.push(label); }
      }
      /* 原文摘段:按"节"聚合提及,每节取提及最密的一行(段落),
         取提及最多的前 3 节,按文档顺序输出原文段——
         回答"同一个词条,这本书到底是怎么说的" */
      const bySect = new Map();               // 节名 -> Map(行首 -> {start,end,hits,anchor})
      for (const pos of positions) {
        const ls = bb.text.lastIndexOf('\n', pos - 1) + 1;
        let le = bb.text.indexOf('\n', pos);
        if (le < 0) le = bb.text.length;
        const s = sectAt(bb, ls);
        const label = s ? s.label : '';
        if (!bySect.has(label)) bySect.set(label, new Map());
        const lines = bySect.get(label);
        const ln = lines.get(ls) || { start: ls, end: le, hits: 0, anchor: pos };
        ln.hits++;
        lines.set(ls, ln);
      }
      /* 每节取提及最密的行(同密取更早的),按节内提及总数取前 3 节,再按文档顺序排列 */
      const picked = [...bySect.entries()]
        .map(([label, lines]) => {
          let best = null;
          for (const ln of lines.values())
            if (!best || ln.hits > best.hits || (ln.hits === best.hits && ln.start < best.start)) best = ln;
          return { label, ln: best, total: [...lines.values()].reduce((a, b) => a + b.hits, 0) };
        })
        .sort((a, b) => b.total - a.total)
        .slice(0, PS_MAX)
        .sort((a, b) => a.ln.start - b.ln.start);
      const ps = picked.map(({ label, ln }) => {
        let st = ln.start, en = ln.end, head = false, tail = false;
        if (en - st > PASS_CAP + 30) {
          st = Math.max(ln.start, Math.min(ln.anchor - 80, ln.end - PASS_CAP));
          en = Math.min(ln.end, st + PASS_CAP);
          const back = bb.text.lastIndexOf('。', st);
          if (back > ln.start && st - back < 130 && back < ln.anchor) { st = back + 1; }
          const fwd = bb.text.indexOf('。', en - 1);
          if (fwd >= 0 && fwd < ln.end && fwd - en < 130) en = fwd + 1;
          head = st > ln.start; tail = en < ln.end;
        }
        let t = cleanSnip(bb.text.slice(st, en));
        if (head) t = '……' + t;
        if (tail && !t.endsWith('……')) t += '……';
        return { s: label, t };
      });
      cmp[book] = {
        n: positions.length,
        sn: chaps.length,
        chs: chaps.slice(0, SECT_MAX).filter(Boolean),
        ps,
      };
    }
    if (Object.keys(cmp).length) e.cmp = cmp;
  }

  // 5d. 人工评语层(curated.compare_notes)合并进 cmp
  for (const [name, note] of Object.entries(curated.compare_notes || {})) {
    const t = byName.get(name);
    if (!t) continue;
    t.cmp = t.cmp || {};
    t.cmp.note = { hong: note.hong || '', zhu: note.zhu || '' };
  }
  globalThis.__bookChapters = { hong: bookBuf.hong.chapters, zhu: bookBuf.zhu.chapters };
}

/* ---------------- 6. 地点数据 ---------------- */
const locations = curated.locations || [];

/* ---------------- 7. 时期归属 ---------------- */
const PERIODS = [
  { id: 'p1', name: '十七年文学', from: 1949, to: 1966 },
  { id: 'p2', name: '文革文学', from: 1966, to: 1976 },
  { id: 'p3', name: '新时期文学', from: 1976, to: 1989 },
  { id: 'p4', name: '九十年代文学', from: 1990, to: 1999 },
  { id: 'p5', name: '新世纪文学', from: 2000, to: 2018 },
];
function periodOf(year) {
  if (!year) return '';
  const p = PERIODS.find(p => year >= p.from && year < p.to) ||
            (year === 1966 ? PERIODS[1] : null);
  return p ? p.id : '';
}
for (const e of entities) {
  const y = e.birth || e.workYear;
  e.period = periodOf(y) || (e.era ? (e.era.includes('50-70') ? 'p1' : e.era.includes('80') ? 'p3' : '') : '');
}
for (const c of [...chronicle, ...hongChronicle]) {
  const y = c.year;
  c.period = periodOf(y) || (y >= 1949 && y < 1966 ? 'p1' : y < 1976 ? 'p2' : y < 1990 ? 'p3' : y < 2000 ? 'p4' : y <= 2018 ? 'p5' : '');
  if (y < 1949 || y > 2018) c.out = true;
}

/* ---------------- 8. 输出(拆两份:核心即用 + 正文惰性包) ----------------
   核心包 data.js:时间轴/图谱/地图/搜索所需字段(summary 保留作搜索摘要),
   首屏加载;正文包 data-body.js:词条正文 + 两史口径摘段,抽屉/Wiki
   首次打开时由 app.js 的 ensureBodyData() 动态补载(file:// 兼容)。 */
const entitiesCore = entities.map(({ body, cmp, ...rest }) => rest);
const notesCore = notes.map(({ body, ...rest }) => rest);

const allEvents = [...chronicle, ...hongChronicle];
const bySrcCount = { hong: 0, zhu: 0, both: 0, none: 0 };
for (const e of entities) {
  const s = e.src || [];
  if (s.length === 2) bySrcCount.both++;
  else if (s.includes('hong')) bySrcCount.hong++;
  else if (s.includes('zhu')) bySrcCount.zhu++;
  else bySrcCount.none++;
}
const DATA = {
  generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
  periods: PERIODS,
  periodizations,                 // 两套教材分期(wiki 分期导航)
  books: {
    hong: { ...BOOKS.hong, chronicle: hongChronicle.length, chapters: globalThis.__bookChapters.hong },
    zhu:  { ...BOOKS.zhu,  chronicle: chronicle.length, chapters: globalThis.__bookChapters.zhu },
  },
  entities: entitiesCore,         // 实体卡核心字段(正文在 data-body.js)
  notes: notesCore,               // 分期笔记(同上)
  events: allEvents.filter(c => !c.out),
  edges,
  bands,
  important: curated.important_persons || [],
  locations,
  stats: {
    entities: entities.length, placeholders: placeholders.length,
    edges: edges.length, events: allEvents.filter(c => !c.out).length,
    milestones: milestones.length, notes: notes.length,
    located: locations.length,
    bySrc: bySrcCount,
    eventsBySrc: {
      hong: allEvents.filter(c => !c.out && c.src === 'hong').length,
      zhu: allEvents.filter(c => !c.out && c.src === 'zhu').length,
      curated: allEvents.filter(c => !c.out && c.src === 'curated').length,
    },
    cmpMined: entities.filter(e => e.cmp).length,
  },
};

// 正文惰性包:实体名/笔记名 → {body, cmp?}(后写优先,与 byName 同序)
const bodyPack = {};
for (const e of entities) bodyPack[e.name] = { body: e.body || '', cmp: e.cmp || null };
for (const n of notes) bodyPack[n.name] = { body: n.body || '' };

const js = '/* 由 tools/build-data.mjs 生成 —— 请勿手改；正文与口径摘段在 data-body.js(惰性加载) */\n'
  + `window.DATA = ${JSON.stringify(DATA, null, 0)};\n`;
const bodyJs = '/* 由 tools/build-data.mjs 生成 —— 惰性包:词条正文 + 两史口径摘段,勿手改 */\n'
  + `window.DATA_BODY = ${JSON.stringify(bodyPack, null, 0)};\n`;
fs.writeFileSync(OUT_FILE, js);
const OUT_BODY_FILE = path.join(HERE, '..', 'js', 'data-body.js');
fs.writeFileSync(OUT_BODY_FILE, bodyJs);

/* ---------------- 9. 统计报告 ---------------- */
const noLife = entities.filter(e => e.type === 'person' && !e.birth).length;
const withLife = entities.filter(e => e.type === 'person' && e.birth).length;
const missingLinkTargets = new Set();
for (const e of entities) for (const t of linkTargets(e.body)) {
  if (!aliasIndex.has(normKey(t))) missingLinkTargets.add(t);
}
console.log('====== data.js 生成完毕 ======');
console.table(DATA.stats);
console.log(`人物有生卒年: ${withLife} / ${withLife + noLife}`);
console.log(`实体来源: 仅洪 ${bySrcCount.hong} / 仅朱 ${bySrcCount.zhu} / 两书均引 ${bySrcCount.both} / 无教材出处 ${bySrcCount.none}`);
console.log(`编年事件: 朱栋霖大事记 ${DATA.stats.eventsBySrc.zhu} / 洪子诚年表 ${DATA.stats.eventsBySrc.hong} / 策展里程碑 ${DATA.stats.eventsBySrc.curated}`);
console.log(`口径挖掘(cmp): ${DATA.stats.cmpMined}/${entities.length} 实体至少被一书提及`);
console.log(`里程碑命中: ${usedMilestone.size}/${milestones.length}（未命中者作为独立条目加入）`);
const hongMs = hongChronicle.filter(c => c.milestone);
const hongPaired = hongMs.filter(c => usedMilestone.has(c.msTitle)).length;
console.log(`洪侧里程碑命中: ${hongMs.length}（其中与朱侧同题配对 ${hongPaired} 个;策展独立卡 ${milestones.length - usedMilestone.size} 张）`);
console.log(`未命中里程碑: ${milestones.filter(m => !usedMilestone.has(m.title)).map(m => m.title + '(' + m.year + ')').join('、') || '无'}`);
for (const key of ['zhu', 'hong']) {
  const pz = DATA.periodizations[key];
  console.log(`分期导航[${pz.label}]: ` + pz.periods.map(p =>
    `${p.name}(${p.chapters.length}章${p.hidden ? ',暂隐' : ',' + p.notes.length + '篇笔记'})`).join(' | '));
}
if (globalThis.__perizReport.unspanned)
  console.log(`分期导航: ${globalThis.__perizReport.unspanned} 篇笔记未解析出年代段,已归入综述组`);
console.log(`未解析链接目标(前20): ${[...missingLinkTargets].slice(0, 20).join('、') || '无'}`);
console.log(`输出体积: data.js ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2)} MB(首屏) + data-body.js ${(fs.statSync(OUT_BODY_FILE).size / 1024 / 1024).toFixed(2)} MB(惰性)`);
