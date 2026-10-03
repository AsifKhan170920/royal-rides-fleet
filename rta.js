/* RTA (menu RTA): licences & permits, deposits, PDC cheques to RTA, RTA (management) fines, fees & charges,
   and the road fines of all cars. Each car also has a "Road fines" tab.
   - Licences & permits (collection rtalic): company limousine licence, vehicle permits, driver permits… with expiry
     (shown on the dashboard 30 days ahead). "Pay fee" opens an expense (5250 Registration & permits).
   - Deposits (collection rtadep): Dr 1400 RTA deposits / Cr bank when paid; refund Dr bank / Cr 1400;
     forfeited Dr 5250 / Cr 1400. Deposits are non-current assets.
   - PDC cheques: the cheques issued to RTA, kept in PDC cheques (payee RTA).
   - Fines (collection fines): kind "road" – traffic fines on a car (Dubai Police / RTA radar, parking, Salik…),
     the driver who had the car that day is found from the assignment; kind "rta" – fines RTA issues to the company
     (inspections, permits, operating rules). A fine is a liability from its date: unpaid fines are accrued at the
     period end (Dr 5220 / 5225, or Dr 1170 when it is to be recovered from the driver; Cr 2450 Fines payable).
     "Pay" records the payment as an expense (with car, driver and "recover from driver"), so recovery from the
     driver's salary works as for any expense.
   Road fines cannot be fetched from the RTA website automatically (plate search with verification, no public
   API); "Check on RTA" opens the official enquiry with the plate copied, and the fines statement downloaded from
   RTA / Dubai Police can be imported (Excel / CSV). Each car keeps the date it was last checked. */
Object.assign(EXP_CATS, {"5225": "RTA fines – company (management)"});
const RTA_ACCTS = {"1400": "RTA deposits (refundable)", "2450": "Traffic & RTA fines payable", "5225": "RTA fines – company (management)"};
Object.assign(ACCT, RTA_ACCTS); if(typeof ACCT_BASE !== "undefined") Object.assign(ACCT_BASE, RTA_ACCTS);
if(typeof NON_CURRENT !== "undefined") NON_CURRENT.add("1400");
S.rtalic = S.rtalic || {}; S.rtadep = S.rtadep || {}; S.fines = S.fines || {}; S.rtaTab = S.rtaTab || "lic"; S.rtaEdit = S.rtaEdit || null; S.finePay = S.finePay || null;
const RTA_TABS = {lic: "Licences & permits", dep: "Deposits", pdc: "PDC cheques", fines: "RTA fines", road: "Road fines (all cars)", fees: "Fees & charges"};
const LIC_TYPES = {company: "Limousine operator licence (company)", trade: "Trade licence", vehicle: "Vehicle limousine permit", driver: "Driver RTA permit / limousine card", other: "Other RTA approval"};
const FINE_SRC = {dxbpolice: "Dubai Police", rta: "RTA", parking: "RTA parking", salik: "Salik", auh: "Abu Dhabi Police", shj: "Sharjah Police", other: "Other"};
const RTA_URL = "https://www.rta.ae", DXB_POLICE_URL = "https://www.dubaipolice.gov.ae";
const fineList = kind => Object.values(S.fines).filter(f => f.kind === kind);
const fineCat = f => f.kind === "rta" ? "5225" : "5220";
// unpaid on a day: dated on or before it and not paid by then
const unpaidAt = (f, day) => f.date && f.date <= day && f.status !== "cancelled" && !(f.paidOn && f.paidOn <= day);
// who had the car: the assignment on that day, else the driver with the most trips in that car that day
/* Who had the car at a moment (a Salik crossing, a fuel fill, a fine): the driver whose platform trip in that car was
   going on or had just started (trip start up to 3 hours before), else the next trip in that car within an hour;
   without a time or a trip, the car's assignment that day, else the driver with most trips in that car that day.
   driverAt returns {id, how}; fineDriver(vid, date, time) only the driver. */
const toMin = t => { const m = String(t || "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i); if(!m) return null; let h = +m[1]; const ap = (m[3] || "").toLowerCase(); if(ap.startsWith("p") && h < 12) h += 12; if(ap.startsWith("a") && h === 12) h = 0; return h * 60 + +m[2]; };
function driverAt(vid, date, time){
  const v = S.vehicles[vid]; if(!v || !date) return {id: "", how: ""}; const day = date.slice(0,10), tm = toMin(time);
  const pool = (S.ledger && S.ledger.trips && !S.ledger.loading ? S.ledger.trips : S.trips), ts = pool.filter(t => t.d === day && t.dr && vehicleForTrip(t) === vid);
  if(tm != null){
    const timed = ts.map(t => ({t, m: toMin(t.t)})).filter(x => x.m != null);
    const before = timed.filter(x => x.m <= tm && tm - x.m <= 180).sort((a, b) => b.m - a.m)[0], after = timed.filter(x => x.m > tm && x.m - tm <= 60).sort((a, b) => a.m - b.m)[0];
    const hit = before || after; if(hit) return {id: hit.t.dr, how: `trip at ${hit.t.t}`};
  }
  try{ const h = holderOf(vehDrv(v), day); if(h) return {id: h, how: "assigned"}; }catch(e){}
  const n = {}; ts.forEach(t => n[t.dr] = (n[t.dr] || 0) + 1); const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return top ? {id: top[0], how: "most trips that day"} : {id: "", how: ""};
}
const fineDriver = (vid, date, time) => driverAt(vid, date, time).id;
window.driverAt = driverAt;
const checkDays = () => num(setting("finesCheckDays", 7)) || 7;
const daysSince = d => d ? Math.round((parseD(iso(new Date())) - parseD(d.slice(0,10))) / 86400000) : null;

/* ---------- accounting ---------- */
function postRta(add){
  const acct = d => d.account || "1100";
  for(const d of Object.values(S.rtadep)){
    add.src = {kind: "rtadep", id: d.id};
    if(d.date >= S.from && d.date <= S.to){ add("1400", num(d.amount), 0, `RTA deposit – ${d.purpose || ""}${d.ref ? " " + d.ref : ""}`, d.date); add(acct(d), 0, num(d.amount), `RTA deposit – ${d.purpose || ""}`, d.date); }
    if(d.closedOn && d.closedOn >= S.from && d.closedOn <= S.to){
      if(d.status === "refunded"){ add(d.refundAccount || acct(d), num(d.amount), 0, `RTA deposit refunded – ${d.purpose || ""}`, d.closedOn); add("1400", 0, num(d.amount), `RTA deposit refunded – ${d.purpose || ""}`, d.closedOn); }
      if(d.status === "forfeited"){ add("5250", num(d.amount), 0, `RTA deposit forfeited – ${d.purpose || ""}`, d.closedOn); add("1400", 0, num(d.amount), `RTA deposit forfeited – ${d.purpose || ""}`, d.closedOn); }
    }
  }
  // unpaid fines: the change in the accrual over the period
  const before = addDays(S.from, -1);
  for(const f of Object.values(S.fines)){
    add.src = {kind: "fine", id: f.id};
    const d = r2((unpaidAt(f, S.to) ? num(f.amount) : 0) - (unpaidAt(f, before) ? num(f.amount) : 0)); if(!d) continue;
    const dr = f.recover ? "1170" : fineCat(f), m = `${f.kind === "rta" ? "RTA fine" : "Traffic fine"} ${f.fineNo || ""}${f.vehicleId ? " – " + vName(f.vehicleId) : ""}${f.recover ? " (to recover from driver)" : ""}`;
    if(d > 0){ add(dr, d, 0, m + " – unpaid", S.to); add("2450", 0, d, m + " – unpaid", S.to); } else { add("2450", -d, 0, m + " – paid", S.to); add(dr, 0, -d, m + " – paid", S.to); }
  }
}
function rtaOpening(code){
  const start = setting("ledgerStart", "2026-09-01"), b = addDays(start, -1); let o = 0;
  if(code === "1400") o += sum(Object.values(S.rtadep).filter(d => d.date && d.date < start && !(d.closedOn && d.closedOn < start)), d => num(d.amount));
  if(code === "2450") o -= sum(Object.values(S.fines).filter(f => unpaidAt(f, b)), f => num(f.amount));
  if(code === "1170") o += sum(Object.values(S.fines).filter(f => f.recover && unpaidAt(f, b)), f => num(f.amount));
  return r2(o);
}

/* ---------- writing expense entries (fine payments) ---------- */
async function addEntries(rows){
  const by = {}; rows.forEach(r => (by[r.date.slice(0,7)] ||= []).push(r));
  for(const [m, list] of Object.entries(by)){
    const ref = S.db.doc("entries/" + m), snap = await ref.get(), cur = snap.exists ? (snap.data().rows || []) : [];
    if(!await writeOk(ref.set({month: m, rows: [...cur, ...list]}))) return false;
  }
  await loadPeriod(); return true;
}
async function payFines(ids, date, account){
  const fs = ids.map(id => S.fines[id]).filter(f => f && !f.paidOn); if(!fs.length) return;
  const rows = fs.map(f => ({id: uid(), type: "expense", date, category: fineCat(f), amount: num(f.amount), vat: 0, vehicleId: f.vehicleId || "", driverId: f.driverId || "", recover: !!f.recover && !!f.driverId, paidFrom: account,   // no driver known: company cost
    note: `${f.kind === "rta" ? "RTA fine" : (FINE_SRC[f.source] || "Traffic") + " fine"} ${f.fineNo || ""}${f.desc ? " – " + f.desc : ""}`.trim(), fineId: f.id}));
  if(!await addEntries(rows)) return;
  for(let i = 0; i < fs.length; i++){ const {id, ...b} = fs[i]; await writeOk(S.db.doc("fines/" + id).set({...b, status: "paid", paidOn: date, entryId: rows[i].id, payAccount: account})); }
  S.finePay = null; const nod = fs.filter(f => f.recover && !f.driverId).length; if(nod) setTimeout(() => toast(`${nod} fine(s) to recover had no driver – booked as company cost; set the driver on the expense to recover it.`), 2500); toast(`${fs.length} fine${fs.length === 1 ? "" : "s"} paid – recorded in Expenses & payments${fs.some(f => f.recover) ? "; the ones to recover go to the driver" : ""}.`); render();
}

/* ---------- fines tables ---------- */
const fineStatus = f => f.status === "cancelled" ? '<span class="pill">Cancelled</span>' : f.paidOn ? `<span class="pill good">Paid</span> <span class="small muted">${esc(dmyS(f.paidOn))}</span>` : f.status === "disputed" ? '<span class="pill warn">Disputed</span>' : '<span class="pill bad">Unpaid</span>';
function fineTable(list, key, showCar){
  const sel = new Set((S.finePay || {}).ids || []), unpaid = list.filter(f => !f.paidOn && f.status !== "cancelled");
  const rows = list.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const pg = paged(key, rows);
  return `<div class="tbl"><table><thead><tr><th></th><th>Date</th><th>Fine no.</th>${showCar ? "<th>Car</th>" : ""}<th>Source</th><th>Violation</th><th>Driver</th><th class="num">Amount</th><th class="num">Points</th><th>Recover</th><th>Status</th><th></th></tr></thead><tbody>
  ${pg.rows.map(f => `<tr><td>${!f.paidOn && f.status !== "cancelled" ? `<input type="checkbox" data-finesel="${esc(f.id)}" ${sel.has(f.id) ? "checked" : ""} aria-label="Select">` : ""}</td><td>${esc(dmyS((f.date || "").slice(0,10)))}${f.time ? ` <span class="small muted">${esc(f.time)}</span>` : ""}</td><td class="mono small">${esc(f.fineNo || "")}</td>${showCar ? `<td>${f.vehicleId ? `<button class="btn sm ghost" data-vehview="${esc(f.vehicleId)}" data-vehtab="fines" style="padding:2px 6px">${esc(vName(f.vehicleId))}</button>` : "—"}</td>` : ""}<td class="small">${esc(f.kind === "rta" ? "RTA" : FINE_SRC[f.source] || "")}</td><td class="small" style="white-space:normal;min-width:180px">${esc(f.desc || "")}${f.location ? `<div class="muted">${esc(f.location)}</div>` : ""}</td><td class="small">${f.driverId ? esc(dName(f.driverId)) : '<span class="muted">—</span>'}</td><td class="num">${fmt(num(f.amount))}</td><td class="num">${num(f.points) || ""}</td><td>${f.recover ? '<span class="pill brass">Driver</span>' : '<span class="small muted">Company</span>'}</td><td>${fineStatus(f)}</td>
    <td class="row" style="flex-wrap:nowrap">${!f.paidOn && f.status !== "cancelled" ? `<button class="btn sm primary" data-finepay="${esc(f.id)}">Pay</button>` : ""}<button class="btn sm" data-fineedit="${esc(f.id)}">Edit</button></td></tr>`).join("") || `<tr><td colspan="${showCar ? 12 : 11}" class="muted">No fines.</td></tr>`}
  </tbody><tfoot><tr><td></td><td colspan="${showCar ? 6 : 5}">${list.length} fine(s) · unpaid ${unpaid.length}</td><td class="num">${fmt(sum(list, f => num(f.amount)))}</td><td class="num">${sum(list, f => num(f.points)) || ""}</td><td colspan="3">Unpaid AED <b>${fmt(sum(unpaid, f => num(f.amount)))}</b></td></tr></tfoot></table></div>${pg.bar}${payPanel()}`;
}
function payPanel(){
  const p = S.finePay; if(!p || !p.ids.length) return "";
  const fs = p.ids.map(id => S.fines[id]).filter(Boolean);
  return `<form class="form" id="fFinePay" style="margin-top:10px;border:1px solid var(--line);padding:10px;border-radius:8px"><div class="f wide"><b>Pay ${fs.length} fine${fs.length === 1 ? "" : "s"} – AED ${fmt(sum(fs, f => num(f.amount)))}</b> <span class="small muted">One expense per fine is recorded (with its car and driver).</span></div>
    <div class="f"><label for="fp_date">Paid on</label><input id="fp_date" name="date" type="date" required value="${esc(iso(new Date()))}"></div>
    <div class="f"><label for="fp_acct">Paid from</label><select id="fp_acct" name="account">${opts(acctOpts(null, true), "1100")}</select></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Record payment</button><button class="btn ghost" type="button" data-finepaycancel="1">Cancel</button></div></form>`;
}
function fineForm(f, kind, vid){
  f = f || {kind, vehicleId: vid || "", date: iso(new Date()), source: kind === "rta" ? "rta" : "dxbpolice", recover: kind === "road"};
  const fld = (n, l, type = "text", extra = "") => `<div class="f"><label for="fn_${n}">${l}</label><input id="fn_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(f[n] ?? "")}"${extra}></div>`;
  return `<div class="section"><h2>${f.id ? "Edit" : "Add"} ${f.kind === "rta" ? "RTA fine" : "road fine"}</h2><form class="form" id="fFine" data-id="${esc(f.id || "")}" data-kind="${esc(f.kind)}">
    ${fld("date", "Date", "date", " required")}${fld("time", "Time", "time")}${fld("fineNo", f.kind === "rta" ? "Violation / reference no." : "Fine / ticket no.", "text", " required")}
    ${f.kind === "road" ? `<div class="f"><label for="fn_src">Issued by</label><select id="fn_src" name="source">${opts(FINE_SRC, f.source || "dxbpolice")}</select></div>` : ""}
    <div class="f"><label for="fn_car">Car</label><select id="fn_car" name="vehicleId">${listOpts(S.vehicles, v => vName(v.id), f.vehicleId || "", f.kind === "rta" ? "— not for a car —" : "Choose…")}</select></div>
    <div class="f"><label for="fn_drv">Driver (blank = whoever had the car that day)</label><select id="fn_drv" name="driverId">${listOpts(S.drivers, d => d.name || d.id, f.driverId || "", "—")}</select></div>
    ${fld("desc", "Violation", "text", " required")}${fld("location", "Location")}${fld("amount", "Amount (AED)", "number", " required")}${f.kind === "road" ? fld("points", "Black points", "number") : fld("dueDate", "Pay by", "date")}
    <div class="f"><label for="fn_rec">Who bears it</label><select id="fn_rec" name="recover">${opts({true: "Recover from the driver", false: "Company cost"}, String(!!f.recover))}</select></div>
    <div class="f"><label for="fn_st">Status</label><select id="fn_st" name="status">${opts({unpaid: "Unpaid", disputed: "Disputed / objection filed", cancelled: "Cancelled by authority", paid: "Paid"}, f.status || "unpaid")}</select></div>
    ${fld("notes", "Notes")}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-finecancel="1">Cancel</button>${f.id ? `<button class="btn danger" type="button" data-finedel="${esc(f.id)}">Delete</button>` : ""}</div>
    ${f.paidOn ? `<p class="small muted wide">Paid on ${esc(dmyS(f.paidOn))} – the payment is in Expenses & payments; delete it there if the payment is undone.</p>` : ""}</form></div>`;
}

/* ---------- importing a fines statement (Excel / CSV from RTA / Dubai Police) ---------- */
async function importFines(file, vidOnly){
  if(!window.XLSX){ toast("The Excel tool is still loading – try again in a moment."); return; }
  const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true}), rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval: "", raw: false});
  if(!rows.length){ toast("No rows found in the file."); return; }
  const keys = Object.keys(rows[0]), pick = (...w) => { for(const x of w){ const k = keys.find(k => norm(k).includes(x)); if(k) return k; } return ""; }   // the first word in the list wins ("total amount" before "amount");
  const K = {no: pick("ticketno", "fineno", "finenumber", "ticketnumber", "violationno", "referenceno", "ticket", "number"), date: pick("date"), time: pick("time"), plate: pick("plate"), src: pick("source", "issuer", "authority", "emirate"),
    desc: pick("description", "violation", "offence", "type"), loc: pick("location", "place", "street"), amt: pick("amount", "fine", "value", "aed"), pts: pick("blackpoint", "points")};
  if(!K.no || !K.amt){ toast("Could not find the fine number and amount columns in the file."); return; }
  const byPlate = {}; Object.values(S.vehicles).forEach(v => { byPlate[norm(v.plate).replace(/^[a-z]+/, "")] = v.id; byPlate[norm(v.plate)] = v.id; });
  const known = new Set(Object.values(S.fines).map(f => f.kind + "|" + norm(f.fineNo)));
  const toIso = s => { s = String(s || "").trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return `${m[1]}-${m[2]}-${m[3]}`; m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/); if(m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; const d = new Date(s); return isNaN(d) ? "" : iso(d); };
  let added = 0, skipped = 0, noCar = 0;
  for(const r of rows){
    const fineNo = String(r[K.no] || "").trim(), amount = num(String(r[K.amt]).replace(/[^\d.-]/g, "")); if(!fineNo || !amount){ skipped++; continue; }
    if(known.has("road|" + norm(fineNo))){ skipped++; continue; }
    const p = norm(r[K.plate] || ""), vid = vidOnly || byPlate[p] || byPlate[p.replace(/^[a-z]+/, "")] || ""; if(!vid) noCar++;
    const date = toIso(r[K.date]) || iso(new Date()), srcTxt = norm(r[K.src] || "");
    const f = {kind: "road", fineNo, date, time: K.time ? String(r[K.time] || "").slice(0, 5) : "", vehicleId: vid, driverId: fineDriver(vid, date, K.time ? String(r[K.time] || "") : ""), desc: String(r[K.desc] || "").trim(), location: K.loc ? String(r[K.loc] || "").trim() : "",
      amount, points: K.pts ? num(r[K.pts]) : 0, source: srcTxt.includes("rta") ? "rta" : srcTxt.includes("abu") ? "auh" : srcTxt.includes("sharjah") ? "shj" : srcTxt.includes("salik") ? "salik" : "dxbpolice", recover: true, status: "unpaid", imported: file.name, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()};
    if(await writeOk(S.db.doc("fines/f-" + uid()).set(f))){ added++; known.add("road|" + norm(fineNo)); }
  }
  if(vidOnly) await markChecked(vidOnly);
  toast(`Imported ${added} new fine${added === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped (already in or empty)` : ""}${noCar ? `, ${noCar} without a matching car` : ""}.`); render();
}
async function markChecked(vid){ const v = S.vehicles[vid]; if(!v) return; const {id, ...b} = v; await writeOk(S.db.doc("vehicles/" + vid).set({...b, finesCheckedAt: new Date().toISOString()})); }

/* ---------- the car's Road fines tab ---------- */
function vehFinesTab(id){
  const v = S.vehicles[id] || {}, ds = daysSince(v.finesCheckedAt), due = ds == null || ds >= checkDays(), list = fineList("road").filter(f => f.vehicleId === id);
  if(S.rtaEdit && S.rtaEdit.kind === "fine") return fineForm(S.rtaEdit.id ? S.fines[S.rtaEdit.id] : null, "road", id);
  return `<div class="banner ${due ? "" : "info"}">Last checked on the RTA / Dubai Police website: <b>${v.finesCheckedAt ? esc(dmyS(v.finesCheckedAt.slice(0,10))) + ` (${ds} day${ds === 1 ? "" : "s"} ago)` : "never"}</b>. ${due ? `Check every ${checkDays()} days.` : ""}
    <div class="row" style="margin-top:6px;gap:6px"><button class="btn sm" data-finecheck="${esc(id)}" data-url="${RTA_URL}">Check on RTA</button><button class="btn sm" data-finecheck="${esc(id)}" data-url="${DXB_POLICE_URL}">Check on Dubai Police</button><button class="btn sm" data-finechecked="${esc(id)}">Mark checked today</button>
    <label class="btn sm" style="cursor:pointer">Import fines statement<input type="file" accept=".xlsx,.xls,.csv" data-fineimport="${esc(id)}" hidden></label></div>
    <div class="small muted" style="margin-top:4px">Plate <b class="mono">${esc(v.plate || "")}</b> is copied when you open the website – choose plate details, paste it, then add the fines here or import the statement.</div></div>
  <div class="row" style="justify-content:space-between;margin:8px 0"><span class="small muted">The driver is the one assigned to the car on the fine date (change it on the fine if needed).</span><div class="row">${dlBtn("vfines", id)}<button class="btn sm primary" data-fineadd="road" data-car="${esc(id)}">Add road fine</button></div></div>
  ${fineTable(list, "vfines-" + id, false)}`;
}
const fineCsv = list => [["Date","Time","Fine no.","Car","Source","Violation","Location","Driver","Amount","Black points","Recover from driver","Status","Paid on"],
  ...list.slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map(f => [f.date, f.time || "", f.fineNo || "", f.vehicleId ? vName(f.vehicleId) : "", f.kind === "rta" ? "RTA" : FINE_SRC[f.source] || "", f.desc || "", f.location || "", f.driverId ? dName(f.driverId) : "", num(f.amount), num(f.points) || "", f.recover ? "Yes" : "No", f.paidOn ? "Paid" : f.status || "unpaid", f.paidOn || ""])];
DL.vfines = id => [`road_fines_${norm(vName(id))}.csv`, fineCsv(fineList("road").filter(f => f.vehicleId === id))];

/* ---------- the RTA page ---------- */
function licForm(l){
  l = l || {type: "vehicle", issue: iso(new Date())};
  const fld = (n, lab, type = "text", extra = "") => `<div class="f"><label for="lc_${n}">${lab}</label><input id="lc_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(l[n] ?? "")}"${extra}></div>`;
  return `<div class="section"><h2>${l.id ? "Edit" : "Add"} licence / permit</h2><form class="form" id="fLic" data-id="${esc(l.id || "")}">
    <div class="f"><label for="lc_type">Type</label><select id="lc_type" name="type">${opts(LIC_TYPES, l.type)}</select></div>${fld("number", "Licence / permit no.", "text", " required")}${fld("name", "Name / description")}
    <div class="f"><label for="lc_car">Car (vehicle permits)</label><select id="lc_car" name="vehicleId">${listOpts(S.vehicles, v => vName(v.id), l.vehicleId || "", "—")}</select></div>
    <div class="f"><label for="lc_drv">Driver (driver permits)</label><select id="lc_drv" name="driverId">${listOpts(S.drivers, d => d.name || d.id, l.driverId || "", "—")}</select></div>
    ${fld("issue", "Issue date", "date")}${fld("expiry", "Expiry date", "date", " required")}${fld("fee", "Renewal fee (AED)", "number")}${fld("remind", "Remind days before (default 30)", "number")}${fld("notes", "Notes")}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-rtacancel="1">Cancel</button>${l.id ? `<button class="btn danger" type="button" data-rtadel="rtalic" data-id="${esc(l.id)}">Delete</button>` : ""}</div></form></div>`;
}
function depForm(d){
  d = d || {date: iso(new Date()), account: "1100", status: "held"};
  const fld = (n, lab, type = "text", extra = "") => `<div class="f"><label for="dp_${n}">${lab}</label><input id="dp_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(d[n] ?? "")}"${extra}></div>`;
  return `<div class="section"><h2>${d.id ? "Edit" : "Add"} RTA deposit</h2><form class="form" id="fDep" data-id="${esc(d.id || "")}">
    ${fld("purpose", "Purpose (e.g. limousine licence guarantee, plate deposit)", "text", " required")}${fld("ref", "Receipt / reference no.")}${fld("amount", "Amount (AED)", "number", " required")}${fld("date", "Paid on", "date", " required")}
    <div class="f"><label for="dp_acct">Paid from</label><select id="dp_acct" name="account">${opts(acctOpts(["bank","cash"]), d.account || "1100")}</select></div>
    <div class="f"><label for="dp_car">Car (if for a car)</label><select id="dp_car" name="vehicleId">${listOpts(S.vehicles, v => vName(v.id), d.vehicleId || "", "—")}</select></div>
    <div class="f"><label for="dp_st">Status</label><select id="dp_st" name="status">${opts({held: "Held by RTA", refunded: "Refunded", forfeited: "Forfeited / adjusted by RTA"}, d.status || "held")}</select></div>
    ${fld("closedOn", "Refunded / forfeited on", "date")}<div class="f"><label for="dp_racct">Refunded into</label><select id="dp_racct" name="refundAccount">${opts(acctOpts(["bank","cash"]), d.refundAccount || d.account || "1100")}</select></div>${fld("notes", "Notes")}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-rtacancel="1">Cancel</button>${d.id ? `<button class="btn danger" type="button" data-rtadel="rtadep" data-id="${esc(d.id)}">Delete</button>` : ""}</div></form></div>`;
}
const isRtaPdc = p => p.rta || /\brta\b|roads?\s*(and|&)\s*transport/i.test(p.payee || "") || /\brta\b|roads?\s*(and|&)\s*transport/i.test(window.BOOKS && p.party ? BOOKS.partyName(p.party) : "");
const expTag = d => { if(!d) return ""; const left = Math.round((parseD(d) - parseD(iso(new Date()))) / 86400000); return left < 0 ? ' <span class="pill bad">Expired</span>' : left <= 30 ? ` <span class="pill warn">${left} day${left === 1 ? "" : "s"}</span>` : ""; };
function vRta(){
  const tab = RTA_TABS[S.rtaTab] ? S.rtaTab : "lic", E = S.rtaEdit; let body = "";
  if(E && E.kind === "lic") body = licForm(E.id ? S.rtalic[E.id] : null);
  else if(E && E.kind === "dep") body = depForm(E.id ? S.rtadep[E.id] : null);
  else if(E && E.kind === "fine") body = fineForm(E.id ? S.fines[E.id] : null, E.fkind || "rta", E.car);
  else if(tab === "lic"){
    const L = Object.values(S.rtalic).sort((a, b) => (a.expiry || "").localeCompare(b.expiry || ""));
    body = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">Expiring within 30 days shows on the dashboard. Soonest expiry first.</span><div class="row">${dlBtn("rtalic")}<button class="btn sm primary" data-rtaadd="lic">Add licence / permit</button></div></div>
    ${L.length ? `<div class="tbl"><table><thead><tr><th>Type</th><th>No.</th><th>Name</th><th>Car / driver</th><th>Issued</th><th>Expiry</th><th class="num">Renewal fee</th><th></th></tr></thead><tbody>${L.map(l => `<tr><td class="small">${esc(LIC_TYPES[l.type] || "")}</td><td class="mono small">${esc(l.number || "")}</td><td>${esc(l.name || "")}</td><td class="small">${l.vehicleId ? esc(vName(l.vehicleId)) : ""}${l.driverId ? esc(dName(l.driverId)) : ""}</td><td>${l.issue ? esc(dmyS(l.issue)) : ""}</td><td>${l.expiry ? esc(dmyS(l.expiry)) : ""}${expTag(l.expiry)}</td><td class="num">${num(l.fee) ? fmt(num(l.fee)) : ""}</td><td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-licpay="${esc(l.id)}">Pay fee</button><button class="btn sm" data-rtaedit="lic" data-id="${esc(l.id)}">Edit</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><b>No licences yet</b>Add the company's limousine operator licence, vehicle permits and driver RTA permits with their expiry dates.</div>`}`;
  } else if(tab === "dep"){
    const L = Object.values(S.rtadep).sort((a, b) => (b.date || "").localeCompare(a.date || "")), held = L.filter(d => (d.status || "held") === "held");
    body = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">Held by RTA: <b>AED ${fmt(sum(held, d => num(d.amount)))}</b> (account 1400, non-current asset).</span><div class="row">${dlBtn("rtadep")}<button class="btn sm primary" data-rtaadd="dep">Add deposit</button></div></div>
    ${L.length ? `<div class="tbl"><table><thead><tr><th>Paid on</th><th>Purpose</th><th>Reference</th><th>Car</th><th class="num">Amount</th><th>Paid from</th><th>Status</th><th></th></tr></thead><tbody>${L.map(d => `<tr><td>${esc(dmyS(d.date))}</td><td>${esc(d.purpose || "")}</td><td class="mono small">${esc(d.ref || "")}</td><td>${d.vehicleId ? esc(vName(d.vehicleId)) : ""}</td><td class="num">${fmt(num(d.amount))}</td><td class="small">${esc(acctName(d.account || "1100"))}</td><td>${(d.status || "held") === "held" ? '<span class="pill warn">Held</span>' : d.status === "refunded" ? `<span class="pill good">Refunded</span> <span class="small muted">${esc(dmyS(d.closedOn || ""))}</span>` : `<span class="pill bad">Forfeited</span>`}</td><td><button class="btn sm" data-rtaedit="dep" data-id="${esc(d.id)}">Edit</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><b>No deposits yet</b>Add the deposits and guarantees paid to RTA; mark them refunded or forfeited when settled.</div>`}`;
  } else if(tab === "pdc"){
    const L = Object.values(S.pdcs || {}).filter(isRtaPdc).sort((a, b) => (a.date || "").localeCompare(b.date || "")), pend = L.filter(p => p.status === "pending");
    body = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">Cheques issued to RTA (kept in PDC cheques). Pending: <b>${pend.length}</b> · AED ${fmt(sum(pend, p => num(p.amount)))}</span><button class="btn sm primary" data-rtapdc="1">Add RTA cheque</button></div>
    ${L.length ? `<div class="tbl"><table><thead><tr><th>Cheque date</th><th>Cheque no.</th><th>Bank</th><th class="num">Amount</th><th>Note</th><th>Status</th><th></th></tr></thead><tbody>${L.map(p => `<tr><td>${esc(dmyS(p.date))}</td><td class="mono">${esc(p.chequeNo || "")}</td><td>${esc(p.bank || "")}</td><td class="num">${fmt(num(p.amount))}</td><td class="small">${esc(p.note || p.memo || "")}</td><td><span class="pill ${p.status === "cleared" ? "good" : p.status === "bounced" ? "bad" : p.status === "cancelled" ? "" : "warn"}">${esc((typeof PDC_STATUS !== "undefined" && PDC_STATUS[p.status]) || p.status)}</span></td><td class="row">${p.status === "pending" ? `<button class="btn sm" data-pdcrec="${esc(p.id)}">Record payment</button>` : ""}<button class="btn sm" data-nav="pdc">Open in PDC cheques</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><b>No RTA cheques yet</b>Add the post-dated cheques given to RTA (licence fees, permits, instalments). They are kept with the other PDCs and remind you on their date.</div>`}`;
  } else if(tab === "fines"){
    body = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">Fines RTA issues to the company (inspections, permits, operating rules). Tick unpaid ones to pay several at once.</span><div class="row">${dlBtn("rtafines")}<button class="btn sm primary" data-fineadd="rta">Add RTA fine</button></div></div>${fineTable(fineList("rta"), "rtafines", true)}`;
  } else if(tab === "road"){
    const stale = Object.values(S.vehicles).filter(v => v.active !== false && (daysSince(v.finesCheckedAt) == null || daysSince(v.finesCheckedAt) >= checkDays()));
    body = `<div class="banner ${stale.length ? "" : "info"}">${stale.length ? `${stale.length} car${stale.length === 1 ? "" : "s"} not checked in the last ${checkDays()} days: ${esc(stale.slice(0, 15).map(v => vName(v.id)).join(", "))}${stale.length > 15 ? "…" : ""}.` : `All cars checked in the last ${checkDays()} days.`}
      <div class="row" style="margin-top:6px;gap:6px"><a class="btn sm" href="${RTA_URL}" target="_blank" rel="noopener">RTA website</a><a class="btn sm" href="${DXB_POLICE_URL}" target="_blank" rel="noopener">Dubai Police website</a><label class="btn sm" style="cursor:pointer">Import fines statement (all cars, matched by plate)<input type="file" accept=".xlsx,.xls,.csv" data-fineimport="" hidden></label>
      <label class="small">Check every <input id="fineDays" type="number" min="1" value="${checkDays()}" style="width:60px"> days</label></div></div>
    <div class="row" style="justify-content:flex-end;margin:8px 0">${dlBtn("allfines")}</div>${fineTable(fineList("road"), "allfines", true)}`;
  } else {
    const L = S.entries.filter(e => e.type === "expense" && ["5250", "5225", "5220"].includes(e.category)).sort((a, b) => b.date.localeCompare(a.date)), by = {};
    L.forEach(e => by[e.category] = (by[e.category] || 0) + num(e.amount) + num(e.vat));
    body = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="small muted">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))} · from Expenses & payments: registration & permits, RTA fines and traffic fines.</span><button class="btn sm primary" data-rtafee="1">Add RTA fee</button></div>
    <div class="kpis">${Object.entries(by).map(([c, v]) => `<div class="kpi"><div class="l">${esc(EXP_CATS[c] || c)}</div><div class="v">${fmt(v)}</div></div>`).join("") || ""}</div>
    ${L.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Category</th><th>Car</th><th>Driver</th><th>Note</th><th class="num">Amount</th><th>Recovered</th></tr></thead><tbody>${L.map(e => `<tr><td>${esc(dmyS(e.date))}</td><td class="small">${esc(EXP_CATS[e.category] || "")}</td><td>${e.vehicleId ? esc(vName(e.vehicleId)) : ""}</td><td class="small">${e.driverId ? esc(dName(e.driverId)) : ""}</td><td class="small" style="white-space:normal">${esc(e.note || "")}</td><td class="num">${fmt(num(e.amount) + num(e.vat))}</td><td>${e.recover ? '<span class="pill brass">Driver</span>' : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="sub">No RTA fees, permits or fines paid in this period.</p>`}`;
  }
  return `<div class="section"><div class="head"><div><h2>RTA</h2><p class="sub">Licences, deposits, cheques, fines and fees with the Roads & Transport Authority.</p></div></div>${tabBtns("data-rtatab", tab, RTA_TABS)}${body}</div>`;
}
DL.rtalic = () => [`rta_licences.csv`, [["Type","No.","Name","Car","Driver","Issued","Expiry","Renewal fee","Notes"], ...Object.values(S.rtalic).map(l => [LIC_TYPES[l.type] || "", l.number || "", l.name || "", l.vehicleId ? vName(l.vehicleId) : "", l.driverId ? dName(l.driverId) : "", l.issue || "", l.expiry || "", num(l.fee), l.notes || ""])]];
DL.rtadep = () => [`rta_deposits.csv`, [["Paid on","Purpose","Reference","Car","Amount","Paid from","Status","Closed on"], ...Object.values(S.rtadep).map(d => [d.date, d.purpose || "", d.ref || "", d.vehicleId ? vName(d.vehicleId) : "", num(d.amount), acctName(d.account || "1100"), d.status || "held", d.closedOn || ""])]];
DL.rtafines = () => [`rta_fines.csv`, fineCsv(fineList("rta"))];
DL.allfines = () => [`road_fines_all_cars.csv`, fineCsv(fineList("road"))];

/* dashboard */
function rtaDash(){
  const lim = addDays(iso(new Date()), 30), lic = Object.values(S.rtalic).filter(l => l.expiry && l.expiry <= lim), unpaid = Object.values(S.fines).filter(f => unpaidAt(f, iso(new Date())));
  const stale = Object.values(S.vehicles).filter(v => v.active !== false && (daysSince(v.finesCheckedAt) == null || daysSince(v.finesCheckedAt) >= checkDays()));
  const parts = [];
  if(lic.length && !window.REM) parts.push(`RTA licences / permits expiring: ${esc(lic.map(l => (l.name || LIC_TYPES[l.type] || "") + " " + dmyS(l.expiry)).join(", "))}.`);
  if(unpaid.length) parts.push(`${unpaid.length} unpaid fine${unpaid.length === 1 ? "" : "s"} (AED ${fmt(sum(unpaid, f => num(f.amount)))}).`);
  if(stale.length && !window.REM) parts.push(`${stale.length} car${stale.length === 1 ? "" : "s"} not checked for road fines in ${checkDays()} days.`);
  return parts.length ? `<div class="banner">${parts.join(" ")} <button class="btn sm" data-nav="rta">RTA</button></div>` : "";
}

/* ---------- events ---------- */
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.rtatab){ S.rtaTab = t.dataset.rtatab; S.rtaEdit = null; S.finePay = null; render(); return; }
  if(t.dataset.rtaadd){ S.rtaEdit = {kind: t.dataset.rtaadd, id: ""}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.rtaedit){ S.rtaEdit = {kind: t.dataset.rtaedit, id: t.dataset.id}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.rtacancel || t.dataset.finecancel){ S.rtaEdit = null; render(); return; }
  if(t.dataset.rtadel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to delete"; return; } if(await writeOk(S.db.doc(t.dataset.rtadel + "/" + t.dataset.id).delete())){ S.rtaEdit = null; toast("Deleted."); render(); } return; }
  if(t.dataset.fineadd){ S.rtaEdit = {kind: "fine", id: "", fkind: t.dataset.fineadd, car: t.dataset.car || ""}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.fineedit){ const f = S.fines[t.dataset.fineedit]; S.rtaEdit = {kind: "fine", id: f.id, fkind: f.kind, car: f.vehicleId}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.finedel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to delete"; return; } if(await writeOk(S.db.doc("fines/" + t.dataset.finedel).delete())){ S.rtaEdit = null; toast("Fine deleted."); render(); } return; }
  if(t.dataset.finepay){ S.finePay = {ids: [t.dataset.finepay]}; render(); return; }
  if(t.dataset.finepaycancel){ S.finePay = null; render(); return; }
  if(t.dataset.finecheck){ const v = S.vehicles[t.dataset.finecheck] || {}; try{ await navigator.clipboard.writeText(v.plate || ""); }catch(e){} window.open(t.dataset.url, "_blank", "noopener"); toast(`Plate ${v.plate || ""} copied – paste it in the fines enquiry.`); return; }
  if(t.dataset.finechecked){ await markChecked(t.dataset.finechecked); toast("Marked as checked today."); render(); return; }
  if(t.dataset.licpay){ const l = S.rtalic[t.dataset.licpay]; S.view = "entries"; S.edit = {kind: "entry", id: "", data: {date: iso(new Date()), type: "expense", category: "5250", paidFrom: "1100", amount: num(l.fee) || "", vehicleId: l.vehicleId || "", driverId: l.driverId || "", note: `RTA ${LIC_TYPES[l.type] || "licence"} ${l.number || ""} renewal`}}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.rtafee){ S.view = "entries"; S.edit = {kind: "entry", id: "", data: {date: iso(new Date()), type: "expense", category: "5250", paidFrom: "1100", note: "RTA "}}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.rtapdc){ S.view = "pdc"; S.pdcPreset = {dir: "out", payee: "RTA – Roads & Transport Authority"}; S.pdcEdit = {id: ""}; render(); window.scrollTo(0,0); return; }
});
document.addEventListener("change", async ev => {
  const t = ev.target;
  if(t.dataset && t.dataset.finesel != null){ const ids = new Set((S.finePay || {}).ids || []); t.checked ? ids.add(t.dataset.finesel) : ids.delete(t.dataset.finesel); S.finePay = ids.size ? {ids: [...ids]} : null; render(); return; }
  if(t.dataset && t.dataset.fineimport != null && t.files && t.files[0]){ await importFines(t.files[0], t.dataset.fineimport); t.value = ""; return; }
  if(t.id === "fineDays"){ const v = Math.max(1, num(t.value)); if(S.db) await writeOk(S.db.doc("settings/main").set({...S.settings, finesCheckDays: v})); render(); }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(!["fLic", "fDep", "fFine", "fFinePay"].includes(f.id)) return; ev.preventDefault(); if(!S.db) return;
  const d = Object.fromEntries(new FormData(f).entries()), by = (S.user && (S.user.name || S.user.id)) || "";
  if(f.id === "fFinePay"){ await payFines(S.finePay.ids, d.date, d.account); return; }
  if(f.id === "fLic"){ d.fee = num(d.fee); d.remind = String(d.remind) === "" ? "" : num(d.remind); const id = f.dataset.id || "lc-" + uid(); if(await writeOk(S.db.doc("rtalic/" + id).set({...d, by, at: new Date().toISOString()}))){ S.rtaEdit = null; toast("Saved."); render(); } return; }
  if(f.id === "fDep"){ d.amount = num(d.amount); if(d.status === "held") d.closedOn = ""; if(d.status !== "held" && !d.closedOn){ toast("Enter the date it was refunded / forfeited."); return; }
    const id = f.dataset.id || "dp-" + uid(); if(await writeOk(S.db.doc("rtadep/" + id).set({...d, by, at: new Date().toISOString()}))){ S.rtaEdit = null; toast("Deposit saved."); render(); } return; }
  // fines
  const id = f.dataset.id || "f-" + uid(), prev = S.fines[id] || {};
  const rec = {...prev, ...d, kind: f.dataset.kind, amount: num(d.amount), points: num(d.points), recover: d.recover === "true", by, at: new Date().toISOString()};
  if(!rec.driverId && rec.vehicleId) rec.driverId = fineDriver(rec.vehicleId, rec.date, rec.time);
  if(rec.status !== "paid" && prev.paidOn && rec.status !== prev.status){ rec.paidOn = ""; }
  if(rec.status === "paid" && !rec.paidOn) rec.paidOn = rec.date;   // marked paid without recording a payment here
  if(await writeOk(S.db.doc("fines/" + id).set(rec))){ S.rtaEdit = null; toast("Fine saved."); render(); }
});
window.RTA = {post: postRta, opening: rtaOpening, dash: rtaDash};
window.vehFinesTab = vehFinesTab;
Object.assign(window.BOOK_VIEWS = window.BOOK_VIEWS || {}, {rta: vRta});
