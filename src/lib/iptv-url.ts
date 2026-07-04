export function maskIptvUrl(url: string): string {
  try {
    const isRelative = /^\//.test(url);
    const parsed = new URL(url, "http://local");

    const proxiedTarget = parsed.searchParams.get("u");
    if (proxiedTarget) parsed.searchParams.set("u", maskIptvUrl(proxiedTarget));

    for (const key of ["username", "password"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "***");
    }

    parsed.username = "";
    parsed.password = "";
    parsed.pathname = parsed.pathname.replace(
      /(\/(?:live|movie|series)\/)([^/]+)\/([^/]+)(\/)/i,
      "$1***USER***/***PASS***$4",
    );

    return isRelative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
  } catch {
    return url
      .replace(/(\/(?:live|movie|series)\/)([^/]+)\/([^/]+)(\/)/i, "$1***USER***/***PASS***$4")
      .replace(/([?&](?:username|password)=)[^&]+/gi, "$1***")
      .replace(/([?&]u=)[^&]+/gi, "$1***");
  }
}