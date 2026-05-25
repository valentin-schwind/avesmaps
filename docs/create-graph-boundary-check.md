# Create Graph Boundary Check

## 1. Current createGraph Responsibilities

`createGraph` ist aktuell im Inline-Script von `index.html` definiert (`index.html:1532`) und uebernimmt mehrere Aufgaben in einer Funktion:

- `syntheticPathSegments.clear()` am Start (`index.html:1533`)
- leeres Graph-Objekt fuer alle `locationData`-Eintraege initialisieren (`index.html:1534-1537`)
- ueber alle `pathData` iterieren (`index.html:1538`)
- Start-/Endpunkte per `getLocationAtPathEndpoint(...)` auf Locations mappen (`index.html:1539-1541`)
- Distanz per `calculatePathCoordinateDistance(...)` berechnen (`index.html:1542`)
- Route-Type per `normalizePathSubtype(...)` normalisieren (`index.html:1543`)
- Transportoption aus UI-Zustand per `getTransportOption(...)` aufloesen (`index.html:1544`)
- Transport erlauben/ablehnen per `isTransportAllowedForPath(...)` (`index.html:1549-1551`)
- Geschwindigkeit per `SPEED_TABLE` bestimmen (`index.html:1552-1556`)
- Graph-Kanten schreiben per `addGraphConnection(...)` (bidirektional, `index.html:1558-1559`)
- getrennte Komponenten per `connectDetachedGraphComponents(graph)` verbinden (`index.html:1562`)
- unverbundene Orte loggen (`index.html:1564-1567`)

## 2. Direct Dependencies

Direkte Abhaengigkeiten von `createGraph`:

- Globale Daten / State:
  - `locationData` (lesen)
  - `pathData` (lesen)
  - `syntheticPathSegments` (schreiben via `.clear()`)
- Globale Konstanten:
  - `SPEED_TABLE`
- Direkt aufgerufene Funktionen:
  - `getLocationAtPathEndpoint` (`js/map-features.js:1584`)
  - `calculatePathCoordinateDistance` (`js/map-features.js:1588`)
  - `normalizePathSubtype` (`js/map-features.js:1516`)
  - `getTransportOption` (`js/routing.js:243`)
  - `isTransportAllowedForPath` (`js/routing.js:257`)
  - `addGraphConnection` (`js/map-features.js:1579`)
  - `connectDetachedGraphComponents` (`index.html:1493`)
- UI-/jQuery-Abhaengigkeiten:
  - indirekt direkt ueber `getTransportOption`, das `#allowLand/#allowRiver/#allowSea` und Selects ausliest.
- map/Leaflet/DOM/API:
  - `createGraph` selbst hat keine direkten Leaflet-/DOM-/API-Zugriffe.

## 3. Nested Dependencies

Indirekte Ketten rund um `createGraph`:

- `getTransportOption` (`js/routing.js:243`)
  - jQuery-gekoppelt an Routing-Controls.
- `isTransportAllowedForPath` (`js/routing.js:257`)
  - nutzt `normalizePathSubtype(...)` und `getDefaultTransportDomainForPathSubtype(...)`.
  - `getDefaultTransportDomainForPathSubtype` liegt in `js/dialogs-review.js:3543` (cross-file Kopplung in Richtung Review/UI-Datei).
- `connectDetachedGraphComponents` (`index.html:1493`)
  - ruft `getSyntheticRouteConfig(...)` (`index.html:1483`) auf.
- `getSyntheticRouteConfig`
  - ruft wiederum `getTransportOption(SYNTHETIC_ROUTE_TYPE)` auf, also indirekt UI-Status.
- `addSyntheticGraphConnection` (`js/route-graph-core.js:44`)
  - schreibt in globale `syntheticPathSegments`
  - ruft `addGraphConnection(...)` (aktuell `js/map-features.js`) und `buildSyntheticPathSegment(...)` (aktuell `js/map-features.js:2630`) auf.

## 4. Boundary Assessment

- `createGraph` sollte vorerst im Inline-Script bleiben.
  - Grund: direkte Abhaengigkeit auf `getTransportOption(...)` (UI-gekoppelt) plus Orchestrierung ueber mehrere Bereiche.
- `connectDetachedGraphComponents` jetzt verschieben ist technisch moeglich, aber als Boundary nicht ideal.
  - Es zieht indirekt weiterhin UI-Kopplung (`getSyntheticRouteConfig -> getTransportOption`) in den Core.
- Besser zuerst ein kleiner reiner Helfer extrahieren, der keine UI-/DOM-Abhaengigkeit hat.

## 5. Candidate Next Tiny Steps

### A. `connectDetachedGraphComponents` direkt verschieben
- Technisch: moeglich ohne offensichtliche Laufzeitbarriere.
- Boundary: unsauber wegen indirekter UI-Kopplung.
- Bewertung: nicht erster Wunschschritt.

### B. `getSyntheticRouteConfig` verschieben
- Technisch: moeglich, aber explizite Abhaengigkeit auf `getTransportOption` bleibt.
- Boundary: wuerde UI-Logik staerker in `route-graph-core.js` verankern.
- Bewertung: nicht empfohlen.

### C. `createGraph` parameterisieren
- Architektur: sinnvoll als Endziel.
- Diff-Risiko: fuer "naechster kleiner Schritt" zu gross (Signatur, Aufrufer, Testflaeche).
- Bewertung: jetzt zu riskant/gross.

### D. `addGraphConnection` nach `js/route-graph-core.js` verschieben
- Technisch: sehr klein, rein, keine UI/DOM/Leaflet/API-Abhaengigkeit.
- Nutzen: reduziert Rueckwaertsabhaengigkeit von `route-graph-core.js` auf `map-features.js`.
- Bewertung: guter naechster Minischritt.

### E. `buildSyntheticPathSegment` nach `js/route-graph-core.js` verschieben
- Technisch: ebenfalls rein und ohne UI/DOM/Leaflet/API.
- Nutzen: weiterer Abhaengigkeitsabbau.
- Bewertung: sinnvoll, aber groesser als D; besser als Folgeschritt nach D.

### F. Nur Dokumentation ergaenzen und hier stoppen
- Stabilitaet: maximal sicher.
- Fortschritt: kein technischer Abbau der aktuellen Koppelungen.
- Bewertung: nur wenn aktuell keine weiteren minimalen Schritte gewuenscht sind.

## 6. Recommendation

Empfehlung fuer **genau den naechsten Schritt**: **Option D (`addGraphConnection` unveraendert nach `js/route-graph-core.js` verschieben).**

Begruendung:

- kleinster sinnvoller Diff,
- keine Verhaltensaenderung noetig,
- keine UI-Abhaengigkeit im Core neu eingefuehrt,
- verbessert die Grenze fuer spaetere Schritte an `createGraph` und `connectDetachedGraphComponents`.

Explizit: Ein weiterer Code-Schritt ohne Verhaltensaenderung ist moeglich.

## 7. Risk Assessment

Moegliche Regressionen beim naechsten Grenzbereich:

- Standardrouting:
  - fehlende oder doppelte `addGraphConnection`-Definition kann Kantenaufbau brechen.
- Synthetische Querfeldein-Verbindungen:
  - wenn Graph-Kanten nicht korrekt geschrieben werden, fehlen Verbindungen trotz laufender Berechnung.
- Transportauswahl / deaktivierte Transportarten:
  - Risiken bleiben weiterhin in `createGraph`/`getTransportOption`-Kette; durch Schritt D selbst nicht vergroessert.
- Fehlende Route-Segmente:
  - Folgefehler moeglich, wenn Kanten-ID-Pfade nicht mehr im Graphen ankommen.
- Edge-Case-Warnungen:
  - Konsolenwarnungen wie "Keine Route..." oder "Kein Segment gefunden..." koennen erst bei seltenen Komponenten sichtbar werden.

## 8. Next Safe Commit

Kleinstmoeglicher sinnvoller Code-Commit:

1. `addGraphConnection` unveraendert von `js/map-features.js` nach `js/route-graph-core.js` verschieben.
2. Definition in `js/map-features.js` entfernen (keine weitere Logik aendern).
3. Checks:
   - genau eine Definition von `addGraphConnection` in `index.html + js/*.js`
   - Aufrufstellen unveraendert vorhanden (`index.html`, `js/route-graph-core.js`)
   - `node --check js/route-graph-core.js`
   - `node --check js/map-features.js`
   - Diff nur in den beiden betroffenen Dateien.

