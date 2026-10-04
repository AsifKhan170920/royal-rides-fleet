/**
 * Royal Rides – token relay (Google Apps Script web app)
 *
 * Bolt refuses token requests that come from a web page (it answers 500 when the browser sends its Origin), so the
 * Fleet Ledger asks this script for the token instead. Nothing is stored here: the client id and secret come from
 * the software's settings (Platforms → Bolt → API / data sync → API keys) with each request, and the token goes
 * straight back. All the other Bolt calls (companies, orders) are made by the page itself.
 * Yango answers only servers, so for Yango the page sends the whole request (forward_url) and the relay passes it on.
 *
 * Setup (once): script.google.com → New project → paste this file → Deploy → New deployment → Web app →
 * Execute as: Me, Who has access: Anyone → Deploy (allow the access Google asks for) → copy the Web app URL into
 * "Token relay URL" on the API keys box.
 */
const ALLOWED = ['https://oidc.bolt.eu/token'];
// platforms that answer only servers (Yango): the page sends the whole request, the relay makes it and returns status + text
const FORWARD = ['https://fleet-api.taxi.yandex.net/', 'https://fleet-api.yango.tech/'];
const PASS_HEADERS = ['x-client-id', 'x-api-key', 'x-park-id', 'authorization', 'accept', 'accept-language'];

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.forward_url) return forward_(p);
    const url = p.token_url || ALLOWED[0];
    if (ALLOWED.indexOf(url) < 0) return out_({error: 'token URL not allowed: ' + url});
    if (!p.client_id || !p.client_secret) return out_({error: 'client id and secret missing'});
    const payload = {client_id: p.client_id, client_secret: p.client_secret, grant_type: 'client_credentials'};
    if (p.scope) payload.scope = p.scope;
    const res = UrlFetchApp.fetch(url, {method: 'post', payload: payload, muteHttpExceptions: true});
    let j; try { j = JSON.parse(res.getContentText()); } catch (x) { j = {error: res.getContentText().slice(0, 200)}; }
    if (res.getResponseCode() !== 200) j.error = j.error || ('HTTP ' + res.getResponseCode());
    return out_(j);
  } catch (err) {
    return out_({error: String(err && err.message || err)});
  }
}
function forward_(p) {
  if (!FORWARD.some(f => p.forward_url.indexOf(f) === 0)) return out_({error: 'address not allowed: ' + p.forward_url});
  const h = {}, given = JSON.parse(p.headers || '{}');
  Object.keys(given).forEach(k => { if (PASS_HEADERS.indexOf(k.toLowerCase()) >= 0) h[k] = given[k]; });
  const opt = {method: (p.method || 'GET').toLowerCase(), headers: h, muteHttpExceptions: true};
  if (p.body) { opt.payload = p.body; opt.contentType = 'application/json'; }
  const res = UrlFetchApp.fetch(p.forward_url, opt);
  return out_({status: res.getResponseCode(), text: res.getContentText()});
}
function doGet() { return out_({ok: true, relay: 'Royal Rides token relay'}); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
