"""Backend for the Kanban app — a KiroCrew app.

A tiny, dependency-light (stdlib + aiohttp) board server with LOCAL JSON
storage. No external service, no credentials. Cards live in three columns
(todo / doing / done) and are created, edited, deleted, and moved by the UI.

Runtime env (managed subprocess): PORT, KIROCREW_APP_NAME, KIROCREW_HOME,
KIROCREW_PROXY_SECRET. Binds 127.0.0.1:$PORT.

Security: the gateway reverse-proxies /apps/kanban/api/{path} -> /api/{path}
and signs each request with an HMAC in X-KiroCrew-Proxy. When
KIROCREW_PROXY_SECRET is set we fail-closed on a bad signature; when unset
(local dev) we allow, matching the platform's other apps.
"""
from __future__ import annotations

import functools
import hashlib
import hmac as _hmac_mod
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Any

from aiohttp import web

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("kanban-app")

PORT = int(os.environ.get("PORT", 9100))
APP_NAME = os.environ.get("KIROCREW_APP_NAME", "kanban")

_PROXY_HMAC_MAX_AGE_S = 60
_COLUMNS = ("todo", "doing", "done")
_COLUMN_LABELS = {"todo": "To Do", "doing": "In Progress", "done": "Done"}
_PRIORITIES = ("low", "medium", "high")
_MAX_TITLE = 200
_MAX_DESC = 2000


# =============================================================================
# Errors + envelopes
# =============================================================================
class _HttpError(Exception):
    def __init__(self, code: str, message: str, status: int, hint: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.hint = hint


def _err(code: str, message: str, status: int, hint: str | None = None) -> web.Response:
    return web.json_response(
        {"error": {"code": code, "message": message, "hint": hint}}, status=status
    )


def _handler(fn):
    """Wrap a handler so every failure becomes a structured envelope; no bare 500."""

    @functools.wraps(fn)
    async def wrapper(request: web.Request) -> web.Response:
        try:
            return await fn(request)
        except web.HTTPException:
            raise
        except _HttpError as e:
            return _err(e.code, e.message, e.status, e.hint)
        except json.JSONDecodeError:
            return _err("bad_request", "Request body must be valid JSON.", 400)
        except Exception:  # noqa: BLE001 - never leak internals
            log.exception("unhandled error in %s", getattr(fn, "__name__", "handler"))
            return _err(
                "internal",
                "Something went wrong handling the request.",
                500,
                "Try again. If it keeps happening, check the gateway log.",
            )

    return wrapper


# =============================================================================
# HMAC proxy middleware (SOFT when KIROCREW_PROXY_SECRET unset)
# =============================================================================
@web.middleware
async def hmac_proxy_middleware(request: web.Request, handler):
    """Verify X-KiroCrew-Proxy HMAC on every request except /health.

    msg = "<ts>:<METHOD>:<path>[?query]:<sha256(body)>"
    SOFT MODE: KIROCREW_PROXY_SECRET unset -> allow (local dev).
    When set -> fail-closed (missing/invalid/expired -> 401).
    """
    if request.path == "/health":
        return await handler(request)

    secret = os.environ.get("KIROCREW_PROXY_SECRET", "").strip()
    if not secret:
        return await handler(request)

    def _deny(reason: str) -> web.Response:
        return _err("unauthorized", "Proxy authentication failed.", 401, reason)

    header = request.headers.get("X-KiroCrew-Proxy")
    if not header:
        return _deny("missing X-KiroCrew-Proxy header")
    parts = header.split(":", 1)
    if len(parts) != 2:
        return _deny("malformed X-KiroCrew-Proxy header")
    ts_str, sig_received = parts
    try:
        ts = int(ts_str)
    except ValueError:
        return _deny("invalid timestamp in proxy header")
    if abs(int(time.time()) - ts) > _PROXY_HMAC_MAX_AGE_S:
        return _deny("proxy signature expired")

    body = await request.read() if request.can_read_body else b""
    body_hash = hashlib.sha256(body).hexdigest()
    msg = f"{ts_str}:{request.method}:{request.path}"
    if request.query_string:
        msg += f"?{request.query_string}"
    msg += f":{body_hash}"
    expected = _hmac_mod.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
    if not _hmac_mod.compare_digest(sig_received, expected):
        return _deny("invalid proxy signature")
    return await handler(request)


# =============================================================================
# Storage — a single JSON file under the app data dir
# =============================================================================
def _kirocrew_home() -> str:
    return os.environ.get("KIROCREW_HOME") or os.path.expanduser("~/.kiro/crew")


def _data_dir() -> Path:
    d = Path(_kirocrew_home()) / "apps" / APP_NAME / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _board_path() -> Path:
    return _data_dir() / "board.json"


def _seed_board() -> dict:
    """A friendly starter board on first run."""
    now = _now_ms()
    return {
        "cards": [
            {
                "id": uuid.uuid4().hex,
                "title": "Welcome to your Kanban board 👋",
                "description": "Click a card to edit it. Use the + on a column to add a card. Move cards with the ◀ ▶ buttons.",
                "column": "todo",
                "priority": "medium",
                "order": 0,
                "created_at": now,
                "updated_at": now,
            },
            {
                "id": uuid.uuid4().hex,
                "title": "Try moving me to In Progress",
                "description": "",
                "column": "todo",
                "priority": "low",
                "order": 1,
                "created_at": now,
                "updated_at": now,
            },
        ]
    }


def _load_board() -> dict:
    p = _board_path()
    if not p.is_file():
        board = _seed_board()
        _save_board(board)
        return board
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("cards"), list):
            raise ValueError("malformed board file")
        return data
    except (json.JSONDecodeError, ValueError):
        log.warning("board.json unreadable; starting a fresh board")
        board = _seed_board()
        _save_board(board)
        return board


def _save_board(board: dict) -> None:
    p = _board_path()
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(board, indent=2), encoding="utf-8")
    os.replace(tmp, p)  # atomic on same volume


def _now_ms() -> int:
    return int(time.time() * 1000)


# =============================================================================
# Validation helpers
# =============================================================================
def _clean_title(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        raise _HttpError("bad_request", "title is required.", 400)
    t = v.strip()
    if len(t) > _MAX_TITLE:
        raise _HttpError("bad_request", f"title exceeds {_MAX_TITLE} characters.", 400)
    return t


def _clean_desc(v: Any) -> str:
    if v is None:
        return ""
    if not isinstance(v, str):
        raise _HttpError("bad_request", "description must be a string.", 400)
    if len(v) > _MAX_DESC:
        raise _HttpError("bad_request", f"description exceeds {_MAX_DESC} characters.", 400)
    return v


def _clean_column(v: Any, default: str | None = None) -> str:
    if v is None and default is not None:
        return default
    if v not in _COLUMNS:
        raise _HttpError("bad_request", f"column must be one of: {', '.join(_COLUMNS)}.", 400)
    return v


def _clean_priority(v: Any) -> str:
    if v is None:
        return "medium"
    if v not in _PRIORITIES:
        raise _HttpError("bad_request", f"priority must be one of: {', '.join(_PRIORITIES)}.", 400)
    return v


def _next_order(board: dict, column: str) -> int:
    existing = [c for c in board["cards"] if c.get("column") == column]
    return (max((c.get("order", 0) for c in existing), default=-1)) + 1


async def _read_json(request: web.Request) -> dict:
    try:
        data = await request.json()
    except json.JSONDecodeError:
        raise _HttpError("bad_request", "Request body must be valid JSON.", 400)
    if not isinstance(data, dict):
        raise _HttpError("bad_request", "Request body must be a JSON object.", 400)
    return data


# =============================================================================
# Handlers
# =============================================================================
async def h_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok", "app": APP_NAME})


@_handler
async def h_status(request: web.Request) -> web.Response:
    board = _load_board()
    return web.json_response(
        {"app": APP_NAME, "version": "0.1.0", "card_count": len(board["cards"])}
    )


@_handler
async def h_board(request: web.Request) -> web.Response:
    board = _load_board()
    columns = []
    for key in _COLUMNS:
        cards = [c for c in board["cards"] if c.get("column") == key]
        cards.sort(key=lambda c: c.get("order", 0))
        columns.append({"key": key, "label": _COLUMN_LABELS[key], "cards": cards})
    return web.json_response({"columns": columns, "total": len(board["cards"])})


@_handler
async def h_create_card(request: web.Request) -> web.Response:
    body = await _read_json(request)
    board = _load_board()
    column = _clean_column(body.get("column"), default="todo")
    card = {
        "id": uuid.uuid4().hex,
        "title": _clean_title(body.get("title")),
        "description": _clean_desc(body.get("description")),
        "column": column,
        "priority": _clean_priority(body.get("priority")),
        "order": _next_order(board, column),
        "created_at": _now_ms(),
        "updated_at": _now_ms(),
    }
    board["cards"].append(card)
    _save_board(board)
    return web.json_response(card, status=201)


@_handler
async def h_update_card(request: web.Request) -> web.Response:
    card_id = request.match_info.get("id", "")
    body = await _read_json(request)
    board = _load_board()
    card = next((c for c in board["cards"] if c.get("id") == card_id), None)
    if card is None:
        raise _HttpError("not_found", f"Card {card_id} not found.", 404)
    if "title" in body:
        card["title"] = _clean_title(body.get("title"))
    if "description" in body:
        card["description"] = _clean_desc(body.get("description"))
    if "priority" in body:
        card["priority"] = _clean_priority(body.get("priority"))
    if "column" in body:
        new_col = _clean_column(body.get("column"))
        if new_col != card["column"]:
            card["column"] = new_col
            card["order"] = _next_order(board, new_col)
    card["updated_at"] = _now_ms()
    _save_board(board)
    return web.json_response(card)


@_handler
async def h_delete_card(request: web.Request) -> web.Response:
    card_id = request.match_info.get("id", "")
    board = _load_board()
    before = len(board["cards"])
    board["cards"] = [c for c in board["cards"] if c.get("id") != card_id]
    if len(board["cards"]) == before:
        raise _HttpError("not_found", f"Card {card_id} not found.", 404)
    _save_board(board)
    return web.json_response({"deleted": True, "id": card_id})


@_handler
async def h_move_card(request: web.Request) -> web.Response:
    """Move a card to a column and position. Body: {id, column, index?}."""
    body = await _read_json(request)
    card_id = body.get("id") or ""
    board = _load_board()
    card = next((c for c in board["cards"] if c.get("id") == card_id), None)
    if card is None:
        raise _HttpError("not_found", f"Card {card_id} not found.", 404)
    column = _clean_column(body.get("column"))
    # Target index within the destination column (clamped).
    dest = [c for c in board["cards"] if c.get("column") == column and c.get("id") != card_id]
    dest.sort(key=lambda c: c.get("order", 0))
    index = body.get("index")
    if not isinstance(index, int) or index < 0:
        index = len(dest)
    index = min(index, len(dest))
    dest.insert(index, card)
    card["column"] = column
    card["updated_at"] = _now_ms()
    # Renumber the destination column so order is dense and stable.
    for i, c in enumerate(dest):
        c["order"] = i
    _save_board(board)
    return web.json_response(card)


# =============================================================================
# App
# =============================================================================
def build_app() -> web.Application:
    app = web.Application(middlewares=[hmac_proxy_middleware])
    app.router.add_get("/health", h_health)
    app.router.add_get("/api/status", h_status)
    app.router.add_get("/api/board", h_board)
    app.router.add_post("/api/cards", h_create_card)
    app.router.add_patch("/api/cards/{id}", h_update_card)
    app.router.add_delete("/api/cards/{id}", h_delete_card)
    app.router.add_post("/api/cards/move", h_move_card)
    return app


if __name__ == "__main__":
    log.info("kanban backend on 127.0.0.1:%s", PORT)
    web.run_app(build_app(), host="127.0.0.1", port=PORT, print=None)
