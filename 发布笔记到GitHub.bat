@echo off
chcp 65001 >nul
title 发布源笔记到 GitHub
cd /d "%~dp0"
echo 正在同步 Vault 源笔记到公开仓库...
node tools\publish-notes.mjs
if errorlevel 1 (
  echo 发布失败：请确认 Vault 路径存在、且本地代理（127.0.0.1:7897）已开启。
  pause & exit /b 1
)
echo.
echo 完成：https://github.com/InfinityBqwq/dangdai-wenxue-notes
pause
