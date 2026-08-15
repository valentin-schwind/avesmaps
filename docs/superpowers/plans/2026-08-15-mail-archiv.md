# Bauplan: Postfach-Archiv

**Entwurf:** `docs/superpowers/specs/2026-08-15-mail-archiv-design.md`
**Gebaut:** 2026-08-15, eine Sitzung, inline.

Der Plan trägt bewusst **keine abgeschriebenen Code-Blöcke** gegen den Bestand — ein Codeblock im
Bauplan ist eine Vermutung. Wo etwas Vorhandenes vorausgesetzt wird, steht der Prüfbefehl daneben.

## T1 — Archiv-Ordner auflösen (`api/_internal/mail/imap.php`)

- `AVESMAPS_IMAP_ARCHIVE_NAMES` = `archive`, `archiv`, `archives`, `archivierte objekte`,
  `archivierte elemente`.
- `avesmapsImapResolveArchiveMailbox(array $folders, string $configured = '')` über den vorhandenen
  `avesmapsImapResolveFolder()`.
  Prüfbefehl, dass es den gibt: `git grep -n "function avesmapsImapResolveFolder" api/_internal/mail/imap.php`
- `archive_mailbox` in `avesmapsResolveImapConfig()`, Vorgabe leer (⇒ wird gesucht, nicht geraten).
- 🔴 **Kein Rückfall auf ein Literal** wie bei `avesmapsImapSentMailboxFrom()`. Dort ist der Rückfall
  richtig, weil die verlorene Kopie nur eine Bequemlichkeit ist; hier würde er eine Mail in einen
  erfundenen Ordner verschieben.

**Abnahme:** `api/_internal/mail/__tests__/imap-archive-mailbox-test.php`, mutationsscharf.

## T2 — Ordner wechseln und verschieben (`api/_internal/mail/imap.php`)

- `avesmapsImapMoveToFolder($imap, int $uid, string $folder): bool` — der bisherige
  `avesmapsImapMoveToTrash()`-Rumpf, Name verallgemeinert; der alte Name bleibt als Hülle stehen
  (sein Test und sein Aufrufer bleiben unangetastet).
- `avesmapsImapSelectFolder($imap, string $ref, string $folder): bool` über `imap_reopen`.

## T3 — Endpunkt (`api/edit/mail/mailbox.php`)

- `box`-Schlüssel: Hilfsfunktion, die `inbox|archive` entgegennimmt, alles andere mit `400`
  abweist, bei `archive` den Ordner auflöst (`422 no_archive_mailbox`, wenn keiner da ist) und den
  Strom umschaltet (`502 archive_open_failed`, wenn das misslingt). 💣 Nie einen Client-String als
  Ordnernamen.
- Aktionen: `archive` (POST `{uid}`), `unarchive` (POST `{uid}`), `archived` (GET, Liste + `mailbox`),
  `sent-archive` / `sent-unarchive` (POST `{id}`), `sent-archived` (GET).
- `sent-archived` **vor** dem IMAP-Verbindungsaufbau beantworten, wie `sent` es heute tut — die
  DB-Hälfte des Archivs überlebt so eine IMAP-Störung.
- `archived_at DATETIME(3) NULL` in die DDL **und** `avesmapsEnsureMailReplyArchiveColumn()` per
  `SHOW COLUMNS` nachrüsten (§6 des Entwurfs).
- `avesmapsMailListSent()` filtert `archived_at IS NULL`.

## T4 — Oberfläche (`index.html`, `css/features/mail-inbox.css`)

- Dritter Reiterknopf `data-mail-tab="archiv"`, Bereich `data-mail-pane="archiv"` mit zwei
  Abschnitten (`mail-archive-list`, `mail-archive-sent-list`) je unter einer Überschrift.
- `.mail-inbox__action` als geteilter weicher Knopf-Look; `.mail-inbox__trash` behält nur den
  Gefahr-Ton beim Überfahren, `.mail-inbox__archive` bekommt einen neutralen.
  ⚠️ Nur Token, kein Literal (AGENTS.md §12).
- Kein `?v=` von Hand — der Deploy stempelt `index.html` und alles, was daran hängt (AGENTS.md §7).

## T5 — Client (`js/review/review-mail.js`)

- Archiv-Knopf je Zeile in *Empfangen* und *Gesendet*; Reihenfolge Archiv links, Papierkorb rechts.
- Reiter *Archiv* lädt beide Abschnitte, zeigt bei `mailbox: ""` den Satz „Im Postfach gibt es keinen
  Ordner ‚Archiv'."
- `box: "archive"` bei `message` und `image` im Archiv.
- `jumpToSent()` sucht im Archiv weiter, wenn die Antwort in *Gesendet* fehlt.

**Abnahme:** `js/review/__tests__/mail-archiv-form.test.js` — zwei Handlungen je Zeile in richtiger
Reihenfolge, gestapelte Geometrie im Archiv-Reiter, Sprung auf eine archivierte Antwort.

## T6 — Testfeld und Auslieferung

💣 Vor dem Push läuft das **ganze** Testfeld, nicht nur die eigenen Tests (AGENTS.md §9) — inklusive
`tools/wikidump/test-*.php`, die das `__tests__`-Muster nicht findet. PHP mit
`mbstring`/`pdo_sqlite`/`gd`, sonst melden 45 Tests rot, die nur die Erweiterung vermissen.
Vorbestehend rot bleibt genau `linkcheck/link-url-test.php` (echter DNS-Abruf).

Dann ein Commit, ein Push, und der Blick des Owners auf die Live-Seite.
