import pg from "pg";
import { databaseUrl } from "./database-url";
const globalDb = globalThis as unknown as { ridePool?: pg.Pool };
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  return (globalDb.ridePool ??= new pg.Pool({
    connectionString: databaseUrl(process.env.DATABASE_URL),
    max: 5,
    connectionTimeoutMillis: 10000,
  }));
}
export const athleteId = "00000000-0000-4000-8000-000000000001";
