# Arguments arrive through environment variables, never interpolated into PowerShell code.
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$appPort = 8080
$baseUrl = "http://127.0.0.1:$appPort"
$expectedVersion = (Get-Content -Raw -LiteralPath (Join-Path $appRoot 'package.json') | ConvertFrom-Json).version
function Get-AppHealth {
    try {
        $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -TimeoutSec 2
        if ($health.app -eq 'kpi-atelier' -and $health.protocol -eq 1 -and $health.version -eq $expectedVersion) { return 'ready' }
        return 'occupied'
    } catch {
        $tcp = New-Object System.Net.Sockets.TcpClient
        try { $tcp.Connect('127.0.0.1', $appPort); return 'occupied' } catch { return 'offline' } finally { $tcp.Dispose() }
    }
}
try {
    $health = Get-AppHealth
    if ($health -eq 'occupied') { throw 'El puerto 8080 está ocupado por otro servicio o versión. Cierra ese proceso y vuelve a abrir KPI Atelier.' }
    if ($health -eq 'offline') {
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $serverScript = Join-Path $PSScriptRoot 'serve.mjs'
        Start-Process -FilePath $node -ArgumentList @(('"' + $serverScript + '"'), "$appPort") -WorkingDirectory $appRoot -WindowStyle Hidden
        $deadline = (Get-Date).AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 250
            $health = Get-AppHealth
        } while ($health -eq 'offline' -and (Get-Date) -lt $deadline)
        if ($health -ne 'ready') { throw 'No se pudo iniciar KPI Atelier. Comprueba Node.js y que el puerto 8080 esté disponible.' }
    }
    $launchUrl = "$baseUrl/"
    if ($env:KPI_LAUNCH_SERVER) {
        $launchUrl += '?server=' + [Uri]::EscapeDataString($env:KPI_LAUNCH_SERVER) + '&database=' + [Uri]::EscapeDataString($env:KPI_LAUNCH_DATABASE)
    }
    $edgeCommand = Get-Command msedge.exe -ErrorAction SilentlyContinue
    $edgePaths = @($edgeCommand.Source, "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
    $edge = $edgePaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if ($edge) { Start-Process -FilePath $edge -ArgumentList ('--app="' + $launchUrl + '"') }
    else { Start-Process $launchUrl }
    exit 0
} catch {
    Write-Host "No se pudo abrir KPI Atelier: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
