@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
echo ==== %date% %time% ==== >> sync-log.txt
npm run sync >> sync-log.txt 2>&1
rem the other platforms through their APIs (skipped when none is switched on)
npm run apis >> sync-log.txt 2>&1
