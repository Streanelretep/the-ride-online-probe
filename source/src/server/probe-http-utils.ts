import type { IncomingMessage } from "node:http";
export const htmlEscape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function readBody(req: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const part = Buffer.from(chunk);
    bytes += part.length;
    if (bytes > limit) throw new Error("BODY_TOO_LARGE");
    chunks.push(part);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function cookieValue(req: IncomingMessage, name: string) {
  return req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export const probeStyle = `*{box-sizing:border-box}body{margin:0;background:#f4f6f2;color:#16201c;font:16px/1.6 Arial,sans-serif}main{max-width:780px;margin:auto;padding:38px 20px}h1{font-size:clamp(29px,6vw,44px);line-height:1.1;letter-spacing:-1px}h2{font-size:21px}.card{background:white;border:1px solid #e5e9e2;border-radius:14px;padding:24px;margin:20px 0}.eyebrow{font-size:11px;letter-spacing:2px;font-weight:bold}.tag{background:#e9efdf;padding:6px 10px;border-radius:5px;font-size:12px;font-weight:bold}.notice{background:#e9efdf;padding:18px;border-radius:8px}button{border:0;background:#16201c;color:white;padding:14px 20px;border-radius:6px;font:inherit;font-weight:bold;cursor:pointer}.primary{background:#c7f247;color:#16201c}button:disabled{opacity:.5;cursor:not-allowed}a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #578700;outline-offset:3px}label{display:block;margin:16px 0}select,input:not([type=checkbox]){font:inherit;max-width:100%;width:100%;padding:10px;border:1px solid #bbb;border-radius:6px}small{color:#657069}code{overflow-wrap:anywhere}.check{display:flex;align-items:flex-start;gap:10px}.check input{margin-top:6px;min-width:18px;height:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#36591c}`;
