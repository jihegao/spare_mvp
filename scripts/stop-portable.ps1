[CmdletBinding()]
param(
    [string]$DataRoot = '',
    [switch]$CheckOwnershipOnly,
    [switch]$RemoveInstanceState,
    [switch]$DeleteSharedData
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'portable-process.ps1')
$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Python = Join-Path $PackageRoot 'runtime\python.exe'
$PathResolver = Join-Path $PSScriptRoot 'portable-paths.py'
$pathArguments = @('-I', '-B', $PathResolver, '--package-root', $PackageRoot)
if (-not [string]::IsNullOrWhiteSpace($DataRoot)) { $pathArguments += @('--data-root', $DataRoot) }
$pathJson = & $Python @pathArguments
if ($LASTEXITCODE -ne 0) { throw 'Portable path resolution failed; no process or data was changed.' }
$Paths = $pathJson | ConvertFrom-Json
$PidRoot = [string]$Paths.pid_root
$stoppingFailed = $false

if ($CheckOwnershipOnly) {
    foreach ($name in @('backend', 'solara')) {
        $pidPath = Join-Path $PidRoot "$name.pid"
        $process = Get-OwnedPortableProcess -Name $name -Python $Python -PidPath $pidPath `
            -InstallationId ([string]$Paths.installation_id)
        if ($null -eq $process) { throw "$name service ownership could not be verified." }
    }
    Write-Output 'Both portable services belong to this installation.'
    return
}

$instanceMutex = Acquire-SharedDataMutex -MutexName ([string]$Paths.startup_mutex) `
    -BusyMessage 'This installation is still starting or stopping. No process was changed.'
try {

foreach ($name in @('solara', 'backend')) {
    $pidPath = Join-Path $PidRoot "$name.pid"
    try {
        $process = Get-OwnedPortableProcess -Name $name -Python $Python -PidPath $pidPath `
            -InstallationId ([string]$Paths.installation_id)
        if ($null -ne $process) {
            Stop-Process -InputObject $process -Force
            if (-not $process.WaitForExit(10000)) {
                throw "$name service did not exit after it was stopped; ownership records were retained."
            }
            Remove-PortableProcessRecord -PidPath $pidPath
            Write-Output "Stopped $name service."
        }
    } catch {
        $stoppingFailed = $true
        Write-Warning "Could not safely stop $name service: $($_.Exception.Message)"
    }
}
if ($stoppingFailed) { throw 'One or more services could not be stopped with verified ownership.' }

if (-not (Test-Path (Join-Path $PidRoot 'backend.pid')) -and -not (Test-Path (Join-Path $PidRoot 'solara.pid'))) {
    Remove-Item -LiteralPath ([string]$Paths.state_file) -Force -ErrorAction SilentlyContinue
}

$sharedMutex = $null
try {
    if ($DeleteSharedData) {
        # The writer process has stopped. The same mutex serializes the final
        # binding scan with deletion, so another installation cannot bind or
        # open this data root between the check and removal.
        $sharedMutex = Acquire-SharedDataMutex -MutexName ([string]$Paths.data_mutex)
        $pathJson = & $Python -I -B $PathResolver --package-root $PackageRoot --data-root ([string]$Paths.data_root)
        if ($LASTEXITCODE -ne 0) { throw 'Could not revalidate shared-data bindings before deletion.' }
        $deletePaths = $pathJson | ConvertFrom-Json
        if (-not [bool]$deletePaths.binding_matches_selected) {
            throw 'The selected user-data root is not the current installation binding; it was retained.'
        }
        if (@($deletePaths.binding_scan_errors).Count -ne 0) {
            throw 'Shared-data binding inventory contains unreadable records; user data was retained.'
        }
        if (@($deletePaths.other_bindings).Count -ne 0) {
            $owners = @($deletePaths.other_bindings | ForEach-Object { $_.installation_id }) -join ', '
            throw "User data remains bound to other installations ($owners); it was retained."
        }
        if (Test-Path -LiteralPath ([string]$deletePaths.data_root)) {
            Remove-Item -LiteralPath ([string]$deletePaths.data_root) -Recurse -Force
        }
        Write-Output "Deleted explicitly confirmed user data: $($deletePaths.data_root)"
    }

    if ($RemoveInstanceState -and (Test-Path -LiteralPath ([string]$Paths.instance_root))) {
        Remove-Item -LiteralPath ([string]$Paths.instance_root) -Recurse -Force
    }
    if (Test-Path -LiteralPath ([string]$Paths.data_lock)) {
        try {
            $metadata = Get-Content -LiteralPath ([string]$Paths.data_lock) -Raw | ConvertFrom-Json
            if ($metadata.installation_id -eq [string]$Paths.installation_id) {
                Remove-Item -LiteralPath ([string]$Paths.data_lock) -Force
            }
        } catch {
            Write-Warning 'Shared writer metadata was unreadable and was retained; the named mutex remains authoritative.'
        }
    }
} finally {
    if ($null -ne $sharedMutex) { Release-SharedDataMutex -Mutex $sharedMutex }
}
} finally {
    if ($null -ne $instanceMutex) { Release-SharedDataMutex -Mutex $instanceMutex }
}
