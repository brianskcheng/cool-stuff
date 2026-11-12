/**
 * Sign-up list for Joyce's 25th: a Cloudflare Worker with one KV namespace.
 *
 * For the invitation page (anyone):
 *   GET  /               how many are going, and who has signed up
 *   POST /               add or change one RSVP
 *
 * For Joyce (needs the list key, sent as "Authorization: Bearer <key>"):
 *   GET    /admin            the full list, messages included
 *   POST   /admin/base       set how many said yes outside the page
 *   DELETE /admin/guest?id=  remove one entry
 *
 * Each RSVP is its own KV key, so two people signing up at the same moment
 * can never overwrite each other. The public summary is a separate key that
 * is rebuilt after every change and refreshed if it gets old.
 */

const ANSWERS = ["yes", "maybe", "no"];
const MAX_GUESTS = 300; // the form is public: cap what anyone can write
const MAX_BODY = 4000;
const SUMMARY_MAX_AGE = 5 * 60 * 1000;
const DEFAULT_ORIGINS = "https://joycesqlee.com,https://www.joycesqlee.com";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsFor(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGIN || DEFAULT_ORIGINS).split(",").map((s) => s.trim());
  const known = allowed.includes(origin) || LOCAL_ORIGIN.test(origin);
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (known) headers["Access-Control-Allow-Origin"] = origin;
  return { headers, known };
}

const reply = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });

const clean = (value, max) =>
  String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

// "Britney Jean Spears" -> "Britney S." for the list everyone can see
function publicName(name) {
  const parts = String(name).trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || "";
  return parts[0] + " " + parts[parts.length - 1].charAt(0).toUpperCase() + ".";
}

function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isJoyce(request, env) {
  const sent = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return !!env.ADMIN_KEY && sameKey(sent, env.ADMIN_KEY);
}

async function readBase(env) {
  const stored = parseInt(await env.RSVPS.get("base"), 10);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  const fallback = parseInt(env.BASE_GOING, 10);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

// every RSVP's short details, oldest first (read from key metadata: one KV call)
async function listGuests(env) {
  const guests = [];
  let cursor;
  do {
    const page = await env.RSVPS.list({ prefix: "g:", cursor });
    for (const key of page.keys) {
      if (key.metadata) guests.push({ id: key.name.slice(2), ...key.metadata });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return guests.sort((a, b) => (a.t || 0) - (b.t || 0));
}

// what the invitation page shows; `guests` and `base` can be passed in when already known
async function buildSummary(env, known = {}) {
  const guests = known.guests || (await listGuests(env));
  const base = known.base != null ? known.base : await readBase(env);
  const shown = guests.filter((g) => g.s === "yes" || g.s === "maybe");
  const summary = {
    ok: true,
    base,
    going: base + shown.filter((g) => g.s === "yes").length,
    maybe: shown.filter((g) => g.s === "maybe").length,
    guests: shown.map((g) => ({ name: publicName(g.n), status: g.s, song: g.g || "" })),
    built: Date.now(),
  };
  await env.RSVPS.put("public", JSON.stringify(summary));
  return summary;
}

async function publicSummary(env) {
  const saved = await env.RSVPS.get("public", "json");
  if (saved && Date.now() - saved.built < SUMMARY_MAX_AGE) return saved;
  return buildSummary(env);
}

async function saveRsvp(request, env) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { status: 413, body: { ok: false, error: "That's too long." } };
  let d;
  try { d = JSON.parse(raw); } catch (e) { d = null; }
  if (!d || typeof d !== "object") return { status: 400, body: { ok: false, error: "Could not read that." } };

  const name = clean(d.name, 60);
  const status = ANSWERS.includes(d.status) ? d.status : "";
  if (!name || !status) return { status: 400, body: { ok: false, error: "Name and answer are needed." } };

  let id = String(d.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  if (id.length < 8) id = crypto.randomUUID();

  const guests = await listGuests(env);
  const earlier = guests.find((g) => g.id === id);
  if (!earlier && guests.length >= MAX_GUESTS) return { status: 429, body: { ok: false, error: "The list is full." } };

  const now = Date.now();
  const record = {
    id,
    name,
    status,
    song: status === "no" ? "" : clean(d.song, 120),
    note: clean(d.note, 500),
    at: earlier ? earlier.t : now, // first signed up
    updated: now,
  };
  const meta = { n: record.name, s: record.status, g: record.song, t: record.at };
  await env.RSVPS.put("g:" + id, JSON.stringify(record), { metadata: meta });

  // KV listings can lag a few seconds, so place this RSVP into the list ourselves
  const merged = guests.filter((g) => g.id !== id).concat({ id, ...meta }).sort((a, b) => (a.t || 0) - (b.t || 0));
  return { status: 200, body: await buildSummary(env, { guests: merged }) };
}

async function fullList(env) {
  const guests = await listGuests(env);
  const records = await Promise.all(guests.map((g) => env.RSVPS.get("g:" + g.id, "json")));
  return {
    ok: true,
    base: await readBase(env),
    guests: records.filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0)),
  };
}

export default {
  async fetch(request, env) {
    const { headers, known } = corsFor(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!env.RSVPS) return reply({ ok: false, error: "Sign-up list not set up." }, 503, headers);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/" && request.method === "GET") return reply(await publicSummary(env), 200, headers);

      if (path === "/" && request.method === "POST") {
        // browsers on other sites cannot post here; this is a courtesy lock, not security
        if (!known) return reply({ ok: false, error: "Not allowed from here." }, 403, headers);
        const out = await saveRsvp(request, env);
        return reply(out.body, out.status, headers);
      }

      if (path.startsWith("/admin")) {
        if (!isJoyce(request, env)) return reply({ ok: false, error: "Wrong list key." }, 401, headers);

        if (path === "/admin" && request.method === "GET") return reply(await fullList(env), 200, headers);

        if (path === "/admin/base" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const base = parseInt(body.base, 10);
          if (!Number.isFinite(base) || base < 0 || base > 500) return reply({ ok: false, error: "Give a number from 0 to 500." }, 400, headers);
          await env.RSVPS.put("base", String(base));
          await buildSummary(env, { base });
          return reply(await fullList(env).then((l) => ({ ...l, base })), 200, headers);
        }

        if (path === "/admin/guest" && request.method === "DELETE") {
          const id = String(url.searchParams.get("id") || "").replace(/[^A-Za-z0-9_-]/g, "");
          if (!id) return reply({ ok: false, error: "Which one?" }, 400, headers);
          const before = await listGuests(env);
          await env.RSVPS.delete("g:" + id);
          const left = before.filter((g) => g.id !== id);
          await buildSummary(env, { guests: left });
          const list = await fullList(env);
          return reply({ ...list, guests: list.guests.filter((g) => g.id !== id) }, 200, headers);
        }
      }

      return reply({ ok: false, error: "Not found." }, 404, headers);
    } catch (err) {
      return reply({ ok: false, error: "Something went wrong. Try again." }, 500, headers);
    }
  },
};
