# ShopFlow auto-tracker watcher (Delmia + Fusion).
# Za svaku aplikaciju: pauza ako mis idle >= $IdleThreshold sekundi ILI prozor aplikacije nije u fokusu >= $IdleThreshold sekundi.
# Ako su obje pokrenute, aktivna je samo ona koja je zadnja bila u fokusu (druga je u pauzi).
# ExtraFocus: dodatni procesi koji se racunaju kao fokus te aplikacije (dok je ona pokrenuta), npr. Claude desktop uz Fusion.

$Apps = @(
    @{ Name = "Delmia"; ProcessNames = @("3DEXPERIENCE");              ExtraFocus = @();         RowId = 1 },
    @{ Name = "Fusion"; ProcessNames = @("Fusion360", "AutodeskFusion"); ExtraFocus = @("Claude"); RowId = 2 }
)
$IdleThreshold    = 30   # sekundi
$FocusDebounce    = 3    # aplikacija mora biti u fokusu barem 3s da se pauza resetuje
$SupabaseUrl      = "https://orjetlbyrunceopyhyal.supabase.co"
$SupabaseKey      = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yamV0bGJ5cnVuY2VvcHloeWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM4NjMsImV4cCI6MjA5MzQ3OTg2M30.vRzJEDmrjA8f8gKs3f-ZDpGpePW2mSTIuh4zpxpicyo"

# Jednokratna instanca: ubij staru instancu ako postoji
$lockFile = "$env:TEMP\shopflow-delmia.pid"
if (Test-Path $lockFile) {
    try { Stop-Process -Id ([int](Get-Content $lockFile)) -Force -ErrorAction SilentlyContinue } catch {}
}
$PID | Out-File $lockFile -Force

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

foreach ($app in $Apps) {
    $app.LastRunning          = $null
    $app.LastPaused           = $null
    $app.LastFocusTime        = [DateTime]::Now
    $app.ContinuousFocusStart = $null
}
$activeApp         = $null   # aplikacija koja je zadnja bila u fokusu (nakon debounce)
$lastMousePos      = [System.Windows.Forms.Cursor]::Position
$lastMouseMoveTime = [DateTime]::Now
Write-Host "Tracker pokrenut. Gledam: $(($Apps | ForEach-Object { $_.ProcessNames }) -join ', ') (idle/focus pauza: ${IdleThreshold}s)"

while ($true) {
    # Mis idle
    $currentPos = [System.Windows.Forms.Cursor]::Position
    if ($currentPos.X -ne $lastMousePos.X -or $currentPos.Y -ne $lastMousePos.Y) {
        $lastMousePos      = $currentPos
        $lastMouseMoveTime = [DateTime]::Now
    }
    $idleSeconds = ([DateTime]::Now - $lastMouseMoveTime).TotalSeconds

    # Fokus prozora — s debounce: mora biti u fokusu barem $FocusDebounce sekundi
    $focusedProc = Get-ForegroundProcessName
    foreach ($app in $Apps) {
        $app.Running = $null -ne (Get-Process -Name $app.ProcessNames -ErrorAction SilentlyContinue)
        if (($app.ProcessNames -contains $focusedProc) -or ($app.Running -and $app.ExtraFocus -contains $focusedProc)) {
            if ($null -eq $app.ContinuousFocusStart) {
                $app.ContinuousFocusStart = [DateTime]::Now
            }
            $continuousFocusSec = ([DateTime]::Now - $app.ContinuousFocusStart).TotalSeconds
            if ($continuousFocusSec -ge $FocusDebounce) {
                $app.LastFocusTime = [DateTime]::Now
                $activeApp = $app.Name
            }
        } else {
            $app.ContinuousFocusStart = $null
        }
    }

    foreach ($app in $Apps) {
        $running      = $app.Running
        if (-not $running -and $activeApp -eq $app.Name) { $activeApp = $null }
        $focusSeconds = ([DateTime]::Now - $app.LastFocusTime).TotalSeconds
        $otherActive  = ($null -ne $activeApp) -and ($activeApp -ne $app.Name)
        $paused = $running -and (($idleSeconds -ge $IdleThreshold) -or ($focusSeconds -ge $IdleThreshold) -or $otherActive)

        if ($running -ne $app.LastRunning -or $paused -ne $app.LastPaused) {
            $body = "{`"running`":$($running.ToString().ToLower()),`"paused`":$($paused.ToString().ToLower())}"
            try {
                Invoke-RestMethod -Method PATCH `
                    -Uri "$SupabaseUrl/rest/v1/tracker_status?id=eq.$($app.RowId)" `
                    -Headers $headers -Body $body | Out-Null
                if ($paused) {
                    $reason = if ($idleSeconds -ge $IdleThreshold) { "mis idle $([int]$idleSeconds)s" } elseif ($otherActive) { "aktivan $activeApp" } else { "fokus drugdje $([int]$focusSeconds)s" }
                    Write-Host "$(Get-Date -Format 'HH:mm:ss')  $($app.Name): PAUZA ($reason)"
                } elseif ($running) {
                    Write-Host "$(Get-Date -Format 'HH:mm:ss')  $($app.Name): running"
                } else {
                    Write-Host "$(Get-Date -Format 'HH:mm:ss')  $($app.Name): stopped"
                }
            } catch {
                Write-Host "$(Get-Date -Format 'HH:mm:ss')  $($app.Name): Greska: $_"
            }
            $app.LastRunning = $running
            $app.LastPaused  = $paused
        }
    }

    Start-Sleep -Seconds 1
}
