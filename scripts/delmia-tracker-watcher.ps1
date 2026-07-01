# ShopFlow Delmia auto-tracker watcher.
# Prati je li 3DEXPERIENCE pokrenut i ima li pomaka misa.
# Ako nema pomaka misa $IdleThreshold sekundi, salje paused=true u Supabase.

$ProcessName   = "3DEXPERIENCE"
$IdleThreshold = 30   # sekundi bez pomaka misa -> pauza
$SupabaseUrl   = "https://orjetlbyrunceopyhyal.supabase.co"
$SupabaseKey   = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yamV0bGJ5cnVuY2VvcHloeWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM4NjMsImV4cCI6MjA5MzQ3OTg2M30.vRzJEDmrjA8f8gKs3f-ZDpGpePW2mSTIuh4zpxpicyo"

Add-Type -AssemblyName System.Windows.Forms

$headers = @{
    "apikey"        = $SupabaseKey
    "Authorization" = "Bearer $SupabaseKey"
    "Content-Type"  = "application/json"
    "Prefer"        = "return=minimal"
}

$lastRunning      = $null
$lastPaused       = $null
$lastMousePos     = [System.Windows.Forms.Cursor]::Position
$lastMouseMoveTime = [DateTime]::Now

Write-Host "Delmia tracker pokrenut. Gledam: $ProcessName (idle pauza: ${IdleThreshold}s)"

while ($true) {
    $running = $null -ne (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)

    $currentPos = [System.Windows.Forms.Cursor]::Position
    if ($currentPos.X -ne $lastMousePos.X -or $currentPos.Y -ne $lastMousePos.Y) {
        $lastMousePos = $currentPos
        $lastMouseMoveTime = [DateTime]::Now
    }
    $idleSeconds = ([DateTime]::Now - $lastMouseMoveTime).TotalSeconds
    $paused = $running -and ($idleSeconds -ge $IdleThreshold)

    if ($running -ne $lastRunning -or $paused -ne $lastPaused) {
        $body = "{`"running`":$($running.ToString().ToLower()),`"paused`":$($paused.ToString().ToLower())}"
        try {
            Invoke-RestMethod -Method PATCH `
                -Uri "$SupabaseUrl/rest/v1/tracker_status?id=eq.1" `
                -Headers $headers -Body $body | Out-Null
            $status = if ($paused) { "PAUZA (idle ${idleSeconds}s)" } elseif ($running) { "running" } else { "stopped" }
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  $status"
        } catch {
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  Greska: $_"
        }
        $lastRunning = $running
        $lastPaused  = $paused
    }

    Start-Sleep -Seconds 1
}
