@echo off
setlocal

:: Directorio raíz de KPI Atelier
set "APP_DIR=%~dp0"
set "APP_PORT=8080"
set "SERVER_ARG=%~1"
set "DB_ARG=%~2"

:: Comprobar si el servidor local ya está en ejecución
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%APP_PORT%' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>&1

if %errorlevel% neq 0 (
  :: Iniciar el servidor local en segundo plano
  start "KPI Atelier Server" /min node "%APP_DIR%scripts\serve.mjs" %APP_PORT%
  :: Breve espera para asegurar que el puerto esté listo
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "for ($i=0; $i -lt 15; $i++) { Start-Sleep -Milliseconds 200; try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:%APP_PORT%' -UseBasicParsing -TimeoutSec 1; exit 0 } catch {} }; exit 1" >nul 2>&1
)

:: Construir URL con parámetros de conexión en vivo
set "LAUNCH_URL=http://127.0.0.1:%APP_PORT%/"
if not "%SERVER_ARG%"=="" (
  set "LAUNCH_URL=http://127.0.0.1:%APP_PORT%/?server=%SERVER_ARG%&database=%DB_ARG%"
)

:: Lanzar Microsoft Edge en Modo Aplicación (ventana nativa sin barras de navegación)
where msedge.exe >nul 2>&1
if %errorlevel% equ 0 (
  start "" msedge.exe --app="%LAUNCH_URL%"
  goto :end
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="%LAUNCH_URL%"
  goto :end
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app="%LAUNCH_URL%"
  goto :end
)

:: Fallback al navegador predeterminado del sistema
start "" "%LAUNCH_URL%"

:end
endlocal
exit /b 0
