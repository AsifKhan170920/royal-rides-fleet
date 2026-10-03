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
  if(S.view === "expiries") return "";
  const exp = due.filter(x => daysLeft(x.date) < 0).length;
  return `<div class="banner"><b>Staff documents:</b> ${exp ? `${exp} expired, ` : ""}${due.length - exp} expiring within ${remindDays()} days (${esc(due.slice(0, 3).map(x => `${x.who} – ${x.label} ${dmyS(x.date)}`).join("; "))}${due.length > 3 ? "…" : ""}). <button class="btn sm" data-nav="expiries">Visa & EID expiry</button></div>`;
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
const EMP_TABS = {details:"Details & documents", pay:"Salary & payments", letters:"Offer letters"};
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
      body = `<div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Salary payable</th></tr></thead><tbody>
        <tr><td></td><td><b>Opening balance</b></td><td></td><td></td><td class="num"><b>${aed(num(e.opening))}</b></td></tr>
        ${st.lines.map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${esc(l.desc)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td></tr>`).join("")}
      </tbody><tfoot><tr><td colspan="4">Salary payable at ${esc(dmyS(S.to))}</td><td class="num"><b>${aed(st.bal)}</b></td></tr></tfoot></table></div>
      <div class="row" style="margin-top:10px;gap:18px"><span>Advances & loans outstanding <b class="mono">${fmt(st.adv)}</b></span>${st.bal > 0.005 ? `<button class="btn" data-emppay="${esc(id)}" data-amt="${r2(st.bal)}">Pay AED ${fmt(st.bal)}</button>` : ""}<button class="btn" data-empadv="${esc(id)}">Give an advance / loan</button></div>`;
    }
  } else {
    const docs = Object.values(S.docs || {}).filter(d => d.kind === "empoffer" && d.refId === id);
    body = `<div class="row" style="margin-bottom:10px"><button class="btn primary" data-empofferfor="${esc(id)}">New offer letter</button></div>
      ${docs.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Status</th><th>Last saved</th><th></th></tr></thead><tbody>${docs.map(d => `<tr><td>${esc(dmyS((d.fields || {}).start || ""))}</td><td><span class="pill ${d.status === "final" ? "good" : "warn"}">${d.status === "final" ? "Final" : "Draft"}</span></td><td class="small muted">${esc(d.updatedText || "")}</td><td class="row"><button class="btn sm" data-docopen="${esc(d.id)}" data-goto="empoffers">Open</button><button class="btn sm" data-docpdf="${esc(d.id)}">PDF</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="sub">No offer letter for this employee yet.</p>`}`;
  }
  return `<div class="section"><div class="head"><div><h2>${esc(e.name)}${e.code ? ` <span class="mono small muted">${esc(e.code)}</span>` : ""}</h2><p class="sub">${esc(e.designation || "")}${e.dept ? " · " + esc(DEPTS[e.dept]) : ""} · monthly gross AED ${fmt(gross(e))}</p></div>
    <div class="row"><button class="btn ghost" data-empview="">← All employees</button><button class="btn" data-empedit="${esc(id)}">Edit</button></div></div>
  ${tabBtns("data-emptab", tab, EMP_TABS)}${body}</div>`;
}
const histEntries2 = () => (S.ledger && S.ledger.entries && !S.ledger.loading) ? S.ledger.entries : S.entries;
// an employee's salary-payable account: payroll runs (credit), recoveries and payments (debit), plus advances
function empStatement(id, entries){
  const p = "e:" + id, mv = window.BOOKS ? BOOKS.partyMoves(entries, p, "2110") : [], adv = window.BOOKS ? BOOKS.partyMoves(entries, p, "1180") : [];
  const lines = mv.map(m => ({date: m.date, desc: m.desc, dr: m.dr, cr: m.cr}));
  let rec = 0;
  Object.values(S.emppay).filter(r => r.posted && r.date <= S.to).forEach(r => (r.lines || []).filter(l => l.empId === id).forEach(l => {
    lines.push({date: r.date, desc: `Salary ${r.month}${num(l.unpaidDays) ? ` (${num(l.unpaidDays)} unpaid days)` : ""}`, cr: num(l.earned)});
    if(num(l.recover)){ lines.push({date: r.date, desc: `Advance recovered – salary ${r.month}`, dr: num(l.recover)}); rec += num(l.recover); }
  }));
  lines.sort((a,b) => a.date.localeCompare(b.date) || (b.cr ? 1 : 0) - (a.cr ? 1 : 0));
  let bal = num((S.employees[id] || {}).opening); lines.forEach(l => { bal = r2(bal + (l.cr || 0) - (l.dr || 0)); l.bal = bal; });
  return {lines, bal, adv: r2(sum(adv, m => m.dr - m.cr) - rec)};
}

/* ---------- payroll ---------- */
function vEmpPayroll(){
  const month = S.payMonth || S.to.slice(0,7), run = S.emppay[month], posted = run && run.posted;
  const emps = Object.values(S.employees).filter(e => e.active !== false && (!e.joinDate || e.joinDate <= monthEnd(month))).sort((a,b) => (a.name || "").localeCompare(b.name || ""));
  const draft = S.payDraft && S.payDraft.month === month ? S.payDraft : (S.payDraft = {month, lines: Object.fromEntries(((run && run.lines) || []).map(l => [l.empId, {...l}]))});
  const lineFor = e => posted ? run.lines.find(l => l.empId === e.id) : calcLine(e, draft.lines[e.id] || {});
  const lines = posted ? run.lines : emps.map(e => lineFor(e));
  const months = [...new Set([month, ...Object.keys(S.emppay), S.to.slice(0,7), S.from.slice(0,7)])].sort().reverse();
  const inp = (e, k, v) => `<input type="number" step="0.01" data-payl="${esc(e.empId)}" data-payk="${k}" value="${esc(v || "")}" style="width:90px;text-align:right" ${posted ? "disabled" : ""}>`;
  return `<div class="section"><div class="head"><div><h2>Employee payroll · ${esc(month)}</h2><p class="sub">Monthly salaries of employees (not drivers). Posting the run records Dr salaries (administrative expenses, by department) / Cr 2110 Staff salaries payable on ${esc(dmyS(monthEnd(month)))}. Then pay each employee from Payments (account 2110), or with the Pay buttons.</p></div>
    <div class="row"><select id="payM" aria-label="Month">${opts(Object.fromEntries(months.map(m => [m, m])), month)}</select>${posted ? `<span class="pill good">Posted</span><button class="btn" id="payCsv">Export CSV</button><button class="btn danger" id="payReopen">Reopen</button>` : `<button class="btn primary" id="payPost" ${S.canWrite && S.db && lines.length ? "" : "disabled"}>Post payroll</button>`}</div></div>
  ${lines.length ? `<div class="tbl"><table><thead><tr><th>Employee</th><th>Department</th><th class="num">Basic</th><th class="num">Allowances</th><th class="num">Gross</th><th class="num">Unpaid days</th><th class="num">Other deductions</th><th class="num">Earned</th><th class="num">Advance recovered</th><th class="num">Net pay</th><th></th></tr></thead><tbody>
  ${lines.map(l => `<tr><td>${esc(l.name)}</td><td class="small">${esc(DEPTS[l.dept] || "")}</td><td class="num">${fmt(l.basic)}</td><td class="num">${fmt(l.allow)}</td><td class="num">${fmt(l.gross)}</td><td class="num">${inp(l, "unpaidDays", l.unpaidDays)}</td><td class="num">${inp(l, "otherDed", l.otherDed)}</td><td class="num">${fmt(l.earned)}</td><td class="num">${inp(l, "recover", l.recover)}</td><td class="num"><b>${fmt(l.net)}</b></td>
    <td>${posted && l.net > 0 ? `<button class="btn sm" data-emppay="${esc(l.empId)}" data-amt="${l.net}">Pay</button>` : ""}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="4">${lines.length} employee(s)</td><td class="num">${fmt(sum(lines, l => l.gross))}</td><td></td><td></td><td class="num">${fmt(sum(lines, l => l.earned))}</td><td class="num">${fmt(sum(lines, l => l.recover))}</td><td class="num"><b>${fmt(sum(lines, l => l.net))}</b></td><td></td></tr></tfoot></table></div>
  <p class="small muted" style="margin-top:6px">Unpaid days are deducted at gross ÷ 30 per day. Advance recovered moves the amount from 1180 Staff advances & loans to the salary payable account.${posted ? ` Posted ${esc(new Date(run.at).toLocaleString("en-GB"))}${run.by ? " by " + esc(run.by) : ""}.` : ""}</p>` : `<div class="empty"><b>No active employees for this month</b>Add employees on the Employees page.</div>`}</div>`;
}
function calcLine(e, d){
  const g = gross(e), unpaid = r2(g / 30 * num(d.unpaidDays)), earned = r2(g - unpaid - num(d.otherDed));
  return {empId: e.id, name: e.name, dept: e.dept || "admin", basic: num(e.basic), allow: r2(g - num(e.basic)), gross: g, unpaidDays: num(d.unpaidDays), otherDed: num(d.otherDed), earned, recover: num(d.recover), net: r2(earned - num(d.recover))};
}
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
  const t = ev.target.closest("button"); if(!t) return;
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
    const month = S.payMonth || S.to.slice(0,7), d = S.payDraft || {lines: {}};
    const lines = Object.values(S.employees).filter(e => e.active !== false && (!e.joinDate || e.joinDate <= monthEnd(month))).map(e => calcLine(e, d.lines[e.id] || {}));
    t.disabled = true;
    if(await writeOk(S.db.doc("emppay/" + month).set({month, date: monthEnd(month), lines, posted: true, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()}))){ S.payDraft = null; toast(`Payroll ${month} posted.`); render(); }
    return;
  }
  if(t.id === "payReopen"){
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to reopen"; return; }
    const month = S.payMonth || S.to.slice(0,7), r = S.emppay[month]; if(!r) return; const {id:_, ...b} = r;
    if(await writeOk(S.db.doc("emppay/" + month).set({...b, posted: false}))){ S.payDraft = null; toast("Payroll reopened."); render(); } return;
  }
  if(t.id === "payCsv"){ const month = S.payMonth || S.to.slice(0,7), r = S.emppay[month]; if(!r) return;
    saveCsv(`payroll_${month}.csv`, [["Employee","Department","IBAN","Basic","Allowances","Gross","Unpaid days","Other deductions","Earned","Advance recovered","Net pay"], ...r.lines.map(l => [l.name, DEPTS[l.dept] || "", (S.employees[l.empId] || {}).iban || "", l.basic, l.allow, l.gross, l.unpaidDays, l.otherDed, l.earned, l.recover, l.net])]); return; }
});
document.addEventListener("input", ev => {
  const t = ev.target; if(!t.dataset || !t.dataset.payl || !S.payDraft) return;
  (S.payDraft.lines[t.dataset.payl] ||= {})[t.dataset.payk] = t.value;
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.dataset && t.dataset.payl){ render(); return; }
  if(t.id === "payM"){ S.payMonth = t.value; S.payDraft = null; render(); return; }
  if(t.id === "expF"){ S.expFilter = t.value; render(); return; }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fEmp") return; ev.preventDefault(); if(!S.db) return;
  const fd = Object.fromEntries(new FormData(f).entries()), id = f.dataset.id || ("e-" + uid()), {id:_, ...prev} = S.employees[id] || {};
  ["basic","housing","transport","otherAllow","opening"].forEach(k => fd[k] = num(fd[k])); fd.active = fd.active !== "false";
  if(await writeOk(S.db.doc("employees/" + id).set({...prev, ...fd}))){ S.empEdit = null; toast("Employee saved."); render(); }
});
window.EMP = {banner: empBanner, post: postPayroll, docFields};
window.BOOK_VIEWS = {...(window.BOOK_VIEWS || {}), employees: vEmployees, emppayroll: vEmpPayroll, expiries: vExpiries, empoffers: () => docsView("empoffer")};
