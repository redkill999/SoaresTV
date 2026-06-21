# Como gerar o APK do SoaresTV 3.0 (passo a passo)

Voce nao precisa entender Android Studio nem linha de comando. Tudo esta automatizado no arquivo **`GERAR-APK.bat`**.

---

## 1. Baixe o projeto para o seu PC

No Lovable, clique em **GitHub > Connect** (se ainda nao conectou) ou em **Export > Download ZIP** e extraia para uma pasta **sem espacos no nome**, por exemplo:

```
C:\SoaresTV
```

> Evite caminhos com acento ou espaco (ex.: `Meus Documentos`) — o Gradle quebra.

---

## 2. Instale os 3 programas (so uma vez na vida)

| Programa | Link | Tamanho |
|---|---|---|
| **Bun** (gerenciador JS) | https://bun.sh | ~30 MB |
| **JDK 17+** (Java) | https://adoptium.net/temurin/releases/ | ~180 MB |
| **Android Studio** | https://developer.android.com/studio | ~1 GB |

Ao abrir o **Android Studio pela primeira vez**, aceite todos os defaults — ele vai baixar o **Android SDK** automaticamente (mais ~3 GB). Feche o Android Studio depois disso.

---

## 3. Gere o APK (2 cliques)

Abra a pasta `C:\SoaresTV` no Explorer e **de 2 cliques** em:

```
GERAR-APK.bat
```

O script faz tudo sozinho:

1. `bun install` — instala dependencias
2. `bun run build` — builda o site
3. `bunx cap add android` — cria a pasta `android/` se nao existir
4. `bunx cap sync android` — copia o build para dentro do projeto Android
5. `gradlew assembleDebug` — compila o APK (na 1a vez demora 5–15 min, depois fica em ~1 min)
6. Abre o Windows Explorer com o APK ja selecionado
7. Pergunta se voce quer abrir o projeto no Android Studio

O APK final fica em:

```
C:\SoaresTV\android\app\build\outputs\apk\debug\app-debug.apk
```

---

## 4. Instale no celular

1. Mande o `app-debug.apk` para o celular (USB, WhatsApp, Google Drive…)
2. No Android, va em **Configuracoes > Seguranca > Instalar apps desconhecidos** e libere o app que vai abrir o APK (ex.: WhatsApp, Files)
3. Toque no arquivo `.apk` e instale
4. Abra o **SoaresTV** — ja conecta na sua lista IPTV

---

## Variacoes do script

| Comando | O que faz |
|---|---|
| `GERAR-APK.bat` | APK **debug** (recomendado para teste pessoal) |
| `GERAR-APK.bat release` | APK **release** nao-assinado (precisa assinar depois para Play Store) |
| `GERAR-APK.bat studio` | So abre o projeto no Android Studio (sem recompilar) |

---

## Erros comuns

**`'bun' nao encontrado`** → Bun nao instalado ou PATH nao atualizado. Feche e reabra o terminal/Explorer depois de instalar.

**`'java' nao encontrado`** → JDK nao instalado. Use o instalador da Adoptium e marque "Set JAVA_HOME".

**`Android SDK nao encontrado`** → Abra o Android Studio uma vez, ou rode no PowerShell:
```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
```
Depois feche e reabra o Explorer.

**Build trava em `Downloading Gradle...`** → Conexao lenta na 1a vez. Espere; o Gradle baixa ~150 MB so na primeira compilacao.

**APK abre mas tela preta** → O APK e a "casca" que abre `https://tv-magica-brasa-soarestv.lovable.app`. Verifique conexao com a internet do celular.

---

## Como funciona por dentro (resumo)

O APK e um **WebView Capacitor** que carrega o site publicado no Lovable. Toda logica (login Xtream/M3U, EPG, favoritos, player) vive no site — o APK so embrulha. Por isso:

- Sempre que voce publica novidades no Lovable, o APK **ja recebe automatico** (nao precisa recompilar).
- So precisa recompilar o APK quando mudar **icone, splash, permissoes, plugins nativos** ou o `capacitor.config.ts`.
