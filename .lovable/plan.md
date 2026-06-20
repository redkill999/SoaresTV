## Objetivo

Deixar o app com a mesma sensação de uso do XCIPTV (do vídeo), funcionando bem no celular **e** na TV Box / Android TV com controle remoto. Sem trocar logo nem dados de login.

> Observação importante: não consegui abrir o vídeo do Drive (link bloqueado pra download). O plano abaixo é baseado nas 4 prioridades que você marcou. Se algo no vídeo for diferente, me avise depois de ver as 4 entregas.

---

## 1. Navegação por controle remoto (D-pad TV)

- Instalar `@noriginmedia/norigin-spatial-navigation` (biblioteca padrão de TVs web — usada por Smart TVs Samsung/LG e Android TV web apps).
- Inicializar no `__root.tsx` com `init({ debug: false, throttle: 50 })`.
- Marcar como focáveis: cards de canal/filme/série, itens da sidebar de categorias, abas Live/Movies/Series do home, botão voltar, controles do player.
- Estilo de foco grande e visível: borda + glow no item focado (`data-focused`).
- Scroll automático pro item focado (`scrollIntoView({ block: "nearest" })`).
- Tecla "Voltar" (Esc / botão Back do controle) volta uma tela.
- Mouse e toque continuam funcionando normal — D-pad é só uma camada adicional.

## 2. Mini-player na grade de canais Live

- No topo da página `/live`, painel preview (~30% da altura no desktop, retrátil no celular).
- Quando o canal é **focado** (não clicado), começa a tocar em volume baixo no preview após 800ms.
- Clicar/OK = abre tela cheia do player normal.
- Mostra nome do canal + programa atual (EPG curta que já existe).

## 3. EPG em grade completa (TV Guide)

- Nova rota `/guide` (botão na sidebar do AppShell).
- Layout: coluna fixa à esquerda com nome+logo do canal, linha do tempo horizontal com blocos de programa (agora ± 6h).
- Usa `get_simple_data_table` do Xtream (carrega sob demanda por canal visível — janela virtual).
- Linha vertical vermelha marcando "agora".
- Clicar/OK num bloco "agora" = abre player do canal; bloco futuro = só mostra detalhes.
- Navegação D-pad: ↑↓ troca canal, ←→ navega blocos no tempo.

## 4. Layout split estilo XCIPTV em /live

- Atual: sidebar de categorias + grid de cards quadrados.
- Novo (em telas ≥ md): topo = mini-player; abaixo = 3 colunas — `[categorias | lista de canais | EPG do canal selecionado]`.
- No celular vira stack vertical: mini-player no topo, categorias colapsáveis, lista de canais.
- `/movies` e `/series` mantêm grid atual (não é a cara do XCIPTV nelas).

---

## Detalhes técnicos

```text
src/
  lib/
    tv-focus.ts            # wrapper sobre useFocusable, defaults do projeto
    xtream.ts              # + getFullEpg(creds, streamId) usando get_simple_data_table
  hooks/
    use-remote-back.ts     # Esc / "Back" -> router.history.back()
  components/
    FocusableCard.tsx      # MediaCard com useFocusable + estilo de foco
    MiniPlayer.tsx         # player compacto reutilizável
    EpgRow.tsx             # uma linha do TV Guide (canal + timeline)
  routes/
    __root.tsx             # init() da spatial-navigation + handler global Back
    live.tsx               # refator: split layout + mini-player
    guide.tsx              # nova: TV Guide em grade
  components/
    AppShell.tsx           # + link "Guia" na sidebar
```

Dependências novas: `@noriginmedia/norigin-spatial-navigation` (~10kb). Nada mais.

Nada do que já funciona é removido: login Xtream, M3U, favoritos, histórico, busca, ParentalGate, traduções, tema — tudo intacto.

## Fora do escopo

- Não vou trocar a logo nem strings de identidade do app.
- Não vou empacotar como APK nativo (você optou por manter web).
- Não vou mexer em `/movies` e `/series` além do D-pad funcionar lá.

Aprovando, começo pela parte 1 (D-pad) + parte 4 (layout split) no mesmo passo, depois 2 (mini-player) e por fim 3 (EPG em grade) que é a mais pesada.