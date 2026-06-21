@echo off
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
REM     GERAR-APK.bat studio    -> So abre o projeto no Android Studio
REM ============================================================

setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"
title SoaresTV - Gerar APK

set "MODE=%~1"
if "%MODE%"=="" set "MODE=debug"

cls
echo.
echo  ============================================================
echo    SOARESTV 3.0  -  Gerador automatico de APK Android
echo    Modo: %MODE%
echo  ============================================================
echo.

REM ---------- 0. Detectar Android SDK automaticamente ----------
if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" (
    set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
    set "ANDROID_SDK_ROOT=%LOCALAPPDATA%\Android\Sdk"
    echo  [info] ANDROID_HOME detectado: !ANDROID_HOME!
  )
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
call bun install || goto :fail

REM ---------- 3. Build do site ----------
echo.
echo  [2/5] Buildando frontend (bun run build)...
call bun run build || goto :fail

REM ---------- 4. Adicionar plataforma Android se nao existir ----------
if not exist "android" (
  echo.
  echo  [extra] Plataforma Android ausente - rodando: bunx cap add android
  call bunx cap add android || goto :fail
)

REM ---------- 5. Sync Capacitor ----------
echo.
echo  [3/5] Sincronizando Capacitor (bunx cap sync android)...
call bunx cap sync android || goto :fail

REM ---------- 6. Compilar APK ----------
echo.
echo  [4/5] Compilando APK %MODE% com Gradle (pode demorar varios minutos na 1a vez)...
pushd android
if /I "%MODE%"=="release" (
  call gradlew.bat assembleRelease || (popd & goto :fail)
  set "APK_PATH=app\build\outputs\apk\release\app-release-unsigned.apk"
) else (
  call gradlew.bat assembleDebug || (popd & goto :fail)
  set "APK_PATH=app\build\outputs\apk\debug\app-debug.apk"
)
popd

set "FULL_APK=android\%APK_PATH%"
if not exist "%FULL_APK%" (
  echo  [ERRO] APK nao encontrado em %FULL_APK%
  goto :fail
)

echo.
echo  [5/5] Pronto!
echo  ============================================================
echo    APK GERADO COM SUCESSO
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
pause
endlocal
exit /b 1
