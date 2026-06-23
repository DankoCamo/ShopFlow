# Jednokratna instalacija: registrira Windows Scheduled Task koji na logon
# pokrene delmia-tracker-watcher.ps1 skriveno u pozadini.
#
# Pokreni OVU skriptu jednom (desni klik -> Run with PowerShell, ili u
# PowerShell konzoli: powershell -ExecutionPolicy Bypass -File install-delmia-tracker-task.ps1)

$TaskName = "ShopFlow Delmia Tracker"
$ScriptPath = Join-Path $PSScriptRoot "delmia-tracker-watcher.ps1"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force

Write-Host "Task '$TaskName' registriran. Pokrenut ce se automatski na sljedeci login."
Write-Host "Za odmah testiranje: Start-ScheduledTask -TaskName '$TaskName'"
