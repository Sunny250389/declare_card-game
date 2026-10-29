from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any


SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    collection TEXT NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (collection, key)
)
"""


class Store:
    """Durable JSON document store backed by SQLite.

    The backend runs as a single process that owns this database file. Keep the
    file on a persistent volume in production. Callers that read then write must
    hold `store.lock` so the two steps happen atomically.
    """

    def __init__(self, path: str) -> None:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self._connection = sqlite3.connect(path, check_same_thread=False)
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute(SCHEMA)
        self._connection.commit()

    def get(self, collection: str, key: str) -> dict[str, Any] | None:
        with self.lock:
            row = self._connection.execute(
                "SELECT data FROM documents WHERE collection = ? AND key = ?", (collection, key)
            ).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, collection: str, key: str, data: dict[str, Any]) -> None:
        with self.lock:
            self._connection.execute(
                """
                INSERT INTO documents (collection, key, data) VALUES (?, ?, ?)
                ON CONFLICT (collection, key) DO UPDATE SET data = excluded.data
                """,
                (collection, key, json.dumps(data)),
            )
            self._connection.commit()

    def delete(self, collection: str, key: str) -> None:
        with self.lock:
            self._connection.execute("DELETE FROM documents WHERE collection = ? AND key = ?", (collection, key))
            self._connection.commit()

    def close(self) -> None:
        with self.lock:
            self._connection.close()
