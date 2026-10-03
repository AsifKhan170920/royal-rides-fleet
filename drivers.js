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
  S.ledgerDriver = id; S.hdrBtns = "";
  const body = tab === "trips" ? dTrips(id) : tab === "tx" ? dTx(id) : tab === "salary" ? dSalary(id) : tab === "perf" ? dPerf(id) : dAccts(id);
  return `<div class="section"><div class="head"><div><h2>${esc(d.name)}${d.code ? ` <span class="mono small muted">${esc(d.code)}</span>` : ""}</h2>
    <p class="sub">${esc(drvTermTextFull(tm))} · Car ${car ? esc(vName(car)) : "—"} · Machine ${m ? esc(m.name || m.tid) : "—"}${d.phone ? " · " + esc(d.phone) : ""}</p></div>
    <div class="row"><button class="btn ghost" data-back="1">← Back</button>${S.hdrBtns || ""}<button class="btn" data-edit="driver" data-id="${esc(id)}">Edit driver</button><button class="btn" data-offerfor="${esc(id)}">Offer letter</button></div></div>
  ${tabBtns("data-drvtab", tab, DRV_TABS)}${body}</div>`;
}

/* ---------- trip history ---------- */
/* Trip selection for a salary: in the driver's Trip history, the unsettled trips of the period are ticked
   (all by default); a trip left unticked stays unsettled and is offered again in a later period. Trips from
   earlier periods that are still unsettled are listed apart, unticked – tick them to pay them in this salary.
   The choice is kept in drvAdj/sel-<driver>-<from>-<to> {excluded:[row ids], late:[row ids]}. */
const selKey = id => `sel-${id}-${S.from}-${S.to}`;
const selDoc = id => (S.drvAdj || {})[selKey(id)] || {excluded: [], late: []};
async function saveSel(id, patch){
  const d = {...selDoc(id), ...patch}; delete d.id;
  await writeOk(S.db.doc("drvAdj/" + selKey(id)).set({...d, kind: "sel", driverId: id, from: S.from, to: S.to}));
}
function tripShare(t){
  const tm = termAt(termList(S.drivers[t.dr] || {}, DRV_TERMS), t.d) || {}, model = tm.payModel || "commission", net = (t.f||0) - (t.sf||0) - (t.tx||0);
  return (model === "commission" || model === "salary_comm") ? net * num(tm.commissionPct) / 100 : model === "rent" ? net : 0;
}
// the period's computation without the trips left out of this salary
function selX(id, x0){
  const ex = new Set(selDoc(id).excluded || []); if(!x0 || !ex.size) return x0;
  const x = {...x0}, out = S.trips.filter(t => t.dr === id && ex.has(t.id)), tips2 = setting("tipsToDriver", true);
  out.forEach(t => { const net = (t.f||0) - (t.sf||0) - (t.tx||0), sh = tripShare(t), tp = tips2 ? (t.tp||0) : 0;
    x.fare -= t.f||0; x.fee -= t.sf||0; x.tax -= t.tx||0; x.net -= net; x.tip -= t.tp||0; x.tipsDue -= tp; x.cash -= t.c||0; x.ref -= t.rf||0; x.km -= t.km||0;
    x.ent -= sh; x.balance -= sh + tp - (t.c||0); });
  x.n -= new Set(out.filter(t => t.tr || t.f).map(t => t.tr || t.id)).size; x.excluded = out.length;
  return x;
}
// earlier unsettled trips the company chose to pay in this salary
const lateSelected = id => { const L = lateTrips(id); if(!L) return null; const pick = new Set(selDoc(id).late || []); return L.filter(t => pick.has(t.id)); };
const lockedPeriod = id => Object.values(S.payroll).some(p => p.driverId === id && p.from <= S.to && p.to >= S.from);
function tripBtns(t){
  const k = `data-day="${esc(t.d)}" data-id="${esc(t.id)}"`;
  return `<div class="row" style="gap:3px;flex-wrap:nowrap"><button class="btn sm" data-tripview="1" ${k}>View</button><button class="btn sm" data-tripedit="1" ${k}>Edit</button><button class="btn sm danger" data-tripdel="1" ${k}>Delete</button></div>`;
}
function dTrips(id){
  const rows = S.trips.filter(t => t.dr === id && (t.tr || t.f || t.sf || t.tp || t.c || t.rf || t.oe)).sort(newest);
  const lock = lockedPeriod(id), ex = new Set(selDoc(id).excluded || []), late = historyReady() ? (lateTrips(id) || []) : null, pick = new Set(selDoc(id).late || []);
  const pg = paged("dtrips-" + id, rows), multi = new Set(rows.map(plOf)).size > 1, shown = pg.rows, net = t => (t.f||0) - (t.sf||0) - (t.tx||0);
  const open = rows.filter(t => moneyRow(t) && !settleStatus(t).ok), sel = open.filter(t => !ex.has(t.id));
  const box = t => !moneyRow(t) || settleStatus(t).ok || lock ? "" : `<input type="checkbox" data-tsel="${esc(t.id)}" data-drv="${esc(id)}" ${ex.has(t.id) ? "" : "checked"} aria-label="Include in this salary">`;
  const head = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span>${lock ? '<span class="pill good">This period is finalised</span> – the selection is closed.' : `<b>${sel.length}</b> of ${open.length} unsettled trip rows selected for this salary${open.length - sel.length ? ` · <span class="pill bad">${open.length - sel.length} left out</span>` : ""}`}</span>
    ${lock || !open.length ? `<div class="row">${dlBtn("dtrips", id)}</div>` : `<div class="row" style="gap:6px">${dlBtn("dtrips", id)}<button class="btn sm" data-tselall="${esc(id)}" data-on="1">Select all</button><button class="btn sm" data-tselall="${esc(id)}" data-on="0">Select none</button></div>`}</div>`;
  const tbl = rows.length ? `<div class="tbl"><table><thead><tr><th></th><th>Date</th><th>Time</th>${multi ? "<th>Platform</th>" : ""}<th>Car</th><th class="num">Fare</th><th class="num">Fee + VAT</th><th class="num">Tips</th><th class="num">Cash</th><th class="num">Net</th><th class="num">Km</th><th>Status</th><th>Settlement</th><th></th></tr></thead><tbody>
  ${shown.map(t => `<tr${ex.has(t.id) && !settleStatus(t).ok ? ' style="opacity:.55"' : ""}><td>${box(t)}</td><td>${esc(dmyS(t.d))}</td><td>${esc(t.t || "")}</td>${multi ? `<td>${esc(pName(plOf(t)))}</td>` : ""}<td>${esc(vName(vehicleForTrip(t) || "unassigned"))}</td><td class="num">${fmt(t.f)}</td><td class="num">${fmt((t.sf||0) + (t.tx||0))}</td><td class="num">${fmt(t.tp)}</td><td class="num">${fmt(t.c)}</td><td class="num">${fmt(net(t))}</td><td class="num">${t.km ? fmt(t.km) : ""}</td><td class="small">${esc((t.st || "").replace(/_/g, " "))}${t.pay ? " · " + esc(t.pay) : ""}</td><td>${settleBadge(t)}${ex.has(t.id) && !settleStatus(t).ok ? ' <span class="small muted">left out</span>' : ""}</td><td>${tripBtns(t)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td></td><td colspan="${multi ? 4 : 3}">${new Set(rows.map(t => t.tr || t.id)).size} trips</td><td class="num">${fmt(sum(rows, t => t.f))}</td><td class="num">${fmt(sum(rows, t => (t.sf||0) + (t.tx||0)))}</td><td class="num">${fmt(sum(rows, t => t.tp))}</td><td class="num">${fmt(sum(rows, t => t.c))}</td><td class="num">${fmt(sum(rows, net))}</td><td class="num">${fmt(sum(rows, t => t.km))}</td><td colspan="3"></td></tr></tfoot></table></div>${pg.bar}`
    : `<div class="empty"><b>No trips in this period</b>Change the dates at the top, or import the platform reports.</div>`;
  const lateBox = late == null ? `<p class="small muted">Loading earlier unsettled trips…</p>` : !late.length ? "" : `<h2 style="margin-top:18px">Unsettled trips from earlier periods</h2>
    <p class="sub">Dated in periods that are already finalised but not paid there (left out, or arrived in a later report). Tick the ones to pay in this salary; the others stay unsettled.</p>
    <div class="tbl"><table><thead><tr><th></th><th>Date</th><th>Time</th><th>Trip</th><th class="num">Fare</th><th class="num">Net</th><th class="num">Tips</th><th class="num">Cash</th><th class="num">Effect on salary</th></tr></thead><tbody>
    ${late.map(t => `<tr><td>${lock ? "" : `<input type="checkbox" data-tlate="${esc(t.id)}" data-drv="${esc(id)}" ${pick.has(t.id) ? "checked" : ""} aria-label="Pay in this salary">`}</td><td>${esc(dmyS(t.d))}</td><td>${esc(t.t || "")}</td><td class="mono small">${esc(String(t.tr || t.id).slice(0,13))}</td><td class="num">${fmt(t.f)}</td><td class="num">${fmt(net(t))}</td><td class="num">${fmt(t.tp)}</td><td class="num">${fmt(t.c)}</td><td class="num">${aed(tripEffect(t))}</td></tr>`).join("")}
    </tbody><tfoot><tr><td></td><td colspan="7">${late.filter(t => pick.has(t.id)).length} of ${late.length} selected</td><td class="num"><b>${aed(sum(late.filter(t => pick.has(t.id)), tripEffect))}</b></td></tr></tfoot></table></div>`;
  return (window.tripEditor ? tripEditor() : "") + head + tbl + lateBox;
}

/* ---------- view / edit / delete a trip row (trips/{day}) ---------- */
const TRIP_FIELDS = [["f","Fare"],["sf","Platform fee"],["tx","VAT on fee"],["tp","Tip"],["rf","Refunds / tolls"],["c","Cash collected"],["oe","Other earnings"],["po","Paid to bank"],["km","Distance (km)"]];
function tripEditor(){
  const e = S.tripEdit; if(!e) return "";
  const t = S.trips.find(x => x.id === e.id && x.d === e.day); if(!t){ S.tripEdit = null; return ""; }
  const st = settleStatus(t), net = (t.f||0) - (t.sf||0) - (t.tx||0);
  if(e.mode === "view") return `<div class="section"><div class="head"><div><h2>Trip ${esc(String(t.tr || t.id).slice(0, 18))}</h2><p class="sub">${esc(dmyS(t.d))} ${esc(t.t || "")} · ${esc(pName(plOf(t)))} · ${settleBadge(t)}</p></div><div class="row"><button class="btn" data-tripedit="1" data-day="${esc(t.d)}" data-id="${esc(t.id)}">Edit</button><button class="btn ghost" data-tripclose="1">Close</button></div></div>
    <div class="tbl"><table><tbody>${[["Driver", dName(t.dr)], ["Car", vName(vehicleForTrip(t) || "unassigned") + (t.p ? " (plate " + t.p + ")" : "")], ["Status", (t.st || "").replace(/_/g, " ")], ["Product", t.prod], ["Payment", t.pay], ["Trip ID", t.tr], ["Row ID", t.id]].map(([l, v]) => `<tr><td class="muted">${l}</td><td>${esc(v || "—")}</td></tr>`).join("")}
    ${TRIP_FIELDS.map(([k, l]) => `<tr><td class="muted">${l}</td><td class="num">${fmt(t[k] || 0)}</td></tr>`).join("")}<tr class="tot"><td><b>Net (fare − fee − VAT)</b></td><td class="num"><b>${fmt(net)}</b></td></tr></tbody></table></div></div>`;
  if(st.ok) return `<div class="section"><div class="banner">This trip is settled in the salary for ${esc(dmyS(st.p.from))} – ${esc(dmyS(st.p.to))}. Reopen that salary (Transactions → Edit) before changing the trip.</div><button class="btn ghost" data-tripclose="1">Close</button></div>`;
  return `<div class="section"><h2>Edit trip ${esc(String(t.tr || t.id).slice(0, 18))}</h2><form class="form" id="fTrip" data-day="${esc(t.d)}" data-id="${esc(t.id)}">
    <div class="f"><label for="tr_d">Date</label><input id="tr_d" name="d" type="date" required value="${esc(t.d)}"></div>
    <div class="f"><label for="tr_t">Time</label><input id="tr_t" name="t" value="${esc(t.t || "")}" placeholder="HH:MM"></div>
    <div class="f"><label for="tr_dr">Driver</label><select id="tr_dr" name="dr">${listOpts(S.drivers, d => d.name || d.id, t.dr)}</select></div>
    <div class="f"><label for="tr_p">Plate</label><input id="tr_p" name="p" value="${esc(t.p || "")}"></div>
    ${TRIP_FIELDS.map(([k, l]) => `<div class="f"><label for="tr_${k}">${l}</label><input id="tr_${k}" name="${k}" type="number" step="0.01" value="${esc(t[k] ?? "")}"></div>`).join("")}
    <div class="f wide"><label for="tr_note">Reason for the change</label><input id="tr_note" name="note" required placeholder="e.g. fare corrected from the Uber statement"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save trip</button><button class="btn ghost" type="button" data-tripclose="1">Cancel</button></div>
  </form></div>`;
}
window.tripEditor = tripEditor; window.tripBtns = tripBtns;

/* ---------- transactions (the driver's account) ---------- */
/* Trips are not listed one by one: a salary period, once finalised, is credited to the driver as one line
   (what the company owes him), and every payment to him is a debit; money he hands over is a credit. */
function drvTx(id){
  const d = S.drivers[id] || {}, ents = (S.ledger && S.ledger.entries) || [], lines = [];
  Object.values(S.payroll).filter(p => p.driverId === id && p.to <= S.to).forEach(p => {
    const v = num(p.entitled != null ? p.entitled : num(p.salary != null ? p.salary : salaryOf(p)) + num(p.cash) - num(p.card));
    const per = `${dmyS(p.from)} – ${dmyS(p.to)}`, cash = num(p.cashCollected != null ? p.cashCollected : p.cash), card = num(p.card), bcash = num(p.bookingCash);
    lines.push({ref: {kind: "payroll", id: p.id, from: p.from, to: p.to}, date: p.to, desc: `Salary entitled ${dmyS(p.from)} – ${dmyS(p.to)} (finalised, ${p.n || 0} trips${p.late && p.late.length ? ` + ${p.late.length} earlier` : ""})`, ...(v >= 0 ? {cr: v} : {dr: -v}), sal: true});
    if(r2(cash)) lines.push({date: p.to, desc: `Cash collected from riders ${per}`, dr: r2(cash), sal: true});
    if(r2(bcash)) lines.push({date: p.to, desc: `Cash from direct bookings ${per}`, dr: r2(bcash), sal: true});
    if(r2(card)) lines.push({date: p.to, desc: `Card payments on the company machine ${per}`, cr: r2(card), sal: true});
  });
  ents.filter(e => e.driverId === id).forEach(e => { const a = num(e.amount), n = e.note ? " – " + e.note : "";
    const ref = {kind: "entry", id: e.id, date: e.date};
    if(e.type === "driver_payment") lines.push({ref, date: e.date, desc: "Payment to driver" + n, dr: a});
    else if(e.type === "driver_receipt") lines.push({ref, date: e.date, desc: "Received from driver" + n, cr: a}); });
  if(window.BOOKS) BOOKS.driverLines(ents, id).forEach(l => lines.push({...l}));
  lines.sort((a,b) => a.date.localeCompare(b.date) || (a.sal ? 1 : 0) - (b.sal ? 1 : 0));   // a period's lines come after the payments of that day
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
  const x = selX(id, compute().D[id]), late = lateSelected(id) || [], pending = x ? r2(salaryOf(x) + sum(late, tripEffect)) : 0;
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">The driver's account from ${esc(dmyS(start))}: when a salary period is finalised, its salary entitled is a credit, and the cash he collected from riders in that period a debit (card payments on the company machine a credit); payments to him are debits. Positive balance = the company owes the driver. Newest first.</span><button class="btn sm" id="expLedger">Download CSV</button></div>
  ${!fin && (x && (x.n || x.inst || x.adv) || late.length) ? `<div class="banner">The salary for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))} is not finalised yet (AED ${fmt(pending)} so far), so it is not in this account. <button class="btn sm" data-drvtab="salary">Open Salary</button></div>` : ""}
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th><th></th></tr></thead><tbody>
  ${(T.pg = paged("dtx-" + id, T.shown.slice().reverse())).rows.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${l.sal ? "<b>" + esc(l.desc) + "</b>" : esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td><td>${txActions(l.ref)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No finalised salary or payment in this period.</td></tr>`}
  ${T.pg.last ? `<tr><td>${esc(dmyS(S.from < start ? start : S.from))}</td><td><b>${S.from <= start ? "Opening balance" : "Balance brought forward"}</b></td><td></td><td></td><td class="num"><b>${aed(S.from <= start ? T.open : T.before)}</b></td><td></td></tr>` : ""}
  </tbody><tfoot><tr><td colspan="2">Balance ${esc(dmyS(S.to))} – ${T.closing >= 0 ? "payable to the driver" : "the driver owes the company"}</td><td class="num">${fmt(sum(T.shown, l => l.dr))}</td><td class="num">${fmt(sum(T.shown, l => l.cr))}</td><td class="num"><b>${aed(T.closing)}</b></td><td></td></tr></tfoot></table></div>${T.pg.bar}
  <div class="row" style="margin-top:10px;gap:18px"><span>Salary account <b class="mono">${fmt(T.closing)}</b></span><span>Loans & advances still to recover <b class="mono">${fmt(loanOut)}</b></span><span>Net position <b class="mono ${T.closing - loanOut < 0 ? "neg" : ""}">${fmt(T.closing - loanOut)}</b></span></div>`;
}

// View / Edit / Delete on the driver's account lines
function txActions(ref){
  if(!ref) return "";
  const k = esc(JSON.stringify(ref));
  return `<div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-txview="${k}">View</button><button class="btn sm" data-txedit="${k}">Edit</button><button class="btn sm danger" data-txdel="${k}">Delete</button></div>`;
}
// show a period: used to open the month of a document that is outside the dates at the top
async function showPeriod(a, b){ S.from = a; S.to = b; $("#pFrom").value = a; $("#pTo").value = b; $("#preset").value = "custom"; await loadPeriod(); }
async function txOpen(ref, edit){
  if(ref.kind === "payroll"){
    // a finalised salary: View shows its statement; Edit reopens it so it can be changed and finalised again
    if(edit){ const p = S.payroll[ref.id]; if(p && !await writeOk(S.db.doc("payroll/" + ref.id).delete())) return; toast("Salary reopened – make the changes and finalise again."); }
    S.drvTab = "salary"; await showPeriod(ref.from, ref.to); render(); window.scrollTo(0,0); return;
  }
  const inPeriod = () => S.entries.some(e => e.id === ref.id);
  if(!inPeriod()) await showPeriod(ref.date.slice(0,7) + "-01", monthEnd(ref.date.slice(0,7)));
  if(ref.kind === "doc"){ S.view = ref.type === "receipt" ? "receipts" : ref.type === "journal" ? "journals" : "payments"; S.drvView = ""; if(window.BOOKS) BOOKS.openDoc(ref.id); render(); window.scrollTo(0,0); return; }
  const e = S.entries.find(x => x.id === ref.id); if(!e) return;
  S.view = "entries"; S.drvView = ""; S.edit = {kind: "entry", id: e.id, data: {...e}}; render(); window.scrollTo(0,0);
}
async function txDelete(ref){
  if(ref.kind === "payroll"){ if(await writeOk(S.db.doc("payroll/" + ref.id).delete())) toast("Salary reopened (the finalised record is deleted)."); render(); return; }
  const m = ref.date.slice(0,7), snap = await S.db.doc("entries/" + m).get(), rows = (snap.exists ? snap.data().rows || [] : []).filter(x => x.id !== ref.id);
  if(await writeOk(S.db.doc("entries/" + m).set({month: m, rows}))){ await loadPeriod(); render(); toast("Deleted."); }
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
/* ---------- salary statement (sections) ---------- */
/* One model feeds the screen, the printed statement and the finalised record:
   1 Performance · 2 Earnings by platform · 3 Direct (fare-related) expenditure · 4 Salary calculation
   (company share / fees, violation deductions) · 5 Entitled to be paid (less loans, advances, visa…)
   and the cash settlement · 6 Cash reconciliation (receivable less platform and machine payments and
   the cash with the driver). */
function salaryModel(id, x, late, lateEff, T){
  const tm = termAt(termList(S.drivers[id] || {}, DRV_TERMS), S.to) || {}, mode = tm.expMode === "before" ? "before" : "after";
  const mine = S.trips.filter(t => t.dr === id), byPl = {};
  const exS = new Set(selDoc(id).excluded || []);
  mine.filter(t => !exS.has(t.id)).forEach(t => { const b = byPl[plOf(t)] ||= {f:0, fee:0, n:new Set()}; b.f += t.f||0; b.fee += (t.sf||0) + (t.tx||0); if(t.tr || t.f) b.n.add(t.tr || t.id); });
  const platforms = Object.entries(byPl).map(([k, b]) => ({name: pName(k), n: b.n.size, fares: r2(b.f), fee: r2(b.fee), net: r2(b.f - b.fee)})).filter(p => p.n || p.net).sort((a,b) => b.net - a.net);
  const earnings = r2(x.net + num(x.other));
  const recov = S.entries.filter(e => e.driverId === id && e.type === "expense" && e.recover), byCat = {};
  recov.forEach(e => byCat[e.category || "5310"] = r2((byCat[e.category || "5310"] || 0) + num(e.amount) + num(e.vat)));
  const expenditure = r2(num(x.dexp)), netEarn = r2(earnings - (mode === "before" ? expenditure : 0));
  const rentAmt = r2(num(x.rentAmt)), rta = r2(num(x.rta)), base = r2(mode === "before" ? x.ent - x.deduct : x.ent);
  const coShare = r2(netEarn - base - rentAmt - rta);
  const pens = Object.values(S.drvAdj || {}).filter(a => a.driverId === id && a.kind === "penalty" && a.date >= S.from && a.date <= S.to);
  const salary = r2(base + x.tipsDue - num(x.penalty));
  const items = Object.values(S.ditems).filter(it => it.driverId === id).map(it => ({it, amt: r2(sum(itemPlan(it).inst.filter(q => q.date >= S.from && q.date <= S.to), q => q.amt) + sum((it.repayments || []).filter(r => r.paidTo === "2100" && r.date >= S.from && r.date <= S.to), r => num(r.amount)))})).filter(o => o.amt);
  const viaInc = r2(sum(S.entries.filter(e => e.driverId === id && e.type === "income" && e.paidFrom === "driver"), e => num(e.amount) + num(e.vat))), viaExp = r2(x.viaDriver + viaInc);
  const entitled = r2(salary - x.inst - x.adv - (mode === "after" ? x.deduct : 0) + viaExp);
  const due = r2(entitled - x.cash - viaInc + x.card + lateEff);
  const paidIn = r2(x.balance - salaryOf(x)), payable = T ? r2(T.before + due + paidIn) : null;
  // cash reconciliation
  const otherGross = r2(sum(S.entries.filter(e => e.driverId === id && e.type === "income"), e => num(e.amount) + num(e.vat)));
  const receivable = r2(x.fare + x.tip + x.ref + otherGross), app = r2(x.fare + x.tip + x.ref - x.cash), otherCo = r2(otherGross - viaInc);
  const expected = r2(x.cash + viaInc - x.card);
  // cash the driver gave back: "Received from driver" entries, receipts from him (Receipts → driver → cash handed over), and company costs he paid from that cash
  const fromReceipts = window.BOOKS ? sum(BOOKS.driverLines(S.entries, id).filter(l => l.ref && l.ref.type === "receipt"), l => l.cr || 0) : 0;
  const handed = r2(x.recv + fromReceipts + sum(S.entries.filter(e => e.driverId === id && e.type === "expense" && e.paidFrom === "driver"), e => num(e.amount) + num(e.vat)));
  const decl = Object.values(S.drvAdj || {}).find(a => a.driverId === id && a.kind === "cash" && a.from === S.from && a.to === S.to);
  const inHand = decl ? r2(num(decl.amount)) : null, diff = r2(expected - handed - (inHand == null ? 0 : inHand));
  // performance
  const C = compute(), all = Object.values(C.D).filter(d => d.n && S.drivers[d.id]), acts = (S.activity || []).filter(a => a.dr === id);
  const perf = {n: x.n, days: x.daysWorked || 0, km: r2(x.km), perDay: x.daysWorked ? r2(x.net / x.daysWorked) : 0, fleetDay: r2(sum(all, d => d.net) / Math.max(1, sum(all, d => d.daysWorked))),
    perTrip: x.n ? r2(x.net / x.n) : 0, cashPct: x.fare ? Math.round(100 * x.cash / x.fare) : 0, rank: all.sort((a,b) => b.net - a.net).findIndex(d => d.id === id) + 1, of: all.length,
    completion: acts.length ? Math.round(100 * acts.filter(a => a.st === "completed").length / acts.length) : null, cancelled: acts.filter(a => /cancel/.test(a.st || "")).length};
  return {id, x, tm, mode, platforms, earnings, byCat, expenditure, netEarn, rentAmt, rta, base, coShare, pens, salary, items, viaInc, viaExp, entitled, due, paidIn, payable, late, lateEff, T,
    receivable, app, otherCo, expected, handed, inHand, diff, perf};
}
// the statement as sections of rows – shared by the screen and the printed copy
function salaryRows(M){
  const x = M.x, tm = M.tm, L = (label, v, kind = "") => ({label, v, kind});
  const model = tm.payModel || "commission", pct = num(tm.commissionPct);
  const payLabel = model === "rent" ? "Driver earnings after company fee" : model === "salary" ? "Salary" : model === "salary_comm" ? `Salary + commission (${pct}%)` : `Commission (${pct}%)`;
  const S2 = M.platforms.map(p => L(`${esc(p.name)} <span class="sub">${p.n} trips · fares ${fmt(p.fares)} − fee & VAT ${fmt(p.fee)}</span>`, p.net));
  if(num(x.other)) S2.push(L("Other bookings (direct)", x.other));
  if(x.excluded) S2.push(L(`<span class="sub">${x.excluded} trip row(s) of this period are left out of this salary (Trip history)</span>`, null));
  S2.push(L("Total earnings", M.earnings, "t"));
  const S3 = Object.entries(M.byCat).map(([c, v]) => L(esc(EXP_CATS[c] || "Expense"), -v));
  if(!S3.length) S3.push(L('<span class="sub">No direct expenditure this period</span>', null));
  S3.push(L("Total direct expenditure", -M.expenditure, "t"));
  S3.push(L("Net earnings", r2(M.earnings - M.expenditure), "g"));   // earnings less direct expenditure
  const S4 = [];
  if(M.rentAmt) S4.push(L(`Company fee (${x.rentDays} days × ${fmt(num(tm.rentPerDay))})`, -M.rentAmt));
  if(M.rta) S4.push(L(`RTA / permit fee (${x.rtaDays} days × ${fmt(num(tm.rtaPerDay))})`, -M.rta));
  S4.push(L(payLabel, M.base, "t"));
  if(x.tipsDue) S4.push(L("Tips from platforms", x.tipsDue));
  M.pens.forEach(a => S4.push({...L(`Violation deduction${a.pct ? " " + num(a.pct) + "%" : ""}${a.reason ? " – " + esc(a.reason) : ""}`, -num(a.amount)), pen: a.id}));
  S4.push(L("Salary for the period", M.salary, "g"));
  const S5 = [L("Salary for the period", M.salary)];
  M.items.forEach(o => S5.push(L(`Less ${esc((ITEM_KINDS[o.it.kind] || "recovery").toLowerCase())}${o.it.desc ? " – " + esc(o.it.desc) : ""}`, -o.amt)));
  if(x.adv) S5.push(L("Less advances", -x.adv));
  if(M.mode === "after" && M.expenditure) S5.push(L("Less direct expenditure", -x.deduct));
  if(M.viaExp) S5.push(L("Add company costs paid from the driver's cash", M.viaExp));
  S5.push(L("Less cash collected from riders", -x.cash));
  if(M.viaInc) S5.push(L("Less cash from direct bookings", -M.viaInc));
  if(x.card) S5.push(L("Add card payments on the company machine", x.card));
  if(M.late.length) S5.push(L(`Unsettled trips from earlier periods (${M.late.length})`, M.lateEff));
  S5.push(L("Net payable for the period", M.due, "t"));
  if(M.paidIn) S5.push(L("Paid to / received from the driver in the period", M.paidIn));
  if(M.T){ S5.push(L("Balance brought forward", M.T.before)); S5.push(L(M.payable >= 0 ? "Balance payable to the driver" : "Balance the driver owes", M.payable, "g")); }
  const S6 = [L("Total receivable (fares, tips & tolls + other bookings)", M.receivable, "t"), L("Less platform payments (paid in the app)", -M.app)];
  if(M.otherCo > 0.004) S6.push(L("Less other bookings received by the company", -M.otherCo));
  S6.push(L("Less machine payments (card)", -x.card), L("Cash that should be with the driver", M.expected, "t"), L("Less handed over / spent for the company", -M.handed),
    L(M.inHand == null ? "Less cash in hand with the driver (not counted)" : "Less cash in hand with the driver (counted)", M.inHand == null ? null : -M.inHand),
    L(`Difference – ${M.inHand == null ? "still to be accounted for" : Math.abs(M.diff) < 0.005 ? "fully accounted for" : M.diff > 0 ? "shortage" : "excess"}`, M.diff, "g"));
  return [["2", "Earnings", S2], ["3", "Direct expenditure", S3], ["4", "Salary calculation", S4], ["5", "Payable this period", S5], ["6", "Cash reconciliation", S6]];
}
/* Performance targets (per month): the general targets in Settings apply to every driver, unless the driver
   has his own targets (driver form → "Own targets"). Trips, days and km are pro-rated to the period
   (a full month counts as 1); completion % is not. */
function driverTargets(id){
  const d = S.drivers[id] || {}, own = d.ownTargets === true || d.ownTargets === "true";
  const src = own ? {trips: d.tgTrips, days: d.tgDays, km: d.tgKm, comp: d.tgCompletion}
    : {trips: setting("tgTrips", 300), days: setting("tgDays", 25), km: setting("tgKm", 3000), comp: setting("tgCompletion", 80)};
  let f = 0; for(let day = S.from; day <= S.to; day = addDays(day, 1)) f += 1 / dim(day);
  const t = v => num(v) ? num(v) * f : null;
  return {own, f, trips: t(src.trips), days: t(src.days), km: t(src.km), comp: num(src.comp) || null};
}
function targetRows(id, x, completion){
  const T = driverTargets(id), rows = [];
  const add = (label, target, actual, unit, round) => { if(target == null) return; const tv = round ? Math.round(target) : r2(target); rows.push({label, target: tv, actual, unit, pct: tv ? Math.round(100 * actual / tv) : 0, met: actual >= tv - 0.0001}); };
  add("Trips", T.trips, x.n || 0, "", true); add("Days worked", T.days, x.daysWorked || 0, "", true); add("Distance", T.km, r2(x.km || 0), " km", true);
  if(T.comp != null && completion != null) add("Completion", T.comp, completion, "%", true);
  return {T, rows};
}
function targetTable(id, x, completion, print){
  const {T, rows} = targetRows(id, x, completion); if(!rows.length) return "";
  const met = rows.filter(r => r.met).length, f = v => typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : fmt(v)) : v;
  const note = `${T.own ? "Driver's own targets" : "General targets"}${Math.abs(T.f - 1) > 0.01 ? ` · pro-rated to ${r2(T.f)} month` : " · monthly"}`;
  if(print) return `<table class="tg"><tr class="sec"><th colspan="5">Targets – ${met} of ${rows.length} met <span style="font-weight:400">(${note})</span></th></tr><tr><th>Measure</th><th>Target</th><th>Actual</th><th>Achieved</th><th>Status</th></tr>
    ${rows.map(r => `<tr><td>${r.label}</td><td class="c">${f(r.target)}${r.unit}</td><td class="c">${f(r.actual)}${r.unit}</td><td class="c">${r.pct}%</td><td class="c ${r.met ? "ok" : "no"}">${r.met ? "Met" : "Not met"}</td></tr>`).join("")}</table>`;
  return `<div class="tbl" style="margin-top:6px"><table><thead><tr><th>Target <span class="small muted" style="text-transform:none;letter-spacing:0">(${note})</span></th><th class="num">Target</th><th class="num">Actual</th><th class="num">Achieved</th><th>${met} of ${rows.length} met</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${r.label}</td><td class="num">${f(r.target)}${r.unit}</td><td class="num">${f(r.actual)}${r.unit}</td><td class="num">${r.pct}%</td><td><span class="pill ${r.met ? "good" : "bad"}">${r.met ? "Met" : "Not met"}</span></td></tr>`).join("")}</tbody></table></div>`;
}
// "3 of 4" for the Drivers list
function targetSummary(id, x){
  const acts = (S.activity || []).filter(a => a.dr === id), comp = acts.length ? Math.round(100 * acts.filter(a => a.st === "completed").length / acts.length) : null;
  const {rows} = targetRows(id, x || {}, comp); if(!rows.length) return "";
  const met = rows.filter(r => r.met).length;
  return `<span class="pill ${met === rows.length ? "good" : met ? "warn" : "bad"}" title="${esc(rows.map(r => r.label + ": " + r.actual + r.unit + " / " + r.target + r.unit).join(" · "))}">${met} of ${rows.length}</span>`;
}
window.targetSummary = targetSummary;
const perfCells = P => [["Trips", P.n], ["Days worked", P.days], ["Distance", fmt(P.km) + " km"], ["Net per day", fmt(P.perDay)], ["Fleet average / day", fmt(P.fleetDay)], ["Net per trip", fmt(P.perTrip)], ["Cash trips", P.cashPct + "%"],
  ...(P.completion != null ? [["Completion", P.completion + "%"], ["Cancelled", P.cancelled]] : []), ["Rank", P.rank ? P.rank + " of " + P.of : "—"]];
function salaryHtml(M, print, locked){
  const cells = perfCells(M.perf);
  const perfT = targetTable(M.id, M.x, M.perf.completion, false);
  const perf0 = `<h3 style="margin:4px 0 6px">1. Performance</h3><div class="tbl"><table><thead><tr>${cells.map(c => `<th style="text-align:center">${c[0]}</th>`).join("")}</tr></thead><tbody><tr>${cells.map(c => `<td style="text-align:center"><b>${c[1]}</b></td>`).join("")}</tr></tbody></table></div>`;
  const perf = perf0 + perfT;
  const forms = {
    "4": locked ? "" : `<div class="row" style="gap:6px;margin-top:6px"><input type="number" step="0.01" id="penAmt" placeholder="AED" style="width:100px" aria-label="Deduction amount (AED)"><input id="penWhy" placeholder="Reason (e.g. RTA violation, complaint)" style="flex:1;min-width:160px" aria-label="Reason"><button class="btn sm" data-penadd="${esc(M.id)}">Deduct from salary</button></div>`,
    "5": recovTbl(M.id, locked),
    "6": locked ? "" : `<div class="row" style="gap:6px;margin-top:6px"><input type="number" step="0.01" id="cashDecl" placeholder="${r2(M.expected - M.handed)}" value="${M.inHand == null ? "" : M.inHand}" style="width:120px" aria-label="Cash in hand"><button class="btn sm" data-cashset="${esc(M.id)}">Save cash in hand (counted)</button></div>`};
  return perf + salaryRows(M).map(([n, title, rows]) => `<h3 style="margin:16px 0 6px">${n}. ${title}</h3><div class="tbl"><table><tbody>
    ${rows.map(r => `<tr${r.kind ? ' class="tot"' : ""}><td style="white-space:normal">${r.kind ? "<b>" + r.label + "</b>" : r.label}${r.pen && !locked ? ` <button class="btn sm ghost" data-pendel="${esc(r.pen)}" aria-label="Remove">✕</button>` : ""}</td><td class="num">${r.v == null ? "" : r.kind ? "<b>" + aed(r.v) + "</b>" : aed(r.v)}</td></tr>`).join("")}
  </tbody></table></div>${forms[n] || ""}`).join("");
}
// the printed statement: its own clean layout (letterhead, details, bordered sections, signatures)
const SAL_CSS = `.sp{font:8.6pt/1.3 "Segoe UI",Arial,sans-serif;color:#111;padding:7mm 11mm 5mm;width:210mm;box-sizing:border-box;background:#fff}
.sp .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #16213a;padding-bottom:6px;margin-bottom:8px}
.sp .co{font:700 15pt "Segoe UI",Arial,sans-serif;color:#16213a;line-height:1.1}.sp .co small{display:block;font:400 7.5pt "Segoe UI",Arial;color:#555;margin-top:3px}
.sp .ttl{text-align:right;color:#16213a}.sp .ttl b{display:block;font-size:11.5pt;letter-spacing:.08em}.sp .ttl span{font-size:8.5pt;color:#444}
.sp table{width:100%;border-collapse:collapse;margin:0 0 4px;page-break-inside:avoid}
.sp th,.sp td{white-space:normal;text-transform:none;letter-spacing:0;position:static;font-family:inherit;font-size:inherit;color:inherit;background:none}
.sp th,.sp td{border:1px solid #c5c9d2;padding:2px 7px;vertical-align:top}
.sp .info td{padding:3px 7px;font-size:8.5pt}.sp .info td.l{background:#f3f4f7;color:#555;width:15%;font-size:8pt}
.sp .perf th{background:#f3f4f7;color:#444;font-weight:600;font-size:7.5pt;text-align:center;padding:3px 2px}.sp .perf td{text-align:center;font-weight:700;padding:4px 2px}
.sp tr.sec th{background:#16213a;color:#fff;text-align:left;font-size:8.5pt;font-weight:600;letter-spacing:.03em}
.sp td.n{text-align:right;white-space:nowrap;width:26%;font-variant-numeric:tabular-nums}
.sp tr.t td{font-weight:700;background:#f3f4f7}.sp tr.g td{font-weight:700;background:#e4e8f0;border-top:2px solid #16213a}
.sp .tg th{background:#f3f4f7;color:#444;font-weight:600;font-size:7.5pt;text-align:center}.sp .tg tr.sec th{text-align:left}.sp .tg td.c{text-align:center}.sp .tg td.ok{color:#11703a;font-weight:700}.sp .tg td.no{color:#b3261e;font-weight:700}
.sp .sub{color:#666;font-size:7.5pt}.sp .neg{color:#111}
.sp .sigs{display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-top:12px;page-break-inside:avoid}
.sp .sigs .who{font-weight:700;color:#16213a}.sp .sigs .line{border-bottom:1px solid #333;height:30px;margin:2px 0 3px}.sp .sigs .cap{font-size:8pt;color:#555}
.sp .foot{margin-top:10px;font-size:7pt;color:#888;text-align:center}`;
function salaryPrintHtml(M, d, fin){
  const s = S.settings, co = s.company || "Royal Rides Limousine LLC", tm = M.tm, today = iso(new Date());
  const addr = [s.address, s.licence ? "Trade licence " + s.licence : "", s.trn ? "TRN " + s.trn : "", s.phone, s.email].filter(Boolean).join(" · ");
  const amt = v => v == null ? "" : (v < 0 ? "-" : "") + fmt(Math.abs(v));
  const cells = perfCells(M.perf), car = vehAt(M.id, S.to);
  return `<div class="sp">
  <div class="hd"><div class="co">${esc(co)}${addr ? `<small>${esc(addr)}</small>` : ""}</div><div class="ttl"><b>DRIVER SALARY STATEMENT</b><span>${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · amounts in AED</span></div></div>
  <table class="info"><tr><td class="l">Driver</td><td><b>${esc(d.name || "")}</b>${d.code ? " (" + esc(d.code) + ")" : ""}</td><td class="l">Period</td><td>${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</td></tr>
    <tr><td class="l">Pay terms</td><td>${esc(drvTermTextFull(tm))}</td><td class="l">Status</td><td>${fin ? "Finalised " + esc(dmyS(fin.at.slice(0,10))) : "Draft – not finalised"}</td></tr>
    <tr><td class="l">Car</td><td>${car ? esc(vName(car)) : "—"}</td><td class="l">Printed</td><td>${esc(dmyS(today))}</td></tr></table>
  <table class="perf"><tr class="sec"><th colspan="${cells.length}">1. Performance</th></tr><tr>${cells.map(c => `<th>${c[0]}</th>`).join("")}</tr><tr>${cells.map(c => `<td>${c[1]}</td>`).join("")}</tr></table>
  ${targetTable(M.id, M.x, M.perf.completion, true)}
  ${salaryRows(M).map(([n, title, rows]) => `<table><tr class="sec"><th colspan="2">${n}. ${title}</th></tr>${rows.map(r => `<tr${r.kind ? ` class="${r.kind}"` : ""}><td>${r.label}</td><td class="n">${amt(r.v)}</td></tr>`).join("")}</table>`).join("")}
  <div class="sigs"><div><div class="who">For Driver</div><div class="line"></div><div>${esc(d.name || "")}</div><div class="cap">Signature & date</div></div>
    <div><div class="who">For ${esc(co)}</div><div class="line"></div><div>${esc(s.signatory || "")}${s.signatoryTitle ? (s.signatory ? ", " : "") + esc(s.signatoryTitle) : ""}</div><div class="cap">Authorised signatory</div></div></div>
  </div>`;
}
async function printSalary(id){
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  if(!historyReady()){ toast("Still loading the history – try again in a moment."); return; }
  const x = selX(id, compute().D[id]) || {}, late = lateSelected(id) || [], M = salaryModel(id, x, late, r2(sum(late, tripEffect)), drvTx(id)), d = S.drivers[id] || {};
  const fin = Object.values(S.payroll).find(p => p.driverId === id && p.from === S.from && p.to === S.to);
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff";
  box.innerHTML = `<style>${SAL_CSS}</style>${salaryPrintHtml(M, d, fin)}`; document.body.appendChild(box);
  const name = `Salary_${(d.name || "driver").replace(/[^\w]+/g, "_")}_${S.from}_${S.to}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.97}, html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}, pagebreak: {mode: ["css", "legacy"], avoid: ["table", ".sigs"]}}).from(box.querySelector(".sp")).save(); toast("Downloaded " + name); }
  catch(e){ toast("Could not make the PDF. Try again."); }
  box.remove();
}

function dSalary(id){
  const C = compute(), x = selX(id, C.D[id]) || {n:0, fare:0, fee:0, tax:0, net:0, ent:0, tipsDue:0, cash:0, card:0, deduct:0, adv:0, inst:0, viaDriver:0, books:0, paid:0, recv:0, balance:0, daysWorked:0, rentDays:0};
  const runs = Object.values(S.payroll).filter(p => p.driverId === id).sort((a,b) => b.from.localeCompare(a.from));
  const overlap = runs.find(p => p.from <= S.to && p.to >= S.from), same = runs.find(p => p.from === S.from && p.to === S.to);
  const next = runs.length ? addDays(runs[0].to, 1) : null, ready = historyReady(), T = ready ? drvTx(id) : null;
  // late trips: settled by this period unless it is already finalised (then they were settled by it, or wait for the next)
  const late = same ? [] : (lateSelected(id) || []), lateEff = r2(sum(late, tripEffect)), sal = r2(salaryOf(x) + lateEff);
  const payable = T ? r2(T.before + sal + (x.balance - salaryOf(x))) : null;
  const M = salaryModel(id, x, late, lateEff, T);
  const lateTbl = late.length ? `<h2 style="margin-top:16px">Unsettled trips from earlier periods</h2><p class="sub">These trips are dated in a period that was already finalised, but they were not part of it (they arrived in a later report). They are added to this salary and settled when you finalise.</p>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Time</th><th>Trip</th><th class="num">Fare</th><th class="num">Net</th><th class="num">Tips</th><th class="num">Cash</th><th class="num">Effect on salary</th></tr></thead><tbody>
    ${late.map(t => `<tr><td>${esc(dmyS(t.d))}</td><td>${esc(t.t || "")}</td><td class="mono small">${esc(String(t.tr || t.id).slice(0,13))}</td><td class="num">${fmt(t.f)}</td><td class="num">${fmt((t.f||0) - (t.sf||0) - (t.tx||0))}</td><td class="num">${fmt(t.tp)}</td><td class="num">${fmt(t.c)}</td><td class="num">${aed(tripEffect(t))}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="7">Total</td><td class="num"><b>${aed(lateEff)}</b></td></tr></tfoot></table></div>` : "";
  let fin;
  if(same){
    let note;
    if(Array.isArray(same.rows)){
      // compare the trips it settled and the rest of the computation separately
      const inRec = new Set(same.rows), exS = new Set(selDoc(id).excluded || []), periodTrips = S.trips.filter(t => t.dr === id && moneyRow(t) && !exS.has(t.id));
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
  S.hdrBtns = `${pay}<button class="btn" data-salprint="${esc(id)}">Print / PDF for signing</button>`;
  const finBtn = same || overlap ? "" : `<button class="btn primary" data-finalise="${esc(id)}" ${S.canWrite && S.db && ready ? "" : "disabled"}>Finalise salary</button>`;
  return `<div style="max-width:980px"><h2>Salary statement · ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}${same ? ' <span class="pill good">Finalised</span>' : ""}</h2>
    ${same || overlap ? fin : ""}
    ${salaryHtml(M, false, !!same)}${!T ? `<p class="small muted">Loading the history (balance brought forward, unsettled trips)…</p>` : ""}${lateTbl}
    <div class="row" style="margin-top:14px;gap:8px">${finBtn}${dlBtn("dsal", id)}${!same && !overlap && next && next !== S.from ? `<button class="btn ghost" data-setperiod="${next}|${monthEnd(next.slice(0,7))}">Next period to finalise: ${esc(dmyS(next))} – ${esc(dmyS(monthEnd(next.slice(0,7))))}</button>` : ""}</div>
    <p class="small muted" style="margin-top:6px">Finalised salaries are listed in Transactions (View / Edit / Delete).</p></div>`;
}
async function finalise(id){
  const runs = Object.values(S.payroll).filter(p => p.driverId === id);
  if(runs.some(p => p.from <= S.to && p.to >= S.from)){ toast("Part of this period is already finalised."); return; }
  if(!historyReady()){ toast("Still loading the history – try again in a moment."); return; }
  const x = selX(id, compute().D[id]) || {}, T = drvTx(id), late = lateSelected(id) || [], lateEff = r2(sum(late, tripEffect)), exSet = new Set(selDoc(id).excluded || []);
  const periodTrips = S.trips.filter(t => t.dr === id && moneyRow(t) && !exSet.has(t.id) && !settleStatus(t).ok);
  const k = ["n","daysWorked","fare","fee","tax","net","ent","tipsDue","cash","card","deduct","adv","inst","viaDriver","books","paid","recv","balance"];
  const rec = {driverId: id, from: S.from, to: S.to, termsText: x.termsText || "", ...Object.fromEntries(k.map(f => [f, r2(num(x[f]))])),
    salary: r2(salaryOf(x) + lateEff), nonTrip: r2(salaryOf(x) - sum(periodTrips, tripEffect)), lateEffect: lateEff,
    entitled: (() => { const M = salaryModel(id, x, late, lateEff, T); return r2(M.due + x.cash + M.viaInc - x.card + sum(late, t => t.c || 0)); })(),
    cashCollected: r2(x.cash + sum(late, t => t.c || 0)), bookingCash: r2(sum(S.entries.filter(e => e.driverId === id && e.type === "income" && e.paidFrom === "driver"), e => num(e.amount) + num(e.vat))),
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
  const tgt = targetTable(id, x, acts.length ? Math.round(100 * done / Math.max(1, acts.length)) : null, false);
  return `<div class="row" style="justify-content:flex-end">${dlBtn("dperf", id)}</div>${tgt ? `<h2>Targets</h2>${tgt}` : ""}<div class="kpis" style="margin-top:12px">${kpi("Trips", x.n || 0, `${x.daysWorked || 0} days worked`)}${kpi("Net earnings", fmt(x.net), `rank ${rank || "—"} of ${all.length} drivers`)}${kpi("Net per day", fmt(perDay), `fleet average ${fmt(fleetDay)}`)}
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
  return `${form}<div class="row" style="margin-bottom:10px">${Object.entries({loan:"New loan", advance:"New salary advance", visa:"New visa", shared:"Other expense", other:"Other amount"}).map(([k,l]) => `<button class="btn ${k === "loan" ? "primary" : ""}" data-newitem="${k}">${l}</button>`).join("")}${dlBtn("daccts", id)}</div>
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

DL.dtrips = id => { const rows = S.trips.filter(t => t.dr === id && (t.tr || t.f || t.sf || t.tp || t.c || t.rf || t.oe)).sort((a,b) => (a.d + a.t).localeCompare(b.d + b.t)), ex = new Set(selDoc(id).excluded || []);
  return [`trips_${norm(dName(id))}_${S.from}_${S.to}.csv`, [["Date","Time","Platform","Car","Fare","Fee + VAT","Tips","Refunds","Cash","Net","Km","Status","Payment","Settlement","In this salary"],
    ...rows.map(t => [t.d, t.t || "", pName(plOf(t)), vName(vehicleForTrip(t) || "unassigned"), r2(t.f||0), r2((t.sf||0) + (t.tx||0)), r2(t.tp||0), r2(t.rf||0), r2(t.c||0), r2((t.f||0) - (t.sf||0) - (t.tx||0)), r2(t.km||0), t.st || "", t.pay || "", settleStatus(t).ok ? "Settled" : "Unsettled", settleStatus(t).ok ? "" : ex.has(t.id) ? "No" : "Yes"])]];
};
DL.dsal = id => { if(!historyReady()) { toast("Still loading – try again in a moment."); return null; }
  const x = selX(id, compute().D[id]) || {}, late = lateSelected(id) || [], M = salaryModel(id, x, late, r2(sum(late, tripEffect)), drvTx(id)), strip = h => String(h).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return [`salary_${norm(dName(id))}_${S.from}_${S.to}.csv`, [["Section","Line","AED"], ...perfCells(M.perf).map(c => ["1. Performance", c[0], c[1]]), ...salaryRows(M).flatMap(([n, title, rows]) => rows.map(r => [n + ". " + title, strip(r.label), r.v == null ? "" : r2(r.v)]))]];
};
DL.dperf = id => { const C = compute(), x = C.D[id] || {}, trips = S.trips.filter(t => t.dr === id && (t.tr || t.f)), W = {}, seen = new Set();
  trips.forEach(t => { const w = W[weekEnd(t.d)] ||= {n:0, days:new Set(), f:0, net:0, km:0, c:0}; const k = t.tr || t.id; if(!seen.has(k)){ seen.add(k); w.n++; w.km += t.km || 0; } w.days.add(t.d); w.f += t.f || 0; w.net += (t.f||0) - (t.sf||0) - (t.tx||0); w.c += t.c || 0; });
  const acts = (S.activity || []).filter(a => a.dr === id), comp = acts.length ? Math.round(100 * acts.filter(a => a.st === "completed").length / acts.length) : null, {rows} = targetRows(id, x, comp);
  return [`performance_${norm(dName(id))}_${S.from}_${S.to}.csv`, [["Targets","Target","Actual","Achieved %","Status"], ...rows.map(r => [r.label, r.target, r.actual, r.pct, r.met ? "Met" : "Not met"]), [], ["Week ending","Trips","Days","Fares","Net","Km","Cash"], ...Object.keys(W).sort().map(k => [k, W[k].n, W[k].days.size, r2(W[k].f), r2(W[k].net), r2(W[k].km), r2(W[k].c)])]];
};
DL.daccts = id => [`driver_accounts_${norm(dName(id))}_${S.to}.csv`, [["Date","Account","Description","Total cost","Driver share","Company bears","Monthly instalment","From month","Recovered","Outstanding"],
  ...Object.values(S.ditems).filter(it => it.driverId === id).sort((a,b) => (a.date || "").localeCompare(b.date || "")).map(it => { const cost = num(it.amount) + num(it.vat) || num(it.driverAmount), da = num(it.driverAmount), out = itemOutstanding(it, S.to); return [it.date, ITEM_KINDS[it.kind] || "", it.desc || "", r2(cost), r2(da), r2(cost - da), num(it.installment) || "in full", it.startMonth || "", r2(da - out), out]; })]];

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
  if(t.dataset.salprint){ printSalary(t.dataset.salprint); return; }
  if(t.dataset.tselall){ const id = t.dataset.tselall, open = S.trips.filter(x => x.dr === id && moneyRow(x) && !settleStatus(x).ok).map(x => x.id); await saveSel(id, {excluded: t.dataset.on === "1" ? [] : open}); render(); return; }
  if(t.dataset.tripview || t.dataset.tripedit){ S.tripEdit = {day: t.dataset.day, id: t.dataset.id, mode: t.dataset.tripview ? "view" : "edit"}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.tripclose){ S.tripEdit = null; render(); return; }
  if(t.dataset.tripdel){
    const tr = S.trips.find(x => x.id === t.dataset.id && x.d === t.dataset.day); if(!tr) return;
    if(settleStatus(tr).ok){ toast("This trip is settled in a finalised salary – reopen that salary first."); return; }
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Sure?"; return; }
    const snap = await S.db.doc("trips/" + tr.d).get(), rows = {...(snap.exists ? snap.data().rows || {} : {})}; delete rows[tr.id];
    if(await writeOk(S.db.doc("trips/" + tr.d).set({date: tr.d, rows}))){ S.tripEdit = null; await loadPeriod(); render(); toast("Trip deleted."); }
    return;
  }
  if(t.dataset.txview || t.dataset.txedit){
    const ref = JSON.parse(t.dataset.txview || t.dataset.txedit);
    if(t.dataset.txedit && ref.kind === "payroll" && t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Reopen?"; return; }
    await txOpen(ref, !!t.dataset.txedit); return;
  }
  if(t.dataset.txdel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Sure?"; return; } await txDelete(JSON.parse(t.dataset.txdel)); return; }
  if(t.dataset.penadd){
    const id = t.dataset.penadd, amount = r2(num((document.getElementById("penAmt") || {}).value)), why = ((document.getElementById("penWhy") || {}).value || "").trim();
    if(amount <= 0){ toast("Enter the amount to deduct (AED)."); return; }
    if(!why){ toast("Enter the reason for the deduction."); return; }
    if(await writeOk(S.db.doc("drvAdj/pen-" + uid()).set({kind: "penalty", driverId: id, date: S.to, from: S.from, amount, reason: why, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()}))) toast(`Deducted AED ${fmt(amount)} from the salary.`);
    return;
  }
  if(t.dataset.pendel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Remove?"; return; } if(await writeOk(S.db.doc("drvAdj/" + t.dataset.pendel).delete())) toast("Deduction removed."); return; }
  if(t.dataset.cashset){
    const id = t.dataset.cashset, v = (document.getElementById("cashDecl") || {}).value, key = `cash-${id}-${S.from}-${S.to}`;
    if(v === "" || v == null){ if(await writeOk(S.db.doc("drvAdj/" + key).delete())) toast("Cash in hand cleared."); return; }
    if(await writeOk(S.db.doc("drvAdj/" + key).set({kind: "cash", driverId: id, from: S.from, to: S.to, date: S.to, amount: num(v), by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()}))) toast("Cash in hand saved.");
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

document.addEventListener("change", async ev => {
  const t = ev.target;
  if(t.dataset && t.dataset.tsel){ const id = t.dataset.drv, ex = new Set(selDoc(id).excluded || []); t.checked ? ex.delete(t.dataset.tsel) : ex.add(t.dataset.tsel); await saveSel(id, {excluded: [...ex]}); render(); }
  if(t.dataset && t.dataset.tlate){ const id = t.dataset.drv, pk = new Set(selDoc(id).late || []); t.checked ? pk.add(t.dataset.tlate) : pk.delete(t.dataset.tlate); await saveSel(id, {late: [...pk]}); render(); }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fTrip") return; ev.preventDefault(); if(!S.db) return;
  const fd = Object.fromEntries(new FormData(f).entries()), day0 = f.dataset.day, id = f.dataset.id;
  const snap0 = await S.db.doc("trips/" + day0).get(), rows0 = {...(snap0.exists ? snap0.data().rows || {} : {})}, old = rows0[id]; if(!old){ toast("Trip not found."); return; }
  const row = {...old, d: fd.d, t: fd.t || "", dr: fd.dr, p: fd.p || "", edited: {at: new Date().toISOString(), by: (S.user && (S.user.name || S.user.id)) || "", note: fd.note || ""}};
  TRIP_FIELDS.forEach(([k]) => row[k] = r2(num(fd[k])));
  if(fd.d === day0){ rows0[id] = row; if(!await writeOk(S.db.doc("trips/" + day0).set({date: day0, rows: rows0}))) return; }
  else {
    // moved to another day: write the new day first, then remove it from the old one
    const s1 = await S.db.doc("trips/" + fd.d).get(), rows1 = {...(s1.exists ? s1.data().rows || {} : {}), [id]: row};
    if(!await writeOk(S.db.doc("trips/" + fd.d).set({date: fd.d, rows: rows1}))) return;
    delete rows0[id]; if(!await writeOk(S.db.doc("trips/" + day0).set({date: day0, rows: rows0}))) return;
  }
  S.tripEdit = null; await loadPeriod(); render(); toast("Trip saved.");
});
