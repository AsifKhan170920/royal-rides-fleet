/* Platform page (Platforms & contracts → name): Ledger · Payouts · Fee invoices.
   - Ledger: the platform's account (its clearing account) from the books start, as a statement – per week (or day /
     month): what the platform collected for us (fares, tips, tolls & refunds, other earnings) is a debit; its service
     fee, the VAT on the fee and the cash our drivers kept are credits; every payout to the bank is a credit.
     The balance is what the platform still owes us.
   - Payouts: every payout in the platform's statement, matched with the money that reached the bank. With
     "reconcile payouts with the bank" on (per platform), a payout waits in 1158 Platform payouts in transit until it is
     matched (bank date, amount received, account); a difference goes to 5300 bank charges (short) or 4200 other income
     (over). Off: payouts are taken as received in the bank on their date (as before).
   - Fee invoices: the tax invoices the platform issues for its service fee (Uber's monthly / weekly fee invoices):
     number, date, period, fee, VAT, PDF. Each is compared with the fee and VAT in the trip data of that period, so a
     missing or wrong invoice stands out; the invoices are the support for the input VAT. They are not posted again –
     the fee is already booked from the trips.
   Trip files differ by platform: each platform's file is mapped to the fields once on Import trip data; the mapping
   is remembered for that file layout. Excel files (.xlsx) can be dropped as well as CSV. */
Object.assign(ACCT, {"1158": "Platform payouts in transit"}); if(typeof ACCT_BASE !== "undefined") Object.assign(ACCT_BASE, {"1158": "Platform payouts in transit"});
S.pltView = S.pltView || ""; S.pltTab = S.pltTab || "ledger"; S.pltGroup = S.pltGroup || "week"; S.payouts = S.payouts || {}; S.feeinv = S.feeinv || {}; S.feeEdit = S.feeEdit || null; S.poMatch = S.poMatch || null;
const PLT_TABS = {ledger: "Ledger", payouts: "Payouts", fees: "Fee invoices"};
const pltConfirm = pl => !!(S.platforms[pl] || {}).payoutConfirm;
const histTrips = () => (S.ledger && S.ledger.trips && !S.ledger.loading) ? S.ledger.trips : S.trips;
const histEnts = () => (S.ledger && S.ledger.entries && !S.ledger.loading) ? S.ledger.entries : S.entries;

// payouts in the statement, one per day (the "paid to bank" rows of the trip data), plus payouts entered by hand
function statementPayouts(pl){
  const by = {}; histTrips().filter(t => plOf(t) === pl && t.po).forEach(t => { by[t.d] = r2((by[t.d] || 0) + t.po); });
  return Object.entries(by).map(([d, a]) => ({id: pl + "_" + d, pl, date: d, amount: a, m: S.payouts[pl + "_" + d]})).sort((a, b) => a.date.localeCompare(b.date));
}
/* journal: matched payouts (confirm mode) */
function postPlt(add){
  for(const m of Object.values(S.payouts)){
    if(!m.bankDate || m.bankDate < S.from || m.bankDate > S.to || !pltConfirm(m.pl)) continue;
    const memo = `${pName(m.pl)} payout of ${dmyS(m.date)} received`, diff = r2(num(m.bankAmount) - num(m.amount));
    add(m.account || payAcct(m.pl), num(m.bankAmount), 0, memo, m.bankDate); add("1158", 0, num(m.amount), memo, m.bankDate);
    if(diff < 0) add("5300", -diff, 0, memo + " – short received", m.bankDate); else if(diff > 0) add("4200", 0, diff, memo + " – received over", m.bankDate);
  }
}

/* ---------- ledger ---------- */
function pltLedger(pl){
  const grp = S.pltGroup, start = setting("ledgerStart", "2026-09-01"), gk = d => grp === "day" ? d : grp === "month" ? monthEnd(d.slice(0,7)) : weekEnd(d);
  const G = {}, L = [];
  histTrips().filter(t => plOf(t) === pl && t.d).forEach(t => { const k = gk(t.d), g = G[k] ||= {a: t.d, z: t.d, n: new Set(), f: 0, tp: 0, rf: 0, oe: 0, sf: 0, tx: 0, c: 0};
    g.f += t.f || 0; g.tp += t.tp || 0; g.rf += t.rf || 0; g.oe += t.oe || 0; g.sf += t.sf || 0; g.tx += t.tx || 0; g.c += t.c || 0; if(t.tr || t.f) g.n.add(t.tr || t.id); if(t.d < g.a) g.a = t.d; if(t.d > g.z) g.z = t.d; });
  Object.entries(G).forEach(([k, g]) => { const per = g.a === g.z ? dmyS(g.a) : `${dmyS(g.a)} – ${dmyS(g.z)}`, date = k > S.to ? S.to : k;
    if(r2(g.f + g.tp + g.rf + g.oe)) L.push({date, desc: `Collected by ${pName(pl)} · ${g.n.size} trips · ${per} (fares ${fmt(g.f)}${g.tp ? ", tips " + fmt(g.tp) : ""}${g.rf ? ", tolls & refunds " + fmt(g.rf) : ""}${g.oe ? ", other " + fmt(g.oe) : ""})`, dr: r2(g.f + g.tp + g.rf + g.oe)});
    if(r2(g.sf)) L.push({date, desc: `Service fee · ${per}`, cr: r2(g.sf)});
    if(r2(g.tx)) L.push({date, desc: `VAT on service fee · ${per}`, cr: r2(g.tx)});
    if(r2(g.c)) L.push({date, desc: `Cash collected by our drivers · ${per}`, cr: r2(g.c)}); });
  statementPayouts(pl).forEach(p => L.push({date: p.date, desc: `Payout to bank${pltConfirm(pl) ? (p.m && p.m.bankDate ? ` – received ${dmyS(p.m.bankDate)} AED ${fmt(num(p.m.bankAmount))}` : " – not yet matched with the bank") : ""}`, cr: p.amount, po: true}));
  histEnts().filter(e => e.type === "uber_payout" && (e.platformId || "uber") === pl).forEach(e => L.push({date: e.date, desc: `Payout received${e.note ? " – " + e.note : ""} (entered)`, cr: num(e.amount), ref: {kind: "entry", id: e.id, date: e.date}}));
  L.sort((a, b) => a.date.localeCompare(b.date) || (a.po ? 1 : 0) - (b.po ? 1 : 0));
  let bal = typeof openingOf === "function" ? openingOf(clearingAcct(pl)) : 0; const open = bal, shown = []; let before = bal;
  L.forEach(l => { bal = r2(bal + (l.dr || 0) - (l.cr || 0)); l.bal = bal; if(l.date < S.from) before = bal; else if(l.date <= S.to) shown.push(l); });
  return {open, before, shown, close: shown.length ? shown[shown.length - 1].bal : before, start};
}
function pltLedgerTab(pl){
  const wait = needHistory(); if(wait) return wait;
  const R = pltLedger(pl);
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(pName(pl))}'s account (${esc(clearingAcct(pl))} · ${esc(acctName(clearingAcct(pl)))}) from ${esc(dmyS(R.start))}: collected for us = debit; fee, VAT, cash kept by drivers and payouts = credit. Balance = what ${esc(pName(pl))} still owes us. Newest first.</span>
    <select id="pltGrp" aria-label="Group">${opts({day: "By day", week: "By week", month: "By month"}, S.pltGroup)}</select></div>
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>
  ${(R.pg = paged("pltled-" + pl, R.shown.slice().reverse())).rows.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nothing in this period.</td></tr>`}
  ${R.pg.last ? `<tr><td>${esc(dmyS(S.from < R.start ? R.start : S.from))}</td><td><b>${S.from <= R.start ? "Opening balance" : "Balance brought forward"}</b></td><td></td><td></td><td class="num"><b>${aed(S.from <= R.start ? R.open : R.before)}</b></td></tr>` : ""}
  </tbody><tfoot><tr><td colspan="2">Balance ${esc(dmyS(S.to))} – ${R.close >= 0 ? "owed by " + esc(pName(pl)) : "we owe " + esc(pName(pl))}</td><td class="num">${fmt(sum(R.shown, l => l.dr || 0))}</td><td class="num">${fmt(sum(R.shown, l => l.cr || 0))}</td><td class="num"><b>${aed(R.close)}</b></td></tr></tfoot></table></div>${R.pg.bar}`;
}

/* ---------- payouts ---------- */
function pltPayoutsTab(pl){
  const wait = needHistory(); if(wait) return wait;
  const on = pltConfirm(pl), P = statementPayouts(pl).filter(p => p.date >= S.from && p.date <= S.to), M = S.poMatch && S.poMatch.pl === pl ? S.poMatch : null;
  const matched = P.filter(p => p.m && p.m.bankDate), open = P.filter(p => !(p.m && p.m.bankDate)), allOpen = statementPayouts(pl).filter(p => !(p.m && p.m.bankDate));
  const form = M ? (() => { const p = P.find(x => x.id === M.id) || statementPayouts(pl).find(x => x.id === M.id); if(!p) return ""; const m = p.m || {};
    return `<form class="form" id="fPoMatch" data-id="${esc(p.id)}" data-pl="${esc(pl)}" data-date="${esc(p.date)}" data-amount="${p.amount}" style="border:1px solid var(--line);padding:10px;border-radius:8px;margin-bottom:10px"><div class="f wide"><b>Match the payout of ${esc(dmyS(p.date))} – AED ${fmt(p.amount)}</b> <span class="small muted">with the credit on the bank statement</span></div>
      <div class="f"><label for="pm_d">Received in the bank on</label><input id="pm_d" name="bankDate" type="date" required value="${esc(m.bankDate || p.date)}"></div><div class="f"><label for="pm_a">Amount received</label><input id="pm_a" name="bankAmount" type="number" step="0.01" required value="${esc(m.bankAmount ?? p.amount)}"></div>
      <div class="f"><label for="pm_ac">Bank account</label><select id="pm_ac" name="account">${opts(acctOpts(["bank"]), m.account || payAcct(pl))}</select></div><div class="f"><label for="pm_r">Bank reference</label><input id="pm_r" name="ref" value="${esc(m.ref || "")}"></div>
      <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save match</button><button class="btn ghost" type="button" data-pomatch="">Cancel</button>${m.bankDate ? `<button class="btn danger" type="button" data-pounmatch="${esc(p.id)}">Remove match</button>` : ""}</div></form>`; })() : "";
  return `<div class="banner ${on ? "info" : ""}">${on ? `Payouts are reconciled with the bank: a payout waits in <b>1158 Platform payouts in transit</b> until you match it with the bank credit. In transit now: <b>AED ${fmt(sum(allOpen, p => p.amount))}</b> (${allOpen.length} payout${allOpen.length === 1 ? "" : "s"}).` : `Payouts are taken as received in the bank on their date. Turn on reconciliation to match each payout with the bank statement – unmatched payouts then wait in "payouts in transit".`}
    <div class="row" style="margin-top:6px"><button class="btn sm ${on ? "" : "primary"}" data-poconfirm="${esc(pl)}">${on ? "Turn reconciliation off" : "Reconcile payouts with the bank"}</button></div></div>
  ${form}
  <div class="tbl"><table><thead><tr><th>Payout date</th><th class="num">Payout (statement)</th><th>Received in bank</th><th class="num">Amount received</th><th class="num">Difference</th><th>Bank</th><th>Status</th><th></th></tr></thead><tbody>
  ${P.slice().reverse().map(p => { const m = p.m || {}, ok = !!m.bankDate, diff = ok ? r2(num(m.bankAmount) - p.amount) : null;
    return `<tr><td>${esc(dmyS(p.date))}</td><td class="num">${fmt(p.amount)}</td><td>${ok ? esc(dmyS(m.bankDate)) : ""}</td><td class="num">${ok ? fmt(num(m.bankAmount)) : ""}</td><td class="num">${diff ? aed(diff) : ok ? "0.00" : ""}</td><td class="small">${ok ? esc(acctName(m.account || payAcct(pl))) + (m.ref ? " · " + esc(m.ref) : "") : ""}</td>
      <td>${ok ? (diff ? '<span class="pill warn">Matched – difference</span>' : '<span class="pill good">Matched</span>') : on ? '<span class="pill bad">In transit</span>' : '<span class="pill">Assumed received</span>'}</td><td>${on ? `<button class="btn sm ${ok ? "" : "primary"}" data-pomatch="${esc(p.id)}" data-pl="${esc(pl)}">${ok ? "Edit" : "Match"}</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="8" class="muted">No payouts in the trip data for this period.</td></tr>`}
  </tbody><tfoot><tr><td>${P.length} payout(s)</td><td class="num">${fmt(sum(P, p => p.amount))}</td><td></td><td class="num">${fmt(sum(matched, p => num(p.m.bankAmount)))}</td><td class="num">${fmt(sum(matched, p => num(p.m.bankAmount) - p.amount))}</td><td colspan="3">${on ? `Not matched: ${open.length} · AED ${fmt(sum(open, p => p.amount))}` : ""}</td></tr></tfoot></table></div>
  <p class="small muted" style="margin-top:6px">Payouts come from the "paid to bank" rows of ${esc(pName(pl))}'s statement in the trip data. A payout entered by hand (Purchases & expenses → Platform payout received) is a bank receipt already and is in the Ledger.</p>`;
}

/* ---------- fee invoices ---------- */
function feeData(pl, a, b){ const ts = histTrips().filter(t => plOf(t) === pl && t.d >= a && t.d <= b); return {fee: r2(sum(ts, t => t.sf || 0)), vat: r2(sum(ts, t => t.tx || 0))}; }
function pltFeesTab(pl){
  const wait = needHistory(); if(wait) return wait;
  const L = Object.values(S.feeinv).filter(f => f.pl === pl).sort((a, b) => (b.to || b.date || "").localeCompare(a.to || a.date || ""));
  const E = S.feeEdit && S.feeEdit.pl === pl ? S.feeEdit : null, f0 = E && E.id ? S.feeinv[E.id] : null, f = f0 || {from: S.from, to: S.to, date: iso(new Date())};
  const fld = (n, l, type = "text", extra = "") => `<div class="f"><label for="fi_${n}">${l}</label><input id="fi_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(f[n] ?? "")}"${extra}></div>`;
  const form = E ? `<form class="form" id="fFeeInv" data-id="${esc(E.id || "")}" data-pl="${esc(pl)}" style="border:1px solid var(--line);padding:10px;border-radius:8px;margin-bottom:10px"><div class="f wide"><b>${f0 ? "Edit" : "Add"} ${esc(pName(pl))} fee invoice</b> <span class="small muted">– from the tax invoice ${esc(pName(pl))} issued for its service fee.</span></div>
    ${fld("number", "Invoice no.", "text", " required")}${fld("date", "Invoice date", "date", " required")}${fld("from", "Period from", "date", " required")}${fld("to", "Period to", "date", " required")}${fld("fee", "Service fee (before VAT)", "number", " required")}${fld("vat", "VAT", "number")}${fld("trn", `${pName(pl)} TRN`)}${fld("notes", "Notes")}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-feeedit="">Cancel</button>${f0 ? `<button class="btn danger" type="button" data-feedel="${esc(f0.id)}">Delete</button>` : ""}</div></form>` : "";
  const rows = L.map(x => { const d = feeData(pl, x.from, x.to), dfee = r2(num(x.fee) - d.fee), dvat = r2(num(x.vat) - d.vat); return {...x, d, dfee, dvat}; });
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">Each invoice is compared with the service fee and VAT in the trip data of its period. The fee is booked from the trips; the invoices support the input VAT.</span><button class="btn sm primary" data-feeedit="new" data-pl="${esc(pl)}">Add fee invoice</button></div>
  ${form}
  <div class="tbl"><table><thead><tr><th>Invoice</th><th>Date</th><th>Period</th><th class="num">Fee (invoice)</th><th class="num">Fee (trips)</th><th class="num">Difference</th><th class="num">VAT (invoice)</th><th class="num">VAT (trips)</th><th class="num">Difference</th><th>PDF</th><th></th></tr></thead><tbody>
  ${rows.map(x => `<tr><td class="mono">${esc(x.number || "")}</td><td>${esc(dmyS(x.date || ""))}</td><td>${esc(dmyS(x.from))} – ${esc(dmyS(x.to))}</td><td class="num">${fmt(num(x.fee))}</td><td class="num">${fmt(x.d.fee)}</td><td class="num">${Math.abs(x.dfee) < 0.05 ? '<span class="pill good">✓</span>' : aed(x.dfee)}</td><td class="num">${fmt(num(x.vat))}</td><td class="num">${fmt(x.d.vat)}</td><td class="num">${Math.abs(x.dvat) < 0.05 ? '<span class="pill good">✓</span>' : aed(x.dvat)}</td>
    <td>${typeof rcptCell === "function" ? rcptCell({id: "fee-" + x.id}) : ""}</td><td><button class="btn sm" data-feeedit="${esc(x.id)}" data-pl="${esc(pl)}">Edit</button></td></tr>`).join("") || `<tr><td colspan="11" class="muted">No fee invoices yet.</td></tr>`}
  </tbody><tfoot><tr><td colspan="3">${rows.length} invoice(s)</td><td class="num">${fmt(sum(rows, x => num(x.fee)))}</td><td class="num">${fmt(sum(rows, x => x.d.fee))}</td><td class="num">${fmt(sum(rows, x => x.dfee))}</td><td class="num">${fmt(sum(rows, x => num(x.vat)))}</td><td class="num">${fmt(sum(rows, x => x.d.vat))}</td><td class="num">${fmt(sum(rows, x => x.dvat))}</td><td colspan="2"></td></tr></tfoot></table></div>
  ${(() => { const d = feeData(pl, S.from, S.to), cov = rows.filter(x => x.from <= S.to && x.to >= S.from); return `<p class="small muted" style="margin-top:6px">This period (${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}): fee in the trip data AED ${fmt(d.fee)}, VAT ${fmt(d.vat)}; ${cov.length ? `covered by ${cov.length} invoice(s)` : `<b class="neg">no fee invoice recorded yet</b>`}.</p>`; })()}`;
}

/* ---------- the page ---------- */
function platformDetail(pl){
  const p = S.platforms[pl] || {id: pl, name: pName(pl)}, tab = PLT_TABS[S.pltTab] ? S.pltTab : "ledger";
  const body = tab === "payouts" ? pltPayoutsTab(pl) : tab === "fees" ? pltFeesTab(pl) : pltLedgerTab(pl);
  return `<div class="section"><div class="head"><div><h2>${esc(p.name || pName(pl))}</h2><p class="sub">${esc(p.legalName || "")}${p.legalName ? " · " : ""}account ${esc(clearingAcct(pl))} · payouts to ${esc(acctName(payAcct(pl)))}</p></div>
    <div class="row"><button class="btn ghost" data-back="1">← Back</button>${S.platforms[pl] ? `<button class="btn" data-edit="platform" data-id="${esc(pl)}">Edit platform</button>` : ""}</div></div>
  ${tabBtns("data-plttab", tab, PLT_TABS)}${body}</div>`;
}
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.pltview != null){ S.pltView = t.dataset.pltview; S.edit = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.plttab){ S.pltTab = t.dataset.plttab; S.poMatch = null; S.feeEdit = null; render(); return; }
  if(t.dataset.poconfirm){ const p = S.platforms[t.dataset.poconfirm]; if(!p){ toast("Add the platform on Platforms & contracts first."); return; } const {id, ...b} = p;
    if(await writeOk(S.db.doc("platforms/" + id).set({...b, payoutConfirm: !p.payoutConfirm}))) toast(p.payoutConfirm ? "Payouts are taken as received again." : "Reconciliation on – match each payout with the bank credit."); render(); return; }
  if(t.dataset.pomatch != null){ S.poMatch = t.dataset.pomatch ? {pl: t.dataset.pl, id: t.dataset.pomatch} : null; render(); return; }
  if(t.dataset.pounmatch){ if(await writeOk(S.db.doc("payouts/" + t.dataset.pounmatch).delete())){ S.poMatch = null; toast("Match removed – the payout is in transit again."); render(); } return; }
  if(t.dataset.feeedit != null){ S.feeEdit = t.dataset.feeedit ? {pl: t.dataset.pl || S.pltView, id: t.dataset.feeedit === "new" ? "" : t.dataset.feeedit} : null; render(); return; }
  if(t.dataset.feedel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again"; return; } if(await writeOk(S.db.doc("feeinv/" + t.dataset.feedel).delete())){ S.feeEdit = null; toast("Fee invoice deleted."); render(); } return; }
});
document.addEventListener("change", ev => { if(ev.target.id === "pltGrp"){ S.pltGroup = ev.target.value; render(); } });
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fPoMatch" && f.id !== "fFeeInv") return; ev.preventDefault(); if(!S.db) return;
  const d = Object.fromEntries(new FormData(f).entries()), by = (S.user && (S.user.name || S.user.id)) || "";
  if(f.id === "fPoMatch"){ const id = f.dataset.id;
    if(await writeOk(S.db.doc("payouts/" + id).set({pl: f.dataset.pl, date: f.dataset.date, amount: num(f.dataset.amount), bankDate: d.bankDate, bankAmount: num(d.bankAmount), account: d.account, ref: d.ref || "", by, at: new Date().toISOString()}))){ S.poMatch = null; toast("Payout matched with the bank."); render(); } return; }
  const id = f.dataset.id || "fi-" + uid();
  if(d.from > d.to){ toast("The period must end after it starts."); return; }
  if(await writeOk(S.db.doc("feeinv/" + id).set({...d, pl: f.dataset.pl, fee: num(d.fee), vat: num(d.vat), by, at: new Date().toISOString()}))){ S.feeEdit = null; toast("Fee invoice saved."); render(); }
});
window.PLT = {post: postPlt, confirm: pltConfirm};
window.platformDetail = platformDetail;
