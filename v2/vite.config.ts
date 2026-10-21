import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const v2Dir = fileURLToPath(new URL('.', import.meta.url)) // …/dangdai-git/v2/
const repoRoot = path.resolve(v2Dir, '..') // 仓库根（旧版静态站所在）
const fontsDir = path.join(repoRoot, 'lib', 'fonts') // 霞鹜文楷（~32MB，勿复制进 v2/public、勿入 git）
const distFontsDir = path.join(v2Dir, 'dist', 'fonts')

const MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

/** 手动递归复制——勿用 cpSync：部分环境递归复制会静默崩进程（见仓库根 AGENTS.md 踩坑速查） */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

/**
 * 旧版字体插件：
 * - dev：/fonts/* 由中间件直读仓库根 lib/fonts（字体文件留在 git 内原位，零复制）；
 * - build：closeBundle 把 lib/fonts 递归复制到 dist/fonts（产物仅在 dist，不入库）。
 * style.css 内部以相对路径引用 ./files/*.woff2，/fonts/* 全量映射后自然成立。
 */
function legacyFonts(): Plugin {
  return {
    name: 'v2-legacy-fonts',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0])
        const file = path.resolve(fontsDir, '.' + rel)
        if (!file.startsWith(fontsDir + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
          return next()
        }
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (!fs.existsSync(fontsDir)) return
      copyDir(fontsDir, distFontsDir)
      console.log('[v2-legacy-fonts] lib/fonts → dist/fonts 复制完成')
    },
  }
}

export default defineConfig({
  plugins: [react(), legacyFonts()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 允许 dev server 直接读取仓库根 js/data.js / js/config.js（副作用引入，见 src/data/store.ts）
    fs: { allow: [repoRoot] },
  },
})
