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
      fm[k] = inner ? inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [];
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
  // 显示标签：取到第一句，限 34 字
  let label = c.text.split(/[。；]/)[0].replace(/\[\[|\]\]/g, '');
  c.label = label.length > 34 ? label.slice(0, 33) + '…' : label;
  c.id = `c${c.year}-${String(c.month).padStart(2, '0')}-${c.label.slice(0, 12)}`;
}

/* ---------------- 4. 分期笔记（notes/）纳入 WIKI ---------------- */
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

/* ---------------- 4b. 镇卷页面：时间轴综述 + 逐年大事记 ---------------- */
const specialPages = [
  { file: path.join(VAULT, '中国当代文学史时间轴.md'), name: '中国当代文学史时间轴' },
  { file: path.join(VAULT, '原文', '中国现代文学史1915-2018', '中国当代文学大事记（1949—2018）.md'), name: '中国当代文学大事记（1949—2018）' },
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
  byName.set(sp.name, page); addAlias(sp.name);
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

// 5.3 里程碑 → 优先级1 + 标题/说明；未命中的作为独立事件加入
const milestones = curated.milestones || [];
const usedMilestone = new Set();
for (const c of chronicle) {
  c.priority = 2; c.kind = 'event';
  for (const ms of milestones) {
    if (usedMilestone.has(ms.title)) continue;         // 每个里程碑只标注最早命中的条目
    if (ms.year !== c.year) continue;
    if (ms.month && ms.month !== c.month) continue;
    const hay = c.text;
    const allHit = !ms.match || ms.match.every(k => hay.includes(k));
    const anyHit = ms.matchAny && ms.matchAny.some(k => hay.includes(k));
    const hit = (ms.match || ms.matchAny) ? (allHit || anyHit) : false;
    if (hit) {
      c.priority = 1; c.title = ms.title; c.blurb = ms.blurb || '';
      c.kind = ms.type || 'event'; c.milestone = true;
      usedMilestone.add(ms.title);
      break;
    }
  }
}
for (const ms of milestones) {
  if (usedMilestone.has(ms.title)) continue;
  chronicle.push({ id: 'ms-' + ms.title, year: ms.year, month: ms.month || '', day: '',
    text: ms.blurb || ms.title, label: ms.title, title: ms.title, blurb: ms.blurb || '',
    kind: ms.type || 'event', priority: 1, milestone: true, refs: [], standalone: true });
}

// 5.4 主次/类型覆盖
for (const [name, ov] of Object.entries(curated.overrides || {})) {
  const t = byName.get(name);
  if (t) Object.assign(t, ov);
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
for (const c of chronicle) {
  const y = c.year;
  c.period = periodOf(y) || (y >= 1949 && y < 1966 ? 'p1' : y < 1976 ? 'p2' : y < 1990 ? 'p3' : y < 2000 ? 'p4' : y <= 2018 ? 'p5' : '');
  if (y < 1949 || y > 2018) c.out = true;
}

/* ---------------- 8. 输出 ---------------- */
const DATA = {
  generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
  periods: PERIODS,
  entities,                       // 实体卡（含正文）
  notes,                          // 分期笔记
  events: chronicle.filter(c => !c.out),
  edges,
  bands,
  important: curated.important_persons || [],
  locations,
  stats: {
    entities: entities.length, placeholders: placeholders.length,
    edges: edges.length, events: chronicle.filter(c => !c.out).length,
    milestones: milestones.length, notes: notes.length,
    located: locations.length,
  },
};

const js = '/* 由 tools/build-data.mjs 生成 —— 请勿手改；Vault 更新后运行 node tools/build-data.mjs */\n'
  + `window.DATA = ${JSON.stringify(DATA, null, 0)};\n`;
fs.writeFileSync(OUT_FILE, js);

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
console.log(`里程碑命中: ${milestones.filter(m => usedMilestone.has(m.title)).length}/${milestones.length}（未命中者作为独立条目加入）`);
console.log(`未命中里程碑: ${milestones.filter(m => !usedMilestone.has(m.title)).map(m => m.title + '(' + m.year + ')').join('、') || '无'}`);
console.log(`未解析链接目标(前20): ${[...missingLinkTargets].slice(0, 20).join('、')}`);
console.log(`输出体积: ${(fs.statSync(OUT_FILE).size / 1024 / 1024).toFixed(2)} MB`);
