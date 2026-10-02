#!/usr/bin/env node
/**
 * 敏感词降噪工具：把文件中的历史词条替换为中性占位符 〔S01〕，产出可供模型安全读取的脱敏副本。
 *
 * 目的：词条原文只留在数据层与本地文件里，模型上下文中用占位符指代，
 * 减少内容过滤误伤（[1301] 等）造成的调用中断。脚本输出永不包含词条本身。
 *
 * 用法（Node ≥18，零依赖）：
 *   node tools/scrub.mjs check <file...>                     统计命中；退出码 0=干净 2=有命中 1=出错
 *   node tools/scrub.mjs scrub <file...>                     生成 <file>.scrub（脱敏副本）与 <file>.scrub.map（还原映射）
 *   node tools/scrub.mjs restore <map> <scrubbed> <out>      还原保留占位符的编辑稿
 *   --terms=<path>    覆盖默认术语表 tools/sensitive-terms.txt（一行一词，# 开头为注释）
 *
 * 约定（见 AGENTS.md「敏感词降噪」节）：
 *   - 术语表与 *.scrub.map 永不读入代理上下文；
 *   - 代理输出（提交信息、注释、汇报）不复述词条，用 〔S##〕 或年份段指代。
 */
'use strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const TOKEN_LIKE = /〔S\d+〕/; // 占位符样式（非全局，用于校验）
const TOKEN_SCAN = /〔S\d+〕/g; // 全局，用于扫描残留

const fail = (msg) => { console.error('[scrub] ' + msg); exit(1); };
const token = (i) => `〔S${String(i + 1).padStart(2, '0')}〕`;

function parseArgs() {
  let termsPath = 'tools/sensitive-terms.txt';
  const rest = [];
  for (const a of argv.slice(2)) {
    if (a.startsWith('--terms=')) termsPath = a.slice(8);
    else if (a.startsWith('-')) fail('未知参数：' + a);
    else rest.push(a);
  }
  return { cmd: rest[0], files: rest.slice(1), termsPath };
}

function loadTerms(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch { fail(`找不到术语表 ${path}。请人工创建：一行一个词，# 开头为注释。`); }
  const terms = [...new Set(raw.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')))];
  if (!terms.length) fail(`术语表 ${path} 为空，请人工填入词条后再用。`);
  for (const t of terms) if (TOKEN_LIKE.test(t)) fail('术语表内含占位符样式（〔S数字〕），会引起还原歧义。');
  return terms;
}

// 按"长词优先"的替换顺序统计实际命中数（短词不重复计入长词内部），与 scrub 的真实替换一致
function countHits(text, byLenDesc) {
  let rest = text;
  const counts = [];
  let total = 0;
  for (const [tok, term] of byLenDesc) {
    const n = rest.split(term).length - 1;
    if (n) { counts.push([tok, n]); total += n; rest = rest.replaceAll(term, tok); }
  }
  counts.reverse(); // 恢复按编号顺序展示
  return { counts, total };
}

const readOr = (f) => { try { return readFileSync(f, 'utf8'); } catch (e) { fail(`读取 ${f} 失败：${e.message}`); } };

function cmdCheck(files, termsPath) {
  const pairs = loadTerms(termsPath).map((t, i) => [token(i), t]);
  const byLenDesc = [...pairs].sort((a, b) => b[1].length - a[1].length);
  let grand = 0;
  for (const f of files) {
    const { counts, total } = countHits(readOr(f), byLenDesc);
    grand += total;
    const detail = total ? `${total} 处命中（${counts.map(([t, n]) => `${t}×${n}`).join(' ')}）` : '干净';
    console.log(`[scrub] ${f}：${detail}`);
  }
  exit(grand ? 2 : 0);
}

function cmdScrub(files, termsPath) {
  const pairs = loadTerms(termsPath).map((t, i) => [token(i), t]);
  // 长词优先替换，避免短词吃掉长词的前缀
  const byLenDesc = [...pairs].sort((a, b) => b[1].length - a[1].length);
  for (const f of files) {
    const text = readOr(f);
    const { counts, total } = countHits(text, byLenDesc);
    if (!total) { console.log(`[scrub] ${f}：干净，无需脱敏`); continue; }
    let out = text;
    for (const [tok, term] of byLenDesc) out = out.replaceAll(term, tok);
    const scrubPath = f + '.scrub';
    writeFileSync(scrubPath, out);
    writeFileSync(scrubPath + '.map', JSON.stringify({ file: f, terms: Object.fromEntries(pairs) }, null, 2));
    console.log(`[scrub] ${f} → ${scrubPath}（${total} 处：${counts.map(([t, n]) => `${t}×${n}`).join(' ')}）`);
  }
}

function cmdRestore([mapPath, scrubPath, outPath]) {
  if (!mapPath || !scrubPath || !outPath) fail('用法：restore <map> <scrubbed> <out>');
  const map = JSON.parse(readOr(mapPath));
  let text = readOr(scrubPath);
  const missing = [];
  for (const [tok, term] of Object.entries(map.terms || {})) {
    if (!text.includes(tok)) { missing.push(tok); continue; }
    text = text.replaceAll(tok, term);
  }
  writeFileSync(outPath, text);
  console.log(`[scrub] 还原完成 → ${outPath}`);
  if (missing.length) console.warn(`[scrub] 注意：${missing.join(' ')} 在编辑稿中已不存在（可能被删改）。`);
  const leftover = text.match(TOKEN_SCAN);
  if (leftover) console.warn(`[scrub] 注意：输出仍残留占位符 ${[...new Set(leftover)].join(' ')}，映射可能不匹配。`);
}

const { cmd, files, termsPath } = parseArgs();
if (cmd === 'check') cmdCheck(files, termsPath);
else if (cmd === 'scrub') cmdScrub(files, termsPath);
else if (cmd === 'restore') cmdRestore(files);
else fail('用法见文件头注释：check | scrub | restore');
