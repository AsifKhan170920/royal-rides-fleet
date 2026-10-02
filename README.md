# Royal Rides – Fleet Ledger

Fleet accounting for Royal Rides Limousine LLC: Uber trips, drivers, cars, investors, expenses, driver settlement, investor P&L, ledger and VAT.

**Live:** https://asifkhan170920.github.io/royal-rides-fleet/

## Sign-in and data
- Sign in with the **Fair Tax portal** account: the same user ID and password as the CRM, or the admin's Google sign-in. Signing in to the portal also signs you in here.
- Staff need **Fleet** access, which the admin ticks in the portal under *Users & access*.
- All data is in the portal's Firebase database under `apps/fleet/store/rr`. None of it is in this repository, which holds only the program.

## Uber Sync (daily trips from Uber Fleet Hub)
The `uber-sync` folder is a small program for the office PC. It needs Node.js and Google Chrome.

1. Copy `uber-sync/.env.example` to `uber-sync/.env` and fill in `PORTAL_USER` and `PORTAL_PASSWORD`. Use a portal user with Fleet access, for example a staff user called `uber-sync`.
2. Double-click **1 - Uber login (once).bat**. A Chrome window opens on Uber Fleet Hub. Sign in once, including the code Uber sends, and the login is kept in `uber-sync/profile`.
3. Double-click **2 - Sync trips now.bat**. It downloads the *Payments Transaction* report for the last `SYNC_DAYS` days into `DOWNLOAD_DIR`, then saves the trips in the Fleet Ledger. Trips already saved are skipped. Output goes to `uber-sync/sync-log.txt`.
4. Optional: **3 - Schedule daily sync.bat** runs step 3 every day at 06:00 with Windows Task Scheduler.

If Uber changes its pages and a report step can't be found, the window stays open. Download the report by hand (Reports → Generate report → Payments Transaction → Download) and the program picks the file up. You can also import any CSV with `npm run sync -- --file "path\to\file.csv"`, or drop it on the Import page.

Note: automating the Uber portal may conflict with Uber's terms. If Uber grants API access for the fleet, switch to that.
