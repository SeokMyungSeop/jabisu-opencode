# Starts FilmCraft so Jabisu can drive it: its control server listens on 127.0.0.1:__PORT__ and accepts only
# Jabisu's token, which this script reads itself so it never appears in the conversation.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File start-filmcraft.ps1
$ErrorActionPreference = "Stop"
$port = __PORT__
$app = Join-Path $env:ProgramFiles "FilmCraft\filmcraft.exe"

function Listening {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Path -LiteralPath $app)) {
  Write-Output "FilmCraft is not installed at $app."
  exit 1
}

if (Listening) {
  Write-Output "FilmCraft is already running with remote control on port $port."
  exit 0
}

if (Get-Process -Name filmcraft -ErrorAction SilentlyContinue) {
  Write-Output "FilmCraft is open without remote control. Ask the user to save their work and close it, then run this again."
  exit 2
}

if (-not (Test-Path -LiteralPath '__TOKEN_FILE__')) {
  Write-Output "Jabisu has not prepared FilmCraft's remote control yet. Ask the user to restart Jabisu, then run this again."
  exit 1
}

$env:FILMCRAFT_CONTROL_TOKEN = (Get-Content -Raw -LiteralPath '__TOKEN_FILE__').Trim()
Start-Process -FilePath $app -ArgumentList @("--control", "$port")

for ($i = 0; $i -lt 60; $i++) {
  if (Listening) {
    Write-Output "FilmCraft started with remote control on port $port."
    exit 0
  }
  Start-Sleep -Milliseconds 500
}

Write-Output "FilmCraft started, but its remote control did not open within 30 seconds."
exit 1
