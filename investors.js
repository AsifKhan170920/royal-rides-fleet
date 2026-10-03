/* Investor page (Investors → name): Trips summary · Profit & share · Transactions.
   Profit & share works out the investor's share from every car he held in the period (after the management fee and
   the repairs he bears), less the bank instalments recovered from him, = his net profit. Finalising it stores the
   result (collection invpay) and credits the net profit to his Transactions; payments to him (Payout to investor,
   Payments with the investor as "Paid to") are debits and money received from him a credit.
   Positive balance = the company owes the investor. The journal is not changed by finalising: the investor share
   is booked from the trips (5900 / 2200) and the instalment recovery by the finance module. */
S.invView = S.invView || ""; S.invTab = S.invTab || "trips"; S.invpay = S.invpay || {}; S.invGroup = S.invGroup || "week";
const INV_TABS = {trips: "Trips summary", pl: "Profit & share", tx: "Transactions"};

// the investor's cars and figures for the period
function invModel(id){
  const C = compute(), I = C.I[id] || {vs: [], share: 0, emi: 0}, feeVatRec = setting("feeVatRecoverable", false);
  const carEmi = vid => { const rec = S.vehicles[vid]; if(!window.FIN || !rec || !FIN.of(rec) || FIN.owner(rec) !== "investor") return {emi: 0, n: 0};
    const sch = FIN.schedule(rec).filter(x => x.date >= S.from && x.date <= S.to); return {emi: r2(sum(sch, x => x.emi)), n: sch.length, f: FIN.of(rec)}; };
  const cars = I.vs.map(v => { const e = carEmi(v.id); return {id: v.id, name: vName(v.id), terms: v.termsText || "", n: v.n,
    rev: r2(v.fareRev - v.fee - (feeVatRec ? 0 : v.tax) + v.ref), drv: r2(v.drvCost), exp: r2(v.exp), op: r2(v.op), mgmt: r2(v.mgmt), rmInv: r2(v.rmInv || 0), share: r2(v.byInv[id] || 0), emi: e.emi, emiN: e.n, f: e.f}; });
  const share = r2(sum(cars, c => c.share)), emi = r2(sum(cars, c => c.emi));
  return {id, C, cars, share, emi, net: r2(share - emi)};
}
const invFin = id => Object.values(S.invpay).find(p => p.investorId === id && p.from === S.from && p.to === S.to);
const invOverlap = id => Object.values(S.invpay).find(p => p.investorId === id && p.from <= S.to && p.to >= S.from);

/* ---------- Trip summary: trips grouped by day / week / month, per car (car page and investor page) ---------- */
function tripRows(carIds, grp){
  const C = compute(), fareStd = setting("fareVat", "exempt") === "standard", feeVatRec = setting("feeVatRecoverable", false);
  const gk = day => { const k = grp === "day" ? day : grp === "month" ? monthEnd(day.slice(0,7)) : weekEnd(day); return k > S.to ? S.to : k; };
  const rows = {};
  carIds.forEach(cid => {
    const v = C.V[cid]; if(!v) return;
    const n = {}, seen = new Set(); S.trips.forEach(t => { const k = t.tr || t.id; if((t.tr || t.f) && vehicleForTrip(t) === cid && !seen.has(k)){ seen.add(k); n[t.d] = (n[t.d] || 0) + 1; } });
    Object.entries(v.seg).forEach(([day, b]) => { const k = gk(day) + "|" + cid, g = rows[k] ||= {key: gk(day), car: cid, a: day, z: day, n: 0, fare: 0, fee: 0, ref: 0, drv: 0, exp: 0};
      g.fare += fareStd ? b.fare / 1.05 : b.fare; g.fee += b.fee + (feeVatRec ? 0 : b.tax); g.ref += b.ref; g.drv += b.drv; g.exp += b.exp; g.n += n[day] || 0; if(day < g.a) g.a = day; if(day > g.z) g.z = day; });
  });
  return Object.values(rows).map(g => ({...g, op: r2(g.fare - g.fee + g.ref - g.drv - g.exp)})).sort((a, b) => a.key.localeCompare(b.key) || vName(a.car).localeCompare(vName(b.car)));
}
function tripTable(R, pgKey, head, many){
  const per = g => g.a === g.z ? dmyS(g.a) : dmyS(g.a) + " – " + dmyS(g.z), T = k => fmt(sum(R, g => g[k])), cols = many ? 9 : 8;
  return `${head}<div class="tbl"><table><thead><tr><th>Period</th>${many ? "<th>Car</th>" : ""}<th class="num">Trips</th><th class="num">Fares</th><th class="num">Platform fee & VAT</th><th class="num">Tolls recovered</th><th class="num">Driver cost</th><th class="num">Car expenses</th><th class="num">Operating profit</th></tr></thead><tbody>
  ${(R.pg = paged(pgKey, R.slice().reverse())).rows.map(g => `<tr><td>${esc(per(g))}</td>${many ? `<td>${esc(vName(g.car))}</td>` : ""}<td class="num">${g.n}</td><td class="num">${fmt(g.fare)}</td><td class="num">${fmt(-g.fee)}</td><td class="num">${fmt(g.ref)}</td><td class="num">${fmt(-g.drv)}</td><td class="num">${fmt(-g.exp)}</td><td class="num">${aed(g.op)}</td></tr>`).join("") || `<tr><td colspan="${cols}" class="muted">No trips in this period.</td></tr>`}
  </tbody><tfoot><tr><td colspan="${many ? 2 : 1}">Total</td><td class="num">${sum(R, g => g.n)}</td><td class="num">${T("fare")}</td><td class="num">${fmt(-sum(R, g => g.fee))}</td><td class="num">${T("ref")}</td><td class="num">${fmt(-sum(R, g => g.drv))}</td><td class="num">${fmt(-sum(R, g => g.exp))}</td><td class="num"><b>${T("op")}</b></td></tr></tfoot></table></div>${R.pg.bar}`;
}
const tripCsv = (R, many) => [["From","To", ...(many ? ["Car"] : []), "Trips","Fares","Platform fee & VAT","Tolls recovered","Driver cost","Car expenses","Operating profit"],
  ...R.map(g => [g.a, g.z, ...(many ? [vName(g.car)] : []), g.n, r2(g.fare), -r2(g.fee), r2(g.ref), -r2(g.drv), -r2(g.exp), g.op]),
  ["Total", "", ...(many ? [""] : []), sum(R, g => g.n), r2(sum(R, g => g.fare)), -r2(sum(R, g => g.fee)), r2(sum(R, g => g.ref)), -r2(sum(R, g => g.drv)), -r2(sum(R, g => g.exp)), r2(sum(R, g => g.op))]];
const grpSel = (id, val) => `<select id="${id}" aria-label="Group trips">${opts({day: "By day", week: "By week", month: "By month"}, val || "week")}</select>`;
// the car page
function vehTripsTab(id){
  return tripTable(tripRows([id], S.vehGroup || "week"), "vtrips-" + id, `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · newest first</span><div class="row">${dlBtn("vled", id)}${grpSel("vgrp", S.vehGroup)}</div></div>`, false);
}
DL.vled = id => [`trip_summary_${norm(vName(id))}_${S.from}_${S.to}.csv`, tripCsv(tripRows([id], S.vehGroup || "week"), false)];
// the investor page
const invTrips = id => tripRows(invModel(id).cars.map(c => c.id), S.invGroup);
function invTripsTab(id){
  return tripTable(invTrips(id), "invtrips-" + id, `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · his cars' trips · newest first</span><div class="row">${dlBtn("invtrips", id)}${grpSel("igrp", S.invGroup)}</div></div>`, true);
}
DL.invtrips = id => [`investor_trips_${norm(iName(id))}_${S.from}_${S.to}.csv`, tripCsv(invTrips(id), true)];

/* ---------- Profit & share, and its finalisation ---------- */
/* The same statement as the car P&L, for all his cars together: Revenue → Direct costs → Gross profit → Expenses
   (incl. the company's management fee) → Net profit. On "management fee only" terms all of it is his; on a % share
   the company's part is taken off. Then the bank instalments recovered from him → net payable. */
function invStmt(M){
  const R = [], H = label => R.push({k: "h", label}), I = (label, a) => R.push({k: "i", label, a: r2(a)}), T = (label, b, k = "s") => R.push({k, label, b: r2(b)});
  const pl = {}, cat = {}; let ref = 0, drv = 0, mgmt = 0, outVat = 0;
  M.cars.forEach(c => { const P = vehPLModel(c.id);
    Object.entries(P.byPl).forEach(([k, b]) => { const x = pl[k] ||= {f: 0, fee: 0, n: 0}; x.f += b.f; x.fee += b.fee; x.n += b.n; });
    Object.entries(P.byCat).forEach(([k, val]) => cat[k] = (cat[k] || 0) + val);
    ref += P.v.ref; drv += P.v.drvCost; mgmt += P.v.mgmt; if(P.fareStd && P.v.fareRev) outVat += sum(Object.values(P.byPl), b => b.f) - P.v.fareRev; });
  const pls = Object.entries(pl).sort((x, y) => y[1].f - x[1].f), fees = sum(pls, ([, b]) => b.fee), DIRECT = ["5200", "5210"];
  H("Revenue");
  pls.forEach(([k, b]) => I(`${pName(k)} – fares (${b.n} trips)`, b.f));
  if(r2(outVat)) I("Less: output VAT on fares", -outVat);
  if(r2(ref)) I("Tolls & fees recovered", ref);
  const rev = r2(sum(pls, ([, b]) => b.f) - outVat + ref); T("Total revenue", rev);
  H("Direct costs");
  pls.forEach(([k, b]) => { if(r2(b.fee)) I(`${pName(k)} service fee & VAT`, -b.fee); });
  I("Driver cost (earnings share / salary)", -drv);
  let direct = fees + drv; DIRECT.forEach(c => { if(cat[c]){ I(EXP_CATS[c], -cat[c]); direct += cat[c]; } });
  T("Total direct costs", -direct);
  const gross = r2(rev - direct); T("Gross profit", gross);
  H("Expenses");
  let ex = 0; Object.entries(cat).filter(([c]) => !DIRECT.includes(c)).forEach(([c, val]) => { I(EXP_CATS[c] || "Other expenses", -val); ex += val; });
  if(r2(mgmt)){ I("Management fee – company", -mgmt); ex += mgmt; }
  if(!r2(ex)) I("No expenses in this period", 0);
  T("Total expenses", -ex);
  const net = r2(gross - ex);
  if(Math.abs(net - M.share) > 0.01){ T("Net profit of the cars", net); I("Less: company's share of the profit (per the terms)", -(net - M.share)); T("Investor's share", M.share); }
  else T("Net profit – investor's", net);
  if(M.emi){ H("Less: bank instalments recovered"); M.cars.filter(c => c.emi).forEach(c => I(`${c.name} – ${(c.f || {}).bank || "bank"}${(c.f || {}).facility ? " " + c.f.facility : ""} (${c.emiN})`, -c.emi)); }
  T("Net payable to the investor", M.net, "g");
  return R;
}
function invPLTab(id){
  const M = invModel(id), fin = invFin(id), over = !fin && invOverlap(id), changed = fin && Math.abs(num(fin.net) - M.net) > 0.01;
  const tbl = `<div class="tbl"><table><thead><tr><th>Car</th><th>Terms</th><th class="num">Trips</th><th class="num">Net revenue</th><th class="num">Driver cost</th><th class="num">Car expenses</th><th class="num">Operating profit</th><th class="num">Mgmt fee</th><th class="num">Investor's share</th><th class="num">Bank instalment</th></tr></thead><tbody>
    ${M.cars.map(c => `<tr><td><button class="btn sm ghost" data-vehview="${esc(c.id)}" style="padding:2px 6px">${esc(c.name)}</button></td><td class="small" style="white-space:normal;min-width:200px">${esc(c.terms)}</td><td class="num">${c.n}</td><td class="num">${fmt(c.rev)}</td><td class="num">${fmt(-c.drv)}</td><td class="num">${fmt(-c.exp)}</td><td class="num">${aed(c.op)}</td><td class="num">${fmt(c.mgmt)}</td><td class="num"><b>${aed(c.share)}</b></td><td class="num">${c.emi ? fmt(-c.emi) : ""}</td></tr>`).join("") || `<tr><td colspan="10" class="muted">No cars for this investor in the period.</td></tr>`}
    </tbody>${M.cars.length > 1 ? `<tfoot><tr><td colspan="2">Total</td><td class="num">${sum(M.cars, c => c.n)}</td><td class="num">${fmt(sum(M.cars, c => c.rev))}</td><td class="num">${fmt(-sum(M.cars, c => c.drv))}</td><td class="num">${fmt(-sum(M.cars, c => c.exp))}</td><td class="num">${fmt(sum(M.cars, c => c.op))}</td><td class="num">${fmt(sum(M.cars, c => c.mgmt))}</td><td class="num">${fmt(M.share)}</td><td class="num">${fmt(-M.emi)}</td></tr></tfoot>` : ""}</table></div>`;
  const status = fin ? `<div class="banner ${changed ? "" : "info"}">Finalised for ${esc(dmyS(fin.from))} – ${esc(dmyS(fin.to))}: net profit AED ${fmt(fin.net)} credited to Transactions${fin.by ? " · by " + esc(fin.by) : ""}${fin.at ? " on " + esc(dmyS(fin.at.slice(0,10))) : ""}.${changed ? ` <b>The figures have changed since (now ${fmt(M.net)})</b> – reopen and finalise again to update.` : ""}</div>`
    : over ? `<div class="banner">Part of this period is already finalised (${esc(dmyS(over.from))} – ${esc(dmyS(over.to))}). Choose the same dates at the top to see it.</div>` : "";
  return `${status}<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · share after the management fee and any repairs he bears</span>
    <div class="row">${dlBtn("invpl", id)}<button class="btn sm" data-invprint="${esc(id)}">Print / PDF</button>${fin ? `<button class="btn sm danger" data-invreopen="${esc(fin.id)}">Reopen</button>` : over ? "" : `<button class="btn sm primary" data-invfin="${esc(id)}" ${S.canWrite && M.cars.length ? "" : "disabled"}>Finalise ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</button>`}</div></div>
  <style>${VPL_CSS}</style><div class="tbl" style="max-width:760px;padding:6px 4px"><div style="text-align:center;margin:6px 0 2px"><b>${esc(iName(id))} – Profit & loss statement</b><div class="small muted">For the period ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</div></div>${stmtTable(invStmt(M))}</div>
  <h3 style="margin:16px 0 6px">By car</h3>${tbl}
  <p class="small muted" style="margin-top:6px">Finalising credits the net profit to his Transactions. A finalised period can be reopened (here or from Transactions) and finalised again.</p>`;
}
DL.invpl = id => { const M = invModel(id);
  if(window.__fmt === "pdf"){ printInvPL(id); return null; }
  return [`investor_profit_${norm(iName(id))}_${S.from}_${S.to}.csv`, [[`${iName(id)} – Profit & loss statement, ${dmyS(S.from)} to ${dmyS(S.to)}`, "AED"],
    ...invStmt(M).map(r => r.k === "h" ? [r.label.toUpperCase(), ""] : r.k === "i" ? ["   " + r.label, r.a] : [r.label, r.b]), ["", ""], ["BY CAR", ""],
    ...M.cars.map(c => ["   " + c.name + " – " + c.terms + " – " + c.n + " trips – operating profit " + fmt(c.op) + " – management fee " + fmt(c.mgmt), c.share])]];
};
async function invFinalise(id){
  if(invOverlap(id)){ toast("Part of this period is already finalised."); return; }
  const M = invModel(id), by = (S.user && (S.user.name || S.user.id)) || "";
  const rec = {investorId: id, from: S.from, to: S.to, share: M.share, emi: M.emi, net: M.net, by, at: new Date().toISOString(),
    cars: M.cars.map(c => ({id: c.id, n: c.n, op: c.op, mgmt: c.mgmt, share: c.share, emi: c.emi, terms: c.terms}))};
  if(await writeOk(S.db.doc("invpay/" + id + "_" + S.from).set(rec))) toast(`Finalised: net profit AED ${fmt(M.net)} credited to ${iName(id)}.`);
}
const INV_PCSS = () => `${SAL_CSS}${VPL_CSS}.sp .vbox{border:1px solid #c5c9d2;padding:4px 6px 8px;margin-top:10px}.sp .vst{font-size:10pt}.sp .vst td{border:0}`;
function invPrintHtml(id){
  const M = invModel(id), s = S.settings, co = s.company || "Royal Rides Limousine LLC", x = S.investors[id] || {}, addr = [s.address, s.trn ? "TRN " + s.trn : ""].filter(Boolean).join(" · "), fin = invFin(id);
  const html = `<div class="sp"><div class="hd"><div class="co">${typeof coLogo === "function" ? coLogo() : ""}${esc(co)}${addr ? `<small>${esc(addr)}</small>` : ""}</div><div class="ttl"><b>INVESTOR PROFIT & LOSS</b><span>${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · amounts in AED</span></div></div>
    <table class="info"><tr><td class="l">Investor</td><td><b>${esc(x.name || "")}</b></td><td class="l">Phone</td><td>${esc(x.phone || "—")}</td></tr><tr><td class="l">Cars</td><td>${esc(M.cars.map(c => c.name).join(", ") || "—")}</td><td class="l">Status</td><td>${fin ? "Finalised " + esc(dmyS(fin.at.slice(0,10))) : "Not finalised"}</td></tr></table>
    <table class="perf"><tr><th>Car</th><th>Trips</th><th>Net revenue</th><th>Driver cost</th><th>Car expenses</th><th>Operating profit</th><th>Mgmt fee</th><th>Share</th></tr>${M.cars.map(c => `<tr><td>${esc(c.name)}</td><td>${c.n}</td><td>${fmt(c.rev)}</td><td>${fmt(-c.drv)}</td><td>${fmt(-c.exp)}</td><td>${fmt(c.op)}</td><td>${fmt(c.mgmt)}</td><td><b>${fmt(c.share)}</b></td></tr>`).join("")}</table>
    <div class="vbox">${stmtTable(invStmt(M))}</div>
    <div class="sigs"><div><div class="who">Investor</div><div class="line"></div><div>${esc(x.name || "")}</div><div class="cap">Signature & date</div></div><div><div class="who">For ${esc(co)}</div><div class="line"></div><div>${esc(s.signatory || "")}${s.signatoryTitle ? (s.signatory ? ", " : "") + esc(s.signatoryTitle) : ""}</div><div class="cap">Authorised signatory</div></div></div></div>`;
  return html;
}
async function printInvPL(id){
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  const x = S.investors[id] || {}, box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff";
  box.innerHTML = `<style>${INV_PCSS()}</style>${invPrintHtml(id)}`; document.body.appendChild(box);
  const name = `Investor_profit_${norm(x.name || id)}_${S.from}_${S.to}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.97}, html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}, pagebreak: {mode: ["css", "legacy"], avoid: ["table", ".sigs"]}}).from(box.querySelector(".sp")).save(); toast("Downloaded " + name); }
  catch(e){ toast("Could not make the PDF. Try again."); }
  box.remove();
}

/* ---------- Transactions: finalised net profit, payments and receipts only ---------- */
function invTx(id){
  const x = S.investors[id] || {}, ents = (S.ledger && S.ledger.entries) || [], lines = [];
  Object.values(S.invpay).filter(p => p.investorId === id && p.to <= S.to).forEach(p => {
    const v = num(p.net);
    lines.push({ref: {kind: "invpay", id: p.id, from: p.from, to: p.to}, date: p.to, desc: `Net profit ${dmyS(p.from)} – ${dmyS(p.to)} (finalised · share ${fmt(p.share)}${num(p.emi) ? " − instalments " + fmt(p.emi) : ""})`, ...(v >= 0 ? {cr: v} : {dr: -v}), fin: true});
  });
  ents.filter(e => e.investorId === id && (e.type === "investor_payout" || e.type === "investor_receipt")).forEach(e => {
    const ref = {kind: "entry", id: e.id, date: e.date}, n = e.note ? " – " + e.note : "";
    lines.push(e.type === "investor_payout" ? {ref, date: e.date, desc: "Payment to investor" + n, dr: num(e.amount)} : {ref, date: e.date, desc: "Received from investor" + n, cr: num(e.amount)});
  });
  if(window.BOOKS) BOOKS.partyMoves(ents, "i:" + id, "2200").forEach(m => lines.push({ref: m.e ? {kind: "doc", id: m.e.id, date: m.e.date, type: m.e.type} : null, date: m.date, desc: m.desc, ...(m.dr ? {dr: m.dr} : {}), ...(m.cr ? {cr: m.cr} : {})}));
  lines.sort((a, b) => a.date.localeCompare(b.date) || (a.fin ? 1 : 0) - (b.fin ? 1 : 0));
  let bal = num(x.openingBalance), before = bal; const open = bal, shown = [];
  lines.forEach(l => { bal = r2(bal + (l.cr || 0) - (l.dr || 0)); l.bal = bal; if(l.date < S.from) before = bal; else shown.push(l); });
  return {open, before, shown, closing: bal};
}
const invActions = ref => !ref ? "" : ref.kind === "invpay" ? `<div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-invfinview="${esc(JSON.stringify(ref))}">View</button><button class="btn sm danger" data-invreopen="${esc(ref.id)}">Reopen</button></div>` : (window.txActions ? txActions(ref) : "");
function invTxTab(id){
  const wait = needHistory(); if(wait) return wait;
  const T = invTx(id), start = setting("ledgerStart", "2026-09-01"), M = invModel(id), fin = invOverlap(id);
  return `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">His account from ${esc(dmyS(start))}: a finalised net profit is a credit; payments to him are debits and money received from him a credit. Positive balance = the company owes the investor. Newest first.</span>
    <div class="row">${dlBtn("invtx", id)}<button class="btn sm" data-payinv="${esc(id)}" data-amt="${Math.max(0, T.closing)}">Pay investor</button><button class="btn sm" data-recvinv="${esc(id)}">Receive from investor</button></div></div>
  ${!fin && M.cars.length ? `<div class="banner">The profit for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))} is not finalised yet (net AED ${fmt(M.net)} so far), so it is not in this account. <button class="btn sm" data-invtab="pl">Open Profit & share</button></div>` : ""}
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th><th></th></tr></thead><tbody>
  ${(T.pg = paged("invtx-" + id, T.shown.slice().reverse())).rows.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${l.fin ? "<b>" + esc(l.desc) + "</b>" : esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td><td>${invActions(l.ref)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No finalised profit, payment or receipt in this period.</td></tr>`}
  ${T.pg.last ? `<tr><td>${esc(dmyS(S.from < start ? start : S.from))}</td><td><b>${S.from <= start ? "Opening balance" : "Balance brought forward"}</b></td><td></td><td></td><td class="num"><b>${aed(S.from <= start ? T.open : T.before)}</b></td><td></td></tr>` : ""}
  </tbody><tfoot><tr><td colspan="2">Balance ${esc(dmyS(S.to))} – ${T.closing >= 0 ? "payable to the investor" : "the investor owes the company"}</td><td class="num">${fmt(sum(T.shown, l => l.dr))}</td><td class="num">${fmt(sum(T.shown, l => l.cr))}</td><td class="num"><b>${aed(T.closing)}</b></td><td></td></tr></tfoot></table></div>${T.pg.bar}`;
}
DL.invtx = id => { const T = invTx(id); return [`investor_account_${norm(iName(id))}_${S.from}_${S.to}.csv`, [["Date","Description","Debit","Credit","Balance"], [S.from, "Balance brought forward", "", "", r2(T.before)], ...T.shown.map(l => [l.date, l.desc, l.dr ? r2(l.dr) : "", l.cr ? r2(l.cr) : "", r2(l.bal)])]]; };

/* ---------- the page ---------- */
function investorDetail(id){
  const x = S.investors[id] || {}, tab = INV_TABS[S.invTab] ? S.invTab : "trips", M = invModel(id);
  const body = tab === "pl" ? invPLTab(id) : tab === "tx" ? invTxTab(id) : invTripsTab(id);
  const bal = historyReady() ? invTx(id).closing : null;
  return `<div class="section"><div class="head"><div><h2>${esc(x.name || "Investor")}</h2><p class="sub">${esc([x.phone, x.email].filter(Boolean).join(" · ") || "")}${x.bank ? " · " + esc(x.bank) : ""}</p>
    <p class="sub">Cars: <b>${esc(M.cars.map(c => c.name).join(", ") || Object.values(S.vehicles).filter(v => v.investorId === id).map(v => vName(v.id)).join(", ") || "none")}</b>${bal != null ? ` · Balance <b class="${bal < 0 ? "neg" : ""}">${fmt(bal)}</b> ${bal >= 0 ? "payable to him" : "owed by him"}` : ""}</p></div>
    <div class="row"><button class="btn ghost" data-back="1">← Back</button><button class="btn" data-edit="investor" data-id="${esc(id)}">Edit investor</button><button class="btn" data-agreefor="${esc(id)}">Agreement</button></div></div>
  ${tabBtns("data-invtab", tab, INV_TABS)}${body}</div>`;
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.invview != null){ S.invView = t.dataset.invview; S.edit = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.invtab){ S.invTab = t.dataset.invtab; render(); return; }
  if(t.dataset.invprint){ printInvPL(t.dataset.invprint); return; }
  if(t.dataset.invfin){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to finalise"; return; } t.disabled = true; await invFinalise(t.dataset.invfin); render(); return; }
  if(t.dataset.invreopen){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to reopen"; return; } if(await writeOk(S.db.doc("invpay/" + t.dataset.invreopen).delete())) toast("Reopened – the finalised profit is removed from Transactions."); render(); return; }
  if(t.dataset.invfinview){ const r = JSON.parse(t.dataset.invfinview); S.invTab = "pl"; S.from = r.from; S.to = r.to; $("#pFrom").value = r.from; $("#pTo").value = r.to; $("#preset").value = "custom"; await loadPeriod(); render(); window.scrollTo(0,0); return; }
  if(t.dataset.payinv || t.dataset.recvinv){ const k = t.dataset.payinv ? "payment" : "receipt", id = t.dataset.payinv || t.dataset.recvinv; S.view = k === "payment" ? "payments" : "receipts"; S.invView = ""; if(window.BOOKS) BOOKS.newInvestorDoc(k, id, num(t.dataset.amt)); render(); window.scrollTo(0,0); return; }
});
document.addEventListener("change", ev => { if(ev.target.id === "igrp"){ S.invGroup = ev.target.value; render(); } });
/* ---------- bulk: finalise every investor's profit for the period; download the finalised statements ---------- */
S.invBulk = S.invBulk || null;
function invBulkRows(){
  return Object.values(S.investors).map(x => { const M = invModel(x.id), fin = invFin(x.id), over = !fin && invOverlap(x.id);
    return {id: x.id, name: x.name || x.id, cars: M.cars.map(c => c.name).join(", "), share: M.share, emi: M.emi, net: M.net, fin: fin || over,
      status: fin ? "done" : over ? "overlap" : !M.cars.length ? "empty" : "ready"}; }).sort((a, b) => a.name.localeCompare(b.name));
}
const IB_STATUS = {ready: ["warn", "Ready"], done: ["good", "Finalised"], overlap: ["good", "Part finalised"], empty: ["", "No cars"]};
const invBulkRecs = () => { const b = S.invBulk || {}; return Object.values(S.invpay).filter(p => p.at && p.at.slice(0,10) >= b.from && p.at.slice(0,10) <= b.to).sort((a, c) => iName(a.investorId).localeCompare(iName(c.investorId)) || a.from.localeCompare(c.from)); };
function invBulkPanel(){
  const b = S.invBulk; if(!b) return "";
  const off = new Set(b.off || []);
  if(b.mode === "fin"){
    const rows = invBulkRows(), ready = rows.filter(r => r.status === "ready"), on = ready.filter(r => !off.has(r.id));
    return `<div class="section"><div class="head"><div><h2>Bulk profit finalisation · ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</h2><p class="sub">Change the period at the top to finalise another period. Each investor's net profit is credited to his Transactions, as from his own page.</p></div><button class="btn ghost" data-ibclose="1">Close</button></div>
    <div class="tbl"><table><thead><tr><th><input type="checkbox" data-iball="1" ${on.length && on.length === ready.length ? "checked" : ""} aria-label="All ready"></th><th>Investor</th><th>Cars</th><th class="num">Share of profit</th><th class="num">Bank instalments</th><th class="num">Net profit</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r => { const [cls, lbl] = IB_STATUS[r.status]; return `<tr><td>${r.status === "ready" ? `<input type="checkbox" data-ibone="${esc(r.id)}" ${off.has(r.id) ? "" : "checked"} aria-label="Finalise">` : ""}</td><td><button class="btn sm ghost" data-invview="${esc(r.id)}" style="padding:2px 6px">${esc(r.name)}</button></td><td class="small" style="white-space:normal">${esc(r.cars || "—")}</td><td class="num">${fmt(r.share)}</td><td class="num">${r.emi ? fmt(-r.emi) : ""}</td><td class="num"><b>${aed(r.net)}</b></td><td><span class="pill ${cls}">${lbl}</span>${r.fin ? ` <span class="small muted">${esc(dmyS(r.fin.from))}–${esc(dmyS(r.fin.to))}</span>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">No investors yet.</td></tr>`}
    </tbody><tfoot><tr><td></td><td colspan="4">${on.length} of ${ready.length} ready investors selected</td><td class="num"><b>${fmt(sum(on, r => r.net))}</b></td><td></td></tr></tfoot></table></div>
    <div class="row" style="margin-top:10px;gap:10px"><button class="btn primary" data-ibgo="1" ${on.length && S.canWrite ? "" : "disabled"}>Finalise ${on.length} investor${on.length === 1 ? "" : "s"} for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</button>${dlBtn("invbulkfin")}</div>
    <p class="small muted" style="margin-top:6px">A finalised profit can be reopened from the investor's page (Profit & share or Transactions).</p></div>`;
  }
  const recs = invBulkRecs(), on = recs.filter(p => !off.has(p.id));
  return `<div class="section"><div class="head"><div><h2>Bulk profit & loss statements</h2><p class="sub">Profits finalised between the dates below – one PDF with each investor's statement on its own page, ready to print and sign.</p></div><button class="btn ghost" data-ibclose="1">Close</button></div>
  <div class="form" style="grid-template-columns:repeat(auto-fit,minmax(160px,220px))"><div class="f"><label for="ibF">Finalised from</label><input id="ibF" type="date" value="${esc(b.from)}"></div><div class="f"><label for="ibT">Finalised to</label><input id="ibT" type="date" value="${esc(b.to)}"></div></div>
  ${recs.length ? `<div class="tbl" style="margin-top:10px"><table><thead><tr><th><input type="checkbox" data-iball="1" ${on.length === recs.length ? "checked" : ""} aria-label="All"></th><th>Investor</th><th>Period</th><th class="num">Share of profit</th><th class="num">Bank instalments</th><th class="num">Net profit</th><th>Finalised</th></tr></thead><tbody>
    ${recs.map(p => `<tr><td><input type="checkbox" data-ibone="${esc(p.id)}" ${off.has(p.id) ? "" : "checked"} aria-label="Include"></td><td>${esc(iName(p.investorId))}</td><td>${esc(dmyS(p.from))} – ${esc(dmyS(p.to))}</td><td class="num">${fmt(num(p.share))}</td><td class="num">${num(p.emi) ? fmt(-num(p.emi)) : ""}</td><td class="num"><b>${aed(num(p.net))}</b></td><td class="small muted">${esc(dmyS(p.at.slice(0,10)))}${p.by ? " · " + esc(p.by) : ""}</td></tr>`).join("")}
    </tbody><tfoot><tr><td></td><td colspan="4">${on.length} of ${recs.length} selected</td><td class="num">${fmt(sum(on, p => num(p.net)))}</td><td></td></tr></tfoot></table></div>
    <div class="row" style="margin-top:10px;gap:10px"><button class="btn primary" data-ibpdf="1" ${on.length ? "" : "disabled"}>Download statements PDF (${on.length})</button>${dlBtn("invbulkpl")}</div>`
  : `<p class="sub" style="margin-top:10px">No investor profit was finalised between these dates.</p>`}</div>`;
}
DL.invbulkfin = () => [`investor_profits_${S.from}_${S.to}.csv`, [["Investor","Cars","Share of profit","Bank instalments","Net profit","Status"], ...invBulkRows().map(r => [r.name, r.cars, r.share, -r.emi, r.net, IB_STATUS[r.status][1]])]];
DL.invbulkpl = () => { const off = new Set((S.invBulk || {}).off || []);
  return [`investor_profits_finalised_${S.invBulk.from}_${S.invBulk.to}.csv`, [["Investor","Period from","Period to","Share of profit","Bank instalments","Net profit","Finalised on","Finalised by"],
    ...invBulkRecs().filter(p => !off.has(p.id)).map(p => [iName(p.investorId), p.from, p.to, r2(num(p.share)), -r2(num(p.emi)), r2(num(p.net)), p.at.slice(0,10), p.by || ""])]]; };
async function invBulkFinalise(){
  const off = new Set(S.invBulk.off || []), list = invBulkRows().filter(r => r.status === "ready" && !off.has(r.id)); let n = 0;
  for(const r of list){ toast(`Finalising ${++n} of ${list.length} – ${r.name}…`); await invFinalise(r.id); }
  toast(`${n} investor profit${n === 1 ? "" : "s"} finalised for ${dmyS(S.from)} – ${dmyS(S.to)}.`); render();
}
async function invBulkPdf(){
  const off = new Set(S.invBulk.off || []), recs = invBulkRecs().filter(p => !off.has(p.id)); if(!recs.length) return;
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  try{ if(!window.jspdf) await loadJs("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"); }catch(e){ toast("The PDF tool could not load – check the internet connection."); return; }
  const keep = {from: S.from, to: S.to, preset: $("#preset").value}, doc = new window.jspdf.jsPDF({unit: "mm", format: "a4", compress: true}); let pages = 0;
  const groups = {}; recs.forEach(p => (groups[p.from + "|" + p.to] ||= []).push(p));
  try{
    for(const [key, list] of Object.entries(groups)){
      const [a, b] = key.split("|"); S.from = a; S.to = b; await loadPeriod();   // each statement for its own period
      for(const p of list){
        toast(`Making statement ${pages + 1} of ${recs.length} – ${iName(p.investorId)}…`);
        const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff";
        box.innerHTML = `<style>${INV_PCSS()}</style>${invPrintHtml(p.investorId)}`; document.body.appendChild(box);
        const canvas = await html2pdf().set({html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff"}}).from(box.querySelector(".sp")).toCanvas().get("canvas");
        box.remove();
        const h = Math.min(297, 210 * canvas.height / canvas.width), w = h < 297 ? 210 : 297 * canvas.width / canvas.height;
        if(pages) doc.addPage(); doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (210 - w) / 2, 0, w, h); pages++;
      }
    }
    doc.save(`Investor_PL_statements_finalised_${S.invBulk.from}_${S.invBulk.to}.pdf`); toast(`Downloaded ${pages} investor statements.`);
  }catch(e){ console.warn(e); toast("Could not make the PDF. Try again."); }
  S.from = keep.from; S.to = keep.to; $("#pFrom").value = keep.from; $("#pTo").value = keep.to; $("#preset").value = keep.preset; await loadPeriod(); render();
}
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.ibopen){ const today = iso(new Date()); S.invBulk = t.dataset.ibopen === "fin" ? {mode: "fin", off: []} : {mode: "pdf", from: today.slice(0,8) + "01", to: today, off: []}; S.invView = ""; render(); window.scrollTo(0,0); return; }
  if(t.dataset.ibclose){ S.invBulk = null; render(); return; }
  if(t.dataset.ibgo){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to finalise"; return; } t.disabled = true; t.textContent = "Finalising…"; await invBulkFinalise(); return; }
  if(t.dataset.ibpdf){ t.disabled = true; t.textContent = "Making the PDF…"; await invBulkPdf(); return; }
});
document.addEventListener("change", ev => {
  const t = ev.target, b = S.invBulk; if(!b) return;
  if(t.id === "ibF" || t.id === "ibT"){ b[t.id === "ibF" ? "from" : "to"] = t.value; b.off = []; render(); return; }
  if(t.dataset && t.dataset.ibone){ const off = new Set(b.off || []); t.checked ? off.delete(t.dataset.ibone) : off.add(t.dataset.ibone); b.off = [...off]; render(); return; }
  if(t.dataset && t.dataset.iball){ b.off = t.checked ? [] : b.mode === "fin" ? invBulkRows().filter(r => r.status === "ready").map(r => r.id) : invBulkRecs().map(p => p.id); render(); }
});
window.invBulkPanel = invBulkPanel;
window.investorDetail = investorDetail; window.vehTripsTab = vehTripsTab; window.tripRows = tripRows;
