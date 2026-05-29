# Fortschritt: Globale Herrschaftsgebiet-Eigenschaften und abgeleitete Außengrenzen

Stand: 2026-05-29

Dieses Dokument protokolliert den Umbau aus `docs/political-territory-global-display-and-derived-boundaries-plan.md`. Es ergänzt den Hauptplan, ersetzt ihn aber nicht.

## Ziel

Avesmaps stellt politische Herrschaftsgebiet-Eigenschaften und abgeleitete Außengrenzen auf ein globales, territory-basiertes Modell um.

Zentrale Regel:

```text
Karte klickt Geometrie -> Editor oeffnet Breadcrumb -> aktiver Breadcrumb bestimmt Territorium -> Eigenschaften und Außengrenzen werden global an diesem Territorium gelesen/geschrieben.
```

## Arbeitsregeln

- Bestehende echte Karten-Geometrien werden nicht geloescht, umgeschrieben oder neu zugeordnet.
- Bestehende Territorien und Territorien-Hierarchien werden nicht veraendert.
- Lokale Eigenschaften/Overrides werden zuerst aus der aktiven UI entfernt oder deaktiviert; alte Daten bleiben erhalten.
- Keine Migration, Archivierung oder Loeschung ohne Diagnose und explizite Freigabe.
- Jeder Commit muss klein, nachvollziehbar und lauffaehig bleiben.
- Nach jedem Commit wird der Commit-SHA verifiziert und hier dokumentiert.

## Statusuebersicht

| Phase | Status | Commit | Bemerkung |
|---|---|---|---|
| Phase 1: Diagnose | offen | - | Diagnose fuer Datenkonflikte und Legacy-Snapshots noch ausstehend. |
| Phase 2: Aktiver Breadcrumb als harte Wahrheit | begonnen | `07786f443da4271bf0a2628e0a3f99f69b775f32` | Breadcrumb-Wechsel synchronisiert das Derived-Geometry-Panel gegen den aktiven Knoten; weitere Absicherung des Fallbacks steht aus. |
| Phase 3: Lokale Override-UI deaktivieren | begonnen | `06c27359c079e6d2a417975adf82b6fb68b91b17` | Footer-Installation, Anzeige und Refresh sind in der aktiven UI deaktiviert; API-/Legacy-Funktionen bleiben erhalten. |
| Phase 4: Eigenschaften global lesen/schreiben | offen | - | `assignmentDisplays` entmachten, nicht sofort loeschen. |
| Phase 5: Geometrie-Panel auf aktiven Breadcrumb fixieren | begonnen | `07786f443da4271bf0a2628e0a3f99f69b775f32` | Reload nach Breadcrumb-Wechsel umgesetzt; UI-Schalter und Backend-Modi fehlen noch. |
| Phase 6: Außengrenzen-UI vervollstaendigen | offen | - | Dritter Schalter `Fuer alle Unterregionen uebernehmen` fehlt noch. |
| Phase 7: Backend-Modi fuer Außengrenzen | offen | - | `flat`/`hierarchical`-Vertrag und rekursive Planung fehlen noch. |
| Phase 8: Quellenprotokoll | offen | - | Optional, aber fuer Diagnose/Reproduktion sinnvoll. |
| Phase 9: Tests und manuelle Pruefung | offen | - | Testfaelle werden pro Commit ergaenzt. |
| Phase 10: Legacy-Aufraeumung | blockiert | - | Erst nach stabiler Testphase und expliziter Freigabe. |

## Commit-Log

### 2026-05-29 — `06c27359c079e6d2a417975adf82b6fb68b91b17`

**Ziel:** Lokale Override-UI in der aktiven Bedienoberflaeche deaktivieren.

**Geaenderte Dateien:**

- `js/territory/territory-override-footer.js`

**Was wurde geaendert:**

- `LOCAL_OVERRIDE_UI_ENABLED` auf `false` gesetzt.
- Footer-Installation bricht ab und entfernt eventuell vorhandene Footer-Elemente.
- Sichtbarkeits-Sync setzt Pending-Override-Status zurueck und blendet den Footer nicht mehr ein.
- Refresh des lokalen Override-Footers wird in der aktiven UI kurzgeschlossen.

**Nicht geaendert:**

- Keine API.
- Keine Datenbank.
- Keine alten lokalen Override-Daten.
- Keine echten Geometrien.
- Keine Territorien oder Hierarchien.
- Bestehende Hilfsfunktionen fuer Diagnose/Legacy-Aufraeumung bleiben im Code erhalten.

**Verifikation:**

- Commit `06c27359c079e6d2a417975adf82b6fb68b91b17` wurde von GitHub bestaetigt und ueber `fetch_commit` verifiziert.
- Der Commit-Diff enthaelt nur `js/territory/territory-override-footer.js`.

**Offene Risiken:**

- Manuelle Browser-Pruefung steht aus.
- Backend-/API-Pfade fuer lokale Overrides existieren weiterhin als Legacy-/Diagnosepfad.
- Endgueltige Entfernung/DCE darf erst nach Diagnose und expliziter Freigabe erfolgen.

### 2026-05-29 — `07786f443da4271bf0a2628e0a3f99f69b775f32`

**Ziel:** Derived-Geometry-Panel nach Breadcrumb-Wechsel gegen den aktiven Breadcrumb-Knoten synchronisieren.

**Geaenderte Dateien:**

- `js/territory/territory-editor-ui-hints.js`

**Was wurde geaendert:**

- Nach dem Laden des Derived-Geometry-Iframe-Editors wird ein Breadcrumb-Observer installiert.
- Der Observer reagiert auf Aenderungen in `#manualEditPath`.
- Bei einem aktiven Breadcrumb-Wechsel wird der aktuelle Assignment-State gelesen und `AvesmapsPoliticalDerivedGeometryEditor.loadForCurrentTerritory(value)` aufgerufen.
- Wiederholte Reloads fuer denselben Target-Key werden vermieden.

**Nicht geaendert:**

- Keine API.
- Keine Datenbank.
- Keine Geometrien.
- Keine Territorien oder Hierarchien.
- Kein Override- oder Legacy-Datenpfad.

**Verifikation:**

- Commit `07786f443da4271bf0a2628e0a3f99f69b775f32` wurde von GitHub bestaetigt und ueber `fetch_commit` verifiziert.
- Der Commit-Diff enthaelt nur `js/territory/territory-editor-ui-hints.js`.

**Offene Risiken:**

- Manuelle Browser-Pruefung steht aus.
- `activeDisplayNode` hat weiterhin einen Fallback auf das letzte Breadcrumb-Element, falls kein aktiver Knoten gesetzt ist.

### 2026-05-29 — `2d5771705f9917ae821b804dd4c0c40faf4b871d`

**Ziel:** Fortschritts- und Altlastenprotokoll fuer den Umbau anlegen.

**Geaenderte Dateien:**

- `docs/political-territory-global-display-and-derived-boundaries-progress.md`

**Was wurde geaendert:**

- Statusuebersicht fuer die Umsetzungsphasen angelegt.
- Commit-Log-Struktur angelegt.
- Altlasten-/DCE-Kandidatenliste angelegt.
- Manuelle Testfaelle als fortlaufende Checkliste angelegt.

**Nicht geaendert:**

- Keine App-Logik.
- Keine API.
- Keine Datenbank.
- Keine Geometrien.
- Keine Territorien oder Hierarchien.

**Verifikation:**

- Commit `2d5771705f9917ae821b804dd4c0c40faf4b871d` wurde von GitHub bestaetigt und ueber `fetch_commit` verifiziert.

**Offene Risiken:**

- Keine technischen Risiken; reiner Dokumentations-Commit.

## Aktuelle Altlasten / DCE-Kandidaten

| Bereich | Datei/Funktion | Risiko | Behandlung |
|---|---|---|---|
| Lokale Override-UI | `js/territory/territory-override-footer.js` | Geometriereferenzierter UI-Pfad wurde in der aktiven UI deaktiviert, bleibt aber als Legacy-Code erhalten. | Nach Diagnose und Freigabe entfernen oder weiter einkapseln. |
| Legacy-Snapshots | `style_json.assignmentDisplays` / `assignment_displays` | Doppelte Wahrheit gegenueber globalen Territory-Werten. | Nur noch als Legacy-Fallback/Diagnose lesen; nicht als aktive Wahrheit speichern. |
| Aktiver Breadcrumb | `activeDisplayNode`, `readRootSelection()` | Fallback auf letztes Breadcrumb-Element kann falsches Territorium adressieren. | Breadcrumb-Wechsel explizit setzen und Panels neu synchronisieren; Fallback spaeter haerter absichern. |
| Derived-Geometry-Ziel | `territory-derived-geometry-iframe-editor.js::getTargetKey()` | Prinzipiell richtig, aber Reload bei Breadcrumb-Wechsel muss garantiert sein. | Nach Breadcrumb-Wechsel explizit `loadForCurrentTerritory()` aufrufen; Browser-Test ausstehend. |
| Innengrenzen-UI | `updateInnerBoundaryControl()` | Blattknoten werden aktuell disabled und unchecked; Ziel ist disabled, checked, ausgegraut. | In Phase 6 korrigieren. |
| Außengrenzen-Modus | Frontend/Backend | `flat` und `hierarchical` sind noch nicht fachlich getrennt. | Generation-Mode und rekursive Source-Planung einfuehren. |
| Quellenprotokoll | Backend | Erzeugte Derived-Geometrien sind schwer reproduzierbar. | Optional Tabelle `political_territory_derived_geometry_source` oder aequivalentes Protokoll. |

## Manuelle Testfaelle

- Klick auf Olrong-Flaeche, dann Breadcrumb `Lorgolosch`: Eigenschaften und Derived Geometry betreffen `Lorgolosch`.
- Klick auf Kibrom-Asch, dann Breadcrumb `Kibrom`: Eigenschaften und Derived Geometry betreffen `Kibrom`.
- Blattknoten ohne Unterregionen: `Innengrenzen darstellen` ist deaktiviert, abgehakt und ausgegraut.
- `Außengrenzen darstellen` deaktivieren und speichern: Nur aktive Derived Geometry des Territoriums wird deaktiviert; echte Geometrien bleiben unveraendert.
- Lokale Override-UI erscheint nicht mehr in der aktiven Bedienoberflaeche.
- Bestehende echte Polygone bleiben nach jedem Commit unveraendert.
- Bestehende Territorien und Hierarchien bleiben nach jedem Commit unveraendert.
