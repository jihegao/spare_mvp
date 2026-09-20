[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$BackendPort = 4173,
    [ValidateRange(1024, 65535)]
    [int]$SolaraPort = 8765,
    [switch]$AutoSelectPorts,
    [switch]$CheckPortsOnly,
    [switch]$NoBrowser,
    [string]$DataRoot = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'portable-process.ps1')

$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RuntimeRoot = Join-Path $PackageRoot 'runtime'
$ApplicationRoot = Join-Path $PackageRoot 'app'
$Python = Join-Path $RuntimeRoot 'python.exe'
$PathResolver = Join-Path $PSScriptRoot 'portable-paths.py'
$DataManager = Join-Path $PSScriptRoot 'portable-data.py'
$DataGuard = Join-Path $PSScriptRoot 'portable-data-guard.py'
$pathArguments = @('-I', '-B', $PathResolver, '--package-root', $PackageRoot)
if (-not [string]::IsNullOrWhiteSpace($DataRoot)) { $pathArguments += @('--data-root', $DataRoot) }
$pathJson = & $Python @pathArguments
if ($LASTEXITCODE -ne 0) { throw 'Portable path resolution failed.' }
$Paths = $pathJson | ConvertFrom-Json
$DataRoot = [string]$Paths.data_root
$Database = [string]$Paths.database
$InstanceRoot = [string]$Paths.instance_root
$LogRoot = [string]$Paths.logs_dir
$PidRoot = [string]$Paths.pid_root
$OutputRoot = [string]$Paths.output_root
$DataLockPath = [string]$Paths.data_lock
$FrontendModuleTest = Join-Path $PSScriptRoot 'test-frontend-modules.ps1'
$SolaraAssetCache = Join-Path $PackageRoot 'assets\solara-cdn'
$StartupErrorLog = Join-Path $LogRoot 'startup-error.log'
$ActivePortsFile = [string]$Paths.state_file
$LegacyDataRoot = Join-Path $PackageRoot 'data'
$LegacyDatabase = Join-Path $LegacyDataRoot 'spare_mvp.sqlite3'

foreach ($requiredPath in @($Python, $ApplicationRoot, $PathResolver, $DataManager, $DataGuard, $LegacyDatabase)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Portable package is incomplete. Missing: $requiredPath"
    }
}
foreach ($directory in @($InstanceRoot, $LogRoot, $PidRoot, [string]$Paths.matplotlib_root)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}
Remove-Item -LiteralPath $StartupErrorLog -Force -ErrorAction SilentlyContinue

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
    $instanceToken = [Guid]::NewGuid().ToString('N')
    $ownedArguments = @('-B', '-X', "spare_mvp_instance=$instanceToken") + $Arguments
    $process = Start-Process -FilePath $Python `
        -ArgumentList (Join-ProcessArguments $ownedArguments) `
        -WorkingDirectory $ApplicationRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $outLog `
        -RedirectStandardError $errLog `
        -PassThru
    try {
        Write-PortableProcessRecord -Process $process -Name $Name -Python $Python -PidPath $PidPath `
            -InstanceToken $instanceToken -InstallationId ([string]$Paths.installation_id)
    } catch {
        if (-not $process.HasExited) { Stop-Process -InputObject $process -Force }
        Remove-PortableProcessRecord -PidPath $PidPath
        throw
    }
    return [pscustomobject]@{ Process = $process; InstanceToken = $instanceToken }
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
$startupMutex = $null
$sharedDataMutex = $null
$activePortsWritten = $false
$activePortsTemporary = "$ActivePortsFile.tmp-$PID"
try {
    $startupMutex = Acquire-SharedDataMutex -MutexName ([string]$Paths.startup_mutex) `
        -BusyMessage 'This installation is already starting or stopping. No process was changed.'
    if ($null -ne (Get-OwnedPortableProcess -Name 'backend' -Python $Python -PidPath $backendPidPath -InstallationId ([string]$Paths.installation_id)) -or
        $null -ne (Get-OwnedPortableProcess -Name 'solara' -Python $Python -PidPath $solaraPidPath -InstallationId ([string]$Paths.installation_id))) {
        throw 'The portable platform is already running. Run Stop-Platform.cmd before starting it again.'
    }
    $legacyEntries = @(Get-ChildItem -LiteralPath $LegacyDataRoot -Force)
    $legacyWasUsed = $null -ne ($legacyEntries |
        Where-Object { $_.Name -notin @('spare_mvp.sqlite3', 'spare_mvp.sqlite3-wal', 'spare_mvp.sqlite3-shm') } |
        Select-Object -First 1)
    $legacyHasDurableFiles = $null -ne ($legacyEntries |
        Where-Object { $_.Name -notin @(
            'spare_mvp.sqlite3', 'spare_mvp.sqlite3-wal', 'spare_mvp.sqlite3-shm',
            'active-ports.json', 'integrity-cache.json', 'pids', 'logs', 'matplotlib', 'diagnostics'
        ) } |
        Select-Object -First 1)
    # A pre-#381 instance used package-local PID records. Stop only processes
    # proven to belong to this package before backing up its SQLite database.
    $legacyPidRoot = Join-Path $LegacyDataRoot 'pids'
    if ((Test-Path -LiteralPath $legacyPidRoot) -and $legacyPidRoot -ine $PidRoot) {
        foreach ($legacyName in @('solara', 'backend')) {
            $legacyPidPath = Join-Path $legacyPidRoot "$legacyName.pid"
            $legacyProcess = Get-OwnedPortableProcess -Name $legacyName -Python $Python -PidPath $legacyPidPath
            if ($null -ne $legacyProcess) {
                Stop-Process -InputObject $legacyProcess -Force
                if (-not $legacyProcess.WaitForExit(10000)) {
                    throw "Legacy $legacyName service did not exit; migration was not started."
                }
                Remove-PortableProcessRecord -PidPath $legacyPidPath
            }
        }
        Remove-Item -LiteralPath (Join-Path $LegacyDataRoot 'active-ports.json') -Force -ErrorAction SilentlyContinue
    }

    $sharedDataMutex = Acquire-SharedDataMutex -MutexName ([string]$Paths.data_mutex)
    $migrationArguments = @(
        '-I', '-B', $DataManager, 'migrate',
        '--source', $LegacyDatabase,
        '--destination', $Database,
        '--status-file', (Join-Path $InstanceRoot 'data-migration.json'),
        '--recovery-backup-root', (Join-Path $DataRoot 'migration-backups')
    )
    if ([bool]$Paths.binding_matches_selected) {
        $migrationArguments += '--allow-existing'
    } elseif (Test-Path -LiteralPath $Database -PathType Leaf) {
        $migrationArguments += @('--allow-existing', '--preserve-source-before-reuse')
        if ($legacyWasUsed) { $migrationArguments += '--conflict-after-source-backup' }
    }
    & $Python @migrationArguments
    if ($LASTEXITCODE -ne 0) { throw 'Portable user database migration or validation failed.' }
    if (-not [bool]$Paths.binding_matches_selected -and $legacyHasDurableFiles) {
        & $Python -I -B $DataManager migrate-files `
            --source-root $LegacyDataRoot `
            --destination-root $DataRoot `
            --status-file (Join-Path $InstanceRoot 'durable-files-migration.json')
        if ($LASTEXITCODE -ne 0) { throw 'Portable outputs or user-configuration migration failed.' }
    }
    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
    $bindingArguments = @('-I', '-B', $PathResolver, '--package-root', $PackageRoot, '--data-root', $DataRoot, '--write-binding')
    $pathJson = & $Python @bindingArguments
    if ($LASTEXITCODE -ne 0) { throw 'Portable data-root binding failed after database validation.' }
    $Paths = $pathJson | ConvertFrom-Json
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
    $env:MPLCONFIGDIR = [string]$Paths.matplotlib_root
    & $Python -I -B (Join-Path $PSScriptRoot 'prepare-solara-assets.py') --lock (Join-Path $PackageRoot 'assets\solara-assets.lock.json') --destination $SolaraAssetCache --verify
    if ($LASTEXITCODE -ne 0) { throw 'Solara offline frontend cache is missing or changed.' }
    $env:SOLARA_ASSETS_PROXY = 'true'
    $env:SOLARA_ASSETS_PROXY_CACHE_DIR = $SolaraAssetCache
    # Cache misses must fail locally instead of contacting a public CDN.
    $env:SOLARA_ASSETS_CDN = 'http://127.0.0.1:1/'
    $env:SPARE_MVP_SOLARA_BACKEND_API_BASE = "http://127.0.0.1:$BackendPort/api"

    $backendLaunch = Start-PortableProcess -Name 'backend' -PidPath $backendPidPath -Arguments @(
        $DataGuard,
        '--mutex-name', ([string]$Paths.data_mutex),
        '--module', 'src.spare_mvp_backend.http_server',
        '--host', '127.0.0.1',
        '--port', "$BackendPort",
        '--repo-root', $ApplicationRoot,
        '--database', $Database,
        '--output-dir', $OutputRoot
    )
    $backendProcess = $backendLaunch.Process
    Write-SharedDataWriterMetadata -LockPath $DataLockPath -Process $backendProcess -Python $Python `
        -InstanceToken $backendLaunch.InstanceToken -InstallationId ([string]$Paths.installation_id) `
        -PackageRoot $PackageRoot -DataRoot $DataRoot
    # The guarded backend now waits for this exact named mutex. Releasing the
    # migration holder hands write ownership to whichever backend acquires it;
    # this process still requires its own backend health check before success.
    Release-SharedDataMutex -Mutex $sharedDataMutex
    $sharedDataMutex = $null
    Wait-ForHttp200 -Uri "http://127.0.0.1:$BackendPort/front/" -Process $backendProcess -ServiceName 'Backend service'
    & $FrontendModuleTest `
        -PackageRoot $PackageRoot `
        -BackendPort $BackendPort `
        -ExpectedBackendPid $backendProcess.Id

    $solaraLaunch = Start-PortableProcess -Name 'solara' -PidPath $solaraPidPath -Arguments @(
        '-m', 'solara', 'run', 'src.spare_mvp_abm.aircraft_support_v1.solara_app',
        '--host', '127.0.0.1',
        '--port', "$SolaraPort",
        '--production',
        '--no-open'
    )
    $solaraProcess = $solaraLaunch.Process
    Wait-ForHttp200 -Uri "http://127.0.0.1:$SolaraPort/" -Process $solaraProcess -ServiceName 'Solara visualization service'

    $solaraBaseUri = "http://127.0.0.1:$SolaraPort"
    $encodedSolaraBaseUri = [Uri]::EscapeDataString($solaraBaseUri)
    $frontendUri = "http://127.0.0.1:$BackendPort/front/?solaraUrl=$encodedSolaraBaseUri"
    [ordered]@{
        format_version = 2
        installation_id = [string]$Paths.installation_id
        package_root = $PackageRoot
        data_root = $DataRoot
        backend_port = $BackendPort
        solara_port = $SolaraPort
        backend_pid = $backendProcess.Id
        solara_pid = $solaraProcess.Id
        frontend_url = $frontendUri
        solara_url = $solaraBaseUri
    } | ConvertTo-Json | Set-Content -LiteralPath $activePortsTemporary -Encoding UTF8
    Move-Item -LiteralPath $activePortsTemporary -Destination $ActivePortsFile -Force
    $activePortsWritten = $true
    Release-SharedDataMutex -Mutex $startupMutex
    $startupMutex = $null
    Write-Output "Portable platform started: $frontendUri"
    if (-not $NoBrowser) {
        Start-Process $frontendUri
    }
} catch {
    $startupFailure = $_
    Write-StartupFailureLog -Failure $startupFailure
    $solaraStopped = $null -eq $solaraProcess
    $backendStopped = $null -eq $backendProcess
    if ($null -ne $solaraProcess -and -not $solaraProcess.HasExited) {
        Stop-Process -InputObject $solaraProcess -Force
        $solaraStopped = $solaraProcess.WaitForExit(10000)
    } elseif ($null -ne $solaraProcess) {
        $solaraStopped = $true
    }
    if ($null -ne $backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -InputObject $backendProcess -Force
        $backendStopped = $backendProcess.WaitForExit(10000)
    } elseif ($null -ne $backendProcess) {
        $backendStopped = $true
    }
    if ($null -ne $backendProcess -and $backendStopped) {
        Remove-PortableProcessRecord -PidPath $backendPidPath
    }
    if ($null -ne $solaraProcess -and $solaraStopped) {
        Remove-PortableProcessRecord -PidPath $solaraPidPath
    }
    if ($activePortsWritten) {
        Remove-Item -LiteralPath $ActivePortsFile -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $activePortsTemporary -Force -ErrorAction SilentlyContinue
    if ($null -ne $sharedDataMutex) {
        Release-SharedDataMutex -Mutex $sharedDataMutex
        $sharedDataMutex = $null
    }
    if ($null -ne $startupMutex) {
        Release-SharedDataMutex -Mutex $startupMutex
        $startupMutex = $null
    }
    throw "Platform startup failed: $($startupFailure.Exception.Message) Diagnostics: $StartupErrorLog"
}
