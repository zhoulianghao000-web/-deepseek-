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
"%NODE_EXE%" "%~dp0scripts\launch.mjs"

set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" (echo 服务已正常退出。) else (echo 服务异常退出，代码 %EXITCODE%。)
pause
endlocal
