// Change this if your API runs somewhere else (must match "servers" in openapi.yaml)
const API_BASE = 'http://localhost:3000/api/v1';

// Keeps the signed-in customer in the browser so profile.html can load it
const store = {
  get() { try { return JSON.parse(localStorage.getItem('ff_customer')); } catch (e) { return null; } },
  set(c) { try { localStorage.setItem('ff_customer', JSON.stringify(c)); } catch (e) {} },
  clear() { try { localStorage.removeItem('ff_customer'); } catch (e) {} }
};

function toast(msg, kind) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// Throws an Error with .status (HTTP code) and .details (field errors) when the API rejects a request.
// A network failure throws an Error with no .status.
async function api(path, opts) {
  const res = await fetch(API_BASE + path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  let body = null;
  try { body = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error((body && body.message) || 'Request failed (' + res.status + ')');
    err.status = res.status;
    err.details = body && body.details;
    throw err;
  }
  return body;
}

function errorText(err) {
  if (err.details && err.details.length) return err.details.map(d => d.issue).join(' ');
  return err.message;
}
