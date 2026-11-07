// PayOut frontend on Cloudflare Workers (deploy: npx wrangler deploy).
// The pages (public/) are served as static assets. /api, /auth, /vendor and /healthz are forwarded to the PayOut
// server on Render (BACKEND_URL), so the browser only ever talks to this one site: the login cookie, live updates
// (server-sent events) and redirects all keep working without any cross-site setup.
const FORWARD = /^\/(api|auth|vendor)(\/|$)|^\/healthz$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!FORWARD.test(url.pathname)) return env.ASSETS.fetch(request);
    if (!env.BACKEND_URL) return new Response('BACKEND_URL is not set for this Worker.', { status: 500 });

    const backend = new URL(env.BACKEND_URL);
    const target = new URL(url.pathname + url.search, backend);
    const headers = new Headers(request.headers);
    headers.set('X-PayOut-Host', url.host); // the address the customer sees (used for redirects, cookies and the demo check)
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
    const hasBody = !['GET', 'HEAD'].includes(request.method);

    let res;
    try {
      res = await fetch(target, { method: request.method, headers, body: hasBody ? request.body : undefined, redirect: 'manual' });
    } catch {
      return Response.json({ error: 'PayOut server is waking up. Try again in a few seconds.' }, { status: 503 });
    }

    // keep PayPal and other outside redirects as they are; point redirects at the Render host back to this site
    const out = new Response(res.body, res);
    const loc = res.headers.get('Location');
    if (loc) {
      try { const l = new URL(loc, backend); if (l.host === backend.host) out.headers.set('Location', l.pathname + l.search + l.hash); } catch { /* leave it */ }
    }
    return out;
  },
};
