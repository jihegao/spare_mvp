[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$RuntimeSource,
    [Parameter(Mandatory=$true)][string]$Destination,
    [string]$DependencyBundle,
    [string]$FrontendAssets,
    [string]$SourceManifest,
    [string]$ProjectFile,
    [string]$ExperimentConfig
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($ExperimentConfig -and -not $ProjectFile) { throw 'ExperimentConfig requires ProjectFile.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = (Resolve-Path -LiteralPath $RuntimeSource).Path
$python = Join-Path $runtime 'python.exe'
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination must not exist; existing packages are never overwritten.' }
if (-not (Test-Path -LiteralPath $python)) { throw 'RuntimeSource must contain the prepared Windows Python runtime.' }
if ($destinationPath.StartsWith($runtime + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination must be outside RuntimeSource.' }
if (-not $DependencyBundle) { $DependencyBundle = Split-Path -Parent $runtime }
$bundle = (Resolve-Path -LiteralPath $DependencyBundle).Path
if (-not $FrontendAssets) { $FrontendAssets = Join-Path $bundle 'solara-cdn' }
$frontend = (Resolve-Path -LiteralPath $FrontendAssets).Path
& $python -I -B (Join-Path $PSScriptRoot 'prepare-solara-assets.py') --destination $frontend --verify
if ($LASTEXITCODE -ne 0) { throw 'Solara frontend assets differ from the reviewed lock.' }
foreach ($name in @('windows-runtime.json','requirements-windows.lock','installed-distributions.json','runtime-manifest.json','wheelhouse','downloads')) {
    if (-not (Test-Path -LiteralPath (Join-Path $bundle $name))) { throw "Prepared dependency bundle is missing: $name" }
}
foreach ($name in @('windows-runtime.json','requirements-windows.lock')) {
    if ((Get-FileHash -LiteralPath (Join-Path $bundle $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $repo ('packaging\' + $name))).Hash) {
        throw "Dependency bundle does not match the reviewed lock: $name"
    }
}
& $python -I -B (Join-Path $PSScriptRoot 'portable-package.py') verify-runtime --root $bundle --runtime-source $runtime
if ($LASTEXITCODE -ne 0) { throw 'Runtime or wheelhouse differs from the reviewed lock.' }
& $python -I -B -m pip --isolated check
if ($LASTEXITCODE -ne 0) { throw 'Runtime dependencies failed pip check.' }
$sourceArguments = @()
if ($SourceManifest) { $sourceArguments = @('--source-manifest', (Resolve-Path -LiteralPath $SourceManifest).Path) }
& $python -I -B (Join-Path $PSScriptRoot 'portable-package.py') stage --repo $repo --root $destinationPath @sourceArguments
if ($LASTEXITCODE -ne 0) { throw 'Allowlisted application staging failed.' }
Copy-Item -LiteralPath $runtime -Destination (Join-Path $destinationPath 'runtime') -Recurse
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'assets') | Out-Null
Copy-Item -LiteralPath (Join-Path $repo 'packaging\solara-assets.lock.json') -Destination (Join-Path $destinationPath 'assets\solara-assets.lock.json')
& $python -I -B (Join-Path $PSScriptRoot 'prepare-solara-assets.py') --destination (Join-Path $destinationPath 'assets\solara-cdn') --offline-source $frontend
if ($LASTEXITCODE -ne 0) { throw 'Offline Solara asset copying failed.' }
# Copy verified content unchanged; seal rechecks it against the prepared manifest.
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'dependencies') | Out-Null
foreach ($name in @('windows-runtime.json','requirements-windows.lock','installed-distributions.json','runtime-manifest.json','wheelhouse','downloads')) {
    Copy-Item -LiteralPath (Join-Path $bundle $name) -Destination (Join-Path $destinationPath 'dependencies') -Recurse
}
$caseArguments = @()
if ($ProjectFile) { $caseArguments += @('--project', (Resolve-Path -LiteralPath $ProjectFile).Path) }
if ($ExperimentConfig) { $caseArguments += @('--experiment-config', (Resolve-Path -LiteralPath $ExperimentConfig).Path) }
& (Join-Path $destinationPath 'runtime\python.exe') -I -B -X utf8 (Join-Path $destinationPath 'scripts\initialize-case-database.py') --database (Join-Path $destinationPath 'data/spare_mvp.sqlite3') @caseArguments
if ($LASTEXITCODE -ne 0) { throw 'Fixture database initialization failed.' }
& $python -I -B (Join-Path $PSScriptRoot 'portable-package.py') seal --root $destinationPath
if ($LASTEXITCODE -ne 0) { throw 'Package sealing failed.' }
& $python -I -B (Join-Path $PSScriptRoot 'portable-package.py') verify --root $destinationPath
if ($LASTEXITCODE -ne 0) { throw 'Package integrity verification failed.' }
Write-Output "Built portable package: $destinationPath"
