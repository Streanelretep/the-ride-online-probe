import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  listProbeModels,
  runProbe,
  probeErrorMessage,
  ProbeError,
  type ProbeSession,
  type ProbeModel,
} from "./chatgpt-probe";
import { verifyTransfer } from "./probe-transfer";
import {
  htmlEscape as esc,
  readBody,
  cookieValue,
  probeStyle,
} from "./probe-http-utils";

type Options = {
  origin: string;
  password: string;
  hostId: string;
  fetcher?: typeof fetch;
  allowHttpForTests?: boolean;
};
type Browser = {
  csrf: string;
  expiresAt: number;
  authenticated: boolean;
  message: string;
};
const random = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest();
const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
export function createOnlineProbeServer(options: Options) {
  const parsed = new URL(options.origin);
  if (
    parsed.origin !== options.origin ||
    parsed.username ||
    parsed.password ||
    (parsed.protocol !== "https:" &&
      !(options.allowHttpForTests && parsed.hostname === "127.0.0.1"))
  )
    throw new Error("HTTPS_ORIGIN_REQUIRED");
  if (
    options.password.length < 24 ||
    options.password.length > 256 ||
    !/^urn:uuid:[0-9a-f-]{36}$/.test(options.hostId)
  )
    throw new Error("SECURE_CONFIG_REQUIRED");
  const fetcher = options.fetcher ?? fetch;
  const browsers = new Map<string, Browser>();
  const cookieName =
    parsed.protocol === "https:" ? "__Host-ride-online" : "ride-online-test";
  const runtime = randomBytes(8).toString("hex");
  let active:
    | {
        session: ProbeSession;
        models: ProbeModel[];
        attempts: number;
        revision: number;
      }
    | undefined;
  let pairing: { code: string; expiresAt: number } | undefined;
  let version = 0,
    busy = false,
    failedLogins = 0,
    blockedUntil = 0;
  let lastResult = "Nog geen online AI-test uitgevoerd.";
  const csrf = (s: Browser) =>
    `<input type="hidden" name="csrf" value="${s.csrf}">`;
  const frame = (contents: string) =>
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Online ChatGPT-proef · The Ride</title><style>${probeStyle}</style></head><body><main><p class="eyebrow">THE RIDE / ONLINE BEWIJSPROEF</p><h1>Je coach, zonder je pc.</h1>${contents}<p><small>Proces ${runtime}. Alleen de vaste testzin; geen Garmin- of gezondheidsgegevens. Een herstart of slaapstand wist de koppeling. Dit is nog geen permanente coach of bewezen altijd beschikbare hosting.</small></p></main></body></html>`;
  const page = (s: Browser) =>
    frame(
      !s.authenticated
        ? `
    <section class="card"><h2>Open je privéproef</h2><p>Gebruik het toegangswachtwoord uit de environment-instellingen van je eigen Render-dienst. Dit is niet je ChatGPT-wachtwoord.</p><form method="post" action="/login">${csrf(s)}<label>Toegangswachtwoord<input type="password" name="password" autocomplete="current-password" maxlength="256" required></label><button class="primary">Proef openen →</button></form></section><p class="notice" role="status">${esc(s.message)}</p>
  `
        : `<p class="notice" role="status">${esc(s.message)}</p>
    <section class="card"><span class="tag">${active ? "TIJDELIJK VERBONDEN" : "NOG NIET VERBONDEN"}</span><h2>1 · Geef deze server tijdelijk toestemming</h2>
    <p>Maak een eenmalige koppelcode. Open daarna op je pc de lokale proef op <code>http://127.0.0.1:4319</code>, kies ‘Online proef koppelen’ en vul dit serveradres en de code in. Je logt bij OpenAI op je pc in; de toestemming gaat na jouw bevestiging rechtstreeks via HTTPS naar deze server.</p>
    <form method="post" action="/pair">${csrf(s)}<button ${busy ? "disabled" : ""}>Nieuwe koppelcode maken</button></form>
    ${pairing ? `<label>Jouw serveradres<input value="${esc(options.origin)}" readonly></label><label>Koppelcode · vijf minuten geldig<input value="${pairing.code}" readonly autocomplete="off"></label><p><small>De code is een tijdelijk toegangsbewijs. Deel hem niet in de chat. Een nieuwe code vervangt de vorige.</small></p>` : ""}
    ${active ? `<p>De tijdelijke AI-toestemming verloopt om ${new Date(active.session.expiresAt).toISOString().slice(11, 19)} UTC. Nog maximaal ${Math.max(0, 3 - active.attempts)} handmatige testaanvragen.</p>` : ""}</section>
    <section class="card"><h2>2 · Test op je smartphone met je pc uit</h2><ol><li>Bewaar deze HTTPS-link op je smartphone en open hem daar.</li><li>Log zo nodig in met hetzelfde Render-toegangswachtwoord.</li><li>Schakel wifi op de telefoon uit en gebruik mobiel internet.</li><li>Schakel je pc volledig uit. Voer binnen tien minuten na het koppelen één test uit.</li></ol>
    <p>De vaste inhoud is <code>Reply with exactly: The Ride connection works.</code> De aanvraag gebruikt je abonnementsruimte; er is geen API-key of automatische herhaling.</p>
    <form method="post" action="/probe">${csrf(s)}<label>Model<select name="model" ${!active ? "disabled" : ""}>${active?.models.map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}</option>`).join("") ?? ""}</select></label><label class="check"><input type="checkbox" name="consent" value="yes" required ${!active ? "disabled" : ""}><span>Voer één testzin uit via mijn ChatGPT-abonnement.</span></label><label class="check"><input type="checkbox" name="pcOff" value="yes"><span>Mijn pc staat uit en ik gebruik mobiel internet. Dit is mijn eigen bevestiging; de server kan mijn pc niet controleren.</span></label><button class="primary" ${!active || active.attempts >= 3 || busy ? "disabled" : ""}>Test op de online server →</button></form><p class="notice">${esc(lastResult)}</p></section>
    <section class="card"><h2>3 · Ruim de tijdelijke koppeling op</h2><form method="post" action="/clear">${csrf(s)}<label class="check"><input type="checkbox" name="confirm" value="yes" required><span>Verwijder de tijdelijke ChatGPT-toestemming uit dit proces.</span></label><button>Online testsessie wissen</button></form><p><small>Deze knop wist het lokale geheugen van de server; trek de app-toestemming desgewenst ook in bij ChatGPT.</small></p><form method="post" action="/logout">${csrf(s)}<button>Alleen deze browser uitloggen</button></form></section>`,
    );
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (parsed.protocol === "https:")
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    const json = (status: number, data: object) => {
      res
        .writeHead(status, { "Content-Type": "application/json" })
        .end(JSON.stringify(data));
    };
    const redirect = () => {
      res.writeHead(303, { Location: "/" }).end();
    };
    let url: URL;
    try {
      url = new URL(req.url ?? "/", options.origin);
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Health checks contain no state and may be sent with a platform-internal Host.
    if (req.method === "GET" && url.pathname === "/healthz") {
      json(200, { ok: true });
      return;
    }
    if (req.headers.host !== parsed.host || url.origin !== options.origin) {
      res.writeHead(403).end();
      return;
    }
    for (const [key, s] of browsers)
      if (s.expiresAt <= Date.now()) browsers.delete(key);
    if (active && active.session.expiresAt <= Date.now()) {
      active = undefined;
      version++;
      lastResult =
        "De tijdelijke toestemming is verlopen. Koppel opnieuw via je pc.";
    }
    if (pairing && pairing.expiresAt <= Date.now()) pairing = undefined;
    if (blockedUntil && blockedUntil <= Date.now()) {
      blockedUntil = 0;
      failedLogins = 0;
    }
    try {
      if (url.pathname.startsWith("/_probe/")) {
        if (
          req.method !== "POST" ||
          !req.headers["content-type"]?.startsWith("application/json")
        ) {
          json(405, { ok: false });
          return;
        }
        const presented = req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice(7)
          : "";
        if (!pairing || !equal(presented, pairing.code)) {
          json(403, { ok: false });
          return;
        }
        if (url.pathname === "/_probe/pair-info") {
          await readBody(req, 200);
          json(200, {
            app: "the-ride-online-probe",
            protocol: 1,
            hostId: options.hostId,
            expiresAt: pairing.expiresAt,
          });
          return;
        }
        if (url.pathname === "/_probe/import") {
          if (busy) {
            json(409, { ok: false });
            return;
          }
          pairing = undefined;
          active = undefined;
          busy = true;
          const importedAtVersion = ++version;
          try {
            const input = JSON.parse(await readBody(req, 100000));
            const session = await verifyTransfer(
              input,
              options.hostId,
              fetcher,
            );
            const models = await listProbeModels(session, fetcher);
            if (version !== importedAtVersion) {
              json(409, { ok: false });
              return;
            }
            active = { session, models, attempts: 0, revision: version };
            lastResult =
              "Toestemming ontvangen. Je kunt nu de vaste testzin vanaf de online server aanvragen.";
            json(200, { ok: true, expiresAt: session.expiresAt });
          } finally {
            busy = false;
          }
          return;
        }
        json(404, { ok: false });
        return;
      }
      let sid = cookieValue(req, cookieName);
      let s = sid ? browsers.get(sid) : undefined;
      if (!s && req.method === "GET" && url.pathname === "/") {
        if (browsers.size >= 50) {
          res.writeHead(429).end("Probeer later opnieuw.");
          return;
        }
        sid = random();
        s = {
          csrf: random(),
          authenticated: false,
          expiresAt: Date.now() + 20 * 60_000,
          message: "Alleen voor de eigenaar van deze proef.",
        };
        browsers.set(sid, s);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1200${parsed.protocol === "https:" ? "; Secure" : ""}`,
        );
      }
      if (!s) {
        res.writeHead(401).end("Open eerst de startpagina.");
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(page(s));
        return;
      }
      if (
        req.method !== "POST" ||
        req.headers.origin !== options.origin ||
        !req.headers["content-type"]?.startsWith(
          "application/x-www-form-urlencoded",
        )
      ) {
        res.writeHead(403).end("Ongeldige herkomst.");
        return;
      }
      const form = new URLSearchParams(await readBody(req, 4096));
      if (form.get("csrf") !== s.csrf) {
        res.writeHead(403).end("Ongeldige testsessie.");
        return;
      }
      if (url.pathname === "/login") {
        if (blockedUntil > Date.now()) {
          s.message = "Te veel mislukte logins. Wacht vijf minuten.";
          redirect();
          return;
        }
        const password = form.get("password") ?? "";
        if (password.length > 256 || !equal(password, options.password)) {
          failedLogins++;
          if (failedLogins >= 10) blockedUntil = Date.now() + 5 * 60_000;
          s.message = "Toegangswachtwoord niet geaccepteerd.";
          redirect();
          return;
        }
        failedLogins = 0;
        browsers.delete(sid!);
        sid = random();
        s.authenticated = true;
        s.csrf = random();
        s.expiresAt = Date.now() + 20 * 60_000;
        browsers.set(sid, s);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1200${parsed.protocol === "https:" ? "; Secure" : ""}`,
        );
        s.message =
          "Privéproef geopend. De tijdelijke koppeling werkt ook in je andere browser na inloggen met hetzelfde toegangswachtwoord.";
        redirect();
        return;
      }
      if (!s.authenticated) {
        res.writeHead(401).end("Log eerst in.");
        return;
      }
      if (url.pathname === "/logout") {
        browsers.delete(sid!);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${parsed.protocol === "https:" ? "; Secure" : ""}`,
        );
        redirect();
        return;
      }
      if (url.pathname === "/clear") {
        if (form.get("confirm") !== "yes") {
          s.message = "Bevestig eerst het wissen.";
          redirect();
          return;
        }
        version++;
        active = undefined;
        pairing = undefined;
        lastResult = "Tijdelijke toestemming gewist.";
        s.message = lastResult;
        redirect();
        return;
      }
      if (busy) {
        s.message = "Er loopt al een aanvraag. Wacht op het resultaat.";
        redirect();
        return;
      }
      if (url.pathname === "/pair") {
        pairing = { code: random(), expiresAt: Date.now() + 5 * 60_000 };
        s.message =
          "Koppelcode gemaakt. Gebruik deze binnen vijf minuten op de lokale proefpagina van je pc.";
        redirect();
        return;
      }
      if (url.pathname === "/probe") {
        if (!active || active.attempts >= 3 || form.get("consent") !== "yes") {
          s.message =
            "Koppel eerst een geldige toestemming en bevestig één testaanvraag.";
          redirect();
          return;
        }
        const model = form.get("model");
        if (!active.models.some((m) => m.slug === model)) {
          s.message = "Kies een model uit deze koppeling.";
          redirect();
          return;
        }
        const current = active;
        busy = true;
        try {
          if (
            current.session.lastProbeAt &&
            Date.now() - current.session.lastProbeAt < 60_000
          ) {
            s.message = "Wacht één minuut voor de volgende test.";
            redirect();
            return;
          }
          current.attempts++;
          await runProbe(current.session, model!, fetcher);
          if (active !== current || version !== current.revision) {
            s.message =
              "De koppeling is tijdens de test gewist. Het resultaat is niet meer actief.";
            redirect();
            return;
          }
          lastResult = `ONLINE TEST GESLAAGD · The Ride connection works. · Proces ${runtime} · ${new Date().toISOString()}${form.get("pcOff") === "yes" ? " · Jij bevestigde: pc uit en mobiel internet." : " · Pc-uitproef nog niet door jou bevestigd."}`;
          s.message = lastResult;
        } catch (error) {
          s.message = probeErrorMessage(error);
          lastResult = s.message;
        } finally {
          busy = false;
        }
        redirect();
        return;
      }
      res.writeHead(404).end();
    } catch (error) {
      json(400, {
        ok: false,
        error:
          error instanceof ProbeError ? error.code : "PROBE_REQUEST_REJECTED",
      });
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 90000;
  return server;
}
