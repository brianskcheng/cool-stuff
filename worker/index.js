// brianskcheng.com: serves the Lei Moon Jar vase maker at /vase/
import vase from "../site/vase/index.html";

const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname.startsWith("www.")) { url.hostname = url.hostname.slice(4); return Response.redirect(url.toString(), 301); }
    if (url.pathname === "/" || url.pathname === "/vase") return Response.redirect(new URL("/vase/", url).toString(), 302);
    if (url.pathname === "/vase/" || url.pathname === "/vase/index.html") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      return new Response(request.method === "HEAD" ? null : vase, { headers: HTML });
    }
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
};
