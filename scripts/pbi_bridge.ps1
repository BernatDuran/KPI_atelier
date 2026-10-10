# scripts/pbi_bridge.ps1
# Bridge between KPI Atelier and local Power BI Desktop (Analysis Services Tabular)
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("discover", "status", "schema", "inject-measure")]
    [string]$Action,

    [string]$Server = "",
    [string]$Database = "",
    [string]$TableName = "",
    [string]$TableNameBase64 = "",
    [string]$MeasureName = "",
    [string]$MeasureNameBase64 = "",
    [string]$Expression = "",
    [string]$ExpressionBase64 = "",
    [string]$FormatString = "",
    [string]$ConfigJson = "",
    [string]$ConfigBase64 = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

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
    $dll = Find-TabularDll
    if (-not $dll) {
        throw "No se encontró Microsoft.AnalysisServices.Tabular.dll."
    }

    $binDir = Split-Path -Parent $dll
    [System.AppDomain]::CurrentDomain.add_AssemblyResolve({
        param($sender, $args)
        $assemblyName = ($args.Name -split ',')[0]
        $candidate = Join-Path $binDir "$assemblyName.dll"
        if (Test-Path $candidate) {
            return [System.Reflection.Assembly]::LoadFrom($candidate)
        }
        return $null
    })

    Add-Type -Path $dll -ErrorAction SilentlyContinue

    $srv = New-Object Microsoft.AnalysisServices.Tabular.Server
    $srv.Connect($targetServer)
    return $srv
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
                try {
                    $srv = Connect-Server $serverStr
                    if ($srv.Databases.Count -gt 0) {
                        $firstDb = $srv.Databases[0]
                        $dbName = $firstDb.Name
                        if ($firstDb.Model -and $firstDb.Model.Name) {
                            $modelName = $firstDb.Model.Name
                        }
                    }
                    $srv.Disconnect()
                } catch {
                    # Silently ignore connection errors during discovery
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

try {
    switch ($Action) {
        "discover" {
            $instances = @(Discover-Instances)
            $out = @{
                success = $true
                instances = $instances
            }
            $out | ConvertTo-Json -Depth 5 -Compress
        }

        "status" {
            if (-not $Server) {
                $instances = Discover-Instances
                if ($instances.Count -gt 0) {
                    $Server = $instances[0].server
                } else {
                    throw "No se detectó ningún servidor de Power BI Desktop activo."
                }
            }

            $srv = Connect-Server $Server
            try {
                $dbList = @()
                foreach ($db in $srv.Databases) {
                    $dbList += @{
                        name = $db.Name
                        id = $db.ID
                        compatibilityLevel = $db.CompatibilityLevel
                    }
                }
                @{
                    success = $true
                    connected = $true
                    server = $Server
                    serverName = $srv.Name
                    databases = $dbList
                } | ConvertTo-Json -Depth 5 -Compress
            } finally {
                $srv.Disconnect()
            }
        }

        "schema" {
            if (-not $Server) {
                $instances = Discover-Instances
                if ($instances.Count -gt 0) {
                    $Server = $instances[0].server
                } else {
                    throw "No se especificó servidor y no hay instancias de Power BI Desktop activas."
                }
            }

            # Resolve friendly report name from server port before connecting to Tabular server
            $reportName = $null
            try {
                $portPart = [int](($Server -split ':')[-1])
                $msmdsrvProcs = Get-Process -Name "msmdsrv" -ErrorAction SilentlyContinue
                foreach ($mProc in $msmdsrvProcs) {
                    $pPorts = Get-NetTCPConnection -OwningProcess $mProc.Id -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort
                    if ($portPart -in $pPorts) {
                        $reportName = Get-PbiReportName $mProc.Id
                        if ($reportName) { break }
                    }
                }
            } catch {}

            $srv = Connect-Server $Server
            try {
                if ($srv.Databases.Count -eq 0) {
                    throw "El servidor no tiene bases de datos cargadas."
                }

                $db = $null
                if ($Database) {
                    $db = $srv.Databases.Find($Database)
                    if (-not $db) {
                        $db = $srv.Databases | Where-Object { $_.Name -eq $Database -or $_.ID -eq $Database } | Select-Object -First 1
                    }
                }
                if (-not $db) {
                    $db = $srv.Databases[0]
                }

                $tablesOut = @()
                $allMeasures = @()
                $detectedDateTables = @()

                foreach ($tbl in $db.Model.Tables) {
                    # Skip internal local date templates if needed, but report properties
                    $isAutoDate = $tbl.Name -like "LocalDateTable_*" -or $tbl.Name -like "DateTableTemplate_*"
                    $isTimeCategory = ($tbl.DataCategory -eq "Time")

                    $columnsOut = @()
                    $hasDateTimeCol = $false
                    $primaryKeyCol = $null
                    $dateTimeCols = @()

                    foreach ($col in $tbl.Columns) {
                        $colTypeStr = $col.DataType.ToString()
                        $isDateType = ($colTypeStr -in @("DateTime", "Date"))

                        if ($isDateType) {
                            $hasDateTimeCol = $true
                            $dateTimeCols += $col.Name
                        }

                        if ($col.IsKey) {
                            $primaryKeyCol = $col.Name
                        }

                        $columnsOut += @{
                            name = $col.Name
                            dataType = $colTypeStr
                            dataCategory = [string]$col.DataCategory
                            isKey = [bool]$col.IsKey
                            isHidden = [bool]$col.IsHidden
                            formatString = [string]$col.FormatString
                        }
                    }

                    $tableMeasures = @()
                    foreach ($m in $tbl.Measures) {
                        $configVal = $null
                        $anno = $m.Annotations.Find("KPI_Atelier_Config")
                        if ($anno) { $configVal = $anno.Value }

                        $mObj = @{
                            name = $m.Name
                            table = $tbl.Name
                            expression = $m.Expression
                            formatString = [string]$m.FormatString
                            isHidden = [bool]$m.IsHidden
                            displayFolder = [string]$m.DisplayFolder
                            configAnnotation = $configVal
                        }
                        $tableMeasures += $mObj
                        $allMeasures += $mObj
                    }

                    # Determine hierarchy for date table detection
                    if (-not $isAutoDate) {
                        $tier = 0
                        $suggestedDateCol = $null

                        if ($isTimeCategory) {
                            $tier = 1
                        } elseif ($tbl.Name -match '(?i)(Date|Calendar|Fecha|Calendario|Tiempo)') {
                            $tier = 2
                        } elseif ($hasDateTimeCol) {
                            $tier = 3
                        }

                        if ($tier -gt 0) {
                            if ($primaryKeyCol -and ($primaryKeyCol -in $dateTimeCols)) {
                                $suggestedDateCol = $primaryKeyCol
                            } elseif ($dateTimeCols.Count -gt 0) {
                                # prefer column containing Date or Fecha
                                $nameMatch = $dateTimeCols | Where-Object { $_ -match '(?i)(Date|Fecha)' } | Select-Object -First 1
                                $suggestedDateCol = if ($nameMatch) { $nameMatch } else { $dateTimeCols[0] }
                            }

                            $detectedDateTables += @{
                                table = $tbl.Name
                                tier = $tier
                                isOfficialMarked = $isTimeCategory
                                suggestedColumn = $suggestedDateCol
                                dateColumns = $dateTimeCols
                            }
                        }
                    }

                    $tablesOut += @{
                        name = $tbl.Name
                        dataCategory = [string]$tbl.DataCategory
                        isHidden = [bool]$tbl.IsHidden
                        isAutoDate = $isAutoDate
                        columns = $columnsOut
                        measures = $tableMeasures
                    }
                }

                # Sort detected date tables by tier ascending (1 is best), then table name
                $detectedDateTables = @($detectedDateTables | Sort-Object { [int]$_.tier }, { [string]$_.table })



                $resolvedModelName = if ($reportName) {
                    $reportName
                } elseif ($db.Model.Name -and $db.Model.Name -ne "Model") {
                    $db.Model.Name
                } elseif ($db.Name) {
                    $db.Name
                } else {
                    "Power BI Desktop"
                }

                @{
                    success = $true
                    server = $Server
                    database = $db.Name
                    databaseId = $db.ID
                    reportName = if ($reportName) { $reportName } else { "" }
                    modelName = $resolvedModelName
                    tables = $tablesOut
                    measures = $allMeasures
                    detectedDateTables = $detectedDateTables
                } | ConvertTo-Json -Depth 6 -Compress
            } finally {
                $srv.Disconnect()
            }
        }

        "inject-measure" {
            if (-not $Server) { throw "Se requiere el parámetro -Server." }

            if ($TableNameBase64) {
                $TableName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($TableNameBase64))
            }
            if ($MeasureNameBase64) {
                $MeasureName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($MeasureNameBase64))
            }
            if (-not $MeasureName) { throw "Se requiere el parámetro -MeasureName o -MeasureNameBase64." }

            if ($ExpressionBase64) {
                $Expression = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ExpressionBase64))
            }
            if (-not $Expression) { throw "Se requiere el parámetro -Expression o -ExpressionBase64." }

            if ($ConfigBase64) {
                $ConfigJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($ConfigBase64))
            }

            $srv = Connect-Server $Server
            try {
                if ($srv.Databases.Count -eq 0) {
                    throw "El servidor no tiene bases de datos cargadas."
                }

                $db = $null
                if ($Database) {
                    $db = $srv.Databases.Find($Database)
                    if (-not $db) {
                        $db = $srv.Databases | Where-Object { $_.Name -eq $Database -or $_.ID -eq $Database } | Select-Object -First 1
                    }
                }
                if (-not $db) { $db = $srv.Databases[0] }

                # Check if measure already exists in any table in the model
                $existingMeas = $null
                $existingTable = $null
                foreach ($tbl in $db.Model.Tables) {
                    $found = $tbl.Measures.Find($MeasureName)
                    if ($found) {
                        $existingMeas = $found
                        $existingTable = $tbl
                        break
                    }
                }

                if ($existingMeas) {
                    $meas = $existingMeas
                    $targetTable = $existingTable
                    $isNew = $false
                } else {
                    $targetTable = $null
                    if ($TableName) {
                        $targetTable = $db.Model.Tables.Find($TableName)
                    }
                    if (-not $targetTable) {
                        $targetTable = $db.Model.Tables.Find("_Measures")
                        if (-not $targetTable) {
                            $targetTable = $db.Model.Tables | Where-Object { -not ($_.Name -like "LocalDateTable_*") } | Select-Object -First 1
                        }
                    }
                    if (-not $targetTable) {
                        throw "No se encontró una tabla válida donde ubicar la medida."
                    }

                    $meas = New-Object Microsoft.AnalysisServices.Tabular.Measure
                    $meas.Name = $MeasureName
                    $targetTable.Measures.Add($meas)
                    $isNew = $true
                }

                # Strip leading "MeasureName = " only if strictly matching the measure name
                $escapedName = [regex]::Escape($MeasureName)
                $cleanExpr = $Expression -replace "^\s*(\[?$escapedName\]?)\s*=\s*", ""
                $trimmedStart = $cleanExpr.TrimStart([char[]]@("`r", "`n", " ", "`t"))
                $meas.Expression = "`r`n" + $trimmedStart
                if ($FormatString) {
                    $meas.FormatString = $FormatString
                }

                if ($ConfigJson) {
                    $anno = $meas.Annotations.Find("KPI_Atelier_Config")
                    if (-not $anno) {
                        $anno = New-Object Microsoft.AnalysisServices.Tabular.Annotation
                        $anno.Name = "KPI_Atelier_Config"
                        $meas.Annotations.Add($anno)
                    }
                    $anno.Value = $ConfigJson
                }

                $db.Model.SaveChanges() | Out-Null

                @{
                    success = $true
                    isNew = $isNew
                    server = $Server
                    database = $db.Name
                    tableName = $targetTable.Name
                    measureName = $MeasureName
                    hasAnnotation = [bool]$ConfigJson
                } | ConvertTo-Json -Depth 5 -Compress
            } finally {
                $srv.Disconnect()
            }
        }
    }
} catch {
    $errObj = @{
        success = $false
        error = $_.Exception.Message
        details = $_.ScriptStackTrace
    }
    $errObj | ConvertTo-Json -Depth 5 -Compress
    exit 1
}
