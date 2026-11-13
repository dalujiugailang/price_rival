"""Merge a read-only cloud tracking-table export, preserving all other local tables."""
import gzip
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / 'data/competition-efficiency/20261113'

def main():
    rows = json.loads(gzip.decompress((FOLDER / 'cloud-tracking-batches.json.gz').read_bytes()))
    connection = sqlite3.connect(ROOT / 'data/price-rival.sqlite')
    connection.row_factory = sqlite3.Row
    old = [dict(row) for row in connection.execute('SELECT * FROM tracking_batches')]
    backup = FOLDER / 'local-tracking-before-sync.json.gz'
    if backup.exists():
        raise RuntimeError('Backup already exists; inspect the previous run before syncing again')
    backup.write_bytes(gzip.compress(json.dumps(old, ensure_ascii=False).encode()))
    columns = [row[1] for row in connection.execute('PRAGMA table_info(tracking_batches)')]
    if any(set(row) != set(columns) for row in rows):
        raise RuntimeError('Cloud/local tracking schemas differ')
    old_ids = {row['id'] for row in old}
    with connection:
        # Release the confirmed-scope unique constraint before applying the authoritative state.
        connection.executemany('UPDATE tracking_batches SET is_confirmed=0 WHERE id=?', [(r['id'],) for r in rows])
        names = ','.join('"' + col + '"' for col in columns)
        updates = ','.join('"' + col + '"=excluded."' + col + '"' for col in columns if col != 'id')
        sql = f'INSERT INTO tracking_batches ({names}) VALUES ({",".join("?" for _ in columns)}) ON CONFLICT(id) DO UPDATE SET {updates}'
        connection.executemany(sql, [[row[col] for col in columns] for row in rows])
    report = {'cloudRows': len(rows), 'newIds': sum(r['id'] not in old_ids for r in rows),
              'activeRows': connection.execute('SELECT COUNT(*) FROM tracking_batches WHERE deleted_at IS NULL').fetchone()[0],
              'latestSavedAt': connection.execute('SELECT MAX(created_at) FROM tracking_batches WHERE deleted_at IS NULL').fetchone()[0],
              'integrity': connection.execute('PRAGMA quick_check').fetchone()[0]}
    (FOLDER / 'sync-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))

if __name__ == '__main__':
    main()
