@echo off
setlocal
cd /d "%~dp0"
echo ===== %date% %time% START %* =====>>tmp\nas-text-embed.log
if not exist tmp mkdir tmp
call npx --yes tsx --require ./scripts/stub-server-only.cjs scripts/embed-nas-chunks.ts %*>>tmp\nas-text-embed.log 2>&1
echo ===== %date% %time% END exit=%errorlevel% =====>>tmp\nas-text-embed.log
endlocal
