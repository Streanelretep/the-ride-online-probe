import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto";
import type { QueryPort } from "./db-port";

type Client = QueryPort & { release(destroy?: boolean): void };
type Pool = { connect(): Promise<Client> };
export type StorageCheckCode =
  | "ENCRYPTION_KEY_INVALID"
  | "DATABASE_CONNECT_FAILED"
  | "DATABASE_TRANSACTION_FAILED"
  | "DATABASE_SCHEMA_MISSING"
  | "STORED_CREDENTIAL_KEY_MISMATCH"
  | "DATABASE_WRITE_FAILED"
  | "DATABASE_READBACK_FAILED"
  | "DATABASE_CLEANUP_FAILED";
export type StorageCheckResult =
  | { ok: true; storedCredentialChecked: boolean }
  | { ok: false; code: StorageCheckCode };

// No provider calls or real credentials are created. All writes are rolled back.
export async function checkOnlineStorage(
  pool: Pool,
  owner: string,
): Promise<StorageCheckResult> {
  const marker = `ride-config-check:${randomBytes(24).toString("hex")}`;
  let ciphertext: string;
  try {
    ciphertext = encrypt(marker);
    if (decrypt(ciphertext) !== marker) throw new Error();
  } catch {
    return { ok: false, code: "ENCRYPTION_KEY_INVALID" };
  }
  let client: Client | undefined;
  let transaction = false;
  let cleanupFailed = false;
  let code: StorageCheckCode = "DATABASE_CONNECT_FAILED";
  let result: StorageCheckResult;
  try {
    client = await pool.connect();
    code = "DATABASE_TRANSACTION_FAILED";
    await client.query("BEGIN");
    transaction = true;
    await client.query("SET LOCAL statement_timeout = '10s'");
    code = "DATABASE_SCHEMA_MISSING";
    await client.query("SELECT id FROM audit_log LIMIT 0");
    const stored = await client.query(
      "SELECT credential_ciphertext FROM chatgpt_connection WHERE athlete_id=$1",
      [owner],
    );
    const existing = stored.rows[0]?.credential_ciphertext;
    const storedCredentialChecked =
      typeof existing === "string" && existing.length > 0;
    if (storedCredentialChecked) {
      code = "STORED_CREDENTIAL_KEY_MISMATCH";
      decrypt(existing);
    }
    code = "DATABASE_WRITE_FAILED";
    const written = await client.query(
      `INSERT INTO audit_log(athlete_id,action,details)
       VALUES($1,'configuration.storage_check',$2::jsonb) RETURNING id`,
      [owner, JSON.stringify({ ciphertext })],
    );
    if (!written.rows[0]?.id) throw new Error();
    code = "DATABASE_READBACK_FAILED";
    const read = await client.query(
      "SELECT details FROM audit_log WHERE id=$1 AND athlete_id=$2",
      [written.rows[0].id, owner],
    );
    const received = read.rows[0]?.details?.ciphertext;
    if (typeof received !== "string" || decrypt(received) !== marker)
      throw new Error();
    result = { ok: true, storedCredentialChecked };
  } catch {
    // Never return driver exceptions, URLs, tokens, test strings or ciphertext.
    result = { ok: false, code };
  } finally {
    if (client && transaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        cleanupFailed = true;
      }
    }
    if (client) {
      try {
        client.release(cleanupFailed);
      } catch {
        cleanupFailed = true;
      }
    }
  }
  return cleanupFailed
    ? { ok: false, code: "DATABASE_CLEANUP_FAILED" }
    : result;
}
