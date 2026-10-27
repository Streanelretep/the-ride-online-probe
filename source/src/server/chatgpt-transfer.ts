import { z } from "zod";
import type { JWTVerifyGetKey } from "jose";
import { approvedChatGptOrigin } from "../contracts/chatgpt";
import {
  hostSchema,
  clientSchema,
  SubscriptionError,
  verifyRenewableImport,
  type RenewableCredential,
} from "./chatgpt-oauth";
import type { ChatGptConnections } from "./chatgpt-connections";

const pairSchema = z
  .object({
    app: z.literal("the-ride-coach"),
    protocol: z.literal(2),
    hostId: hostSchema,
    expiresAt: z.number().int().positive(),
    registration: z
      .object({ clientId: clientSchema, subject: z.string().min(1).max(500) })
      .strict()
      .optional(),
  })
  .strict();
export type SubscriptionPair = z.infer<typeof pairSchema> & {
  origin: string;
  code: string;
};
export function subscriptionOrigin(value: string) {
  try {
    const url = new URL(value.trim());
    if (
      url.origin !== approvedChatGptOrigin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new SubscriptionError("INVALID_DESTINATION");
  }
}
export async function readLimitedJson(
  request: Request | Response,
  limit = 128000,
) {
  if (!request.body) throw new SubscriptionError("INVALID_PAIR");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) throw new Error();
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SubscriptionError("INVALID_PAIR");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function send(
  origin: string,
  path: string,
  code: string,
  body: unknown,
  fetcher: typeof fetch,
) {
  const destination = subscriptionOrigin(origin);
  if (!/^[A-Za-z0-9_-]{43}$/.test(code))
    throw new SubscriptionError("INVALID_PAIR");
  let response: Response;
  try {
    response = await fetcher(`${destination}${path}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60000),
      headers: {
        Authorization: `Bearer ${code}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SubscriptionError("INVALID_PAIR");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new SubscriptionError("INVALID_PAIR");
  }
  return readLimitedJson(response, 16000);
}
export async function prepareSubscriptionPair(
  value: string,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<SubscriptionPair> {
  const origin = subscriptionOrigin(value);
  const parsed = pairSchema.safeParse(
    await send(origin, "/api/chatgpt/pair-info", code, {}, fetcher),
  );
  if (
    !parsed.success ||
    parsed.data.expiresAt <= Date.now() ||
    parsed.data.expiresAt > Date.now() + 6 * 60000
  )
    throw new SubscriptionError("INVALID_PAIR");
  return { ...parsed.data, origin, code };
}
export async function transferSubscription(
  pair: SubscriptionPair,
  credential: RenewableCredential,
  nonce: string,
  fetcher: typeof fetch = fetch,
) {
  if (pair.expiresAt <= Date.now() || credential.hostId !== pair.hostId)
    throw new SubscriptionError("INVALID_PAIR");
  const result = await send(
    pair.origin,
    "/api/chatgpt/import",
    pair.code,
    { credential, nonce },
    fetcher,
  );
  if (
    !z
      .object({ ok: z.literal(true) })
      .strict()
      .safeParse(result).success
  )
    throw new SubscriptionError("INVALID_PAIR");
}
export async function handleSubscriptionTransfer(
  request: Request,
  operation: "pair-info" | "import",
  repo: ChatGptConnections,
  fetcher: typeof fetch = fetch,
  keys?: JWTVerifyGetKey,
) {
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    // Pair possession is the only authority on this direct relay-to-server channel.
    if (
      request.method !== "POST" ||
      request.headers.has("origin") ||
      request.headers.get("content-type")?.split(";")[0] !== "application/json"
    )
      throw new SubscriptionError("INVALID_PAIR");
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      request.headers.get("authorization") ?? "",
    );
    if (!match) throw new SubscriptionError("INVALID_PAIR");
    if (operation === "pair-info") {
      await readLimitedJson(request, 1024);
      return Response.json(await repo.pairInfo(match[1]), { headers });
    }
    // Consume before signature/network work; a code cannot win in two processes.
    const pair = await repo.consumePair(match[1]);
    const credential = await verifyRenewableImport(
      await readLimitedJson(request),
      pair.hostId,
      fetcher,
      keys,
    );
    if (
      pair.registration &&
      (credential.clientId !== pair.registration.clientId ||
        credential.subject !== pair.registration.subject)
    )
      throw new SubscriptionError("INVALID_IDENTITY");
    await repo.install(credential, pair.version);
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json(
      { error: "PAIR_NOT_ACCEPTED" },
      { status: 400, headers },
    );
  }
}
