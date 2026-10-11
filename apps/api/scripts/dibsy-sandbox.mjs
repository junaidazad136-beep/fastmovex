#!/usr/bin/env node
/**
 * LOCAL DEVELOPMENT ONLY — a stand-in for the Dibsy API and its hosted payment page, so the whole card flow
 * (checkout → payment page → back to the shop → webhook) can be tried without a Dibsy account.
 * It speaks the same shapes FastMoveX's Dibsy provider uses (POST/GET /v2/payments, POST /v2/payments/:id/refunds).
 * No real money, no real cards. Never point production at it (the API refuses http gateways in production).
 *
 *   node scripts/dibsy-sandbox.mjs            # listens on http://localhost:4010
 *
 * then in apps/api/.env:
 *   DIBSY_SECRET_KEY=sk_test_local_sandbox_key
 *   DIBSY_API_URL=http://localhost:4010/v2
 *   API_PUBLIC_URL=http://localhost:4000       # the sandbox calls the webhook here
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const PORT = Number(process.env.DIBSY_SANDBOX_PORT || 4010);
const KEY = process.env.DIBSY_SANDBOX_KEY || 'sk_test_local_sandbox_key';
const payments = new Map();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); });

async function notify(p) {
  if (!p.webhookUrl) return;
  try {
    const r = await fetch(p.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: p.id, createdAt: new Date().toISOString() }) });
    console.log(`webhook ${p.id} → ${r.status}`);
  } catch (e) {
    console.log(`webhook ${p.id} failed: ${e.message} (FastMoveX will still check when the customer returns)`);
  }
}

function page(p) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dibsy sandbox — pay ${esc(p.amount.value)} ${esc(p.amount.currency)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f4f6;margin:0;display:grid;place-items:center;min-height:100vh}
.c{background:#fff;border-radius:16px;box-shadow:0 8px 30px #0001;padding:28px;width:min(380px,92vw)}
.t{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a2bd8;font-weight:700}
h1{font-size:30px;margin:8px 0 2px}p{color:#555;margin:0 0 18px;font-size:14px}
button{width:100%;padding:13px;border-radius:10px;border:0;font-size:15px;font-weight:600;margin-top:10px;cursor:pointer}
.pay{background:#111;color:#fff}.ap{background:#000;color:#fff}.no{background:#fde8e8;color:#b42318}.x{background:#eee;color:#333}
.w{margin-top:16px;font-size:12px;color:#b54708;background:#fffaeb;border-radius:8px;padding:8px 10px}</style></head>
<body><div class="c"><div class="t">Dibsy · sandbox</div><h1>QAR ${esc(p.amount.value)}</h1><p>${esc(p.description || '')}</p>
<form method="post" action="/checkout/${esc(p.id)}/succeeded?method=creditcard"><button class="pay" data-testid="sandbox-pay">Pay with card</button></form>
<form method="post" action="/checkout/${esc(p.id)}/succeeded?method=applepay"><button class="ap" data-testid="sandbox-applepay">Pay with Apple Pay</button></form>
<form method="post" action="/checkout/${esc(p.id)}/succeeded?method=googlepay"><button class="ap" data-testid="sandbox-googlepay">Pay with Google Pay</button></form>
<form method="post" action="/checkout/${esc(p.id)}/failed"><button class="no" data-testid="sandbox-decline">Decline</button></form>
<form method="post" action="/checkout/${esc(p.id)}/canceled"><button class="x" data-testid="sandbox-cancel">Cancel and go back</button></form>
<div class="w">Local test page — no real card is charged.</div></div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const body = await readBody(req);

  // Hosted payment page (what the customer sees)
  let m = /^\/checkout\/([\w-]+)$/.exec(url.pathname);
  if (m && req.method === 'GET') {
    const p = payments.get(m[1]);
    if (!p) return json(res, 404, { status: 404, details: 'Payment not found' });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page(p));
  }
  m = /^\/checkout\/([\w-]+)\/(succeeded|failed|canceled)$/.exec(url.pathname);
  if (m && req.method === 'POST') {
    const p = payments.get(m[1]);
    if (!p) return json(res, 404, { status: 404, details: 'Payment not found' });
    if (p.status === 'open') {
      p.status = m[2];
      p.method = url.searchParams.get('method') || null;
      console.log(`${p.id} ${p.status}${p.method ? ` (${p.method})` : ''}`);
      await notify(p);
    }
    res.writeHead(303, { location: p.redirectUrl });
    return res.end();
  }

  // API
  if (!url.pathname.startsWith('/v2/')) return json(res, 404, { status: 404, details: 'Not found' });
  if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { status: 401, details: 'Invalid API key' });
  if (req.method === 'POST' && url.pathname === '/v2/payments') {
    const b = JSON.parse(body || '{}');
    if (!b.amount?.value || !/^\d+(\.\d{1,2})?$/.test(b.amount.value) || b.amount.currency !== 'QAR') return json(res, 422, { status: 422, details: 'Invalid amount' });
    if (!b.redirectUrl) return json(res, 422, { status: 422, details: 'redirectUrl is required' });
    const id = `pt_${randomBytes(8).toString('hex')}`;
    const p = { id, status: 'open', amount: b.amount, description: b.description, redirectUrl: b.redirectUrl, webhookUrl: b.webhookUrl, metadata: b.metadata ?? {}, method: null, createdAt: new Date().toISOString() };
    payments.set(id, p);
    console.log(`created ${id} QAR ${b.amount.value} for ${b.metadata?.order_number ?? '?'}`);
    return json(res, 201, { ...p, _links: { checkout: { href: `http://localhost:${PORT}/checkout/${id}` } } });
  }
  m = /^\/v2\/payments\/([\w-]+)(\/refunds)?$/.exec(url.pathname);
  const p = m && payments.get(m[1]);
  if (m && !p) return json(res, 404, { status: 404, details: 'Payment not found' });
  if (m && req.method === 'GET' && !m[2]) return json(res, 200, p);
  if (m && req.method === 'POST' && m[2]) {
    const b = JSON.parse(body || '{}');
    console.log(`refund ${p.id} QAR ${b.amount}`);
    return json(res, 201, { id: `re_${randomBytes(6).toString('hex')}`, status: 'refunded', amount: b.amount });
  }
  json(res, 404, { status: 404, details: 'Not found' });
});

server.listen(PORT, () => console.log(`Dibsy sandbox on http://localhost:${PORT} (key ${KEY})`));
