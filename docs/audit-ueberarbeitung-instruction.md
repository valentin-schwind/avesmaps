# Audit-Überarbeitung — Instruction

> **Status: ENTWURF, nicht gebaut.** Dieses Dokument beschreibt, *was* zu bauen wäre.
> Owner-Freigabe steht aus. Stand: 2026-07-14.

## 1. Warum

Der heutige „Änderungen"-Reiter speist sich aus zwei Quellen und kennt nur **eine**
Undo-Einheit: die einzelne Zeile. Das reicht nicht — aus drei Gründen, die alle schon
real aufgetreten sind.

### Der Auslöser: der Große-Fluss-Vorfall (2026-07-05)

Der Owner wollte **ein** falsch zugewiesenes Segment (am Gadang) vom „Großen Fluss"
lösen und benutzte „Entfernen". Die Semantik war damals **weg-weit** und löste **alle 32
Segmente** auf: `wiki_path` weg, Namen zurück auf Generika (`Flussweg-5054`…`5085`).

Gerettet hat die Daten, dass der Vorgang **pro Segment einen eigenen Audit-Eintrag mit
`before_json`** schrieb (`map_audit_log` 16879–16910). Die Reparatur bestand dann aber aus
**30 von Hand zusammengesuchten** `undo_audit_change`-Aufrufen plus einem `assign`.

Daraus folgen die drei Lehren, die diese Überarbeitung trägt:

1. **Der Audit-Log war das Sicherheitsnetz — nicht der Fehler.** Der Fehler war eine
   destruktive Voreinstellung (Reichweite 32 Objekte, Kopfmodell 1 Objekt). Das ist
   inzwischen gefixt (`a712548f`: „Entfernen wirkt nie ungefragt weg-weit").
2. **Es fehlt die Undo-Einheit „Vorgang".** Ein logischer Vorgang, der 32 Objekte anfasst,
   muss sich mit **einem** Klick zurücknehmen lassen, nicht mit 30 kopierten IDs.
3. **Es fehlt die Undo-Einheit „Objekt".** Bei mehreren Editoren ist eine lineare Zeitachse
   das falsche Modell (siehe §3).

### Die zweite Lücke: halbe Abdeckung

Große Teile des Systems schreiben **ohne jede Spur**. Verifiziert in §2.

## 2. Bestandsaufnahme (verifiziert 2026-07-14)

### Was heute protokolliert wird

| Bereich | Log | Schreiber |
|---|---|---|
| Karten-Elemente (`map_features`) | `map_audit_log` | `avesmapsWriteMapAuditLog` (`api/_internal/map/features.php:2147`), `avesmapsWikiSyncWriteMapAuditLog` (`api/_internal/wiki/locations-helpers.php:204`), gemeinsamer Helfer `avesmapsWikiSyncAuditFeaturePropsChange` (`locations-helpers.php:183`) |
| Territoriums-**Geometrie** | `political_territory_geometry_audit_log` | `avesmapsPoliticalWriteGeometryAuditLog` (`api/_internal/political/territories-audit.php:426`) |

**Die Karten-Ebene ist gut abgedeckt.** Alle relevanten Schreibpfade laufen über den
gemeinsamen Helfer: `paths.php`, `regions.php`, `path-flow.php`, `path-verlauf.php`,
`settlement-coat-upload.php`, `settlement-images.php`, `locations.php`, `settlements.php`.
Das ist ausdrücklich **kein** Problembereich.

### Was heute KEINE Spur hinterlässt

Alle Zeilen einzeln geprüft (Datei enthält keinerlei Audit-Aufruf):

| Vorgang | Datei | Mutiert |
|---|---|---|
| **Territoriums-Modell / Hierarchie** (Eltern setzen, aussortieren, sperren) | `api/_internal/wiki/sync-monitor-model.php` | `political_territory`, `wiki_territory_model` |
| **„Identität übernehmen"** | `api/_internal/wiki/sync-monitor-identity.php` | `political_territory` |
| **Territorien-Wiki-Sync** | `api/_internal/wiki/territories-dom.php` | `political_territory` |
| **Subtree-Display** ⚠️ | `api/edit/political/subtree-display.php` | `political_territory` |
| **Zoom-Sync** | `api/edit/political/assignment-zoom-sync.php` | `political_territory` |
| **Abenteuer** (Anlegen/Ändern/Löschen, Orte, Reihenfolge, Cover) | `api/_internal/app/adventures.php` | `adventure`, `adventure_place` |
| **Quellen** (Anlegen/Löschen/Unterdrücken, `other_source`-Übernahme) | `api/_internal/app/feature-sources.php` | `feature_sources`, `sources` |
| **Bewertungs-Moderation** (verbergen, löschen) | `api/_internal/reviews.php`, `api/edit/reviews.php` | `map_reviews` |
| **Meldungs-Moderation** (Status setzen, erledigen) | `api/edit/reports/locations.php` | `map_reports`, `location_reports` |
| **Globale Einstellungen** (z. B. Bild-Kill-Switch) | `api/_internal/wiki/settlements.php`, `api/_internal/app/adventures.php` | `app_setting` |

⚠️ **`subtree-display.php` ist besonders schmerzhaft:** Genau dieser Endpoint verursacht
laut AGENTS.md §10 die bekannte **Albenhus/Zwerch-Anomalie** („ein Speichern schreibt
aufgelöste Darstellungen global auf alle Vorfahren"). Der Vorgang, der die Daten
verbiegt, hinterlässt **keine Spur** — deshalb ist die Anomalie bis heute nicht
rekonstruierbar.

### Undo heute

- Einstieg: `POST /api/edit/map/features.php` `{action:"undo_audit_change", audit_id:N}`.
- Stellt `before_json` zurück (Name + `properties_json`).
- **Konflikt-Check:** `avesmapsAssertUndoPatchStillCurrent`
  (`api/_internal/map/features.php:408`) vergleicht den `after`-Schnappschuss mit dem
  aktuellen Stand und **lehnt ab**, wenn sich seither etwas geändert hat. Fehlen Spalten
  im Schnappschuss, wirft er „nicht genug Audit-Daten für ein unabhängiges
  Rückgängigmachen".
- Gilt **nur** für `map_features`. Für Territoriums-Geometrie existiert ein eigener,
  paralleler Pfad; für alles aus der Lückenliste gibt es **kein** Undo.

### Aufbewahrung heute

- `political_territory_geometry_audit_log`: **hat bereits einen rollierenden Deckel** —
  `avesmapsPoliticalPruneGeometryAuditLog(..., $keepRows = 250)`
  (`territories-audit.php:455`, geklemmt 100…1000).
- `map_audit_log`: **kein Prune, wächst unbegrenzt.**

## 3. Das Modell: Objekt-Historie statt linearer Zeitachse

### Warum linear nicht reicht

Lineares Undo ist das **Editor**-Modell: ein Nutzer, eine Sitzung, eine Zeitachse.
Avesmaps ist aber ein **Inhaltssystem** mit mehreren Editoren. Der Owner-Fall:

```
Valentin ändert Objekt A
Thomas   ändert Objekt B
Valentin ändert Objekt C
Valentin löscht Objekt D
```

Valentin muss A zurücknehmen und D wiederherstellen können, **ohne** B und C anzufassen.
Eine lineare Zeitachse kann das nicht.

Das gesuchte Modell ist keine Exotik — **es ist das Modell jedes Wikis** (jede Seite hat
ihre eigene Versionsgeschichte) und von Git (Historie pro Datei, einzelner Commit
revertierbar). Wiki Aventurica selbst arbeitet so.

Die Grundlage liegt bereits: `map_audit_log` hat `feature_id`, `before_json`, `after_json`,
`created_at` — das **ist** faktisch schon ein objektbezogener Event-Store. Er wird nur nie
objektweise gelesen.

### Drei Undo-Ebenen

| Ebene | Frage | Einheit |
|---|---|---|
| **Änderung** | „Nimm genau diese eine Änderung zurück." | ein `audit_change` |
| **Vorgang** | „Nimm diesen ganzen Vorgang zurück." (die 32 Segmente) | ein `audit_event` |
| **Objekt** | „Setze dieses Objekt auf den Stand von gestern 14:00." | ein Objekt + Zeitpunkt |

Alle drei greifen auf dieselben Daten zu. Es sind Sichten, keine getrennten Systeme.

## 4. Owner-Entscheidungen (verbindlich)

1. **Zweck:** Nachvollziehen & Rückgängigmachen + Forensik + Aktivitäts-Überblick.
   **Keine** öffentliche Historie für Besucher.
2. **Zwei Ebenen:** Feed (Ereignisse) getrennt von Detailzeilen (Vorher/Nachher).
3. **Bulk-Läufe:** **ein** Feed-Eintrag pro Lauf mit Zusammenfassung. Detailzeilen mit
   Vorher/Nachher **nur bei destruktiven** Vorgängen (§6).
4. **Aufbewahrung:** Feed = letzte **500 Ereignisse**. Objekt-Historie = pro Objekt letzte
   **100 Änderungen** + **Basis-Schnappschuss**. Getrennte Deckel — ein 913-Segment-Sync
   verbraucht **1** von 500 Feed-Plätzen, nicht 913.
5. **Löschen wird wiederherstellbar** (als gelöscht markieren statt Zeile entfernen).

## 5. Datenmodell

### `audit_event` — der Feed (was ist passiert)

Eine Zeile pro **logischem Vorgang**, nicht pro berührtem Datensatz.

| Spalte | Zweck |
|---|---|
| `id` | PK |
| `action` | Maschinencode, z. B. `path_clear_assign`, `wikisync_apply_adventures` |
| `scope` | `single` \| `bulk` \| `sync` |
| `actor_user_id` | wer (NULL = System/Cron) |
| `origin` | `editor` \| `wikisync` \| `import` \| `community` \| `system` |
| `summary_json` | Kennzahlen: `{created:3, updated:913, deleted:0, entity:"path"}` |
| `is_destructive` | bool (§6) — steuert, ob Detailzeilen geschrieben werden |
| `affected_count` | wie viele Objekte |
| `created_at` | Zeitstempel |
| `undone_at`, `undone_by`, `undo_event_id` | Vorgangs-Undo |

**Deckel:** Prune auf die letzten 500 Zeilen — analog zum bereits existierenden
`avesmapsPoliticalPruneGeometryAuditLog`. Das Prunen eines Events löscht **auch** seine
Detailzeilen (siehe unten) — deshalb ist der Basis-Schnappschuss (§5.3) zwingend.

### `audit_change` — die Details (was genau)

Eine Zeile **pro betroffenem Objekt**, aber **nur wenn** `audit_event.is_destructive` gilt.

| Spalte | Zweck |
|---|---|
| `id` | PK |
| `event_id` | FK → `audit_event` |
| `entity_type` | `map_feature` \| `territory` \| `adventure` \| `feature_source` \| `review` \| `report` \| `setting` |
| `entity_id` | interne ID |
| `entity_public_id` | stabile öffentliche ID (überlebt Re-Import) |
| `op` | `create` \| `update` \| `delete` \| `restore` |
| `before_json` / `after_json` | **vollständige** Schnappschüsse, keine Diffs |
| `created_at` | Zeitstempel |
| `undone_at`, `undone_by` | Zeilen-Undo |

**Vollständige Schnappschüsse, nicht Diffs.** Nur so lässt sich ein Objekt direkt auf
einen Zeitpunkt setzen, ohne eine Kette abspielen zu müssen.

**Deckel:** pro `(entity_type, entity_id)` die letzten **100** Änderungen.

### `audit_baseline` — der Boden der Historie

Der Owner-Satz „**Startpunkt aber merken**" ist der kritischste Teil des ganzen Entwurfs.
Ohne ihn hat eine gedeckelte Historie **keinen Boden**: Fällt die älteste Änderung aus dem
100er-Fenster, kann man nie mehr auf „wie es mal war" zurück.

| Spalte | Zweck |
|---|---|
| `entity_type`, `entity_id` | PK |
| `snapshot_json` | Zustand **vor** der ältesten noch gespeicherten Änderung |
| `snapshot_at` | Zeitpunkt dieses Zustands |

**Regel:** Bevor eine Änderung aus dem 100er-Fenster (oder mit ihrem Event) gelöscht wird,
wird ihr `before_json` in den Basis-Schnappschuss **hochgerollt**. Damit ist jeder Punkt
zwischen „Basis" und „jetzt" erreichbar, und der Speicher bleibt gedeckelt.

(Dasselbe Prinzip wie ein Keyframe im Video oder ein Checkpoint in einer Datenbank.)

### Verhältnis zu den Alt-Tabellen

`map_audit_log` und `political_territory_geometry_audit_log` werden **nicht** sofort
abgeschafft. Migrationsweg in §9.

## 6. Definition „destruktiv" (HART)

Detailzeilen kosten Platz, deshalb nur bei destruktiven Vorgängen. Diese Grenze muss
**explizit** sein, sonst rutscht in einem Jahr ein Vorgang durch, der stillschweigend
Daten überschreibt — genau der Große-Fluss-Fall.

**Ein Vorgang ist destruktiv, wenn er einen vom Menschen gepflegten Wert entfernt oder
überschreibt.** Konkret:

| Destruktiv (Detailzeilen PFLICHT) | Nicht destruktiv (nur Zusammenfassung) |
|---|---|
| Löschen eines Objekts | Anlegen eines neuen Objekts |
| Zuweisung **entfernen** (`clear_assign`, `remove_wiki`) | Erst-Zuweisung eines vorher leeren Feldes |
| Überschreiben eines **nicht-leeren** Feldes | Befüllen eines **leeren** Feldes |
| Bulk-Umbenennung / Neu-Zuweisung | Wiki-Sync, der nur neue Datensätze anlegt |
| `TRUNCATE` / Massen-Clear | Reine Lese-/Cache-Vorgänge |
| Wiederherstellen (überschreibt den Ist-Stand!) | Staging-Tabellen füllen |

**Faustregel für Zweifelsfälle: im Zweifel destruktiv.** Ein zu viel geschriebener
Detail-Datensatz kostet Bytes; ein zu wenig geschriebener kostet Daten.

**Diese Liste ist Teil des Codes, nicht der Doku:** Die Aktion trägt ihr
`is_destructive` selbst (eine zentrale Map `action → destructive`), damit ein neuer
Endpoint sich bewusst einordnen **muss**.

## 7. Semantik: „Rückgängig" ≠ „Zurücksetzen"

Das sind **zwei verschiedene Operationen**. Werden sie vermischt, wirft man irgendwann
unbemerkt fremde Arbeit weg.

| | Rückgängig machen | Auf Zeitpunkt zurücksetzen |
|---|---|---|
| Frage | „Diese Änderung war ein Fehler." | „Bring dieses Objekt auf den Stand von damals." |
| Seither geändert? | **Bricht ab** (Konflikt-Check, wie heute `avesmapsAssertUndoPatchStillCurrent`) | **Überschreibt bewusst** |
| Bestätigung | keine nötig | **zwingend**, mit Anzeige, was überschrieben wird |
| Ergebnis | schreibt `before_json` zurück | schreibt den Zustand zum Zeitpunkt T |

Beide erzeugen **selbst wieder ein `audit_event`** (`op = restore`). Ein Undo ist eine
Änderung wie jede andere und muss ebenfalls rückgängig gemacht werden können. Niemals
still am Log vorbeischreiben.

## 8. Die drei harten Probleme

Sie sind der Grund, warum das mehr ist als „anders sortieren".

### 8.1 Querverweise zwischen Objekten

Ein Wegsegment ist unabhängig — unkritisch. Aber es gibt Verweise, und die sind
aufzählbar:

- `political_territory.parent_id` → anderes Territorium
- Hauptstadt → Siedlung (`capital_name` in `political_territory_wiki`)
- `feature_sources.entity_public_id` → Element
- `adventure_place` → Ort/Region/Territorium/Weg

**Regel:** Vor dem Schreiben einer Wiederherstellung werden alle Verweise des
Schnappschusses geprüft. Zeigt einer ins Leere (Ziel gelöscht/verschmolzen), wird die
Wiederherstellung **abgelehnt** mit klarer Meldung — **niemals** ein kaputter Verweis
geschrieben.

### 8.2 Veralteter Schnappschuss

Siehe §7. Der Konflikt-Check existiert bereits und ist wiederzuverwenden, nicht neu zu
erfinden.

### 8.3 Gelöschte Objekte

Owner-Entscheidung: wiederherstellbar. Das heißt **konsequent**:

- Löschen setzt `is_active = 0` / `deleted_at` — die Zeile **bleibt**, die ID bleibt gültig.
- Verweise anderer Tabellen bleiben damit intakt.
- **Ein einziges echtes `DELETE` reißt ein Loch** in dieses Versprechen. Die
  Bestandsaufnahme (§2) listet die Stellen; sie sind vor dem Bau durchzugehen.
- Öffentliche Endpoints müssen `deleted_at IS NULL` filtern — sonst tauchen gelöschte
  Objekte auf der Karte wieder auf.

## 9. Bauphasen

Jede Phase ist für sich deploybar und lässt das System funktionsfähig.

**P1 — Fundament (ohne Verhaltensänderung).**
Tabellen `audit_event` / `audit_change` / `audit_baseline` anlegen (inline-DDL, wie im
Projekt üblich). Zentrale Schreib-API `avesmapsAuditRecord(event, changes[])` plus die
`action → is_destructive`-Map. Noch kein Aufrufer. Prune-Routinen (500 Events / 100 pro
Objekt) inklusive Basis-Hochrollen.

**P2 — Lücken schließen (Schreiben).**
Die Endpoints aus §2 nacheinander an `avesmapsAuditRecord` anschließen. Reihenfolge nach
Schmerz: `subtree-display` (Albenhus/Zwerch!) → Territoriums-Modell/Identität → Quellen →
Abenteuer → Moderation → `app_setting`.
**Bestehende Schreibpfade nicht anfassen** — `map_audit_log` läuft weiter.

**P3 — Feed vereinheitlichen (Lesen).**
Der „Änderungen"-Reiter liest `audit_event` und blendet die Alt-Tabellen als weitere
Quelle ein (wie heute schon zwei Quellen gemerged werden). Bulk-Läufe erscheinen als
**eine** aufklappbare Zeile.

**P4 — Vorgangs-Undo.**
„Diesen Vorgang rückgängig machen" über alle `audit_change` eines Events, transaktional,
mit Konflikt-Check pro Zeile und einem Bericht, was nicht ging. **Damit wäre der
Große-Fluss-Fall ein Klick gewesen.**

**P5 — Objekt-Historie.**
Pro Element ein Reiter „Verlauf": Zeitachse aus `audit_change` + Basis-Schnappschuss,
Wiederherstellen auf einen Zeitpunkt (mit Bestätigung, §7).

**P6 — Soft-Delete konsequent.**
Echte `DELETE`s umstellen, Wiederherstellung gelöschter Objekte.

**P7 — Migration.**
`map_audit_log` und `political_territory_geometry_audit_log` in `audit_event`/`audit_change`
überführen, Alt-Pfade abschalten. Erst wenn P1–P6 stehen.

## 10. Nicht-Ziele (bewusst NICHT gebaut)

- **Keine öffentliche Historie** für Besucher.
- **Keine Detailzeilen für harmlose Massenanlagen** (Wiki-Sync, der nur neu anlegt).
- **Kein Diff-basiertes Format** — volle Schnappschüsse, auch wenn sie mehr Platz kosten.
- **Kein Merge/Konfliktauflösung** wie in Git. Bei Konflikt wird abgelehnt, nicht
  zusammengeführt.
- **Kein Live-Aktivitäts-Stream** (WebSocket o. ä.) — STRATO.

## 11. Offene Punkte für den Owner

1. **Reihenfolge P2:** Ist `subtree-display` wirklich zuerst? (Meine Empfehlung — es ist
   der einzige Vorgang in der Lückenliste, der nachweislich Daten verbiegt.)
2. **Wer darf zurücksetzen?** Jeder Editor für jedes Objekt, oder nur Admin für fremde
   Änderungen?
3. **`app_setting`** (globaler Bild-Kill-Switch): mit in den Audit, oder Rauschen?
4. **Prune-Zeitpunkt:** Bei jedem Schreiben (billig, aber häufig) oder per Cron?

---

**Bezug:** `AGENTS.md` §10 (Albenhus/Zwerch, „schwere Endpoints nie loopen") ·
`docs/refactoring-masterplan.md` · `docs/territories.md`

**Quellen der Bestandsaufnahme in §2** (alle am 2026-07-14 im Code geprüft, nicht vermutet):
`api/_internal/map/features.php:408,2147` · `api/_internal/wiki/locations-helpers.php:183,204` ·
`api/_internal/political/territories-audit.php:426,455`
