/* Joyce's 25th: collage letters, countdown, calendar links, RSVP, sparkles. */
(() => {
  "use strict";

  const P = window.PARTY || {};
  const RSVP = P.rsvp || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- seeded random, so the collage is the same on every visit ---------- */
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- cut-out letters ---------- */
  const FONTS = ["'Ultra'", "'Abril Fatface'", "'Bevan'", "'DM Serif Display'", "'Rozha One'"];
  // [paper, ink] pairs taken from the poster's scraps
  const SCRAPS = [
    ["#f7c9d6", "#c2185b"], ["#cdbbe6", "#5b2a98"], ["#f6d2bc", "#d4622a"], ["#23201f", "#f3e6d4"],
    ["#f3e6d4", "#3f8a3a"], ["#f6c66a", "#5b2a98"], ["#e9e4de", "#23201f"], ["#f4f0ea", "#e0186f"],
    ["#3f8a3a", "#f3ead9"], ["#f3d98a", "#c2185b"], ["#dfe3fb", "#5b62c9"], ["#f1e3d0", "#c2185b"],
  ];
  // the three big lines are matched to the poster letter by letter: [paper, ink, font]
  const PRESETS = {
    joyce: [["#f1e3d0", "#c2185b", 0], ["#23201f", "#f3e6d4", 2], ["#f5cfa8", "#2e7d32", 1], ["#f6c7d2", "#d81b72", 0], ["#cdbbe6", "#5b2a98", 3], ["#f1e3d0", "#23201f", 0], ["#efe4d6", "#23201f", 2]],
    age: [["#f7c9d6", "#e0186f", 0], ["#23201f", "#f3e6d4", 1], ["#f6c66a", "#5b2a98", 2], ["#f6d2bc", "#c2185b", 0]],
    birthday: [["#3f8a3a", "#f3ead9", 2], ["#f3e6d4", "#e85d9c", 0], ["#e9e4de", "#23201f", 1], ["#f6dcc0", "#f07f1e", 0], ["#efe2cf", "#5b2a98", 2], ["#f7c9d6", "#c2185b", 1], ["#f4f0ea", "#7f8be0", 0], ["#f3d98a", "#3f8a3a", 3]],
  };

  // a polygon with slightly wobbly edges: scissors for letters, torn for strips
  function ragged(rand, { nx, ny, ax, ay }) {
    const pts = [];
    for (let i = 0; i <= nx; i++) pts.push([(i / nx) * 100, rand() * ay]);
    for (let i = 1; i < ny; i++) pts.push([100 - rand() * ax, (i / ny) * 100]);
    for (let i = nx; i >= 0; i--) pts.push([(i / nx) * 100, 100 - rand() * ay]);
    for (let i = ny - 1; i >= 1; i--) pts.push([rand() * ax, (i / ny) * 100]);
    return "polygon(" + pts.map((p) => p[0].toFixed(1) + "% " + p[1].toFixed(1) + "%").join(",") + ")";
  }

  let letterCount = 0;
  function ransom(line, seed) {
    const rand = seeded(seed);
    const text = line.textContent.trim();
    const preset = PRESETS[line.dataset.ransom];
    line.textContent = "";
    let last = -1;
    let n = 0;
    for (const ch of text) {
      if (ch === " ") {
        const gap = document.createElement("span");
        gap.className = "rsp";
        line.appendChild(gap);
        continue;
      }
      let paper, ink, font;
      if (preset && preset[n]) {
        [paper, ink, font] = preset[n];
      } else {
        let k;
        do k = Math.floor(rand() * SCRAPS.length); while (k === last);
        last = k;
        [paper, ink] = SCRAPS[k];
        font = Math.floor(rand() * FONTS.length);
      }
      const wrap = document.createElement("span");
      wrap.className = "rl";
      wrap.style.setProperty("--bg", paper);
      wrap.style.setProperty("--fg", ink);
      wrap.style.setProperty("--f", FONTS[font]);
      wrap.style.setProperty("--r", ((rand() - 0.5) * 9).toFixed(1) + "deg");
      wrap.style.setProperty("--y", ((rand() - 0.5) * 0.1).toFixed(3) + "em");
      wrap.style.setProperty("--i", String(n));
      wrap.style.setProperty("--clip", ragged(rand, { nx: 4, ny: 4, ax: 6, ay: 5 }));
      const b = document.createElement("b");
      b.textContent = ch;
      wrap.appendChild(b);
      line.appendChild(wrap);
      n++;
      letterCount++;
    }
  }

  $$("[data-ransom]").forEach((line, i) => ransom(line, 2026 + i * 97));
  $$(".strip__in").forEach((el, i) => el.style.setProperty("--tear", ragged(seeded(55 + i * 13), { nx: 26, ny: 3, ax: 1.4, ay: 9 })));

  // stick the title on once the fonts are in, the section headings as they scroll into view
  const title = $(".ransom-title");
  const titleLines = $$(".rline", title);
  let delay = 250;
  titleLines.forEach((line) => {
    line.style.setProperty("--d0", delay + "ms");
    delay += $$(".rl", line).length * 38 + 60;
  });
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 1500))]).then(() => titleLines.forEach((l) => l.classList.add("go")));

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("go"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -12% 0px" });
    $$(".rhead .rline").forEach((l) => io.observe(l));
  } else {
    $$(".rhead .rline").forEach((l) => l.classList.add("go"));
  }

  /* ---------- countdown ---------- */
  const start = new Date(P.start);
  const end = new Date(P.end);
  const cd = { d: $("#cd-d"), h: $("#cd-h"), m: $("#cd-m"), s: $("#cd-s") };
  const pad = (n) => String(n).padStart(2, "0");
  function tick() {
    let left = Math.max(0, start - Date.now());
    if (left === 0) {
      const label = $(".lcd__label");
      if (label && !label.dataset.done) {
        label.dataset.done = "1";
        label.textContent = Date.now() < end ? "♥ it's karaoke time ♥" : "♥ what a night ♥";
      }
    }
    const s = Math.floor(left / 1000);
    cd.d.textContent = pad(Math.floor(s / 86400));
    cd.h.textContent = pad(Math.floor((s % 86400) / 3600));
    cd.m.textContent = pad(Math.floor((s % 3600) / 60));
    cd.s.textContent = pad(s % 60);
  }
  if (cd.d && !isNaN(start)) { tick(); setInterval(tick, 1000); }

  /* ---------- add to calendar ---------- */
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const where = P.venue + ", " + P.address;
  const gcal = $("#cal-google");
  if (gcal && !isNaN(start)) {
    gcal.href = "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=" + encodeURIComponent(P.title) +
      "&dates=" + stamp(start) + "/" + stamp(end) +
      "&details=" + encodeURIComponent(P.calendarNote + "\n\n" + location.href.split("#")[0]) +
      "&location=" + encodeURIComponent(where);
  }
  const ics = $("#cal-ics");
  if (ics && !isNaN(start)) {
    const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
    const file = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//joyce-25th//EN", "BEGIN:VEVENT",
      "UID:joyce-25th-2026@invite", "DTSTAMP:" + stamp(new Date()),
      "DTSTART:" + stamp(start), "DTEND:" + stamp(end),
      "SUMMARY:" + esc(P.title), "LOCATION:" + esc(where), "DESCRIPTION:" + esc(P.calendarNote),
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    ics.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(file);
  }

  /* ---------- sparkles ---------- */
  const fx = $("#fx");
  const COLOURS = ["#e91e7a", "#5b2a98", "#f07f1e", "#3f8a3a", "#7f8be0", "#e2ac2f"];
  function burst(x, y, { n = 8, spread = 60, glyphs = ["✦", "✧", "★", "♥"], size = [12, 22], life = [0.6, 1] } = {}) {
    if (reduceMotion || !fx) return;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("i");
      el.className = "sp";
      el.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      const ang = Math.random() * Math.PI * 2;
      const dist = spread * (0.35 + Math.random() * 0.65);
      el.style.setProperty("--x0", x + "px");
      el.style.setProperty("--y0", y + "px");
      el.style.setProperty("--dx", Math.cos(ang) * dist + "px");
      el.style.setProperty("--dy", Math.sin(ang) * dist + (spread > 100 ? 60 : 0) + "px");
      el.style.setProperty("--rot", Math.round((Math.random() - 0.5) * 360) + "deg");
      el.style.setProperty("--fs", Math.round(size[0] + Math.random() * (size[1] - size[0])) + "px");
      el.style.setProperty("--life", (life[0] + Math.random() * (life[1] - life[0])).toFixed(2) + "s");
      el.style.setProperty("--col", COLOURS[Math.floor(Math.random() * COLOURS.length)]);
      el.addEventListener("animationend", () => el.remove());
      fx.appendChild(el);
    }
  }
  const centreOf = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const party = (el) => burst(...centreOf(el), { n: 34, spread: 190, glyphs: ["💖", "✨", "🪩", "⭐", "🎤", "🍒"], size: [18, 30], life: [0.9, 1.6] });

  // a sparkle trail behind the mouse, very 2003
  if (!reduceMotion && matchMedia("(hover: hover) and (pointer: fine)").matches) {
    let last = 0;
    addEventListener("pointermove", (e) => {
      const now = performance.now();
      if (now - last < 55) return;
      last = now;
      burst(e.clientX, e.clientY, { n: 1, spread: 26, size: [10, 16], life: [0.5, 0.8] });
    }, { passive: true });
  }

  // and a little burst wherever a finger lands on the paper
  if (!reduceMotion) {
    addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || e.target.closest("a, button, input, textarea, label")) return;
      burst(e.clientX, e.clientY, { n: 5, spread: 44, size: [11, 18], life: [0.5, 0.85] });
    }, { passive: true });
  }

  // stickers pop when poked; the phone rings
  $$("button.stk").forEach((s) => {
    s.addEventListener("click", () => {
      const cls = s.classList.contains("stk--phone") ? "ring" : "pop";
      s.classList.remove(cls);
      void s.offsetWidth;
      s.classList.add(cls);
      burst(...centreOf(s), { n: 10, spread: 70 });
    });
    s.addEventListener("animationend", (e) => { if (e.animationName === "pop" || e.animationName === "ring") s.classList.remove("pop", "ring"); });
  });

  // the CD turns as the page scrolls
  const disc = $(".stk--cd");
  if (disc && !reduceMotion) {
    let queued = false;
    const spin = () => { queued = false; disc.style.rotate = (scrollY * 0.4).toFixed(1) + "deg"; };
    addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(spin); } }, { passive: true });
  }

  function toast(msg) {
    $$(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  /* ---------- share ---------- */
  const share = $("#share");
  if (share) {
    share.addEventListener("click", async () => {
      const url = location.href.split("#")[0];
      const data = { title: P.title, text: "🪩 You're invited to Joyce's 25th Birthday!", url };
      if (navigator.share) {
        try { await navigator.share(data); } catch (e) { /* closed the sheet */ }
      } else {
        toast((await copy(url)) ? "Link copied ✨" : url);
      }
    });
  }

  /* ---------- RSVP ---------- */
  const KEY = "joyce25-rsvp";
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const ANSWER = { yes: "I'm in! 🪩", maybe: "Maybe 🤔", no: "Can't make it 😢" };
  const form = $("#rsvp-form");
  const done = $("#rsvp-done");
  const errorBox = $("#rsvp-error");
  const sendBtn = $("#rsvp-send");
  const songField = $("#song-field");
  const useSheet = !!RSVP.endpoint;

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function message(d) {
    const lines = ["RSVP for Joyce's 25th 🪩", "Name: " + d.name, ANSWER[d.status]];
    if (d.song) lines.push("Karaoke song 🎤: " + d.song);
    if (d.note) lines.push("Message: " + d.note);
    return lines.join("\n");
  }
  const whatsappUrl = (d) => "https://wa.me/" + (RSVP.whatsapp || "") + "?text=" + encodeURIComponent(message(d));

  function showDone(d, celebrate) {
    const first = d.name.split(/\s+/)[0];
    const copyFor = {
      yes: ["You're on the list! 🪩", "See you on Saturday 5th December, " + first + ". Start warming up those vocals 🎤"],
      maybe: ["Pencilled in ✏️", "Thanks, " + first + ". Let Joyce know as soon as you can!"],
      no: ["You'll be missed 😢", "Thanks for letting Joyce know, " + first + "."],
    }[d.status];
    $("#done-title").textContent = copyFor[0];
    $("#done-text").textContent = copyFor[1];
    const wa = $("#done-wa");
    wa.hidden = useSheet;
    if (!useSheet) $("#done-wa-link").href = whatsappUrl(d);
    form.hidden = true;
    done.hidden = false;
    if (celebrate) {
      done.focus({ preventScroll: true });
      if (d.status !== "no") party(done);
    }
  }

  function fill(d) {
    form.elements.name.value = d.name || "";
    form.elements.song.value = d.song || "";
    form.elements.note.value = d.note || "";
    $$('input[name="status"]', form).forEach((r) => { r.checked = r.value === d.status; });
    songField.hidden = d.status === "no";
  }

  async function saveToSheet(d) {
    // text/plain keeps this a "simple" request, which Apps Script web apps accept cross-origin
    const res = await fetch(RSVP.endpoint, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(d) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || "Could not save");
  }

  if (form) {
    $("#rsvp-hint").textContent = useSheet ? "" : "This opens WhatsApp with your RSVP ready to send to Joyce.";
    form.addEventListener("change", (e) => {
      if (e.target.name === "status") songField.hidden = e.target.value === "no";
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const prev = store.get();
      const d = {
        id: (prev && prev.id) || newId(),
        name: form.elements.name.value.trim().replace(/\s+/g, " "),
        status: form.elements.status.value,
        song: form.elements.status.value === "no" ? "" : form.elements.song.value.trim(),
        note: form.elements.note.value.trim(),
      };
      const fail = (msg, el) => { errorBox.textContent = msg; errorBox.hidden = false; if (el) el.focus(); };
      if (!d.name) return fail("Pop your name in first ✏️", form.elements.name);
      if (!d.status) return fail("Are you coming? Pick one 👆", $('input[name="status"]', form));

      if (useSheet) {
        sendBtn.disabled = true;
        try {
          await saveToSheet(d);
        } catch (err) {
          sendBtn.disabled = false;
          return fail("That didn't send. Check your signal and try again, or message Joyce directly.");
        }
        sendBtn.disabled = false;
        store.set(d);
        showDone(d, true);
        loadGuests();
      } else {
        store.set(d);
        window.open(whatsappUrl(d), "_blank", "noopener");
        showDone(d, true);
      }
    });

    $("#done-change").addEventListener("click", () => {
      const d = store.get();
      if (d) fill(d);
      done.hidden = true;
      form.hidden = false;
      form.elements.name.focus();
    });
    $("#done-copy").addEventListener("click", async () => {
      const d = store.get();
      if (d) toast((await copy(message(d))) ? "Copied. Paste it to Joyce 💌" : "Couldn't copy, sorry");
    });

    const saved = store.get();
    if (saved && saved.name && ANSWER[saved.status]) { fill(saved); showDone(saved, false); }
  }

  /* ---------- who's coming (needs the sign-up sheet) ---------- */
  async function loadGuests() {
    if (!useSheet) return;
    try {
      const out = await (await fetch(RSVP.endpoint)).json();
      const all = (out.guests || []).filter((g) => g && g.name && (g.status === "yes" || g.status === "maybe"));
      if (!all.length) return;
      const yes = all.filter((g) => g.status === "yes");
      const maybe = all.filter((g) => g.status === "maybe");
      const list = $("#guests-list");
      list.textContent = "";
      const rand = seeded(7);
      const tints = ["#f7c9d6", "#cdbbe6", "#f6d2bc", "#f3d98a", "#dfe3fb", "#fff"];
      yes.concat(maybe).forEach((g, i) => {
        const li = document.createElement("li");
        li.className = "guest" + (g.status === "maybe" ? " guest--maybe" : "");
        li.style.setProperty("--bg", tints[i % tints.length]);
        li.style.setProperty("--r", ((rand() - 0.5) * 6).toFixed(1) + "deg");
        li.textContent = g.name + (g.status === "maybe" ? " (maybe)" : "");
        if (g.song) {
          const s = document.createElement("small");
          s.textContent = "🎤 " + g.song;
          li.appendChild(s);
        }
        list.appendChild(li);
      });
      $("#guests-count").textContent = yes.length + " coming" + (maybe.length ? " · " + maybe.length + " maybe" : "") + " 🪩";
      $("#guests").hidden = false;
    } catch (e) { /* the list is a nice-to-have */ }
  }
  loadGuests();
})();
