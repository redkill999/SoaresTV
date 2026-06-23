@echo off
REM ============================================================
REM  BUILD ANDROID APK - SoaresTV
REM  Corrige automaticamente os erros comuns:
REM    - roda sempre na pasta do projeto
REM    - instala/ativa Git quando npm precisa baixar dependencia GitHub
REM    - usa --legacy-peer-deps para conflito do capacitor-video-player
REM    - para imediatamente se npm install falhar, evitando erro "vite nao reconhecido"
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title SoaresTV - Build Android
color 0A

set "LOG_FILE=%CD%\build-android.log"
echo ============================================================ > "%LOG_FILE%"
echo SoaresTV - Build Android - %DATE% %TIME% >> "%LOG_FILE%"
echo Pasta: %CD% >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"

echo.
echo ============================================================
echo   SOARESTV - GERADOR DE APK ANDROID
echo ============================================================
echo.
echo Log desta execucao: %LOG_FILE%
echo.

REM --- Verificacoes basicas ---
if not exist "package.json" (
  echo [ERRO] package.json nao encontrado.
  echo Rode este .bat DENTRO da pasta do projeto baixado do Lovable.
  goto :fail_no_log
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao instalado. Baixe em https://nodejs.org
  goto :fail_no_log
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao encontrado. Reinstale o Node.js em https://nodejs.org
  goto :fail_no_log
)

REM npm precisa de Git porque uma dependencia do player vem do GitHub.
call :ensure_git || goto :fail_no_log

echo [1/7] Limpando instalacao anterior...
if exist "node_modules" rmdir /s /q node_modules >> "%LOG_FILE%" 2>&1
if exist "package-lock.json" del /f /q package-lock.json >> "%LOG_FILE%" 2>&1
if exist "bun.lockb" del /f /q bun.lockb >> "%LOG_FILE%" 2>&1
echo       OK
echo.

echo [2/7] Instalando dependencias do projeto...
call npm config set legacy-peer-deps true >> "%LOG_FILE%" 2>&1
call npm install --legacy-peer-deps --include=dev >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERRO] Falha no npm install.
  echo        Normalmente isso e internet instavel, antivirus bloqueando, ou Git/Node mal instalado.
  goto :fail
)
if not exist "node_modules\.bin\vite.cmd" (
  echo [ERRO] O npm install terminou, mas o Vite nao foi instalado.
  echo        Vou parar aqui para nao cair no erro "vite nao reconhecido".
  goto :fail
)
echo       OK
echo.

echo [3/7] Garantindo Capacitor Android instalado...
call npm install @capacitor/core @capacitor/cli @capacitor/android --legacy-peer-deps --include=dev >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERRO] Falha ao instalar Capacitor.
  goto :fail
)
echo       OK
echo.

echo [4/7] Compilando app web...
call npm run build >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERRO] Falha no build. Veja o log acima/abaixo.
  goto :fail
)
echo       OK
echo.

echo [5/7] Adicionando plataforma Android...
if exist "android" (
  echo       Pasta android ja existe - pulando cap add
) else (
  call npx cap add android >> "%LOG_FILE%" 2>&1
  if errorlevel 1 (
    echo [ERRO] Falha em cap add android.
    goto :fail
  )
)
echo       OK
echo.

echo [6/7] Sincronizando arquivos web -^> Android...
call npx cap sync android >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERRO] Falha em cap sync.
  goto :fail
)
echo       OK
echo.

echo [7/7] Aplicando customizacoes nativas fullscreen / splash...
if exist "android-template\MainActivity.java" (
  for /f "delims=" %%i in ('dir /b /s "android\app\src\main\java\MainActivity.java" 2^>nul') do (
    copy /y "android-template\MainActivity.java" "%%i" >> "%LOG_FILE%" 2>&1
    echo       MainActivity.java atualizada
  )
)
if exist "android-template\styles.xml" (
  if exist "android\app\src\main\res\values\styles.xml" (
    copy /y "android-template\styles.xml" "android\app\src\main\res\values\styles.xml" >> "%LOG_FILE%" 2>&1
    echo       styles.xml atualizada
  )
)
call npx cap sync android >> "%LOG_FILE%" 2>&1
echo       OK
echo.

echo ============================================================
echo   PRONTO! Projeto Android preparado.
echo ============================================================
echo.
echo Dentro do Android Studio:
echo   1. Aguarde o Gradle sincronizar
echo   2. Menu Build -^> Build Bundle(s)/APK(s) -^> Build APK(s)
echo   3. O APK fica em: android\app\build\outputs\apk\debug\
echo.

call npx cap open android >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [aviso] Nao consegui abrir automaticamente o Android Studio.
  echo         Abra manualmente a pasta: %CD%\android
)

echo.
pause
endlocal
exit /b 0

:ensure_git
where git >nul 2>&1
if not errorlevel 1 exit /b 0

REM Tenta ativar Git caso esteja instalado mas fora do PATH.
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "PATH=%ProgramFiles(x86)%\Git\cmd;%PATH%"
where git >nul 2>&1
if not errorlevel 1 exit /b 0

echo [aviso] Git nao encontrado. O npm precisa dele para instalar uma dependencia do player.
echo         Tentando instalar Git automaticamente pelo winget...
where winget >nul 2>&1
if errorlevel 1 (
  echo [ERRO] winget nao encontrado para instalar o Git automaticamente.
  echo        Instale Git manualmente: https://git-scm.com/download/win
  echo        Depois feche esta janela e rode o .bat de novo.
  exit /b 1
)

call winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements >> "%LOG_FILE%" 2>&1
if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "PATH=%ProgramFiles(x86)%\Git\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Git foi solicitado, mas ainda nao entrou no PATH.
  echo        Feche esta janela, abra novamente o .bat, ou reinicie o Windows.
  exit /b 1
)
echo       Git instalado/detectado com sucesso.
exit /b 0

:fail
echo.
echo ============================================================
echo   [FALHA] Build interrompido. Corrigi o .bat para parar no erro real.
echo ============================================================
echo.
echo Log completo salvo em:
echo %LOG_FILE%
echo.
if exist "%LOG_FILE%" (
  echo Ultimas linhas do erro:
  echo ------------------------------------------------------------
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content -LiteralPath '%LOG_FILE%' -Tail 45" 2>nul
  echo ------------------------------------------------------------
)
echo.
pause
endlocal
exit /b 1

:fail_no_log
echo.
pause
endlocal
exit /b 1
