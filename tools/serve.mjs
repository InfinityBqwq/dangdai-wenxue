/* 零依赖静态服务器：node tools/serve.mjs [端口]
   · gzip：文本类资源按 Accept-Encoding 压缩，结果按 路径+mtime 缓存
   · 缓存策略：lib/（第三方库与字体，改动罕见）→ max-age=86400；
     应用自身文件 no-store，改动即生效 */
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const PORT = +(process.argv[2] || 8080);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.md']);
const COMPRESS_MAX = 12 * 1024 * 1024;      // 超大文件直接流式,不压
const gzipCache = new Map();                // file -> {mtimeMs, buf}

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('Not Found'); return;
  }
  const ext = path.extname(file);
  // 缓存策略:lib/ 内容稳定走长缓存;应用文件 no-store,改动即生效
  const rel = path.relative(ROOT, file);
  const cacheCtl = rel === 'lib' || rel.startsWith('lib' + path.sep)
    ? 'public, max-age=86400'
    : 'no-store';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheCtl,
  };
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404).end('Not Found'); return; }
    const accept = req.headers['accept-encoding'] || '';
    if (COMPRESSIBLE.has(ext) && st.size <= COMPRESS_MAX && /\bgzip\b/.test(accept)) {
      let gz = gzipCache.get(file);
      if (!gz || gz.mtimeMs !== st.mtimeMs) {
        gz = { mtimeMs: st.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(file), { level: 6 }) };
        gzipCache.set(file, gz);
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = gz.buf.length;
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(200, headers);
      res.end(gz.buf);
    } else {
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(PORT, () => {
  console.log(`✦ 中国当代文学史数字长卷 → http://localhost:${PORT}（gzip + lib 长缓存）`);
});
