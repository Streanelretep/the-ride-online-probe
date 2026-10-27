// Server-only credential repository, also usable from the local Node test harness.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encrypt, decrypt } from "./crypto";
import { db, athleteId } from "./db";
import type { QueryPort } from "./db-port";
import type { SubscriptionStatus } from "../contracts/chatgpt";
import {
  renewableSchema,
  refreshCredential,
  revokeCredential,
  SubscriptionError,
  type RenewableCredential,
} from "./chatgpt-oauth";

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
export class ChatGptConnections {
  constructor(
    private sql: QueryPort,
    private owner: string,
    private now = () => Date.now(),
  ) {}
  private async initialize() {
    await this.sql.query(
      "INSERT INTO chatgpt_connection(athlete_id,host_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [this.owner, `urn:uuid:${randomUUID()}`],
    );
  }
  private async recoverInterruptedRefresh() {
    // A crashed process may have consumed a rotating token. Never blindly replay it.
    await this.sql.query(
      "UPDATE chatgpt_connection SET state='reauth_required',credential_ciphertext=NULL,operation_started_at=NULL,error_code='REFRESH_INTERRUPTED',version=version+1,updated_at=now() WHERE athlete_id=$1 AND state='refreshing' AND operation_started_at<$2",
      [this.owner, new Date(this.now() - 90000)],
    );
  }
  async status(): Promise<SubscriptionStatus> {
    await this.recoverInterruptedRefresh();
    const { rows } = await this.sql.query(
      "SELECT state,access_expires_at,checked_at,error_code FROM chatgpt_connection WHERE athlete_id=$1",
      [this.owner],
    );
    const row = rows[0];
    return {
      state: row?.state ?? "disconnected",
      accessExpiresAt: row?.access_expires_at
        ? new Date(row.access_expires_at).toISOString()
        : null,
      checkedAt: row?.checked_at
        ? new Date(row.checked_at).toISOString()
        : null,
      errorCode: row?.error_code ?? null,
    };
  }
  async createPair() {
    await this.initialize();
    await this.recoverInterruptedRefresh();
    const code = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + 5 * 60000;
    const { rows } = await this.sql.query(
      "UPDATE chatgpt_connection SET pair_hash=$2,pair_expires_at=$3,version=version+1,updated_at=now() WHERE athlete_id=$1 AND state<>'refreshing' RETURNING host_id",
      [this.owner, hash(code), new Date(expiresAt)],
    );
    if (!rows.length) throw new SubscriptionError("BUSY");
    return { code, expiresAt };
  }
  async pairInfo(code: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(code))
      throw new SubscriptionError("INVALID_PAIR");
    const { rows } = await this.sql.query(
      "SELECT host_id,client_id,subject,pair_expires_at FROM chatgpt_connection WHERE athlete_id=$1 AND pair_hash=$2 AND pair_expires_at>$3 AND state<>'refreshing'",
      [this.owner, hash(code), new Date(this.now())],
    );
    const row = rows[0];
    if (!row) throw new SubscriptionError("INVALID_PAIR");
    return {
      app: "the-ride-coach",
      protocol: 2 as const,
      hostId: row.host_id as string,
      expiresAt: new Date(row.pair_expires_at).getTime(),
      ...(row.client_id && row.subject
        ? {
            registration: {
              clientId: row.client_id as string,
              subject: row.subject as string,
            },
          }
        : {}),
    };
  }
  async consumePair(code: string) {
    const info = await this.pairInfo(code);
    const { rows } = await this.sql.query(
      "UPDATE chatgpt_connection SET pair_hash=NULL,pair_expires_at=NULL,version=version+1 WHERE athlete_id=$1 AND pair_hash=$2 AND pair_expires_at>$3 AND state<>'refreshing' RETURNING version",
      [this.owner, hash(code), new Date(this.now())],
    );
    if (!rows.length) throw new SubscriptionError("INVALID_PAIR");
    return { ...info, version: rows[0].version as number };
  }
  async install(credential: RenewableCredential, version: number) {
    renewableSchema.parse(credential);
    const { rows } = await this.sql.query(
      `UPDATE chatgpt_connection SET client_id=$3,subject=$4,credential_ciphertext=$5,state='active',version=version+1,access_expires_at=$6,operation_started_at=NULL,retry_after=NULL,error_code=NULL,checked_at=NULL,updated_at=now()
      WHERE athlete_id=$1 AND version=$2 AND host_id=$7 AND (client_id IS NULL OR (client_id=$3 AND subject=$4)) RETURNING version`,
      [
        this.owner,
        version,
        credential.clientId,
        credential.subject,
        encrypt(JSON.stringify(credential)),
        new Date(credential.expiresAt),
        credential.hostId,
      ],
    );
    if (!rows.length) throw new SubscriptionError("CONNECTION_CHANGED");
  }
  private async load() {
    const { rows } = await this.sql.query(
      "SELECT state,version,credential_ciphertext,retry_after FROM chatgpt_connection WHERE athlete_id=$1",
      [this.owner],
    );
    return rows[0];
  }
  async access(
    refresh: (
      old: RenewableCredential,
    ) => Promise<RenewableCredential> = refreshCredential,
  ) {
    await this.recoverInterruptedRefresh();
    const row = await this.load();
    if (!row || row.state === "disconnected")
      throw new SubscriptionError("NOT_CONNECTED");
    if (row.state === "reauth_required")
      throw new SubscriptionError("REAUTH_REQUIRED");
    if (row.state === "refreshing") throw new SubscriptionError("BUSY");
    const old = renewableSchema.parse(
      JSON.parse(decrypt(row.credential_ciphertext)),
    );
    if (old.expiresAt > this.now() + 60000)
      return { credential: old, version: row.version as number };
    if (row.retry_after && new Date(row.retry_after).getTime() > this.now())
      throw new SubscriptionError("RETRY_LATER");
    const { rows } = await this.sql.query(
      "UPDATE chatgpt_connection SET state='refreshing',operation_started_at=$3,version=version+1 WHERE athlete_id=$1 AND version=$2 AND state='active' RETURNING version",
      [this.owner, row.version, new Date(this.now())],
    );
    if (!rows.length) throw new SubscriptionError("BUSY");
    const version = rows[0].version;
    let next: RenewableCredential;
    try {
      next = await refresh(old);
      if (
        next.clientId !== old.clientId ||
        next.subject !== old.subject ||
        next.hostId !== old.hostId
      )
        throw new SubscriptionError("INVALID_IDENTITY");
    } catch (error) {
      const code =
        error instanceof SubscriptionError ? error.code : "RETRY_LATER";
      const terminal = [
        "REAUTH_REQUIRED",
        "INVALID_IDENTITY",
        "TOKEN_RESPONSE",
      ].includes(code);
      await this.sql.query(
        "UPDATE chatgpt_connection SET state=$3,credential_ciphertext=CASE WHEN $4 THEN NULL ELSE credential_ciphertext END,operation_started_at=NULL,retry_after=$5,error_code=$6,version=version+1 WHERE athlete_id=$1 AND version=$2 AND state='refreshing'",
        [
          this.owner,
          version,
          terminal ? "reauth_required" : "active",
          terminal,
          new Date(this.now() + 60000),
          code,
        ],
      );
      throw new SubscriptionError(code);
    }
    // If persistence fails after remote rotation, leave the committed 'refreshing'
    // marker. Recovery asks for login instead of reusing the consumed old token.
    const saved = await this.sql.query(
      "UPDATE chatgpt_connection SET credential_ciphertext=$3,state='active',access_expires_at=$4,operation_started_at=NULL,retry_after=NULL,error_code=NULL,version=version+1,updated_at=now() WHERE athlete_id=$1 AND version=$2 AND state='refreshing' RETURNING version",
      [
        this.owner,
        version,
        encrypt(JSON.stringify(next)),
        new Date(next.expiresAt),
      ],
    );
    if (!saved.rows.length) throw new SubscriptionError("CONNECTION_CHANGED");
    return { credential: next, version: saved.rows[0].version as number };
  }
  async claimTest() {
    const { rows } = await this.sql.query(
      "UPDATE chatgpt_connection SET next_test_at=$2 WHERE athlete_id=$1 AND state='active' AND next_test_at<=$3 RETURNING version",
      [this.owner, new Date(this.now() + 60000), new Date(this.now())],
    );
    if (!rows.length) throw new SubscriptionError("RETRY_LATER");
  }
  async finishTest(version: number) {
    const { rows } = await this.sql.query(
      "UPDATE chatgpt_connection SET checked_at=$3,error_code=NULL WHERE athlete_id=$1 AND version=$2 AND state='active' RETURNING version",
      [this.owner, version, new Date(this.now())],
    );
    if (!rows.length) throw new SubscriptionError("CONNECTION_CHANGED");
  }
  async assertCurrent(version: number) {
    const { rows } = await this.sql.query(
      "SELECT 1 FROM chatgpt_connection WHERE athlete_id=$1 AND version=$2 AND state='active'",
      [this.owner, version],
    );
    if (!rows.length) throw new SubscriptionError("CONNECTION_CHANGED");
  }
  async disconnect(
    revoke: (
      credential: RenewableCredential,
    ) => Promise<boolean> = revokeCredential,
  ) {
    // Clear first, invalidating pending imports/refreshes. A stale completion cannot reconnect.
    const row = await this.load();
    const { rows } = await this.sql.query(
      "UPDATE chatgpt_connection SET state='disconnected',credential_ciphertext=NULL,pair_hash=NULL,pair_expires_at=NULL,operation_started_at=NULL,retry_after=NULL,access_expires_at=NULL,checked_at=NULL,error_code=NULL,version=version+1 WHERE athlete_id=$1 AND version=$2 RETURNING version",
      [this.owner, row?.version ?? -1],
    );
    if (!rows.length && row) throw new SubscriptionError("CONNECTION_CHANGED");
    if (!row?.credential_ciphertext) return false;
    try {
      return await revoke(
        renewableSchema.parse(JSON.parse(decrypt(row.credential_ciphertext))),
      );
    } catch {
      return false;
    }
  }
}
export const chatGptConnections = () => new ChatGptConnections(db(), athleteId);
