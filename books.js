/* Books, in the Manager.io model: receipts, payments, sales invoices, customers, purchase invoices,
   suppliers and journal entries. Documents are rows in entries/{month} like the other entries, so they
   load with the period and with the history; customers and suppliers are their own collections.
   Control accounts: 1200 Accounts receivable (customers), 2000 Accounts payable (suppliers),
   2100 Driver accounts. A line on a control account carries its party: "c:<id>", "s:<id>" or "d:<id>". */
Object.assign(ACCT, {"1200":"Accounts receivable (customers)", "2000":"Accounts payable (suppliers)", "4200":"Other income"});

const BK = {
  receipt: {title:"Receipt", plural:"Receipts", view:"receipts", cash:"Received in", partyLabel:"Received from", partyTypes:"csd", cols:["account","desc","amount","vat","invoiceId"]},
  payment: {title:"Payment", plural:"Payments", view:"payments", cash:"Paid from", partyLabel:"Paid to", partyTypes:"scd", cols:["account","desc","amount","vat","invoiceId"]},
  sale_invoice: {title:"Sales invoice", plural:"Sales invoices", view:"salesinv", partyLabel:"Customer", partyTypes:"c", cols:["desc","account","qty","price","vat"], defAcct:"4100"},
  purchase_invoice: {title:"Purchase invoice", plural:"Purchase invoices", view:"purchinv", partyLabel:"Supplier", partyTypes:"s", cols:["desc","account","qty","price","vat"], defAcct:"5310"},
  journal: {title:"Journal entry", plural:"Journal entries", view:"journals", cols:["account","party","desc","dr","cr"]},
};
const CONTROL = {"1200":"c", "2000":"s", "2100":"d"};
const VAT_OPTS = {"":"No VAT", "5":"5% VAT"};
const isInv = k => k === "sale_invoice" || k === "purchase_invoice";
const lineNet = (k, l) => r2(isInv(k) ? num(l.qty === "" || l.qty == null ? 1 : l.qty) * num(l.price) : num(l.amount));
const lineVat = (k, l) => r2(lineNet(k, l) * (l.vat === "5" ? 0.05 : 0));
function docTotals(e){ const ls = e.lines || [], net = sum(ls, l => lineNet(e.type, l)), vat = sum(ls, l => lineVat(e.type, l)); return {net: r2(net), vat: r2(vat), total: r2(net + vat)}; }
function partyName(p){
  if(!p) return ""; const [t, id] = [p.slice(0,1), p.slice(2)];
  return t === "c" ? ((S.customers[id] || {}).name || "Customer") : t === "s" ? ((S.suppliers[id] || {}).name || "Supplier") : t === "d" ? dName(id) : "";
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
  return out.sort((a,b) => a.date.localeCompare(b.date));
}
const driverLines = (entries, drId) => partyMoves(entries, "d:" + drId, "2100").map(x => ({date:x.date, desc:x.desc, ...(x.dr ? {dr:x.dr} : {}), ...(x.cr ? {cr:x.cr} : {})}));
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
  if(types.includes("d")) Object.values(S.drivers).sort(byName).forEach(x => o["d:" + x.id] = "Driver · " + (x.name || x.id));
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
    if(col === "party") return `<select ${a} aria-label="Customer, supplier or driver">${opts(partyOpts("csd"), l.party || "", "—")}</select>`;
    if(col === "vat") return `<select ${a} aria-label="VAT">${opts(VAT_OPTS, l.vat || "")}</select>`;
    if(col === "invoiceId") return CONTROL[l.account] && CONTROL[l.account] !== "d" ? `<select ${a} aria-label="Invoice">${opts(unpaid, l.invoiceId || "", "Not linked")}</select>` : "";
    if(col === "desc") return `<input ${a} value="${esc(l.desc ?? "")}" aria-label="Description">`;
    return `<input ${a} type="number" step="0.01" value="${esc(l[col] ?? "")}" aria-label="${col}" style="text-align:right">`;
  };
  const heads = {account:"Account", party:"Customer / supplier / driver", desc:"Description", amount:"Amount", vat:"VAT", invoiceId:"Invoice", qty:"Qty", price:"Unit price", dr:"Debit", cr:"Credit"};
  return `<div class="section"><h2>${b.id ? "Edit" : "New"} ${esc(c.title.toLowerCase())}</h2>
  ${c.cash ? `<p class="sub">To settle an invoice, use account ${k === "receipt" ? "1200 Accounts receivable" : "2000 Accounts payable"} and pick the invoice. To pay or receive from a driver, use 2100 Driver accounts with the driver as ${esc(c.partyLabel.toLowerCase())}.</p>` : k === "journal" ? `<p class="sub">Debits must equal credits. Lines on 1200, 2000 or 2100 need the customer, supplier or driver.</p>` : ""}
  <form id="fBk"><div class="form">${head}<div class="f wide"><label for="bh_note">Notes</label>${inp("note")}</div></div>
  <div class="tbl" style="margin-top:12px"><table><thead><tr>${c.cols.map(x => `<th${["amount","qty","price","dr","cr"].includes(x) ? ' class="num"' : ""}>${heads[x]}</th>`).join("")}${isInv(k) ? '<th class="num">Total</th>' : ""}<th></th></tr></thead><tbody>
  ${b.lines.map((l, i) => `<tr>${c.cols.map(col => `<td style="min-width:${col === "desc" ? 200 : col === "account" || col === "party" ? 190 : col === "invoiceId" ? 170 : 90}px">${cell(l, i, col)}</td>`).join("")}${isInv(k) ? `<td class="num" id="bkl_${i}">${fmt(lineNet(k, l) + lineVat(k, l))}</td>` : ""}<td><button type="button" class="btn sm ghost" data-bkdel="${i}" aria-label="Remove line">✕</button></td></tr>`).join("")}
  </tbody></table></div>
  <div class="row" style="margin-top:8px;justify-content:space-between"><button type="button" class="btn sm" data-bkadd="1">Add line</button><div id="bkTot">${bkTotalsHtml()}</div></div>
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
  const keep = k === "journal" ? l => num(l.dr) || num(l.cr) : l => lineNet(k, l) || l.account || l.desc;
  const lines = b.lines.filter(keep).map(l => { const o = {...l}; Object.keys(o).forEach(x => { if(o[x] === "" || o[x] == null) delete o[x]; }); return o; });
  if(!lines.length){ toast("Add at least one line."); return; }
  if(k !== "journal" && !isInv(k) && lines.some(l => !l.account)){ toast("Choose the account on every line."); return; }
  if(isInv(k) && !d.party){ toast(`Choose the ${BK[k].partyLabel.toLowerCase()}.`); return; }
  if(k === "journal"){ const dr = sum(lines, l => num(l.dr)), cr = sum(lines, l => num(l.cr)); if(Math.abs(dr - cr) > 0.005){ toast("Debits and credits must be equal."); return; } if(lines.some(l => !l.account)){ toast("Choose the account on every line."); return; } }
  for(const l of lines){ const need = CONTROL[l.account]; if(!need || isInv(k)) continue; const p = lineParty({type:k, party:d.party}, l);
    if(!p || p[0] !== need){ toast(`Account ${l.account} needs a ${need === "c" ? "customer" : need === "s" ? "supplier" : "driver"}${k === "journal" ? " on the line" : " as " + BK[k].partyLabel.toLowerCase()}.`); return; } }
  const rec = {id: b.id || uid(), type: k, date: d.date, lines, note: d.note || "", ref: d.ref || "", by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()};
  if(BK[k].cash){ rec.paidFrom = d.paidFrom || "1100"; rec.party = d.party || ""; rec.payee = d.payee || ""; }
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
    table = list.length ? `<div class="tbl"><table><thead><tr><th>Date</th><th>Reference</th><th>${c.cash}</th><th>${c.partyLabel}</th><th>Description</th><th class="num">Amount</th><th></th></tr></thead><tbody>
    ${list.map(e => `<tr><td>${esc(dmyS(e.date))}</td><td class="small">${esc(e.ref)}</td><td>${esc(acctName(e.paidFrom || "1100"))}</td><td>${esc(partyName(e.party) || e.payee || "")}</td><td class="small" style="white-space:normal">${esc((e.lines || []).map(l => l.desc || acctName(l.account)).join(", "))}</td><td class="num">${fmt(docTotals(e).total)}</td><td><button class="btn sm" data-bkedit="${esc(e.id)}">Edit</button></td></tr>`).join("")}
    </tbody><tfoot><tr><td colspan="5">${list.length} ${c.plural.toLowerCase()}</td><td class="num">${fmt(sum(list, e => docTotals(e).total))}</td><td></td></tr></tfoot></table></div>` : `<div class="empty"><b>No ${c.plural.toLowerCase()} in this period</b>Click “New ${c.title.toLowerCase()}” to add one.</div>`;
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
  return `<div class="section"><div class="head"><div><h2>${esc(x.name)} · statement</h2><p class="sub">${esc(dmyS(S.from))} to ${esc(dmyS(S.to))}${x.trn ? " · TRN " + esc(x.trn) : ""}</p></div><div class="row"><button class="btn ghost" data-pback="1">← All ${kind}s</button><button class="btn" data-pedit="${kind}" data-id="${esc(id)}">Edit</button></div></div>
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
  try{ await html2pdf().set({margin: 0, filename: name, image: {type: "jpeg", quality: 0.96}, html2canvas: {scale: 2, backgroundColor: "#ffffff"}, jsPDF: {unit: "mm", format: "a4", orientation: "portrait"}}).from(box.firstChild).save(); toast("Downloaded " + name); }
  catch(err){ toast("Could not make the PDF. Try again."); }
  box.remove();
}

/* ---------- wiring ---------- */
window.BOOKS = {TYPES: Object.keys(BK), post, driverNet, driverLines};
window.BOOK_VIEWS = {
  receipts: () => docList("receipt"), payments: () => docList("payment"), salesinv: () => docList("sale_invoice"),
  purchinv: () => docList("purchase_invoice"), journals: () => docList("journal"),
  customers: () => partyView("customer"), suppliers: () => partyView("supplier"),
};
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.nav){ S.bk = null; S.pe = null; S.pv = null; return; }
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
  if(t.dataset.hf){ b.data[t.dataset.hf] = t.value; if(t.dataset.hf === "party" && ev.type === "change") render(); return; }
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
  if(f.id === "fParty"){
    ev.preventDefault(); if(!S.db) return;
    const kind = f.dataset.kind, col = kind === "customer" ? "customers" : "suppliers", id = f.dataset.id || (kind[0] + "-" + uid());
    const fd = Object.fromEntries(new FormData(f).entries()); fd.creditDays = num(fd.creditDays); fd.opening = num(fd.opening);
    const {id:_, ...prev} = S[col][id] || {};
    if(await writeOk(S.db.doc(col + "/" + id).set({...prev, ...fd}))){ S.pe = null; toast("Saved."); render(); }
  }
});
