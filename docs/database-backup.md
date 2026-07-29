# Database backup

A full, restorable dump of the Avesmaps database, produced from PHP and downloaded
as one gzip-packed `.sql` file.

- **Entry point:** the edit shell's top bar, next to 📖 Handbuch → **💾 Datenbank-Backup**
  (`edit/backup.php`). **Admin only.**
- **Endpoint:** `api/edit/admin/database-backup.php` (capability `admin`).
- **Library:** `api/_internal/backup/db-dump.php`.
- **Unit test:** `api/_internal/backup/__tests__/db-dump-test.php`.
- **Storage:** `uploads/db-backups/`, HTTP-denied, gitignored, the three newest kept.

## What the file contains

Every base table with `DROP TABLE IF EXISTS` + `CREATE TABLE` + its rows, then views,
triggers and stored routines. Schema *and* data, so an empty database is a valid
restore target.

Deliberately **no** `CREATE DATABASE` and no `USE` — the dump lands in whichever
database the client has selected, which is what makes the phpMyAdmin route work.
The preamble sets `FOREIGN_KEY_CHECKS=0` (so table order does not matter) and
`SQL_MODE='NO_AUTO_VALUE_ON_ZERO'`; the trailer restores everything it changed and
ends with a `-- AVESMAPS BACKUP END` marker.

## Restoring

```bash
gunzip -c avesmaps-<db>-<stamp>.sql.gz | mysql -u <user> -p <database>
```

Or in phpMyAdmin: select the target database → *Import* → upload the `.sql.gz`
(watch the upload limit; for a large dump use the command line).

## Why it works the way it does

**Why not `mysqldump`.** STRATO shared hosting gives us no shell, so the dump has to
be produced from PHP over the same PDO connection the app uses.

**Why it runs in steps.** A full dump is far more work than one PHP request may
spend, so a backup is a *run*: `db_backup_run` holds the phase plus the object and
row cursors, and the page POSTs `step` until the run reports `done`. Same shape as
the WikiSync passes. Row pagination is keyset (`WHERE pk > :cursor ORDER BY pk`)
wherever a single-column primary key allows it, so a table read across several steps
neither skips nor repeats a row.

**Why the `.gz` is built the pigz way.** A deflate stream cannot be resumed by a
later PHP process. The naive chunked writer therefore appends one complete *gzip
member* per flush — valid per the spec, and `gunzip`, `zcat`, zlib and PHP's
`gzopen` all read such a file whole. But PHP's own `gzdecode()` and 7-Zip's GUI read
only the **first** member and hand back a silently truncated dump, which for a
backup is the worst failure there is. So the writer emits **one** member instead:

1. the fixed 10-byte gzip header, once;
2. per flush a fresh raw-deflate context and `deflate_add($sql, ZLIB_SYNC_FLUSH)` —
   byte-aligned output with no back-references outside its own chunk, so the
   fragments concatenate into one valid deflate stream;
3. at the end a final empty block (sets `BFINAL`) plus the gzip trailer: CRC-32 and
   length, little-endian.

The CRC is carried in the run row and extended per fragment with `crc32_combine`
(GF(2) matrix form), so the trailer is correct without ever re-reading the payload.
The unit test asserts `gzdecode()` returns the *complete* payload — that single
assert is what proves the file is single-member.

**Why a step appends before it persists.** If the process died between the two in
the other order, a fragment would be missing and the dump would silently lose rows.
This way the file can only ever be *longer* than the persisted `gz_bytes`, and each
step starts by truncating it back to that value — exact, because fragments are
byte-aligned. Then the replayed step re-emits them. Never reorder the pair, and
never drop the reconcile.

**Verification is part of the run.** The last phase inflates the finished file
end-to-end and requires that it decodes cleanly, that the decompressed length equals
the bytes compressed, that its CRC matches the accumulated one, and that the last
line is the end marker. A run reaches `completed` only when all four hold, so
"completed" means "this file restores".

## Caveats

- **Hot backup.** Each step runs on its own request and therefore its own MySQL
  connection, so no transaction spans the run. Within one table the read is stable;
  two tables are not guaranteed to be from the same instant. A row written by an
  editor mid-run may or may not be in the dump.
- **The file is a secret.** It contains `users.password_hash`, every share link and
  every report. `uploads/db-backups/` is HTTP-denied and gitignored; the only way to
  the file is the admin-gated download action. See `docs/repository-data-policy.md`.
- **Optional objects are best-effort.** If the hosting account may not list views,
  triggers or routines, the run records a warning and continues rather than failing.
  Definers are stripped from what it does dump — a kept `DEFINER=` clause fails on
  every host but this one, which is every host a backup is restored on.
- **Views on views** are emitted in alphabetical order. This database has none
  today; two dependent ones would need explicit ordering.
- **The "skip transient tables" option** leaves the WikiSync caches
  (`wiki_dump_hybrid_state`, `wiki_dump_title_alias`, `wiki_sync_pages`,
  `wiki_*_staging`) empty but still emits their `CREATE TABLE`, so the restore is a
  complete working schema. The list is deliberately tiny: everything on it is
  rebuilt by a "Dump holen" run. `political_territory_wiki` (manual overrides),
  `wiki_sync_cases` (editor decisions) and the `*_audit_log` tables (history) are
  **not** on it and never should be — mislabelling a table transient means silent
  data loss in a backup.
