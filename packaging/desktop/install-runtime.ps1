[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$AppExecutable,
    [switch]$Resume
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$DockerInstaller = Join-Path $PSScriptRoot 'Docker Desktop Installer.exe'
$WslInstaller = Join-Path $PSScriptRoot 'wsl.msi'
$StateRoot = Join-Path $env:ProgramData 'SpareMvpDesktop'
$StateFile = Join-Path $StateRoot 'install-state.json'

function Write-State {
    param([string]$Status, [string]$Message)
    New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
    [ordered]@{
        format_version = 1
        status = $Status
        message = $Message
        updated_at = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

trap {
    try { Write-State -Status 'failed' -Message $_.Exception.Message } catch {}
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Runtime installation requires administrator approval.'
    }
}

function Invoke-CheckedProcess {
    param([string]$FilePath, [string[]]$Arguments, [int[]]$AllowedExitCodes = @(0, 3010))
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -notin $AllowedExitCodes) {
        throw "$FilePath failed with exit code $($process.ExitCode)."
    }
    return $process.ExitCode
}

function Get-DockerDesktopPath {
    foreach ($candidate in @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Set-ResumeAfterLogon {
    $command = '"' + $AppExecutable.Replace('"', '""') + '" --resume-install'
    New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' `
        -Name 'SpareMvpDesktopResume' -PropertyType String -Value $command -Force | Out-Null
}

function Test-RebootPending {
    $featureNames = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')
    foreach ($featureName in $featureNames) {
        $feature = Get-WindowsOptionalFeature -Online -FeatureName $featureName
        if ($feature.State -eq 'EnablePending') { return $true }
    }
    return Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending'
}

Write-State -Status 'starting' -Message 'Runtime installer started.'
Assert-Administrator
foreach ($required in @($DockerInstaller, $WslInstaller, $AppExecutable)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Required installation resource is missing: $required"
    }
}

Write-State -Status 'enabling_windows_features' -Message 'Enabling Windows features required by WSL2.'
$wslFeatureExit = Invoke-CheckedProcess -FilePath 'dism.exe' -Arguments @('/online','/enable-feature','/featurename:Microsoft-Windows-Subsystem-Linux','/all','/norestart')
$vmFeatureExit = Invoke-CheckedProcess -FilePath 'dism.exe' -Arguments @('/online','/enable-feature','/featurename:VirtualMachinePlatform','/all','/norestart')

Write-State -Status 'installing_wsl' -Message 'Installing the offline WSL runtime.'
$wslExit = Invoke-CheckedProcess -FilePath 'msiexec.exe' -Arguments @('/i', $WslInstaller, '/qn', '/norestart')

if ((3010 -in @($wslFeatureExit, $vmFeatureExit, $wslExit)) -or (Test-RebootPending)) {
    Set-ResumeAfterLogon
    Write-State -Status 'reboot_required' -Message 'Windows must restart before runtime installation can continue.'
    shutdown.exe /r /t 60 /c 'spare_mvp Desktop runtime installation requires a restart.'
    exit 0
}

if (-not (Get-DockerDesktopPath)) {
    Write-State -Status 'installing_docker' -Message 'Installing Docker Desktop.'
    # Docker's license acceptance remains an explicit first-start user action.
    Invoke-CheckedProcess -FilePath $DockerInstaller -Arguments @('install','--user','--backend=wsl-2','--no-windows-containers') -AllowedExitCodes @(0, 3010) | Out-Null
}

Write-State -Status 'docker_first_start_required' -Message 'Start Docker Desktop and complete its first-run license confirmation.'
$dockerDesktop = Get-DockerDesktopPath
if ($dockerDesktop) {
    Start-Process -FilePath $dockerDesktop
}
