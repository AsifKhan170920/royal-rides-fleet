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
const PLT_ACCTS = {"1158": "Platform payouts in transit", "4030": "Platform adjustments (income)", "5020": "Platform adjustments / other deductions"};
Object.assign(ACCT, PLT_ACCTS); if(typeof ACCT_BASE !== "undefined") Object.assign(ACCT_BASE, PLT_ACCTS);
S.pladj = S.pladj || {};
S.pltView = S.pltView || ""; S.pltTab = S.pltTab || "ledger"; S.pltGroup = S.pltGroup || "week"; S.payouts = S.payouts || {}; S.feeinv = S.feeinv || {}; S.feeEdit = S.feeEdit || null; S.poMatch = S.poMatch || null;
const PLT_TABS = {ledger: "Ledger", payouts: "Payouts", fees: "Fee invoices", api: "API / data sync"};
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
  // balancing adjustments from imports: the report's total that no field of the trip data covers
  for(const a of Object.values(S.pladj)){
    add.src = {kind: "pladj", id: a.id, pl: a.pl};
    if(!a.date || a.date < S.from || a.date > S.to) continue; const v = r2(num(a.amount)), c = clearingAcct(a.pl), memo = `${pName(a.pl)} balancing adjustment – ${a.file || "import"}`;
    if(v > 0){ add(c, v, 0, memo, a.date); add("4030", 0, v, memo, a.date); } else if(v < 0){ add("5020", -v, 0, memo, a.date); add(c, 0, -v, memo, a.date); }
  }
  for(const m of Object.values(S.payouts)){
    add.src = {kind: "payout", pl: m.pl};
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
  Object.values(S.pladj).filter(a => a.pl === pl).forEach(a => { const v = r2(num(a.amount)); L.push({date: a.date, desc: `Balancing adjustment (${v > 0 ? "income 4030" : "expense 5020"}) – ${a.file || "import"}: report total vs. imported rows`, ...(v > 0 ? {dr: v} : {cr: -v}), adj: a.id}); });
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
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th><th></th></tr></thead><tbody>
  ${(R.pg = paged("pltled-" + pl, R.shown.slice().reverse())).rows.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td><td>${l.adj ? `<button class="btn sm danger" data-pladjdel="${esc(l.adj)}">Delete</button>` : l.ref ? ledgerActions(l.ref) : l.po ? `<button class="btn sm" data-plttab="payouts">View</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Nothing in this period.</td></tr>`}
  ${R.pg.last ? `<tr><td>${esc(dmyS(S.from < R.start ? R.start : S.from))}</td><td><b>${S.from <= R.start ? "Opening balance" : "Balance brought forward"}</b></td><td></td><td></td><td class="num"><b>${aed(S.from <= R.start ? R.open : R.before)}</b></td><td></td></tr>` : ""}
  </tbody><tfoot><tr><td colspan="2">Balance ${esc(dmyS(S.to))} – ${R.close >= 0 ? "owed by " + esc(pName(pl)) : "we owe " + esc(pName(pl))}</td><td class="num">${fmt(sum(R.shown, l => l.dr || 0))}</td><td class="num">${fmt(sum(R.shown, l => l.cr || 0))}</td><td class="num"><b>${aed(R.close)}</b></td><td></td></tr></tfoot></table></div>${R.pg.bar}`;
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

/* ---------- API / data sync ----------
   How the platform's trips come in: by file (Import trip data) or through its API, fetched by the sync program on the
   office PC (uber-sync: "4 - Sync platform APIs", also run by the daily sync). Here: what to call and how to read the
   answer – nothing secret. The secrets go in uber-sync/.env under the platform's name. */
const API_FIELDS = [["id", "Trip / order id"], ["date", "Date & time"], ["driverId", "Driver id on the platform"], ["driverName", "Driver name"], ["plate", "Number plate"], ["fare", "Fare"], ["fee", "Platform fee / commission"], ["vat", "VAT on fee"], ["tip", "Tip"], ["refund", "Tolls & refunds"], ["cash", "Cash collected by driver"], ["other", "Other earnings / bonus"], ["payout", "Payout to bank"], ["km", "Distance (km)"]];
// ready-made settings for platforms whose API is known (checked against the live API)
const PLT_PRESETS = {bolt: {note: "Bolt Fleet Integration API – OAuth client credentials from the Bolt fleet portal; finished orders only.", api: {enabled: true, authType: "oauth", tokenUrl: "https://oidc.bolt.eu/token", scope: "fleet-integration:api", method: "POST",
  tripsUrl: "https://node.bolt.eu/fleet-integration-gateway/fleetIntegration/v1/getFleetOrders", body: '{"company_ids":{companyIds},"start_ts":{fromTs},"end_ts":{toTs},"offset":{offset},"limit":{limit}}', listPath: "data.orders", pageSize: 500, maxDays: 15, filter: "order_status=finished",
  companiesUrl: "https://node.bolt.eu/fleet-integration-gateway/fleetIntegration/v1/getCompanies", companiesPath: "data.company_ids",
  fields: {id: "order_reference", date: "order_created_timestamp", driverId: "driver_uuid", driverName: "driver_name", plate: "vehicle_license_plate", fare: "order_price.ride_price", fee: "order_price.commission", tip: "order_price.tip", refund: "order_price.toll_fee", cash: "order_price.ride_price?payment_method=cash", km: "ride_distance/1000"}}}};
function pltApiTab(pl){
  const p = S.platforms[pl];
  if(!p) return `<div class="banner">Add ${esc(pName(pl))} on Platforms & contracts first (Add Uber, Bolt…), then set its API here.</div>`;
  const a = p.api || {}, F = a.fields || {}, pre = String(pl).toUpperCase().replace(/[^A-Z0-9]/g, "_"), sy = p.sync;
  const fld = (n, l, ph = "", extra = "") => `<div class="f"><label for="ap_${n}">${l}</label><input id="ap_${n}" name="${n}" value="${esc(a[n] ?? "")}" placeholder="${esc(ph)}"${extra}></div>`;
  const envs = (a.authType || "oauth") === "oauth" ? [`${pre}_CLIENT_ID=`, `${pre}_CLIENT_SECRET=`] : a.authType === "apikey" ? [`${pre}_API_KEY=`] : a.authType === "bearer" ? [`${pre}_TOKEN=`] : [];
  return `<div class="banner ${a.enabled ? "info" : ""}"><b>${a.enabled ? "API on" : "File import"}</b> – ${a.enabled ? `the sync program on the office PC fetches ${esc(pName(pl))}'s trips every day (and with "4 - Sync platform APIs").` : `${esc(pName(pl))}'s trips come from the files dropped on Import trip data. Switch the API on when ${esc(pName(pl))} has given you API access.`}
    ${sy ? `<div style="margin-top:6px">Last sync: <b>${esc(new Date(sy.at).toLocaleString("en-GB"))}</b> · ${esc(dmyS(sy.from))} – ${esc(dmyS(sy.to))} · ${sy.error ? `<span class="pill bad">Failed</span> ${esc(sy.error)}` : `<span class="pill good">OK</span> ${sy.added} new trips, ${sy.dup} already there`}</div>` : a.enabled ? '<div style="margin-top:6px" class="small">Not run yet.</div>' : ""}</div>
  ${apiKeysBox(pl)}
  ${PLT_PRESETS[pl] ? `<div class="row" style="margin-bottom:8px"><button class="btn" data-apipreset="${esc(pl)}">Fill in the ${esc(pName(pl))} API settings</button><span class="small muted">${esc(PLT_PRESETS[pl].note)}</span></div>` : ""}
  <form class="form" id="fApi" data-pl="${esc(pl)}">
    <div class="f"><label for="ap_en">Trips come by</label><select id="ap_en" name="enabled">${opts({false: "File import (Import trip data)", true: "API – fetched by the office sync program"}, String(!!a.enabled))}</select></div>
    <div class="f"><label for="ap_auth">Sign-in</label><select id="ap_auth" name="authType">${opts({oauth: "OAuth 2 – client ID & secret", apikey: "API key in a header", bearer: "Fixed bearer token", none: "None"}, a.authType || "oauth")}</select></div>
    ${fld("tokenUrl", "Token URL (OAuth)", "https://…/oauth/token")}${fld("scope", "Scope (if asked)")}${fld("keyHeader", "API key header name", "X-API-Key")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Trips / earnings request</b> <span class="small muted">– placeholders: {from} {to} (dates), {fromTs} {toTs} (Unix time), {offset} {page} {limit} (pages), {companyIds} (accounts)</span></div>
    <div class="f"><label for="ap_m">Method</label><select id="ap_m" name="method">${opts({GET: "GET", POST: "POST"}, a.method || "GET")}</select></div>
    ${fld("tripsUrl", "URL", "https://…/orders?start={fromTs}&end={toTs}&offset={offset}&limit={limit}", ' style="min-width:420px"')}${fld("body", "Body (POST, JSON)", '{"start_ts":{fromTs},"end_ts":{toTs},"offset":{offset},"limit":{limit}}')}
    ${fld("listPath", "Where the list is in the answer", "data.orders")}${fld("filter", "Only rows where (e.g. order_status=finished)", "order_status=finished")}${fld("companiesUrl", "Accounts URL – for {companyIds} (optional)")}${fld("companiesPath", "Where the account ids are", "data.company_ids")}${fld("pageSize", "Page size (blank = one page)", "100")}${fld("maxDays", "Days per request (blank = whole period)", "15")}${fld("pageStart", "First page number", "0")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Fields</b> <span class="small muted">– the name of each field in a list item: dots for nested fields (order_price.ride_price), /1000 to divide (metres → km), ?field=value to take it only then (order_price.ride_price?payment_method=cash), + to add fields</span></div>
    ${API_FIELDS.map(([k, l]) => `<div class="f"><label for="apf_${k}">${l}</label><input id="apf_${k}" name="f_${k}" value="${esc(F[k] || "")}"></div>`).join("")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Or through Google Apps Script</b> <span class="small muted">– optional, instead of the keys above: deploy apps-script/bolt-proxy.gs as a web app (the secret stays in its Script Properties), then paste its URL and access key here and use "Sync now".</span></div>
    ${fld("proxyUrl", "Apps Script web app URL", "https://script.google.com/macros/s/…/exec", ' style="min-width:420px"')}${fld("proxyKey", "Access key (ACCESS_KEY in the script)")}
    <div class="f wide"><div class="small" style="background:var(--bg);padding:8px;border-radius:6px">With the office sync program instead, the secrets go only in <b class="mono">uber-sync/.env</b> on the office PC – never here:<br>${envs.map(x => `<span class="mono">${esc(x)}</span>`).join("<br>") || "–"}</div></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save API settings</button></div></form>`;
}

/* ---------- the platform's API called straight from the software ----------
   The client id / secret are saved in their own record (secrets/<platform>), read only when syncing and never shown
   again; the page gets a token, the account ids and the orders itself (Bolt allows calls from this site). */
S.apiKeys = S.apiKeys || {};
async function loadApiKeys(pl){ try{ const d = await S.db.doc("secrets/" + pl).get(); S.apiKeys[pl] = d.exists ? d.data() : {}; }catch(e){ S.apiKeys[pl] = {error: e.message}; } return S.apiKeys[pl]; }
function apiKeysBox(pl){
  const k = S.apiKeys[pl], a = (S.platforms[pl] || {}).api || {};
  if(k === undefined){ loadApiKeys(pl).then(() => { if(S.pltView === pl && S.pltTab === "api") render(); }); }
  const has = k && k.clientSecret, kk = k || {};
  return `<form class="form section" id="fApiKeys" data-pl="${esc(pl)}" style="padding:12px 14px">
    <div class="f wide"><b>API keys – sync straight from the software</b> <span class="small muted">– from the ${esc(pName(pl))} fleet portal (API credentials). Saved once; then "Sync now" above fetches the trips. No office PC or script needed.</span>
      ${has ? `<div style="margin-top:4px"><span class="pill good">Keys saved</span> <span class="small muted">${kk.at ? "on " + esc(new Date(kk.at).toLocaleString("en-GB")) : ""} – the secret is not shown again; enter a new one only to change it.</span></div>` : k && k.error ? `<div class="small" style="margin-top:4px"><span class="pill bad">Could not read</span> ${esc(k.error)}</div>` : ""}</div>
    <div class="f"><label for="ak_id">Client ID</label><input id="ak_id" name="clientId" value="${esc(kk.clientId || "")}" autocomplete="off" style="min-width:300px"></div>
    <div class="f"><label for="ak_sec">Client secret</label><input id="ak_sec" name="clientSecret" type="password" autocomplete="new-password" placeholder="${has ? "saved – leave blank to keep" : ""}" style="min-width:300px"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save keys</button>${has ? `<button class="btn" type="button" data-apitest="${esc(pl)}">Test connection</button><button class="btn ghost" type="button" data-apikeysdel="${esc(pl)}">Remove keys</button>` : ""}
      ${a.tokenUrl ? "" : '<span class="small muted">Then click "Fill in the API settings" below (or set the token / trips URLs).</span>'}</div></form>`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function apiFetch(url, opt){
  for(let i = 0; i < 5; i++){
    const r = await fetch(url, opt);
    if(r.status === 429){ await sleep([2000, 5000, 15000, 30000, 30000][i]); continue; }
    const txt = await r.text(); let j; try{ j = JSON.parse(txt); }catch(e){ j = null; }
    if(!r.ok) throw new Error(`HTTP ${r.status} ${(j && (j.message || j.error_description || j.error)) || txt.slice(0, 120)}`);
    return j;
  }
  throw new Error("the platform kept saying too many requests – try again in a few minutes");
}
async function apiToken(api, keys){
  if((api.authType || "oauth") !== "oauth") return keys.clientSecret;
  if(!api.tokenUrl) throw new Error("set the token URL (Fill in the API settings)");
  const body = new URLSearchParams({client_id: keys.clientId, client_secret: keys.clientSecret, grant_type: "client_credentials"}); if(api.scope) body.set("scope", api.scope);
  const j = await apiFetch(api.tokenUrl, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded"}, body});
  if(!j || !j.access_token) throw new Error("no token in the answer – check the client id and secret");
  return j.access_token;
}
function apiHeaders(api, token){
  const h = {Accept: "application/json"};
  if((api.authType || "oauth") === "apikey") h[api.keyHeader || "X-API-Key"] = token; else if(api.authType !== "none") h.Authorization = "Bearer " + token;
  return h;
}
async function apiCompanies(api, token){
  if(!api.companiesUrl) return [];
  const j = await apiFetch(api.companiesUrl, {headers: apiHeaders(api, token)});
  return pdig(j, api.companiesPath || "data.company_ids") || [];
}
async function directOrders(pl, fromTs, toTs){
  const api = (S.platforms[pl] || {}).api || {}, keys = await loadApiKeys(pl);
  if(!keys.clientSecret) throw new Error("save the API keys first");
  if(!api.tripsUrl) throw new Error("set the trips URL (Fill in the API settings)");
  const token = await apiToken(api, keys), companies = await apiCompanies(api, token), H = apiHeaders(api, token);
  const span = (num(api.maxDays) || 3650) * 86400, limit = num(api.pageSize) || 0, all = {}, list = [];
  const fill = (t, v) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => k in v ? (typeof v[k] === "object" ? JSON.stringify(v[k]) : v[k]) : m);
  for(let a = fromTs; a <= toTs; a += span){
    const b = Math.min(toTs, a + span - 1);
    for(let pg = 0; pg < 200; pg++){
      const v = {fromTs: a, toTs: b, from: iso(new Date(a * 1000)), to: iso(new Date(b * 1000)), offset: pg * (limit || 0), page: pg + (num(api.pageStart) || 0), limit: limit || 1000, companyIds: companies};
      const opt = {method: api.method || "GET", headers: {...H}};
      if(opt.method === "POST"){ opt.headers["Content-Type"] = "application/json"; opt.body = fill(api.body, v); }
      const j = await apiFetch(fill(api.tripsUrl, v), opt);
      if(j && typeof j.code === "number" && j.code !== 0) throw new Error(`${pName(pl)}: ${j.code} ${j.message || ""}`);
      const rows = pdig(j, api.listPath) || [];
      rows.forEach(o => { const id = ppick(o, (api.fields || {}).id); if(id != null && id !== ""){ all[id] = o; } else list.push(o); });
      if(!limit || rows.length < limit) break;
    }
  }
  return {companies, orders: [...Object.values(all), ...list]};
}

/* ---------- fetching through a Google Apps Script proxy, straight from the browser ----------
   The platform's API is called by a small Google Apps Script web app (apps-script/bolt-proxy.gs) that keeps the
   secret; the page calls it with its URL and access key (stored with the platform – only signed-in users read them),
   maps the orders with the platform's API fields and saves them like an import. No office PC needed. */
const pdig = (o, path) => !path ? undefined : String(path).split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function ppick(o, spec){
  if(!spec) return undefined; const parts = String(spec).split("+").map(x => x.trim()).filter(Boolean);
  const one = p => { let [path, cond] = p.split("?"); if(cond){ const [k, v] = cond.split("="); if(!String(v || "").split("|").includes(String(pdig(o, k)))) return 0; }
    let div = 1; const m = path.match(/^(.*)\/(\d+(?:\.\d+)?)$/); if(m){ path = m[1]; div = +m[2]; } const v = pdig(o, path); return div !== 1 && v != null && v !== "" ? +v / div : v; };
  return parts.length === 1 ? one(parts[0]) : parts.reduce((a, p) => a + (+one(p) || 0), 0);
}
const pkeep = (o, filter) => !filter || String(filter).split("&").every(c => { const [k, v] = c.split("="); return String(v || "").split("|").includes(String(pdig(o, k.trim()))); });
function preadDate(v){
  if(typeof v === "number" || /^\d{10,13}$/.test(String(v || ""))){ const n = +v, d = new Date(n < 1e12 ? n * 1000 : n); return {date: iso(d), time: d.toTimeString().slice(0, 5)}; }
  return UberParse.parseTripDate(v);
}
async function browserSync(pl, days){
  const p = S.platforms[pl], api = (p || {}).api || {}, F = api.fields || {};
  const to = new Date(), from = new Date(to.getTime() - days * 86400000), fromTs = Math.floor(new Date(iso(from) + "T00:00:00").getTime() / 1000), toTs = Math.floor(to.getTime() / 1000);
  let j, via;
  if(api.direct){ j = await directOrders(pl, fromTs, toTs); via = "API"; }
  else if(api.proxyUrl && api.proxyKey){ const r = await fetch(`${api.proxyUrl}${api.proxyUrl.includes("?") ? "&" : "?"}key=${encodeURIComponent(api.proxyKey)}&from=${fromTs}&to=${toTs}`);
    j = await r.json(); if(!j.ok) throw new Error(j.error || "the Apps Script answered with an error"); via = "Apps Script"; }
  else throw new Error("save the API keys first");
  const rows = (Array.isArray(j.orders) ? j.orders : pdig(j, api.listPath) || []).filter(o => pkeep(o, api.filter));
  const trips = rows.map(o => { const dt = preadDate(ppick(o, F.date)); if(!dt) return null; const n = k => num(ppick(o, F[k])); const id = String(ppick(o, F.id) ?? "").trim() || `${dt.date}|${ppick(o, F.driverName)}|${n("fare")}`;
    return {id: pl + ":" + norm(id), tr: pl + ":" + norm(id), d: dt.date, t: dt.time, name: String(ppick(o, F.driverName) ?? "").trim(), uuid: String(ppick(o, F.driverId) ?? "").trim(), p: String(ppick(o, F.plate) ?? "").trim(),
      f: n("fare"), sf: Math.abs(n("fee")), tx: Math.abs(n("vat")), tp: n("tip"), rf: n("refund"), c: Math.abs(n("cash")), oe: n("other"), po: Math.abs(n("payout")), km: n("km")}; }).filter(Boolean);
  // drivers by their id on this platform or their name; cars by plate
  const byId = {}, byName = {}; Object.values(S.drivers).forEach(d => { if((d.platformIds || {})[pl]) byId[d.platformIds[pl]] = d.id; byName[norm(d.name)] = d.id; });
  const plates = {}; Object.values(S.vehicles).forEach(v => plates[norm(v.plate)] = v.id);
  for(const t of trips){
    let id = (t.uuid && byId[t.uuid]) || (t.name && byName[norm(t.name)]);
    if(!id){ id = "d-" + (norm(t.name).slice(0, 20) || norm(t.uuid).slice(0, 12) || uid()); const rec = {name: t.name || "Unnamed driver", platformIds: t.uuid ? {[pl]: t.uuid} : {}, payModel: "", commissionPct: 0, active: true, createdFromImport: true}; await writeOk(S.db.doc("drivers/" + id).set(rec)); S.drivers[id] = {id, ...rec}; }
    else if(t.uuid && !((S.drivers[id] || {}).platformIds || {})[pl]){ const {id: _, ...b} = S.drivers[id]; const rec = {...b, platformIds: {...(b.platformIds || {}), [pl]: t.uuid}}; await writeOk(S.db.doc("drivers/" + id).set(rec)); S.drivers[id] = {id, ...rec}; }
    byId[t.uuid] = id; byName[norm(t.name)] = id; t.dr = id;
    if(t.p && !plates[norm(t.p)]){ const vid = "v-" + norm(t.p).slice(0, 20); plates[norm(t.p)] = vid; const rec = {plate: t.p, fleetId: "", model: "", investorId: "", active: true, createdFromImport: true}; await writeOk(S.db.doc("vehicles/" + vid).set(rec)); S.vehicles[vid] = {id: vid, ...rec}; }
  }
  const byDay = {}; trips.forEach(t => (byDay[t.d] ||= []).push(t)); let added = 0, dup = 0;
  for(const [day, L] of Object.entries(byDay)){
    const ref = S.db.doc("trips/" + day), snap = await ref.get(), ex = snap.exists ? (snap.data().rows || {}) : {}, merged = {...ex};
    for(const t of L){ if(ex[t.id]){ dup++; continue; } merged[t.id] = {tr: t.tr, d: t.d, t: t.t, dr: t.dr, p: t.p, f: t.f, sf: t.sf, tx: t.tx, tp: t.tp, rf: t.rf, c: t.c, oe: t.oe || 0, po: t.po || 0, km: t.km || 0, pl}; added++; }
    if(!await writeOk(ref.set({date: day, rows: merged}))) throw new Error("could not save the trips");
  }
  const {id: _, ...b} = S.platforms[pl]; await writeOk(S.db.doc("platforms/" + pl).set({...b, sync: {at: new Date().toISOString(), from: iso(from), to: iso(to), added, dup, error: "", via}}));
  return {orders: (j.orders || []).length, kept: rows.length, added, dup};
}

/* "Sync now": asks the sync listener on the office PC to fetch the trips now (settings/syncRequest) */
S.syncReq = S.syncReq || null;
function syncBox(only){
  const r = S.syncReq || {}, alive = r.listener && (Date.now() - new Date(r.listener).getTime()) < 3 * 60000, st = r.status;
  const when = x => x ? new Date(x).toLocaleString("en-GB") : "";
  return `<div class="section" style="padding:10px 14px"><div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
    <div><b>Sync now</b> <span class="small muted">– fetch the trips from the platform APIs${only ? "" : " (and Uber, if ticked)"}${(() => { const px = Object.values(S.platforms).filter(p => p.api && (p.api.direct || p.api.proxyUrl) && (!only || p.id === only)).map(p => p.name || p.id); return px.length ? ` – ${esc(px.join(", "))} straight from here${only ? "" : ", the others"}` : ""; })()}${only && S.platforms[only] && S.platforms[only].api && (S.platforms[only].api.direct || S.platforms[only].api.proxyUrl) ? "" : " through the office PC"}.</span>
      <div class="small" style="margin-top:3px${only && S.platforms[only] && S.platforms[only].api && S.platforms[only].api.direct ? ";display:none" : ""}">Office PC listener: ${alive ? '<span class="pill good">Online</span>' : '<span class="pill bad">Offline</span> <span class="muted">– start "5 - Start sync listener" on the office PC</span>'}
      ${st ? ` · last request ${when(r.at)}: ${st === "done" ? `<span class="pill good">Done</span> ${when(r.doneAt)}` : st === "error" ? '<span class="pill bad">Failed</span>' : st === "running" ? '<span class="pill warn">Running…</span>' : '<span class="pill warn">Waiting for the PC…</span>'}` : ""}</div>
      ${r.log && r.log.length && (st === "done" || st === "error") ? `<div class="small muted" style="margin-top:3px;white-space:pre-line">${esc(r.log.slice(-6).join("\n"))}</div>` : ""}</div>
    <div class="row" style="gap:6px;align-items:center">${only ? "" : `<label class="small"><input type="checkbox" id="syncUber"> Uber too</label>`}<label class="small">Days <input id="syncDays" type="number" min="1" max="62" value="2" style="width:56px"></label>
      <button class="btn primary" data-syncnow="${esc(only || "")}" ${S.canWrite && st !== "waiting" && st !== "running" ? "" : "disabled"}>${st === "waiting" || st === "running" ? "Syncing…" : "Sync now"}</button></div></div></div>`;
}

/* ---------- the page ---------- */
function platformDetail(pl){
  const p = S.platforms[pl] || {id: pl, name: pName(pl)}, tab = PLT_TABS[S.pltTab] ? S.pltTab : "ledger";
  const body = tab === "payouts" ? pltPayoutsTab(pl) : tab === "fees" ? pltFeesTab(pl) : tab === "api" ? syncBox(pl) + pltApiTab(pl) : pltLedgerTab(pl);
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
  if(t.dataset.syncnow != null){ const days0 = Math.max(1, Math.min(62, num(($("#syncDays") || {}).value) || 2)), only = t.dataset.syncnow;
    const direct = Object.values(S.platforms).filter(p => p.api && (p.api.direct || (p.api.proxyUrl && p.api.proxyKey)) && (!only || p.id === only));
    if(direct.length){ t.disabled = true; const lines = [];
      for(const p of direct){ t.textContent = "Fetching " + (p.name || p.id) + "…"; try{ const x = await browserSync(p.id, days0); lines.push(`${p.name || p.id}: ${x.kept} trips, ${x.added} new, ${x.dup} already there`); }catch(e){ lines.push(`${p.name || p.id}: failed – ${e.message}`);
        const q = S.platforms[p.id]; if(q){ const {id: _, ...b} = q; await writeOk(S.db.doc("platforms/" + p.id).set({...b, sync: {at: new Date().toISOString(), from: iso(new Date(Date.now() - days0 * 86400000)), to: iso(new Date()), added: 0, dup: 0, error: e.message, via: b.api && b.api.direct ? "API" : "Apps Script"}})); } } }
      await loadPeriod(); S.ledger = null; toast(lines.join(" · ")); render(); if(only && direct.some(p => p.id === only)) return; }
    const days = days0, uber = !!(($("#syncUber") || {}).checked);
    const prev = S.syncReq || {}; if(await writeOk(S.db.doc("settings/syncRequest").set({...prev, status: "waiting", at: new Date().toISOString(), by: (S.user && (S.user.name || S.user.id)) || "", days, uber, only: t.dataset.syncnow || "", log: []}))) toast(prev.listener && (Date.now() - new Date(prev.listener).getTime()) < 180000 ? "Sync requested – the office PC is fetching the trips." : "Sync requested – it runs when the listener on the office PC is started."); return; }
  if(t.dataset.apitest){ const pl = t.dataset.apitest; t.disabled = true; t.textContent = "Testing…";
    try{ const api = (S.platforms[pl] || {}).api || {}; if(!api.tokenUrl) throw new Error('click "Fill in the API settings" first'); const keys = await loadApiKeys(pl), tok = await apiToken(api, keys), c = await apiCompanies(api, tok);
      toast(`Connected to ${pName(pl)} – ${c.length ? c.length + " company account(s): " + c.join(", ") : "token OK"}.`); }catch(e){ toast("Connection failed – " + e.message); }
    render(); return; }
  if(t.dataset.apikeysdel){ const pl = t.dataset.apikeysdel; if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again"; return; }
    if(await writeOk(S.db.doc("secrets/" + pl).delete())){ S.apiKeys[pl] = {}; const p = S.platforms[pl]; if(p){ const {id, ...b} = p; await writeOk(S.db.doc("platforms/" + id).set({...b, api: {...(b.api || {}), direct: false}})); } toast("API keys removed."); render(); } return; }
  if(t.dataset.apipreset){ const p = S.platforms[t.dataset.apipreset], pr = PLT_PRESETS[t.dataset.apipreset]; if(!p || !pr) return; const {id, ...b} = p;
    if(await writeOk(S.db.doc("platforms/" + id).set({...b, api: {...(p.api || {}), ...pr.api}}))) toast(`${pName(id)} API settings filled in.`); render(); return; }
  if(t.dataset.pladjdel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again"; return; } if(await writeOk(S.db.doc("pladj/" + t.dataset.pladjdel).delete())){ toast("Adjustment deleted."); render(); } return; }
  if(t.dataset.pounmatch){ if(await writeOk(S.db.doc("payouts/" + t.dataset.pounmatch).delete())){ S.poMatch = null; toast("Match removed – the payout is in transit again."); render(); } return; }
  if(t.dataset.feeedit != null){ S.feeEdit = t.dataset.feeedit ? {pl: t.dataset.pl || S.pltView, id: t.dataset.feeedit === "new" ? "" : t.dataset.feeedit} : null; render(); return; }
  if(t.dataset.feedel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again"; return; } if(await writeOk(S.db.doc("feeinv/" + t.dataset.feedel).delete())){ S.feeEdit = null; toast("Fee invoice deleted."); render(); } return; }
});
document.addEventListener("change", ev => { if(ev.target.id === "pltGrp"){ S.pltGroup = ev.target.value; render(); } });
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fPoMatch" && f.id !== "fFeeInv" && f.id !== "fApi" && f.id !== "fApiKeys") return; ev.preventDefault(); if(!S.db) return;
  if(f.id === "fApiKeys"){ const pl = f.dataset.pl, d = Object.fromEntries(new FormData(f).entries()), old = S.apiKeys[pl] || {}, p = S.platforms[pl]; if(!p) return;
    const rec = {clientId: d.clientId.trim(), clientSecret: d.clientSecret.trim() || old.clientSecret || "", at: new Date().toISOString(), by: (S.user && (S.user.name || S.user.id)) || ""};
    if(!rec.clientId || !rec.clientSecret){ toast("Enter the client ID and the client secret."); return; }
    if(!await writeOk(S.db.doc("secrets/" + pl).set(rec))) return; S.apiKeys[pl] = rec;
    const {id, ...b} = p, pr = PLT_PRESETS[pl]; await writeOk(S.db.doc("platforms/" + id).set({...b, api: {...((pr && !(b.api || {}).tokenUrl) ? pr.api : {}), ...(b.api || {}), direct: true}}));
    toast(`${pName(pl)} API keys saved – click "Test connection", then "Sync now".`); render(); return; }
  if(f.id === "fApi"){ const d = Object.fromEntries(new FormData(f).entries()), p = S.platforms[f.dataset.pl]; if(!p) return; const {id, ...b} = p, fields = {};
    Object.keys(d).filter(k => k.startsWith("f_")).forEach(k => { if(d[k].trim()) fields[k.slice(2)] = d[k].trim(); delete d[k]; });
    // anything that looks like a secret is refused – it belongs in the .env file on the office PC
    if(Object.values(d).some(v => /secret|password/i.test(v) && v.length > 20)){ toast("Do not enter secrets here – put them in uber-sync/.env on the office PC."); return; }
    const api = {...d, direct: !!(p.api && p.api.direct), enabled: d.enabled === "true", maxDays: d.maxDays ? num(d.maxDays) : "", pageSize: d.pageSize ? num(d.pageSize) : "", pageStart: d.pageStart ? num(d.pageStart) : "", fields};
    if(api.enabled && (!api.tripsUrl || !fields.date)){ toast("Set at least the URL and the date field before switching the API on."); return; }
    if(await writeOk(S.db.doc("platforms/" + id).set({...b, api}))){ toast(api.enabled ? "Saved – the office sync program will fetch these trips." : "Saved."); render(); } return; }
  const d = Object.fromEntries(new FormData(f).entries()), by = (S.user && (S.user.name || S.user.id)) || "";
  if(f.id === "fPoMatch"){ const id = f.dataset.id;
    if(await writeOk(S.db.doc("payouts/" + id).set({pl: f.dataset.pl, date: f.dataset.date, amount: num(f.dataset.amount), bankDate: d.bankDate, bankAmount: num(d.bankAmount), account: d.account, ref: d.ref || "", by, at: new Date().toISOString()}))){ S.poMatch = null; toast("Payout matched with the bank."); render(); } return; }
  const id = f.dataset.id || "fi-" + uid();
  if(d.from > d.to){ toast("The period must end after it starts."); return; }
  if(await writeOk(S.db.doc("feeinv/" + id).set({...d, pl: f.dataset.pl, fee: num(d.fee), vat: num(d.vat), by, at: new Date().toISOString()}))){ S.feeEdit = null; toast("Fee invoice saved."); render(); }
});
window.PLT = {post: postPlt, confirm: pltConfirm, syncBox};
window.platformDetail = platformDetail;
