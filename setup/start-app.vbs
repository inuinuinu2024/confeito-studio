Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /c cd backend && uv run uvicorn src.app.main:app --port 8000", 0, false
WshShell.Run "cmd.exe /c cd frontend && npm run dev", 0, false
