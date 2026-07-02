# ShopFlow Delmia auto-tracker watcher.
# Pauza ako: mis idle >= $IdleThreshold sekundi ILI 3DEXPERIENCE prozor nije u fokusu >= $IdleThreshold sekundi.

$ProcessName      = "3DEXPERIENCE"
$IdleThreshold    = 30   # sekundi
$FocusDebounce    = 3    # 3DEXPERIENCE mora biti u fokusu barem 3s da se pauza resetuje
$SupabaseUrl      = "https://orjetlbyrunceopyhyal.supabase.co"
$SupabaseKey      = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yamV0bGJ5cnVuY2VvcHloeWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM4NjMsImV4cCI6MjA5MzQ3OTg2M30.vRzJEDmrjA8f8gKs3f-ZDpGpePW2mSTIuh4zpxpicyo"

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@

function Get-ForegroundProcessName {
    $hwnd   = [Win32]::GetForegroundWindow()
    if ($hwnd -eq [IntPtr]::Zero) { return $null }
    $winPid = 0
    [Win32]::GetWindowThreadProcessId($hwnd, [ref]$winPid) | Out-Null
    if ($winPid -eq 0) { return $null }
    $proc = Get-Process -Id $winPid -ErrorAction SilentlyContinue
    return $proc.Name
}

$headers = @{
    "apikey"        = $SupabaseKey
    "Authorization" = "Bearer $SupabaseKey"
    "Content-Type"  = "application/json"
    "Prefer"        = "return=minimal"
}

$lastRunning         = $null
$lastPaused          = $null
$lastMousePos        = [System.Windows.Forms.Cursor]::Position
$lastMouseMoveTime   = [DateTime]::Now
$lastDelmiaFocusTime = [DateTime]::Now
$delmiaContinuousFocusStart = $null
Write-Host "Delmia tracker pokrenut. Gledam: $ProcessName (idle/focus pauza: ${IdleThreshold}s)"

while ($true) {
    $running = $null -ne (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)

    # Mis idle
    $currentPos = [System.Windows.Forms.Cursor]::Position
    if ($currentPos.X -ne $lastMousePos.X -or $currentPos.Y -ne $lastMousePos.Y) {
        $lastMousePos      = $currentPos
        $lastMouseMoveTime = [DateTime]::Now
    }
    $idleSeconds = ([DateTime]::Now - $lastMouseMoveTime).TotalSeconds

    # Fokus prozora — s debounce: mora biti u fokusu barem $FocusDebounce sekundi
    $focusedProc = Get-ForegroundProcessName
    if ($focusedProc -eq $ProcessName) {
        if ($null -eq $delmiaContinuousFocusStart) {
            $delmiaContinuousFocusStart = [DateTime]::Now
        }
        $continuousFocusSec = ([DateTime]::Now - $delmiaContinuousFocusStart).TotalSeconds
        if ($continuousFocusSec -ge $FocusDebounce) {
            $lastDelmiaFocusTime = [DateTime]::Now
        }
    } else {
        $delmiaContinuousFocusStart = $null
    }
    $focusSeconds = ([DateTime]::Now - $lastDelmiaFocusTime).TotalSeconds

    $paused = $running -and (($idleSeconds -ge $IdleThreshold) -or ($focusSeconds -ge $IdleThreshold))

    if ($running -ne $lastRunning -or $paused -ne $lastPaused) {
        $body = "{`"running`":$($running.ToString().ToLower()),`"paused`":$($paused.ToString().ToLower())}"
        try {
            Invoke-RestMethod -Method PATCH `
                -Uri "$SupabaseUrl/rest/v1/tracker_status?id=eq.1" `
                -Headers $headers -Body $body | Out-Null
            if ($paused) {
                $reason = if ($idleSeconds -ge $IdleThreshold) { "mis idle $([int]$idleSeconds)s" } else { "fokus drugdje $([int]$focusSeconds)s" }
                Write-Host "$(Get-Date -Format 'HH:mm:ss')  PAUZA ($reason)"
            } elseif ($running) {
                Write-Host "$(Get-Date -Format 'HH:mm:ss')  running"
            } else {
                Write-Host "$(Get-Date -Format 'HH:mm:ss')  stopped"
            }
        } catch {
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  Greska: $_"
        }
        $lastRunning = $running
        $lastPaused  = $paused
    }

    Start-Sleep -Seconds 1
}
