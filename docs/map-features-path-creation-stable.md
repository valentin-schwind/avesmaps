# Path-Creation Stable Split

## Zweck

Dieses Dokument markiert den engen 1:1-Split der Path-Creation-Helfer aus `js/map-features.js` als stabilen Stand.

Wichtig: Dies war ein kontrollierter Extract ohne Logikaenderung.

## Verschobene Funktionen

Nach `js/map-features-path-creation.js` wurden verschoben:

- `clearPendingPathCreation`
- `showPendingPathCreationPreview`
- `updatePendingPathCreationLine`
- `startPathCreationAt`
- `startPathCreationFromLocation`
- `appendPendingPathCreationLocation`
- `extendPendingPathCreationAtLocation`
- `completePendingPathCreationAtLocation`
- `handlePendingPathCreationClick`

## Bewusst nicht verschoben

Als Shared-Helper bleibt in `js/map-features.js`:

- `findNearestGraphEndpointToLatLng`

Begruendung:

Die Funktion wird weiterhin auch vom Path-Geometry-Editing genutzt und bleibt bis zu einer eigenen Geometry-Boundary zentral verfuegbar.

## Script-Reihenfolge

Im Map-Features-Bereich gilt:

1. `js/map-features-path-domain.js`
2. `js/map-features-path-labels.js`
3. `js/map-features-path-rendering.js`
4. `js/map-features-path-creation.js`
5. `js/map-features.js`

`js/map-features-path-creation.js` wird vor `js/map-features.js` geladen, damit die globalen Funktionsnamen beim Aufruf verfuegbar sind.

## Smoke-Plan

Nach diesem Split sollte manuell geprueft werden:

1. Seite laedt ohne Konsolenfehler.
2. Wegerstellung ueber Karte/Context startet.
3. Start aus bestehendem Ort funktioniert.
4. Zwischenpunkte werden sichtbar gesammelt.
5. Zielort schliesst den Flow und erstellt den Weg.
6. Neuer Weg erscheint und Path-Edit-Dialog oeffnet.
7. Abbruch/Neustart raeumt Preview-Marker und Preview-Linie auf.
8. Path-Creation blockiert laufende Powerline-Creation nicht.
9. Kurzer Routing-Check nach neuem Weg.
10. Reload/URL ohne Fehler.

## Smoke-Ergebnis

Betreiber-Smoke bestanden: Punkte 1-14 ohne Auffaelligkeiten.

## Entscheidung

Der Path-Creation-Split ist stabil abgeschlossen und soll vorerst nicht weiter aufgeteilt werden.

Naechster Kandidat bleibt Path-Geometry-Editing mit eigener Boundary-Analyse.
