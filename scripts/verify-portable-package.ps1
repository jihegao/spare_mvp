[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot,
    [ValidateRange(1024, 65535)]
    [int]$BackendPort = 14173,
    [ValidateRange(1024, 65535)]
    [int]$SolaraPort = 18765
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = (Resolve-Path $PackageRoot).Path
$startScript = Join-Path $PackageRoot 'scripts\start-portable.ps1'
$stopScript = Join-Path $PackageRoot 'scripts\stop-portable.ps1'
$moduleTestScript = Join-Path $PackageRoot 'scripts\test-frontend-modules.ps1'
if (
    -not (Test-Path -LiteralPath $startScript) -or
    -not (Test-Path -LiteralPath $stopScript) -or
    -not (Test-Path -LiteralPath $moduleTestScript)
) {
    throw "Not a valid portable package: $PackageRoot"
}

try {
    & $startScript -BackendPort $BackendPort -SolaraPort $SolaraPort -NoBrowser
    $backendPid = [int](Get-Content -LiteralPath (Join-Path $PackageRoot 'data\pids\backend.pid') -Raw)
    & $moduleTestScript -PackageRoot $PackageRoot -BackendPort $BackendPort -ExpectedBackendPid $backendPid
    foreach ($uri in @(
        "http://127.0.0.1:$BackendPort/_spare_mvp/health",
        "http://127.0.0.1:$BackendPort/front/",
        "http://127.0.0.1:$BackendPort/api/projects",
        "http://127.0.0.1:$SolaraPort/",
        "http://127.0.0.1:$SolaraPort/jupyter/nbextensions/jupyter-vue/nodeps.js",
        "http://127.0.0.1:$SolaraPort/jupyter/nbextensions/jupyter-vuetify/nodeps.js"
    )) {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -TimeoutSec 10
        if ($response.StatusCode -ne 200) {
            throw "Portable package endpoint did not return HTTP 200: $uri"
        }
    }
    Write-Output 'Portable package offline startup smoke test passed.'
} finally {
    & $stopScript
}
