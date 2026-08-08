"""Watchdog for chatgpt-web-provider (Hermes cron, no_agent mode).

Runs every few minutes inside Hermes' scheduler. If the adapter
(127.0.0.1:8765) is not listening, starts the dedicated Chrome (if needed)
and the adapter via start-adapter.bat. Prints ONLY on state changes
(watchdog pattern: silence = healthy).
"""
import socket
import subprocess
import urllib.request

ADAPTER_PORT = 8765
BAT = r"D:\hermes\chatgpt-web-provider\start-adapter.bat"


def listening(port: int, timeout: float = 0.7) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(timeout)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    msgs = []
    if not listening(ADAPTER_PORT):
        try:
            # start-adapter.bat: starts Chrome (CDP 9233) if needed, then the
            # adapter; idempotent (skips anything already listening).
            subprocess.Popen(
                ["cmd", "/c", "start", "", "/min", BAT],
                creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
            )
            msgs.append("chatgpt-web-provider adapter was down; startup triggered")
        except Exception as e:  # noqa: BLE001
            msgs.append(f"adapter startup failed: {e}")
    else:
        # Adapter is up — verify the browser side once in a while.
        try:
            with urllib.request.urlopen("http://127.0.0.1:8765/health", timeout=2) as r:
                body = r.read().decode("utf-8", "replace")
                if '"browser_connected":true' not in body:
                    msgs.append("adapter up but browser disconnected: " + body[:160])
        except Exception as e:  # noqa: BLE001
            msgs.append(f"adapter health check failed: {e}")
    if msgs:
        print("\n".join(msgs))


if __name__ == "__main__":
    main()
