/**
 * Royal Rides – token relay (Google Apps Script web app)
 *
 * Bolt refuses token requests that come from a web page (it answers 500 when the browser sends its Origin), so the
 * Fleet Ledger asks this script for the token instead. Nothing is stored here: the client id and secret come from
 * the software's settings (Platforms → Bolt → API / data sync → API keys) with each request, and the token goes
 * straight back. All the other Bolt calls (companies, orders) are made by the page itself.
 *
 * Setup (once): script.google.com → New project → paste this file → Deploy → New deployment → Web app →
 * Execute as: Me, Who has access: Anyone → Deploy (allow the access Google asks for) → copy the Web app URL into
 * "Token relay URL" on the API keys box.
 */
const ALLOWED = ['https://oidc.bolt.eu/token'];

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
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
function doGet() { return out_({ok: true, relay: 'Royal Rides token relay'}); }
function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
