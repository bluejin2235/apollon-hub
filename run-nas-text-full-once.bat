@echo off
setlocal
cd /d "%~dp0"
net use T: \\aiw\work >nul 2>&1
net use P: \\aiw\partners >nul 2>&1
if not exist tmp mkdir tmp
echo ===== %date% %time% FULL EXTRACT START =====>>tmp\nas-text-full.log
call npx --yes tsx --require ./scripts/stub-server-only.cjs scripts/index-nas-text.ts --purge-missing>>tmp\nas-text-full.log 2>&1
echo ===== %date% %time% FULL EXTRACT END exit=%errorlevel% =====>>tmp\nas-text-full.log
echo ===== %date% %time% FULL EMBED START =====>>tmp\nas-text-full.log
call npx --yes tsx --require ./scripts/stub-server-only.cjs scripts/embed-nas-chunks.ts --full>>tmp\nas-text-full.log 2>&1
echo ===== %date% %time% FULL EMBED END exit=%errorlevel% =====>>tmp\nas-text-full.log
endlocal
