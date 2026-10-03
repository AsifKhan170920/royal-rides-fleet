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
- **Payment machines → Upload statements**: drop statements from any provider (Network International, Magnati, Geidea…) as Excel or CSV, several at once. Title lines above the table and total rows are skipped. Machines are matched to the statement by terminal number (TID), ignoring leading zeros. Match the columns once (date, TID, amount, fee, reference, type) and the mapping is remembered. Declined rows are skipped, refunds and voids are negative, and unknown TIDs are added as new terminals.
- A card payment is credited to the driver holding the terminal on that day, because he did not keep that money as cash. The ledger posts it as Dr 1120 card receipts / Cr 2100 driver; the card fee goes to 5300. A payment on an unassigned terminal goes to 2150 until the terminal is assigned.
- **Reconciliation** per driver: Total payment = Payout from application + Card payment + Cash from driver + Difference. The difference is cash still with the driver. Click a driver to see each day; days with more card payments than cash trips are flagged.

## Bank & cash (cash and cash equivalents)

- **Bank & cash accounts**, like Manager.io's Bank and Cash Accounts: bank accounts (codes 1100–1109), cash accounts (1110–1119) and card network / merchant balances (1120–1129). 1100 Bank, 1110 Cash in hand and 1120 Card machine receipts always exist and can be renamed; more can be added with an opening balance as at the books start date.
- Click an account to see its ledger (money in, money out, running balance, export CSV). Every journal line is now dated, and the journal export uses those dates.
- **Inter-account transfers**: bank to bank, cash deposit, petty cash top-up, or a card network settling to the bank, with optional bank charges taken from the paying account.
- Each platform has a "Payouts paid into" account, and each payment machine has a "Payments go to" network account.

## Car and machine assignment

- Cars are assigned to drivers on the **Vehicles** page. Click a car to open two tabs: **Assignment history** (assign a driver with an effective date; see from / until for each driver) and **Ledger** (fares, platform fee, VAT, refunds, driver cost, expenses and investor share, with a running balance that ends at the company share).
- Payment machines are assigned on the **Machines** page. Click a machine to open two tabs: **Assignment history** (hand-over date) and **Transactions** (card payments with fee, net and running total).
- One car and one machine have one driver at a time. Earlier trips and card payments keep the earlier driver. The driver form shows the current car and machine automatically.

## Books (books.js), Manager.io style

- **Receipts** and **Payments**: received in / paid from a bank or cash account, with lines on any account and 5% VAT where needed. To settle an invoice, use 1200 / 2000 and pick the invoice. To pay or receive from a driver, use 2100 with the driver; this shows in the driver's ledger and settlement.
- **Sales invoices**: numbered automatically (INV-0001…), with due date from the customer's credit days, status (Due / Part paid / Overdue / Paid) and a tax invoice PDF.
- **Purchase invoices**: supplier's invoice number and due date.
- **Customers** and **Suppliers**: balances (1200 / 2000), opening balances and statements with unpaid invoices.
- **Journal entries**: balanced debit and credit lines; lines on 1200, 2000 or 2100 carry the customer, supplier or driver.
- All documents are stored as rows in entries/{month} and post to the journal, trial balance, VAT and bank ledgers.

## Driver page (drivers.js)

Drivers → click a driver. The separate settlement, driver ledger and car usage menus are replaced by five tabs:
- **Trip history**: the driver's trips in the period.
- **Transactions**: the driver's account. Trips are not listed one by one: each finalised salary is one credit (owed to the driver), each payment to him a debit, and money he hands over a credit. A running balance is kept, plus loans still to recover and the net position.
- **Salary**: under the computation, a table shows every advance, loan, visa and other recovery account (balance at start, instalment, extra recovered, repaid in cash, balance after). "Add to salary" recovers an extra amount in this salary (Dr 2100 / Cr 1170). Above it is the computation for the period (share, tips, cash, card, deductions, instalments, payments) and **Finalise**, which stores the record in `payroll`. Finalised periods cannot overlap. The record is compared with the current computation; payments made afterwards don't count as a change. "Reopen" removes a record, and "Pay" opens a salary payment.
- **Performance**: trips, net per day against the fleet average, rank, net per trip, km, cash share, completion, week by week and cars driven.
- **Accounts**: loans, salary advances, visa and other amounts. The driver pays 100% by default; a lower share is borne by the company as an expense. Recovered in monthly instalments.

## Payment and receipt with a driver

Choosing a driver as "Paid to" / "Received from" turns the form into a driver form, with a preview of the entry:
- Payment: salary / balance (Dr 2100 / Cr bank), salary advance, loan, visa or other expense for the driver (Dr 1170 driver share + Dr expense company share / Cr bank, recovered monthly Dr 2100 / Cr 1170), or other accounts.
- Receipt: cash handed over (Dr bank / Cr 2100), loan or advance repayment (Dr bank / Cr 1170), or other accounts.
- Any other payee works as before, with one line per account.

## Chart of accounts and financial statements

- **Chart of accounts**: all accounts grouped by type (1 assets, 2 liabilities, 3 equity, 4 income, 5 expenses), with opening and current balances and a ledger for each. Accounts can be added (collection `coa`, doc id = code), renamed, and given opening balances.
- **Financial statements**: profit & loss for the period, and a balance sheet at the period end (opening balances plus everything posted since the books start). Any gap shows as "opening balances not yet entered".

## Trip settlement

When a driver's salary is finalised, the ids of the trip rows it paid are stored on the payroll record (`rows`). A trip that arrives later with a date inside a finalised period is shown as **Missed** in the driver's Trip history. It is listed under "Unsettled trips from earlier periods" in the next salary computation, added to that salary, and settled when that period is finalised. Each trip shows its settlement status: settled (with the period), missed, or not settled yet.

## PDC cheques (pdc.js)

- **Accounts → PDC cheques** holds received and issued post-dated cheques: cheque no., bank, date, amount, customer / supplier / driver or a name, the bank account, and status (pending, cleared, bounced, cancelled).
- A PDC is a memo until its date; nothing is posted.
- When the cheque date arrives, a banner shows on every page. A browser notification can be switched on from the PDC page.
- "Record receipt" / "Record payment" opens the form filled in from the cheque (1200 for a customer, 2000 for a supplier, the driver form for a driver). Saving it marks the PDC cleared, with a link to the document.

## Employees (employees.js) and how staff costs are split

- **Drivers** are direct staff. Their earnings share or salary (5100) and their visas, permits and benefits (5280) are **cost of sales**, together with platform fees and vehicle running costs (5000–5289).
- **Employees** are office, operations and workshop staff. Their salaries post to **administrative expenses** by department (6000 administration, 6001 operations, 6002 workshop / other), with visa, Emirates ID & medical (6010), gratuity (6020) and leave salary & tickets (6030).
- Profit & loss: Revenue → Cost of sales → Gross profit → Administrative & general expenses → Operating profit → Investors' profit share → Net profit.
- **Employee payroll**: a monthly run (`emppay/{YYYY-MM}`) with unpaid days (gross ÷ 30), other deductions and advance recovery. Posting records Dr salaries / Cr 2110 Staff salaries payable at month end; a recovered advance moves from 1180 to 2110. Salaries and advances are paid from Payments with the employee as payee (2110 / 1180).
- **Visa & EID expiry**: passport, visa, Emirates ID, labour card, licence and medical expiry for drivers and employees. There is no separate menu; the dashboard lists what is expired or due, a banner shows on the other pages within the reminder window (Settings, default 30 days), and an optional browser notification can be switched on.
- **Employee offer letters**: drafted from the designation and salary breakdown, with UAE Labour Law terms; edited and downloaded as PDF like the driver letters.

## Driver salary statement (sections)

Drivers → driver → Salary shows one statement in sections. The same statement prints as a PDF with signature lines for the driver and the authorised signatory / partner.
1. **Performance**: trips, days, km, net per day against the fleet, net per trip, cash share, completion, rank.
2. **Earnings**: net of platform fee and VAT, per platform (Uber, Bolt…), plus other (direct) bookings.
3. **Direct expenditure**: fare-related costs charged to the driver (fuel, Salik, fines, repairs). Per driver (pay terms) they are either recovered in full after the salary, or deducted before the commission so the company carries its share (`expMode`).
4. **Salary calculation**: company fee / RTA fee per day, company share, salary + commission, tips, and **violation deductions** as a % of the salary (`drvAdj`, posted Dr 2100 / Cr 4210).
5. **Entitled to be paid**: salary less loan, advance, visa and other instalments (extra recoveries can be added), then the cash settlement and the balance payable.
6. **Cash reconciliation**: total receivable, less platform payments, other bookings received by the company, machine payments, cash handed over and cash in hand counted. The difference shows a shortage or excess.

The driver's **Transactions**: when a salary period is finalised, it adds "salary entitled" (credit) and, for the same period, the cash collected from riders and from direct bookings (debit) and the card payments on the company machine (credit). Payments and receipts are added as they happen.
