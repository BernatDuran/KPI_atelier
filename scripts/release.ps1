$ErrorActionPreference = 'Stop'
$releaseRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$releaseVersion = (Get-Content -Raw -LiteralPath (Join-Path $releaseRoot 'package.json') | ConvertFrom-Json).version
if ($releaseVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Version invalida.' }
$outputRoot = Join-Path $releaseRoot 'releases'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$stage = Join-Path $outputRoot ('.stage-' + [guid]::NewGuid().ToString('N'))
$verify = Join-Path $outputRoot ('.verify-' + [guid]::NewGuid().ToString('N'))
$packageDir = Join-Path $outputRoot "KPI-Atelier-v$releaseVersion"
$packageZip = Join-Path $outputRoot "KPI_Atelier_v${releaseVersion}_Codigo_Fuente.zip"
$stagedZip = "$stage.zip"
# Never replace a locally modified package or delete an unchecked recursive path.
if (Test-Path -LiteralPath $packageDir) {
    & node (Join-Path $PSScriptRoot 'release.mjs') verify $packageDir
    if ($LASTEXITCODE -ne 0) { throw 'El paquete previo fue modificado; conservalo con otro nombre antes de regenerar.' }
}
& node (Join-Path $PSScriptRoot 'release.mjs') stage $stage
if ($LASTEXITCODE -ne 0) { throw 'No se pudo preparar la distribucion.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $stagedZip, [IO.Compression.CompressionLevel]::Optimal, $false)
[IO.Compression.ZipFile]::ExtractToDirectory($stagedZip, $verify)
& node (Join-Path $PSScriptRoot 'release.mjs') verify $verify
if ($LASTEXITCODE -ne 0) { throw 'La verificacion del ZIP ha fallado; se conservan los archivos de diagnostico.' }
foreach ($releasePath in @($packageDir, $verify)) {
    $checkedPath = [IO.Path]::GetFullPath($releasePath)
    if ([IO.Path]::GetDirectoryName($checkedPath) -ne $outputRoot) { throw 'Ruta de limpieza fuera de releases.' }
    if (Test-Path -LiteralPath $checkedPath) { Remove-Item -LiteralPath $checkedPath -Recurse -Force }
}
Move-Item -LiteralPath $stage -Destination $packageDir
Move-Item -LiteralPath $stagedZip -Destination $packageZip -Force
$sha256 = [Security.Cryptography.SHA256]::Create()
$zipStream = [IO.File]::OpenRead($packageZip)
try { $zipHash = [BitConverter]::ToString($sha256.ComputeHash($zipStream)).Replace('-', '').ToLowerInvariant() }
finally { $zipStream.Dispose(); $sha256.Dispose() }
[IO.File]::WriteAllText("$packageZip.sha256", "$zipHash  $([IO.Path]::GetFileName($packageZip))`n", (New-Object Text.UTF8Encoding($false)))
Write-Output "Distribucion verificada: $packageDir"
Write-Output "ZIP verificado: $packageZip"
