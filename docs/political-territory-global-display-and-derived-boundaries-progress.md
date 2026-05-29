# Fortschritt: Globale Herrschaftsgebiet-Eigenschaften und abgeleitete Außengrenzen

Stand: 2026-05-29

Dieses Dokument protokolliert den Umbau aus `docs/political-territory-global-display-and-derived-boundaries-plan.md`. Es ergänzt den Hauptplan, ersetzt ihn aber nicht.

## Ziel

Avesmaps stellt politische Herrschaftsgebiet-Eigenschaften und abgeleitete Außengrenzen auf ein globales, territory-basiertes Modell um.

Zentrale Regel:

```text
Karte klickt Geometrie -> Editor oeffnet Breadcrumb -> aktiver Breadcrumb bestimmt Territorium -> Eigenschaften und Außengrenzen werden global an diesem Territorium gelesen/geschrieben.
```

## Verbindlicher Grenz-Vertrag

Die abgeleiteten Außengrenzen werden langfristig immer hierarchisch konsistent berechnet. Eine Änderung an einer unteren Geometrie muss auch alle betroffenen oberen Außengrenzen aktualisieren. Berechnung und Anzeige sind getrennt.

```text
Außengrenzen darstellen
= dieses Gebiet zeigt eine berechnete Außengrenze. Berechnet wird sie unabhängig vom Anzeige-Häkchen, sobald das Gebiet im redaktionellen Boundary-Recompute betroffen ist und eine Außengrenze erzeugen kann.

Innengrenzen darstellen
= dieses Gebiet zeigt seine inneren Grenzlinien. Diese Einstellung ist territory-lokal und wirkt nicht automatisch auf Kinder.

Für alle Unterregionen übernehmen
= wendet die aktuellen Grenz-Einstellungen rekursiv auf Unterregionen an.
```

Der UI-Hilfetext fuer die rekursive Aktion lautet:

```text
Berechnet und übernimmt diese Grenz-Einstellungen rekursiv für alle Unterregionen.
```

`political_territory_geometry` bleibt die redaktionelle Quellgeometrie. `political_territory_derived_geometry` ist die berechnete politische Außengrenze eines Hierarchieknotens. Sobald ein Territory als Hierarchieknoten existiert und aus echten Geometrien oder Kind-Außengrenzen eine gueltige Außengrenze erzeugen kann, kann es eine Derived Boundary bekommen. Das gilt auch fuer Blattknoten mit eigener echter Geometrie.

Die Berechnung laeuft bottom-up. Blatt- oder Quellknoten werden aus echten Geometrien abgeleitet. Elterngebiete werden bevorzugt aus den frisch berechneten Kind-Außengrenzen vereinigt. Echte Kind-/Blatt-Geometrien bleiben als Fallback und Quelle relevant, duerfen aber nicht ueberschrieben werden.

Enklaven, Exklaven und innere Ringe sind Bestandteil der Außengrenze. Eine gueltige Außengrenze kann daher ein `Polygon` mit inneren Ringen oder ein `MultiPolygon` mit inneren Ringen sein. Diese Ringe duerfen bei Union, Speicherung und Rendering nicht entfernt oder als normale Innengrenze umgedeutet werden.

Boundary-relevante Änderungen werden beim Editor-Speichern direkt fuer die betroffenen Hierarchien neu berechnet. Relevante Änderungen sind insbesondere echte Geometrie, Geometrie-Zuordnung, Territory-Hierarchie, Gültigkeitsjahre und die Option `existiert bis heute`. Betroffen sind das geänderte Territory, erzeugbare Unterknoten bei rekursiver Übernahme und alle Ancestors, deren Außengrenze von der Änderung abhängt.

Derived Boundaries sind historisch gültig. Sie werden nur aus Quellen gebildet, die im betrachteten Jahr oder Intervall gültig sind. Eine Änderung an Gültigkeitsjahren oder `existiert bis heute` invalidiert daher dieselben abhängigen Außengrenzen wie eine Geometrieänderung.

`Für alle Unterregionen übernehmen` ist eine bewusste Massenaktion. Nur wenn diese Option aktiv ist, werden `Außengrenzen darstellen` und `Innengrenzen darstellen` rekursiv auf Kinder und Kindeskinder übertragen.

Innengrenzen werden relativ zum aktuell dargestellten Breadcrumb-Kontext gestuft. Die unterste sichtbare Rekursionsstufe beginnt mit Index 1; darüber folgen 2, 3, 4 usw. Die äußerste Grenze des angezeigten Gebiets ist immer `X`. Die maximale sichtbare Innengrenzen-Tiefe soll als zentraler Parameter konfigurierbar bleiben.

## Berechnungsort und Bedienung

Die Polygon-Union wird nicht in reinem PHP implementiert. Solange keine robuste serverseitige Geometrie-Engine verfuegbar ist, erzeugt oder aktualisiert der Editor-Client die Außengrenzen mit der vorhandenen JavaScript-Geometrie-Logik. Das PHP-Backend plant, liefert Quellen, validiert Metadaten und speichert die fertigen Derived Boundaries transaktional.

Waehrend der Editor-Client Außengrenzen berechnet, zeigt die UI einen sichtbaren Ladebalken oder Fortschrittszustand. Die Berechnung ist eine redaktionelle Aktion und darf Zeit kosten; die normale Endnutzerkarte darf dadurch nicht belastet werden.

Im Kontextmenue soll ein expliziter Eintrag `Außengrenzen erzeugen/aktualisieren` angeboten werden. Dieser Eintrag startet dieselbe Berechnungsfunktion wie das Geometrie-Panel beziehungsweise der Save-Hook. Es darf keine zweite, abweichende Berechnungslogik geben.

## Performance-Vertrag fuer Grenz-Rendering

Zoomen und Pannen duerfen keine Grenzberechnung und moeglichst keine kleinteiligen Nachladevorgaenge ausloesen. Nutzer wechseln Zoomstufen schnell; die Uebergaenge muessen fluessig bleiben.

Avesmaps bevorzugt fuer politische Grenzen deshalb einen einmaligen, sichtbaren Ladezustand mit ausreichend vollstaendigem Payload gegenueber haeufigem spaeten Nachladen. Lieber etwas mehr Grenzdaten initial oder layerweise uebertragen und lokal cachen, als beim Zoomen zu wenig Daten haben und dadurch Ruckler, Nachladepausen oder Rechenlast erzeugen.

Die normale Kartenansicht soll vorberechnete Derived Boundaries laden, revisioniert cachen und beim Zoomen nur Sichtbarkeit, Layergruppen und Styles umschalten. Polygon-Union gehoert in den redaktionellen Editor-Berechnungspfad; das PHP-Backend plant, validiert und speichert, solange keine robuste serverseitige Geometrie-Engine verfuegbar ist.

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
| Phase 6: Außengrenzen-UI vervollstaendigen | begonnen | `f06cb07b10da78ccd12f8ff6e8bb5e5936171542` | Alle drei Ziel-Schalter sind sichtbar; rekursiver Modus bleibt bis zum Backend-Vertrag deaktiviert; Hinweistext wurde nutzerverstaendlicher formuliert. |
| Phase 7: Hierarchische Außengrenzen-Planung und Speicherung | offen | - | Der alte `flat`/`hierarchical`-Vertrag wurde durch den hierarchischen Grenz-Vertrag ersetzt; rekursive bottom-up-Planung und Batch-Speicherung fehlen noch. |
| Phase 8: Quellenprotokoll | offen | - | Optional, aber fuer Diagnose/Reproduktion sinnvoll. |
| Phase 9: Tests und manuelle Pruefung | begonnen | `99b5f9830f320101c935810eb419cafa0830486e` | Browser-Smoke-Test und Nachtest erfolgreich; erwartbar fehlende Geometry-Assignments liefern nun leeren 200-Zustand ohne Konsolenfehler. |
| Phase 10: Legacy-Aufraeumung | blockiert | - | Erst nach stabiler Testphase und expliziter Freigabe. |

## Commit-Log

### 2026-05-29 — `99b5f9830f320101c935810eb419cafa0830486e`

**Ziel:** Erwartbar fehlende Geometry-Assignments nicht mehr als HTTP-400-Konsolenfehler melden.

**Geaenderte Dateien:**

- `api/_internal/political/territories-endpoint.php`

**Was wurde geaendert:**

- GET-Action `geometry_assignment` wird vor dem allgemeinen GET-`match` separat behandelt.
- Wenn `avesmapsPoliticalGetGeometryAssignment()` fuer eine syntaktisch gueltige UUID keine passende politische Geometrie findet, antwortet der Endpunkt mit HTTP 200.
- Die Antwort enthaelt `missing_geometry_assignment: true`, `geometry: null` und `assignment: null`.
- Ungueltige IDs bleiben echte Fehler und laufen weiter in den bestehenden Fehlerpfad.

**Nicht geaendert:**

- Keine Datenbank.
- Keine Geometrien.
- Keine Territorien oder Hierarchien.
- Keine Schreiboperationen.
- Kein Derived-Geometry-Vertrag.

**Verifikation:**

- Commit `99b5f9830f320101c935810eb419cafa0830486e` wurde von GitHub bestaetigt und ueber `fetch_commit` verifiziert.
- Der Commit-Diff ist auf `api/_internal/political/territories-endpoint.php` und die GET-Action `geometry_assignment` begrenzt.
- Browser-Nachtest bestanden: normales Verhalten, keine Konsolenfehler.

**Offene Risiken:**

- Keine aus dem Browser-Nachtest bekannt.

### 2026-05-29 — `f06cb07b10da78ccd12f8ff6e8bb5e5936171542`

**Ziel:** Hinweistext zum derzeit deaktivierten Unterregionen-Modus nutzerverstaendlicher formulieren.

**Geaenderte Dateien:**

- `js/territory/territory-derived-geometry-iframe-editor.js`

**Was wurde geaendert:**

- Technischer Hinweis `flache Außengrenze für den aktiven Breadcrumb-Knoten` ersetzt.
- Neuer Text: `Erzeugt derzeit nur die Außengrenze des oben ausgewählten Gebiets. Unterregionen werden nicht einzeln neu berechnet.`

**Nicht geaendert:**

- Keine API.
- Keine Datenbank.
- Keine Geometrien.
- Keine Territorien oder Hierarchien.
- Keine Save-Semantik.

**Verifikation:**

- Commit `f06cb07b10da78ccd12f8ff6e8bb5e5936171542` wurde von GitHub bestaetigt und ueber `fetch_commit` verifiziert.
- Der Commit-Diff enthaelt nur die sichtbare Hinweiszeile in `js/territory/territory-derived-geometry-iframe-editor.js`.

**Offene Risiken:**

- Erneute Browser-Pruefung des Hinweistexts steht aus.
- Der rekursive Modus ist bewusst noch deaktiviert.

### 2026-05-29 — `5a39fcb9fc7a3472dd01b316729ff2eb96f861bd`

**Ziel:** Dritten Ziel-Schalter im Geometrie-Panel sichtbar machen, ohne eine noch nicht implementierte Backend-Funktion zu simulieren.

**Geaenderte Dateien:**

- `js/territory/territory-derived-geometry-iframe-editor.js`

**Was wurde geaendert:**

- Checkbox `Für alle Unterregionen übernehmen` im Geometrie-Panel ergänzt.
- Die Checkbox ist deaktiviert, bis der Backend-Modus fuer rekursive/hierarchische Derived-Geometrien implementiert ist.
- Hinweistext ergänzt: aktuell wird die flache Außengrenze fuer den aktiven Breadcrumb-Knoten erzeugt.
- CSS fuer deaktivierten rekursiven Modus ergänzt.

**Nicht geaendert:**

- Keine API.
- Keine Datenbank.
- Keine Geometrien.
- Keine Territorien oder Hierarchien.
- Keine Save-Semantik.
- Kein Payload fuer `flat`/`hierarchical`.

**Verifikation:**

- Commit `5a39fcb9fc7a3472dd01b316729ff2eb96f861bd` wurde von GitHub bestaetigt und ueber `fetch_commit` verifiziert.
- Der Commit-Diff enthaelt nur UI-Markup und CSS in `js/territory/territory-derived-geometry-iframe-editor.js`.

**Offene Risiken:**

- Der rekursive Modus ist bewusst noch deaktiviert.
- Phase 7 muss den Backend-Vertrag `flat`/`hierarchical` sauber einfuehren.

### 2026-05-29 — `b4c8d4ea801c8bab2cee8fac7d2580b85423e14c`

**Ziel:** Blattknoten ohne Unterregionen im Geometrie-Panel korrekt darstellen.

**Geaenderte Dateien:**

- `js/territory/territory-derived-geometry-iframe-editor.js`

**Was wurde geaendert:**

- `updateInnerBoundaryControl()` setzt `Innengrenzen darstellen` bei nicht verfuegbaren Innengrenzen auf `checked` statt `unchecked`.
- Die Checkbox bleibt deaktiviert und ueber die bestehende CSS-Klasse ausgegraut.

**Nicht geaendert:**

- Keine API.
- Keine Datenbank.
- Keine Geometrien.
- Keine Territorien oder Hierarchien.
- Keine Save-Semantik fuer `show_inner_boundaries`: Blattknoten speichern weiterhin `false`, weil keine Innengrenzen vorhanden sind.

**Verifikation:**

- Commit `b4c8d4ea801c8bab2cee8fac7d2580b85423e14c` wurde von GitHub bestaetigt und ueber `fetch_commit` verifiziert.
- Der Commit-Diff enthaelt nur die Checkbox-Statusaenderung in `js/territory/territory-derived-geometry-iframe-editor.js`.

**Offene Risiken:**

- Keine aus dem ersten Browser-Smoke-Test bekannt.

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

## Testbefunde

### 2026-05-29 — Browser-Smoke-Test nach Phase 2/3/5/6

**Bestanden:**

- Breadcrumb-Wechsel funktioniert.
- Geometrie-Panel zeigt die drei erwarteten Optionen.
- `Für alle Unterregionen übernehmen` ist sichtbar und deaktiviert.
- Blattknoten zeigen `Innengrenzen darstellen` deaktiviert, abgehakt und ausgegraut.
- Lokale Override-UI erscheint nicht mehr.
- Vorsichtiger Speichertest funktioniert.

**Auffaellig:**

- `geometry_assignment` lieferte beim Oeffnen fuer `geometry_public_id=887c6744-f898-4096-a4aa-3b23da1a908a` HTTP 400. Das Frontend behandelte 400/404 an dieser Stelle bereits als fehlende gespeicherte Eigenschaften und lief weiter. Mit Commit `99b5f9830f320101c935810eb419cafa0830486e` wurde fuer syntaktisch gueltige, aber fehlende Geometrien ein leerer HTTP-200-Zustand eingefuehrt.
- Der urspruengliche Hinweistext zum flachen Modus war fuer Endnutzer unverstaendlich und wurde mit Commit `f06cb07b10da78ccd12f8ff6e8bb5e5936171542` ersetzt.

### 2026-05-29 — Browser-Nachtest nach Assignment-Status-Fix

**Bestanden:**

- Anwendung verhaelt sich normal.
- Es erscheinen keine Konsolenfehler.
- Der zuvor auffaellige `geometry_assignment`-Fall ist damit fuer den Smoke-Test bereinigt.

## Aktuelle Altlasten / DCE-Kandidaten

| Bereich | Datei/Funktion | Risiko | Behandlung |
|---|---|---|---|
| Lokale Override-UI | `js/territory/territory-override-footer.js` | Geometriereferenzierter UI-Pfad wurde in der aktiven UI deaktiviert, bleibt aber als Legacy-Code erhalten. | Nach Diagnose und Freigabe entfernen oder weiter einkapseln. |
| Legacy-Snapshots | `style_json.assignmentDisplays` / `assignment_displays` | Doppelte Wahrheit gegenueber globalen Territory-Werten. | Nur noch als Legacy-Fallback/Diagnose lesen; nicht als aktive Wahrheit speichern. |
| Aktiver Breadcrumb | `activeDisplayNode`, `readRootSelection()` | Fallback auf letztes Breadcrumb-Element kann falsches Territorium adressieren. | Breadcrumb-Wechsel explizit setzen und Panels neu synchronisieren; Fallback spaeter haerter absichern. |
| Derived-Geometry-Ziel | `territory-derived-geometry-iframe-editor.js::getTargetKey()` | Prinzipiell richtig, aber Reload bei Breadcrumb-Wechsel muss garantiert sein. | Nach Breadcrumb-Wechsel explizit `loadForCurrentTerritory()` aufrufen; Browser-Test ausstehend. |
| Innengrenzen-UI | `updateInnerBoundaryControl()` | Blattknoten-UI wurde auf disabled, checked, ausgegraut korrigiert; Browser-Test bestanden. | Nach weiterem Regressionstest als erledigt markieren. |
| Außengrenzen-Modus | Frontend/Backend | UI-Schalter ist sichtbar, aber der rekursive Modus ist bewusst deaktiviert. | Phase 7: hierarchische Grenz-Planung, Editor-Client-Berechnung und Batch-Speicherung einfuehren. |
| Assignment-Ladefehler | `geometry_assignment` GET | HTTP 400 erschien in der Konsole, obwohl das Frontend den Fall als fehlende gespeicherte Eigenschaften behandelte. | Mit Commit `99b5f9830f320101c935810eb419cafa0830486e` fuer syntaktisch gueltige fehlende Geometrien auf leeren 200-Zustand umgestellt und im Browser nachgetestet. |
| Quellenprotokoll | Backend | Erzeugte Derived-Geometrien sind schwer reproduzierbar. | Optional Tabelle `political_territory_derived_geometry_source` oder aequivalentes Protokoll. |

## Manuelle Testfaelle

- Klick auf Olrong-Flaeche, dann Breadcrumb `Lorgolosch`: Eigenschaften und Derived Geometry betreffen `Lorgolosch`.
- Klick auf Kibrom-Asch, dann Breadcrumb `Kibrom`: Eigenschaften und Derived Geometry betreffen `Kibrom`.
- Blattknoten ohne Unterregionen: `Innengrenzen darstellen` ist deaktiviert, abgehakt und ausgegraut.
- Geometrie-Panel zeigt `Für alle Unterregionen übernehmen` deaktiviert mit Hinweis auf die nur fuer das ausgewaehlte Gebiet erzeugte Außengrenze.
- `geometry_assignment` mit syntaktisch gueltiger, aber nicht vorhandener `geometry_public_id` liefert HTTP 200 und keinen roten Konsolenfehler.
- `Außengrenzen darstellen` deaktivieren und speichern: Nur aktive Derived Geometry des Territoriums wird deaktiviert; echte Geometrien bleiben unveraendert.
- Lokale Override-UI erscheint nicht mehr in der aktiven Bedienoberflaeche.
- Bestehende echte Polygone bleiben nach jedem Commit unveraendert.
- Bestehende Territorien und Hierarchien bleiben nach jedem Commit unveraendert.
