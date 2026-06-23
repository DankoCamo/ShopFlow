# ShopFlow Delmia auto-tracker watcher.
# Prati je li 3DEXPERIENCE pokrenut i salje status u Supabase.
# ShopFlow app cita status iz Supabase i sam pali/gasi timer.
#
# PODESI: $ProcessName = tocan naziv exe-a bez ekstenzije (provjeri Task Manager)

$ProcessName  = "3DEXPERIENCE"
$SupabaseUrl  = "https://orjetlbyrunceopyhyal.supabase.co"
$SupabaseKey  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9yamV0bGJ5cnVuY2VvcHloeWFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDM4NjMsImV4cCI6MjA5MzQ3OTg2M30.vRzJEDmrjA8f8gKs3f-ZDpGpePW2mSTIuh4zpxpicyo"

$headers = @{
    "apikey"       = $SupabaseKey
    "Authorization"= "Bearer $SupabaseKey"
    "Content-Type" = "application/json"
    "Prefer"       = "return=minimal"
}

$lastRunning = $null
Write-Host "Delmia tracker pokrenut. Gledam: $ProcessName"

while ($true) {
    $running = $null -ne (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)

    if ($running -ne $lastRunning) {
        $body = "{`"running`":$($running.ToString().ToLower())}"
        try {
            Invoke-RestMethod -Method PATCH `
                -Uri "$SupabaseUrl/rest/v1/tracker_status?id=eq.1" `
                -Headers $headers -Body $body | Out-Null
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  running = $running"
        } catch {
            Write-Host "$(Get-Date -Format 'HH:mm:ss')  Greska: $_"
        }
        $lastRunning = $running
    }

    Start-Sleep -Seconds 3
}
