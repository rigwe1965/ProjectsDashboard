# Prompts (hidden input) for the given keys and writes them into a dashboard env file.
# Run it in YOUR OWN PowerShell window (it needs an interactive prompt):
#   powershell -ExecutionPolicy Bypass -File C:\Users\rigwe\Desktop\ProjectsDashboard\supervisor\set-env-values.ps1
param(
  [string]$File = "$PSScriptRoot\..\data\claudeworkspace-demo.env",
  [string[]]$Keys = @("SUPABASE_SERVICE_ROLE_KEY", "DEMO_DB_URL")
)
$File = (Resolve-Path $File).Path
$lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $File)

foreach ($k in $Keys) {
  $sec = Read-Host -Prompt "Paste value for $k (input hidden)" -AsSecureString
  $val = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
  if (-not $val) { Write-Host "  skipped $k (empty)"; continue }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^$([regex]::Escape($k))=") { $lines[$i] = "$k=$val"; $found = $true; break }
  }
  if (-not $found) { $lines.Add("$k=$val") }
  Write-Host "  saved $k ($($val.Length) characters)"
}
[System.IO.File]::WriteAllLines($File, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Done. Wrote $File"
