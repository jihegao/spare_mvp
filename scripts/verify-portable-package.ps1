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
$python = Join-Path $PackageRoot 'runtime\python.exe'
$verifier = Join-Path $PackageRoot 'scripts\portable-package.py'
$pathResolver = Join-Path $PackageRoot 'scripts\portable-paths.py'
if (
    -not (Test-Path -LiteralPath $startScript) -or
    -not (Test-Path -LiteralPath $stopScript) -or
    -not (Test-Path -LiteralPath $moduleTestScript) -or
    -not (Test-Path -LiteralPath $python) -or
    -not (Test-Path -LiteralPath $verifier) -or
    -not (Test-Path -LiteralPath $pathResolver)
) {
    throw "Not a valid portable package: $PackageRoot"
}

& $python -X utf8 -I -B $verifier verify --root $PackageRoot
if ($LASTEXITCODE -ne 0) { throw 'Package integrity verification failed before startup.' }
& $python -X utf8 -I -B -m pip --isolated check
if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency closure failed.' }
$env:NO_PROXY = '127.0.0.1,localhost'
$pathJson = & $python -X utf8 -I -B $pathResolver --package-root $PackageRoot
if ($LASTEXITCODE -ne 0) { throw 'Portable path resolution failed before startup verification.' }
$Paths = $pathJson | ConvertFrom-Json
$pidRoot = [string]$Paths.pid_root
$evidenceRoot = [string]$Paths.evidence_dir
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$started = $false
try {
    & $startScript -BackendPort $BackendPort -SolaraPort $SolaraPort -NoBrowser
    $started = $true
    $backendPid = [int](Get-Content -LiteralPath (Join-Path $pidRoot 'backend.pid') -Raw)
    & $moduleTestScript -PackageRoot $PackageRoot -BackendPort $BackendPort -ExpectedBackendPid $backendPid
    foreach ($uri in @(
        "http://127.0.0.1:$BackendPort/_spare_mvp/health",
        "http://127.0.0.1:$BackendPort/front/",
        "http://127.0.0.1:$BackendPort/api/projects",
        "http://127.0.0.1:$SolaraPort/",
        "http://127.0.0.1:$SolaraPort/jupyter/nbextensions/jupyter-vue/nodeps.js",
        "http://127.0.0.1:$SolaraPort/jupyter/nbextensions/jupyter-vuetify/nodeps.js",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/@widgetti/solara-vuetify3-app@5.0.2/dist/solara-vuetify-app8.min.js",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/@widgetti/solara-vuetify3-app@5.0.2/dist/692.solara-vuetify-app8.min.js",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/@widgetti/solara-vuetify3-app@5.0.2/dist/fonts.css",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/@widgetti/solara-vuetify3-app@5.0.2/dist/1ab7bbddcdbde1b6f274.woff2",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/font-awesome@4.5.0/css/font-awesome.min.css",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/requirejs@2.3.6/require.js",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/katex@0.16.9/dist/katex.min.js",
        "http://127.0.0.1:$SolaraPort/_solara/cdn/mermaid@10.8.0/dist/mermaid.min.js"
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
