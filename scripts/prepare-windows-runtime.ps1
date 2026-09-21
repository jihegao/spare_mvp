[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Destination,
    [string]$OfflineSource
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$specFile = Join-Path $repo 'packaging\windows-runtime.json'
$lockFile = Join-Path $repo 'packaging\requirements-windows.lock'
$spec = Get-Content -LiteralPath $specFile -Raw | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $root) { throw 'Destination must not exist.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows x64 is required.' }
if (-not (Test-Path -LiteralPath $lockFile)) { throw 'Reviewed Windows dependency lock is missing.' }
New-Item -ItemType Directory -Path (Join-Path $root 'downloads') -Force | Out-Null
$archive = Join-Path $root ('downloads\' + $spec.archive)
$wheels = Join-Path $root 'wheelhouse'
if ($OfflineSource) {
    $offline = (Resolve-Path -LiteralPath $OfflineSource).Path
    Copy-Item -LiteralPath (Join-Path $offline ('downloads\' + $spec.archive)) -Destination $archive
    Copy-Item -LiteralPath (Join-Path $offline 'wheelhouse') -Destination $wheels -Recurse
} else {
    & curl.exe --fail --location --retry 2 --connect-timeout 15 --max-time 300 --output $archive $spec.url
    if ($LASTEXITCODE -ne 0) { throw 'Official CPython archive download failed.' }
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $spec.sha256) {
    throw 'CPython archive hash mismatch.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$runtime = Join-Path $root 'runtime'
New-Item -ItemType Directory -Path $runtime | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($entry in $zip.Entries) {
        if (-not $entry.FullName.StartsWith('tools/') -or $entry.FullName.EndsWith('/')) { continue }
        $relative = $entry.FullName.Substring(6).Replace('/', [IO.Path]::DirectorySeparatorChar)
        $target = [IO.Path]::GetFullPath((Join-Path $runtime $relative))
        if (-not $target.StartsWith($runtime + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid runtime archive path.' }
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target)
    }
} finally { $zip.Dispose() }
$python = Join-Path $root 'runtime\python.exe'
& $python -X utf8 -I -B -c 'import sys; assert sys.version_info[:3] == (3,13,15); assert sys.maxsize > 2**32'
if ($LASTEXITCODE -ne 0) { throw 'CPython version or architecture mismatch.' }
if (-not $OfflineSource) {
    & $python -X utf8 -I -B -m pip --isolated download --disable-pip-version-check --no-cache-dir --only-binary=:all: --require-hashes --index-url https://pypi.org/simple --dest $wheels -r $lockFile
    if ($LASTEXITCODE -ne 0) { throw 'Locked wheel download failed.' }
}
# Installing from this point never consults an index or developer cache.
& $python -X utf8 -I -B -m pip --isolated install --no-compile --no-warn-script-location --disable-pip-version-check --no-cache-dir --no-index --only-binary=:all: --require-hashes --find-links $wheels -r $lockFile
if ($LASTEXITCODE -ne 0) { throw 'Offline dependency installation failed.' }
& $python -X utf8 -I -B -m pip --isolated check
if ($LASTEXITCODE -ne 0) { throw 'Installed dependency closure is inconsistent.' }
& $python -X utf8 -I -B -c 'import mesa,solara,numpy,pandas,scipy,matplotlib,openpyxl; print(mesa.__version__)'
if ($LASTEXITCODE -ne 0) { throw 'Scientific dependency import failed.' }
Copy-Item -LiteralPath $specFile -Destination (Join-Path $root 'windows-runtime.json')
Copy-Item -LiteralPath $lockFile -Destination (Join-Path $root 'requirements-windows.lock')
& $python -X utf8 -I -B -m pip --isolated list --format=json --disable-pip-version-check | Set-Content -LiteralPath (Join-Path $root 'installed-distributions.json') -Encoding UTF8
if ($LASTEXITCODE -ne 0) { throw 'Dependency inventory failed.' }
# Only this freshly extracted and installed runtime establishes a baseline.
Get-ChildItem -LiteralPath $runtime -Recurse -Directory -Filter '__pycache__' | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $runtime -Recurse -File | Where-Object { $_.Extension -in @('.pyc', '.pyo') } | Remove-Item -Force
& $python -X utf8 -I -B (Join-Path $PSScriptRoot 'portable-package.py') finalize-runtime --root $root
if ($LASTEXITCODE -ne 0) { throw 'Prepared runtime manifest creation failed.' }
& $python -X utf8 -I -B (Join-Path $PSScriptRoot 'portable-package.py') verify-runtime --root $root --runtime-source $runtime
if ($LASTEXITCODE -ne 0) { throw 'Prepared bundle verification failed.' }
$assetArguments = @()
if ($OfflineSource) { $assetArguments = @('--offline-source', (Join-Path $offline 'solara-cdn')) }
& $python -X utf8 -I -B (Join-Path $PSScriptRoot 'prepare-solara-assets.py') --destination (Join-Path $root 'solara-cdn') @assetArguments
if ($LASTEXITCODE -ne 0) { throw 'Locked Solara frontend asset preparation failed.' }
Write-Output "Prepared isolated Windows runtime and offline wheelhouse: $root"
