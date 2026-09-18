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

$python = Join-Path $PackageRoot 'runtime\python.exe'
$verifier = Join-Path $PackageRoot 'scripts\portable-package.py'
& $python -I $verifier verify --root $PackageRoot
if ($LASTEXITCODE -ne 0) { throw 'Package integrity verification failed before startup.' }
& $python -I -m pip --isolated check
if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency closure failed.' }
$env:NO_PROXY = '127.0.0.1,localhost'
$evidenceRoot = Join-Path $PackageRoot 'data\evidence'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$started = $false
try {
    & $startScript -BackendPort $BackendPort -SolaraPort $SolaraPort -NoBrowser
    $started = $true
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
    [ordered]@{
        validation_scope = 'startup-and-static-assets-only'
        business_acceptance_complete = $false
        network_disconnected_verified = $false
        source_commit = (Get-Content (Join-Path $PackageRoot 'manifest.json') -Raw | ConvertFrom-Json).source_commit
        checked_at_utc = [DateTime]::UtcNow.ToString('o')
        backend_pid = $backendPid
        backend_port = $BackendPort
        solara_port = $SolaraPort
    } | ConvertTo-Json | Set-Content (Join-Path $evidenceRoot 'startup-smoke.json') -Encoding UTF8
    Write-Output 'Portable startup smoke passed. Browser business flows and disconnected-machine acceptance remain separate.'
} finally {
    if ($started) { & $stopScript }
}
