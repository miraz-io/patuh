// Network helpers: IP normalisation, the outbound address guard (SSRF) and a fetch that cannot be rebound to a blocked address.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIPv4, isIPv6 } from "node:net";

export const BLOCKED = "That address is not allowed (link-local or cloud metadata)";

/** Eight 16-bit groups of an IPv6 address (dotted-quad tails and :: handled), or null. */
export function v6Groups(raw: string): number[] | null {
  let a = raw.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!isIPv6(a)) return null;
  const q = a.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (q) a = a.slice(0, q.index) + ((+q[1] << 8) | +q[2]).toString(16) + ":" + ((+q[3] << 8) | +q[4]).toString(16);
  const [head, tail] = a.split("::");
  const h = head ? head.split(":") : [], t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const mid = tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
  return [...h, ...mid, ...t].map((x) => parseInt(x, 16));
}

/** The IPv4 address hidden inside ::ffff:a.b.c.d, ::a.b.c.d and the NAT64 prefix 64:ff9b::/96, or the address itself if it is IPv4. */
export function embeddedV4(a: string): string | null {
  a = a.replace(/^\[|\]$/g, "");
  if (isIPv4(a)) return a;
  const g = v6Groups(a); if (!g) return null;
  const q = (x: number, y: number) => `${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`;
  if (g.slice(0, 5).every((v) => v === 0) && (g[5] === 0xffff || g[5] === 0)) return q(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((v) => v === 0)) return q(g[6], g[7]);
  return null;
}

/** Problem text for an IP literal that must never be an outbound target: link-local, cloud metadata. Private LAN and loopback stay allowed (Ollama, vLLM). */
export function addrProblem(a: string): string | null {
  const v4 = embeddedV4(a);
  if (v4 && (v4.startsWith("169.254.") || v4 === "100.100.100.200" || v4 === "168.63.129.16")) return BLOCKED;
  const g = v6Groups(a);
  if (g && ((g[0] & 0xffc0) === 0xfe80 || (g[0] === 0xfd00 && g[1] === 0x0ec2 && g.slice(2, 7).every((v) => v === 0) && g[7] === 0x254))) return BLOCKED;
  return null;
}

/** Throttle key for a client: IPv6 clients are grouped by /64 (one subscriber owns a whole /64), mapped IPv4 collapses to IPv4. */
export function ipGroup(ip: string): string {
  const v4 = embeddedV4(ip); if (v4) return v4;
  const g = v6Groups(ip);
  return g ? `${g.slice(0, 4).map((x) => x.toString(16)).join(":")}::/64` : ip;
}

/** DNS lookup used at connect time: every address the name resolves to is checked, so a name cannot be rebound to a metadata address between check and use. */
export const safeLookup = ((host: string, opts: { all?: boolean }, cb: (...a: any[]) => void) => {
  dns.lookup(host, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (addrs.some((x) => addrProblem(x.address))) return cb(new Error(BLOCKED));
    return opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
  });
}) as never;

const MAX_BODY = 5 * 1024 * 1024;
/** fetch for the AI endpoint: guarded lookup, no redirects, bounded body. Only what chatRaw needs (POST with a text body). */
export const pinnedFetch: typeof fetch = (input, init) => new Promise((resolve, reject) => {
  const u = new URL(String(input)), bad = addrProblem(u.hostname);
  if (bad) return reject(new Error(bad));
  const req = (u.protocol === "https:" ? https : http).request(u, { method: init?.method ?? "GET", headers: init?.headers as http.OutgoingHttpHeaders, lookup: safeLookup, signal: init?.signal ?? undefined }, (res) => {
    const chunks: Buffer[] = []; let n = 0;
    res.on("data", (c: Buffer) => { n += c.length; if (n > MAX_BODY) req.destroy(new Error("Response too large")); else chunks.push(c); });
    res.on("error", reject);
    res.on("end", () => {
      const s = res.statusCode ?? 502;
      if (s >= 300 && s < 400) return reject(new Error("Redirects are not followed"));
      resolve(new Response(s === 204 || s === 205 ? null : Buffer.concat(chunks), { status: s }));
    });
  });
  req.on("error", reject);
  req.end(init?.body as string | undefined);
});
