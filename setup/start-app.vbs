Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c cd frontend && npm run dev", 0, false
