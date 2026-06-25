// Stub vazio — buffer de diagnóstico LIVE removido na Fase 1.
// Mantém a API original em formato no-op para preservar imports.
export type LivePlayerKind = "hls" | "native" | "mpegts" | "exo" | "html5" | "unknown";
export type LiveDiagSession = {
  id: string;
  startedAt: number;
  host: string | null;
  result: "playing" | "failed" | "pending";
};

export function liveDiagStart(_input: Record<string, unknown>): string { return ""; }
export function liveDiagAttachProbe(_id: string, _report: unknown): void {}
export function liveDiagRecordAttempt(_id: string, _att: unknown): void {}
export function liveDiagMarkPlaying(_id: string, _kind: LivePlayerKind, _url: string): void {}
export function liveDiagMarkFailed(_id: string, _msg: string): void {}
export function liveDiagLatestFailedFor(_src: string): LiveDiagSession | null { return null; }
export function liveDiagSetMediaInfo(_id: string, _payload: unknown): void {}
export function liveDiagRecordFreeze(_id: string, _snap: unknown): void {}
export function liveDiagGetSessions(): LiveDiagSession[] { return []; }
export function liveDiagSubscribe(_cb: () => void): () => void { return () => {}; }
export function liveDiagClear(): void {}
export function liveDiagFormat(_s: LiveDiagSession): string { return ""; }
export function liveDiagFormatAll(): string { return ""; }
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* noop */ }
  return false;
}
