@echo off
chcp 65001 >nul
title 中国当代文学史 · 数字长卷
cd /d "%~dp0"
echo 正在重建数据（Vault 变更后运行本脚本即可同步）...
node tools\build-data.mjs
if errorlevel 1 (
  echo 数据重建失败，请检查 Node 是否安装。
  pause & exit /b 1
)
echo 正在启动本地服务器...
start "" "http://localhost:8080"
node tools\serve.mjs 8080
