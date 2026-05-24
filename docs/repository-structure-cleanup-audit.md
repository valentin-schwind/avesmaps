# Repository Structure Cleanup Audit

## 1. Zweck

Dieses Audit bereitet eine spaetere Bereinigung der Repository- und Asset-Struktur vor. Es ist bewusst von Dead-Code-Elimination und Rename-Refactoring getrennt.

Der aktuelle Schmerzpunkt ist nicht primaer unbenutzter Code, sondern eine zu flache und dadurch schwerer lesbare Dateistruktur nach vielen stabilen Splits. Zusaetzlich sollen SQL-Dateien und CSS-/Style-Anteile in JavaScript-Dateien strukturell bewertet werden.

Dieses Dokument ist nur Analyse. Es enthaelt keine Code-, Pfad-, CSS-, SQL- oder HTML-Aenderungen.

## 2. Ausgangslage

Nach den bisherigen Refactorings existieren viele thematisch zusammengehoerende Dateien direkt im `js/`-Root, insbesondere:

- `map-features-*`
- `dialogs-review-*`

Diese Dateien sind fachlich stabiler geworden, aber der Ordner `js/` wird dadurch unuebersichtlich. Das ist ein normales Folgeproblem nach einer erfolgreichen Split-Serie.

Gleichzeitig gibt es weitere Strukturthemen:

- SQL-Dateien sollten konsistent in einem SQL-/DB-Bereich liegen.
- Statische CSS-Regeln oder wiederkehrende Style-Strings in JS-Dateien koennten teilweise in CSS-Dateien ausgelagert werden.
- Dynamische Leaflet-/Marker-/Label-Styles duerfen nicht blind aus JS entfernt werden, weil sie oft von Zoom, Feature-Typ, Koordinaten oder Laufzeitdaten abhaengen.

## 3. Nicht-Ziele

Dieses Audit ist nicht:

- Dead-Code-Elimination
- Rename Refactoring
- ES-Module-Migration
- Build-System-Einfuehrung
- sofortige Umstellung der Script-Architektur
- Logikaenderung

Klassische Script-Tags bleiben weiterhin verbindlich. Es werden keine `import`-/`export`-Syntax und kein `type="module"` eingefuehrt.

## 4. JS-Zielstruktur: Vorschlag

### 4.1 `map-features`-Dateien

Aktuelle stabile Split-Dateien koennten spaeter in einen Unterordner verschoben werden:

```text
js/
  map-features/
    labels.js
    powerlines.js
    layer-state.js
    display-mode.js
    share-pin.js
    waypoints.js
    location-name-labels.js
    path-domain.js
    path-labels.js
    path-rendering.js
```

Die bestehende Restdatei `js/map-features.js` sollte kurzfristig im `js/`-Root bleiben.

Grund:

- Sie ist weiterhin der zentrale Rest-Orchestrator.
- Viele alte Aufrufer, Dokumente und mentale Modelle beziehen sich auf `js/map-features.js`.
- Ein gleichzeitiger Umzug der Restdatei wuerde den ersten Pfad-Commit unnoetig vergroessern.

Kurzfristige Empfehlung:

- Nur die bereits stabilen `map-features-*`-Splitdateien verschieben.
- `js/map-features.js` vorerst nicht verschieben.
- Script-Reihenfolge in `index.html` exakt beibehalten, nur Pfade anpassen.

### 4.2 `dialogs-review`-Dateien

Die vielen `dialogs-review-*`-Dateien koennten spaeter in einen eigenen Unterordner verschoben werden:

```text
js/
  dialogs-review/
    core.js
    status.js
    pending.js
    paths.js
    labels.js
    locations.js
    panels.js
    wiki-sync.js
    region-wiki-picker.js
    region-basics.js
    region-parent-tree.js
    region-assignment-state.js
    region-assignment-ui.js
    region-tabs-payload.js
    region-save-flow.js
    region-dialog-population.js
    region-submit-flow.js
    region-events.js
    dialog-state.js
    editor-submit.js
    report-flow.js
    main.js
```

Dabei waere `main.js` der moegliche neue Name fuer den heutigen Rest-Orchestrator `js/dialogs-review.js`.

Aber: Dieser Rename sollte nicht Teil des ersten Struktur-Commits sein.

Kurzfristige Empfehlung:

- Erst nur Pfadverschiebung der Dateien, keine Umbenennung.
- Falls `dialogs-review.js` verschoben wird, zunaechst als `js/dialogs-review/dialogs-review.js` oder `js/dialogs-review/main.js` nur nach eigener Entscheidung.
- Wegen der grossen Anzahl Dateien zuerst `map-features-*` verschieben, danach separat `dialogs-review-*`.

### 4.3 Weitere moegliche JS-Unterordner

Spaeter denkbar, aber nicht erster Schritt:

```text
js/
  routing/
  ui/
  map-core/
  data/
  regions/
```

Diese Ordner sollten erst entstehen, wenn wirklich mehrere stabile Dateien in diese Bereiche passen. Kein Ordner nur fuer eine einzelne Datei anlegen.

## 5. Script-Reihenfolge und Risiken

Die groesste technische Gefahr bei einem Pfad-Refactoring ist nicht die Logik, sondern die Reihenfolge und Vollstaendigkeit der Script-Tags.

Bei klassischem Script-Tag-Aufbau gilt:

- Reihenfolge bleibt semantisch relevant.
- Globale Funktionen muessen vor fruehen Aufrufern verfuegbar sein.
- Dateien duerfen verschoben werden, aber ihre Ladereihenfolge muss exakt gleich bleiben.
- Keine Datei darf versehentlich doppelt geladen werden.
- Keine alte Datei darf im HTML verbleiben, wenn sie verschoben wurde.

Erster Smoke nach einem Pfad-Commit:

- Seite laden, keine 404 in Network-Tab.
- Browser-Konsole: keine `ReferenceError`, keine `SyntaxError`.
- Basis-Karte sichtbar.
- Map-Features-Block initialisiert.
- Routenplanung kurz testen.
- ein Popup oeffnen.
- einen Map-Mode wechseln.
- eine geteilte URL neu laden.

## 6. SQL-Zielstruktur

SQL-Dateien sollten spaeter in einem klaren SQL-/DB-Bereich liegen. Empfohlene Struktur:

```text
sql/
  schema/
  migrations/
  seeds/
  maintenance/
  legacy/
```

Bedeutung:

- `schema/`: aktuelle Tabellenstruktur oder Basisschema
- `migrations/`: zeitlich geordnete Schema-Aenderungen
- `seeds/`: Test-/Startdaten
- `maintenance/`: Wartungs- oder Reparaturskripte
- `legacy/`: alte, nur noch dokumentarisch relevante SQL-Dateien

Risiken vor SQL-Verschiebungen:

- PHP-Dateien koennten relative Pfade auf SQL-Dateien erwarten.
- Lokale Import-/Moderationsskripte koennten SQL-Dateien per Pfad laden.
- README-/Doku-Anleitungen koennten alte Pfade nennen.
- Deployment- oder Backup-Skripte koennten implizit Dateipfade erwarten.

Empfehlung:

- Vor dem Verschieben alle `.sql`-Dateien repositoryweit auflisten.
- Danach alle Vorkommen der Dateinamen in PHP, Python, Shell, PowerShell, Markdown und JS suchen.
- Erst dann verschieben.
- SQL-Pfad-Refactoring als separater Commit, nicht zusammen mit JS-Unterordnern.

## 7. CSS-/Style-Code in JS

Nicht jeder Style in JS ist falsch. Fuer Avesmaps gibt es drei Kategorien.

### 7.1 Gute CSS-Auslagerungskandidaten

Auslagerbar sind vor allem:

- statische CSS-Regeln als String
- wiederkehrende Klassen-Styles
- Popup-/Panel-/Button-Darstellung, wenn sie nicht laufzeitabhaengig ist
- Markup-Strings mit wiederholten statischen `style`-Attributen

Ziel:

```text
css/
  components.css
  map-features.css
  dialogs-review.css
```

oder, falls bereits ein anderer CSS-Stil im Projekt etabliert ist, bestehende CSS-Dateien erweitern statt neue Dateien anzulegen.

### 7.2 Vorerst in JS lassen

In JS bleiben sollten dynamische Styles, die von Laufzeitdaten abhaengen:

- Leaflet-Icon-Groessen
- Marker-Anker und Popup-Anker
- Zoom-abhaengige Labelgroessen
- Feature-Farben aus Daten oder Konfiguration
- berechnete Pfad- oder Linienstyles
- Koordinaten-/Positionswerte
- Styles, die direkt aus User-/Map-State abgeleitet werden

Diese Werte sind Teil der Rendering-Logik, nicht nur Praesentation.

### 7.3 Pruefregel fuer CSS-Auslagerung

Ein Style darf nur ausgelagert werden, wenn:

- er nicht von Zoom, Koordinate, Feature-Typ oder User-State abhaengt
- er nicht als Inline-Wert fuer Leaflet-Geometrie gebraucht wird
- er nicht Teil eines dynamisch berechneten Icons ist
- die CSS-Spezifitaet nach der Auslagerung stabil bleibt
- der visuelle Smoke bestanden wird

## 8. Empfohlene Reihenfolge

### Schritt 1: Nur `map-features-*` in Unterordner verschieben

Ziel:

```text
js/map-features/map-features-labels.js                  -> js/map-features/labels.js
js/map-features/map-features-powerlines.js              -> js/map-features/powerlines.js
js/map-features/map-features-layer-state.js             -> js/map-features/layer-state.js
js/map-features/map-features-display-mode.js            -> js/map-features/display-mode.js
js/map-features/map-features-share-pin.js               -> js/map-features/share-pin.js
js/map-features/map-features-waypoints.js               -> js/map-features/waypoints.js
js/map-features/map-features-location-name-labels.js    -> js/map-features/location-name-labels.js
js/map-features/map-features-path-domain.js             -> js/map-features/path-domain.js
js/map-features/map-features-path-labels.js             -> js/map-features/path-labels.js
js/map-features/map-features-path-rendering.js          -> js/map-features/path-rendering.js
```

Nicht verschieben:

```text
js/map-features.js
```

HTML-Anpassung:

- nur Script-Pfade in `index.html` aendern
- Reihenfolge exakt beibehalten

Smoke:

- Karte laedt
- keine 404 fuer JS-Dateien
- keine Konsolenfehler
- Map-Mode-Wechsel
- Labels/Powerlines/Paths kurz pruefen
- Share-Pin kurz pruefen
- Waypoints/Route kurz pruefen

### Schritt 2: `dialogs-review-*` in Unterordner verschieben

Erst nach erfolgreichem Schritt 1.

Ziel:

```text
js/review/review-core.js       -> js/dialogs-review/core.js
js/review/review-status.js     -> js/dialogs-review/status.js
...
```

Offene Entscheidung:

- `js/dialogs-review.js` als Rest-Orchestrator zunaechst ebenfalls verschieben oder vorerst im Root lassen?

Empfehlung:

- Wenn verschieben, dann als letzter Script im neuen Ordner.
- Keine gleichzeitige Umbenennung, falls dadurch der Commit groesser wird.

Smoke:

- Review-/Meldungen-Panel oeffnen
- Dialoge oeffnen/schliessen
- mindestens je ein Location-/Path-/Label-/Region-Dialog kurz testen
- keine 404
- keine Konsolenfehler

### Schritt 3: SQL-Dateien ordnen

Erst nach JS-Pfad-Smokes.

Vorgehen:

- `.sql`-Dateien auflisten
- Referenzen suchen
- Zielstruktur bestaetigen
- Dateien verschieben
- Doku-/Skriptpfade aktualisieren

### Schritt 4: CSS aus JS auslagern

Nur in kleinen Gruppen.

Empfohlene erste Gruppe:

- statische Popup-/Dialog-/Button-Styles, falls vorhanden

Nicht als erste Gruppe:

- Leaflet-Icons
- Marker-Styles
- Label-Offsets
- Zoom-abhaengige Werte
- Path-Styles

### Schritt 5: Dead Code und Rename Audit

Erst nach Struktur-Cleanup.

Grund:

- Nach Ordnerstruktur und CSS-Auslagerung ist besser sichtbar, was wirklich unbenutzt oder schlecht benannt ist.
- Renames sollten nicht mit Pfadverschiebungen gemischt werden.

## 9. Erste sichere Code-Runde

Die risikoaermste erste Code-Runde ist:

```text
Move stable map-features split files into js/map-features/
```

Inhalt:

- neuen Ordner `js/map-features/` anlegen
- zehn stabile `map-features-*`-Splitdateien verschieben
- `index.html` Script-Pfade anpassen
- keine Funktionsnamen aendern
- keine Logik aendern
- `js/map-features.js` im Root lassen

Warum dieser Schritt zuerst:

- kleiner als der Dialog-Review-Block
- fachlich abgeschlossen und dokumentiert
- wenige Dateien im Vergleich zu `dialogs-review-*`
- klare Script-Reihenfolge bereits in `docs/refactoring-status.md` dokumentiert

## 10. Nicht vermischen

Nicht im gleichen Commit kombinieren:

- JS-Unterordner und SQL-Verschiebungen
- JS-Unterordner und CSS-Auslagerung
- Pfadverschiebungen und Rename Refactoring
- Pfadverschiebungen und Dead-Code-Entfernung
- `map-features-*` und `dialogs-review-*`, falls der Commit dadurch unuebersichtlich wird

## 11. Klare Empfehlung

Naechster Code-Schritt nach diesem Audit:

1. Nur `map-features-*`-Splitdateien nach `js/map-features/` verschieben.
2. Nur `index.html` Script-Pfade anpassen.
3. Kein Rename.
4. Keine Logikaenderung.
5. Browser-Smoke.

Danach erst entscheiden, ob `dialogs-review-*` folgt.
