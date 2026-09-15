[CmdletBinding()]
param(
    [string]$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = (Resolve-Path $PackageRoot).Path
$startScript = Join-Path $PackageRoot 'scripts\start-portable.ps1'

function New-EphemeralListener {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    return $listener
}

$backendBlocker = $null
$solaraBlocker = $null
$freePortProbe1 = $null
$freePortProbe2 = $null
try {
    $backendBlocker = New-EphemeralListener
    $solaraBlocker = New-EphemeralListener
    $occupiedBackendPort = [int]$backendBlocker.LocalEndpoint.Port
    $occupiedSolaraPort = [int]$solaraBlocker.LocalEndpoint.Port

    $fallback = & $startScript `
        -BackendPort $occupiedBackendPort `
        -SolaraPort $occupiedSolaraPort `
        -AutoSelectPorts `
        -CheckPortsOnly
    if ($fallback.backend_port -eq $occupiedBackendPort) {
        throw "Backend automatic selection retained occupied port $occupiedBackendPort."
    }
    if ($fallback.solara_port -eq $occupiedSolaraPort) {
        throw "Solara automatic selection retained occupied port $occupiedSolaraPort."
    }
    if ($fallback.backend_port -eq $fallback.solara_port) {
        throw 'Backend and Solara selected the same fallback port.'
    }

    $freePortProbe1 = New-EphemeralListener
    $freePortProbe2 = New-EphemeralListener
    $explicitBackendPort = [int]$freePortProbe1.LocalEndpoint.Port
    $explicitSolaraPort = [int]$freePortProbe2.LocalEndpoint.Port
    $freePortProbe1.Stop()
    $freePortProbe1 = $null
    $freePortProbe2.Stop()
    $freePortProbe2 = $null

    $explicit = & $startScript `
        -BackendPort $explicitBackendPort `
        -SolaraPort $explicitSolaraPort `
        -CheckPortsOnly
    if ($explicit.backend_port -ne $explicitBackendPort -or $explicit.solara_port -ne $explicitSolaraPort) {
        throw 'Explicit free ports were not preserved.'
    }

    $duplicateWasRejected = $false
    try {
        & $startScript `
            -BackendPort $explicitBackendPort `
            -SolaraPort $explicitBackendPort `
            -CheckPortsOnly | Out-Null
    } catch {
        $duplicateWasRejected = $true
    }
    if (-not $duplicateWasRejected) {
        throw 'Strict port selection did not reject duplicate backend and Solara ports.'
    }

    Write-Output 'Portable port-selection tests passed.'
} finally {
    if ($null -ne $freePortProbe2) {
        $freePortProbe2.Stop()
    }
    if ($null -ne $freePortProbe1) {
        $freePortProbe1.Stop()
    }
    if ($null -ne $solaraBlocker) {
        $solaraBlocker.Stop()
    }
    if ($null -ne $backendBlocker) {
        $backendBlocker.Stop()
    }
}
