/* Settings in three tabs: Business information · VAT · General (books start, targets, reminders, tips).
   Business information: legal details, logo (on every statement, payslip and letter), trade licence (authority,
   number, issue and expiry – reminded before expiry), share capital and partners. Changes to the MOA / licence
   (partners, shares, capital, manager) are kept as dated versions: each has an effective date, and the one in force on
   a date is used for that date.
   VAT: registration (TRN, effective date), tax period (quarterly / monthly and the month the first period ends),
   return due 28 days after the period end (reminded), how fares and expenses are treated (recoverable or not), the
   tax codes (standard, zero-rated, exempt, out of scope, reverse charge, non-recoverable) with their return boxes,
   the VAT accounts, and the default tax code of each income, expense and asset account. The VAT tab also shows
   each return period: output VAT, input VAT and the net payable / refundable from the books. */
S.setTab = S.setTab || "biz"; S.ownEdit = S.ownEdit || null;
const SET_TABS = {biz: "Business information", vat: "VAT", gen: "General", data: "Backup & reset"};
const DEFAULT_TAXCODES = [
  {id: "SR", name: "Standard rated 5%", rate: 5, recover: true, box: "1 / 9"},
  {id: "SRN", name: "Standard 5% – not recoverable", rate: 5, recover: false, box: "– (cost)"},
  {id: "ZR", name: "Zero rated 0%", rate: 0, recover: true, box: "2"},
  {id: "EX", name: "Exempt", rate: 0, recover: false, box: "3"},
  {id: "OS", name: "Out of scope", rate: 0, recover: false, box: "–"},
  {id: "RC", name: "Reverse charge 5% (imports of services)", rate: 5, recover: true, box: "3 / 10"}];
const taxCodes = () => (S.settings.taxCodes && S.settings.taxCodes.length ? S.settings.taxCodes : DEFAULT_TAXCODES);
function coLogo(h = 38){ return S.settings.logo ? `<img src="${S.settings.logo}" alt="" style="height:${h}px;max-width:140px;object-fit:contain;vertical-align:middle;margin-right:10px">` : ""; }

/* ---------- ownership: dated versions of capital and partners ---------- */
const ownVersions = () => (S.settings.ownership || []).slice().sort((a, b) => (a.from || "").localeCompare(b.from || ""));
const ownAt = day => { let v = null; ownVersions().forEach(x => { if(x.from <= day) v = x; }); return v; };

/* ---------- VAT periods ---------- */
function vatPeriods(){
  const s = S.settings; if(!s.vatRegistered || !s.vatFrom) return [];
  const len = s.vatPeriod === "monthly" ? 1 : 3, endM = num(s.vatFirstEnd) || 0, out = [];
  // the first period ending on or after the registration date in the chosen cycle
  let end = monthEnd(s.vatFrom.slice(0,7));
  if(len === 3 && endM){ for(let i = 0; i < 3 && +end.slice(5,7) % 3 !== endM % 3; i++) end = monthEnd(addMonths(end.slice(0,7) + "-01", 1).slice(0,7)); }
  let start = s.vatFrom; const lim = addMonths(iso(new Date()).slice(0,7) + "-01", 4);
  while(start <= lim && out.length < 60){ out.push({from: start, to: end, due: addDays(end, 28)}); start = addDays(end, 1); end = monthEnd(addMonths(start.slice(0,7) + "-01", len - 1).slice(0,7)); }
  return out;
}
function vatSummary(p){
  if(!historyReady()) return null;
  const J = historyJournal().filter(l => l.date >= p.from && l.date <= p.to), mv = c => r2(sum(J.filter(l => l.acct === c), l => l.cr - l.dr));
  const out = mv(S.settings.vatOutAcct || "2300"), inp = -mv(S.settings.vatInAcct || "1300");
  return {out, inp, net: r2(out - inp)};
}

/* ---------- the page ---------- */
function setView(){
  const tab = SET_TABS[S.setTab] ? S.setTab : "biz";
  let body = "";
  if(tab === "gen"){ SET.busy = true; try{ body = vSettings(); } finally { SET.busy = false; } }
  else if(tab === "biz") body = bizTab(); else if(tab === "data") body = dataTab(); else body = vatTab();
  return `<div class="section" style="padding-bottom:6px"><div class="head"><div><h2>Settings</h2><p class="sub">Business information, VAT and the general rules of the software.</p></div></div>${tabBtns("data-settab", tab, SET_TABS)}</div>${body}`;
}
function bizTab(){
  const s = S.settings, fld = (n, l, type = "text", extra = "") => `<div class="f"><label for="bz_${n}">${l}</label><input id="bz_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(s[n] ?? (n === "company" ? "Royal Rides Limousine LLC" : ""))}"${extra}></div>`;
  const cur = ownAt(iso(new Date())), V = ownVersions();
  const E = S.ownEdit, ev = E ? (E.idx != null ? V[E.idx] : {from: iso(new Date()), capital: cur ? cur.capital : "", shares: cur ? cur.shares : "", partners: cur ? JSON.parse(JSON.stringify(cur.partners || [])) : [{}]}) : null;
  if(E && !E.rows) E.rows = (ev.partners && ev.partners.length ? ev.partners : [{}]).map(p => ({...p}));
  const lic = s.licenceExpiry ? Math.round((parseD(s.licenceExpiry) - parseD(iso(new Date()))) / 86400000) : null;
  const partnersTable = v => `<div class="tbl"><table><thead><tr><th>Partner / shareholder</th><th>Nationality</th><th>Passport / Emirates ID</th><th>Role</th><th class="num">Shares</th><th class="num">Share %</th><th class="num">Capital (AED)</th></tr></thead><tbody>
    ${(v.partners || []).map(p => { const pct = num(v.shares) ? 100 * num(p.shares) / num(v.shares) : num(p.pct); return `<tr><td><b>${esc(p.name || "")}</b></td><td>${esc(p.nationality || "")}</td><td class="mono small">${esc(p.idNo || "")}</td><td class="small">${esc(p.role || "")}</td><td class="num">${num(p.shares) || ""}</td><td class="num">${pct ? pct.toFixed(2) + "%" : ""}</td><td class="num">${fmt(num(v.capital) * pct / 100)}</td></tr>`; }).join("")}
    </tbody><tfoot><tr><td colspan="4">Total</td><td class="num">${sum(v.partners || [], p => num(p.shares)) || ""}</td><td class="num">${(num(v.shares) ? 100 * sum(v.partners || [], p => num(p.shares)) / num(v.shares) : sum(v.partners || [], p => num(p.pct))).toFixed(2)}%</td><td class="num">${fmt(num(v.capital))}</td></tr></tfoot></table></div>`;
  const ownForm = E ? `<form class="form" id="fOwn" style="border:1px solid var(--line);padding:10px;border-radius:8px;margin-top:10px"><div class="f wide"><b>${E.idx != null ? "Edit" : "New"} MOA / licence change</b> <span class="small muted">– capital, shares and partners from the effective date (e.g. a partner's shares transferred).</span></div>
    <div class="f"><label for="ow_from">Effective date</label><input id="ow_from" name="from" type="date" required value="${esc(ev.from || "")}"></div>
    <div class="f"><label for="ow_cap">Share capital (AED)</label><input id="ow_cap" name="capital" type="number" step="0.01" value="${esc(ev.capital ?? "")}"></div>
    <div class="f"><label for="ow_sh">Number of shares</label><input id="ow_sh" name="shares" type="number" step="1" value="${esc(ev.shares ?? "")}"></div>
    <div class="f"><label for="ow_ref">Reference (MOA amendment / notary no.)</label><input id="ow_ref" name="ref" value="${esc(ev.ref || "")}"></div>
    <div class="f wide"><div class="tbl"><table><thead><tr><th>Name</th><th>Nationality</th><th>Passport / Emirates ID</th><th>Role</th><th>Shares</th><th></th></tr></thead><tbody>
      ${E.rows.map((p, i) => `<tr><td><input data-ownrow="${i}" data-k="name" value="${esc(p.name || "")}" placeholder="Partner name"></td><td><input data-ownrow="${i}" data-k="nationality" value="${esc(p.nationality || "")}" style="width:110px"></td><td><input data-ownrow="${i}" data-k="idNo" value="${esc(p.idNo || "")}" style="width:140px"></td><td><select data-ownrow="${i}" data-k="role">${opts({partner: "Partner", manager: "Partner & manager", sleeping: "Sleeping partner", manager_only: "Manager (not a partner)"}, p.role || "partner")}</select></td><td><input data-ownrow="${i}" data-k="shares" type="number" step="1" value="${esc(p.shares ?? "")}" style="width:90px"></td><td><button class="btn sm ghost" type="button" data-ownrowdel="${i}">×</button></td></tr>`).join("")}
    </tbody></table></div><button class="btn sm" type="button" data-ownrowadd="1" style="margin-top:6px">Add partner</button></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save change</button><button class="btn ghost" type="button" data-ownedit="">Cancel</button>${E.idx != null ? `<button class="btn danger" type="button" data-owndel="${E.idx}">Delete this version</button>` : ""}</div></form>` : "";
  return `<div class="section"><div class="head"><div><h2>Business information</h2><p class="sub">Shown on letters, statements, payslips and invoices.</p></div></div>
  <form class="form" id="fBiz">
    <div class="f wide"><label>Logo</label><div class="row" style="gap:10px;align-items:center">${s.logo ? `<img src="${s.logo}" alt="Logo" style="height:56px;max-width:180px;object-fit:contain;border:1px solid var(--line);border-radius:6px;padding:4px;background:#fff">` : '<span class="small muted">No logo yet</span>'}<label class="btn sm" style="cursor:pointer">${s.logo ? "Change logo" : "Upload logo"}<input type="file" accept="image/*" id="logoFile" hidden></label>${s.logo ? '<button class="btn sm ghost" type="button" data-logodel="1">Remove</button>' : ""}</div></div>
    ${fld("company", "Company name (trade name)", "text", " required")}${fld("legalName", "Legal name (as on the licence)")}
    <div class="f"><label for="bz_form">Legal form</label><select id="bz_form" name="legalForm">${opts({llc: "Limited Liability Company (LLC)", sole: "Sole establishment", civil: "Civil company", fze: "Free zone (FZE / FZ-LLC)", branch: "Branch", other: "Other"}, s.legalForm || "llc")}</select></div>
    ${fld("established", "Established on", "date")}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Trade licence</b> ${lic != null ? (lic < 0 ? `<span class="pill bad">Expired ${-lic} days ago</span>` : lic <= 30 ? `<span class="pill warn">${lic} days left</span>` : `<span class="pill good">Valid</span>`) : ""}</div>
    ${fld("licence", "Licence no.")}${fld("licenceAuthority", "Issuing authority", "text", ' placeholder="e.g. Department of Economy & Tourism – Dubai"')}${fld("licenceIssue", "Issue date", "date")}${fld("licenceExpiry", "Expiry date", "date")}${fld("licenceActivity", "Licensed activity", "text", ' placeholder="e.g. Limousine passenger transport"')}
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Contact & tax</b></div>
    ${fld("address", "Address")}${fld("poBox", "P.O. Box")}${fld("phone", "Phone")}${fld("email", "Email", "email")}${fld("website", "Website")}${fld("trn", "TRN (VAT registration no.)")}
    ${fld("signatory", "Authorised signatory")}${fld("signatoryTitle", "Signatory title", "text", ' placeholder="e.g. Managing Director"')}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite && S.db ? "" : "disabled"}>Save business information</button></div>
  </form></div>
  <div class="section"><div class="head"><div><h2>Share capital & partners</h2><p class="sub">${cur ? `In force since ${esc(dmyS(cur.from))}${cur.ref ? " · " + esc(cur.ref) : ""} · capital AED ${fmt(num(cur.capital))}${num(cur.shares) ? ` in ${num(cur.shares)} shares of AED ${fmt(num(cur.capital) / num(cur.shares))}` : ""}` : "No capital or partners entered yet."} Each change to the MOA / licence is a new version from its effective date.</p></div><button class="btn primary" data-ownedit="new">New MOA / licence change</button></div>
    ${cur ? partnersTable(cur) : ""}${ownForm}
    ${V.length ? `<h3 style="margin:14px 0 6px">History of changes</h3><div class="tbl"><table><thead><tr><th>Effective from</th><th>Until</th><th class="num">Capital</th><th class="num">Shares</th><th>Partners</th><th>Reference</th><th></th></tr></thead><tbody>
      ${V.slice().reverse().map((v, ri) => { const i = V.length - 1 - ri, next = V[i + 1]; return `<tr${v === cur ? ' style="background:var(--brass-soft)"' : ""}><td>${esc(dmyS(v.from))}</td><td>${next ? esc(dmyS(addDays(next.from, -1))) : "—"}</td><td class="num">${fmt(num(v.capital))}</td><td class="num">${num(v.shares) || ""}</td><td class="small" style="white-space:normal">${esc((v.partners || []).map(p => `${p.name} ${num(v.shares) ? (100 * num(p.shares) / num(v.shares)).toFixed(1) + "%" : ""}`).join(", "))}</td><td class="small">${esc(v.ref || "")}</td><td><button class="btn sm" data-ownedit="${i}">Edit</button></td></tr>`; }).join("")}
    </tbody></table></div>` : ""}</div>`;
}
function vatTab(){
  const s = S.settings, fld = (n, l, type = "text", extra = "") => `<div class="f"><label for="vt_${n}">${l}</label><input id="vt_${n}" name="${n}" type="${type}" value="${esc(s[n] ?? "")}"${extra}></div>`;
  const P = vatPeriods(), today = iso(new Date()), codes = taxCodes();
  const wait = historyReady() ? "" : (needHistory(), "");
  const accts = Object.keys(ACCT).filter(c => ["4", "5", "6"].includes(c[0]) || c === "1500").sort();
  const map = s.taxMap || {}, defCode = c => map[c] || (c[0] === "4" ? (c === "4000" || c === "4010" ? (s.fareVat === "standard" ? "SR" : "EX") : "SR") : c === "5100" || c === "5900" || c === "5285" || c === "6000" || c === "6001" || c === "6002" || c === "6020" || c === "6030" || c === "5950" || c === "5955" || c === "5220" || c === "5225" ? "OS" : (s.inputVatRecoverable ? "SR" : "SRN"));
  return `<div class="section"><div class="head"><div><h2>VAT registration & returns</h2><p class="sub">The return is due 28 days after the end of each tax period; you are reminded 14 days before. Confirm the treatment of limousine fares with your tax adviser.</p></div></div>
  <form class="form" id="fVat">
    <div class="f"><label for="vt_reg">VAT registered</label><select id="vt_reg" name="vatRegistered">${opts({true: "Yes", false: "No"}, String(!!s.vatRegistered))}</select></div>
    ${fld("trn", "TRN")}${fld("vatFrom", "Registration effective from", "date")}
    <div class="f"><label for="vt_per">Tax period</label><select id="vt_per" name="vatPeriod">${opts({quarterly: "Quarterly", monthly: "Monthly"}, s.vatPeriod || "quarterly")}</select></div>
    <div class="f"><label for="vt_fe">Quarters end in (FTA stagger)</label><select id="vt_fe" name="vatFirstEnd">${opts({"3": "Mar · Jun · Sep · Dec", "1": "Jan · Apr · Jul · Oct", "2": "Feb · May · Aug · Nov"}, String(s.vatFirstEnd || "3"))}</select></div>
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>Treatment</b></div>
    <div class="f"><label for="vt_fare">Fares (platform trips)</label><select id="vt_fare" name="fareVat">${opts({exempt: "Exempt (local passenger transport)", standard: "Standard 5% (VAT inside fare)"}, s.fareVat || "exempt")}</select></div>
    <div class="f"><label for="vt_fee">VAT on platform service fee</label><select id="vt_fee" name="feeVatRecoverable">${opts({false: "Not recoverable (cost)", true: "Recoverable input VAT"}, String(!!s.feeVatRecoverable))}</select></div>
    <div class="f"><label for="vt_inp">VAT on expenses</label><select id="vt_inp" name="inputVatRecoverable">${opts({false: "Not recoverable (cost)", true: "Recoverable input VAT"}, String(!!s.inputVatRecoverable))}</select></div>
    <div class="f"><label for="vt_rec">Partial recovery (if exempt and taxable supplies are mixed) – recoverable %</label><input id="vt_rec" name="vatRecoverPct" type="number" step="0.01" value="${esc(s.vatRecoverPct ?? "")}" placeholder="100"></div>
    <div class="f wide" style="margin-top:6px;border-top:1px solid var(--line);padding-top:10px"><b>VAT accounts</b></div>
    <div class="f"><label for="vt_out">Output VAT (liability)</label><select id="vt_out" name="vatOutAcct">${opts(Object.fromEntries(Object.keys(ACCT).filter(c => c[0] === "2").map(c => [c, c + " · " + acctName(c)])), s.vatOutAcct || "2300")}</select></div>
    <div class="f"><label for="vt_in">Input VAT (asset)</label><select id="vt_in" name="vatInAcct">${opts(Object.fromEntries(Object.keys(ACCT).filter(c => c[0] === "1").map(c => [c, c + " · " + acctName(c)])), s.vatInAcct || "1300")}</select></div>
    <div class="f"><label for="vt_nr">Non-recoverable VAT (expense)</label><select id="vt_nr" name="vatNrAcct">${opts(Object.fromEntries(Object.keys(ACCT).filter(c => c[0] === "5" || c[0] === "6").map(c => [c, c + " · " + acctName(c)])), s.vatNrAcct || "5010")}</select></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite && S.db ? "" : "disabled"}>Save VAT settings</button></div></form></div>
  ${s.vatRegistered ? `<div class="section"><div class="head"><div><h2>VAT return periods</h2><p class="sub">From the books: output VAT on ${esc(s.vatOutAcct || "2300")} and input VAT on ${esc(s.vatInAcct || "1300")} in each period${historyReady() ? "" : " (loading the books…)"}.</p></div></div>
    ${P.length ? `<div class="tbl"><table><thead><tr><th>Period</th><th>Return due</th><th class="num">Output VAT</th><th class="num">Input VAT (recoverable)</th><th class="num">Net payable / (refundable)</th><th>Status</th></tr></thead><tbody>
    ${P.slice().reverse().map(p => { const v = p.to <= S.to ? vatSummary(p) : null, left = Math.round((parseD(p.due) - parseD(today)) / 86400000);
      return `<tr><td>${esc(dmyS(p.from))} – ${esc(dmyS(p.to))}</td><td>${esc(dmyS(p.due))}</td><td class="num">${v ? fmt(v.out) : ""}</td><td class="num">${v ? fmt(v.inp) : ""}</td><td class="num">${v ? `<b>${v.net < 0 ? "(" + fmt(-v.net) + ")" : fmt(v.net)}</b>` : ""}</td><td>${(S.settings.vatFiled || {})[p.to] ? `<span class="pill good">Filed ${esc(dmyS(S.settings.vatFiled[p.to]))}</span> <button class="btn sm ghost" data-vatfiled="${esc(p.to)}" data-undo="1">Undo</button>` : p.to > today ? '<span class="pill">Open period</span>' : (left < 0 ? `<span class="pill bad">Due date passed ${-left} days</span>` : left <= 14 ? `<span class="pill warn">Due in ${left} days</span>` : `<span class="pill brass">Due ${esc(dmyS(p.due))}</span>`) + ` <button class="btn sm" data-vatfiled="${esc(p.to)}">Mark filed</button>`}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<p class="sub">Enter the registration date to list the periods.</p>`}</div>` : ""}
  <div class="section"><div class="head"><div><h2>Tax codes</h2><p class="sub">As in Manager.io: each code has a rate, whether its VAT is recoverable, and the box of the VAT return it goes to.</p></div></div>
    <form id="fTaxCodes"><div class="tbl"><table><thead><tr><th>Code</th><th>Name</th><th class="num">Rate %</th><th>VAT recoverable</th><th>Return box</th><th></th></tr></thead><tbody>
    ${codes.map((c, i) => `<tr><td><input data-tc="${i}" data-k="id" value="${esc(c.id)}" style="width:60px"></td><td><input data-tc="${i}" data-k="name" value="${esc(c.name)}" style="width:260px"></td><td class="num"><input data-tc="${i}" data-k="rate" type="number" step="0.01" value="${esc(c.rate)}" style="width:70px;text-align:right"></td><td><select data-tc="${i}" data-k="recover">${opts({true: "Recoverable", false: "Not recoverable"}, String(!!c.recover))}</select></td><td><input data-tc="${i}" data-k="box" value="${esc(c.box || "")}" style="width:80px"></td><td><button class="btn sm ghost" type="button" data-tcdel="${i}">×</button></td></tr>`).join("")}
    </tbody></table></div><div class="row" style="margin-top:8px;gap:8px"><button class="btn sm" type="button" data-tcadd="1">Add tax code</button><button class="btn sm primary" type="submit" ${S.canWrite && S.db ? "" : "disabled"}>Save tax codes</button>${S.settings.taxCodes ? '<button class="btn sm ghost" type="button" data-tcreset="1">Back to the default codes</button>' : ""}</div></form></div>
  <div class="section"><div class="head"><div><h2>Default tax code per account</h2><p class="sub">Which tax code each income, expense and asset account uses by default – e.g. salaries and depreciation out of scope, office rent standard rated, fines out of scope. Change any and save.</p></div></div>
    <form id="fTaxMap"><div class="tbl"><table><thead><tr><th>Account</th><th>Group</th><th>Default tax code</th></tr></thead><tbody>
    ${accts.map(c => `<tr><td><span class="mono small">${esc(c)}</span> ${esc(acctName(c))}</td><td class="small muted">${esc(typeof COA_GROUPS !== "undefined" && typeof mainGroup === "function" ? (COA_GROUPS[mainGroup(c)] || ["", ""])[1] : "")}</td><td><select data-tm="${esc(c)}">${opts(Object.fromEntries(codes.map(x => [x.id, x.id + " – " + x.name])), defCode(c))}</select></td></tr>`).join("")}
    </tbody></table></div><div class="row" style="margin-top:8px"><button class="btn sm primary" type="submit" ${S.canWrite && S.db ? "" : "disabled"}>Save account tax codes</button></div></form></div>`;
}

/* ---------- backup & reset ----------
   Backup: every collection of the fleet data as one JSON file. Reset: deletes the data so fresh data can be entered –
   a backup is downloaded first; business information, VAT settings, the chart of accounts and the platforms with
   their contracts can be kept. Only the owner should do this; it cannot be undone (except by restoring the backup). */
const DATA_COLS = ["trips", "tripinfo", "gps", "gpsreview", "gpspax", "cardtx", "entries", "drivers", "vehicles", "investors", "platforms", "documents", "driverItems", "terminals", "accounts", "customers", "suppliers", "coa", "payroll", "pdcs", "employees", "emppay", "drvAdj", "invpay", "loans", "rtalic", "rtadep", "fines", "reminders", "rcptmeta", "receipts", "payouts", "feeinv", "pladj", "rtablocks", "rtaplates"];
async function dataBackup(){
  const out = {exportedAt: new Date().toISOString(), company: S.settings.company || "", settings: S.settings, data: {}};
  for(const c of DATA_COLS){ toast("Backing up " + c + "…"); const snap = await S.db.collection(c).get(); out.data[c] = {}; snap.docs.forEach(d => out.data[c][d.id] = d.data()); }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], {type: "application/json"})); a.download = `fleet_backup_${iso(new Date())}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return out;
}
function dataTab(){
  return `<div class="section"><div class="head"><div><h2>Backup</h2><p class="sub">Download all the fleet data (trips, drivers, cars, entries, payroll, settings …) as one file to keep.</p></div><button class="btn primary" data-databackup="1">Download full backup</button></div></div>
  <div class="section" style="border:1px solid #b3261e"><h2>Delete all data and start fresh</h2><p class="sub">Deletes every trip, driver, car, investor, entry, invoice, payroll, loan, fine and document so you can enter fresh data. A full backup is downloaded first. <b>This cannot be undone</b> except by restoring that backup.</p>
    <form class="form" id="fReset">
      <div class="f wide"><label><input type="checkbox" name="keepSettings" checked> Keep business information, VAT settings and general settings</label></div>
      <div class="f wide"><label><input type="checkbox" name="keepCoa" checked> Keep the chart of accounts (your own accounts and groups)</label></div>
      <div class="f wide"><label><input type="checkbox" name="keepPlatforms" checked> Keep the platforms with their contracts and API settings</label></div>
      <div class="f wide"><label><input type="checkbox" name="keepBank"> Keep the bank & cash accounts (names only – their balances came from the deleted entries)</label></div>
      <div class="f"><label for="rs_c">Type DELETE ALL to confirm</label><input id="rs_c" name="confirm" autocomplete="off"></div>
      <div class="row wide"><button class="btn danger" type="submit" ${S.canWrite && S.db ? "" : "disabled"}>Delete all data</button></div></form></div>`;
}
async function dataReset(f){
  const d = Object.fromEntries(new FormData(f).entries());
  if(d.confirm !== "DELETE ALL"){ toast("Type DELETE ALL to confirm."); return; }
  const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Backing up…";
  try{ await dataBackup(); }catch(e){ toast("The backup could not be made – nothing was deleted."); btn.disabled = false; btn.textContent = "Delete all data"; return; }
  const keep = new Set([...(d.keepCoa ? ["coa"] : []), ...(d.keepPlatforms ? ["platforms"] : []), ...(d.keepBank ? ["accounts"] : [])]); let n = 0;
  for(const c of DATA_COLS.filter(x => !keep.has(x))){
    btn.textContent = "Deleting " + c + "…"; const snap = await S.db.collection(c).get();
    for(const x of snap.docs){ await (x.ref ? x.ref.delete() : S.db.doc(c + "/" + x.id).delete()); n++; }
  }
  if(d.keepPlatforms){ const snap = await S.db.collection("platforms").get(); for(const x of snap.docs){ const b = {...x.data()}; delete b.sync; delete b.payoutConfirm; await S.db.doc("platforms/" + x.id).set(b); } }
  // settings: business, VAT and general kept (or all cleared); import logs and filed VAT returns go with the data
  const st = d.keepSettings ? {...S.settings} : {}; ["importLog", "posLog", "vatFiled"].forEach(k => delete st[k]);
  await S.db.doc("settings/main").set(st);
  S.ledger = null; S.navStack = []; await loadPeriod(); toast(`All data deleted (${n} records). The backup file is in your downloads.`); S.setTab = "biz"; render();
}

/* ---------- events ---------- */
async function saveSettings(patch, msg){ if(await writeOk(S.db.doc("settings/main").set({...S.settings, ...patch}))){ if(msg) toast(msg); render(); return true; } return false; }
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.settab){ S.setTab = t.dataset.settab; S.ownEdit = null; render(); return; }
  if(t.dataset.ownedit != null){ S.ownEdit = t.dataset.ownedit === "" ? null : {idx: t.dataset.ownedit === "new" ? null : +t.dataset.ownedit}; render(); return; }
  if(t.dataset.ownrowadd){ S.ownEdit.rows.push({}); render(); return; }
  if(t.dataset.ownrowdel != null){ S.ownEdit.rows.splice(+t.dataset.ownrowdel, 1); if(!S.ownEdit.rows.length) S.ownEdit.rows.push({}); render(); return; }
  if(t.dataset.owndel != null){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again"; return; } const V = ownVersions(); V.splice(+t.dataset.owndel, 1); S.ownEdit = null; await saveSettings({ownership: V}, "Version deleted."); return; }
  if(t.dataset.vatfiled){ const m = {...(S.settings.vatFiled || {})}; if(t.dataset.undo) delete m[t.dataset.vatfiled]; else m[t.dataset.vatfiled] = iso(new Date()); await saveSettings({vatFiled: m}, t.dataset.undo ? "Marked as not filed." : "VAT return marked as filed."); return; }
  if(t.dataset.databackup){ t.disabled = true; t.textContent = "Preparing…"; try{ await dataBackup(); toast("Backup downloaded."); }catch(e){ toast("The backup could not be made."); } t.disabled = false; t.textContent = "Download full backup"; return; }
  if(t.dataset.logodel){ await saveSettings({logo: ""}, "Logo removed."); return; }
  if(t.dataset.tcadd){ const c = [...taxCodes(), {id: "", name: "", rate: 0, recover: false, box: ""}]; S.settings = {...S.settings, taxCodes: c}; render(); return; }
  if(t.dataset.tcdel != null){ const c = taxCodes().slice(); c.splice(+t.dataset.tcdel, 1); S.settings = {...S.settings, taxCodes: c}; render(); return; }
  if(t.dataset.tcreset){ const {taxCodes: _, ...rest} = S.settings; if(await writeOk(S.db.doc("settings/main").set(rest))){ toast("Default tax codes restored."); render(); } return; }
});
document.addEventListener("input", ev => { const t = ev.target; if(t.dataset && t.dataset.ownrow != null && S.ownEdit) S.ownEdit.rows[+t.dataset.ownrow][t.dataset.k] = t.value; });
document.addEventListener("change", async ev => {
  const t = ev.target;
  if(t.dataset && t.dataset.ownrow != null && S.ownEdit){ S.ownEdit.rows[+t.dataset.ownrow][t.dataset.k] = t.value; return; }
  if(t.id === "logoFile" && t.files && t.files[0]){
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(t.files[0]); });
    const k = Math.min(1, 360 / Math.max(img.width, img.height)), c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL("image/png"); if(data.length > 300000){ toast("The logo is too large – use a smaller image."); return; }
    await saveSettings({logo: data}, "Logo saved – it shows on statements, payslips and letters.");
  }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(!["fBiz", "fVat", "fOwn", "fTaxCodes", "fTaxMap", "fReset"].includes(f.id)) return; ev.preventDefault(); if(!S.db) return;
  if(f.id === "fReset"){ await dataReset(f); return; }
  const d = Object.fromEntries(new FormData(f).entries());
  if(f.id === "fBiz"){ await saveSettings(d, "Business information saved."); return; }
  if(f.id === "fVat"){ d.vatRegistered = d.vatRegistered === "true"; d.feeVatRecoverable = d.feeVatRecoverable === "true"; d.inputVatRecoverable = d.inputVatRecoverable === "true"; await saveSettings(d, "VAT settings saved."); return; }
  if(f.id === "fOwn"){
    const V = ownVersions(), rows = S.ownEdit.rows.filter(p => (p.name || "").trim()).map(p => ({...p, shares: num(p.shares)}));
    if(!rows.length){ toast("Add at least one partner."); return; }
    const v = {from: d.from, capital: num(d.capital), shares: num(d.shares), ref: d.ref || "", partners: rows, at: new Date().toISOString(), by: (S.user && (S.user.name || S.user.id)) || ""};
    if(num(v.shares) && Math.abs(sum(rows, p => p.shares) - num(v.shares)) > 0.001){ toast(`The partners hold ${sum(rows, p => p.shares)} shares, but the company has ${num(v.shares)}.`); return; }
    if(S.ownEdit.idx != null) V[S.ownEdit.idx] = v; else { if(V.some(x => x.from === v.from)){ toast("There is already a version from that date – edit it instead."); return; } V.push(v); }
    S.ownEdit = null; await saveSettings({ownership: V.sort((a, b) => a.from.localeCompare(b.from))}, `Capital & partners saved – in force from ${dmyS(v.from)}.`); return;
  }
  if(f.id === "fTaxCodes"){ const c = taxCodes().map((x, i) => { const g = k => (f.querySelector(`[data-tc="${i}"][data-k="${k}"]`) || {}).value; return {id: (g("id") || "").trim().toUpperCase(), name: g("name") || "", rate: num(g("rate")), recover: g("recover") === "true", box: g("box") || ""}; }).filter(x => x.id);
    await saveSettings({taxCodes: c}, "Tax codes saved."); return; }
  if(f.id === "fTaxMap"){ const m = {}; f.querySelectorAll("[data-tm]").forEach(sel => m[sel.dataset.tm] = sel.value); await saveSettings({taxMap: m}, "Account tax codes saved."); }
});
window.SET = {view: setView, busy: false, vatPeriods, ownAt};
