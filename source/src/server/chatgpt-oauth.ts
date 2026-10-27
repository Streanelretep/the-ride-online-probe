// Server/loopback relay only. Never pass these records to a Client Component.
import { jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import {
  beginLogin,
  issuer,
  resource,
  openAiKeys,
  type PendingLogin,
} from "./chatgpt-probe";

export const requiredScopes = [
  "openid",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
  "offline_access",
];
export const hostSchema = z
  .string()
  .regex(
    /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
export const clientSchema = z.string().regex(/^oaiapp_[A-Za-z0-9_-]{1,200}$/);
const secret = z.string().min(1).max(32000);
export const renewableSchema = z
  .object({
    hostId: hostSchema,
    clientId: clientSchema,
    subject: z.string().min(1).max(500),
    accessToken: secret,
    refreshToken: secret,
    idToken: secret,
    scopes: z.array(z.string().max(100)).max(30),
    expiresAt: z.number().int().positive(),
    refreshExpiresAt: z.number().int().positive(),
    earliestRefreshAt: z.number().int().nonnegative(),
  })
  .strict();
export type RenewableCredential = z.infer<typeof renewableSchema>;
export class SubscriptionError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export const subscriptionMessages: Record<string, string> = {
  NOT_CONNECTED: "Verbind eerst je ChatGPT-abonnement.",
  REAUTH_REQUIRED:
    "De toestemming moet opnieuw worden gekoppeld via de lokale aanmeldhulp op je pc.",
  BUSY: "De verbinding wordt al bijgewerkt. Probeer zo meteen opnieuw.",
  RETRY_LATER:
    "OpenAI is tijdelijk niet bereikbaar of vraagt om te wachten. Je koppeling blijft bewaard; probeer later opnieuw.",
  CLIENT_CONFIGURATION:
    "OpenAI accepteert de appregistratie niet. De configuratie moet worden gecontroleerd.",
  INVALID_IDENTITY:
    "De identiteit of toestemming kon niet worden bevestigd. Er is niets gekoppeld.",
  INVALID_PAIR:
    "Deze koppelcode is ongeldig, verlopen of al gebruikt. Maak in de app een nieuwe code.",
  INVALID_DESTINATION:
    "Gebruik het exacte HTTPS-hoofdadres van je eigen Render-app.",
  TOKEN_RESPONSE:
    "OpenAI gaf geen bruikbare vernieuwbare toestemming terug. Koppel opnieuw met toestemming voor blijvende toegang.",
  CONNECTION_CHANGED: "De koppeling is intussen gewijzigd. Ververs de pagina.",
  CONFIRMATION: "Bevestig eerst de toestemming voor deze handeling.",
  INVALID_MODEL:
    "Haal je modellen opnieuw op en kies een model uit jouw account.",
};
export function subscriptionMessage(error: unknown) {
  return error instanceof SubscriptionError && subscriptionMessages[error.code]
    ? subscriptionMessages[error.code]
    : "De koppeling kon niet worden bijgewerkt. Controleer de installatie en probeer opnieuw. Geheimen worden niet in meldingen getoond.";
}
export function beginRenewableLogin(
  hostId: string,
  redirectUri: string,
  previous?: { clientId: string; subject: string },
) {
  hostSchema.parse(hostId);
  const login = beginLogin(hostId, redirectUri);
  const url = new URL(login.url);
  url.searchParams.set(
    "scope",
    "openid profile email resource.invoke chatgpt.tokens.use.direct offline_access",
  );
  if (previous) {
    clientSchema.parse(previous.clientId);
    url.searchParams.set("client_id", previous.clientId);
    url.searchParams.delete("agent_name_hint");
    login.pending.clientId = previous.clientId;
    login.pending.subject = previous.subject;
  }
  return { ...login, url: url.toString() };
}
async function boundedJson(response: Response): Promise<any> {
  if (!response.body) throw new SubscriptionError("TOKEN_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 128000) throw new SubscriptionError("TOKEN_RESPONSE");
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SubscriptionError("TOKEN_RESPONSE");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function tokenRequest(body: URLSearchParams, fetcher: typeof fetch) {
  let response: Response;
  try {
    response = await fetcher(`${issuer}/api/accounts/oauth/token`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new SubscriptionError("RETRY_LATER");
  }
  const raw = await boundedJson(response).catch(() => null);
  if (!response.ok) {
    const code = typeof raw?.error === "string" ? raw.error : raw?.error?.code;
    if (
      [
        "invalid_grant",
        "invalid_refresh_token",
        "token_expired",
        "refresh_token_expired",
        "refresh_token_invalidated",
        "refresh_token_reused",
      ].includes(code)
    )
      throw new SubscriptionError("REAUTH_REQUIRED");
    if (code === "invalid_client")
      throw new SubscriptionError("CLIENT_CONFIGURATION");
    throw new SubscriptionError(
      response.status === 429 || response.status >= 500
        ? "RETRY_LATER"
        : "TOKEN_RESPONSE",
    );
  }
  const parsed = z
    .object({
      access_token: secret,
      refresh_token: secret,
      id_token: secret.optional(),
      token_type: z.string(),
      expires_in: z.number().int().positive().max(86400),
      scope: z.string().max(3000).optional(),
      earliest_refresh_at: z
        .union([z.number().int().nonnegative(), z.string().max(80)])
        .optional(),
    })
    .safeParse(raw);
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== "bearer")
    throw new SubscriptionError("TOKEN_RESPONSE");
  return parsed.data;
}
async function verifyIdentity(
  idToken: string,
  clientId: string,
  fetcher: typeof fetch,
  keys?: JWTVerifyGetKey,
  nonce?: string,
  subject?: string,
) {
  try {
    const { payload } = await jwtVerify(
      idToken,
      keys ?? (await openAiKeys(fetcher)),
      {
        issuer,
        audience: clientId,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "exp", "iat"],
        clockTolerance: 5,
      },
    );
    if (
      !payload.sub ||
      (nonce !== undefined && payload.nonce !== nonce) ||
      (subject && payload.sub !== subject)
    )
      throw new Error();
    return payload.sub;
  } catch {
    throw new SubscriptionError("INVALID_IDENTITY");
  }
}
export async function verifyAccess(
  credential: RenewableCredential,
  fetcher: typeof fetch = fetch,
  keys?: JWTVerifyGetKey,
) {
  try {
    const { payload } = await jwtVerify(
      credential.accessToken,
      keys ?? (await openAiKeys(fetcher)),
      {
        issuer,
        audience: resource,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "exp", "iat", "client_id", "scope"],
        clockTolerance: 5,
      },
    );
    const scopes =
      typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
    if (
      payload.sub !== credential.subject ||
      payload.client_id !== credential.clientId ||
      !requiredScopes.every((s) => scopes.includes(s)) ||
      !requiredScopes.every((s) => credential.scopes.includes(s))
    )
      throw new Error();
    return Math.min(credential.expiresAt, payload.exp! * 1000);
  } catch {
    throw new SubscriptionError("INVALID_IDENTITY");
  }
}
function nextCredential(
  raw: Awaited<ReturnType<typeof tokenRequest>>,
  base: {
    hostId: string;
    clientId: string;
    subject: string;
    idToken: string;
    scopes: string[];
  },
) {
  const now = Date.now();
  const scopes =
    raw.scope === undefined
      ? base.scopes
      : raw.scope.split(/\s+/).filter(Boolean);
  if (!requiredScopes.every((s) => scopes.includes(s)))
    throw new SubscriptionError("INVALID_IDENTITY");
  const earliest = raw.earliest_refresh_at;
  const earliestRefreshAt =
    earliest === undefined
      ? 0
      : typeof earliest === "number"
        ? earliest * 1000
        : Date.parse(earliest);
  if (!Number.isSafeInteger(earliestRefreshAt) || earliestRefreshAt < 0)
    throw new SubscriptionError("TOKEN_RESPONSE");
  return renewableSchema.parse({
    ...base,
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    idToken: raw.id_token ?? base.idToken,
    scopes,
    expiresAt: now + raw.expires_in * 1000,
    refreshExpiresAt: now + 30 * 86400000,
    earliestRefreshAt,
  });
}
export async function finishRenewableLogin(
  pending: PendingLogin,
  callback: URLSearchParams,
  hostId: string,
  fetcher: typeof fetch = fetch,
  keys?: JWTVerifyGetKey,
) {
  if (
    Date.now() >= pending.expiresAt ||
    callback.getAll("state").length !== 1 ||
    callback.getAll("code").length !== 1 ||
    callback.getAll("client_id").length > 1 ||
    callback.get("state") !== pending.state ||
    callback.has("error")
  )
    throw new SubscriptionError("INVALID_IDENTITY");
  const clientId = callback.get("client_id") ?? pending.clientId;
  const code = callback.get("code");
  if (
    !clientSchema.safeParse(clientId).success ||
    !code ||
    code.length > 4096 ||
    (pending.clientId && pending.clientId !== clientId)
  )
    throw new SubscriptionError("INVALID_IDENTITY");
  const raw = await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId!,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
      resource,
    }),
    fetcher,
  );
  if (!raw.id_token || !raw.scope)
    throw new SubscriptionError("TOKEN_RESPONSE");
  const subject = await verifyIdentity(
    raw.id_token,
    clientId!,
    fetcher,
    keys,
    pending.nonce,
    pending.subject,
  );
  const credential = nextCredential(raw, {
    hostId,
    clientId: clientId!,
    subject,
    idToken: raw.id_token,
    scopes: [],
  });
  credential.expiresAt = await verifyAccess(credential, fetcher, keys);
  return { credential, nonce: pending.nonce };
}
export async function refreshCredential(
  old: RenewableCredential,
  fetcher: typeof fetch = fetch,
  keys?: JWTVerifyGetKey,
) {
  if (old.refreshExpiresAt <= Date.now())
    throw new SubscriptionError("REAUTH_REQUIRED");
  if (old.earliestRefreshAt > Date.now())
    throw new SubscriptionError("RETRY_LATER");
  const raw = await tokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: old.clientId,
      refresh_token: old.refreshToken,
      resource,
    }),
    fetcher,
  );
  if (raw.id_token)
    await verifyIdentity(
      raw.id_token,
      old.clientId,
      fetcher,
      keys,
      undefined,
      old.subject,
    );
  const next = nextCredential(raw, old);
  next.expiresAt = await verifyAccess(next, fetcher, keys);
  return next;
}
export async function verifyRenewableImport(
  input: unknown,
  hostId: string,
  fetcher: typeof fetch = fetch,
  keys?: JWTVerifyGetKey,
) {
  const { credential, nonce } = z
    .object({ credential: renewableSchema, nonce: z.string().min(32).max(200) })
    .strict()
    .parse(input);
  if (
    credential.hostId !== hostId ||
    credential.expiresAt <= Date.now() ||
    credential.expiresAt > Date.now() + 86400000 ||
    credential.refreshExpiresAt > Date.now() + 30 * 86400000 + 60000 ||
    credential.refreshExpiresAt <= Date.now()
  )
    throw new SubscriptionError("INVALID_IDENTITY");
  await verifyIdentity(
    credential.idToken,
    credential.clientId,
    fetcher,
    keys,
    nonce,
    credential.subject,
  );
  credential.expiresAt = await verifyAccess(credential, fetcher, keys);
  return credential;
}
export async function revokeCredential(
  credential: RenewableCredential,
  fetcher: typeof fetch = fetch,
) {
  try {
    const discovery = await fetcher(
      `${issuer}/.well-known/openid-configuration`,
      { redirect: "error", signal: AbortSignal.timeout(15000) },
    );
    if (!discovery.ok) return false;
    const metadata = await boundedJson(discovery);
    const url = new URL(metadata.revocation_endpoint);
    if (
      metadata.issuer !== issuer ||
      url.origin !== issuer ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    )
      return false;
    const response = await fetcher(url.toString(), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: credential.refreshToken,
        token_type_hint: "refresh_token",
        client_id: credential.clientId,
      }),
    });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    return false;
  }
}
