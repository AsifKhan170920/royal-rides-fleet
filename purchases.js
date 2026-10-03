/* Purchases & expenses (menu Money → Purchases & expenses; it was "Expenses & payments").
   Tabs: All entries (every expense and payment, the form) · Purchases (other purchases: repairs, parts, office…)
   · Fuel · Salik · EV charging (each imported from the statement downloaded from its portal) · Receipts.
   Importing a statement (Excel / CSV): the columns are recognised (date, time, plate, amount, VAT, litres / kWh,
   station / gate, transaction no.) and can be changed; each row is matched to the car by plate and to the driver
   who had the car that day; rows already imported (same transaction no.) are skipped. Salik can be grouped per car
   and day. Each row becomes an expense (5200 fuel & EV, 5210 Salik) with its car and driver – so it lands in the
   car's P&L and, when "recover from driver" is chosen, is deducted in the driver's salary.
   Prepaid accounts: Fuel, Salik and EV charging are topped up in advance – a top-up is a Payment to the supplier
   (Dr 2000 supplier / Cr bank, an advance). The statement uploaded from the portal is the consumption: it is saved
   as a Purchase invoice from that supplier (one per month; Dr fuel / Salik expense, Cr 2000 supplier), which uses up
   the advance. Each invoice line keeps its car, driver and "recover from driver", so the car's P&L and the driver's
   salary see it like any other expense (PUR.expand turns the lines into expense rows when the period loads).
   Without a supplier the rows are booked as paid directly from the chosen account.
   Receipts: a photo or PDF can be attached to any expense (stored compressed with the data, up to ~900 KB). */
// imported invoice lines as expense rows (car P&L, driver recovery, the tabs); the invoice is posted by the books
function expandInv(ents){
  const out = [];
  ents.filter(e => e.type === "purchase_invoice" && (e.lines || []).some(l => l.sub || l.vehicleId)).forEach(e => (e.lines || []).forEach((l, i) => {
    if(!l.sub && !l.vehicleId) return;
    const net = r2(num(l.qty === "" || l.qty == null ? 1 : l.qty) * num(l.price)), vat = l.vat === "5" ? r2(net * 0.05) : 0;   // as the books post it
    out.push({id: e.id + ":" + i, virtual: true, docId: e.id, type: "expense", date: l.date || e.date, category: l.account || "5310", sub: l.sub || "", amount: net, vat, vehicleId: l.vehicleId || "", driverId: l.driverId || "", recover: !!l.recover, qty: num(l.units), srcRef: l.srcRef || "", note: l.desc || "", paidFrom: "inv", party: e.party});
  }));
  return out;
}
const supKey = src => "purSup_" + src;
const supOf = src => { const id = setting(supKey(src), ""); return id && S.suppliers[id] ? id : ""; };
const SUP_NAME = {fuel: "ENOC (fuel)", salik: "Salik", ev: "EV charging"};
S.purTab = S.purTab || "all"; S.purImp = S.purImp || null; S.rcpt = S.rcpt || {};
const PUR_TABS = {all: "All entries", purchase: "Purchases", invoices: "Purchase invoices", fuel: "Fuel", salik: "Salik", ev: "EV charging", receipts: "Receipts"};
const PUR_SRC = {fuel: {cat: "5200", sub: "fuel", label: "Fuel", unit: "Litres", hint: "ENOC / ADNOC / Emarat fleet card portal – transactions report"},
  salik: {cat: "5210", sub: "salik", label: "Salik", unit: "Trips", hint: "Salik business account – trips / statement export"},
  ev: {cat: "5200", sub: "ev", label: "EV charging", unit: "kWh", hint: "DEWA EV Green Charger / Tesla / other charging portal – sessions report"}};
const entSub = e => e.sub || (e.category === "5210" ? "salik" : e.category === "5200" ? "fuel" : "");
const expEntries = () => S.entries.filter(e => e.type === "expense");

/* ---------- receipts ---------- */
async function attachReceipt(entryId, file){
  if(!S.db) return;
  let data, type = file.type || "";
  if(type.startsWith("image/")){
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); data = c.toDataURL("image/jpeg", 0.72); type = "image/jpeg";
  } else {
    if(file.size > 900 * 1024){ toast("This PDF is larger than 900 KB – scan it smaller or attach a photo instead."); return; }
    data = await new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); });
  }
  if(data.length > 1300000){ toast("The file is too large to attach – use a smaller photo or PDF."); return; }
  const meta = {entryId, name: file.name, type, size: Math.round(data.length * 0.75), at: new Date().toISOString(), by: (S.user && (S.user.name || S.user.id)) || ""};
  if(await writeOk(S.db.doc("receipts/" + entryId).set({...meta, data})) && await writeOk(S.db.doc("rcptmeta/" + entryId).set(meta))) toast("Receipt attached.");
  render();
}
async function openReceipt(entryId){
  const snap = await S.db.doc("receipts/" + entryId).get(); if(!snap.exists){ toast("Receipt not found."); return; }
  const r = snap.data(), bin = atob(r.data.split(",")[1]), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  window.open(URL.createObjectURL(new Blob([u], {type: r.type || "application/octet-stream"})), "_blank", "noopener");
}
const rcptCell = e => S.rcpt[e.id] ? `<button class="btn sm" data-rcptopen="${esc(e.id)}" title="${esc(S.rcpt[e.id].name || "")}">View</button>` : `<label class="btn sm ghost" style="cursor:pointer">Attach<input type="file" accept="image/*,.pdf" data-rcptadd="${esc(e.id)}" hidden></label>`;

/* ---------- statement import ---------- */
function impGuess(keys, src){
  const pick = (...w) => { for(const x of w){ const k = keys.find(k => norm(k).includes(x)); if(k) return k; } return ""; }   // the first word in the list wins ("total amount" before "amount")
  return {txn: pick("transactionid", "transactionno", "transid", "referenceno", "receiptno", "tripid", "sessionid", "invoiceno", "reference"), date: pick("transactiondate", "tripdate", "date", "starttime"), time: pick("time"),
    plate: pick("plate", "vehicleno", "vehicle", "registration"), amount: pick("totalamount", "amountincl", "grossamount", "total", "amount", "charge", "fare", "cost", "value"), vat: pick("vat", "tax"),
    qty: src === "fuel" ? pick("litre", "liter", "volume", "quantity", "qty") : src === "ev" ? pick("kwh", "energy", "consumption") : "", place: pick("station", "site", "location", "gate", "charger", "merchant", "toll")};
}
async function readSheet(file){
  if(!window.XLSX){ toast("The Excel tool is still loading – try again in a moment."); return null; }
  const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true});
  // the header row may not be the first: take the first row that has a date-like and an amount-like header
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, defval: "", raw: false});
  let h = aoa.findIndex(r => r.some(c => /date/i.test(c)) && r.some(c => /amount|total|charge|fare|value|cost/i.test(c))); if(h < 0) h = 0;
  const head = aoa[h].map((c, i) => String(c || "").trim() || "Column " + (i + 1));
  return aoa.slice(h + 1).filter(r => r.some(c => String(c).trim())).map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}
const toIsoD = s => { s = String(s || "").trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if(m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -](\d{2,4})/); if(m){ const mo = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3 + 1; if(mo > 0) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`; } const d = new Date(s); return isNaN(d) ? "" : iso(d); };
const plateMap = () => { const m = {}; Object.values(S.vehicles).forEach(v => { const p = norm(v.plate); m[p] = v.id; m[p.replace(/^[a-z]+/, "")] = v.id; m[p.replace(/\D/g, "")] = m[p.replace(/\D/g, "")] || v.id; }); return m; };
function impRows(){
  const I = S.purImp, M = I.map, pm = plateMap(), seen = new Set(); (((S.ledger && S.ledger.entries) || S.entries)).forEach(e => { if(e.srcRef) seen.add(e.srcRef); (e.srcRefs || []).forEach(x => seen.add(x)); (e.lines || []).forEach(l => { if(l.srcRef) seen.add(l.srcRef); (l.srcRefs || []).forEach(x => seen.add(x)); }); });
  const out = I.rows.map((r, i) => {
    const date = toIsoD(r[M.date]), p = norm(r[M.plate]), vid = pm[p] || pm[p.replace(/^[a-z]+/, "")] || pm[p.replace(/\D/g, "")] || "";
    let gross = num(String(r[M.amount]).replace(/[^\d.-]/g, "")), vat = M.vat ? num(String(r[M.vat]).replace(/[^\d.-]/g, "")) : 0;
    if(!M.vat && I.vatMode === "incl"){ vat = r2(gross - gross / 1.05); }
    if(M.vat && I.vatMode === "excl") gross = gross + vat;   // amount column is before VAT
    const net = r2(gross - (I.vatMode === "none" ? 0 : vat));
    const ref = M.txn && String(r[M.txn]).trim() ? I.src + ":" + norm(r[M.txn]) : I.src + ":" + norm([date, r[M.time], p, gross, r[M.place]].join("|"));
    const time = M.time ? String(r[M.time]).trim() : "", who = vid && window.driverAt ? driverAt(vid, date, time) : {id: "", how: ""};
    return {i, date, time, plate: r[M.plate], vid, drv: who.id, how: who.how, net, vat: I.vatMode === "none" ? 0 : r2(vat), qty: M.qty ? num(r[M.qty]) : 0, place: M.place ? String(r[M.place]).trim() : "", ref, dup: seen.has(ref), ok: !!date && !!gross};
  });
  return out;
}
function impPanel(src){
  const I = S.purImp; if(!I || I.src !== src) return `<div class="row" style="gap:8px;align-items:center;margin-bottom:10px"><label class="btn primary" style="cursor:pointer">Import ${esc(PUR_SRC[src].label)} statement<input type="file" accept=".xlsx,.xls,.csv" data-purimp="${src}" hidden></label><span class="small muted">${esc(PUR_SRC[src].hint)} (Excel or CSV).</span></div>`;
  const keys = Object.keys(I.rows[0] || {}), R = impRows(), use = R.filter(r => r.ok && !r.dup), noCar = use.filter(r => !r.vid).length;
  const sel = (f, l) => `<div class="f"><label>${l}</label><select data-impmap="${f}">${opts(Object.fromEntries(keys.map(k => [k, k])), I.map[f], "— none —")}</select></div>`;
  const groups = I.group ? Object.values(use.reduce((g, r) => { const k = r.vid + "|" + r.date + "|" + r.drv; (g[k] ||= {...r, net: 0, vat: 0, qty: 0, n: 0}); g[k].net += r.net; g[k].vat += r.vat; g[k].qty += r.qty; g[k].n++; return g; }, {})) : use;
  return `<div class="section" style="border:1px solid var(--line)"><div class="head"><div><h3 style="margin:0">Import ${esc(PUR_SRC[src].label)} – ${esc(I.name)}</h3><p class="sub">${R.length} rows · ${use.length} new · ${R.filter(r => r.dup).length} already imported · ${R.filter(r => !r.ok).length} without date / amount${noCar ? ` · <b class="neg">${noCar} without a matching car</b>` : ""}</p></div><button class="btn ghost" data-impcancel="1">Cancel</button></div>
    <div class="form" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${sel("date", "Date")}${sel("time", "Time")}${sel("plate", "Plate")}${sel("amount", "Amount")}${sel("vat", "VAT")}${sel("qty", PUR_SRC[src].unit)}${sel("place", src === "salik" ? "Gate" : "Station / location")}${sel("txn", "Transaction no.")}
      <div class="f"><label>Amounts</label><select data-impopt="vatMode">${opts({incl: "Include 5% VAT", excl: "Are before VAT (VAT column added)", none: "No VAT"}, I.vatMode)}</select></div>
      <div class="f"><label>Supplier (prepaid account)</label><select data-impopt="supplier">${opts(Object.fromEntries(Object.values(S.suppliers).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(x => [x.id, x.name])), I.supplier, "— none: paid directly —")}</select></div>
      ${I.supplier ? "" : `<div class="f"><label>Paid from</label><select data-impopt="paidFrom">${opts(acctOpts(null, true), I.paidFrom)}</select></div>`}
      <div class="f"><label>Who bears it</label><select data-impopt="recover">${opts({false: "Company cost", true: "Recover from the driver"}, String(I.recover))}</select></div>
      <div class="f"><label>Rows</label><select data-impopt="group">${opts({false: "One expense per row", true: "Group per car, day and driver"}, String(I.group))}</select></div></div>
    <div class="tbl" style="margin-top:10px;max-height:340px;overflow:auto"><table><thead><tr><th>Date</th><th>Plate</th><th>Car</th><th>Driver</th><th>${src === "salik" ? "Gate" : "Station"}</th><th class="num">${PUR_SRC[src].unit}</th><th class="num">Net</th><th class="num">VAT</th><th></th></tr></thead><tbody>
    ${R.slice(0, 300).map(r => `<tr${r.dup || !r.ok ? ' style="opacity:.45"' : ""}><td>${esc(r.date ? dmyS(r.date) : "?")} <span class="small muted">${esc(r.time)}</span></td><td class="mono small">${esc(r.plate)}</td><td>${r.vid ? esc(vName(r.vid)) : '<span class="neg small">no match</span>'}</td><td class="small">${r.drv ? esc(dName(r.drv)) + (r.how ? ` <span class="muted">(${esc(r.how)})</span>` : "") : '<span class="muted">—</span>'}</td><td class="small">${esc(r.place)}</td><td class="num">${r.qty || ""}</td><td class="num">${fmt(r.net)}</td><td class="num">${fmt(r.vat)}</td><td class="small muted">${r.dup ? "already in" : !r.ok ? "skipped" : ""}</td></tr>`).join("")}
    </tbody></table></div>${R.length > 300 ? `<p class="small muted">First 300 rows shown.</p>` : ""}
    <div class="row" style="margin-top:10px;gap:10px"><button class="btn primary" data-impgo="1" ${groups.length && S.canWrite ? "" : "disabled"}>Import ${groups.length} expense${groups.length === 1 ? "" : "s"} – AED ${fmt(sum(groups, r => r.net + r.vat))}</button><span class="small muted">The driver is the one whose trip in that car was going on at that time (else the car's assignment). ${I.supplier ? `Saved as a purchase invoice from ${esc((S.suppliers[I.supplier] || {}).name || "")} (one per month) – it uses up the top-ups paid to him.` : "Booked as paid directly from the account."} Rows without a car are imported without a car (company cost).</span></div></div>`;
}
async function impGo(){
  const I = S.purImp, P = PUR_SRC[I.src], R = impRows().filter(r => r.ok && !r.dup);
  const list = I.group ? Object.values(R.reduce((g, r) => { const k = r.vid + "|" + r.date + "|" + r.drv; const x = g[k] ||= {...r, net: 0, vat: 0, qty: 0, n: 0, refs: []}; x.net += r.net; x.vat += r.vat; x.qty += r.qty; x.n++; x.refs.push(r.ref); return g; }, {})) : R;
  const rows = list.map(r => ({id: uid(), type: "expense", date: r.date, category: P.cat, sub: P.sub, amount: r2(r.net), vat: r2(r.vat), vehicleId: r.vid, driverId: r.drv || "", recover: I.recover && !!r.drv, paidFrom: I.paidFrom,
    qty: r2(r.qty), note: `${P.label}${r.n > 1 ? ` · ${r.n} ${P.sub === "salik" ? "trips" : "transactions"}` : ""}${r.place && !(r.n > 1) ? " · " + r.place : ""}${r.qty ? ` · ${r2(r.qty)} ${P.unit.toLowerCase()}` : ""}`, srcRef: r.refs ? r.refs[0] : r.ref, srcRefs: r.refs || undefined, imported: I.name}));
  rows.forEach(r => { if(!r.srcRefs) delete r.srcRefs; });
  if(I.supplier){
    // one purchase invoice per month from the prepaid supplier
    const byM = {}; rows.forEach(r => (byM[r.date.slice(0,7)] ||= []).push(r));
    const docs = Object.entries(byM).map(([m, rs]) => ({id: uid(), type: "purchase_invoice", date: rs.map(r => r.date).sort().pop(), dueDate: rs.map(r => r.date).sort().pop(), party: "s:" + I.supplier,
      number: `${P.label.toUpperCase().replace(/[^A-Z]/g, "")}-${m}`, ref: I.name, note: `${P.label} consumption imported from ${I.name} – to change it, delete this invoice and import again`,
      lines: rs.map(r => ({desc: `${r.note}${r.vehicleId ? " – " + vName(r.vehicleId) : ""} – ${dmyS(r.date)}`, account: r.category, qty: 1, price: r.amount, vat: r.vat ? "5" : "", vatAmt: r.vat || "", date: r.date, sub: r.sub, units: r.qty, vehicleId: r.vehicleId, driverId: r.driverId, recover: r.recover, srcRef: r.srcRef, ...(r.srcRefs ? {srcRefs: r.srcRefs} : {})})),
      by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()}));
    try{ await S.db.doc("settings/main").set({...S.settings, [supKey(I.src)]: I.supplier}); }catch(e){}
    if(await addEntries(docs)){ S.purImp = null; toast(`${rows.length} ${P.label.toLowerCase()} line${rows.length === 1 ? "" : "s"} saved as ${docs.length} purchase invoice${docs.length === 1 ? "" : "s"} from ${(S.suppliers[I.supplier] || {}).name}.`); render(); }
    return;
  }
  toast(`Importing ${rows.length} expenses…`);
  if(window.addEntries ? await addEntries(rows) : false){ S.purImp = null; toast(`${rows.length} ${P.label.toLowerCase()} expense${rows.length === 1 ? "" : "s"} imported.`); render(); }
}

/* ---------- tabs ---------- */
function purTable(list, unit){
  const pg = paged("pur-" + S.purTab, list.slice().sort((a, b) => b.date.localeCompare(a.date)));
  return `<div class="tbl"><table><thead><tr><th>Date</th><th>Category</th><th>Car</th><th>Driver</th><th>Note</th>${unit ? `<th class="num">${unit}</th>` : ""}<th class="num">Net</th><th class="num">VAT</th><th>Paid from</th><th>Receipt</th><th></th></tr></thead><tbody>
  ${pg.rows.map(e => `<tr><td>${esc(dmyS(e.date))}</td><td class="small">${esc(EXP_CATS[e.category] || "")}${e.recover ? ' <span class="pill brass">From driver</span>' : ""}</td><td>${e.vehicleId ? esc(vName(e.vehicleId)) : ""}</td><td class="small">${e.driverId ? esc(dName(e.driverId)) : ""}</td><td class="small" style="white-space:normal">${esc(e.note || "")}</td>${unit ? `<td class="num">${num(e.qty) || ""}</td>` : ""}<td class="num">${fmt(num(e.amount))}</td><td class="num">${num(e.vat) ? fmt(num(e.vat)) : ""}</td><td class="small">${esc(e.virtual ? "Invoice – " + (window.BOOKS ? BOOKS.partyName(e.party) : "supplier") : e.paidFrom === "driver" ? "Driver's cash" : acctName(e.paidFrom || "1100"))}</td><td>${rcptCell(e)}</td><td><button class="btn sm" data-puredit="${esc(e.id)}">Edit</button></td></tr>`).join("") || `<tr><td colspan="${unit ? 11 : 10}" class="muted">Nothing in this period.</td></tr>`}
  </tbody><tfoot><tr><td colspan="${unit ? 5 : 5}">${list.length} expense(s)</td>${unit ? `<td class="num">${r2(sum(list, e => num(e.qty))) || ""}</td>` : ""}<td class="num">${fmt(sum(list, e => num(e.amount)))}</td><td class="num">${fmt(sum(list, e => num(e.vat)))}</td><td colspan="3"></td></tr></tfoot></table></div>${pg.bar}`;
}
function byCar(list, unit){
  const by = {}; list.forEach(e => { const b = by[e.vehicleId || ""] ||= {n: 0, q: 0, a: 0}; b.n++; b.q += num(e.qty); b.a += num(e.amount) + num(e.vat); });
  const rows = Object.entries(by).sort((a, b) => b[1].a - a[1].a); if(!rows.length) return "";
  return `<details style="margin-bottom:10px"><summary class="small" style="cursor:pointer"><b>By car</b> – ${rows.length} car${rows.length === 1 ? "" : "s"}</summary><div class="tbl" style="margin-top:6px"><table><thead><tr><th>Car</th><th class="num">Expenses</th>${unit ? `<th class="num">${unit}</th>` : ""}<th class="num">Total incl. VAT</th></tr></thead><tbody>${rows.map(([v, b]) => `<tr><td>${v ? esc(vName(v)) : '<span class="muted">No car</span>'}</td><td class="num">${b.n}</td>${unit ? `<td class="num">${r2(b.q) || ""}</td>` : ""}<td class="num">${fmt(b.a)}</td></tr>`).join("")}</tbody></table></div></details>`;
}
function prepaidBox(src){
  const id = supOf(src);
  if(!id) return `<div class="banner info">Fuel, Salik and EV charging are prepaid: create the supplier for this account, top it up with a payment, and import the consumption as his purchase invoice.
    <div class="row" style="margin-top:6px;gap:6px"><button class="btn sm" data-supmake="${src}">Create supplier "${esc(SUP_NAME[src])}"</button><select data-supset="${src}" aria-label="Or choose a supplier">${opts(Object.fromEntries(Object.values(S.suppliers).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(x => [x.id, x.name])), "", "…or choose an existing supplier")}</select></div></div>`;
  const bal = window.BOOKS && BOOKS.partyBal ? BOOKS.partyBal("s:" + id, "2000") : 0, name = (S.suppliers[id] || {}).name;
  return `<div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">${esc(name)} – ${bal <= 0 ? "prepaid balance" : "owed to supplier"}</div><div class="v ${bal > 0 ? "neg" : ""}">${fmt(Math.abs(bal))}</div><div class="n">top-ups less consumption invoices</div></div>
    <div class="kpi"><div class="l">Account</div><div class="v" style="font-size:14px"><button class="btn sm primary" data-suptop="${esc(id)}" data-src="${src}">Top up</button> <button class="btn sm" data-supstmt="${esc(id)}">Statement</button> <button class="btn sm ghost" data-supchange="${src}">Change supplier</button></div></div></div>`;
}
function purView(){
  if(S.edit && S.edit.kind === "entry") S.purTab = "all";   // an entry opened from anywhere shows in the entry form
  const tab = PUR_TABS[S.purTab] ? S.purTab : "all", head = `<div class="section" style="padding-bottom:6px"><div class="head"><div><h2>Purchases & expenses</h2><p class="sub">Every purchase, expense and payment. Fuel, Salik and EV charging are imported from the statements downloaded from their portals; attach the receipt to any expense.</p></div></div>${tabBtns("data-purtab", tab, PUR_TABS)}</div>`;
  if(tab === "all"){ PUR.busy = true; try{ return head + vEntries(); } finally { PUR.busy = false; } }
  if(tab === "invoices") return head + (PUR.invView ? PUR.invView() : "");   // supplier bills (Purchase invoices) live here
  const E = expEntries(); let body = "";
  if(tab === "purchase"){
    const list = E.filter(e => !["fuel", "salik", "ev"].includes(entSub(e)));
    body = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">Repairs, parts, tyres, insurance, permits, office and other purchases paid in cash or by bank. Supplier bills on credit go in Purchase invoices.</span><div class="row">${dlBtn("purlist", "purchase")}<button class="btn sm primary" data-puradd="5230">Add purchase</button><button class="btn sm" data-purtab="invoices">Purchase invoices</button></div></div>${byCar(list)}${purTable(list)}`;
  } else if(tab === "receipts"){
    const withR = E.filter(e => S.rcpt[e.id]), without = E.filter(e => !S.rcpt[e.id]);
    body = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${withR.length} of ${E.length} expenses in this period have a receipt. Expenses without a receipt are listed first – attach a photo or PDF.</span></div>${purTable([...without, ...withR].reverse())}`;
  } else {
    const P = PUR_SRC[tab], list = E.filter(e => entSub(e) === tab);
    body = `${prepaidBox(tab)}${impPanel(tab)}<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · ${list.length} expense(s) · AED ${fmt(sum(list, e => num(e.amount) + num(e.vat)))} incl. VAT</span><div class="row">${dlBtn("purlist", tab)}<button class="btn sm" data-puradd="${P.cat}" data-sub="${P.sub}">Add one manually</button></div></div>${byCar(list, P.unit)}${purTable(list, P.unit)}`;
  }
  return head + `<div class="section">${body}</div>`;
}
DL.purlist = tab => { const E = expEntries().filter(e => tab === "purchase" ? !["fuel", "salik", "ev"].includes(entSub(e)) : entSub(e) === tab);
  return [`${tab}_${S.from}_${S.to}.csv`, [["Date","Category","Car","Driver","Note","Quantity","Net","VAT","Total","Paid from","Recover from driver","Receipt"], ...E.sort((a, b) => a.date.localeCompare(b.date)).map(e => [e.date, EXP_CATS[e.category] || "", e.vehicleId ? vName(e.vehicleId) : "", e.driverId ? dName(e.driverId) : "", e.note || "", num(e.qty) || "", num(e.amount), num(e.vat), r2(num(e.amount) + num(e.vat)), e.paidFrom === "driver" ? "Driver's cash" : acctName(e.paidFrom || "1100"), e.recover ? "Yes" : "No", S.rcpt[e.id] ? "Yes" : "No"])]]; };

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.purtab){ S.purTab = t.dataset.purtab; S.purImp = null; S.edit = null; S.view = "entries"; render(); return; }
  if(t.dataset.puradd){ S.purTab = "all"; S.edit = {kind: "entry", id: "", data: {date: iso(new Date()) <= S.to && iso(new Date()) >= S.from ? iso(new Date()) : S.from, type: "expense", category: t.dataset.puradd, paidFrom: "1100", sub: t.dataset.sub || ""}}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.supmake){ const src = t.dataset.supmake, id = "s-" + uid(); if(await writeOk(S.db.doc("suppliers/" + id).set({name: SUP_NAME[src], creditDays: 0, opening: 0}))){ await writeOk(S.db.doc("settings/main").set({...S.settings, [supKey(src)]: id})); toast(`Supplier "${SUP_NAME[src]}" created – rename it in Suppliers if needed.`); render(); } return; }
  if(t.dataset.supchange){ const k = supKey(t.dataset.supchange); await writeOk(S.db.doc("settings/main").set({...S.settings, [k]: ""})); render(); return; }
  if(t.dataset.suptop){ S.view = "payments"; if(window.BOOKS) BOOKS.newPartyDoc("payment", "s:" + t.dataset.suptop, "2000", 0, `${PUR_SRC[t.dataset.src].label} account top-up`); render(); window.scrollTo(0,0); return; }
  if(t.dataset.supstmt){ S.view = "suppliers"; S.pv = {kind: "supplier", id: t.dataset.supstmt}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.puredit){ const e = S.entries.find(x => x.id === t.dataset.puredit); if(!e) return;
    if(e.virtual){ S.view = "purchinv"; if(window.BOOKS) BOOKS.openDoc(e.docId); render(); window.scrollTo(0,0); return; } S.purTab = "all"; S.edit = {kind: "entry", id: e.id, data: {...e}}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.rcptopen){ openReceipt(t.dataset.rcptopen); return; }
  if(t.dataset.impcancel){ S.purImp = null; render(); return; }
  if(t.dataset.impgo){ t.disabled = true; t.textContent = "Importing…"; await impGo(); return; }
});
document.addEventListener("change", async ev => {
  const t = ev.target; if(!t.dataset) return;
  if(t.dataset.rcptadd && t.files && t.files[0]){ await attachReceipt(t.dataset.rcptadd, t.files[0]); return; }
  if(t.dataset.purimp && t.files && t.files[0]){ const src = t.dataset.purimp, file = t.files[0], rows = await readSheet(file); t.value = ""; if(!rows) return; if(!rows.length){ toast("No rows found in the file."); return; }
    S.purImp = {src, name: file.name, rows, map: impGuess(Object.keys(rows[0]), src), vatMode: "incl", paidFrom: "1100", supplier: supOf(src), recover: src === "salik", group: src === "salik"}; render(); return; }
  if(t.dataset.supset && t.value){ await writeOk(S.db.doc("settings/main").set({...S.settings, [supKey(t.dataset.supset)]: t.value})); render(); return; }
  if(t.dataset.impmap && S.purImp){ S.purImp.map[t.dataset.impmap] = t.value; render(); return; }
  if(t.dataset.impopt && S.purImp){ const k = t.dataset.impopt; S.purImp[k] = k === "recover" || k === "group" ? t.value === "true" : t.value; render(); return; }
});
window.PUR = {view: purView, busy: false, expand: expandInv};
// Purchase invoices open inside Purchases & expenses (their own menu item is replaced by it)
if(window.BOOK_VIEWS && BOOK_VIEWS.purchinv){ PUR.invView = BOOK_VIEWS.purchinv; BOOK_VIEWS.purchinv = () => { S.purTab = "invoices"; return purView(); }; }
