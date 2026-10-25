# Windows helper: builds server_sync.exe with g++ and (optionally) runs the checks.
# Usage (from the simulator folder):  .\build.ps1        -> build only
#                                     .\build.ps1 -Test  -> build, then run tests\check.ps1
param([switch]$Test)

if (-not (Get-Command g++ -ErrorAction SilentlyContinue)) {
    Write-Host "g++ not found. Install MSYS2 and add C:\msys64\ucrt64\bin to PATH (see README), then reopen the terminal."
    exit 1
}
$sources = (Get-ChildItem "$PSScriptRoot\src\*.cpp").FullName
& g++ -std=c++17 -O2 -Wall -Wextra -pthread "-I$PSScriptRoot\include" @sources -o "$PSScriptRoot\server_sync.exe"
if ($LASTEXITCODE -ne 0) { Write-Host "Build FAILED"; exit 1 }
Write-Host "Built $PSScriptRoot\server_sync.exe"
if ($Test) { & "$PSScriptRoot\tests\check.ps1" -Exe "$PSScriptRoot\server_sync.exe" }
