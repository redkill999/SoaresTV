---
name: Proxy /api/stream nunca retorna 5xx
description: src/routes/api/stream.ts rebaixa upstream 5xx e fetch-fail para 424; não voltar para 502
type: constraint
---

`src/routes/api/stream.ts` NUNCA pode responder com status 5xx. O Lovable
runtime-error boundary captura qualquer 5xx como `RUNTIME_ERROR` com
`has_blank_screen: true`, mesmo quando o `VideoPlayer` já está fazendo
fallback normal para o próximo candidato (HTTP→HTTPS→direto).

Regras invioláveis em `handle()`:

1. Falha de fetch / nenhum upstream respondeu → `jsonError(msg, 424)`
   (preservar 401/403 quando upstream devolver auth error).
2. Upstream respondeu mas com 5xx → rebaixar para 424 via
   `const outStatus = upstream.status >= 500 ? 424 : upstream.status;`.
3. Não usar 502/503/504 em nenhuma resposta deste arquivo.

**Por quê:** o player já lida com qualquer status não-OK avançando para
o próximo candidato. Devolver 5xx só serve para disparar tela em branco
falsa no preview.
