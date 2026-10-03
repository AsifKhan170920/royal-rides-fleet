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
const finText = v => { const f = finOf(v); if(!f) return ""; return f.funding === "bank" ? `${f.bank || "Bank"} finance${f.facility ? " · " + f.facility : ""}` : "Full payment"; };
function finOutstanding(v, day){ return r2(num((finOf(v) || {}).loan) - sum(finSchedule(v).filter(x => x.date <= day), x => x.principal)); }

/* journal: purchases and instalments in the period */
function postFin(add){
  for(const v of Object.values(S.vehicles)){
    const f = finOf(v); if(!f) continue;
    const owner = finOwner(v), name = vName(v.id), acct = f.payFrom || "1100", price = num(f.price), loan = num(f.loan), dp = num(f.downPayment);
    if(f.purchaseDate && f.purchaseDate >= S.from && f.purchaseDate <= S.to){
      const m = `Purchase of ${name}${f.dealer ? " – " + f.dealer : ""}`;
      if(owner === "company"){
        add("1500", price, 0, m, f.purchaseDate);
        if(f.funding === "bank"){ add("2400", 0, loan, m + " – " + (f.bank || "bank") + " finance", f.purchaseDate); if(r2(price - loan)) add(acct, 0, price - loan, m + " – down payment", f.purchaseDate); }
        else add(acct, 0, price, m, f.purchaseDate);
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
    ${fld("purchaseDate", "Purchase date", "date")}${fld("price", "Purchase price (AED)", "number", " required")}${fld("dealer", "Dealer / seller")}
    <div class="f"><label for="vf_funding">Paid by</label><select id="vf_funding" name="funding">${opts({cash: "Full payment", bank: "Bank finance"}, f.funding || "cash")}</select></div>
    <div class="f"><label for="vf_payFrom">Paid from / instalments from</label><select id="vf_payFrom" name="payFrom">${opts(acctOpts(["bank","cash"]), f.payFrom || "1100")}</select></div>
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Bank finance</b> <span class="small muted">– leave empty for a full payment. Instalment blank = worked out from the flat rate.</span></div>
    ${fld("bank", "Bank")}${fld("facility", "Facility ID / number")}${fld("loan", "Loan amount", "number")}${fld("downPayment", "Down payment", "number")}
    <div class="f"><label for="vf_downBy">Down payment paid by</label><select id="vf_downBy" name="downBy">${opts({company: "Company", investor: "Investor"}, f.downBy || (owner === "investor" ? "investor" : "company"))}</select></div>
    ${fld("rate", "Flat rate % per year", "number")}${fld("months", "Tenure (months)", "number")}${fld("emi", "Monthly instalment (EMI)", "number")}${fld("firstDue", "First instalment date", "date")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Depreciation</b> <span class="small muted">– company-owned cars only; investor cars are not the company's assets.</span></div>
    ${fld("lifeYears", "Useful life (years, default 5)", "number")}${fld("residualPct", "Residual value % (default 20)", "number")}
    <div class="f wide"><label for="vf_notes">Notes</label><input id="vf_notes" name="notes" value="${esc(f.notes)}"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button>${finOf(v) ? `<button class="btn ghost" type="button" data-finedit="">Cancel</button>` : ""}</div></form>`;
  const tot = {emi: sum(sch, x => x.emi), p: sum(sch, x => x.principal), i: sum(sch, x => x.profit)}, paid = sch.filter(x => x.date <= today), next = sch.find(x => x.date > today);
  const info = [["Owned by", owner === "company" ? "Company" : "Investor – " + iName(v.investorId)], ["Purchased", (f.purchaseDate ? dmyS(f.purchaseDate) : "—") + (f.dealer ? " · " + f.dealer : "")], ["Price", fmt(num(f.price))],
    ["Paid by", f.funding === "bank" ? "Bank finance" : "Full payment"], ...(f.funding === "bank" ? [["Bank", f.bank], ["Facility no.", f.facility], ["Loan", fmt(num(f.loan))], ["Down payment", fmt(num(f.downPayment)) + " (" + (f.downBy === "investor" ? "investor" : "company") + ")"],
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
  if(fd.funding === "bank"){
    if(!num(fd.loan)) fd.loan = r2(num(fd.price) - num(fd.downPayment));
    if(!num(fd.downPayment)) fd.downPayment = r2(num(fd.price) - num(fd.loan));
    if(!num(fd.months) || !fd.firstDue){ toast("Enter the tenure (months) and the first instalment date."); return; }
  }
  const {id:_, ...body} = v;
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
function vehPLRows(M){
  const v = M.v, L = (label, val, kind = "") => ({label, v: val, kind});
  const S2 = Object.entries(M.byPl).sort((a,b) => b[1].f - a[1].f).map(([k, b]) => L(`${esc(pName(k))} <span class="sub">${b.n} trips · fares ${fmt(b.f)} − fee & VAT ${fmt(b.fee)}</span>`, r2(b.f - b.fee)));
  if(M.fareStd && v.fareRev) S2.push(L("Less output VAT on fares", -r2(sum(Object.values(M.byPl), b => b.f) - v.fareRev)));
  if(r2(v.ref)) S2.push(L("Tolls & fees recovered", v.ref));
  S2.push(L("Net revenue", M.netRev, "t"));
  const S3 = [L("Driver cost (earnings share / salary)", -v.drvCost), ...Object.entries(M.byCat).map(([c, val]) => L(esc(EXP_CATS[c] || "Expense"), -val)), L("Total direct costs", -r2(v.drvCost + v.exp), "t"), L("Operating profit", v.op, "g")];
  const S4 = [];
  if(M.owner === "investor" || v.investorId){
    if(v.mgmt) S4.push(L("Management fee (company)", -v.mgmt));
    if(v.rmInv) S4.push(L("Investor's share before repairs", r2(v.invShare + v.rmInv)), L("Less repairs & maintenance (investor 100%)", -v.rmInv));
    S4.push(L(`Investor's share – ${esc(vehTermText(M.terms).replace(/^[^:]*: /, ""))}`, v.invShare, "t"), L("Company's share", v.company, "t"));
  } else S4.push(L("Company's share (company-owned car)", v.company, "t"));
  const S5 = [];
  if(M.owner === "investor"){
    S5.push(L("Investor's share", v.invShare));
    if(M.emi) S5.push(L(`Less finance instalments (${esc((M.f || {}).bank || "bank")} ${esc((M.f || {}).facility || "")}, ${M.sch.length})`, -M.emi));
    S5.push(L("Net due to the investor for this car", M.invNet, "g"));
  } else {
    S5.push(L("Company's share", v.company));
    if(M.profit) S5.push(L("Less finance cost (profit / interest)", -M.profit));
    if(M.depr) S5.push(L("Less depreciation", -M.depr));
    S5.push(L("Net profit to the company from this car", M.coNet, "g"));
  }
  const f = M.f, S6 = [];
  if(f){
    S6.push(L(`Bought ${f.purchaseDate ? dmyS(f.purchaseDate) : ""} – ${f.funding === "bank" ? "bank finance" : "full payment"}${M.owner === "investor" ? " (investor's car)" : ""}`, num(f.price)));
    if(M.owner === "company"){ const acc = accDepr(M.rec, S.to); S6.push(L("Accumulated depreciation", -acc), L("Book value", r2(num(f.price) - acc), "t")); }
    if(f.funding === "bank") S6.push(L(`Loan outstanding – ${esc(f.bank || "")} ${esc(f.facility || "")}`, finOutstanding(M.rec, S.to)));
  }
  return [["2", "Revenue", S2], ["3", "Direct costs", S3], ["4", "Profit split", S4], ["5", M.owner === "investor" ? "Investor settlement" : "Company result", S5], ...(S6.length ? [["6", "Asset & finance", S6]] : [])];
}
const vehPerf = M => [["Trips", M.trips], ["Days in service", M.days], ["Distance", fmt(M.km) + " km"], ["Drivers", M.drivers], ["Net revenue / day", fmt(M.days ? M.netRev / M.days : 0)], ["Net revenue / km", fmt(M.km ? M.netRev / M.km : 0)], ["Operating margin", (M.netRev ? Math.round(100 * M.v.op / M.netRev) : 0) + "%"]];
function vehPLTab(id){
  const M = vehPLModel(id), cells = vehPerf(M);
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · ${esc(M.owner === "investor" ? "Investor's car – " + iName(M.v.investorId || M.terms.investorId) : "Company-owned car")}</span>
    <div class="row">${dlBtn("vpl", id)}<button class="btn sm" data-vplprint="${esc(id)}">Print / PDF</button></div></div>
  <h3 style="margin:4px 0 6px">1. Performance</h3><div class="tbl"><table><thead><tr>${cells.map(c => `<th style="text-align:center">${c[0]}</th>`).join("")}</tr></thead><tbody><tr>${cells.map(c => `<td style="text-align:center"><b>${c[1]}</b></td>`).join("")}</tr></tbody></table></div>
  ${vehPLRows(M).map(([n, title, rows]) => `<h3 style="margin:16px 0 6px">${n}. ${title}</h3><div class="tbl"><table><tbody>${rows.map(r => `<tr${r.kind ? ' class="tot"' : ""}><td style="white-space:normal">${r.kind ? "<b>" + r.label + "</b>" : r.label}</td><td class="num">${r.v == null ? "" : r.kind ? "<b>" + aed(r.v) + "</b>" : aed(r.v)}</td></tr>`).join("")}</tbody></table></div>`).join("")}`;
}
async function printVehPL(id){
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  const M = vehPLModel(id), s = S.settings, co = s.company || "Royal Rides Limousine LLC", cells = vehPerf(M), inv = M.owner === "investor" ? iName(M.v.investorId || M.terms.investorId) : "";
  const amt = x => x == null ? "" : (x < 0 ? "-" : "") + fmt(Math.abs(x)), addr = [s.address, s.trn ? "TRN " + s.trn : ""].filter(Boolean).join(" · ");
  const html = `<div class="sp"><div class="hd"><div class="co">${esc(co)}${addr ? `<small>${esc(addr)}</small>` : ""}</div><div class="ttl"><b>VEHICLE PROFIT & LOSS</b><span>${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · amounts in AED</span></div></div>
    <table class="info"><tr><td class="l">Vehicle</td><td><b>${esc(vName(id))}</b>${M.rec.model ? " · " + esc(M.rec.model) : ""}</td><td class="l">Owner</td><td>${esc(inv || "Company")}</td></tr>
    <tr><td class="l">Terms</td><td>${esc(vehTermText(M.terms))}</td><td class="l">Bought with</td><td>${esc(M.f ? finText(M.rec) : "—")}</td></tr></table>
    <table class="perf"><tr class="sec"><th colspan="${cells.length}">1. Performance</th></tr><tr>${cells.map(c => `<th>${c[0]}</th>`).join("")}</tr><tr>${cells.map(c => `<td>${c[1]}</td>`).join("")}</tr></table>
    ${vehPLRows(M).map(([n, title, rows]) => `<table><tr class="sec"><th colspan="2">${n}. ${title}</th></tr>${rows.map(r => `<tr${r.kind ? ` class="${r.kind}"` : ""}><td>${r.label}</td><td class="n">${amt(r.v)}</td></tr>`).join("")}</table>`).join("")}
    <div class="sigs"><div><div class="who">${inv ? "For Investor" : "Prepared by"}</div><div class="line"></div><div>${esc(inv)}</div><div class="cap">Signature & date</div></div><div><div class="who">For ${esc(co)}</div><div class="line"></div><div>${esc(s.signatory || "")}${s.signatoryTitle ? (s.signatory ? ", " : "") + esc(s.signatoryTitle) : ""}</div><div class="cap">Authorised signatory</div></div></div></div>`;
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff"; box.innerHTML = `<style>${SAL_CSS}</style>${html}`; document.body.appendChild(box);
  const name = `Vehicle_PL_${norm(vName(id))}_${S.from}_${S.to}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.97}, html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}, pagebreak: {mode: ["css", "legacy"], avoid: ["table", ".sigs"]}}).from(box.querySelector(".sp")).save(); toast("Downloaded " + name); }
  catch(e){ toast("Could not make the PDF. Try again."); }
  box.remove();
}
DL.vpl = id => { const M = vehPLModel(id), strip = h => String(h).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return [`vehicle_pl_${norm(vName(id))}_${S.from}_${S.to}.csv`, [["Section","Line","AED"], ...vehPerf(M).map(c => ["1. Performance", c[0], c[1]]), ...vehPLRows(M).flatMap(([n, t, rows]) => rows.map(r => [n + ". " + t, strip(r.label), r.v == null ? "" : r2(r.v)]))]]; };
document.addEventListener("click", ev => { const t = ev.target.closest("button"); if(t && t.dataset.vplprint) printVehPL(t.dataset.vplprint); });

window.FIN = {post: (...a) => postFin(...a), investorEmi, opening: (...a) => finOpening(...a), text: finText, of: finOf, owner: finOwner, outstanding: finOutstanding, depr: deprFor};
window.vehFinTab = vehFinTab; window.vehPLTab = vehPLTab;
