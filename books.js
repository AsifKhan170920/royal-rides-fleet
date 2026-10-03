/* Books, in the Manager.io model: receipts, payments, sales invoices, customers, purchase invoices,
   suppliers and journal entries. Documents are rows in entries/{month} like the other entries, so they
   load with the period and with the history; customers and suppliers are their own collections.
   Control accounts: 1200 Accounts receivable (customers), 2000 Accounts payable (suppliers),
   2100 Driver accounts. A line on a control account carries its party: "c:<id>", "s:<id>" or "d:<id>". */
Object.assign(ACCT, {"1200":"Accounts receivable (customers)", "2000":"Accounts payable (suppliers)", "4200":"Other income",
  "3000":"Owner's capital", "3100":"Owner's drawings", "3900":"Retained earnings"});
const ACCT_BASE = {...ACCT};
// custom accounts and renamed / opening balances from the Chart of accounts (collection "coa", doc id = code)
function applyCoa(){ Object.keys(ACCT).forEach(k => { if(!(k in ACCT_BASE)) delete ACCT[k]; else ACCT[k] = ACCT_BASE[k]; }); Object.values(S.coa || {}).forEach(a => { if(a.name) ACCT[a.id] = a.name; }); }
const TYPE_OF = c => ({"1":"Asset", "2":"Liability", "3":"Equity", "4":"Income"})[String(c)[0]] || "Expense";

const BK = {
  receipt: {title:"Receipt", plural:"Receipts", view:"receipts", cash:"Received in", partyLabel:"Received from", partyTypes:"csdei", cols:["account","desc","amount","vat","invoiceId"]},
  payment: {title:"Payment", plural:"Payments", view:"payments", cash:"Paid from", partyLabel:"Paid to", partyTypes:"scdei", cols:["account","desc","amount","vat","invoiceId"]},
  sale_invoice: {title:"Sales invoice", plural:"Sales invoices", view:"salesinv", partyLabel:"Customer", partyTypes:"c", cols:["desc","account","qty","price","vat"], defAcct:"4100"},
  purchase_invoice: {title:"Purchase invoice", plural:"Purchase invoices", view:"purchinv", partyLabel:"Supplier", partyTypes:"s", cols:["desc","account","qty","price","vat"], defAcct:"5310"},
  journal: {title:"Journal entry", plural:"Journal entries", view:"journals", cols:["account","party","desc","dr","cr"]},
};
const CONTROL = {"1200":"c", "2000":"s", "2100":"d", "2110":"e", "1180":"e", "2200":"i"};
/* Profit & loss groups: drivers and the cars are the cost of the service (cost of sales); office,
   operations and workshop staff and general costs are administrative expenses. */
function plGroup(code){
  const n = +code; if(String(code)[0] === "4") return "income";
  if(n === 5900) return "investor";
  return n >= 5000 && n < 5290 ? "cos" : "admin";
}
const PL_GROUPS = {cos:"Cost of sales", admin:"Administrative & general expenses", investor:"Investors' profit share"};
const VAT_OPTS = {"":"No VAT", "5":"5% VAT"};
const isInv = k => k === "sale_invoice" || k === "purchase_invoice";
const lineNet = (k, l) => r2(isInv(k) ? num(l.qty === "" || l.qty == null ? 1 : l.qty) * num(l.price) : num(l.amount));
const lineVat = (k, l) => r2(lineNet(k, l) * (l.vat === "5" ? 0.05 : 0));
function docTotals(e){ const ls = e.lines || [], net = sum(ls, l => lineNet(e.type, l)), vat = sum(ls, l => lineVat(e.type, l)); return {net: r2(net), vat: r2(vat), total: r2(net + vat)}; }
function partyName(p){
  if(!p) return ""; const [t, id] = [p.slice(0,1), p.slice(2)];
  return t === "c" ? ((S.customers[id] || {}).name || "Customer") : t === "s" ? ((S.suppliers[id] || {}).name || "Supplier") : t === "d" ? dName(id) : t === "e" ? ((S.employees || {})[id] || {}).name || "Employee" : t === "i" ? ((S.investors[id] || {}).name || "Investor") : "";
}
const docMemo = e => `${BK[e.type].title}${e.number ? " " + e.number : ""}${partyName(e.party) ? " – " + partyName(e.party) : e.payee ? " – " + e.payee : ""}${e.ref ? " – " + e.ref : ""}`;
const lineParty = (e, l) => e.type === "journal" ? (l.party || "") : (e.party || "");
const histEntries = () => (S.ledger && S.ledger.entries && !S.ledger.loading) ? S.ledger.entries : S.entries;
const byName = (a, b) => (a.name || "").localeCompare(b.name || "");

/* ---------- posting ---------- */
function post(e, add, o){
  const k = e.type; if(!BK[k]) return false;
  const memo = docMemo(e), m = l => memo + (l.desc ? " – " + l.desc : "");
  if(k === "journal"){ (e.lines || []).forEach(l => add(l.account || "5310", num(l.dr), num(l.cr), m(l))); return true; }
  const T = docTotals(e), ls = e.lines || [];
  if(k === "receipt"){ add(e.paidFrom || "1100", T.total, 0, memo); ls.forEach(l => add(l.account || "4200", 0, lineNet(k, l), m(l))); add("2300", 0, T.vat, memo); }
  if(k === "payment"){ add(e.paidFrom || "1100", 0, T.total, memo); ls.forEach(l => add(l.account || "5310", lineNet(k, l) + (o.inVatRec ? 0 : lineVat(k, l)), 0, m(l))); if(o.inVatRec) add("1300", T.vat, 0, memo); }
  if(k === "sale_invoice"){ add("1200", T.total, 0, memo); ls.forEach(l => add(l.account || "4100", 0, lineNet(k, l), m(l))); add("2300", 0, T.vat, memo); }
  if(k === "purchase_invoice"){ ls.forEach(l => add(l.account || "5310", lineNet(k, l) + (o.inVatRec ? 0 : lineVat(k, l)), 0, m(l))); if(o.inVatRec) add("1300", T.vat, 0, memo); add("2000", 0, T.total, memo); }
  return true;
}
// movements on a control account for one party
function partyMoves(entries, p, acct){
  const out = [];
  for(const e of entries){
    if(!BK[e.type]) continue; const memo = docMemo(e);
    if(e.type === "sale_invoice" && acct === "1200" && e.party === p) out.push({date:e.date, desc:memo, dr:docTotals(e).total, cr:0, e});
    if(e.type === "purchase_invoice" && acct === "2000" && e.party === p) out.push({date:e.date, desc:memo, dr:0, cr:docTotals(e).total, e});
    (e.lines || []).forEach(l => {
      if(isInv(e.type) || l.account !== acct || lineParty(e, l) !== p) return;
      const a = e.type === "journal" ? 0 : lineNet(e.type, l) + lineVat(e.type, l);
      out.push({date:e.date, desc:memo + (l.desc ? " – " + l.desc : ""), dr: e.type === "journal" ? num(l.dr) : e.type === "payment" ? a : 0, cr: e.type === "journal" ? num(l.cr) : e.type === "receipt" ? a : 0, e, inv:l.invoiceId});
    });
  }
  if(acct === "2000" && window.FIN) out.push(...FIN.supplierMoves(p));   // cars bought on credit
  return out.sort((a,b) => a.date.localeCompare(b.date));
}
const driverLines = (entries, drId) => partyMoves(entries, "d:" + drId, "2100").map(x => ({date:x.date, desc:x.desc, ...(x.dr ? {dr:x.dr} : {}), ...(x.cr ? {cr:x.cr} : {}), ...(x.e ? {ref:{kind:"doc", id:x.e.id, date:x.e.date, type:x.e.type}} : {})}));
const driverNet = (entries, drId) => r2(sum(partyMoves(entries, "d:" + drId, "2100"), x => x.cr - x.dr));
function invPaid(inv, entries){
  return r2(sum(entries.filter(e => e.type === (inv.type === "sale_invoice" ? "receipt" : "payment")), e => sum((e.lines || []).filter(l => l.invoiceId === inv.id), l => lineNet(e.type, l) + lineVat(e.type, l))));
}
function invStatus(inv, entries){
  const T = docTotals(inv), paid = invPaid(inv, entries), due = r2(T.total - paid), today = iso(new Date());
  return {total:T.total, paid, due, label: due <= 0.005 ? "Paid" : inv.dueDate && inv.dueDate < today ? "Overdue" : paid ? "Part paid" : "Due",
    cls: due <= 0.005 ? "good" : inv.dueDate && inv.dueDate < today ? "bad" : "warn"};
}
function partyBalance(kind, id, entries){
  const p = (kind === "customer" ? "c:" : "s:") + id, acct = kind === "customer" ? "1200" : "2000", rec = (kind === "customer" ? S.customers : S.suppliers)[id] || {};
  const mv = partyMoves(entries, p, acct); return r2(num(rec.opening) + sum(mv, x => kind === "customer" ? x.dr - x.cr : x.cr - x.dr));
}

/* ---------- options ---------- */
function chartOpts(excludeCash){
  const o = {}; Object.keys(ACCT).forEach(c => o[c] = c + " · " + acctName(c));
  cashAccounts().forEach(a => { if(excludeCash) delete o[a.id]; else o[a.id] = a.id + " · " + a.name; });
  Object.keys(S.platforms).forEach(p => { const c = clearingAcct(p); o[c] = c + " · " + acctName(c); });
  return Object.fromEntries(Object.entries(o).sort((a,b) => a[0].localeCompare(b[0])));
}
function partyOpts(types){
  const o = {};
  if(types.includes("c")) Object.values(S.customers).sort(byName).forEach(x => o["c:" + x.id] = "Customer · " + x.name);
  if(types.includes("s")) Object.values(S.suppliers).sort(byName).forEach(x => o["s:" + x.id] = "Supplier · " + x.name);
  if(types.includes("i")) Object.values(S.investors).sort(byName).forEach(x => o["i:" + x.id] = "Investor · " + x.name);
  if(types.includes("d")) Object.values(S.drivers).sort(byName).forEach(x => o["d:" + x.id] = "Driver · " + (x.name || x.id));
  if(types.includes("e")) Object.values(S.employees || {}).sort(byName).forEach(x => o["e:" + x.id] = "Employee · " + (x.name || x.id));
  return o;
}

/* ---------- editor ---------- */
const blankLine = k => isInv(k) ? {desc:"", account: BK[k].defAcct, qty:"1", price:"", vat:""} : k === "journal" ? {account:"", party:"", desc:"", dr:"", cr:""} : {account:"", desc:"", amount:"", vat:"", invoiceId:""};
function newDoc(k){
  const today = iso(new Date()), date = today >= S.from && today <= S.to ? today : S.to;
  S.bk = {view: BK[k].view, kind: k, id: "", data: {date, paidFrom: k === "receipt" ? "1100" : k === "payment" ? "1100" : "", party: "", payee: "", ref: "", number: "", dueDate: "", note: ""}, lines: [blankLine(k), ...(k === "journal" ? [blankLine(k)] : [])]};
}
function openDocRow(id){
  const e = S.entries.find(x => x.id === id); if(!e || !BK[e.type]) return;
  S.bk = {view: BK[e.type].view, kind: e.type, id, data: {...e}, lines: (e.lines || []).map(l => ({...l}))};
  // a payment to / receipt from a driver with one line on his account opens in the driver form
  if(BK[e.type].cash && (e.party || "").startsWith("d:")){
    const ls = e.lines || [];
    if(ls.length === 1 && ls[0].account === "2100"){ S.bk.data.purpose = e.type === "payment" ? "salary" : "cash"; S.bk.data.amount = String(lineNet(e.type, ls[0])); S.bk.data.desc = ls[0].desc || ""; }
    else S.bk.data.purpose = "other";
  }
}
// a receipt / payment filled in from a post-dated cheque (pdc.js); saving it marks the cheque cleared
function newFromPdc(p){
  const k = p.dir === "in" ? "receipt" : "payment"; newDoc(k);
  const d = S.bk.data, amt = String(num(p.amount));
  Object.assign(d, {date: p.date, paidFrom: p.account || "1100", party: p.party || "", payee: p.payee || "", ref: `PDC ${p.chequeNo || ""}${p.bank ? " · " + p.bank : ""}`, note: p.note || "", pdcId: p.id});
  if((p.party || "").startsWith("d:")){ d.purpose = k === "payment" ? "salary" : "cash"; d.amount = amt; }
  else S.bk.lines = [{...blankLine(k), account: (p.party || "").startsWith("c:") ? "1200" : (p.party || "").startsWith("s:") ? "2000" : "", amount: amt, desc: p.note || ""}];
}
function newDriverDoc(k, drId, purpose, amt){
  newDoc(k); S.bk.data.party = "d:" + drId; S.bk.data.purpose = purpose; S.bk.data.amount = amt > 0 ? String(r2(amt)) : "";
}

/* ---------- payment / receipt with a driver ---------- */
/* Choosing a driver as "Paid to" / "Received from" turns the form into a driver form:
   Payment – salary (Dr 2100 / Cr bank), salary advance, loan, visa or other expense for the driver
   (a driver account: Dr 1170 his share + Dr expense the company's share / Cr bank, recovered monthly
   from his salary), or other accounts. Receipt – cash handed over (Dr bank / Cr 2100), repayment of a
   loan or advance (Dr bank / Cr 1170), or other accounts. */
const DRV_PAY = {salary:"Salary / balance payment", advance:"Salary advance", loan:"Loan", visa:"Visa (paid for the driver)", shared:"Other expense paid for the driver (medical, licence…)", other:"Other – choose accounts"};
const DRV_REC = {cash:"Cash handed over / balance received", repay:"Loan or advance repayment", other:"Other – choose accounts"};
const ITEM_P = ["advance","loan","visa","shared"];
function drvPurpose(b){ const p = b.data.purpose; return (b.kind === "payment" ? DRV_PAY : DRV_REC)[p] ? p : b.kind === "payment" ? "salary" : "cash"; }
function drvPreview(b){
  const d = b.data, p = drvPurpose(b), drId = (d.party || "").slice(2), who = dName(drId), bank = acctName(d.paidFrom || "1100"), amt = num(d.amount);
  if(p === "other") return "";
  if(p === "salary") return `Records: Dr 2100 Driver account – ${esc(who)} <b>${fmt(amt)}</b> · Cr ${esc(bank)} <b>${fmt(amt)}</b>. The driver's payable balance goes down.`;
  if(p === "cash") return `Records: Dr ${esc(bank)} <b>${fmt(amt)}</b> · Cr 2100 Driver account – ${esc(who)} <b>${fmt(amt)}</b>. The cash he holds goes down.`;
  if(p === "repay"){ const it = S.ditems[d.itemId]; return `Records: Dr ${esc(bank)} <b>${fmt(amt)}</b> · Cr 1170 Driver loans & recoverables <b>${fmt(amt)}</b>${it ? ` (${esc(ITEM_KINDS[it.kind] || "")}${it.desc ? " – " + esc(it.desc) : ""}; outstanding ${fmt(itemOutstanding(it, d.date || S.to))})` : ""}. Later instalments get shorter.`; }
  const vat = ["visa","shared"].includes(p) ? num(d.vat) : 0, cost = amt + vat, pct = String(d.sharePct ?? "") === "" ? 100 : num(d.sharePct), da = r2(cost * pct / 100), co = r2(cost - da), inst = num(d.installment);
  return `Records: Dr 1170 Driver loans & recoverables <b>${fmt(da)}</b> (driver's ${pct}%)${co ? ` · Dr ${esc(acctName(d.category || "5280"))} <b>${fmt(co)}</b> (company's share)` : ""} · Cr ${esc(bank)} <b>${fmt(cost)}</b>.<br>Recovered from his salary ${inst > 0 && inst < da ? `at <b>${fmt(inst)}</b> a month` : "<b>in full</b>"} from ${esc(d.startMonth || (d.date || "").slice(0,7))} (each month: Dr 2100 / Cr 1170).`;
}
function driverPanel(b){
  const k = b.kind, d = b.data, p = drvPurpose(b), drId = d.party.slice(2), P = k === "payment" ? DRV_PAY : DRV_REC;
  const ready = S.ledger && S.ledger.key === setting("ledgerStart", "2026-09-01") + "|" + S.to && !S.ledger.loading && !S.ledger.error;
  if(!ready && S.db) needHistory();
  const bal = ready ? (window.drvBalance ? drvBalance(drId) : ledgerLines(drId).closing) : null, items = Object.values(S.ditems).filter(it => it.driverId === drId), out = sum(items, it => itemOutstanding(it, S.to));
  const f = (n, l, type = "number", extra = "") => `<div class="f"><label for="bh_${n}">${l}</label><input id="bh_${n}" data-hf="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(d[n] ?? "")}"${extra}></div>`;
  let fields = `<div class="f"><label for="bh_purpose">What is it for?</label><select id="bh_purpose" data-hf="purpose">${opts(P, p)}</select></div>`;
  if(p === "salary" || p === "cash") fields += f("amount", "Amount", "number", bal != null && p === "salary" && bal > 0 ? ` placeholder="${r2(bal)}"` : "") + f("desc", "Description", "text");
  if(p === "repay") fields += `<div class="f"><label for="bh_itemId">Loan / advance</label><select id="bh_itemId" data-hf="itemId">${opts(Object.fromEntries(items.filter(it => itemOutstanding(it, d.date || S.to) > 0.004).map(it => [it.id, `${ITEM_KINDS[it.kind] || ""}${it.desc ? " – " + it.desc : ""} · outstanding ${fmt(itemOutstanding(it, S.to))}`])), d.itemId || "", "Choose…")}</select></div>` + f("amount", "Amount");
  if(ITEM_P.includes(p)) fields += f("amount", "Amount (excl. VAT)") + (["visa","shared"].includes(p) ? f("vat", "VAT") : "") + f("sharePct", "Driver's share % (default 100)", "number", ' placeholder="100"')
    + f("installment", "Monthly instalment (blank = in full)") + f("startMonth", "Recover from month", "month") + f("desc", "Description", "text")
    + `<div class="f"><label for="bh_category">Expense for the company's share</label><select id="bh_category" data-hf="category">${opts(EXP_CATS, d.category || "5280")}</select></div>`;
  return `<div class="banner info" style="margin-top:10px"><b>${esc(dName(drId))}</b> · salary account ${bal == null ? "loading…" : `<b>${bal >= 0 ? "payable to him " : "he owes "}AED ${fmt(Math.abs(bal))}</b>`} at ${esc(dmyS(S.to))} · loans & advances outstanding <b>AED ${fmt(out)}</b></div>
  <div class="form" style="margin-top:10px">${fields}</div>${p === "other" ? "" : `<p class="small" id="bkPrev" style="margin-top:10px">${drvPreview(b)}</p>`}`;
}
function bkEditor(){
  const b = S.bk, k = b.kind, c = BK[k], d = b.data, hist = histEntries();
  const hf = (name, label, html) => `<div class="f"><label for="bh_${name}">${label}</label>${html}</div>`;
  const inp = (name, type = "text", extra = "") => `<input id="bh_${name}" data-hf="${name}" type="${type}" value="${esc(d[name] ?? "")}"${extra}>`;
  const sel = (name, o, blank) => `<select id="bh_${name}" data-hf="${name}">${opts(o, d[name] || "", blank)}</select>`;
  let head = hf("date", "Date", inp("date", "date", " required"));
  if(c.cash) head += hf("paidFrom", c.cash, sel("paidFrom", acctOpts()));
  if(c.partyTypes) head += hf("party", c.partyLabel, sel("party", partyOpts(c.partyTypes), isInv(k) ? "Choose…" : "— none —"));
  if(c.cash) head += hf("payee", "or name (if not in the lists)", inp("payee"));
  if(k === "sale_invoice") head += hf("number", "Invoice no.", inp("number", "text", ` placeholder="${esc(nextInvNo())} (automatic)"`));
  if(k === "purchase_invoice") head += hf("number", "Supplier's invoice no.", inp("number"));
  if(isInv(k)) head += hf("dueDate", "Due date", inp("dueDate", "date"));
  head += hf("ref", k === "journal" ? "Narration" : "Reference", inp("ref"));
  const unpaid = !c.cash ? {} : Object.fromEntries(hist.filter(e => e.type === (k === "receipt" ? "sale_invoice" : "purchase_invoice") && (!d.party || e.party === d.party))
    .map(e => [e, invStatus(e, hist.filter(x => x.id !== b.id))]).filter(([e, s]) => s.due > 0.005 || b.lines.some(l => l.invoiceId === e.id)).map(([e, s]) => [e.id, `${e.number || "Invoice"} · ${dmyS(e.date)} · due ${fmt(s.due)}`]));
  const cell = (l, i, col) => {
    const a = `data-line="${i}" data-lf="${col}"`;
    if(col === "account") return `<select ${a} aria-label="Account">${opts(chartOpts(!!c.cash), l.account || "", "Choose account…")}</select>`;
    if(col === "party") return `<select ${a} aria-label="Customer, supplier or driver">${opts(partyOpts("csdei"), l.party || "", "—")}</select>`;
    if(col === "vat") return `<select ${a} aria-label="VAT">${opts(VAT_OPTS, l.vat || "")}</select>`;
    if(col === "invoiceId") return CONTROL[l.account] && CONTROL[l.account] !== "d" ? `<select ${a} aria-label="Invoice">${opts(unpaid, l.invoiceId || "", "Not linked")}</select>` : "";
    if(col === "desc") return `<input ${a} value="${esc(l.desc ?? "")}" aria-label="Description">`;
    return `<input ${a} type="number" step="0.01" value="${esc(l[col] ?? "")}" aria-label="${col}" style="text-align:right">`;
  };
  const heads = {account:"Account", party:"Customer / supplier / driver", desc:"Description", amount:"Amount", vat:"VAT", invoiceId:"Invoice", qty:"Qty", price:"Unit price", dr:"Debit", cr:"Credit"};
  const dmode = !!c.cash && (d.party || "").startsWith("d:"), simple = dmode && drvPurpose(b) !== "other";
  return `<div class="section"><h2>${b.id ? "Edit" : "New"} ${esc(c.title.toLowerCase())}</h2>
  ${c.cash ? `<p class="sub">${dmode ? `A driver is selected: choose what the ${k} is for and the entry is made for you.` : `To settle an invoice, use account ${k === "receipt" ? "1200 Accounts receivable" : "2000 Accounts payable"} and pick the invoice. Choose a driver as ${esc(c.partyLabel.toLowerCase())} for salary, advances, loans and visa.`}</p>` : k === "journal" ? `<p class="sub">Debits must equal credits. Lines on 1200, 2000 or 2100 need the customer, supplier or driver.</p>` : ""}
  <form id="fBk"><div class="form">${head}<div class="f wide"><label for="bh_note">Notes</label>${inp("note")}</div></div>
  ${dmode ? driverPanel(b) : ""}
  ${simple ? "" : `<div class="tbl" style="margin-top:12px"><table><thead><tr>${c.cols.map(x => `<th${["amount","qty","price","dr","cr"].includes(x) ? ' class="num"' : ""}>${heads[x]}</th>`).join("")}${isInv(k) ? '<th class="num">Total</th>' : ""}<th></th></tr></thead><tbody>
  ${b.lines.map((l, i) => `<tr>${c.cols.map(col => `<td style="min-width:${col === "desc" ? 200 : col === "account" || col === "party" ? 190 : col === "invoiceId" ? 170 : 90}px">${cell(l, i, col)}</td>`).join("")}${isInv(k) ? `<td class="num" id="bkl_${i}">${fmt(lineNet(k, l) + lineVat(k, l))}</td>` : ""}<td><button type="button" class="btn sm ghost" data-bkdel="${i}" aria-label="Remove line">✕</button></td></tr>`).join("")}
  </tbody></table></div>
  <div class="row" style="margin-top:8px;justify-content:space-between"><button type="button" class="btn sm" data-bkadd="1">Add line</button><div id="bkTot">${bkTotalsHtml()}</div></div>`}
  <div class="row" style="margin-top:12px"><button class="btn primary" type="submit" ${S.canWrite && S.db ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-bkcancel="1">Cancel</button>${b.id ? `<button class="btn danger" type="button" data-bkdelete="1">Delete</button>` : ""}${k === "sale_invoice" && b.id ? `<button class="btn" type="button" data-bkpdf="${esc(b.id)}">Download PDF</button>` : ""}</div>
  </form></div>`;
}
function bkTotalsHtml(){
  const b = S.bk; if(!b) return "";
  if(b.kind === "journal"){ const dr = sum(b.lines, l => num(l.dr)), cr = sum(b.lines, l => num(l.cr)), diff = r2(dr - cr);
    return `Debit <b class="mono">${fmt(dr)}</b> · Credit <b class="mono">${fmt(cr)}</b> ${Math.abs(diff) < 0.005 ? '<span class="pill good">Balanced</span>' : `<span class="pill bad">Difference ${fmt(diff)}</span>`}`; }
  const T = docTotals({type: b.kind, lines: b.lines});
  return `Net <b class="mono">${fmt(T.net)}</b> · VAT <b class="mono">${fmt(T.vat)}</b> · Total <b class="mono">AED ${fmt(T.total)}</b>`;
}
function nextInvNo(){ const n = (num(S.settings.invSeq) || 0) + 1; return (S.settings.invPrefix || "INV-") + String(n).padStart(4, "0"); }

async function saveBk(){
  const b = S.bk, k = b.kind, d = b.data;
  if(!d.date){ toast("Enter the date."); return; }
  if(BK[k].cash && (d.party || "").startsWith("d:") && drvPurpose(b) !== "other"){
    const drId = d.party.slice(2), p = drvPurpose(b), amt = num(d.amount), by = (S.user && (S.user.name || S.user.id)) || "";
    if(!amt){ toast("Enter the amount."); return; }
    if(ITEM_P.includes(p)){
      // a driver account (loan, advance, visa…): posted from driverItems, recovered monthly through the salary
      const vat = ["visa","shared"].includes(p) ? num(d.vat) : 0, pct = String(d.sharePct ?? "") === "" ? 100 : num(d.sharePct);
      const rec = {driverId: drId, kind: p, date: d.date, desc: d.desc || d.note || "", amount: amt, vat, sharePct: pct, driverAmount: r2((amt + vat) * pct / 100), category: d.category || "5280",
        paidFrom: d.paidFrom || "1100", installment: num(d.installment), startMonth: d.startMonth || d.date.slice(0,7), repayments: [], ref: d.ref || "", viaPayment: true, by, at: new Date().toISOString()};
      if(b.id && S.entries.some(x => x.id === b.id)){ const e = S.entries.find(x => x.id === b.id), m0 = e.date.slice(0,7), s0 = await S.db.doc("entries/" + m0).get(); if(!await writeOk(S.db.doc("entries/" + m0).set({month: m0, rows: (s0.exists ? s0.data().rows || [] : []).filter(r => r.id !== b.id)}))) return; }
      if(!await writeOk(S.db.doc("driverItems/i-" + uid()).set(rec))) return;
      if(d.pdcId && window.PDC) await PDC.cleared(d.pdcId, "", d.date);
      S.bk = null; await loadPeriod(); render(); toast(`${ITEM_KINDS[p]} recorded for ${dName(drId)}. It is on his Accounts tab.`); return;
    }
    if(p === "repay"){
      const it = S.ditems[d.itemId]; if(!it){ toast("Choose the loan or advance."); return; } const {id:_, ...ib} = it;
      if(!await writeOk(S.db.doc("driverItems/" + it.id).set({...ib, repayments: [...(ib.repayments || []), {date: d.date, amount: amt, paidTo: d.paidFrom || "1100", note: d.ref || d.desc || ""}]}))) return;
      if(d.pdcId && window.PDC) await PDC.cleared(d.pdcId, "", d.date);
      S.bk = null; render(); toast("Repayment recorded."); return;
    }
    b.lines = [{account: "2100", desc: d.desc || (k === "payment" ? "Salary / balance payment" : "Cash received from the driver"), amount: String(amt), vat: ""}];
  }
  const keep = k === "journal" ? l => num(l.dr) || num(l.cr) : l => lineNet(k, l) || l.account || l.desc;
  const lines = b.lines.filter(keep).map(l => { const o = {...l}; Object.keys(o).forEach(x => { if(o[x] === "" || o[x] == null) delete o[x]; }); return o; });
  if(!lines.length){ toast("Add at least one line."); return; }
  if(k !== "journal" && !isInv(k) && lines.some(l => !l.account)){ toast("Choose the account on every line."); return; }
  if(isInv(k) && !d.party){ toast(`Choose the ${BK[k].partyLabel.toLowerCase()}.`); return; }
  if(k === "journal"){ const dr = sum(lines, l => num(l.dr)), cr = sum(lines, l => num(l.cr)); if(Math.abs(dr - cr) > 0.005){ toast("Debits and credits must be equal."); return; } if(lines.some(l => !l.account)){ toast("Choose the account on every line."); return; } }
  for(const l of lines){ const need = CONTROL[l.account]; if(!need || isInv(k)) continue; const p = lineParty({type:k, party:d.party}, l);
    if(!p || p[0] !== need){ toast(`Account ${l.account} needs a ${need === "c" ? "customer" : need === "s" ? "supplier" : need === "i" ? "investor" : need === "e" ? "employee" : "driver"}${k === "journal" ? " on the line" : " as " + BK[k].partyLabel.toLowerCase()}.`); return; } }
  const rec = {id: b.id || uid(), type: k, date: d.date, lines, note: d.note || "", ref: d.ref || "", by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()};
  if(BK[k].cash){ rec.paidFrom = d.paidFrom || "1100"; rec.party = d.party || ""; rec.payee = d.payee || ""; if(d.pdcId) rec.pdcId = d.pdcId; }
  if(isInv(k)){ rec.party = d.party; rec.dueDate = d.dueDate || ""; rec.number = d.number || ""; }
  let settings = null;
  if(k === "sale_invoice" && !rec.number){ rec.number = nextInvNo(); settings = {...S.settings, invSeq: (num(S.settings.invSeq) || 0) + 1}; }
  if(isInv(k) && !rec.dueDate){ const p = (k === "sale_invoice" ? S.customers : S.suppliers)[d.party.slice(2)] || {}; rec.dueDate = addDays(d.date, num(p.creditDays) || 0); }
  const m = d.date.slice(0,7), old = b.id && S.entries.find(x => x.id === b.id);
  if(old && old.date.slice(0,7) !== m){ const om = old.date.slice(0,7), s0 = await S.db.doc("entries/" + om).get(); const r0 = (s0.exists ? s0.data().rows || [] : []).filter(r => r.id !== b.id); if(!await writeOk(S.db.doc("entries/" + om).set({month: om, rows: r0}))) return; }
  const snap = await S.db.doc("entries/" + m).get(); let rows = snap.exists ? (snap.data().rows || []) : [];
  rows = rows.filter(r => r.id !== rec.id); rows.push(rec);
  if(!await writeOk(S.db.doc("entries/" + m).set({month: m, rows}))) return;
  if(settings) await writeOk(S.db.doc("settings/main").set(settings));
  if(d.pdcId && window.PDC) await PDC.cleared(d.pdcId, rec.id, d.date);
  S.bk = null; await loadPeriod(); render(); toast(`${BK[k].title}${rec.number ? " " + rec.number : ""} saved.`);
}
async function deleteBk(){
  const b = S.bk, e = S.entries.find(x => x.id === b.id); if(!e) return;
  const m = e.date.slice(0,7), snap = await S.db.doc("entries/" + m).get(), rows = (snap.exists ? snap.data().rows || [] : []).filter(r => r.id !== b.id);
  if(await writeOk(S.db.doc("entries/" + m).set({month: m, rows}))){ S.bk = null; await loadPeriod(); render(); toast("Deleted."); }
}

/* ---------- lists ---------- */
function docList(k){
  const c = BK[k], editing = S.bk && S.bk.view === S.view ? bkEditor() : "";
  const list = S.entries.filter(e => e.type === k).slice().sort((a,b) => (b.date + (b.number || "")).localeCompare(a.date + (a.number || "")));
  let table;
  if(isInv(k)){
    const wait = needHistory(); if(wait) return editing + `<div class="section"><h2>${c.plural}</h2>${wait}</div>`;
    const hist = histEntries(), sts = list.map(e => [e, invStatus(e, hist)]);
    table = list.length ? `<div class="tbl"><table><thead><tr><th>${k === "sale_invoice" ? "Invoice no." : "Supplier's no."}</th><th>Date</th><th>Due</th><th>${c.partyLabel}</th><th>Reference</th><th class="num">Total</th><th class="num">${k === "sale_invoice" ? "Received" : "Paid"}</th><th class="num">Balance due</th><th>Status</th><th></th></tr></thead><tbody>
    ${sts.map(([e, s]) => `<tr><td class="mono">${esc(e.number || "—")}</td><td>${esc(dmyS(e.date))}</td><td>${e.dueDate ? esc(dmyS(e.dueDate)) : ""}</td><td>${esc(partyName(e.party))}</td><td class="small">${esc(e.ref)}</td><td class="num">${fmt(s.total)}</td><td class="num">${fmt(s.paid)}</td><td class="num"><b>${fmt(s.due)}</b></td><td><span class="pill ${s.cls}">${s.label}</span></td>
      <td class="row"><button class="btn sm" data-bkedit="${esc(e.id)}">Edit</button>${k === "sale_invoice" ? `<button class="btn sm" data-bkpdf="${esc(e.id)}">PDF</button>` : ""}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="5">${list.length} invoices</td><td class="num">${fmt(sum(sts, x => x[1].total))}</td><td class="num">${fmt(sum(sts, x => x[1].paid))}</td><td class="num">${fmt(sum(sts, x => x[1].due))}</td><td colspan="2"></td></tr></tfoot></table></div>` : `<div class="empty"><b>No ${c.plural.toLowerCase()} in this period</b>Click “New ${c.title.toLowerCase()}” to add one.</div>`;
  } else if(k === "journal"){
    table = list.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Narration</th><th>Accounts</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${list.map(e => `<tr><td>${esc(dmyS(e.date))}</td><td style="white-space:normal">${esc(e.ref || e.note)}</td><td class="small" style="white-space:normal">${esc([...new Set((e.lines || []).map(l => l.account + " " + acctName(l.account)))].join(", "))}</td><td class="num">${fmt(sum(e.lines || [], l => num(l.dr)))}</td><td><button class="btn sm" data-bkedit="${esc(e.id)}">Edit</button></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><b>No journal entries in this period</b>Use journal entries for adjustments, accruals, depreciation and corrections.</div>`;
  } else {
    // driver accounts given (payments) and their cash repayments (receipts) are listed with the documents
    const rows = list.map(e => ({date: e.date, ref: e.ref, acct: e.paidFrom || "1100", who: partyName(e.party) || e.payee || "", desc: (e.lines || []).map(l => l.desc || acctName(l.account)).join(", "), amt: docTotals(e).total, btn: `<button class="btn sm" data-bkedit="${esc(e.id)}">Edit</button>`}));
    Object.values(S.ditems).forEach(it => {
      const lbl = `${ITEM_KINDS[it.kind] || "Loan"}${it.desc ? " – " + it.desc : ""}`, btn = `<button class="btn sm" data-itemedit="${esc(it.id)}">Open</button>`;
      if(k === "payment" && it.date >= S.from && it.date <= S.to) rows.push({date: it.date, ref: it.ref || "", acct: it.paidFrom || "1100", who: dName(it.driverId), desc: lbl, amt: r2(num(it.amount) + num(it.vat) || num(it.driverAmount)), btn});
      if(k === "receipt") (it.repayments || []).forEach(r => { if(r.date >= S.from && r.date <= S.to) rows.push({date: r.date, ref: r.note || "", acct: r.paidTo || "1100", who: dName(it.driverId), desc: "Repayment – " + lbl, amt: num(r.amount), btn}); });
    });
    rows.sort((a,b) => b.date.localeCompare(a.date));
    table = rows.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Reference</th><th>${c.cash}</th><th>${c.partyLabel}</th><th>Description</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(dmyS(r.date))}</td><td class="small">${esc(r.ref)}</td><td>${esc(acctName(r.acct))}</td><td>${esc(r.who)}</td><td class="small" style="white-space:normal">${esc(r.desc)}</td><td class="num">${fmt(r.amt)}</td><td>${r.btn}</td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="5">${rows.length} ${c.plural.toLowerCase()}</td><td class="num">${fmt(sum(rows, r => r.amt))}</td><td></td></tr></tfoot></table></div>` : `<div class="empty"><b>No ${c.plural.toLowerCase()} in this period</b>Click “New ${c.title.toLowerCase()}” to add one.</div>`;
  }
  return editing + `<div class="section"><div class="head"><div><h2>${c.plural} · ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</h2></div><button class="btn primary" data-bknew="${k}">New ${esc(c.title.toLowerCase())}</button></div>${table}</div>`;
}

/* ---------- customers & suppliers ---------- */
function partyView(kind){
  const col = kind === "customer" ? "customers" : "suppliers", recs = S[col], label = kind === "customer" ? "Customer" : "Supplier";
  const pe = S.pe && S.pe.kind === kind && (!S.pe.id || recs[S.pe.id]) ? S.pe : null, pv = S.pv && S.pv.kind === kind ? S.pv : null;
  const form = pe ? partyForm(kind, pe.id) : "";
  const wait = needHistory();
  if(wait) return form + `<div class="section"><h2>${label}s</h2>${wait}</div>`;
  const hist = histEntries();
  if(pv && recs[pv.id]) return form + partyStatement(kind, pv.id, hist);
  const list = Object.values(recs).sort(byName), invType = kind === "customer" ? "sale_invoice" : "purchase_invoice";
  return form + `<div class="section"><div class="head"><div><h2>${label}s</h2><p class="sub">${kind === "customer" ? "Who owes the company (accounts receivable, 1200)" : "Who the company owes (accounts payable, 2000)"} at ${esc(dmyS(S.to))}. Click a name for the statement.</p></div><button class="btn primary" data-pnew="${kind}">New ${label.toLowerCase()}</button></div>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>Name</th><th>Code</th><th>Phone</th><th>TRN</th><th class="num">Open invoices</th><th class="num">${kind === "customer" ? "Balance owed to us" : "Balance we owe"}</th><th></th></tr></thead><tbody>
  ${list.map(x => { const open = hist.filter(e => e.type === invType && e.party === (kind[0] + ":" + x.id) && invStatus(e, hist).due > 0.005).length, bal = partyBalance(kind, x.id, hist);
    return `<tr><td><button class="btn sm ghost" data-pview="${kind}" data-id="${esc(x.id)}" style="padding:2px 6px"><b>${esc(x.name)}</b></button></td><td class="mono small">${esc(x.code)}</td><td>${esc(x.phone)}</td><td class="mono small">${esc(x.trn)}</td><td class="num">${open || ""}</td><td class="num"><b>${aed(bal)}</b></td><td><button class="btn sm" data-pedit="${kind}" data-id="${esc(x.id)}">Edit</button></td></tr>`; }).join("")}
  </tbody><tfoot><tr><td colspan="5">Total</td><td class="num">${fmt(sum(list, x => partyBalance(kind, x.id, hist)))}</td><td></td></tr></tfoot></table></div>` : `<div class="empty"><b>No ${label.toLowerCase()}s yet</b>Add ${kind === "customer" ? "hotels, corporate clients and other customers you invoice" : "garages, fuel companies, insurers and other suppliers"}.</div>`}</div>`;
}
function partyForm(kind, id){
  const x = (kind === "customer" ? S.customers : S.suppliers)[id] || {}, label = kind === "customer" ? "customer" : "supplier";
  const f = (n, l, type = "text") => `<div class="f"><label for="pf_${n}">${l}</label><input id="pf_${n}" name="${n}" type="${type}" ${type === "number" ? 'step="0.01"' : ""} value="${esc(x[n] ?? "")}"${n === "name" ? " required" : ""}></div>`;
  return `<div class="section"><h2>${id ? "Edit " + esc(x.name) : "New " + label}</h2><form class="form" id="fParty" data-kind="${kind}" data-id="${esc(id || "")}">
    ${f("name", "Name")}${f("code", "Code")}${f("contact", "Contact person")}${f("phone", "Phone")}${f("email", "Email", "email")}${f("trn", "TRN")}
    <div class="f wide"><label for="pf_address">Address</label><input id="pf_address" name="address" value="${esc(x.address)}"></div>
    ${f("creditDays", "Credit days", "number")}${f("opening", `Opening balance on ${dmyS(setting("ledgerStart", "2026-09-01"))} (${kind === "customer" ? "owed to us" : "we owe"})`, "number")}
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-pcancel="1">Cancel</button>${id ? `<button class="btn danger" type="button" data-del="${kind}s" data-id="${esc(id)}">Delete</button>` : ""}</div>
  </form></div>`;
}
function partyStatement(kind, id, hist){
  const x = (kind === "customer" ? S.customers : S.suppliers)[id], p = kind[0] + ":" + id, acct = kind === "customer" ? "1200" : "2000";
  const mv = partyMoves(hist, p, acct), sign = kind === "customer" ? 1 : -1; let bal = num(x.opening), before = bal; const shown = [];
  mv.forEach(m => { bal = r2(bal + sign * (m.dr - m.cr)); if(m.date < S.from) before = bal; else shown.push({...m, bal}); });
  const invType = kind === "customer" ? "sale_invoice" : "purchase_invoice", open = hist.filter(e => e.type === invType && e.party === p).map(e => [e, invStatus(e, hist)]).filter(([, s]) => s.due > 0.005);
  return `<div class="section"><div class="head"><div><h2>${esc(x.name)} · statement</h2><p class="sub">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}${x.trn ? " · TRN " + esc(x.trn) : ""}</p></div><div class="row"><button class="btn ghost" data-back="1">← Back</button><button class="btn" data-pedit="${kind}" data-id="${esc(id)}">Edit</button></div></div>
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">${kind === "customer" ? "Invoiced" : "Paid"}</th><th class="num">${kind === "customer" ? "Received" : "Invoiced"}</th><th class="num">Balance</th></tr></thead><tbody>
  <tr><td>${esc(dmyS(S.from))}</td><td><b>Balance brought forward</b></td><td></td><td></td><td class="num"><b>${aed(before)}</b></td></tr>
  ${shown.map(m => `<tr><td>${esc(dmyS(m.date))}</td><td style="white-space:normal">${esc(m.desc)}</td><td class="num">${m.dr ? fmt(m.dr) : ""}</td><td class="num">${m.cr ? fmt(m.cr) : ""}</td><td class="num">${aed(m.bal)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="4">Balance ${esc(dmyS(S.to))}</td><td class="num"><b>${aed(bal)}</b></td></tr></tfoot></table></div>
  ${open.length ? `<h2 style="margin-top:14px">Unpaid invoices</h2><div class="tbl"><table><thead><tr><th>No.</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">Balance due</th><th>Status</th></tr></thead><tbody>${open.map(([e, s]) => `<tr><td class="mono">${esc(e.number || "—")}</td><td>${esc(dmyS(e.date))}</td><td>${e.dueDate ? esc(dmyS(e.dueDate)) : ""}</td><td class="num">${fmt(s.total)}</td><td class="num"><b>${fmt(s.due)}</b></td><td><span class="pill ${s.cls}">${s.label}</span></td></tr>`).join("")}</tbody></table></div>` : ""}</div>`;
}

/* ---------- invoice PDF ---------- */
async function invoicePdf(id){
  const e = histEntries().find(x => x.id === id) || S.entries.find(x => x.id === id); if(!e) return;
  if(!window.html2pdf){ toast("The PDF tool is still loading – try again in a moment."); return; }
  const cu = S.customers[(e.party || "").slice(2)] || {}, T = docTotals(e), st = invStatus(e, histEntries());
  const html = `<div class="paper">${letterhead()}
    <h3 style="text-align:center;margin:10px 0 14px;letter-spacing:.08em">TAX INVOICE</h3>
    <table style="width:100%;margin-bottom:12px;font-size:10pt"><tr><td style="vertical-align:top;width:55%"><b>Bill to</b><br>${esc(cu.name || partyName(e.party))}${cu.address ? "<br>" + esc(cu.address) : ""}${cu.trn ? "<br>TRN " + esc(cu.trn) : ""}</td>
      <td style="vertical-align:top;text-align:right">Invoice no. <b>${esc(e.number || "")}</b><br>Date ${esc(dmyS(e.date))}${e.dueDate ? "<br>Due " + esc(dmyS(e.dueDate)) : ""}${e.ref ? "<br>Ref " + esc(e.ref) : ""}</td></tr></table>
    <table style="width:100%;border-collapse:collapse;font-size:10pt"><thead><tr style="background:#f1f1f1"><th style="text-align:left;padding:6px">Description</th><th style="text-align:right;padding:6px">Qty</th><th style="text-align:right;padding:6px">Unit price</th><th style="text-align:right;padding:6px">VAT</th><th style="text-align:right;padding:6px">Amount (AED)</th></tr></thead><tbody>
    ${(e.lines || []).map(l => `<tr><td style="padding:6px;border-bottom:1px solid #ddd">${esc(l.desc || "")}</td><td style="padding:6px;text-align:right;border-bottom:1px solid #ddd">${esc(l.qty ?? 1)}</td><td style="padding:6px;text-align:right;border-bottom:1px solid #ddd">${fmt(num(l.price))}</td><td style="padding:6px;text-align:right;border-bottom:1px solid #ddd">${fmt(lineVat(e.type, l))}</td><td style="padding:6px;text-align:right;border-bottom:1px solid #ddd">${fmt(lineNet(e.type, l) + lineVat(e.type, l))}</td></tr>`).join("")}
    </tbody></table>
    <table style="margin-left:auto;margin-top:10px;font-size:10pt"><tr><td style="padding:3px 10px">Subtotal</td><td style="text-align:right">${fmt(T.net)}</td></tr><tr><td style="padding:3px 10px">VAT 5%</td><td style="text-align:right">${fmt(T.vat)}</td></tr><tr><td style="padding:3px 10px"><b>Total AED</b></td><td style="text-align:right"><b>${fmt(T.total)}</b></td></tr>${st.paid ? `<tr><td style="padding:3px 10px">Received</td><td style="text-align:right">${fmt(st.paid)}</td></tr><tr><td style="padding:3px 10px"><b>Balance due</b></td><td style="text-align:right"><b>${fmt(st.due)}</b></td></tr>` : ""}</table>
    ${e.note ? `<p style="margin-top:14px;font-size:10pt">${esc(e.note)}</p>` : ""}</div>`;
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;background:#fff"; box.innerHTML = html; document.body.appendChild(box);
  const name = `Invoice_${(e.number || "draft").replace(/[^\w-]+/g, "_")}.pdf`;
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.96}, html2canvas: {scale: 2, scrollX: 0, scrollY: 0, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}}).from(box.firstChild).save(); toast("Downloaded " + name); }
  catch(err){ toast("Could not make the PDF. Try again."); }
  box.remove();
}

/* ---------- chart of accounts ---------- */
const TYPE_ORDER = ["Asset","Liability","Equity","Income","Expense"];
function allCodes(){
  return [...new Set([...Object.keys(ACCT), ...cashAccounts().map(a => a.id), ...Object.keys(S.platforms).map(clearingAcct), ...Object.keys(S.coa || {})])].sort();
}
// opening balance at the books start, debit positive (cash accounts, customers, suppliers and drivers keep theirs on their own pages)
function openingOf(code){
  let o = num((S.coa[code] || {}).opening);
  const ca = cashAccounts().find(a => a.id === code); if(ca) o += num(ca.opening);
  if(code === "1200") o += sum(Object.values(S.customers), c => num(c.opening));
  if(code === "2000") o -= sum(Object.values(S.suppliers), x => num(x.opening));
  if(code === "2100") o -= sum(Object.values(S.drivers), d => num(d.openingBalance));
  if(window.FIN) o += FIN.opening(code);   // cars bought (and financed) before the books start
  if(window.LOANS) o += LOANS.opening(code);   // loans taken before the books start
  return r2(o);
}
const natural = (code, v) => ["Asset","Expense"].includes(TYPE_OF(code)) ? v : -v;
function coaBalances(J){
  const mv = {}; J.forEach(l => { mv[l.acct] = (mv[l.acct] || 0) + l.dr - l.cr; });
  return allCodes().map(code => ({code, name: acctName(code), type: TYPE_OF(code), open: openingOf(code), bal: r2(openingOf(code) + (mv[code] || 0)), used: code in mv}));
}
function coaView(){
  const ce = S.ce ? coaForm(S.ce.code) : "", wait = needHistory();
  if(wait) return ce + `<div class="section"><h2>Chart of accounts</h2>${wait}</div>`;
  if(S.coaView) return ce + coaLedger(S.coaView);
  const rows = coaBalances(historyJournal());
  return ce + `<div class="section"><div class="head"><div><h2>Chart of accounts</h2><p class="sub">Every account with its opening balance (books start ${esc(dmyS(setting("ledgerStart", "2026-09-01")))}) and balance at ${esc(dmyS(S.to))}. Click an account for its ledger. Codes: 1 assets, 2 liabilities, 3 equity, 4 income, 5 expenses.</p></div><button class="btn primary" data-coanew="1">Add account</button></div>
  <div class="tbl"><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Opening</th><th class="num">Balance ${esc(dmyS(S.to))}</th><th></th></tr></thead><tbody>
  ${TYPE_ORDER.map(ty => { const rs = rows.filter(r => r.type === ty); return `<tr><td colspan="6" style="background:var(--bg)"><b>${ty === "Liability" ? "Liabilities" : ty + "s"}</b></td></tr>` + rs.map(r => `<tr><td class="mono">${esc(r.code)}</td><td><button class="btn sm ghost" data-coaview="${esc(r.code)}" style="padding:2px 6px">${esc(r.name)}</button>${S.coa[r.code] && !(r.code in ACCT_BASE) && !cashAccounts().some(a => a.id === r.code) ? ' <span class="pill">Custom</span>' : ""}</td><td class="small">${ty}${ty === "Expense" ? ` · <span class="muted">${esc(PL_GROUPS[plGroup(r.code)] || "")}</span>` : ""}</td><td class="num">${r.open ? aed(natural(r.code, r.open)) : ""}</td><td class="num">${aed(natural(r.code, r.bal))}</td><td><button class="btn sm" data-coaedit="${esc(r.code)}">Edit</button></td></tr>`).join(""); }).join("")}
  </tbody></table></div><p class="small muted" style="margin-top:6px">Balances are shown the natural way round: assets and expenses as debits, liabilities, equity and income as credits.</p></div>`;
}
function coaForm(code){
  const a = S.coa[code] || {}, isCash = cashAccounts().some(x => x.id === code), builtIn = code && (code in ACCT_BASE);
  return `<div class="section"><h2>${code ? "Edit " + esc(code) + " · " + esc(acctName(code)) : "New account"}</h2>
  ${isCash ? `<p class="sub">This is a bank / cash account: edit it on the Bank & cash accounts page.</p><button class="btn ghost" data-coacancel="1">Close</button>` : `<form class="form" id="fCoa" data-code="${esc(code || "")}">
    <div class="f"><label for="ca_c">Code (4 digits: 1 asset, 2 liability, 3 equity, 4 income, 5 expense)</label><input id="ca_c" name="code" required pattern="[1-9][0-9]{3}" value="${esc(code || "")}" ${code ? "readonly" : ""}></div>
    <div class="f"><label for="ca_n">Name</label><input id="ca_n" name="name" required value="${esc(a.name || (code ? acctName(code) : ""))}"></div>
    <div class="f"><label for="ca_o">Opening balance (debit +, credit −)</label><input id="ca_o" name="opening" type="number" step="0.01" value="${esc(a.opening ?? "")}"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-coacancel="1">Cancel</button>${code && !builtIn && S.coa[code] ? `<button class="btn danger" type="button" data-del="coa" data-id="${esc(code)}">Delete</button>` : ""}</div>
  </form>${["1200","2000","2100"].includes(code) ? `<p class="small muted">Opening balances of customers, suppliers and drivers are entered on their own forms and added to this account.</p>` : ""}`}</div>`;
}
function coaLedger(code){
  const J = historyJournal().filter(l => l.acct === code).sort((a,b) => a.date.localeCompare(b.date)); let bal = openingOf(code); const open = bal;
  const rows = J.map(l => { bal = r2(bal + l.dr - l.cr); return {...l, bal}; });
  return `<div class="section"><div class="head"><div><h2>${esc(code)} · ${esc(acctName(code))}</h2><p class="sub">${TYPE_OF(code)} · from the books start to ${esc(dmyS(S.to))}. Totals that come from the trips are dated at the end of the period.</p></div><button class="btn ghost" data-back="1">← Back</button></div>
  <div class="tbl"><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance (Dr +)</th></tr></thead><tbody>
  <tr><td></td><td><b>Opening balance</b></td><td></td><td></td><td class="num"><b>${aed(open)}</b></td></tr>
  ${rows.slice(-1000).map(l => `<tr><td>${esc(dmyS(l.date))}</td><td style="white-space:normal">${esc(l.memo)}</td><td class="num">${l.dr ? fmt(l.dr) : ""}</td><td class="num">${l.cr ? fmt(l.cr) : ""}</td><td class="num">${aed(l.bal)}</td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="2">Balance</td><td class="num">${fmt(sum(rows, l => l.dr))}</td><td class="num">${fmt(sum(rows, l => l.cr))}</td><td class="num"><b>${aed(bal)}</b></td></tr></tfoot></table></div></div>`;
}

/* ---------- financial statements ---------- */
function statementsView(){
  // profit & loss for the period at the top
  const L = journal(compute()), mv = {}; L.forEach(l => { mv[l.acct] = (mv[l.acct] || 0) + l.dr - l.cr; });
  const codes = g => Object.keys(mv).filter(c => TYPE_OF(c) !== "Asset" && TYPE_OF(c) !== "Liability" && TYPE_OF(c) !== "Equity" && plGroup(c) === g && r2(mv[c])).sort();
  const inc = codes("income"), cos = codes("cos"), adm = codes("admin"), invs = codes("investor");
  const tInc = sum(inc, c => -mv[c]), tCos = sum(cos, c => mv[c]), tAdm = sum(adm, c => mv[c]), tInv = sum(invs, c => mv[c]);
  const gp = tInc - tCos, op = gp - tAdm, np = op - tInv;
  const line = (c, v) => `<tr><td class="mono small">${esc(c)}</td><td>${esc(acctName(c))}</td><td class="num">${aed(v)}</td></tr>`;
  const head = t => `<tr><td colspan="3"><b>${t}</b></td></tr>`, tot = (t, v) => `<tr class="tot"><td></td><td><b>${t}</b></td><td class="num"><b>${aed(v)}</b></td></tr>`;
  const pl = `<div class="section"><h2>Profit & loss · ${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}</h2><div class="tbl"><table><tbody>
    ${head("Revenue")}${inc.map(c => line(c, -mv[c])).join("")}${tot("Total revenue", tInc)}
    ${head(PL_GROUPS.cos + " <span class=\"small muted\">(drivers, platform fees, vehicle running costs)</span>")}${cos.map(c => line(c, mv[c])).join("")}${tot("Total cost of sales", tCos)}
    ${tot("Gross profit", gp)}
    ${head(PL_GROUPS.admin + " <span class=\"small muted\">(office, operations & workshop staff, overheads)</span>")}${adm.map(c => line(c, mv[c])).join("")}${tot("Total administrative & general expenses", tAdm)}
    ${tot("Operating profit", op)}
    ${invs.length ? head(PL_GROUPS.investor) + invs.map(c => line(c, mv[c])).join("") : ""}
    ${tot(np >= 0 ? "Net profit" : "Net loss", np)}</tbody></table></div>
    <p class="small muted" style="margin-top:6px">Drivers are direct staff: their earnings share or salary (5100) and their visas & permits (5280) are cost of sales. Employees' salaries post to administrative expenses by department (6000–6002) with their visa & EID (6010). A driver's own share of a loan or visa is not an expense – it sits in 1170 until recovered.</p></div>`;
  const wait = needHistory();
  if(wait) return pl + `<div class="section"><h2>Balance sheet</h2>${wait}</div>`;
  // balance sheet at the end of the period: opening balances + everything posted since the books start
  const B = coaBalances(historyJournal()).filter(r => r.bal || r.open);
  const grp = ty => B.filter(r => r.type === ty), val = r => natural(r.code, r.bal);
  const profit = -sum(B.filter(r => r.type === "Income" || r.type === "Expense"), r => r.bal);
  const tA = sum(grp("Asset"), val), tL = sum(grp("Liability"), val), tE = sum(grp("Equity"), val) + profit, diff = r2(tA - tL - tE), gap = Math.abs(diff) > 0.01;
  const bl = r => `<tr><td class="mono small">${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${aed(val(r))}</td></tr>`;
  const bs = `<div class="section"><h2>Balance sheet at ${esc(dmyS(S.to))}</h2><div class="tbl"><table><tbody>
    <tr><td colspan="3"><b>Assets</b></td></tr>${grp("Asset").map(bl).join("")}<tr class="tot"><td></td><td><b>Total assets</b></td><td class="num"><b>${aed(tA)}</b></td></tr>
    <tr><td colspan="3"><b>Liabilities</b></td></tr>${grp("Liability").map(bl).join("")}<tr class="tot"><td></td><td><b>Total liabilities</b></td><td class="num"><b>${aed(tL)}</b></td></tr>
    <tr><td colspan="3"><b>Equity</b></td></tr>${grp("Equity").map(bl).join("")}<tr><td></td><td>Profit since ${esc(dmyS(setting("ledgerStart", "2026-09-01")))}</td><td class="num">${aed(profit)}</td></tr>
    ${gap ? `<tr><td></td><td>Opening balances not yet entered (difference)</td><td class="num">${aed(diff)}</td></tr>` : ""}
    <tr class="tot"><td></td><td><b>Total liabilities & equity</b></td><td class="num"><b>${aed(tL + tE + (gap ? diff : 0))}</b></td></tr></tbody></table></div>
    ${gap ? `<p class="small muted" style="margin-top:6px">The difference is the opening position not yet entered. Enter the opening balances (owner's capital, retained earnings, other assets and liabilities at the books start) in the Chart of accounts and it disappears.</p>` : ""}</div>`;
  return `<div class="grid2">${pl}${bs}</div>`;
}

/* ---------- wiring ---------- */
// a payment to an employee: salary (2110) or an advance / loan (1180)
// payment to / receipt from an investor: account 2200 Investor payables
function newInvestorDoc(k, id, amt){ newDoc(k); S.bk.data.party = "i:" + id; S.bk.lines = [{...blankLine(k), account: "2200", desc: k === "payment" ? "Profit payment to investor" : "Received from investor", amount: amt > 0 ? String(r2(amt)) : ""}]; }
function newEmpPayment(id, acct, amt, desc){ newDoc("payment"); S.bk.data.party = "e:" + id; S.bk.lines = [{...blankLine("payment"), account: acct, desc, amount: amt > 0 ? String(r2(amt)) : ""}]; }
window.BOOKS = {TYPES: Object.keys(BK), post, driverNet, driverLines, applyCoa, newDriverDoc, newFromPdc, newEmpPayment, newInvestorDoc, partyName, partyOpts, partyMoves, openDoc: openDocRow};
window.BOOK_VIEWS = {
  receipts: () => docList("receipt"), payments: () => docList("payment"), salesinv: () => docList("sale_invoice"),
  purchinv: () => docList("purchase_invoice"), journals: () => docList("journal"),
  customers: () => partyView("customer"), suppliers: () => partyView("supplier"), coa: () => coaView(), statements: () => statementsView(),
};
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.nav){ S.bk = null; S.pe = null; S.pv = null; S.ce = null; return; }
  if(t.dataset.coanew){ S.ce = {code: ""}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.coaedit){ S.ce = {code: t.dataset.coaedit}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.coacancel){ S.ce = null; render(); return; }
  if(t.dataset.coaview != null){ S.coaView = t.dataset.coaview; S.ce = null; render(); window.scrollTo(0,0); return; }
  if(t.dataset.bknew){ newDoc(t.dataset.bknew); render(); window.scrollTo(0,0); return; }
  if(t.dataset.bkedit){ openDocRow(t.dataset.bkedit); render(); window.scrollTo(0,0); return; }
  if(t.dataset.bkcancel){ S.bk = null; render(); return; }
  if(t.dataset.bkadd && S.bk){ S.bk.lines.push(blankLine(S.bk.kind)); render(); return; }
  if(t.dataset.bkdel != null && S.bk){ S.bk.lines.splice(+t.dataset.bkdel, 1); if(!S.bk.lines.length) S.bk.lines.push(blankLine(S.bk.kind)); render(); return; }
  if(t.dataset.bkdelete){ if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to delete"; return; } deleteBk(); return; }
  if(t.dataset.bkpdf){ invoicePdf(t.dataset.bkpdf); return; }
  if(t.dataset.pnew){ S.pe = {kind: t.dataset.pnew, id: ""}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.pedit){ S.pe = {kind: t.dataset.pedit, id: t.dataset.id}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.pcancel){ S.pe = null; render(); return; }
  if(t.dataset.pview){ S.pv = {kind: t.dataset.pview, id: t.dataset.id}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.pback){ S.pv = null; render(); return; }
});
function onField(ev){
  const t = ev.target, b = S.bk; if(!b) return;
  if(t.dataset.hf){ b.data[t.dataset.hf] = t.value;
    if(["party","purpose","itemId"].includes(t.dataset.hf) && ev.type === "change"){ render(); return; }
    const pv = document.getElementById("bkPrev"); if(pv) pv.innerHTML = drvPreview(b); return; }
  if(t.dataset.lf != null && t.dataset.line != null){
    const l = b.lines[+t.dataset.line]; if(!l) return; l[t.dataset.lf] = t.value;
    if(t.dataset.lf === "account" && ev.type === "change"){ render(); return; }
    const tot = document.getElementById("bkTot"); if(tot) tot.innerHTML = bkTotalsHtml();
    const lt = document.getElementById("bkl_" + t.dataset.line); if(lt) lt.textContent = fmt(lineNet(b.kind, l) + lineVat(b.kind, l));
  }
}
document.addEventListener("input", onField);
document.addEventListener("change", onField);
document.addEventListener("submit", async ev => {
  const f = ev.target;
  if(f.id === "fBk"){ ev.preventDefault(); if(S.db) saveBk(); return; }
  if(f.id === "fCoa"){
    ev.preventDefault(); if(!S.db) return;
    const fd = Object.fromEntries(new FormData(f).entries()), code = f.dataset.code || fd.code;
    if(!/^[1-9][0-9]{3}$/.test(code)){ toast("The code must be 4 digits."); return; }
    if(!f.dataset.code && (allCodes().includes(code))){ toast("Account " + code + " already exists."); return; }
    if(await writeOk(S.db.doc("coa/" + code).set({name: (fd.name || "").trim(), opening: num(fd.opening)}))){ S.ce = null; toast("Account saved."); render(); }
    return;
  }
  if(f.id === "fParty"){
    ev.preventDefault(); if(!S.db) return;
    const kind = f.dataset.kind, col = kind === "customer" ? "customers" : "suppliers", id = f.dataset.id || (kind[0] + "-" + uid());
    const fd = Object.fromEntries(new FormData(f).entries()); fd.creditDays = num(fd.creditDays); fd.opening = num(fd.opening);
    const {id:_, ...prev} = S[col][id] || {};
    if(await writeOk(S.db.doc(col + "/" + id).set({...prev, ...fd}))){ S.pe = null; toast("Saved."); render(); }
  }
});
