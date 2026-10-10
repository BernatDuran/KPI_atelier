# scripts/install-pbitool.ps1
# Installs KPI Atelier as an official Power BI Desktop External Tool (.pbitool.json)
[CmdletBinding()]
param(
    [switch]$NoElevation
)

$ErrorActionPreference = "Stop"

$repoRoot = (Split-Path -Parent $PSScriptRoot)
$launcherPath = Join-Path $repoRoot "kpi-atelier.cmd"
$iconPath = Join-Path $repoRoot "dist\icon.png"

if (-not (Test-Path $launcherPath)) {
    throw "No se encontro el lanzador: $launcherPath"
}

if (-not (Test-Path $iconPath)) {
    Write-Host "Generando icono 48x48 PNG..."
    node (Join-Path $repoRoot "scripts\generate_icon.mjs")
}

$iconBytes = [System.IO.File]::ReadAllBytes($iconPath)
$iconBase64 = [System.Convert]::ToBase64String($iconBytes)
# Microsoft specification: image/png;base64,... WITHOUT data: prefix
$iconData = "image/png;base64,$iconBase64"

$toolDef = [ordered]@{
    version = "1.0"
    name = "KPI Atelier"
    description = "Estudio de diseno visual y generacion de medidas DAX para tarjetas KPI en Power BI Desktop."
    path = $launcherPath
    arguments = '"%server%" "%database%"'
    iconData = $iconData
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$jsonText = $toolDef | ConvertTo-Json -Depth 4

# Save a copy in repository root
$repoCopy = Join-Path $repoRoot "kpi-atelier.pbitool.json"
[System.IO.File]::WriteAllText($repoCopy, $jsonText, $utf8NoBom)
Write-Host "OK: Copia local guardada en: $repoCopy" -ForegroundColor Green

# Determine External Tools target directory
$commonFilesX86 = [System.Environment]::GetFolderPath('CommonProgramFilesX86')
if (-not $commonFilesX86) {
    $commonFilesX86 = [System.Environment]::GetFolderPath('CommonProgramFiles')
}
$targetDir = Join-Path $commonFilesX86 "Microsoft Shared\Power BI Desktop\External Tools"

# Check Administrator privileges
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not $NoElevation) {
    Write-Host "Se requieren privilegios de Administrador para registrar la herramienta en Program Files (x86)." -ForegroundColor Yellow
    Write-Host "Elevando proceso..." -ForegroundColor Cyan
    $proc = Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NoElevation" -PassThru -Wait
    if ($proc.ExitCode -eq 0) {
        Write-Host "OK: KPI Atelier registrado con exito en Power BI Desktop." -ForegroundColor Green
    }
    exit $proc.ExitCode
}

# When running elevated (or if folder is accessible):
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$targetFile = Join-Path $targetDir "kpi-atelier.pbitool.json"
[System.IO.File]::WriteAllText($targetFile, $jsonText, $utf8NoBom)

Write-Host "OK: Registrado en Power BI Desktop External Tools:" -ForegroundColor Green
Write-Host "  Ruta: $targetFile" -ForegroundColor Cyan
Write-Host "  Lanzador: $launcherPath"
Write-Host "  Icono: 48x48 PNG ($($iconBytes.Length) bytes incrustados)"

$pbiRunning = Get-Process -Name "PBIDesktop" -ErrorAction SilentlyContinue
if ($pbiRunning) {
    Write-Host "`n[INFO] Power BI Desktop esta actualmente abierto." -ForegroundColor Yellow
    Write-Host "Para ver el boton de KPI Atelier en la pestana 'Herramientas externas', reinicia Power BI Desktop o abre una nueva ventana." -ForegroundColor Yellow
} else {
    Write-Host "`nKPI Atelier aparecera en la pestana 'Herramientas externas' la proxima vez que abras Power BI Desktop." -ForegroundColor Green
}
