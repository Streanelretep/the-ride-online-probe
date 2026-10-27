import { createHash, randomBytes } from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";

export const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
export const probePrompt = "Reply with exactly: The Ride connection works.";
const sharingScope = "chatgpt.tokens.use.direct";
const random = () => randomBytes(32).toString("base64url");
export class ProbeError extends Error {
  constructor(
    public code: string,
    public diagnostic?: ProbeDiagnostic,
  ) {
    super(code);
  }
}
export type ProbeDiagnostic = {
  stage: "http" | "stream";
  reason:
    | "http_error"
    | "unexpected_content_type"
    | "missing_body"
    | "malformed_event"
    | "provider_error"
    | "incomplete_response"
    | "completion_status"
    | "stream_ended"
    | "stream_interrupted"
    | "stream_timeout"
    | "size_limit"
    | "unexpected_output";
  httpStatus?: number;
  contentType?:
    "event-stream" | "json" | "text" | "html" | "binary" | "other" | "missing";
  bodyKind?:
    "sse" | "error_json" | "detail_json" | "json" | "html" | "text" | "empty";
  eventCount?: number;
  lastEvent?: string;
  providerCode?: string;
  parameter?: string;
};
const providerCodes = [
  "subscription_sharing_user_not_eligible",
  "subscription_sharing_usage_limit_exceeded",
  "subscription_sharing_usage_unavailable",
  "subscription_sharing_unsupported_capability",
  "subscription_sharing_route_not_supported",
  "subscription_sharing_invalid_user",
  "chatpass_v2_scope_not_authorized",
  "chatpass_v2_invalid_authorization_context",
  "model_not_found",
  "invalid_api_key",
  "invalid_request_error",
  "unsupported_parameter",
  "missing_required_parameter",
  "server_error",
  "rate_limit_exceeded",
  "insufficient_quota",
] as const;
const safeEventTypes = new Set([
  "response.created",
  "response.in_progress",
  "response.completed",
  "response.failed",
  "response.incomplete",
  "response.output_text.delta",
  "response.output_text.done",
  "response.output_item.added",
  "response.output_item.done",
  "response.content_part.added",
  "response.content_part.done",
  "error",
]);
function providerFailure(
  raw: unknown,
  diagnostic: ProbeDiagnostic,
  fallback = "PROVIDER",
) {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawCode =
    typeof value.code === "string"
      ? value.code
      : typeof value.type === "string"
        ? value.type
        : "";
  // Never surface free-form messages, arbitrary codes, IDs, output or credentials.
  const code = providerCodes.find((c) => c === rawCode);
  diagnostic.providerCode = code ?? "other_or_missing";
  if (
    typeof value.param === "string" &&
    [
      "model",
      "instructions",
      "input",
      "store",
      "stream",
      "tools",
      "service_tier",
    ].includes(value.param)
  )
    diagnostic.parameter = value.param;
  const category: Record<string, string> = {
    subscription_sharing_user_not_eligible: "NOT_ELIGIBLE",
    subscription_sharing_usage_limit_exceeded: "LIMIT",
    subscription_sharing_usage_unavailable: "USAGE_UNAVAILABLE",
    subscription_sharing_unsupported_capability: "UNSUPPORTED",
    subscription_sharing_route_not_supported: "ROUTE",
    subscription_sharing_invalid_user: "AUTH",
    chatpass_v2_scope_not_authorized: "PERMISSION",
    chatpass_v2_invalid_authorization_context: "PERMISSION",
    model_not_found: "MODEL_UNAVAILABLE",
    invalid_api_key: "AUTH",
    invalid_request_error: "REQUEST",
    unsupported_parameter: "REQUEST",
    missing_required_parameter: "REQUEST",
    server_error: "SERVER_ERROR",
    rate_limit_exceeded: "LIMIT",
    insufficient_quota: "LIMIT",
  };
  return new ProbeError(code ? category[code] : fallback, diagnostic);
}
export function probeErrorMessage(error: unknown) {
  if (!(error instanceof ProbeError)) return probeMessages.PROVIDER;
  const message = probeMessages[error.code] ?? probeMessages.PROVIDER;
  if (!error.diagnostic) return message;
  // Only locally defined labels and allowlisted metadata can reach the page.
  const d = error.diagnostic;
  return `${message} Diagnose: ${d.reason}${d.httpStatus ? ` · HTTP ${d.httpStatus}` : ""}${d.contentType ? ` · type ${d.contentType}` : ""}${d.bodyKind ? ` · inhoud ${d.bodyKind}` : ""}${d.providerCode ? ` · ${d.providerCode}` : ""}${d.parameter ? ` · veld ${d.parameter}` : ""}${d.lastEvent ? ` · laatste event ${d.lastEvent}` : ""}.`;
}
export const probeMessages: Record<string, string> = {
  ACCESS_DENIED:
    "Toestemming is niet gegeven. Er is geen AI-aanvraag uitgevoerd.",
  STATE:
    "De loginpoging is verlopen of hoort bij een ander venster. Begin opnieuw.",
  CLIENT:
    "OpenAI gaf geen geldige appregistratie terug. Deze account- of integratieroute is mogelijk niet beschikbaar.",
  TOKEN:
    "OpenAI kon de login niet afronden. Er is geen API-key gebruikt als alternatief.",
  IDENTITY:
    "De identiteit kon niet veilig worden bevestigd. De verbinding is niet geactiveerd.",
  SCOPE:
    "Inloggen is gelukt, maar gebruik van je ChatGPT-abonnement is niet toegestaan. Controleer je abonnement en de toestemming.",
  AUTH: "Je testsessie is verlopen. Log opnieuw in.",
  LIMIT:
    "Je ChatGPT-gebruikslimiet is bereikt of abonnementsgebruik is niet beschikbaar. Er wordt niet automatisch bijbetaald via een API-key.",
  MODELS:
    "Dit account geeft geen bruikbare modellen terug voor deze koppeling.",
  PROVIDER:
    "OpenAI is niet bereikbaar of deze preview-route wordt niet geaccepteerd. Probeer later opnieuw.",
  INCOMPLETE:
    "De testaanvraag is niet volledig afgerond. Dit telt niet als een geslaagde verbindingstest.",
  OUTPUT: "De aanvraag is afgerond, maar de verwachte testzin kwam niet terug.",
  COOLDOWN: "Wacht één minuut voordat je nog een test uitvoert.",
  NOT_ELIGIBLE:
    "OpenAI meldt dat deze gebruiker, werkruimte of dit beleid geen abonnementsgebruik toelaat. Herhaal dezelfde test niet; we moeten eerst de geschiktheid controleren.",
  USAGE_UNAVAILABLE:
    "OpenAI kon de beschikbaarheid van je abonnementsgebruik niet controleren. Je login blijft behouden; probeer later opnieuw.",
  UNSUPPORTED:
    "OpenAI accepteert een onderdeel van deze aanvraag niet binnen de abonnementskoppeling. We moeten het aangegeven veld controleren.",
  ROUTE:
    "OpenAI accepteert deze aanvraagroute niet voor de abonnementskoppeling. We moeten de integratie controleren.",
  PERMISSION:
    "De verleende toestemming wordt voor deze AI-aanvraag niet geaccepteerd. We moeten de appregistratie en toestemming controleren.",
  MODEL_UNAVAILABLE:
    "OpenAI accepteert het gekozen model niet voor deze aanvraag. Een model in de lijst is nog geen bewijs van beschikbare analyse.",
  REQUEST:
    "OpenAI wijst de inhoud of instellingen van de testaanvraag af. Dit is nog geen bewijs van een probleem met je abonnement.",
  SERVER_ERROR:
    "OpenAI heeft de aanvraag met een serverfout beëindigd. Er is geen volledig afgerond testantwoord.",
  REMOTE_URL:
    "Gebruik alleen het HTTPS-hoofdadres van je eigen Render-proef, eindigend op .onrender.com, zonder extra pad of parameters.",
  REMOTE_PAIR:
    "De online koppeling is niet geaccepteerd of de koppelcode is verlopen. Maak op je online proef een nieuwe code en controleer het adres.",
  REMOTE_CONSENT:
    "Bevestig eerst dat het jouw server is en dat de tijdelijke toestemming naar dat adres mag worden overgebracht.",
};
type Fetch = typeof fetch;
export type PendingLogin = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  clientId?: string;
  subject?: string;
};
export type ProbeSession = {
  accessToken: string;
  clientId: string;
  subject: string;
  expiresAt: number;
  lastProbeAt?: number;
  // Retained only for an explicitly requested, short-lived server transfer.
  idToken?: string;
  nonce?: string;
};
export function beginLogin(
  hostId: string,
  redirectUri: string,
  previous?: ProbeSession,
) {
  const pending: PendingLogin = {
    state: random(),
    nonce: random(),
    verifier: random(),
    redirectUri,
    expiresAt: Date.now() + 10 * 60_000,
    clientId: previous?.clientId,
    subject: previous?.subject,
  };
  const url = new URL(`${issuer}/api/accounts/authorize`);
  url.search = new URLSearchParams({
    client_id: previous?.clientId ?? "dynamic_agent_client",
    ...(previous ? {} : { agent_name_hint: "The Ride Coach" }),
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: redirectUri,
    // This short-lived test deliberately does not request offline_access or retain refresh tokens.
    scope: "openid profile email resource.invoke chatgpt.tokens.use.direct",
    resource,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256")
      .update(pending.verifier)
      .digest("base64url"),
  }).toString();
  return { url: url.toString(), pending };
}
async function safeFetch(fetcher: Fetch, url: string, init?: RequestInit) {
  try {
    return await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ProbeError("PROVIDER");
  }
}
async function jsonResponse(response: Response) {
  const raw = await response.text();
  if (raw.length > 1_000_000) throw new ProbeError("PROVIDER");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProbeError("PROVIDER");
  }
}
export async function openAiKeys(fetcher: Fetch = fetch) {
  const discovery = await safeFetch(
    fetcher,
    `${issuer}/.well-known/openid-configuration`,
  );
  if (!discovery.ok) throw new ProbeError("PROVIDER");
  const config = await jsonResponse(discovery);
  if (
    config.issuer !== issuer ||
    config.authorization_endpoint !== `${issuer}/api/accounts/authorize` ||
    config.token_endpoint !== `${issuer}/api/accounts/oauth/token`
  )
    throw new ProbeError("IDENTITY");
  const jwks = new URL(config.jwks_uri);
  if (jwks.origin !== issuer || jwks.username || jwks.password)
    throw new ProbeError("IDENTITY");
  return createRemoteJWKSet(jwks, {
    [customFetch]: fetcher,
    timeoutDuration: 15_000,
  });
}
export async function finishLogin(
  pending: PendingLogin,
  callback: URLSearchParams,
  fetcher: Fetch = fetch,
  suppliedKeys?: JWTVerifyGetKey,
  keepIdentityForTransfer = false,
): Promise<ProbeSession> {
  if (
    Date.now() >= pending.expiresAt ||
    callback.getAll("state").length !== 1 ||
    callback.get("state") !== pending.state
  )
    throw new ProbeError("STATE");
  if (callback.has("error")) throw new ProbeError("ACCESS_DENIED");
  const code = callback.get("code");
  const clientId = callback.get("client_id") ?? pending.clientId;
  if (
    !code ||
    code.length > 4096 ||
    !clientId ||
    !/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(clientId) ||
    (pending.clientId && pending.clientId !== clientId)
  )
    throw new ProbeError("CLIENT");
  const response = await safeFetch(
    fetcher,
    `${issuer}/api/accounts/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: pending.verifier,
        redirect_uri: pending.redirectUri,
        resource,
      }),
    },
  );
  if (!response.ok) throw new ProbeError("TOKEN");
  const raw = await jsonResponse(response);
  const parsed = z
    .object({
      access_token: z.string().min(1).max(32000),
      id_token: z.string().min(1).max(32000),
      token_type: z.string(),
      expires_in: z.number().positive().max(86400),
      scope: z.string(),
    })
    .safeParse(raw);
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== "bearer")
    throw new ProbeError("TOKEN");
  const tokens = parsed.data;
  let subject: string;
  try {
    const keys = suppliedKeys ?? (await openAiKeys(fetcher));
    const { payload } = await jwtVerify(tokens.id_token, keys, {
      issuer,
      audience: clientId,
      algorithms: ["RS256", "ES256"],
      requiredClaims: ["sub", "exp", "iat", "nonce"],
      clockTolerance: 5,
    });
    if (
      payload.nonce !== pending.nonce ||
      !payload.sub ||
      (pending.subject && payload.sub !== pending.subject)
    )
      throw new Error("IDENTITY");
    subject = payload.sub;
  } catch {
    throw new ProbeError("IDENTITY");
  }
  const scopes = new Set(tokens.scope.split(/\s+/));
  if (![sharingScope, "resource.invoke", "openid"].every((s) => scopes.has(s)))
    throw new ProbeError("SCOPE");
  return {
    accessToken: tokens.access_token,
    clientId,
    subject,
    ...(keepIdentityForTransfer
      ? { idToken: tokens.id_token, nonce: pending.nonce }
      : {}),
    expiresAt: Math.min(
      Date.now() + tokens.expires_in * 1000,
      Date.now() + 20 * 60_000,
    ),
  };
}
export type ProbeModel = { slug: string; name: string };
export async function listProbeModels(
  session: ProbeSession,
  fetcher: Fetch = fetch,
): Promise<ProbeModel[]> {
  if (session.expiresAt <= Date.now()) throw new ProbeError("AUTH");
  const response = await safeFetch(fetcher, `${resource}/models`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
  });
  if (!response.ok)
    throw new ProbeError(
      response.status === 429
        ? "LIMIT"
        : response.status === 401
          ? "AUTH"
          : "PROVIDER",
    );
  const data = await jsonResponse(response);
  const parsed = z
    .object({
      models: z
        .array(
          z.object({
            slug: z.string().min(1).max(200),
            display_name: z.string().max(200),
            visibility: z.string(),
          }),
        )
        .max(1000),
    })
    .safeParse(data);
  if (!parsed.success) throw new ProbeError("MODELS");
  const models = parsed.data.models
    .filter((m) => m.visibility === "list")
    .map((m) => ({ slug: m.slug, name: m.display_name }));
  if (!models.length) throw new ProbeError("MODELS");
  return models;
}
export async function runProbe(
  session: ProbeSession,
  model: string,
  fetcher: Fetch = fetch,
) {
  if (session.expiresAt <= Date.now()) throw new ProbeError("AUTH");
  if (session.lastProbeAt && Date.now() - session.lastProbeAt < 60_000)
    throw new ProbeError("COOLDOWN");
  session.lastProbeAt = Date.now();
  const response = await safeFetch(fetcher, `${resource}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: probePrompt }],
      store: false,
      stream: true,
    }),
  });
  const contentType = probeContentType(response);
  if (response.ok && contentType === "event-stream" && response.body)
    return consumeProbeStream(response.body, response.status);
  if (!response.body)
    throw new ProbeError("INCOMPLETE", {
      stage: "http",
      reason: "missing_body",
      httpStatus: response.status,
      contentType,
    });
  // Some proxies/adapters label SSE as plain text or omit its media type.
  // Validate the actual bounded body; never equate an HTTP 200 with success.
  const text = await readProbeBody(response.body);
  if (response.ok && /^(?:data:|event:|:)/.test(text.trimStart())) {
    const replay = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
    return consumeProbeStream(replay, response.status, contentType);
  }
  return rejectProbeResponse(response, text);
}
function probeContentType(
  response: Response,
): NonNullable<ProbeDiagnostic["contentType"]> {
  const type =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  return type === "text/event-stream"
    ? "event-stream"
    : type.includes("json")
      ? "json"
      : type === "text/plain"
        ? "text"
        : type === "text/html"
          ? "html"
          : type === "application/octet-stream"
            ? "binary"
            : type
              ? "other"
              : "missing";
}
async function readProbeBody(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(),
    decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000)
        throw new ProbeError("INCOMPLETE", {
          stage: "http",
          reason: "size_limit",
        });
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    throw new ProbeError("INCOMPLETE", {
      stage: "http",
      reason:
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
          ? "stream_timeout"
          : "stream_interrupted",
    });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function rejectProbeResponse(
  response: Response,
  text: string,
): Promise<never> {
  const type = probeContentType(response);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    /* Body type is not trusted. Never echo raw text. */
  }
  const object =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  throw providerFailure(
    object.error,
    {
      stage: "http",
      reason: response.ok ? "unexpected_content_type" : "http_error",
      httpStatus: response.status,
      contentType: type,
      bodyKind:
        raw && object.error
          ? "error_json"
          : raw && Object.hasOwn(object, "detail")
            ? "detail_json"
            : raw
              ? "json"
              : /^\s*</.test(text)
                ? "html"
                : text.trim()
                  ? "text"
                  : "empty",
    },
    response.status === 429
      ? "LIMIT"
      : response.status === 401
        ? "AUTH"
        : response.ok
          ? "INCOMPLETE"
          : "PROVIDER",
  );
}
export async function consumeProbeStream(
  body: ReadableStream<Uint8Array>,
  httpStatus = 200,
  contentType: ProbeDiagnostic["contentType"] = "event-stream",
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    text = "",
    completed = false,
    bytes = 0;
  const diagnostic: ProbeDiagnostic = {
    stage: "stream",
    reason: "stream_ended",
    httpStatus,
    contentType,
    bodyKind: "sse",
    eventCount: 0,
  };
  const fail = (
    reason: ProbeDiagnostic["reason"],
    code = "INCOMPLETE",
  ): never => {
    throw new ProbeError(code, { ...diagnostic, reason });
  };
  const processEvent = (block: string) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      fail("malformed_event");
    }
    if (!event || typeof event !== "object") fail("malformed_event");
    diagnostic.eventCount!++;
    diagnostic.lastEvent = safeEventTypes.has(event.type)
      ? event.type
      : "other";
    if (
      event.type === "response.output_text.delta" &&
      typeof event.delta === "string"
    )
      text += event.delta;
    if (event.type === "response.failed" || event.type === "error") {
      throw providerFailure(
        event.response?.error ?? event.error ?? event,
        { ...diagnostic, reason: "provider_error" },
        "INCOMPLETE",
      );
    }
    if (event.type === "response.incomplete") fail("incomplete_response");
    if (event.type === "response.completed") {
      if (event.response?.status !== "completed") fail("completion_status");
      completed = true;
    }
    if (text.length > 4000) fail("size_limit", "OUTPUT");
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000) fail("size_limit");
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(
        /\r\n/g,
        "\n",
      );
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        processEvent(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) processEvent(buffer);
    if (!completed) fail("stream_ended");
    if (text.trim() !== "The Ride connection works.")
      fail("unexpected_output", "OUTPUT");
    return text.trim();
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    fail(
      error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name)
        ? "stream_timeout"
        : "stream_interrupted",
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
