@echo off
REM ============================================================
REM  build-apk.bat - Gera o APK Android do SoaresTV no Windows
REM  Uso:
REM    build-apk.bat            -> APK debug
REM    build-apk.bat release    -> APK release (nao-assinado)
REM
REM  Pre-requisitos:
REM    - Bun         (https://bun.sh)
REM    - JDK 17+     (java -version deve mostrar 17 ou superior)
REM    - Android SDK com ANDROID_HOME ou ANDROID_SDK_ROOT setado
REM      Ex.: setx ANDROID_HOME "%LOCALAPPDATA%\Android\Sdk"
REM ============================================================

setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=debug"

echo.
echo ============================================================
echo  SoaresTV - Build APK (%MODE%)
echo ============================================================

REM ---------- checagens ----------
where bun >nul 2>nul
if errorlevel 1 (
  echo [ERRO] 'bun' nao encontrado no PATH. Instale em https://bun.sh
  goto :fail
)

where java >nul 2>nul
if errorlevel 1 (
  echo [ERRO] 'java' nao encontrado. Instale o JDK 17+.
  goto :fail
)

if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" (
  echo [ERRO] Defina ANDROID_HOME ou ANDROID_SDK_ROOT apontando para o Android SDK.
  echo        Ex.: setx ANDROID_HOME "%%LOCALAPPDATA%%\Android\Sdk"
  goto :fail
)

REM ---------- pipeline ----------
echo.
echo [1/5] Instalando dependencias (bun install)...
call bun install || goto :fail

echo.
echo [2/5] Buildando frontend (bun run build)...
call bun run build || goto :fail

if not exist "android" (
  echo.
  echo Plataforma Android ausente - executando: bunx cap add android
  call bunx cap add android || goto :fail
)

echo.
echo [3/5] Sincronizando Capacitor (bunx cap sync android)...
call bunx cap sync android || goto :fail

echo.
echo [3b/5] Aplicando patch landscape + permissoes (android-landscape.mjs)...
call node scripts/android-landscape.mjs || goto :fail

REM Validacao: garante que o patch funcionou
findstr /C:"android:screenOrientation=\"landscape\"" "android\app\src\main\AndroidManifest.xml" >nul 2>nul
if errorlevel 1 (
  echo [ERRO] AndroidManifest nao ficou em landscape apos o patch.
  goto :fail
)
findstr /C:"android.permission.INTERNET" "android\app\src\main\AndroidManifest.xml" >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Permissao INTERNET ausente no AndroidManifest.
  goto :fail
)


echo.
echo [4/5] Compilando APK (%MODE%) com Gradle...
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
  echo [ERRO] APK nao encontrado em %FULL_APK%
  goto :fail
)

echo.
echo ============================================================
echo  [OK] APK gerado com sucesso!
echo  Caminho: %CD%\%FULL_APK%
echo ============================================================
echo.
REM Abre a pasta no Explorer
start "" explorer /select,"%CD%\%FULL_APK%"

endlocal
exit /b 0

:fail
echo.
echo ============================================================
echo  [FALHA] Build interrompido. Veja o erro acima.
echo ============================================================
endlocal
exit /b 1
