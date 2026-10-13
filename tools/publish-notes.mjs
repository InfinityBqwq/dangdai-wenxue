// 同步 Vault 源笔记到公开仓库 D:\Planing\dangdai-wenxue-notes（github.com/InfinityBqwq/dangdai-wenxue-notes）。
// 用法：node tools/publish-notes.mjs [--no-push]
// 镜像语义 = 以 Vault 为准：先清空发布目录（保留 .git）再全量复制，删除/改名才会同步过去。
// 注：目录复制手动递归（本机 node v25 的 cpSync 会崩进程，见 deploy.mjs）。
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vaultDir = 'D:\\Doc\\Vault\\MARKING\\中国文学史'; // 与 build-data.mjs 同一数据源
const notesRepo = join(root, '..', 'dangdai-wenxue-notes');
const remote = 'https://github.com/InfinityBqwq/dangdai-wenxue-notes.git';
const proxy = 'http://127.0.0.1:7897'; // 本机 github.com 需走本地代理，换端口须同步改这里
const push = !process.argv.includes('--no-push');
// 略过 git 元数据与 Obsidian 本地缓存，不进公开仓库
const skip = new Set(['.git', '.obsidian', '.trash']);

if (!existsSync(vaultDir)) {
  console.error(`[notes] 找不到 Vault 目录：${vaultDir}`);
  process.exit(1);
}

if (!existsSync(join(notesRepo, '.git'))) {
  mkdirSync(notesRepo, { recursive: true });
  console.log('[notes] 首次运行：初始化发布仓库…');
  execFileSync('git', ['init', '-b', 'main'], { cwd: notesRepo, stdio: 'inherit' });
  execFileSync('git', ['config', 'http.proxy', proxy], { cwd: notesRepo, stdio: 'inherit' });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: notesRepo, stdio: 'inherit' });
}

let files = 0, bytes = 0;
const copy = (src, dest) => {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (skip.has(name)) continue;
    const s = join(src, name), d = join(dest, name);
    if (statSync(s).isDirectory()) copy(s, d);
    else { copyFileSync(s, d); files++; bytes += statSync(s).size; }
  }
};
for (const name of readdirSync(notesRepo)) {
  if (name !== '.git') rmSync(join(notesRepo, name), { recursive: true, force: true });
}
copy(vaultDir, notesRepo);
console.log(`[notes] 镜像完成：${files} 个文件，约 ${(bytes / 1024 / 1024).toFixed(1)} MB`);

const gitQuiet = (...a) => execFileSync('git', a, { cwd: notesRepo, encoding: 'utf8' }).trim();
const gitRun = (...a) => execFileSync('git', a, { cwd: notesRepo, stdio: 'inherit' });

if (!gitQuiet('status', '--porcelain')) {
  console.log('[notes] 笔记无变化，无需发布');
  process.exit(0);
}
gitRun('add', '-A');
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
gitRun('commit', '-m', `sync: Vault 源笔记同步 ${stamp}`);
if (!push) {
  console.log('[notes] --no-push：已停在本地提交');
  process.exit(0);
}
console.log('[notes] 推送到 GitHub…');
gitRun('push', '-u', 'origin', 'main');
console.log('[notes] 完成：https://github.com/InfinityBqwq/dangdai-wenxue-notes');
