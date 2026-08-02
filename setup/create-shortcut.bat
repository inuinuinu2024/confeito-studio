@echo off
setlocal

set "SHORTCUT_PATH=%~dp0Confeito-Studio.lnk"
set "VBS_PATH=%~dp0start-app.vbs"
set "ICON_PATH=%~dp0app-icon.ico"
set "WORKING_DIR=%~dp0.."

powershell -NoProfile -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%SHORTCUT_PATH%'); $Shortcut.TargetPath = 'wscript.exe'; $Shortcut.Arguments = '"%VBS_PATH%"'; $Shortcut.WorkingDirectory = '%WORKING_DIR%'; if (Test-Path '%ICON_PATH%') { $Shortcut.IconLocation = '%ICON_PATH%' } else { $Shortcut.IconLocation = 'imageres.dll, 15' }; $Shortcut.Save()"

echo =======================================================
echo Shortcut created in the scripts directory!
echo Right-click "Confeito-Studio.lnk" and "Pin to taskbar".
echo =======================================================
pause
