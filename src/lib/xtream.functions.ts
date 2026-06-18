import { createServerFn } from "@tanstack/react-start";

// Proxy fetch for Xtream/M3U/XMLTV to bypass CORS.
// No DB, no auth — pure passthrough. Credentials live in the user's browser.

function normalizeServer(s: string) {
  let v = s.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v;
}

export const xtreamApi = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      server: string;
      username: string;
      password: string;
      action?: string;
      params?: Record<string, string | number>;
    }) => d,
  )
  .handler(async ({ data }) => {
    const base = normalizeServer(data.server);
    const url = new URL(`${base}/player_api.php`);
    url.searchParams.set("username", data.username);
    url.searchParams.set("password", data.password);
    if (data.action) url.searchParams.set("action", data.action);
    if (data.params) {
      for (const [k, v] of Object.entries(data.params)) {
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0 SoaresTV" },
    });
    if (!res.ok) throw new Error(`Xtream ${res.status}`);
    const text = await res.text();
    try {
      return { ok: true as const, data: JSON.parse(text) };
    } catch {
      return { ok: false as const, raw: text };
    }
  });

export const fetchM3U = createServerFn({ method: "POST" })
  .inputValidator((d: { url: string }) => d)
  .handler(async ({ data }) => {
    const res = await fetch(data.url, { headers: { "User-Agent": "Mozilla/5.0 SoaresTV" } });
    if (!res.ok) throw new Error(`M3U ${res.status}`);
    return { text: await res.text() };
  });
