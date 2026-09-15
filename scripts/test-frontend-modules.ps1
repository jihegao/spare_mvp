[CmdletBinding()]
param(
    [string]$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [ValidateRange(1024, 65535)]
    [int]$BackendPort = 4173,
    [int]$ExpectedBackendPid = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = (Resolve-Path $PackageRoot).Path
$FrontendRoot = Join-Path $PackageRoot 'app\front'
$AllowedModuleMimeTypes = @(
    'application/ecmascript',
    'application/javascript',
    'text/ecmascript',
    'text/javascript'
)

if (-not (Test-Path -LiteralPath $FrontendRoot -PathType Container)) {
    throw "Frontend directory is missing: $FrontendRoot"
}

function Invoke-LocalRequest {
    param([string]$Uri)

    try {
        return Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 15 -Headers @{
            'Cache-Control' = 'no-cache'
        }
    } catch {
        throw "HTTP request failed for $Uri. $($_.Exception.Message)"
    }
}

$baseUri = "http://127.0.0.1:$BackendPort"
$healthUri = "$baseUri/_spare_mvp/health"
$healthResponse = Invoke-LocalRequest -Uri $healthUri
try {
    $health = $healthResponse.Content | ConvertFrom-Json
} catch {
    throw "Port $BackendPort returned HTTP 200 but not the SPARE backend health JSON. Another service may own the port."
}
if ($health.service -ne 'spare-mvp-backend' -or $health.status -ne 'ok') {
    throw "Port $BackendPort is not serving the expected SPARE backend. Another service may own the port."
}
if ($ExpectedBackendPid -gt 0 -and [int]$health.pid -ne $ExpectedBackendPid) {
    throw "Port $BackendPort belongs to backend PID $($health.pid), not the process started now (PID $ExpectedBackendPid)."
}

$moduleFiles = @(Get-ChildItem -LiteralPath $FrontendRoot -File | Where-Object {
    $_.Extension.ToLowerInvariant() -in @('.js', '.mjs')
})
if ($moduleFiles.Count -eq 0) {
    throw "No JavaScript modules were found under $FrontendRoot"
}

$failures = New-Object System.Collections.Generic.List[string]
foreach ($moduleFile in $moduleFiles) {
    $escapedName = [Uri]::EscapeDataString($moduleFile.Name)
    $uri = "$baseUri/front/$escapedName"
    try {
        $response = Invoke-LocalRequest -Uri $uri
        $contentType = [string]$response.Headers['Content-Type']
        $mimeType = ($contentType -split ';', 2)[0].Trim().ToLowerInvariant()
        if ($response.StatusCode -ne 200) {
            $failures.Add("$($moduleFile.Name): HTTP $($response.StatusCode)")
        } elseif ($mimeType -notin $AllowedModuleMimeTypes) {
            $failures.Add("$($moduleFile.Name): Content-Type is '$contentType'")
        } elseif ([string]$response.Headers['X-Content-Type-Options'] -ne 'nosniff') {
            $failures.Add("$($moduleFile.Name): missing X-Content-Type-Options: nosniff")
        }
    } catch {
        $failures.Add("$($moduleFile.Name): $($_.Exception.Message)")
    }
}

if ($failures.Count -gt 0) {
    throw "Frontend module validation failed:`r`n - $($failures -join "`r`n - ")"
}

Write-Output "Frontend module validation passed: PID $($health.pid), $($moduleFiles.Count) module files, JavaScript MIME types correct."
