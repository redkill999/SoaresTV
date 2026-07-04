---
name: D-pad arrow keys must escape inputs in TV mode
description: Em src/lib/tv-dpad.ts handleKey(), o guard `if (typing) return` só pode bloquear quando NÃO estiver em tvMode. Em TV mode, Up/Down precisam funcionar mesmo com <input> focado — não existe Tab no controle remoto.
type: constraint
---
Em `src/lib/tv-dpad.ts`, `handleKey()`, o bloco:

```ts
if (typing) {
  if (!tvMode) return;
  if (!isUp && !isDown) return;
}
```

**NÃO** simplificar para `if (typing) return` — isso reintroduz o bug do login na Android TV onde o campo Servidor recebe autofoco (`data-tv-default-focus`), typing fica `true` desde o 1º frame, e nenhuma seta do controle remoto move o foco. O usuário fica preso em Servidor e todos os campos parecem "selecionados juntos".

Left/Right e digitação em si NÃO devem ser interceptadas dentro do input — cursor e edição de texto seguem normais. Só Up/Down escapam pra navegação espacial via `pickNearest`.

**Why:** controle remoto de TV não tem Tab. Sem esse escape, formulários com autofoco (login, PIN parental, busca) viram armadilha em TV.
