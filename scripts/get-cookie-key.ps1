param(
  [Parameter(Mandatory = $true)]
  [string]$PrefsPath
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $PrefsPath)) { throw 'LocalPrefs.json not found: ' + $PrefsPath }
$json = Get-Content -LiteralPath $PrefsPath -Raw | ConvertFrom-Json
if (-not $json.os_crypt -or -not $json.os_crypt.encrypted_key) { throw 'os_crypt.encrypted_key not found in LocalPrefs.json' }
$raw = [Convert]::FromBase64String($json.os_crypt.encrypted_key)
if ($raw.Length -lt 6) { throw 'encrypted_key is too short' }
$blob = $raw[5..($raw.Length - 1)]
Add-Type -AssemblyName System.Security
$key = [System.Security.Cryptography.ProtectedData]::Unprotect($blob, $null, 'CurrentUser')
[Convert]::ToBase64String($key)
