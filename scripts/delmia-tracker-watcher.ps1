# ShopFlow Delmia auto-tracker watcher.
# Provjerava je li 3DEXPERIENCE/Delmia pokrenut na ovom racunalu i preko
# lokalnog HTTP endpointa javlja ShopFlow web appu (otvorenom u browseru)
# da sam upali/ugasi timer u Trackeru.
#
# PRIJE PRVOG POKRETANJA PROVJERI/PODESI:
#   - $ProcessName: tocan naziv .exe procesa (Task Manager -> tab Details ->
#     desni klik na kolonu -> "Image name", pronadji 3DEXPERIENCE/Delmia proces)
#   - $Port: mora se poklapati s DELMIA_WATCHER_URL u index.html (default 5005)
#
# U ShopFlow appu mora postojati projekt s tocnim nazivom "CAM Delmia - Kres"
# (Kanban -> Novi projekt) da bi se vrijeme automatski pripisalo tom projektu.

$ProcessName = "3DEXPERIENCE"   # bez .exe ekstenzije, provjeri u Task Manageru
$Port        = 5005

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Delmia tracker watcher slusa na http://localhost:$Port/status (proces: $ProcessName)"

try {
    while ($true) {
        $running = $null -ne (Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)

        $task = $listener.GetContextAsync()
        if ($task.Wait(1000)) {
            $context = $task.Result
            $response = $context.Response
            $response.Headers.Add("Access-Control-Allow-Origin", "*")
            $response.ContentType = "application/json"
            $body = '{"running":' + ($running.ToString().ToLower()) + '}'
            $buffer = [System.Text.Encoding]::UTF8.GetBytes($body)
            $response.ContentLength64 = $buffer.Length
            $response.OutputStream.Write($buffer, 0, $buffer.Length)
            $response.OutputStream.Close()
        }
    }
} finally {
    $listener.Stop()
}
