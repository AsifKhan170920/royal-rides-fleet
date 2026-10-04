/* RTA portal data (RTA → Import from RTA portal): the workbook extracted from the RTA corporate portal
   (ums.rta.ae / vls.rta.ae) with the sheets Summary, Payable Fines, Vehicles, Drivers, Non-Payable & Blocks,
   Reserved Plates and Certificates. Importing it:
   - Vehicles: added or updated by plate (make, model, year, colour, chassis, body, fuel, seats, origin, licence status,
     first registered, last renewed, registration expiry = Mulkiya, mortgage, insurer, policy, insurance expiry);
   - Drivers: added or updated by name or licence number (licence no., issue, expiry, status, categories, RTA unified no.);
   - Payable fines: added as road fines (ticket id, reference, date and time, car, source, violation, location, amount,
     black points, ticket type); the driver is the one whose trip in that car was going on at that time; fines already
     in the software (same ticket id) are updated, not doubled;
   - Non-payable items & blocks (circulars, service blocks) and reserved plates: kept in their own RTA tabs;
   - Certificates (NOCs, permits): RTA licences & permits with their expiry (reminded);
   - Summary: the trade licence number and expiry go to Settings → Business information.
   Nothing is deleted. */
S.rtablocks = S.rtablocks || {}; S.rtaplates = S.rtaplates || {}; S.rtaImp = S.rtaImp || null;
const MON = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
// "29-Sep-2026 11:44", "03-Dec-2026", "2026-09-29" → {date, time}
function rtaDate(v){
  const s = String(v || "").trim(); let m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ](\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
  if(m && MON[m[2].toLowerCase()]) return {date: `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`, time: m[4] ? m[4].padStart(5, "0") : ""};
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/); if(m) return {date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] || ""};
  return {date: "", time: ""};
}
const rtaSrc = s => { s = norm(s); return s.includes("dubaipolice") ? "dxbpolice" : s.includes("parking") ? "parking" : s.includes("rta") ? "rta" : s.includes("salik") ? "salik" : s.includes("abudhabi") ? "auh" : s.includes("sharjah") ? "shj" : "other"; };
const titleCase = s => String(s || "").toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).trim();
function sheetRows(wb, name){
  const ws = wb.Sheets[wb.SheetNames.find(n => norm(n) === norm(name)) || ""]; if(!ws) return [];
  const aoa = XLSX.utils.sheet_to_json(ws, {header: 1, defval: "", raw: false}); const h = aoa.findIndex(r => r.filter(x => String(x).trim()).length > 2); if(h < 0) return [];
  const head = aoa[h].map(x => String(x).trim());
  return aoa.slice(h + 1).filter(r => r.some(x => String(x).trim())).map(r => Object.fromEntries(head.map((k, i) => [k, String(r[i] ?? "").trim()])));
}
// a driver on the RTA list (full name in capitals) is matched to one in the software by licence number, or by at least
// two words of the name covering two thirds of the shorter name ("MUHAMMAD ASIF KHAN ABDUL" = "Muhammad Asif Khan")
const nameWords = n => String(n || "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(w => w.length > 1);
function findDriver(name, lic){
  const L = norm(lic); if(L){ const d = Object.values(S.drivers).find(d => norm(d.licenceNo) === L); if(d) return d; }
  const t = nameWords(name); let best = null, sc = 0;
  Object.values(S.drivers).forEach(d => { const w = nameWords(d.name), c = w.filter(x => t.includes(x)).length, s = c / Math.min(w.length || 1, t.length || 1); if(c >= 2 && s >= 0.66 && s > sc){ sc = s; best = d; } });
  if(!best && window.matchDriver){ const id = matchDriver(name, ""); if(id) best = S.drivers[id]; }
  return best;
}
const findVeh = (no, code) => { const n = norm(no); return Object.values(S.vehicles).find(v => { const p = norm(v.plate); return p === norm((code || "") + no) || p.replace(/^[a-z]+/, "") === n || p.replace(/\D/g, "") === n; }); };

async function rtaReadFile(file){
  if(!window.XLSX){ toast("The Excel tool is still loading – try again in a moment."); return; }
  const wb = XLSX.read(await file.arrayBuffer(), {type: "array"});
  const veh = sheetRows(wb, "Vehicles").filter(r => r["Plate No."]), drv = sheetRows(wb, "Drivers").filter(r => r["Driver Name"]), fines = sheetRows(wb, "Payable Fines").filter(r => (r["Ticket ID"] || r["Fine Ref No."]) && rtaDate(r["Date & Time"]).date),   // the total row at the end is left out
    blocks = sheetRows(wb, "Non-Payable & Blocks"), plates = sheetRows(wb, "Reserved Plates"), certs = sheetRows(wb, "Certificates");
  const sumAoa = wb.Sheets.Summary ? XLSX.utils.sheet_to_json(wb.Sheets.Summary, {header: 1, defval: "", raw: false}) : [], sumText = sumAoa.map(r => r.join(" ")).join("\n");
  const lic = (sumText.match(/Trade Licence No\.?\s*(\d+)/i) || [])[1] || "", licExp = rtaDate((sumText.match(/expire[ds]?\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i) || [])[1]).date, total = num((sumText.match(/Payable fines – total \(AED\)\s*([\d,.]+)/i) || [])[1]);
  if(!veh.length && !drv.length && !fines.length){ toast("This does not look like the RTA data workbook (no Vehicles, Drivers or Payable Fines sheet)."); return; }
  S.rtaImp = {name: file.name, veh, drv, fines, blocks, plates, certs, lic, licExp, total}; render();
}
function rtaImpPanel(){
  const I = S.rtaImp;
  const head = `<div class="row" style="gap:8px;align-items:center;margin-bottom:10px"><label class="btn primary" style="cursor:pointer">Choose the RTA data workbook<input type="file" accept=".xlsx,.xls" id="rtaFile" hidden></label><span class="small muted">The Excel file extracted from the RTA corporate portal – Vehicles, Drivers, Payable Fines, Non-Payable & Blocks, Reserved Plates, Certificates.</span></div>`;
  if(!I) return head + `<p class="sub">Nothing is deleted: vehicles and drivers are added or updated, fines already in the software are updated, not doubled.</p>`;
  const vNew = I.veh.filter(r => !findVeh(r["Plate No."], r["Plate Code"])).length, dNames = new Set(Object.values(S.drivers).map(d => norm(d.name))), dLic = new Set(Object.values(S.drivers).map(d => norm(d.licenceNo)).filter(Boolean));
  const dNew = I.drv.filter(r => !findDriver(r["Driver Name"], r["Licence No."])).length, known = new Set(Object.values(S.fines).map(f => norm(f.fineNo)));
  const fNew = I.fines.filter(r => !known.has(norm(r["Ticket ID"]))).length, fTot = sum(I.fines, r => num(r["Amount (AED)"]));
  const row = (l, n, nw, note) => `<tr><td>${l}</td><td class="num">${n}</td><td class="num">${nw}</td><td class="small muted">${note}</td></tr>`;
  return head + `<div class="section" style="border:1px solid var(--line)"><h3 style="margin:0 0 6px">${esc(I.name)}</h3>
    <div class="tbl"><table><thead><tr><th>Sheet</th><th class="num">Rows</th><th class="num">New</th><th>What happens</th></tr></thead><tbody>
    ${row("Vehicles", I.veh.length, vNew, "added; existing cars updated (Mulkiya and insurance expiry, chassis, make, year…)")}
    ${row("Drivers", I.drv.length, dNew, "added; existing drivers updated (licence no., expiry, categories, RTA unified no.)")}
    ${row("Payable fines", I.fines.length, fNew, `AED ${fmt(fTot)}${I.total ? ` – portal total AED ${fmt(I.total)} ${Math.abs(I.total - fTot) < 1 ? "✓" : "(differs)"}` : ""}; driver by trip time`)}
    ${row("Non-payable & blocks", I.blocks.length, I.blocks.length, "kept in RTA → Blocks & circulars")}
    ${row("Reserved plates", I.plates.length, I.plates.length, "kept in RTA → Reserved plates, reminded before the reservation ends")}
    ${row("Certificates", I.certs.length, I.certs.length, "RTA licences & permits, reminded before expiry")}
    ${I.lic ? row("Trade licence", 1, "", `no. ${esc(I.lic)}${I.licExp ? ", expiry " + esc(dmyS(I.licExp)) : ""} → Settings → Business information`) : ""}
    </tbody></table></div>
    <div class="row" style="margin-top:10px;gap:10px"><button class="btn primary" data-rtaimpgo="1" ${S.canWrite ? "" : "disabled"}>Import everything</button><button class="btn ghost" data-rtaimpcancel="1">Cancel</button></div></div>`;
}
async function rtaImport(btn){
  const I = S.rtaImp, by = (S.user && (S.user.name || S.user.id)) || "", at = new Date().toISOString(), say = t => { if(btn) btn.textContent = t; };
  let nV = 0, nD = 0, nF = 0, nB = 0, nP = 0, nC = 0;
  // vehicles
  say("Vehicles…");
  for(const r of I.veh){
    const no = r["Plate No."], code = r["Plate Code"]; if(!no) continue;
    const ex = findVeh(no, code), id = ex ? ex.id : "v-" + norm((code || "") + no).slice(0, 20), {id: _, ...prev} = ex || {};
    const reg = rtaDate(r["Registration Expiry"]).date, ins = rtaDate(r["Insurance Expiry"]).date;
    const rec = {...prev, plate: prev.plate || `${code || ""}${no}`, plateCode: code || "", plateNo: no, make: titleCase(r.Make), model: prev.model || titleCase(`${r.Make} ${r.Model}`), year: r.Year, colour: r.Colour, vin: r["Chassis No."] || prev.vin || "",
      bodyType: titleCase(r["Body Type"]), fuel: r.Fuel, seats: r.Seats, origin: r.Origin, regStatus: r["Licence Status"], firstRegistered: rtaDate(r["First Registered"]).date, lastRenewed: rtaDate(r["Last Renewed"]).date,
      mulkiyaExpiry: reg || prev.mulkiyaExpiry || "", mortgaged: r.Mortgaged, insurer: r.Insurer || prev.insurer || "", policyNo: r["Policy No."] || prev.policyNo || "", insuranceExpiry: ins || prev.insuranceExpiry || "", active: prev.active !== false, rtaSyncedAt: at};
    if(await writeOk(S.db.doc("vehicles/" + id).set(rec))){ S.vehicles[id] = {id, ...rec}; nV++; }
  }
  // drivers
  say("Drivers…");
  for(const r of I.drv){
    const name = titleCase(r["Driver Name"]); if(!name) continue;
    const ex = findDriver(r["Driver Name"], r["Licence No."]), id = ex ? ex.id : "d-" + norm(name).slice(0, 20), {id: _, ...prev} = ex || {};
    const rec = {...prev, name: prev.name || name, licenceNo: r["Licence No."] || prev.licenceNo || "", licenceExpiry: rtaDate(r["Licence Expiry"]).date || prev.licenceExpiry || "", licenceIssue: rtaDate(r["Licence Issue"]).date || prev.licenceIssue || "",
      licenceStatus: r["Licence Status"] || prev.licenceStatus || "", licenceCategories: r["Licence Categories"] || prev.licenceCategories || "", rtaUnifiedNo: r["RTA Unified No."] || prev.rtaUnifiedNo || "", active: prev.active !== false, ...(ex ? {} : {payModel: "", commissionPct: 0, createdFromImport: true})};
    if(await writeOk(S.db.doc("drivers/" + id).set(rec))){ S.drivers[id] = {id, ...rec}; nD++; }
  }
  // payable fines
  say("Fines…");
  const byNo = {}; Object.values(S.fines).forEach(f => byNo[norm(f.fineNo)] = f);
  for(const r of I.fines){
    const no = r["Ticket ID"] || r["Fine Ref No."]; if(!no) continue; const dt = rtaDate(r["Date & Time"]), v = findVeh(r["Plate No."], r["Plate Code"]), vid = v ? v.id : "";
    const ex = byNo[norm(no)], id = ex ? ex.id : "f-" + norm(no).slice(0, 30), {id: _, ...prev} = ex || {};
    const rec = {...prev, kind: "road", fineNo: no, refNo: r["Fine Ref No."] || "", date: dt.date, time: dt.time, vehicleId: vid || prev.vehicleId || "", plate: `${r["Plate Code"] || ""}${r["Plate No."] || ""}`, chassis: r["Chassis No."] || "",
      source: rtaSrc(r.Source), desc: r.Violation || "", location: r.Location || "", amount: num(r["Amount (AED)"]), points: num(r["Black Points"]), ticketType: r["Ticket Type"] || "",
      driverId: prev.driverId || (vid && window.driverAt ? driverAt(vid, dt.date, dt.time).id : ""), recover: prev.recover ?? true, status: prev.paidOn ? prev.status : (prev.status === "disputed" ? "disputed" : "unpaid"), imported: I.name, by, at};
    if(await writeOk(S.db.doc("fines/" + id).set(rec))) nF++;
  }
  // blocks, plates, certificates
  say("Blocks, plates, certificates…");
  for(const r of I.blocks){ const id = "bl-" + norm(r["Ref ID"] || r.Reference).slice(0, 30); if(await writeOk(S.db.doc("rtablocks/" + id).set({refId: r["Ref ID"], reference: r.Reference, date: rtaDate(r.Date).date, plate: r.Plate, chassis: r["Chassis No."], authority: r["Issuing Authority"], desc: r.Description, blocked: r["Services Blocked"], type: r.Type, status: "open", imported: I.name, at}))) nB++; }
  for(const r of I.plates){ const id = "pl-" + norm(r.Code + r["Plate No."]); if(await writeOk(S.db.doc("rtaplates/" + id).set({plateNo: r["Plate No."], code: r.Code, category: r.Category, status: r.Status, expiry: rtaDate(r["Reservation Expiry"]).date, imported: I.name, at}))) nP++; }
  for(const r of I.certs){ const id = "lc-" + norm(r["Ref No."] || r.Certificate).slice(0, 30); const prev = S.rtalic[id] || {};
    if(await writeOk(S.db.doc("rtalic/" + id).set({...prev, type: prev.type || "other", number: r["Ref No."], name: r.Certificate, issue: rtaDate(r["Issue Date"]).date, expiry: rtaDate(r["Expiry Date"]).date, portalStatus: r["Status (portal)"], imported: I.name, at}))) nC++; }
  // trade licence
  if(I.lic) await writeOk(S.db.doc("settings/main").set({...S.settings, licence: I.lic, ...(I.licExp ? {licenceExpiry: I.licExp} : {})}));
  S.rtaImp = null; toast(`Imported: ${nV} vehicles, ${nD} drivers, ${nF} fines, ${nB} blocks, ${nP} reserved plates, ${nC} certificates.`); render();
}

/* the two new RTA tabs */
function rtaBlocksTab(){
  const L = Object.values(S.rtablocks).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `<p class="sub">Circulars, service blocks and other non-payable items on the company's RTA file – a block can stop renewals until it is cleared.</p>
  ${L.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Reference</th><th>Plate / chassis</th><th>Authority</th><th>Description</th><th>Services blocked</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>${L.map(b => `<tr><td>${esc(dmyS(b.date || ""))}</td><td class="mono small">${esc(b.refId || "")}<div class="muted">${esc(b.reference || "")}</div></td><td class="small">${esc(b.plate || "")}<div class="muted mono">${esc(b.chassis || "")}</div></td><td class="small" style="white-space:normal;max-width:220px">${esc(b.authority || "")}</td><td class="small" style="white-space:normal;max-width:260px">${esc(b.desc || "")}</td><td class="small">${esc(b.blocked || "")}</td><td class="small">${esc(b.type || "")}</td><td>${b.status === "cleared" ? '<span class="pill good">Cleared</span>' : '<span class="pill bad">Open</span>'}</td><td><button class="btn sm" data-blockclear="${esc(b.id)}">${b.status === "cleared" ? "Reopen" : "Mark cleared"}</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>No blocks or circulars</b>Import the RTA data workbook to bring them in.</div>`}`;
}
function rtaPlatesTab(){
  const L = Object.values(S.rtaplates).sort((a, b) => (a.expiry || "").localeCompare(b.expiry || ""));
  return `<p class="sub">Plates reserved by the company (not on a vehicle) – renew or use them before the reservation ends (reminded 30 days before).</p>
  ${L.length ? `<div class="tbl"><table><thead><tr><th>Plate</th><th>Category</th><th>Status</th><th>Reservation expiry</th></tr></thead><tbody>${L.map(p => `<tr><td class="mono"><b>${esc(p.code || "")} ${esc(p.plateNo || "")}</b></td><td class="small">${esc(p.category || "")}</td><td class="small">${esc(p.status || "")}</td><td>${esc(dmyS(p.expiry || ""))}${typeof expTag === "function" ? expTag(p.expiry) : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><b>No reserved plates</b>Import the RTA data workbook to bring them in.</div>`}`;
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.rtaimpcancel){ S.rtaImp = null; render(); return; }
  if(t.dataset.rtaimpgo){ t.disabled = true; await rtaImport(t); return; }
  if(t.dataset.blockclear){ const b = S.rtablocks[t.dataset.blockclear]; if(!b) return; const {id, ...rest} = b; if(await writeOk(S.db.doc("rtablocks/" + id).set({...rest, status: b.status === "cleared" ? "open" : "cleared", clearedOn: b.status === "cleared" ? "" : iso(new Date())}))) render(); return; }
});
document.addEventListener("change", async ev => { if(ev.target.id === "rtaFile" && ev.target.files && ev.target.files[0]){ await rtaReadFile(ev.target.files[0]); ev.target.value = ""; } });
window.RTAIMP = {panel: rtaImpPanel, blocks: rtaBlocksTab, plates: rtaPlatesTab};
