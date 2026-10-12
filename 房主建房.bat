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
if not exist node_modules\ws (
  echo [x] 缺依赖。先在这个目录跑一次：npm install
  pause
  exit /b 1
)
if not exist packages\hostd\dist\cli.js (
  echo [x] 还没编译。先在这个目录跑一次：npm run build
  pause
  exit /b 1
)
start "3178 房主端" node packages\hostd\dist\cli.js host --port 3000 %*
exit /b 0
