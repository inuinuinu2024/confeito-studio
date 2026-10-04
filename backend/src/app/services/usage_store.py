"""Storage and aggregation of the Gemini usage records (Cost Monitor, docs/specs/cost-monitor.md).

SQLite database ``config.settings.usage_db_file`` (Python's sqlite3, one connection per call). This module is
the only place that knows the storage: the web version replaces it with a server database and keeps the
same functions. Aggregation happens here (SQL), so the frontend never loads every record.

Days and months are the viewer's local calendar: the caller passes the time "now" and the UTC offset
(minutes) of the viewer's clock.
"""

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from ..config import settings
from ..errors import AppError, BadRequestError, exception_text
from .pricing import Usage

SCHEMA_VERSION = 1
COUNT_COLUMNS = (
    "input_tokens",
    "cached_tokens",
    "output_text_tokens",
    "output_image_tokens",
    "thought_tokens",
    "search_queries",
    "images",
)
_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    at_ms INTEGER NOT NULL,
    user TEXT NOT NULL,
    tool TEXT NOT NULL,
    model TEXT NOT NULL,
    api TEXT NOT NULL,
    service_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    {", ".join(f"{c} INTEGER NOT NULL DEFAULT 0" for c in COUNT_COLUMNS)},
    cost_usd REAL,
    estimated INTEGER NOT NULL DEFAULT 0,
    prices_checked_on TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS usage_records_user_at ON usage_records (user, at_ms);
PRAGMA user_version = {SCHEMA_VERSION};
"""
_COLUMNS = (
    "id",
    "at",
    "at_ms",
    "user",
    "tool",
    "model",
    "api",
    "service_tier",
    "status",
    *COUNT_COLUMNS,
    "cost_usd",
    "estimated",
    "prices_checked_on",
)
_lock = threading.Lock()


class UsageStoreError(AppError):
    pass


def _db_path() -> Path:
    return settings.usage_db_file


def _row_values(record: dict[str, Any]) -> tuple[Any, ...]:
    usage = record["usage"]
    at_ms = int(datetime.fromisoformat(record["at"]).timestamp() * 1000)
    return (
        record["id"],
        record["at"],
        at_ms,
        record["user"],
        record["tool"],
        record["model"],
        record["api"],
        record["service_tier"],
        record["status"],
        *(usage[c] for c in COUNT_COLUMNS),
        record["cost_usd"],
        1 if record["estimated"] else 0,
        record["prices_checked_on"],
    )


_INSERT = f"INSERT INTO usage_records ({', '.join(_COLUMNS)}) VALUES ({', '.join('?' * len(_COLUMNS))})"


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    path = _db_path()
    with _lock:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(path, timeout=10)
        except (OSError, sqlite3.Error) as e:
            raise UsageStoreError(f"利用記録（{path.name}）を開けませんでした。", raw_response=exception_text(e)) from e
        try:
            conn.row_factory = sqlite3.Row
            conn.executescript(_SCHEMA)
            yield conn
            conn.commit()
        except sqlite3.DatabaseError as e:
            raise UsageStoreError(
                f"利用記録（{path.name}）を読み書きできませんでした。ファイルが壊れていないか確認してください。",
                raw_response=exception_text(e),
            ) from e
        finally:
            conn.close()


def insert(record: dict[str, Any]) -> None:
    """Stores one record (the shape usage_service.record builds)."""
    with _connect() as conn:
        conn.execute(_INSERT, _row_values(record))


def _record(row: sqlite3.Row) -> dict[str, Any]:
    usage: Usage = {c: row[c] for c in COUNT_COLUMNS}  # type: ignore[assignment]
    return {
        "id": row["id"],
        "at": row["at"],
        "user": row["user"],
        "tool": row["tool"],
        "model": row["model"],
        "api": row["api"],
        "service_tier": row["service_tier"],
        "status": row["status"],
        "usage": usage,
        "cost_usd": row["cost_usd"],
        "estimated": bool(row["estimated"]),
        "prices_checked_on": row["prices_checked_on"],
    }


_TOTALS = (
    "COUNT(*) AS count, COALESCE(SUM(cost_usd), 0) AS cost_usd, "
    "COALESCE(SUM(cost_usd IS NULL), 0) AS unpriced, COALESCE(SUM(estimated), 0) AS estimated, "
    + ", ".join(f"COALESCE(SUM({c}), 0) AS {c}" for c in COUNT_COLUMNS)
)


def _totals(row: sqlite3.Row, group: str | None = None) -> dict[str, Any]:
    return {key: row[key] for key in row.keys() if key != group}


RANGES = ("7d", "30d", "90d", "month", "all")
"""Periods of the chart and the totals: the last 7 / 30 / 90 days, this month, or since the first record."""
_RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90}
DAY_RECORDS_LIMIT = 1000
"""Records listed for one day (more than anyone runs in a day)."""


def _tz(tz_offset_minutes: int) -> timezone:
    return timezone(timedelta(minutes=tz_offset_minutes))


def _ms(d: datetime) -> int:
    return int(d.timestamp() * 1000)


class _Query:
    """Aggregates of one user's records with ``since <= at_ms < until``."""

    def __init__(self, conn: sqlite3.Connection, user: str, since_ms: int, until_ms: int) -> None:
        self.conn = conn
        self.where = "user = ? AND at_ms >= ? AND at_ms < ?"
        self.args: tuple[Any, ...] = (user, since_ms, until_ms)

    def total(self) -> dict[str, Any]:
        return _totals(
            self.conn.execute(f"SELECT {_TOTALS} FROM usage_records WHERE {self.where}", self.args).fetchone()
        )

    def breakdown(self, key: str) -> list[dict[str, Any]]:
        """Totals per tool or model, most expensive first."""
        rows = self.conn.execute(
            f"SELECT {key}, {_TOTALS} FROM usage_records WHERE {self.where} GROUP BY {key} "
            "ORDER BY cost_usd DESC, count DESC",
            self.args,
        )
        return [{"name": row[key], **_totals(row, key)} for row in rows]

    def daily(self, tz_offset_minutes: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT strftime('%Y-%m-%d', at_ms / 1000, 'unixepoch', ?) AS day, tool, "
            f"COALESCE(SUM(cost_usd), 0) AS cost_usd, COUNT(*) AS count FROM usage_records WHERE {self.where} "
            "GROUP BY day, tool",
            (f"{tz_offset_minutes:+d} minutes", *self.args),
        ).fetchall()

    def records(self, limit: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            f"SELECT * FROM usage_records WHERE {self.where} ORDER BY at_ms DESC, rowid DESC LIMIT ?",
            (*self.args, limit),
        ).fetchall()
        return [_record(r) for r in rows]


def summary(user: str, now_ms: int, tz_offset_minutes: int, range_key: str) -> dict[str, Any]:
    """For the viewer's local calendar: totals of today and this month; for the period ``range_key`` (ending
    today): its totals, the cost per day and tool (every day listed, oldest first) and the totals per tool
    and per model (most expensive first); and the latest record."""
    tz = _tz(tz_offset_minutes)
    now = datetime.fromtimestamp(now_ms / 1000, UTC).astimezone(tz)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_ms = _ms(today + timedelta(days=1))
    with _connect() as conn:
        if range_key in _RANGE_DAYS:
            start = today - timedelta(days=_RANGE_DAYS[range_key] - 1)
        elif range_key == "month":
            start = today.replace(day=1)
        else:
            first = conn.execute("SELECT MIN(at_ms) FROM usage_records WHERE user = ?", (user,)).fetchone()[0]
            first_day = datetime.fromtimestamp(first / 1000, UTC).astimezone(tz) if first is not None else today
            start = min(first_day.replace(hour=0, minute=0, second=0, microsecond=0), today)
        in_range = _Query(conn, user, _ms(start), tomorrow_ms)
        periods = {
            "today": _Query(conn, user, _ms(today), tomorrow_ms).total(),
            "month": _Query(conn, user, _ms(today.replace(day=1)), tomorrow_ms).total(),
            "range": in_range.total(),
        }
        daily_rows = in_range.daily(tz_offset_minutes)
        by_tool = in_range.breakdown("tool")
        by_model = in_range.breakdown("model")
        latest_row = conn.execute(
            "SELECT * FROM usage_records WHERE user = ? ORDER BY at_ms DESC, rowid DESC LIMIT 1", (user,)
        ).fetchone()

    days = (today - start).days + 1
    daily: dict[str, dict[str, Any]] = {}
    for i in range(days):
        day = (start + timedelta(days=i)).strftime("%Y-%m-%d")
        daily[day] = {"day": day, "by_tool": {}, "cost_usd": 0.0, "count": 0}
    for row in daily_rows:
        entry = daily.get(row["day"])
        if entry is None:
            continue
        entry["by_tool"][row["tool"]] = row["cost_usd"]
        entry["cost_usd"] += row["cost_usd"]
        entry["count"] += row["count"]
    for entry in daily.values():
        # A tool whose calls all lack a price has no cost to show in the chart.
        entry["by_tool"] = {tool: cost for tool, cost in entry["by_tool"].items() if cost > 0}

    return {
        "periods": periods,
        "range": {
            "key": range_key,
            "start": start.strftime("%Y-%m-%d"),
            "end": today.strftime("%Y-%m-%d"),
            "days": days,
        },
        "latest": _record(latest_row) if latest_row else None,
        "daily": list(daily.values()),
        "by_tool": by_tool,
        "by_model": by_model,
    }


def day_detail(user: str, day: str, tz_offset_minutes: int) -> dict[str, Any]:
    """One local day ``YYYY-MM-DD``: its totals, per tool and per model, and its records (newest first)."""
    try:
        start = datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=_tz(tz_offset_minutes))
    except ValueError as e:
        raise BadRequestError(f"日付の形式が正しくありません: {day}") from e
    with _connect() as conn:
        query = _Query(conn, user, _ms(start), _ms(start + timedelta(days=1)))
        result = {
            "day": day,
            "total": query.total(),
            "by_tool": query.breakdown("tool"),
            "by_model": query.breakdown("model"),
            "records": query.records(DAY_RECORDS_LIMIT),
        }
    return result


def list_records(user: str, offset: int, limit: int) -> dict[str, Any]:
    """``{records, total}``: one page of records, newest first."""
    with _connect() as conn:
        total = conn.execute("SELECT COUNT(*) FROM usage_records WHERE user = ?", (user,)).fetchone()[0]
        rows = conn.execute(
            "SELECT * FROM usage_records WHERE user = ? ORDER BY at_ms DESC, rowid DESC LIMIT ? OFFSET ?",
            (user, limit, offset),
        ).fetchall()
    return {"records": [_record(r) for r in rows], "total": total}
