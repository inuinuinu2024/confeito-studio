Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c npm run dev", 0, false
