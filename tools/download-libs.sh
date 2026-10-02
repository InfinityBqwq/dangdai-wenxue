#!/bin/bash
# 下载本地化依赖 —— 多镜像重试，任一镜像成功即过
cd "$(dirname "$0")/../lib"

dl() {
  local out="$1"; shift
  for url in "$@"; do
    echo "[dl] $out <- $url"
    if curl -L --fail --silent --show-error --retry 2 --connect-timeout 20 -o "$out" "$url"; then
      local size=$(stat -c%s "$out" 2>/dev/null || echo 0)
      if [ "$size" -gt 1000 ]; then echo "[ok] $out ($size bytes)"; return 0; fi
    fi
    echo "[retry] $out failed from $url"
  done
  echo "[FAIL] $out"
  return 1
}

dl d3.min.js \
  "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js" \
  "https://unpkg.com/d3@7/dist/d3.min.js" \
  "https://registry.npmmirror.com/d3/7.9.0/files/dist/d3.min.js"

dl echarts.min.js \
  "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js" \
  "https://unpkg.com/echarts@5.5.1/dist/echarts.min.js" \
  "https://registry.npmmirror.com/echarts/5.5.1/files/dist/echarts.min.js"

dl marked.min.js \
  "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js" \
  "https://unpkg.com/marked@12.0.2/marked.min.js" \
  "https://registry.npmmirror.com/marked/12.0.2/files/marked.min.js"

dl china-geojson.js \
  "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json" \
  "https://raw.githubusercontent.com/echarts-maps/echarts-china-provinces-js/master/china.json"

# 中国地图备用源（省级简化版，文件更小）
dl china-geojson-alt.json \
  "https://geo.datav.aliyun.com/areas_v3/bound/100000.json" || true

# 霞鹜文楷字体（约 19MB，多源尝试）
mkdir -p fonts
dl fonts/LXGWWenKai-Regular.ttf \
  "https://cdn.jsdelivr.net/gh/lxgw/LxgwWenKai@v1.330/fonts/LXGWWenKai-Regular.ttf" \
  "https://github.com/lxgw/LxgwWenKai/releases/download/v1.330/LXGWWenKai-Regular.ttf" \
  "https://raw.githubusercontent.com/lxgw/LxgwWenKai/main/fonts/LXGWWenKai-Regular.ttf" \
  "https://registry.npmmirror.com/lxgw-wenkai-webfont/1.1.0/files/style.css" || true

# 若 ttf 失败但拿到了 webfont css，改下 woff2 整包
if [ ! -s "fonts/LXGWWenKai-Regular.ttf" ]; then
  rm -f "fonts/LXGWWenKai-Regular.ttf"
  dl fonts/LXGWWenKai-Medium.ttf \
    "https://github.com/lxgw/LxgwWenKai/releases/download/v1.330/LXGWWenKai-Medium.ttf" || true
fi

echo "=== DONE ==="
ls -la
