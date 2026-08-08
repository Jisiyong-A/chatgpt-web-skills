# Kill ONLY chrome processes using the chatgpt-web-profile (never user Chrome)
$procs = Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -like '*chatgpt-web-profile*' }
foreach ($p in $procs) {
    try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; Write-Host "killed $($p.ProcessId)" } catch { }
}
Start-Sleep -Seconds 2
Write-Host "remaining chatgpt-profile chrome procs: $((Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*chatgpt-web-profile*' }).Count)"
