@echo off
>nul chcp 65001
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [x] 没找到 node。请先装 Node LTS。
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
start "3178 本地壳" node packages\hostd\dist\cli.js join --port 3178 %*
rem 给壳两秒起服务，再开浏览器（ping 当睡眠用，timeout 在输入被重定向时会失败）
ping -n 3 127.0.0.1 >nul
start "" http://127.0.0.1:3178/
exit /b 0
