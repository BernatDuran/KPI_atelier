# Local connection, instance discovery and exact database resolution.
function Find-TabularDll {
    $paths = @(
        "C:\Program Files\Microsoft SQL Server Management Studio 22\Release\Common7\IDE\Microsoft.AnalysisServices.Tabular.dll",
        "C:\Program Files\Microsoft SQL Server Management Studio 21\Release\Common7\IDE\Microsoft.AnalysisServices.Tabular.dll",
        "C:\Program Files\Microsoft SQL Server Management Studio 20\Release\Common7\IDE\Microsoft.AnalysisServices.Tabular.dll",
        "C:\Program Files\Microsoft SQL Server Management Studio 19\Release\Common7\IDE\Microsoft.AnalysisServices.Tabular.dll",
        "C:\Program Files\Microsoft SQL Server Management Studio 18\Release\Common7\IDE\Microsoft.AnalysisServices.Tabular.dll",
        "C:\Program Files\Microsoft SQL Server\170\DTS\Binn\Microsoft.AnalysisServices.Tabular.dll",
        "C:\Program Files\Microsoft SQL Server\160\DTS\Binn\Microsoft.AnalysisServices.Tabular.dll",
        "C:\Program Files\Microsoft SQL Server\150\DTS\Binn\Microsoft.AnalysisServices.Tabular.dll"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) { return $p }
    }

    $scriptBin = Join-Path (Split-Path -Parent $PSScriptRoot) "bin\Microsoft.AnalysisServices.Tabular.dll"
    if (Test-Path $scriptBin) { return $scriptBin }

    return $null
}

function Connect-Server([string]$targetServer) {
    if ($targetServer -notmatch '^(localhost|127\.0\.0\.1|\[::1\]):([0-9]{1,5})$' -or [int]$Matches[2] -lt 1 -or [int]$Matches[2] -gt 65535) {
        throw 'Solo se permiten instancias locales con puerto válido.'
    }
    $dll = Find-TabularDll
    if (-not $dll) {
        throw "No se encontró Microsoft.AnalysisServices.Tabular.dll."
    }

    if (-not $script:AssemblyResolver) {
        $script:AssemblyBinDir = Split-Path -Parent $dll
        $script:AssemblyResolver = [System.ResolveEventHandler]{
            param($sender, $args)
            $assemblyName = ($args.Name -split ',')[0]
            $candidate = Join-Path $script:AssemblyBinDir "$assemblyName.dll"
            if (Test-Path $candidate) {
                return [System.Reflection.Assembly]::LoadFrom($candidate)
            }
            return $null
        }
        [System.AppDomain]::CurrentDomain.add_AssemblyResolve($script:AssemblyResolver)
    }

    if (-not $script:TabularLoaded) {
        Add-Type -Path $dll -ErrorAction Stop
        $script:TabularLoaded = $true
    }

    $srv = New-Object Microsoft.AnalysisServices.Tabular.Server
    $srv.Connect($targetServer)
    return $srv
}

function Resolve-Database($srv, [string]$identity, [bool]$required = $false) {
    if ($srv.Databases.Count -eq 0) { throw 'El servidor no tiene bases de datos cargadas.' }
    if (-not $identity) {
        if ($required -or $srv.Databases.Count -ne 1) { throw 'Selecciona explícitamente la base de datos de destino.' }
        return $srv.Databases[0]
    }
    $matches = @($srv.Databases | Where-Object { $_.ID -ceq $identity })
    if ($matches.Count -eq 0) { $matches = @($srv.Databases | Where-Object { $_.Name -ceq $identity }) }
    if ($matches.Count -ne 1) { throw "La base de datos seleccionada no existe o es ambigua: $identity" }
    return $matches[0]
}

function Get-PbiReportName($msmdsrvPid) {
    try {
        $msmdsrvProc = Get-CimInstance Win32_Process -Filter "ProcessId = $msmdsrvPid" -ErrorAction SilentlyContinue
        if (-not $msmdsrvProc) {
            $msmdsrvProc = Get-WmiObject Win32_Process -Filter "ProcessId = $msmdsrvPid" -ErrorAction SilentlyContinue
        }
        if (-not $msmdsrvProc -or -not $msmdsrvProc.ParentProcessId) { return $null }
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($msmdsrvProc.ParentProcessId)" -ErrorAction SilentlyContinue
        if (-not $parent) {
            $parent = Get-WmiObject Win32_Process -Filter "ProcessId = $($msmdsrvProc.ParentProcessId)" -ErrorAction SilentlyContinue
        }
        if (-not $parent) { return $null }

        # Check CommandLine argument of parent process first (preserves .pbix / .pbip extension)
        if ($parent.CommandLine) {
            $regex = '"([^"]+\.(?:pbix|pbip|pbit))"'
            if ($parent.CommandLine -match $regex) {
                return [System.IO.Path]::GetFileName($Matches[1])
            }
            $regex2 = '(?:\s|^)([^\s"]+\.(?:pbix|pbip|pbit))'
            if ($parent.CommandLine -match $regex2) {
                return [System.IO.Path]::GetFileName($Matches[1])
            }
        }

        # Check MainWindowTitle of parent process
        $p = Get-Process -Id $parent.ProcessId -ErrorAction SilentlyContinue
        if ($p -and $p.MainWindowTitle) {
            $t = $p.MainWindowTitle -replace '\s*-\s*Power BI Desktop.*$', ''
            if ($t.Trim() -and $t.Trim() -ne "Power BI Desktop") {
                $trimmed = $t.Trim()
                if ($trimmed -match '\.(?:pbix|pbip|pbit)$') {
                    return $trimmed
                }
                return "$trimmed.pbix"
            }
        }
    } catch {}
    return $null
}

function Discover-Instances {
    $results = @()
    $pbiProcesses = Get-Process -Name "msmdsrv" -ErrorAction SilentlyContinue
    $dll = Find-TabularDll
    foreach ($proc in $pbiProcesses) {
        $ports = Get-NetTCPConnection -OwningProcess $proc.Id -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
            Select-Object -ExpandProperty LocalPort -Unique

        $reportName = Get-PbiReportName $proc.Id

        foreach ($port in $ports) {
            $serverStr = "localhost:$port"
            $dbName = ""
            $modelName = ""
            if ($dll) {
                $srv = $null
                try {
                    $srv = Connect-Server $serverStr
                    if ($srv.Databases.Count -gt 0) {
                        $firstDb = $srv.Databases[0]
                        $dbName = $firstDb.Name
                        if ($firstDb.Model -and $firstDb.Model.Name) {
                            $modelName = $firstDb.Model.Name
                        }
                    }
                } catch {
                    # Silently ignore connection errors during discovery
                } finally {
                    if ($srv) { $srv.Disconnect() }
                }
            }

            $displayName = if ($reportName) {
                $reportName
            } elseif ($modelName -and $modelName -ne "Model") {
                $modelName
            } elseif ($dbName) {
                $dbName
            } else {
                "Power BI Desktop (puerto $port)"
            }

            $results += [PSCustomObject]@{
                pid = $proc.Id
                port = $port
                server = $serverStr
                database = $dbName
                reportName = if ($reportName) { $reportName } else { "" }
                modelName = $displayName
            }
        }
    }
    return $results
}
