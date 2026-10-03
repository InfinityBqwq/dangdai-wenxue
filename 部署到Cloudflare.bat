@echo off
chcp 65001 >nul
title 部署到 Cloudflare Pages
cd /d "%~dp0"
echo 正在从 Vault 重建数据...
node tools\build-data.mjs
if errorlevel 1 (
  echo 数据重建失败，中断部署。请检查 Node 与 Vault 路径。
  pause & exit /b 1
)
echo 正在组装部署目录...
node tools\deploy.mjs
if errorlevel 1 (
  echo 组装失败，请检查 Node 是否安装。
  pause & exit /b 1
)
echo 正在上传到 Cloudflare Pages...
npx --yes wrangler@latest pages deploy .deploy-tmp --project-name=dangdai-wenxue --branch=main --commit-dirty=true
if errorlevel 1 (
  echo 部署失败：若提示未登录，请先运行 npx wrangler login 完成浏览器授权。
  pause & exit /b 1
)
echo.
echo 部署完成：https://dangdai-wenxue.pages.dev
pause
