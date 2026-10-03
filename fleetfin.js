/* Vehicle purchase & finance (vehicle.fin). Each car is owned by the company or by an investor, and bought
   with full payment or with a bank finance facility (bank, facility number, loan, down payment, flat rate,
   tenure, monthly instalment, first due date, paid from which bank account). One investor can hold cars
   bought both ways.
   Accounting
   - Company car, full payment:  Dr 1500 Motor vehicles / Cr bank.
   - Company car, bank finance:  Dr 1500 price / Cr 2400 Vehicle finance loans (loan) and Cr bank (down payment);
                                 each instalment: Dr 2400 principal + Dr 5950 finance cost / Cr bank.
   - Investor car, bank finance: the facility is in the company's name for the investor's car:
                                 Dr 1190 Investor vehicle finance / Cr 2400 (loan); each instalment: Dr 2400 principal
                                 + Dr 1190 profit / Cr bank, recovered from the investor's earnings: Dr 2200 / Cr 1190.
                                 The investor's down payment is recorded on the car (memo).
   - Investor car, full payment: paid by the investor – recorded on the car only.
   Instalments are taken as paid on their due dates (standing order) from the chosen bank account. */
Object.assign(ACCT, {"1500":"Motor vehicles", "1190":"Investor vehicle finance (recoverable)", "2400":"Vehicle finance loans (banks)", "5950":"Vehicle finance cost (profit / interest)"});
if(typeof ACCT_BASE !== "undefined") Object.assign(ACCT_BASE, {"1500":"Motor vehicles", "1190":"Investor vehicle finance (recoverable)", "2400":"Vehicle finance loans (banks)", "5950":"Vehicle finance cost (profit / interest)"});

const finOf = v => v && v.fin && num(v.fin.price) ? v.fin : null;
const finOwner = v => (finOf(v) || {}).owner || ((termAt(termList(v, VEH_TERMS), iso(new Date())) || {}).investorId ? "investor" : "company");
const addMonths = (d, n) => { const [y, m, day] = d.split("-").map(Number), t = new Date(y, m - 1 + n, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate(); return iso(new Date(t.getFullYear(), t.getMonth(), Math.min(day, last))); };
// the instalment schedule: flat rate – equal principal and equal profit in every instalment
function finSchedule(v){
  const f = finOf(v); if(!f || f.funding !== "bank") return [];
  const loan = num(f.loan), n = Math.max(1, Math.round(num(f.months))), emi = num(f.emi) || r2((loan + loan * num(f.rate) / 100 * n / 12) / n);
  const profit = Math.max(0, r2(emi * n - loan)), out = []; let bal = loan, pp = 0, ip = 0;
  for(let i = 0; i < n; i++){
    const last = i === n - 1, pr = last ? r2(loan - pp) : r2(loan / n), it = last ? r2(profit - ip) : r2(profit / n);
    pp = r2(pp + pr); ip = r2(ip + it); bal = r2(bal - pr);
    out.push({no: i + 1, date: addMonths(f.firstDue || f.purchaseDate || iso(new Date()), i), emi: r2(pr + it), principal: pr, profit: it, balance: bal});
  }
  return out;
}
const dealerName = f => f && f.supplierId && S.suppliers[f.supplierId] ? S.suppliers[f.supplierId].name : (f && f.dealer) || "";
const finText = v => { const f = finOf(v); if(!f) return ""; return f.funding === "bank" ? `${f.bank || "Bank"} finance${f.facility ? " · " + f.facility : ""}` : f.funding === "credit" ? "Supplier credit – " + (dealerName(f) || "supplier") : "Full payment"; };
// a car bought on credit is owed to its supplier: it shows on the supplier's statement and balance
function supplierMoves(p){
  const out = [];
  for(const v of Object.values(S.vehicles)){
    const f = finOf(v); if(!f || f.funding !== "credit" || !f.supplierId || "s:" + f.supplierId !== p || !f.purchaseDate || f.purchaseDate > S.to) continue;
    if(f.purchaseDate < setting("ledgerStart", "2026-09-01")) continue;   // before the books start: in the supplier's opening balance
    out.push({date: f.purchaseDate, desc: "Purchase of " + vName(v.id) + " on credit", dr: 0, cr: r2(num(f.price) - num(f.downPayment))});
  }
  return out;
}
function finOutstanding(v, day){ return r2(num((finOf(v) || {}).loan) - sum(finSchedule(v).filter(x => x.date <= day), x => x.principal)); }

/* journal: purchases and instalments in the period */
function postFin(add){
  for(const v of Object.values(S.vehicles)){
    const f = finOf(v); if(!f) continue;
    const owner = finOwner(v), name = vName(v.id), acct = f.payFrom || "1100", price = num(f.price), loan = num(f.loan), dp = num(f.downPayment);
    if(f.purchaseDate && f.purchaseDate >= S.from && f.purchaseDate <= S.to){
      const m = `Purchase of ${name}${dealerName(f) ? " – " + dealerName(f) : ""}`, cred = r2(price - dp);
      if(owner === "company"){
        add("1500", price, 0, m, f.purchaseDate);
        if(f.funding === "bank"){ add("2400", 0, loan, m + " – " + (f.bank || "bank") + " finance", f.purchaseDate); if(r2(price - loan)) add(acct, 0, price - loan, m + " – down payment", f.purchaseDate); }
        else if(f.funding === "credit"){ add("2000", 0, cred, m + " – on credit", f.purchaseDate); if(dp) add(acct, 0, dp, m + " – down payment", f.purchaseDate); }
        else add(acct, 0, price, m, f.purchaseDate);
      } else if(f.funding === "credit"){
        // the company owes the supplier for the investor's car – recoverable from the investor
        add("1190", cred, 0, m + " – on credit for " + iName(v.investorId), f.purchaseDate); add("2000", 0, cred, m + " – on credit", f.purchaseDate);
        if(f.downBy === "company" && dp){ add("1190", dp, 0, m + " – down payment for " + iName(v.investorId), f.purchaseDate); add(acct, 0, dp, m + " – down payment", f.purchaseDate); }
      } else if(f.funding === "bank"){
        add("1190", loan, 0, m + " – finance for " + iName(v.investorId), f.purchaseDate); add("2400", 0, loan, m + " – " + (f.bank || "bank") + " finance", f.purchaseDate);
        // a down payment the company made for the investor is recoverable from him as well
        if(f.downBy === "company" && dp){ add("1190", dp, 0, m + " – down payment for " + iName(v.investorId), f.purchaseDate); add(acct, 0, dp, m + " – down payment", f.purchaseDate); }
      }
    }
    for(const x of finSchedule(v)){
      if(x.date < S.from || x.date > S.to) continue;
      const m = `${f.bank || "Bank"} instalment ${x.no} – ${name}${f.facility ? " – " + f.facility : ""}`;
      add("2400", x.principal, 0, m, x.date); add(owner === "company" ? "5950" : "1190", x.profit, 0, m, x.date); add(acct, 0, x.emi, m, x.date);
      if(owner === "investor"){ add("2200", x.emi, 0, "Recovered from investor – " + m, x.date); add("1190", 0, x.emi, "Recovered from investor – " + m, x.date); }
    }
  }
}
// instalments recovered from an investor in a period (deducted from what he is paid)
function investorEmi(invId, from, to){
  return r2(sum(Object.values(S.vehicles).filter(v => finOf(v) && finOwner(v) === "investor" && (v.investorId === invId || (termAt(termList(v, VEH_TERMS), to) || {}).investorId === invId)),
    v => sum(finSchedule(v).filter(x => x.date >= from && x.date <= to), x => x.emi)));
}
// opening balances at the books start for cars bought before it
function finOpening(code){
  const start = setting("ledgerStart", "2026-09-01"); let o = 0;
  for(const v of Object.values(S.vehicles)){
    const f = finOf(v); if(!f || !f.purchaseDate || f.purchaseDate >= start) continue;
    const owner = finOwner(v), before = finSchedule(v).filter(x => x.date < start), out = r2(num(f.loan) - sum(before, x => x.principal));
    if(code === "1500" && owner === "company") o += num(f.price);
    if(code === "2400" && f.funding === "bank") o -= out;
    if(code === "1190" && owner === "investor" && f.funding === "bank") o += out;
  }
  return r2(o);
}

/* ---------- the car's "Purchase & finance" tab ---------- */
function vehFinTab(id){
  const v = S.vehicles[id], f = v.fin || {}, edit = S.finEdit === id || !finOf(v), sch = finSchedule(v), today = iso(new Date()), owner = finOwner(v);
  const fld = (n, l, type = "text", extra = "") => `<div class="f"><label for="vf_${n}">${l}</label><input id="vf_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(f[n] ?? "")}"${extra}></div>`;
  if(edit) return `<form class="form" id="fVehFin" data-id="${esc(id)}">
    <div class="f"><label for="vf_owner">Owned by</label><select id="vf_owner" name="owner">${opts({company: "Company", investor: "Investor" + ((termAt(termList(v, VEH_TERMS), today) || {}).investorId ? " – " + iName((termAt(termList(v, VEH_TERMS), today) || {}).investorId) : "")}, f.owner || owner)}</select></div>
    ${fld("purchaseDate", "Purchase date", "date")}${fld("price", "Purchase price (AED)", "number", " required")}
    <div class="f"><label for="vf_supplierId">Supplier (dealer / seller)</label><select id="vf_supplierId" name="supplierId">${opts(Object.fromEntries(Object.values(S.suppliers).sort((a,b) => (a.name || "").localeCompare(b.name || "")).map(x => [x.id, x.name])), f.supplierId || "", f.dealer && !f.supplierId ? "— (was: " + f.dealer + ")" : "—")}</select><span class="small muted">New dealer? Add him under Accounts → Suppliers.</span></div>
    <div class="f"><label for="vf_funding">Paid by</label><select id="vf_funding" name="funding">${opts({cash: "Full payment", bank: "Bank finance", credit: "Supplier credit – pay the supplier later"}, f.funding || "cash")}</select></div>
    <div class="f"><label for="vf_payFrom">Paid from / instalments from</label><select id="vf_payFrom" name="payFrom">${opts(acctOpts(["bank","cash"]), f.payFrom || "1100")}</select></div>
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Bank finance / down payment</b> <span class="small muted">– bank fields only for a bank finance. On supplier credit the price less the down payment is owed to the supplier (pay him from Payments → account 2000). Instalment blank = worked out from the flat rate.</span></div>
    ${fld("bank", "Bank")}${fld("facility", "Facility ID / number")}${fld("loan", "Loan amount", "number")}${fld("downPayment", "Down payment", "number")}
    <div class="f"><label for="vf_downBy">Down payment paid by</label><select id="vf_downBy" name="downBy">${opts({company: "Company", investor: "Investor"}, f.downBy || (owner === "investor" ? "investor" : "company"))}</select></div>
    ${fld("rate", "Flat rate % per year", "number")}${fld("months", "Tenure (months)", "number")}${fld("emi", "Monthly instalment (EMI)", "number")}${fld("firstDue", "First instalment date", "date")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Depreciation</b> <span class="small muted">– company-owned cars only; investor cars are not the company's assets.</span></div>
    ${fld("lifeYears", "Useful life (years, default 5)", "number")}${fld("residualPct", "Residual value % (default 20)", "number")}
    <div class="f wide"><label for="vf_notes">Notes</label><input id="vf_notes" name="notes" value="${esc(f.notes)}"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button>${finOf(v) ? `<button class="btn ghost" type="button" data-finedit="">Cancel</button>` : ""}</div></form>`;
  const tot = {emi: sum(sch, x => x.emi), p: sum(sch, x => x.principal), i: sum(sch, x => x.profit)}, paid = sch.filter(x => x.date <= today), next = sch.find(x => x.date > today);
  const info = [["Owned by", owner === "company" ? "Company" : "Investor – " + iName(v.investorId)], ["Purchased", (f.purchaseDate ? dmyS(f.purchaseDate) : "—")], ["Supplier", dealerName(f)], ["Price", fmt(num(f.price))],
    ["Paid by", f.funding === "bank" ? "Bank finance" : f.funding === "credit" ? `Supplier credit – ${fmt(num(f.price) - num(f.downPayment))} owed to the supplier${num(f.downPayment) ? ", down payment " + fmt(num(f.downPayment)) : ""}` : "Full payment"], ...(f.funding === "bank" ? [["Bank", f.bank], ["Facility no.", f.facility], ["Loan", fmt(num(f.loan))], ["Down payment", fmt(num(f.downPayment)) + " (" + (f.downBy === "investor" ? "investor" : "company") + ")"],
    ["Flat rate / tenure", `${num(f.rate)}% · ${num(f.months)} months`], ["Instalment", fmt(sch[0] ? sch[0].emi : 0) + " from " + (sch[0] ? dmyS(sch[0].date) : "—")], ["Outstanding today", fmt(finOutstanding(v, today))], ["Next instalment", next ? dmyS(next.date) + " · " + fmt(next.emi) : "—"]] : []),
    ["Paid from", acctName(f.payFrom || "1100")], ...(owner === "company" ? [["Depreciation", `${num(f.lifeYears) || 5} years, residual ${String(f.residualPct ?? "") === "" ? 20 : num(f.residualPct)}% · accumulated ${fmt(deprFor(v, "1900-01-01", today))} · book value ${fmt(num(f.price) - deprFor(v, "1900-01-01", today))}`]] : [["Depreciation", "None – the car is the investor's asset"]])];
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${owner === "investor" && f.funding === "bank" ? "Instalments are recovered from the investor's earnings (Investor P&L)." : owner === "company" && f.funding === "bank" ? "Instalments: principal reduces the loan, the profit is a finance cost." : ""}</span><div class="row">${sch.length ? dlBtn("finsch", id) : ""}<button class="btn sm" data-finedit="${esc(id)}">Edit</button></div></div>
  <div class="tbl"><table><tbody>${info.map(([l, val]) => `<tr><td class="muted" style="width:30%">${l}</td><td>${esc(val || "—")}</td></tr>`).join("")}${f.notes ? `<tr><td class="muted">Notes</td><td>${esc(f.notes)}</td></tr>` : ""}</tbody></table></div>
  ${sch.length ? `<h3 style="margin:14px 0 6px">Instalment schedule <span class="small muted">· ${paid.length} of ${sch.length} paid</span></h3><div class="tbl"><table><thead><tr><th class="num">#</th><th>Due date</th><th class="num">Instalment</th><th class="num">Principal</th><th class="num">Profit / interest</th><th class="num">Loan balance</th><th>Status</th></tr></thead><tbody>
    ${sch.map(x => `<tr><td class="num">${x.no}</td><td>${esc(dmyS(x.date))}</td><td class="num">${fmt(x.emi)}</td><td class="num">${fmt(x.principal)}</td><td class="num">${fmt(x.profit)}</td><td class="num">${fmt(x.balance)}</td><td>${x.date <= today ? '<span class="pill good">Paid</span>' : x === next ? '<span class="pill warn">Next</span>' : '<span class="muted small">Upcoming</span>'}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="2">Total</td><td class="num">${fmt(tot.emi)}</td><td class="num">${fmt(tot.p)}</td><td class="num">${fmt(tot.i)}</td><td colspan="2"></td></tr></tfoot></table></div>` : ""}`;
}
DL.finsch = id => { const v = S.vehicles[id], f = v.fin || {}; return [`finance_${norm(vName(id))}_${norm(f.facility || "")}.csv`, [["Instalment","Due date","Instalment amount","Principal","Profit / interest","Loan balance"], ...finSchedule(v).map(x => [x.no, x.date, x.emi, x.principal, x.profit, x.balance])]]; };

document.addEventListener("click", ev => {
  const t = ev.target.closest("button"); if(!t || t.dataset.finedit == null) return;
  S.finEdit = t.dataset.finedit; render();
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fVehFin") return; ev.preventDefault(); if(!S.db) return;
  const fd = Object.fromEntries(new FormData(f).entries()), v = S.vehicles[f.dataset.id]; if(!v) return;
  ["price","loan","downPayment","rate","months","emi","lifeYears","residualPct"].forEach(k => fd[k] = String(fd[k] ?? "") === "" ? "" : num(fd[k]));
  if(fd.funding === "credit" && !fd.supplierId){ toast("Choose the supplier the car is bought from on credit."); return; }
  if(fd.supplierId) delete fd.dealer;
  if(fd.funding === "bank"){
    if(!num(fd.loan)) fd.loan = r2(num(fd.price) - num(fd.downPayment));
    if(!num(fd.downPayment)) fd.downPayment = r2(num(fd.price) - num(fd.loan));
    if(!num(fd.months) || !fd.firstDue){ toast("Enter the tenure (months) and the first instalment date."); return; }
  }
  const {id:_, ...body} = v;
  if(!fd.supplierId && (v.fin || {}).dealer) fd.dealer = v.fin.dealer;
  if(await writeOk(S.db.doc("vehicles/" + f.dataset.id).set({...body, fin: fd}))){ S.finEdit = null; toast("Purchase & finance saved."); render(); }
});
/* ---------- depreciation (company-owned cars only) ---------- */
/* Straight line over the useful life (default 5 years) down to the residual value (default 20% of the price).
   Investor-owned cars are not the company's assets – no depreciation, even when registered in its name. */
Object.assign(ACCT, {"1510":"Accumulated depreciation – motor vehicles", "5285":"Depreciation – motor vehicles"});
if(typeof ACCT_BASE !== "undefined") Object.assign(ACCT_BASE, {"1510":"Accumulated depreciation – motor vehicles", "5285":"Depreciation – motor vehicles"});
function deprFor(v, from, to){
  const f = finOf(v); if(!f || finOwner(v) !== "company" || !f.purchaseDate) return 0;
  const life = num(f.lifeYears) || 5, resid = num(f.price) * (String(f.residualPct ?? "") === "" ? 20 : num(f.residualPct)) / 100, end = addMonths(f.purchaseDate, Math.round(life * 12));
  const a = from > f.purchaseDate ? from : f.purchaseDate, b = to < end ? to : addDays(end, -1); if(a > b) return 0;
  return r2((num(f.price) - resid) / (life * 365.25) * daysBetween(a, b));
}
const accDepr = (v, day) => deprFor(v, "1900-01-01", day);
// depreciation for the period, and the opening balance of accumulated depreciation at the books start
const _postFin = postFin;
postFin = function(add){
  _postFin(add);
  for(const v of Object.values(S.vehicles)){ const d = deprFor(v, S.from, S.to); if(d){ add("5285", d, 0, "Depreciation – " + vName(v.id), S.to); add("1510", 0, d, "Depreciation – " + vName(v.id), S.to); } }
};
const _finOpening = finOpening;
finOpening = function(code){
  let o = _finOpening(code);
  if(code === "1510"){ const start = setting("ledgerStart", "2026-09-01"); o -= sum(Object.values(S.vehicles), v => deprFor(v, "1900-01-01", addDays(start, -1))); }
  return r2(o);
};

/* ---------- the car's profit & loss statement ---------- */
function vehPLModel(id){
  const C = compute(), v = C.V[id] || {seg:{}, segments:[], expList:[], n:0, km:0, fareRev:0, fee:0, tax:0, ref:0, drvCost:0, exp:0, op:0, mgmt:0, invShare:0, company:0, rm:0, rmInv:0, byInv:{}};
  const rec = S.vehicles[id] || {}, f = finOf(rec), owner = finOwner(rec), inVatRec = setting("inputVatRecoverable", false), feeVatRec = setting("feeVatRecoverable", false), fareStd = setting("fareVat", "exempt") === "standard";
  const trips = S.trips.filter(t => (t.tr || t.f) && vehicleForTrip(t) === id), byPl = {}, seen = new Set(), drivers = new Set(), days = new Set();
  trips.forEach(t => { const b = byPl[plOf(t)] ||= {f:0, fee:0, n:0}; b.f += t.f || 0; b.fee += (t.sf || 0) + (feeVatRec ? 0 : (t.tx || 0)); const k = t.tr || t.id; if(!seen.has(k)){ seen.add(k); b.n++; } drivers.add(t.dr); days.add(t.d); });
  const byCat = {}; v.expList.forEach(e => byCat[e.category || "5310"] = r2((byCat[e.category || "5310"] || 0) + num(e.amount) + (inVatRec ? 0 : num(e.vat))));
  const sch = finSchedule(rec).filter(x => x.date >= S.from && x.date <= S.to), emi = r2(sum(sch, x => x.emi)), profit = r2(sum(sch, x => x.profit)), depr = deprFor(rec, S.from, S.to);
  const netRev = r2(v.fareRev - v.fee - (feeVatRec ? 0 : v.tax) + v.ref), terms = termAt(termList(rec, VEH_TERMS), S.to) || {};
  return {id, rec, v, f, owner, terms, trips: seen.size, km: r2(v.km), drivers: drivers.size, days: days.size, byPl, byCat, netRev, fareStd, sch, emi, profit, depr,
    invNet: r2(v.invShare - (owner === "investor" ? emi : 0)), coNet: r2(v.company - (owner === "company" ? profit + depr : 0))};
}
/* The statement, in the usual P&L form: items in the first amount column, totals in the second,
   brackets for deductions. Rows: h heading · i item · s subtotal · g final total. */
function vehStmt(M){
  const v = M.v, R = [], H = label => R.push({k: "h", label}), I = (label, a) => R.push({k: "i", label, a: r2(a)}), T = (label, b, k = "s") => R.push({k, label, b: r2(b)});
  H("Revenue");
  Object.entries(M.byPl).sort((x, y) => y[1].f - x[1].f).forEach(([k, b]) => { I(`${pName(k)} – fares (${b.n} trips)`, b.f); if(r2(b.fee)) I(`Less: ${pName(k)} service fee & VAT`, -b.fee); });
  if(M.fareStd && v.fareRev) I("Less: output VAT on fares", -r2(sum(Object.values(M.byPl), b => b.f) - v.fareRev));
  if(r2(v.ref)) I("Tolls & fees recovered", v.ref);
  T("Net revenue", M.netRev);
  H("Direct costs");
  I("Driver cost (earnings share / salary)", -v.drvCost);
  Object.entries(M.byCat).forEach(([c, val]) => I(EXP_CATS[c] || "Other expenses", -val));
  T("Total direct costs", -r2(v.drvCost + v.exp));
  if(M.owner === "investor"){
    T("Operating profit", v.op);
    H("Profit sharing");
    const terms = vehTermText(M.terms).replace(/^[^:]*: /, "");
    if(v.rmInv){ I(`Investor's share (${terms})`, v.invShare + v.rmInv); I("Less: repairs & maintenance borne by the investor", -v.rmInv); }
    T(v.rmInv ? "Investor's share" : `Investor's share (${terms})`, v.invShare);
    T(`Company's share${v.mgmt ? ` (incl. management fee ${fmt(v.mgmt)})` : ""}`, v.company);
    if(M.emi){
      H("Investor settlement");
      I("Investor's share", v.invShare);
      I(`Less: bank instalment${M.sch.length > 1 ? "s" : ""} – ${(M.f || {}).bank || "bank"}${(M.f || {}).facility ? " " + M.f.facility : ""}`, -M.emi);
      T("Net payable to the investor", M.invNet, "g");
    }
  } else {
    const below = M.depr || M.profit;
    T(below ? "Operating profit" : "Net profit for the period", v.op, below ? "s" : "g");
    if(below){
      if(M.depr) I("Less: depreciation", -M.depr);
      if(M.profit) I("Less: finance cost (bank profit / interest)", -M.profit);
      T("Net profit for the period", M.coNet, "g");
    }
  }
  return R;
}
// memo: the car and its finance at the period end (not part of the profit)
function vehMemo(M){
  const f = M.f, out = []; if(!f) return out;
  out.push([`Purchase price${f.purchaseDate ? " – " + dmyS(f.purchaseDate) : ""}${dealerName(f) ? " – " + dealerName(f) : ""}`, num(f.price)]);
  if(M.owner === "company"){ const acc = accDepr(M.rec, S.to); out.push(["Accumulated depreciation", -acc], ["Book value", r2(num(f.price) - acc)]); }
  else out.push(["Owner", "Investor – no depreciation in the company's books"]);
  if(f.funding === "bank") out.push([`Bank loan outstanding – ${f.bank || ""} ${f.facility || ""}`.trim(), finOutstanding(M.rec, S.to)]);
  if(f.funding === "credit" && f.supplierId) out.push([`Owed to ${dealerName(f)} (supplier balance)`, (() => { try{ return r2(num((S.suppliers[f.supplierId] || {}).opening) + sum(BOOKS.partyMoves(histEntries(), "s:" + f.supplierId, "2000"), x => x.cr - x.dr)); }catch(e){ return ""; } })()]);
  return out;
}
const vehPerf = M => [["Trips", M.trips], ["Days in service", M.days], ["Distance", fmt(M.km) + " km"], ["Drivers", M.drivers], ["Net revenue / day", fmt(M.days ? M.netRev / M.days : 0)], ["Net revenue / km", fmt(M.km ? M.netRev / M.km : 0)], ["Operating margin", (M.netRev ? Math.round(100 * M.v.op / M.netRev) : 0) + "%"]];
const br = x => x == null || x === "" ? "" : typeof x === "string" ? x : x < 0 ? `(${fmt(-x)})` : fmt(x);
const VPL_CSS = `.vst{width:100%;border-collapse:collapse}.vst td{padding:4px 8px;vertical-align:top}.vst td.n{text-align:right;white-space:nowrap;width:120px;font-variant-numeric:tabular-nums}
.vst tr.h td{font-weight:700;text-transform:uppercase;letter-spacing:.04em;font-size:.85em;padding-top:12px}.vst tr.i td:first-child{padding-left:22px}
.vst tr.s td{font-weight:700}.vst tr.s td.n.b{border-top:1px solid currentColor}.vst tr.g td{font-weight:700}.vst tr.g td.n.b{border-top:1px solid currentColor;border-bottom:3px double currentColor}
.vst tr.memo td{font-size:.92em}`;
const stmtTable = R => `<table class="vst"><tr><td></td><td class="n"><b>AED</b></td><td class="n"><b>AED</b></td></tr>${R.map(r => `<tr class="${r.k}"><td>${esc(r.label)}</td><td class="n">${r.k === "i" ? br(r.a) : ""}</td><td class="n${r.k === "s" || r.k === "g" ? " b" : ""}">${r.k === "s" || r.k === "g" ? br(r.b) : ""}</td></tr>`).join("")}</table>`;
const memoTable = rows => rows.length ? `<table class="vst"><tr class="h"><td>Vehicle & finance – ${esc(dmyS(S.to))}</td><td class="n"></td></tr>${rows.map(([l, x]) => `<tr class="memo"><td>${esc(l)}</td><td class="n">${br(x)}</td></tr>`).join("")}</table>` : "";
function vehPLTab(id){
  const M = vehPLModel(id), cells = vehPerf(M);
  return `<style>${VPL_CSS}</style><div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(M.owner === "investor" ? "Investor's car – " + iName(M.v.investorId || M.terms.investorId) : "Company-owned car")}</span>
    <div class="row">${dlBtn("vpl", id)}<button class="btn sm" data-vplprint="${esc(id)}">Print / PDF</button></div></div>
  <div class="tbl" style="margin-bottom:12px"><table><thead><tr>${cells.map(c => `<th style="text-align:center">${c[0]}</th>`).join("")}</tr></thead><tbody><tr>${cells.map(c => `<td style="text-align:center"><b>${c[1]}</b></td>`).join("")}</tr></tbody></table></div>
  <div class="tbl" style="max-width:760px;padding:6px 4px"><div style="text-align:center;margin:6px 0 2px"><b>${esc(vName(id))} – Profit & loss statement</b><div class="small muted">For the period ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</div></div>${stmtTable(vehStmt(M))}</div>
  ${M.f ? `<div class="tbl" style="max-width:760px;padding:6px 4px;margin-top:12px">${memoTable(vehMemo(M))}</div>` : ""}`;
}
async function printVehPL(id){
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  const M = vehPLModel(id), s = S.settings, co = s.company || "Royal Rides Limousine LLC", cells = vehPerf(M), inv = M.owner === "investor" ? iName(M.v.investorId || M.terms.investorId) : "";
  const addr = [s.address, s.trn ? "TRN " + s.trn : ""].filter(Boolean).join(" · ");
  const html = `<div class="sp"><div class="hd"><div class="co">${esc(co)}${addr ? `<small>${esc(addr)}</small>` : ""}</div><div class="ttl"><b>PROFIT & LOSS STATEMENT</b><span>${esc(vName(id))} · ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</span></div></div>
    <table class="info"><tr><td class="l">Vehicle</td><td><b>${esc(vName(id))}</b>${M.rec.model ? " · " + esc(M.rec.model) : ""}</td><td class="l">Owner</td><td>${esc(inv || "Company")}</td></tr>
    <tr><td class="l">Terms</td><td>${esc(vehTermText(M.terms))}</td><td class="l">Bought with</td><td>${esc(M.f ? finText(M.rec) : "—")}</td></tr></table>
    <table class="perf"><tr>${cells.map(c => `<th>${c[0]}</th>`).join("")}</tr><tr>${cells.map(c => `<td>${c[1]}</td>`).join("")}</tr></table>
    <div class="vbox">${stmtTable(vehStmt(M))}</div>${M.f ? `<div class="vbox">${memoTable(vehMemo(M))}</div>` : ""}
    <div class="sigs"><div><div class="who">${inv ? "For Investor" : "Prepared by"}</div><div class="line"></div><div>${esc(inv)}</div><div class="cap">Signature & date</div></div><div><div class="who">For ${esc(co)}</div><div class="line"></div><div>${esc(s.signatory || "")}${s.signatoryTitle ? (s.signatory ? ", " : "") + esc(s.signatoryTitle) : ""}</div><div class="cap">Authorised signatory</div></div></div></div>`;
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff";
  box.innerHTML = `<style>${SAL_CSS}${VPL_CSS}.sp .vbox{border:1px solid #c5c9d2;padding:4px 6px 8px;margin-top:10px}.sp .vst{font-size:10pt}.sp .vst td{border:0}</style>${html}`; document.body.appendChild(box);
  const name = `Vehicle_PL_${norm(vName(id))}_${S.from}_${S.to}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.97}, html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}, pagebreak: {mode: ["css", "legacy"], avoid: ["table", ".sigs"]}}).from(box.querySelector(".sp")).save(); toast("Downloaded " + name); }
  catch(e){ toast("Could not make the PDF. Try again."); }
  box.remove();
}
// downloads: the PDF is the statement itself; Excel / CSV carry the same statement rows
DL.vpl = id => {
  if(window.__fmt === "pdf"){ printVehPL(id); return null; }
  const M = vehPLModel(id), memo = vehMemo(M);
  return [`vehicle_pl_${norm(vName(id))}_${S.from}_${S.to}.csv`, [[`${vName(id)} – Profit & loss statement, ${dmyS(S.from)} to ${dmyS(S.to)}`, "AED", "AED"],
    ...vehStmt(M).map(r => r.k === "h" ? [r.label.toUpperCase(), "", ""] : r.k === "i" ? ["   " + r.label, r.a, ""] : [r.label, "", r.b]),
    ...(memo.length ? [["", "", ""], ["VEHICLE & FINANCE – " + dmyS(S.to), "", ""], ...memo.map(([l, x]) => ["   " + l, x, ""])] : []),
    ["", "", ""], ["KEY FIGURES", "", ""], ...vehPerf(M).map(c => ["   " + c[0], String(c[1]), ""])]];
};
document.addEventListener("click", ev => { const t = ev.target.closest("button"); if(t && t.dataset.vplprint) printVehPL(t.dataset.vplprint); });

window.FIN = {post: (...a) => postFin(...a), supplierMoves, investorEmi, opening: (...a) => finOpening(...a), text: finText, of: finOf, owner: finOwner, outstanding: finOutstanding, depr: deprFor};
window.vehFinTab = vehFinTab; window.vehPLTab = vehPLTab;
