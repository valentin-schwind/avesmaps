# CSS-Refactoring-Plan

Diese Datei beschreibt die Zielstruktur fuer das Stylesheet-Refactoring in Avesmaps. Der aktuelle Stand ist bewusst inkrementell: `css/styles.css` ist der stabile Einstiegspunkt und importiert neue Base-Dateien sowie vorerst das Legacy-Stylesheet.

## Aktueller Einstiegspunkt

`css/styles.css` soll dauerhaft die einzige Datei bleiben, die von der Hauptseite eingebunden wird. Intern importiert sie die modularen CSS-Dateien in definierter Reihenfolge.

Aktueller Stand:

```css
@import url("base/fonts.css");
@import url("base/tokens.css");
@import url("base/reset.css");
@import url("base/base.css");
@import url("legacy/styles-legacy.css");
```

Das Legacy-Stylesheet enthaelt den bisherigen Inhalt von `css/styles.css`. Dadurch bleibt das visuelle Verhalten der App zunaechst erhalten, waehrend neue CSS-Bereiche kontrolliert aufgebaut werden koennen.

## Zielstruktur

```text
css/
  base/
    fonts.css
    tokens.css
    reset.css
    base.css

  layout/
    app-shell.css
    map-layout.css
    overlays.css
    panels.css

  components/
    buttons.css
    forms.css
    modal.css
    context-menu.css
    combobox.css
    tabs.css
    toast.css
    tree.css

  features/
    map-scale-band.css
    map-decorations.css
    spotlight-search.css
    route-planner.css
    waypoints.css
    transport-options.css
    location-report.css
    edit-dialogs.css
    political-territory.css
    political-timeline.css
    review-panel.css
    wiki-sync.css
    measurement.css
    legal-dialog.css

  pages/
    main.css
    admin.css
    edit.css
    political-territory-editor.css

  legacy/
    styles-legacy.css
```

## Migrationsregel

Eine Regelgruppe wird erst dann aus `css/legacy/styles-legacy.css` entfernt, wenn sie in eine neue, spezifischere Datei verschoben wurde und die betroffenen Seiten getestet wurden.

Vorgehen pro Regelgruppe:

1. Zielbereich bestimmen: base, layout, component, feature oder page.
2. Neue CSS-Datei anlegen oder vorhandene Datei erweitern.
3. Import in `css/styles.css` oberhalb von `legacy/styles-legacy.css` eintragen.
4. Regelgruppe aus `legacy/styles-legacy.css` entfernen.
5. Hauptkarte und betroffene Dialoge/Editoren testen.

## Priorisierte Migration

1. `#map`, `html`, `body`, `.visually-hidden` und generische `[hidden]`-Regeln nach `base/` und `layout/` verschieben.
2. Admin-Regeln in `pages/admin.css` auslagern und nur in `admin/index.php` laden.
3. Edit-Shell-Regeln in `pages/edit.css` auslagern und nur in `edit/index.php` laden.
4. Den grossen Inline-Styleblock aus `html/political-territory-editor.html` nach `pages/political-territory-editor.css` verschieben.
5. Gemeinsame Dialog-/Overlay-Regeln nach `components/modal.css` und `layout/overlays.css` verschieben.
6. `location-report-form` schrittweise zu generischeren Formularregeln in `components/forms.css` ueberfuehren.
7. Feature-Regeln fuer Review, WikiSync, Routing, Transport, Timeline, Measurement und Political Territories trennen.

## Konventionen

- Generische Komponenten bekommen neutrale Namen, z. B. `.modal-dialog`, `.form`, `.button`, `.tabs`, `.combobox`.
- Feature-spezifische Klassen bleiben BEM-artig, z. B. `.review-panel__tab` oder `.political-territory-range__bar`.
- IDs sollen nur fuer JavaScript-Referenzen verwendet werden. Neue CSS-Regeln sollen moeglichst ueber Klassen laufen.
- JavaScript darf dynamische Positions-, Groessen- und Koordinatenwerte setzen. Statische Farben, Abstaende, Schatten, Fonts und Layoutregeln gehoeren in CSS.
- `legacy/styles-legacy.css` ist ein Zwischenzustand und soll mit jedem Refactoring-Schritt kleiner werden.
