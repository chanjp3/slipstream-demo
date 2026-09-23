// Chartavia Charter Marketplace — auth + marketplace API
// Users, requests, quotes, and messages live in D1; sessions live in Workers KV.

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const PBKDF2_ITERATIONS = 100_000;
// Terms of Service version a new account accepts (public/terms.html, "Last updated").
// Bump it when the Terms change materially; users.terms_version records it.
const TERMS_VERSION = '2026-09-23';

// ---------------------------------------------------------------- demo mode
// This deployment is a guided demo: anyone can switch between seeded personas
// to see both sides of the marketplace. Only @demo.chartavia accounts are
// switchable — real registrations still work but can't be impersonated.
const DEMO_PERSONAS = [
  { email: 'ava@demo.chartavia', label: 'Ava · Client' },
  { email: 'ben@demo.chartavia', label: 'Ben · Client (Plus)' },
  { email: 'meridian@demo.chartavia', label: 'Meridian · Op Admin' },
  { email: 'dana@demo.chartavia', label: 'Dana · Op Member' },
  { email: 'bluewing@demo.chartavia', label: 'Bluewing · Operator' },
  { email: 'northline@demo.chartavia', label: 'Northline · New operator' },
  { email: 'staff@demo.chartavia', label: 'Concierge · Staff' },
];

async function demoSessionFor(env, email) {
  if (!DEMO_PERSONAS.some((p) => p.email === email)) return null;
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) return null;
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.SLIPSTREAM_KV.put(
    'sess:' + token,
    JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role, epoch: user.session_epoch || 0 }),
    { expirationTtl: SESSION_TTL }
  );
  return { token, user };
}

function demoToolbar(currentEmail) {
  // The design bundle replaces the whole document at unpack time, so the bar
  // is injected by a script (window + timers survive the replacement) that
  // re-attaches it once the app has rendered.
  const buttons = DEMO_PERSONAS.map((p) => {
    const active = p.email === currentEmail;
    const style = active
      ? 'background:#2E6BE6;color:#fff;'
      : 'background:rgba(255,255,255,.08);color:#c9d6ee;';
    return '<button data-demo-email="' + p.email + '" style="' + style
      + 'border:none;cursor:pointer;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:700;white-space:nowrap;font-family:system-ui,sans-serif">'
      + p.label + '</button>';
  }).join('');
  const bar = '<div id="demobar" style="position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:5000;'
    + 'background:rgba(22,35,59,.97);border-radius:999px;box-shadow:0 10px 34px rgba(10,20,40,.45);'
    + 'padding:8px 12px;display:flex;align-items:center;gap:6px;font-family:system-ui,sans-serif;max-width:96vw;overflow-x:auto">'
    + '<span style="color:#8fa3c8;font-size:10px;font-weight:800;letter-spacing:1px;padding:0 6px;white-space:nowrap">DEMO · VIEW AS</span>'
    + buttons + '</div>';
  const script = '(function(){var h=' + JSON.stringify(bar) + ';'
    + 'window.__demoSwitch=function(e){fetch("/api/demo/switch",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:e})}).then(function(r){return r.json()}).then(function(){location.reload()})};'
    + 'function ensure(){if(document.body&&!document.getElementById("demobar")){var w=document.createElement("div");w.innerHTML=h;var el=w.firstChild;'
    + 'el.addEventListener("click",function(ev){var b=ev.target.closest("button");if(b&&b.getAttribute("data-demo-email"))window.__demoSwitch(b.getAttribute("data-demo-email"))});'
    + 'document.body.appendChild(el)}}'
    + 'setInterval(ensure,700);})();';
  return '<scr' + 'ipt>' + script + '</scr' + 'ipt>';
}

async function apiDemoSwitch(request, env) {
  const b = await request.json().catch(() => null);
  const sess = await demoSessionFor(env, b ? String(b.email || '') : '');
  if (!sess) return json({ error: 'Unknown demo persona' }, 400);
  return json(
    { ok: true, name: sess.user.name },
    200,
    'slipstream_session=' + sess.token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_TTL
  );
}

const FLEET = {
  p300: { name: 'Phenom 300E', seats: 7 },
  xls: { name: 'Citation XLS Gen2', seats: 9 },
  c350: { name: 'Challenger 350', seats: 9 },
  g450: { name: 'Gulfstream G450', seats: 14 },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) {
      return handleApi(request, env, path);
    }
    return withSecurityHeaders(await handlePage(request, env, path));
  },
  // Daily (see "triggers" in wrangler.jsonc): rating expiry reminders.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(ratingExpirySweep(env));
  },
};

function withSecurityHeaders(res) {
  const out = new Response(res.body, res);
  out.headers.set('x-content-type-options', 'nosniff');
  // /map.html sets its own: it is framed by /app, and it must name our origin
  // to the tile servers (OpenStreetMap refuses requests with no Referer).
  if (!out.headers.has('x-frame-options')) out.headers.set('x-frame-options', 'DENY');
  if (!out.headers.has('referrer-policy')) out.headers.set('referrer-policy', 'same-origin');
  return out;
}

// Fixed-window rate limiter backed by D1 (strongly consistent): 8 attempts
// per key per minute. Returns null when under the limit; a 429 when over.
const RATE_LIMIT_MAX = 8;

async function rateLimit(request, env, scope, extra) {
  try {
    const win = Math.floor(Date.now() / 60000);
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const key = scope + ':' + ip + (extra ? ':' + extra : '') + ':' + win;
    await env.DB.prepare(
      'INSERT INTO rate_limits (k, n, w) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1'
    ).bind(key, win).run();
    const row = await env.DB.prepare('SELECT n FROM rate_limits WHERE k = ?').bind(key).first();
    if (row && row.n > RATE_LIMIT_MAX) {
      return json({ error: 'Too many attempts — try again in a minute.' }, 429);
    }
    // Opportunistic cleanup of windows older than two minutes.
    if (row && row.n === 1) {
      await env.DB.prepare('DELETE FROM rate_limits WHERE w < ?').bind(win - 2).run();
    }
  } catch {}
  return null;
}

async function handlePage(request, env, path) {
  {
    const url = new URL(request.url);

    let session = await getSession(request, env);

    if (path === '/') {
      if (session) return redirect('/app');
      return serveAsset(env, request, '/home.html');
    }

    if (path === '/logout') {
      const token = getCookie(request, 'slipstream_session');
      if (token) await env.SLIPSTREAM_KV.delete('sess:' + token);
      return new Response(null, {
        status: 302,
        headers: {
          location: '/login',
          'set-cookie': 'slipstream_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        },
      });
    }

    if (path === '/login' || path === '/register') {
      if (session) return redirect('/app');
      return serveAsset(env, request, path + '.html');
    }

    if (path === '/forgot' || path === '/reset') {
      return serveAsset(env, request, path + '.html');
    }

    if (path === '/concierge') return serveAsset(env, request, '/concierge.html');
    if (path === '/terms' || path === '/privacy') return serveAsset(env, request, path + '.html');
    const tripDoc = path.match(/^\/trip\/(RQ-\d+)$/);
    if (tripDoc) {
      if (!session) return redirect('/login');
      return await tripDocPage(request, env, session, tripDoc[1]);
    }

    // The airport map, framed by /app. Served here rather than as a blob:
    // document so the browser can send our origin to the tile server, and so
    // the map provider's key travels with the page instead of the bundle.
    if (path === '/map.html') {
      if (!session) return new Response('Sign in to use the map.', { status: 401, headers: { 'content-type': 'text/plain' } });
      const res = await serveAsset(env, request, '/map.html');
      if (!res.ok) return res;
      const cfg = JSON.stringify({ mapboxToken: env.MAPBOX_TOKEN || null }).replace(/</g, '\\u003c');
      const html = (await res.text()).replace('<head>', () => '<head><script>window.__MAP=' + cfg + '</script>');
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'private, max-age=300',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-frame-options': 'SAMEORIGIN',
        },
      });
    }

    // Never serve the app bundle directly — it must go through the auth gate.
    if (path === '/app.html') {
      return redirect('/app');
    }
    if (path === '/login.html' || path === '/register.html') {
      return redirect(path.replace('.html', ''));
    }

    if (path === '/app') {
      let setCookie = null;
      if (!session) {
        const auto = await demoSessionFor(env, DEMO_PERSONAS[0].email);
        if (!auto) return redirect('/login');
        session = { id: auto.user.id, email: auto.user.email, name: auto.user.name, role: auto.user.role };
        setCookie = 'slipstream_session=' + auto.token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + SESSION_TTL;
      }
      const res = await serveAsset(env, request, '/app.html');
      let html = await res.text();
      if (session.role === 'operator') {
        html = html.replace(
          '&quot;default&quot;:&quot;client&quot;',
          '&quot;default&quot;:&quot;operator&quot;'
        );
      }
      const current = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(session.id).first();
      html = html.replace('</body>', demoToolbar(current ? current.email : session.email) + '</body>');
      const headers = {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      };
      if (setCookie) headers['set-cookie'] = setCookie;
      return new Response(html, { headers });
    }

    return env.ASSETS.fetch(request);
  }
}

// ---------------------------------------------------------------- API router

async function handleApi(request, env, path) {
  try {
    const method = request.method;
    if (path === '/api/register' && method === 'POST') return await apiRegister(request, env);
    if (path === '/api/login' && method === 'POST') return await apiLogin(request, env);
    if (path === '/api/logout' && method === 'POST') return await apiLogout(request, env);
    if (path === '/api/demo/switch' && method === 'POST') return await apiDemoSwitch(request, env);
    if (path === '/api/forgot' && method === 'POST') return await apiForgotPassword(request, env);
    if (path === '/api/reset' && method === 'POST') return await apiResetPassword(request, env);
    if (path === '/api/concierge' && method === 'POST') return await apiConcierge(request, env);
    if (path === '/api/public/stats' && method === 'GET') return await apiPublicStats(env);

    // Everything below requires a session. The user row is consulted on every
    // request: org membership changes, email changes and session-epoch bumps
    // (password change) take effect immediately.
    const me = await getSession(request, env);
    if (!me) return json({ error: 'Not signed in' }, 401);
    const row = await env.DB.prepare(
      'SELECT email, org_id, org_role, session_epoch, is_staff FROM users WHERE id = ?'
    ).bind(me.id).first();
    if (!row || (me.epoch || 0) !== (row.session_epoch || 0)) {
      const token = getCookie(request, 'slipstream_session');
      if (token) await env.SLIPSTREAM_KV.delete('sess:' + token);
      return json({ error: 'Not signed in' }, 401);
    }
    me.email = row.email;
    me.isStaff = !!row.is_staff;
    if (me.role === 'operator') {
      me.orgId = row.org_id || me.id;
      me.orgRole = row.org_role || 'admin';
    }

    let m;
    if (path === '/api/me' && method === 'GET') return json(publicUser(me));
    if (path === '/api/me/profile' && method === 'POST') return await apiUpdateProfile(request, env, me);
    if (path === '/api/me/password' && method === 'POST') return await apiChangePassword(request, env, me);
    if (path === '/api/me/prefs' && method === 'POST') return await apiUpdatePrefs(request, env, me);
    if (path === '/api/billing/upgrade' && method === 'POST') return await apiBillingChange(env, me, 'up');
    if (path === '/api/billing/downgrade' && method === 'POST') return await apiBillingChange(env, me, 'down');
    if (path === '/api/operator/profile' && method === 'POST') return await apiSaveOperatorProfile(request, env, me);
    if (path === '/api/operator/fleet' && method === 'POST') return await apiAddAircraft(request, env, me);
    if ((m = path.match(/^\/api\/operator\/fleet\/(\d+)\/delete$/)) && method === 'POST')
      return await apiRemoveAircraft(env, me, +m[1]);
    if (path === '/api/operator/verify' && method === 'POST') return await apiVerifyFleet(env, me, request);
    if (path === '/api/operator/d085' && method === 'POST') return await apiUploadD085(request, env, me);
    if (path === '/api/operator/d085' && method === 'GET') return await apiGetD085(env, me);
    if (path === '/api/operator/certificate' && method === 'POST') return await apiUploadCertDoc(request, env, me);
    if (path === '/api/operator/certificate' && method === 'GET') return await apiGetCertDoc(env, me);
    if (path === '/api/operator/safety-doc' && method === 'POST') return await apiUploadSafetyDoc(request, env, me);
    if (path === '/api/operator/safety-doc' && method === 'GET') return await apiGetSafetyDoc(env, me);
    if (path === '/api/operator/review/resubmit' && method === 'POST') return await apiResubmitReview(request, env, me);
    if ((m = path.match(/^\/api\/operator\/fleet\/(\d+)\/photo$/)) && method === 'POST')
      return await apiUploadAircraftPhoto(request, env, me, +m[1]);
    if ((m = path.match(/^\/api\/fleet\/(\d+)\/photo$/)) && method === 'GET')
      return await apiGetAircraftPhoto(env, +m[1]);
    if (path === '/api/operator/invites' && method === 'POST') return await apiCreateInvite(env, me);
    if ((m = path.match(/^\/api\/operator\/invites\/([A-Z0-9-]+)\/revoke$/)) && method === 'POST')
      return await apiRevokeInvite(env, me, m[1]);
    if ((m = path.match(/^\/api\/operator\/members\/(\d+)\/remove$/)) && method === 'POST')
      return await apiRemoveMember(env, me, +m[1]);
    if ((m = path.match(/^\/api\/operator\/trips\/(\d+)\/expenses$/)) && method === 'POST')
      return await apiSetTripExpenses(request, env, me, +m[1]);
    if ((m = path.match(/^\/api\/staff\/concierge\/(\d+)$/)) && method === 'POST')
      return await apiStaffConcierge(request, env, me, +m[1]);
    if (path === '/api/staff/sweep' && method === 'POST') {
      // The daily job on demand; it is idempotent, so running it twice sends nothing twice.
      if (!me.isStaff) return json({ error: 'Not found' }, 404);
      return json({ ok: true, ...(await ratingExpirySweep(env)) });
    }
    if ((m = path.match(/^\/api\/staff\/operators\/(\d+)$/)) && method === 'POST')
      return await apiStaffOperator(request, env, me, +m[1]);
    if ((m = path.match(/^\/api\/staff\/operators\/(\d+)\/doc\/(certificate|d085|safety)$/)) && method === 'GET')
      return await apiStaffOperatorDoc(env, me, +m[1], m[2]);
    if (path === '/api/bootstrap' && method === 'GET') return await apiBootstrap(env, me);
    if (path === '/api/requests' && method === 'POST') return await apiCreateRequest(request, env, me);

    if ((m = path.match(/^\/api\/requests\/(RQ-\d+)\/accept$/)) && method === 'POST')
      return await apiAcceptQuote(request, env, me, m[1]);
    if ((m = path.match(/^\/api\/requests\/(RQ-\d+)\/review$/)) && method === 'POST')
      return await apiSubmitReview(request, env, me, m[1]);
    if ((m = path.match(/^\/api\/requests\/(RQ-\d+)\/trip$/)) && method === 'POST')
      return await apiTripAction(request, env, me, m[1]);
    if ((m = path.match(/^\/api\/requests\/(RQ-\d+)\/close$/)) && method === 'POST')
      return await apiCloseRequest(env, me, m[1]);
    if (path === '/api/empty-legs' && method === 'POST') return await apiPostEmptyLeg(request, env, me);
    if ((m = path.match(/^\/api\/empty-legs\/(\d+)\/remove$/)) && method === 'POST')
      return await apiRemoveEmptyLeg(env, me, +m[1]);
    if ((m = path.match(/^\/api\/requests\/(RQ-\d+)\/quotes$/)) && method === 'POST')
      return await apiSubmitQuote(request, env, me, m[1]);
    if ((m = path.match(/^\/api\/quotes\/(\d+)\/messages$/))) {
      if (method === 'GET') return await apiGetMessages(env, me, +m[1]);
      if (method === 'POST') return await apiSendMessage(request, env, me, +m[1]);
    }
    if ((m = path.match(/^\/api\/quotes\/(\d+)\/contract$/))) {
      if (method === 'GET') return await apiGetContract(env, me, +m[1]);
      if (method === 'POST') return await apiUploadContract(request, env, me, +m[1]);
    }
    if ((m = path.match(/^\/api\/quotes\/(\d+)\/contract-link$/)) && method === 'POST')
      return await apiSetContractLink(request, env, me, +m[1]);
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err.stack || err);
    return json({ error: 'Server error' }, 500);
  }
}

// ---------------------------------------------------------------------- auth

async function apiRegister(request, env) {
  const limited = await rateLimit(request, env, 'reg');
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid request body' }, 400);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const name = String(body.name || '').trim().slice(0, 80);
  const role = body.role === 'operator' ? 'operator' : 'client';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
  if (!name) return json({ error: 'Enter your name' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return json({ error: 'An account with that email already exists' }, 409);

  // Operators can join an existing team with an invite code; otherwise they
  // become the admin of their own new org.
  let invite = null;
  const inviteCode = String(body.inviteCode || '').trim().toUpperCase();
  if (role === 'operator' && inviteCode) {
    invite = await env.DB.prepare('SELECT * FROM org_invites WHERE code = ? AND used_by IS NULL')
      .bind(inviteCode).first();
    if (!invite) return json({ error: 'That invite code is invalid or already used' }, 400);
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  const res = await env.DB.prepare(
    "INSERT INTO users (email, name, role, salt, hash, terms_version, terms_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ).bind(email, name, role, toHex(salt), toHex(hash), TERMS_VERSION).run();
  const userId = res.meta.last_row_id;

  if (role === 'operator') {
    if (invite) {
      await env.DB.prepare('UPDATE users SET org_id = ?, org_role = ? WHERE id = ?')
        .bind(invite.org_id, 'member', userId).run();
      await env.DB.prepare("UPDATE org_invites SET used_by = ?, used_at = datetime('now') WHERE code = ?")
        .bind(userId, invite.code).run();
      await notifyUser(env, invite.org_id, name + ' joined your Chartavia team',
        [name + ' registered with your invite code and can now quote and message under your company profile.'],
        new URL(request.url).origin + '/app', 'View your team', { kicker: 'TEAM' });
    } else {
      await env.DB.prepare('UPDATE users SET org_id = ?, org_role = ? WHERE id = ?')
        .bind(userId, 'admin', userId).run();
    }
  }

  return createSession(env, { id: userId, email, name, role });
}

async function apiLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid request body' }, 400);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const limited = await rateLimit(request, env, 'login', email);
  if (limited) return limited;

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user || user.hash === 'x') return json({ error: 'Incorrect email or password' }, 401);

  const hash = await hashPassword(password, fromHex(user.salt));
  if (!timingSafeEqual(toHex(hash), user.hash)) {
    return json({ error: 'Incorrect email or password' }, 401);
  }
  return createSession(env, user);
}

async function apiLogout(request, env) {
  const token = getCookie(request, 'slipstream_session');
  if (token) await env.SLIPSTREAM_KV.delete('sess:' + token);
  return json(
    { ok: true },
    200,
    'slipstream_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
  );
}

// Forgot password: emailed single-use token (30 min TTL). The response never
// reveals whether the email exists. In demo mode (no email provider) the
// reset link is returned directly so the flow stays testable.
async function apiForgotPassword(request, env) {
  const b = await request.json().catch(() => null);
  const email = b ? String(b.email || '').trim().toLowerCase() : '';
  if (!email) return json({ error: 'Enter your email' }, 400);
  const limited = await rateLimit(request, env, 'forgot', email);
  if (limited) return limited;

  const user = await env.DB.prepare('SELECT id, hash FROM users WHERE email = ?').bind(email).first();
  let demoLink = null;
  if (user && user.hash !== 'x') {
    const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await env.SLIPSTREAM_KV.put('pwreset:' + token, JSON.stringify({ id: user.id }), { expirationTtl: 1800 });
    const link = new URL(request.url).origin + '/reset?token=' + token;
    await sendEmail(env, email, 'Reset your Chartavia password',
      emailHtml('Reset your password',
        ['Someone (hopefully you) asked to reset the password for this account.',
         'The link below works once and expires in 30 minutes. If you didn\u2019t ask, ignore this email \u2014 nothing changes.'],
        'Choose a new password', link, { kicker: 'ACCOUNT' }));
    if (!env.RESEND_API_KEY) demoLink = link;
  }
  const res = { ok: true };
  if (demoLink) res.demoLink = demoLink;
  return json(res);
}

async function apiResetPassword(request, env) {
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const token = String(b.token || '');
  const password = String(b.password || '');
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
  if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: 'This reset link is invalid or expired' }, 400);
  const raw = await env.SLIPSTREAM_KV.get('pwreset:' + token);
  if (!raw) return json({ error: 'This reset link is invalid or expired' }, 400);
  const { id } = JSON.parse(raw);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(password, salt);
  // New password + bumped epoch: every existing session is signed out.
  await env.DB.prepare('UPDATE users SET salt = ?, hash = ?, session_epoch = session_epoch + 1 WHERE id = ?')
    .bind(toHex(salt), toHex(hash), id).run();
  await env.SLIPSTREAM_KV.delete('pwreset:' + token);
  return json({ ok: true });
}

async function createSession(env, user) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.SLIPSTREAM_KV.put(
    'sess:' + token,
    JSON.stringify({ id: user.id, email: user.email, name: user.name, role: user.role, epoch: user.session_epoch || 0 }),
    { expirationTtl: SESSION_TTL }
  );
  return json(
    { ok: true, role: user.role },
    200,
    `slipstream_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`
  );
}

async function getSession(request, env) {
  const token = getCookie(request, 'slipstream_session');
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const raw = await env.SLIPSTREAM_KV.get('sess:' + token);
  if (!raw) return null;
  const session = JSON.parse(raw);
  // Sessions from before users lived in D1 have no id — treat as signed out.
  if (!session.id) {
    await env.SLIPSTREAM_KV.delete('sess:' + token);
    return null;
  }
  return session;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

// ------------------------------------------------------------------- account

async function refreshSession(request, env, me, patch) {
  const token = getCookie(request, 'slipstream_session');
  const updated = { ...me, ...patch };
  if (token) {
    await env.SLIPSTREAM_KV.put('sess:' + token, JSON.stringify(updated), {
      expirationTtl: SESSION_TTL,
    });
  }
  return updated;
}

async function apiUpdateProfile(request, env, me) {
  const b = await request.json().catch(() => null);
  const name = b ? String(b.name || '').trim().slice(0, 80) : '';
  if (!name) return json({ error: 'Enter a name' }, 400);
  await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, me.id).run();
  await refreshSession(request, env, me, { name });
  return json({ ok: true, name });
}

async function apiChangePassword(request, env, me) {
  const limited = await rateLimit(request, env, 'pw', String(me.id));
  if (limited) return limited;
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const current = String(b.current || '');
  const next = String(b.next || '');
  if (next.length < 8) return json({ error: 'New password must be at least 8 characters' }, 400);

  const user = await env.DB.prepare('SELECT salt, hash, session_epoch FROM users WHERE id = ?').bind(me.id).first();
  if (!user) return json({ error: 'Account not found' }, 404);
  const check = await hashPassword(current, fromHex(user.salt));
  if (!timingSafeEqual(toHex(check), user.hash)) {
    return json({ error: 'Current password is incorrect' }, 401);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(next, salt);
  // Bump the session epoch so every other signed-in session dies, then issue
  // a fresh session for this one.
  const epoch = (user.session_epoch || 0) + 1;
  await env.DB.prepare('UPDATE users SET salt = ?, hash = ?, session_epoch = ? WHERE id = ?')
    .bind(toHex(salt), toHex(hash), epoch, me.id).run();
  const oldToken = getCookie(request, 'slipstream_session');
  if (oldToken) await env.SLIPSTREAM_KV.delete('sess:' + oldToken);
  return createSession(env, { id: me.id, email: me.email, name: me.name, role: me.role, session_epoch: epoch });
}

async function apiUpdatePrefs(request, env, me) {
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const row = await env.DB.prepare('SELECT prefs FROM users WHERE id = ?').bind(me.id).first();
  const prefs = { ...JSON.parse(row?.prefs || '{}') };
  if ('showEmptyLegDeals' in b) prefs.showEmptyLegDeals = !!b.showEmptyLegDeals;
  await env.DB.prepare('UPDATE users SET prefs = ? WHERE id = ?')
    .bind(JSON.stringify(prefs), me.id).run();
  return json({ ok: true, prefs });
}

// ---------------------------------------------------------------- analytics

// Org-wide sales analytics: every quote the team has sent, joined to its
// request, with expenses on won trips for profit margins.
async function operatorAnalytics(env, me) {
  const rows = (await env.DB.prepare(
    `SELECT q.id AS quote_id, q.price, q.expenses, q.operator_id, u.name AS member,
            r.id AS rid, r.type, r.legs, r.accepted_quote_id, r.trip_status,
            cu.name AS client
     FROM quotes q
     JOIN requests r ON r.id = q.request_id
     JOIN users u ON u.id = q.operator_id
     JOIN users cu ON cu.id = r.user_id
     WHERE q.operator_id IN (SELECT id FROM users WHERE org_id = ?)
     ORDER BY q.created_at DESC`
  ).bind(me.orgId).all()).results;

  const isWon = (r) => r.accepted_quote_id === r.quote_id && r.trip_status !== 'cancelled';
  const won = rows.filter(isWon);
  const revenue = won.reduce((s, r) => s + r.price, 0);
  const withExp = won.filter((r) => r.expenses != null);
  const expTotal = withExp.reduce((s, r) => s + r.expenses, 0);
  const revWithExp = withExp.reduce((s, r) => s + r.price, 0);

  const out = {
    sent: rows.length,
    won: won.length,
    winRate: rows.length ? Math.round((won.length / rows.length) * 100) : 0,
    revenue,
    expenses: expTotal,
    profit: revWithExp - expTotal,
    marginPct: revWithExp ? Math.round(((revWithExp - expTotal) / revWithExp) * 100) : null,
    expMissing: won.length - withExp.length,
    trips: won.map((r) => ({
      quoteId: r.quote_id,
      rid: r.rid,
      type: r.type,
      legs: JSON.parse(r.legs),
      client: r.client,
      member: r.member,
      price: r.price,
      expenses: r.expenses,
      tripStatus: r.trip_status,
    })),
  };
  if (me.orgRole === 'admin') {
    const byMember = new Map();
    for (const r of rows) {
      const m = byMember.get(r.operator_id) || { name: r.member, sent: 0, won: 0, revenue: 0, expenses: 0, revWithExp: 0 };
      m.sent++;
      if (isWon(r)) {
        m.won++;
        m.revenue += r.price;
        if (r.expenses != null) { m.expenses += r.expenses; m.revWithExp += r.price; }
      }
      byMember.set(r.operator_id, m);
    }
    out.members = [...byMember.values()].map((m) => ({
      name: m.name, sent: m.sent, won: m.won,
      winRate: m.sent ? Math.round((m.won / m.sent) * 100) : 0,
      revenue: m.revenue,
      profit: m.revWithExp - m.expenses,
    })).sort((a, b) => b.revenue - a.revenue);
  }
  return out;
}

// Any team member can record a won trip's costs.
async function apiSetTripExpenses(request, env, me, quoteId) {
  if (me.role !== 'operator') return json({ error: 'Operators only' }, 403);
  const b = await request.json().catch(() => null);
  const amount = b ? Math.round(+b.amount) : NaN;
  if (!Number.isFinite(amount) || amount < 0 || amount > 5_000_000) return json({ error: 'Enter a valid amount' }, 400);
  const q = await env.DB.prepare(
    `SELECT q.id FROM quotes q
     JOIN requests r ON r.id = q.request_id
     JOIN users u ON u.id = q.operator_id
     WHERE q.id = ?1 AND COALESCE(u.org_id, u.id) = ?2 AND r.accepted_quote_id = q.id`
  ).bind(quoteId, me.orgId).first();
  if (!q) return json({ error: 'Trip not found' }, 404);
  await env.DB.prepare('UPDATE quotes SET expenses = ? WHERE id = ?').bind(amount, quoteId).run();
  return json({ ok: true, expenses: amount });
}

// ---------------------------------------------------- operator profile / FAA

// Marketing names → FAA type-designator patterns (the registry's Model field
// says "BD-100-1A10", never "Challenger 350"). Covers common charter types.
const MODEL_ALIASES = [
  [/challenger\s*3(00|50)|cl[- ]?30/i, /^BD-?100/i],
  [/challenger\s*6(0[0-5])/i, /^CL-?600/i],
  [/phenom\s*100/i, /^EMB-?500/i],
  [/phenom\s*300/i, /^EMB-?505/i],
  [/praetor\s*[56]00|legacy\s*4[57]0|legacy\s*500/i, /^EMB-?54[05]|^EMB-?550/i],
  [/legacy\s*6(00|50)/i, /^EMB-?135BJ/i],
  [/citation\s*(excel|xls)/i, /^560-?XL/i],
  [/citation\s*x\b|citation\s*ten/i, /^750/],
  [/citation\s*latitude/i, /^680A/i],
  [/citation\s*longitude/i, /^700/],
  [/citation\s*sovereign/i, /^680(?!A)/i],
  [/citation\s*mustang|mustang/i, /^510/],
  [/citation\s*(m2|cj1)/i, /^525(?![ABC])/i],
  [/citation\s*cj2/i, /^525A/i],
  [/citation\s*cj3/i, /^525B/i],
  [/citation\s*cj4/i, /^525C/i],
  [/citation\s*(v|ultra|encore|560)/i, /^560(?!-?XL)/i],
  [/citation\s*(ii\b|bravo|s550|550)/i, /^S?550/i],
  [/citation\s*(iii|vi\b|vii|650)/i, /^650/],
  [/citation\s*(i\b|isp|501)/i, /^50[01]/],
  [/vision\s*jet|sf-?50/i, /SF50/i],
  [/hondajet|ha-?420/i, /HA-?420/i],
  [/eclipse\s*(500|550)?/i, /EA-?50|^500\b/i],
  [/premier\s*(i|1)?/i, /^390/],
  [/beechjet|hawker\s*400|diamond\s*jet/i, /^400A?|MU-?300/i],
  [/g-?280/i, /G280|GALAXY/i],
  [/g-?150|g-?100|astra/i, /G150|ASTRA|1125/i],
  [/g-?iv|g[- ]?4[05]0|gulfstream\s*iv/i, /^G-?IV|^GIV/i],
  [/g[- ]?v\b|g[- ]?5[05]0|gulfstream\s*v/i, /^G-?V\b|^GV/i],
  [/g[- ]?6[05]0|g[- ]?700|g[- ]?800/i, /^GVI|^G-?VI/i],
  [/global\s*(5[05]00|6[05]00|express|xrs)/i, /^BD-?700(?!-2)/i],
  [/global\s*7[05]00|global\s*8000/i, /^BD-?700-?2/i],
  [/learjet\s*4[05]|learjet\s*7[05]/i, /^45|^40|^70|^75/],
  [/learjet\s*60/i, /^60/],
  [/hawker|h[- ]?(800|850|900)/i, /^HAWKER|^125|^BAE/i],
  [/falcon\s*2000/i, /FALCON\s*2000|^F2000/i],
  [/falcon\s*900/i, /FALCON\s*900|^F900/i],
  [/falcon\s*7x|falcon\s*8x/i, /FALCON\s*[78]X/i],
  [/falcon\s*50/i, /FALCON\s*50|^F50/i],
  [/king\s*air/i, /^B?[23]00|^B?90|^B?100|KING\s*AIR/i],
  [/pilatus|pc-?12/i, /PC-?12/i],
  [/pc-?24/i, /PC-?24/i],
  [/tbm/i, /TBM/i],
];

function matchModel(claim, faaModel) {
  if (!faaModel) return 'not_found';
  const norm = (x) => x.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (norm(faaModel).includes(norm(claim)) || norm(claim).includes(norm(faaModel))) return 'verified';
  for (const [claimRe, faaRe] of MODEL_ALIASES) {
    if (claimRe.test(claim)) return faaRe.test(faaModel.trim()) ? 'verified' : 'mismatch';
  }
  return 'found'; // registered aircraft, model on file, but no alias to auto-compare
}

async function faaLookup(tail) {
  const n = encodeURIComponent(tail.replace(/^N/i, ''));
  try {
    const res = await fetch('https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=' + n, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        accept: 'text/html',
      },
    });
    if (!res.ok) return { ok: false };
    const html = await res.text();
    const grab = (label) => {
      const mm = html.match(new RegExp('data-label="' + label + '">([^<]*)'));
      return mm ? mm[1].trim() : '';
    };
    const mfr = grab('Manufacturer Name');
    const model = grab('Model');
    if (!mfr && !model) return { ok: false };
    return { ok: true, status: grab('Status'), mfr, model };
  } catch {
    return { ok: false, error: true };
  }
}

function requireOrgAdmin(me) {
  if (me.role !== 'operator') return json({ error: 'Operators only' }, 403);
  if (me.orgRole !== 'admin') return json({ error: 'Only your team admin can do this' }, 403);
  return null;
}

async function getTeam(env, me) {
  const members = (await env.DB.prepare(
    'SELECT id, name, email, org_role FROM users WHERE org_id = ? ORDER BY org_role ASC, name ASC'
  ).bind(me.orgId).all()).results;
  let invites = [];
  if (me.orgRole === 'admin') {
    invites = (await env.DB.prepare(
      'SELECT code, used_by, used_at FROM org_invites WHERE org_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(me.orgId).all()).results;
  }
  return { members, invites, myOrgRole: me.orgRole };
}

async function apiCreateInvite(env, me) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const adminPlan = (await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(me.orgId).first())?.plan || 'free';
  if (adminPlan !== 'pro') {
    const seats = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE org_id = ?').bind(me.orgId).first();
    if (seats.n >= 3) return json({ error: 'Free plan includes 3 team seats — Pro removes the limit.' }, 403);
  }
  const open = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM org_invites WHERE org_id = ? AND used_by IS NULL'
  ).bind(me.orgId).first();
  if (open.n >= 10) return json({ error: 'Too many unused invite codes — revoke some first' }, 400);
  const raw = crypto.getRandomValues(new Uint8Array(4));
  const code = 'SLIP-' + toHex(raw).toUpperCase().slice(0, 6);
  await env.DB.prepare('INSERT INTO org_invites (code, org_id) VALUES (?, ?)').bind(code, me.orgId).run();
  return json({ ok: true, code });
}

async function apiRevokeInvite(env, me, code) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  await env.DB.prepare('DELETE FROM org_invites WHERE code = ? AND org_id = ? AND used_by IS NULL')
    .bind(code, me.orgId).run();
  return json({ ok: true });
}

async function apiRemoveMember(env, me, memberId) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  if (memberId === me.id) return json({ error: 'You cannot remove yourself' }, 400);
  // The removed member becomes the admin of their own empty org.
  const r = await env.DB.prepare(
    "UPDATE users SET org_id = id, org_role = 'admin' WHERE id = ? AND org_id = ? AND role = 'operator'"
  ).bind(memberId, me.orgId).run();
  if (!r.meta.changes) return json({ error: 'Member not found' }, 404);
  return json({ ok: true });
}

async function getOperatorProfile(env, userId) {
  const profile = await env.DB.prepare('SELECT * FROM operator_profiles WHERE user_id = ?').bind(userId).first();
  const fleet = (await env.DB.prepare(
    'SELECT * FROM fleet_aircraft WHERE operator_id = ? ORDER BY id ASC'
  ).bind(userId).all()).results;
  const badge = verificationBadge(profile ? {
    cert_number: profile.cert_number,
    cert_faa_name: profile.cert_faa_name,
    d085_name: profile.d085_name,
    fleet_n: fleet.length,
    fleet_ok: fleet.filter(aircraftCleared).length,
  } : null);
  return { profile: profile || null, fleet, badge, clearance: quoteClearance(profile, fleet) };
}

// Sealed quotes and empty legs are reserved for operators who pass three
// checks. Two are automatic: the certificate number matches the FAA's Part 135
// holders list, and the aircraft offered matches the FAA registry and is listed
// on that certificate. The third is a person: the FAA data proves a certificate
// and its aircraft are real, not that the account holder works there, so a
// member of staff approves each operator, for the certificate it was given on.
function quoteClearance(profile, fleet) {
  const certOk = !!(profile && profile.cert_number && profile.cert_faa_name);
  const cleared = certOk ? fleet.filter(aircraftCleared).map((a) => a.tail) : [];
  const autoOk = certOk && cleared.length > 0;
  const decided = profile && profile.review_cert === profile.cert_number ? profile.review_status : null;
  const review = decided === 'approved' || decided === 'declined' ? decided : 'pending';
  let reason = null;
  if (!certOk) reason = profile && profile.cert_number ? 'cert_unmatched' : 'cert_missing';
  else if (!fleet.length) reason = 'no_fleet';
  else if (!cleared.length) reason = 'no_cleared_aircraft';
  else if (review === 'declined') reason = 'review_declined';
  else if (review !== 'approved') reason = 'review_pending';
  return { ok: !reason, certOk, cleared, autoOk, review, reason };
}

// The FAA's published list lags a reissued D085 and the model alias map has
// gaps, so staff can clear a tail the automatic checks cannot. It still has to
// be a valid registration: a tail the registry does not know stays blocked.
function aircraftCleared(a) {
  if (a.faa_status === 'verified' && a.on_cert === 1) return true;
  return a.staff_ok === 1 && STAFF_CLEARABLE.includes(a.faa_status);
}
const STAFF_CLEARABLE = ['verified', 'found', 'mismatch'];

// SQL twins of aircraftCleared() and of "the rating staff confirmed is the one
// claimed", for queries that scan fleet_aircraft as f and join the profile as p.
const AC_CLEARED_SQL = "((f.faa_status = 'verified' AND f.on_cert = 1) OR (f.staff_ok = 1 AND f.faa_status IN ('verified', 'found', 'mismatch')))";
const RATING_SQL = "CASE WHEN p.safety_verified = p.safety_program AND p.safety_expires >= date('now') THEN p.safety_program END AS safety_program";

// The same rule for one profile row, with what staff and the operator need to
// know around it. A confirmation lasts until the expiry date staff read off the
// audit certificate (inclusive, UTC); a confirmation with no date shows nothing.
function ratingState(p) {
  if (!p || !p.safety_program) return { claimed: null, shown: null };
  const today = new Date().toISOString().slice(0, 10);
  const confirmed = p.safety_verified === p.safety_program;
  const expires = confirmed ? p.safety_expires || null : null;
  const expired = confirmed && (!expires || expires < today);
  return {
    claimed: p.safety_program, hasDoc: !!p.safety_doc_name, confirmed, expires, expired,
    daysLeft: expires && !expired ? Math.round((Date.parse(expires) - Date.parse(today)) / 86400000) : null,
    // a certificate uploaded after the confirmation is a renewal waiting for staff
    newDoc: confirmed && !!p.safety_doc_at && !!p.safety_verified_at && p.safety_doc_at > p.safety_verified_at,
    shown: confirmed && !expired ? p.safety_program : null,
  };
}
const RATING_REMIND_DAYS = 30;
const RATING_MAX_YEARS = 5;

const CLEARANCE_MSG = {
  review_pending: 'Your operator account is in review. Quoting opens as soon as the Chartavia team approves it.',
  review_declined: 'Your operator account has not been approved yet. The operator profile shows what we need; resubmit for review from there.',
  cert_missing: 'Quoting opens once your Part 135 certificate is verified. Add the certificate number in the operator profile.',
  cert_unmatched: 'Your certificate number is not on the FAA Part 135 holders list. Check the designator in the operator profile.',
  no_fleet: 'Add the aircraft you operate in the operator profile and run the FAA check to start quoting.',
  no_cleared_aircraft: 'None of your aircraft has passed the FAA check yet. An aircraft must match the FAA registry and be listed on your certificate.',
};

// The aircraft for a quote or an empty leg, or the refusal to send back.
async function clearedAircraft(env, me, choice) {
  const { fleet, badge, clearance } = await getOperatorProfile(env, me.orgId);
  if (!clearance.ok) return { error: json({ error: CLEARANCE_MSG[clearance.reason], code: 'verify' }, 403) };
  const tail = String(choice || '').startsWith('tail:') ? String(choice).slice(5).toUpperCase() : '';
  const ac = fleet.find((a) => a.tail === tail);
  if (!ac) return { error: json({ error: 'Choose an aircraft from your verified fleet' }, 400) };
  if (!clearance.cleared.includes(ac.tail)) {
    return { error: json({
      error: ac.tail + ' has not passed the FAA check, so it cannot be offered yet. Choose a verified aircraft or re-run the check in the operator profile.',
      code: 'verify',
    }, 403) };
  }
  return { aircraft: ac.tail + '|' + ac.model_claim, badge };
}

function certLooksValid(cert) {
  return /^[A-Z0-9]{4,10}$/.test(cert.replace(/[\s-]/g, '').toUpperCase());
}

// Verification summary used for badges on quotes and in the profile UI.
function verificationBadge(p) {
  // p: {cert_number, cert_faa_name, d085_name, fleet_n, fleet_ok}
  if (!p || !p.cert_number) return 'Unverified';
  if (!p.cert_faa_name) return certLooksValid(p.cert_number) ? 'Cert unverified' : 'Unverified';
  if (p.fleet_n > 0 && p.fleet_n === p.fleet_ok && p.d085_name) return 'FAA 135 verified';
  if (p.fleet_n > 0 && p.fleet_n === p.fleet_ok) return 'FAA 135 verified (D085 pending)';
  return 'FAA 135 certificate holder';
}

const SAFETY_PROGRAMS = [
  'ARGUS Gold', 'ARGUS Gold+', 'ARGUS Platinum',
  'Wyvern Registered', 'Wyvern Wingman',
  'IS-BAO Stage 1', 'IS-BAO Stage 2', 'IS-BAO Stage 3',
];

async function apiSaveOperatorProfile(request, env, me) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const company = String(b.company || '').trim().slice(0, 80);
  const cert = String(b.certNumber || '').trim().toUpperCase().slice(0, 20);
  const base = String(b.baseIata || '').trim().toUpperCase().slice(0, 4);
  const safety = SAFETY_PROGRAMS.includes(b.safety) ? b.safety : null;
  // Verify the certificate against the FAA's published Part 135 holders list.
  const faa = cert
    ? await env.DB.prepare('SELECT name FROM faa135_operators WHERE dsgn = ?').bind(cert).first()
    : null;
  const prev = await env.DB.prepare('SELECT cert_number, review_status FROM operator_profiles WHERE user_id = ?').bind(me.orgId).first();
  await env.DB.prepare(
    `INSERT INTO operator_profiles (user_id, company, cert_number, base_iata, safety_program, cert_faa_name, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET company = ?2, cert_number = ?3, base_iata = ?4,
       safety_program = ?5, cert_faa_name = ?6, updated_at = datetime('now')`
  ).bind(me.orgId, company, cert, base, safety, faa ? faa.name : null).run();
  // Which aircraft are "on the certificate" depends on the number just saved.
  await env.DB.prepare(
    `UPDATE fleet_aircraft SET on_cert = CASE
       WHEN ?1 = '' THEN NULL
       WHEN EXISTS (SELECT 1 FROM faa135_aircraft x WHERE x.dsgn = ?1 AND x.tail = fleet_aircraft.tail) THEN 1
       ELSE 0 END
     WHERE operator_id = ?2`
  ).bind(faa ? cert : '', me.orgId).run();
  if (prev && prev.cert_number !== cert) {
    // A staff decision and any aircraft clearance belong to the certificate they were made for.
    await env.DB.prepare(
      `UPDATE operator_profiles SET review_status = NULL, review_cert = NULL, reviewed_at = NULL, reviewed_by = NULL,
         review_requested_at = NULL WHERE user_id = ?`
    ).bind(me.orgId).run();
    await env.DB.prepare('UPDATE fleet_aircraft SET staff_ok = 0, staff_ok_at = NULL, staff_ok_by = NULL WHERE operator_id = ?')
      .bind(me.orgId).run();
    if (prev.review_status) await logStaffAction(env, me.id, me.orgId, 'reset', 'certificate changed from ' + (prev.cert_number || 'none') + ' to ' + (cert || 'none'));
  }
  await maybeRequestReview(env, request, me.orgId);
  return json({ ok: true, certOk: certLooksValid(cert), faaName: faa ? faa.name : null });
}

// -------------------------------------------- aircraft photos + certificate

const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

async function apiUploadAircraftPhoto(request, env, me, aircraftId) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const ac = await env.DB.prepare('SELECT id FROM fleet_aircraft WHERE id = ? AND operator_id = ?')
    .bind(aircraftId, me.orgId).first();
  if (!ac) return json({ error: 'Aircraft not found' }, 404);
  const form = await request.formData().catch(() => null);
  const file = form ? form.get('file') : null;
  if (!file || typeof file === 'string') return json({ error: 'Attach an image' }, 400);
  if (file.size > PHOTO_MAX_BYTES) return json({ error: 'Image too large (max 5 MB)' }, 400);
  if (!PHOTO_TYPES.includes(file.type)) return json({ error: 'Use a JPEG, PNG, or WebP image' }, 400);
  const pbuf = await file.arrayBuffer();
  if (!sniffOk(pbuf, 'image')) return json({ error: 'File does not look like an image' }, 400);
  await env.SLIPSTREAM_KV.put('acphoto:' + aircraftId, pbuf, {
    metadata: { type: file.type },
  });
  await env.DB.prepare("UPDATE fleet_aircraft SET photo_at = datetime('now') WHERE id = ?")
    .bind(aircraftId).run();
  return json({ ok: true });
}

// Aircraft photos are marketing material — any signed-in user can view them.
async function apiGetAircraftPhoto(env, aircraftId) {
  const { value, metadata } = await env.SLIPSTREAM_KV.getWithMetadata('acphoto:' + aircraftId, 'arrayBuffer');
  if (!value) return json({ error: 'No photo' }, 404);
  return new Response(value, {
    headers: {
      'content-type': (metadata && metadata.type) || 'image/jpeg',
      'cache-control': 'private, max-age=300',
    },
  });
}

async function apiUploadCertDoc(request, env, me) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const form = await request.formData().catch(() => null);
  const file = form ? form.get('file') : null;
  if (!file || typeof file === 'string') return json({ error: 'Attach a file' }, 400);
  if (file.size > D085_MAX_BYTES) return json({ error: 'File too large (max 10 MB)' }, 400);
  const name = String(file.name || 'certificate.pdf').slice(0, 120);
  const kbuf = await file.arrayBuffer();
  if (!sniffOk(kbuf, 'pdf')) return json({ error: 'File does not look like a PDF' }, 400);
  await env.SLIPSTREAM_KV.put('cert:' + me.orgId, kbuf, {
    metadata: { name, type: file.type || 'application/pdf' },
  });
  await env.DB.prepare(
    `INSERT INTO operator_profiles (user_id, cert_doc_name, cert_doc_at, updated_at)
     VALUES (?1, ?2, datetime('now'), datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET cert_doc_name = ?2, cert_doc_at = datetime('now'), updated_at = datetime('now')`
  ).bind(me.orgId, name).run();
  return json({ ok: true, name });
}

// The audit certificate behind a declared ARGUS / Wyvern / IS-BAO rating. The
// rating reaches travelers only after staff confirm it against this document.
async function apiUploadSafetyDoc(request, env, me) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const form = await request.formData().catch(() => null);
  const file = form ? form.get('file') : null;
  if (!file || typeof file === 'string') return json({ error: 'Attach a file' }, 400);
  if (file.size > D085_MAX_BYTES) return json({ error: 'File too large (max 10 MB)' }, 400);
  const name = String(file.name || 'audit-certificate.pdf').slice(0, 120);
  const sbuf = await file.arrayBuffer();
  if (!sniffOk(sbuf, 'pdf')) return json({ error: 'File does not look like a PDF' }, 400);
  await env.SLIPSTREAM_KV.put('safetydoc:' + me.orgId, sbuf, {
    metadata: { name, type: file.type || 'application/pdf' },
  });
  await env.DB.prepare(
    `INSERT INTO operator_profiles (user_id, safety_doc_name, safety_doc_at, updated_at)
     VALUES (?1, ?2, datetime('now'), datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET safety_doc_name = ?2, safety_doc_at = datetime('now'), updated_at = datetime('now')`
  ).bind(me.orgId, name).run();
  return json({ ok: true, name });
}

async function apiGetSafetyDoc(env, me) {
  if (me.role !== 'operator') return json({ error: 'Operators only' }, 403);
  return kvDocResponse(env, 'safetydoc:' + me.orgId, 'audit-certificate.pdf');
}

async function kvDocResponse(env, key, fallbackName) {
  const { value, metadata } = await env.SLIPSTREAM_KV.getWithMetadata(key, 'arrayBuffer');
  if (!value) return json({ error: 'No document uploaded' }, 404);
  return new Response(value, {
    headers: {
      'content-type': (metadata && metadata.type) || 'application/pdf',
      'content-disposition': 'inline; filename="' + ((metadata && metadata.name) || fallbackName).replace(/"/g, '') + '"',
      'cache-control': 'no-store',
    },
  });
}

async function apiGetCertDoc(env, me) {
  if (me.role !== 'operator') return json({ error: 'Operators only' }, 403);
  const { value, metadata } = await env.SLIPSTREAM_KV.getWithMetadata('cert:' + me.orgId, 'arrayBuffer');
  if (!value) return json({ error: 'No certificate uploaded' }, 404);
  return new Response(value, {
    headers: {
      'content-type': (metadata && metadata.type) || 'application/pdf',
      'content-disposition': 'inline; filename="' + ((metadata && metadata.name) || 'certificate.pdf').replace(/"/g, '') + '"',
      'cache-control': 'no-store',
    },
  });
}

async function apiAddAircraft(request, env, me) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const tail = String(b.tail || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8);
  const model = String(b.model || '').trim().slice(0, 40);
  if (!/^N[0-9][0-9A-Z]{1,5}$/.test(tail)) return json({ error: 'Enter a valid N-number (e.g. N123AB)' }, 400);
  if (!model) return json({ error: 'Enter the aircraft model' }, 400);
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM fleet_aircraft WHERE operator_id = ?').bind(me.orgId).first();
  if (count.n >= 25) return json({ error: 'Fleet limit reached (25 aircraft)' }, 400);
  try {
    await env.DB.prepare(
      'INSERT INTO fleet_aircraft (operator_id, tail, model_claim) VALUES (?, ?, ?)'
    ).bind(me.orgId, tail, model).run();
  } catch {
    return json({ error: tail + ' is already in your fleet' }, 409);
  }
  return json({ ok: true });
}

async function apiRemoveAircraft(env, me, aircraftId) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  await env.DB.prepare('DELETE FROM fleet_aircraft WHERE id = ? AND operator_id = ?').bind(aircraftId, me.orgId).run();
  return json({ ok: true });
}

async function apiVerifyFleet(env, me, request) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const fleet = (await env.DB.prepare(
    'SELECT * FROM fleet_aircraft WHERE operator_id = ? ORDER BY id ASC LIMIT 25'
  ).bind(me.orgId).all()).results;
  if (!fleet.length) return json({ error: 'Add aircraft to your fleet first' }, 400);

  const prof = await env.DB.prepare('SELECT cert_number, cert_faa_name FROM operator_profiles WHERE user_id = ?').bind(me.orgId).first();
  const cert = prof?.cert_faa_name ? prof.cert_number : '';
  const results = [];
  for (const a of fleet) {
    const r = await faaLookup(a.tail);
    let status;
    if (!r.ok) status = r.error ? 'pending' : 'not_found';
    else if ((r.status || '').toLowerCase() !== 'valid') status = 'not_found';
    else status = matchModel(a.model_claim, r.model);
    // Cross-check: is this tail on the org's Part 135 certificate?
    let onCert = null;
    if (cert) {
      const hit = await env.DB.prepare('SELECT 1 AS x FROM faa135_aircraft WHERE dsgn = ? AND tail = ?')
        .bind(cert, a.tail).first();
      onCert = hit ? 1 : 0;
    }
    await env.DB.prepare(
      `UPDATE fleet_aircraft SET faa_mfr = ?, faa_model = ?, faa_reg_status = ?, faa_status = ?,
       on_cert = ?, checked_at = datetime('now') WHERE id = ?`
    ).bind(r.ok ? r.mfr : null, r.ok ? r.model : null, r.ok ? r.status : null, status, onCert, a.id).run();
    results.push({ tail: a.tail, status, onCert, faaModel: r.ok ? r.model : null, faaMfr: r.ok ? r.mfr : null });
  }
  await env.DB.prepare(
    `INSERT INTO operator_profiles (user_id, checked_at, updated_at) VALUES (?1, datetime('now'), datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET checked_at = datetime('now')`
  ).bind(me.orgId).run();
  await maybeRequestReview(env, request, me.orgId);
  return json({ ok: true, results });
}

const D085_MAX_BYTES = 10 * 1024 * 1024;

async function apiUploadD085(request, env, me) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const form = await request.formData().catch(() => null);
  const file = form ? form.get('file') : null;
  if (!file || typeof file === 'string') return json({ error: 'Attach a file' }, 400);
  if (file.size > D085_MAX_BYTES) return json({ error: 'File too large (max 10 MB)' }, 400);
  const name = String(file.name || 'd085.pdf').slice(0, 120);
  const dbuf = await file.arrayBuffer();
  if (!sniffOk(dbuf, 'pdf')) return json({ error: 'File does not look like a PDF' }, 400);
  await env.SLIPSTREAM_KV.put('d085:' + me.orgId, dbuf, {
    metadata: { name, type: file.type || 'application/pdf' },
  });
  await env.DB.prepare(
    `INSERT INTO operator_profiles (user_id, d085_name, d085_at, updated_at)
     VALUES (?1, ?2, datetime('now'), datetime('now'))
     ON CONFLICT (user_id) DO UPDATE SET d085_name = ?2, d085_at = datetime('now'), updated_at = datetime('now')`
  ).bind(me.orgId, name).run();
  return json({ ok: true, name });
}

async function apiGetD085(env, me) {
  if (me.role !== 'operator') return json({ error: 'Operators only' }, 403);
  const { value, metadata } = await env.SLIPSTREAM_KV.getWithMetadata('d085:' + me.orgId, 'arrayBuffer');
  if (!value) return json({ error: 'No D085 uploaded' }, 404);
  return new Response(value, {
    headers: {
      'content-type': (metadata && metadata.type) || 'application/pdf',
      'content-disposition': 'inline; filename="' + ((metadata && metadata.name) || 'd085.pdf').replace(/"/g, '') + '"',
      'cache-control': 'no-store',
    },
  });
}

// --------------------------------------------------------------- marketplace

// Single payload the app loads on mount and re-polls: the client's own
// requests (with quotes) or the operator's marketplace view (with own bids).
// Demo deposits: refundable hold placed when a request is posted, tiered by
// the largest aircraft category requested. Kept as the platform fee on
// acceptance; refunded if unfulfillable or the client closes the request.
const DEPOSIT_TIERS = { prop: 150, light: 150, mid: 250, smid: 250, heavy: 500, ulr: 500 };
function depositFor(cats) {
  const amounts = (cats || []).map((c) => DEPOSIT_TIERS[c] || 0).filter(Boolean);
  return amounts.length ? Math.max(...amounts) : 250;
}

// ------------------------------------------------------------ shared helpers

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function routeOfLegs(type, legs) {
  if (!legs.length) return '';
  if (type === 'round') return legs[0].from + ' ⇄ ' + legs[0].to;
  return [legs[0].from, ...legs.map((l) => l.to)].join(' → ');
}

// ---------------------------------------------------------------- concierge

const CONCIERGE_TOPICS = { trip: 'Planning a trip', operator: 'Operator partnership', general: 'General' };

// Public: works signed out (the /concierge page) and signed in (the in-app
// dialog). The message is stored before any email goes out, so nothing is
// lost while no mail provider is configured.
async function apiConcierge(request, env) {
  const limited = await rateLimit(request, env, 'concierge');
  if (limited) return limited;
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  if (b.website) return json({ ok: true }); // honeypot: only bots fill it

  const session = await getSession(request, env);
  const user = session
    ? await env.DB.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(session.id).first()
    : null;
  const name = String((user && user.name) || b.name || '').trim().slice(0, 80);
  const email = String((user && user.email) || b.email || '').trim().slice(0, 120).toLowerCase();
  const phone = String(b.phone || '').trim().slice(0, 40);
  const topic = CONCIERGE_TOPICS[b.topic] ? b.topic : 'general';
  const message = String(b.message || '').trim().slice(0, 2000);
  const requestId = /^RQ-\d+$/.test(String(b.requestId || '')) ? String(b.requestId) : null;
  if (!name) return json({ error: 'Tell us your name' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email' }, 400);
  if (message.length < 10) return json({ error: 'Add a few words about what you need' }, 400);

  const res = await env.DB.prepare(
    `INSERT INTO concierge_requests (user_id, name, email, phone, topic, request_id, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(user ? user.id : null, name, email, phone, topic, requestId, message).run();
  const ref = 'CQ-' + res.meta.last_row_id;

  const origin = new URL(request.url).origin;
  await sendEmail(env, email, 'We have your message — ' + ref, emailHtml(
    'We have your message',
    ['Thank you, ' + name.split(/\s+/)[0] + '. A member of the Chartavia team will read your note and reply personally.'],
    'Open Chartavia', origin + '/',
    { kicker: 'CONCIERGE', quote: message, rows: [['Reference', ref], ['Topic', CONCIERGE_TOPICS[topic]]] }
  ));
  if (env.CONCIERGE_EMAIL) {
    await sendEmail(env, env.CONCIERGE_EMAIL, 'Concierge ' + ref + ' from ' + name, emailHtml(
      'New concierge request', ['Reply to the sender directly, then mark it handled on the concierge desk.'],
      'Open the concierge desk', origin + '/app',
      { kicker: 'STAFF', quote: message, rows: [['Reference', ref], ['From', name], ['Email', email], ['Phone', phone || '—'], ['Topic', CONCIERGE_TOPICS[topic]], ['Trip', requestId || '—']] }
    ));
  }
  return json({ ok: true, ref });
}

async function conciergeDesk(env) {
  const rows = (await env.DB.prepare(
    `SELECT c.*, u.role AS user_role FROM concierge_requests c LEFT JOIN users u ON u.id = c.user_id
     ORDER BY (c.status = 'closed'), c.created_at DESC LIMIT 100`
  ).all()).results;
  return {
    newCount: rows.filter((r) => r.status === 'new').length,
    items: rows.map((r) => ({
      id: r.id, ref: 'CQ-' + r.id, name: r.name, email: r.email, phone: r.phone,
      topic: r.topic, topicLabel: CONCIERGE_TOPICS[r.topic] || 'General',
      member: r.user_role || null, requestId: r.request_id, message: r.message,
      status: r.status, note: r.note, ago: timeAgo(r.created_at),
    })),
  };
}

async function apiStaffConcierge(request, env, me, id) {
  if (!me.isStaff) return json({ error: 'Not found' }, 404);
  const b = await request.json().catch(() => null);
  const status = b && ['new', 'open', 'closed'].includes(b.status) ? b.status : null;
  if (!status) return json({ error: 'Invalid status' }, 400);
  const res = await env.DB.prepare(
    `UPDATE concierge_requests SET status = ?, note = COALESCE(?, note), handled_by = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, b.note == null ? null : String(b.note).slice(0, 1000), me.id, id).run();
  if (!res.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true, desk: await conciergeDesk(env) });
}

// ---------------------------------------------------------- operator review

async function logStaffAction(env, actorId, orgId, action, detail) {
  await env.DB.prepare('INSERT INTO staff_actions (actor_id, org_id, action, detail) VALUES (?, ?, ?, ?)')
    .bind(actorId, orgId, action, detail || null).run();
}

// The first time an operator clears both automatic checks they join the review
// queue, and staff hear about it once.
async function maybeRequestReview(env, request, orgId) {
  const op = await getOperatorProfile(env, orgId);
  if (!op.profile || !op.clearance.autoOk || op.clearance.review !== 'pending' || op.profile.review_requested_at) return;
  await env.DB.prepare("UPDATE operator_profiles SET review_requested_at = datetime('now') WHERE user_id = ?").bind(orgId).run();
  if (!env.CONCIERGE_EMAIL) return;
  const origin = new URL(request.url).origin;
  await sendEmail(env, env.CONCIERGE_EMAIL, 'Operator ready for review: ' + (op.profile.company || op.profile.cert_faa_name), emailHtml(
    'An operator is ready for review',
    ['Their certificate and at least one aircraft passed the FAA checks. Confirm the account belongs to the certificate holder, then approve or decline it on the staff desk.'],
    'Open the staff desk', origin + '/app',
    { kicker: 'STAFF', rows: [['Operator', op.profile.company], ['FAA name', op.profile.cert_faa_name], ['Certificate', op.profile.cert_number], ['Cleared aircraft', op.clearance.cleared.join(', ')]] }
  ));
}

const REVIEW_STAGE_ORDER = { ready: 0, rating: 1, incomplete: 2, declined: 3, approved: 4 };
const STAFF_ACTION_LABELS = {
  approve: 'Approved', decline: 'Declined', revoke: 'Approval withdrawn', clear_aircraft: 'Aircraft cleared',
  unclear_aircraft: 'Aircraft clearance removed', confirm_rating: 'Rating confirmed', unconfirm_rating: 'Rating confirmation removed',
  note: 'Note saved', reset: 'Review reset', resubmit: 'Resubmitted for review',
};

// Every operator company with what staff need to decide: who holds the account,
// what the automatic checks found, the documents on file and the last action.
async function operatorReviewDesk(env) {
  const orgs = (await env.DB.prepare(
    `SELECT u.id AS org_id, u.name AS holder, u.email AS holder_email, u.created_at AS joined,
            (SELECT COUNT(*) FROM users m WHERE m.org_id = u.id AND m.id != u.id) AS members, p.*
     FROM users u LEFT JOIN operator_profiles p ON p.user_id = u.id
     WHERE u.role = 'operator' AND COALESCE(u.org_id, u.id) = u.id AND u.hash != 'x'
     ORDER BY u.id DESC LIMIT 200`
  ).all()).results;
  const fleetRows = (await env.DB.prepare('SELECT * FROM fleet_aircraft ORDER BY id ASC LIMIT 5000').all()).results;
  const actions = (await env.DB.prepare(
    `SELECT a.org_id, a.action, a.detail, a.created_at, s.name AS actor
     FROM staff_actions a LEFT JOIN users s ON s.id = a.actor_id ORDER BY a.id DESC LIMIT 500`
  ).all()).results;

  const items = orgs.map((o) => {
    const profile = o.user_id ? o : null;
    const fleet = fleetRows.filter((f) => f.operator_id === o.org_id);
    const clearance = quoteClearance(profile, fleet);
    const rating = ratingState(profile);
    const ratingWaiting = !!rating.claimed && rating.hasDoc && (!rating.confirmed || rating.newDoc);
    const stage = clearance.review === 'approved' ? (ratingWaiting ? 'rating' : 'approved')
      : clearance.review === 'declined' ? 'declined'
      : clearance.autoOk ? 'ready' : (ratingWaiting ? 'rating' : 'incomplete');
    const last = actions.find((a) => a.org_id === o.org_id);
    return {
      orgId: o.org_id, company: (profile && profile.company) || o.holder, holder: o.holder, email: o.holder_email,
      joined: timeAgo(o.joined), members: o.members,
      cert: (profile && profile.cert_number) || '', faaName: (profile && profile.cert_faa_name) || null,
      base: (profile && profile.base_iata) || '',
      badge: verificationBadge(profile ? { ...profile, fleet_n: fleet.length, fleet_ok: fleet.filter(aircraftCleared).length } : null),
      clearance, stage, review: clearance.review,
      waiting: profile && profile.review_requested_at && clearance.review === 'pending' ? timeAgo(profile.review_requested_at) : null,
      fleet: fleet.map((f) => ({
        id: f.id, tail: f.tail, model: f.model_claim, faaMfr: f.faa_mfr, faaModel: f.faa_model, status: f.faa_status,
        onCert: f.on_cert, staffOk: f.staff_ok === 1, cleared: !!(profile && clearance.certOk && aircraftCleared(f)),
        canClear: f.staff_ok !== 1 && STAFF_CLEARABLE.includes(f.faa_status) && !(f.faa_status === 'verified' && f.on_cert === 1),
      })),
      docs: [
        ['certificate', 'Air carrier certificate', profile && profile.cert_doc_name],
        ['d085', 'D085 aircraft listing', profile && profile.d085_name],
        ['safety', 'Safety audit certificate', profile && profile.safety_doc_name],
      ].filter((d) => d[2]).map((d) => ({ kind: d[0], label: d[1], name: d[2] })),
      rating: { ...rating, waiting: ratingWaiting },
      note: (profile && profile.review_note) || '',
      reason: (profile && profile.review_reason) || '', message: (profile && profile.review_message) || '',
      last: last ? (STAFF_ACTION_LABELS[last.action] || last.action) + (last.detail ? ' (' + last.detail + ')' : '') + ' by ' + (last.actor || 'staff') + ' · ' + timeAgo(last.created_at) : null,
    };
  }).sort((a, b) => REVIEW_STAGE_ORDER[a.stage] - REVIEW_STAGE_ORDER[b.stage]);

  return {
    readyCount: items.filter((i) => i.stage === 'ready').length,
    ratingCount: items.filter((i) => i.rating.waiting).length,
    items,
  };
}

async function apiStaffOperator(request, env, me, orgId) {
  if (!me.isStaff) return json({ error: 'Not found' }, 404);
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const org = await env.DB.prepare("SELECT id, name FROM users WHERE id = ? AND role = 'operator'").bind(orgId).first();
  if (!org) return json({ error: 'Operator not found' }, 404);
  const op = await getOperatorProfile(env, orgId);
  if (!op.profile) return json({ error: 'This operator has not started a profile yet' }, 400);
  const p = op.profile;
  const company = p.company || org.name;
  const origin = new URL(request.url).origin;
  const mail = (subject, title, lines, rows, quote) => notifyUser(env, orgId, subject, lines, origin + '/app', 'Open Chartavia',
    { kicker: 'OPERATOR REVIEW', title, quote, rows: [['Operator', company], ...(rows || [])] });
  let detail = null;

  if (b.action === 'approve' || b.action === 'decline') {
    if (b.action === 'approve' && !op.clearance.certOk) {
      return json({ error: 'Approve once the certificate number matches the FAA list. The approval is recorded against that certificate.' }, 400);
    }
    // A decline tells the operator what is missing: that is what they resubmit against.
    const why = b.action === 'decline' ? String(b.reason || '').trim().slice(0, 600) : null;
    if (b.action === 'decline' && why.length < 10) {
      return json({ error: 'Tell the operator what is missing. They see this text and can resubmit once it is in place.' }, 400);
    }
    await env.DB.prepare(
      `UPDATE operator_profiles SET review_status = ?1, review_cert = cert_number, reviewed_at = datetime('now'), reviewed_by = ?2,
         review_reason = ?3, review_message = CASE WHEN ?1 = 'approved' THEN NULL ELSE review_message END WHERE user_id = ?4`
    ).bind(b.action === 'approve' ? 'approved' : 'declined', me.id, why, orgId).run();
    detail = p.cert_number || null;
    if (b.action === 'approve') {
      await mail('Your operator account is approved', 'You are approved to quote', [
        'A member of the Chartavia team has confirmed your operator account.',
        op.clearance.autoOk
          ? 'You can now send sealed quotes and post empty legs with your cleared aircraft.'
          : 'Quoting opens as soon as one of your aircraft passes the FAA check.',
      ], [['Certificate', p.cert_number]]);
    } else {
      await mail('About your operator account', 'We need a little more from you', [
        'We could not yet confirm your operator account for certificate ' + (p.cert_number || 'on file') + ', so quoting stays locked for now. This is what we need:',
        'Once it is in place, open your operator profile and choose "Resubmit for review". Questions? Message the partner desk from the bid desk.',
      ], null, why);
    }
  } else if (b.action === 'revoke') {
    await env.DB.prepare(
      `UPDATE operator_profiles SET review_status = NULL, review_cert = NULL, reviewed_at = datetime('now'), reviewed_by = ? WHERE user_id = ?`
    ).bind(me.id, orgId).run();
    if (op.clearance.review === 'approved') {
      await mail('Quoting is paused on your operator account', 'Your account is back in review', [
        'A member of the Chartavia team is re-checking your operator account, and quoting is paused until that is done.',
        'Your existing quotes and conversations are not affected. Message the partner desk if you have questions.',
      ]);
    }
  } else if (b.action === 'clear_aircraft' || b.action === 'unclear_aircraft') {
    const ac = op.fleet.find((a) => a.id === +b.aircraftId);
    if (!ac) return json({ error: 'Aircraft not found' }, 404);
    if (b.action === 'clear_aircraft') {
      if (!STAFF_CLEARABLE.includes(ac.faa_status)) {
        return json({ error: ac.tail + ' has no valid FAA registration on record. The operator has to run the FAA check first.' }, 400);
      }
      await env.DB.prepare("UPDATE fleet_aircraft SET staff_ok = 1, staff_ok_at = datetime('now'), staff_ok_by = ? WHERE id = ?").bind(me.id, ac.id).run();
      await mail(ac.tail + ' is cleared for quoting', ac.tail + ' is cleared', [
        'A member of the Chartavia team reviewed ' + ac.tail + ' against your documents and cleared it.',
        op.clearance.review === 'approved'
          ? 'You can offer it on sealed quotes and empty legs now.'
          : 'You can offer it on sealed quotes and empty legs once your account review is complete.',
      ], [['Aircraft', ac.model_claim + ' · ' + ac.tail]]);
    } else {
      await env.DB.prepare('UPDATE fleet_aircraft SET staff_ok = 0, staff_ok_at = NULL, staff_ok_by = NULL WHERE id = ?').bind(ac.id).run();
    }
    detail = ac.tail;
  } else if (b.action === 'confirm_rating' || b.action === 'unconfirm_rating') {
    if (b.action === 'confirm_rating') {
      if (!p.safety_program) return json({ error: 'This operator has not declared a rating' }, 400);
      if (!p.safety_doc_name) return json({ error: 'Confirm a rating only against an uploaded audit certificate' }, 400);
      const expires = String(b.expires || '');
      const today = new Date().toISOString().slice(0, 10);
      const latest = new Date(Date.now() + RATING_MAX_YEARS * 366 * 86400000).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(Date.parse(expires))) {
        return json({ error: 'Enter the expiry date shown on the audit certificate' }, 400);
      }
      if (expires < today) return json({ error: 'That audit certificate has already expired' }, 400);
      if (expires > latest) return json({ error: 'An expiry more than ' + RATING_MAX_YEARS + ' years out is not plausible. Check the date.' }, 400);
      await env.DB.prepare(
        `UPDATE operator_profiles SET safety_verified = safety_program, safety_verified_at = datetime('now'),
           safety_expires = ?, safety_reminded = NULL WHERE user_id = ?`
      ).bind(expires, orgId).run();
      await mail('Your ' + p.safety_program + ' rating is confirmed', 'Your safety rating is confirmed', [
        'We checked your audit certificate. ' + p.safety_program + ' now appears on your quotes and empty legs until ' + fmtLegDate(expires) + '.',
        'Upload the renewed certificate before then and we will confirm it again, so the rating never drops off your quotes.',
      ], [['Rating', p.safety_program], ['Valid until', fmtLegDate(expires)]]);
      detail = p.safety_program + ' until ' + expires;
    } else {
      await env.DB.prepare(
        'UPDATE operator_profiles SET safety_verified = NULL, safety_verified_at = NULL, safety_expires = NULL, safety_reminded = NULL WHERE user_id = ?'
      ).bind(orgId).run();
      detail = p.safety_program || null;
    }
  } else if (b.action !== 'note') {
    return json({ error: 'Unknown action' }, 400);
  }

  if (b.note != null) {
    await env.DB.prepare('UPDATE operator_profiles SET review_note = ? WHERE user_id = ?').bind(String(b.note).slice(0, 1000), orgId).run();
  }
  await logStaffAction(env, me.id, orgId, b.action, detail);
  return json({ ok: true, review: await operatorReviewDesk(env) });
}

// A declined operator puts themselves back in the queue once what staff asked
// for is in place. One resubmission per decline: it ends the declined state.
async function apiResubmitReview(request, env, me) {
  const err = requireOrgAdmin(me);
  if (err) return err;
  const limited = await rateLimit(request, env, 'resubmit', me.orgId);
  if (limited) return limited;
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const message = String(b.message || '').trim().slice(0, 1000);
  if (message.length < 10) return json({ error: 'Tell us in a sentence what has changed since the review' }, 400);
  const op = await getOperatorProfile(env, me.orgId);
  if (!op.profile || op.clearance.review !== 'declined') return json({ error: 'There is no declined review to resubmit' }, 409);
  await env.DB.prepare(
    `UPDATE operator_profiles SET review_status = NULL, review_cert = NULL, review_message = ?,
       review_requested_at = datetime('now') WHERE user_id = ?`
  ).bind(message, me.orgId).run();
  await logStaffAction(env, me.id, me.orgId, 'resubmit', message.slice(0, 140));
  if (env.CONCIERGE_EMAIL) {
    await sendEmail(env, env.CONCIERGE_EMAIL, 'Operator resubmitted for review: ' + (op.profile.company || op.profile.cert_faa_name || 'operator'), emailHtml(
      'An operator resubmitted for review',
      ['They were declined earlier and say the following has changed. Review them again on the staff desk.'],
      'Open the staff desk', new URL(request.url).origin + '/app',
      { kicker: 'STAFF', quote: message, rows: [['Operator', op.profile.company], ['Certificate', op.profile.cert_number], ['You asked for', op.profile.review_reason]] }
    ));
  }
  return json({ ok: true });
}

// Tells operators when a confirmed rating is about to lapse and when it has.
// The marker holds the milestone and the date it was sent for, so each email
// goes out once and a re-confirmation with a new date starts over.
async function ratingExpirySweep(env) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await env.DB.prepare(
    `SELECT user_id, company, safety_program, safety_expires, safety_reminded FROM operator_profiles
     WHERE safety_program IS NOT NULL AND safety_verified = safety_program AND safety_expires IS NOT NULL
       AND safety_expires <= date('now', '+${RATING_REMIND_DAYS} days')`
  ).all()).results;
  const origin = env.APP_ORIGIN || '';
  let soon = 0, expired = 0;
  for (const r of rows) {
    const lapsed = r.safety_expires < today;
    const mark = (lapsed ? 'expired:' : 'soon:') + r.safety_expires;
    if (r.safety_reminded === mark || (!lapsed && r.safety_reminded === 'expired:' + r.safety_expires)) continue;
    const when = fmtLegDate(r.safety_expires);
    await notifyUser(env, r.user_id,
      lapsed ? 'Your ' + r.safety_program + ' rating is no longer shown' : 'Your ' + r.safety_program + ' rating expires on ' + when,
      lapsed
        ? ['The audit certificate behind your ' + r.safety_program + ' rating expired on ' + when + ', so the rating no longer appears on your quotes and empty legs.',
           'Upload the renewed certificate in your operator profile and we will confirm it again.']
        : ['The audit certificate behind your ' + r.safety_program + ' rating expires on ' + when + '. After that date the rating stops appearing on your quotes and empty legs.',
           'Upload the renewed certificate in your operator profile and we will confirm it, so there is no gap.'],
      origin ? origin + '/app' : null, 'Open your operator profile',
      { kicker: 'SAFETY RATING', title: lapsed ? 'Your safety rating has expired' : 'Your safety rating expires soon',
        rows: [['Operator', r.company], ['Rating', r.safety_program], [lapsed ? 'Expired' : 'Valid until', when]] });
    await env.DB.prepare('UPDATE operator_profiles SET safety_reminded = ? WHERE user_id = ?').bind(mark, r.user_id).run();
    if (lapsed) expired++; else soon++;
  }
  return { checked: rows.length, remindedSoon: soon, remindedExpired: expired };
}

async function apiStaffOperatorDoc(env, me, orgId, kind) {
  if (!me.isStaff) return json({ error: 'Not found' }, 404);
  const key = { certificate: 'cert:', d085: 'd085:', safety: 'safetydoc:' }[kind] + orgId;
  return kvDocResponse(env, key, kind + '.pdf');
}

// Who operators see as their contact. Configurable per deployment; the default
// is a role, not a person.
function partnerContact(env) {
  return { name: env.PARTNER_NAME || 'Chartavia Partner Desk', title: env.PARTNER_TITLE || 'Operator partnerships' };
}

// ------------------------------------------------------------- public stats

// Figures for the landing page. Anything computed from marketplace activity
// is withheld until the sample is large enough to mean something.
async function apiPublicStats(env) {
  const min = Math.max(1, parseInt(env.STATS_MIN_SAMPLE || '10', 10) || 10);
  const out = { faaOperators: null, faaAircraft: null, verifiedOperators: null, ratings: [], avgTripValue: null, quotesPerRequest: null, firstOfferMins: null };
  try {
    const faa = await env.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM faa135_operators) AS ops, (SELECT COUNT(*) FROM faa135_aircraft) AS ac'
    ).first();
    out.faaOperators = faa.ops || null;
    out.faaAircraft = faa.ac || null;
  } catch (e) { /* FAA tables not loaded in this database */ }

  const orgs = (await env.DB.prepare(
    `SELECT p.cert_number, p.cert_faa_name, p.review_status, p.review_cert, ${RATING_SQL},
            (SELECT COUNT(*) FROM fleet_aircraft f WHERE f.operator_id = p.user_id AND ${AC_CLEARED_SQL}) AS fleet_cleared
     FROM operator_profiles p`
  ).all()).results;
  // Same bar as quoting: certificate on the FAA list, a cleared aircraft, approved by staff.
  const verified = orgs.filter((o) => o.cert_number && o.cert_faa_name && o.fleet_cleared > 0
    && o.review_status === 'approved' && o.review_cert === o.cert_number);
  if (verified.length >= min) out.verifiedOperators = verified.length;
  // Only ratings staff confirmed against the operator's audit certificate.
  out.ratings = [...new Set(verified.filter((o) => o.safety_program).map((o) => o.safety_program))];

  // Seed accounts (hash 'x', unloginable) are placeholders, not activity.
  const trips = await env.DB.prepare(
    `SELECT COUNT(*) AS n, AVG(q.price) AS avg FROM requests r JOIN quotes q ON q.id = r.accepted_quote_id
     JOIN users u ON u.id = r.user_id AND u.hash != 'x'
     WHERE COALESCE(r.trip_status, 'accepted') != 'cancelled'`
  ).first();
  if (trips.n >= min) out.avgTripValue = Math.round(trips.avg / 100) * 100;

  const quoted = (await env.DB.prepare(
    `SELECT COUNT(q.id) AS n, (julianday(MIN(q.created_at)) - julianday(r.created_at)) * 1440 AS mins
     FROM requests r JOIN quotes q ON q.request_id = r.id
     JOIN users u ON u.id = r.user_id AND u.hash != 'x'
     GROUP BY r.id ORDER BY mins`
  ).all()).results;
  if (quoted.length >= min) {
    out.quotesPerRequest = Math.round((quoted.reduce((s, r) => s + r.n, 0) / quoted.length) * 10) / 10;
    const mins = quoted.map((r) => r.mins).filter((m) => m != null && m >= 0);
    if (mins.length) out.firstOfferMins = Math.round(mins[Math.floor(mins.length / 2)]);
  }

  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' },
  });
}

// ------------------------------------------------------------ trip document

const CAT_LABELS = { prop: 'Turboprop', light: 'Light jet', mid: 'Midsize jet', smid: 'Super-midsize jet', heavy: 'Heavy jet', ulr: 'Ultra-long-range jet' };

function fmtLegDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  if (!m) return d || '—';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// A print-ready page for an accepted trip: the traveler, the winning operator's
// team and staff can open it, and the browser's print dialog saves it as a PDF.
async function tripDocPage(request, env, session, requestId) {
  const page = (body, status) => new Response(body, { status: status || 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  const missing = () => page(tripDocShell('Trip not found', '<div class="body"><h1>We could not find that trip</h1><p class="lead">It may not have an accepted offer yet, or it belongs to a different account.</p></div>', ''), 404);

  const req = await env.DB.prepare(
    'SELECT r.*, u.name AS client_name FROM requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?'
  ).bind(requestId).first();
  const viewer = await env.DB.prepare('SELECT id, role, org_id, is_staff FROM users WHERE id = ?').bind(session.id).first();
  if (!req || !req.accepted_quote_id || !viewer) return missing();
  const q = await env.DB.prepare(
    `SELECT q.*, u.name AS operator_name, COALESCE(u.org_id, u.id) AS org
     FROM quotes q JOIN users u ON u.id = q.operator_id WHERE q.id = ?`
  ).bind(req.accepted_quote_id).first();
  if (!q) return missing();
  const isClient = req.user_id === viewer.id;
  const isOperator = viewer.role === 'operator' && (viewer.org_id || viewer.id) === q.org;
  if (!isClient && !isOperator && !viewer.is_staff) return missing();

  const op = await getOperatorProfile(env, q.org);
  const company = (op.profile && op.profile.company) || q.operator_name;
  const cert = op.profile && op.profile.cert_number;
  const legs = JSON.parse(req.legs || '[]');
  const list = (s) => { try { return JSON.parse(s || '[]'); } catch (e) { return []; } };

  let acName, acTail = '', acSeats = '';
  if (q.aircraft.includes('|')) { [acTail, acName] = q.aircraft.split('|'); }
  else { const f = FLEET[q.aircraft] || { name: q.aircraft, seats: '' }; acName = f.name; acSeats = f.seats; }

  const status = req.trip_status || 'accepted';
  const title = { accepted: 'Trip summary', confirmed: 'Trip confirmation', completed: 'Trip record', cancelled: 'Cancelled trip' }[status];
  const statusNote = {
    accepted: 'Offer accepted. Awaiting the operator’s confirmation.',
    confirmed: 'Confirmed by the operator. Your aircraft is reserved.',
    completed: 'Flown and marked complete by the operator.',
    cancelled: 'This trip was cancelled.',
  }[status];
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US');
  const fee = {
    kept: money(req.deposit_amount) + ' deposit applied (demo billing, no charge made)',
    held: money(req.deposit_amount) + ' held (demo billing, no charge made)',
    refunded: 'Refunded', waived_first: 'Waived: first request', waived_plus: 'Waived: Plus member',
  }[req.deposit_status] || '—';
  const kv = (rows) => '<div class="kv">' + rows.filter((r) => r[1]).map((r) => '<div><span>' + escHtml(r[0]) + '</span><span>' + escHtml(r[1]) + '</span></div>').join('') + '</div>';

  const body = '<div class="body">'
    + '<div class="status s-' + status + '">' + escHtml(status.toUpperCase()) + '</div>'
    + '<h1>' + escHtml(title) + '</h1><p class="lead">' + escHtml(statusNote) + '</p>'
    + '<div class="route">' + escHtml(routeOfLegs(req.type, legs)) + '</div>'
    + '<section><div class="k">Itinerary</div><table class="legs"><thead><tr><th>Leg</th><th>Date</th><th>Departs</th><th>From</th><th>To</th></tr></thead><tbody>'
    + legs.map((l, i) => '<tr><td>' + (i + 1) + '</td><td>' + escHtml(fmtLegDate(l.date)) + '</td><td>' + escHtml(l.time ? l.time + ' local' : '—') + '</td><td class="code">' + escHtml(l.from) + '</td><td class="code">' + escHtml(l.to) + '</td></tr>').join('')
    + '</tbody></table></section>'
    + '<section class="grid"><div><div class="k">Aircraft and operator</div>' + kv([
      ['Operator', company], ['Aircraft', acName], ['Registration', acTail], ['Seats', acSeats && String(acSeats)],
      ['Part 135 certificate', cert], ['FAA check', op.badge],
      ['Safety rating (audit certificate confirmed)', ratingState(op.profile).shown],
    ]) + '</div><div><div class="k">Travel party</div>' + kv([
      ['Traveler', req.client_name], ['Passengers', String(req.pax)],
      ['Requested cabin', list(req.cats).map((c) => CAT_LABELS[c] || c).join(', ')],
      ['Special requirements', list(req.needs).join(', ')], ['Add-ons', list(req.addons).join(', ')],
    ]) + '</div></section>'
    + (req.notes ? '<section><div class="k">Notes from the traveler</div><p class="note">' + escHtml(req.notes) + '</p></section>' : '')
    + '<section class="grid"><div><div class="k">Charter price</div><div class="price">' + money(q.price) + '</div>'
    + '<p class="small">Payable directly to ' + escHtml(company) + ' under your charter agreement.</p></div>'
    + '<div><div class="k">Chartavia</div>' + kv([['Platform fee', fee], ['Contract', q.contract_type ? (q.contract_name || 'On file') + ' (in the conversation)' : 'Shared in the conversation when ready'], ['Reference', req.id]]) + '</div></section>'
    + '<p class="fine">This document summarizes a charter arranged on Chartavia. The charter agreement between the traveler and the operator governs the flight, including price, payment, cancellation and liability. '
    + 'Chartavia is a marketplace. It is not a direct or indirect air carrier and does not operate aircraft. '
    + (cert ? 'The flight is operated by ' + escHtml(company) + ' under FAA Part 135 air carrier certificate ' + escHtml(cert) + '.' : 'The flight is operated by ' + escHtml(company) + ', the certificate holder.')
    + ' Questions: message your ' + (isOperator ? 'client' : 'operator') + ' in Chartavia, or reach the concierge from the app.</p>'
    + '<p class="gen">Generated ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC</p></div>';

  return page(tripDocShell(title + ' ' + req.id, body, req.id));
}

function tripDocShell(title, body, ref) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + escHtml(title) + ' — Chartavia</title><meta name="robots" content="noindex">'
    + '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
    + '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;500;600;700&family=Quicksand:wght@600;700&display=swap" rel="stylesheet">'
    + '<style>' + TRIP_DOC_CSS + '</style></head><body>'
    + '<div class="bar"><a href="/app">← Back to Chartavia</a>' + (ref ? '<button onclick="window.print()">Save as PDF or print</button>' : '') + '</div>'
    + '<div class="sheet"><div class="head"><div class="brand"><img class="tile" src="/favicon.svg" alt=""><img class="word" src="/wordmark-white.svg" alt="Chartavia"></div>'
    + (ref ? '<div class="doc"><div class="dk">TRIP REFERENCE</div><div class="id">' + escHtml(ref) + '</div></div>' : '') + '</div>'
    + body + '</div></body></html>';
}

const TRIP_DOC_CSS = `
:root{--navy:#16233b;--blue:#2e6be6;--gold:#c6a667;--gold-ink:#8a6b2e;--ivory:#f8f6f1;--line:#e8e3d9;--slate:#4a5a76;--mist:#68758d}
*{box-sizing:border-box;margin:0}
body{font-family:'Albert Sans',Helvetica,Arial,sans-serif;background:var(--ivory);color:var(--navy);padding:26px 16px 60px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{max-width:820px;margin:0 auto 14px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.bar a{color:var(--mist);font-size:13px;font-weight:600;text-decoration:none}
.bar button{font-family:'Quicksand','Albert Sans',sans-serif;background:var(--navy);color:#fff;border:none;border-radius:999px;padding:10px 20px;font-size:13.5px;font-weight:700;cursor:pointer}
.sheet{max-width:820px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.head{background:var(--navy);color:#fff;padding:24px 40px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid var(--gold)}
.brand{display:flex;align-items:center;gap:12px}.tile{width:38px;height:38px;display:block}.word{height:15px;display:block}
.doc{text-align:right}.dk{font-family:'Quicksand',sans-serif;font-size:10px;letter-spacing:2.4px;color:#dcc48f;font-weight:700}
.id{font-family:ui-monospace,Menlo,monospace;font-size:17px;font-weight:700;margin-top:3px}
.body{padding:32px 40px 28px}
h1{font-family:'Quicksand','Albert Sans',sans-serif;font-size:27px;font-weight:700;letter-spacing:-.4px;margin-top:10px}
.lead{color:var(--slate);font-size:14.5px;margin-top:6px;line-height:1.55}
.status{display:inline-block;font-family:'Quicksand',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:1.8px;padding:4px 11px;border-radius:999px;background:#eef3fd;color:var(--blue)}
.s-confirmed,.s-completed{background:#e8f6ee;color:#1e5e3c}.s-cancelled{background:#fdecec;color:#b3261e}
.route{font-family:ui-monospace,Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:-.5px;margin-top:20px}
section{margin-top:28px}
.k{font-family:'Quicksand',sans-serif;font-size:10.5px;font-weight:700;letter-spacing:2.2px;color:var(--gold-ink);text-transform:uppercase;display:flex;align-items:center;gap:10px;margin-bottom:6px}
.k::before{content:'';width:24px;height:1px;background:var(--gold)}
table.legs{width:100%;border-collapse:collapse;margin-top:6px}
th{text-align:left;font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--mist);font-weight:700;padding:8px 10px 8px 0;border-bottom:1px solid var(--gold)}
td{padding:12px 10px 12px 0;border-bottom:1px solid var(--line);font-size:14px}
td.code{font-family:ui-monospace,Menlo,monospace;font-weight:700;font-size:15px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:26px 40px}
.kv div{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.kv span:first-child{color:var(--mist);flex:none}.kv span:last-child{font-weight:600;text-align:right}
.price{font-family:'Quicksand',sans-serif;font-size:30px;font-weight:700;margin-top:4px}
.small{font-size:12.5px;color:var(--mist);margin-top:4px;line-height:1.5}
.note{font-size:14px;color:var(--slate);line-height:1.6;white-space:pre-wrap}
.fine{margin-top:30px;padding-top:16px;border-top:1px solid var(--line);font-size:11.5px;line-height:1.65;color:var(--mist)}
.gen{font-size:10.5px;color:#a3adc0;margin-top:10px}
@media (max-width:640px){.head{padding:20px}.body{padding:24px 20px}.grid{grid-template-columns:1fr}.route{font-size:23px}h1{font-size:23px}}
@media print{body{background:#fff;padding:0}.bar{display:none}.sheet{border:none;border-radius:0;max-width:none}@page{margin:12mm}section,.fine{break-inside:avoid}}
`;

// ------------------------------------------------------------------- email

// Sends via Resend when RESEND_API_KEY is configured; otherwise records the
// email in email_outbox (demo mode) so triggers are verifiable end to end.
async function sendEmail(env, to, subject, html) {
  try {
    if (env.RESEND_API_KEY) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM || 'Chartavia <onboarding@resend.dev>', to: [to], subject, html }),
      });
    } else {
      await env.DB.prepare('INSERT INTO email_outbox (to_email, subject, html) VALUES (?, ?, ?)')
        .bind(to, subject, html).run();
    }
  } catch (e) { console.error('sendEmail failed:', e.message); }
}

// Table layout and inline styles only: that is what survives Outlook and
// Gmail. Everything dynamic is escaped. opts: { kicker, rows: [[label, value]],
// quote, preheader }.
function emailHtml(title, lines, ctaText, ctaUrl, opts) {
  const o = opts || {};
  let origin = '';
  try { if (ctaUrl) origin = new URL(ctaUrl).origin; } catch (e) { /* relative link: no icon */ }
  const font = 'font-family:Helvetica,Arial,sans-serif;';
  const rows = (o.rows || []).filter((r) => r[1] != null && r[1] !== '');
  return '<!doctype html><html><body style="margin:0;padding:0;background:#f8f6f1">'
    + '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + escHtml(o.preheader || lines[0] || title) + '</div>'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f1"><tr><td align="center" style="padding:28px 12px">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">'
    + '<tr><td style="background:#16233b;padding:20px 32px;border-bottom:2px solid #c6a667;border-radius:6px 6px 0 0">'
    + (origin ? '<img src="' + origin + '/icon-192.png" width="30" height="30" alt="" style="border-radius:7px;vertical-align:middle;margin-right:11px">' : '')
    + '<span style="' + font + 'font-size:15px;font-weight:700;letter-spacing:4px;color:#ffffff;vertical-align:middle">CHARTAVIA</span></td></tr>'
    + '<tr><td style="background:#ffffff;padding:34px 32px 30px;border:1px solid #e8e3d9;border-top:none">'
    + (o.kicker ? '<div style="' + font + 'font-size:11px;font-weight:700;letter-spacing:2.4px;color:#8a6b2e;margin-bottom:10px">' + escHtml(o.kicker) + '</div>' : '')
    + '<div style="' + font + 'font-size:23px;line-height:1.25;font-weight:700;color:#16233b;margin-bottom:14px">' + escHtml(title) + '</div>'
    + lines.map((l) => '<p style="' + font + 'font-size:15px;color:#4a5a76;line-height:1.65;margin:0 0 12px">' + escHtml(l) + '</p>').join('')
    + (o.quote ? '<div style="' + font + 'margin-top:6px;padding:14px 16px;background:#f8f6f1;border-left:3px solid #c6a667;font-size:14px;line-height:1.6;color:#4a5a76;white-space:pre-wrap">' + escHtml(o.quote) + '</div>' : '')
    + (rows.length ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #c6a667">'
      + rows.map((r) => '<tr><td style="' + font + 'padding:10px 0;border-bottom:1px solid #e8e3d9;font-size:11.5px;letter-spacing:.8px;text-transform:uppercase;color:#8593ab;width:40%">' + escHtml(r[0])
        + '</td><td style="' + font + 'padding:10px 0;border-bottom:1px solid #e8e3d9;font-size:14px;font-weight:700;color:#16233b;text-align:right">' + escHtml(r[1]) + '</td></tr>').join('')
      + '</table>' : '')
    + (ctaUrl ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px"><tr><td style="background:#2e6be6;border-radius:999px">'
      + '<a href="' + escHtml(ctaUrl) + '" style="' + font + 'display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">' + escHtml(ctaText || 'Open Chartavia') + '</a></td></tr></table>' : '')
    + '</td></tr>'
    + '<tr><td style="' + font + 'padding:20px 32px 0;font-size:11.5px;line-height:1.6;color:#8593ab">You received this because of your activity with Chartavia.<br>'
    + 'Chartavia is an air charter broker, not a direct air carrier. Every flight is operated by an FAA-certificated Part 135 operator.'
    + (origin ? '<br><a href="' + origin + '/terms" style="color:#8593ab">Terms of Service</a> &middot; <a href="' + origin + '/privacy" style="color:#8593ab">Privacy Policy</a>' : '')
    + '</td></tr>'
    + '</table></td></tr></table></body></html>';
}

async function notifyUser(env, userId, subject, lines, ctaUrl, ctaText, opts) {
  const u = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?').bind(userId).first();
  if (!u) return;
  await sendEmail(env, u.email, subject, emailHtml((opts && opts.title) || subject, lines, ctaText, ctaUrl, opts));
}

// At most one email per key per hour (e.g. chat pings per conversation).
async function shouldNotify(env, key) {
  const k = key + ':' + Math.floor(Date.now() / 3600000);
  const existing = await env.DB.prepare('SELECT k FROM email_notif WHERE k = ?').bind(k).first();
  if (existing) return false;
  await env.DB.prepare("INSERT OR IGNORE INTO email_notif (k, at) VALUES (?, datetime('now'))").bind(k).run();
  await env.DB.prepare("DELETE FROM email_notif WHERE at < datetime('now', '-3 hours')").run();
  return true;
}

async function apiBootstrap(env, me) {
  const row = await env.DB.prepare('SELECT name, prefs, plan FROM users WHERE id = ?').bind(me.id).first();
  const meOut = {
    ...publicUser(me),
    name: row ? row.name : me.name,
    prefs: JSON.parse(row?.prefs || '{}'),
    plan: row?.plan || 'free',
    isStaff: !!me.isStaff,
  };
  if (me.role === 'client') {
    return json({
      me: meOut, requests: await clientRequests(env, me), emptyLegs: await emptyLegBoard(env),
      concierge: me.isStaff ? await conciergeDesk(env) : null,
      review: me.isStaff ? await operatorReviewDesk(env) : null,
    });
  }
  // The plan is org-wide: members inherit the admin's plan.
  const adminRow = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(me.orgId).first();
  meOut.plan = adminRow?.plan || 'free';
  meOut.orgRole = me.orgRole;
  if (meOut.plan === 'pro') {
    // Pro perk: win-rate analytics across the org's bidding history.
    const st = await env.DB.prepare(
      `SELECT COUNT(*) AS sent,
              COALESCE(SUM(CASE WHEN q.id = r.accepted_quote_id THEN 1 ELSE 0 END), 0) AS won
       FROM quotes q JOIN requests r ON r.id = q.request_id
       WHERE q.operator_id IN (SELECT id FROM users WHERE org_id = ?)`
    ).bind(me.orgId).first();
    meOut.stats = { sent: st.sent, won: st.won };
  }
  const profile = await getOperatorProfile(env, me.orgId);
  if (profile.profile) {
    // Staff notes and who reviewed are internal.
    const { review_note, reviewed_by, ...visible } = profile.profile;
    profile.profile = visible;
  }
  profile.team = await getTeam(env, me);
  return json({
    me: meOut,
    marketplace: await operatorMarketplace(env, me, meOut.plan),
    inbox: await operatorInbox(env, me),
    operatorProfile: profile,
    myEmptyLegs: await myEmptyLegs(env, me),
    analytics: await operatorAnalytics(env, me),
    partner: partnerContact(env),
    concierge: me.isStaff ? await conciergeDesk(env) : null,
    review: me.isStaff ? await operatorReviewDesk(env) : null,
  });
}

// Demo billing: instantly flips the plan — no payment processor involved.
// Operator plans live on the org admin's row; members can't change them.
async function apiBillingChange(env, me, dir) {
  if (me.role === 'operator' && me.orgRole !== 'admin') {
    return json({ error: 'Your team admin manages the plan' }, 403);
  }
  const paid = me.role === 'operator' ? 'pro' : 'plus';
  const plan = dir === 'up' ? paid : 'free';
  await env.DB.prepare('UPDATE users SET plan = ? WHERE id = ?').bind(plan, me.id).run();
  return json({ ok: true, plan });
}

// Every quote this operator has sent, as a conversation list: client + route,
// message count, latest message, and whether the bid won (request booked on it).
async function operatorInbox(env, me) {
  const rows = (await env.DB.prepare(
    `SELECT q.id AS quote_id, q.request_id, q.price, r.type, r.legs, r.accepted_quote_id, r.trip_status,
            q.contract_type, q.contract_name, q.contract_url,
            u.name AS client_name,
            (SELECT COUNT(*) FROM messages m WHERE m.quote_id = q.id) AS msg_count,
            (SELECT text FROM messages m WHERE m.quote_id = q.id
             ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_msg,
            (SELECT MAX(m.created_at) FROM messages m WHERE m.quote_id = q.id) AS last_at,
            (SELECT COUNT(*) FROM messages m WHERE m.quote_id = q.id
             AND m.sender_id NOT IN (SELECT id FROM users WHERE org_id = ?1)
             AND m.created_at > COALESCE((SELECT cr.last_read_at FROM chat_reads cr
                                          WHERE cr.quote_id = q.id AND cr.user_id = ?2), '')) AS unread
     FROM quotes q
     JOIN requests r ON r.id = q.request_id
     JOIN users u ON u.id = r.user_id
     WHERE q.operator_id IN (SELECT id FROM users WHERE org_id = ?1)
     ORDER BY COALESCE(last_at, q.created_at) DESC`
  ).bind(me.orgId, me.id).all()).results;

  return rows.map((r) => ({
    quoteId: r.quote_id,
    requestId: r.request_id,
    type: r.type,
    legs: JSON.parse(r.legs),
    // Clients show as "First L." until this quote is the accepted one.
    client: r.accepted_quote_id === r.quote_id ? r.client_name : maskName(r.client_name),
    price: r.price,
    msgCount: r.msg_count,
    lastMsg: r.last_msg,
    unread: r.unread || 0,
    won: r.accepted_quote_id === r.quote_id,
    booked: r.accepted_quote_id != null,
    tripStatus: r.accepted_quote_id === r.quote_id ? r.trip_status : null,
    contract: contractShape({ id: r.quote_id, contract_type: r.contract_type, contract_name: r.contract_name, contract_url: r.contract_url }),
  }));
}

async function clientRequests(env, me) {
  // Lazy expiry: open requests older than 72h with zero quotes auto-close and
  // refund any held deposit ("not fulfillable").
  await env.DB.prepare(
    `UPDATE requests SET closed_at = datetime('now'),
       deposit_status = CASE WHEN deposit_status = 'held' THEN 'refunded' ELSE deposit_status END
     WHERE user_id = ?1 AND accepted_quote_id IS NULL AND closed_at IS NULL
       AND created_at < datetime('now', '-72 hours')
       AND id NOT IN (SELECT DISTINCT request_id FROM quotes)`
  ).bind(me.id).run();

  const reqs = (await env.DB.prepare(
    'SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(me.id).all()).results;
  if (!reqs.length) return [];

  const quotes = (await env.DB.prepare(
    `SELECT q.*, u.name AS operator_name,
            p.company AS op_company, p.cert_number, p.cert_faa_name, p.d085_name, ${RATING_SQL},
            (SELECT plan FROM users WHERE id = COALESCE(u.org_id, u.id)) AS org_plan,
            (SELECT ROUND(AVG(rv.stars), 1) FROM reviews rv
             WHERE rv.operator_org = COALESCE(u.org_id, u.id)) AS avg_rating,
            (SELECT COUNT(*) FROM reviews rv
             WHERE rv.operator_org = COALESCE(u.org_id, u.id)) AS review_n,
            (SELECT ROUND(AVG((julianday(q2.created_at) - julianday(r2.created_at)) * 1440))
             FROM quotes q2 JOIN requests r2 ON r2.id = q2.request_id
             WHERE q2.operator_id IN (SELECT id FROM users WHERE org_id = COALESCE(u.org_id, u.id))) AS resp_mins,
            (SELECT f.id FROM fleet_aircraft f WHERE f.operator_id = COALESCE(u.org_id, u.id)
             AND f.photo_at IS NOT NULL AND instr(q.aircraft, f.tail || '|') = 1) AS photo_ac_id,
            (SELECT COUNT(*) FROM fleet_aircraft f WHERE f.operator_id = COALESCE(u.org_id, u.id)) AS fleet_n,
            (SELECT COUNT(*) FROM fleet_aircraft f WHERE f.operator_id = COALESCE(u.org_id, u.id)
             AND ${AC_CLEARED_SQL}) AS fleet_ok,
            (SELECT COUNT(*) FROM messages m WHERE m.quote_id = q.id AND m.sender_id != ?1
             AND m.created_at > COALESCE((SELECT cr.last_read_at FROM chat_reads cr
                                          WHERE cr.quote_id = q.id AND cr.user_id = ?1), '')) AS unread
     FROM quotes q
     JOIN users u ON u.id = q.operator_id
     LEFT JOIN operator_profiles p ON p.user_id = COALESCE(u.org_id, u.id)
     WHERE q.request_id IN (SELECT id FROM requests WHERE user_id = ?1)
     ORDER BY q.created_at ASC`
  ).bind(me.id).all()).results;

  const reviews = (await env.DB.prepare(
    'SELECT request_id, stars, text FROM reviews WHERE client_id = ?'
  ).bind(me.id).all()).results;

  return reqs.map((r) => ({
    ...requestShape(r),
    mine: true,
    status: r.accepted_quote_id ? 'quotes' : quotes.some((q) => q.request_id === r.id) ? 'quotes' : 'collecting',
    acceptedQuoteId: r.accepted_quote_id,
    tripStatus: r.trip_status,
    depositAmount: r.deposit_amount,
    depositStatus: r.deposit_status,
    closedAt: r.closed_at,
    review: (() => {
      const v = reviews.find((x) => x.request_id === r.id);
      return v ? { stars: v.stars, text: v.text } : null;
    })(),
    // Operators are anonymous until acceptance: only the accepted quote's
    // operator is revealed; the rest stay "Operator A/B/C" forever.
    // Pro perk: priority placement — Pro operators' quotes list first.
    quotes: quotes
      .filter((q) => q.request_id === r.id)
      .sort((a, b) => ((b.org_plan === 'pro') - (a.org_plan === 'pro')) || (a.created_at < b.created_at ? -1 : 1))
      .map((q, i) =>
        quoteShape(q, { revealed: r.accepted_quote_id === q.id, label: 'Operator ' + String.fromCharCode(65 + i) })
      ),
  }));
}

async function operatorMarketplace(env, me, plan) {
  // Pro perk: instant access. Free operators see new requests after 15 min.
  const delay = plan === 'pro' ? '' : " AND r.created_at <= datetime('now', '-15 minutes')";
  const reqs = (await env.DB.prepare(
    `SELECT r.*, COUNT(q.id) AS bid_count,
            MAX(CASE WHEN q.operator_id IN (SELECT id FROM users WHERE org_id = ?1)
                THEN q.price END) AS my_price
     FROM requests r LEFT JOIN quotes q ON q.request_id = r.id
     WHERE r.accepted_quote_id IS NULL AND r.closed_at IS NULL${delay}
     GROUP BY r.id ORDER BY r.created_at DESC`
  ).bind(me.orgId).all()).results;

  return reqs.map((r) => ({
    ...requestShape(r),
    bids: r.bid_count,
    myBid: r.my_price != null ? { price: r.my_price } : null,
    booked: !!r.accepted_quote_id,
  }));
}

function requestShape(r) {
  return {
    id: r.id,
    type: r.type,
    legs: JSON.parse(r.legs),
    pax: r.pax,
    flexDays: r.flex_days,
    cats: JSON.parse(r.cats),
    budget: r.budget,
    needs: JSON.parse(r.needs),
    addons: JSON.parse(r.addons),
    notes: r.notes,
    posted: timeAgo(r.created_at),
  };
}

function quoteShape(q, anon) {
  const revealed = !anon || anon.revealed;
  // aircraft is either a catalog id (p300/xls/…) or 'TAIL|Model' from a
  // profile-fleet bid. Tail numbers identify operators (public FAA registry),
  // so they hide until acceptance — as do photos, which can show the tail.
  let acName, acSeats = '—';
  if (q.aircraft.includes('|')) {
    const [tail, model] = q.aircraft.split('|');
    acName = revealed ? model + ' · ' + tail : model;
  } else {
    const fleet = FLEET[q.aircraft] || { name: q.aircraft, seats: '—' };
    acName = fleet.name;
    acSeats = fleet.seats;
  }
  const badge = verificationBadge(q.cert_number !== undefined ? q : null);
  return {
    id: q.id,
    op: revealed ? (q.op_company || q.operator_name) : anon.label,
    safety: q.safety_program || badge,
    verif: badge,
    photo: revealed && q.photo_ac_id ? '/api/fleet/' + q.photo_ac_id + '/photo' : false,
    rating: q.review_n ? q.avg_rating : '—',
    reviews: q.review_n || 0,
    resp: fmtResponseTime(q.resp_mins),
    aircraft: acName,
    year: '',
    seats: acSeats,
    price: q.price,
    valid: q.valid_hours + ' h',
    emptyLeg: !!q.empty_leg,
    note: q.message ? (revealed ? q.message : redactContact(q.message)) : false,
    unread: q.unread || 0,
    contract: contractShape(q),
  };
}

// Average time from request posted to this operator's quote, humanized.
function fmtResponseTime(mins) {
  if (mins == null) return '—';
  if (mins < 1) return '<1 min';
  if (mins < 60) return '~' + Math.round(mins) + ' min';
  if (mins < 2880) return '~' + Math.round(mins / 60) + ' h';
  return '~' + Math.round(mins / 1440) + ' d';
}

function contractShape(q) {
  if (!q.contract_type) return null;
  return {
    type: q.contract_type,
    name: q.contract_name || 'Contract',
    url: q.contract_type === 'link' ? q.contract_url : '/api/quotes/' + q.id + '/contract',
  };
}

async function apiCreateRequest(request, env, me) {
  if (me.role !== 'client') return json({ error: 'Only travelers can post requests' }, 403);
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);

  const type = ['oneway', 'round', 'multi'].includes(b.type) ? b.type : 'oneway';
  const legs = Array.isArray(b.legs) ? b.legs.slice(0, 6).map((l) => ({
    from: String(l.from || '').slice(0, 4).toUpperCase(),
    to: String(l.to || '').slice(0, 4).toUpperCase(),
    date: String(l.date || '').slice(0, 10),
    time: String(l.time || '').slice(0, 5),
  })) : [];
  if (!legs.length || legs.some((l) => !l.from || !l.to)) {
    return json({ error: 'Every leg needs a from and to airport' }, 400);
  }
  const pax = Math.min(18, Math.max(1, +b.pax || 1));
  const flexDays = Math.min(3, Math.max(0, +b.flexDays || 0));
  const clean = (arr, max) => (Array.isArray(arr) ? arr.slice(0, max).map((x) => String(x).slice(0, 40)) : []);

  const next = await env.DB.prepare(
    "SELECT COALESCE(MAX(CAST(SUBSTR(id, 4) AS INTEGER)), 2480) + 1 AS n FROM requests"
  ).first();
  const id = 'RQ-' + next.n;

  // Demo deposit: Plus members waived; first-ever request free; otherwise a
  // refundable hold tiered by aircraft category.
  const acct = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(me.id).first();
  const prior = await env.DB.prepare('SELECT COUNT(*) AS n FROM requests WHERE user_id = ?').bind(me.id).first();
  let depositStatus, depositAmount = 0;
  if ((acct?.plan || 'free') === 'plus') depositStatus = 'waived_plus';
  else if (prior.n === 0) depositStatus = 'waived_first';
  else { depositStatus = 'held'; depositAmount = depositFor(b.cats); }

  await env.DB.prepare(
    `INSERT INTO requests (id, user_id, type, legs, pax, flex_days, cats, budget, needs, addons, notes, deposit_amount, deposit_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, me.id, type, JSON.stringify(legs), pax, flexDays,
    JSON.stringify(clean(b.cats, 6)), String(b.budget || '').slice(0, 20),
    JSON.stringify(clean(b.needs, 8)), JSON.stringify(clean(b.addons, 8)),
    String(b.notes || '').slice(0, 1000), depositAmount, depositStatus
  ).run();

  const row = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first();
  return json({
    ...requestShape(row), mine: true, status: 'collecting', acceptedQuoteId: null, quotes: [],
    depositAmount, depositStatus, closedAt: null,
  });
}

async function apiSubmitQuote(request, env, me, requestId) {
  if (me.role !== 'operator') return json({ error: 'Only operators can submit quotes' }, 403);
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const pick = await clearedAircraft(env, me, b.aircraft);
  if (pick.error) return pick.error;
  const aircraft = pick.aircraft;

  const req = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(requestId).first();
  if (!req) return json({ error: 'Request not found' }, 404);
  if (req.accepted_quote_id) return json({ error: 'This request already has an accepted quote' }, 409);

  if (req.closed_at) return json({ error: 'This request was closed by the client' }, 409);

  // One quote per operator TEAM per request.
  const teamBid = await env.DB.prepare(
    'SELECT id FROM quotes WHERE request_id = ? AND operator_id IN (SELECT id FROM users WHERE org_id = ?)'
  ).bind(requestId, me.orgId).first();
  if (teamBid) return json({ error: 'Your team already submitted a quote for this request' }, 409);

  const price = Math.round(+b.price);
  if (!Number.isFinite(price) || price <= 0 || price > 5_000_000) {
    return json({ error: 'Enter a valid price' }, 400);
  }
  const validHours = [24, 48, 72].includes(+b.validHours) ? +b.validHours : 48;

  try {
    await env.DB.prepare(
      `INSERT INTO quotes (request_id, operator_id, aircraft, price, message, empty_leg, valid_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      requestId, me.id, aircraft, price,
      String(b.message || '').slice(0, 500), b.emptyLeg ? 1 : 0, validHours
    ).run();
  } catch (e) {
    return json({ error: 'You already submitted a quote for this request' }, 409);
  }
  {
    const route = routeOfLegs(req.type, JSON.parse(req.legs || '[]'));
    await notifyUser(env, req.user_id, 'New sealed offer on ' + requestId,
      ['An operator has answered your request with a sealed offer. Their identity stays private until you accept.',
       'Compare it side by side with your other offers, message the operator, and accept when you are ready.'],
      new URL(request.url).origin + '/app', 'View your offers',
      { kicker: 'NEW OFFER', title: 'A new offer for ' + route, rows: [
        ['Trip', requestId], ['Route', route],
        ['Aircraft', aircraft.split('|')[1]],
        ['Offer', '$' + price.toLocaleString('en-US')], ['FAA check', pick.badge], ['Valid for', validHours + ' hours'],
      ] });
  }
  return json({ ok: true, price });
}

async function apiAcceptQuote(request, env, me, requestId) {
  const b = await request.json().catch(() => null);
  const quoteId = b ? +b.quoteId : NaN;
  if (!Number.isFinite(quoteId)) return json({ error: 'Invalid quote id' }, 400);

  const req = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(requestId).first();
  if (!req || req.user_id !== me.id) return json({ error: 'Request not found' }, 404);
  if (req.accepted_quote_id) return json({ error: 'A quote is already accepted' }, 409);

  const quote = await env.DB.prepare('SELECT * FROM quotes WHERE id = ? AND request_id = ?')
    .bind(quoteId, requestId).first();
  if (!quote) return json({ error: 'Quote not found' }, 404);

  // Acceptance keeps a held deposit as the platform fee and reveals the
  // winning operator's identity.
  await env.DB.prepare(
    `UPDATE requests SET accepted_quote_id = ?, trip_status = 'accepted',
       deposit_status = CASE WHEN deposit_status = 'held' THEN 'kept' ELSE deposit_status END
     WHERE id = ?`
  ).bind(quoteId, requestId).run();
  {
    const winner = await env.DB.prepare(
      'SELECT q.operator_id, COALESCE(u.org_id, u.id) AS org FROM quotes q JOIN users u ON u.id = q.operator_id WHERE q.id = ?'
    ).bind(quoteId).first();
    if (winner) {
      const origin = new URL(request.url).origin;
      const legs = JSON.parse(req.legs || '[]');
      const route = routeOfLegs(req.type, legs);
      const rows = [['Trip', requestId], ['Route', route], ['First departure', legs[0] ? fmtLegDate(legs[0].date) : ''],
        ['Passengers', String(req.pax)], ['Price', '$' + Number(quote.price).toLocaleString('en-US')]];
      const lines = ['Your sealed quote on ' + requestId + ' was accepted. Your identity is now visible to the client.',
        'Open the conversation to coordinate the contract and confirm the trip. A printable trip sheet is linked there.'];
      const won = { kicker: 'TRIP WON', title: 'Your quote was accepted', rows };
      await notifyUser(env, winner.operator_id, 'Your quote was accepted \u2014 ' + requestId, lines, origin + '/app', 'Open the conversation', won);
      if (winner.org !== winner.operator_id) {
        await notifyUser(env, winner.org, 'Your team won ' + requestId, lines, origin + '/app', 'Open the conversation', won);
      }
      await notifyUser(env, me.id, 'Offer accepted \u2014 ' + requestId,
        ['Your operator now has your details and will confirm the aircraft. The charter agreement and payment are settled directly with them.',
         'Your trip summary is ready to view, save as a PDF, or forward.'],
        origin + '/trip/' + requestId, 'View your trip summary',
        { kicker: 'OFFER ACCEPTED', title: 'You are on your way: ' + route, rows });
    }
  }
  return json({ ok: true, acceptedQuoteId: quoteId });
}

// Client closes a quoted-but-unaccepted request: "none of these work" — the
// held deposit refunds in full.
async function apiCloseRequest(env, me, requestId) {
  const req = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(requestId).first();
  if (!req || req.user_id !== me.id) return json({ error: 'Request not found' }, 404);
  if (req.accepted_quote_id) return json({ error: 'You already accepted a quote' }, 409);
  if (req.closed_at) return json({ error: 'Request is already closed' }, 409);
  await env.DB.prepare(
    `UPDATE requests SET closed_at = datetime('now'),
       deposit_status = CASE WHEN deposit_status = 'held' THEN 'refunded' ELSE deposit_status END
     WHERE id = ?`
  ).bind(requestId).run();
  return json({ ok: true });
}

// Trip lifecycle: accepted -> confirmed -> completed, cancellable by either
// party until completed. Confirm/complete are the winning operator's calls.
async function apiTripAction(request, env, me, requestId) {
  const b = await request.json().catch(() => null);
  const action = b ? String(b.action || '') : '';
  if (!['confirm', 'complete', 'cancel'].includes(action)) return json({ error: 'Invalid action' }, 400);

  const req = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(requestId).first();
  if (!req || !req.accepted_quote_id) return json({ error: 'Trip not found' }, 404);

  const q = await env.DB.prepare(
    `SELECT COALESCE(u.org_id, u.id) AS org FROM quotes q JOIN users u ON u.id = q.operator_id WHERE q.id = ?`
  ).bind(req.accepted_quote_id).first();
  const isClient = req.user_id === me.id;
  const isWinningOp = me.role === 'operator' && q && q.org === me.orgId;
  if (!isClient && !isWinningOp) return json({ error: 'Trip not found' }, 404);

  const cur = req.trip_status || 'accepted';
  let next;
  if (action === 'confirm') {
    if (!isWinningOp) return json({ error: 'Only the operator can confirm the trip' }, 403);
    if (cur !== 'accepted') return json({ error: 'Trip is ' + cur + ' — cannot confirm' }, 409);
    next = 'confirmed';
  } else if (action === 'complete') {
    if (!isWinningOp) return json({ error: 'Only the operator can mark the trip completed' }, 403);
    if (cur !== 'confirmed') return json({ error: 'Trip is ' + cur + ' — confirm it first' }, 409);
    next = 'completed';
  } else {
    if (cur === 'completed' || cur === 'cancelled') return json({ error: 'Trip is already ' + cur }, 409);
    next = 'cancelled';
  }
  // An operator calling off an accepted trip means it can't be flown for the
  // traveler, so the deposit that became our fee at acceptance goes back
  // (Terms 3.3). A traveler cancelling keeps it as the fee.
  const refunded = next === 'cancelled' && isWinningOp && req.deposit_status === 'kept';
  await env.DB.prepare(
    `UPDATE requests SET trip_status = ?1,
       deposit_status = CASE WHEN ?2 = 1 AND deposit_status = 'kept' THEN 'refunded' ELSE deposit_status END
     WHERE id = ?3`
  ).bind(next, refunded ? 1 : 0, requestId).run();
  {
    const origin = new URL(request.url).origin;
    const label = next === 'confirmed' ? 'Your trip is confirmed'
      : next === 'completed' ? 'Your trip is complete'
      : 'Trip cancelled';
    const line = next === 'confirmed' ? 'The operator confirmed ' + requestId + ' \u2014 your aircraft is locked in.'
      : next === 'completed' ? requestId + ' is marked complete. How was it? Leave a review to help other travelers.'
      : requestId + ' was cancelled.' + (refunded ? ' Your deposit is refunded in full.' : '');
    const update = { kicker: 'TRIP UPDATE', title: label, rows: [
      ['Trip', requestId], ['Route', routeOfLegs(req.type, JSON.parse(req.legs || '[]'))], ['Status', next.charAt(0).toUpperCase() + next.slice(1)],
    ] };
    if (isWinningOp) {
      await notifyUser(env, req.user_id, label + ' \u2014 ' + requestId, [line], origin + '/trip/' + requestId,
        next === 'confirmed' ? 'View your trip confirmation' : 'View the trip record', update);
    } else if (q) {
      const bidder = await env.DB.prepare('SELECT operator_id FROM quotes q WHERE q.id = ?').bind(req.accepted_quote_id).first();
      if (bidder) await notifyUser(env, bidder.operator_id, 'Trip cancelled by the client \u2014 ' + requestId, [line], origin + '/app', 'Open Chartavia', update);
    }
  }
  return json({ ok: true, tripStatus: next });
}

// ---------------------------------------------------------------- empty legs

async function apiPostEmptyLeg(request, env, me) {
  if (me.role !== 'operator') return json({ error: 'Operators only' }, 403);
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const pick = await clearedAircraft(env, me, b.aircraft);
  if (pick.error) return pick.error;
  const aircraft = pick.aircraft;

  const from = String(b.from || '').trim().toUpperCase().slice(0, 4);
  const to = String(b.to || '').trim().toUpperCase().slice(0, 4);
  if (!/^[A-Z0-9]{3,4}$/.test(from) || !/^[A-Z0-9]{3,4}$/.test(to)) {
    return json({ error: 'Enter valid airport codes (e.g. TEB and PBI)' }, 400);
  }
  const date = String(b.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Pick a date' }, 400);
  const time = String(b.time || '').slice(0, 5);
  const price = Math.round(+b.price);
  if (!Number.isFinite(price) || price <= 0 || price > 5_000_000) return json({ error: 'Enter a valid price' }, 400);

  const open = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM empty_legs WHERE operator_org = ? AND status = 'open'"
  ).bind(me.orgId).first();
  const legPlan = (await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(me.orgId).first())?.plan || 'free';
  const legCap = legPlan === 'pro' ? 20 : 3;
  if (open.n >= legCap) {
    return json({ error: 'Limit reached (' + legCap + ' open empty legs on your plan' + (legCap === 3 ? ' — Pro raises it to 20' : '') + ')' }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO empty_legs (operator_org, created_by, from_code, to_code, date, time, aircraft, seats, price, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(me.orgId, me.id, from, to, date, time, aircraft, null, price, String(b.note || '').slice(0, 300)).run();
  return json({ ok: true });
}

async function apiRemoveEmptyLeg(env, me, legId) {
  if (me.role !== 'operator') return json({ error: 'Operators only' }, 403);
  await env.DB.prepare("UPDATE empty_legs SET status = 'removed' WHERE id = ? AND operator_org = ?")
    .bind(legId, me.orgId).run();
  return json({ ok: true });
}

// Open, not-yet-flown legs with the operator's trust info, for the client board.
async function emptyLegBoard(env) {
  const rows = (await env.DB.prepare(
    `SELECT e.*, p.company, ${RATING_SQL}, p.cert_number, p.cert_faa_name, p.d085_name,
            (SELECT ROUND(AVG(rv.stars), 1) FROM reviews rv WHERE rv.operator_org = e.operator_org) AS avg_rating,
            (SELECT COUNT(*) FROM reviews rv WHERE rv.operator_org = e.operator_org) AS review_n,
            (SELECT f.id FROM fleet_aircraft f WHERE f.operator_id = e.operator_org
             AND f.photo_at IS NOT NULL AND instr(e.aircraft, f.tail || '|') = 1) AS photo_ac_id,
            (SELECT COUNT(*) FROM fleet_aircraft f WHERE f.operator_id = e.operator_org) AS fleet_n,
            (SELECT COUNT(*) FROM fleet_aircraft f WHERE f.operator_id = e.operator_org
             AND ${AC_CLEARED_SQL}) AS fleet_ok,
            u.name AS poster_name
     FROM empty_legs e
     LEFT JOIN operator_profiles p ON p.user_id = e.operator_org
     JOIN users u ON u.id = e.operator_org
     WHERE e.status = 'open' AND e.date >= date('now')
     ORDER BY e.date ASC LIMIT 60`
  ).all()).results;

  // Board listings are anonymous too — a visible tail number or company name
  // would let a browser book direct and skip the marketplace. Identity flows
  // through the normal request → accept reveal.
  return rows.map((e) => ({
    id: e.id,
    from: e.from_code,
    to: e.to_code,
    date: e.date,
    time: e.time,
    aircraft: e.aircraft.includes('|')
      ? e.aircraft.split('|')[1]
      : (FLEET[e.aircraft] || { name: e.aircraft }).name,
    seats: e.seats,
    price: e.price,
    note: e.note ? redactContact(e.note) : '',
    op: 'Verified operator',
    safety: e.safety_program || verificationBadge(e.cert_number !== undefined ? e : null),
    rating: e.review_n ? e.avg_rating : null,
    reviews: e.review_n || 0,
    photo: false,
  }));
}

async function myEmptyLegs(env, me) {
  return (await env.DB.prepare(
    "SELECT * FROM empty_legs WHERE operator_org = ? AND status = 'open' ORDER BY date ASC"
  ).bind(me.orgId).all()).results.map((e) => ({
    id: e.id, from: e.from_code, to: e.to_code, date: e.date, time: e.time,
    aircraft: e.aircraft.includes('|') ? e.aircraft.split('|')[0] : (FLEET[e.aircraft] || { name: e.aircraft }).name,
    price: e.price,
  }));
}

// ------------------------------------------------------------------- reviews

async function apiSubmitReview(request, env, me, requestId) {
  const b = await request.json().catch(() => null);
  if (!b) return json({ error: 'Invalid request body' }, 400);
  const stars = Math.round(+b.stars);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) return json({ error: 'Pick a star rating' }, 400);
  const text = String(b.text || '').trim().slice(0, 500);

  const req = await env.DB.prepare('SELECT * FROM requests WHERE id = ?').bind(requestId).first();
  if (!req || req.user_id !== me.id) return json({ error: 'Request not found' }, 404);
  if (!req.accepted_quote_id) return json({ error: 'You can review after accepting a quote' }, 400);
  if (req.trip_status !== 'completed') return json({ error: 'You can review once the trip is completed' }, 400);

  const q = await env.DB.prepare(
    `SELECT q.id, COALESCE(u.org_id, u.id) AS org FROM quotes q
     JOIN users u ON u.id = q.operator_id WHERE q.id = ?`
  ).bind(req.accepted_quote_id).first();
  if (!q) return json({ error: 'Accepted quote not found' }, 404);

  await env.DB.prepare(
    `INSERT INTO reviews (request_id, quote_id, operator_org, client_id, stars, text)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT (request_id) DO UPDATE SET stars = ?5, text = ?6, created_at = datetime('now')`
  ).bind(requestId, q.id, q.org, me.id, stars, text).run();
  return json({ ok: true, stars, text });
}

function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || 'Client';
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
}

// Pre-acceptance, contact details in operator messages are redacted so
// identity can't leak through chat. Originals are stored and reappear once
// the client accepts.
function redactContact(text) {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[hidden until acceptance]')
    .replace(/(?:https?:\/\/|www\.)\S+/gi, '[hidden until acceptance]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[hidden until acceptance]');
}

// ---------------------------------------------------------------------- chat

async function quoteParticipants(env, quoteId) {
  return env.DB.prepare(
    `SELECT q.id, q.operator_id, r.user_id AS client_id, r.accepted_quote_id,
            (SELECT org_id FROM users WHERE id = q.operator_id) AS operator_org
     FROM quotes q
     JOIN requests r ON r.id = q.request_id WHERE q.id = ?`
  ).bind(quoteId).first();
}

// A conversation belongs to the requesting client and the quoting operator's
// whole team.
function isParticipant(q, me) {
  if (!q) return false;
  if (q.client_id === me.id) return true;
  return me.role === 'operator' && q.operator_org === me.orgId;
}

async function apiGetMessages(env, me, quoteId) {
  const q = await quoteParticipants(env, quoteId);
  if (!isParticipant(q, me)) return json({ error: 'Not found' }, 404);
  const msgs = (await env.DB.prepare(
    `SELECT m.sender_id, m.text, u.org_id AS sender_org FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.quote_id = ? ORDER BY m.created_at ASC, m.id ASC`
  ).bind(quoteId).all()).results;
  // Opening (or polling) a conversation marks it read for this user.
  await env.DB.prepare(
    `INSERT INTO chat_reads (quote_id, user_id, last_read_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT (quote_id, user_id) DO UPDATE SET last_read_at = datetime('now')`
  ).bind(quoteId, me.id).run();
  const mine = (m) => me.role === 'operator' ? m.sender_org === me.orgId : m.sender_id === me.id;
  const revealed = q.accepted_quote_id === q.id;
  return json({
    messages: msgs.map((m) => {
      const fromOperatorTeam = m.sender_org != null && m.sender_org === q.operator_org;
      const text = !revealed && fromOperatorTeam ? redactContact(m.text) : m.text;
      return { who: mine(m) ? 'me' : 'op', text };
    }),
  });
}

// ------------------------------------------------------------------ contract

// Content sniffing: uploads must actually be what they claim, regardless of
// the declared MIME type or filename.
function sniffOk(buf, kind) {
  const b = new Uint8Array(buf.slice(0, 4));
  const is = (...sig) => sig.every((v, i) => b[i] === v);
  if (kind === 'doc') {
    return is(0x25, 0x50, 0x44, 0x46)   // %PDF
      || is(0x50, 0x4b)                  // PK.. (docx)
      || is(0xd0, 0xcf, 0x11, 0xe0);     // legacy .doc
  }
  if (kind === 'pdf') return is(0x25, 0x50, 0x44, 0x46);
  if (kind === 'image') {
    return is(0xff, 0xd8)                // JPEG
      || is(0x89, 0x50, 0x4e, 0x47)      // PNG
      || is(0x52, 0x49, 0x46, 0x46);     // RIFF (WebP)
  }
  return false;
}

const CONTRACT_MAX_BYTES = 10 * 1024 * 1024;
const CONTRACT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

async function apiUploadContract(request, env, me, quoteId) {
  const q = await quoteParticipants(env, quoteId);
  if (!q || me.role !== 'operator' || q.operator_org !== me.orgId) return json({ error: 'Not found' }, 404);

  const form = await request.formData().catch(() => null);
  const file = form ? form.get('file') : null;
  if (!file || typeof file === 'string') return json({ error: 'Attach a file' }, 400);
  if (file.size > CONTRACT_MAX_BYTES) return json({ error: 'File too large (max 10 MB)' }, 400);
  const cbuf = await file.arrayBuffer();
  if (!sniffOk(cbuf, 'doc')) return json({ error: 'File does not look like a PDF or Word document' }, 400);
  const type = CONTRACT_TYPES.includes(file.type) ? file.type : 'application/pdf';
  const name = String(file.name || 'contract.pdf').slice(0, 120);

  await env.SLIPSTREAM_KV.put('contract:' + quoteId, cbuf, {
    metadata: { name, type },
  });
  await env.DB.prepare(
    `UPDATE quotes SET contract_type = 'file', contract_name = ?, contract_url = NULL,
     contract_at = datetime('now') WHERE id = ?`
  ).bind(name, quoteId).run();
  return json({ ok: true, contract: { type: 'file', name, url: '/api/quotes/' + quoteId + '/contract' } });
}

async function apiSetContractLink(request, env, me, quoteId) {
  const q = await quoteParticipants(env, quoteId);
  if (!q || me.role !== 'operator' || q.operator_org !== me.orgId) return json({ error: 'Not found' }, 404);

  const b = await request.json().catch(() => null);
  const url = b ? String(b.url || '').trim().slice(0, 500) : '';
  let host;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error();
    host = parsed.hostname;
  } catch {
    return json({ error: 'Enter a valid https:// link' }, 400);
  }
  const name = 'Signing link (' + host + ')';
  await env.DB.prepare(
    `UPDATE quotes SET contract_type = 'link', contract_name = ?, contract_url = ?,
     contract_at = datetime('now') WHERE id = ?`
  ).bind(name, url, quoteId).run();
  await env.SLIPSTREAM_KV.delete('contract:' + quoteId);
  return json({ ok: true, contract: { type: 'link', name, url } });
}

async function apiGetContract(env, me, quoteId) {
  const q = await quoteParticipants(env, quoteId);
  if (!isParticipant(q, me)) return json({ error: 'Not found' }, 404);
  const quote = await env.DB.prepare('SELECT contract_type, contract_url FROM quotes WHERE id = ?')
    .bind(quoteId).first();
  if (!quote || !quote.contract_type) return json({ error: 'No contract attached' }, 404);
  if (quote.contract_type === 'link') return redirect(quote.contract_url);

  const { value, metadata } = await env.SLIPSTREAM_KV.getWithMetadata('contract:' + quoteId, 'arrayBuffer');
  if (!value) return json({ error: 'Contract file missing' }, 404);
  return new Response(value, {
    headers: {
      'content-type': (metadata && metadata.type) || 'application/pdf',
      'content-disposition': 'inline; filename="' + ((metadata && metadata.name) || 'contract.pdf').replace(/"/g, '') + '"',
      'cache-control': 'no-store',
    },
  });
}

async function apiSendMessage(request, env, me, quoteId) {
  const q = await quoteParticipants(env, quoteId);
  if (!isParticipant(q, me)) return json({ error: 'Not found' }, 404);
  const b = await request.json().catch(() => null);
  const text = b ? String(b.text || '').trim().slice(0, 1000) : '';
  if (!text) return json({ error: 'Empty message' }, 400);
  await env.DB.prepare('INSERT INTO messages (quote_id, sender_id, text) VALUES (?, ?, ?)')
    .bind(quoteId, me.id, text).run();
  {
    const recipient = me.id === q.client_id ? q.operator_id : q.client_id;
    if (await shouldNotify(env, 'msg:' + quoteId + ':' + recipient)) {
      await notifyUser(env, recipient, 'New message on Chartavia',
        ['You have a new message in one of your Chartavia conversations.'],
        new URL(request.url).origin + '/app', 'Read and reply', { kicker: 'MESSAGE' });
    }
  }
  return json({ ok: true });
}

// --------------------------------------------------------------------- utils

function timeAgo(sqlUtc) {
  const then = new Date(sqlUtc.replace(' ', 'T') + 'Z').getTime();
  const mins = Math.max(1, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return mins + ' min ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + ' h ago';
  const days = Math.round(hours / 24);
  return days + ' d ago';
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));
}

function getCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

function json(data, status = 200, setCookie) {
  const headers = { 'content-type': 'application/json' };
  if (setCookie) headers['set-cookie'] = setCookie;
  return new Response(JSON.stringify(data), { status, headers });
}

function redirect(to) {
  return new Response(null, { status: 302, headers: { location: to } });
}

async function serveAsset(env, request, assetPath) {
  const url = new URL(request.url);
  url.pathname = assetPath;
  return env.ASSETS.fetch(new Request(url, request));
}
