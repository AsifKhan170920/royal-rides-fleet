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
4. **Salary calculation**: company fee / RTA fee per day, company share, salary + commission, tips, and **violation deductions** as a fixed amount with a reason (`drvAdj`, posted Dr 2100 / Cr 4210).
5. **Entitled to be paid**: salary less loan, advance, visa and other instalments (extra recoveries can be added), then the cash settlement and the balance payable.
6. **Cash reconciliation**: total receivable, less platform payments, other bookings received by the company, machine payments, cash handed over and cash in hand counted. The difference shows a shortage or excess.

The driver's **Transactions**: when a salary period is finalised, it adds "salary entitled" (credit) and, for the same period, the cash collected from riders and from direct bookings (debit) and the card payments on the company machine (credit). Payments and receipts are added as they happen.

## Driver performance targets

- **General targets** (Settings, per month, all drivers): trips (default 300), days worked (25), distance (3,000 km) and completion (80%).
- **Own targets** (driver form): with "Own targets" on, the general targets don't apply to that driver. A blank box means no target for that measure.
- Trips, days and km are pro-rated to the selected period (a full month counts as 1); completion is not.
- Target against actual, with achieved % and met / not met, is shown on the driver's Performance tab, in section 1 of the salary statement (screen and PDF), and as "x of y" in the Drivers list.

## Choosing the trips for a salary

- Drivers → driver → **Trip history**: the period's unsettled trip rows have a tick box, all ticked by default ("Select all / Select none"). Untick a trip to leave it out of this salary; the salary statement and the finalised record use only the ticked trips. Choices are saved in `drvAdj/sel-<driver>-<from>-<to>`.
- A trip left out (or arriving later) stays unsettled. In a later period it is listed under **Unsettled trips from earlier periods**, unticked. Tick it to pay it in that salary, or leave it.
- Every trip (Trips page and Trip history) has **View / Edit / Delete**. Editing (with a reason, stored on the trip) and deleting are blocked for trips settled in a finalised salary; reopen that salary first.

## Pages and downloads

- Long lists show 50 rows a page, **newest first**, with Newest / Newer / Older / Oldest buttons. This covers the Trips page, the driver's Trip history and Transactions, a car's ledger, a machine's transactions, card payments and Expenses & payments.
- Every tab has **Download: Excel · PDF · CSV**, oldest first. Excel is a real .xlsx with numbers as numbers. PDF is a table on the company header (landscape for wide reports), with the header row on every page and page numbers; it is built with jsPDF + AutoTable, loaded on first use, so long lists take seconds. That includes trips; the driver's trips, transactions, salary statement, performance and accounts; a car's ledger and assignments; and a machine's transactions and assignments.

## Bulk salary statements

Drivers → **Bulk salary statements**: choose the dates on which salaries were finalised. All salaries finalised then are listed, with tick boxes. **Download statements PDF** gives one PDF with each driver's signing statement on its own page; each statement is worked out for its own period, including the earlier trips that salary settled. A summary (driver, period, trips, share, salary, balance, finalised on / by) downloads as Excel, PDF or CSV.

## Bulk salary finalisation

Drivers → **Bulk salary finalisation**: every driver's salary for the period at the top, with trips, earlier trips picked, salary due and status (Ready, Finalised, Part finalised, Pay terms needed, No trips). Ready drivers are ticked; **Finalise** (two clicks) finalises them one after the other, exactly as from each driver's Salary tab, using their trip selection. The list downloads as Excel, PDF or CSV.

## Vehicle purchase & finance (fleetfin.js)

Each car (Vehicles → car → **Purchase & finance**) records who owns it (company or investor), purchase date, price and dealer, and whether it was bought with full payment or bank finance. For bank finance it also records the bank, facility ID / number, loan, down payment (and who paid it), flat rate, tenure, monthly instalment (worked out from the flat rate if left blank), first due date and the paying bank account. It shows the instalment schedule (principal, profit, loan balance, paid / next) and downloads as Excel, PDF or CSV. The Vehicles list shows Bought with / Bank finance / Facility no.

Accounting (instalments are taken as paid on their due dates):
- Company car: Dr 1500 Motor vehicles / Cr bank (full payment), or Cr 2400 Vehicle finance loans + bank (down payment). Each instalment: Dr 2400 principal + Dr 5950 finance cost / Cr bank.
- Investor car on bank finance: Dr 1190 Investor vehicle finance / Cr 2400. Each instalment: Dr 2400 + Dr 1190 profit / Cr bank, recovered from the investor's earnings (Dr 2200 / Cr 1190). It shows in the Investor P&L as "Finance instalments recovered". A down payment the company made for him is also recoverable.
- Investor car on full payment: recorded on the car only.
- Cars bought before the books start bring their outstanding loan (and the investor receivable) in as opening balances.

## Vehicle profit & loss and depreciation

- Vehicles → car → **Profit & loss**: performance (trips, days in service, km, drivers, revenue per day / km, margin), revenue by platform, direct costs (driver cost and expenses by category), operating profit, the profit split (management fee, investor's share, company's share), the investor settlement (share less finance instalments) or company result (share less finance cost and depreciation), and the asset & finance position. It prints as a PDF with signature lines for the investor and the company, and downloads as Excel, PDF or CSV.
- **Repairs & maintenance borne by** (vehicle terms, dated): shared before the profit split (default), investor 100%, or company 100%.
- **Depreciation** applies to company-owned cars only: straight line over the useful life (default 5 years) to the residual value (default 20%), posted Dr 5285 / Cr 1510. Investor-owned cars are not the company's assets, so they are not depreciated even when registered in the company's name. The investor's share is a cost of sales (vehicle owner's share), not a finance cost.

### Vehicle P&L as a statement; supplier credit purchases
- Vehicles → car → Profit & loss is a proper statement: items in the first AED column, totals in the second, deductions in brackets (Revenue → Net revenue → Direct costs → Operating profit; company car: less depreciation and finance cost → Net profit for the period; investor car: Profit sharing and Investor settlement → Net payable to the investor). A memo "Vehicle & finance" block shows price, accumulated depreciation, book value, loan or supplier balance. The PDF download is the statement itself; Excel / CSV carry the same rows.
- Purchase & finance: the dealer / seller is picked from Suppliers. "Paid by" can be Supplier credit: Dr 1500 (or 1190 for an investor's car) / Cr 2000 Accounts payable for the price less the down payment, shown on the supplier's statement and balance. Pay the supplier from Payments → account 2000.
- Vehicle P&L has no profit-sharing lines: Revenue → Direct costs (platform fee & VAT, driver cost, fuel, Salik) → Gross profit → Expenses (repairs, fines, other expenses assigned to the car, management fee, finance cost, depreciation) → Net profit.
- Investor cars are carried in the company's books by default (Purchase & finance → "Investor's car – in the company's books?"): Dr 1500 Motor vehicles, depreciated like company cars; the investor's down payment / full payment and the instalment principal recovered from his earnings go to 2210 Investor funding of vehicles; the finance cost recovered from him is credited back to 5950. "No – investor's asset" keeps the old treatment (no depreciation, 1190 recoverable).

### Investor page
Investors → click the name: tabs Trips summary (his cars' trips by day / week / month, like the car ledger), Profit & share (per car: operating profit, management fee, his share; less bank instalments = net profit; Print / PDF with signatures; Finalise / Reopen, stored in `invpay`), Transactions (opening balance, finalised net profit as credit, payments to him as debits, money received from him as credit; "Pay investor" / "Receive from investor" open a Payment / Receipt on account 2200 with the investor as party). Expenses & payments also has "Received from investor". Investors can be chosen as party on Payments, Receipts and journal lines (account 2200 needs an investor).
- Car page: the Ledger tab is now "Trip summary" (trips by day / week / month: trips, fares, platform fee & VAT, tolls, driver cost, car expenses, operating profit, with totals).
- Investor terms "Management fee only – the rest of the profit to the investor": the company keeps only the management fee (fixed / % of revenue); the investor gets the operating profit after it. Investor page → Profit & share is a P&L statement for all his cars (Revenue → Direct costs → Gross profit → Expenses incl. management fee → Net profit → less company's share on % terms → less bank instalments → Net payable), with the car-wise table under it.
- PDF reports show amounts with thousands separators and dates as dd/mm/yyyy.
- Investors page: "Bulk profit finalisation" (every investor's net profit for the period at the top, tick and finalise) and "Bulk P&L statements" (profits finalised between two dates → one PDF, each investor's signing statement on its own page; Excel / CSV summary).

### Bank finance
Accounts → Bank finance lists every facility: auto loans from the cars (edited on the car) and business loans added here – short-term, long-term, overdraft / revolving facilities (auto loans = vehicle finance only, added from the car) (collection `loans`). The form takes the contract terms (amount, disbursement date and account, processing fee, method: reducing balance / flat / bullet, rate, tenure incl. any grace period, monthly / quarterly / half-yearly / yearly instalments, first due date, optional fixed instalment) and the schedule is worked out from them. Postings: disbursement Dr bank / Cr 2410 / 2420 / 2430 / 2400; fee Dr 5300; instalments Dr loan (principal) + Dr 5950 / Cr bank on the due dates; loans from before the books start open with their outstanding balance.
- Loans in the accounts: at every period end the principal due within 12 months moves to the current portion (2400 → 2405 vehicle finance, 2420 → 2425 business loans; short-term loans and overdrafts are current), and the interest / profit earned since the last instalment is accrued (Dr 5950 / 5955, Cr 2440 – the journal carries the change, so the balance is the accrual at the period end; investor cars excluded). The P&L shows Finance costs (5950 vehicle finance, 5955 business loans) below operating profit; the balance sheet groups assets and liabilities into current and non-current.

### RTA
Menu RTA (rta.js): Licences & permits (collection `rtalic`, expiry on the dashboard, "Pay fee" → expense 5250), Deposits (`rtadep`: Dr 1400 / Cr bank; refund or forfeit), PDC cheques to RTA (kept in PDC cheques, payee RTA), RTA fines (management fines on the company, 5225), Road fines (all cars, import a fines statement Excel / CSV matched by plate, check interval), Fees & charges (period's 5250 / 5225 / 5220 expenses). Each car has a "Road fines" tab: last checked date, "Check on RTA / Dubai Police" (opens the official site, plate copied), import, add / pay fines. Fines (`fines`) are accrued while unpaid (Dr 5220 / 5225, or 1170 when recoverable from the driver; Cr 2450); "Pay" records an expense per fine with car, driver and "recover from driver", so salary recovery works as for other expenses. The driver is the one assigned on the fine date (else the one with most trips in that car that day). Road fines are not fetched from the RTA website automatically – it has no public API and the enquiry needs interactive verification.

### Reminders & expiries
Overview → Reminders & expiries (reminders.js) gathers every deadline and expiry: staff documents (passport, visa, Emirates ID, labour card, licence / RTA permit, medical) of drivers and employees, car Mulkiya and insurance, the road-fines check, RTA licences & permits (own remind days) and RTA fines with a pay-by date, platform contract ends, pending PDC cheques, the next instalment of every bank loan and car finance, unpaid sales / purchase invoices by due date, and your own reminders (collection `reminders`: what, for whom, date, remind days before, repeats monthly / quarterly / half-yearly / yearly; "Done" rolls a repeating one forward). The dashboard shows "Deadlines & expiries", every page shows a banner for anything expired or due within 7 days, and a daily browser notification can be turned on. "Open" goes to the record to update it.

### Menu groups fold
The menu groups (Overview, People & cars, …) fold: opening one closes the others (remembered in the browser); the group of the current page is always open. On a phone the menu stays one scrolling row.

### Purchases & expenses
"Expenses & payments" is now "Purchases & expenses" (purchases.js) with tabs: All entries (the form and every entry), Purchases (other purchases), Fuel, Salik, EV charging, Receipts. Fuel / Salik / EV statements downloaded from their portals (Excel / CSV) are imported: columns recognised and changeable, header rows above the table skipped, matched to the car by plate and to the driver who had the car that day, duplicates skipped by transaction no. (`srcRef`), VAT included / separate / none, paid-from account, company cost or recover from driver, Salik grouped per car and day. Each row becomes an expense (5200 with `sub` fuel / ev, 5210 Salik) with quantity (litres / kWh / trips). Receipts (photo or PDF) can be attached to any expense: images are compressed; stored in `receipts` (file) and `rcptmeta` (index). Editing an entry keeps the fields the form does not show.
