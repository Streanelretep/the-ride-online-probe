import { createHash } from "node:crypto";
import { createOnlineProbeServer } from "../src/server/online-probe-http";
const origin =
  process.env.RENDER_EXTERNAL_URL ?? process.env.PROBE_PUBLIC_ORIGIN ?? "";
const password = process.env.PROBE_ACCESS_PASSWORD ?? "";
const seed = process.env.PROBE_HOST_SEED ?? "";
const port = Number(process.env.PORT ?? 10000);
if (seed.length < 24 || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PROBE_SETUP_REQUIRED");
// Stable across restarts when the generated environment seed stays unchanged.
const hex = createHash("sha256").update(seed).digest("hex");
const hostId = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
const server = createOnlineProbeServer({ origin, password, hostId });
server.on("error", () => {
  process.stderr.write(
    "Online proef kon niet starten; controleer de configuratie.\n",
  );
  process.exitCode = 1;
});
const listenHost =
  process.env.PROBE_LISTEN_HOST === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0";
server.listen(port, listenHost, () =>
  process.stdout.write("Online proef gestart. Geen credentials in logs.\n"),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });
