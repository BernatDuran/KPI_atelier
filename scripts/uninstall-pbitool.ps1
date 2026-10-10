# scripts/uninstall-pbitool.ps1
# Uninstalls KPI Atelier from Power BI Desktop External Tools
[CmdletBinding()]
param(
    [switch]$NoElevation
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin -and -not $NoElevation) {
    Write-Host "Se requieren privilegios de Administrador para desinstalar la herramienta." -ForegroundColor Yellow
    Write-Host "Elevando proceso..." -ForegroundColor Cyan
    $proc = Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -NoElevation" -PassThru -Wait
    exit $proc.ExitCode
}

$commonFilesX86 = [System.Environment]::GetFolderPath('CommonProgramFilesX86')
$commonFiles64 = [System.Environment]::GetFolderPath('CommonProgramFiles')

$paths = @(
    (Join-Path $commonFilesX86 "Microsoft Shared\Power BI Desktop\External Tools\kpi-atelier.pbitool.json"),
    (Join-Path $commonFiles64 "Microsoft Shared\Power BI Desktop\External Tools\kpi-atelier.pbitool.json")
)

$removedCount = 0
foreach ($p in $paths) {
    if (Test-Path $p) {
        Remove-Item -Path $p -Force
        Write-Host "OK: Archivo eliminado: $p" -ForegroundColor Green
        $removedCount++
    }
}

if ($removedCount -eq 0) {
    Write-Host "No se encontro ningun registro de KPI Atelier en External Tools." -ForegroundColor Yellow
} else {
    Write-Host "OK: KPI Atelier ha sido desinstalado de las Herramientas Externas de Power BI Desktop." -ForegroundColor Green
}
