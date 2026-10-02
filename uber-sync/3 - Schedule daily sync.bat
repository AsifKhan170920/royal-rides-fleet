@echo off
rem Runs the Uber Sync every day at 06:00 under this Windows user.
schtasks /Create /F /SC DAILY /ST 06:00 /TN "Royal Rides Uber Sync" /TR "\"%~dp02 - Sync trips now.bat\""
echo.
echo Daily Uber Sync scheduled for 06:00. Remove it with: schtasks /Delete /TN "Royal Rides Uber Sync" /F
pause
