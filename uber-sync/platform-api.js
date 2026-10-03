// Royal Rides – platform APIs (Bolt, Yango, YAY, Welcome Pickups, Careem … any platform with an API)
//
//   npm run apis               fetch the trips of every platform whose API is switched on
//   npm run apis -- --days 7   how many past days (default SYNC_DAYS, else 2)
//   npm run apis -- --only bolt
//
// What to call and how to read the answer is set per platform on the Fleet Ledger page
// (Platforms & contracts → platform → API / data sync) and stored with the platform – nothing secret.
// The secrets stay on this computer, in uber-sync/.env, named after the platform id, e.g. for "bolt":
//   BOLT_CLIENT_ID=…  BOLT_CLIENT_SECRET=…   (OAuth 2 client credentials)
//   BOLT_API_KEY=…                           (API key in a header)
//   BOLT_TOKEN=…                             (a fixed bearer token)
// Trips are saved like an imported file (trips/{day}, ids prefixed with the platform), duplicates skipped; drivers are
// matched by their id on that platform or their name, cars by plate. Each run writes the result on the platform
// (sync: time, period, rows added, error) so the page shows when it last worked.
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const prefix = id => String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_');
const dig = (obj, path) => !path ? undefined : String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
// a field can be 'a.b' (nested), 'a.b/1000' (divided, e.g. metres to km) or 'a.b?c=x|y' (only when c is x or y, e.g. the price as cash
// only for cash payments); several fields can be added with '+'
function pick(obj, spec){
  if(!spec) return undefined; const parts = String(spec).split('+').map(x => x.trim()).filter(Boolean);
  const one = p => { let [path, cond] = p.split('?'); if(cond){ const [k, v] = cond.split('='); if(!String(v || '').split('|').includes(String(dig(obj, k)))) return 0; }
    let div = 1; const m = path.match(/^(.*)\/(\d+(?:\.\d+)?)$/); if(m){ path = m[1]; div = +m[2]; } const v = dig(obj, path); return div !== 1 && v != null && v !== '' ? +v / div : v; };
  if(parts.length === 1) return one(parts[0]); return parts.reduce((a, p) => a + (+one(p) || 0), 0);
}
const keep = (obj, filter) => !filter || String(filter).split('&').every(c => { const [k, v] = c.split('='); return String(v || '').split('|').includes(String(dig(obj, k.trim()))); });
const fill = (s, v) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));

async function authHeaders(api, P, env, log) {
  const t = api.authType || 'oauth';
  if (t === 'oauth') {
    const id = env[P + '_CLIENT_ID'], secret = env[P + '_CLIENT_SECRET'];
    if (!id || !secret) throw new Error(`Add ${P}_CLIENT_ID and ${P}_CLIENT_SECRET to uber-sync/.env`);
    if (!api.tokenUrl) throw new Error('Set the token URL on the platform page (API / data sync).');
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret, ...(api.scope ? { scope: api.scope } : {}) });
    const r = await fetch(api.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!r.ok) throw new Error(`token request failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = await r.json(); if (!j.access_token) throw new Error('the token answer has no access_token');
    return { Authorization: 'Bearer ' + j.access_token };
  }
  if (t === 'apikey') { const k = env[P + '_API_KEY']; if (!k) throw new Error(`Add ${P}_API_KEY to uber-sync/.env`); return { [api.keyHeader || 'X-API-Key']: k }; }
  if (t === 'bearer') { const k = env[P + '_TOKEN']; if (!k) throw new Error(`Add ${P}_TOKEN to uber-sync/.env`); return { Authorization: 'Bearer ' + k }; }
  return {};
}

// a date field may be "2026-09-14 08:10", "14/09/2026", or a Unix time in seconds / milliseconds
function readDate(v, UP) {
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v || ''))) { const n = +v, d = new Date(n < 1e12 ? n * 1000 : n); const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString(); return { date: z.slice(0, 10), time: z.slice(11, 16) }; }
  return UP.parseTripDate(v);
}

export async function syncPlatformApis({ db, UP, env, log, days, only }) {
  const ref = (...p) => doc(db, 'apps', 'fleet', 'store', 'rr', ...p), col = n => collection(db, 'apps', 'fleet', 'store', 'rr', n);
  const platforms = {}; (await getDocs(col('platforms'))).forEach(d => platforms[d.id] = { id: d.id, ...d.data() });
  const list = Object.values(platforms).filter(p => p.api && p.api.enabled && (!only || p.id === only));
  if (!list.length) { log('No platform has its API switched on (Platforms & contracts → platform → API / data sync).'); return; }
  const drivers = {}, vehicles = {}; (await getDocs(col('drivers'))).forEach(d => drivers[d.id] = d.data()); (await getDocs(col('vehicles'))).forEach(d => vehicles[d.id] = d.data());
  const plates = {}; Object.entries(vehicles).forEach(([id, v]) => plates[UP.norm(v.plate)] = id);
  const to = new Date(); to.setDate(to.getDate() - 1); const from = new Date(to); from.setDate(from.getDate() - (days - 1));
  const isoD = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const vars = { from: isoD(from), to: isoD(to), fromTs: Math.floor(new Date(isoD(from) + 'T00:00:00').getTime() / 1000), toTs: Math.floor(new Date(isoD(to) + 'T23:59:59').getTime() / 1000) };

  for (const p of list) {
    const api = p.api, P = prefix(p.id), F = api.fields || {}, result = { at: new Date().toISOString(), from: vars.from, to: vars.to, added: 0, dup: 0, error: '' };
    try {
      log(`${p.name || p.id}: fetching ${vars.from} → ${vars.to}…`);
      const headers = { Accept: 'application/json', ...(await authHeaders(api, P, env, log)) };
      // {companyIds}: the accounts this API key can see (e.g. Bolt getCompanies), fetched first
      if (/{companyIds}/.test((api.body || '') + api.tripsUrl) && api.companiesUrl) {
        const r = await fetch(api.companiesUrl, { headers }); if (!r.ok) throw new Error('companies request failed: HTTP ' + r.status);
        const ids = dig(await r.json(), api.companiesPath || 'data.company_ids'); if (!Array.isArray(ids) || !ids.length) throw new Error('no company ids in the answer'); vars.companyIds = JSON.stringify(ids);
      }
      const size = +api.pageSize || 0, rows = [];
      for (let page = 0, offset = 0; page < 200; page++) {
        const v = { ...vars, page: page + (+api.pageStart || 0), offset, limit: size || 100 };
        const url = fill(api.tripsUrl, v); if (!url) throw new Error('Set the trips / earnings URL on the platform page.');
        const opt = { method: api.method || 'GET', headers: { ...headers } };
        if ((api.method || 'GET') !== 'GET' && api.body) { opt.body = fill(api.body, v); opt.headers['Content-Type'] = 'application/json'; }
        const r = await fetch(url, opt); if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
        const j = await r.json(), arr = api.listPath ? pick(j, api.listPath) : (Array.isArray(j) ? j : []);
        if (!Array.isArray(arr)) throw new Error(`no list at "${api.listPath || '(top)'}" in the answer`);
        rows.push(...arr.filter(x => keep(x, api.filter))); offset += arr.length;
        if (!size || arr.length < size) break;
      }
      // map to trip rows (same fields as an imported file)
      const n = path => UP.num(pick(r_, path)); let r_;
      const trips = rows.map(r => { r_ = r; const dt = readDate(pick(r, F.date), UP); if (!dt) return null; const id = String(pick(r, F.id) ?? '').trim() || `${dt.date}|${pick(r, F.driverName)}|${n(F.fare)}`;
        return { id: p.id + ':' + UP.norm(id), tr: p.id + ':' + UP.norm(id), d: dt.date, t: dt.time, name: String(pick(r, F.driverName) ?? '').trim(), uuid: String(pick(r, F.driverId) ?? '').trim(), p: String(pick(r, F.plate) ?? '').trim(),
          f: n(F.fare), sf: Math.abs(n(F.fee)), tx: Math.abs(n(F.vat)), tp: n(F.tip), rf: n(F.refund), c: Math.abs(n(F.cash)), oe: n(F.other), po: Math.abs(n(F.payout)), km: n(F.km) }; }).filter(Boolean);
      // drivers by their id on this platform or by name; new ones created
      const byId = {}, byName = {}; Object.entries(drivers).forEach(([id, d]) => { if ((d.platformIds || {})[p.id]) byId[d.platformIds[p.id]] = id; byName[UP.norm(d.name)] = id; });
      for (const t of trips) {
        let id = (t.uuid && byId[t.uuid]) || (t.name && byName[UP.norm(t.name)]);
        if (!id) { id = 'd-' + (UP.norm(t.name).slice(0, 20) || UP.norm(t.uuid).slice(0, 12) || Math.random().toString(36).slice(2, 10)); drivers[id] = { name: t.name || 'Unnamed driver', platformIds: t.uuid ? { [p.id]: t.uuid } : {}, payModel: '', commissionPct: 0, active: true, createdFromImport: true }; await setDoc(ref('drivers', id), drivers[id]); log('new driver:', t.name || id); }
        else if (t.uuid && !(drivers[id].platformIds || {})[p.id]) { drivers[id] = { ...drivers[id], platformIds: { ...(drivers[id].platformIds || {}), [p.id]: t.uuid } }; await setDoc(ref('drivers', id), drivers[id]); }
        byId[t.uuid] = id; byName[UP.norm(t.name)] = id; t.dr = id;
        if (t.p && !plates[UP.norm(t.p)]) { const vid = 'v-' + UP.norm(t.p).slice(0, 20); plates[UP.norm(t.p)] = vid; await setDoc(ref('vehicles', vid), { plate: t.p, fleetId: '', model: '', investorId: '', active: true, createdFromImport: true }); log('new car:', t.p); }
      }
      const byDay = {}; trips.forEach(t => (byDay[t.d] ||= []).push(t));
      for (const [day, L] of Object.entries(byDay)) {
        const snap = await getDoc(ref('trips', day)), existing = snap.exists() ? (snap.data().rows || {}) : {}, merged = { ...existing };
        for (const t of L) { if (existing[t.id]) { result.dup++; continue; } merged[t.id] = { tr: t.tr, d: t.d, t: t.t, dr: t.dr, p: t.p, f: t.f, sf: t.sf, tx: t.tx, tp: t.tp, rf: t.rf, c: t.c, oe: t.oe || 0, po: t.po || 0, km: t.km || 0, pl: p.id }; result.added++; }
        await setDoc(ref('trips', day), { date: day, rows: merged });
      }
      log(`${p.name || p.id}: ${rows.length} rows from the API, ${result.added} new trips, ${result.dup} already there.`);
    } catch (e) { result.error = String(e && e.message ? e.message : e).slice(0, 300); log(`${p.name || p.id}: FAILED – ${result.error}`); }
    const { id, ...body } = platforms[p.id]; await setDoc(ref('platforms', p.id), { ...body, sync: result });
  }
}
