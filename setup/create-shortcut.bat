@echo off
setlocal

set "SHORTCUT_PATH=%~dp0Confeito-Studio.lnk"
set "PS1_PATH=%~dp0start-app.ps1"
set "ICON_PATH=%~dp0app-icon.ico"
set "WORKING_DIR=%~dp0.."

powershell -NoProfile -Command ^
  "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%SHORTCUT_PATH%'); $Shortcut.TargetPath = 'powershell.exe'; $Shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%PS1_PATH%""'; $Shortcut.WorkingDirectory = '%WORKING_DIR%'; if (Test-Path '%ICON_PATH%') { $Shortcut.IconLocation = '%ICON_PATH%' } else { $Shortcut.IconLocation = 'imageres.dll, 15' }; $Shortcut.Save()"

echo =======================================================
echo Shortcut created: %SHORTCUT_PATH%
echo Right-click "Confeito-Studio.lnk" and "Pin to taskbar".
echo =======================================================
pause
