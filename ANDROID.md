# Gerar o APK (Android) do SoaresTV

O projeto já está configurado com **Capacitor**. O APK funciona como uma "casca" que abre o site publicado (`https://tv-magica-brasa-soarestv.lovable.app`), então toda a parte de backend (login, listas, player) continua funcionando igual ao site.

## Pré-requisitos no seu PC

1. **Node.js + Bun** (já tem se você está usando Lovable)
2. **Android Studio** — https://developer.android.com/studio
   - Durante a instalação, deixe marcado: **Android SDK**, **Android SDK Platform**, **Android Virtual Device**
3. **JDK 17** (geralmente vem junto com o Android Studio)

## Passos (primeira vez)

```bash
# 1. Clone o projeto do GitHub e instale dependências
git clone <url-do-seu-repo>
cd <pasta-do-projeto>
bun install

# 2. (Opcional) Faça o build do frontend — só precisa se quiser empacotar offline
bun run build

# 3. Adicione a plataforma Android (cria a pasta android/)
bunx cap add android

# 4. Sincronize a configuração com o projeto Android
bunx cap sync android

# 5. Abra no Android Studio
bunx cap open android
```

## Gerar o APK no Android Studio

1. Aguarde o Gradle Sync terminar (canto inferior direito).
2. Menu: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
3. Quando aparecer a notificação "APK(s) generated successfully", clique em **locate**.
4. O arquivo `app-debug.apk` está em `android/app/build/outputs/apk/debug/`.
5. Copie pro celular e instale (precisa habilitar "Instalar de fontes desconhecidas").

## Atualizações futuras

- **Mudou só o site (frontend/backend no Lovable)?** Não precisa gerar APK de novo — o APK já abre o site atualizado automaticamente.
- **Mudou ícone, nome do app ou configuração nativa?** Rode `bunx cap sync android` e gere novo APK.
- **Mudou conexão HTTP/IPTV?** Rode `bunx cap sync android`, gere um APK novo e desinstale o APK antigo do celular antes de instalar de novo. A configuração atual libera HTTP puro e ativa o HTTP nativo do Android para servidores Xtream que bloqueiam navegador/proxy.

## Ícone e Splash Screen

Coloque uma imagem quadrada de pelo menos 1024×1024 em `resources/icon.png` e um splash em `resources/splash.png`. Depois:

```bash
bunx capacitor-assets generate --android
```

## APK assinado para distribuir

O APK de debug serve para testar no seu celular. Para distribuir (Play Store ou link direto), gere um **release assinado**:

1. Android Studio → **Build → Generate Signed Bundle / APK**
2. Escolha **APK** → **Create new keystore** (guarde a senha!)
3. Build type: **release**
4. O APK assinado fica em `android/app/release/`

## Problemas comuns

- **Tela branca ao abrir**: o app está tentando carregar o site mas está sem internet. Conecte e tente de novo.
- **Vídeos não tocam**: o WebView do Android tem limitações com HLS. Se precisar player nativo, depois a gente instala `@capacitor-community/video-player`.
- **Quer empacotar offline (sem depender do site)?** Edite `capacitor.config.ts` e remova o bloco `server`. Depois `bun run build && bunx cap sync android`. ⚠️ Isso quebra as server functions — precisaria refatorar o backend.

---

## 📺 Android TV (TCL, Sony, Xiaomi, Google TV, Fire TV)

**Sintoma:** o app instala, abre na primeira vez, mas depois de fechar e
ligar a TV de novo o ícone **some** do launcher (continua em
*Configurações → Apps → Ver todos*, mas não na tela inicial).

**Causa:** o APK não declara `LEANBACK_LAUNCHER` nem `banner`. Sem isso,
o launcher de TV não cria atalho permanente.

**Solução (vale para Capacitor, Android Studio puro, Median.co e PWA Builder):**

Tudo pronto em `android-template/` na raiz do projeto:

- `android-template/AndroidManifest.xml` — template comentado com
  `LEANBACK_LAUNCHER`, `android:banner` e `uses-feature` corretos.
- `resources/tv-banner.png` — banner 320×180 (já gerado).
- `resources/icon.png` — ícone 1024×1024 (já gerado).
- `public/manifest.webmanifest` — manifesto PWA com
  `display: standalone`, `orientation: landscape` e
  `categories: ["entertainment","video"]` (lido pelo PWA Builder e Median).

Veja `android-template/README.md` para o passo-a-passo de **cada um dos
4 caminhos de build**. Resumo:

| Caminho           | O que fazer                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| Capacitor         | Colar `<intent-filter>` LEANBACK + `android:banner` no `AndroidManifest.xml` gerado por `cap add android`, copiar `tv-banner.png` para `res/drawable/`, rodar `capacitor-assets generate --android`. |
| Android Studio    | Substituir o `AndroidManifest.xml` pelo template, copiar `tv-banner.png` para `res/drawable/`.        |
| Median.co         | Painel: **Custom Manifest Entries** → colar intent-filter LEANBACK e `android:banner`. Upload do banner em **Branding → TV Banner**. |
| PWA Builder       | Já lê o `manifest.webmanifest` automaticamente. No projeto Android baixado, colar o intent-filter LEANBACK no `AndroidManifest.xml`. |

Depois de instalar o novo APK, reinicie a TV uma vez — o ícone aparece
na linha "Seus apps" e **continua lá** nas próximas vezes.

