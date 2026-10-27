import { z } from "zod";
import { jwtVerify, type JWTVerifyGetKey } from "jose";
import {
  issuer,
  openAiKeys,
  ProbeError,
  probeMessages,
  type ProbeSession,
} from "./chatgpt-probe";

export const transferSchema = z
  .object({
    hostId: z.string().regex(/^urn:uuid:[0-9a-f-]{36}$/),
    clientId: z.string().regex(/^oaiapp_[A-Za-z0-9_-]{1,200}$/),
    subject: z.string().min(1).max(500),
    accessToken: z.string().min(1).max(32000),
    idToken: z.string().min(1).max(32000),
    nonce: z.string().min(32).max(200),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type ProbeTransfer = z.infer<typeof transferSchema>;
export type RemotePair = {
  origin: string;
  code: string;
  hostId: string;
  expiresAt: number;
};
export function renderOrigin(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ProbeError("REMOTE_URL");
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !/^[a-z0-9][a-z0-9-]{0,62}\.onrender\.com$/.test(url.hostname)
  )
    throw new ProbeError("REMOTE_URL");
  return url.origin;
}
const codeSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
async function remoteFetch(
  fetcher: typeof fetch,
  origin: string,
  path: string,
  code: string,
  data: object,
) {
  if (!codeSchema.safeParse(code).success) throw new ProbeError("REMOTE_PAIR");
  let response: Response;
  try {
    response = await fetcher(`${origin}${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${code}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  } catch {
    throw new ProbeError("REMOTE_PAIR");
  }
  if (!response.ok) {
    const failure = await readRemoteJson(response).catch(() => null);
    if (
      failure &&
      typeof failure.error === "string" &&
      Object.hasOwn(probeMessages, failure.error)
    )
      throw new ProbeError(failure.error);
    throw new ProbeError("REMOTE_PAIR");
  }
  return response;
}
async function readRemoteJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.body) throw new ProbeError("REMOTE_PAIR");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16384) throw new ProbeError("REMOTE_PAIR");
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("INVALID_REMOTE_RESPONSE");
    return parsed;
  } catch {
    throw new ProbeError("REMOTE_PAIR");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function prepareRemotePair(
  value: string,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<RemotePair> {
  const origin = renderOrigin(value);
  const response = await remoteFetch(
    fetcher,
    origin,
    "/_probe/pair-info",
    code,
    {},
  );
  const info = z
    .object({
      app: z.literal("the-ride-online-probe"),
      protocol: z.literal(1),
      hostId: transferSchema.shape.hostId,
      expiresAt: z.number().int(),
    })
    .safeParse(await readRemoteJson(response));
  if (!info.success) throw new ProbeError("REMOTE_PAIR");
  if (
    info.data.expiresAt <= Date.now() ||
    info.data.expiresAt > Date.now() + 6 * 60_000
  )
    throw new ProbeError("REMOTE_PAIR");
  return {
    origin,
    code,
    hostId: info.data.hostId,
    expiresAt: info.data.expiresAt,
  };
}
export async function transferToRemote(
  pair: RemotePair,
  session: ProbeSession,
  fetcher: typeof fetch = fetch,
) {
  if (pair.expiresAt <= Date.now()) throw new ProbeError("REMOTE_PAIR");
  const body = transferSchema.parse({
    hostId: pair.hostId,
    clientId: session.clientId,
    subject: session.subject,
    accessToken: session.accessToken,
    idToken: session.idToken,
    nonce: session.nonce,
    expiresAt: session.expiresAt,
  });
  const response = await remoteFetch(
    fetcher,
    renderOrigin(pair.origin),
    "/_probe/import",
    pair.code,
    body,
  );
  const result = z
    .object({ ok: z.literal(true), expiresAt: z.number().int() })
    .parse(await readRemoteJson(response));
  return result.expiresAt;
}
export async function verifyTransfer(
  input: unknown,
  expectedHost: string,
  fetcher: typeof fetch = fetch,
  suppliedKeys?: JWTVerifyGetKey,
): Promise<ProbeSession> {
  const data = transferSchema.parse(input);
  if (
    data.hostId !== expectedHost ||
    data.expiresAt <= Date.now() ||
    data.expiresAt > Date.now() + 21 * 60_000
  )
    throw new ProbeError("REMOTE_PAIR");
  try {
    const { payload } = await jwtVerify(
      data.idToken,
      suppliedKeys ?? (await openAiKeys(fetcher)),
      {
        issuer,
        audience: data.clientId,
        algorithms: ["RS256", "ES256"],
        requiredClaims: ["sub", "exp", "iat", "nonce"],
        clockTolerance: 5,
      },
    );
    if (payload.sub !== data.subject || payload.nonce !== data.nonce)
      throw new Error("IDENTITY");
  } catch {
    throw new ProbeError("IDENTITY");
  }
  // Ten-minute, memory-only experiment. No refresh token or persistent credential.
  return {
    accessToken: data.accessToken,
    subject: data.subject,
    clientId: data.clientId,
    expiresAt: Math.min(data.expiresAt, Date.now() + 10 * 60_000),
  };
}
