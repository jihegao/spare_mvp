[CmdletBinding()]
param([string]$Helper = (Join-Path $PSScriptRoot '..\scripts\portable-process.ps1'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. $Helper
$root = Join-Path ([IO.Path]::GetTempPath()) ('spare-ownership-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$pidPath = Join-Path $root 'backend.pid'
$python = 'C:\portable\runtime\python.exe'
$token = 'a' * 32
$installationId = '1' * 24
$started = [DateTime]::Parse('2026-09-18T01:02:03Z').ToUniversalTime()
$script:fakeProcess = [pscustomobject]@{ Id = 12345; StartTime = $started }
$script:fakeDetails = $null
$script:inspectionFails = $false
$script:fakeListeners = @()
$script:listenerInspectionFails = $false
$assertions = 0
$actualSelf = Microsoft.PowerShell.Management\Get-Process -Id $PID
$powerShellExe = $actualSelf.Path
Write-PortableProcessRecord -Process $actualSelf -Name backend -Python $python -PidPath $pidPath -InstanceToken $token
$actualRecord = Get-Content -LiteralPath "$pidPath.json" -Raw | ConvertFrom-Json
if ($actualRecord.pid -ne $PID -or $actualRecord.started_at_utc -ne $actualSelf.StartTime.ToUniversalTime().ToString('o')) {
    throw 'Native process creation time did not round-trip through ownership record'
}
$assertions++
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
    $script:assertions++
}
function Set-TestRecord {
    [ordered]@{pid=12345; service='backend'; executable=$python; started_at_utc=$started.ToString('o'); instance_token=$token; installation_id=$installationId} |
        ConvertTo-Json | Set-Content -LiteralPath "$pidPath.json" -Encoding UTF8
    Set-Content -LiteralPath $pidPath -Value '12345' -Encoding ascii
    $script:fakeDetails = [pscustomobject]@{
        ExecutablePath=$python
        CommandLine=('"' + $python + '" "-B" "-X" "spare_mvp_instance=' + $token + '" "-m" "src.spare_mvp_backend.http_server"')
    }
}
function Get-Process { [CmdletBinding()]param([int]$Id) return $script:fakeProcess }
function Get-CimInstance { [CmdletBinding()]param([string]$ClassName, [string]$Filter)
    if ($script:inspectionFails) { throw 'simulated access denied' }
    return $script:fakeDetails
}
function Get-NetTCPConnection {
    [CmdletBinding()]param([string]$State, [string]$LocalAddress, [int]$LocalPort)
    if ($script:listenerInspectionFails) { throw 'simulated listener inspection denied' }
    return $script:fakeListeners
}
try {
    Set-TestRecord
    Assert-True ($null -ne (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath)) 'Owned service was rejected'
    Set-TestRecord
    Assert-True ($null -ne (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath -InstallationId $installationId)) 'Matching installation identity was rejected'
    Set-TestRecord
    Assert-True ($null -eq (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath -InstallationId ('2' * 24))) 'Different installation identity was accepted'
    Set-TestRecord
    Assert-True ($null -eq (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath -InstallationId ('2' * 24) -PreserveRecordOnMismatch)) 'Different installation identity was accepted in check-only mode'
    Assert-True (Test-Path $pidPath) 'Check-only ownership mismatch removed the PID record'
    Set-TestRecord
    $script:fakeDetails.CommandLine = '"C:\portable\runtime\python.exe" "C:\other\unrelated.py"'
    Assert-True ($null -eq (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath)) 'Same-runtime unrelated command was accepted'
    Assert-True (-not (Test-Path $pidPath)) 'Known stale record was retained'
    Set-TestRecord
    $script:fakeProcess.StartTime = $started.AddSeconds(1)
    Assert-True ($null -eq (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath)) 'Reused PID creation time was accepted'
    $script:fakeProcess.StartTime = $started
    Set-TestRecord
    $script:fakeDetails.CommandLine = $script:fakeDetails.CommandLine.Replace($token, ('b' * 32))
    Assert-True ($null -eq (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath)) 'Different launch token was accepted'
    Set-TestRecord
    $script:inspectionFails = $true
    $rejected = $false
    try { Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath | Out-Null } catch { $rejected = $true }
    Assert-True $rejected 'Inspection failure must fail closed'
    Assert-True (Test-Path $pidPath) 'Inspection failure must retain PID record'
    $script:inspectionFails = $false
    Remove-Item -LiteralPath "$pidPath.json"
    $rejected = $false
    try { Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath | Out-Null } catch { $rejected = $true }
    Assert-True $rejected 'Legacy PID without identity must fail closed'
    Assert-True (Test-Path $pidPath) 'Legacy unverified record must remain available for diagnosis'
    $solara = '"C:\portable\runtime\python.exe" "-X" "spare_mvp_instance=' + $token + '" "-m" "solara" "run" "src.spare_mvp_abm.aircraft_support_v1.solara_app"'
    Assert-True (Test-PortableServiceCommand -Name solara -CommandLine $solara -InstanceToken $token) 'Owned Solara command rejected'
    Assert-True (-not (Test-PortableServiceCommand -Name backend -CommandLine $solara -InstanceToken $token)) 'Solara command accepted as backend'
    $guardedBackend = '"C:\portable\runtime\python.exe" "-X" "spare_mvp_instance=' + $token + '" "C:\portable\scripts\portable-data-guard.py" "--mutex-name" "Local\SpareMvpData_test" "--module" "src.spare_mvp_backend.http_server"'
    Assert-True (Test-PortableServiceCommand -Name backend -CommandLine $guardedBackend -InstanceToken $token) 'Guarded backend command rejected'
    $script:fakeListeners = @([pscustomobject]@{ OwningProcess = 12345 })
    Assert-PortableTcpListenerOwnership -Name backend -Port 4173 -ExpectedPid 12345
    $assertions++
    $script:fakeListeners = @([pscustomobject]@{ OwningProcess = 99999 })
    $rejected = $false
    try { Assert-PortableTcpListenerOwnership -Name backend -Port 4173 -ExpectedPid 12345 } catch { $rejected = $true }
    Assert-True $rejected 'Foreign listener owner was accepted'
    $script:fakeListeners = @()
    $rejected = $false
    try { Assert-PortableTcpListenerOwnership -Name solara -Port 8765 -ExpectedPid 12345 } catch { $rejected = $true }
    Assert-True $rejected 'Missing listener was accepted'
    $script:listenerInspectionFails = $true
    $rejected = $false
    try { Assert-PortableTcpListenerOwnership -Name solara -Port 8765 -ExpectedPid 12345 } catch { $rejected = $true }
    Assert-True $rejected 'Listener inspection failure did not fail closed'
    $script:listenerInspectionFails = $false
    Set-TestRecord
    $script:fakeProcess = $null
    Assert-True ($null -eq (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath)) 'Exited PID was retained as live'
    Assert-True (-not (Test-Path "$pidPath.json")) 'Exited process metadata was retained'
    Set-TestRecord
    Assert-True ($null -eq (Get-OwnedPortableProcess -Name backend -Python $python -PidPath $pidPath -PreserveRecordOnMismatch)) 'Exited PID was accepted in check-only mode'
    Assert-True (Test-Path $pidPath) 'Check-only exited-process mismatch removed the PID record'
    $mutexProbe = Join-Path $root 'mutex-probe.ps1'
    @'
param([string]$MutexName, [string]$Expectation)
$mutex = [Threading.Mutex]::new($false, $MutexName)
$acquired = $false
try {
    try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
    if (($Expectation -eq 'available') -eq $acquired) { exit 0 }
    exit 1
} finally {
    if ($acquired) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
'@ | Set-Content -LiteralPath $mutexProbe -Encoding UTF8
    $inventoryName = 'Global\SpareMvpBindingInventoryTest_' + [Guid]::NewGuid().ToString('N')
    $inventoryMutex = Acquire-SharedDataMutex -MutexName $inventoryName
    try {
        $blockedProbe = Start-Process -FilePath $powerShellExe -ArgumentList @(
            '-NoProfile', '-File', $mutexProbe, '-MutexName', $inventoryName, '-Expectation', 'blocked'
        ) -Wait -PassThru -WindowStyle Hidden
        Assert-True ($blockedProbe.ExitCode -eq 0) 'Binding inventory mutex did not exclude a concurrent process'
    } finally {
        Release-SharedDataMutex -Mutex $inventoryMutex
    }
    $availableProbe = Start-Process -FilePath $powerShellExe -ArgumentList @(
        '-NoProfile', '-File', $mutexProbe, '-MutexName', $inventoryName, '-Expectation', 'available'
    ) -Wait -PassThru -WindowStyle Hidden
    Assert-True ($availableProbe.ExitCode -eq 0) 'Binding inventory mutex remained unavailable after release'
    Write-Output "Portable ownership tests passed: $assertions assertions. No real processes were stopped."
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force
}
