$ErrorActionPreference = 'Stop'
$wyzeProject = Split-Path -Parent $PSScriptRoot
$wyzeElectron = Join-Path $wyzeProject 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path -LiteralPath $wyzeElectron)) { throw 'Run npm install in the Wyze Monitor project first.' }
$env:NODE_OPTIONS = $null
# Hide the launcher console; Electron creates the interactive monitor window.
Start-Process -FilePath $wyzeElectron -ArgumentList @('.') -WorkingDirectory $wyzeProject -WindowStyle Hidden
