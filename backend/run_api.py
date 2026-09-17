"""Launch Uvicorn with ANSI colors enabled in the Windows console."""

from __future__ import annotations

import ctypes
import os

import uvicorn


def enable_virtual_terminal() -> None:
    """Allow the current cmd.exe window to render ANSI color sequences."""
    if os.name != "nt":
        return
    handle = ctypes.windll.kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
    mode = ctypes.c_uint()
    if handle not in (0, -1) and ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
        ctypes.windll.kernel32.SetConsoleMode(handle, mode.value | 0x0004)  # ENABLE_VIRTUAL_TERMINAL_PROCESSING


def main() -> None:
    enable_virtual_terminal()
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, use_colors=True)


if __name__ == "__main__":
    main()
