[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'portable-process.ps1')
$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PidRoot = Join-Path $PackageRoot 'data\pids'
$Python = Join-Path $PackageRoot 'runtime\python.exe'
$stoppingFailed = $false

foreach ($name in @('solara', 'backend')) {
    $pidPath = Join-Path $PidRoot "$name.pid"
    try {
        $process = Get-OwnedPortableProcess -Name $name -Python $Python -PidPath $pidPath
        if ($null -ne $process) {
            Stop-Process -InputObject $process -Force
            Remove-PortableProcessRecord -PidPath $pidPath
            Write-Output "Stopped $name service."
        }
    } catch {
        $stoppingFailed = $true
        Write-Warning "Could not safely stop $name service: $($_.Exception.Message)"
    }
}
if (-not (Test-Path (Join-Path $PidRoot 'backend.pid')) -and -not (Test-Path (Join-Path $PidRoot 'solara.pid'))) {
    Remove-Item -LiteralPath (Join-Path $PackageRoot 'data\active-ports.json') -Force -ErrorAction SilentlyContinue
}
if ($stoppingFailed) { throw 'One or more services could not be stopped with verified ownership.' }
