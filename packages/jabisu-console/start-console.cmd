@echo off
rem Starts the Jabisu free LLM console. Close this window to stop it.
chcp 65001 > nul
cd /d "%~dp0"
set NODE=node
where node > nul 2> nul || set NODE=C:\tools\node-24\node.exe
"%NODE%" --disable-warning=ExperimentalWarning src\main.ts
pause
