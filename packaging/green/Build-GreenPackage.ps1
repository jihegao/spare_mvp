[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$PortablePackage,
    [Parameter(Mandatory=$true)][string]$DesktopDirectory,
    [Parameter(Mandatory=$true)][string]$Destination
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$portable = (Resolve-Path -LiteralPath $PortablePackage).Path
$desktop = (Resolve-Path -LiteralPath $DesktopDirectory).Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$boundFiles = @(
    'desktop/main.mjs', 'desktop/preload.cjs', 'desktop/service-manager.mjs',
    'desktop/diagnostics.mjs', 'desktop/renderer/app.mjs', 'desktop/renderer/index.html',
    'desktop/renderer/styles.css', 'desktop/package.json', 'desktop/package-lock.json',
    'packaging/green/GreenExtractor.cs', 'packaging/green/Build-GreenPackage.ps1',
    'docs/windows-desktop-rc1.md'
)
if (Test-Path -LiteralPath $destinationPath) { throw "Destination already exists: $destinationPath" }
foreach ($required in @(
    (Join-Path $portable 'runtime\python.exe'),
    (Join-Path $portable 'scripts\portable-package.py'),
    (Join-Path $desktop 'resources\app.asar')
)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required green-package input is missing: $required" }
}

$working = Join-Path ([IO.Path]::GetTempPath()) ('spare-green-' + [Guid]::NewGuid().ToString('N'))
$staging = Join-Path $working 'staging'
$payload = Join-Path $working 'payload.tar'
$stub = Join-Path $working 'green-stub.exe'
try {
    New-Item -ItemType Directory -Path $staging | Out-Null
    Copy-Item -Path (Join-Path $portable '*') -Destination $staging -Recurse
    Copy-Item -Path (Join-Path $desktop '*') -Destination $staging -Recurse -Force
    $desktopExecutable = Get-ChildItem -LiteralPath $staging -Filter '*.exe' -File |
        Where-Object { $_.Name -ne 'SpareMvpDesktop.exe' } | Select-Object -First 1
    if ($null -eq $desktopExecutable) { throw 'Desktop executable was not found.' }
    Move-Item -LiteralPath $desktopExecutable.FullName -Destination (Join-Path $staging 'SpareMvpDesktop.exe') -Force

    & git -C $repo diff --quiet HEAD -- @boundFiles
    if ($LASTEXITCODE -ne 0) { throw 'Green desktop source differs from HEAD; commit the candidate before packaging.' }
    $sourceCommit = (& git -C $repo rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch '^[a-f0-9]{40}$') { throw 'Could not determine the green desktop source commit.' }
    $sourceHashes = [ordered]@{}
    foreach ($name in $boundFiles) {
        $sourcePath = Join-Path $repo $name
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Bound green source is missing: $name" }
        $sourceHashes[$name.Replace('\', '/')] = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [ordered]@{
        format_version = 1
        source_commit = $sourceCommit
        files = $sourceHashes
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $staging 'green-source-manifest.json') -Encoding UTF8

    & (Join-Path $staging 'runtime\python.exe') -I -B (Join-Path $staging 'scripts\portable-package.py') seal --root $staging
    if ($LASTEXITCODE -ne 0) { throw 'Green package sealing failed.' }
    & (Join-Path $staging 'runtime\python.exe') -I -B (Join-Path $staging 'scripts\portable-package.py') verify --root $staging
    if ($LASTEXITCODE -ne 0) { throw 'Green package verification failed.' }

    & tar.exe -cf $payload -C $staging .
    if ($LASTEXITCODE -ne 0) { throw 'Payload archive creation failed.' }
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw "C# compiler is unavailable: $compiler" }
    $source = Join-Path $PSScriptRoot 'GreenExtractor.cs'
    & $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /out:$stub $source
    if ($LASTEXITCODE -ne 0) { throw 'Green extractor compilation failed.' }

    $payloadInfo = Get-Item -LiteralPath $payload
    $payloadHash = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash
    $output = [IO.File]::Open($destinationPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
    try {
        foreach ($part in @($stub, $payload)) {
            $input = [IO.File]::OpenRead($part)
            try { $input.CopyTo($output) } finally { $input.Dispose() }
        }
        $hashBytes = New-Object byte[] 32
        for ($index = 0; $index -lt 32; $index++) { $hashBytes[$index] = [Convert]::ToByte($payloadHash.Substring($index * 2, 2), 16) }
        $output.Write($hashBytes, 0, $hashBytes.Length)
        $lengthBytes = [BitConverter]::GetBytes([Int64]$payloadInfo.Length)
        $output.Write($lengthBytes, 0, $lengthBytes.Length)
        $magicBytes = [Text.Encoding]::ASCII.GetBytes('SPAREPKG')
        $output.Write($magicBytes, 0, $magicBytes.Length)
    } finally { $output.Dispose() }

    [ordered]@{
        format_version = 1
        product = 'spare_mvp 2.0 green'
        executable = [IO.Path]::GetFileName($destinationPath)
        bytes = (Get-Item -LiteralPath $destinationPath).Length
        sha256 = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash.ToLowerInvariant()
        payload_bytes = $payloadInfo.Length
        payload_sha256 = $payloadHash.ToLowerInvariant()
        built_at_utc = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath ($destinationPath + '.manifest.json') -Encoding UTF8
    Write-Output "Built green self-extractor: $destinationPath"
} finally {
    if (Test-Path -LiteralPath $working) { Remove-Item -LiteralPath $working -Recurse -Force }
}
