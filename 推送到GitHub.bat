@echo off
chcp 65001 >nul
title 推送到 GitHub
cd /d "%~dp0"

echo 正在检查本地代理（Clash 端口 7897）...
curl -s -x http://127.0.0.1:7897 --connect-timeout 5 -o nul https://github.com
if errorlevel 1 (
  echo.
  echo [X] 代理不通：github.com 直连会被墙，必须走本地代理。
  echo     请先确认 Clash（或同类代理软件）正在运行，再双击本脚本重试。
  echo     （之前报 "fail to receive handshake" 就是这个原因）
  pause & exit /b 1
)

echo 正在推送 main 分支到 GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo [X] 推送失败：
  echo     - 若提示 fetch first / rejected，说明云端有新提交，
  echo       先执行 git pull --rebase 再重开本脚本；
  echo     - 若提示连接错误，多为代理节点波动，稍等片刻重试。
  pause & exit /b 1
)
echo.
echo [OK] 已推送到 https://github.com/InfinityBqwq/dangdai-wenxue
pause
