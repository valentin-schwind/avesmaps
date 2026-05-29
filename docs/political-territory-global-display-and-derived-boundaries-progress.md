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
| Phase 2: Aktiver Breadcrumb als harte Wahrheit | geplant | - | Breadcrumb-Wechsel muss abhaengige Panels neu synchronisieren. |
| Phase 3: Lokale Override-UI deaktivieren | geplant | - | Footer/Buttons stilllegen, APIs und Daten behalten. |
| Phase 4: Eigenschaften global lesen/schreiben | offen | - | `assignmentDisplays` entmachten, nicht sofort loeschen. |
| Phase 5: Geometrie-Panel auf aktiven Breadcrumb fixieren | geplant | - | Derived Geometry muss immer gegen den aktiven Breadcrumb-Knoten laufen. |
| Phase 6: Außengrenzen-UI vervollstaendigen | offen | - | Dritter Schalter `Fuer alle Unterregionen uebernehmen` fehlt noch. |
| Phase 7: Backend-Modi fuer Außengrenzen | offen | - | `flat`/`hierarchical`-Vertrag und rekursive Planung fehlen noch. |
| Phase 8: Quellenprotokoll | offen | - | Optional, aber fuer Diagnose/Reproduktion sinnvoll. |
| Phase 9: Tests und manuelle Pruefung | offen | - | Testfaelle werden pro Commit ergaenzt. |
| Phase 10: Legacy-Aufraeumung | blockiert | - | Erst nach stabiler Testphase und expliziter Freigabe. |

## Commit-Log

### 2026-05-29 — ausstehend

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

- Ausstehend nach Commit.

**Offene Risiken:**

- Keine technischen Risiken; reiner Dokumentations-Commit.

## Aktuelle Altlasten / DCE-Kandidaten

| Bereich | Datei/Funktion | Risiko | Behandlung |
|---|---|---|---|
| Lokale Override-UI | `js/territory/territory-override-footer.js` | Geometriereferenzierter UI-Pfad kann `reset_local` oder Promote-Logik ausloesen. | In aktiver UI stilllegen; spaeter nach Diagnose entfernen. |
| Legacy-Snapshots | `style_json.assignmentDisplays` / `assignment_displays` | Doppelte Wahrheit gegenueber globalen Territory-Werten. | Nur noch als Legacy-Fallback/Diagnose lesen; nicht als aktive Wahrheit speichern. |
| Aktiver Breadcrumb | `activeDisplayNode`, `readRootSelection()` | Fallback auf letztes Breadcrumb-Element kann falsches Territorium adressieren. | Breadcrumb-Wechsel explizit setzen und Panels neu synchronisieren. |
| Derived-Geometry-Ziel | `territory-derived-geometry-iframe-editor.js::getTargetKey()` | Prinzipiell richtig, aber Reload bei Breadcrumb-Wechsel muss garantiert sein. | Nach Breadcrumb-Wechsel explizit `loadForCurrentTerritory()` aufrufen. |
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
