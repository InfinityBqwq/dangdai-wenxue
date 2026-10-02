@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在从 Vault 重建数据...
node tools\build-data.mjs
pause
