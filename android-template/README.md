# Android TV — arquivos prontos para colar

Esta pasta contém o que falta no APK para o ícone do SoaresTV aparecer
(e **continuar aparecendo**) no launcher das Android TVs (TCL, Sony, Xiaomi,
Google TV, Fire TV, etc.).

## O que tem aqui

- `AndroidManifest.xml` — template comentado com `LEANBACK_LAUNCHER`,
  banner e `uses-feature` corretos.
- `styles.xml` — tema fullscreen + DisplayCutout (notch / câmera).
- `MainActivity.java` — modo IMERSIVO REAL (status bar, navigation bar
  e botões voltar/home/multitarefa escondidos, edge-to-edge cobrindo
  notch). Compatível Android 8 → 15.
- Use `resources/tv-banner.png` (na raiz do projeto) como banner 320×180.

## Fullscreen imersivo (celular + TV)

Depois de `bunx cap add android`, copie em ordem:

```bash
cp android-template/styles.xml      android/app/src/main/res/values/styles.xml
cp android-template/MainActivity.java android/app/src/main/java/com/soarestv/app/MainActivity.java
```

Em seguida abra `android/app/src/main/AndroidManifest.xml` e garanta que
a `MainActivity` use `android:theme="@style/AppTheme.NoActionBar"` (já
está assim no template). Recompile o APK — o app abrirá em
landscape, cobrindo notch/câmera, sem barra superior nem botões
inferiores.


## Onde colar em cada caminho de build

### Capacitor (recomendado — já é o do projeto)

```bash
bunx cap add android         # cria android/
bunx cap sync android
```

1. Abra `android/app/src/main/AndroidManifest.xml` e copie:
   - todos os `<uses-feature>` do template
   - o atributo `android:banner="@drawable/tv_banner"` para o `<application>`
   - o **segundo** `<intent-filter>` (`LEANBACK_LAUNCHER`) para a MainActivity
2. Copie o banner:
   ```bash
   cp resources/tv-banner.png android/app/src/main/res/drawable/tv_banner.png
   ```
3. Gere ícones a partir de `resources/icon.png`:
   ```bash
   bunx capacitor-assets generate --android
   ```
4. `bunx cap sync android` → gere o APK no Android Studio.

### Android Studio puro

Substitua seu `AndroidManifest.xml` pelo template (ajuste `package` e o
nome da Activity). Copie o banner para `res/drawable/tv_banner.png`.

### Median.co

No painel do Median: **App Settings → Android → Custom Manifest Entries**.
Cole o `<intent-filter>` de `LEANBACK_LAUNCHER` e o atributo
`android:banner`. Em **App Settings → Branding** envie `tv-banner.png`
como "TV Banner".

### PWA Builder

Já está pronto via `public/manifest.webmanifest`
(`display: standalone`, `orientation: landscape`,
`categories: ["entertainment","video"]`). Após o PWA Builder gerar o
projeto Android, abra o `AndroidManifest.xml` baixado e adicione o
segundo `<intent-filter>` (LEANBACK) na MainActivity e o
`android:banner` no `<application>` — mesma operação do Capacitor.

## Como confirmar que ficou correto

Depois de instalar o APK na TV:

1. Abra a tela inicial do Google TV / Android TV.
2. O ícone do **SoaresTV** deve aparecer na linha "Seus apps".
3. Reinicie a TV — o ícone **continua lá**.

Se o ícone sumir após reiniciar, o `LEANBACK_LAUNCHER` está faltando
ou o `tv_banner.png` não está em `res/drawable/`.
