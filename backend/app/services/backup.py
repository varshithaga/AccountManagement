"""Backups: the database (pg_dump, or a copy of the SQLite file) and the uploaded files (media/) of every
company, into one folder per backup under BACKUP_DIR, with a RESTORE.txt per company saying how to put
it back.

Restoring is deliberately not a command - it replaces everything in the database, so it is done by
hand, following RESTORE.txt, into a database you have checked first.
"""
import glob
import os
import shutil
import sqlite3
import subprocess
import zipfile
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.engine import make_url

from ..config import get_settings


class BackupError(Exception):
    pass


def find_pg_tool(name: str) -> str:
    """pg_dump / pg_restore: PG_BIN_DIR, then PATH, then the usual Windows install folders. The newest
    version wins - an older pg_dump refuses to dump a newer server."""
    settings = get_settings()
    exe = f'{name}.exe' if os.name == 'nt' else name
    if settings.pg_bin_dir:
        candidate = Path(settings.pg_bin_dir) / exe
        if candidate.is_file():
            return str(candidate)
        raise BackupError(f'{exe} is not in PG_BIN_DIR ({settings.pg_bin_dir}).')
    found = shutil.which(name)
    if found:
        return found
    installed = sorted(glob.glob(f'C:/Program Files/PostgreSQL/*/bin/{exe}'),
                       key=lambda p: int(Path(p).parent.parent.name) if Path(p).parent.parent.name.isdigit() else 0)
    if installed:
        return installed[-1]
    raise BackupError(f'{name} was not found. Set PG_BIN_DIR in backend/.env to the PostgreSQL "bin" folder '
                      '(e.g. C:/Program Files/PostgreSQL/18/bin).')


def _dump_postgres(url, target: Path) -> None:
    env = {**os.environ, 'PGPASSWORD': url.password or ''}
    args = [find_pg_tool('pg_dump'), '--format=custom', '--no-owner', '--file', str(target),
            '--host', url.host or 'localhost', '--port', str(url.port or 5432), '--username', url.username or 'postgres',
            url.database]
    done = subprocess.run(args, env=env, capture_output=True, text=True)
    if done.returncode != 0:
        target.unlink(missing_ok=True)
        raise BackupError(f'pg_dump failed: {done.stderr.strip() or done.returncode}')


def _copy_sqlite(url, target: Path) -> None:
    # SQLite's own backup API: a consistent copy even while the app is running. closing(): a sqlite3
    # connection's own "with" only commits, it doesn't close the file.
    with closing(sqlite3.connect(url.database)) as source, closing(sqlite3.connect(target)) as copy:
        source.backup(copy)


def _zip_media(media_root: Path, target: Path, exclude: set[str] = frozenset()) -> int:
    """Zips a media folder; `exclude` = top-level folders to leave out (other companies' uploads)."""
    count = 0
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as zf:
        if media_root.is_dir():
            for path in sorted(media_root.rglob('*')):
                if path.relative_to(media_root).parts[0] in exclude:
                    continue
                if path.is_file():
                    zf.write(path, path.relative_to(media_root).as_posix())
                    count += 1
    return count


RESTORE_NOTES = """LedgerDesk backup taken {stamp}
=====================================

Contents
  {db_file:<22} the database ({db_kind})
  media.zip              uploaded files ({files} files) - unzip into MEDIA_ROOT ({media_root})

Restore (replaces everything - check you have the right backup first)
  1. Stop the backend.
{db_steps}
  3. Unzip media.zip into {media_root} (replacing its bank_statements folder - leave other companies' folders alone).
  4. cd backend, then: python cli.py migrate   (brings an older backup up to the current schema)
  5. Start the backend and sign in to check.
"""

PG_STEPS = """  2. Restore the database into an EMPTY database (create one in pgAdmin, or: createdb -U {user} {db}_restored):
       pg_restore --no-owner --clean --if-exists -h {host} -p {port} -U {user} -d {db}_restored database.dump
     then point DATABASE_URL in backend/.env at {db}_restored (or restore into {db} itself once you are sure)."""

SQLITE_STEPS = """  2. Copy database.sqlite3 over {path} (keep the old file until you have checked)."""


def _backup_database(url_text: str, folder: Path) -> tuple[str, str, str]:
    """Dumps one database into folder; returns (file name, what it is, the restore steps)."""
    url = make_url(url_text)
    if url.get_backend_name() == 'postgresql':
        _dump_postgres(url, folder / 'database.dump')
        steps = PG_STEPS.format(host=url.host or 'localhost', port=url.port or 5432, user=url.username or 'postgres',
                                db=url.database)
        return 'database.dump', f'PostgreSQL "{url.database}", pg_dump custom format', steps
    if url.get_backend_name() == 'sqlite':
        _copy_sqlite(url, folder / 'database.sqlite3')
        return 'database.sqlite3', 'SQLite file', SQLITE_STEPS.format(path=Path(url.database).resolve())
    raise BackupError(f'Backups of {url.get_backend_name()} databases are not supported.')


def _backup_company(url: str, media: Path, folder: Path, stamp: datetime, exclude: set[str]) -> dict:
    folder.mkdir(parents=True, exist_ok=True)
    db_file, kind, steps = _backup_database(url, folder)
    files = _zip_media(media, folder / 'media.zip', exclude)
    (folder / 'RESTORE.txt').write_text(RESTORE_NOTES.format(
        stamp=f'{stamp:%d %b %Y %H:%M}', db_file=db_file, db_kind=kind, files=files,
        media_root=media.resolve(), db_steps=steps), encoding='utf-8')
    return {'database': db_file, 'media_files': files}


def backup(keep: Optional[int] = None) -> dict:
    """Writes BACKUP_DIR/<YYYY-MM-DD_HHMMSS>/ with database.dump (or .sqlite3), media.zip and RESTORE.txt of
    the main company, and the same for every other company under companies/<key>/.
    keep: delete all but the newest `keep` backups afterwards."""
    from ..database import DEFAULT_COMPANY, active_company_keys, company_url

    settings = get_settings()
    stamp = datetime.now()  # local time - the folder name is what people look for
    folder = Path(settings.backup_dir) / f'{stamp:%Y-%m-%d_%H%M%S}'
    n = 1
    while folder.exists():  # two backups within the same second
        n += 1
        folder = Path(settings.backup_dir) / f'{stamp:%Y-%m-%d_%H%M%S}_{n}'
    keys = active_company_keys()
    others = [k for k in keys if k != DEFAULT_COMPANY]
    media = Path(settings.media_root)
    companies = {}
    try:
        # The main company's uploads are MEDIA_ROOT itself, minus the other companies' folders in it.
        companies[DEFAULT_COMPANY] = _backup_company(settings.database_url, media, folder, stamp, set(others))
        for key in others:
            companies[key] = _backup_company(company_url(key), media / key, folder / 'companies' / key, stamp, set())
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise

    removed = []
    if keep:
        backups = sorted(p for p in Path(settings.backup_dir).iterdir() if p.is_dir() and (p / 'RESTORE.txt').exists())
        for old in backups[:-keep]:
            shutil.rmtree(old)
            removed.append(old.name)
    size = sum(p.stat().st_size for p in folder.rglob('*') if p.is_file())
    main = companies[DEFAULT_COMPANY]
    return {'folder': str(folder.resolve()), 'database': main['database'], 'media_files': main['media_files'],
            'companies': companies, 'bytes': size, 'removed': removed}
