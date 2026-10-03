/* Documents: driver offer letters and investor agreements.
   Drafted from the fleet data, edited in place, saved in the cloud (collection "documents")
   and downloaded as PDF on the company letterhead. Loaded after the main script, so it uses
   its helpers (S, esc, num, fmt, iso, vName, render, writeOk, toast, uid, opts, listOpts). */

const DOCS = {
  offer: { view: "offers", title: "Driver offer letter", party: "Driver", file: "Offer_Letter" },
  agreement: { view: "agreements", title: "Investor agreement", party: "Investor", file: "Investor_Agreement" },
  empoffer: { view: "empoffers", title: "Employee offer letter", party: "Employee", file: "Offer_Letter" },
};
const PEOPLE = kind => kind === "offer" ? S.drivers : kind === "empoffer" ? (S.employees || {}) : S.investors;
S.docs = S.docs || {}; S.docEdit = null;

/* ---------- defaults from the fleet data ---------- */
function offerDefaults(d) {
  const vid = (d.id && typeof vehAt === "function" && vehAt(d.id, iso(new Date()))) || d.vehicleId, v = vid && S.vehicles[vid];
  return {
    name: d.name || "", nationality: "", passport: "", phone: d.phone || "", position: "Limousine Driver", place: "Dubai, UAE",
    start: iso(new Date()), probation: 6, payModel: d.payModel || "commission", commissionPct: num(d.commissionPct),
    rentPerDay: num(d.rentPerDay), salary: num(d.salary), housing: 0, transport: 0, settle: "weekly",
    hours: "8 hours a day, 6 days a week (48 hours a week)", leave: 30, notice: 30, vehicle: v ? vName(v.id) : "",
    benefits: "Employment visa, Emirates ID, medical insurance and the RTA limousine driver permit, arranged and paid by the Company.",
    other: "", validDays: 7,
  };
}
function empOfferDefaults(e) {
  return {
    name: e.name || "", nationality: e.nationality || "", passport: e.passportNo || "", phone: e.phone || "", position: e.designation || "",
    department: ({admin:"Administration", operations:"Operations", workshop:"Workshop", other:""})[e.dept] || "", place: "Dubai, UAE",
    start: e.joinDate || iso(new Date()), probation: 6, basic: num(e.basic), housing: num(e.housing), transport: num(e.transport), otherAllow: num(e.otherAllow),
    hours: "8 hours a day, 6 days a week (48 hours a week)", leave: 30, notice: 30,
    benefits: "Employment visa, Emirates ID and medical insurance, arranged and paid by the Company.", ticket: "One economy return air ticket to your home country every two years of service.",
    other: "", validDays: 7,
  };
}
function agreementDefaults(inv) {
  const cars = Object.values(S.vehicles).filter(v => v.investorId === inv.id);
  const f = cars[0] || {};
  return {
    name: inv.name || "", idNo: "", nationality: "", address: "", phone: inv.phone || "", email: inv.email || "", bank: inv.bank || "",
    cars: cars.map(v => `${v.fleetId ? v.fleetId + " – " : ""}${v.plate || ""} ${v.model || ""}${v.vin ? " (VIN " + v.vin + ")" : ""}`.trim()).join("\n"),
    contribution: "vehicle", amount: 0, invModel: f.invModel && f.invModel !== "none" ? f.invModel : "profit_share",
    invPct: num(f.invPct), invFixed: num(f.invFixed), mgmtFixed: num(f.mgmtFixed), mgmtPct: num(f.mgmtPct),
    payDay: 15, start: iso(new Date()), termMonths: 12, noticeDays: 60, insurance: "company", other: "",
  };
}

/* ---------- letter text ---------- */
const company = () => S.settings.company || "Royal Rides Limousine LLC";
const dmy = s => { if (!s) return "____________"; const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };
const aedT = n => "AED " + fmt(num(n));
const P = t => `<p>${t}</p>`;
const H = t => `<h4>${t}</h4>`;
const L = s => esc(s).replace(/\n/g, "<br>");

function offerBody(x) {
  const pay = x.payModel === "salary" ? `a basic monthly salary of <b>${aedT(x.salary)}</b>`
    : x.payModel === "salary_comm" ? `a basic monthly salary of <b>${aedT(x.salary)}</b> plus a commission of <b>${num(x.commissionPct)}%</b> of your net trip earnings`
    : x.payModel === "rent" ? `your net trip earnings less a vehicle charge of <b>${aedT(x.rentPerDay)} per day</b>`
    : `a commission of <b>${num(x.commissionPct)}%</b> of your net trip earnings`;
  const allow = (num(x.housing) || num(x.transport)) ? ` In addition you will receive${num(x.housing) ? ` a housing allowance of ${aedT(x.housing)} per month` : ""}${num(x.housing) && num(x.transport) ? " and" : ""}${num(x.transport) ? ` a transport allowance of ${aedT(x.transport)} per month` : ""}.` : "";
  return [
    P(`Date: ${dmy(iso(new Date()))}`),
    P(`<b>${esc(x.name) || "[Driver name]"}</b>${x.nationality ? `<br>Nationality: ${esc(x.nationality)}` : ""}${x.passport ? `<br>Passport / Emirates ID: ${esc(x.passport)}` : ""}${x.phone ? `<br>Mobile: ${esc(x.phone)}` : ""}`),
    P(`<b>Subject: Offer of employment – ${esc(x.position)}</b>`),
    P(`Dear ${esc((x.name || "").split(" ")[0]) || "Sir"},`),
    P(`We are pleased to offer you the position of <b>${esc(x.position)}</b> with ${esc(company())} (“the Company”), based in ${esc(x.place)}, on the following terms.`),
    H("1. Start date and probation"),
    P(`Your employment starts on <b>${dmy(x.start)}</b>, subject to your employment visa, Emirates ID and RTA driver permit being issued. The first ${num(x.probation)} month(s) are a probation period, as allowed by the UAE Labour Law (Federal Decree-Law No. 33 of 2021).`),
    H("2. Remuneration"),
    P(`You will receive ${pay}.${allow} Net trip earnings means the fares you earn on the Uber platform (and other platforms the Company uses) less the platform service fee and the VAT on it. Earnings are calculated from the platform reports and settled ${esc(x.settle)} on a written settlement statement.`),
    H("3. Vehicle"),
    P(`${x.vehicle ? `You will be assigned the Company vehicle <b>${esc(x.vehicle)}</b>, or another vehicle the Company decides. ` : "The Company will assign you a vehicle. "}You must keep it clean and safe, report every accident or damage the same day, and use it only for Company work. Traffic fines, Salik and damage caused by your fault or negligence may be recovered from you, within the limits set by the UAE Labour Law.`),
    H("4. Cash and platform rules"),
    P("Cash collected from riders belongs to the Company and is settled against your earnings on each settlement statement. You must follow the RTA rules, the platform's community guidelines and the Company's policies at all times."),
    H("5. Working hours"),
    P(`Your normal working hours are ${esc(x.hours)}, in line with the UAE Labour Law.`),
    H("6. Benefits"),
    P(`${esc(x.benefits)} You are entitled to ${num(x.leave)} days' paid annual leave per completed year of service, the official public holidays, and end-of-service gratuity as set out in the UAE Labour Law.`),
    H("7. Notice period"),
    P(`After probation, either party may end the employment by giving ${num(x.notice)} days' written notice, or as otherwise allowed by law.`),
    x.other ? H("8. Other terms") + P(L(x.other)) : "",
    P(`This offer is valid for ${num(x.validDays)} days from the date above. Please sign below to confirm that you accept it.`),
    P("We look forward to welcoming you to the team."),
  ].join("");
}

function empOfferBody(x) {
  const total = num(x.basic) + num(x.housing) + num(x.transport) + num(x.otherAllow);
  const row = (l, v) => num(v) ? `<tr><td style="padding:3px 12px 3px 0">${l}</td><td style="text-align:right">${aedT(v)}</td></tr>` : "";
  return [
    P(`Date: ${dmy(iso(new Date()))}`),
    P(`<b>${esc(x.name) || "[Employee name]"}</b>${x.nationality ? `<br>Nationality: ${esc(x.nationality)}` : ""}${x.passport ? `<br>Passport no.: ${esc(x.passport)}` : ""}${x.phone ? `<br>Mobile: ${esc(x.phone)}` : ""}`),
    P(`<b>Subject: Offer of employment – ${esc(x.position) || "[Position]"}</b>`),
    P(`Dear ${esc((x.name || "").split(" ")[0]) || "Sir / Madam"},`),
    P(`We are pleased to offer you the position of <b>${esc(x.position)}</b>${x.department ? ` in our ${esc(x.department)} department` : ""} with ${esc(company())} (“the Company”), based in ${esc(x.place)}, on the following terms.`),
    H("1. Start date and probation"),
    P(`Your employment starts on <b>${dmy(x.start)}</b>, subject to your employment visa and Emirates ID being issued. The first ${num(x.probation)} month(s) are a probation period, as allowed by the UAE Labour Law (Federal Decree-Law No. 33 of 2021).`),
    H("2. Salary"),
    P(`Your total monthly salary is <b>${aedT(total)}</b>, made up as follows:`),
    `<table style="margin:0 0 8px">${row("Basic salary", x.basic)}${row("Housing allowance", x.housing)}${row("Transport allowance", x.transport)}${row("Other allowance", x.otherAllow)}<tr><td style="padding:3px 12px 3px 0"><b>Total</b></td><td style="text-align:right"><b>${aedT(total)}</b></td></tr></table>`,
    P("Salary is paid monthly through the Wage Protection System (WPS) to your bank account. End-of-service gratuity is calculated on the basic salary as set out in the UAE Labour Law."),
    H("3. Working hours"),
    P(`Your normal working hours are ${esc(x.hours)}, in line with the UAE Labour Law.`),
    H("4. Leave and benefits"),
    P(`${esc(x.benefits)} You are entitled to ${num(x.leave)} days' paid annual leave per completed year of service and the official public holidays. ${esc(x.ticket || "")}`),
    H("5. Notice period"),
    P(`After probation, either party may end the employment by giving ${num(x.notice)} days' written notice, or as otherwise allowed by law.`),
    H("6. Company policies"),
    P("You agree to follow the Company's policies and procedures, keep the Company's information confidential, and not take up other work without the Company's written approval."),
    x.other ? H("7. Other terms") + P(L(x.other)) : "",
    P(`This offer is valid for ${num(x.validDays)} days from the date above. Please sign below to confirm that you accept it.`),
    P("We look forward to welcoming you to the team."),
  ].join("");
}
function agreementBody(x) {
  const ret = x.invModel === "mgmt_only" ? `the <b>whole Operating Profit</b> of the Vehicle(s) remaining after the Management Fee (the Company keeps only the Management Fee)` : x.invModel === "fixed" ? `a fixed amount of <b>${aedT(x.invFixed)} per month</b> for each month of the term, pro-rated for part months`
    : `<b>${num(x.invPct)}%</b> of the Operating Profit of the Vehicle(s) remaining after the Management Fee`;
  const fee = [num(x.mgmtFixed) ? `${aedT(x.mgmtFixed)} per vehicle per month` : "", num(x.mgmtPct) ? `${num(x.mgmtPct)}% of the fare revenue` : ""].filter(Boolean).join(" plus ") || "nil";
  const contrib = x.contribution === "funds" ? `the sum of <b>${aedT(x.amount)}</b> for the purchase of the Vehicle(s) listed below`
    : x.contribution === "both" ? `the Vehicle(s) listed below together with the sum of <b>${aedT(x.amount)}</b>` : "the Vehicle(s) listed below";
  return [
    `<h3 style="text-align:center">VEHICLE INVESTMENT AND MANAGEMENT AGREEMENT</h3>`,
    P(`This Agreement is made on <b>${dmy(x.start)}</b> between:`),
    P(`<b>${esc(company())}</b>${S.settings.licence ? `, trade licence no. ${esc(S.settings.licence)}` : ""}${S.settings.address ? `, of ${esc(S.settings.address)}` : ""} (“the Company”); and`),
    P(`<b>${esc(x.name) || "[Investor name]"}</b>${x.nationality ? `, ${esc(x.nationality)} national` : ""}${x.idNo ? `, Emirates ID / passport no. ${esc(x.idNo)}` : ""}${x.address ? `, of ${esc(x.address)}` : ""} (“the Investor”).`),
    H("1. Purpose"),
    P(`The Investor provides ${contrib} (“the Vehicle(s)”), and the Company operates them as part of its licensed limousine business on the terms of this Agreement.`),
    P(`<b>Vehicle(s):</b><br>${L(x.cars) || "[list of vehicles]"}`),
    H("2. Operation"),
    P("The Company operates the Vehicle(s) under its RTA limousine licence on Uber and other platforms, appoints and pays the drivers, arranges registration, permits, maintenance and day-to-day running, and keeps full records of trips, income and expenses for each Vehicle."),
    H("3. Operating Profit"),
    P("For each month, Operating Profit of a Vehicle means its fare revenue, less platform service fees and the VAT on them, plus toll and fee recoveries, less the driver cost allocated to that Vehicle, less the vehicle expenses (fuel or charging, Salik, fines not recovered from drivers, maintenance, insurance, registration and similar costs)."),
    H("4. Management Fee"),
    P(`The Company is entitled to a Management Fee of ${fee}, deducted before the Investor's return is calculated.`),
    H("5. Investor's return"),
    P(`The Investor is entitled to ${ret}. ${x.invModel === "fixed" ? "" : "If the Operating Profit after the Management Fee is negative for a month, the shortfall is carried forward and set off against the Investor's share of future profits; the Investor is not asked to pay it in cash unless agreed in writing."}`),
    H("6. Statements and payment"),
    P(`The Company sends the Investor a monthly statement for each Vehicle and pays the Investor's return by bank transfer by the ${num(x.payDay)}th day of the following month${x.bank ? `, to: ${esc(x.bank)}` : ""}.`),
    H("7. Insurance, registration and maintenance"),
    P(`${x.insurance === "investor" ? "The Investor bears the cost of comprehensive insurance and registration of the Vehicle(s); the Company arranges them." : "The Company arranges comprehensive insurance and registration of the Vehicle(s); the cost is a vehicle expense in the Operating Profit."} The Company keeps the Vehicle(s) in good condition and services them as recommended by the manufacturer.`),
    H("8. Term and termination"),
    P(`This Agreement starts on ${dmy(x.start)} for ${num(x.termMonths)} months and renews automatically for the same period unless either party gives ${num(x.noticeDays)} days' written notice. On termination the Company settles all amounts due up to the termination date, and the Vehicle(s) are returned or settled as agreed in writing.`),
    H("9. Confidentiality"),
    P("Each party keeps the other's business information confidential, except where disclosure is required by law."),
    x.other ? H("10. Other terms") + P(L(x.other)) : "",
    H(x.other ? "11. Governing law" : "10. Governing law"),
    P("This Agreement is governed by the laws of the United Arab Emirates as applied in the Emirate of Dubai, and the courts of Dubai have jurisdiction over any dispute."),
  ].join("");
}

/* ---------- sanitising edited text (only simple formatting is kept) ---------- */
const OK_TAGS = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "H3", "H4", "UL", "OL", "LI", "DIV", "SPAN", "TABLE", "TBODY", "TR", "TD", "TH"]);
function cleanHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html");
  const walk = el => [...el.children].forEach(c => {
    if (!OK_TAGS.has(c.tagName)) { c.replaceWith(...[...c.childNodes]); return walk(el); }
    [...c.attributes].forEach(a => { if (!(a.name === "style" && /^[\w\s:;%.#-]*$/.test(a.value))) c.removeAttribute(a.name); });
    walk(c);
  });
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}

/* ---------- the printed page ---------- */
function letterhead() {
  const s = S.settings, line = [s.address, s.licence ? "Licence " + s.licence : "", s.trn ? "TRN " + s.trn : ""].filter(Boolean).join(" · ");
  const line2 = [s.phone, s.email].filter(Boolean).join(" · ");
  return `<div class="lh">${typeof coLogo === "function" && S.settings.logo ? `<div style="margin-bottom:6px">${coLogo(54)}</div>` : ""}<div class="lh-n">${esc(company())}</div>${line ? `<div class="lh-l">${esc(line)}</div>` : ""}${line2 ? `<div class="lh-l">${esc(line2)}</div>` : ""}</div>`;
}
function signatures(kind, x) {
  const s = S.settings;
  const left = `<div><div class="sig-line"></div><b>For ${esc(company())}</b><br>${esc(s.signatory || "Authorised signatory")}${s.signatoryTitle ? `<br>${esc(s.signatoryTitle)}` : ""}<br>Date: ______________</div>`;
  const right = kind === "offer" || kind === "empoffer"
    ? `<div><div class="sig-line"></div><b>Accepted by</b><br>${esc(x.name) || (kind === "offer" ? "Driver" : "Employee")}<br>Date: ______________</div>`
    : `<div><div class="sig-line"></div><b>The Investor</b><br>${esc(x.name) || "Investor"}<br>Date: ______________</div>`;
  return `<div class="sigs">${left}${right}</div>`;
}
const PAGE_CSS = `.paper{background:#fff;color:#111;font:11pt/1.5 "Public Sans","Segoe UI",Arial,sans-serif;padding:18mm 18mm 16mm;width:210mm;max-width:100%;box-sizing:border-box}
.paper .lh{border-bottom:2px solid #a87a2a;padding-bottom:8px;margin-bottom:16px}.paper .lh-n{font:700 17pt "Archivo","Segoe UI",Arial,sans-serif;color:#16213a}
.paper .lh-l{font-size:9pt;color:#555}.paper h3{font-size:13pt;margin:4px 0 12px}.paper h4{font-size:11pt;margin:12px 0 4px}.paper p{margin:0 0 8px}
.paper .sigs{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:34px;break-inside:avoid;page-break-inside:avoid}.paper .sig-line{border-bottom:1px solid #333;height:42px;margin-bottom:6px}
.paper [contenteditable]:focus{outline:2px dashed #a87a2a;outline-offset:4px}`;
(function addCss() { const st = document.createElement("style"); st.textContent = PAGE_CSS + `
.docgrid{display:grid;grid-template-columns:minmax(260px,360px) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:980px){.docgrid{grid-template-columns:minmax(0,1fr)}}
.docgrid .form{grid-template-columns:1fr 1fr}.paperwrap{background:#e9e7e1;border-radius:10px;padding:14px;overflow-x:auto}
.paper{box-shadow:0 2px 14px rgba(0,0,0,.12);margin:0 auto}`; document.head.appendChild(st); })();

async function downloadPdf(kind, x, body) {
  if (!window.html2pdf) { toast("The PDF tool is still loading – try again in a moment."); return; }
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff";
  box.innerHTML = `<div class="paper">${letterhead()}${cleanHtml(body)}${signatures(kind, x)}</div>`;
  document.body.appendChild(box);
  const name = `${DOCS[kind].file}_${(x.name || "draft").replace(/[^\w]+/g, "_")}_${iso(new Date())}.pdf`;
  try {
    await html2pdf().set({ margin: 0, filename: name, image: { type: "jpeg", quality: 0.96 }, html2canvas: { scale: 2, scrollX: 0, scrollY: 0, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }, pagebreak: { mode: ["css", "legacy"], avoid: ["h4", ".sigs", "p"] } }).from(box.firstChild).save();
    toast("Downloaded " + name);
  } catch (e) { toast("Could not make the PDF. Try again."); }
  box.remove();
}

/* ---------- views ---------- */
function vOffers() { return docsView("offer"); }
function vAgreements() { return docsView("agreement"); }
function docsView(kind) {
  const K = DOCS[kind], e = S.docEdit && S.docEdit.kind === kind ? S.docEdit : null;
  const list = Object.values(S.docs).filter(d => d.kind === kind).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  const people = PEOPLE(kind);
  const picker = `<div class="row"><select id="docPick" aria-label="Choose ${K.party.toLowerCase()}">${listOpts(people, p => p.name || p.id, "", `Choose a ${K.party.toLowerCase()}…`)}</select>
    <button class="btn primary" id="docNew" data-kind="${kind}">New ${K.title.toLowerCase()}</button></div>`;
  return `${e ? docEditor(e) : ""}
  <div class="section"><div class="head"><div><h2>${K.title}s</h2><p class="sub">${kind === "empoffer" ? "Drafted from the employee's designation and salary breakdown. Edit the text on the page, save it, and download a PDF on the company letterhead for signing."
    : kind === "offer"
    ? "Drafted from the driver's pay terms and car. Edit the text on the page, save it, and download a PDF on the company letterhead for signing."
    : "Drafted from the investor's cars and the terms set on the Vehicles page. Edit, save, and download a PDF for signing."}</p></div>${picker}</div>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>${K.party}</th><th>Date</th><th>Status</th><th>Last saved</th><th></th></tr></thead><tbody>
  ${list.map(d => `<tr><td>${esc(d.party)}</td><td>${esc(dmy((d.fields || {}).start))}</td><td><span class="pill ${d.status === "final" ? "good" : "warn"}">${d.status === "final" ? "Final" : "Draft"}</span></td><td class="small muted">${esc(d.updatedText || "")}</td>
    <td class="row"><button class="btn sm" data-docopen="${esc(d.id)}">Open</button><button class="btn sm" data-docpdf="${esc(d.id)}">PDF</button></td></tr>`).join("")}
  </tbody></table></div>` : `<div class="empty"><b>No ${K.title.toLowerCase()}s yet</b>Choose a ${K.party.toLowerCase()} above and click New.</div>`}</div>`;
}

const fld = (k, l, x, type = "text", extra = "") => `<div class="f"><label for="dx_${k}">${l}</label><input id="dx_${k}" data-dx="${k}" type="${type}" value="${esc(x[k] ?? "")}"${type === "number" ? ' step="0.01"' : ""}${extra}></div>`;
const area = (k, l, x) => `<div class="f wide"><label for="dx_${k}">${l}</label><textarea id="dx_${k}" data-dx="${k}" rows="3">${esc(x[k] ?? "")}</textarea></div>`;
const sel = (k, l, x, o) => `<div class="f"><label for="dx_${k}">${l}</label><select id="dx_${k}" data-dx="${k}">${opts(o, x[k])}</select></div>`;

function docEditor(e) {
  const x = e.fields, K = DOCS[e.kind];
  const form = e.kind === "empoffer" ? [
    fld("name", "Employee name", x), fld("nationality", "Nationality", x), fld("passport", "Passport no.", x), fld("phone", "Mobile", x),
    fld("position", "Position", x), fld("department", "Department", x), fld("place", "Work place", x), fld("start", "Start date", x, "date"),
    fld("probation", "Probation (months, max 6)", x, "number"), fld("basic", "Basic salary / month", x, "number"), fld("housing", "Housing allowance", x, "number"), fld("transport", "Transport allowance", x, "number"),
    fld("otherAllow", "Other allowance", x, "number"), fld("hours", "Working hours", x), fld("leave", "Annual leave (days)", x, "number"), fld("notice", "Notice period (days)", x, "number"),
    fld("validDays", "Offer valid for (days)", x, "number"), area("benefits", "Visa and benefits", x), area("ticket", "Air ticket", x), area("other", "Other terms (optional)", x),
  ] : e.kind === "offer" ? [
    fld("name", "Driver name", x), fld("nationality", "Nationality", x), fld("passport", "Passport / Emirates ID", x), fld("phone", "Mobile", x),
    fld("position", "Position", x), fld("place", "Work place", x), fld("start", "Start date", x, "date"), fld("probation", "Probation (months, max 6)", x, "number"),
    sel("payModel", "Pay model", x, PAY_MODELS), fld("commissionPct", "Commission %", x, "number"), fld("salary", "Basic salary / month", x, "number"), fld("rentPerDay", "Vehicle charge / day", x, "number"),
    fld("housing", "Housing allowance / month", x, "number"), fld("transport", "Transport allowance / month", x, "number"), sel("settle", "Settlement", x, { weekly: "Weekly", monthly: "Monthly" }), fld("vehicle", "Vehicle", x),
    fld("hours", "Working hours", x), fld("leave", "Annual leave (days)", x, "number"), fld("notice", "Notice period (days)", x, "number"), fld("validDays", "Offer valid for (days)", x, "number"),
    area("benefits", "Visa and benefits", x), area("other", "Other terms (optional)", x),
  ] : [
    fld("name", "Investor name", x), fld("nationality", "Nationality", x), fld("idNo", "Emirates ID / passport", x), fld("phone", "Mobile", x),
    fld("email", "Email", x), fld("address", "Address", x), sel("contribution", "Investor provides", x, { vehicle: "Vehicle(s)", funds: "Funds to buy vehicle(s)", both: "Vehicle(s) and funds" }), fld("amount", "Amount (AED, if funds)", x, "number"),
    sel("invModel", "Investor return", x, { profit_share: "% share of profit", mgmt_only: "Management fee only – rest to the investor", fixed: "Fixed monthly amount" }), fld("invPct", "Profit share %", x, "number"), fld("invFixed", "Fixed amount / month", x, "number"), fld("payDay", "Paid by day of month", x, "number"),
    fld("mgmtFixed", "Management fee / vehicle / month", x, "number"), fld("mgmtPct", "Management fee % of fare revenue", x, "number"), fld("start", "Start date", x, "date"), fld("termMonths", "Term (months)", x, "number"),
    fld("noticeDays", "Notice to end (days)", x, "number"), sel("insurance", "Insurance and registration paid by", x, { company: "Company (as vehicle expense)", investor: "Investor" }),
    area("cars", "Vehicles (one per line)", x), fld("bank", "Investor bank / IBAN", x), area("other", "Other terms (optional)", x),
  ];
  return `<div class="section"><div class="head"><div><h2>${e.id ? "" : "New "}${K.title} – ${esc(x.name || "")}</h2>
    <p class="sub">Change the details on the left and the letter updates. You can also click into the letter and edit the wording directly; after that, the details no longer rewrite it unless you click “Rebuild text”.</p></div>
    <div class="row"><button class="btn" id="docRebuild">Rebuild text</button><button class="btn" id="docPdf">Download PDF</button>
    <button class="btn primary" id="docSave" ${S.canWrite && S.db ? "" : "disabled"}>Save draft</button><button class="btn" id="docFinal" ${S.canWrite && S.db ? "" : "disabled"}>${e.status === "final" ? "Mark as draft" : "Mark final"}</button>
    <button class="btn ghost" id="docClose">Close</button>${e.id ? `<button class="btn danger" id="docDel">Delete</button>` : ""}</div></div>
  <div class="docgrid"><form class="form" id="fDoc" onsubmit="return false">${form.join("")}</form>
  <div class="paperwrap"><div class="paper">${letterhead()}<div id="docBody" contenteditable="true">${cleanHtml(e.body)}</div>${signatures(e.kind, x)}</div></div></div></div>`;
}

/* ---------- actions ---------- */
const buildBody = e => (e.kind === "offer" ? offerBody : e.kind === "empoffer" ? empOfferBody : agreementBody)(e.fields);
function newEmpOffer(emp) { S.docEdit = { id: "", kind: "empoffer", refId: emp.id, fields: empOfferDefaults(emp), body: "", manual: false, status: "draft" }; S.docEdit.body = buildBody(S.docEdit); }
function openDoc(id) { const d = S.docs[id]; if (!d) return; S.docEdit = { id, kind: d.kind, refId: d.refId, fields: { ...d.fields }, body: d.body, manual: !!d.manual, status: d.status || "draft" }; render(); window.scrollTo(0, 0); }
async function saveDoc(statusChange) {
  const e = S.docEdit; if (!e || !S.db) return;
  const b = document.getElementById("docBody"); if (b) e.body = cleanHtml(b.innerHTML);
  if (statusChange) e.status = e.status === "final" ? "draft" : "final";
  e.id = e.id || "doc-" + uid();
  const now = new Date();
  const rec = { kind: e.kind, refId: e.refId || "", party: e.fields.name || "", fields: e.fields, body: e.body, manual: !!e.manual, status: e.status, updated: now.toISOString(), updatedText: now.toLocaleString("en-GB"), by: (S.user && (S.user.name || S.user.id)) || "" };
  if (await writeOk(S.db.doc("documents/" + e.id).set(rec))) { S.docs[e.id] = { id: e.id, ...rec }; toast(statusChange ? (e.status === "final" ? "Marked final." : "Back to draft.") : "Saved."); render(); }
}
// keep the edited wording in memory while the page redraws
function keepBody() { const b = document.getElementById("docBody"); if (b && S.docEdit) S.docEdit.body = b.innerHTML; }

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if (!t) return;
  if (t.id === "docNew") {
    const kind = t.dataset.kind, pick = document.getElementById("docPick").value;
    if (!pick) { toast(`Choose a ${DOCS[kind].party.toLowerCase()} first.`); return; }
    const person = PEOPLE(kind)[pick] || {};
    const fields = kind === "offer" ? offerDefaults(person) : kind === "empoffer" ? empOfferDefaults(person) : agreementDefaults(person);
    S.docEdit = { id: "", kind, refId: pick, fields, body: "", manual: false, status: "draft" };
    S.docEdit.body = buildBody(S.docEdit); render(); window.scrollTo(0, 0); return;
  }
  if (t.dataset.docopen) { openDoc(t.dataset.docopen); return; }
  if (t.dataset.docpdf) { const d = S.docs[t.dataset.docpdf]; if (d) downloadPdf(d.kind, d.fields || {}, d.body); return; }
  if (t.dataset.offerfor || t.dataset.agreefor) {
    const kind = t.dataset.offerfor ? "offer" : "agreement", id = t.dataset.offerfor || t.dataset.agreefor;
    const person = (kind === "offer" ? S.drivers : S.investors)[id] || {};
    S.view = DOCS[kind].view;
    S.docEdit = { id: "", kind, refId: id, fields: kind === "offer" ? offerDefaults(person) : agreementDefaults(person), body: "", manual: false, status: "draft" };
    S.docEdit.body = buildBody(S.docEdit); render(); window.scrollTo(0, 0); return;
  }
  if (!S.docEdit) return;
  if (t.id === "docRebuild") { if (S.docEdit.manual && !confirm("Rebuild the letter from the details? Your own wording changes will be replaced.")) return; S.docEdit.manual = false; S.docEdit.body = buildBody(S.docEdit); render(); return; }
  if (t.id === "docPdf") { keepBody(); downloadPdf(S.docEdit.kind, S.docEdit.fields, S.docEdit.body); return; }
  if (t.id === "docSave") { saveDoc(false); return; }
  if (t.id === "docFinal") { saveDoc(true); return; }
  if (t.id === "docClose") { S.docEdit = null; render(); return; }
  if (t.id === "docDel") {
    if (t.dataset.confirm !== "1") { t.dataset.confirm = "1"; t.textContent = "Click again to delete"; return; }
    const id = S.docEdit.id;
    if (await writeOk(S.db.doc("documents/" + id).delete())) { delete S.docs[id]; S.docEdit = null; toast("Deleted."); render(); }
  }
}, true);
// details → letter (until the wording is edited by hand)
document.addEventListener("input", ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.dx && S.docEdit) {
    S.docEdit.fields[t.dataset.dx] = t.type === "number" ? num(t.value) : t.value;
    if (!S.docEdit.manual) { const b = document.getElementById("docBody"); S.docEdit.body = buildBody(S.docEdit); if (b) b.innerHTML = S.docEdit.body; }
  } else if (t.id === "docBody" && S.docEdit) { S.docEdit.manual = true; S.docEdit.body = t.innerHTML; }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.dataset && t.dataset.dx && t.tagName === "SELECT" && S.docEdit) {
    S.docEdit.fields[t.dataset.dx] = t.value;
    if (!S.docEdit.manual) S.docEdit.body = buildBody(S.docEdit); else keepBody();
    render();
  }
});
