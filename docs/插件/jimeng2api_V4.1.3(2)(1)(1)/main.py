# -*- coding: utf-8 -*-
"""
Temporary entry shim for local testing.

The original compiled plugin is kept as main_core.cp312-win_amd64.pyd.  This
file disables the old license check and forwards normal plugin calls to the
compiled core unchanged.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from types import ModuleType
from typing import Any


_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
_CORE_PATH = os.path.join(_PLUGIN_DIR, "main_core.cp312-win_amd64.pyd")
_CORE: ModuleType | None = None


def _license_ok_payload() -> dict[str, Any]:
    return {
        "ok": True,
        "authorized": True,
        "licensed": True,
        "license_required": False,
        "message": "License check is temporarily disabled for local testing.",
    }


def check_license() -> bool:
    core = _load_core()
    _patch_core_auth(core)
    return True


def _patch_core_auth(core: ModuleType) -> None:
    try:
        core.g_plugin_pass = True
    except Exception:
        pass
    try:
        core.g_show_license_warning = False
    except Exception:
        pass
    try:
        core.check_license = check_license
    except Exception:
        pass


def _load_core() -> ModuleType:
    global _CORE
    if _CORE is not None:
        _patch_core_auth(_CORE)
        return _CORE

    if not os.path.exists(_CORE_PATH):
        raise FileNotFoundError(f"Missing compiled core: {_CORE_PATH}")

    spec = importlib.util.spec_from_file_location("main", _CORE_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load compiled core: {_CORE_PATH}")

    core = importlib.util.module_from_spec(spec)
    previous_main = sys.modules.get("main")
    sys.modules["main"] = core
    try:
        spec.loader.exec_module(core)
    finally:
        if previous_main is None:
            sys.modules.pop("main", None)
        else:
            sys.modules["main"] = previous_main

    _patch_core_auth(core)
    _CORE = core
    return core


def get_info() -> dict[str, Any]:
    core = _load_core()
    info = core.get_info() if hasattr(core, "get_info") else {}
    if isinstance(info, dict):
        return info
    return {"name": "Jimeng Web Video", "description": str(info)}


def handle_action(action: str, data: Any = None, *args: Any, **kwargs: Any) -> Any:
    if action in {
        "check_license",
        "check_license_status",
        "get_license_state",
        "get_machine_code",
        "activate_local_license",
        "activate_network_license",
        "clear_license",
    }:
        return _license_ok_payload()

    core = _load_core()
    _patch_core_auth(core)
    if not hasattr(core, "handle_action"):
        return {"ok": False, "error": f"Unknown action: {action}"}
    try:
        return core.handle_action(action, data, *args, **kwargs)
    except TypeError:
        return core.handle_action(action, data)


def generate(context: dict[str, Any]) -> Any:
    core = _load_core()
    _patch_core_auth(core)
    return core.generate(context)


def __getattr__(name: str) -> Any:
    core = _load_core()
    _patch_core_auth(core)
    return getattr(core, name)

