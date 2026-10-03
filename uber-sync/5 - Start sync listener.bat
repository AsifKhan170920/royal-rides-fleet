@echo off
rem Keeps waiting for the "Sync now" button of the Fleet Ledger page. Leave this window open (or minimised).
cd /d "%~dp0"
if not exist node_modules call npm install
title Royal Rides sync listener
npm run listen
pause
