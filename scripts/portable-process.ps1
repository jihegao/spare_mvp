# Shared ownership check. A PID alone is never sufficient after a service crash.
function Test-PortableServiceCommand {
    param([string]$Name, [string]$CommandLine, [string]$InstanceToken)
    if ($InstanceToken -notmatch '^[a-f0-9]{32}$') { return $false }
    $tokenPattern = '(?:^|\s)"?-X"?\s+"?spare_mvp_instance=' + [regex]::Escape($InstanceToken) + '"?(?=\s|$)'
    if ($CommandLine -notmatch $tokenPattern) { return $false }
    if ($Name -eq 'backend') {
        return $CommandLine -match '(?:^|\s)"?-m"?\s+"?src\.spare_mvp_backend\.http_server"?(?=\s|$)' -or
            ($CommandLine -match '(?:^|\s)"?[^"\s]*portable-data-guard\.py"?(?=\s|$)' -and
             $CommandLine -match '(?:^|\s)"?--module"?\s+"?src\.spare_mvp_backend\.http_server"?(?=\s|$)')
    }
    if ($Name -eq 'solara') {
        return $CommandLine -match '(?:^|\s)"?-m"?\s+"?solara"?\s+"?run"?\s+"?src\.spare_mvp_abm\.aircraft_support_v1\.solara_app"?(?=\s|$)'
    }
    return $false
}

function Write-PortableProcessRecord {
    param([System.Diagnostics.Process]$Process, [string]$Name, [string]$Python,
          [string]$PidPath, [string]$InstanceToken, [string]$InstallationId = '')
    $record = [ordered]@{
        pid = $Process.Id
        service = $Name
        executable = $Python
        started_at_utc = $Process.StartTime.ToUniversalTime().ToString('o')
        instance_token = $InstanceToken
    }
    if (-not [string]::IsNullOrWhiteSpace($InstallationId)) { $record.installation_id = $InstallationId }
    $record | ConvertTo-Json | Set-Content -LiteralPath "$PidPath.json" -Encoding UTF8
    Set-Content -LiteralPath $PidPath -Value $Process.Id -NoNewline -Encoding ascii
}

function Remove-PortableProcessRecord {
    param([string]$PidPath)
    Remove-Item -LiteralPath $PidPath, "$PidPath.json" -Force -ErrorAction SilentlyContinue
}

function Get-OwnedPortableProcess {
    param([string]$Name, [string]$Python, [string]$PidPath, [string]$InstallationId = '')
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
        ([string]::IsNullOrWhiteSpace($InstallationId) -or $record.installation_id -eq $InstallationId) -and
        (Test-PortableServiceCommand -Name $Name -CommandLine $details.CommandLine -InstanceToken $record.instance_token)
    if (-not $ownershipMatches) {
        Write-Warning "Stale $Name record does not own PID $pidValue; process left untouched."
        Remove-PortableProcessRecord -PidPath $PidPath
        return $null
    }
    return $process
}

function Acquire-SharedDataMutex {
    param([string]$MutexName, [string]$BusyMessage = 'User data is already in use by another installation. The other installation was left untouched.')
    $mutex = [Threading.Mutex]::new($false, $MutexName)
    try {
        try {
            $acquired = $mutex.WaitOne(0)
        } catch [Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            $mutex.Dispose()
            throw $BusyMessage
        }
        return $mutex
    } catch {
        if ($null -ne $mutex) { $mutex.Dispose() }
        throw
    }
}

function Release-SharedDataMutex {
    param([Threading.Mutex]$Mutex)
    if ($null -eq $Mutex) { return }
    try { $Mutex.ReleaseMutex() } finally { $Mutex.Dispose() }
}

function Write-SharedDataWriterMetadata {
    param([string]$LockPath, [System.Diagnostics.Process]$Process, [string]$Python,
          [string]$InstanceToken, [string]$InstallationId, [string]$PackageRoot, [string]$DataRoot)
    New-Item -ItemType Directory -Path (Split-Path -Parent $LockPath) -Force | Out-Null
    [ordered]@{
        format_version = 1
        mutex_enforced = $true
        owner_pid = $Process.Id
        owner_started_at_utc = $Process.StartTime.ToUniversalTime().ToString('o')
        executable = $Python
        instance_token = $InstanceToken
        installation_id = $InstallationId
        package_root = [IO.Path]::GetFullPath($PackageRoot)
        data_root = [IO.Path]::GetFullPath($DataRoot)
        written_at_utc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $LockPath -Encoding UTF8
}
