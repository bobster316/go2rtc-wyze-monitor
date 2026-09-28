# Create "Wyze Monitor Pi" (Pi 5, red) or "Wyze Monitor Pi 4" (green)
# shortcuts (Start menu + Desktop) that open that Raspberry Pi's dashboard in
# its own window. The shortcut's AppUserModelID matches src/pi-viewer.js so
# the running window groups with the pinned taskbar button.
#   install-pi-viewer-shortcut.ps1                  # Pi 5
#   install-pi-viewer-shortcut.ps1 -Device pi4      # Pi 4
param(
    [ValidateSet('pi', 'pi4')]
    [string]$Device = 'pi',
    [string]$Url = ''
)
$ErrorActionPreference = 'Stop'
# Must match DEVICES in src/pi-viewer.js. Never change an existing appId:
# Windows drops a taskbar pin whose ID changes.
$profiles = @{
    pi  = @{ Name = 'Wyze Monitor Pi';   AppId = 'WyzeCameraMonitor.Pi';  Url = 'http://192.168.1.155:18765'; IconPrefix = 'Wyze-Monitor-Pi-' }
    pi4 = @{ Name = 'Wyze Monitor Pi 4'; AppId = 'WyzeCameraMonitor.Pi4'; Url = 'http://192.168.1.93:18765';  IconPrefix = 'Wyze-Monitor-Pi4-' }
}
$p = $profiles[$Device]
if (-not $Url) { $Url = $p.Url }

$project = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $project 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $project "assets\icons\$Device\wyze-monitor.ico"
if (-not (Test-Path -LiteralPath $electron)) { throw 'Run npm install in the Wyze Monitor project first.' }
if (-not (Test-Path -LiteralPath $icon)) { throw 'Run scripts/icons/generate-icons.py first.' }
# Copy the icon beside the Windows monitor's launcher icon. A new file name per
# design change sidesteps Windows' shortcut icon cache.
$launchers = Join-Path $env:USERPROFILE 'WyzeCameraMonitor\launchers'
New-Item -ItemType Directory -Force $launchers | Out-Null
$stamp = (Get-FileHash -LiteralPath $icon -Algorithm SHA256).Hash.Substring(0, 8)
Get-ChildItem $launchers -Filter "$($p.IconPrefix)*.ico" | Remove-Item -Force
$installed = Join-Path $launchers "$($p.IconPrefix)$stamp.ico"
Copy-Item -LiteralPath $icon -Destination $installed -Force
$icon = $installed

$targets = @(
    (Join-Path ([Environment]::GetFolderPath('Programs')) "$($p.Name).lnk"),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) "$($p.Name).lnk")
)
$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
    $lnk = $shell.CreateShortcut($path)
    # Via the launcher script, which clears NODE_OPTIONS before starting Electron.
    $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'start-pi-viewer.ps1')`" -Device $Device -Url $Url"
    $lnk.WorkingDirectory = $project
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = "Open the $($p.Name -replace '^Wyze Monitor ', 'Raspberry ') Wyze camera dashboard"
    $lnk.Save()
}
& (Join-Path $PSScriptRoot 'icons\set-shortcut-app-id.ps1') -AppId $p.AppId -Shortcuts $targets
