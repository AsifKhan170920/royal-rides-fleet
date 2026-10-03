/* Bank finance (Accounts → Bank finance): every facility and bank loan in one place.
   - Auto loans: the cars bought on bank finance (Vehicles → car → Purchase & finance) – listed here, edited on the car.
   - Business loans (collection loans): short-term loans, long-term loans, overdraft / revolving
     facilities. The form holds the contract terms; the EMI schedule is worked out from them:
       flat rate        – equal principal and equal profit in every instalment (profit = amount × rate × years);
       reducing balance – equal instalments (annuity), profit on the outstanding balance each period.
     Instalments are monthly, quarterly, half-yearly or yearly, optionally after a grace period (profit only),
     or one bullet repayment at maturity. Instalments are taken as paid on their due dates from the chosen account.
   Accounting: disbursement Dr bank / Cr loan account (2410 short-term, 2420 long-term, 2430 overdraft & facilities,
   2400 auto loans); processing fee Dr 5300 bank charges / Cr bank; each instalment Dr loan (principal) + Dr 5950
   finance cost / Cr bank. Loans taken before the books start come in with their outstanding balance. */
const LOAN_ACCTS = {"2410":"Short-term bank loans", "2420":"Long-term bank loans – non-current", "2425":"Long-term bank loans – current portion", "2430":"Bank overdraft & facilities",
  "2400":"Vehicle finance loans – non-current", "2405":"Vehicle finance loans – current portion", "2440":"Accrued interest / profit on bank loans", "5955":"Interest on business loans"};
Object.assign(ACCT, LOAN_ACCTS); if(typeof ACCT_BASE !== "undefined") Object.assign(ACCT_BASE, LOAN_ACCTS);
S.loans = S.loans || {}; S.loanView = S.loanView || ""; S.loanEdit = S.loanEdit || null;
// business loans only – auto loans are the cars bought on bank finance (Vehicles → car → Purchase & finance)
const LOAN_TYPES = {short: "Short-term business loan", long: "Long-term business loan", facility: "Overdraft / revolving facility"};
const LOAN_ACCT = {short: "2410", long: "2420", facility: "2430"};
const LOAN_FREQ = {1: "Monthly", 3: "Quarterly", 6: "Half-yearly", 12: "Yearly"};

function loanSchedule(l){
  const P = num(l.amount), freq = num(l.freq) || 1, n0 = Math.max(1, Math.round(num(l.months) / freq)), grace = l.method === "bullet" ? 0 : Math.min(n0 - 1, Math.max(0, Math.round(num(l.grace) / freq)));   // the tenure includes the grace period
  const r = num(l.rate) / 100 * freq / 12, first = l.firstDue || addMonths(l.date || iso(new Date()), freq), out = [];
  if(!P || !l.date) return out;
  const due = i => addMonths(first, i * freq);
  // grace period: profit only
  for(let i = 0; i < grace; i++){ const it = r2(P * r); out.push({no: i + 1, date: due(i), principal: 0, profit: it, emi: it, balance: P, grace: true}); }
  const n = l.method === "bullet" ? 1 : n0 - grace, start = grace;
  if(l.method === "bullet"){
    // profit each period, the whole amount at maturity
    for(let i = 0; i < n0 - 1; i++) out.push({no: start + i + 1, date: due(start + i), principal: 0, profit: r2(P * r), emi: r2(P * r), balance: P});
    out.push({no: start + n0, date: due(start + n0 - 1), principal: P, profit: r2(P * r), emi: r2(P + P * r), balance: 0});
    return out;
  }
  if(l.method === "flat"){
    const emi = num(l.emi) || r2((P + P * r * n) / n), profit = Math.max(0, r2(emi * n - P)); let pp = 0, ip = 0, bal = P;
    for(let i = 0; i < n; i++){ const last = i === n - 1, pr = last ? r2(P - pp) : r2(P / n), it = last ? r2(profit - ip) : r2(profit / n); pp = r2(pp + pr); ip = r2(ip + it); bal = r2(bal - pr);
      out.push({no: start + i + 1, date: due(start + i), principal: pr, profit: it, emi: r2(pr + it), balance: bal}); }
    return out;
  }
  // reducing balance (annuity)
  const emi = num(l.emi) || r2(r ? P * r / (1 - Math.pow(1 + r, -n)) : P / n); let bal = P;
  for(let i = 0; i < n; i++){ const last = i === n - 1, it = r2(bal * r), pr = last ? bal : r2(Math.min(bal, emi - it)); bal = r2(bal - pr);
    out.push({no: start + i + 1, date: due(start + i), principal: pr, profit: it, emi: r2(pr + it), balance: bal}); }
  return out;
}
const loanOut = (l, day) => r2(num(l.amount) - sum(loanSchedule(l).filter(x => x.date <= day), x => x.principal));
const loanAcct = l => LOAN_ACCT[l.type] || "2420";

/* journal and opening balances */
function postLoans(add){
  for(const l of Object.values(S.loans)){
    add.src = {kind: "loan", id: l.id};
    const acct = l.account || "1100", name = `${LOAN_TYPES[l.type] || "Loan"} – ${l.bank || "bank"}${l.facility ? " " + l.facility : ""}`;
    if(l.date >= S.from && l.date <= S.to){ add(acct, num(l.amount), 0, name + " – disbursed", l.date); add(loanAcct(l), 0, num(l.amount), name + " – disbursed", l.date);
      if(num(l.fee)){ add("5300", num(l.fee), 0, name + " – processing fee", l.date); add(acct, 0, num(l.fee), name + " – processing fee", l.date); } }
    for(const x of loanSchedule(l)){ if(x.date < S.from || x.date > S.to) continue; const m = `${name} – instalment ${x.no}`;
      add(loanAcct(l), x.principal, 0, m, x.date); add("5955", x.profit, 0, m, x.date); add(acct, 0, x.emi, m, x.date); }
  }
  add.src = null;
  postClassification(add);
}
/* ---------- current / non-current split and accrued interest (IAS 1, accruals) ----------
   At the period end:
   - the principal falling due within 12 months is moved from the non-current loan account to its current portion
     (2420 → 2425 business loans, 2400 → 2405 vehicle finance); short-term loans and overdrafts are current already;
   - the interest / profit earned by the bank since the last instalment and not yet paid is accrued
     (Dr 5955 / 5950, Cr 2440); the journal carries the change over the period, so the balance is always the accrual
     at the period end. Cars of investors: their finance cost is borne by the investor – not accrued. */
function loanBook(){
  const out = [];
  Object.values(S.loans).forEach(l => out.push({start: l.date, sch: loanSchedule(l), nc: LOAN_ACCT[l.type] === "2420" ? "2420" : null, cur: "2425", cost: "5955", accrue: true, name: `${l.bank || "Bank"}${l.facility ? " " + l.facility : ""}`}));
  if(window.FIN) Object.values(S.vehicles).forEach(v => { const f = FIN.of(v); if(!f || f.funding !== "bank") return;
    out.push({start: f.purchaseDate, sch: FIN.schedule(v), nc: "2400", cur: "2405", cost: "5950", accrue: FIN.owner(v) === "company", name: `${f.bank || "Bank"}${f.facility ? " " + f.facility : ""} – ${vName(v.id)}`}); });
  return out.filter(b => b.start);
}
const dueIn12 = (b, day) => b.start > day ? 0 : r2(sum(b.sch.filter(x => x.date > day && x.date <= addMonths(day, 12)), x => x.principal));
function accruedAt(b, day){
  if(!b.accrue || b.start > day) return 0;
  const i = b.sch.findIndex(x => x.date > day); if(i < 0) return 0;
  const prev = i ? b.sch[i - 1].date : b.start, x = b.sch[i], span = (parseD(x.date) - parseD(prev)) / 86400000, done = (parseD(day) - parseD(prev)) / 86400000;
  return span > 0 && done > 0 ? r2(x.profit * Math.min(1, done / span)) : 0;
}
function postClassification(add){
  const before = addDays(S.from, -1);
  for(const b of loanBook()){
    const c = b.nc ? dueIn12(b, S.to) : 0;
    if(c){ add(b.nc, c, 0, `${b.name} – principal due within 12 months (current portion)`, S.to); add(b.cur, 0, c, `${b.name} – principal due within 12 months (current portion)`, S.to); }
    const d = r2(accruedAt(b, S.to) - accruedAt(b, before));
    if(d > 0){ add(b.cost, d, 0, `${b.name} – interest / profit accrued to ${dmyS(S.to)}`, S.to); add("2440", 0, d, `${b.name} – interest / profit accrued`, S.to); }
    else if(d < 0){ add("2440", -d, 0, `${b.name} – accrued interest / profit released`, S.to); add(b.cost, 0, -d, `${b.name} – accrued interest / profit released`, S.to); }
  }
}
// the split shown on the Bank finance page
function loanSplit(day){
  const B = loanBook(); let cur = 0, nc = 0, acc = 0;
  Object.values(S.loans).forEach(l => { const out = loanOut(l, day); if(LOAN_ACCT[l.type] === "2420"){ const c = Math.min(out, dueIn12({start: l.date, sch: loanSchedule(l)}, day)); cur += c; nc += out - c; } else cur += out; });
  if(window.FIN) Object.values(S.vehicles).forEach(v => { const f = FIN.of(v); if(!f || f.funding !== "bank" || !f.purchaseDate) return; const out = FIN.outstanding(v, day), c = Math.min(out, dueIn12({start: f.purchaseDate, sch: FIN.schedule(v)}, day)); cur += c; nc += out - c; });
  B.forEach(b => acc += accruedAt(b, day));
  return {cur: r2(cur), nc: r2(nc), acc: r2(acc)};
}
function loansOpening(code){
  const start = setting("ledgerStart", "2026-09-01"); let o = 0;
  for(const l of Object.values(S.loans)){ if(!l.date || l.date >= start || loanAcct(l) !== code) continue; o -= loanOut(l, addDays(start, -1)); }
  if(code === "2440") o -= sum(loanBook(), b => accruedAt(b, addDays(start, -1)));   // interest accrued at the books start
  return r2(o);
}

/* ---------- the page ---------- */
function autoLoans(){
  if(!window.FIN) return [];
  return Object.values(S.vehicles).filter(v => { const f = FIN.of(v); return f && f.funding === "bank"; }).map(v => { const f = FIN.of(v), sch = FIN.schedule(v), today = iso(new Date());
    return {car: v.id, type: "Auto loan – " + vName(v.id), bank: f.bank, facility: f.facility, amount: num(f.loan), date: f.purchaseDate, rate: num(f.rate) + "% flat", months: num(f.months),
      emi: sch[0] ? sch[0].emi : 0, out: FIN.outstanding(v, today), next: sch.find(x => x.date > today), owner: FIN.owner(v) === "investor" ? "Investor – " + iName(v.investorId) : "Company"}; });
}
function loanRows(){
  const today = iso(new Date());
  return Object.values(S.loans).map(l => { const sch = loanSchedule(l); return {id: l.id, type: LOAN_TYPES[l.type] || "Loan", bank: l.bank, facility: l.facility, amount: num(l.amount), date: l.date,
    rate: `${num(l.rate)}% ${l.method === "flat" ? "flat" : l.method === "bullet" ? "bullet" : "reducing"}`, months: num(l.months), emi: (sch.find(x => !x.grace) || sch[0] || {}).emi || 0, out: loanOut(l, today), next: sch.find(x => x.date > today), owner: l.purpose || ""}; })
    .sort((a, b) => (a.bank || "").localeCompare(b.bank || "") || (a.date || "").localeCompare(b.date || ""));
}
function vBankFinance(){
  if(S.loanEdit) return loanForm(S.loanEdit === "new" ? null : S.loans[S.loanEdit]);
  if(S.loanView && S.loans[S.loanView]) return loanDetail(S.loanView);
  const today = iso(new Date()), lim = addDays(today, 30), A = autoLoans(), L = loanRows(), all = [...L, ...A];
  const due30 = all.filter(r => r.next && r.next.date <= lim);
  const row = r => `<tr><td>${r.car ? `<button class="btn sm ghost" data-vehview="${esc(r.car)}" data-vehtab="fin" style="padding:2px 6px">${esc(r.type)}</button>` : `<button class="btn sm ghost" data-loanview="${esc(r.id)}" style="padding:2px 6px">${esc(r.type)}</button>`}</td><td>${esc(r.bank || "")}</td><td class="mono small">${esc(r.facility || "")}</td><td class="small">${esc(r.owner || "")}</td><td>${r.date ? esc(dmyS(r.date)) : ""}</td><td class="num">${fmt(r.amount)}</td><td class="small">${esc(r.rate)} · ${r.months} mo</td><td class="num">${fmt(r.emi)}</td><td class="num"><b>${fmt(r.out)}</b></td><td>${r.next ? `${esc(dmyS(r.next.date))} · ${fmt(r.next.emi)}${r.next.date <= lim ? ' <span class="pill warn">30 days</span>' : ""}` : r.out ? "" : '<span class="pill good">Repaid</span>'}</td></tr>`;
  const head = `<thead><tr><th>Loan</th><th>Bank</th><th>Facility no.</th><th>For</th><th>Start</th><th class="num">Amount</th><th>Terms</th><th class="num">Instalment</th><th class="num">Outstanding today</th><th>Next instalment</th></tr></thead>`;
  return `<div class="section"><div class="head"><div><h2>Bank finance</h2><p class="sub">Auto loans are the cars bought on bank finance (entered on the car: Purchase & finance). Business loans and facilities are added here with their contract terms, and the instalment schedule is worked out from them.</p></div><div class="row">${dlBtn("loans")}<button class="btn primary" data-loanedit="new">Add business loan / facility</button></div></div>
    <div class="kpis"><div class="kpi"><div class="l">Facilities</div><div class="v">${all.length}</div></div><div class="kpi"><div class="l">Outstanding today</div><div class="v">${fmt(sum(all, r => r.out))}</div></div>${(() => { const sp = loanSplit(S.to); return `<div class="kpi"><div class="l">Current portion · ${esc(dmyS(S.to))}</div><div class="v">${fmt(sp.cur)}</div><div class="n">due within 12 months</div></div><div class="kpi"><div class="l">Non-current portion</div><div class="v">${fmt(sp.nc)}</div><div class="n">due after 12 months</div></div><div class="kpi"><div class="l">Accrued interest / profit</div><div class="v">${fmt(sp.acc)}</div><div class="n">earned by the banks, not yet paid</div></div>`; })()}<div class="kpi"><div class="l">Due in the next 30 days</div><div class="v">${fmt(sum(due30, r => r.next.emi))}</div><div class="n">${due30.length} instalment${due30.length === 1 ? "" : "s"}</div></div></div>
    <h3 style="margin:14px 0 6px">Business loans & facilities</h3>
    ${L.length ? `<div class="tbl"><table>${head}<tbody>${L.map(row).join("")}</tbody><tfoot><tr><td colspan="5">Total</td><td class="num">${fmt(sum(L, r => r.amount))}</td><td></td><td></td><td class="num">${fmt(sum(L, r => r.out))}</td><td></td></tr></tfoot></table></div>` : `<div class="empty"><b>No loans yet</b>Add a short-term or long-term business loan, or an overdraft facility, with its contract terms.</div>`}
    <div class="row" style="justify-content:space-between;margin:14px 0 6px"><h3 style="margin:0">Auto loans (vehicle finance)</h3><select id="autoLoanCar" aria-label="Add auto loan" style="max-width:260px">${opts(Object.fromEntries(Object.values(S.vehicles).filter(v => !(window.FIN && FIN.of(v) && FIN.of(v).funding === "bank")).sort((a, b) => vName(a.id).localeCompare(vName(b.id))).map(v => [v.id, vName(v.id)])), "", "+ Add auto loan – choose the car…")}</select></div>
    ${A.length ? `<div class="tbl"><table>${head}<tbody>${A.map(row).join("")}</tbody><tfoot><tr><td colspan="5">Total</td><td class="num">${fmt(sum(A, r => r.amount))}</td><td></td><td></td><td class="num">${fmt(sum(A, r => r.out))}</td><td></td></tr></tfoot></table></div>` : `<p class="sub">No car is on bank finance. Set it on the car: Vehicles → car → Purchase & finance → Paid by: Bank finance.</p>`}</div>`;
}
DL.loans = () => [`bank_finance_${iso(new Date())}.csv`, [["Loan","Bank","Facility no.","For","Start","Amount","Terms","Tenure (months)","Instalment","Outstanding today","Next due","Next instalment"],
  ...[...loanRows(), ...autoLoans()].map(r => [r.type, r.bank || "", r.facility || "", r.owner || "", r.date || "", r.amount, r.rate, r.months, r.emi, r.out, r.next ? r.next.date : "", r.next ? r.next.emi : ""])]];

function loanForm(l){
  l = l || {type: "long", method: "reducing", freq: 1, date: iso(new Date()), account: "1100"};
  const f = (n, lab, type = "text", extra = "") => `<div class="f"><label for="ln_${n}">${lab}</label><input id="ln_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(l[n] ?? "")}"${extra}></div>`;
  return `<div class="section"><div class="head"><div><h2>${l.id ? "Edit business loan / facility" : "New business loan / facility"}</h2><p class="sub">Enter the terms from the facility letter / contract. Leave the instalment empty to work it out.</p></div><button class="btn ghost" data-back="1">← Back</button></div>
  <form class="form" id="fLoan" data-id="${esc(l.id || "")}">
    <div class="f"><label for="ln_type">Type</label><select id="ln_type" name="type">${opts(LOAN_TYPES, LOAN_TYPES[l.type] ? l.type : "long")}</select><span class="small muted">Car finance? Add it on the car (Auto loans below).</span></div>
    ${f("bank", "Bank", "text", " required")}${f("facility", "Facility ID / loan number")}${f("purpose", "Purpose / for")}
    ${f("amount", "Loan / facility amount (AED)", "number", " required")}${f("date", "Disbursement date", "date", " required")}
    <div class="f"><label for="ln_account">Received in / instalments paid from</label><select id="ln_account" name="account">${opts(acctOpts(["bank","cash"]), l.account || "1100")}</select></div>
    ${f("fee", "Processing fee (AED)", "number")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Contract terms</b></div>
    <div class="f"><label for="ln_method">Profit / interest method</label><select id="ln_method" name="method">${opts({reducing: "Reducing balance (equal instalments)", flat: "Flat rate", bullet: "Bullet – profit each period, principal at maturity"}, l.method || "reducing")}</select></div>
    ${f("rate", "Rate % per year", "number", " required")}${f("months", "Tenure (months)", "number", " required")}
    <div class="f"><label for="ln_freq">Instalments</label><select id="ln_freq" name="freq">${opts(LOAN_FREQ, String(l.freq || 1))}</select></div>
    ${f("grace", "Grace period (months, profit only)", "number")}${f("firstDue", "First instalment date (blank = one period after disbursement)", "date")}${f("emi", "Instalment amount (blank = worked out)", "number")}
    <div class="f wide"><label for="ln_notes">Notes (security, guarantees, covenants)</label><input id="ln_notes" name="notes" value="${esc(l.notes || "")}"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-loanedit="">Cancel</button>${l.id ? `<button class="btn danger" type="button" data-loandel="${esc(l.id)}">Delete</button>` : ""}</div>
  </form></div>`;
}
function loanDetail(id){
  const l = S.loans[id], sch = loanSchedule(l), today = iso(new Date()), next = sch.find(x => x.date > today), paid = sch.filter(x => x.date <= today);
  const info = [["Type", LOAN_TYPES[l.type]], ["Bank", l.bank], ["Facility no.", l.facility], ["Purpose", l.purpose], ["Amount", fmt(num(l.amount))], ["Disbursed", dmyS(l.date) + " into " + acctName(l.account || "1100")],
    ["Terms", `${num(l.rate)}% per year, ${l.method === "flat" ? "flat rate" : l.method === "bullet" ? "bullet repayment" : "reducing balance"}, ${num(l.months)} months, ${(LOAN_FREQ[l.freq || 1] || "Monthly").toLowerCase()}${num(l.grace) ? `, ${num(l.grace)} months grace` : ""}`],
    ["Processing fee", num(l.fee) ? fmt(num(l.fee)) : "—"], ["Account", loanAcct(l) + " · " + acctName(loanAcct(l))], ["Outstanding today", fmt(loanOut(l, today))], ["Next instalment", next ? dmyS(next.date) + " · " + fmt(next.emi) : "—"], ["Notes", l.notes]];
  const tot = {emi: sum(sch, x => x.emi), p: sum(sch, x => x.principal), i: sum(sch, x => x.profit)};
  return `<div class="section"><div class="head"><div><h2>${esc(l.bank || "Loan")} ${l.facility ? `<span class="mono small">${esc(l.facility)}</span>` : ""}</h2><p class="sub">${esc(LOAN_TYPES[l.type] || "")}${l.purpose ? " · " + esc(l.purpose) : ""}</p></div><div class="row"><button class="btn ghost" data-back="1">← Back</button>${dlBtn("loansch", id)}<button class="btn" data-loanedit="${esc(id)}">Edit</button></div></div>
  <div class="tbl"><table><tbody>${info.map(([k, v]) => `<tr><td class="muted" style="width:30%">${k}</td><td>${esc(v || "—")}</td></tr>`).join("")}</tbody></table></div>
  <h3 style="margin:14px 0 6px">Instalment schedule <span class="small muted">· ${paid.length} of ${sch.length} paid</span></h3>
  <div class="tbl"><table><thead><tr><th class="num">#</th><th>Due date</th><th class="num">Instalment</th><th class="num">Principal</th><th class="num">Profit / interest</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>
  ${sch.map(x => `<tr><td class="num">${x.no}</td><td>${esc(dmyS(x.date))}</td><td class="num">${fmt(x.emi)}</td><td class="num">${fmt(x.principal)}</td><td class="num">${fmt(x.profit)}</td><td class="num">${fmt(x.balance)}</td><td>${x.date <= today ? '<span class="pill good">Paid</span>' : x === next ? '<span class="pill warn">Next</span>' : `<span class="muted small">${x.grace ? "Grace – profit only" : "Upcoming"}</span>`}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="2">Total</td><td class="num">${fmt(tot.emi)}</td><td class="num">${fmt(tot.p)}</td><td class="num">${fmt(tot.i)}</td><td colspan="2"></td></tr></tfoot></table></div>
  <p class="small muted" style="margin-top:6px">Instalments are booked on their due dates from ${esc(acctName(l.account || "1100"))}: principal reduces the loan, profit / interest is a finance cost (5955). At each period end the principal due within 12 months is shown as the current portion (2425) and the interest earned since the last instalment is accrued (2440).</p></div>`;
}
DL.loansch = id => { const l = S.loans[id]; return [`loan_schedule_${norm(l.bank || "")}_${norm(l.facility || id)}.csv`, [["Instalment","Due date","Instalment amount","Principal","Profit / interest","Balance"], ...loanSchedule(l).map(x => [x.no, x.date, x.emi, x.principal, x.profit, x.balance])]]; };

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.loanview != null){ S.loanView = t.dataset.loanview; S.loanEdit = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.loanedit != null){ S.loanEdit = t.dataset.loanedit || null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.loandel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to delete"; return; }
    if(await writeOk(S.db.doc("loans/" + t.dataset.loandel).delete())){ S.loanEdit = null; S.loanView = ""; toast("Loan deleted."); render(); } return; }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fLoan") return; ev.preventDefault(); if(!S.db) return;
  const d = Object.fromEntries(new FormData(f).entries());
  ["amount","fee","rate","months","freq","grace","emi"].forEach(k => d[k] = String(d[k] ?? "") === "" ? "" : num(d[k]));
  if(!num(d.amount) || !num(d.months)){ toast("Enter the amount and the tenure."); return; }
  const id = f.dataset.id || "ln-" + uid();
  d.by = (S.user && (S.user.name || S.user.id)) || ""; d.at = new Date().toISOString();
  if(await writeOk(S.db.doc("loans/" + id).set(d))){ S.loanEdit = null; S.loanView = id; toast("Loan saved – the schedule is worked out from its terms."); render(); }
});
document.addEventListener("change", ev => { if(ev.target.id !== "autoLoanCar" || !ev.target.value) return; const id = ev.target.value; S.navStack.push(JSON.stringify(Object.fromEntries(NAV_KEYS.map(k => [k, S[k] ?? null])))); S.view = "vehicles"; S.vehView = id; S.vehTab = "fin"; S.finEdit = id; render(); window.scrollTo(0,0); });
window.LOANS = {post: postLoans, opening: loansOpening, schedule: loanSchedule, split: loanSplit};
Object.assign(window.BOOK_VIEWS = window.BOOK_VIEWS || {}, {bankfin: vBankFinance});
