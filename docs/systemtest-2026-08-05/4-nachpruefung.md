# Bericht 4 — Nachprüfung: was die Kontrolle der Fixes zutage gefördert hat

Nachdem die ersten Befunde behoben waren, haben drei Prüfer **die Fixes selbst** auseinander-
genommen. Zwei Ergebnisse: sie fanden drei echte Fehler in der Arbeit (protokolliert bei A6/A7
in [Bericht 1](1-akut.md)) — und der Sicherheitsprüfer förderte dabei **eine ganze Klasse
offener Fälle** zutage, die der eigentliche Systemtest übersehen hatte.

Diese Liste ist der wertvollste Einzelfund des ganzen Tages. Sie ist **nicht abgearbeitet**.

---

## Die Frage, die sie beantwortet

Für jedes Loch, das geschlossen wurde: wie viele gleichartige stehen noch offen? Geprüft wurden
317 PHP-Dateien unter `api/`, 5 ausgelieferte Verzeichnisse mit ausführbarem Code, 38
Endpunktdateien und 46 Leseseiten über 16 Kindtabellen — vollständig am Code, ohne eine einzige
Anfrage an den Server.

## Was sauber ist

- **Kein einziges ausgeliefertes Verzeichnis mit PHP steht mehr ungeschützt.**
- **Kein Schreibpfad ohne Anmeldung** mehr, in keinem der 87 geprüften Endpunkte.
- **Keine falsche Catch-Reihenfolge** mehr — der Scan über alle 317 Dateien findet null.
- `api/edit/` ist lückenlos, `api/discord/` prüft Signaturen vor jedem Schreibvorgang,
  `api/import/` prüft Tokens mit `hash_equals` und fällt bei fehlender Konfiguration geschlossen aus.
- `uploads/db-backups/` ist gedeckt, obwohl es **nicht** in der Deploy-Liste steht: die
  Deny-Datei wird zur Laufzeit geschrieben. Das sah zuerst wie eine Lücke aus und ist keine.

## Was offen ist — nach Schwere

### Ungebremste Lasthebel für Fremde (12 Stellen)
Auf einem Server, der dreimal an Last erstickt ist, ist das die realistischste Angriffsfläche —
realistischer als Datendiebstahl.

| Stelle | Was ein Fremder auslöst |
|---|---|
| `api/_internal/political/territories-audit.php:23` | **eine anonyme Anfrage = sieben vollständige Politik-Layer-Bauten** (Schleife über Zoom 0–6), ohne Cache |
| `api/app/coat.php:139` | Bild-Proxy: Cache-Schlüssel über die **volle URL samt Query** → jeder Aufruf ein Fehltreffer, 20 s Zeitlimit, keine Größengrenze, Cache wird nie geräumt. Hält beliebig viele Arbeiter fest und benutzt Avesmaps als Verstärker gegen Wiki Aventurica |
| `api/locations/index.php:26` | der stabile Vertrag: lädt alles, **kein ETag, kein Cache, kein Zeitlimit** — derselbe Pfad, den `route/index.php` mit „152 MB Spitze" beziffert |
| `api/_internal/political/wiki-browser-endpoint.php:121` | Begrenzung **invertiert**: wer `limit` wegLÄSST, bekommt gar kein LIMIT |
| `territories-derived-layer.php:16` | Cache-Schlüssel enthält ungeklemmtes `year_bf` → `?year_bf=1,2,3…` umgeht den Cache beliebig oft, je Aufruf DDL + voller Layer + 2,8 MB in `/tmp` |
| `api/app/map-search.php:72` | sechs unbegrenzte Volllesungen **je Tastendruck**, darunter ~35.000 Lore-Zeilen; die Grenze 20 greift erst danach |
| `api/app/track.php:35` | anonymer Schreiber ohne Bremse, `dimension` ist freier Aufrufertext im UNIQUE-Schlüssel → bis zu 100 neue Zeilen je Anfrage |
| `api/_internal/auth.php:43` | `avesmapsLogin` hat **keinen Versuchszähler** — Brute Force und CPU-Erschöpfung in einem |

### Zwei weitere Ausnahmetext-Lecks (andere Bauart als A12)
- `territories-derived-layer.php:148` — `getMessage()` eines `Throwable` wandert in den **Antwortkörper** *und* in die Cache-Datei. Kein Reihenfolgefehler, deshalb hat der Scan es nicht gefunden.
- `territories-read.php:78` — `?debug=1` ist **frei setzbar** und schaltet Ausnahmetexte in die Antwort. Nebenbei: `debug` geht nicht in den Cache-Schlüssel ein.

### Zwei Diagnose-Dateien im falschen Verzeichnis
`api/app/political-derived-geometry-debug.php` und `api/app/political-zoom-coverage-debug.php`
haben **null** Rechteprüfungen und liegen öffentlich. Ihr korrekter Zwilling,
`api/diagnostics/political-schema.php`, verlangt `admin` **und** liegt hinter `.htaccess`.
Richtige Datei, falsches Verzeichnis.

### Sechs weitere Fälle „Daten gelöschter Objekte werden weiter ausgeliefert"
Dasselbe Muster wie A6, nur andere Tabellen:
`api/_internal/reviews.php:110` und `:127` (**öffentliche Bewertungen eines gelöschten Ortes
bleiben unter seiner alten ID lesbar** — verkettet mit dem Payload-Fund, der die toten IDs
liefert), `adventure-search.php:63` und `adventures.php:430` (517 von 2.006 Abenteuer-Orten
zeigen ins Leere), `citymap-search.php:51` und `citymaps.php:971` (14 von 376),
`ecosystem.php:1229` (3 von 322).

### Ein Umgehungspfad im Meldeformular
`api/app/report-location.php:98` — `report_mode: "change"` im **anonymen** Rumpf hebt die
Stundengrenze, die Dublettenprüfung und die Namenskollisionsprüfung auf.

---

## Zwei Randnotizen, die man leicht überliest

**CORS bremst niemanden.** `avesmapsApplyCorsPolicy` gibt `true` zurück, wenn kein `Origin`-Kopf
da ist — richtig so, aber es heißt: gegenüber `curl` oder einem Skript prüft CORS nie. Wo CORS
die einzige Prüfung ist, gibt es keine Prüfung.

**Sechs `.mjs`-Tests sind rot.** Beim Erweitern des Deploy-Riegels kamen 51 bisher nie
ausgeführte Tests zum Vorschein: 30 unter `tools/**/test-*.php` (alle grün, aufgenommen) und 21
`.mjs` — davon **sechs rot** (`test-place-scope-filter`, `test-review-subjects`,
`test-route-leg-popup`, `test-wiki-sync-panel-tab`, `test-wiki-sync-verb-row`,
`test-client-route-flow`). Echte Zusicherungsfehler, keine Umgebungsprobleme. Sie können erst in
den Riegel, wenn sie grün sind — sonst blockieren sie jeden Deploy. Ebenfalls ungedeckt:
`.github/scripts/__tests__/*.test.py`, die Tests der Asset-Stempelkette aus AGENTS.md §7.
