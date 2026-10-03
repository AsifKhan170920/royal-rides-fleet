/* Employees (office, operations, workshop – everyone who is not a driver) and staff documents.
   How staff costs are split in the accounts:
   - Drivers are direct staff: their earnings share / salary (5100) and their visas & permits (5280)
     are COST OF SALES, next to platform fees and vehicle running costs.
   - Employees are indirect staff: their salaries post to ADMINISTRATIVE EXPENSES by department
     (6000 administration, 6001 operations, 6002 workshop / other), with their visa, EID & medical (6010),
     gratuity (6020) and leave salary & tickets (6030).
   Monthly payroll: each run (emppay/{YYYY-MM}) is posted at month end – Dr salaries / Cr 2110 Staff
   salaries payable – and an advance recovered in the run moves from 1180 Staff advances & loans to 2110.
   Paying salaries or advances uses Payments with the employee (account 2110 or 1180).
   Visa, Emirates ID, passport, labour card and licence expiry of drivers and employees are tracked
   here, with a banner on every page and an optional browser notification. */
const EMP_ACCTS = {"1180":"Staff advances & loans", "2110":"Staff salaries payable",
  "6000":"Salaries – administration", "6001":"Salaries – operations", "6002":"Salaries – workshop & other staff",
  "6010":"Staff visa, Emirates ID & medical", "6020":"End-of-service gratuity", "6030":"Leave salary & air tickets"};
Object.assign(ACCT, EMP_ACCTS); if(typeof ACCT_BASE !== "undefined") Object.assign(ACCT_BASE, EMP_ACCTS);
Object.assign(EXP_CATS, {"6010":"Staff visa, Emirates ID & medical", "6020":"End-of-service gratuity", "6030":"Leave salary & air tickets"});
if(ACCT["5280"] === "Driver salaries & visas") { ACCT["5280"] = EXP_CATS["5280"] = "Driver visas, permits & benefits"; if(typeof ACCT_BASE !== "undefined") ACCT_BASE["5280"] = ACCT["5280"]; }
const DEPTS = {admin:"Administration", operations:"Operations", workshop:"Workshop / garage", other:"Other"};
const DEPT_ACCT = {admin:"6000", operations:"6001", workshop:"6002", other:"6002"};
const STAFF_DOCS = [["passportExpiry","Passport","passportNo"], ["visaExpiry","Visa","visaNo"], ["eidExpiry","Emirates ID","eidNo"], ["labourExpiry","Labour card","labourNo"], ["licenceExpiry","Driving licence / RTA permit","licenceNo"], ["medicalExpiry","Medical insurance","medicalNo"]];
S.employees = S.employees || {}; S.emppay = S.emppay || {}; S.empView = ""; S.empTab = "details"; S.empEdit = null; S.expFilter = S.expFilter || "60";
const gross = e => r2(num(e.basic) + num(e.housing) + num(e.transport) + num(e.otherAllow));
const eName = id => (S.employees[id] || {}).name || "Employee";
const remindDays = () => num(setting("remindDays", 30)) || 30;

/* ---------- expiries (drivers and employees) ---------- */
function staffExpiries(){
  const out = [];
  const add = (who, kind, id, rec) => STAFF_DOCS.forEach(([f, label, no]) => { if(rec[f]) out.push({who, kind, id, label, no: rec[no] || "", date: rec[f]}); });
  Object.values(S.drivers).filter(d => d.active !== false).forEach(d => add(d.name || d.id, "Driver", d.id, d));
  Object.values(S.employees).filter(e => e.active !== false).forEach(e => add(e.name, "Employee", e.id, e));
  return out.sort((a,b) => a.date.localeCompare(b.date));
}
const daysLeft = d => Math.round((parseD(d) - parseD(iso(new Date()))) / 86400000);
function expPill(d){ const n = daysLeft(d); return n < 0 ? `<span class="pill bad">Expired ${-n} day${n === -1 ? "" : "s"} ago</span>` : n <= remindDays() ? `<span class="pill warn">${n} day${n === 1 ? "" : "s"} left</span>` : `<span class="pill good">Valid</span>`; }
function empBanner(){
  const due = staffExpiries().filter(x => daysLeft(x.date) <= remindDays()); if(!due.length) return "";
  try{ if("Notification" in window && Notification.permission === "granted"){ const k = "staffNotified-" + iso(new Date()); if(!localStorage.getItem(k)){ localStorage.setItem(k, "1"); new Notification("Staff documents expiring", {body: due.slice(0, 6).map(x => `${x.who}: ${x.label} ${dmyS(x.date)}`).join("\n")}); } } }catch(e){}
  if(S.view === "expiries" || S.view === "dashboard") return "";   // the dashboard lists them
  const exp = due.filter(x => daysLeft(x.date) < 0).length;
  return `<div class="banner"><b>Staff documents:</b> ${exp ? `${exp} expired, ` : ""}${due.length - exp} expiring within ${remindDays()} days (${esc(due.slice(0, 3).map(x => `${x.who} – ${x.label} ${dmyS(x.date)}`).join("; "))}${due.length > 3 ? "…" : ""}). <button class="btn sm" data-nav="dashboard">See on dashboard</button></div>`;
}
// dashboard section: documents expired or expiring within the reminder window
function dashList(){
  const due = staffExpiries().filter(x => daysLeft(x.date) <= remindDays()); if(!due.length) return "";
  const notif = ("Notification" in window) && Notification.permission === "default" ? '<button class="btn sm" data-empnotif="1">Turn on browser notifications</button>' : "";
  return `<div class="section"><div class="head"><div><h2>Visa, Emirates ID & documents expiring</h2><p class="sub">Drivers and employees – expired or within ${remindDays()} days.</p></div><div class="row">${notif}<button class="btn sm" data-nav="expiries">All document dates</button></div></div>
  <div class="tbl"><table><thead><tr><th>Expiry</th><th>Status</th><th>Name</th><th></th><th>Document</th><th>Number</th><th></th></tr></thead><tbody>
  ${due.map(x => `<tr><td>${esc(dmyS(x.date))}</td><td>${expPill(x.date)}</td><td>${esc(x.who)}</td><td class="small muted">${x.kind}</td><td>${esc(x.label)}</td><td class="mono small">${esc(x.no)}</td><td><button class="btn sm" ${x.kind === "Driver" ? `data-edit="driver" data-id="${esc(x.id)}" data-goto="drivers"` : `data-empedit="${esc(x.id)}"`}>Update</button></td></tr>`).join("")}
  </tbody></table></div></div>`;
}
function vExpiries(){
  const lim = S.expFilter, all = staffExpiries(), list = all.filter(x => lim === "all" || daysLeft(x.date) <= num(lim));
  const notif = !("Notification" in window) ? "" : Notification.permission === "granted" ? '<span class="small muted">Browser notifications are on.</span>' : Notification.permission === "denied" ? '<span class="small muted">Browser notifications are blocked in this browser.</span>' : '<button class="btn sm" data-empnotif="1">Turn on browser notifications</button>';
  return `<div class="section"><div class="head"><div><h2>Visa, Emirates ID & document expiry</h2><p class="sub">Drivers and employees. Expiry dates are entered on each driver's and employee's form. You are reminded ${remindDays()} days before (change in Settings).</p></div>
    <div class="row">${notif}<select id="expF" aria-label="Show">${opts({"30":"Expired or within 30 days", "60":"Expired or within 60 days", "90":"Expired or within 90 days", all:"All documents"}, lim)}</select></div></div>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>Expiry</th><th>Status</th><th>Name</th><th></th><th>Document</th><th>Number</th><th></th></tr></thead><tbody>
  ${list.map(x => `<tr><td>${esc(dmyS(x.date))}</td><td>${expPill(x.date)}</td><td>${esc(x.who)}</td><td class="small muted">${x.kind}</td><td>${esc(x.label)}</td><td class="mono small">${esc(x.no)}</td>
    <td><button class="btn sm" ${x.kind === "Driver" ? `data-edit="driver" data-id="${esc(x.id)}" data-goto="drivers"` : `data-empedit="${esc(x.id)}"`}>Update</button></td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty"><b>Nothing due</b>${all.length ? "No document expires in this window." : "Enter visa, Emirates ID and passport expiry dates on the driver and employee forms."}</div>`}</div>`;
}

/* ---------- employees ---------- */
function vEmployees(){
  const form = S.empEdit ? empForm(S.empEdit.id) : "";
  if(S.empView && S.employees[S.empView]) return form + empDetail(S.empView);
  const list = Object.values(S.employees).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  const firstExp = e => STAFF_DOCS.map(([f]) => e[f]).filter(Boolean).sort()[0];
  return form + `<div class="section"><div class="head"><div><h2>Employees</h2><p class="sub">Office, operations and workshop staff. Their salaries are administrative expenses (by department); drivers stay on the Drivers page as cost of sales.</p></div><button class="btn primary" data-empnew="1">Add employee</button></div>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>Name</th><th>Designation</th><th>Department</th><th>Joined</th><th class="num">Monthly gross</th><th>Next expiry</th><th></th></tr></thead><tbody>
  ${list.map(e => { const fx = firstExp(e); return `<tr><td><button class="btn sm ghost" data-empview="${esc(e.id)}" style="padding:2px 6px"><b>${esc(e.name)}</b></button>${e.active === false ? ' <span class="pill">Inactive</span>' : ""}</td><td>${esc(e.designation)}</td><td>${esc(DEPTS[e.dept] || "")}</td><td>${e.joinDate ? esc(dmyS(e.joinDate)) : ""}</td><td class="num">${fmt(gross(e))}</td><td>${fx ? esc(dmyS(fx)) + " " + expPill(fx) : '<span class="muted">—</span>'}</td><td><button class="btn sm" data-empedit="${esc(e.id)}">Edit</button></td></tr>`; }).join("")}
  </tbody><tfoot><tr><td colspan="4">${list.length} employee(s)</td><td class="num">${fmt(sum(list.filter(e => e.active !== false), gross))}</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty"><b>No employees yet</b>Add office, operations and workshop staff with their salary and visa / Emirates ID dates.</div>`}</div>`;
}
const docFields = (x, pre) => STAFF_DOCS.map(([f, label, no]) => `<div class="f"><label for="${pre}_${no}">${label} no.</label><input id="${pre}_${no}" name="${no}" value="${esc(x[no])}"></div><div class="f"><label for="${pre}_${f}">${label} expiry</label><input id="${pre}_${f}" name="${f}" type="date" value="${esc(x[f])}"></div>`).join("");
function empForm(id){
  const x = S.employees[id] || {dept: "admin", active: true, joinDate: iso(new Date())};
  const f = (n, l, type = "text") => `<div class="f"><label for="em_${n}">${l}</label><input id="em_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(x[n] ?? "")}"${n === "name" ? " required" : ""}></div>`;
  return `<div class="section"><h2>${id ? "Edit " + esc(x.name) : "New employee"}</h2><form class="form" id="fEmp" data-id="${esc(id || "")}">
    ${f("name", "Full name")}${f("code", "Employee code")}${f("designation", "Designation")}<div class="f"><label for="em_dept">Department (salary account)</label><select id="em_dept" name="dept">${opts(Object.fromEntries(Object.entries(DEPTS).map(([k,l]) => [k, l + " – " + DEPT_ACCT[k]])), x.dept)}</select></div>
    ${f("phone", "Mobile")}${f("email", "Email", "email")}${f("nationality", "Nationality")}${f("joinDate", "Joining date", "date")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Monthly salary</b> <span class="small muted">– used for the next payroll runs; posted runs keep their figures.</span></div>
    ${f("basic", "Basic", "number")}${f("housing", "Housing allowance", "number")}${f("transport", "Transport allowance", "number")}${f("otherAllow", "Other allowance", "number")}
    ${f("iban", "Bank / IBAN (WPS)")}${f("opening", `Salary payable on ${dmyS(setting("ledgerStart", "2026-09-01"))} (opening)`, "number")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Visa & documents</b> <span class="small muted">– reminders ${remindDays()} days before expiry.</span></div>
    ${docFields(x, "em")}
    <div class="f"><label for="em_active">Status</label><select id="em_active" name="active">${opts({true:"Active", false:"Inactive / left"}, String(x.active !== false))}</select></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-empcancel="1">Cancel</button>${id ? `<button class="btn danger" type="button" data-del="employees" data-id="${esc(id)}">Delete</button>` : ""}</div>
  </form></div>`;
}
const EMP_TABS = {details:"Details & documents", pay:"Ledger", letters:"Offer letters"};
function empDetail(id){
  const e = S.employees[id], tab = EMP_TABS[S.empTab] ? S.empTab : "details";
  let body;
  if(tab === "details"){
    const docs = STAFF_DOCS.filter(([f]) => e[f]);
    body = `<div class="grid2"><div><div class="tbl"><table><tbody>
      ${[["Designation", e.designation], ["Department", (DEPTS[e.dept] || "") + " – account " + (DEPT_ACCT[e.dept] || "6000")], ["Joined", e.joinDate ? dmyS(e.joinDate) : ""], ["Mobile", e.phone], ["Email", e.email], ["Nationality", e.nationality], ["Bank / IBAN", e.iban]].map(([l, v]) => `<tr><td class="muted">${l}</td><td>${esc(v || "—")}</td></tr>`).join("")}
      <tr><td class="muted">Basic</td><td class="num">${fmt(num(e.basic))}</td></tr><tr><td class="muted">Housing</td><td class="num">${fmt(num(e.housing))}</td></tr><tr><td class="muted">Transport</td><td class="num">${fmt(num(e.transport))}</td></tr><tr><td class="muted">Other</td><td class="num">${fmt(num(e.otherAllow))}</td></tr><tr class="tot"><td><b>Monthly gross</b></td><td class="num"><b>${fmt(gross(e))}</b></td></tr>
    </tbody></table></div></div><div><h2>Documents</h2>${docs.length ? `<div class="tbl"><table><thead><tr><th>Document</th><th>Number</th><th>Expiry</th><th></th></tr></thead><tbody>${docs.map(([f, l, no]) => `<tr><td>${l}</td><td class="mono small">${esc(e[no] || "")}</td><td>${esc(dmyS(e[f]))}</td><td>${expPill(e[f])}</td></tr>`).join("")}</tbody></table></div>` : `<p class="sub">No document dates yet – add them with Edit.</p>`}</div></div>`;
  } else if(tab === "pay"){
    const wait = needHistory();
    if(wait) body = wait;
    else {
      const st = empStatement(id, histEntries2());
      body = `<div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Salary payable</th><th></th></tr></thead><tbody>
        <tr><td></td><td><b>Opening balance</b></td><td></td><td></td><td class="num"><b>${aed(num(e.opening))}</b></td><td></td></tr>
        ${st.lines.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td><td>${l.slip ? `<button class="btn sm" data-slipshow="${esc(l.slip.month)}" data-lid="${esc(l.slip.lid)}">Payslip</button>` : ""}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="4">Salary payable (all posted payroll; payments to ${esc(dmyS(S.to))})</td><td class="num"><b>${aed(st.bal)}</b></td><td></td></tr></tfoot></table></div>
      <div class="row" style="margin-top:10px;gap:18px"><span>Advances & loans outstanding <b class="mono">${fmt(st.adv)}</b></span>${st.bal > 0.005 ? `<button class="btn" data-emppay="${esc(id)}" data-amt="${r2(st.bal)}">Pay AED ${fmt(st.bal)}</button>` : ""}<button class="btn" data-empadv="${esc(id)}">Give an advance / loan</button></div>`;
    }
  } else {
    const docs = Object.values(S.docs || {}).filter(d => d.kind === "empoffer" && d.refId === id);
    body = `<div class="row" style="margin-bottom:10px"><button class="btn primary" data-empofferfor="${esc(id)}">New offer letter</button></div>
      ${docs.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Status</th><th>Last saved</th><th></th></tr></thead><tbody>${docs.map(d => `<tr><td>${esc(dmyS((d.fields || {}).start || ""))}</td><td><span class="pill ${d.status === "final" ? "good" : "warn"}">${d.status === "final" ? "Final" : "Draft"}</span></td><td class="small muted">${esc(d.updatedText || "")}</td><td class="row"><button class="btn sm" data-docopen="${esc(d.id)}" data-goto="empoffers">Open</button><button class="btn sm" data-docpdf="${esc(d.id)}">PDF</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="sub">No offer letter for this employee yet.</p>`}`;
  }
  return `<div class="section"><div class="head"><div><h2>${esc(e.name)}${e.code ? ` <span class="mono small muted">${esc(e.code)}</span>` : ""}</h2><p class="sub">${esc(e.designation || "")}${e.dept ? " · " + esc(DEPTS[e.dept]) : ""} · monthly gross AED ${fmt(gross(e))}</p></div>
    <div class="row"><button class="btn ghost" data-back="1">← Back</button><button class="btn" data-empedit="${esc(id)}">Edit</button></div></div>
  ${tabBtns("data-emptab", tab, EMP_TABS)}${body}</div>`;
}
const histEntries2 = () => (S.ledger && S.ledger.entries && !S.ledger.loading) ? S.ledger.entries : S.entries;
// an employee's salary-payable account: payroll runs (credit), recoveries and payments (debit), plus advances
function empStatement(id, entries){
  const p = "e:" + id, mv = window.BOOKS ? BOOKS.partyMoves(entries, p, "2110") : [], adv = window.BOOKS ? BOOKS.partyMoves(entries, p, "1180") : [];
  const lines = mv.map(m => ({date: m.date, desc: m.desc, dr: m.dr, cr: m.cr}));
  let rec = 0;
  ensureLids();
  Object.values(S.emppay).filter(r => r.posted).forEach(r => (r.lines || []).filter(l => l.empId === id).forEach(l => {
    lines.push({slip: {month: r.month, lid: l.lid}, date: r.date, desc: `Salary ${r.month}${num(l.unpaidDays) ? ` (${num(l.unpaidDays)} unpaid days)` : ""}${num(l.addAmt) ? ` + ${l.addNote || "additions"} ${fmt(num(l.addAmt))}` : ""}${num(l.otherDed) ? ` − ${l.dedNote || "deductions"} ${fmt(num(l.otherDed))}` : ""}`, cr: num(l.earned)});
    if(num(l.recover)){ lines.push({date: r.date, desc: `Advance recovered – salary ${r.month}`, dr: num(l.recover)}); rec += num(l.recover); }
  }));
  lines.sort((a,b) => a.date.localeCompare(b.date) || (b.cr ? 1 : 0) - (a.cr ? 1 : 0));
  let bal = num((S.employees[id] || {}).opening); lines.forEach(l => { bal = r2(bal + (l.cr || 0) - (l.dr || 0)); l.bal = bal; });
  return {lines, bal, adv: r2(sum(adv, m => m.dr - m.cr) - rec)};
}

/* ---------- payroll ---------- */
/* A payroll run per month (emppay/{month}): its payroll date, and one payslip line per employee – salary
   components, unpaid days (gross ÷ 30 a day, amount shown), additions (with a description), other deductions
   (with a description) and the advance / loan recovered. Posting books every line on the payroll date
   (Dr salaries by department / Cr 2110; recoveries Dr 2110 / Cr 1180) and puts it in the payroll register below,
   where each payslip can be viewed / printed (for signature and stamp), edited or deleted. "New payslip" adds one
   employee's payslip to a month (e.g. a joiner, a final settlement or a bonus). The employee's advance / loan
   balance and salary payable balance are shown on his row while entering. */
const lineId = () => "l" + uid();
// payslips saved before they had an id get one from their position (stable for the run)
const ensureLids = () => Object.values(S.emppay || {}).forEach(r => (r.lines || []).forEach((l, i) => { if(!l.lid) l.lid = "i" + i; }));
const upAmt = l => l.unpaidAmt != null ? num(l.unpaidAmt) : r2(num(l.gross) / 30 * num(l.unpaidDays));
function calcLine(e, d){
  const basic = num(e.basic), housing = num(e.housing), transport = num(e.transport), other = num(e.otherAllow), g = r2(basic + housing + transport + other);
  const unpaidAmt = r2(g / 30 * num(d.unpaidDays)), addAmt = num(d.addAmt), otherDed = num(d.otherDed), earned = r2(g - unpaidAmt + addAmt - otherDed);
  return {lid: d.lid || lineId(), empId: e.id, name: e.name, code: e.code || "", dept: e.dept || "admin", designation: e.designation || "", basic, housing, transport, otherAllow: other, allow: r2(g - basic), gross: g,
    unpaidDays: num(d.unpaidDays), unpaidAmt, addAmt, addNote: d.addNote || "", otherDed, dedNote: d.dedNote || "", earned, recover: num(d.recover), net: r2(earned - num(d.recover))};
}
const payEmps = month => Object.values(S.employees).filter(e => e.active !== false && (!e.joinDate || e.joinDate <= monthEnd(month))).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
const runDate = (month, run) => (run && run.date) || (S.payDraft && S.payDraft.month === month && S.payDraft.date) || monthEnd(month);
// balances to show while entering: advances & loans outstanding, salary payable
function empBal(id){ if(!historyReady()) return null; const st = empStatement(id, histEntries2()); return {adv: st.adv, pay: st.bal}; }
function payDefaultMonth(){
  // the earliest open month, else the first month after the last posted one (from this month)
  const open = Object.values(S.emppay).filter(r => !r.posted).map(r => r.month).sort()[0]; if(open) return open;
  let m = iso(new Date()).slice(0,7); while(S.emppay[m] && S.emppay[m].posted) m = addMonths(m + "-01", 1).slice(0,7); return m;
}
function vEmpPayroll(){
  ensureLids();
  if(!S.payMonth) S.payMonth = payDefaultMonth();
  const month = S.payMonth, run = S.emppay[month], posted = run && run.posted;
  if(S.slipEdit) return slipForm();
  if(S.slipShow) return slipShow();
  const emps = payEmps(month);
  const draft = S.payDraft && S.payDraft.month === month ? S.payDraft : (S.payDraft = {month, date: run ? run.date : monthEnd(month), lines: Object.fromEntries(((run && run.lines) || []).map(l => [l.empId, {...l}]))});
  const lines = posted ? run.lines : emps.map(e => calcLine(e, draft.lines[e.id] || {}));
  const months = [...new Set([month, ...Object.keys(S.emppay), S.to.slice(0,7), S.from.slice(0,7)])].sort().reverse();
  if(!historyReady()) needHistory();
  const num_ = (l, k, w = 70) => `<input type="number" step="0.01" data-payl="${esc(l.empId)}" data-payk="${k}" value="${esc(l[k] || "")}" style="width:${w}px;text-align:right" ${posted ? "disabled" : ""}>`;
  const txt = (l, k, ph) => `<input data-payl="${esc(l.empId)}" data-payk="${k}" value="${esc(l[k] || "")}" placeholder="${ph}" style="width:120px;margin-top:3px;font-size:12px" ${posted ? "disabled" : ""}>`;
  const balCell = l => { const b = empBal(l.empId); return b ? `<div class="small">Adv./loan <b>${fmt(b.adv)}</b></div><div class="small muted">Payable ${fmt(b.pay)}</div>` : '<span class="small muted">…</span>'; };
  const table = posted ? `<div class="banner info">Payroll <b>${esc(month)}</b> is posted – it is in the register below. Click <b>Edit</b> there to bring it back here, change it and post it again.</div>` : lines.length ? `<div class="tbl"><table><thead><tr><th>Employee</th><th class="num">Gross</th><th class="num">Unpaid days</th><th class="num">Additions</th><th class="num">Other deductions</th><th class="num">Earned</th><th>Balances</th><th class="num">Advance / loan recovered</th><th class="num">Net pay</th></tr></thead><tbody>
    ${lines.map(l => `<tr><td><b>${esc(l.name)}</b><div class="small muted">${esc(DEPTS[l.dept] || "")}${l.designation ? " · " + esc(l.designation) : ""}</div></td><td class="num">${fmt(l.gross)}<div class="small muted">basic ${fmt(l.basic)}</div></td>
      <td class="num">${num_(l, "unpaidDays", 55)}${upAmt(l) ? `<div class="small neg">−${fmt(upAmt(l))}</div>` : ""}</td>
      <td class="num">${num_(l, "addAmt")}${posted ? (l.addNote ? `<div class="small muted">${esc(l.addNote)}</div>` : "") : `<div>${txt(l, "addNote", "e.g. overtime, bonus")}</div>`}</td>
      <td class="num">${num_(l, "otherDed")}${posted ? (l.dedNote ? `<div class="small muted">${esc(l.dedNote)}</div>` : "") : `<div>${txt(l, "dedNote", "describe the deduction")}</div>`}</td>
      <td class="num">${fmt(l.earned)}</td><td>${balCell(l)}</td><td class="num">${num_(l, "recover")}</td><td class="num"><b>${fmt(l.net)}</b></td>
    </tr>`).join("")}
    </tbody><tfoot><tr><td>${lines.length} employee(s)</td><td class="num">${fmt(sum(lines, l => l.gross))}</td><td class="num">${fmt(-sum(lines, l => upAmt(l)))}</td><td class="num">${fmt(sum(lines, l => num(l.addAmt)))}</td><td class="num">${fmt(-sum(lines, l => num(l.otherDed)))}</td><td class="num">${fmt(sum(lines, l => l.earned))}</td><td></td><td class="num">${fmt(sum(lines, l => l.recover))}</td><td class="num"><b>${fmt(sum(lines, l => l.net))}</b></td></tr></tfoot></table></div>
    <p class="small muted" style="margin-top:6px">Unpaid days are deducted at gross ÷ 30 per day. Advance / loan recovered moves the amount from 1180 Staff advances & loans to salary payable. Post to book the salaries and move the month to the register.</p>`
    : `<div class="empty"><b>No active employees for this month</b>Add employees on the Employees page.</div>`;
  const runs = Object.values(S.emppay).filter(r => r.posted).sort((a, b) => b.month.localeCompare(a.month));
  const act = (r, l) => `<div class="row" style="flex-wrap:nowrap;gap:4px"><button class="btn sm" data-slipshow="${esc(r.month)}" data-lid="${esc(l.lid || "")}">View</button><button class="btn sm" data-payedit="${esc(r.month)}">Edit</button><button class="btn sm danger" data-slipdel="${esc(r.month)}" data-lid="${esc(l.lid || "")}">Delete</button>${l.net > 0 ? `<button class="btn sm primary" data-emppay="${esc(l.empId)}" data-amt="${l.net}">Pay</button>` : ""}</div>`;
  const register = `<div class="section"><div class="head"><div><h2>Payroll register</h2><p class="sub">Every posted payslip, by month: View (print / PDF for signature and stamp), Delete, Pay. Edit brings the month back up to change it; posting it again returns it here.</p></div>${dlBtn("payreg")}</div>
    ${runs.length ? `<div class="tbl"><table><thead><tr><th>Month / employee</th><th>Payroll date</th><th class="num">Gross</th><th class="num">Deductions</th><th class="num">Additions</th><th class="num">Advance recovered</th><th class="num">Net pay</th><th></th></tr></thead><tbody>
    ${runs.map(r => { const L = (r.lines || []).slice().sort((x, y) => (x.name || "").localeCompare(y.name || ""));
      return `<tr style="background:var(--bg)"><td><b>${esc(r.month)}</b> ${r.posted ? '<span class="pill good">Posted</span>' : '<span class="pill warn">Draft</span>'} <span class="small muted">${L.length} payslip${L.length === 1 ? "" : "s"}</span></td><td>${esc(dmyS(r.date || monthEnd(r.month)))}</td><td class="num"><b>${fmt(sum(L, l => l.gross))}</b></td><td class="num"><b>${fmt(sum(L, l => upAmt(l) + num(l.otherDed)))}</b></td><td class="num"><b>${fmt(sum(L, l => num(l.addAmt)))}</b></td><td class="num"><b>${fmt(sum(L, l => num(l.recover)))}</b></td><td class="num"><b>${fmt(sum(L, l => l.net))}</b></td><td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="btn sm" data-payedit="${esc(r.month)}">Edit</button><button class="btn sm" data-slipprintall="${esc(r.month)}">All payslips PDF</button></div></td></tr>
      ${r.posted ? L.map(l => `<tr><td style="padding-left:22px">${esc(l.name)}<div class="small muted">${esc(DEPTS[l.dept] || "")}${num(l.unpaidDays) ? ` · ${num(l.unpaidDays)} unpaid day${num(l.unpaidDays) === 1 ? "" : "s"}` : ""}</div></td><td></td><td class="num">${fmt(l.gross)}</td><td class="num">${fmt(upAmt(l) + num(l.otherDed))}</td><td class="num">${fmt(num(l.addAmt))}</td><td class="num">${fmt(num(l.recover))}</td><td class="num"><b>${fmt(l.net)}</b></td><td>${act(r, l)}</td></tr>`).join("") : ""}`; }).join("")}
    </tbody></table></div>` : `<p class="sub">No payroll posted yet.</p>`}</div>`;
  return `<div class="section"><div class="head"><div><h2>Employee payroll · ${esc(month)}</h2><p class="sub">Monthly salaries of employees (not drivers). Posting books Dr salaries (administrative expenses, by department) / Cr 2110 Staff salaries payable on the payroll date, and adds the payslips to the register.</p></div>
    <div class="row"><select id="payM" aria-label="Month">${opts(Object.fromEntries(months.map(m => [m, m])), month)}</select><label class="small">Payroll date <input id="payD" type="date" value="${esc(runDate(month, run))}"></label>${posted ? `<span class="pill good">Posted</span>` : `<button class="btn primary" id="payPost" ${S.canWrite && S.db && lines.length ? "" : "disabled"}>Post payroll</button>`}<button class="btn" data-slipnew="${esc(month)}">New payslip</button></div></div>
  ${table}</div>${register}`;
}
DL.payreg = () => [`payroll_register.csv`, [["Month","Payroll date","Employee","Department","Gross","Unpaid days","Unpaid amount","Additions","Additions note","Other deductions","Deduction note","Earned","Advance / loan recovered","Net pay","Status"],
  ...Object.values(S.emppay).sort((a, b) => a.month.localeCompare(b.month)).flatMap(r => (r.lines || []).map(l => [r.month, r.date || monthEnd(r.month), l.name, DEPTS[l.dept] || "", l.gross, num(l.unpaidDays), upAmt(l), num(l.addAmt), l.addNote || "", num(l.otherDed), l.dedNote || "", l.earned, num(l.recover), l.net, r.posted ? "Posted" : "Draft"]))]];

/* a single payslip: new or edit */
function slipForm(){
  const E = S.slipEdit, run = S.emppay[E.month], old = E.lid && run ? (run.lines || []).find(l => l.lid === E.lid) : null, d = old || {}, emp = S.employees[E.empId || d.empId] || {};
  const fld = (n, l, type = "number", extra = "") => `<div class="f"><label for="sl_${n}">${l}</label><input id="sl_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(d[n] ?? "")}"${extra}></div>`;
  const b = (E.empId || d.empId) ? empBal(E.empId || d.empId) : null;
  return `<div class="section"><div class="head"><div><h2>${old ? "Edit payslip – " + esc(d.name) : "New payslip"}</h2><p class="sub">The salary components come from the employee's record (${old ? "as when this payslip was made" : "current"}). ${run && run.posted ? "The month is posted – the change is booked straight away." : ""}</p></div><button class="btn ghost" data-slipcancel="1">← Back</button></div>
  <form class="form" id="fSlip">
    <div class="f"><label for="sl_emp">Employee</label><select id="sl_emp" name="empId" ${old ? "disabled" : ""} required>${opts(Object.fromEntries(Object.values(S.employees).sort((a, c) => (a.name || "").localeCompare(c.name || "")).map(x => [x.id, x.name])), E.empId || d.empId || "", "Choose…")}</select></div>
    <div class="f"><label for="sl_month">Month</label><input id="sl_month" name="month" type="month" value="${esc(E.month)}" ${old ? "disabled" : ""} required></div>
    <div class="f"><label for="sl_date">Payroll date</label><input id="sl_date" name="date" type="date" value="${esc(runDate(E.month, run))}"></div>
    ${emp.id ? `<div class="f wide small muted">Monthly gross ${fmt(gross(emp))} (basic ${fmt(num(emp.basic))}, housing ${fmt(num(emp.housing))}, transport ${fmt(num(emp.transport))}, other ${fmt(num(emp.otherAllow))})${b ? ` · advances & loans outstanding <b>${fmt(b.adv)}</b> · salary payable <b>${fmt(b.pay)}</b>` : ""}</div>` : ""}
    ${fld("unpaidDays", "Unpaid days")}${fld("addAmt", "Additions (AED)")}${fld("addNote", "Additions – description", "text", ' placeholder="overtime, bonus, leave salary…"')}
    ${fld("otherDed", "Other deductions (AED)")}${fld("dedNote", "Deduction – description", "text", ' placeholder="damage, absence penalty…"')}${fld("recover", "Advance / loan recovered (AED)")}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save payslip</button><button class="btn ghost" type="button" data-slipcancel="1">Cancel</button></div></form></div>`;
}

/* the payslip document: print / PDF for signature and stamp */
function payslipHtml(run, l){
  const s = S.settings, co = s.company || "Royal Rides Limousine LLC", e = S.employees[l.empId] || {}, addr = [s.address, s.licence ? "Trade licence " + s.licence : "", s.trn ? "TRN " + s.trn : "", s.phone, s.email].filter(Boolean).join(" · ");
  const [y, m] = run.month.split("-"), monthTxt = new Date(+y, +m - 1, 1).toLocaleDateString("en-GB", {month: "long", year: "numeric"});
  const row = (t, v, cls = "") => `<tr${cls ? ` class="${cls}"` : ""}><td>${t}</td><td class="n">${v == null ? "" : fmt(v)}</td></tr>`;
  const earn = [["Basic salary", l.basic], ["Housing allowance", l.housing], ["Transport allowance", l.transport], ["Other allowance", l.otherAllow]].filter(([, v]) => v != null && num(v));
  if(l.housing == null && num(l.allow)) earn.push(["Allowances", l.allow]);
  if(num(l.addAmt)) earn.push([`Additions${l.addNote ? " – " + esc(l.addNote) : ""}`, l.addAmt]);
  const ded = []; if(upAmt(l) || num(l.unpaidDays)) ded.push([`Unpaid leave – ${num(l.unpaidDays)} day${num(l.unpaidDays) === 1 ? "" : "s"}`, upAmt(l) || r2(l.gross / 30 * num(l.unpaidDays))]);
  if(num(l.otherDed)) ded.push([`Other deductions${l.dedNote ? " – " + esc(l.dedNote) : ""}`, l.otherDed]); if(num(l.recover)) ded.push(["Advance / loan recovered", l.recover]);
  const tEarn = sum(earn, x => num(x[1])), tDed = sum(ded, x => num(x[1]));
  return `<div class="sp"><div class="hd"><div class="co">${esc(co)}${addr ? `<small>${esc(addr)}</small>` : ""}</div><div class="ttl"><b>PAYSLIP</b><span>${esc(monthTxt)} · paid on ${esc(dmyS(run.date || monthEnd(run.month)))}</span></div></div>
    <table class="info"><tr><td class="l">Employee</td><td><b>${esc(l.name)}</b></td><td class="l">Employee code</td><td>${esc(l.code || e.code || "—")}</td></tr>
    <tr><td class="l">Designation</td><td>${esc(l.designation || e.designation || "—")}</td><td class="l">Department</td><td>${esc(DEPTS[l.dept] || "")}</td></tr>
    <tr><td class="l">Joining date</td><td>${e.joinDate ? esc(dmyS(e.joinDate)) : "—"}</td><td class="l">Bank / IBAN</td><td>${esc(e.iban || "—")}</td></tr></table>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px">
      <table><tr class="sec"><th colspan="2">Earnings</th></tr>${earn.map(([t, v]) => row(t, v)).join("")}${row("Total earnings", tEarn, "t")}</table>
      <table><tr class="sec"><th colspan="2">Deductions</th></tr>${ded.map(([t, v]) => row(t, v)).join("") || row('<span class="sub">None</span>', null)}${row("Total deductions", tDed, "t")}</table></div>
    <table style="margin-top:6px">${row("<b>NET PAY (AED)</b>", l.net, "g")}</table>
    <p class="sub" style="margin:4px 0 0">Gross monthly salary ${fmt(l.gross)} · daily rate for unpaid leave ${fmt(r2(l.gross / 30))} (gross ÷ 30).</p>
    <div class="sigs" style="margin-top:22px"><div><div class="who">Employee</div><div class="line"></div><div>${esc(l.name)}</div><div class="cap">Received the above net pay – signature & date</div></div><div><div class="who">For ${esc(co)}</div><div class="line"></div><div>${esc(s.signatory || "")}${s.signatoryTitle ? (s.signatory ? ", " : "") + esc(s.signatoryTitle) : ""}</div><div class="cap">Authorised signatory & company stamp</div></div></div>
    <div class="foot">Payroll ${esc(run.month)} · printed ${esc(dmyS(iso(new Date())))}</div></div>`;
}
function slipShow(){
  const {month, lid} = S.slipShow, run = S.emppay[month], l = run && (run.lines || []).find(x => x.lid === lid);
  if(!l){ S.slipShow = null; return vEmpPayroll(); }
  return `<div class="section"><div class="head"><div><h2>Payslip – ${esc(l.name)} · ${esc(month)}</h2><p class="sub">Net pay AED ${fmt(l.net)} · paid on ${esc(dmyS(run.date || monthEnd(month)))}</p></div>
    <div class="row"><button class="btn ghost" data-back="1">← Back</button><button class="btn" data-slipprint="${esc(month)}" data-lid="${esc(lid)}">Print</button><button class="btn primary" data-slipview="${esc(month)}" data-lid="${esc(lid)}">Download PDF</button><button class="btn" data-slipedit="${esc(month)}" data-lid="${esc(lid)}">Edit</button></div></div>
    <div style="overflow:auto;background:#e9ebf0;padding:14px;border-radius:8px"><div style="margin:0 auto;width:210mm;box-shadow:0 2px 10px rgba(0,0,0,.15)"><style>${SAL_CSS}</style>${payslipHtml(run, l)}</div></div></div>`;
}
function printSlip(month, lid){
  const run = S.emppay[month], l = run && (run.lines || []).find(x => x.lid === lid); if(!l) return;
  const w = window.open("", "_blank"); if(!w){ toast("Allow pop-ups to print, or use Download PDF."); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(l.name)} ${esc(month)}</title><style>@page{size:A4;margin:0}body{margin:0}${SAL_CSS}</style></head><body>${payslipHtml(run, l)}</body></html>`);
  w.document.close(); setTimeout(() => { try{ w.focus(); w.print(); }catch(e){} }, 300);
}
async function printSlips(month, lid){
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  const run = S.emppay[month]; if(!run) return; const L = (run.lines || []).filter(l => !lid || l.lid === lid); if(!L.length) return;
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff";
  box.innerHTML = `<style>${SAL_CSS}.sp + .sp{page-break-before:always}</style>${L.map(l => payslipHtml(run, l)).join("")}`; document.body.appendChild(box);
  const name = lid ? `Payslip_${norm(L[0].name)}_${month}.pdf` : `Payslips_${month}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.95}, html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}, pagebreak: {mode: ["css", "legacy"], before: ".sp + .sp", avoid: ["table", ".sigs"]}}).from(box).save(); toast("Downloaded " + name); }
  catch(e){ toast("Could not make the PDF. Try again."); }
  box.remove();
}
async function saveRun(month, run){ const {id: _, ...b} = run; return writeOk(S.db.doc("emppay/" + month).set(b)); }
// journal: runs whose month ends inside the period
function postPayroll(add){
  Object.values(S.emppay).forEach(r => {
    if(!r.posted || r.date < S.from || r.date > S.to) return;
    (r.lines || []).forEach(l => {
      const m = `Salary ${r.month} – ${l.name}`;
      add(DEPT_ACCT[l.dept] || "6000", l.earned, 0, m, r.date); add("2110", 0, l.earned, m, r.date);
      if(num(l.recover)){ add("2110", l.recover, 0, "Advance recovered – " + m, r.date); add("1180", 0, l.recover, "Advance recovered – " + m, r.date); }
    });
  });
}

/* ---------- events ---------- */
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return; ensureLids();
  if(t.dataset.nav){ S.empEdit = null; S.empView = ""; return; }
  if(t.dataset.goto){ S.view = t.dataset.goto; S.empView = ""; render(); window.scrollTo(0,0); return; }
  if(t.dataset.empnew){ S.empEdit = {id: ""}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.empedit){ S.view = "employees"; S.empEdit = {id: t.dataset.empedit}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.empcancel){ S.empEdit = null; render(); return; }
  if(t.dataset.empview != null){ S.empView = t.dataset.empview; S.empEdit = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.emptab){ S.empTab = t.dataset.emptab; render(); return; }
  if(t.dataset.empnotif){ try{ await Notification.requestPermission(); }catch(e){} render(); return; }
  if(t.dataset.emppay || t.dataset.empadv){
    const id = t.dataset.emppay || t.dataset.empadv; S.view = "payments"; S.empView = "";
    BOOKS.newEmpPayment(id, t.dataset.emppay ? "2110" : "1180", t.dataset.emppay ? num(t.dataset.amt) : 0, t.dataset.emppay ? "Salary payment" : "Advance / loan");
    render(); window.scrollTo(0,0); return;
  }
  if(t.dataset.empofferfor){ const e = S.employees[t.dataset.empofferfor]; if(!e || !window.newEmpOffer) return; S.view = "empoffers"; newEmpOffer(e); render(); window.scrollTo(0,0); return; }
  if(t.id === "payPost"){
    const month = S.payMonth || S.to.slice(0,7), d = S.payDraft || {lines: {}}, run = S.emppay[month], emps = payEmps(month);
    // every active employee, plus payslips already added to the month for anyone else
    const lines = [...emps.map(e => calcLine(e, d.lines[e.id] || {})), ...((run && run.lines) || []).filter(l => !emps.some(e => e.id === l.empId))];
    t.disabled = true;
    if(await writeOk(S.db.doc("emppay/" + month).set({month, date: d.date || monthEnd(month), lines, posted: true, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()}))){ S.payDraft = null; S.payMonth = ""; toast(`Payroll ${month} posted on ${dmyS(d.date || monthEnd(month))} – ${lines.length} payslips moved to the register.`); render(); }
    return;
  }
  if(t.dataset.payedit){
    const month = t.dataset.payedit, r = S.emppay[month]; if(!r) return;
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again – unposts it"; return; }
    if(await saveRun(month, {...r, posted: false})){ S.payMonth = month; S.payDraft = null; S.slipShow = null; S.slipEdit = null; toast(`Payroll ${month} is open for editing – its salaries are not booked until you post it again.`); render(); window.scrollTo(0,0); } return;
  }
  if(t.dataset.paymonth){ S.slipShow = null; S.payMonth = t.dataset.paymonth; S.payDraft = null; S.slipEdit = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.slipnew){ S.slipEdit = {month: t.dataset.slipnew, lid: "", empId: ""}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.slipedit){ S.slipShow = null; S.slipEdit = {month: t.dataset.slipedit, lid: t.dataset.lid}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.slipcancel){ S.slipEdit = null; render(); return; }
  if(t.dataset.slipview){ printSlips(t.dataset.slipview, t.dataset.lid); return; }
  if(t.dataset.slipshow){ S.view = "emppayroll"; S.empView = ""; S.slipShow = {month: t.dataset.slipshow, lid: t.dataset.lid}; S.slipEdit = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.slipclose){ S.slipShow = null; render(); return; }
  if(t.dataset.slipprint){ printSlip(t.dataset.slipprint, t.dataset.lid); return; }
  if(t.dataset.slipprintall){ printSlips(t.dataset.slipprintall, ""); return; }
  if(t.dataset.slipdel){
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again"; return; }
    const month = t.dataset.slipdel, run = S.emppay[month]; if(!run) return; const lines = (run.lines || []).filter(l => l.lid !== t.dataset.lid);
    const ok = lines.length ? await saveRun(month, {...run, lines}) : await writeOk(S.db.doc("emppay/" + month).delete());
    if(ok){ S.payDraft = null; toast("Payslip deleted – its salary is no longer booked."); render(); } return;
  }
  if(t.id === "payReopen"){
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to reopen"; return; }
    const month = S.payMonth || S.to.slice(0,7), r = S.emppay[month]; if(!r) return; const {id:_, ...b} = r;
    if(await writeOk(S.db.doc("emppay/" + month).set({...b, posted: false}))){ S.payDraft = null; toast("Payroll reopened."); render(); } return;
  }
  if(t.id === "payCsv" || t.dataset.legacy === "payCsv"){ const month = S.payMonth || S.to.slice(0,7), r = S.emppay[month]; if(!r) return;
    saveCsv(`payroll_${month}.csv`, [["Employee","Department","IBAN","Basic","Allowances","Gross","Unpaid days","Unpaid amount","Additions","Additions note","Other deductions","Deduction note","Earned","Advance recovered","Net pay"], ...r.lines.map(l => [l.name, DEPTS[l.dept] || "", (S.employees[l.empId] || {}).iban || "", l.basic, l.allow, l.gross, l.unpaidDays, upAmt(l), num(l.addAmt), l.addNote || "", l.otherDed, l.dedNote || "", l.earned, l.recover, l.net])]); return; }
});
document.addEventListener("input", ev => {
  const t = ev.target; if(!t.dataset || !t.dataset.payl || !S.payDraft) return;
  (S.payDraft.lines[t.dataset.payl] ||= {})[t.dataset.payk] = t.value;
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.dataset && t.dataset.payl){ render(); return; }
  if(t.id === "payM"){ S.payMonth = t.value; S.payDraft = null; render(); return; }
  if(t.id === "payD"){ const month = S.payMonth || S.to.slice(0,7), run = S.emppay[month]; if(S.payDraft) S.payDraft.date = t.value;
    if(run && run.posted && t.value){ saveRun(month, {...run, date: t.value}).then(ok => { if(ok) toast("Payroll date changed – the run is booked on " + dmyS(t.value) + "."); render(); }); } return; }
  if(t.id === "expF"){ S.expFilter = t.value; render(); return; }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fSlip") return; ev.preventDefault(); if(!S.db) return; ensureLids();
  const E = S.slipEdit, d = Object.fromEntries(new FormData(f).entries()), month = E.lid ? E.month : d.month, run0 = S.emppay[month];
  const old = E.lid && run0 ? (run0.lines || []).find(l => l.lid === E.lid) : null, empId = old ? old.empId : d.empId, emp = S.employees[empId];
  if(!emp || !month){ toast("Choose the employee and the month."); return; }
  // an edited payslip keeps the salary components it was made with
  const base = old ? {...emp, basic: old.basic, housing: old.housing ?? 0, transport: old.transport ?? 0, otherAllow: old.otherAllow ?? (old.housing == null ? old.allow : 0), name: old.name, code: old.code, dept: old.dept, designation: old.designation} : emp;
  const line = calcLine(base, {...d, lid: old ? old.lid : ""});
  const run = run0 ? {...run0} : {month, lines: [], posted: true, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()};
  run.date = d.date || run.date || monthEnd(month);
  if(!old && (run.lines || []).some(l => l.empId === empId) && !confirm(emp.name + " already has a payslip for " + month + ". Add another one (e.g. a bonus or final settlement)?")) return;
  run.lines = old ? run.lines.map(l => l.lid === old.lid ? line : l) : [...(run.lines || []), line];
  if(await saveRun(month, run)){ S.slipEdit = null; S.payMonth = month; S.payDraft = null; toast(`Payslip saved – ${emp.name}, ${month}, net AED ${fmt(line.net)}${run.posted ? " (booked)" : ""}.`); render(); }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fEmp") return; ev.preventDefault(); if(!S.db) return;
  const fd = Object.fromEntries(new FormData(f).entries()), id = f.dataset.id || ("e-" + uid()), {id:_, ...prev} = S.employees[id] || {};
  ["basic","housing","transport","otherAllow","opening"].forEach(k => fd[k] = num(fd[k])); fd.active = fd.active !== "false";
  if(await writeOk(S.db.doc("employees/" + id).set({...prev, ...fd}))){ S.empEdit = null; toast("Employee saved."); render(); }
});
window.EMP = {banner: empBanner, post: postPayroll, docFields, dashList};
window.BOOK_VIEWS = {...(window.BOOK_VIEWS || {}), employees: vEmployees, emppayroll: vEmpPayroll, expiries: vExpiries, empoffers: () => docsView("empoffer")};
