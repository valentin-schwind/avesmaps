# Auftrag: toten Code des Ablaufs „Neuer Ort aus dem Wiki" entfernen

## Ausgangslage

Commit `b4a520aa` hat den Kontextmenü-Eintrag **„Hier hinzufügen → Neuer Ort aus dem Wiki"**
entfernt (Knopf in `index.html`, Handler in `js/routing/routing.js`, ★-Symbol in
`css/components/map-context-menu.css`). Grund: das Ortsnamen-Feld im Anlege-Dialog hat jetzt
eine Wiki-Vorschlagsliste, die dasselbe Ziel auf kürzerem Weg erreicht.

Der Eintrag war der **einzige** Einstieg in seinen Ablauf. Alles dahinter ist seither
unerreichbar, schadet aber nichts (`syncWikiSyncCreateLocationContextMenuAction` sucht ein
Element, das es nicht mehr gibt, und bricht sauber ab). **Deine Aufgabe: diesen toten Ablauf
vollständig entfernen.**

## 💣 Die eine Falle: der Namensvetter

Direkt daneben lebt ein **anderer, aktiver** Ablauf mit sehr ähnlichen Namen — „Position für
diesen Fall auf der Karte wählen". Der bleibt **unangetastet**:

| LEBT — nicht anfassen | TOT — entfernen |
|---|---|
| `startWikiSyncLocationPick` | `startWikiSyncCreateLocationSelection` |
| `handleWikiSyncLocationPick` | `openWikiSyncCreateLocationDialogFromCase` |
| `pendingWikiSyncLocationPickCase` | `wikiSyncCreateLocationContextLatLng` |
| Aktion `"pick-position"` | Aktion `"select-wiki-location"` |

Beide Aktionen stehen als benachbarte `if`-Zweige in
`js/review/review-wiki-sync-resolve.js` (~Zeile 38 und ~44). Verwechsle sie nicht.

## Was weg soll

Symbolnamen, nicht Zeilennummern — die Dateien werden parallel bearbeitet, prüfe die Stellen
selbst per `grep`.

**`js/review/review-wiki-sync-cases.js`**
- `hasWikiSyncMissingWikiWithoutCoordinatesCases()`
- `syncWikiSyncCreateLocationContextMenuAction()`
- `startWikiSyncCreateLocationSelection()`
- `clearWikiSyncCreateLocationSelection()`
- `resetWikiSyncCreateLocationFlowState()`
- `openWikiSyncCreateLocationDialogFromCase()`
- die Zweige auf `isWikiSyncCreateLocationSelectionActive` in der Statusmeldung (~32/37) und in
  der Fall-Liste (~58)
- der Zweig, der bei `case_type === "missing_wiki_without_coordinates"` **und** aktivem
  Auswahlmodus die Aktion `select-wiki-location` anbietet (~661)

**`js/review/review-wiki-sync-resolve.js`**
- der `if (action === "select-wiki-location")`-Zweig
- `archiveWikiSyncCreatedLocationCase()` — einziger Aufrufer ist der tote Block unten

**`js/review/review-editor-submit.js`**
- der Block um `wikiSyncCreateLocationCaseId` / `archiveWikiSyncCreatedLocationCase` /
  `resetWikiSyncCreateLocationFlowState` in `handleLocationEditFormSubmit`.
  ⚠️ Der `else`-Zweig ruft ebenfalls `resetWikiSyncCreateLocationFlowState()` — beim Auflösen
  darf das restliche Speichern-Verhalten (Status, Toast, Dialog schließen) **nicht** kippen.

**`js/review/review-locations.js`**
- Aufruf `resetWikiSyncCreateLocationFlowState()` in `resetLocationEditForm` und der Parameter
  `preserveWikiSyncFlow`, falls er danach niemandem mehr dient (prüfen — er wird von
  `openLocationEditDialog` gesetzt).

**`js/app/bootstrap.js`**
- der Escape-Zweig auf `isWikiSyncCreateLocationSelectionActive`
- der Aufruf `syncWikiSyncCreateLocationContextMenuAction()`

**`js/review/review-wiki-sync.js`**
- der Aufruf `syncWikiSyncCreateLocationContextMenuAction()`
- ⚠️ diese Datei wurde am 2026-07-22 von einer Nachbarsession bearbeitet — vor dem Commit
  unbedingt `git diff` lesen (siehe unten).

**`js/app/runtime-state.js`**
- `wikiSyncCreateLocationContextLatLng`, `wikiSyncCreateLocationCaseId`,
  `isWikiSyncCreateLocationSelectionActive`
- **NICHT** `pendingWikiSyncLocationPickCase` — die gehört zum lebenden Ablauf.

## Was NICHT passieren darf

- Die WikiSync-Fallliste muss weiter alle Falltypen anzeigen und auflösen können.
- `pick-position` („Position auf der Karte wählen") muss weiter funktionieren.
- Der Fall-Typ `missing_wiki_without_coordinates` bleibt bestehen — er wird serverseitig bei
  jedem Sync-Lauf neu gebaut (`avesmapsWikiSyncBuildCase`,
  `api/_internal/wiki/locations.php:543`). **Am PHP nichts ändern.**
- Speichern im Ortsdialog muss unverändert laufen (Status, Toast, Dialog schließt).

## Repo-Regeln, die hier greifen

- **Geteilter Arbeitsbaum.** Mehrere Sitzungen schreiben gleichzeitig in dieselben Dateien.
  Niemals `git add -A`/`git add .`/`git commit -a`. Vor **jedem** Commit `git status` **und**
  `git diff -- <datei>` lesen und jeden Hunk als eigenen bestätigen.
  Liegt ein fremder Hunk in derselben Datei: **nicht** `git commit --only` (das nimmt den ganzen
  Arbeitsstand der Datei!), sondern hunk-genau stagen:
  ```
  git diff -- <datei> > p.patch     # auf die EIGENEN Hunks kürzen
  git apply --cached --recount p.patch
  git diff --cached                 # gegenlesen
  git commit -m "…"
  ```
- **Handbuch nicht anfassen.** `html/editor-handbuch.html` gehört seit 2026-07-22 einer
  nächtlichen Routine (AGENTS.md §9). Deine Pflicht ist nur eine sprechende Commit-Betreffzeile.
  Hier ist die nutzersichtbare Wirkung übrigens **keine** — es ist reiner Aufräum-Commit
  (`refactor(editor): …`).
- **Zeilenenden:** Arbeitsbaum ist CRLF, Index LF. Bei Zweifeln `git ls-files --eol <datei>`.
- Kein `?v=` von Hand. Der Deploy stempelt selbst.

## Prüfen

```
node --check <jede berührte .js>
for t in $(find js -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```
⚠️ `js/ui/__tests__/filter-bar.test.js` schlägt derzeit **fremdverschuldet** fehl (eine andere
Sitzung hat `ICON_ASSET_VERSION` in `js/app/utils.js` geändert, der Test vergleicht Markup
byteweise). Das ist nicht deins — prüfe nur, dass es dieser eine bleibt.

Danach lokal gegenprüfen (`php -S 127.0.0.1:<freier port> -t .`, dann `?edit=1`):
1. Rechtsklick → „Hier hinzufügen" zeigt: Neuer Ort · Neue Kreuzung · Neuer Weg · Neues Label ·
   Neues Herrschaftsgebiet. Kein Wiki-Eintrag.
2. Konsole beim Laden fehlerfrei (außer den bekannten „keine API-Konfiguration"-Meldungen, die
   ohne lokale Datenbank normal sind).
3. Ortsdialog öffnen und speichern läuft durch (`fetch` stubben reicht).
4. `grep -rn "WikiSyncCreateLocation" js/` liefert nichts mehr.

## Fertig, wenn

Alle vier Punkte oben stimmen, die Tests bis auf `filter-bar` grün sind, der Commit **nur**
eigene Hunks enthält, und `git show <sha> --stat` gegengelesen wurde.
