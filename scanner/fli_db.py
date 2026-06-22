#!/usr/bin/env python3
"""
Shared DB helper for fli_*_*.py scanners.

Problem this solves:
  Four concurrent writers (HKG 4x, SZX 4x, HKG detail, SZX detail) all hit
  /data/fli_calendar.db. Even with WAL + busy_timeout, long write transactions
  (the 4x scans commit 50-100 rows at once) collide with short per-row
  commits from the detail scanners, producing "database is locked" errors.

Fix (v2 — BEGIN IMMEDIATE):
  1. flock(LOCK_EX) on a sidecar lockfile around every write transaction.
     Only one process can hold the write critical section at a time.
  2. INSIDE the flock, issue `BEGIN IMMEDIATE` so the SQLite writer lock is
     acquired up-front. This means a writer that can't get the lock fails
     FAST (raises SQLITE_BUSY) instead of acquiring a read transaction,
     starting work, then crashing mid-batch when the actual commit tries
     to upgrade to a writer lock. The flock + retry handles the wait.
  3. Belt-and-braces: busy_timeout=60s, idempotent WAL pragma at connect.
  4. A retry loop for any SQLITE_BUSY that slips through (e.g. contention
     with the read-only export scripts).

Writers using this module:
  - fli_4x_daily.py          (HKG 4x calendar scan)
  - fli_4x_daily_szx.py      (SZX 4x calendar scan)
  - fli_detail_scan_aggressive.py (HKG detail scan)
  - fli_detail_scan_szx.py   (SZX detail scan)

Read-only consumers (export scripts) can keep using raw sqlite3 — they don't
hold long transactions and benefit from WAL readers-don't-block-writers.
"""
import os
import fcntl
import sqlite3
import time
import sys
from contextlib import contextmanager

DB_PATH = '/data/fli_calendar.db'
LOCK_PATH = '/data/.fli_calendar.db.lock'

# Busy timeout for SQLITE_BUSY retries (60s is generous; flock should make
# this almost never fire).
BUSY_TIMEOUT_MS = 60_000

# How long to wait for the flock before giving up. Each writer only ever
# holds the lock for the duration of one INSERT OR REPLACE batch, so 30s is
# safe. 4x scans do one batch per route (50-100 rows, ~10-100ms), detail
# scanners do one row at a time (~1-5ms).
FLOCK_TIMEOUT_S = 30.0

# Retries for SQLITE_BUSY that escapes the flock (defensive).
BUSY_RETRIES = 5
BUSY_BACKOFF_S = 1.0


def _log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
    sys.stderr.write(f"[{ts}] fli_db: {msg}\n")
    sys.stderr.flush()


def _ensure_wal(conn):
    """Set WAL + busy_timeout idempotently. Safe to call on every connect."""
    cur = conn.cursor()
    cur.execute("PRAGMA journal_mode = WAL")
    cur.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    cur.execute("PRAGMA synchronous = NORMAL")  # WAL + NORMAL is safe + faster
    conn.commit()


def connect(timeout_s: float = 60.0) -> sqlite3.Connection:
    """
    Open a connection with sensible defaults for the fli_calendar.db.

    timeout_s maps to sqlite3's connect timeout, but the more important
    timeout is busy_timeout (set via PRAGMA), which controls how long
    SQLite itself waits when another writer holds the lock.

    isolation_level=None is required for write_transaction() to issue
    explicit BEGIN IMMEDIATE / COMMIT. Auto-commit semantics (the sqlite3
    default) would conflict with our explicit transactions.
    """
    conn = sqlite3.connect(DB_PATH, timeout=timeout_s, isolation_level=None)
    _ensure_wal(conn)
    return conn


@contextmanager
def flock_ex(timeout_s: float = FLOCK_TIMEOUT_S):
    """
    Cross-process exclusive lock around /data/.fli_calendar.db.lock.

    Blocks until acquired or timeout_s elapses. Yields the file descriptor
    on success, raises TimeoutError on timeout.

    Usage:
        with flock_ex():
            conn.execute(...)
            conn.commit()
    """
    # Open the lock file; create if missing. 'r+' requires the file to exist
    # on some platforms, so we touch it first.
    fd = os.open(LOCK_PATH, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        start = time.monotonic()
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - start > timeout_s:
                    raise TimeoutError(
                        f"flock timeout after {timeout_s}s waiting on {LOCK_PATH}"
                    )
                time.sleep(0.05)
        yield fd
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except Exception:
            pass
        os.close(fd)


def execute_write(conn, sql, params=(), *, label: str = "write") -> None:
    """
    Execute a single write with retry-on-busy. Caller controls the transaction
    (so they can batch multiple execute_write calls in one commit).

    Example:
        with flock_ex():
            execute_write(conn, "INSERT OR REPLACE ...", (...,))
            execute_write(conn, "INSERT OR REPLACE ...", (...,))
            conn.commit()
    """
    last_err = None
    for attempt in range(BUSY_RETRIES):
        try:
            conn.execute(sql, params)
            return
        except sqlite3.OperationalError as e:
            if "locked" in str(e).lower() and attempt < BUSY_RETRIES - 1:
                _log(f"{label}: SQLITE_BUSY (attempt {attempt+1}/{BUSY_RETRIES}), "
                     f"backing off {BUSY_BACKOFF_S}s")
                time.sleep(BUSY_BACKOFF_S * (attempt + 1))
                last_err = e
                continue
            raise
    if last_err:
        raise last_err


def write_with_flock(conn, fn, *, label: str = "write") -> None:
    """
    Convenience: take the flock, run `fn(conn)`, commit, release.

    `fn` should be a callable that does one or more execute_write() calls
    and returns the number of rows affected (or None).

    Example:
        def do_writes(conn):
            n = 0
            for p in prices:
                execute_write(conn, "INSERT OR REPLACE ...", (...,))
                n += 1
            return n

        n = write_with_flock(conn, do_writes, label=f"save {route}")
    """
    with flock_ex():
        try:
            result = fn(conn)
            conn.commit()
            return result
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise


@contextmanager
def write_transaction(conn, *, label: str = "tx", flock_timeout_s: float = FLOCK_TIMEOUT_S,
                      max_retries: int = 5):
    """
    The bulletproof write path. Combines all three layers:

      1. Acquire the cross-process flock (excludes other writers).
      2. Inside the flock, send `BEGIN IMMEDIATE` so the SQLite writer lock
         is acquired at the START of the transaction. If we can't get it,
         we fail fast with SQLITE_BUSY — no more mid-batch crashes.
      3. Run the body. On any exception, ROLLBACK. On clean exit, COMMIT.
      4. Release the flock.

    The connection passed in MUST have been opened with isolation_level=None
    (so we can issue explicit BEGIN/COMMIT). fli_db.connect() sets this for
    you; if you used a raw sqlite3.connect(), do `conn.isolation_level = None`
    before calling this.

    Retries: if BEGIN IMMEDIATE raises SQLITE_BUSY (because the read-only
    export script briefly holds a brief write transaction for a checkpoint),
    we release the flock, sleep with backoff, and retry up to max_retries
    times. Total wall-time: ~flock_timeout_s * max_retries.

    Usage:
        with fli_db.write_transaction(conn, label=f"save {route}") as tx:
            for p in prices:
                tx.execute("INSERT OR REPLACE ...", (...))
            # Auto-commits on clean exit. Auto-rolls-back on exception.
    """
    # Pin isolation_level for the duration. We restore on exit so callers
    # who passed in a connection with auto-commit semantics don't get
    # surprised.
    saved_isolation = conn.isolation_level
    conn.isolation_level = None
    last_err = None
    try:
        for attempt in range(max_retries):
            try:
                with flock_ex(timeout_s=flock_timeout_s):
                    # BEGIN IMMEDIATE acquires the SQLite writer lock up-front.
                    # If another connection holds it (e.g. a detail scanner's
                    # mid-row commit that slipped in before the flock), this
                    # raises SQLITE_BUSY fast. busy_timeout=60s means we wait
                    # up to 60s, but in practice the other writer is done in
                    # milliseconds.
                    conn.execute("BEGIN IMMEDIATE")
                    try:
                        yield conn
                    except Exception:
                        try:
                            conn.execute("ROLLBACK")
                        except Exception:
                            pass
                        raise
                    else:
                        conn.execute("COMMIT")
                return  # success — exit retry loop
            except sqlite3.OperationalError as e:
                if "locked" in str(e).lower() and attempt < max_retries - 1:
                    backoff = BUSY_BACKOFF_S * (attempt + 1)
                    _log(f"{label}: BEGIN IMMEDIATE busy (attempt {attempt+1}/"
                         f"{max_retries}), backing off {backoff}s")
                    time.sleep(backoff)
                    last_err = e
                    continue
                raise
            except TimeoutError as e:
                if attempt < max_retries - 1:
                    backoff = BUSY_BACKOFF_S * (attempt + 1)
                    _log(f"{label}: flock timeout (attempt {attempt+1}/"
                         f"{max_retries}), backing off {backoff}s")
                    time.sleep(backoff)
                    last_err = e
                    continue
                raise
        if last_err:
            raise last_err
    finally:
        conn.isolation_level = saved_isolation


# Health check helper — useful for the scanners' "did my last write actually
# land?" paranoia. Cheap (one row from sqlite_stat1).
def db_healthcheck(conn) -> dict:
    cur = conn.cursor()
    try:
        n_flight_dates = cur.execute(
            "SELECT COUNT(*) FROM flight_dates"
        ).fetchone()[0]
    except sqlite3.OperationalError:
        n_flight_dates = -1
    try:
        n_flight_details = cur.execute(
            "SELECT COUNT(*) FROM flight_details"
        ).fetchone()[0]
    except sqlite3.OperationalError:
        n_flight_details = -1
    journal = cur.execute("PRAGMA journal_mode").fetchone()[0]
    busy = cur.execute("PRAGMA busy_timeout").fetchone()[0]
    return {
        "flight_dates": n_flight_dates,
        "flight_details": n_flight_details,
        "journal_mode": journal,
        "busy_timeout_ms": busy,
    }
