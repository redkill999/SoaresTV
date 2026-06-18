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
