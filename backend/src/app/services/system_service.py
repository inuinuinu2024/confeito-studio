import os
import signal
import threading
import time

def trigger_shutdown(delay: float = 0.5) -> None:
    """
    バックエンドサーバーを安全に終了させる。
    """
    def suicide():
        time.sleep(delay)
        # WindowsやUnix環境で安全にプロセスを終了させる
        try:
            os.kill(os.getpid(), signal.SIGTERM)
        except Exception:
            pass

    threading.Thread(target=suicide, daemon=True).start()
