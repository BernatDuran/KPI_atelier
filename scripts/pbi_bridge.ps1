# scripts/pbi_bridge.ps1
# Bridge between KPI Atelier and local Power BI Desktop (Analysis Services Tabular)
[CmdletBinding()]
param(
    [string]$Action = "",
    [switch]$Interactive,
    [switch]$FromStdin,

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
    [string]$ConfigBase64 = "",
    [string]$ExpectedState = "",
    [string]$ExpectedExpressionBase64 = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "pbi_connection.ps1")

function Throw-Conflict([string]$message) {
    $error = New-Object System.InvalidOperationException($message)
    $error.Data['code'] = 'CONFLICT'
    throw $error
}

function Assert-MeasureVersion($measure, $existingTable, [string]$tableName, [string]$expectedState, [string]$expectedExpressionBase64) {
    if ($expectedState -notin @('absent', 'present')) { throw 'Revisa el destino antes de guardar.' }
    if ($expectedState -eq 'absent' -and $measure) { Throw-Conflict 'La medida ya existe. Actualiza la revisión antes de sobrescribirla.' }
    if ($expectedState -eq 'present') {
        $expectedExpression = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($expectedExpressionBase64))
        if (-not $measure -or $existingTable.Name -cne $tableName -or $measure.Expression -cne $expectedExpression) {
            Throw-Conflict 'La medida cambió desde la revisión. Actualiza el destino antes de guardar.'
        }
    }
}

function Invoke-BridgeAction {
    param(
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
        [string]$ConfigBase64 = "",
        [string]$ExpectedState = "",
        [string]$ExpectedExpressionBase64 = ""
    )

    switch ($Action) {
        "discover" {
            $instances = @(Discover-Instances)
            return @{
                success = $true
                instances = $instances
            }
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
                return @{
                    success = $true
                    connected = $true
                    server = $Server
                    serverName = $srv.Name
                    databases = $dbList
                }
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

                $db = Resolve-Database $srv $Database

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

                return @{
                    success = $true
                    server = $Server
                    database = $db.Name
                    databaseId = $db.ID
                    reportName = if ($reportName) { $reportName } else { "" }
                    modelName = $resolvedModelName
                    tables = $tablesOut
                    measures = $allMeasures
                    detectedDateTables = $detectedDateTables
                }
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

                $db = Resolve-Database $srv $Database $true
                if (-not $TableName) { throw "Selecciona una tabla de destino." }
                if ($ExpectedState -notin @("absent", "present")) { throw "Revisa el destino antes de guardar." }

                # Check if measure already exists in any table in the model (case-insensitive)
                $existingMeas = $null
                $existingTable = $null
                foreach ($tbl in $db.Model.Tables) {
                    $found = $tbl.Measures | Where-Object { $_.Name -ieq $MeasureName } | Select-Object -First 1
                    if ($found) {
                        $existingMeas = $found
                        $existingTable = $tbl
                        break
                    }
                }

                $targetTable = $db.Model.Tables | Where-Object { $_.Name -ceq $TableName } | Select-Object -First 1
                if (-not $targetTable) { throw "La tabla seleccionada ya no existe: $TableName" }
                Assert-MeasureVersion $existingMeas $existingTable $TableName $ExpectedState $ExpectedExpressionBase64
                if ($existingMeas) {
                    $meas = $existingMeas
                    $isNew = $false
                } else {
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

                try { $db.Model.SaveChanges() | Out-Null } catch { $_.Exception.Data["outcomeUnknown"] = $true; throw }

                return @{
                    success = $true
                    isNew = $isNew
                    server = $Server
                    database = $db.Name
                    tableName = $targetTable.Name
                    measureName = $MeasureName
                    hasAnnotation = [bool]$ConfigJson
                }
            } finally {
                $srv.Disconnect()
            }
        }

        "delete-measure" {
            if (-not $Server) { throw "Se requiere el parámetro -Server." }

            if ($MeasureNameBase64) {
                $MeasureName = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($MeasureNameBase64))
            }
            if (-not $MeasureName) { throw "Se requiere el parámetro -MeasureName o -MeasureNameBase64." }

            $srv = Connect-Server $Server
            try {
                if ($srv.Databases.Count -eq 0) {
                    throw "El servidor no tiene bases de datos cargadas."
                }

                $db = Resolve-Database $srv $Database $true

                $deleted = $false
                $fromTable = ""
                foreach ($tbl in $db.Model.Tables) {
                    $found = $tbl.Measures | Where-Object { $_.Name -ieq $MeasureName } | Select-Object -First 1
                    if ($found) {
                        $tbl.Measures.Remove($found) | Out-Null
                        $deleted = $true
                        $fromTable = $tbl.Name
                        break
                    }
                }

                if ($deleted) {
                    try { $db.Model.SaveChanges() | Out-Null } catch { $_.Exception.Data["outcomeUnknown"] = $true; throw }
                }

                return @{
                    success = $true
                    deleted = $deleted
                    measureName = $MeasureName
                    tableName = $fromTable
                }
            } finally {
                $srv.Disconnect()
            }
        }
    }
}

if ($Interactive) {
    [Console]::Out.WriteLine('{"ready":true}')
    while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $req = $line | ConvertFrom-Json
            $resp = Invoke-BridgeAction `
                -Action $req.action `
                -Server $req.server `
                -Database $req.database `
                -TableName $req.tableName `
                -TableNameBase64 $req.tableNameBase64 `
                -MeasureName $req.measureName `
                -MeasureNameBase64 $req.measureNameBase64 `
                -Expression $req.expression `
                -ExpressionBase64 $req.expressionBase64 `
                -FormatString $req.formatString `
                -ConfigJson $req.configJson `
                -ConfigBase64 $req.configBase64 `
                -ExpectedState $req.expectedState `
                -ExpectedExpressionBase64 $req.expectedExpressionBase64

            $resp.requestId = $req.requestId
            $jsonOut = $resp | ConvertTo-Json -Depth 6 -Compress
            [Console]::Out.WriteLine($jsonOut)
        } catch {
            $errObj = @{
                success = $false
                error = $_.Exception.Message
                code = if ($_.Exception.Data["code"]) { $_.Exception.Data["code"] } else { "BRIDGE_REJECTED" }
                outcomeUnknown = [bool]$_.Exception.Data["outcomeUnknown"]
                requestId = $req.requestId
            }
            $jsonOut = $errObj | ConvertTo-Json -Depth 5 -Compress
            [Console]::Out.WriteLine($jsonOut)
        }
    }
} elseif ($FromStdin) {
    try {
        $raw = [Console]::In.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($raw)) { throw "No se recibieron datos por stdin." }
        $req = $raw | ConvertFrom-Json
        $resp = Invoke-BridgeAction `
            -Action $req.action `
            -Server $req.server `
            -Database $req.database `
            -TableName $req.tableName `
            -TableNameBase64 $req.tableNameBase64 `
            -MeasureName $req.measureName `
            -MeasureNameBase64 $req.measureNameBase64 `
            -Expression $req.expression `
            -ExpressionBase64 $req.expressionBase64 `
            -FormatString $req.formatString `
            -ConfigJson $req.configJson `
            -ConfigBase64 $req.configBase64 `
                -ExpectedState $req.expectedState `
                -ExpectedExpressionBase64 $req.expectedExpressionBase64

        $resp | ConvertTo-Json -Depth 6 -Compress
    } catch {
        $errObj = @{
            success = $false
            error = $_.Exception.Message
            details = $_.ScriptStackTrace
        }
        $errObj | ConvertTo-Json -Depth 5 -Compress
        exit 1
    }
} else {
    try {
        if (-not $Action) { throw "Se requiere especificar el parámetro -Action." }
        $resp = Invoke-BridgeAction `
            -Action $Action `
            -Server $Server `
            -Database $Database `
            -TableName $TableName `
            -TableNameBase64 $TableNameBase64 `
            -MeasureName $MeasureName `
            -MeasureNameBase64 $MeasureNameBase64 `
            -Expression $Expression `
            -ExpressionBase64 $ExpressionBase64 `
            -FormatString $FormatString `
            -ConfigJson $ConfigJson `
            -ConfigBase64 $ConfigBase64 `
            -ExpectedState $ExpectedState `
            -ExpectedExpressionBase64 $ExpectedExpressionBase64

        $resp | ConvertTo-Json -Depth 6 -Compress
    } catch {
        $errObj = @{
            success = $false
            error = $_.Exception.Message
            details = $_.ScriptStackTrace
        }
        $errObj | ConvertTo-Json -Depth 5 -Compress
        exit 1
    }
}
