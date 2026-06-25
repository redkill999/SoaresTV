// Stub vazio — buffer de diagnóstico VOD removido na Fase 1.
export type VodPlayerKind = "html5" | "hls" | "mpegts" | "exo" | "unknown";
export type VodDiagSession = {
  id: string;
  startedAt: number;
  host: string | null;
  result: "playing" | "failed" | "pending";
};

export function vodDiagStart(_input: Record<string, unknown>): string { return ""; }
export function vodDiagRecordAttempt(_id: string, _att: unknown): string { return ""; }
export function vodDiagPatchAttempt(_id: string, _attId: string, _patch: unknown): void {}
export function vodDiagMarkPlaying(_id: string, _kind: VodPlayerKind, _url: string): void {}
export function vodDiagMarkFailed(_id: string, _msg: string): void {}
export function vodDiagLatestFailedFor(_src: string): VodDiagSession | null { return null; }
export function vodDiagAttachFinalProbe(_id: string, _probe: unknown): void {}
export function vodDiagUpdateCandidates(_id: string, _candidates: string[]): void {}
export type VodProbeResult = {
  upstreamStatus?: number | string;
  clientStatus?: number | string;
  directCandidate?: string | null;
  finalUrl?: string | null;
  deadMediaBases?: string;
  redirected?: boolean;
  failureClass?: string;
  contentType?: string | null;
};
export async function probeVodCandidateForDiag(_url: string, _ua?: string | null): Promise<VodProbeResult> {
  return {};
}
export function vodDiagGetSessions(): VodDiagSession[] { return []; }
export function vodDiagSubscribe(_cb: () => void): () => void { return () => {}; }
export function vodDiagClear(): void {}
export function vodDiagFormat(_s: VodDiagSession): string { return ""; }
export function vodDiagFormatAll(): string { return ""; }
