// Royal Rides – Uber Sync
//
//   npm run login            open the Uber window once and sign in (the login is remembered)
//   npm run sync             download the Payments Transaction report and save the trips
//   npm run sync -- --file X import a CSV you already have
//   npm run sync -- --days 3 how many past days to fetch (default: from SYNC_DAYS, else 2)
//
// The Uber window uses its own Chrome profile in ./profile, so the sign-in stays there between runs.
// Trips go to the Fair Tax portal's Firestore (apps/fleet/store/rr), the same place the
// Fleet Ledger page reads. Trips already saved are skipped by Trip ID.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { chromium } from 'playwright-core';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const ENV = process.env;
const UBER_URL = ENV.UBER_URL || 'https://supplier.uber.com/';
const OUT_DIR = ENV.DOWNLOAD_DIR || 'D:\\Client\\Royal limousine\\Uber trips';
const PROFILE = path.join(here, 'profile');
const DAYS = +(arg('--days') || ENV.SYNC_DAYS || 2);
const log = (...a) => console.log(new Date().toLocaleTimeString(), '·', ...a);

// ---------------------------------------------------------------- Fair Tax portal (Firebase)
const FIREBASE = {
  apiKey: 'AIzaSyCi99HrNPxzxTm7G_plNo0Phn2XQnXyNWk', authDomain: 'fair-tax-audit-desk.firebaseapp.com', projectId: 'fair-tax-audit-desk',
  storageBucket: 'fair-tax-audit-desk.firebasestorage.app', messagingSenderId: '160519324912', appId: '1:160519324912:web:717c64ae8e45c4e6efee35',
};
let db = null;
async function portal() {
  if (db) return db;
  if (!ENV.PORTAL_USER || !ENV.PORTAL_PASSWORD) throw new Error('Add PORTAL_USER and PORTAL_PASSWORD to uber-sync/.env (a portal user with Fleet access).');
  const app = initializeApp(FIREBASE);
  const id = ENV.PORTAL_USER.trim().toLowerCase();
  const email = id.includes('@') ? id : id.replace(/[^a-z0-9._-]/g, '') + '@users.fairtax-portal.app';
  await signInWithEmailAndPassword(getAuth(app), email, ENV.PORTAL_PASSWORD);
  db = getFirestore(app);
  return db;
}
const ref = (...p) => doc(db, 'apps', 'fleet', 'store', 'rr', ...p);
const col = name => collection(db, 'apps', 'fleet', 'store', 'rr', name);

// ---------------------------------------------------------------- CSV → trips (same rules as the Import page)
const num = v => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
function parseTripDate(v) {
  const s = String(v || '').trim(); if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}):?(\d{2})?/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] ? `${m[4]}:${m[5] || '00'}` : '' };
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
  if (m) { let d = +m[1], mo = +m[2]; if (mo > 12) [d, mo] = [mo, d]; return { date: `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`, time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}` : '' }; }
  const d = new Date(s); if (!isNaN(d)) return { date: iso(d), time: d.toTimeString().slice(0, 5) };
  return null;
}
function guessMap(h) {
  const L = h.map(x => x.toLowerCase());
  const one = re => { const i = L.findIndex(x => re.test(x)); return i < 0 ? [] : [h[i]]; };
  const many = (re, not) => h.filter((x, i) => re.test(L[i]) && !(not && not.test(L[i])));
  const total = /^(total|paid to you)$|^paid to you\s*:\s*your earnings$|^paid to you\s*:\s*trip balance$/;
  return {
    tripId: one(/trip.*(uuid|id)|^uuid$/), date: one(/^(trip request time|request time|trip date|date|vs reporting|reporting time|transaction time|local time|trip time|time)$/).concat(one(/date|time|reporting/)).filter((x,i,a)=>a.indexOf(x)===i && !/fare|wait|earning|paid|amount|fee|tip/i.test(x)).slice(0,1), driverUuid: one(/driver.*uuid/),
    driverFirst: one(/first ?name/), driverLast: one(/surname|last ?name/), driverName: one(/^(driver ?(full ?)?name|driver)$/), plate: one(/plate|licen[cs]e/),
    fare: many(/fare|surge|wait time|time at stop|cancell|premium/, /service|tax|vat|adjust|refund|payout/).filter(x => !total.test(x.toLowerCase())),
    fee: many(/service fee|commission|uber fee/, /tax|vat/), tax: many(/tax|vat/, /fare|refund/), tip: many(/\btip/),
    refund: many(/refund|toll|airport|expense/, /payout|cash/), cash: many(/cash/), km: many(/distance|km/),
  };
}
function toTrips(rows, map) {
  const g = (r, k) => (map[k] || []).map(c => r[c]).find(v => v != null && String(v).trim() !== '');
  const s = (r, k, abs) => (map[k] || []).reduce((a, c) => a + (abs ? Math.abs(num(r[c])) : num(r[c])), 0);
  const out = [];
  rows.forEach((r, i) => {
    const f = s(r, 'fare'), sf = s(r, 'fee', true), tx = s(r, 'tax', true), tp = s(r, 'tip'), rf = s(r, 'refund'), c = s(r, 'cash', true), km = s(r, 'km');
    if (!f && !sf && !tp && !rf && !c) return;
    const dt = parseTripDate(g(r, 'date')); if (!dt) return;
    const name = (g(r, 'driverName') || [g(r, 'driverFirst'), g(r, 'driverLast')].filter(Boolean).join(' ') || '').trim();
    let id = g(r, 'tripId'); if (!id) id = 'row-' + norm(JSON.stringify(r)).slice(0, 40) + '-' + i;
    out.push({ id: String(id), d: dt.date, t: dt.time, uuid: g(r, 'driverUuid') || '', name, p: g(r, 'plate') || '', f: r2(f), sf: r2(sf), tx: r2(tx), tp: r2(tp), rf: r2(rf), c: r2(c), km: r2(km) });
  });
  return out;
}

async function importCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  const headers = parsed.meta.fields || [];
  if (!headers.length) throw new Error(`${path.basename(file)} has no header row.`);
  await portal();
  const setSnap = await getDoc(ref('settings', 'main'));
  const settings = setSnap.exists() ? setSnap.data() : {};
  const sig = norm(headers.join('|')).slice(0, 180);
  const map = (settings.mappings || {})[sig] || guessMap(headers);
  const rows = toTrips(parsed.data, map);
  if (!rows.length) { log(`${path.basename(file)}: no trips found (check the column mapping on the Import page once).`); return { added: 0, dup: 0 }; }

  // drivers and cars: match existing ones, create the new ones (flagged "created from import")
  const drivers = {}, vehicles = {};
  (await getDocs(col('drivers'))).forEach(d => drivers[d.id] = d.data());
  (await getDocs(col('vehicles'))).forEach(d => vehicles[d.id] = d.data());
  const byUuid = {}, byName = {}, plates = {};
  Object.entries(drivers).forEach(([id, d]) => { if (d.uberUuid) byUuid[d.uberUuid] = id; byName[norm(d.name)] = id; });
  Object.entries(vehicles).forEach(([id, v]) => plates[norm(v.plate)] = id);
  for (const t of rows) {
    let id = (t.uuid && byUuid[t.uuid]) || (t.name && byName[norm(t.name)]);
    if (!id) {
      id = 'd-' + (norm(t.uuid).slice(0, 12) || norm(t.name).slice(0, 20) || Math.random().toString(36).slice(2, 10));
      byUuid[t.uuid] = id; byName[norm(t.name)] = id;
      await setDoc(ref('drivers', id), { name: t.name || 'Unnamed driver', uberUuid: t.uuid || '', payModel: '', commissionPct: 0, active: true, createdFromImport: true });
      log('new driver:', t.name || id);
    } else if (t.uuid && drivers[id] && !drivers[id].uberUuid) {
      drivers[id].uberUuid = t.uuid; await setDoc(ref('drivers', id), drivers[id]);
    }
    t.dr = id;
    if (t.p && !plates[norm(t.p)]) {
      const vid = 'v-' + norm(t.p).slice(0, 20); plates[norm(t.p)] = vid;
      await setDoc(ref('vehicles', vid), { plate: t.p, fleetId: '', model: '', investorId: '', active: true, createdFromImport: true });
      log('new car:', t.p);
    }
  }
  // one document per day, skipping trips already saved
  const byDay = {}; rows.forEach(t => (byDay[t.d] ||= []).push(t));
  let added = 0, dup = 0;
  for (const [day, list] of Object.entries(byDay)) {
    const snap = await getDoc(ref('trips', day)); const existing = snap.exists() ? (snap.data().rows || {}) : {};
    const merged = { ...existing };
    for (const t of list) { if (existing[t.id]) { dup++; continue; } merged[t.id] = { d: t.d, t: t.t, dr: t.dr, p: t.p, f: t.f, sf: t.sf, tx: t.tx, tp: t.tp, rf: t.rf, c: t.c, km: t.km }; added++; }
    await setDoc(ref('trips', day), { date: day, rows: merged });
  }
  const days = Object.keys(byDay).sort();
  const entry = { at: new Date().toLocaleString('en-GB'), files: 'Uber Sync: ' + path.basename(file).slice(0, 100), added, dup, range: `${days[0]} → ${days[days.length - 1]}` };
  await setDoc(ref('settings', 'main'), { ...settings, importLog: [...(settings.importLog || []), entry].slice(-30) });
  log(`${path.basename(file)}: ${added} new trips saved, ${dup} already there (${entry.range}).`);
  return { added, dup };
}

// ---------------------------------------------------------------- Uber Fleet Hub (browser)
async function openUber() {
  fs.mkdirSync(PROFILE, { recursive: true });
  return chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: false, acceptDownloads: true, viewport: null, args: ['--start-maximized'] });
}
const onLogin = url => /auth\.uber\.com|login|signin/i.test(url);
async function waitForLogin(page, minutes) {
  if (!onLogin(page.url())) return true;
  log(`Please sign in to Uber in the window (waiting up to ${minutes} minutes)…`);
  const end = Date.now() + minutes * 60000;
  while (Date.now() < end) { await page.waitForTimeout(3000); if (!onLogin(page.url())) { log('Signed in.'); return true; } }
  return false;
}
const tryClick = async (page, texts, timeout = 6000) => {
  for (const t of texts) {
    const loc = page.getByRole('button', { name: t }).or(page.getByRole('link', { name: t })).or(page.getByText(t, { exact: false })).first();
    try { await loc.click({ timeout }); return true; } catch { /* next */ }
  }
  return false;
};

async function fetchReport(page) {
  const to = new Date(); to.setDate(to.getDate() - 1);
  const from = new Date(to); from.setDate(from.getDate() - (DAYS - 1));
  log(`Requesting the Payments Transaction report ${iso(from)} → ${iso(to)}…`);
  // Fleet Hub: Reports → Generate report → Payments transaction → dates → Generate → Download.
  // Uber changes its pages from time to time; if a step is not found we fall back to manual mode.
  let ok = await tryClick(page, ['Reports']);
  if (ok) ok = await tryClick(page, ['Generate report', 'Create report', 'New report', 'Generate']);
  if (ok) ok = await tryClick(page, ['Payments transaction', 'Payments Transaction', 'Payment transactions']);
  if (ok) await tryClick(page, ['Generate', 'Create', 'Submit'], 4000);
  if (ok) {
    for (let i = 0; i < 20; i++) {   // the report takes a little while to build
      await page.waitForTimeout(6000);
      const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
      if (await tryClick(page, ['Download'], 3000)) { const d = await dl; if (d) return d; }
    }
  }
  log('Could not finish the report steps automatically.');
  log('In the Uber window: Reports → Generate report → Payments Transaction → pick the dates → Download. Waiting up to 15 minutes for the file…');
  return page.waitForEvent('download', { timeout: 15 * 60000 }).catch(() => null);
}

async function main() {
  const file = arg('--file');
  if (file && file !== true) { await importCsv(path.resolve(String(file))); process.exit(0); }
  const ctx = await openUber();
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(UBER_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  if (arg('--login')) {
    const ok = await waitForLogin(page, 15);
    log(ok ? 'Login saved. You can close the window; daily syncs will use it.' : 'Not signed in.');
    await page.waitForTimeout(4000); await ctx.close(); return;
  }
  if (!(await waitForLogin(page, 15))) { log('Not signed in to Uber – nothing downloaded.'); await ctx.close(); process.exit(2); }
  const dl = await fetchReport(page);
  if (!dl) { log('No report was downloaded.'); await ctx.close(); process.exit(3); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, `payments_${iso(new Date())}_${Date.now() % 100000}.csv`);
  await dl.saveAs(target);
  log('Saved', target);
  await ctx.close();
  await importCsv(target);
  process.exit(0);
}
main().catch(e => { console.error('Uber Sync failed:', e && e.message ? e.message : e); process.exit(1); });
