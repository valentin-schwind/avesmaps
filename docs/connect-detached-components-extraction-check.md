# Connect Detached Components Extraction Check

## 1. Current Definition

- `connectDetachedGraphComponents` ist aktuell im Inline-Script von `index.html` definiert (`index.html:1493`).
- Aufgabe der Funktion:
  - findet zusammenhaengende Komponenten im Routing-Graphen,
  - waehlt die groesste Komponente als Anker,
  - ermittelt fuer jede weitere Komponente die naechste Verbindung,
  - fuegt synthetische Querfeldein-Kanten hinzu,
  - loggt die Anzahl hinzugefuegter synthetischer Verbindungen.

## 2. Dependencies

`connectDetachedGraphComponents(graph)`

- Liest globale Variablen:
  - keine direkt
- Schreibt globale Variablen:
  - keine direkt
  - indirekte Mutation ueber `addSyntheticGraphConnection(...)`:
    - `graph`-Objekt wird erweitert
    - globale `syntheticPathSegments` wird beschrieben
- Aufgerufene Funktionen:
  - `findGraphComponents(...)` (jetzt in `js/route-graph-core.js`)
  - `getSyntheticRouteConfig(...)` (Inline-Script)
  - `createLocationLookup(...)` (jetzt in `js/route-graph-core.js`)
  - `findNearestComponentConnection(...)` (jetzt in `js/route-graph-core.js`)
  - `addSyntheticGraphConnection(...)` (jetzt in `js/route-graph-core.js`)
- DOM/Leaflet/jQuery/API/map-Abhaengigkeiten:
  - keine direkten DOM-/Leaflet-/API-/map-Zugriffe
  - **indirekte UI-Abhaengigkeit**:
    - `getSyntheticRouteConfig(...)` ruft `getTransportOption(...)`
    - `getTransportOption(...)` (in `js/routing.js`) liest jQuery-UI-Controls (`#allowLand`, `#landTransport`, etc.).

## 3. Call Sites

Treffer per Suche:

1. Definition:
   - `index.html:1493`
2. Aufruf:
   - `index.html:1562` in `createGraph(...)`

Weitere Aufrufe in `js/*.js` wurden nicht gefunden.

## 4. Related Functions

- `getSyntheticRouteConfig` (`index.html:1483`)
  - bildet `routeType/speed` aus aktueller Transportauswahl.
  - haengt indirekt an UI (via `getTransportOption`).

- `getTransportOption` (`js/routing.js:243`)
  - jQuery-gebunden an Routing-Formularzustand.
  - liefert aktives Transportmittel fuer einen `routeType`.

- `createGraph` (`index.html:1532`)
  - ruft `syntheticPathSegments.clear()` auf,
  - baut regulare Kanten,
  - ruft danach `connectDetachedGraphComponents(graph)`.

- `addSyntheticGraphConnection` (`js/route-graph-core.js:44`)
  - fuegt bidirektionale synthetische Kanten hinzu,
  - schreibt Segmentdaten in `syntheticPathSegments`.

- `findNearestComponentConnection` (`js/route-graph-core.js:15`)
  - berechnet die naechste Verbindung zweier Komponenten.

- `syntheticPathSegments` (`js/runtime-state.js:19`)
  - globale Map fuer synthetische Segmente.
  - wird in `js/routing.js:getRouteSegments(...)` gelesen (`js/routing.js:151`).

## 5. Extraction Recommendation

Empfehlung: **erst nach Verschiebung oder Parameterisierung von `getSyntheticRouteConfig` sinnvoll**.

Begruendung:

- Rein technisch ist eine unveraenderte Verschiebung von `connectDetachedGraphComponents` moeglich (keine direkten DOM-/Leaflet-/API-Zugriffe, Aufruf nur zur Laufzeit aus `createGraph`).
- Die Funktion bleibt aber indirekt UI-gekoppelt durch `getSyntheticRouteConfig -> getTransportOption (jQuery)`.
- Ohne diesen Schritt wuerde `js/route-graph-core.js` weiter Richtung UI-gekoppelter Orchestrierung wachsen statt ein klarer Graph-Kern zu bleiben.

Explizit:
- **Verschiebung ohne Verhaltensaenderung ist moeglich**, aber als Architekturgrenze derzeit nur bedingt sauber.

## 6. Risk Assessment

Moegliche Regressionen:

- Transportoptionen:
  - indirekte UI-Abhaengigkeit kann zu schwerer nachvollziehbaren Fehlern fuehren (Land/Fluss/See-Auswahl wirkt auf Querfeldein-Verbindungen).

- Querfeldein-Verbindungen:
  - wenn `routeConfig` null oder falsch aufgeloest wird, entfallen synthetische Verbindungen fuer getrennte Komponenten.

- Route-Gewichtung:
  - fehlende/falsche synthetische Kanten aendern erreichbare Routen oder erzwingen laengere Umwege.

- Script-Reihenfolge:
  - bei verteilten globalen Abhaengigkeiten steigt das Risiko stiller Koppelung (insb. Inline-Script vs. ausgelagerte Datei).

- Sichtbare Routing-Regressionen trotz funktionierender Standardrouten:
  - Standardrouten zwischen gut verbundenen Orten koennen weiterhin funktionieren,
  - Probleme zeigen sich vor allem bei getrennten Komponenten/Edge-Cases.

## 7. Next Safe Commit

Da die Grenze aktuell primär `getSyntheticRouteConfig` ist, naechster sicherer Alternativschritt:

1. **Nicht** sofort `connectDetachedGraphComponents` verschieben.
2. Zuerst `getSyntheticRouteConfig` als eigenen kleinen Schritt behandeln:
   - entweder unveraendert mit verschieben (und Abhaengigkeit dokumentieren),
   - oder besser: Parameterisierung vorbereiten, sodass `connectDetachedGraphComponents` eine fertige `routeConfig` entgegennimmt.
3. Danach `connectDetachedGraphComponents` verschieben.

Wenn strikt am kleinsten technischen Schritt orientiert:

- `connectDetachedGraphComponents` kann auch direkt unveraendert verschoben werden,
- aber die empfehlenswertere Reihenfolge fuer saubere Grenzen ist: erst `getSyntheticRouteConfig`-Kopplung klaeren, dann verschieben.
