# Create "Wyze Monitor Pi" shortcuts (Start menu + Desktop) that open the
# Raspberry Pi dashboard in its own window with the Pi icon. The shortcut's
# AppUserModelID matches src/pi-viewer.js so the running window groups with
# the pinned taskbar button.
param(
    [string]$Url = 'http://192.168.1.155:18765'
)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $project 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $project 'assets\icons\pi\wyze-monitor.ico'
if (-not (Test-Path -LiteralPath $electron)) { throw 'Run npm install in the Wyze Monitor project first.' }
if (-not (Test-Path -LiteralPath $icon)) { throw 'Run scripts/icons/generate-icons.py first.' }
# Copy the icon beside the Windows monitor's launcher icon. A new file name per
# design change sidesteps Windows' shortcut icon cache.
$launchers = Join-Path $env:USERPROFILE 'WyzeCameraMonitor\launchers'
New-Item -ItemType Directory -Force $launchers | Out-Null
$stamp = (Get-FileHash -LiteralPath $icon -Algorithm SHA256).Hash.Substring(0, 8)
Get-ChildItem $launchers -Filter 'Wyze-Monitor-Pi-*.ico' | Remove-Item -Force
$installed = Join-Path $launchers "Wyze-Monitor-Pi-$stamp.ico"
Copy-Item -LiteralPath $icon -Destination $installed -Force
$icon = $installed

$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Wyze Monitor Pi.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Wyze Monitor Pi.lnk')
)
$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
    $lnk = $shell.CreateShortcut($path)
    # Via the launcher script, which clears NODE_OPTIONS before starting Electron.
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'start-pi-viewer.ps1')`" -Url $Url"
    $lnk.WorkingDirectory = $project
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = 'Open the Raspberry Pi Wyze camera dashboard'
    $lnk.Save()
}
& (Join-Path $PSScriptRoot 'icons\set-shortcut-app-id.ps1') -AppId 'WyzeCameraMonitor.Pi' -Shortcuts $targets
