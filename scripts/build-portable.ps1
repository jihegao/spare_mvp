[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$RuntimeSource,
    [Parameter(Mandatory=$true)][string]$Destination,
    [string]$DependencyBundle,
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
foreach ($name in @('windows-runtime.json','requirements-windows.lock','installed-distributions.json','wheelhouse','downloads')) {
    if (-not (Test-Path -LiteralPath (Join-Path $bundle $name))) { throw "Prepared dependency bundle is missing: $name" }
}
foreach ($name in @('windows-runtime.json','requirements-windows.lock')) {
    if ((Get-FileHash -LiteralPath (Join-Path $bundle $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $repo ('packaging\' + $name))).Hash) {
        throw "Dependency bundle does not match the reviewed lock: $name"
    }
}
& $python -I -m pip --isolated check
if ($LASTEXITCODE -ne 0) { throw 'Runtime dependencies failed pip check.' }
& $python -I (Join-Path $PSScriptRoot 'portable-package.py') verify-runtime --root $bundle
if ($LASTEXITCODE -ne 0) { throw 'Runtime or wheelhouse differs from the reviewed lock.' }
$sourceArguments = @()
if ($SourceManifest) { $sourceArguments = @('--source-manifest', (Resolve-Path -LiteralPath $SourceManifest).Path) }
& $python -I (Join-Path $PSScriptRoot 'portable-package.py') stage --repo $repo --root $destinationPath @sourceArguments
if ($LASTEXITCODE -ne 0) { throw 'Allowlisted application staging failed.' }
Copy-Item -LiteralPath $runtime -Destination (Join-Path $destinationPath 'runtime') -Recurse
# Bytecode and user caches are not part of the sealed runtime.
Get-ChildItem -LiteralPath (Join-Path $destinationPath 'runtime') -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'dependencies') | Out-Null
foreach ($name in @('windows-runtime.json','requirements-windows.lock','installed-distributions.json','wheelhouse','downloads')) {
    Copy-Item -LiteralPath (Join-Path $bundle $name) -Destination (Join-Path $destinationPath 'dependencies') -Recurse
}
$caseArguments = @()
if ($ProjectFile) { $caseArguments += @('--project', (Resolve-Path -LiteralPath $ProjectFile).Path) }
if ($ExperimentConfig) { $caseArguments += @('--experiment-config', (Resolve-Path -LiteralPath $ExperimentConfig).Path) }
& (Join-Path $destinationPath 'runtime\python.exe') -I -B -X utf8 (Join-Path $PSScriptRoot 'initialize-case-database.py') --database (Join-Path $destinationPath 'data/spare_mvp.sqlite3') @caseArguments
if ($LASTEXITCODE -ne 0) { throw 'Fixture database initialization failed.' }
& $python -I (Join-Path $PSScriptRoot 'portable-package.py') seal --root $destinationPath
if ($LASTEXITCODE -ne 0) { throw 'Package sealing failed.' }
& $python -I (Join-Path $PSScriptRoot 'portable-package.py') verify --root $destinationPath
if ($LASTEXITCODE -ne 0) { throw 'Package integrity verification failed.' }
Write-Output "Built portable package: $destinationPath"
