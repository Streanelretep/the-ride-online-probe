export function databaseUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname)
      throw new Error();
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (!loopback) {
      if (
        ["disable", "no-verify"].includes(
          url.searchParams.get("sslmode") ?? "",
        ) ||
        url.searchParams.get("ssl") === "false"
      )
        throw new Error();
      // pg's URL parameters override its separate ssl options; make the URL explicit.
      url.searchParams.delete("ssl");
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    throw new Error("DATABASE_TLS_OR_URL_REQUIRED");
  }
}
