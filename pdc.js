/* Post-dated cheques (PDC). Received cheques (from customers, drivers or others) and issued cheques
   (to suppliers, landlords…) are kept here with their cheque date. Until that date a PDC is only a
   memo – nothing is posted. When the date arrives it shows as a banner on every page (and as a browser
   notification if switched on); "Record receipt" / "Record payment" opens the receipt or payment form
   filled in from the cheque, and saving it marks the PDC as cleared with a link to that document.
   Bounced and cancelled cheques are only marked. Stored in the "pdcs" collection. */
const PDC_STATUS = {pending:"Pending", cleared:"Cleared", bounced:"Bounced", cancelled:"Cancelled"};
const PDC_DIR = {in:"Received (from customer / driver)", out:"Issued (to supplier / others)"};
const pdcList = () => Object.values(S.pdcs || {});
const todayIso = () => iso(new Date());
const pdcDue = () => pdcList().filter(p => p.status === "pending" && p.date <= todayIso());
const pdcWho = p => (p.party && window.BOOKS ? BOOKS.partyName(p.party) : "") || p.payee || "—";
S.pdcs = S.pdcs || {}; S.pdcEdit = null; S.pdcFilter = S.pdcFilter || {status:"pending", dir:""};

function pdcBanner(){
  const due = pdcDue(); if(!due.length) return "";
  pdcNotify(due);
  if(S.view === "pdc") return "";
  const inn = due.filter(p => p.dir === "in"), out = due.filter(p => p.dir === "out");
  return `<div class="banner"><b>${due.length} post-dated cheque${due.length > 1 ? "s" : ""} due.</b> ${inn.length ? `To deposit: ${inn.length} (AED ${fmt(sum(inn, p => num(p.amount)))}). ` : ""}${out.length ? `To be paid from the bank: ${out.length} (AED ${fmt(sum(out, p => num(p.amount)))}). ` : ""}<button class="btn sm" data-nav="pdc">Open PDCs</button></div>`;
}
function pdcNotify(due){
  try{
    if(!("Notification" in window) || Notification.permission !== "granted") return;
    const key = "pdcNotified-" + todayIso(); if(localStorage.getItem(key)) return; localStorage.setItem(key, "1");
    new Notification("Post-dated cheques due", {body: due.slice(0, 5).map(p => `${p.dir === "in" ? "Deposit" : "Pay"} ${p.chequeNo || ""} · ${pdcWho(p)} · AED ${fmt(num(p.amount))}`).join("\n")});
  }catch(e){}
}

function vPdc(){
  const f = S.pdcFilter, t = todayIso(), wk = addDays(t, 7);
  const all = pdcList(), list = all.filter(p => (!f.status || p.status === f.status) && (!f.dir || p.dir === f.dir)).sort((a,b) => a.date.localeCompare(b.date));
  const pend = all.filter(p => p.status === "pending"), pin = pend.filter(p => p.dir === "in"), pout = pend.filter(p => p.dir === "out");
  const kpi = (l, v, n) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${n ? `<div class="n">${n}</div>` : ""}</div>`;
  const when = p => { if(p.status !== "pending") return ""; const d = Math.round((parseD(p.date) - parseD(t)) / 86400000);
    return d < 0 ? `<span class="pill bad">${-d} day${d === -1 ? "" : "s"} overdue</span>` : d === 0 ? '<span class="pill bad">Due today</span>' : d <= 7 ? `<span class="pill warn">In ${d} day${d === 1 ? "" : "s"}</span>` : `<span class="small muted">In ${d} days</span>`; };
  const notif = !("Notification" in window) ? "" : Notification.permission === "granted" ? '<span class="small muted">Browser notifications are on.</span>' : Notification.permission === "denied" ? '<span class="small muted">Browser notifications are blocked in this browser.</span>' : '<button class="btn sm" data-pdcnotif="1">Turn on browser notifications</button>';
  return `${S.pdcEdit ? pdcForm(S.pdcEdit.id) : ""}
  <div class="kpis">${kpi("PDCs received, pending", fmt(sum(pin, p => num(p.amount))), `${pin.length} cheque(s)`)}${kpi("PDCs issued, pending", fmt(sum(pout, p => num(p.amount))), `${pout.length} cheque(s)`)}
    ${kpi("Due now", pdcDue().length, "cheque date reached")}${kpi("Next 7 days", pend.filter(p => p.date > t && p.date <= wk).length, `AED ${fmt(sum(pend.filter(p => p.date > t && p.date <= wk), p => num(p.amount)))}`)}</div>
  <div class="section"><div class="head"><div><h2>Post-dated cheques</h2><p class="sub">A PDC is only a memo until its date. When the date arrives, record it as a receipt (cheque deposited) or a payment (cheque cleared from the bank); the PDC is then marked cleared.</p></div>
    <div class="row">${notif}<select id="pdcFs" aria-label="Status">${opts(PDC_STATUS, f.status, "All statuses")}</select><select id="pdcFd" aria-label="Direction">${opts({in:"Received", out:"Issued"}, f.dir, "Received & issued")}</select><button class="btn primary" data-pdcnew="1">Add PDC</button></div></div>
  ${list.length ? `<div class="tbl"><table><thead><tr><th>Cheque date</th><th></th><th>Type</th><th>Cheque no.</th><th>Bank</th><th>From / to</th><th class="num">Amount</th><th>Bank account</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(p => `<tr><td>${esc(dmyS(p.date))}</td><td>${when(p)}</td><td>${p.dir === "in" ? "Received" : "Issued"}</td><td class="mono">${esc(p.chequeNo)}</td><td>${esc(p.bank)}</td><td>${esc(pdcWho(p))}</td><td class="num">${fmt(num(p.amount))}</td><td class="small">${esc(acctName(p.account || "1100"))}</td>
    <td><span class="pill ${p.status === "cleared" ? "good" : p.status === "bounced" ? "bad" : p.status === "cancelled" ? "" : "warn"}">${esc(PDC_STATUS[p.status] || p.status)}</span>${p.status === "cleared" && p.clearedOn ? `<div class="small muted">${esc(dmyS(p.clearedOn))}</div>` : ""}</td>
    <td class="row">${p.status === "pending" ? `<button class="btn sm ${p.date <= t ? "primary" : ""}" data-pdcrec="${esc(p.id)}">${p.dir === "in" ? "Record receipt" : "Record payment"}</button><button class="btn sm" data-pdcstat="bounced" data-id="${esc(p.id)}">Bounced</button>` : p.status === "bounced" ? `<button class="btn sm" data-pdcstat="pending" data-id="${esc(p.id)}">Re-presented</button>` : ""}<button class="btn sm ghost" data-pdcedit="${esc(p.id)}">Edit</button></td></tr>`).join("")}
  </tbody><tfoot><tr><td colspan="6">${list.length} cheque(s)</td><td class="num">${fmt(sum(list, p => num(p.amount)))}</td><td colspan="3"></td></tr></tfoot></table></div>` : `<div class="empty"><b>No cheques here</b>Add the post-dated cheques you have received or issued, or change the filter.</div>`}</div>`;
}
function pdcForm(id){
  const p = S.pdcs[id] || {dir: "in", status: "pending", account: "1100", date: todayIso(), ...(S.pdcPreset || {})};   // preset: e.g. a cheque to RTA
  return `<div class="section"><h2>${id ? "Edit cheque " + esc(p.chequeNo || "") : "Add post-dated cheque"}</h2>
  <form class="form" id="fPdc" data-id="${esc(id || "")}">
    <div class="f"><label for="pd_dir">Type</label><select id="pd_dir" name="dir">${opts(PDC_DIR, p.dir)}</select></div>
    <div class="f"><label for="pd_date">Cheque date</label><input id="pd_date" name="date" type="date" required value="${esc(p.date)}"></div>
    <div class="f"><label for="pd_no">Cheque no.</label><input id="pd_no" name="chequeNo" required value="${esc(p.chequeNo)}"></div>
    <div class="f"><label for="pd_bank">Bank (of the cheque)</label><input id="pd_bank" name="bank" value="${esc(p.bank)}" placeholder="e.g. Emirates NBD"></div>
    <div class="f"><label for="pd_amt">Amount (AED)</label><input id="pd_amt" name="amount" type="number" step="0.01" required value="${esc(p.amount ?? "")}"></div>
    <div class="f"><label for="pd_party">Customer / supplier / driver</label><select id="pd_party" name="party">${opts(window.BOOKS ? BOOKS.partyOpts("csd") : {}, p.party || "", "— other —")}</select></div>
    <div class="f"><label for="pd_payee">or name</label><input id="pd_payee" name="payee" value="${esc(p.payee)}"></div>
    <div class="f"><label for="pd_acct">Deposit to / pay from</label><select id="pd_acct" name="account">${opts(acctOpts(["bank"]), p.account || "1100")}</select></div>
    <div class="f"><label for="pd_st">Status</label><select id="pd_st" name="status">${opts(PDC_STATUS, p.status)}</select></div>
    <div class="f wide"><label for="pd_note">What it is for</label><input id="pd_note" name="note" value="${esc(p.note)}" placeholder="e.g. rent Q4, invoice INV-0004, loan instalment"></div>
    <div class="row wide"><button class="btn primary" type="submit" ${S.canWrite ? "" : "disabled"}>Save</button><button class="btn ghost" type="button" data-pdccancel="1">Cancel</button>${id ? `<button class="btn danger" type="button" data-del="pdcs" data-id="${esc(id)}">Delete</button>` : ""}</div>
  </form></div>`;
}
// called by books.js after the receipt / payment made from a PDC is saved
async function pdcCleared(pdcId, docId, date){
  const p = S.pdcs[pdcId]; if(!p) return; const {id:_, ...b} = p;
  await writeOk(S.db.doc("pdcs/" + pdcId).set({...b, status: "cleared", clearedOn: date, docId: docId || ""}));
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button"); if(!t) return;
  if(t.dataset.nav){ S.pdcEdit = null; return; }
  if(t.dataset.pdcnew){ S.pdcEdit = {id: ""}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.pdcedit){ S.pdcEdit = {id: t.dataset.pdcedit}; render(); window.scrollTo(0,0); return; }
  if(t.dataset.pdccancel){ S.pdcEdit = null; render(); return; }
  if(t.dataset.pdcnotif){ try{ await Notification.requestPermission(); }catch(e){} render(); return; }
  if(t.dataset.pdcstat){ const p = S.pdcs[t.dataset.id]; if(!p) return; const {id:_, ...b} = p;
    if(await writeOk(S.db.doc("pdcs/" + p.id).set({...b, status: t.dataset.pdcstat, ...(t.dataset.pdcstat === "bounced" ? {bouncedOn: todayIso()} : {})}))) toast(t.dataset.pdcstat === "bounced" ? "Marked as bounced." : "Back to pending."); return; }
  if(t.dataset.pdcrec){ const p = S.pdcs[t.dataset.pdcrec]; if(!p || !window.BOOKS) return; S.view = p.dir === "in" ? "receipts" : "payments"; BOOKS.newFromPdc(p); render(); window.scrollTo(0,0); return; }
});
document.addEventListener("change", ev => {
  const t = ev.target;
  if(t.id === "pdcFs"){ S.pdcFilter.status = t.value; render(); }
  if(t.id === "pdcFd"){ S.pdcFilter.dir = t.value; render(); }
});
document.addEventListener("submit", async ev => {
  const f = ev.target; if(f.id !== "fPdc") return; ev.preventDefault(); if(!S.db) return;
  const fd = Object.fromEntries(new FormData(f).entries()), id = f.dataset.id || ("q-" + uid()), {id:_, ...prev} = S.pdcs[id] || {};
  fd.amount = num(fd.amount);
  if(!fd.party && !fd.payee){ toast("Choose who the cheque is from / to, or type a name."); return; }
  if(await writeOk(S.db.doc("pdcs/" + id).set({...prev, ...fd, by: (S.user && (S.user.name || S.user.id)) || "", at: new Date().toISOString()}))){ S.pdcEdit = null; S.pdcPreset = null; toast("Cheque saved."); render(); }
});
window.PDC = {banner: pdcBanner, cleared: pdcCleared};
window.BOOK_VIEWS = {...(window.BOOK_VIEWS || {}), pdc: vPdc};
