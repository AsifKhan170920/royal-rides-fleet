/* Reminders & expiries (Overview → Reminders & expiries): every date in the software that has a deadline or an
   expiry, in one list, on the dashboard, as a banner on every page and as a daily browser notification.
   Collected automatically:
     drivers & employees – passport, visa, Emirates ID, labour card, driving licence / RTA permit, medical insurance
     cars – Mulkiya, insurance; road-fines check due
     RTA – licences & permits, RTA fines with a pay-by date
     platforms – contract end
     post-dated cheques – cheque date (pending)
     bank finance – next instalment of every loan and car finance
     invoices – sales invoices to collect and purchase invoices to pay, by due date
   plus your own reminders (collection reminders): trade licence, Ejari / office lease, insurance policies, VAT return,
   anything – with how many days before to remind, and repeat monthly / quarterly / yearly ("Done" moves it on).
   Each kind has its own reminder window (days before): set in Settings → remind days (documents), here for the rest. */
S.reminders = S.reminders || {}; S.remFilter = S.remFilter || {win: "due", cat: ""}; S.remEdit = S.remEdit || null;
const REM_CATS = {staff: "Visa & staff documents", car: "Cars (Mulkiya, insurance)", rta: "RTA", contract: "Platform contracts", pdc: "PDC cheques", loan: "Bank finance instalments", invoice: "Invoices", payroll: "Payroll", custom: "My reminders"};
const REM_REPEAT = {"": "Does not repeat", "1": "Monthly", "3": "Quarterly", "6": "Half-yearly", "12": "Yearly"};
const remLeft = d => Math.round((parseD(d) - parseD(iso(new Date()))) / 86400000);
const remDays = () => num(setting("remindDays", 30)) || 30;

function allReminders(){
  const R = [], today = iso(new Date()), add = (cat, date, title, who, ref, before, open) => { if(date) R.push({cat, date: date.slice(0,10), title, who: who || "", ref: ref || "", before, open}); };
  // staff documents (drivers & employees)
  if(typeof staffExpiries === "function") staffExpiries().forEach(x => add("staff", x.date, x.label, x.who + " (" + x.kind.toLowerCase() + ")", x.no, remDays(),
    x.kind === "Driver" ? {view: "drivers", set: {edit: {kind: "driver", id: x.id}}} : {view: "employees", set: {empEdit: {id: x.id}}}));
  // cars
  Object.values(S.vehicles).filter(v => v.active !== false).forEach(v => {
    add("car", v.mulkiyaExpiry, "Mulkiya (registration)", vName(v.id), v.mulkiyaNo, 30, {view: "vehicles", set: {edit: {kind: "vehicle", id: v.id}}});
    add("car", v.insuranceExpiry, "Insurance" + (v.insurer ? " – " + v.insurer : ""), vName(v.id), v.policyNo, 30, {view: "vehicles", set: {edit: {kind: "vehicle", id: v.id}}});
  });
  // road fines: one line for all cars whose check is due
  if(window.RTA){ const days = num(setting("finesCheckDays", 7)) || 7, due = Object.values(S.vehicles).filter(v => v.active !== false).map(v => v.finesCheckedAt ? addDays(v.finesCheckedAt.slice(0,10), days) : today).filter(d => d <= today);
    if(due.length) add("car", due.sort()[0], "Check road fines on RTA / Dubai Police", due.length + " car" + (due.length === 1 ? "" : "s"), "", 0, {view: "rta", set: {rtaTab: "road"}}); }
  // RTA
  Object.values(S.rtalic || {}).forEach(l => add("rta", l.expiry, (typeof LIC_TYPES !== "undefined" && LIC_TYPES[l.type]) || "RTA licence", l.name || (l.vehicleId ? vName(l.vehicleId) : l.driverId ? dName(l.driverId) : ""), l.number, num(l.remind) || 30, {view: "rta", set: {rtaTab: "lic", rtaEdit: {kind: "lic", id: l.id}}}));
  Object.values(S.fines || {}).filter(f => f.dueDate && !f.paidOn && f.status !== "cancelled").forEach(f => add("rta", f.dueDate, "Pay RTA fine – " + (f.desc || ""), f.vehicleId ? vName(f.vehicleId) : "Company", f.fineNo, 7, {view: "rta", set: {rtaTab: "fines"}}));
  // platform contracts
  Object.values(S.platforms).forEach(p => add("contract", p.contractEnd, "Contract ends", p.legalName || p.name || p.id, "", 30, {view: "platforms", set: {edit: {kind: "platform", id: p.id}}}));
  // post-dated cheques
  Object.values(S.pdcs || {}).filter(p => p.status === "pending").forEach(p => add("pdc", p.date, (p.dir === "in" ? "Deposit cheque" : "Cheque to be paid") + " – AED " + fmt(num(p.amount)), (window.BOOKS && p.party ? BOOKS.partyName(p.party) : "") || p.payee || "", p.chequeNo, 7, {view: "pdc", set: {}}));
  // bank finance: the next instalment of each loan and car finance
  if(window.LOANS) Object.values(S.loans || {}).forEach(l => { const x = LOANS.schedule(l).find(i => i.date >= today); if(x) add("loan", x.date, `Instalment ${x.no} – AED ${fmt(x.emi)}`, `${l.bank || "Bank"}${l.facility ? " " + l.facility : ""}`, l.purpose, 7, {view: "bankfin", set: {loanView: l.id}}); });
  if(window.FIN) Object.values(S.vehicles).forEach(v => { const f = FIN.of(v); if(!f || f.funding !== "bank") return; const x = FIN.schedule(v).find(i => i.date >= today);
    if(x) add("loan", x.date, `Car finance instalment ${x.no} – AED ${fmt(x.emi)}`, `${f.bank || "Bank"}${f.facility ? " " + f.facility : ""} – ${vName(v.id)}`, "", 7, {view: "vehicles", set: {vehView: v.id, vehTab: "fin"}}); });
  // invoices by due date (unpaid)
  if(window.BOOKS && BOOKS.invStatus){ const ents = BOOKS.histEntries();
    ents.filter(e => (e.type === "sale_invoice" || e.type === "purchase_invoice") && e.dueDate).forEach(e => { const st = BOOKS.invStatus(e, ents); if(st.due <= 0.005) return;
      add("invoice", e.dueDate, `${e.type === "sale_invoice" ? "Collect" : "Pay"} invoice ${e.number || ""} – AED ${fmt(st.due)}`, BOOKS.partyName(e.party), "", 7, {view: e.type === "sale_invoice" ? "salesinv" : "purchinv", set: {}}); }); }
  // employee payroll: last month and this month until posted
  if(Object.values(S.employees || {}).some(e => e.active !== false)){ const cur = today.slice(0,7), prev = addMonths(cur + "-01", -1).slice(0,7);
    [prev, cur].forEach(m => { const run = (S.emppay || {})[m]; if(!(run && run.posted) && m >= setting("ledgerStart", "2026-09-01").slice(0,7)) add("payroll", monthEnd(m), "Post employee payroll " + m, "All employees", "", 5, {view: "emppayroll", set: {payMonth: m, payDraft: null}}); }); }
  // my reminders
  Object.values(S.reminders).filter(r => !r.done).forEach(r => add("custom", r.date, r.title, r.who, r.ref, String(r.before ?? "") === "" ? 30 : num(r.before), {view: "reminders", set: {remEdit: r.id}}));
  return R.map(r => ({...r, left: remLeft(r.date)})).sort((a, b) => a.date.localeCompare(b.date));
}
// in the reminder window (or already past)
const remDue = () => allReminders().filter(r => r.left <= r.before);
const remPill = r => r.left < 0 ? `<span class="pill bad">${r.cat === "staff" || r.cat === "car" || r.cat === "rta" || r.cat === "contract" ? "Expired" : "Overdue"} ${-r.left} day${r.left === -1 ? "" : "s"}</span>` : r.left === 0 ? '<span class="pill bad">Today</span>' : r.left <= 7 ? `<span class="pill warn">${r.left} day${r.left === 1 ? "" : "s"}</span>` : r.left <= r.before ? `<span class="pill brass">${r.left} days</span>` : '<span class="pill good">Later</span>';
const remRow = r => `<tr><td>${esc(dmyS(r.date))}</td><td>${remPill(r)}</td><td class="small muted">${esc(REM_CATS[r.cat])}</td><td>${esc(r.title)}</td><td>${esc(r.who)}</td><td class="mono small">${esc(r.ref)}</td><td><button class="btn sm" data-remopen="${esc(JSON.stringify(r.open))}">Open</button>${r.cat === "custom" ? ` <button class="btn sm primary" data-remdone="${esc(r.open.set.remEdit)}">Done</button>` : ""}</td></tr>`;
const remHead = `<thead><tr><th>Date</th><th>Status</th><th>Type</th><th>Item</th><th>Who / what</th><th>No.</th><th></th></tr></thead>`;

/* dashboard section */
function remDash(){
  const due = remDue(), exp = due.filter(r => r.left < 0).length, wk = due.filter(r => r.left >= 0 && r.left <= 7).length;
  if(!due.length) return `<div class="section"><div class="head"><div><h2>Deadlines & expiries</h2><p class="sub">Nothing expired or due soon.</p></div><button class="btn sm" data-nav="reminders">All reminders</button></div></div>`;
  const notif = ("Notification" in window) && Notification.permission === "default" ? '<button class="btn sm" data-remnotif="1">Turn on browser notifications</button>' : "";
  return `<div class="section"><div class="head"><div><h2>Deadlines & expiries</h2><p class="sub">${exp ? `<b class="neg">${exp} expired / overdue</b> · ` : ""}${wk} within 7 days · ${due.length - exp - wk} later in their reminder window.</p></div><div class="row">${notif}<button class="btn sm" data-nav="reminders">All reminders</button></div></div>
  <div class="tbl"><table>${remHead}<tbody>${due.slice(0, 15).map(remRow).join("")}</tbody></table></div>${due.length > 15 ? `<p class="small muted" style="margin-top:6px">${due.length - 15} more – <button class="btn sm" data-nav="reminders">see all</button></p>` : ""}</div>`;
}
/* banner on every page, and a daily browser notification */
function remBanner(){
  if(!S.db || S.view === "dashboard" || S.view === "reminders") return "";
  const due = remDue(), urgent = due.filter(r => r.left <= 7); if(!urgent.length) return "";
  try{ if("Notification" in window && Notification.permission === "granted"){ const k = "remNotified-" + iso(new Date()); if(!localStorage.getItem(k)){ localStorage.setItem(k, "1");
    new Notification("Royal Rides – deadlines & expiries", {body: urgent.slice(0, 6).map(r => `${dmyS(r.date)} · ${r.title} – ${r.who}`).join("\n")}); } } }catch(e){}
  const exp = urgent.filter(r => r.left < 0).length;
  return `<div class="banner"><b>Deadlines:</b> ${exp ? `${exp} expired / overdue, ` : ""}${urgent.length - exp} due within 7 days (${esc(urgent.slice(0, 3).map(r => `${r.title} – ${r.who} ${dmyS(r.date)}`).join("; "))}${urgent.length > 3 ? "…" : ""}). <button class="btn sm" data-nav="reminders">Reminders</button></div>`;
}

/* the page */
function remForm(r){
  r = r || {date: iso(new Date()), before: 30, repeat: ""};
  const fld = (n, l, type = "text", extra = "") => `<div class="f"><label for="rm_${n}">${l}</label><input id="rm_${n}" name="${n}" type="${type}" value="${esc(r[n] ?? "")}"${extra}></div>`;
  return `<div class="section"><h2>${r.id ? "Edit reminder" : "New reminder"}</h2><form class="form" id="fRem" data-id="${esc(r.id || "")}">
    ${fld("title", "What (e.g. Trade licence renewal, Ejari, VAT return Q3)", "text", " required")}${fld("who", "For / about (company, car, person)")}${fld("ref", "Number / reference")}
    ${fld("date", "Expiry / deadline", "date", " required")}${fld("before", "Remind how many days before", "number", ' min="0"')}
    <div class="f"><label for="rm_rep">Repeats</label><select id="rm_rep" name="repeat">${opts(REM_REPEAT, String(r.repeat || ""))}</select></div>${fld("notes", "Notes")}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-remcancel="1">Cancel</button>${r.id ? `<button class="btn danger" type="button" data-remdel="${esc(r.id)}">Delete</button>` : ""}</div></form></div>`;
}
function vReminders(){
  const F = S.remFilter, all = allReminders(), list = all.filter(r => (!F.cat || r.cat === F.cat) && (F.win === "all" ? true : F.win === "due" ? r.left <= r.before : r.left <= num(F.win)));
  const edit = S.remEdit ? remForm(S.remEdit === "new" ? null : S.reminders[S.remEdit]) : "";
  const notif = !("Notification" in window) ? "" : Notification.permission === "granted" ? '<span class="small muted">Browser notifications are on.</span>' : Notification.permission === "denied" ? '<span class="small muted">Notifications are blocked in this browser.</span>' : '<button class="btn sm" data-remnotif="1">Turn on browser notifications</button>';
  const counts = Object.keys(REM_CATS).map(c => { const n = all.filter(r => r.cat === c && r.left <= r.before).length; return n ? `<span class="pill ${all.some(r => r.cat === c && r.left < 0) ? "bad" : "warn"}">${esc(REM_CATS[c])}: ${n}</span>` : ""; }).join(" ");
  return `${edit}<div class="section"><div class="head"><div><h2>Reminders & expiries</h2><p class="sub">Every deadline and expiry in the software. Dates are kept on their own records (driver, employee, car, RTA, PDC, loan, invoice); add anything else as your own reminder.</p></div>
    <div class="row">${notif}<select id="remWin" aria-label="Show">${opts({due: "Due (in each reminder window)", "7": "Expired or within 7 days", "30": "Expired or within 30 days", "90": "Expired or within 90 days", all: "All dates"}, F.win)}</select><select id="remCat" aria-label="Type">${opts(REM_CATS, F.cat, "All types")}</select>${dlBtn("reminders")}<button class="btn primary" data-remnew="1">Add reminder</button></div></div>
  ${counts ? `<p style="margin:0 0 8px">${counts}</p>` : ""}
  ${list.length ? `<div class="tbl"><table>${remHead}<tbody>${list.map(remRow).join("")}</tbody></table></div>` : `<div class="empty"><b>Nothing here</b>No deadlines or expiries for this filter.</div>`}
  <p class="small muted" style="margin-top:6px">Reminder windows: staff documents ${remDays()} days (Settings), cars, RTA licences, contracts and your own reminders 30 days unless set, cheques, instalments and invoices 7 days.</p></div>`;
}
DL.reminders = () => [`reminders_${iso(new Date())}.csv`, [["Date","Days left","Type","Item","Who / what","No."], ...allReminders().map(r => [r.date, r.left, REM_CATS[r.cat], r.title, r.who, r.ref])]];

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.remopen){ const o = JSON.parse(t.dataset.remopen); S.navStack.push(JSON.stringify(Object.fromEntries(NAV_KEYS.map(k => [k, S[k] ?? null])))); S.edit = null; S.view = o.view; Object.assign(S, o.set || {}); render(); window.scrollTo(0,0); return; }
  if(t.dataset.remnew){ S.remEdit = "new"; render(); window.scrollTo(0,0); return; }
  if(t.dataset.remcancel){ S.remEdit = null; render(); return; }
  if(t.dataset.remnotif){ try{ await Notification.requestPermission(); }catch(e){} render(); return; }
  if(t.dataset.remdel){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to delete"; return; } if(await writeOk(S.db.doc("reminders/" + t.dataset.remdel).delete())){ S.remEdit = null; toast("Reminder deleted."); render(); } return; }
  if(t.dataset.remdone){ const r = S.reminders[t.dataset.remdone]; if(!r) return; const {id, ...b} = r;
    const next = num(r.repeat) ? {...b, date: addMonths(r.date, num(r.repeat)), lastDone: iso(new Date())} : {...b, done: true, lastDone: iso(new Date())};
    if(await writeOk(S.db.doc("reminders/" + id).set(next))) toast(num(r.repeat) ? `Done – next on ${dmyS(next.date)}.` : "Done."); render(); return; }
});
document.addEventListener("change", ev => {
  if(ev.target.id === "remWin"){ S.remFilter.win = ev.target.value; render(); }
  if(ev.target.id === "remCat"){ S.remFilter.cat = ev.target.value; render(); }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fRem") return; ev.preventDefault(); if(!S.db) return;
  const d = Object.fromEntries(new FormData(f).entries()); d.before = String(d.before) === "" ? 30 : num(d.before); d.done = false;
  const id = f.dataset.id || "rm-" + uid();
  if(await writeOk(S.db.doc("reminders/" + id).set({...d, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()}))){ S.remEdit = null; toast("Reminder saved."); render(); }
});
window.REM = {dash: remDash, banner: remBanner, all: allReminders};
Object.assign(window.BOOK_VIEWS = window.BOOK_VIEWS || {}, {reminders: vReminders});
