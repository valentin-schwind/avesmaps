# Avesmaps — Fortsetzung des Systemtests vom 05.08.2026

> Übergabe an eine neue Session. Selbsttragend: alles, was gebraucht wird, steht hier oder
> ist von hier aus verlinkt.

## Wo wir stehen

Am 05.08.2026 lief ein Rundum-Systemtest (12 Prüfagenten + 2 Gegenprüfer). Ergebnis und
Belege liegen vollständig im Repo: **[`docs/systemtest-2026-08-05/`](systemtest-2026-08-05/README.md)** —
lies zuerst `README.md`, dann `1-akut.md`. 222 Befunde, davon 33 AKUT nach feindlicher
Gegenprüfung. **13 AKUT sind erledigt** (im Bericht mit ✅ und Commit markiert), 20 offen.

Danach wurden die Fixes selbst geprüft. Das Ergebnis steht in
**[`4-nachpruefung.md`](systemtest-2026-08-05/4-nachpruefung.md)** und ist der wertvollste
offene Posten: 12 ungebremste Lasthebel für anonyme Aufrufer, 2 weitere Ausnahmetext-Lecks,
2 Diagnose-Dateien im öffentlichen statt im geschützten Verzeichnis, 6 weitere Tabellen, die
Daten gelöschter Objekte ausliefern.

## Deine Aufgabe

**Befunde A1 bis A5 aus `1-akut.md`: die Community-Meldungsstrecke.**

Das ist der einzige Zusammenhang im ganzen Test, bei dem **echte Menschen echte Arbeit
verlieren, ohne es zu merken** — und von keiner Seite sichtbar ist: weder der Melder noch
die Redaktion kann feststellen, dass etwas verschwunden ist.

- **A1** Eine verworfene Meldung antwortet **wortgleich** wie ein Erfolg. Nur der
  Statuscode unterscheidet sie (200 = weggeworfen, 201 = gespeichert), und der Client
  wertet ihn nicht aus. Genau falsch herum: der Mensch merkt nichts, der Bot lernt sofort.
- **A2** Die Stundengrenze (5/IP) zählt Änderungsvorschläge mit, blockiert sie aber nicht.
  Fünf Korrekturen verbrauchen das Kontingent für neue Orte.
- **A3** Eine bearbeitete Meldung ist danach unauffindbar — der Endpunkt liefert nur
  `status='neu'`, es gibt keine Liste erledigter Meldungen.
- **A4** Annehmen/Ablehnen erzeugt **keinen** Eintrag im Änderungsprotokoll.
- **A5** Der Erläuterungstext des Melders landet ungefragt in der öffentlichen Beschreibung.

> **✅ A1 und A2 sind erledigt (05.08.2026 abends): `776c2b89`, `c6ceb981`, `a07348ef`.**
> Owner-Entscheid zur Produktfrage: **Bot still, Mensch ehrlich** — die drei Bot-Fallen antworten
> zeichen- und codegleich wie ein Erfolg, die Stundengrenze und der Nur-Link-Kommentar bekommen
> eine echte Absage. Zahlen und Vorbehalte stehen bei A1/A2 in `1-akut.md`. Die drei feindlichen
> Gegenprüfungen dieser Fixes haben **A29–A31** neu gefunden; A29 (der Schlüssel der Stundengrenze
> steht in einem Anfrage-Kopf) trifft vier Drosseln auf einmal und gehört nach oben.
>
> **Es geht weiter bei A3+A4** — eine Erweiterung von `api/edit/reports/locations.php` plus
> Editor-Oberfläche, mittelgroß. Danach A5 (klein).

A1+A2 waren ein Endpunkt (`api/app/report-location.php`) und klein. A3+A4 sind eine
Erweiterung (`api/edit/reports/locations.php` + Editor-Oberfläche) und mittelgroß.
**Liefere einzeln aus und prüfe live nach.**

💣 **Es gibt keinen Löschweg für `map_reports`** (das ist A3). Jede echte Meldung, die eine Probe
anlegt, bleibt für immer. Vier der fünf A1-Wege legen nichts an und sind deshalb frei prüfbar; die
Stundengrenze und ihre Zählsemantik sind es nicht — dafür braucht es fünf bis sechs Zeilen. Frag
den Owner, bevor du sie anlegst.

## Pflichtlektüre vor der ersten Zeile Code

1. `AGENTS.md` — besonders §9 (Konventionen) und §10 (bekannte Fragilitäten).
   ⚠️ §10 nennt zwei Fehler als offen, die behoben sind, und fünf Zahlen darin sind falsch
   (siehe `2-kann.md` Abschnitt 2). Glaub dem Brief nicht blind.
2. [`1-akut.md`](systemtest-2026-08-05/1-akut.md), Abschnitt 1 — die fünf Befunde im
   Wortlaut mit Fundstellen und Belegen.
3. Das Ausfallprotokoll bei **A6/A7** in derselben Datei. Drei Fehler an einem Tag, jeder
   mit seiner Lehre. Lies sie, sie sind teuer bezahlt.

## Die Fallen, die am 05.08. je einen Ausfall gekostet haben

💣 **Miss und repariere denselben Pfad.** Ein Fix landete auf einem Endpunkt, den seit dem
Payload-Umbau niemand mehr aufruft, während das Leck in `map-features.php` saß. **Bevor du
etwas reparierst: grep, wer den Code überhaupt aufruft.**

💣 **`feature_sources` ↔ `map_features` brauchen `COLLATE utf8mb4_unicode_ci`** beim
Spaltenvergleich, auf der `feature_sources`-Seite. Ohne das: „Illegal mix of collations",
entschieden beim Planen, also 500 bei jedem Aufruf. Steht dreimal im Code dokumentiert.

💣 **Ein grüner sqlite-Test beweist nichts über MySQL.** Der Kollationsfehler lief den
ganzen Ausfall über grün. Wenn eine Eigenschaft nur auf MySQL existiert, kann sqlite sie
nicht prüfen — schreib das in den Test statt ihm zu glauben.

💣 **`.htaccess` erlaubt nicht jede Apache-Direktive.** Eine unerlaubte wirft 500 für
**alles** im Verzeichnis, nicht nur für sich selbst.

💣 **STRATO ist Shared Hosting und dreimal an eigener Testlast erstickt.** Nie einen
Endpunkt in einer Schleife abfragen. Eine Probe genügt. Ein Edit-Tab feuert ~19
gleichzeitige Anfragen. Löse **nie** Dump/Sync/Autoget/Massenlauf/Backup/Linkchecker aus.
Es arbeiten echte Redakteure gleichzeitig auf derselben Datenbank.

💣 **Geteilter Arbeitsbaum.** Mehrere Sessions teilen dieses Checkout. Nie `git add -A`,
nie `git add .`, nie `git commit -a`. Immer `git status` zuerst und nur eigene Pfade
nach Pfad einzeln stagen.

## Wie geprüft und ausgeliefert wird

- Volle Testsuite vor jedem Commit:
  ```
  php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
      -d extension=php_curl.dll -d extension=php_pdo_sqlite.dll \
      -d extension=php_sqlite3.dll -d extension=php_gd.dll <test>
  ```
  über alle `api`/`tools`-Tests, plus `node <test>` für JS.
- **Der Deploy fährt seit 05.08. alle 197 Tests, bevor er hochlädt** — ein roter Test
  blockiert die Auslieferung. Das ist Absicht.
- Push nach `master` → ~1–2 Min Deploy, **PHP wirkt 2–4 Min verzögert**. Nicht im
  Deployfenster messen, sonst misst du einen halb hochgeladenen Zustand.
- Live gegenprüfen, mit Zahlen. „Sieht gut aus" ist kein Beweis.
- Es gibt **keine lokale Datenbank** — alles DB-Gebundene ist nur live prüfbar.

## Wenn du fertig bist

Markiere die erledigten Befunde in `1-akut.md` mit ✅, dem Commit und der Zahl, die es
belegt — so wie A6/A7 und A11/A12 es vormachen. Ein Bericht, der Arbeit fordert, die
schon getan ist, ist genau der Fehler, den dieser Test bei AGENTS.md §10 gefunden hat.

Schick am Ende Agenten los, die deine eigene Arbeit gegenprüfen. Am 05.08. haben genau
die drei Fehler gefunden, die ich selbst übersehen hatte.

Kommentare, Doku und Commit-Nachrichten auf **Englisch** (AGENTS.md §8), Antworten an den
Owner auf **Deutsch**.

## Danach, in dieser Reihenfolge

1. **Die 6 roten `.mjs`-Tests grün machen** — klein, gut abgegrenzt, und danach können sie
   in den Deploy-Riegel (`test-place-scope-filter`, `test-review-subjects`,
   `test-route-leg-popup`, `test-wiki-sync-panel-tab`, `test-wiki-sync-verb-row`,
   `test-client-route-flow`; alle unter `tools/`). Es sind echte Zusicherungsfehler, keine
   Umgebungsprobleme — sie sind nur nie jemandem aufgefallen, weil sie nie liefen.
2. **Die Lasthebel aus [Bericht 4](systemtest-2026-08-05/4-nachpruefung.md)** — der
   schlimmste ist `territories-audit.php:23`: **eine** anonyme Anfrage baut den Politik-Layer
   siebenmal, ohne Cache.
3. **A16** (Änderungsprotokoll für Karten, Abenteuer, Vorkommen) — groß, braucht einen
   eigenen Entwurf: 5.104 + 1.352 + 457 Zeilen haben heute keinen Weg zurück.
