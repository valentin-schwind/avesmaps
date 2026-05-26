# Refactoring TODO

Diese Liste sammelt konkrete Refactoring- und Aufraeumpunkte, die bei der strukturellen Sichtung des Avesmaps-Repositories aufgefallen sind. Fokus: Zukunftsfaehigkeit, Bearbeitbarkeit durch Menschen und Coding-Agenten, Lesbarkeit, DRY/Clean Code und sicher entfernbarer Dead Code.

## Erledigt

### `js/routing/routing.js`: alter `#inputLocation`-Click-Handler

Status: erledigt.

Der alte, spaeter ueberschriebene Click-Handler fuer `#inputLocation` ist im produktiven Code nicht mehr vorhanden. `hasFirstWaypoint`, die manuelle `waypointHtml`-Erzeugung und die alte Inline-Autocomplete-/Remove-Button-Logik wurden im aktuellen Stand nicht mehr in `js/routing/routing.js` gefunden.

Aktueller Stand in `routeDataRequest.then(...)`:

```js
initializeWaypointSorting();
$("#inputLocation").off("click").on("click", () => {
	appendWaypointInput().trigger("focus");
});
resetWaypointInputs();
```

## Prioritaet 1: Potentieller DCE / Debug- und Legacy-Pfade

### `js/routing/route-engine.js`: Server-Routing-Probe

Der Code um `shouldProbeServerRouting()`, `?serverrouting=1`, `buildServerRouteProbeRequest(...)`, `probeServerRouteForClientSegment(...)` und `logServerRouteProbeResult(...)` wirkt wie Migrations- oder Debug-Code fuer den Vergleich Client-Routing vs. Server-Routing.

Aufgabe:

- Entscheiden, ob `?serverrouting=1` noch aktiv gebraucht wird.
- Falls nein: Probe-Code entfernen.
- Falls ja: in eine explizite Debug-Datei verschieben, z. B. `js/routing/route-debug-probe.js`.

### `js/routing/route-engine.js`: Client-Routing-Legacy-Fallback

Der Code um `shouldUseServerPrimaryRouting()` und `?clientrouting=1` haelt den alten Client-Router als Fallback aktiv.

Aufgabe:

- Entscheiden, ob Client-Routing noch als Notfallpfad gebraucht wird.
- Falls Server-Routing endgueltig primaer ist: Fallback entfernen oder in ein Debug-/Dev-Modul auslagern.
- Falls der Fallback bleiben soll: Namen und Struktur expliziter machen, damit klar ist, dass es sich um einen bewusst erhaltenen Legacy-Pfad handelt.

## Prioritaet 2: CSS-DCE und CSS-DRY

### `css/styles.css`: doppelte Deklarationen in `body, html`

Im `body, html`-Block sind `margin`, `padding` und `height` doppelt gesetzt.

Aufgabe:

- Die wiederholten Deklarationen entfernen.

### `css/styles.css`: vermutlich tote Trust-Note-Regeln

Die Klasse `.location-report-dialog__trust-note` wurde in der bisherigen Suche nur in `css/styles.css` gefunden, nicht in HTML oder JS.

Aufgabe:

- Lokal mit `grep -R "location-report-dialog__trust-note" .` pruefen.
- Falls keine Nutzung existiert: folgende Regeln entfernen:
  - `.location-report-dialog__trust-note`
  - `#location-report-dialog .location-report-dialog__trust-note`

### `css/styles.css`: redundante Overlay-Regeln

Die Overlays fuer Location-, WikiSync-, Path-, Powerline-, Label- und Region-Dialoge enthalten weitgehend identische CSS-Regeln.

Aufgabe:

- Gemeinsame Klasse einfuehren, z. B. `.modal-overlay`.
- Nur abweichende Werte wie `z-index` separat lassen.
- Markup entsprechend angleichen.

## Prioritaet 3: CSS aus HTML herausziehen

### `html/political-territory-editor.html`: grosser Inline-Styleblock

Der Territory-Editor enthaelt einen grossen `<style>`-Block direkt im HTML. Das erschwert Wartung und Agenten-Bearbeitung.

Aufgabe:

- Neue Datei `css/political-territory-editor.css` anlegen.
- Den kompletten Inline-Styleblock aus `html/political-territory-editor.html` dorthin verschieben.
- Im HTML stattdessen einbinden:

```html
<link rel="stylesheet" href="/css/political-territory-editor.css">
```

- `css/political-territory-wiki-tree.css` separat behalten, weil es als wiederverwendbare Tree-Komponente wirkt.
- Danach pruefen, ob zwischen `styles.css`, `political-territory-wiki-tree.css` und `political-territory-editor.css` doppelte Regeln existieren.

## Prioritaet 4: CSS-Scope trennen

### Admin- und Edit-Styles aus `css/styles.css` auslagern

`css/styles.css` enthaelt auch Styles fuer `admin/index.php` und `edit/index.php`, z. B. `.admin-shell`, `.admin-panel`, `.admin-user-form`, `.edit-page`, `.edit-login`, `.edit-shell`.

Diese Styles sind nicht tot, gehoeren aber nicht zwingend in das Haupt-CSS der Karte.

Aufgabe:

- `css/admin.css` fuer `admin/index.php` anlegen.
- `css/edit.css` fuer `edit/index.php` anlegen.
- Die entsprechenden Regeln aus `css/styles.css` herausziehen.
- In den jeweiligen PHP/HTML-Einstiegen die neuen CSS-Dateien laden.

## Prioritaet 5: `index.html` entlasten

`index.html` ist weiterhin App-Shell, grosses Dialog-Markup, Review-/Editor-Markup, Legal-Text, Script-Liste und Bootstrap-Code zugleich.

Aufgabe:

- Karteninitialisierung, Pane-Setup, TileLayer-Setup und globale UI-Events aus dem Inline-Script in eine Datei verschieben, z. B. `js/app/bootstrap.js`.
- Dialog- und Panel-Markup langfristig auslagern oder in Template-Funktionen ueberfuehren.
- Ziel: `index.html` als moeglichst kleine App-Shell.

## Prioritaet 6: `js/config.js` in echte Config und Verhalten trennen

Status: teilweise erledigt.

Die Runtime-Patches wurden aus `js/config.js` entfernt und in den politischen Territory-/Layer-Kontext verschoben. `config.js` ist dadurch wieder deutlich naeher an einer reinen Konstanten-/Default-Datei.

Noch offen:

- Reine Konstanten weiter in kleinere Dateien aufteilen, z. B.:
  - `js/config/app-constants.js`
  - `js/config/api-endpoints.js`
  - `js/config/transport-config.js`
  - `js/config/tile-config.js`
  - `js/config/planner-defaults.js`
- Langfristig keine Verhalten installierenden Funktionen in einer Datei namens `config.js` belassen.

## Prioritaet 7: globale Overrides reduzieren

Aktuell gibt es Stellen, an denen globale Funktionen nachtraeglich ersetzt oder per Timeout installiert werden.

Beispiele:

- `route-engine.js` ersetzt `window.updateMapView` durch `updateMapViewServerPrimary`.
- Region-Visibility-Verhalten wird zeitversetzt installiert.

Aufgabe:

- Durch explizite Controller-/Strategy-Struktur ersetzen.
- Beispiel: `routingController.setEngine(serverEngine)` statt spaeterem Global-Override.
- Beispiel: `regionVisibilityController.install(policy)` statt Timeout-basiertem Override.

## Prioritaet 8: PHP-API weiter splitten

`api/edit/map/features.php` ist Dispatcher, Validierung, Repository-/DB-Zugriff, Locking, Audit und Feature-Domainlogik in einer Datei.

Aufgabe:

- Datei schrittweise reduzieren.
- Moegliche Zielstruktur:
  - `api/_internal/map-features/validation.php`
  - `api/_internal/map-features/repository.php`
  - `api/_internal/map-features/audit.php`
  - `api/_internal/map-features/locks.php`
  - `api/_internal/map-features/geometry.php`
- `api/edit/map/features.php` langfristig auf Request-Handling, Action-Dispatch und Fehlerbehandlung reduzieren.

## Prioritaet 9: DOM-Selektoren zentralisieren

Viele Dialoge verwenden wiederkehrende DOM-IDs und Selektoren direkt in Event- und Dialoglogik.

Aufgabe:

- Pro Dialog kleine Ref-Funktionen einfuehren, z. B.:
  - `getLocationEditRefs()`
  - `getRegionEditRefs()`
  - `getPathEditRefs()`
- Ziel: Selektoren nur an einer Stelle pro Dialog pflegen.
- Das erleichtert Codex/Copilot-Aenderungen und reduziert Tippfehler bei DOM-IDs.

## Prioritaet 10: `js/ui/ui-controls.js` splitten

`ui-controls.js` enthaelt mehrere unabhaengige UI-Domaenen: Kartendekoration, Massstabsband, Entfernungsmessung und Transport-Comboboxen.

Aufgabe:

- In kleinere Dateien aufteilen:
  - `js/ui/map-decorations.js`
  - `js/ui/scale-band-control.js`
  - `js/ui/distance-measurement.js`
  - `js/ui/transport-combobox.js`

## Prioritaet 11: Encoding pruefen

In `js/config.js` wurden mojibake-artige Strings gesehen, z. B. `GroÃƒÅ¸stÃƒÂ¤dte`.

Aufgabe:

- Lokal pruefen, ob das tatsaechlich im Repository steht oder nur durch die Connector-Anzeige verursacht wurde.
- Falls es im Repository steht: Encoding korrigieren.

## Nicht blind loeschen

Folgende Bereiche sind nicht als DCE einzustufen, auch wenn sie auf den ersten Blick ungenutzt wirken koennen:

- `.status-grid` und `.stat` im Territory-Editor: Markup existiert, UI ist nur versteckt.
- Review-, WikiSync-, Route-Plan- und Context-Menu-Klassen: Viele werden dynamisch per JS erzeugt.
- Political-Territory-Klassen: Viele sind dynamisch oder editor-spezifisch.
- `installPoliticalTerritoryLayerGeometryMerge()`: kein DCE, sondern aktive Laufzeitlogik.
- `installPoliticalRegionVisibilityBehavior()`: kein DCE, sondern aktives Verhalten.
