@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 微信 AI 接入网关 - 一键启动

set "NODE_EXE="

rem 1) 优先使用包内自带的便携 Node 运行时（发行包 / 已放置 runtime 的开发目录）
if exist "%~dp0runtime\node\node.exe" set "NODE_EXE=%~dp0runtime\node\node.exe"

rem 2) 其次使用系统 PATH 中的 node
if not defined NODE_EXE (
  for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
)

rem 3) 再尝试常见的 Node 安装位置
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE (
  for /d %%D in ("%APPDATA%\nvm\v*") do if not defined NODE_EXE if exist "%%~fD\node.exe" set "NODE_EXE=%%~fD\node.exe"
)

if not defined NODE_EXE (
  echo.
  echo [错误] 未找到 Node.js 运行时。
  echo   方式一：安装 Node.js 18 及以上版本 ^(https://nodejs.org^) 后重试；
  echo   方式二：将便携版 Node 解压到本目录的 runtime\node\ 下 ^(需含 node.exe^)。
  echo.
  pause
  exit /b 1
)

echo 使用 Node: %NODE_EXE%
echo.
"%NODE_EXE%" "%~dp0scripts\launch.mjs"
set "EXITCODE=%ERRORLEVEL%"
echo.

rem 按退出码分流：仅失败路径才暂停等待（避免出现「Press any key to continue」时不知输入什么）
if "%EXITCODE%"=="3" goto :already_running
if "%EXITCODE%"=="0" goto :stopped
goto :failed

:already_running
echo 服务已在运行，管理控制台已打开。本窗口 3 秒后自动关闭。
rem 使用 ping 做延时：timeout 在 stdin 被重定向时会报错
ping -n 4 127.0.0.1 >nul
goto :end

:stopped
echo 服务已停止。本窗口 3 秒后自动关闭。
ping -n 4 127.0.0.1 >nul
goto :end

:failed
echo [失败] 启动未成功。请查看上方日志定位原因：
echo        缺少依赖 → 执行 npm install；
echo        缺少 Node → 安装 Node 18+ 或放置 runtime\node\；
echo        端口被占 → 结束占用 3000 端口的进程，或 set PORT=3100 后重试。
echo.
pause
goto :end

:end
rem 透传语义化退出码（3=已有实例 0=正常停止 其他=失败）；先展开变量再 endlocal
endlocal & exit /b %EXITCODE%
