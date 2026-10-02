"""Process lifecycle (called when the last browser tab closes)."""

import os
import signal
import subprocess
import sys
import threading
import time


def trigger_shutdown(delay: float = 0.5) -> None:
    """Terminates this server after ``delay`` seconds (whole process tree on Windows)."""

    def terminate() -> None:
        time.sleep(delay)
        pid = os.getpid()
        if sys.platform == "win32":
            try:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
                return
            except OSError:
                pass
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass

    threading.Thread(target=terminate, daemon=True).start()
