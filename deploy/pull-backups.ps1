# Copies the server's nightly database backups to this PC and checks every file by hash. Run it from your own PC (Windows PowerShell), about once a week:
#   $env:PD_SERVER = "deploy@<server address>"          (once; the address is not kept in the repository)
#   .\deploy\pull-backups.ps1
# It needs the SSH key to be usable (loaded in the ssh-agent, or pass -Key). It never deletes anything on this PC. It removes the temporary
# copy on the server only after every hash matches. The backups hold the whole database: keep the destination private, never put it in a repository.
param(
  [string]$Server = $env:PD_SERVER,
  [string]$Key = $env:PD_SSH_KEY,
  [string]$Dest = $(if ($env:DASHBOARD_BACKUP_DIR) { Join-Path $env:DASHBOARD_BACKUP_DIR 'server-nightly' } else { '' }),
  [string]$LiveDir = '/home/deploy/ProjectsDashboard/deploy'
)
$ErrorActionPreference = 'Stop'
if (-not $Server) { throw 'Set the server first: $env:PD_SERVER = "deploy@<server address>" (or pass -Server).' }
if (-not $Dest) { throw 'No destination: set DASHBOARD_BACKUP_DIR or pass -Dest (a folder outside any repository).' }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$keyArgs = @(); if ($Key) { $keyArgs = @('-i', $Key) }
$tmp = '/tmp/pd-backups'

# 1. On the server: copy the backup folder out of the db-backup container and hash every file.
Write-Host "1/4 Preparing the backups on the server..."
$remote = "set -e; cd $LiveDir; rm -rf $tmp; docker compose cp db-backup:/backups $tmp; cd $tmp; sha256sum *.dump"
$lines = & ssh @keyArgs $Server $remote
if ($LASTEXITCODE -ne 0) { throw "ssh failed (exit $LASTEXITCODE). Nothing was copied." }
$expected = @{}
foreach ($l in $lines) { if ($l -match '^([0-9a-f]{64})\s+\*?(\S+\.dump)$') { $expected[$Matches[2]] = $Matches[1] } }
if ($expected.Count -eq 0) { throw 'The server reported no .dump files. Is the db-backup service running?' }

# 2. Copy them here.
Write-Host "2/4 Copying $($expected.Count) file(s) to $Dest ..."
& scp @keyArgs "${Server}:$tmp/*.dump" $Dest
if ($LASTEXITCODE -ne 0) { throw "scp failed (exit $LASTEXITCODE). The temporary copy on the server was left in place." }

# 3. Compare every hash.
Write-Host "3/4 Checking hashes..."
$bad = @()
foreach ($name in $expected.Keys) {
  $f = Join-Path $Dest $name
  if (-not (Test-Path $f) -or (Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne $expected[$name]) { $bad += $name }
}
if ($bad.Count) { throw ("Hash mismatch or missing file: " + ($bad -join ', ') + ". The temporary copy on the server was left in place.") }

# 4. Everything matches: remove the temporary copy on the server.
Write-Host "4/4 All hashes match. Removing the temporary copy on the server..."
& ssh @keyArgs $Server "rm -rf $tmp"
if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove $tmp on the server. Remove it by hand: it holds the whole database." }
$newest = ($expected.Keys | Sort-Object)[-1]
Write-Host "Done: $($expected.Count) backup(s) verified in $Dest. Newest: $newest"
