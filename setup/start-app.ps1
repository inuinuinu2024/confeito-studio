# Confeito-Studio Startup Script
# Launches backend and frontend as fully detached processes using WMI.
# This ensures child processes survive after this script exits.

# ── Debug logging toggle ──
# Set to $true to enable detailed startup logging (setup/startup-debug.log).
$LOG_ENABLED = $false

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$debugLog = Join-Path $scriptDir "startup-debug.log"

function Write-Log($msg) {
    if ($LOG_ENABLED) { Add-Content -Path $debugLog -Value $msg }
}

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Log "================================================"
Write-Log "Startup at: $timestamp"

# --- Resolve tool paths ---
$uvPath = Join-Path $env:USERPROFILE ".local\bin\uv.exe"
if (-not (Test-Path $uvPath)) {
    $uvCmd = Get-Command uv -ErrorAction SilentlyContinue
    if ($uvCmd) { $uvPath = $uvCmd.Source }
}

$npmCmd = "C:\nvm4w\nodejs\npm.cmd"
if (-not (Test-Path $npmCmd)) {
    $npmSearch = Get-Command npm -ErrorAction SilentlyContinue
    if ($npmSearch) { $npmCmd = $npmSearch.Source -replace '\.ps1$', '.cmd' }
}

Write-Log "uvPath: $uvPath (exists: $(Test-Path $uvPath))"
Write-Log "npmCmd: $npmCmd (exists: $(Test-Path $npmCmd))"

# --- Launch backend using WMI (fully detached) ---
$backendDir = Join-Path $projectRoot "backend"
$backendLogSuffix = if ($LOG_ENABLED) { "> `"" + (Join-Path $scriptDir "backend.log") + "`" 2> `"" + (Join-Path $scriptDir "backend-err.log") + "`"" } else { "> NUL 2>&1" }
$backendCmd = "cmd.exe /c cd /d `"$backendDir`" && `"$uvPath`" run python -m uvicorn src.app.main:app --port 8000 $backendLogSuffix"

try {
    $startup = ([wmiclass]"Win32_ProcessStartup").CreateInstance()
    $startup.ShowWindow = 0 # SW_HIDE
    
    $result = Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList @($backendCmd, $backendDir, $startup)
    $backendPid = $result.ProcessId
    $returnValue = $result.ReturnValue
    Write-Log "Backend WMI Create: ReturnValue=$returnValue PID=$backendPid"
} catch {
    Write-Log "Backend WMI launch FAILED: $_"
}

# --- Launch frontend using WMI (fully detached) ---
$frontendDir = Join-Path $projectRoot "frontend"
$frontendLogSuffix = if ($LOG_ENABLED) { "> `"" + (Join-Path $scriptDir "frontend.log") + "`" 2> `"" + (Join-Path $scriptDir "frontend-err.log") + "`"" } else { "> NUL 2>&1" }
$frontendCmd = "cmd.exe /c cd /d `"$frontendDir`" && `"$npmCmd`" run dev $frontendLogSuffix"

try {
    $startup2 = ([wmiclass]"Win32_ProcessStartup").CreateInstance()
    $startup2.ShowWindow = 0 # SW_HIDE

    $result2 = Invoke-WmiMethod -Class Win32_Process -Name Create -ArgumentList @($frontendCmd, $frontendDir, $startup2)
    $frontendPid = $result2.ProcessId
    $returnValue2 = $result2.ReturnValue
    Write-Log "Frontend WMI Create: ReturnValue=$returnValue2 PID=$frontendPid"
} catch {
    Write-Log "Frontend WMI launch FAILED: $_"
}

# Wait and verify (only when logging)
if ($LOG_ENABLED) {
    Start-Sleep -Seconds 5

    $backendAlive = $false
    try {
        $proc = Get-Process -Id $backendPid -ErrorAction Stop
        $backendAlive = -not $proc.HasExited
    } catch { }
    Write-Log "Backend alive after 5s: $backendAlive"

    $frontendAlive = $false
    try {
        $proc2 = Get-Process -Id $frontendPid -ErrorAction Stop
        $frontendAlive = -not $proc2.HasExited
    } catch { }
    Write-Log "Frontend alive after 5s: $frontendAlive"
}

# Open browser is handled by Vite (--open flag in package.json)
