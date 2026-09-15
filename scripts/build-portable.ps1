[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$RuntimeSource,
    [Parameter(Mandatory=$true)][string]$Destination,
    [string]$ProjectFile,
    [string]$ExperimentConfig
)
$ErrorActionPreference = 'Stop'
if ($ExperimentConfig -and -not $ProjectFile) { throw 'ExperimentConfig requires ProjectFile.' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = (Resolve-Path -LiteralPath $RuntimeSource).Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination must not exist; existing packages are never overwritten.' }
if (-not (Test-Path -LiteralPath (Join-Path $runtime 'python.exe'))) { throw 'RuntimeSource must contain python.exe and installed project dependencies.' }
if ($destinationPath.StartsWith($runtime + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination must be outside RuntimeSource.' }
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'app') -Force | Out-Null
foreach ($folder in @('front','src','contracts','public','exports')) {
    Copy-Item -LiteralPath (Join-Path $repo $folder) -Destination (Join-Path $destinationPath 'app') -Recurse
}
# Never include runtime databases or bytecode from the development checkout.
$unwanted = Get-ChildItem -LiteralPath (Join-Path $destinationPath 'app') -Recurse -File | Where-Object { $_.Extension -in @('.pyc','.sqlite3','.db') }
foreach ($file in $unwanted) { Remove-Item -LiteralPath $file.FullName }
Copy-Item -LiteralPath $runtime -Destination (Join-Path $destinationPath 'runtime') -Recurse
New-Item -ItemType Directory -Path (Join-Path $destinationPath 'scripts') | Out-Null
foreach ($name in @('start-portable.ps1','stop-portable.ps1','test-frontend-modules.ps1','test-port-selection.ps1','verify-portable-package.ps1')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $destinationPath 'scripts')
}
foreach ($name in @('Start-Platform.cmd','Start-Platform.vbs','Stop-Platform.cmd')) {
    Copy-Item -LiteralPath (Join-Path $repo $name) -Destination $destinationPath
}
$caseArguments = @()
if ($ProjectFile) { $caseArguments += @('--project', (Resolve-Path -LiteralPath $ProjectFile).Path) }
if ($ExperimentConfig) { $caseArguments += @('--experiment-config', (Resolve-Path -LiteralPath $ExperimentConfig).Path) }
& (Join-Path $runtime 'python.exe') -B -X utf8 (Join-Path $PSScriptRoot 'initialize-case-database.py') --database (Join-Path $destinationPath 'data/spare_mvp.sqlite3') @caseArguments
if ($LASTEXITCODE -ne 0) { throw 'Case database initialization failed.' }
@{ package_name='SPARE'; created_at_utc=[DateTime]::UtcNow.ToString('o'); source_commit=(git -C $repo rev-parse HEAD); database='data/spare_mvp.sqlite3'; entrypoints=@('Start-Platform.cmd','Start-Platform.vbs','Stop-Platform.cmd') } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destinationPath 'manifest.json') -Encoding UTF8
Write-Output "Built portable package: $destinationPath"
