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

## Platforms & contracts

- **Platforms & contracts** keeps every platform or party the company works with (Uber, Bolt, Yango, YAY, Welcome Pickups, hotels, corporate clients): contract dates, a link to the signed contract, commission %, VAT on commission, payout cycle and credit days. Terms are dated, like driver and car terms.
- Each platform has its own receivable account: Uber 1150, Bolt 1151, Yango 1152, YAY 1153, Welcome Pickups 1154, then 1155 onwards for new parties.
- **Import trip data**: choose the platform first. Uber files are recognised automatically. For other platforms, match the columns once and the mapping is saved for that platform. The fee in each file is checked against the contract commission.
- **Driver & car usage**: trips are booked to the driver logged in to the driver app, and the car is the plate used on that trip. This page lists who drove which car and flags trips on cars that are not the driver's assigned car.

## Driver accounts, loans and collections

- **Driver ledger & loans** shows a running account per driver from the ledger start date (Settings), with an opening balance per driver. It includes earnings share, tips, cash collected from riders, advances, payments, charges, company costs paid from the driver's cash, and loan instalments. Positive = the company owes the driver.
- **Loans, salary advances and shared costs** (e.g. visa: company 50%, driver 50%) are recovered in monthly instalments on the last day of each month until paid. Cash repayments shorten the plan. The ledger uses account 1170 Driver loans & recoverables.
- **Paid from "Driver's cash"** on an expense or direct booking puts it on the driver's account instead of the bank. "Card machine" receipts sit in 1120 until a "Card machine settlement to bank" entry.
- **Collections & cash** shows what each platform collected in the app, the cash drivers kept, what is still due from each platform, trips by payment type, and the cash still held by each driver.

## Card terminals and reconciliation

- **Card terminals**: each payment machine has its terminal ID (TID) and a dated driver assignment. When a machine moves to another driver, save the new driver with the date; earlier payments stay with the earlier driver.
- **Import trip data → Card terminal statement**: drop the terminal statement CSV from the bank / provider. Match the columns once (date, TID, amount, fee, reference, type) and the mapping is remembered. Declined rows are skipped, refunds and voids are negative, and unknown TIDs are added as new terminals.
- A card payment is credited to the driver holding the terminal on that day, because he did not keep that money as cash. The ledger posts it as Dr 1120 card receipts / Cr 2100 driver; the card fee goes to 5300. A payment on an unassigned terminal goes to 2150 until the terminal is assigned.
- **Reconciliation** per driver: Total payment = Payout from application + Card payment + Cash from driver + Difference. The difference is cash still with the driver. Click a driver to see each day; days with more card payments than cash trips are flagged.
