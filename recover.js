/* Expense recovery – who bears which expenses: the driver (deducted in his salary) or the company.
   Expenses are grouped (Fuel, EV charging, Salik, Fines, Repairs, Parking & wash, Other). For each group:
   - a rule for new entries (imports of fuel / Salik / EV, new fines): "Recover from the driver", "Company cost", or
     "As entered" (the import's own choice);
   - what the period holds: entries with a driver that are recovered from him / company cost, and buttons that turn all
     of them one way or the other (for every driver, or only the driver whose salary is open).
   Each entry keeps its own "Recover from driver?" – the rule and the buttons only set it, so the books, the car's P&L
   and the salary stay in step. */
const REC_GROUPS = {fuel: "Fuel (ENOC)", ev: "EV charging", salik: "Salik / tolls", fines: "Traffic & RTA fines", repairs: "Repairs & maintenance", parking: "Parking & car wash", other: "Other expenses"};
const recKey = e => { const sub = e.sub || (e.category === "5210" ? "salik" : ""); if(["fuel", "ev", "salik"].includes(sub)) return sub;
  const c = String(e.category || ""); return c === "5200" ? "fuel" : c === "5210" ? "salik" : c === "5220" || c === "5225" || e.fineId ? "fines" : c === "5230" ? "repairs" : c === "5270" ? "parking" : "other"; };
const recRules = () => setting("recoverRules", {}) || {};
// the default "recover from driver" for a new entry of a group (fallback: what the import would have done)
const recDef = (group, fallback) => { const r = recRules()[group]; return r === "driver" ? true : r === "company" ? false : !!fallback; };
S.recOpen = S.recOpen || false;

function recPanel(drv){
  const E = (S.entries || []).filter(e => e.type === "expense" && e.driverId && (!drv || e.driverId === drv)), R = recRules();
  const by = {}; Object.keys(REC_GROUPS).forEach(k => by[k] = {rn: 0, ra: 0, cn: 0, ca: 0});
  E.forEach(e => { const b = by[recKey(e)], a = num(e.amount) + num(e.vat); if(e.recover){ b.rn++; b.ra += a; } else { b.cn++; b.ca += a; } });
  const who = drv ? esc(dName(drv)) : "all drivers";
  return `<div class="section" style="border:1px solid var(--line)"><div class="head"><div><h3 style="margin:0">Expense recovery – who bears which expenses</h3><p class="sub">An expense <b>recovered from the driver</b> is deducted in his salary (Direct expenditure); a <b>company cost</b> is not. The rule sets new entries (fuel / Salik / EV imports, new fines); the buttons change the entries already in ${esc(dmyS(S.from))} – ${esc(dmyS(S.to))} for ${who}. Each entry can still be changed on its own (Edit → Recover from driver?).</p></div>
    <button class="btn ghost" data-recopen="0">Close</button></div>
    <div class="tbl"><table><thead><tr><th>Expense</th><th class="num">Recovered from driver</th><th class="num">Company cost</th><th>Rule for new entries</th><th>Entries of this period (${who})</th></tr></thead><tbody>
    ${Object.entries(REC_GROUPS).map(([k, l]) => { const b = by[k];
      return `<tr><td><b>${l}</b></td><td class="num">${b.rn ? `${fmt(b.ra)} <span class="small muted">(${b.rn})</span>` : "—"}</td><td class="num">${b.cn ? `${fmt(b.ca)} <span class="small muted">(${b.cn})</span>` : "—"}</td>
        <td><select data-recrule="${k}" aria-label="Rule for ${l}" ${S.canWrite ? "" : "disabled"}>${opts({"": "As entered", driver: "Recover from the driver", company: "Company cost"}, R[k] || "")}</select></td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap">${S.canWrite ? `<button class="btn sm" data-recset="${k}|driver|${esc(drv || "")}" ${b.cn ? "" : "disabled"}>All → recover from driver</button><button class="btn sm" data-recset="${k}|company|${esc(drv || "")}" ${b.rn ? "" : "disabled"}>All → company cost</button>` : ""}</div></td></tr>`; }).join("")}
    </tbody></table></div></div>`;
}
const recBtn = drv => `<button class="btn sm ghost" data-recopen="1"${drv ? ` data-recdrv="${esc(drv)}"` : ""}>Who bears which expenses</button>`;

async function recSet(group, val, drv){
  if(!window.PUR || !PUR.fix) return 0; const want = val === "driver";
  const n = await PUR.fix(e => (e.date >= S.from && e.date <= S.to && e.driverId && (!drv || e.driverId === drv) && recKey(e) === group && !!e.recover !== want) ? {recover: want} : null);
  // the fine records themselves (their accrual is booked to the driver or the company)
  if(group === "fines") for(const f of Object.values(S.fines || {})){ if(!f.date || f.date < S.from || f.date > S.to || !f.driverId || (drv && f.driverId !== drv) || !!f.recover === want) continue;
    const {id, ...body} = f; await writeOk(S.db.doc("fines/" + id).set({...body, recover: want})); }
  return n;
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest && ev.target.closest("button"); if(!t) return;
  if(t.dataset.recopen != null){ S.recOpen = t.dataset.recopen === "1" ? (t.dataset.recdrv || "all") : false; render(); return; }
  if(t.dataset.recset){ const [g, v, drv] = t.dataset.recset.split("|");
    if(t.dataset.confirm !== "1"){ t.dataset.confirm = "1"; t.textContent = "Click again to change"; return; }
    t.disabled = true; t.textContent = "Saving…"; const n = await recSet(g, v, drv); toast(`${n} ${REC_GROUPS[g].toLowerCase()} entr${n === 1 ? "y" : "ies"} now ${v === "driver" ? "recovered from the driver" : "company cost"}.`); render(); return; }
});
document.addEventListener("change", async ev => { const t = ev.target; if(!t.dataset || !t.dataset.recrule) return;
  const R = {...recRules()}; if(t.value) R[t.dataset.recrule] = t.value; else delete R[t.dataset.recrule];
  if(await writeOk(S.db.doc("settings/main").set({...S.settings, recoverRules: R}))) toast("Rule saved – new " + REC_GROUPS[t.dataset.recrule].toLowerCase() + " entries: " + (t.value === "driver" ? "recovered from the driver" : t.value === "company" ? "company cost" : "as entered") + "."); });

window.RECOV = {panel: recPanel, btn: recBtn, def: recDef, key: recKey, groups: REC_GROUPS};
