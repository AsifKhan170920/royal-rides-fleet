/* GPS tracking (Sharyo IoT FMS): the tracker's Activity report – every stretch each car moved, with times and km –
   is imported from its Excel export and checked against the platform trips of the same car:
   - km the car moved with no platform trip going on (off-platform use), and who most likely drove it,
   - days the car moved without any trip, and days with trips while the tracker shows the car standing still
     (the trips were done in another car, or the plate on the trips is wrong).
   The tracker has no open API (its data pages work only inside its own login), so its reports are imported. */
const GPS_PORTAL = "https://sharyoiot.in/VTSV15/Reports?pUserId=1260&pModuleId=30&pListSP=rptActivity&pLinkText=Activity";
const GPS_TABS = {audit: "Audit by car", drivers: "Audit by driver", import: "Import"};
S.gpsTab = S.gpsTab || "audit"; S.gps = S.gps || null; S.gpsImp = S.gpsImp || null; S.gpsFlag = S.gpsFlag ?? true; S.gpsCar = S.gpsCar || ""; S.gpsOpen = S.gpsOpen || "";
// a stretch with no trip within this many minutes before / after counts as off the platforms
const GPS_PRE = 45, GPS_POST = 20;

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
    const ts = tripsOf[x.v + "|" + x.d] || [], win = ts.map(t => { const a = gMin(t.ts || t.t), b = gMin(t.te) ?? (a != null ? a + 30 : null); return a == null ? null : {a: a - GPS_PRE, b: (b < a ? b + 1440 : b) + GPS_POST, dr: t.dr}; }).filter(Boolean);
    const segs = x.segs.map(g => { const a = gMin(g.s), b0 = gMin(g.e), b = b0 == null ? a : (b0 < a ? b0 + 1440 : b0); const hit = win.find(w => a <= w.b && b >= w.a); return {...g, a, b, on: !!hit, dr: hit ? hit.dr : ""}; });
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
  return head + (tab === "drivers" ? gpsDriverView(A) : gpsCarView(A));
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
    <p class="small muted" style="margin-top:6px">A stretch counts as on a trip when a platform trip in that car started up to ${GPS_PRE} minutes after it began or ended up to ${GPS_POST} minutes before it ended (driving to the pick-up included). Off-platform km are given to the driver of the nearest trip that day, else to the car's assigned driver.</p></div>`;
}
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
  if(t.dataset.gpsopen){ S.gpsOpen = S.gpsOpen === t.dataset.gpsopen ? "" : t.dataset.gpsopen; render(); return; }
  if(t.dataset.gpscancel){ S.gpsImp = null; render(); return; }
  if(t.dataset.gpsgo){ t.disabled = true; t.textContent = "Importing…"; await gpsSave(); S.gpsTab = "audit"; render(); return; }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.id === "gpsFile" && t.files[0]) gpsRead(t.files[0]).catch(e => toast("Could not read the file – " + e.message));
  if(t.id === "gpsFlag"){ S.gpsFlag = t.checked; render(); }
  if(t.id === "gpsCar"){ S.gpsCar = t.value; render(); }
});
["dragover", "drop"].forEach(n => document.addEventListener(n, ev => { const d = ev.target.closest && ev.target.closest("label[for=gpsFile]"); if(!d) return; ev.preventDefault(); ev.stopPropagation(); if(n === "drop" && ev.dataTransfer.files[0]) gpsRead(ev.dataTransfer.files[0]).catch(e => toast("Could not read the file – " + e.message)); }, true));
Object.assign(window.BOOK_VIEWS = window.BOOK_VIEWS || {}, {gps: vGps});
window.GPS = {read: gpsRead, audit: gpsAudit, load: gpsLoad};
