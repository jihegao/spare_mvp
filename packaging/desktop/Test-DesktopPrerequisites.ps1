[CmdletBinding()]
param(
    [string]$ReleaseDirectory = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FileEvidence {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ present = $false; path = $Path }
    }
    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        present = $true
        path = $item.FullName
        bytes = $item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$systemDrive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
$features = foreach ($name in @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')) {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $name
    [ordered]@{ name = $name; state = [string]$feature.State }
}

$result = [ordered]@{
    format_version = 1
    collected_at = [DateTime]::UtcNow.ToString('o')
    computer_name = $env:COMPUTERNAME
    windows = [ordered]@{
        caption = $os.Caption
        version = $os.Version
        build = $os.BuildNumber
        architecture = $os.OSArchitecture
    }
    hardware = [ordered]@{
        memory_bytes = [uint64]$os.TotalVisibleMemorySize * 1KB
        system_drive_free_bytes = [uint64]$systemDrive.FreeSpace
        virtualization_firmware_enabled = [bool]$cpu.VirtualizationFirmwareEnabled
        second_level_address_translation = [bool]$cpu.SecondLevelAddressTranslationExtensions
    }
    windows_features = $features
    docker_command_present = [bool](Get-Command docker.exe -ErrorAction SilentlyContinue)
    release_files = [ordered]@{
        setup = Get-FileEvidence (Join-Path $ReleaseDirectory 'spare-mvp-2.0-desktop-rc1-setup.exe')
        manifest = Get-FileEvidence (Join-Path $ReleaseDirectory 'release-manifest.json')
    }
}

$result | ConvertTo-Json -Depth 8
