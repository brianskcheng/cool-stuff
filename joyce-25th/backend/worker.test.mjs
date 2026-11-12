// Runs the worker against an in-memory stand-in for KV:  node backend/worker.test.mjs
import assert from "node:assert/strict";
import worker from "./worker.js";

function fakeKV() {
  const rows = new Map();
  return {
    rows,
    async get(key, type) {
      const row = rows.get(key);
      if (!row) return null;
      return type === "json" ? JSON.parse(row.value) : row.value;
    },
    async put(key, value, opts = {}) { rows.set(key, { value, metadata: opts.metadata || null }); },
    async delete(key) { rows.delete(key); },
    async list({ prefix = "" } = {}) {
      const keys = [...rows.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: rows.get(name).metadata }));
      return { keys, list_complete: true };
    },
  };
}

const SITE = "https://joycesqlee.com";
const env = { RSVPS: fakeKV(), ADMIN_KEY: "list-key-123", BASE_GOING: "15" };
const call = async (path, { method = "GET", body, origin = SITE, key } = {}) => {
  const headers = { Origin: origin };
  if (key) headers.Authorization = "Bearer " + key;
  const res = await worker.fetch(new Request("https://api.test" + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }), env);
  return { status: res.status, cors: res.headers.get("Access-Control-Allow-Origin"), data: res.status === 204 ? null : await res.json() };
};

// empty list starts from the 15 who had already said yes
let r = await call("/");
assert.equal(r.status, 200);
assert.equal(r.cors, SITE);
assert.deepEqual({ base: r.data.base, going: r.data.going, maybe: r.data.maybe, guests: r.data.guests }, { base: 15, going: 15, maybe: 0, guests: [] });

// preflight
assert.equal((await call("/", { method: "OPTIONS" })).status, 204);

// bad sign-ups are refused
assert.equal((await call("/", { method: "POST", body: { name: "", status: "yes" } })).status, 400);
assert.equal((await call("/", { method: "POST", body: { name: "A", status: "definitely" } })).status, 400);
assert.equal((await call("/", { method: "POST", body: "not json" })).status, 400);
assert.equal((await call("/", { method: "POST", body: { name: "A", status: "yes", note: "x".repeat(5000) } })).status, 413);
r = await call("/", { method: "POST", body: { name: "Mallory", status: "yes" }, origin: "https://evil.example" });
assert.equal(r.status, 403);
assert.equal(r.cors, null);

// a yes, a maybe and a no
r = await call("/", { method: "POST", body: { id: "guest-0001", name: "Britney Jean Spears", status: "yes", song: "Toxic", note: "Happy birthday!" } });
assert.equal(r.status, 200);
assert.equal(r.data.going, 16);
assert.deepEqual(r.data.guests, [{ name: "Britney S.", status: "yes", song: "Toxic" }]);
await call("/", { method: "POST", body: { id: "guest-0002", name: "Kylie", status: "maybe", song: "Spinning Around" } });
r = await call("/", { method: "POST", body: { id: "guest-0003", name: "Nelly", status: "no", song: "ignored", note: "so sorry" } });
assert.equal(r.data.going, 16);
assert.equal(r.data.maybe, 1);
assert.deepEqual(r.data.guests.map((g) => g.name), ["Britney S.", "Kylie"]); // people who can't come are not shown publicly
assert.equal((await call("/")).data.going, 16);

// the same guest changing their answer updates their entry instead of adding one
r = await call("/", { method: "POST", body: { id: "guest-0002", name: "Kylie", status: "yes", song: "Spinning Around" } });
assert.equal(r.data.going, 17);
assert.equal(r.data.maybe, 0);
assert.equal([...env.RSVPS.rows.keys()].filter((k) => k.startsWith("g:")).length, 3);

// Joyce's list needs the key
assert.equal((await call("/admin")).status, 401);
assert.equal((await call("/admin", { key: "wrong-key-xxx" })).status, 401);
r = await call("/admin", { key: env.ADMIN_KEY });
assert.equal(r.status, 200);
assert.equal(r.data.base, 15);
assert.deepEqual(r.data.guests.map((g) => [g.name, g.status, g.song, g.note]), [
  ["Britney Jean Spears", "yes", "Toxic", "Happy birthday!"],
  ["Kylie", "yes", "Spinning Around", ""],
  ["Nelly", "no", "", "so sorry"],
]);

// she corrects the "told me directly" number
assert.equal((await call("/admin/base", { method: "POST", body: { base: 12 } })).status, 401);
assert.equal((await call("/admin/base", { method: "POST", body: { base: -3 }, key: env.ADMIN_KEY })).status, 400);
r = await call("/admin/base", { method: "POST", body: { base: 12 }, key: env.ADMIN_KEY });
assert.equal(r.data.base, 12);
assert.equal((await call("/")).data.going, 14);

// and removes a duplicate
r = await call("/admin/guest?id=guest-0002", { method: "DELETE", key: env.ADMIN_KEY });
assert.deepEqual(r.data.guests.map((g) => g.name), ["Britney Jean Spears", "Nelly"]);
r = await call("/");
assert.equal(r.data.going, 13);
assert.deepEqual(r.data.guests.map((g) => g.name), ["Britney S."]);

// a stale summary is rebuilt from the entries themselves
const stale = JSON.parse(env.RSVPS.rows.get("public").value);
env.RSVPS.rows.set("public", { value: JSON.stringify({ ...stale, going: 999, built: Date.now() - 10 * 60 * 1000 }), metadata: null });
assert.equal((await call("/")).data.going, 13);

// the list cannot be flooded
for (let i = 0; i < 320; i++) await call("/", { method: "POST", body: { id: "bulk-" + String(i).padStart(4, "0"), name: "G" + i, status: "yes" } });
assert.equal([...env.RSVPS.rows.keys()].filter((k) => k.startsWith("g:")).length, 300);

assert.equal((await call("/nope")).status, 404);
console.log("worker: all checks pass");
