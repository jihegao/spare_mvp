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

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw '运行环境安装必须获得管理员授权。'
    }
}

function Invoke-CheckedProcess {
    param([string]$FilePath, [string[]]$Arguments, [int[]]$AllowedExitCodes = @(0, 3010))
    $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -PassThru
    if ($process.ExitCode -notin $AllowedExitCodes) {
        throw "$FilePath 安装失败，退出码 $($process.ExitCode)。"
    }
    return $process.ExitCode
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

Assert-Administrator
foreach ($required in @($DockerInstaller, $WslInstaller, $AppExecutable)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "安装资源缺失：$required"
    }
}

Write-State -Status 'enabling_windows_features' -Message '正在启用 WSL2 所需系统组件。'
$wslFeatureExit = Invoke-CheckedProcess -FilePath 'dism.exe' -Arguments @('/online','/enable-feature','/featurename:Microsoft-Windows-Subsystem-Linux','/all','/norestart')
$vmFeatureExit = Invoke-CheckedProcess -FilePath 'dism.exe' -Arguments @('/online','/enable-feature','/featurename:VirtualMachinePlatform','/all','/norestart')

Write-State -Status 'installing_wsl' -Message '正在安装离线 WSL 运行时。'
$wslExit = Invoke-CheckedProcess -FilePath 'msiexec.exe' -Arguments @('/i', $WslInstaller, '/qn', '/norestart')

if ((3010 -in @($wslFeatureExit, $vmFeatureExit, $wslExit)) -or (Test-RebootPending)) {
    Set-ResumeAfterLogon
    Write-State -Status 'reboot_required' -Message '系统组件已启用，重新登录后将继续安装。'
    shutdown.exe /r /t 60 /c 'spare_mvp Desktop 运行环境安装需要重新启动。'
    exit 0
}

if (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe'))) {
    Write-State -Status 'installing_docker' -Message '正在安装 Docker Desktop。'
    # Docker's license acceptance remains an explicit first-start user action.
    Invoke-CheckedProcess -FilePath $DockerInstaller -Arguments @('install','--user','--backend=wsl-2','--no-windows-containers') -AllowedExitCodes @(0, 3010) | Out-Null
}

Write-State -Status 'docker_first_start_required' -Message '请启动 Docker Desktop 并完成首次许可确认。'
$dockerDesktop = Join-Path $env:LOCALAPPDATA 'Programs\Docker\Docker\Docker Desktop.exe'
if (Test-Path -LiteralPath $dockerDesktop) {
    Start-Process -FilePath $dockerDesktop
}
