@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
echo ==== %date% %time% platform APIs ==== >> sync-log.txt
npm run apis >> sync-log.txt 2>&1
