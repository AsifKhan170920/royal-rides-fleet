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
    <p class="sub">${esc(drvTermText(tm))} · Car ${car ? esc(vName(car)) : "—"} · Machine ${m ? esc(m.name || m.tid) : "—"}${d.phone ? " · " + esc(d.phone) : ""}</p></div>
    <div class="row"><button class="btn ghost" data-drvview="">← All drivers</button><button class="btn" data-edit="driver" data-id="${esc(id)}">Edit driver</button><button class="btn" data-offerfor="${esc(id)}">Offer letter</button></div></div>
  ${tabBtns("data-drvtab", tab, DRV_TABS)}${body}</div>`;
}

/* ---------- trip history ---------- */
function dTrips(id){
  const rows = S.trips.filter(t => t.dr === id && (t.tr || t.f || t.sf || t.tp || t.c || t.rf || t.oe));
  if(!rows.length) return `<div class="empty"><b>No trips in this period</b>Change the dates at the top, or import the platform reports.</div>`;
  const multi = new Set(rows.map(plOf)).size > 1, shown = rows.slice(0, 500), net = t => (t.f||0) - (t.sf||0) - (t.tx||0);
  return `<div class="tbl"><table><thead><tr><th>Date</th><th>Time</th>${multi ? "<th>Platform</th>" : ""}<th>Car</th><th class="num">Fare</th><th class="num">Fee + VAT</th><th class="num">Tips</th><th class="num">Refunds</th><th class="num">Cash</th><th class="num">Net</th><th class="num">Km</th><th>Status</th><th>Payment</th></tr></thead><tbody>
  ${shown.map(t => `<tr><td>${esc(dmyS(t.d))}</td><td>${esc(t.t || "")}</td>${multi ? `<td>${esc(pName(plOf(t)))}</td>` : ""}<td>${esc(vName(vehicleForTrip(t) || "unassigned"))}</td><td class="num">${fmt(t.f)}</td><td class="num">${fmt((t.sf||0) + (t.tx||0))}</td><td class="num">${fmt(t.tp)}</td><td class="num">${fmt(t.rf)}</td><td class="num">${fmt(t.c)}</td><td class="num">${fmt(net(t))}</td><td class="num">${t.km ? fmt(t.km) : ""}</td><td class="small">${esc((t.st || "").replace(/_/g, " "))}</td><td class="small">${esc(t.pay || (t.c ? "cash" : ""))}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="${multi ? 4 : 3}">${new Set(rows.map(t => t.tr || t.id)).size} trips${rows.length > 500 ? " – first 500 rows shown" : ""}</td><td class="num">${fmt(sum(rows, t => t.f))}</td><td class="num">${fmt(sum(rows, t => (t.sf||0) + (t.tx||0)))}</td><td class="num">${fmt(sum(rows, t => t.tp))}</td><td class="num">${fmt(sum(rows, t => t.rf))}</td><td class="num">${fmt(sum(rows, t => t.c))}</td><td class="num">${fmt(sum(rows, net))}</td><td class="num">${fmt(sum(rows, t => t.km))}</td><td colspan="2"></td></tr></tfoot></table></div>`;
}

/* ---------- transactions (running account) ---------- */
function dTx(id){
  if(!historyReady()) return `<p class="sub">${S.ledger && S.ledger.error ? "Couldn't load the history. Change the dates to retry." : "Loading the driver's history…"}</p>`;
  const R = ledgerLines(id), start = setting("ledgerStart", "2026-09-01");
  const loanOut = sum(Object.values(S.ditems).filter(it => it.driverId === id), it => itemOutstanding(it, S.to));
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">Running account from ${esc(dmyS(start))}. Positive = the company owes the driver; negative = the driver owes the company.</span>
    <div class="row"><select id="lgrp" aria-label="Group trips">${opts({day:"Trips by day", week:"Trips by week", month:"Trips by month"}, S.ledgerGroup)}</select><button class="btn" id="expLedger">Export CSV</button></div></div>
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit (driver owes)</th><th class="num">Credit (owed to driver)</th><th class="num">Balance</th></tr></thead><tbody>
  <tr><td>${esc(dmyS(S.from < start ? start : S.from))}</td><td><b>${S.from <= start ? "Opening balance" : "Balance brought forward"}</b></td><td></td><td></td><td class="num"><b>${aed(S.from <= start ? R.open : R.before)}</b></td></tr>
  ${R.shown.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="2">Closing balance ${esc(dmyS(S.to))}</td><td class="num">${fmt(sum(R.shown, l => l.dr))}</td><td class="num">${fmt(sum(R.shown, l => l.cr))}</td><td class="num"><b>${aed(R.closing)}</b></td></tr></tfoot></table></div>
  <div class="row" style="margin-top:10px;gap:18px"><span>Salary account <b class="mono">${fmt(R.closing)}</b></span><span>Loans & advances still to recover <b class="mono">${fmt(loanOut)}</b></span><span>Net position <b class="mono ${R.closing - loanOut < 0 ? "neg" : ""}">${fmt(R.closing - loanOut)}</b></span></div>`;
}

/* ---------- salary ---------- */
const salaryOf = x => r2(num(x.balance) - num(x.books) + num(x.paid) - num(x.recv));
function dSalary(id){
  const C = compute(), x = C.D[id] || {n:0, fare:0, fee:0, tax:0, net:0, ent:0, tipsDue:0, cash:0, card:0, deduct:0, adv:0, inst:0, viaDriver:0, books:0, paid:0, recv:0, balance:0, daysWorked:0, rentDays:0};
  const runs = Object.values(S.payroll).filter(p => p.driverId === id).sort((a,b) => b.from.localeCompare(a.from));
  const overlap = runs.find(p => p.from <= S.to && p.to >= S.from), same = runs.find(p => p.from === S.from && p.to === S.to);
  const next = runs.length ? addDays(runs[0].to, 1) : null, ready = historyReady(), R = ready ? ledgerLines(id) : null;
  const ln = (label, v, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td style="white-space:normal">${label}</td><td class="num">${v == null ? "" : aed(v)}</td></tr>`;
  const rows = [
    ln(`Trips: ${x.n} · days worked: ${x.daysWorked || 0}`, null),
    ln("Fares", x.fare), ln("Platform fee", -x.fee), ln("VAT on platform fee", -x.tax), ln("<b>Net earnings</b>", x.net),
    ln(`<b>Driver's share</b> – ${esc(x.termsText || "no terms")}${x.rentDays ? ` (rent for ${x.rentDays} days)` : ""}`, x.ent),
    x.tipsDue ? ln("Tips", x.tipsDue) : "", ln("Cash collected from riders", -x.cash), x.card ? ln("Card payments on the company machine", x.card) : "",
    x.deduct ? ln("Fines / tolls charged to the driver", -x.deduct) : "", x.adv ? ln("Advances (deducted in full)", -x.adv) : "",
    x.inst ? ln("Loan / advance / visa instalments", -x.inst) : "", x.viaDriver ? ln(x.viaDriver > 0 ? "Company costs paid from the driver's cash" : "Company money collected by the driver", x.viaDriver) : "",
    x.books ? ln("Payments, receipts & journal entries on the driver's account", x.books) : "", x.paid ? ln("Paid to the driver (expenses page)", -x.paid) : "", x.recv ? ln("Received from the driver", x.recv) : "",
    ln("<b>Salary for the period</b> (before payments)", salaryOf(x), "tot"), (x.books || x.paid || x.recv) ? ln("Paid to / received from the driver in the period", r2(x.balance - salaryOf(x))) : "", ln("<b>Balance for the period</b>", x.balance, "tot"),
    R ? ln("Balance brought forward", R.before) : "", R ? ln(`<b>${R.closing >= 0 ? "Payable to the driver" : "Driver owes the company"} at ${esc(dmyS(S.to))}</b>`, R.closing, "tot") : ""].join("");
  let fin;
  if(same){
    const was = same.salary != null ? same.salary : salaryOf(same), now = salaryOf(x), changed = Math.abs(was - now) > 0.01;
    fin = `<div class="banner ${changed ? "" : "info"}">Finalised on ${esc(new Date(same.at).toLocaleString("en-GB"))}${same.by ? " by " + esc(same.by) : ""}: salary AED ${fmt(was)}. ${changed ? `The computation has changed since – it is now AED ${fmt(now)}. Check what was added (trips, deductions, instalments), or reopen and finalise again.` : "The computation still matches. Payments to or from the driver don't change it."}</div>`;
  } else if(overlap){
    fin = `<div class="banner">Part of this period is already finalised (${esc(dmyS(overlap.from))} – ${esc(dmyS(overlap.to))}). Choose dates after ${esc(dmyS(runs[0].to))}.${next ? ` <button class="btn sm" data-setperiod="${next}|${monthEnd(next.slice(0,7))}">Use ${esc(dmyS(next))} – ${esc(dmyS(monthEnd(next.slice(0,7))))}</button>` : ""}</div>`;
  } else {
    fin = `<div class="row" style="gap:10px;align-items:center"><button class="btn primary" data-finalise="${esc(id)}" ${S.canWrite && S.db ? "" : "disabled"}>Finalise salary for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</button>
      ${next && next !== S.from ? `<span class="small muted">Last finalised period ended ${esc(dmyS(runs[0].to))}.</span> <button class="btn sm" data-setperiod="${next}|${monthEnd(next.slice(0,7))}">Next period: ${esc(dmyS(next))} – ${esc(dmyS(monthEnd(next.slice(0,7))))}</button>` : ""}</div>
      <p class="small muted" style="margin-top:6px">Finalising stores this computation as the record for the period. A finalised period can't be finalised again or overlapped.</p>`;
  }
  const pay = R && R.closing > 0.005 ? `<button class="btn" data-paysalary="${esc(id)}" data-amt="${r2(R.closing)}">Pay AED ${fmt(R.closing)} to the driver</button>` : "";
  return `<div class="grid2"><div><h2>Salary computation · ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</h2>
    <div class="tbl"><table><tbody>${rows}</tbody></table></div>${!R ? `<p class="small muted">Loading the balance brought forward…</p>` : ""}</div>
    <div><h2>Finalise</h2>${fin}<div class="row" style="margin-top:10px">${pay}</div>
    <h2 style="margin-top:16px">Finalised periods</h2>${runs.length ? `<div class="tbl"><table><thead><tr><th>Period</th><th class="num">Trips</th><th class="num">Driver's share</th><th class="num">Salary</th><th class="num">Closing balance</th><th>Finalised</th><th></th></tr></thead><tbody>
    ${runs.map(p => `<tr><td>${esc(dmyS(p.from))} – ${esc(dmyS(p.to))}</td><td class="num">${p.n}</td><td class="num">${fmt(p.ent)}</td><td class="num">${aed(p.salary != null ? p.salary : salaryOf(p))}</td><td class="num">${p.closing == null ? "—" : aed(p.closing)}</td><td class="small muted">${esc(p.by || "")}${p.at ? " · " + esc(new Date(p.at).toLocaleDateString("en-GB")) : ""}</td>
      <td class="row"><button class="btn sm" data-setperiod="${p.from}|${p.to}">Open</button><button class="btn sm danger" data-payrolldel="${esc(p.id)}">Reopen</button></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="sub">No period finalised yet.</p>`}</div></div>`;
}
async function finalise(id){
  const runs = Object.values(S.payroll).filter(p => p.driverId === id);
  if(runs.some(p => p.from <= S.to && p.to >= S.from)){ toast("Part of this period is already finalised."); return; }
  const x = compute().D[id] || {}, R = historyReady() ? ledgerLines(id) : null, k = ["n","daysWorked","fare","fee","tax","net","ent","tipsDue","cash","card","deduct","adv","inst","viaDriver","books","paid","recv","balance"];
  const rec = {driverId: id, from: S.from, to: S.to, termsText: x.termsText || "", ...Object.fromEntries(k.map(f => [f, r2(num(x[f]))])), salary: salaryOf(x), opening: R ? R.before : null, closing: R ? R.closing : null,
    by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()};
  if(await writeOk(S.db.doc("payroll/" + id + "_" + S.from).set(rec))) toast(`Salary finalised for ${dmyS(S.from)} – ${dmyS(S.to)}.`);
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
    return `<tr><td>${esc(dmyS(it.date))}</td><td>${esc(ITEM_KINDS[it.kind] || "")}</td><td style="white-space:normal">${esc(it.desc)}${(it.repayments || []).length ? `<div class="small muted">${it.repayments.length} cash repayment(s)</div>` : ""}</td>
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
window.driverDetail = driverDetail;
