@echo off
setlocal
cd /d %~dp0
where node >/dev/null 2>/dev/null || (echo 没找到 node，先装 Node LTS 或解压绿色便携包 & pause & exit /b 1)
if not exist packageshostddistcli.js (echo 还没编译，先跑一次 npm run build & pause & exit /b 1)
node packageshostddistcli.js join --port 3178
start "" http://127.0.0.1:3178/
pause
