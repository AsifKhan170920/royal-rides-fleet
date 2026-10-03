// Royal Rides – Uber Sync
//
//   npm run login            open the Uber window once and sign in (the login is remembered)
//   npm run sync             download the Payments Transaction report and save the trips
//   npm run sync -- --file X import a CSV you already have
//   npm run sync -- --days 3 how many past days to fetch (default: from SYNC_DAYS, else 2)
//   npm run apis             fetch the other platforms through their APIs (see platform-api.js)
//   npm run listen           wait for the "Sync now" button of the Fleet Ledger page and run the sync when it is pressed
//
// The Uber window uses its own Chrome profile in ./profile, so the sign-in stays there between runs.
// Trips go to the Fair Tax portal's Firestore (apps/fleet/store/rr), the same place the
// Fleet Ledger page reads. Trips already saved are skipped by Trip ID.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Papa from 'papaparse';
import { chromium } from 'playwright-core';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { syncPlatformApis } from './platform-api.js';

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

// ---------------------------------------------------------------- reports → Fleet Ledger (same reader as the Import page)
const UP = createRequire(import.meta.url)('../uber-parse.js');
const { norm } = UP;
const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };

async function driversAndCars() {
  const drivers = {}, vehicles = {};
  (await getDocs(col('drivers'))).forEach(d => drivers[d.id] = d.data());
  (await getDocs(col('vehicles'))).forEach(d => vehicles[d.id] = d.data());
  const byUuid = {}, byName = {}, plates = {};
  Object.entries(drivers).forEach(([id, d]) => { if (d.uberUuid) byUuid[d.uberUuid] = id; byName[norm(d.name)] = id; });
  Object.entries(vehicles).forEach(([id, v]) => plates[norm(v.plate)] = id);
  return {
    async driver(t) {
      let id = (t.uuid && byUuid[t.uuid]) || (t.name && byName[norm(t.name)]);
      if (!id) {
        id = 'd-' + (norm(t.name).slice(0, 20) || norm(t.uuid).slice(0, 12) || Math.random().toString(36).slice(2, 10));
        byUuid[t.uuid] = id; byName[norm(t.name)] = id;
        await setDoc(ref('drivers', id), { name: t.name || 'Unnamed driver', uberUuid: t.uuid || '', payModel: '', commissionPct: 0, active: true, createdFromImport: true });
        log('new driver:', t.name || id);
      }
      return id;
    },
    async car(plate, vu) {
      if (!plate || plates[norm(plate)]) return;
      const id = 'v-' + norm(plate).slice(0, 20); plates[norm(plate)] = id;
      await setDoc(ref('vehicles', id), { plate, uberVehicleUuid: vu || '', fleetId: '', model: '', investorId: '', active: true, createdFromImport: true });
      log('new car:', plate);
    },
  };
}

async function importCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '');
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.replace(/^\ufeff/, '') });
  const headers = parsed.meta.fields || [];
  if (!headers.length) throw new Error(`${path.basename(file)} has no header row.`);
  await portal();
  const setSnap = await getDoc(ref('settings', 'main'));
  const settings = setSnap.exists() ? setSnap.data() : {};
  const kind = UP.detect(headers), dc = await driversAndCars();
  const byDay = {}; let added = 0, dup = 0, label;

  if (kind === 'activity') {
    // trip details: car, distance, status – joined to the payments by Trip UUID
    const rows = UP.activityRows(parsed.data, headers);
    for (const t of rows) { t.dr = await dc.driver(t); await dc.car(t.p, t.vu); (byDay[t.d] ||= []).push(t); }
    for (const [day, list] of Object.entries(byDay)) {
      const snap = await getDoc(ref('tripinfo', day)); const merged = snap.exists() ? { ...(snap.data().rows || {}) } : {};
      for (const t of list) { merged[t.tr] ? dup++ : added++; merged[t.tr] = { d: t.d, t: t.t, dr: t.dr, p: t.p, vu: t.vu, km: t.km, st: t.st, prod: t.prod, pay: t.pay }; }
      await setDoc(ref('tripinfo', day), { date: day, rows: merged });
    }
    label = 'Uber Sync – Trip activity: ';
  } else {
    // money rows, one per transaction; checked against the report's own "Paid to you" total
    const sig = norm(headers.join('|')).slice(0, 180);
    const map = (settings.mappings || {})[sig] || UP.guessMap(headers);
    const rows = UP.paymentRows(parsed.data, map).filter(t => t.d);
    const paid = UP.paidToYou(parsed.data, headers), ours = UP.balanceOf(rows);
    if (paid != null && Math.abs(paid - ours) > 0.05) log(`WARNING: rows add up to ${ours}, the report's "Paid to you" is ${paid}. Check the column mapping on the Import page.`);
    else if (paid != null) log(`Checked: rows add up to the report's "Paid to you" total (${paid}).`);
    for (const t of rows) { t.dr = await dc.driver(t); await dc.car(t.p); (byDay[t.d] ||= []).push(t); }
    for (const [day, list] of Object.entries(byDay)) {
      const snap = await getDoc(ref('trips', day)); const existing = snap.exists() ? (snap.data().rows || {}) : {};
      const merged = { ...existing };
      for (const t of list) { if (existing[t.id]) { dup++; continue; } merged[t.id] = { tr: t.tr || '', d: t.d, t: t.t, dr: t.dr, p: t.p, f: t.f, sf: t.sf, tx: t.tx, tp: t.tp, rf: t.rf, c: t.c, oe: t.oe || 0, po: t.po || 0, km: t.km }; added++; }
      await setDoc(ref('trips', day), { date: day, rows: merged });
    }
    label = 'Uber Sync: ';
  }
  const days = Object.keys(byDay).sort();
  if (!days.length) { log(`${path.basename(file)}: nothing to import.`); return { added: 0, dup: 0 }; }
  const entry = { at: new Date().toLocaleString('en-GB'), files: (label + path.basename(file)).slice(0, 120), added, dup, range: `${days[0]} → ${days[days.length - 1]}` };
  await setDoc(ref('settings', 'main'), { ...settings, importLog: [...(settings.importLog || []), entry].slice(-30) });
  log(`${path.basename(file)} (${kind}): ${added} new, ${dup} already there (${entry.range}).`);
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

// "Sync now" on the Fleet Ledger page writes settings/syncRequest {status: "waiting", days, uber}; this listener runs it
// and writes back running → done / error with what came in. Keep it running on the office PC ("5 - Start sync listener").
async function listen() {
  await portal(); let busy = false;
  log('Listening for "Sync now" from the Fleet Ledger page… (keep this window open)');
  const reqRef = ref('settings', 'syncRequest');
  await setDoc(reqRef, { ...((await getDoc(reqRef)).data() || {}), listener: new Date().toISOString() });
  setInterval(async () => { try { const s = (await getDoc(reqRef)).data() || {}; await setDoc(reqRef, { ...s, listener: new Date().toISOString() }); } catch { /* offline for a moment */ } }, 60000);
  onSnapshot(reqRef, async snap => {
    const r = snap.data(); if (!r || r.status !== 'waiting' || busy) return;
    busy = true; const started = new Date().toISOString(), lines = [], capture = (...a) => { lines.push(a.join(' ')); log(...a); };
    await setDoc(reqRef, { ...r, status: 'running', startedAt: started });
    try {
      if (r.uber) {
        capture('Uber: opening Fleet Hub…');
        const ctx = await openUber(); const page = ctx.pages()[0] || await ctx.newPage();
        await page.goto(UBER_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
        if (!(await waitForLogin(page, 5))) capture('Uber: not signed in – run "1 - Uber login (once)".');
        else { const dl = await fetchReport(page); if (dl) { fs.mkdirSync(OUT_DIR, { recursive: true }); const target = path.join(OUT_DIR, `payments_${iso(new Date())}_${Date.now() % 100000}.csv`); await dl.saveAs(target); await ctx.close(); const x = await importCsv(target); capture(`Uber: ${x.added} new rows, ${x.dup} already there.`); } else { await ctx.close(); capture('Uber: no report downloaded.'); } }
      }
      await syncPlatformApis({ db, UP, env: ENV, log: capture, days: +r.days || DAYS, only: r.only || null });
      await setDoc(reqRef, { ...r, status: 'done', startedAt: started, doneAt: new Date().toISOString(), log: lines.slice(-20) });
    } catch (e) { await setDoc(reqRef, { ...r, status: 'error', startedAt: started, doneAt: new Date().toISOString(), log: [...lines, 'ERROR: ' + (e && e.message ? e.message : e)].slice(-20) }); log('Sync failed:', e && e.message); }
    busy = false;
  });
}

async function main() {
  if (arg('--listen')) { await listen(); return; }
  if (arg('--apis')) { await portal(); await syncPlatformApis({ db, UP, env: ENV, log, days: DAYS, only: typeof arg('--only') === 'string' ? arg('--only') : null }); process.exit(0); }
  const files = process.argv.flatMap((x, i, a) => x === '--file' && a[i + 1] ? [path.resolve(a[i + 1])] : []);
  if (files.length) {
    files.sort((x, y) => (/activity/i.test(y) ? 1 : 0) - (/activity/i.test(x) ? 1 : 0));
    for (const f of files) await importCsv(f);
    process.exit(0);
  }
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
