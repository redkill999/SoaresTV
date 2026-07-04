---
name: Home hotspots alignment (Live/EPG/VOD/Series + rodapé)
description: Coordenadas % dos hotspots da Home casadas com as bordas azul/vermelha da arte home-bg.png. Não alterar sem re-medir.
type: design
---

Alinhamento validado do anel amarelo de foco com as bordas da arte da Home.
Vale para **web desktop E APK Android** — a arte é `object-fill` (estica pra
100% do canvas) e os hotspots usam %, então escalam iguais em qualquer viewport.

## Regras invioláveis
- `.hotspot .hotspot-ring` DEVE usar `inset: 0` em `src/styles.css`. NÃO adicionar
  recuo (inset negativo/positivo) — o recuo já está embutido nas coordenadas dos hotspots.
- `<img class="home-bg">` DEVE permanecer `object-fill` (não `object-contain`/`cover`).
- Canvas: `.home-canvas h-full w-full` cobrindo 100% do wrapper. Não trocar por
  aspect-ratio fixo — quebra o casamento das % com a arte em telas não-16:9.
- Ao trocar a arte `home-bg.png`, RE-MEDIR pixel a pixel e atualizar `HOTSPOTS`
  em `src/routes/home.tsx`. Não estimar no olho.

## Coordenadas atuais (base 1376x768 da arte)
Tiles principais (t:33.33, h:35.81):
- live   l:5.74  w:20.71
- epg    l:28.27 w:20.71
- vod    l:50.80 w:20.42
- series l:73.04 w:20.64

Rodapé (t:78.52, h:15.36):
- account l:3.85 w:8.36 | multi l:14.10 w:8.36 | catchup l:24.35 w:8.72
- favorite l:66.72 w:8.36 | radio l:77.03 w:8.50 | settings l:87.50 w:8.50

Status topo direito (t:4, h:16): alarm/rec/vpn/msg em w:7, update w:6.
