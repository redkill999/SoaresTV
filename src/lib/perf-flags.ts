// =========================================================================
// perf-flags — flags temporárias de A/B para comparar comportamentos de
// playback no MESMO build, sem rebuild/rollback.
//
// Uso no console/APK:
//   window.__perfFlags.legacyApkBuffer = true   // ativa parâmetros pré-v12
//   window.__perfFlags.legacyApkBuffer = false  // volta ao smooth-buffer atual
//
// A flag só afeta LIVE no APK (nativeRuntime + isLive). Web/VOD e TV mode
// permanecem idênticos ao comportamento atual em qualquer estado da flag.
// =========================================================================

export type PerfFlags = {
  /** Quando true, LIVE no APK usa params pré-commit 2a98f49 (v12 smooth buffer). */
  legacyApkBuffer: boolean;
};

declare global {
  interface Window {
    __perfFlags?: PerfFlags;
  }
}

const DEFAULTS: PerfFlags = {
  legacyApkBuffer: false,
};

export function getPerfFlags(): PerfFlags {
  if (typeof window === "undefined") return { ...DEFAULTS };
  if (!window.__perfFlags) {
    window.__perfFlags = { ...DEFAULTS };
  }
  // Garante que todas as chaves existam mesmo se o usuário sobrescrever parcialmente.
  const cur = window.__perfFlags;
  for (const k of Object.keys(DEFAULTS) as (keyof PerfFlags)[]) {
    if (typeof cur[k] === "undefined") {
      (cur as Record<string, unknown>)[k] = DEFAULTS[k];
    }
  }
  return cur;
}

export function installPerfFlags(): void {
  if (typeof window === "undefined") return;
  getPerfFlags();
  // eslint-disable-next-line no-console
  console.log(
    "%c[PERF FLAGS] instalado — ajuste com window.__perfFlags.legacyApkBuffer = true|false",
    "color:#ff0;font-weight:bold",
    { ...window.__perfFlags },
  );
}
