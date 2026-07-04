@echo off
if /I not "%~1"=="__run" (
  start "SoaresTV - Gerar APK" cmd /k ""%~f0" __run %*"
  exit /b
)
shift /1
REM ============================================================
REM  GERAR-APK.bat  -  SoaresTV 3.0
REM  Script automatico de compilacao do APK Android.
REM
REM  COMO USAR (passo a passo):
REM    1) Baixe o projeto inteiro do Lovable (botao "Download ZIP"
REM       ou clone via GitHub) e extraia numa pasta sem espacos
REM       no caminho, por ex.:  C:\SoaresTV
REM    2) Instale os pre-requisitos UMA UNICA VEZ:
REM         - Bun .............. https://bun.sh/   (clique em Install)
REM         - JDK 17+ .......... https://adoptium.net/temurin/releases/
REM         - Android Studio ... https://developer.android.com/studio
REM           Ao abrir o Android Studio pela 1a vez, deixe ele baixar
REM           o "Android SDK" automatico (default).
REM    3) De 2 cliques neste arquivo (GERAR-APK.bat).
REM       Ele instala dependencias, builda o site, sincroniza o
REM       Capacitor, compila o APK e abre a pasta com o arquivo.
REM
REM  Parametros opcionais (linha de comando):
REM     GERAR-APK.bat           -> APK debug (padrao, instala em qualquer celular)
REM     GERAR-APK.bat release   -> APK release nao-assinado
REM ============================================================
REM
REM  IMPORTANTE - server.url no capacitor.config.ts
REM  --------------------------------------------------
REM  Este APK aponta para o site publicado no Lovable
REM  (tv-magica-brasa-soarestv.lovable.app). Alteracoes do
REM  frontend PRECISAM ser publicadas la antes de testar no
REM  celular/TV — o build local NAO substitui o site remoto.
REM
REM  Como confirmar que o APK esta rodando a versao certa:
REM    - Configuracoes > Sobre > "Build" mostra o APP_BUILD_ID
REM    - Deve ser igual ao APP_BUILD_ID em src/lib/app-build.ts
REM    - Se divergir: publique no Lovable e reabra o APP
REM ============================================================



setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"
title SoaresTV - Gerar APK
set "LOG_FILE=%CD%\GERAR-APK.log"
echo ============================================================ > "%LOG_FILE%"
echo SoaresTV - Gerar APK - %DATE% %TIME% >> "%LOG_FILE%"
echo Pasta: %CD% >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=debug"

cls
echo.
echo  ============================================================
echo    SOARESTV 3.0  -  Gerador automatico de APK Android
echo    Modo: %MODE%
echo  ============================================================
echo.
echo  [info] Log desta execucao: %LOG_FILE%
echo.

REM ---------- 0. Detectar Android SDK automaticamente ----------
if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" (
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
    set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
    echo  [info] ANDROID_HOME detectado: !ANDROID_HOME!
  )
)

REM ---------- 0b. Preferir JDK compativel com Android/Gradle ----------
if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" (
  set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
  set "PATH=!JAVA_HOME!\bin;!PATH!"
  echo  [info] Java do Android Studio detectado: !JAVA_HOME!
) else if exist "%ProgramFiles%\Eclipse Adoptium\jdk-21*" (
  for /d %%J in ("%ProgramFiles%\Eclipse Adoptium\jdk-21*") do set "JAVA_HOME=%%~fJ"
  set "PATH=!JAVA_HOME!\bin;!PATH!"
  echo  [info] JDK 21 detectado: !JAVA_HOME!
) else if exist "%ProgramFiles%\Eclipse Adoptium\jdk-17*" (
  for /d %%J in ("%ProgramFiles%\Eclipse Adoptium\jdk-17*") do set "JAVA_HOME=%%~fJ"
  set "PATH=!JAVA_HOME!\bin;!PATH!"
  echo  [info] JDK 17 detectado: !JAVA_HOME!
)

REM ---------- 1. Checagens basicas ----------
where bun >nul 2>nul || (
  echo  [ERRO] 'bun' nao encontrado. Instale em https://bun.sh
  goto :fail
)
where java >nul 2>nul || (
  echo  [ERRO] 'java' nao encontrado. Instale o JDK 17+ em https://adoptium.net
  goto :fail
)
set "JAVA_VERSION="
set "JAVA_MAJOR="
for /f "tokens=3" %%V in ('java -version 2^>^&1 ^| findstr /i "version"') do if not defined JAVA_VERSION set "JAVA_VERSION=%%~V"
for /f "tokens=1 delims=." %%M in ("!JAVA_VERSION!") do set "JAVA_MAJOR=%%M"
if defined JAVA_MAJOR (
  if !JAVA_MAJOR! GEQ 25 (
    echo  [ERRO] Java !JAVA_VERSION! detectado, mas o Gradle/Android nao suporta Java 25+.
    echo         Instale JDK 21 ou JDK 17 e rode este arquivo novamente.
    echo         Link recomendado: https://adoptium.net/temurin/releases/?version=21
    goto :fail
  )
)

REM ---------- Modo "so abrir Android Studio" ----------
if /I "%MODE%"=="studio" goto :open_studio

if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" (
  echo  [ERRO] Android SDK nao encontrado.
  echo         Abra o Android Studio uma vez e deixe instalar o SDK,
  echo         ou rode:  setx ANDROID_HOME "%%LOCALAPPDATA%%\Android\Sdk"
  goto :fail
)

REM ---------- 2. Instalar deps ----------
echo.
echo  [1/5] Instalando dependencias (bun install)...
call bun install >> "%LOG_FILE%" 2>&1 || goto :fail

REM ---------- 3. Build do site ----------
echo.
echo  [2/5] Buildando frontend (bun run build)...
call bun run build >> "%LOG_FILE%" 2>&1 || goto :fail

REM ---------- 4. Adicionar plataforma Android se nao existir ----------
if not exist "android" (
  echo.
  echo  [extra] Plataforma Android ausente - rodando: bunx cap add android
  call bunx cap add android >> "%LOG_FILE%" 2>&1 || goto :fail
)

REM ---------- 5. Sync Capacitor ----------
echo.
echo  [3/5] Sincronizando Capacitor (bunx cap sync android)...
call bunx cap sync android >> "%LOG_FILE%" 2>&1 || goto :fail

echo  [3a/5] Aplicando patch do ExoPlayer para IPTV .TS...
call node scripts/patch-video-player.mjs >> "%LOG_FILE%" 2>&1 || goto :fail

REM ---------- 5b. Gerar icones (celular + TV banner) a partir de resources/ ----------
echo.
echo  [3b/5] Gerando icones do APK (a partir da pasta resources\)...
call bunx @capacitor/assets generate --android --assetPath resources >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo  [aviso] Falha ao gerar icones automaticamente - seguindo com os icones atuais.
)

REM ---------- 5c. Patch AndroidManifest (landscape + banner TV + leanback) ----------
echo.
echo  [3c/5] Aplicando patches no AndroidManifest (landscape + icone TV)...
call node scripts/android-landscape.mjs >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo  [ERRO] Falha ao patchar AndroidManifest - veja o log.
  goto :fail
)

REM ---------- 5d. VALIDACAO: garantir que o manifest ficou em landscape ----------
echo.
echo  [3d/5] Validando AndroidManifest...
set "MANIFEST=android\app\src\main\AndroidManifest.xml"
if not exist "%MANIFEST%" (
  echo  [ERRO] AndroidManifest.xml nao encontrado em %MANIFEST%
  goto :fail
)
findstr /C:"android:screenOrientation=\"landscape\"" "%MANIFEST%" >nul 2>nul
if errorlevel 1 (
  echo  [ERRO] AndroidManifest NAO ficou em landscape apos o patch.
  echo         Conteudo atual da MainActivity:
  findstr /C:"MainActivity" "%MANIFEST%"
  goto :fail
)
findstr /C:"android.permission.INTERNET" "%MANIFEST%" >nul 2>nul
if errorlevel 1 (
  echo  [ERRO] Permissao INTERNET ausente no AndroidManifest.
  goto :fail
)
findstr /C:"usesCleartextTraffic=\"true\"" "%MANIFEST%" >nul 2>nul
if errorlevel 1 (
  echo  [aviso] usesCleartextTraffic nao detectado - listas HTTP puras podem falhar.
)
echo  [ok] Manifest validado: landscape + INTERNET confirmados.

REM ---------- 6. Compilar APK ----------
echo.
echo  [4/5] Compilando APK %MODE% com Gradle (pode demorar varios minutos na 1a vez)...
pushd android
if /I "%MODE%"=="release" (
  call gradlew.bat assembleRelease >> "%LOG_FILE%" 2>&1 || (popd & goto :fail)
  set "APK_PATH=app\build\outputs\apk\release\app-release-unsigned.apk"
) else (
  call gradlew.bat assembleDebug >> "%LOG_FILE%" 2>&1 || (popd & goto :fail)
  set "APK_PATH=app\build\outputs\apk\debug\app-debug.apk"
)
popd

set "FULL_APK=android\%APK_PATH%"
if not exist "%FULL_APK%" (
  echo  [ERRO] APK nao encontrado em %FULL_APK%
  goto :fail
)

REM ---------- 6b. Assinar release com keystore LOCAL (teste pessoal) ----------
if /I "%MODE%"=="release" (
  echo.
  echo  [4b/5] Assinando APK release com keystore local para instalacao pessoal...
  call node scripts/sign-release-apk.mjs >> "%LOG_FILE%" 2>&1
  if errorlevel 1 (
    echo  [aviso] Nao consegui assinar automaticamente. APK unsigned continua em %FULL_APK%.
  ) else (
    set "FULL_APK=android\app\build\outputs\apk\release\app-release-signed.apk"
    echo  [ok] APK release assinado ^(keystore local, NAO usar pra Play Store^).
  )
)

echo.
echo  [5/5] Pronto!
echo  ============================================================
echo    APK GERADO COM SUCESSO
echo    Modo:    %MODE%
echo    Arquivo: %CD%\%FULL_APK%
echo  ============================================================
echo.
echo  Transferira para o celular (USB ou WhatsApp/Drive), aceite
echo  "Instalar de fontes desconhecidas" e abra o arquivo.
echo.

REM Abre o Explorer ja selecionando o APK
start "" explorer /select,"%CD%\%FULL_APK%"

REM Pergunta se quer abrir no Android Studio
choice /C SN /N /M "  Abrir o projeto no Android Studio agora? (S/N) "
if errorlevel 2 goto :done
goto :open_studio

:open_studio
echo.
echo  Abrindo projeto no Android Studio...
set "STUDIO="
if exist "%ProgramFiles%\Android\Android Studio\bin\studio64.exe" set "STUDIO=%ProgramFiles%\Android\Android Studio\bin\studio64.exe"
if exist "%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe" set "STUDIO=%LOCALAPPDATA%\Programs\Android Studio\bin\studio64.exe"
if not exist "android" (
  echo  [aviso] Pasta android\ ainda nao existe. Rode primeiro: GERAR-APK.bat
  goto :done
)
if defined STUDIO (
  start "" "%STUDIO%" "%CD%\android"
) else (
  echo  [aviso] Android Studio nao encontrado no caminho padrao.
  echo          Abra-o manualmente e use: File ^> Open ^> selecione a pasta "android".
  start "" explorer "%CD%\android"
)
goto :done

:done
echo.
pause
endlocal
exit /b 0

:fail
echo.
echo  ============================================================
echo    [FALHA] Build interrompido. Leia a mensagem acima.
echo  ============================================================
echo.
echo  O arquivo com o erro completo foi salvo aqui:
echo  %LOG_FILE%
echo.
if exist "%LOG_FILE%" (
  echo  Ultimas linhas do erro:
  echo  ------------------------------------------------------------
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%LOG_FILE%' -Tail 40" 2>nul
  echo  ------------------------------------------------------------
  echo.
)
pause
endlocal
exit /b 1
