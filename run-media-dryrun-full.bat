@echo off
setlocal
cd /d "%~dp0"
net use T: \\aiw\work >nul 2>&1
net use P: \\aiw\partners >nul 2>&1
echo ===== %date% %time% START dry-run-full =====>>media-index.log
npx tsx scripts/index-media.ts --dry-run>>media-index.log 2>&1
echo ===== %date% %time% END dry-run exit=%errorlevel% =====>>media-index.log
endlocal
