"""Hold the Windows shared-data mutex while running the backend module."""
from __future__ import annotations

import argparse
import ctypes
import runpy
import sys


WAIT_OBJECT_0 = 0
WAIT_ABANDONED = 0x80
INFINITE = 0xFFFFFFFF


def acquire_windows_mutex(name: str):
    if sys.platform != "win32":
        raise RuntimeError("portable-data-guard is only supported by the native Windows package")
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel32.WaitForSingleObject.restype = ctypes.c_uint32
    kernel32.ReleaseMutex.argtypes = [ctypes.c_void_p]
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel32.CreateMutexW(None, False, name)
    if not handle:
        raise OSError(ctypes.get_last_error(), "CreateMutexW failed")
    result = kernel32.WaitForSingleObject(handle, INFINITE)
    if result not in (WAIT_OBJECT_0, WAIT_ABANDONED):
        kernel32.CloseHandle(handle)
        raise OSError(ctypes.get_last_error(), f"WaitForSingleObject failed: {result}")
    return kernel32, handle


def parse_arguments(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mutex-name", required=True)
    parser.add_argument("--module", required=True)
    args, arguments = parser.parse_known_args(argv)
    return args, arguments


def main() -> None:
    args, arguments = parse_arguments()
    kernel32, handle = acquire_windows_mutex(args.mutex_name)
    try:
        sys.argv = [args.module, *arguments]
        runpy.run_module(args.module, run_name="__main__")
    finally:
        kernel32.ReleaseMutex(handle)
        kernel32.CloseHandle(handle)


if __name__ == "__main__":
    main()
