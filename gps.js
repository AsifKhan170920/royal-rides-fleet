/* GPS tracking (Sharyo IoT FMS): the tracker's Activity report – every stretch each car moved, with times and km –
   is imported from its Excel export and checked against the platform trips of the same car:
   - km the car moved with no platform trip going on (off-platform use), and who most likely drove it,
   - days the car moved without any trip, and days with trips while the tracker shows the car standing still
     (the trips were done in another car, or the plate on the trips is wrong).
   The tracker has no open API (its data pages work only inside its own login), so its reports are imported. */
const GPS_PORTAL = "https://sharyoiot.in/VTSV15/Reports?pUserId=1260&pModuleId=30&pListSP=rptActivity&pLinkText=Activity";
const GPS_TABS = {data: "GPS data", suspect: "Suspicious trips", audit: "Audit by car", drivers: "Audit by driver", import: "Import"};
S.susLevel = S.susLevel ?? "high"; S.susStatus = S.susStatus || ""; S.susDrv = S.susDrv || ""; S.gpsReview = S.gpsReview || {};
const SUS_STATUS = {open: "Open", discussed: "Discussed with driver", explained: "Explained – OK", confirmed: "Confirmed – private ride"};
S.gpsTab = S.gpsTab || "data"; S.gpsTerm = S.gpsTerm || ""; S.gpsDay = S.gpsDay || ""; S.gpsOff = S.gpsOff || false; S.gps = S.gps || null; S.gpsImp = S.gpsImp || null; S.gpsFlag = S.gpsFlag ?? true; S.gpsCar = S.gpsCar || ""; S.gpsOpen = S.gpsOpen || "";
/* What each stretch was, by ranges set on the GPS data tab (Settings keys gpsPickupMin / gpsPickupKm / gpsParkKm):
   Trip    – during a platform trip of the car (its start to its end, a few minutes either side)
   Pickup  – driving to the next trip: ends at most gpsPickupMin minutes before the trip starts and, with the other
             pickup stretches of that trip, within gpsPickupKm km – shown with that trip's S.No
   Parking – a short move of at most gpsParkKm km (parking, queueing, moving the car)
   No trip – anything else: the off-platform km and the stretches checked for private rides */
const GPS_TOL = 3;
const gpsRange = () => ({pickMin: num(setting("gpsPickupMin", 30)) || 30, pickKm: num(setting("gpsPickupKm", 8)) || 8, parkKm: num(setting("gpsParkKm", 1.5))});
const TERM_LABEL = {trip: "Trip", pickup: "Pickup", parking: "Parking", none: "No trip"};

const gDate = s => { const m = String(s || "").match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/); if(m) return {d: `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, t: `${m[4].padStart(2, "0")}:${m[5]}`};
  const n = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/); return n ? {d: `${n[1]}-${n[2]}-${n[3]}`, t: `${n[4].padStart(2, "0")}:${n[5]}`} : null; };
const gMin = t => { const m = String(t || "").match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
const gPlate = p => { const n = norm(p); return Object.values(S.vehicles).find(v => { const q = norm(v.plate); return q === n || q.replace(/^[a-z]+/, "") === n.replace(/^[a-z]+/, "") || q.replace(/\D/g, "") === n.replace(/\D/g, ""); }); };

/* ---------- import ---------- */
async function gpsRead(file){
  if(!window.XLSX){ toast("The Excel tool is still loading – try again in a moment."); return; }
  const isText = /\.(csv|txt)$/i.test(file.name), buf = isText ? null : await file.arrayBuffer();
  let wb; if(isText) wb = XLSX.read(await file.text(), {type: "string", raw: true});
  else { const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 400)).toLowerCase(); wb = /<html|<table/.test(head) ? XLSX.read(new TextDecoder().decode(buf), {type: "string", raw: true}) : XLSX.read(buf, {type: "array", cellDates: true}); }
  const out = []; let found = false;
  for(const name of wb.SheetNames){
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], {header: 1, defval: "", raw: false, dateNF: "dd/mm/yyyy hh:mm:ss"});
    let h = -1, C = null;
    aoa.forEach((r, i) => { const L = r.map(c => String(c || "").toLowerCase().trim());
      if(L.some(c => /start time/.test(c)) && L.some(c => /distance/.test(c))){ h = i; found = true;
        const col = re => L.findIndex(c => re.test(c)); C = {v: col(/vehicle/), drv: col(/driver/), s: col(/start time/), e: col(/end time/), from: col(/start loc/), to: col(/end loc/), st: col(/status/), km: col(/distance/)}; return; }
      if(h < 0 || !C || i <= h) return;
      const s = gDate(r[C.s]), e = gDate(r[C.e]), st = String(r[C.st] || "").toUpperCase(), plate = String(r[C.v] || "").trim();
      if(!s || !plate || !/TRAVEL|MOVING|RUNNING/.test(st)) return;
      out.push({plate, d: s.d, s: s.t, e: e ? e.t : "", ed: e ? e.d : s.d, km: r2(num(String(r[C.km] || "").replace(/[^\d.]/g, ""))), from: String(r[C.from] || "").replace(/, *$/, "").slice(0, 80), to: String(r[C.to] || "").replace(/, *$/, "").slice(0, 80), drv: C.drv >= 0 ? String(r[C.drv] || "").trim() : ""});
    });
  }
  if(!found){ toast("This is not the tracker's Activity report – open Reports → Activity, generate it and use TOOLS → Excel."); return; }
  const cars = {}; out.forEach(r => { const v = gPlate(r.plate); r.vid = v ? v.id : ""; cars[r.plate] = r.vid; });
  S.gpsImp = {file: file.name, rows: out, cars}; render();
}
async function gpsSave(){
  const I = S.gpsImp; if(!I) return; const byDay = {}; I.rows.forEach(r => (byDay[r.d] ||= []).push(r)); let added = 0, dup = 0;
  for(const [day, L] of Object.entries(byDay)){
    const ref = S.db.doc("gps/" + day), snap = await ref.get(), rows = snap.exists ? {...(snap.data().rows || {})} : {};
    for(const r of L){ const id = norm(r.plate + "_" + r.d + "_" + r.s + "_" + r.e).slice(0, 60); if(rows[id]){ dup++; continue; } rows[id] = {p: r.plate, v: r.vid, s: r.s, e: r.e, ed: r.ed, km: r.km, from: r.from, to: r.to, ...(r.drv ? {drv: r.drv} : {})}; added++; }
    if(!await writeOk(ref.set({date: day, rows}))) return;
  }
  S.gpsImp = null; S.gps = null; toast(`${added} GPS stretch(es) imported, ${dup} already there.`); render();
}

/* ---------- data for the period ---------- */
async function gpsLoad(){
  const key = S.from + "|" + S.to; S.gps = {key, loading: true};
  try{ const snap = await S.db.collection("gps").where("date", ">=", S.from).where("date", "<=", S.to).get(), rows = [];
    snap.docs.forEach(d => Object.entries((d.data() || {}).rows || {}).forEach(([id, r]) => rows.push({id, d: d.id, ...r, v: r.v || ((gPlate(r.p) || {}).id || "")})));
    try{ const rv = await S.db.collection("gpsreview").get(); S.gpsReview = {}; rv.docs.forEach(x => S.gpsReview[x.id] = x.data()); }catch(e){}
    if(S.gps && S.gps.key === key) S.gps = {key, rows}; }
  catch(e){ S.gps = {key, error: e.message}; }
  render();
}
function gpsAudit(){
  const G = S.gps.rows, T = (S.trips || []).filter(t => t.tr || t.f), days = {};
  const tripsOf = {}; T.forEach(t => { const v = vehicleForTrip(t); if(v) (tripsOf[v + "|" + t.d] ||= []).push(t); });
  G.forEach(g => { if(!g.v) return; const k = g.v + "|" + g.d; (days[k] ||= {v: g.v, d: g.d, segs: []}).segs.push(g); });
  // a car with trips but no movement counts only on a day the tracker's report covers (some car has GPS data that
  // day) and for a car the tracker follows (it has GPS data in the period)
  const gDays = new Set(G.map(g => g.d)), tracked = new Set(G.map(g => g.v).filter(Boolean));
  Object.keys(tripsOf).forEach(k => { const [v, d] = k.split("|"); if(!days[k] && gDays.has(d) && tracked.has(v)) days[k] = {v, d, segs: []}; });
  const out = Object.values(days).map(x => {
    const ts = tripsOf[x.v + "|" + x.d] || [], R = gpsRange(), seen = new Set();
    // one window per trip (rows of the same trip once): start to end; no end time → about 2 min a km, at least 15 min
    const win = ts.filter(t => { const k = t.tr || t.id; if(seen.has(k)) return false; seen.add(k); return true; })
      .map(t => { const a = gMin(t.ts || t.t); if(a == null) return null; let b = gMin(t.te); if(b == null) b = a + Math.max(15, Math.round((t.km || 0) * 2)); if(b < a) b += 1440; return {a, b, dr: t.dr, no: t.no || ""}; }).filter(Boolean).sort((p, q) => p.a - q.a);
    const segs = x.segs.map(g => { const a = gMin(g.s), b0 = gMin(g.e), b = b0 == null ? a : (b0 < a ? b0 + 1440 : b0); return {...g, a, b, term: "none", on: false, dr: "", no: ""}; }).filter(g => g.a != null).sort((p, q) => p.a - q.a);
    // a stretch is part of a trip when its middle falls in the trip (the tracker and the platform clocks differ a little)
    segs.forEach(g => { const mid = (g.a + g.b) / 2, w = win.find(w => mid >= w.a - 1 && mid <= w.b + GPS_TOL); if(w){ g.term = "trip"; g.dr = w.dr; g.no = w.no; } });
    // driving to the pick-up: the stretches just before each trip, nearest first, while within the ranges
    win.forEach(w => { let km = 0; segs.filter(g => g.term === "none" && g.b <= w.a + GPS_TOL && g.b >= w.a - R.pickMin).sort((p, q) => q.a - p.a)
      .forEach(g => { if(km + g.km > R.pickKm) return; km += g.km; g.term = "pickup"; g.dr = w.dr; g.no = w.no; }); });
    segs.forEach(g => { if(g.term === "none" && g.km <= R.parkKm) g.term = "parking"; g.on = g.term !== "none"; });
    const off = segs.filter(s => !s.on), km = r2(sum(segs, s => s.km)), offKm = r2(sum(off, s => s.km)), tripKm = r2(sum(ts, t => t.km || 0));
    const drivers = [...new Set(ts.map(t => t.dr).filter(Boolean))];
    // who most likely drove the stretches off the platforms: the driver of the nearest trip / the car's assignment
    const offBy = {}; off.forEach(s => { const w = window.driverAt ? driverAt(x.v, x.d, s.s) : {id: ""}; const k = w.id || ""; offBy[k] = r2((offBy[k] || 0) + s.km); });
    const flags = [];
    if(km >= 5 && !ts.length) flags.push("Moved without any trip");
    if(ts.length && km < 1) flags.push("Trips but the car did not move");
    if(ts.length && offKm >= 25 && offKm >= km * 0.35) flags.push("Off-platform km");
    if(tripKm > km * 1.25 + 5 && km > 0) flags.push("Trip km more than GPS km");
    const night = off.filter(s => s.a != null && (s.a % 1440 < 300) && s.km >= 3); if(night.length) flags.push("Night drive off the platforms");
    return {v: x.v, d: x.d, km, offKm, tripKm, trips: new Set(ts.map(t => t.tr || t.id)).size, drivers, offBy, segs, off, flags, first: segs.length ? segs.map(s => s.s).sort()[0] : "", last: segs.length ? segs.map(s => s.e).sort().pop() : ""};
  });
  return out.sort((a, b) => b.d.localeCompare(a.d) || vName(a.v).localeCompare(vName(b.v)));
}

/* ---------- views ---------- */
function vGps(){
  const tab = GPS_TABS[S.gpsTab] ? S.gpsTab : "audit";
  const head = `<div class="section" style="padding-bottom:6px"><div class="head"><div><h2>GPS tracking</h2><p class="sub">The tracker's movements of each car checked against the platform trips – km driven off the platforms, cars moving without trips, and trips the tracker does not confirm.</p></div>
    <div class="row"><a class="btn" href="${GPS_PORTAL}" target="_blank" rel="noopener">Open the tracking portal</a></div></div>${tabBtns("data-gpstab", tab, GPS_TABS)}</div>`;
  if(tab === "import") return head + gpsImportView();
  if(!S.db) return head;
  if(!S.gps || S.gps.key !== S.from + "|" + S.to){ if(!S.gps || !S.gps.loading) gpsLoad(); return head + `<div class="section"><p class="sub">Loading the GPS data…</p></div>`; }
  if(S.gps.loading) return head + `<div class="section"><p class="sub">Loading the GPS data…</p></div>`;
  if(S.gps.error) return head + `<div class="section"><div class="banner">Could not read the GPS data – ${esc(S.gps.error)}</div></div>`;
  if(!S.gps.rows.length) return head + `<div class="section"><div class="empty"><b>No GPS data for ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</b>Import the tracker's Activity report on the Import tab (or change the period at the top).<div class="row" style="justify-content:center;margin-top:10px"><button class="btn primary" data-gpstab="import">Import</button></div></div></div>`;
  const A = gpsAudit();
  return head + (tab === "drivers" ? gpsDriverView(A) : tab === "data" ? gpsDataView(A) : tab === "suspect" ? gpsSuspectView(A) : gpsCarView(A));
}
function gpsCarView(A){
  const L = A.filter(x => (!S.gpsFlag || x.flags.length) && (!S.gpsCar || x.v === S.gpsCar)), pg = paged("gps", L);
  const tot = {km: r2(sum(A, x => x.km)), off: r2(sum(A, x => x.offKm)), flagged: A.filter(x => x.flags.length).length};
  return `<div class="section"><div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">GPS km (all cars)</div><div class="v">${fmt(tot.km)}</div></div><div class="kpi"><div class="l">Off-platform km</div><div class="v ${tot.off ? "neg" : ""}">${fmt(tot.off)}</div><div class="n">${tot.km ? Math.round(100 * tot.off / tot.km) : 0}% of GPS km</div></div>
      <div class="kpi"><div class="l">Car-days to check</div><div class="v">${tot.flagged}</div><div class="n">of ${A.length}</div></div></div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="row" style="gap:6px"><label class="small"><input type="checkbox" id="gpsFlag" ${S.gpsFlag ? "checked" : ""}> Only days to check</label><select id="gpsCar" aria-label="Car">${listOpts(S.vehicles, v => vName(v.id), S.gpsCar, "All cars")}</select></div>${dlBtn("gps")}</div>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Car</th><th>Moving</th><th class="num">GPS km</th><th class="num">Trips</th><th class="num">Trip km</th><th class="num">Off-platform km</th><th>Drivers (trips)</th><th>Off-platform – likely driver</th><th>Check</th><th></th></tr></thead><tbody>
    ${pg.rows.map(x => { const k = x.v + "|" + x.d, open = S.gpsOpen === k;
      return `<tr><td>${esc(dmyS(x.d))}</td><td>${esc(vName(x.v))}</td><td class="small">${esc(x.first)}–${esc(x.last)}</td><td class="num">${fmt(x.km)}</td><td class="num">${x.trips}</td><td class="num">${fmt(x.tripKm)}</td><td class="num ${x.offKm >= 25 ? "neg" : ""}">${fmt(x.offKm)}</td>
        <td class="small">${esc(x.drivers.map(dName).join(", ") || "—")}</td><td class="small">${esc(Object.entries(x.offBy).filter(([, km]) => km >= 1).map(([d, km]) => (d ? dName(d) : "unknown") + " " + fmt(km) + " km").join(", ") || "—")}</td>
        <td>${x.flags.map(f => `<span class="pill ${/did not move|more than/.test(f) ? "warn" : "bad"}">${esc(f)}</span>`).join(" ") || '<span class="pill good">OK</span>'}</td><td><button class="btn sm" data-gpsopen="${esc(k)}">${open ? "Hide" : "Stretches"}</button></td></tr>
        ${open ? `<tr><td colspan="11"><div class="tbl"><table><thead><tr><th>From</th><th>To</th><th class="num">km</th><th>Start</th><th>End</th><th>On a trip</th></tr></thead><tbody>${x.segs.slice().sort((a, b) => a.s.localeCompare(b.s)).map(s => `<tr${s.on ? "" : ' style="background:var(--bad-bg, #fdecec)"'}><td>${esc(s.s)}</td><td>${esc(s.e)}</td><td class="num">${fmt(s.km)}</td><td class="small">${esc(s.from)}</td><td class="small">${esc(s.to)}</td><td class="small">${s.on ? esc(dName(s.dr)) : "<b>no trip</b>"}</td></tr>`).join("")}</tbody></table></div></td></tr>` : ""}`; }).join("") || `<tr><td colspan="11" class="muted">Nothing to check in this period.</td></tr>`}
    </tbody></table></div>${pg.bar}
    <p class="small muted" style="margin-top:6px">Each stretch is Trip (during a platform trip), Pickup (driving to the next trip within the ranges on the GPS data tab), Parking (a short move) or No trip. Off-platform km are the No-trip km, given to the driver of the nearest trip that day, else to the car's assigned driver.</p></div>`;
}
/* ---------- suspicious trips: rides the driver may have taken off the apps ----------
   A driver can switch the platform app off, agree a fare with a rider and keep the cash – the platforms show nothing,
   but the tracker records the drive. Stretches with no platform trip are joined into journeys (stops under 10 min
   are part of the same journey) and graded:
   High   – between two platform trips of the day, or at night (00:00–05:00), 5 km or more; or 10 km+ on a day
            the car made no platform trip at all
   Medium – any other journey of 8 km or more
   Low    – a drive before the first / after the last trip of the day (going to work / home), 3 km or more
   Each one can be marked Open / Discussed / Explained / Confirmed with a note, and printed per driver to discuss. */
function gpsSuspects(A){
  const out = [];
  A.forEach(x => {
    const segs = x.segs.filter(g => g.a != null).sort((p, q) => p.a - q.a); if(!segs.length) return;
    const on = segs.filter(g => g.term === "trip"), firstOn = on.length ? on[0].a : null, lastOn = on.length ? Math.max(...on.map(g => g.b ?? g.a)) : null;
    const J = []; let cur = null;
    segs.forEach(g => { if(g.on){ cur = null; return; }
      if(cur && g.a - cur.b <= 10){ cur.b = Math.max(cur.b, g.b ?? g.a); cur.km = r2(cur.km + g.km); cur.to = g.to; cur.e = g.e; cur.n++; }
      else { cur = {a: g.a, b: g.b ?? g.a, km: g.km, from: g.from, to: g.to, s: g.s, e: g.e, n: 1}; J.push(cur); } });
    J.forEach(j => {
      const dur = j.b - j.a; if(j.km < 3 || dur < 6) return;
      const night = j.a % 1440 < 300, noTrips = !x.trips, between = firstOn != null && j.a > firstOn && j.a < lastOn;
      const where = noTrips ? "No platform trip all day" : between ? "Between platform trips" : firstOn != null && j.a <= firstOn ? "Before the first trip of the day" : "After the last trip of the day";
      const level = (between && j.km >= 5) || (night && j.km >= 5) || (noTrips && j.km >= 10) ? "high" : j.km >= 8 ? "medium" : "low";
      const w = window.driverAt ? driverAt(x.v, x.d, j.s) : {id: "", how: ""}, id = norm(x.v + "_" + x.d + "_" + j.s).slice(0, 60), rv = S.gpsReview[id] || {};
      out.push({id, v: x.v, d: x.d, s: j.s, e: j.e, km: j.km, dur, from: j.from, to: j.to, stops: j.n - 1, where: where + (night ? " · at night" : ""), level, dr: rv.dr || w.id || "", how: rv.dr ? "set by hand" : w.how, status: rv.status || "open", note: rv.note || ""});
    });
  });
  return out.sort((p, q) => q.d.localeCompare(p.d) || String(p.s).localeCompare(String(q.s)));
}
const susLevelPill = l => `<span class="pill ${l === "high" ? "bad" : l === "medium" ? "warn" : ""}">${l === "high" ? "High" : l === "medium" ? "Medium" : "Low"}</span>`;
const susDur = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
function susFilter(L){ return L.filter(x => (!S.susLevel || (S.susLevel === "high" ? x.level === "high" : S.susLevel === "medium" ? x.level !== "low" : true)) && (!S.susStatus || x.status === S.susStatus) && (!S.susDrv || x.dr === S.susDrv) && (!S.gpsCar || x.v === S.gpsCar)); }
function gpsSuspectView(A){
  const all = gpsSuspects(A), L = susFilter(all), pg = paged("gpssus", L), cnt = k => all.filter(x => x.level === k).length;
  const drvs = [...new Set(all.map(x => x.dr).filter(Boolean))].sort((a, b) => dName(a).localeCompare(dName(b)));
  return `<div class="section"><p class="sub">Journeys the tracker recorded with no platform trip going on – a driver may have switched the app off and taken the rider privately. Check each one with the driver; mark what he says. A journey before the first or after the last trip of the day is usually the drive to work or home (Low).</p>
    <div class="kpis" style="margin-bottom:10px"><div class="kpi"><div class="l">High</div><div class="v neg">${cnt("high")}</div><div class="n">${fmt(sum(all.filter(x => x.level === "high"), x => x.km))} km</div></div><div class="kpi"><div class="l">Medium</div><div class="v">${cnt("medium")}</div></div><div class="kpi"><div class="l">Low</div><div class="v">${cnt("low")}</div></div>
      <div class="kpi"><div class="l">Still open</div><div class="v">${all.filter(x => x.status === "open" && x.level !== "low").length}</div><div class="n">high + medium</div></div><div class="kpi"><div class="l">Confirmed private rides</div><div class="v ${all.some(x => x.status === "confirmed") ? "neg" : ""}">${all.filter(x => x.status === "confirmed").length}</div></div></div>
    <div class="row" style="justify-content:space-between;margin-bottom:8px;gap:6px"><div class="row" style="gap:6px"><select id="susLevel" aria-label="Level">${opts({high: "High only", medium: "High + medium", all: "All levels"}, S.susLevel || "all")}</select><select id="susStatus" aria-label="Status">${opts(SUS_STATUS, S.susStatus, "Any status")}</select>
      <select id="susDrv" aria-label="Driver">${opts(Object.fromEntries(drvs.map(d => [d, dName(d)])), S.susDrv, "All drivers")}</select><select id="gpsCar" aria-label="Car">${listOpts(S.vehicles, v => vName(v.id), S.gpsCar, "All cars")}</select></div>
      <div class="row" style="gap:6px">${dlBtn("gpssus")}<button class="btn sm primary" data-susrpt="${esc(S.susDrv)}" ${S.susDrv ? "" : 'disabled title="Choose a driver first"'}>Driver discussion report (PDF)</button></div></div>
    <div class="tbl"><table><thead><tr><th>Date</th><th>Time</th><th>Car</th><th>Driver</th><th class="num">km</th><th>Duration</th><th>From → To</th><th>Why</th><th>Level</th><th>Status</th><th>Note</th></tr></thead><tbody>
    ${pg.rows.map(x => `<tr><td>${esc(dmyS(x.d))}</td><td>${esc(x.s)}–${esc(x.e)}</td><td>${esc(vName(x.v))}</td><td class="small">${x.dr ? esc(dName(x.dr)) : '<span class="muted">unknown</span>'}${x.how ? `<div class="muted">${esc(x.how)}</div>` : ""}</td><td class="num">${fmt(x.km)}</td><td class="small">${susDur(x.dur)}${x.stops ? ` · ${x.stops} stop(s)` : ""}</td>
      <td class="small" style="white-space:normal;min-width:180px">${esc(x.from)} → ${esc(x.to)}</td><td class="small">${esc(x.where)}</td><td>${susLevelPill(x.level)}</td>
      <td><select data-susst="${esc(x.id)}" aria-label="Status" ${S.canWrite ? "" : "disabled"}>${opts(SUS_STATUS, x.status)}</select></td><td><input data-susnote="${esc(x.id)}" value="${esc(x.note)}" placeholder="what the driver said" style="min-width:160px" ${S.canWrite ? "" : "disabled"}></td></tr>`).join("") || '<tr><td colspan="11" class="muted">Nothing suspicious with these filters.</td></tr>'}
    </tbody><tfoot><tr><td colspan="4">${L.length} journey(s)</td><td class="num">${fmt(sum(L, x => x.km))}</td><td colspan="6"></td></tr></tfoot></table></div>${pg.bar}</div>`;
}
DL.gpssus = () => { const L = S.gps && S.gps.rows ? susFilter(gpsSuspects(gpsAudit())) : [];
  return [`suspicious_trips_${S.from}_${S.to}.csv`, [["Date", "Start", "End", "Car", "Driver", "km", "Minutes", "From", "To", "Why", "Level", "Status", "Note"], ...L.map(x => [x.d, x.s, x.e, vName(x.v), x.dr ? dName(x.dr) : "unknown", x.km, x.dur, x.from, x.to, x.where, x.level, SUS_STATUS[x.status], x.note])]]; };
async function susSave(id, patch){
  const old = S.gpsReview[id] || {}, rec = {...old, ...patch, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()};
  if(await writeOk(S.db.doc("gpsreview/" + id).set(rec))){ S.gpsReview[id] = rec; return true; } return false;
}
/* the paper to sit down with the driver: every suspicious journey of the period, what he says, signatures */
async function susReport(drId){
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  if(!gpsReady()) await gpsLoad();
  const L = gpsSuspects(gpsAudit()).filter(x => x.dr === drId && x.level !== "low"), d = S.drivers[drId] || {}, st = S.settings || {}, co = st.company || "Royal Rides Limousine LLC";
  if(!L.length){ toast("No high or medium suspicious journeys for this driver in the period."); return; }
  const css = `.sr{font:8.6pt/1.35 "Segoe UI",Arial,sans-serif;color:#111;padding:8mm 10mm;width:210mm;box-sizing:border-box;background:#fff}.sr h1{font-size:13pt;margin:0;color:#16213a}.sr .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #16213a;padding-bottom:6px;margin-bottom:8px}
    .sr table{width:100%;border-collapse:collapse;margin-bottom:8px}.sr th,.sr td{border:1px solid #c5c9d2;padding:3px 5px;vertical-align:top;text-align:left}.sr th{background:#16213a;color:#fff;font-weight:600;font-size:8pt}.sr td.n{text-align:right}.sr .ans{height:26px}
    .sr .note{background:#f3f4f7;padding:6px 8px;margin:6px 0 10px;font-size:8pt}.sr .sigs{display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-top:16px}.sr .line{border-bottom:1px solid #333;height:30px}`;
  const html = `<div class="sr"><div class="hd"><div><h1>${esc(co)}</h1><div>Vehicle usage – journeys without a platform trip</div></div><div style="text-align:right"><b>DRIVER DISCUSSION REPORT</b><br>${esc(dmyS(S.from))} – ${esc(dmyS(S.to))}</div></div>
    <table><tr><td style="width:18%;background:#f3f4f7">Driver</td><td><b>${esc(d.name || "")}</b></td><td style="width:18%;background:#f3f4f7">Journeys to explain</td><td>${L.length} · ${fmt(sum(L, x => x.km))} km</td></tr></table>
    <div class="note">The car's tracker recorded these journeys while no Uber, Bolt or Yango trip was going on for the car. Please explain each one (e.g. fuel, car wash, workshop, going home with company permission). A journey taken with a rider outside the platforms is against company rules.</div>
    <table><tr><th>#</th><th>Date</th><th>Time</th><th>Car</th><th>km</th><th>From → To</th><th>Why flagged</th><th style="width:26%">Driver's explanation</th></tr>
    ${L.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(dmyS(x.d))}</td><td>${esc(x.s)}–${esc(x.e)}<br><span style="color:#666">${susDur(x.dur)}</span></td><td>${esc(vName(x.v))}</td><td class="n">${fmt(x.km)}</td><td>${esc(x.from)} → ${esc(x.to)}</td><td>${esc(x.where)}${x.level === "high" ? " <b>(high)</b>" : ""}</td><td class="ans">${esc(x.note)}</td></tr>`).join("")}</table>
    <div class="sigs"><div><b>Driver</b><div class="line"></div>${esc(d.name || "")} – signature & date</div><div><b>For ${esc(co)}</b><div class="line"></div>${esc(st.signatory || "")} – signature & date</div></div></div>`;
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff"; box.innerHTML = `<style>${css}</style>${html}`; document.body.appendChild(box);
  const name = `Discussion_${(d.name || "driver").replace(/[^\w]+/g, "_")}_${S.from}_${S.to}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.97}, html2canvas: {scale: 2, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}, pagebreak: {mode: ["css", "legacy"], avoid: ["tr", ".sigs"]}}).from(box.querySelector(".sr")).save(); toast("Downloaded " + name);
    for(const x of L) if(x.status === "open") await susSave(x.id, {status: "discussed", dr: x.dr}); render(); }
  catch(e){ toast("Could not make the PDF. Try again."); }
  box.remove();
}

/* every stretch the tracker recorded in the period, with the trip it belongs to (or none) */
function gpsSegs(A){ return A.flatMap(x => x.segs.map(g => ({...g, v: x.v, d: x.d}))).sort((a, b) => b.d.localeCompare(a.d) || vName(a.v).localeCompare(vName(b.v)) || String(a.s).localeCompare(String(b.s))); }
function gpsDataView(A){
  const all = gpsSegs(A); all.slice().sort((p, q) => (p.d + p.s).localeCompare(q.d + q.s) || vName(p.v).localeCompare(vName(q.v))).forEach((g, i) => g.sn = i + 1);
  const L = all.filter(g => (!S.gpsCar || g.v === S.gpsCar) && (!S.gpsDay || g.d === S.gpsDay) && (!S.gpsOff || !g.on) && (!S.gpsTerm || g.term === S.gpsTerm)), pg = paged("gpsdata", L);
  const days = [...new Set(all.map(g => g.d))].sort(), byCar = {}; all.forEach(g => { const o = byCar[g.v] ||= {km: 0, off: 0, n: 0, days: new Set()}; o.km += g.km; o.n++; o.days.add(g.d); if(!g.on) o.off += g.km; });
  const dur = g => { const b = g.b == null ? g.a : g.b; return g.a == null ? "" : `${Math.floor((b - g.a) / 60)}:${String((b - g.a) % 60).padStart(2, "0")}`; };
  return `<div class="section"><p class="sub">Every stretch each car moved in ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))} (GPS data from ${days.length ? esc(dmyS(days[0])) + " to " + esc(dmyS(days[days.length - 1])) : "—"}), with the platform trip it belongs to.</p>
    <details style="margin-bottom:10px"><summary class="small" style="cursor:pointer"><b>By car</b> – ${Object.keys(byCar).length} cars · ${fmt(sum(all, g => g.km))} km</summary><div class="tbl" style="margin-top:6px"><table><thead><tr><th>Car</th><th class="num">Days</th><th class="num">Stretches</th><th class="num">GPS km</th><th class="num">km without a trip</th></tr></thead><tbody>
      ${Object.entries(byCar).sort((a, b) => b[1].km - a[1].km).map(([v, o]) => `<tr><td>${esc(v ? vName(v) : "Not in Vehicles")}</td><td class="num">${o.days.size}</td><td class="num">${o.n}</td><td class="num">${fmt(o.km)}</td><td class="num">${fmt(o.off)}</td></tr>`).join("")}</tbody></table></div></details>
    ${(() => { const R = gpsRange(), c = k => all.filter(g => g.term === k), t = k => fmt(sum(c(k), g => g.km)); return `<div class="kpis" style="margin-bottom:8px">${Object.entries(TERM_LABEL).map(([k, l]) => `<div class="kpi"><div class="l">${l}</div><div class="v ${k === "none" && c(k).length ? "neg" : ""}">${t(k)} km</div><div class="n">${c(k).length} stretch(es)</div></div>`).join("")}</div>
      <form class="form" id="fGpsRange" style="margin-bottom:10px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))"><div class="f wide"><b>Ranges</b> <span class="small muted">– driving to a pick-up must end within the minutes before the trip and stay within the km; a move up to the parking km counts as parking.</span></div>
        <div class="f"><label for="grm">Pickup – minutes before the trip</label><input id="grm" name="gpsPickupMin" type="number" step="1" min="1" value="${R.pickMin}"></div><div class="f"><label for="grk">Pickup – km at most</label><input id="grk" name="gpsPickupKm" type="number" step="0.5" min="0" value="${R.pickKm}"></div>
        <div class="f"><label for="grp">Parking – km at most</label><input id="grp" name="gpsParkKm" type="number" step="0.5" min="0" value="${R.parkKm}"></div><div class="f" style="align-self:end"><button class="btn" type="submit" ${S.canWrite ? "" : "disabled"}>Save ranges</button></div></form>`; })()}
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="row" style="gap:6px"><select id="gpsTerm" aria-label="Term">${opts(TERM_LABEL, S.gpsTerm, "All terms")}</select><select id="gpsCar" aria-label="Car">${listOpts(S.vehicles, v => vName(v.id), S.gpsCar, "All cars")}</select><select id="gpsDay" aria-label="Day">${opts(Object.fromEntries(days.map(d => [d, dmyS(d)])), S.gpsDay, "All days")}</select></div>${dlBtn("gpsdata")}</div>
    <div class="tbl"><table><thead><tr><th>S.No</th><th>Date</th><th>Car</th><th>Start</th><th>End</th><th>Duration</th><th class="num">km</th><th>From</th><th>To</th><th>Term</th><th>Trip No</th><th>Driver</th></tr></thead><tbody>
    ${pg.rows.map(g => `<tr${g.term === "none" ? ' style="background:var(--bad-bg, #fdecec)"' : ""}><td class="mono">${g.sn}</td><td>${esc(dmyS(g.d))}</td><td>${esc(vName(g.v))}</td><td>${esc(g.s)}</td><td>${esc(g.e)}</td><td class="small">${dur(g)}</td><td class="num">${fmt(g.km)}</td><td class="small" style="white-space:normal">${esc(g.from)}</td><td class="small" style="white-space:normal">${esc(g.to)}</td>
      <td><span class="pill ${g.term === "trip" ? "good" : g.term === "pickup" ? "info" : g.term === "parking" ? "" : "bad"}">${TERM_LABEL[g.term]}</span></td><td class="mono">${g.no ? `<button class="btn sm ghost" data-gototrip="${g.no}" style="padding:1px 6px">${g.no}</button>` : ""}</td><td class="small">${g.dr ? esc(dName(g.dr)) : ""}</td></tr>`).join("") || '<tr><td colspan="12" class="muted">No stretches match.</td></tr>'}
    </tbody><tfoot><tr><td colspan="6">${L.length} stretch(es)</td><td class="num">${fmt(sum(L, g => g.km))}</td><td colspan="5"></td></tr></tfoot></table></div>${pg.bar}</div>`;
}
DL.gpsdata = () => { const A = S.gps && S.gps.rows ? gpsAudit() : [], all = gpsSegs(A); all.slice().sort((p, q) => (p.d + p.s).localeCompare(q.d + q.s) || vName(p.v).localeCompare(vName(q.v))).forEach((g, i) => g.sn = i + 1);
  const L = all.filter(g => (!S.gpsCar || g.v === S.gpsCar) && (!S.gpsDay || g.d === S.gpsDay) && (!S.gpsTerm || g.term === S.gpsTerm));
  return [`gps_data_${S.from}_${S.to}.csv`, [["S.No", "Date", "Car", "Start", "End", "km", "From", "To", "Term", "Trip No", "Driver"], ...L.map(g => [g.sn, g.d, vName(g.v), g.s, g.e, g.km, g.from, g.to, TERM_LABEL[g.term], g.no || "", g.dr ? dName(g.dr) : ""])]]; };
function gpsDriverView(A){
  const by = {}; const add = (d, k, v) => { const o = by[d] ||= {d, days: new Set(), tripKm: 0, offKm: 0, flags: 0}; o[k] += v; };
  A.forEach(x => { x.drivers.forEach(d => { by[d] ||= {d, days: new Set(), tripKm: 0, offKm: 0, flags: 0}; by[d].days.add(x.d); }); const tk = {}; x.segs.filter(s => s.on && s.dr).forEach(s => tk[s.dr] = (tk[s.dr] || 0) + s.km); Object.entries(tk).forEach(([d, km]) => add(d, "tripKm", km));
    Object.entries(x.offBy).forEach(([d, km]) => { add(d || "", "offKm", km); if(x.flags.length) by[d || ""].flags++; }); });
  const L = Object.values(by).filter(o => o.tripKm + o.offKm > 0).sort((a, b) => b.offKm - a.offKm);
  return `<div class="section"><p class="sub">Km on platform trips and km off the platforms per driver (off-platform km go to the driver of the nearest trip that day, else to the car's assigned driver).</p>
    <div class="tbl"><table><thead><tr><th>Driver</th><th class="num">Days</th><th class="num">GPS km on trips</th><th class="num">Off-platform km</th><th class="num">Off-platform %</th><th class="num">Days to check</th></tr></thead><tbody>
    ${L.map(o => { const tot = o.tripKm + o.offKm, p = tot ? Math.round(100 * o.offKm / tot) : 0; return `<tr><td>${o.d ? esc(dName(o.d)) : '<span class="muted">No driver found</span>'}</td><td class="num">${o.days.size || ""}</td><td class="num">${fmt(o.tripKm)}</td><td class="num ${p >= 35 ? "neg" : ""}">${fmt(o.offKm)}</td><td class="num">${p}%</td><td class="num">${o.flags || ""}</td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">No data.</td></tr>`}
    </tbody></table></div></div>`;
}
function gpsImportView(){
  const I = S.gpsImp;
  const how = `<div class="section"><h3 style="margin-top:0">Import the tracker's Activity report</h3>
    <ol class="small" style="margin:0 0 10px 18px;line-height:1.7"><li><a href="${GPS_PORTAL}" target="_blank" rel="noopener">Open the tracking portal</a> → Vehicle Reports → General → <b>Activity</b>.</li><li>From / To date, <b>Select Vehicle: All Vehicles</b>, Generate Report.</li><li><b>TOOLS → Excel</b>, then drop the file here. Stretches already imported are skipped, so overlapping files are safe.</li></ol>
    <label class="drop" for="gpsFile"><b>Drop the Activity report here (Excel or CSV)</b><br>or click to choose<input type="file" id="gpsFile" accept=".xls,.xlsx,.csv" hidden></label>
    <p class="small muted" style="margin-top:8px">The tracker has no API open to other software – its data pages work only inside its own login – so its reports are imported. Ask Sharyo for an API (or a daily e-mailed report) and the import can be automated.</p></div>`;
  if(!I) return how;
  const days = [...new Set(I.rows.map(r => r.d))].sort(), noCar = Object.entries(I.cars).filter(([, v]) => !v).map(([p]) => p);
  return `<div class="section" style="border:1px solid var(--line)"><div class="head"><div><h3 style="margin:0">${esc(I.file)}</h3><p class="sub">${I.rows.length} moving stretches · ${Object.keys(I.cars).length} car(s) · ${days.length ? esc(dmyS(days[0])) + " – " + esc(dmyS(days[days.length - 1])) : ""} · ${fmt(sum(I.rows, r => r.km))} km${noCar.length ? ` · <b class="neg">not in Vehicles: ${esc(noCar.join(", "))}</b>` : ""}</p></div>
    <div class="row"><button class="btn ghost" data-gpscancel="1">Cancel</button><button class="btn primary" data-gpsgo="1" ${I.rows.length && S.canWrite ? "" : "disabled"}>Import ${I.rows.length} stretches</button></div></div>
    <div class="tbl" style="max-height:320px;overflow:auto"><table><thead><tr><th>Car</th><th>Date</th><th>Start</th><th>End</th><th class="num">km</th><th>From</th><th>To</th></tr></thead><tbody>${I.rows.slice(0, 200).map(r => `<tr><td>${esc(r.vid ? vName(r.vid) : r.plate)}</td><td>${esc(dmyS(r.d))}</td><td>${esc(r.s)}</td><td>${esc(r.e)}</td><td class="num">${fmt(r.km)}</td><td class="small">${esc(r.from)}</td><td class="small">${esc(r.to)}</td></tr>`).join("")}</tbody></table></div></div>` + how;
}
DL.gps = () => { const A = S.gps && S.gps.rows ? gpsAudit() : [];
  return [`gps_audit_${S.from}_${S.to}.csv`, [["Date", "Car", "First move", "Last move", "GPS km", "Trips", "Trip km", "Off-platform km", "Drivers (trips)", "Off-platform – likely driver", "Check"], ...A.map(x => [x.d, vName(x.v), x.first, x.last, x.km, x.trips, x.tripKm, x.offKm, x.drivers.map(dName).join(", "), Object.entries(x.offBy).map(([d, km]) => (d ? dName(d) : "unknown") + " " + km).join(", "), x.flags.join("; ")])]]; };

document.addEventListener("click", async ev => {
  const t = ev.target.closest && ev.target.closest("button"); if(!t) return;
  if(t.dataset.gpstab){ S.gpsTab = t.dataset.gpstab; render(); return; }
  if(t.dataset.gototrip){ S.view = "trips"; S.tripFilter = {...S.tripFilter, q: "#" + t.dataset.gototrip, driver: "", vehicle: "", platform: "", settle: ""}; render(); window.scrollTo(0, 0); return; }
  if(t.dataset.susrpt != null){ if(!t.dataset.susrpt){ toast("Choose a driver first."); return; } t.disabled = true; await susReport(t.dataset.susrpt); t.disabled = false; return; }
  if(t.dataset.gpsopen){ S.gpsOpen = S.gpsOpen === t.dataset.gpsopen ? "" : t.dataset.gpsopen; render(); return; }
  if(t.dataset.gpscancel){ S.gpsImp = null; render(); return; }
  if(t.dataset.gpsgo){ t.disabled = true; t.textContent = "Importing…"; await gpsSave(); S.gpsTab = "data"; render(); return; }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.id === "gpsFile" && t.files[0]) gpsRead(t.files[0]).catch(e => toast("Could not read the file – " + e.message));
  if(t.id === "gpsFlag"){ S.gpsFlag = t.checked; render(); }
  if(t.id === "gpsCar"){ S.gpsCar = t.value; render(); }
  if(t.id === "gpsDay"){ S.gpsDay = t.value; render(); }
  if(t.id === "gpsTerm"){ S.gpsTerm = t.value; render(); }
  if(t.id === "susLevel"){ S.susLevel = t.value === "all" ? "" : t.value; render(); }
  if(t.id === "susStatus"){ S.susStatus = t.value; render(); }
  if(t.id === "susDrv"){ S.susDrv = t.value; render(); }
  if(t.dataset && t.dataset.susst){ const x = gpsSuspects(gpsAudit()).find(y => y.id === t.dataset.susst); susSave(t.dataset.susst, {status: t.value, dr: x ? x.dr : ""}).then(ok => { if(ok) toast("Saved."); render(); }); }
  if(t.dataset && t.dataset.susnote){ const x = gpsSuspects(gpsAudit()).find(y => y.id === t.dataset.susnote); susSave(t.dataset.susnote, {note: t.value.trim(), dr: x ? x.dr : ""}).then(ok => { if(ok) toast("Note saved."); }); }
  if(t.id === "gpsOff"){ S.gpsOff = t.checked; render(); }
});
document.addEventListener("submit", async ev => { if(ev.target.id !== "fGpsRange") return; ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target).entries());
  if(await writeOk(S.db.doc("settings/main").set({...S.settings, gpsPickupMin: num(d.gpsPickupMin), gpsPickupKm: num(d.gpsPickupKm), gpsParkKm: num(d.gpsParkKm)}))){ toast("Ranges saved."); setTimeout(render, 300); } });
["dragover", "drop"].forEach(n => document.addEventListener(n, ev => { const d = ev.target.closest && ev.target.closest("label[for=gpsFile]"); if(!d) return; ev.preventDefault(); ev.stopPropagation(); if(n === "drop" && ev.dataTransfer.files[0]) gpsRead(ev.dataTransfer.files[0]).catch(e => toast("Could not read the file – " + e.message)); }, true));
/* one driver's vehicle-usage audit for the period: the car-days he drove (his trips, or off-platform km given to him) */
function gpsDriver(id){
  if(!S.gps || !S.gps.rows) return null;
  const rows = gpsAudit().map(x => { const on = r2(sum(x.segs.filter(s => s.on && s.dr === id), s => s.km)), off = r2(x.offBy[id] || 0), mine = x.drivers.includes(id) || off > 0;
    return mine ? {d: x.d, v: x.v, trips: x.drivers.includes(id) ? x.trips : 0, gpsKm: x.km, onKm: on, offKm: off, flags: x.flags.filter(f => f !== "Trip km more than GPS km" || x.drivers.includes(id)), others: x.drivers.filter(d => d !== id)} : null; }).filter(Boolean);
  const onKm = r2(sum(rows, r => r.onKm)), offKm = r2(sum(rows, r => r.offKm));
  return {rows, days: rows.length, onKm, offKm, pct: onKm + offKm ? Math.round(100 * offKm / (onKm + offKm)) : 0, flagged: rows.filter(r => r.flags.length).length};
}
const gpsReady = () => S.gps && S.gps.rows && S.gps.key === S.from + "|" + S.to;
async function gpsEnsure(){ if(!gpsReady()) await gpsLoad(); return gpsReady(); }
Object.assign(window.BOOK_VIEWS = window.BOOK_VIEWS || {}, {gps: vGps});
window.GPS = {read: gpsRead, audit: gpsAudit, load: gpsLoad, driver: gpsDriver, ready: gpsReady, ensure: gpsEnsure, suspects: () => gpsSuspects(gpsAudit()), report: susReport, levelPill: susLevelPill, dur: susDur, STATUS: SUS_STATUS};
