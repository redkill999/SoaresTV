// Helpers puros para o relay /api/live-stream. Separados do route file para
// facilitar testes unitários sem tocar em fetch/streams reais.

/** Procura sincronização MPEG-TS: byte 0x47 em offset X e novamente em X+188.
 *  Retorna o offset da sincronização, ou -1 se não encontrada nos primeiros
 *  ~376 bytes do chunk. Não exige que o primeiro byte seja 0x47 — chunk pode
 *  começar em posição intermediária dentro de um pacote. */
export function findMpegTsSync(data: Uint8Array): number {
  const maxOffset = Math.min(188, data.length - 188);
  if (maxOffset < 0) return -1;
  for (let offset = 0; offset <= maxOffset; offset++) {
    if (data[offset] === 0x47 && data[offset + 188] === 0x47) {
      return offset;
    }
  }
  return -1;
}

/** Detecta corpo textual óbvio (HTML, JSON, mensagem de erro plana) no início
 *  de um chunk. Usado para rejeitar respostas que claramente não são MPEG-TS
 *  antes de repassá-las ao mpegts.js. */
export function looksLikeTextualErrorBody(data: Uint8Array): boolean {
  if (data.length === 0) return false;
  // Sample the first ~256 bytes.
  const sampleLen = Math.min(256, data.length);
  let ascii = 0;
  let control = 0;
  for (let i = 0; i < sampleLen; i++) {
    const b = data[i];
    const printable = (b >= 32 && b < 127) || b === 9 || b === 10 || b === 13;
    if (printable) ascii++;
    else if (b < 32) control++;
  }
  if (ascii / sampleLen < 0.85) return false;
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(data.subarray(0, sampleLen))
    .trim()
    .toLowerCase();
  if (!head) return false;
  if (head.startsWith("<") /* html/xml */) return true;
  if (head.startsWith("{") || head.startsWith("[")) return true;
  if (/^(unauthorized|forbidden|error|max\s*connections|blocked|banned|invalid)/i.test(head)) {
    return true;
  }
  // Se é praticamente só texto e não parece TS, tratamos como body de erro.
  return control === 0 && ascii > 32 && !head.includes("\u0000");
}

/** Cabeçalhos a NÃO reencaminhar para o navegador em uma resposta de relay
 *  Live MPEG-TS. Usar em teste unitário para garantir que nenhum deles vaze. */
export const FORBIDDEN_RESPONSE_HEADERS = [
  "content-length",
  "content-range",
  "accept-ranges",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
] as const;
