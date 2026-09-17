@echo off
setlocal
cd /d "%~dp0"
net use T: \\aiw\work >nul 2>&1
net use P: \\aiw\partners >nul 2>&1
if not exist tmp mkdir tmp
echo ===== %date% %time% START %* =====>>tmp\nas-text-index.log
call npx --yes tsx --require ./scripts/stub-server-only.cjs scripts/index-nas-text.ts %*>>tmp\nas-text-index.log 2>&1
echo ===== %date% %time% END exit=%errorlevel% =====>>tmp\nas-text-index.log
endlocal
