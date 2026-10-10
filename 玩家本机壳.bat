@echo off
>nul chcp 65001
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [x] 没找到 node。请先装 Node LTS，或用绿色便携包那份（R1 还在做）。
  pause
  exit /b 1
)
if not exist packages\hostd\dist\cli.js (
  echo [x] 还没编译。先在这个目录跑一次：npm run build
  pause
  exit /b 1
)
echo 本地壳启动中：http://127.0.0.1:3178    （Ctrl+C 退出）
start "" http://127.0.0.1:3178/
node packages\hostd\dist\cli.js join --port 3178 %*
pause
