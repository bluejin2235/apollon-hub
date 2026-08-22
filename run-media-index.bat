@echo off
cd /d "%~dp0"
net use T: \\aiw\work
net use P: \\aiw\partners
npx tsx scripts/index-media.ts >> media-index.log 2>&1
