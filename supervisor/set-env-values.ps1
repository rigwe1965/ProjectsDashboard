# Prompts for the given keys and writes them into a dashboard env file.
# Run it in YOUR OWN PowerShell window (it needs an interactive prompt):
#   powershell -ExecutionPolicy Bypass -File C:\Users\rigwe\Desktop\ProjectsDashboard\supervisor\set-env-values.ps1
# If pasting into the hidden prompt does not work (it stores a control character instead), add -Visible:
#   ... set-env-values.ps1 -Visible        (the value is then shown on screen as you paste it)
param(
  [string]$File = "$PSScriptRoot\..\data\claudeworkspace-demo.env",
  [string[]]$Keys = @("SUPABASE_SERVICE_ROLE_KEY", "DEMO_DB_URL"),
  [int]$MinLength = 20,
  [switch]$Visible
)
$File = (Resolve-Path $File).Path
$lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $File)
$changed = $false

foreach ($k in $Keys) {
  if ($Visible) {
    $val = Read-Host -Prompt "Paste value for $k (input VISIBLE)"
  } else {
    $sec = Read-Host -Prompt "Paste value for $k (input hidden; use Shift+Insert or right-click to paste)" -AsSecureString
    $val = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  # drop control characters (e.g. a literal Ctrl+V) and surrounding whitespace
  $val = ($val -replace '[\x00-\x1F\x7F]', '').Trim()
  if (-not $val) { Write-Host "  skipped $k (empty)"; continue }
  if ($val.Length -lt $MinLength) {
    Write-Host "  NOT saved $k : only $($val.Length) characters, so the paste did not work. Try again with -Visible."
    continue
  }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($k))=") { $lines[$i] = "$k=$val"; $found = $true; break }
  }
  if (-not $found) { $lines.Add("$k=$val") }
  $changed = $true
  Write-Host "  saved $k ($($val.Length) characters)"
}
if ($changed) {
  [System.IO.File]::WriteAllLines($File, $lines, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Done. Wrote $File"
} else {
  Write-Host "Nothing saved; the file was not changed."
}
