/**
 * Royal Rides – Bolt proxy (Google Apps Script web app)
 *
 * Lets the Fleet Ledger page fetch Bolt orders straight from the browser ("Sync now"), without the office PC.
 * The Bolt secret stays here, in Script Properties – never in the web page.
 *
 * Setup (once):
 *  1. script.google.com → New project → paste this file.
 *  2. Project Settings → Script Properties → add:
 *       BOLT_CLIENT_ID      your Bolt client id
 *       BOLT_CLIENT_SECRET  your Bolt client secret
 *       ACCESS_KEY          any long random text (the same text goes in the Fleet Ledger, Bolt → API / data sync)
 *  3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy → copy the Web app URL.
 *  4. Fleet Ledger → Platforms & contracts → Bolt → API / data sync → "Through Google Apps Script":
 *     paste the URL and the ACCESS_KEY, save, then "Sync now".
 *
 * Call: GET <url>?key=ACCESS_KEY&from=<unix seconds>&to=<unix seconds>
 * Answer: {ok: true, orders: [...]}  (all orders of every company of this key; Bolt allows ~15 days per request,
 * so the period is fetched in windows) or {ok: false, error: "..."}.
 */
const BOLT_BASE = 'https://node.bolt.eu/fleet-integration-gateway/fleetIntegration/v1';

function doGet(e) {
  try {
    const P = PropertiesService.getScriptProperties(), p = (e && e.parameter) || {};
    if (!P.getProperty('ACCESS_KEY') || p.key !== P.getProperty('ACCESS_KEY')) return out_({ok: false, error: 'wrong key'});
    const from = Number(p.from), to = Number(p.to);
    if (!from || !to || to <= from) return out_({ok: false, error: 'give from and to as Unix seconds'});
    if (to - from > 93 * 86400) return out_({ok: false, error: 'at most about 3 months per call'});
    const token = token_(P.getProperty('BOLT_CLIENT_ID'), P.getProperty('BOLT_CLIENT_SECRET'));
    const companies = get_(BOLT_BASE + '/getCompanies', token).data.company_ids || [];
    if (!companies.length) return out_({ok: false, error: 'no Bolt company for this key'});
    const all = {}, span = 15 * 86400;
    for (let a = from; a <= to; a += span) {
      const b = Math.min(to, a + span - 1);
      for (let offset = 0; offset < 50000; offset += 500) {
        const r = post_(BOLT_BASE + '/getFleetOrders', token, {company_ids: companies, start_ts: a, end_ts: b, offset: offset, limit: 500});
        if (r.code !== 0) throw new Error('Bolt: ' + r.code + ' ' + r.message);
        const list = (r.data && r.data.orders) || [];
        list.forEach(o => all[o.order_reference] = o);
        if (list.length < 500) break;
      }
    }
    return out_({ok: true, companies: companies, orders: Object.keys(all).map(k => all[k])});
  } catch (err) {
    return out_({ok: false, error: String(err && err.message || err)});
  }
}

function token_(id, secret) {
  if (!id || !secret) throw new Error('set BOLT_CLIENT_ID and BOLT_CLIENT_SECRET in Script Properties');
  const res = UrlFetchApp.fetch('https://oidc.bolt.eu/token', {method: 'post', payload: {client_id: id, client_secret: secret, grant_type: 'client_credentials', scope: 'fleet-integration:api'}, muteHttpExceptions: true});
  if (res.getResponseCode() !== 200) throw new Error('Bolt token failed: HTTP ' + res.getResponseCode());
  return JSON.parse(res.getContentText()).access_token;
}
function get_(url, token) { return call_(url, {method: 'get', headers: {Authorization: 'Bearer ' + token}}); }
function post_(url, token, body) { return call_(url, {method: 'post', contentType: 'application/json', headers: {Authorization: 'Bearer ' + token}, payload: JSON.stringify(body)}); }
// too many requests: wait and try again
function call_(url, opt) {
  opt.muteHttpExceptions = true;
  for (let i = 0; i < 5; i++) {
    const res = UrlFetchApp.fetch(url, opt);
    if (res.getResponseCode() === 429) { Utilities.sleep([2000, 5000, 15000, 30000, 30000][i]); continue; }
    if (res.getResponseCode() >= 300) throw new Error('HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    return JSON.parse(res.getContentText());
  }
  throw new Error('Bolt kept saying too many requests – try again in a few minutes');
}
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
