[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$PidRoot = Join-Path $PackageRoot 'data\pids'

function Stop-RecordedPortableProcess {
    param([string]$Name)

    $pidPath = Join-Path $PidRoot "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidPath)) {
        return
    }
    $pidText = (Get-Content -LiteralPath $pidPath -Raw).Trim()
    $pidValue = 0
    if ([int]::TryParse($pidText, [ref]$pidValue)) {
        $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
        if ($null -ne $process) {
            $commandLine = ''
            $executablePath = ''
            try {
                $details = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction Stop
                $commandLine = $details.CommandLine
                $executablePath = $details.ExecutablePath
            } catch {
                # Unknown ownership must never terminate a process from another environment.
            }
            if ($executablePath -ieq (Join-Path $PackageRoot 'runtime\python.exe') -and -not [string]::IsNullOrWhiteSpace($commandLine) -and $commandLine.Contains($PackageRoot)) {
                Stop-Process -Id $pidValue -Force
                Write-Output "Stopped $Name service."
            } else {
                Write-Warning "PID $pidValue is not owned by this portable package and was not terminated."
            }
        }
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

Stop-RecordedPortableProcess -Name 'solara'
Stop-RecordedPortableProcess -Name 'backend'
Remove-Item -LiteralPath (Join-Path $PackageRoot 'data\active-ports.json') -Force -ErrorAction SilentlyContinue
