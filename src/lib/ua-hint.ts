// Cache do User-Agent que funcionou no último login bem-sucedido por host.
// Cortar o "carrossel" de 7 UAs no próximo login do mesmo servidor.
//
// Chave: hostname do servidor (sem porta). Painéis costumam aceitar/recusar UA
// no nível do datacenter, então um único UA cobre todas as portas do mesmo host.

const KEY = "soarestv:uaHint";

function readMap(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function writeMap(m: Record<string, string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* quota — ignora */
  }
}

function hostOf(server: string): string | null {
  try {
    let s = server.trim();
    if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
    return new URL(s).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function getUAHint(server: string): string | undefined {
  const h = hostOf(server);
  if (!h) return undefined;
  return readMap()[h];
}

export function setUAHint(server: string, ua: string) {
  const h = hostOf(server);
  if (!h || !ua) return;
  const m = readMap();
  if (m[h] === ua) return;
  m[h] = ua;
  writeMap(m);
}
