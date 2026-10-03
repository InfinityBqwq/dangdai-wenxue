// 组装 Cloudflare Pages 部署目录：只复制上线白名单，其余本地文件（工具/文档/会话）不发布。
// 用法：node tools/deploy.mjs  → 产出 .deploy-tmp/，随后 wrangler pages deploy .deploy-tmp
// 注：本机 node v25 的 cpSync 复制目录会崩进程（access violation），故用 copyFileSync 手动递归。
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.deploy-tmp');

// 站点白名单：index.html 引用的资源全在这几处，新增顶层目录须同步此表。
// 404.html 有特定作用：Pages 检测到它后不再把未知路径回退成首页，而是返回真 404。
const whitelist = ['index.html', '404.html', 'css', 'js', 'lib'];

rmSync(out, { recursive: true, force: true });
let files = 0, bytes = 0;
const copy = (src, dest) => {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name), d = join(dest, name);
    if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copy(s, d); }
    else { copyFileSync(s, d); files++; bytes += statSync(s).size; }
  }
};
for (const item of whitelist) {
  const s = join(root, item), d = join(out, item);
  if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copy(s, d); }
  else { mkdirSync(dirname(d), { recursive: true }); copyFileSync(s, d); files++; bytes += statSync(s).size; }
}
console.log(`[deploy] 部署目录就绪：${out}`);
console.log(`[deploy] 共 ${files} 个文件，约 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
console.log('[deploy] 下一步：npx wrangler pages deploy .deploy-tmp --project-name=dangdai-wenxue');
