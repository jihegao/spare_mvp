# Shared ownership check. A PID alone is never sufficient after a service crash.
function Test-PortableServiceCommand {
    param([string]$Name, [string]$CommandLine, [string]$InstanceToken)
    if ($InstanceToken -notmatch '^[a-f0-9]{32}$') { return $false }
    $tokenPattern = '(?:^|\s)"?-X"?\s+"?spare_mvp_instance=' + [regex]::Escape($InstanceToken) + '"?(?=\s|$)'
    if ($CommandLine -notmatch $tokenPattern) { return $false }
    if ($Name -eq 'backend') {
        return $CommandLine -match '(?:^|\s)"?-m"?\s+"?src\.spare_mvp_backend\.http_server"?(?=\s|$)'
    }
    if ($Name -eq 'solara') {
        return $CommandLine -match '(?:^|\s)"?-m"?\s+"?solara"?\s+"?run"?\s+"?src\.spare_mvp_abm\.aircraft_support_v1\.solara_app"?(?=\s|$)'
    }
    return $false
}

function Write-PortableProcessRecord {
    param([System.Diagnostics.Process]$Process, [string]$Name, [string]$Python,
          [string]$PidPath, [string]$InstanceToken)
    [ordered]@{
        pid = $Process.Id
        service = $Name
        executable = $Python
        started_at_utc = $Process.StartTime.ToUniversalTime().ToString('o')
        instance_token = $InstanceToken
    } | ConvertTo-Json | Set-Content -LiteralPath "$PidPath.json" -Encoding UTF8
    Set-Content -LiteralPath $PidPath -Value $Process.Id -NoNewline -Encoding ascii
}

function Remove-PortableProcessRecord {
    param([string]$PidPath)
    Remove-Item -LiteralPath $PidPath, "$PidPath.json" -Force -ErrorAction SilentlyContinue
}

function Get-OwnedPortableProcess {
    param([string]$Name, [string]$Python, [string]$PidPath)
    if (-not (Test-Path -LiteralPath $PidPath)) { return $null }
    $pidValue = 0
    if (-not [int]::TryParse((Get-Content -LiteralPath $PidPath -Raw).Trim(), [ref]$pidValue)) {
        throw "Invalid $Name PID record; ownership cannot be verified."
    }
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-PortableProcessRecord -PidPath $PidPath
        return $null
    }
    if (-not (Test-Path -LiteralPath "$PidPath.json")) {
        throw "$Name PID record has no creation-time and service identity; process left untouched."
    }
    # Inspection failure deliberately throws, retaining the record and process.
    $record = Get-Content -LiteralPath "$PidPath.json" -Raw | ConvertFrom-Json
    $details = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop
    if ($null -eq $details -or [string]::IsNullOrWhiteSpace($details.ExecutablePath) -or [string]::IsNullOrWhiteSpace($details.CommandLine)) {
        throw "$Name process inspection returned no ownership evidence; process left untouched."
    }
    $ownershipMatches = $record.pid -eq $pidValue -and $record.service -eq $Name -and
        $record.executable -ieq $Python -and $details.ExecutablePath -ieq $Python -and
        $record.started_at_utc -eq $process.StartTime.ToUniversalTime().ToString('o') -and
        (Test-PortableServiceCommand -Name $Name -CommandLine $details.CommandLine -InstanceToken $record.instance_token)
    if (-not $ownershipMatches) {
        Write-Warning "Stale $Name record does not own PID $pidValue; process left untouched."
        Remove-PortableProcessRecord -PidPath $PidPath
        return $null
    }
    return $process
}
