[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$BackendPort = 4173,
    [ValidateRange(1024, 65535)]
    [int]$SolaraPort = 8765,
    [switch]$AutoSelectPorts,
    [switch]$CheckPortsOnly,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimeRoot = Join-Path $PackageRoot 'runtime'
$ApplicationRoot = Join-Path $PackageRoot 'app'
$DataRoot = Join-Path $PackageRoot 'data'
$Python = Join-Path $RuntimeRoot 'python.exe'
$Database = Join-Path $DataRoot 'spare_mvp.sqlite3'
$LogRoot = Join-Path $DataRoot 'logs'
$PidRoot = Join-Path $DataRoot 'pids'
$OutputRoot = Join-Path $DataRoot 'outputs'
$FrontendModuleTest = Join-Path $PSScriptRoot 'test-frontend-modules.ps1'
$StartupErrorLog = Join-Path $LogRoot 'startup-error.log'
$ActivePortsFile = Join-Path $DataRoot 'active-ports.json'

foreach ($requiredPath in @($Python, $ApplicationRoot, $Database)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Portable package is incomplete. Missing: $requiredPath"
    }
}
foreach ($directory in @($LogRoot, $PidRoot, $OutputRoot, (Join-Path $DataRoot 'matplotlib'))) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
Remove-Item -LiteralPath $StartupErrorLog -Force -ErrorAction SilentlyContinue

function Get-PortableProcess {
    param([string]$PidPath)

    if (-not (Test-Path -LiteralPath $PidPath)) {
        return $null
    }
    $pidText = (Get-Content -LiteralPath $PidPath -Raw).Trim()
    $pidValue = 0
    if (-not [int]::TryParse($pidText, [ref]$pidValue)) {
        Remove-Item -LiteralPath $PidPath -Force
        return $null
    }
    $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        Remove-Item -LiteralPath $PidPath -Force
        return $null
    }
    try {
        $details = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop
        $commandLine = $details.CommandLine
        if ($details.ExecutablePath -ine $Python -or (-not [string]::IsNullOrWhiteSpace($commandLine) -and -not $commandLine.Contains($PackageRoot))) {
            # Windows may reuse a PID recorded by an earlier, crashed launch.
            Remove-Item -LiteralPath $PidPath -Force
            return $null
        }
    } catch {
        # If process inspection is restricted, retain the PID record and fail safely.
    }
    return $process
}

function Join-ProcessArguments {
    param([string[]]$Values)

    return (($Values | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' ')
}

function Start-PortableProcess {
    param(
        [string]$Name,
        [string[]]$Arguments,
        [string]$PidPath
    )

    $outLog = Join-Path $LogRoot "$Name.stdout.log"
    $errLog = Join-Path $LogRoot "$Name.stderr.log"
    $process = Start-Process -FilePath $Python `
        -ArgumentList (Join-ProcessArguments $Arguments) `
        -WorkingDirectory $ApplicationRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -PassThru
    Set-Content -LiteralPath $PidPath -Value $process.Id -NoNewline -Encoding ascii
    return $process
}

function Wait-ForHttp200 {
    param(
        [string]$Uri,
        [System.Diagnostics.Process]$Process,
        [string]$ServiceName
    )

    for ($attempt = 1; $attempt -le 45; $attempt++) {
        if ($Process.HasExited) {
            throw "$ServiceName exited during startup. See $LogRoot."
        }
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                return
            }
        } catch {
            # The local service is still starting.
        }
        Start-Sleep -Seconds 1
    }
    throw "$ServiceName startup timed out. See $LogRoot."
}

function Get-PortOwnerDescription {
    param([int]$Port)

    try {
        $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
            Select-Object -First 1
        if ($null -eq $connection) {
            return 'unknown process'
        }
        $ownerProcess = Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
        if ($null -eq $ownerProcess) {
            return "PID $($connection.OwningProcess)"
        }
        return "$($ownerProcess.ProcessName) (PID $($ownerProcess.Id))"
    } catch {
        return 'unknown process'
    }
}

function Assert-TcpPortAvailable {
    param(
        [int]$Port,
        [string]$ServiceName
    )

    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($null -ne ($listeners | Where-Object { $_.Port -eq $Port } | Select-Object -First 1)) {
        $owner = Get-PortOwnerDescription -Port $Port
        throw "$ServiceName cannot start because TCP port $Port is already occupied by $owner. Stop that process or choose another port."
    }
}

function Test-TcpPortAvailable {
    param(
        [int]$Port,
        [int[]]$ExcludedPorts = @()
    )

    if ($Port -in $ExcludedPorts) {
        return $false
    }
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return $null -eq ($listeners | Where-Object { $_.Port -eq $Port } | Select-Object -First 1)
}

function Resolve-TcpPort {
    param(
        [int]$PreferredPort,
        [string]$ServiceName,
        [bool]$AllowFallback,
        [int[]]$ExcludedPorts = @()
    )

    if (Test-TcpPortAvailable -Port $PreferredPort -ExcludedPorts $ExcludedPorts) {
        return $PreferredPort
    }
    if (-not $AllowFallback) {
        if ($PreferredPort -in $ExcludedPorts) {
            throw "$ServiceName cannot use TCP port $PreferredPort because the other platform service already selected it."
        }
        $owner = Get-PortOwnerDescription -Port $PreferredPort
        throw "$ServiceName cannot start because TCP port $PreferredPort is already occupied by $owner. Stop that process, choose another port, or enable automatic port selection."
    }

    for ($offset = 1; $offset -le 200; $offset++) {
        $candidate = $PreferredPort + $offset
        if ($candidate -gt 65535) {
            $candidate = 1023 + ($candidate - 65535)
        }
        if (Test-TcpPortAvailable -Port $candidate -ExcludedPorts $ExcludedPorts) {
            Write-Host "$ServiceName port $PreferredPort is unavailable; selected port $candidate."
            return $candidate
        }
    }
    throw "$ServiceName could not find a free TCP port near $PreferredPort."
}

if ($CheckPortsOnly) {
    $checkedBackendPort = Resolve-TcpPort `
        -PreferredPort $BackendPort `
        -ServiceName 'Backend service' `
        -AllowFallback ([bool]$AutoSelectPorts)
    $checkedSolaraPort = Resolve-TcpPort `
        -PreferredPort $SolaraPort `
        -ServiceName 'Solara visualization service' `
        -AllowFallback ([bool]$AutoSelectPorts) `
        -ExcludedPorts @($checkedBackendPort)
    [pscustomobject]@{
        backend_port = $checkedBackendPort
        solara_port = $checkedSolaraPort
    }
    return
}

function Write-StartupFailureLog {
    param([System.Management.Automation.ErrorRecord]$Failure)

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add("Time: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))")
    $lines.Add("Package: $PackageRoot")
    $lines.Add("Backend port: $BackendPort")
    $lines.Add("Solara port: $SolaraPort")
    $lines.Add("Error: $($Failure.Exception.Message)")
    foreach ($serviceLogName in @('backend.stderr.log', 'solara.stderr.log')) {
        $serviceLog = Join-Path $LogRoot $serviceLogName
        if (Test-Path -LiteralPath $serviceLog) {
            $lines.Add('')
            $lines.Add("Last lines from ${serviceLogName}:")
            foreach ($logLine in @(Get-Content -LiteralPath $serviceLog -Tail 30 -ErrorAction SilentlyContinue)) {
                $lines.Add([string]$logLine)
            }
        }
    }
    # VBScript reads this log as UTF-16 so Chinese diagnostics remain legible
    # on Windows systems whose legacy code page is not UTF-8.
    Set-Content -LiteralPath $StartupErrorLog -Value $lines -Encoding Unicode
}

$backendPidPath = Join-Path $PidRoot 'backend.pid'
$solaraPidPath = Join-Path $PidRoot 'solara.pid'
$backendProcess = $null
$solaraProcess = $null
$activePortsWritten = $false
try {
    if ($null -ne (Get-PortableProcess $backendPidPath) -or $null -ne (Get-PortableProcess $solaraPidPath)) {
        throw 'The portable platform is already running. Run Stop-Platform.cmd before starting it again.'
    }
    if ($AutoSelectPorts) {
        $BackendPort = Resolve-TcpPort `
            -PreferredPort $BackendPort `
            -ServiceName 'Backend service' `
            -AllowFallback $true
        $SolaraPort = Resolve-TcpPort `
            -PreferredPort $SolaraPort `
            -ServiceName 'Solara visualization service' `
            -AllowFallback $true `
            -ExcludedPorts @($BackendPort)
    } else {
        Assert-TcpPortAvailable -Port $BackendPort -ServiceName 'Backend service'
        if ($SolaraPort -eq $BackendPort) {
            throw 'Backend service and Solara visualization service cannot use the same TCP port.'
        }
        Assert-TcpPortAvailable -Port $SolaraPort -ServiceName 'Solara visualization service'
    }
    if (-not (Test-Path -LiteralPath $FrontendModuleTest -PathType Leaf)) {
        throw "Portable package is incomplete. Missing: $FrontendModuleTest"
    }

    $env:PYTHONNOUSERSITE = '1'
    $env:PYTHONDONTWRITEBYTECODE = '1'
    $env:NO_PROXY = '127.0.0.1,localhost'
    $env:PYTHONHOME = $RuntimeRoot
    $env:PYTHONPATH = $ApplicationRoot
    $env:PATH = "$RuntimeRoot;$RuntimeRoot\Scripts;$env:PATH"
    $env:MPLCONFIGDIR = Join-Path $DataRoot 'matplotlib'
    $env:SPARE_MVP_SOLARA_BACKEND_API_BASE = "http://127.0.0.1:$BackendPort/api"

    $backendProcess = Start-PortableProcess -Name 'backend' -PidPath $backendPidPath -Arguments @(
        '-m', 'src.spare_mvp_backend.http_server',
        '--host', '127.0.0.1',
        '--port', "$BackendPort",
        '--repo-root', $ApplicationRoot,
        '--database', $Database,
        '--output-dir', $OutputRoot
    )
    Wait-ForHttp200 -Uri "http://127.0.0.1:$BackendPort/front/" -Process $backendProcess -ServiceName 'Backend service'
    & $FrontendModuleTest `
        -PackageRoot $PackageRoot `
        -BackendPort $BackendPort `
        -ExpectedBackendPid $backendProcess.Id

    $solaraProcess = Start-PortableProcess -Name 'solara' -PidPath $solaraPidPath -Arguments @(
        '-m', 'solara', 'run', 'src.spare_mvp_abm.aircraft_support_v1.solara_app',
        '--host', '127.0.0.1',
        '--port', "$SolaraPort",
        '--production',
        '--no-open'
    )
    Wait-ForHttp200 -Uri "http://127.0.0.1:$SolaraPort/" -Process $solaraProcess -ServiceName 'Solara visualization service'

    $solaraBaseUri = "http://127.0.0.1:$SolaraPort"
    $encodedSolaraBaseUri = [Uri]::EscapeDataString($solaraBaseUri)
    $frontendUri = "http://127.0.0.1:$BackendPort/front/?solaraUrl=$encodedSolaraBaseUri"
    [ordered]@{
        backend_port = $BackendPort
        solara_port = $SolaraPort
        backend_pid = $backendProcess.Id
        solara_pid = $solaraProcess.Id
        frontend_url = $frontendUri
        solara_url = $solaraBaseUri
    } | ConvertTo-Json | Set-Content -LiteralPath $ActivePortsFile -Encoding UTF8
    $activePortsWritten = $true
    Write-Output "Portable platform started: $frontendUri"
    if (-not $NoBrowser) {
        Start-Process $frontendUri
    }
} catch {
    $startupFailure = $_
    Write-StartupFailureLog -Failure $startupFailure
    if ($null -ne $solaraProcess -and -not $solaraProcess.HasExited) {
        Stop-Process -Id $solaraProcess.Id -Force
    }
    if ($null -ne $backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id -Force
    }
    if ($null -ne $backendProcess) {
        Remove-Item -LiteralPath $backendPidPath -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $solaraProcess) {
        Remove-Item -LiteralPath $solaraPidPath -Force -ErrorAction SilentlyContinue
    }
    if ($activePortsWritten) {
        Remove-Item -LiteralPath $ActivePortsFile -Force -ErrorAction SilentlyContinue
    }
    throw "Platform startup failed: $($startupFailure.Exception.Message) Diagnostics: $StartupErrorLog"
}
