import { createOnlineConnectServer } from "../src/server/online-connect-http";
import { chatGptConnections } from "../src/server/chatgpt-connections";
import { db, athleteId } from "../src/server/db";
import { checkOnlineStorage } from "../src/server/online-storage-check";
const port = Number(process.env.PORT ?? 10000);
const key = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");
if (
  !process.env.DATABASE_URL ||
  key.length !== 32 ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535
) {
  console.error(
    "CONNECT_SETUP_REQUIRED: stel DATABASE_URL en APP_ENCRYPTION_KEY veilig in bij Render.",
  );
  process.exit(1);
}
try {
  const check = await checkOnlineStorage(db(), athleteId);
  if (!check.ok) {
    console.error(`CONNECT_STORAGE_FAILED: ${check.code}`);
    await db().end();
    process.exit(1);
  }
  console.log(
    "CONNECT_STORAGE_OK: database lezen/schrijven en encryptie gecontroleerd; testrecord teruggedraaid.",
  );
  if (check.storedCredentialChecked)
    console.log(
      "CONNECT_EXISTING_KEY_OK: bestaande opgeslagen toestemming kan worden ontsleuteld.",
    );
  const server = createOnlineConnectServer({
    origin: process.env.RENDER_EXTERNAL_URL ?? "",
    password: process.env.PROBE_ACCESS_PASSWORD ?? "",
    repo: chatGptConnections(),
  });
  server.on("error", () => {
    console.error("CONNECT_START_FAILED");
    process.exitCode = 1;
  });
  server.listen(port, "0.0.0.0", () =>
    console.log("Blijvende koppeling gestart. Geheimen worden niet gelogd."),
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      server.close(() => {
        void db().end();
      });
      server.closeAllConnections();
    });
} catch {
  console.error(
    "CONNECT_START_FAILED: controleer databaseverbinding, migrations en serverconfiguratie.",
  );
  await db().end();
  process.exitCode = 1;
}
