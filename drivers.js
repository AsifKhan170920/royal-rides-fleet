/* Driver page (Drivers → click a driver): Trip history, Transactions, Salary, Performance and Accounts.
   Salary: the computation for the period at the top; "Finalise" stores it in the payroll collection
   (one record per driver and period). Finalised periods cannot overlap, so a period is paid once.
   Accounts: loans, salary advances, visa and other amounts recovered from the driver, 100% his share
   unless a lower share is entered (the company bears the rest as an expense). */
const DRV_TABS = {trips:"Trip history", tx:"Transactions", salary:"Salary", perf:"Performance", accts:"Accounts"};
const histKey = () => setting("ledgerStart", "2026-09-01") + "|" + S.to;
function historyReady(){
  if(!S.db) return false;
  if(!S.ledger || S.ledger.key !== histKey()){ loadLedger(); return false; }
  return !S.ledger.loading && !S.ledger.error;
}

function driverDetail(id){
  const d = S.drivers[id], tab = DRV_TABS[S.drvTab] ? S.drvTab : "trips", today = iso(new Date());
  const car = vehAt(id, today), m = machineAt(id, today), tm = termAt(termList(d, DRV_TERMS), today);
  S.ledgerDriver = id;
  const body = tab === "trips" ? dTrips(id) : tab === "tx" ? dTx(id) : tab === "salary" ? dSalary(id) : tab === "perf" ? dPerf(id) : dAccts(id);
  return `<div class="section"><div class="head"><div><h2>${esc(d.name)}${d.code ? ` <span class="mono small muted">${esc(d.code)}</span>` : ""}</h2>
    <p class="sub">${esc(drvTermTextFull(tm))} · Car ${car ? esc(vName(car)) : "—"} · Machine ${m ? esc(m.name || m.tid) : "—"}${d.phone ? " · " + esc(d.phone) : ""}</p></div>
    <div class="row"><button class="btn ghost" data-drvview="">← All drivers</button><button class="btn" data-edit="driver" data-id="${esc(id)}">Edit driver</button><button class="btn" data-offerfor="${esc(id)}">Offer letter</button></div></div>
  ${tabBtns("data-drvtab", tab, DRV_TABS)}${body}</div>`;
}

/* ---------- trip history ---------- */
function dTrips(id){
  const rows = S.trips.filter(t => t.dr === id && (t.tr || t.f || t.sf || t.tp || t.c || t.rf || t.oe));
  if(!rows.length) return `<div class="empty"><b>No trips in this period</b>Change the dates at the top, or import the platform reports.</div>`;
  const multi = new Set(rows.map(plOf)).size > 1, shown = rows.slice(0, 500), net = t => (t.f||0) - (t.sf||0) - (t.tx||0);
  const sm = settledMap(id), runs = Object.values(S.payroll).filter(p => p.driverId === id);
  return `<div class="tbl"><table><thead><tr><th>Date</th><th>Time</th>${multi ? "<th>Platform</th>" : ""}<th>Car</th><th class="num">Fare</th><th class="num">Fee + VAT</th><th class="num">Tips</th><th class="num">Refunds</th><th class="num">Cash</th><th class="num">Net</th><th class="num">Km</th><th>Status</th><th>Payment</th><th>Settlement</th></tr></thead><tbody>
  ${shown.map(t => `<tr><td>${esc(dmyS(t.d))}</td><td>${esc(t.t || "")}</td>${multi ? `<td>${esc(pName(plOf(t)))}</td>` : ""}<td>${esc(vName(vehicleForTrip(t) || "unassigned"))}</td><td class="num">${fmt(t.f)}</td><td class="num">${fmt((t.sf||0) + (t.tx||0))}</td><td class="num">${fmt(t.tp)}</td><td class="num">${fmt(t.rf)}</td><td class="num">${fmt(t.c)}</td><td class="num">${fmt(net(t))}</td><td class="num">${t.km ? fmt(t.km) : ""}</td><td class="small">${esc((t.st || "").replace(/_/g, " "))}</td><td class="small">${esc(t.pay || (t.c ? "cash" : ""))}</td><td>${settleBadge(t)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="${multi ? 4 : 3}">${new Set(rows.map(t => t.tr || t.id)).size} trips${rows.length > 500 ? " – first 500 rows shown" : ""}</td><td class="num">${fmt(sum(rows, t => t.f))}</td><td class="num">${fmt(sum(rows, t => (t.sf||0) + (t.tx||0)))}</td><td class="num">${fmt(sum(rows, t => t.tp))}</td><td class="num">${fmt(sum(rows, t => t.rf))}</td><td class="num">${fmt(sum(rows, t => t.c))}</td><td class="num">${fmt(sum(rows, net))}</td><td class="num">${fmt(sum(rows, t => t.km))}</td><td colspan="2"></td><td class="small">${rows.filter(t => moneyRow(t) && settleStatus(t).ok).length} settled · ${rows.filter(t => moneyRow(t) && !settleStatus(t).ok).length} unsettled</td></tr></tfoot></table></div>`;
}

/* ---------- transactions (the driver's account) ---------- */
/* Trips are not listed one by one: a salary period, once finalised, is credited to the driver as one line
   (what the company owes him), and every payment to him is a debit; money he hands over is a credit. */
function drvTx(id){
  const d = S.drivers[id] || {}, ents = (S.ledger && S.ledger.entries) || [], lines = [];
  Object.values(S.payroll).filter(p => p.driverId === id && p.to <= S.to).forEach(p => {
    const v = num(p.salary != null ? p.salary : salaryOf(p));
    lines.push({date: p.to, desc: `Salary ${dmyS(p.from)} – ${dmyS(p.to)} (finalised, ${p.n || 0} trips${p.late && p.late.length ? ` + ${p.late.length} earlier` : ""})`, ...(v >= 0 ? {cr: v} : {dr: -v}), sal: true});
  });
  ents.filter(e => e.driverId === id).forEach(e => { const a = num(e.amount), n = e.note ? " – " + e.note : "";
    if(e.type === "driver_payment") lines.push({date: e.date, desc: "Payment to driver" + n, dr: a});
    else if(e.type === "driver_receipt") lines.push({date: e.date, desc: "Received from driver" + n, cr: a}); });
  if(window.BOOKS) BOOKS.driverLines(ents, id).forEach(l => lines.push({...l}));
  lines.sort((a,b) => a.date.localeCompare(b.date) || (b.sal ? 1 : 0) - (a.sal ? 1 : 0));
  let bal = num(d.openingBalance), before = bal; const open = bal, shown = [];
  lines.forEach(l => { bal = r2(bal + (l.cr || 0) - (l.dr || 0)); l.bal = bal; if(l.date < S.from) before = bal; else shown.push(l); });
  return {open, before, shown, closing: bal};
}
const drvBalance = id => historyReady() ? drvTx(id).closing : null;
function dTx(id){
  if(!historyReady()) return `<p class="sub">${S.ledger && S.ledger.error ? "Couldn't load the history. Change the dates to retry." : "Loading the driver's account…"}</p>`;
  const T = drvTx(id), start = setting("ledgerStart", "2026-09-01");
  const loanOut = sum(Object.values(S.ditems).filter(it => it.driverId === id), it => itemOutstanding(it, S.to));
  const fin = Object.values(S.payroll).some(p => p.driverId === id && p.from <= S.to && p.to >= S.from);
  const x = compute().D[id], late = lateTrips(id) || [], pending = x ? r2(salaryOf(x) + sum(late, tripEffect)) : 0;
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">The driver's account from ${esc(dmyS(start))}: each finalised salary is a credit (owed to him), each payment a debit. Positive balance = the company owes the driver.</span><button class="btn" id="expLedger">Export CSV</button></div>
  ${!fin && (x && (x.n || x.inst || x.adv) || late.length) ? `<div class="banner">The salary for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))} is not finalised yet (AED ${fmt(pending)} so far), so it is not in this account. <button class="btn sm" data-drvtab="salary">Open Salary</button></div>` : ""}
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit (paid to driver)</th><th class="num">Credit (salary due)</th><th class="num">Balance</th></tr></thead><tbody>
  <tr><td>${esc(dmyS(S.from < start ? start : S.from))}</td><td><b>${S.from <= start ? "Opening balance" : "Balance brought forward"}</b></td><td></td><td></td><td class="num"><b>${aed(S.from <= start ? T.open : T.before)}</b></td></tr>
  ${T.shown.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${l.sal ? "<b>" + esc(l.desc) + "</b>" : esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No finalised salary or payment in this period.</td></tr>`}
  </tbody><tfoot><tr><td colspan="2">Balance ${esc(dmyS(S.to))} – ${T.closing >= 0 ? "payable to the driver" : "the driver owes the company"}</td><td class="num">${fmt(sum(T.shown, l => l.dr))}</td><td class="num">${fmt(sum(T.shown, l => l.cr))}</td><td class="num"><b>${aed(T.closing)}</b></td></tr></tfoot></table></div>
  <div class="row" style="margin-top:10px;gap:18px"><span>Salary account <b class="mono">${fmt(T.closing)}</b></span><span>Loans & advances still to recover <b class="mono">${fmt(loanOut)}</b></span><span>Net position <b class="mono ${T.closing - loanOut < 0 ? "neg" : ""}">${fmt(T.closing - loanOut)}</b></span></div>`;
}

/* ---------- recoveries shown under the salary computation ---------- */
function recovTbl(id, locked){
  const items = Object.values(S.ditems).filter(it => it.driverId === id && (itemOutstanding(it, addDays(S.from, -1)) > 0.004 || itemPlan(it).inst.some(x => x.date >= S.from && x.date <= S.to) || (it.repayments || []).some(r => r.date >= S.from && r.date <= S.to)));
  const fines = S.entries.filter(e => e.driverId === id && e.type === "expense" && e.recover);
  if(!items.length && !fines.length) return "";
  const rows = items.map(it => {
    const before = it.date > addDays(S.from, -1) ? 0 : itemOutstanding(it, addDays(S.from, -1)), given = it.date >= S.from && it.date <= S.to ? num(it.driverAmount) : 0;
    const sched = sum(itemPlan(it).inst.filter(x => x.date >= S.from && x.date <= S.to), x => x.amt), extra = sum((it.repayments || []).filter(r => r.paidTo === "2100" && r.date >= S.from && r.date <= S.to), r => num(r.amount));
    const cash = sum((it.repayments || []).filter(r => r.paidTo !== "2100" && r.date >= S.from && r.date <= S.to), r => num(r.amount)), after = itemOutstanding(it, S.to);
    return `<tr><td>${esc(ITEM_KINDS[it.kind] || "")}${it.desc ? ` <span class="small muted">${esc(it.desc)}</span>` : ""}</td><td class="num">${fmt(before + given)}</td><td class="num">${fmt(sched)}</td><td class="num">${extra ? fmt(extra) : ""}</td><td class="num">${cash ? fmt(cash) : ""}</td><td class="num"><b>${fmt(after)}</b></td>
      <td>${!locked && after > 0.004 && S.canWrite ? `<div class="row" style="gap:4px;flex-wrap:nowrap"><input type="number" step="0.01" data-recov="${esc(it.id)}" placeholder="${r2(after)}" style="width:90px;text-align:right" aria-label="Amount to recover"><button class="btn sm" data-recadd="${esc(it.id)}">Add to salary</button></div>` : ""}</td></tr>`;
  }).join("");
  return `<h2 style="margin-top:16px">Advances, loans & other recoveries</h2><p class="sub">Balances of the driver's accounts. The monthly instalments are already in the computation above; to recover more in this salary, enter the amount and click “Add to salary”.</p>
  <div class="tbl"><table><thead><tr><th>Account</th><th class="num">Balance at start</th><th class="num">Instalment this period</th><th class="num">Extra recovered</th><th class="num">Repaid in cash</th><th class="num">Balance after</th><th></th></tr></thead><tbody>${rows}
  ${fines.length ? `<tr><td>Fines / tolls charged to the driver (${fines.length})</td><td></td><td class="num">${fmt(sum(fines, e => num(e.amount) + num(e.vat)))}</td><td></td><td></td><td></td><td class="small muted">in the computation</td></tr>` : ""}
  </tbody></table></div>`;
}

/* ---------- salary ---------- */
/* Trip settlement: finalising a period stores the ids of the trip rows it paid (payroll.rows). A trip that
   arrives later with a date inside a finalised period (platform reports are by date and time, so a trip
   can be missed) is "unsettled": it is listed under the next salary computation and settled there. */
const salaryOf = x => r2(num(x.balance) - num(x.books) + num(x.paid) - num(x.recv));
const moneyRow = t => !!(t.f || t.sf || t.tx || t.tp || t.c || t.rf);
// what one trip row adds to the driver's salary: his share of the net, tips, less the cash he kept
function tripEffect(t){
  const tm = termAt(termList(S.drivers[t.dr] || {}, DRV_TERMS), t.d) || {}, model = tm.payModel || "commission", net = (t.f||0) - (t.sf||0) - (t.tx||0);
  const share = (model === "commission" || model === "salary_comm") ? net * num(tm.commissionPct) / 100 : model === "rent" ? net : 0;
  return share + (setting("tipsToDriver", true) ? (t.tp || 0) : 0) - (t.c || 0);   // not rounded per trip, so sums match the computation
}
function settledMap(id){ const m = {}; Object.values(S.payroll).filter(p => p.driverId === id).forEach(p => (p.rows || []).forEach(r => m[r] = p)); return m; }
// trips dated inside a finalised period (one that recorded its trips) but not settled by any period
function lateTrips(id){
  if(!historyReady()) return null;
  const runs = Object.values(S.payroll).filter(p => p.driverId === id && Array.isArray(p.rows)), sm = settledMap(id);
  return S.ledger.trips.filter(t => t.dr === id && moneyRow(t) && t.d < S.from && !sm[t.id] && runs.some(p => t.d >= p.from && t.d <= p.to)).sort((a,b) => (a.d + a.t).localeCompare(b.d + b.t));
}
// settlement status of a trip row: green when a finalised salary paid it, red when not (yet)
let _sc = null;
function settleIndex(){
  if(_sc && _sc.p === S.payroll) return _sc;
  const rows = {}, runs = {}; Object.values(S.payroll).forEach(p => { (p.rows || []).forEach(r => rows[r] = p); (runs[p.driverId] ||= []).push(p); });
  return _sc = {p: S.payroll, rows, runs};
}
function settleStatus(t){
  const I = settleIndex(), p = I.rows[t.id]; if(p) return {ok: true, p};
  const mine = I.runs[t.dr] || [], old = mine.find(r => !Array.isArray(r.rows) && t.d >= r.from && t.d <= r.to);   // finalised before trips were recorded
  if(old) return {ok: true, p: old};
  return {ok: false, missed: mine.some(r => Array.isArray(r.rows) && t.d >= r.from && t.d <= r.to)};
}
function settleBadge(t){
  if(!moneyRow(t)) return ""; const s = settleStatus(t);
  return s.ok ? `<span class="pill good" title="Paid in the salary for ${dmyS(s.p.from)} – ${dmyS(s.p.to)}">Settled ${esc(dmyS(s.p.from))}–${esc(dmyS(s.p.to))}</span>`
    : `<span class="pill bad" title="${s.missed ? "Arrived after its period was finalised – goes to the next salary" : "Not in a finalised salary yet"}">Unsettled${s.missed ? " – missed, next salary" : ""}</span>`;
}
window.settleBadge = settleBadge; window.settleStatus = settleStatus;
function dSalary(id){
  const C = compute(), x = C.D[id] || {n:0, fare:0, fee:0, tax:0, net:0, ent:0, tipsDue:0, cash:0, card:0, deduct:0, adv:0, inst:0, viaDriver:0, books:0, paid:0, recv:0, balance:0, daysWorked:0, rentDays:0};
  const runs = Object.values(S.payroll).filter(p => p.driverId === id).sort((a,b) => b.from.localeCompare(a.from));
  const overlap = runs.find(p => p.from <= S.to && p.to >= S.from), same = runs.find(p => p.from === S.from && p.to === S.to);
  const next = runs.length ? addDays(runs[0].to, 1) : null, ready = historyReady(), T = ready ? drvTx(id) : null;
  // late trips: settled by this period unless it is already finalised (then they were settled by it, or wait for the next)
  const late = same ? [] : (lateTrips(id) || []), lateEff = r2(sum(late, tripEffect)), sal = r2(salaryOf(x) + lateEff);
  const payable = T ? r2(T.before + sal + (x.balance - salaryOf(x))) : null;
  /* The computation, laid out as a driver ledger: income by platform, the company's charges, the driver's
     salary + commission, tips, deductions, the cash he collected, and what is due. Below it: fare receipts. */
  const ln = (label, v, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td style="white-space:normal">${label}</td><td class="num">${v == null ? "" : aed(v)}</td></tr>`;
  const head = t => `<tr><td colspan="2" style="background:var(--bg)"><b>${t}</b></td></tr>`;
  const mine = S.trips.filter(t => t.dr === id), byPl = {};
  mine.forEach(t => { const b = byPl[plOf(t)] ||= {f:0, fee:0, tp:0, rf:0, c:0, n:new Set()}; b.f += t.f||0; b.fee += (t.sf||0) + (t.tx||0); b.tp += t.tp||0; b.rf += t.rf||0; b.c += t.c||0; if(t.tr || t.f) b.n.add(t.tr || t.id); });
  const income = r2(x.net + num(x.other)), tm = termAt(termList(S.drivers[id] || {}, DRV_TERMS), S.to) || {};
  const rentAmt = num(x.rentAmt), rta = num(x.rta), coShare = r2(income - x.ent - rta - rentAmt);
  const recov = S.entries.filter(e => e.driverId === id && e.type === "expense" && e.recover), byCat = {};
  recov.forEach(e => byCat[e.category || "5310"] = (byCat[e.category || "5310"] || 0) + num(e.amount) + num(e.vat));
  const items = Object.values(S.ditems).filter(it => it.driverId === id).map(it => ({it, amt: sum(itemPlan(it).inst.filter(q => q.date >= S.from && q.date <= S.to), q => q.amt) + sum((it.repayments || []).filter(r => r.paidTo === "2100" && r.date >= S.from && r.date <= S.to), r => num(r.amount))})).filter(o => o.amt);
  // cash the driver took for direct bookings belongs in the cash settlement; costs he paid from his cash are a credit
  const viaInc = sum(S.entries.filter(e => e.driverId === id && e.type === "income" && e.paidFrom === "driver"), e => num(e.amount) + num(e.vat)), viaExp = r2(x.viaDriver + viaInc);
  const earned = r2(x.ent + x.tipsDue - x.deduct - x.adv - x.inst + viaExp);
  const rows = [
    head(`Income <span class="small muted">(net of platform fee & VAT) · ${x.n} trips · ${x.daysWorked || 0} days</span>`),
    ...Object.entries(byPl).sort((p, q) => q[1].f - p[1].f).map(([k, b]) => ln(`${esc(pName(k))} <span class="small muted">${b.n.size} trips · fares ${fmt(b.f)} − fee & VAT ${fmt(b.fee)}</span>`, b.f - b.fee)),
    num(x.other) ? ln("Other bookings (direct)", x.other) : "",
    ln("<b>Total income</b>", income, "tot"),
    head("Company charges"),
    rentAmt ? ln(`Company fee (${x.rentDays} days × ${fmt(num(tm.rentPerDay))})`, -rentAmt) : "",
    rta ? ln(`RTA / permit fee (${x.rtaDays} days × ${fmt(num(tm.rtaPerDay))})`, -rta) : "",
    Math.abs(coShare) > 0.004 ? ln(tm.payModel === "salary" ? "Company share (driver on fixed salary)" : `Company share (${r2(100 - num(tm.commissionPct))}%)`, -coShare) : "",
    ln(`<b>Driver salary + commission</b> – ${esc(x.termsText || "no terms")}`, x.ent, "tot"),
    x.tipsDue ? ln("Tips from platforms", x.tipsDue) : "",
    (recov.length || items.length || x.adv || viaExp) ? head("Deductions") : "",
    ...Object.entries(byCat).map(([c, v]) => ln(esc(EXP_CATS[c] || "Expense") + " (charged to the driver)", -v)),
    ...items.map(o => ln(`${esc(ITEM_KINDS[o.it.kind] || "Recovery")}${o.it.desc ? " – " + esc(o.it.desc) : ""} instalment`, -o.amt)),
    x.adv ? ln("Advances (deducted in full)", -x.adv) : "",
    viaExp ? ln("Company costs paid from the driver's cash", viaExp) : "",
    ln("<b>Net salary earned</b>", earned, "tot"),
    head("Cash settlement"),
    ln("Cash collected from riders (with the driver)", -x.cash),
    viaInc ? ln("Cash from direct bookings (with the driver)", -viaInc) : "",
    x.card ? ln("Card payments on the company machine", x.card) : "",
    late.length ? ln(`Unsettled trips from earlier periods (${late.length}) – see below`, lateEff) : "",
    ln("<b>Salary due for the period</b>", sal, "tot"),
    (x.books || x.paid || x.recv) ? ln("Paid to / received from the driver in the period", r2(x.balance - salaryOf(x))) : "",
    T ? ln("Balance brought forward (finalised salaries less payments)", T.before) : "",
    T ? ln(`<b>${payable >= 0 ? "Payable to the driver" : "Driver owes the company"} at ${esc(dmyS(S.to))}</b>`, payable, "tot") : ""].join("");
  // fare receipts: everything riders paid for his trips, and where that money is now
  const inc = sum(S.entries.filter(e => e.driverId === id && e.type === "income" && e.paidFrom === "driver"), e => num(e.amount) + num(e.vat));
  const handed = x.recv + sum(S.entries.filter(e => e.driverId === id && e.type === "expense" && e.paidFrom === "driver"), e => num(e.amount) + num(e.vat));
  const otherGross = sum(S.entries.filter(e => e.driverId === id && e.type === "income"), e => num(e.amount) + num(e.vat));
  const receivable = r2(x.fare + x.tip + x.ref + otherGross), app = r2(x.fare + x.tip + x.ref - x.cash), otherNonCash = r2(otherGross - inc);
  const withDriver = r2(x.cash + inc - x.card), diff = r2(withDriver - handed);
  const recon = `<h2 style="margin-top:16px">Fare receipts reconciliation</h2><p class="sub">What riders paid for this driver's trips (and his direct bookings), and where the money is.</p>
    <div class="tbl"><table><tbody>
    ${ln("<b>Total receivable</b> – fares, tips & tolls of his trips + other bookings", receivable, "tot")}
    ${ln("Received through platform payouts (paid in the app)", -app)}
    ${otherNonCash > 0.004 ? ln("Other bookings received by the company (bank / card)", -otherNonCash) : ""}
    ${ln("Machine payments (card on the company machine)", -x.card)}
    ${ln("<b>Cash with the driver</b>", withDriver, "tot")}
    ${ln("Handed over / spent for the company", -handed)}
    ${ln(`<b>Difference</b> – ${diff > 0.004 ? "cash still with the driver" : diff < -0.004 ? "more handed over / card than cash collected" : "fully accounted for"}`, diff, "tot")}
    </tbody></table></div><p class="small muted" style="margin-top:6px">Platform payouts come to the company as one transfer for all drivers – see Collections & cash for what each platform has paid. The cash with the driver is deducted in the salary above; what he hands over is credited to his account.</p>`;
  const lateTbl = late.length ? `<h2 style="margin-top:16px">Unsettled trips from earlier periods</h2><p class="sub">These trips are dated in a period that was already finalised, but they were not part of it (they arrived in a later report). They are added to this salary and settled when you finalise.</p>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Time</th><th>Trip</th><th class="num">Fare</th><th class="num">Net</th><th class="num">Tips</th><th class="num">Cash</th><th class="num">Effect on salary</th></tr></thead><tbody>
    ${late.map(t => `<tr><td>${esc(dmyS(t.d))}</td><td>${esc(t.t || "")}</td><td class="mono small">${esc(String(t.tr || t.id).slice(0,13))}</td><td class="num">${fmt(t.f)}</td><td class="num">${fmt((t.f||0) - (t.sf||0) - (t.tx||0))}</td><td class="num">${fmt(t.tp)}</td><td class="num">${fmt(t.c)}</td><td class="num">${aed(tripEffect(t))}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="7">Total</td><td class="num"><b>${aed(lateEff)}</b></td></tr></tfoot></table></div>` : "";
  let fin;
  if(same){
    let note;
    if(Array.isArray(same.rows)){
      // compare the trips it settled and the rest of the computation separately
      const inRec = new Set(same.rows), periodTrips = S.trips.filter(t => t.dr === id && moneyRow(t));
      const newTrips = periodTrips.filter(t => !inRec.has(t.id)), nonTrip = r2(salaryOf(x) - sum(periodTrips, tripEffect));
      const changed = Math.abs(nonTrip - num(same.nonTrip)) > 0.05;
      note = `${newTrips.length ? `${newTrips.length} trip(s) dated in this period arrived after it was finalised (AED ${fmt(sum(newTrips, tripEffect))}); they show as unsettled in the next salary. ` : ""}${changed ? `Other items changed since (deductions, instalments…): AED ${fmt(num(same.nonTrip))} then, AED ${fmt(nonTrip)} now – reopen and finalise again if needed.` : "Payments to or from the driver don't change it."}`;
      fin = `<div class="banner ${changed || newTrips.length ? "" : "info"}">Finalised on ${esc(new Date(same.at).toLocaleString("en-GB"))}${same.by ? " by " + esc(same.by) : ""}: salary AED ${fmt(same.salary)}, ${same.rows.length} trip rows settled${same.late && same.late.length ? ` (incl. ${same.late.length} from earlier periods)` : ""}. ${note}</div>`;
    } else {
      const was = same.salary != null ? same.salary : salaryOf(same), now = salaryOf(x), changed = Math.abs(was - now) > 0.01;
      fin = `<div class="banner ${changed ? "" : "info"}">Finalised on ${esc(new Date(same.at).toLocaleString("en-GB"))}${same.by ? " by " + esc(same.by) : ""}: salary AED ${fmt(was)}. ${changed ? `The computation has changed since – it is now AED ${fmt(now)}.` : "The computation still matches."}</div>`;
    }
  } else if(overlap){
    fin = `<div class="banner">Part of this period is already finalised (${esc(dmyS(overlap.from))} – ${esc(dmyS(overlap.to))}). Choose dates after ${esc(dmyS(runs[0].to))}.${next ? ` <button class="btn sm" data-setperiod="${next}|${monthEnd(next.slice(0,7))}">Use ${esc(dmyS(next))} – ${esc(dmyS(monthEnd(next.slice(0,7))))}</button>` : ""}</div>`;
  } else {
    fin = `<div class="row" style="gap:10px;align-items:center"><button class="btn primary" data-finalise="${esc(id)}" ${S.canWrite && S.db && ready ? "" : "disabled"}>Finalise salary for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</button>
      ${next && next !== S.from ? `<span class="small muted">Last finalised period ended ${esc(dmyS(runs[0].to))}.</span> <button class="btn sm" data-setperiod="${next}|${monthEnd(next.slice(0,7))}">Next period: ${esc(dmyS(next))} – ${esc(dmyS(monthEnd(next.slice(0,7))))}</button>` : ""}</div>
      <p class="small muted" style="margin-top:6px">Finalising stores this computation and marks its ${S.trips.filter(t => t.dr === id && moneyRow(t)).length + late.length} trip rows as settled. A finalised period can't be finalised again or overlapped.</p>`;
  }
  const pay = T && same && payable > 0.005 ? `<button class="btn" data-paysalary="${esc(id)}" data-amt="${r2(payable)}">Pay AED ${fmt(payable)} to the driver</button>` : "";
  return `<div class="grid2"><div><h2>Salary computation · ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</h2>
    <div class="tbl"><table><tbody>${rows}</tbody></table></div>${recon}${!T ? `<p class="small muted">Loading the history (balance brought forward, unsettled trips)…</p>` : ""}${lateTbl}${recovTbl(id, !!same)}</div>
    <div><h2>Finalise</h2>${fin}<div class="row" style="margin-top:10px">${pay}</div>
    <h2 style="margin-top:16px">Finalised periods</h2>${runs.length ? `<div class="tbl"><table><thead><tr><th>Period</th><th class="num">Trips</th><th class="num">Driver's share</th><th class="num">Salary</th><th class="num">Closing balance</th><th>Finalised</th><th></th></tr></thead><tbody>
    ${runs.map(p => `<tr><td>${esc(dmyS(p.from))} – ${esc(dmyS(p.to))}${p.late && p.late.length ? `<div class="small muted">+ ${p.late.length} earlier trip(s)</div>` : ""}</td><td class="num">${p.n}</td><td class="num">${fmt(p.ent)}</td><td class="num">${aed(p.salary != null ? p.salary : salaryOf(p))}</td><td class="num">${p.closing == null ? "—" : aed(p.closing)}</td><td class="small muted">${esc(p.by || "")}${p.at ? " · " + esc(new Date(p.at).toLocaleDateString("en-GB")) : ""}</td>
      <td class="row"><button class="btn sm" data-setperiod="${p.from}|${p.to}">Open</button><button class="btn sm danger" data-payrolldel="${esc(p.id)}">Reopen</button></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="sub">No period finalised yet.</p>`}</div></div>`;
}
async function finalise(id){
  const runs = Object.values(S.payroll).filter(p => p.driverId === id);
  if(runs.some(p => p.from <= S.to && p.to >= S.from)){ toast("Part of this period is already finalised."); return; }
  if(!historyReady()){ toast("Still loading the history – try again in a moment."); return; }
  const x = compute().D[id] || {}, T = drvTx(id), late = lateTrips(id) || [], lateEff = r2(sum(late, tripEffect));
  const periodTrips = S.trips.filter(t => t.dr === id && moneyRow(t));
  const k = ["n","daysWorked","fare","fee","tax","net","ent","tipsDue","cash","card","deduct","adv","inst","viaDriver","books","paid","recv","balance"];
  const rec = {driverId: id, from: S.from, to: S.to, termsText: x.termsText || "", ...Object.fromEntries(k.map(f => [f, r2(num(x[f]))])),
    salary: r2(salaryOf(x) + lateEff), nonTrip: r2(salaryOf(x) - sum(periodTrips, tripEffect)), lateEffect: lateEff,
    rows: [...periodTrips.map(t => t.id), ...late.map(t => t.id)], late: late.map(t => t.id), opening: T.before, closing: r2(T.before + salaryOf(x) + lateEff + num(x.balance) - salaryOf(x)),
    by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()};
  if(await writeOk(S.db.doc("payroll/" + id + "_" + S.from).set(rec))) toast(`Salary finalised for ${dmyS(S.from)} – ${dmyS(S.to)}: ${rec.rows.length} trip rows settled.`);
}

/* ---------- performance ---------- */
function dPerf(id){
  const C = compute(), x = C.D[id] || {}, all = Object.values(C.D).filter(d => d.n && S.drivers[d.id]);
  const trips = S.trips.filter(t => t.dr === id && (t.tr || t.f)), acts = (S.activity || []).filter(a => a.dr === id);
  if(!trips.length && !acts.length) return `<div class="empty"><b>No trips in this period</b>Change the dates at the top.</div>`;
  const done = acts.filter(a => a.st === "completed").length, canc = acts.filter(a => /cancel/.test(a.st || "")).length;
  const perDay = x.daysWorked ? x.net / x.daysWorked : 0, fleetDay = sum(all, d => d.net) / Math.max(1, sum(all, d => d.daysWorked));
  const rank = all.sort((a,b) => b.net - a.net).findIndex(d => d.id === id) + 1;
  const W = {}; const seen = new Set();
  trips.forEach(t => { const w = W[weekEnd(t.d)] ||= {n:0, days:new Set(), f:0, net:0, km:0, c:0}; const k = t.tr || t.id; if(!seen.has(k)){ seen.add(k); w.n++; w.km += t.km || 0; } w.days.add(t.d); w.f += t.f || 0; w.net += (t.f||0) - (t.sf||0) - (t.tx||0); w.c += t.c || 0; });
  const cars = {}; (acts.length ? acts.filter(a => a.st === "completed").map(a => ({p:a.p, d:a.d})) : trips.filter(t => t.p).map(t => ({p:t.p, d:t.d}))).forEach(r => { const c = cars[r.p] ||= {n:0, other:0}; c.n++; const own = vehAt(id, r.d), v = Object.values(S.vehicles).find(v => norm(v.plate) === norm(r.p)); if(own && v && v.id !== own) c.other++; });
  const kpi = (l, v, n) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${n ? `<div class="n">${n}</div>` : ""}</div>`;
  return `<div class="kpis">${kpi("Trips", x.n || 0, `${x.daysWorked || 0} days worked`)}${kpi("Net earnings", fmt(x.net), `rank ${rank || "—"} of ${all.length} drivers`)}${kpi("Net per day", fmt(perDay), `fleet average ${fmt(fleetDay)}`)}
    ${kpi("Net per trip", fmt(x.n ? x.net / x.n : 0), "")}${kpi("Distance", fmt(x.km) + " km", x.km ? `${fmt(x.fare / x.km)} fare per km` : "")}${kpi("Cash share", (x.fare ? Math.round(100 * x.cash / x.fare) : 0) + "%", `AED ${fmt(x.cash)} in cash`)}
    ${acts.length ? kpi("Completion", Math.round(100 * done / Math.max(1, acts.length)) + "%", `${canc} cancelled of ${acts.length} requests`) : ""}</div>
  <div class="grid2"><div><h2>Week by week</h2><div class="tbl"><table><thead><tr><th>Week ending</th><th class="num">Trips</th><th class="num">Days</th><th class="num">Fares</th><th class="num">Net</th><th class="num">Km</th><th class="num">Cash</th></tr></thead><tbody>
    ${Object.keys(W).sort().map(k => { const w = W[k]; return `<tr><td>${esc(dmyS(k))}</td><td class="num">${w.n}</td><td class="num">${w.days.size}</td><td class="num">${fmt(w.f)}</td><td class="num">${fmt(w.net)}</td><td class="num">${fmt(w.km)}</td><td class="num">${fmt(w.c)}</td></tr>`; }).join("")}
    </tbody></table></div></div>
    <div><h2>Cars driven</h2><div class="tbl"><table><thead><tr><th>Car</th><th class="num">Trips</th><th class="num">Not his assigned car</th></tr></thead><tbody>
    ${Object.entries(cars).sort((a,b) => b[1].n - a[1].n).map(([p, c]) => `<tr><td class="mono">${esc(p)}</td><td class="num">${c.n}</td><td class="num">${c.other || ""}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No plates in the reports.</td></tr>`}
    </tbody></table></div></div></div>`;
}

/* ---------- accounts: loans, advances, visa ---------- */
function dAccts(id){
  const e = S.edit && ["ditem","drep"].includes(S.edit.kind) ? S.edit : null;
  const form = !e ? "" : e.kind === "drep" ? repForm(e.id) : itemForm(e.id, S.ditems[e.id] || {driverId: id, kind: e.preset || "loan", date: iso(new Date()) <= S.to && iso(new Date()) >= S.from ? iso(new Date()) : S.to, paidFrom: "1100", category: "5280"});
  const items = Object.values(S.ditems).filter(it => it.driverId === id).sort((a,b) => (b.date || "").localeCompare(a.date || ""));
  return `${form}<div class="row" style="margin-bottom:10px">${Object.entries({loan:"New loan", advance:"New salary advance", visa:"New visa", shared:"Other expense", other:"Other amount"}).map(([k,l]) => `<button class="btn ${k === "loan" ? "primary" : ""}" data-newitem="${k}">${l}</button>`).join("")}</div>
  ${items.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th class="num">Total cost</th><th class="num">Driver share</th><th class="num">Company bears</th><th>Recovery</th><th class="num">Recovered</th><th class="num">Outstanding</th><th></th></tr></thead><tbody>
  ${items.map(it => { const p = itemPlan(it), out = itemOutstanding(it, S.to), next = p.inst.find(x => x.date > S.to), cost = num(it.amount) + num(it.vat) || num(it.driverAmount), da = num(it.driverAmount);
    return `<tr><td>${esc(dmyS(it.date))}</td><td>${esc(ITEM_KINDS[it.kind] || "")}</td><td style="white-space:normal">${esc(it.desc)}${(it.repayments || []).length ? `<div class="small muted">${it.repayments.length} repayment(s)</div>` : ""}</td>
      <td class="num">${fmt(cost)}</td><td class="num">${fmt(da)} <span class="small muted">${cost ? Math.round(100 * da / cost) : 100}%</span></td><td class="num">${fmt(cost - da)}</td>
      <td class="small">${num(it.installment) > 0 && num(it.installment) < da ? fmt(num(it.installment)) + "/month from " + esc(it.startMonth) : "In full, " + esc(it.startMonth)}${next && out > 0 ? `<div class="muted">Next ${esc(dmyS(next.date))}: ${fmt(next.amt)}</div>` : ""}</td>
      <td class="num">${fmt(da - out)}</td><td class="num">${out > 0.004 ? `<b>${fmt(out)}</b>` : '<span class="pill good">Cleared</span>'}</td>
      <td class="row"><button class="btn sm" data-edit="ditem" data-id="${esc(it.id)}">Edit</button>${out > 0.004 ? `<button class="btn sm" data-edit="drep" data-id="${esc(it.id)}">Repayment</button>` : ""}</td></tr>`; }).join("")}
  </tbody><tfoot><tr><td colspan="8">Still to recover after ${esc(dmyS(S.to))}</td><td class="num"><b>${fmt(sum(items, it => itemOutstanding(it, S.to)))}</b></td><td></td></tr></tfoot></table></div>` : `<p class="sub">No loans, advances or visa accounts for this driver.</p>`}
  <div class="banner info" style="margin-top:12px"><b>How these post.</b> When given: the driver's share is debited to <b>1170 Driver loans & recoverables</b> (an asset) and any part the company bears to the expense category; the bank or cash account is credited. On the last day of each month the instalment moves from 1170 to the driver's account <b>2100</b>, so it is deducted from his salary. A cash repayment credits 1170 directly. In the financial statements 1170 is a current asset until recovered; the company's share is an expense in the profit & loss.</div>`;
}

/* ---------- events ---------- */
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.drvview != null){ S.drvView = t.dataset.drvview; S.edit = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.drvtab){ S.drvTab = t.dataset.drvtab; S.edit = null; render(); return; }
  if(t.dataset.newitem){ S.edit = {kind: "ditem", id: "", preset: t.dataset.newitem}; render(); return; }
  if(t.dataset.recadd){
    const it = S.ditems[t.dataset.recadd], inp = document.querySelector(`[data-recov="${t.dataset.recadd}"]`); if(!it || !inp) return;
    const amt = r2(num(inp.value || inp.placeholder)), out = itemOutstanding(it, S.to);
    if(amt <= 0 || amt > out + 0.004){ toast(`Enter an amount up to AED ${fmt(out)}.`); return; }
    const {id:_, ...b} = it;
    if(await writeOk(S.db.doc("driverItems/" + it.id).set({...b, repayments: [...(b.repayments || []), {date: S.to, amount: amt, paidTo: "2100", note: `Recovered in salary ${dmyS(S.from)} – ${dmyS(S.to)}`}]}))) toast(`AED ${fmt(amt)} added to this salary.`);
    return;
  }
  if(t.dataset.finalise){ t.disabled = true; await finalise(t.dataset.finalise); render(); return; }
  if(t.dataset.payrolldel){
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to reopen"; return; }
    if(await writeOk(S.db.doc("payroll/" + t.dataset.payrolldel).delete())){ toast("Period reopened."); render(); } return;
  }
  if(t.dataset.setperiod){
    const [a, b] = t.dataset.setperiod.split("|"); S.from = a; S.to = b;
    $("#pFrom").value = a; $("#pTo").value = b; $("#preset").value = "custom"; await loadPeriod(); render(); return;
  }
  if(t.dataset.paysalary){ S.view = "payments"; S.drvView = ""; if(window.BOOKS) BOOKS.newDriverDoc("payment", t.dataset.paysalary, "salary", num(t.dataset.amt)); render(); window.scrollTo(0,0); return; }
  if(t.dataset.itemedit){ const it = S.ditems[t.dataset.itemedit]; if(!it) return; S.view = "drivers"; S.drvView = it.driverId; S.drvTab = "accts"; S.edit = {kind: "ditem", id: it.id}; render(); window.scrollTo(0,0); return; }
});
window.driverDetail = driverDetail; window.drvTx = drvTx; window.drvBalance = drvBalance;
