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
echo       Aplicando patch capacitor-video-player (suporte .ts / buffer / erros)...
call node scripts/patch-video-player.mjs 2>&1 | powershell -NoProfile -ExecutionPolicy Bypass -Command "$input | Tee-Object -FilePath '%LOG_FILE%' -Append"
if errorlevel 1 (
  echo [ERRO] Patch capacitor-video-player falhou. APK NAO contem suporte .ts/watchdog/erros.
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
call :fix_styles_xml || goto :fail
call npx cap sync android >> "%LOG_FILE%" 2>&1
call node scripts/patch-video-player.mjs 2>&1 | powershell -NoProfile -ExecutionPolicy Bypass -Command "$input | Tee-Object -FilePath '%LOG_FILE%' -Append"
if errorlevel 1 (
  echo [ERRO] Patch capacitor-video-player falhou depois do segundo cap sync.
  goto :fail
)
call :fix_build_gradle
echo       OK

echo.


echo [8/8] Compilando APK debug com Gradle (assembleDebug)...
pushd android >nul
if exist "gradlew.bat" (
  call gradlew.bat assembleDebug >> "%LOG_FILE%" 2>&1
  set "GRADLE_RC=!errorlevel!"
) else (
  echo [ERRO] gradlew.bat nao encontrado em android\
  set "GRADLE_RC=1"
)
popd >nul
if not "!GRADLE_RC!"=="0" (
  echo [ERRO] Falha ao gerar APK pelo Gradle.
  echo        Abrindo Android Studio para voce gerar manualmente...
  call npx cap open android >> "%LOG_FILE%" 2>&1
  goto :fail
)

set "APK_DIR=%CD%\android\app\build\outputs\apk\debug"
set "APK_FILE=%APK_DIR%\app-debug.apk"

echo.
echo ============================================================
echo   PRONTO! APK gerado com sucesso.
echo ============================================================
echo.
if exist "%APK_FILE%" (
  echo APK: %APK_FILE%
) else (
  echo Pasta do APK: %APK_DIR%
)
echo.
echo Abrindo a pasta do APK no Explorador...
if exist "%APK_FILE%" (
  explorer.exe /select,"%APK_FILE%"
) else (
  if exist "%APK_DIR%" explorer.exe "%APK_DIR%"
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

REM 1) Tenta winget se existir
where winget >nul 2>&1
if not errorlevel 1 (
  echo         Tentando instalar Git pelo winget...
  call winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements >> "%LOG_FILE%" 2>&1
  if exist "%ProgramFiles%\Git\cmd\git.exe" set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
  if exist "%ProgramFiles(x86)%\Git\cmd\git.exe" set "PATH=%ProgramFiles(x86)%\Git\cmd;%PATH%"
  where git >nul 2>&1
  if not errorlevel 1 (
    echo       Git instalado via winget.
    exit /b 0
  )
)

REM 2) Fallback: baixa PortableGit (nao precisa de admin nem winget)
set "PORTABLE_GIT_DIR=%CD%\.tools\PortableGit"
set "PORTABLE_GIT_EXE=%PORTABLE_GIT_DIR%\cmd\git.exe"
if exist "%PORTABLE_GIT_EXE%" (
  set "PATH=%PORTABLE_GIT_DIR%\cmd;%PATH%"
  echo       PortableGit ja existia em %PORTABLE_GIT_DIR%.
  exit /b 0
)

echo         Baixando PortableGit (~50MB) - aguarde...
if not exist "%CD%\.tools" mkdir "%CD%\.tools" >nul 2>&1
set "PORTABLE_GIT_URL=https://github.com/git-for-windows/git/releases/download/v2.46.0.windows.1/PortableGit-2.46.0-64-bit.7z.exe"
set "PORTABLE_GIT_PKG=%CD%\.tools\PortableGit.7z.exe"

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%PORTABLE_GIT_URL%' -OutFile '%PORTABLE_GIT_PKG%' } catch { Write-Host $_; exit 1 }" >> "%LOG_FILE%" 2>&1
if not exist "%PORTABLE_GIT_PKG%" (
  echo [ERRO] Falha ao baixar PortableGit. Verifique sua conexao.
  echo        Ou instale Git manualmente: https://git-scm.com/download/win
  exit /b 1
)

echo         Extraindo PortableGit em %PORTABLE_GIT_DIR%...
mkdir "%PORTABLE_GIT_DIR%" >nul 2>&1
"%PORTABLE_GIT_PKG%" -y -o"%PORTABLE_GIT_DIR%" >> "%LOG_FILE%" 2>&1
del /q "%PORTABLE_GIT_PKG%" >nul 2>&1

if not exist "%PORTABLE_GIT_EXE%" (
  echo [ERRO] PortableGit nao foi extraido corretamente.
  echo        Instale Git manualmente: https://git-scm.com/download/win
  exit /b 1
)

set "PATH=%PORTABLE_GIT_DIR%\cmd;%PATH%"
where git >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Git extraido mas nao detectado no PATH.
  exit /b 1
)
echo       PortableGit instalado com sucesso (sem admin).
exit /b 0

:fix_styles_xml
if not exist "android\app\src\main\res\values" exit /b 0
if not exist "android-template\styles.xml" (
  echo [ERRO] android-template\styles.xml ausente. >> "%LOG_FILE%"
  exit /b 1
)
rem Copia o template (UTF-8 valido, sem BOM) por cima do styles.xml gerado.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = Get-Content -LiteralPath 'android-template\styles.xml' -Raw; [IO.File]::WriteAllText('android\app\src\main\res\values\styles.xml', $s, (New-Object Text.UTF8Encoding $false))" >> "%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo [ERRO] Falha ao corrigir styles.xml.
  exit /b 1
)
exit /b 0



:fix_build_gradle
powershell -NoProfile -ExecutionPolicy Bypass -Command "$targets=@(); if(Test-Path 'android\app\build.gradle'){$targets+='android\app\build.gradle'}; if(Test-Path 'node_modules'){$targets+=(Get-ChildItem -Path 'node_modules' -Recurse -Filter 'build.gradle' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\android\\' } | ForEach-Object { $_.FullName })}; foreach($p in $targets){ try { $s=Get-Content -LiteralPath $p -Raw; if($s -match 'proguard-android\.txt'){ $s=$s -replace 'proguard-android\.txt','proguard-android-optimize.txt'; [IO.File]::WriteAllText($p, $s, [Text.UTF8Encoding]::new($false)); Write-Host ('Patched: '+$p) } } catch {} }" >> "%LOG_FILE%" 2>&1
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
