@echo off
REM ============================================================
REM  BUILD ANDROID APK - SoaresTV
REM  Automatiza: limpa, instala, compila e abre projeto Android
REM ============================================================
setlocal enabledelayedexpansion
title SoaresTV - Build Android
color 0A

echo.
echo ============================================================
echo   SOARESTV - GERADOR DE APK ANDROID
echo ============================================================
echo.

REM --- Verificacoes basicas ---
if not exist "package.json" (
  echo [ERRO] package.json nao encontrado.
  echo Rode este .bat DENTRO da pasta do projeto.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao instalado. Baixe em https://nodejs.org
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao encontrado.
  pause
  exit /b 1
)

echo [1/7] Limpando instalacao anterior...
if exist "node_modules" rmdir /s /q node_modules
if exist "package-lock.json" del /f /q package-lock.json
if exist "bun.lockb" del /f /q bun.lockb
echo       OK
echo.

echo [2/7] Instalando dependencias do projeto (npm install)...
call npm install --legacy-peer-deps
if errorlevel 1 (
  echo [ERRO] Falha no npm install. Verifique sua conexao.
  pause
  exit /b 1
)
echo       OK
echo.

echo [3/7] Instalando Capacitor (core, cli, android)...
call npm install @capacitor/core @capacitor/cli @capacitor/android --legacy-peer-deps
if errorlevel 1 (
  echo [ERRO] Falha ao instalar Capacitor.
  pause
  exit /b 1
)
echo       OK
echo.

echo [4/7] Compilando app web (npm run build)...
call npm run build
if errorlevel 1 (
  echo [ERRO] Falha no build. Veja o erro acima.
  pause
  exit /b 1
)
echo       OK
echo.

echo [5/7] Adicionando plataforma Android...
if exist "android" (
  echo       Pasta android ja existe - pulando cap add
) else (
  call npx cap add android
  if errorlevel 1 (
    echo [ERRO] Falha em cap add android.
    pause
    exit /b 1
  )
)
echo       OK
echo.

echo [6/7] Sincronizando arquivos web -^> Android...
call npx cap sync android
if errorlevel 1 (
  echo [ERRO] Falha em cap sync.
  pause
  exit /b 1
)
echo       OK
echo.

echo [7/7] Aplicando customizacoes nativas (fullscreen / splash)...
if exist "android-template\MainActivity.java" (
  REM Descobre o caminho do package
  for /f "delims=" %%i in ('dir /b /s /a:d "android\app\src\main\java" 2^>nul') do (
    set "JAVA_DIR=%%i"
  )
  if defined JAVA_DIR (
    REM Pega a pasta mais profunda (onde fica MainActivity.java original)
    for /f "delims=" %%i in ('dir /b /s "android\app\src\main\java\MainActivity.java" 2^>nul') do (
      copy /y "android-template\MainActivity.java" "%%i" >nul
      echo       MainActivity.java atualizada
    )
  )
)
if exist "android-template\styles.xml" (
  if exist "android\app\src\main\res\values\styles.xml" (
    copy /y "android-template\styles.xml" "android\app\src\main\res\values\styles.xml" >nul
    echo       styles.xml atualizada
  )
)
call npx cap sync android >nul 2>&1
echo       OK
echo.

echo ============================================================
echo   PRONTO! Abrindo projeto no Android Studio...
echo ============================================================
echo.
echo Dentro do Android Studio:
echo   1. Aguarde o Gradle sincronizar (pode demorar na 1a vez)
echo   2. Menu Build -^> Build Bundle(s)/APK(s) -^> Build APK(s)
echo   3. O APK fica em: android\app\build\outputs\apk\debug\
echo.

call npx cap open android

echo.
pause
endlocal
