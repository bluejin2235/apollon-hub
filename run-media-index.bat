@echo off
setlocal
cd /d "%~dp0"
net use T: \\aiw\work >nul 2>&1
net use P: \\aiw\partners >nul 2>&1
echo ===== %date% %time% START %* =====>>media-index.log
npx tsx scripts/index-media.ts %*>>media-index.log 2>&1
echo ===== %date% %time% END exit=%errorlevel% =====>>media-index.log
endlocal
