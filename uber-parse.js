/* Reading Uber Fleet Hub reports. Shared by the Fleet Ledger page and the Uber Sync program.
   Two reports are understood:
   - Payments Transaction ("payments_order"): one row per money movement – trip earnings,
     adjustments, cash collected and payouts to the bank. Rows are keyed by transaction UUID,
     so a trip with several rows (adjustment, late tip) keeps all of them.
   - Trip activity ("trip_activity"): one row per trip with the number plate, distance, status,
     product and payment type. It is joined to the payments by Trip UUID, which gives the car. */
(function (root) {
  const num = v => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const low = x => String(x).toLowerCase().replace(/\s*:\s*/g, ":").replace(/^﻿/, "").trim();

  function parseTripDate(v) {
    const s = String(v || "").trim(); if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5]}` : "" };
    m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
    if (m) { let d = +m[1], mo = +m[2]; if (mo > 12) [d, mo] = [mo, d]; return { date: `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, time: m[4] ? `${m[4].padStart(2, "0")}:${m[5]}` : "" }; }
    const d = new Date(s); if (!isNaN(d)) return { date: iso(d), time: d.toTimeString().slice(0, 5) };
    return null;
  }

  // which report is this?
  function detect(headers) {
    const L = headers.map(low);
    if (L.some(x => /number plate|plate/.test(x)) && L.some(x => /trip status/.test(x)) && !L.some(x => /paid to you|fare|service fee/.test(x))) return "activity";
    return "payments";
  }

  const FIELDS = [
    ["txId", "Transaction ID (one row per money movement)", false], ["tripId", "Trip ID", false], ["date", "Date / time", false],
    ["driverUuid", "Driver UUID", false], ["driverFirst", "Driver first name", false], ["driverLast", "Driver surname", false], ["driverName", "Driver full name", false], ["plate", "Vehicle plate", false],
    ["fare", "Fare (if there is a fare total, only that column)", true], ["fee", "Uber service fee", true], ["tax", "VAT / taxes charged by Uber", true], ["tip", "Tip", true],
    ["refund", "Refunds & expenses (tolls, airport, surcharges)", true], ["cash", "Cash collected", true], ["other", "Other earnings / incentives", true],
    ["payout", "Payouts transferred to the bank", true], ["km", "Distance (km)", true],
  ];

  function guessMap(h) {
    const L = h.map(low);
    const one = re => { const i = L.findIndex(x => re.test(x)); return i < 0 ? [] : [h[i]]; };
    const many = (re, not) => h.filter((x, i) => re.test(L[i]) && !(not && not.test(L[i])));
    const fareTotal = one(/^paid to you:your earnings:fare$/);
    const taxParts = many(/tax|vat/, /fare|refund|expense|^paid to you:your earnings:taxes$/);
    const refunds = many(/trip balance:(refunds|expenses)/);
    const dateCols = one(/^(trip request time|request time|trip date|date|vs reporting|reporting time|transaction time|local time|trip time|time)$/)
      .concat(one(/date|time|reporting/)).filter((x, i, a) => a.indexOf(x) === i && !/fare|wait|earning|paid|amount|fee|tip|drop/i.test(x)).slice(0, 1);
    return {
      txId: one(/^transaction uuid$|^transaction id$/), tripId: one(/^trip uuid$/).length ? one(/^trip uuid$/) : one(/trip.*(uuid|id)|^uuid$/),
      date: dateCols, driverUuid: one(/driver.*uuid/), driverFirst: one(/first ?name/), driverLast: one(/surname|last ?name/),
      driverName: one(/^(driver ?(full ?)?name|driver)$/), plate: one(/number plate|plate|licen[cs]e plate/),
      fare: fareTotal.length ? fareTotal : many(/fare|surge|wait time|time at stop|cancell|premium|reservation/, /service|tax|vat|refund|payout|expense/),
      fee: many(/service fee|commission|uber fee/, /tax|vat/),
      tax: taxParts.length ? taxParts : one(/^paid to you:your earnings:taxes$/),
      tip: many(/\btip\b|:tip$/),
      refund: refunds.length ? refunds : many(/refund|toll|airport|surcharge/, /payout|cash|tax/),
      cash: many(/cash collected|\bcash\b/, /transferred|bank/),
      other: many(/other earnings|incentive|promotion|bonus|quest|referral/),
      payout: many(/transferred to bank|transferred to bank account|payouts:transferred|instant pay|cash ?out to/),
      km: many(/distance|\bkm\b/),
    };
  }

  // Payments Transaction rows → money rows
  function paymentRows(rows, map) {
    const g = (r, k) => (map[k] || []).map(c => r[c]).find(v => v != null && String(v).trim() !== "");
    // Fees, VAT, cash and payouts come out negative in Uber's report, and an occasional row
    // reverses them (positive). Each column keeps its own signs; a column whose total is
    // negative is flipped so the field reads as a positive deduction.
    const flip = {};
    Object.values(map).flat().forEach(c => { if (!(c in flip)) flip[c] = rows.reduce((a, r) => a + num(r[c]), 0) < 0 ? -1 : 1; });
    const s = (r, k, deduction) => (map[k] || []).reduce((a, c) => a + num(r[c]) * (deduction ? flip[c] : 1), 0);
    const out = [];
    rows.forEach((r, i) => {
      const f = s(r, "fare"), sf = s(r, "fee", true), tx = s(r, "tax", true), tp = s(r, "tip"), rf = s(r, "refund"), c = s(r, "cash", true),
        oe = s(r, "other"), po = s(r, "payout", true), km = s(r, "km");
      if (!f && !sf && !tx && !tp && !rf && !c && !oe && !po) return;
      const dt = parseTripDate(g(r, "date"));
      const name = (g(r, "driverName") || [g(r, "driverFirst"), g(r, "driverLast")].filter(Boolean).join(" ") || "").trim();
      const tr = String(g(r, "tripId") || "");
      let id = g(r, "txId") || tr; if (!id) id = "row-" + norm(JSON.stringify(r)).slice(0, 40) + "-" + i;
      out.push({ id: String(id), tr, d: dt ? dt.date : "", t: dt ? dt.time : "", uuid: g(r, "driverUuid") || "", name, p: g(r, "plate") || "",
        f: r2(f), sf: r2(sf), tx: r2(tx), tp: r2(tp), rf: r2(rf), c: r2(c), oe: r2(oe), po: r2(po), km: r2(km) });
    });
    return out;
  }

  // Trip activity rows → trip details (plate, distance, status…)
  function activityRows(rows, headers) {
    const L = headers.map(low), col = re => { const i = L.findIndex(x => re.test(x)); return i < 0 ? null : headers[i]; };
    const C = { tr: col(/^trip uuid$|trip.*uuid/), uuid: col(/driver uuid/), first: col(/first ?name/), last: col(/surname|last ?name/), vu: col(/vehicle uuid/),
      p: col(/number plate|plate/), req: col(/request time/), drop: col(/drop-?off time/), km: col(/distance/), st: col(/trip status|status/), prod: col(/product type/), pay: col(/payment type/) };
    const out = [];
    rows.forEach(r => {
      const tr = C.tr && r[C.tr]; if (!tr) return;
      const dt = parseTripDate(C.req && r[C.req]); if (!dt) return;
      out.push({ tr: String(tr), d: dt.date, t: dt.time, uuid: (C.uuid && r[C.uuid]) || "", name: [C.first && r[C.first], C.last && r[C.last]].filter(Boolean).join(" ").trim(),
        vu: (C.vu && r[C.vu]) || "", p: (C.p && r[C.p]) || "", km: r2(num(C.km && r[C.km])), st: (C.st && r[C.st]) || "", prod: (C.prod && r[C.prod]) || "", pay: (C.pay && r[C.pay]) || "" });
    });
    return out;
  }

  // the report's own "Paid to you" total, to check an import against
  function paidToYou(rows, headers) {
    const c = headers.find(x => low(x) === "paid to you"); if (!c) return null;
    return r2(rows.reduce((a, r) => a + num(r[c]), 0));
  }
  // what our rows add up to (same formula as the Uber clearing account in the ledger)
  const balanceOf = rows => r2(rows.reduce((a, t) => a + t.f + t.tp + t.rf + t.oe - t.sf - t.tx - t.c - t.po, 0));

  const API = { num, r2, norm, parseTripDate, detect, FIELDS, guessMap, paymentRows, activityRows, paidToYou, balanceOf };
  root.UberParse = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
