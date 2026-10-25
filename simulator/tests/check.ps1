# Windows / PowerShell version of tests/check.sh
# Usage (from the simulator folder):  .\tests\check.ps1 [-Exe .\server_sync.exe]
param([string]$Exe = ".\server_sync.exe")

if (-not (Test-Path $Exe)) { Write-Host "Build first: $Exe not found (see README, 'Windows')."; exit 1 }
$script:pass = 0; $script:fail = 0

function Check($name, [bool]$ok) {
    if ($ok) { Write-Host "  PASS  $name"; $script:pass++ } else { Write-Host "  FAIL  $name"; $script:fail++ }
}
function Run([string[]]$a) { (& $Exe @a 2>&1 | Out-String) }
function Field([string]$text, [string]$label) {
    $m = [regex]::Match($text, "(?m)^" + [regex]::Escape($label) + "[^:]*:\s*(\d+)")
    if ($m.Success) { [int]$m.Groups[1].Value } else { -1 }
}
function TicketsSold([string]$text) {
    $m = [regex]::Match($text, "Tickets \(initial / sold\)\s*:\s*\d+ / (\d+)")
    if ($m.Success) { [int]$m.Groups[1].Value } else { -1 }
}

Write-Host "1. Default scenario (15 producers / 10 slots / 3 workers, synchronized)"
$out = Run @("15", "10", "3", "1", "100", "0")
Check "all 15 requests processed (no hang)" ((Field $out "Requests processed") -eq 15)
Check "no race with mutex" ((Field $out "Race-condition count") -eq 0)
Check "exactly 1 ticket sold" ((TicketsSold $out) -eq 1)

Write-Host "2. Buffer full / empty behaviour"
Check "buffer reached 10/10" ((Field $out "Peak buffer usage") -eq 10)
Check "producers blocked on full buffer" ((Field $out "Producer wait events") -ge 1)
Check "consumers blocked on empty buffer" ((Field $out "Consumer wait events") -ge 1)

Write-Host "3. Unsynchronized mode"
$out = Run @("15", "10", "3", "0", "100", "0")
Check "lost update / overselling detected" ((Field $out "Race-condition count") -ge 1)

Write-Host "4. Deterministic race experiment"
$out = Run @("--race")
Check "--race: unsafe detected, safe prevented" (($out -match "RACE CONDITION DETECTED") -and ($out -match "RACE CONDITION PREVENTED"))

Write-Host "5. Other configurations / termination"
foreach ($cfg in @("15 1 3 1 5 0", "7 2 5 1 5 3", "30 3 1 1 2 0", "1 1 1 1 1 0")) {
    $parts = $cfg.Split(" ")
    $o = Run $parts
    Check "config [$cfg]" ((Field $o "Requests processed") -eq [int]$parts[0])
}

Write-Host "6. Input validation"
$null = & $Exe 0 10 3 2>&1
Check "rejects clients=0" ($LASTEXITCODE -eq 2)

Write-Host ""
Write-Host "passed=$($script:pass) failed=$($script:fail)"
if ($script:fail -gt 0) { exit 1 }
