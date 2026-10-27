import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { approvedChatGptOrigin } from "../contracts/chatgpt";
import { ChatGptConnections } from "./chatgpt-connections";
import { ChatGptService, subscriptionActionError } from "./chatgpt-service";
import { handleSubscriptionTransfer } from "./chatgpt-transfer";
import {
  cookieValue,
  htmlEscape as esc,
  probeStyle,
  readBody,
} from "./probe-http-utils";
type Browser = {
  csrf: string;
  expiresAt: number;
  authenticated: boolean;
  message: string;
  models: { slug: string; name: string }[];
  pair?: { code: string; expiresAt: number };
  busy: boolean;
};
type Options = {
  origin: string;
  password: string;
  repo: ChatGptConnections;
  fetcher?: typeof fetch;
  allowHttpForTests?: boolean;
};
const random = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest();
export function createOnlineConnectServer(options: Options) {
  const parsed = new URL(options.origin);
  if (
    options.origin !== approvedChatGptOrigin &&
    !(
      options.allowHttpForTests &&
      parsed.origin === options.origin &&
      parsed.hostname === "127.0.0.1" &&
      parsed.protocol === "http:"
    )
  )
    throw new Error("APPROVED_HTTPS_ORIGIN_REQUIRED");
  if (options.password.length < 24 || options.password.length > 256)
    throw new Error("SECURE_PASSWORD_REQUIRED");
  const cookieName =
    parsed.protocol === "https:" ? "__Host-ride-connect" : "ride-connect-test";
  const secure = parsed.protocol === "https:" ? "; Secure" : "";
  const browsers = new Map<string, Browser>();
  const runtime = randomBytes(8).toString("hex");
  const service = new ChatGptService(options.repo, options.fetcher);
  let failures = 0,
    blockedUntil = 0;
  const csrf = (s: Browser) =>
    `<input type="hidden" name="csrf" value="${s.csrf}">`;
  const frame = (body: string) =>
    `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blijvende ChatGPT-koppeling · The Ride</title><style>${probeStyle}</style></head><body><main><p class="eyebrow">THE RIDE / BLIJVENDE KOPPELING</p><h1>Je coach, ook morgen verbonden.</h1>${body}<p><small>Proces ${runtime}. Alleen de vaste testzin; de volledige sportcoach is nog in ontwikkeling.</small></p></main></body></html>`;
  const page = async (s: Browser) => {
    if (!s.authenticated)
      return frame(
        `<section class="card"><h2>Open je privéomgeving</h2><p>Gebruik PROBE_ACCESS_PASSWORD uit de Environment-instellingen van je eigen Render-service.</p><form action="/login" method="post">${csrf(s)}<label>Toegangswachtwoord<input type="password" name="password" required maxlength="256" autocomplete="current-password"></label><button class="primary">Open mijn koppeling →</button></form></section><p class="notice" role="status">${esc(s.message)}</p>`,
      );
    const status = await options.repo.status();
    if (s.pair && s.pair.expiresAt <= Date.now()) s.pair = undefined;
    const labels = {
      active: "TOESTEMMING OPGESLAGEN",
      disconnected: "NOG NIET VERBONDEN",
      refreshing: "WORDT VERNIEUWD",
      reauth_required: "OPNIEUW AANMELDEN",
    };
    return frame(
      `<p class="notice" role="status">${esc(s.message)}</p><section class="card"><span class="tag">${labels[status.state]}</span><h2>1 · Verbind jouw ChatGPT-abonnement</h2><p>De toestemming wordt versleuteld in je eigen database bewaard. De server vernieuwt geldige toegang wanneer je hem gebruikt. Slapen of herstarten van Render wist de opgeslagen koppeling niet.</p><ol><li>Maak hieronder een koppelcode.</li><li>Start op je pc <code>npm run chatgpt:connect</code> en open <code>http://127.0.0.1:4320</code>.</li><li>Plak daar de code, kies Continue with ChatGPT en bekijk de toestemming.</li><li>Keer terug en ververs deze pagina.</li></ol><form action="/pair" method="post">${csrf(s)}<label class="check"><input type="checkbox" name="consent" value="yes" required><span>Mijn vernieuwbare ChatGPT-toestemming mag op deze eigen server worden bewaard.</span></label><button ${s.busy ? "disabled" : ""}>Nieuwe koppelcode maken</button></form>${s.pair ? `<label>Koppelcode · vijf minuten geldig<input value="${s.pair.code}" readonly autocomplete="off"></label><p><small>Plak alleen in de lokale aanmeldhulp. Deel de code niet in de chat.</small></p>` : ""}<p><small>Na intrekken of definitief verlopen toestemming is opnieuw aanmelden via de pc nodig. De eerdere tienminutenproef op poort 4319 gebruikt een andere koppeling.</small></p></section><section class="card"><h2>2 · Test op je smartphone</h2><p>Haal eerst je modellen op. Elke AI-test is één handmatige aanvraag binnen je ChatGPT-gebruik, met uitsluitend de vaste testzin.</p><form action="/models" method="post">${csrf(s)}<button ${status.state !== "active" || s.busy ? "disabled" : ""}>Mijn modellen ophalen</button></form>${s.models.length && status.state === "active" ? `<form action="/test" method="post">${csrf(s)}<label>Model<select name="model">${s.models.map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}</option>`).join("")}</select></label><label class="check"><input type="checkbox" name="consent" value="yes" required><span>Voer één testzin uit via mijn abonnement.</span></label><label class="check"><input type="checkbox" name="pcOff" value="yes"><span>Mijn pc staat uit en ik gebruik mobiel internet. Dit is mijn eigen bevestiging.</span></label><button class="primary" ${s.busy ? "disabled" : ""}>Test mijn opgeslagen koppeling →</button></form>` : ""}${status.checkedAt ? `<p>Laatste volledig afgeronde test: ${esc(new Date(status.checkedAt).toISOString())}.</p>` : ""}<p><small>Voor de herstartproef: herstart deze bestaande service in Render, log opnieuw in op je smartphone en test opnieuw. Een nieuw proces-ID toont de herstart; de opgeslagen toestemming hoort beschikbaar te blijven.</small></p></section><section class="card"><h2>3 · Gebruik en loskoppelen</h2><p><a href="https://chatgpt.com/#settings" target="_blank" rel="noreferrer">Bekijk gebruik en apprechten in ChatGPT ↗</a></p><form action="/disconnect" method="post">${csrf(s)}<label class="check"><input type="checkbox" name="consent" value="yes" required><span>Verwijder de opgeslagen toestemming en vraag intrekking bij OpenAI.</span></label><button ${s.busy ? "disabled" : ""}>ChatGPT loskoppelen</button></form><form action="/logout" method="post">${csrf(s)}<button>Alleen deze browser uitloggen</button></form></section>`,
    );
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    let url: URL;
    try {
      url = new URL(req.url ?? "/", options.origin);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/healthz") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end('{"ok":true}');
      return;
    }
    if (req.headers.host !== parsed.host || url.origin !== options.origin) {
      res.writeHead(403).end();
      return;
    }
    for (const [key, s] of browsers)
      if (s.expiresAt <= Date.now()) browsers.delete(key);
    if (blockedUntil && blockedUntil <= Date.now()) {
      failures = 0;
      blockedUntil = 0;
    }
    let s: Browser | undefined;
    const redirect = () => res.writeHead(303, { Location: "/" }).end();
    try {
      if (
        ["/api/chatgpt/pair-info", "/api/chatgpt/import"].includes(url.pathname)
      ) {
        if (req.method !== "POST") {
          res.writeHead(405).end();
          return;
        }
        const headers = new Headers();
        for (const name of ["authorization", "content-type", "origin"])
          if (typeof req.headers[name] === "string")
            headers.set(name, req.headers[name]);
        const request = new Request(url, {
          method: "POST",
          headers,
          body: await readBody(req, 128000),
        });
        const response = await handleSubscriptionTransfer(
          request,
          url.pathname.endsWith("pair-info") ? "pair-info" : "import",
          options.repo,
          options.fetcher,
        );
        response.headers.forEach((value, name) => res.setHeader(name, value));
        res.writeHead(response.status).end(await response.text());
        return;
      }
      let sid = cookieValue(req, cookieName);
      s = sid ? browsers.get(sid) : undefined;
      if (!s && req.method === "GET" && url.pathname === "/") {
        if (browsers.size >= 50) {
          res.writeHead(429).end();
          return;
        }
        sid = random();
        s = {
          csrf: random(),
          expiresAt: Date.now() + 20 * 60000,
          authenticated: false,
          message: "Alleen voor de eigenaar van deze server.",
          models: [],
          busy: false,
        };
        browsers.set(sid, s);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1200${secure}`,
        );
      }
      if (!s) {
        res.writeHead(401).end("Open eerst de startpagina.");
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await page(s));
        return;
      }
      if (
        req.method !== "POST" ||
        req.headers.origin !== options.origin ||
        req.headers["content-type"]?.split(";")[0] !==
          "application/x-www-form-urlencoded"
      ) {
        res.writeHead(403).end("Ongeldige herkomst.");
        return;
      }
      const form = new URLSearchParams(await readBody(req, 4096));
      if (form.get("csrf") !== s.csrf) {
        res.writeHead(403).end();
        return;
      }
      if (url.pathname === "/login") {
        if (blockedUntil > Date.now()) {
          s.message = "Te veel mislukte logins. Wacht vijf minuten.";
          redirect();
          return;
        }
        const password = form.get("password") ?? "";
        if (
          password.length > 256 ||
          !timingSafeEqual(digest(password), digest(options.password))
        ) {
          if (++failures >= 10) blockedUntil = Date.now() + 5 * 60000;
          s.message = "Toegangswachtwoord niet geaccepteerd.";
          redirect();
          return;
        }
        failures = 0;
        browsers.delete(sid!);
        sid = random();
        s.csrf = random();
        s.authenticated = true;
        s.expiresAt = Date.now() + 20 * 60000;
        s.message =
          "Je privéomgeving is geopend. De database bewaart je gekoppelde toestemming.";
        browsers.set(sid, s);
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1200${secure}`,
        );
        redirect();
        return;
      }
      if (!s.authenticated) {
        res.writeHead(401).end();
        return;
      }
      if (url.pathname === "/logout") {
        browsers.delete(sid!);
        s.pair = undefined;
        s.models = [];
        res.setHeader(
          "Set-Cookie",
          `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
        );
        redirect();
        return;
      }
      if (s.busy) {
        s.message = "Er is al een handeling actief. Wacht even.";
        redirect();
        return;
      }
      if (
        ["/pair", "/test", "/disconnect"].includes(url.pathname) &&
        form.get("consent") !== "yes"
      ) {
        s.message = "Bevestig eerst de toestemming voor deze handeling.";
        redirect();
        return;
      }
      s.busy = true;
      if (url.pathname === "/pair") {
        s.pair = await options.repo.createPair();
        s.message =
          "Koppelcode gemaakt. Gebruik hem binnen vijf minuten in de lokale aanmeldhulp.";
      } else if (url.pathname === "/models") {
        s.models = await service.models();
        s.message = "Modellen opgehaald; dit is nog geen geslaagde AI-test.";
      } else if (url.pathname === "/test") {
        const model = form.get("model");
        if (!s.models.some((m) => m.slug === model))
          throw new Error("INVALID_MODEL");
        await service.test(String(model));
        s.message = `ONLINE TEST GESLAAGD · The Ride connection works. · Opgeslagen toestemming · Proces ${runtime} · ${new Date().toISOString()}${form.get("pcOff") === "yes" ? " · Jij bevestigde: pc uit en mobiel internet." : ""}`;
      } else if (url.pathname === "/disconnect") {
        const revoked = await service.disconnect();
        s.models = [];
        s.pair = undefined;
        s.message = revoked
          ? "Tokens verwijderd; OpenAI heeft de intrekking geaccepteerd."
          : "Tokens verwijderd. Intrekking bij OpenAI kon niet worden bevestigd; trek de apprechten ook in via ChatGPT-instellingen.";
      } else {
        s.busy = false;
        res.writeHead(404).end();
        return;
      }
      s.busy = false;
      redirect();
    } catch (error) {
      if (req.method === "GET") {
        res
          .writeHead(503, { "Content-Type": "text/html; charset=utf-8" })
          .end(
            frame(
              '<section class="card"><h2>Je opslag is even niet bereikbaar</h2><p>Controleer of je Supabase-project actief is en de databaseconfiguratie klopt. <a href="/">Probeer opnieuw</a>.</p></section>',
            ),
          );
      } else if (s) {
        s.busy = false;
        s.message = subscriptionActionError(error);
        redirect();
      } else
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end('{"error":"REQUEST_NOT_ACCEPTED"}');
    }
  });
  server.requestTimeout = 180000;
  server.headersTimeout = 10000;
  return server;
}
