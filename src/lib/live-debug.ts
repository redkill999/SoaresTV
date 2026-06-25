// Stub vazio — diagnóstico LIVE foi removido na Fase 1 da reversão.
// Mantém os símbolos exportados para preservar a compilação do VideoPlayer
// sem efeitos colaterais (probes de rede, logs em loop, etc.).
export type LiveProbeReport = {
  best?: { ok?: boolean; ua?: string; uaString?: string; contentType?: string } | null;
  attempts?: unknown[];
};

export async function probeLiveStream(_url: string, _ua?: string | null): Promise<LiveProbeReport> {
  return { best: null, attempts: [] };
}
export function logLiveProbeReport(_r: LiveProbeReport, _ctx: Record<string, unknown>): void {}
export function liveContentKind(_ct?: string | null): "hls" | "ts" | "unknown" { return "unknown"; }
