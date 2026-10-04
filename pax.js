/* Passenger audit – the tracker's seat sensor ("Trip Passenger" report): every journey with someone on a seat.
   Each passenger journey is matched with the platform trips of the same car; a passenger journey with no Uber / Bolt /
   Yango trip going on is the strongest sign of a ride taken off the apps. It is given to the driver of the trips
   around it (or the car's assigned driver), can be marked Open / Discussed / Explained / Confirmed with a note, and is
   printed with the driver's salary statement (a landscape page). This audit replaces the km-based GPS audit there. */
S.pax = S.pax || null; S.paxImp = S.paxImp || null; S.paxOnly = S.paxOnly ?? true; S.paxDrv = S.paxDrv || ""; S.paxCar = S.paxCar || "";
const PAX_TOL = 5;   // minutes either side when matching a passenger journey with a platform trip
/* the term of each passenger journey: on a platform trip; just before one (the rider sat in before the trip was started
   in the app) or just after one (the rider got out after it was ended); parking (the car hardly moved – waiting, a bag
   on the seat); or no trip – a ride with nobody paying through the apps, the one to explain */
const PAX_TERM = {trip: "Trip", pickup: "Pickup (before trip)", drop: "Drop-off (after trip)", park: "Parking", none: "No trip"};
const paxRange = () => ({parkKm: num(setting("gpsParkKm", 2)), nearMin: num(setting("paxNearMin", 15)) || 15, nearKm: num(setting("paxNearKm", 5)), attrMin: num(setting("gpsAttrMin", 180)) || 180});
const paxTerm = x => `<span class="pill ${x.term === "trip" ? "good" : x.term === "none" ? (x.level === "high" ? "bad" : "warn") : ""}">${PAX_TERM[x.term]}${x.term === "none" ? (x.level === "high" ? " · High" : " · Medium") : ""}</span>`;

const paxWhen = v => { const s = String(v || "").trim();
  if(/^\d{5}(\.\d+)?$/.test(s)){ const d = new Date(Math.round((+s - 25569) * 86400000)); return {d: d.toISOString().slice(0, 10), t: d.toISOString().slice(11, 16)}; }   // Excel serial (wall time)
  const m = s.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\D+(\d{1,2}):(\d{2})/); if(m) return {d: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, t: `${m[4].padStart(2, "0")}:${m[5]}`};
  const n = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/); return n ? {d: `${n[1]}-${n[2]}-${n[3]}`, t: `${n[4].padStart(2, "0")}:${n[5]}`} : null; };
const paxMin = t => { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const paxPlate = p => { const n = norm(p); return Object.values(S.vehicles).find(v => { const q = norm(v.plate); return q === n || q.replace(/\D/g, "") === n.replace(/\D/g, ""); }); };

/* ---------- import ---------- */
async function paxRead(file){
  if(!window.XLSX){ toast("The Excel tool is still loading – try again in a moment."); return; }
  const buf = await file.arrayBuffer(), head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 400)).toLowerCase();
  const wb = /<html|<table/.test(head) || /\.csv$/i.test(file.name) ? XLSX.read(new TextDecoder().decode(buf), {type: "string", raw: true}) : XLSX.read(buf, {type: "array", cellDates: false});
  const out = []; let found = false;
  for(const name of wb.SheetNames){
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], {header: 1, defval: "", raw: false}); let C = null;
    aoa.forEach(r => { const L = r.map(c => String(c || "").toLowerCase().trim());
      if(!C && L.some(c => /passenger/.test(c)) && L.some(c => /seat/.test(c))){ const col = re => L.findIndex(c => re.test(c)); C = {v: col(/vehicle/), s: col(/from date|start time|from/), e: col(/to date|end time|^to/), from: col(/start loc/), to: col(/end loc/), pax: col(/^passenger/), km: col(/distance/), seats: col(/seat/), drv: col(/driver/)}; found = true; return; }
      if(!C) return; const plate = String(r[C.v] || "").trim(), s = paxWhen(r[C.s]), e = paxWhen(r[C.e]);
      if(!plate || !s || !/^L?\s?\d/i.test(plate) || (C.pax >= 0 && /^no$/i.test(String(r[C.pax]).trim()))) return;
      out.push({plate, d: s.d, s: s.t, e: e ? e.t : s.t, ed: e ? e.d : s.d, km: r2(num(String(r[C.km] || "").replace(/[^\d.]/g, ""))), seats: num(r[C.seats]) || 1,
        from: String(r[C.from] || "").replace(/, *$/, "").slice(0, 90), to: String(r[C.to] || "").replace(/, *$/, "").slice(0, 90)}); });
  }
  if(!found){ toast("This is not the tracker's Trip Passenger report (Reports → Trip Passenger Excel Download)."); return; }
  const cars = {}; out.forEach(r => { const v = paxPlate(r.plate); r.vid = v ? v.id : ""; cars[r.plate] = r.vid; });
  S.paxImp = {file: file.name, rows: out, cars}; render();
}
async function paxSave(){
  const I = S.paxImp; if(!I) return; const byDay = {}; I.rows.forEach(r => (byDay[r.d] ||= []).push(r)); let added = 0, dup = 0;
  for(const [day, L] of Object.entries(byDay)){
    const ref = S.db.doc("gpspax/" + day), snap = await ref.get(), rows = snap.exists ? {...(snap.data().rows || {})} : {};
    for(const r of L){ const id = norm(r.plate + "_" + r.d + "_" + r.s).slice(0, 60); if(rows[id]){ dup++; continue; } rows[id] = {p: r.plate, v: r.vid, s: r.s, e: r.e, ed: r.ed, km: r.km, seats: r.seats, from: r.from, to: r.to}; added++; }
    if(!await writeOk(ref.set({date: day, rows}))) return;
  }
  S.paxImp = null; S.pax = null; toast(`${added} passenger journey(s) imported, ${dup} already there.`); render();
}

/* ---------- data and matching ---------- */
async function paxLoad(){
  const key = S.from + "|" + S.to; S.pax = {key, loading: true};
  try{ const snap = await S.db.collection("gpspax").where("date", ">=", S.from).where("date", "<=", S.to).get(), rows = [];
    snap.docs.forEach(d => Object.entries((d.data() || {}).rows || {}).forEach(([id, r]) => rows.push({id, d: d.id, ...r, v: r.v || ((paxPlate(r.p) || {}).id || "")})));
    try{ const rv = await S.db.collection("gpsreview").get(); S.gpsReview = S.gpsReview || {}; rv.docs.forEach(x => S.gpsReview[x.id] = x.data()); }catch(e){}
    if(S.pax && S.pax.key === key) S.pax = {key, rows}; }
  catch(e){ S.pax = {key, error: e.message}; }
  render();
}
const paxReady = () => S.pax && S.pax.rows && S.pax.key === S.from + "|" + S.to;
async function paxEnsure(){ if(!paxReady()) await paxLoad(); return paxReady(); }
function paxAudit(){
  if(!paxReady()) return [];
  const R = paxRange(), wins = {};
  const seen = new Set(); (S.trips || []).filter(t => t.tr || t.f).forEach(t => { const v = vehicleForTrip(t), k = t.tr || t.id; if(!v || seen.has(k)) return; seen.add(k);
    const a = paxMin(t.ts || t.t); if(a == null) return; let b = paxMin(t.te); if(b == null) b = a + Math.max(15, Math.round((t.km || 0) * 2)); if(b < a) b += 1440; (wins[v + "|" + t.d] ||= []).push({a, b, dr: t.dr, no: t.no || ""}); });
  return S.pax.rows.map(x => { const a = paxMin(x.s), b0 = paxMin(x.e), b = b0 == null ? a : (b0 < a ? b0 + 1440 : b0), win = (wins[x.v + "|" + x.d] || []).sort((p, q) => p.a - q.a);
    const w = win.find(w => Math.min(b, w.b + PAX_TOL) - Math.max(a, w.a - PAX_TOL) > 0), dur = b - a, id = "pax_" + x.id, rv = (S.gpsReview || {})[id] || {};
    let dr = "", how = "", level = "", term = "trip", near = null;
    if(w){ dr = w.dr; how = "his platform trip " + (w.no || ""); }
    else { const pk = win.find(t => t.a >= b && t.a - b <= R.nearMin), dp = win.slice().reverse().find(t => a >= t.b && a - t.b <= R.nearMin);
      if(x.km <= R.parkKm) term = "park"; else if(pk && x.km <= R.nearKm){ term = "pickup"; near = pk; } else if(dp && x.km <= R.nearKm){ term = "drop"; near = dp; } else term = "none";
      if(near){ dr = near.dr; how = (term === "pickup" ? "before" : "after") + " his trip " + (near.no || ""); }
      else { const who = typeof gpsWho === "function" ? gpsWho(x.v, x.d, {a, b}, win, {...gpsRange(), attrMin: R.attrMin}) : {dr: "", how: ""}; dr = who.dr; how = who.how; }
      level = term === "none" ? (x.km >= 3 && dur >= 3 ? "high" : "medium") : "low"; }
    return {...x, rid: id, a, b, dur, match: !!w, term, no: w ? w.no : near ? near.no : "", dr: rv.dr || dr, how: rv.dr ? "set by hand" : how, level, status: rv.status || "open", note: rv.note || ""}; })
    .sort((p, q) => q.d.localeCompare(p.d) || String(p.s).localeCompare(String(q.s)) || String(p.p).localeCompare(String(q.p)));
}
function paxDriver(id){
  if(!paxReady()) return null; const all = paxAudit(), mine = all.filter(x => x.dr === id), on = mine.filter(x => x.match), off = mine.filter(x => !x.match), sus = off.filter(x => x.level !== "low"), c = st => sus.filter(x => x.status === st).length;
  return {all: mine, on, off, sus, onKm: r2(sum(on, x => x.km)), offKm: r2(sum(sus, x => x.km)), high: sus.filter(x => x.level === "high").length, short: off.filter(x => x.level === "low").length,
    explained: c("explained"), confirmed: c("confirmed"), open: c("open") + c("discussed"), cars: [...new Set(mine.map(x => x.v))], days: [...new Set(mine.map(x => x.d))].sort()};
}
const paxDur = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const paxLevel = l => `<span class="pill ${l === "high" ? "bad" : l === "medium" ? "warn" : ""}">${l === "high" ? "High" : l === "medium" ? "Medium" : "Short"}</span>`;

/* ---------- the page on GPS tracking ---------- */
function paxView(mode){
  const I = S.paxImp;
  const imp = `<div class="section"><div class="head"><div><h3 style="margin:0">Import the Trip Passenger report</h3><p class="sub">Tracking portal → Vehicle Reports → General → <b>Trip Passenger Excel Download</b> → From / To date, All Vehicles → Generate → download, then drop the file here. Journeys already imported are skipped.</p></div></div>
    <label class="drop" for="paxFile"><b>Drop the Trip Passenger report here (.xls / .xlsx / .csv)</b><br>or click to choose<input type="file" id="paxFile" accept=".xls,.xlsx,.csv" hidden></label>
    ${I ? `<div style="margin-top:10px"><b>${esc(I.file)}</b> – ${I.rows.length} passenger journeys · ${[...new Set(I.rows.map(r => r.d))].length} day(s) · ${fmt(sum(I.rows, r => r.km))} km${Object.entries(I.cars).some(([, v]) => !v) ? ` · <b class="neg">not in Vehicles: ${esc(Object.entries(I.cars).filter(([, v]) => !v).map(([p]) => p).join(", "))}</b>` : ""}
      <div class="row" style="margin-top:6px"><button class="btn primary" data-paxgo="1" ${S.canWrite ? "" : "disabled"}>Import ${I.rows.length} journeys</button><button class="btn ghost" data-paxcancel="1">Cancel</button></div></div>` : ""}</div>`;
  if(mode === "import") return imp + paxOldBox();
  if(!S.db) return "";
  if(!paxReady()){ if(!(S.pax && S.pax.loading)) paxLoad(); return '<div class="section"><p class="sub">Loading the passenger journeys…</p></div>'; }
  const all = paxAudit();
  if(!all.length) return `<div class="section"><div class="empty"><b>No passenger journeys for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</b>Import the Trip Passenger report on the Import tab, or change the period.<div class="row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-gpstab="import">Import</button></div></div></div>`;
  if(mode === "data") return paxDataView(all);
  const off = all.filter(x => !x.match), sus = off.filter(x => x.level !== "low");
  const L = all.filter(x => (!S.paxOnly || (!x.match && x.level !== "low")) && (!S.paxDrv || x.dr === S.paxDrv) && (!S.paxCar || x.v === S.paxCar)), pg = paged("pax", L);
  const drvs = [...new Set(all.map(x => x.dr).filter(Boolean))].sort((a, b) => dName(a).localeCompare(dName(b)));
  return `<div class="section"><div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">Passenger journeys</div><div class="v">${all.length}</div><div class="n">${fmt(sum(all, x => x.km))} km</div></div>
      <div class="kpi"><div class="l">On a platform trip</div><div class="v">${all.length - off.length}</div><div class="n">${Math.round(100 * (all.length - off.length) / all.length)}%</div></div>
      <div class="kpi"><div class="l">No platform trip</div><div class="v neg">${sus.length}</div><div class="n">${fmt(sum(sus, x => x.km))} km · ${sus.filter(x => x.level === "high").length} high</div></div>
      <div class="kpi"><div class="l">Confirmed private rides</div><div class="v ${sus.some(x => x.status === "confirmed") ? "neg" : ""}">${sus.filter(x => x.status === "confirmed").length}</div><div class="n">${sus.filter(x => x.status === "open").length} still open</div></div></div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px;gap:6px"><div class="row" style="gap:6px"><label class="small"><input type="checkbox" id="paxOnly" ${S.paxOnly ? "checked" : ""}> Only "No trip"</label>
      <select id="paxDrv" aria-label="Driver">${opts(Object.fromEntries(drvs.map(d => [d, dName(d)])), S.paxDrv, "All drivers")}</select><select id="paxCar" aria-label="Car">${listOpts(S.vehicles, v => vName(v.id), S.paxCar, "All cars")}</select></div>
      <div class="row" style="gap:6px">${dlBtn("pax")}<button class="btn sm primary" data-paxpdf="${esc(S.paxDrv)}" ${S.paxDrv ? "" : 'disabled title="Choose a driver first"'}>Driver audit (PDF)</button></div></div>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Seat taken</th><th>Car</th><th class="num">Seats</th><th class="num">km</th><th>From → To</th><th>Trip No</th><th>Driver</th><th>Term</th><th>Status</th><th>Note</th></tr></thead><tbody>
    ${pg.rows.map(x => `<tr${x.term === "none" ? ' style="background:var(--bad-bg, #fdecec)"' : ""}><td>${esc(dmyS(x.d))}</td><td>${esc(x.s)}–${esc(x.e)}<div class="small muted">${paxDur(x.dur)}</div></td><td>${esc(vName(x.v) || x.p)}</td><td class="num">${x.seats}</td><td class="num">${fmt(x.km)}</td>
      <td class="small" style="white-space:normal;min-width:200px">${esc(x.from)} → ${esc(x.to)}</td><td class="small">${x.no ? `<button class="btn sm ghost" data-gototrip="${x.no}" style="padding:1px 6px">Trip ${x.no}</button>` : "—"}</td>
      <td class="small">${x.dr ? esc(dName(x.dr)) : '<span class="muted">unknown</span>'}${x.how && !x.match ? `<div class="muted">${esc(x.how)}</div>` : ""}</td><td>${paxTerm(x)}</td>
      <td>${x.match ? "" : `<select data-paxst="${esc(x.rid)}" aria-label="Status" ${S.canWrite ? "" : "disabled"}>${opts(SUS_STATUS, x.status)}</select>`}</td><td>${x.match ? "" : `<input data-paxnote="${esc(x.rid)}" value="${esc(x.note)}" placeholder="what the driver said" style="min-width:150px" ${S.canWrite ? "" : "disabled"}>`}</td></tr>`).join("") || '<tr><td colspan="11" class="muted">Nothing with these filters.</td></tr>'}
    </tbody><tfoot><tr><td colspan="4">${L.length} journey(s)</td><td class="num">${fmt(sum(L, x => x.km))}</td><td colspan="6"></td></tr></tfoot></table></div>${pg.bar}
    ${paxRangeForm()}
    <p class="small muted" style="margin-top:6px">A passenger journey is on a platform trip when one of the car's Uber / Bolt / Yango trips runs at the same time (${PAX_TOL} min either side). Without one: <b>Parking</b> – the car moved no more than the parking km (waiting, a bag on the seat); <b>Pickup / Drop-off</b> – it ends just before or starts just after one of the car's trips (within the minutes and km set above: the rider sat in before the trip was started in the app, or got out after it was ended) and goes to that trip's driver; everything else is <b>No trip</b> – a ride outside the apps, given to the driver of the trips around it (else the nearest trip within the minutes set, else the car's assigned driver). No trip – High: 3 km or more; Medium: shorter. Only "No trip" goes on the reports.</p></div>`;
}
// the minutes for giving a journey without a trip to a driver (saved with the other tracker ranges)
function paxRangeForm(){ const R = paxRange();
  return `<form class="form" id="fPaxRange" style="margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))"><div class="f wide"><b>Ranges for the terms</b></div>
    <div class="f"><label for="prp">Parking – km at most</label><input id="prp" name="gpsParkKm" type="number" step="0.5" min="0" value="${R.parkKm}"></div>
    <div class="f"><label for="prm">Pickup / Drop-off – minutes from the trip</label><input id="prm" name="paxNearMin" type="number" step="1" min="0" value="${R.nearMin}"></div>
    <div class="f"><label for="prk">Pickup / Drop-off – km at most</label><input id="prk" name="paxNearKm" type="number" step="0.5" min="0" value="${R.nearKm}"></div>
    <div class="f"><label for="pra">No trip – driver of the nearest trip within (min)</label><input id="pra" name="gpsAttrMin" type="number" step="5" min="0" value="${R.attrMin}"></div>
    <div class="f" style="align-self:end"><button class="btn" type="submit" ${S.canWrite ? "" : "disabled"}>Save ranges</button></div></form>`; }
document.addEventListener("submit", async ev => { if(ev.target.id !== "fPaxRange") return; ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target).entries());
  if(await writeOk(S.db.doc("settings/main").set({...S.settings, gpsParkKm: num(d.gpsParkKm), paxNearMin: num(d.paxNearMin), paxNearKm: num(d.paxNearKm), gpsAttrMin: num(d.gpsAttrMin)}))){ toast("Ranges saved."); setTimeout(render, 300); } });
/* ---------- Passenger data: every journey of the report as imported, with the platform trip it sits on ---------- */
function paxDataView(all){
  const L = all.filter(x => (!S.paxTermF || x.term === S.paxTermF) && (!S.paxDrv || x.dr === S.paxDrv) && (!S.paxCar || x.v === S.paxCar)).sort((a, b) => b.d.localeCompare(a.d) || String(b.s).localeCompare(String(a.s)) || String(a.p).localeCompare(String(b.p))), pg = paged("paxdata", L);   // latest first
  const drvs = [...new Set(all.map(x => x.dr).filter(Boolean))].sort((a, b) => dName(a).localeCompare(dName(b))), days = [...new Set(all.map(x => x.d))].sort(), st = L.indexOf(pg.rows[0]);
  return `<div class="section"><p class="sub">Every passenger journey of the Trip Passenger report in ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))} (data from ${esc(dmyS(days[0]))} to ${esc(dmyS(days[days.length - 1]))}), with its term and the platform trip it belongs to.</p>
    <div class="kpis" style="margin-bottom:8px">${Object.entries(PAX_TERM).map(([k, l]) => { const c = all.filter(x => x.term === k); return `<div class="kpi"><div class="l">${l}</div><div class="v ${k === "none" && c.length ? "neg" : ""}">${c.length}</div><div class="n">${fmt(sum(c, x => x.km))} km</div></div>`; }).join("")}</div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px;gap:6px"><div class="row" style="gap:6px"><select id="paxTermF" aria-label="Term">${opts(PAX_TERM, S.paxTermF || "", "All terms")}</select><select id="paxDrv" aria-label="Driver">${opts(Object.fromEntries(drvs.map(d => [d, dName(d)])), S.paxDrv, "All drivers")}</select><select id="paxCar" aria-label="Car">${listOpts(S.vehicles, v => vName(v.id), S.paxCar, "All cars")}</select></div>${dlBtn("paxdata")}</div>
    <div class="tbl"><table><thead><tr><th class="num">S.No</th><th>Date</th><th>Seat taken</th><th>Seat free</th><th class="num">Min</th><th>Car</th><th class="num">Seats</th><th class="num">km</th><th>From</th><th>To</th><th>Term</th><th>Trip No</th><th>Driver</th><th></th></tr></thead><tbody>
    ${pg.rows.map((x, i) => `<tr><td class="num">${st + i + 1}</td><td>${esc(dmyS(x.d))}</td><td>${esc(x.s)}</td><td>${esc(x.e)}</td><td class="num">${x.dur}</td><td>${esc(vName(x.v) || x.p)}</td><td class="num">${x.seats}</td><td class="num">${fmt(x.km)}</td>
      <td class="small" style="white-space:normal;min-width:140px">${esc(x.from)}</td><td class="small" style="white-space:normal;min-width:140px">${esc(x.to)}</td><td>${paxTerm(x)}</td><td class="small">${x.no ? `<button class="btn sm ghost" data-gototrip="${x.no}" style="padding:1px 6px">${x.no}</button>` : "—"}</td>
      <td class="small">${x.dr ? esc(dName(x.dr)) : '<span class="muted">unknown</span>'}</td><td>${S.canWrite ? `<button class="btn sm ghost" data-paxdel="${esc(x.d + "|" + x.id)}" aria-label="Delete">✕</button>` : ""}</td></tr>`).join("") || '<tr><td colspan="14" class="muted">Nothing with these filters.</td></tr>'}
    </tbody><tfoot><tr><td colspan="7">${L.length} journey(s)</td><td class="num">${fmt(sum(L, x => x.km))}</td><td colspan="6"></td></tr></tfoot></table></div>${pg.bar}</div>`;
}
DL.paxdata = () => { const L = paxAudit().filter(x => (!S.paxTermF || x.term === S.paxTermF) && (!S.paxDrv || x.dr === S.paxDrv) && (!S.paxCar || x.v === S.paxCar)).sort((a, b) => b.d.localeCompare(a.d) || String(b.s).localeCompare(String(a.s)));
  return [`passenger_data_${S.from}_${S.to}.csv`, [["Date", "Seat taken", "Seat free", "Minutes", "Car", "Seats", "km", "From", "To", "Term", "Trip No", "Driver"], ...L.map(x => [x.d, x.s, x.e, x.dur, vName(x.v) || x.p, x.seats, x.km, x.from, x.to, PAX_TERM[x.term] + (x.term === "none" ? " – " + x.level : ""), x.no, x.dr ? dName(x.dr) : ""])]]; };
async function paxDel(key){ const [day, id] = key.split("|"), ref = S.db.doc("gpspax/" + day), snap = await ref.get(); if(!snap.exists) return;
  const rows = {...(snap.data().rows || {})}; delete rows[id]; if(!await writeOk(ref.set({date: day, rows}))) return;
  if(S.pax && S.pax.rows) S.pax.rows = S.pax.rows.filter(x => !(x.d === day && x.id === id)); toast("Journey deleted."); render(); }
/* ---------- the old km-based GPS data (Activity report) – no longer used, removed on request ---------- */
function paxOldBox(){
  if(!S.db || !S.canWrite) return "";
  if(S.gpsOld == null){ S.gpsOld = "…"; Promise.all([S.db.collection("gps").get(), S.db.collection("gpsreview").get()]).then(([a, b]) => { S.gpsOld = {gps: a.docs.map(d => d.id), rv: b.docs.map(d => d.id).filter(id => !/^pax_/.test(id))}; render(); }).catch(() => { S.gpsOld = {gps: [], rv: []}; render(); }); }
  const O = S.gpsOld; if(typeof O !== "object" || !(O.gps.length + O.rv.length)) return "";
  return `<div class="section"><h3 style="margin-top:0">Old GPS data (Activity report)</h3><p class="sub">${O.gps.length} day(s) of the old km-based GPS data and ${O.rv.length} review note(s) are still stored. The audit now uses only the Trip Passenger report – delete them to clear the old data (the passenger journeys and their notes stay).</p>
    <button class="btn danger" data-gpsolddel="1">Delete the old GPS data</button></div>`;
}
DL.pax = () => { const L = paxAudit().filter(x => (!S.paxOnly || (!x.match && x.level !== "low")) && (!S.paxDrv || x.dr === S.paxDrv) && (!S.paxCar || x.v === S.paxCar));
  return [`passenger_audit_${S.from}_${S.to}.csv`, [["Date", "Seat taken", "Seat free", "Minutes", "Car", "Seats", "km", "From", "To", "Term", "Trip No", "Driver", "Driver found by", "Level", "Status", "Note"], ...L.map(x => [x.d, x.s, x.e, x.dur, vName(x.v) || x.p, x.seats, x.km, x.from, x.to, PAX_TERM[x.term], x.no, x.dr ? dName(x.dr) : "unknown", x.how, x.match ? "" : x.level, x.match ? "" : SUS_STATUS[x.status], x.note])]]; };

/* ---------- the driver's audit (FMS tab, salary statement) ---------- */
const PAX_CSS = `.px{font:8.2pt/1.3 "Segoe UI",Arial,sans-serif;color:#111;padding:7mm 9mm;width:297mm;box-sizing:border-box;background:#fff}
.px .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #16213a;padding-bottom:5px;margin-bottom:7px}.px .co{font:700 14pt "Segoe UI",Arial;color:#16213a}
.px .ttl{text-align:right;color:#16213a}.px .ttl b{display:block;font-size:11pt;letter-spacing:.06em}
.px table{width:100%;border-collapse:collapse;margin:0 0 6px;table-layout:fixed}.px th,.px td{border:1px solid #c5c9d2;padding:2px 4px;vertical-align:top;text-align:left;white-space:normal;overflow-wrap:anywhere;word-break:break-word;font-size:7.8pt;line-height:1.25;height:auto}
.px tr.sec th{background:#16213a;color:#fff;font-weight:600}.px th{background:#f3f4f7;font-weight:600;font-size:7.4pt}.px td.n,.px th.n{text-align:right}
.px tr.t td{font-weight:700;background:#f3f4f7}.px .bad{color:#b3261e;font-weight:700}.px tr.x td{background:#fdecec}
.px .box{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-bottom:7px}.px .box div{border:1px solid #c5c9d2;padding:4px 6px}.px .box b{display:block;font-size:11pt}.px .box span{color:#555;font-size:7.4pt}
.px .note{color:#555;font-size:7.4pt;margin:3px 0 6px}.px .sigs{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:10px;page-break-inside:avoid}.px .line{border-bottom:1px solid #333;height:26px}`;
function paxAuditHtml(id){
  const A = paxDriver(id); if(!A || !A.all.length) return "";
  const d = S.drivers[id] || {}, st = S.settings || {}, co = st.company || "Royal Rides Limousine LLC";
  const byDay = {}; A.all.forEach(x => { const k = x.d + "|" + x.v, o = byDay[k] ||= {d: x.d, v: x.v, n: 0, on: 0, off: 0, offKm: 0, km: 0}; o.n++; o.km += x.km; if(x.match) o.on++; else if(x.level !== "low"){ o.off++; o.offKm += x.km; } });
  const days = Object.values(byDay).sort((p, q) => p.d.localeCompare(q.d) || vName(p.v).localeCompare(vName(q.v)));
  return `<div class="px"><div class="hd"><div class="co">${esc(co)}</div><div class="ttl"><b>PASSENGER TRIPS AUDIT</b>${esc(d.name || "")} · ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</div></div>
    <div class="box"><div><span>Passenger journeys in his cars</span><b>${A.all.length}</b></div><div><span>On his platform trips</span><b>${A.on.length} · ${fmt(A.onKm)} km</b></div><div><span>With a passenger but NO platform trip</span><b class="${A.sus.length ? "bad" : ""}">${A.sus.length} · ${fmt(A.offKm)} km</b></div>
      <div><span>Explained / confirmed private</span><b>${A.explained} / <span class="${A.confirmed ? "bad" : ""}" style="font-size:11pt;color:inherit">${A.confirmed}</span></b></div><div><span>Not yet settled</span><b>${A.open}</b></div></div>
    ${(() => { const T = A.all.slice().sort((a, b) => a.d.localeCompare(b.d) || a.a - b.a || String(a.p).localeCompare(String(b.p))); let prev = null;
      const tot = k => T.filter(x => x.term === k);
      return `<table><colgroup>${[3, 6, 7.5, 3.5, 4, 5.5, 3, 4, 14, 14, 15, 20.5].map(w => `<col style="width:${w}%">`).join("")}</colgroup><tr class="sec"><th colspan="12">1. Activity trail – every passenger journey in his cars, in sequence (No trip = to explain)</th></tr>
      <tr><th>#</th><th>Date</th><th>Seat taken – free</th><th class="n">Min</th><th class="n">Gap</th><th>Car</th><th class="n">Seats</th><th class="n">km</th><th>From</th><th>To</th><th>Term · Trip No</th><th>Status · driver's explanation</th></tr>
      ${T.map((x, i) => { const gap = prev && prev.d === x.d && prev.v === x.v ? x.a - prev.b : null; prev = x; const no = x.term === "none";
        return `<tr${no ? ' class="x"' : ""}><td>${i + 1}</td><td>${esc(dmyS(x.d))}</td><td>${esc(x.s)} – ${esc(x.e)}</td><td class="n">${x.dur}</td><td class="n">${gap == null ? "" : paxDur(Math.max(0, gap))}</td><td>${esc(vName(x.v) || x.p)}</td><td class="n">${x.seats}</td><td class="n">${fmt(x.km)}</td><td>${esc(x.from)}</td><td>${esc(x.to)}</td>
          <td>${no ? `<b>No trip · ${x.level === "high" ? "High" : "Medium"}</b>` : esc(PAX_TERM[x.term])}${x.term === "trip" ? " · " + esc(x.no) : x.how ? `<br><span style="color:#555">${esc(x.how)}</span>` : ""}</td><td>${no ? `<b>${esc(SUS_STATUS[x.status])}</b>${x.note ? " – " + esc(x.note) : ""}` : ""}</td></tr>`; }).join("") || '<tr><td colspan="12">No passenger journeys in his cars in this period.</td></tr>'}
      <tr class="t"><td colspan="12">${Object.entries(PAX_TERM).map(([k, l]) => `${l}: ${tot(k).length} (${fmt(sum(tot(k), x => x.km))} km)`).join(" · ")}</td></tr></table>`; })()}
    <table><tr class="sec"><th colspan="7">2. Day by day</th></tr><tr><th>Date</th><th>Car</th><th class="n">Passenger journeys</th><th class="n">On his platform trips</th><th class="n">No platform trip</th><th class="n">km with no trip</th><th class="n">Passenger km</th></tr>
      ${days.map(r => `<tr><td>${esc(dmyS(r.d))}</td><td>${esc(vName(r.v))}</td><td class="n">${r.n}</td><td class="n">${r.on}</td><td class="n ${r.off ? "bad" : ""}">${r.off || ""}</td><td class="n">${r.offKm ? fmt(r.offKm) : ""}</td><td class="n">${fmt(r.km)}</td></tr>`).join("")}
      <tr class="t"><td colspan="2">Total</td><td class="n">${A.all.length}</td><td class="n">${A.on.length}</td><td class="n">${A.sus.length}</td><td class="n">${fmt(A.offKm)}</td><td class="n">${fmt(sum(A.all, x => x.km))}</td></tr></table>
    <div class="note">The car's seat sensor records every journey with someone on a seat. Each one is checked against the car's Uber / Bolt / Yango trips at that time (${PAX_TOL} minutes either side). The activity trail lists every journey in order (Gap: minutes since the car's journey before, the same day); a journey with a passenger and no platform trip (No trip, shaded) is to be explained; it is his when it falls between his trips or near one, or when the car was assigned to him. Journeys right before or after his trips (Pickup / Drop-off) and Parking (${A.short}) are left out.</div>
    <div class="sigs"><div><b>Driver</b><div class="line"></div>${esc(d.name || "")} – signature & date</div><div><b>For ${esc(co)}</b><div class="line"></div>${esc(st.signatory || "")} – signature & date</div></div></div>`;
}
// 4 lines for the salary statement
function paxSummaryRows(id){
  const L = (label, v, kind = "") => ({label, v, kind, num: true}), A = paxDriver(id);
  if(!paxReady() || !S.pax.rows.length) return [{label: '<span class="sub">No Trip Passenger report imported for this period</span>', v: null}];
  if(!A || !A.all.length) return [{label: '<span class="sub">No passenger journeys in his cars in the period</span>', v: null}];
  return [{...L("Passenger journeys on his platform trips", A.on.length), int: true}, {...L(`Passenger journeys with no platform trip (${fmt(A.offKm)} km, ${A.high} high)`, A.sus.length, A.sus.length ? "t" : ""), int: true},
    {...L(`Explained ${A.explained} · confirmed private ${A.confirmed} · not settled`, A.open, A.confirmed ? "t" : ""), int: true}, {label: '<span class="sub">Details: Passenger trips audit (next page / FMS tab)</span>', v: null}];
}
// landscape pages added to a jsPDF document (salary PDFs)
async function paxAddPages(doc, id){
  const html = paxAuditHtml(id); if(!html) return 0;
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:297mm;background:#fff"; box.innerHTML = `<style>${PAX_CSS}</style>${html}`; document.body.appendChild(box); let n = 0;
  try{ const el = box.querySelector(".px"), top0 = el.getBoundingClientRect().top, cssW = el.offsetWidth;
    const cuts = [...el.querySelectorAll("tr, .box, .note, .sigs, .hd")].map(x => x.getBoundingClientRect().bottom - top0).sort((a, b) => a - b);
    const canvas = await html2pdf().set({margin: 0, jsPDF: {unit: "mm", format: "a4", orientation: "landscape"}, html2canvas: {scale: 2, backgroundColor: "#ffffff"}}).from(el).toCanvas().get("canvas"), k = canvas.width / cssW, mm = cssW / 297, total = el.offsetHeight;
    let y = 0;
    while(y < total - 1){ const room = (n ? 210 - 14 : 210 - 7) * mm; let end = Math.max(...cuts.filter(c => c > y + 1 && c <= y + room), 0); if(end <= y + 1) end = Math.min(y + room, total); if(total - y <= room) end = total;
      const c = document.createElement("canvas"); c.width = canvas.width; c.height = Math.max(1, Math.round((end - y) * k)); c.getContext("2d").drawImage(canvas, 0, Math.round(y * k), c.width, c.height, 0, 0, c.width, c.height);
      doc.addPage("a4", "landscape"); doc.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", 0, n ? 7 : 0, 297, 297 * c.height / c.width); n++; y = end; } }
  finally{ box.remove(); }
  return n;
}
async function paxPdf(id){
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  await paxEnsure(); const html = paxAuditHtml(id); if(!html){ toast("No passenger journeys for this driver in the period."); return; }
  const d = S.drivers[id] || {}, box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:297mm;background:#fff"; box.innerHTML = `<style>${PAX_CSS}</style>${html}`; document.body.appendChild(box);
  const name = `Passenger_audit_${(d.name || "driver").replace(/[^\w]+/g, "_")}_${S.from}_${S.to}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.95}, html2canvas: {scale: 2, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "landscape"}, pagebreak: {mode: ["css", "legacy"], avoid: ["tr", ".sigs", ".box"]}}).from(box.querySelector(".px")).save(); toast("Downloaded " + name);
    for(const x of paxDriver(id).sus) if(x.status === "open") await susSave(x.rid, {status: "discussed", dr: x.dr}); render(); }
  catch(e){ toast("Could not make the PDF. Try again."); }
  box.remove();
}
// the driver's FMS tab
function paxRmsHtml(id){
  if(!paxReady()){ if(!(S.pax && S.pax.loading)) paxLoad(); return '<p class="sub">Loading the passenger journeys…</p>'; }
  if(!S.pax.rows.length) return `<div class="empty"><b>No Trip Passenger report for this period</b>Import it on GPS tracking → Passenger audit.<div class="row" style="justify-content:center;margin-top:10px"><button class="btn" data-nav="gps">GPS tracking</button></div></div>`;
  const A = paxDriver(id);
  return `<div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">Passenger journeys in his cars</div><div class="v">${A.all.length}</div></div><div class="kpi"><div class="l">On his platform trips</div><div class="v">${A.on.length}</div><div class="n">${fmt(A.onKm)} km</div></div>
      <div class="kpi"><div class="l">No platform trip</div><div class="v ${A.sus.length ? "neg" : ""}">${A.sus.length}</div><div class="n">${fmt(A.offKm)} km · ${A.high} high</div></div><div class="kpi"><div class="l">Confirmed private</div><div class="v ${A.confirmed ? "neg" : ""}">${A.confirmed}</div><div class="n">${A.open} not settled</div></div></div>
    <div class="row" style="justify-content:space-between;margin-bottom:6px;gap:6px"><select id="fmsTerm" aria-label="Term">${opts(PAX_TERM, S.fmsTerm || "", "All terms")}</select><button class="btn sm primary" data-paxpdf="${esc(id)}">Passenger trips audit (PDF)</button></div>
    ${(() => { const L = A.all.filter(x => !S.fmsTerm || x.term === S.fmsTerm).sort((a, b) => b.d.localeCompare(a.d) || String(b.s).localeCompare(String(a.s))), pg = paged("fms", L);
      return `<div class="tbl"><table><thead><tr><th>Date</th><th>Seat taken</th><th>Car</th><th class="num">Seats</th><th class="num">km</th><th>From → To</th><th>Term</th><th>Trip No</th><th>Why his</th><th>Status</th><th>Note</th></tr></thead><tbody>
      ${pg.rows.map(x => `<tr${x.term === "none" ? ' style="background:var(--bad-bg, #fdecec)"' : ""}><td>${esc(dmyS(x.d))}</td><td>${esc(x.s)}–${esc(x.e)}</td><td>${esc(vName(x.v) || x.p)}</td><td class="num">${x.seats}</td><td class="num">${fmt(x.km)}</td><td class="small" style="white-space:normal;min-width:200px">${esc(x.from)} → ${esc(x.to)}</td><td>${paxTerm(x)}</td>
        <td class="small">${x.no ? `<button class="btn sm ghost" data-gototrip="${x.no}" style="padding:1px 6px">${x.no}</button>` : "—"}</td><td class="small">${esc(x.how)}</td>
        <td>${x.term === "none" ? `<select data-paxst="${esc(x.rid)}" aria-label="Status" ${S.canWrite ? "" : "disabled"}>${opts(SUS_STATUS, x.status)}</select>` : ""}</td><td>${x.term === "none" ? `<input data-paxnote="${esc(x.rid)}" value="${esc(x.note)}" placeholder="what the driver said" ${S.canWrite ? "" : "disabled"}>` : ""}</td></tr>`).join("") || '<tr><td colspan="11" class="muted">No passenger journeys of his in this period.</td></tr>'}
      </tbody><tfoot><tr><td colspan="4">${L.length} journey(s)</td><td class="num">${fmt(sum(L, x => x.km))}</td><td colspan="6"></td></tr></tfoot></table></div>${pg.bar}`; })()}<p class="small muted" style="margin-top:6px">From the tracker's seat sensor (Trip Passenger report). This audit is printed with his salary statement.</p>`;
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest && ev.target.closest("button"); if(!t) return;
  if(t.dataset.paxgo){ t.disabled = true; t.textContent = "Importing…"; await paxSave(); return; }
  if(t.dataset.paxcancel){ S.paxImp = null; render(); return; }
  if(t.dataset.paxdel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Sure?"; return; } t.disabled = true; await paxDel(t.dataset.paxdel); return; }
  if(t.dataset.gpsolddel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again – this cannot be undone"; return; }
    t.disabled = true; t.textContent = "Deleting…"; const O = S.gpsOld; let n = 0;
    for(const id of O.gps){ if(await writeOk(S.db.doc("gps/" + id).delete())) n++; }
    for(const id of O.rv){ if(await writeOk(S.db.doc("gpsreview/" + id).delete())) n++; if(S.gpsReview) delete S.gpsReview[id]; }
    S.gpsOld = null; S.gps = null; toast(n + " old GPS record(s) deleted."); render(); return; }
  if(t.dataset.paxpdf != null){ if(!t.dataset.paxpdf){ toast("Choose a driver first."); return; } t.disabled = true; await paxPdf(t.dataset.paxpdf); t.disabled = false; return; }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.id === "paxFile" && t.files[0]) paxRead(t.files[0]).catch(e => toast("Could not read the file – " + e.message));
  if(t.id === "paxOnly"){ S.paxOnly = t.checked; render(); }
  if(t.id === "paxDrv"){ S.paxDrv = t.value; render(); }
  if(t.id === "paxCar"){ S.paxCar = t.value; render(); }
  if(t.id === "paxTermF"){ S.paxTermF = t.value; render(); }
  if(t.id === "fmsTerm"){ S.fmsTerm = t.value; render(); }
  if(t.dataset && t.dataset.paxst){ const x = paxAudit().find(y => y.rid === t.dataset.paxst); susSave(t.dataset.paxst, {status: t.value, dr: x ? x.dr : ""}).then(ok => { if(ok) toast("Saved."); render(); }); }
  if(t.dataset && t.dataset.paxnote){ const x = paxAudit().find(y => y.rid === t.dataset.paxnote); susSave(t.dataset.paxnote, {note: t.value.trim(), dr: x ? x.dr : ""}).then(ok => { if(ok) toast("Note saved."); }); }
});
["dragover", "drop"].forEach(n => document.addEventListener(n, ev => { const d = ev.target.closest && ev.target.closest("label[for=paxFile]"); if(!d) return; ev.preventDefault(); ev.stopPropagation(); if(n === "drop" && ev.dataTransfer.files[0]) paxRead(ev.dataTransfer.files[0]).catch(e => toast("Could not read the file – " + e.message)); }, true));
window.PAX = {view: paxView, read: paxRead, load: paxLoad, ready: paxReady, ensure: paxEnsure, audit: paxAudit, driver: paxDriver, auditHtml: paxAuditHtml, css: PAX_CSS, summaryRows: paxSummaryRows, addPages: paxAddPages, pdf: paxPdf, rmsHtml: paxRmsHtml};
