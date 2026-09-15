import os
import signal
import subprocess
import sys
import threading
import time

def trigger_shutdown(delay: float = 0.5) -> None:
    """
    バックエンドサーバーを安全に終了させる。
    Windowsではプロセスツリー全体を確実に終了させる。
    """
    def suicide():
        time.sleep(delay)
        pid = os.getpid()
        if sys.platform == "win32":
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
                return
            except Exception:
                pass
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass

    threading.Thread(target=suicide, daemon=True).start()
