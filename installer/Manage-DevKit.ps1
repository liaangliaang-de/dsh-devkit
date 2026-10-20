[CmdletBinding()]
param(
  [ValidateSet('Install','Uninstall','Status')][string]$Action = 'Status',
  [string]$DshHome,
  [string]$DshInstallation = "$env:LOCALAPPDATA\Programs\DeepSeek Harness"
)
$ErrorActionPreference = 'Stop'
$cli = Join-Path $DshInstallation 'resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path -LiteralPath $cli)) { throw 'DeepSeek Harness installation was not found. Set -DshInstallation.' }
if ($DshHome) { $env:DSH_HOME = [IO.Path]::GetFullPath($DshHome) }
$dataRoot = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$profileRoot = Join-Path $dataRoot 'profiles\desktop'
$manifest = Join-Path $profileRoot 'package.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'Open this DSH Desktop profile once, then fully quit it before installation.' }
if ($Action -eq 'Status') {
  $p = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  $entry = @($p.dsh.profile.bundles | Where-Object { $_ -eq 'dsh-devkit' })
  [pscustomobject]@{ Profile=$profileRoot; BundleEntries=$entry.Count; Package=$p.dependencies.'dsh-devkit'; StateRoot=(Join-Path $dataRoot 'devkit') }
  exit 0
}
$gui = @(Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | Where-Object {
  $_.CommandLine -and $_.CommandLine -notmatch '--type=|--expose-internals|--utility-sub-type='
})
$defaultRoot = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.dsh'))
if ($gui.Count -and [IO.Path]::GetFullPath($dataRoot) -eq $defaultRoot) { throw 'Fully quit DeepSeek Harness (including the tray) before changing its packages. Your running sessions have not been stopped.' }
$backupRoot = Join-Path $profileRoot ('devkit-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
foreach ($name in @('package.json','pnpm-lock.yaml','cordis.patch.yml','cordis.yml')) {
  $item = Join-Path $profileRoot $name
  if (Test-Path -LiteralPath $item) { Copy-Item -LiteralPath $item -Destination (Join-Path $backupRoot $name) }
}
if ($Action -eq 'Install') {
  $packageFile = Join-Path $PSScriptRoot 'dsh-devkit-0.2.7.tgz'
  $checksumFile = Join-Path $PSScriptRoot 'SHA256SUMS.txt'
  $checksum = @(Get-Content -LiteralPath $checksumFile | Where-Object { $_ -match '^[a-fA-F0-9]{64}\s+\*?dsh-devkit-0\.2\.7\.tgz$' })
  if ($checksum.Count -ne 1) { throw 'Package checksum entry is missing or ambiguous.' }
  $expected = ($checksum[0] -split '\s+')[0]
  if ((Get-FileHash -LiteralPath $packageFile -Algorithm SHA256).Hash -ne $expected) { throw 'Package checksum mismatch.' }
  & $cli plugin --profile desktop add $packageFile --offline --ignore-scripts
} else {
  & $cli plugin --profile desktop remove dsh-devkit
}
if ($LASTEXITCODE -ne 0) { throw "DSH package operation failed ($LASTEXITCODE). Configuration backup: $backupRoot" }
Write-Output "Finished. Configuration backup: $backupRoot"
Write-Output 'Project state and execution artifacts have been retained. Restart DSH and check the single dsh-devkit entry.'
