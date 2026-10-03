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
    <div class="f wide"><label for="vf_notes">Notes</label><input id="vf_notes" name="notes" value="${esc(f.notes)}"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button>${finOf(v) ? `<button class="btn ghost" type="button" data-finedit="">Cancel</button>` : ""}</div></form>`;
  const tot = {emi: sum(sch, x => x.emi), p: sum(sch, x => x.principal), i: sum(sch, x => x.profit)}, paid = sch.filter(x => x.date <= today), next = sch.find(x => x.date > today);
  const info = [["Owned by", owner === "company" ? "Company" : "Investor – " + iName(v.investorId)], ["Purchased", (f.purchaseDate ? dmyS(f.purchaseDate) : "—") + (f.dealer ? " · " + f.dealer : "")], ["Price", fmt(num(f.price))],
    ["Paid by", f.funding === "bank" ? "Bank finance" : "Full payment"], ...(f.funding === "bank" ? [["Bank", f.bank], ["Facility no.", f.facility], ["Loan", fmt(num(f.loan))], ["Down payment", fmt(num(f.downPayment)) + " (" + (f.downBy === "investor" ? "investor" : "company") + ")"],
    ["Flat rate / tenure", `${num(f.rate)}% · ${num(f.months)} months`], ["Instalment", fmt(sch[0] ? sch[0].emi : 0) + " from " + (sch[0] ? dmyS(sch[0].date) : "—")], ["Outstanding today", fmt(finOutstanding(v, today))], ["Next instalment", next ? dmyS(next.date) + " · " + fmt(next.emi) : "—"]] : []),
    ["Paid from", acctName(f.payFrom || "1100")]];
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
  ["price","loan","downPayment","rate","months","emi"].forEach(k => fd[k] = String(fd[k] ?? "") === "" ? "" : num(fd[k]));
  if(fd.funding === "bank"){
    if(!num(fd.loan)) fd.loan = r2(num(fd.price) - num(fd.downPayment));
    if(!num(fd.downPayment)) fd.downPayment = r2(num(fd.price) - num(fd.loan));
    if(!num(fd.months) || !fd.firstDue){ toast("Enter the tenure (months) and the first instalment date."); return; }
  }
  const {id:_, ...body} = v;
  if(await writeOk(S.db.doc("vehicles/" + f.dataset.id).set({...body, fin: fd}))){ S.finEdit = null; toast("Purchase & finance saved."); render(); }
});
window.FIN = {post: postFin, investorEmi, opening: finOpening, text: finText, of: finOf, owner: finOwner, outstanding: finOutstanding};
window.vehFinTab = vehFinTab;
