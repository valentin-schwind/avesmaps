# Create Graph Transport Boundary Check

## 1. Current Definition

- `createGraph` ist im Inline-Script in `index.html` definiert (`index.html:1470`).
- Die Funktion baut den Routing-Graphen aus `locationData` und `pathData` auf.
- Dabei mischt sie Graph-Aufbau, Transportauswahl/Transportregeln und Nachbearbeitung fuer getrennte Komponenten.

## 2. Responsibilities

`createGraph` enthaelt aktuell diese Aufgaben:

- `syntheticPathSegments.clear()`
- Graph initialisieren (`graph[location.name] = {}`)
- `pathData` iterieren
- Start-/End-Location pro Pfad finden (`getLocationAtPathEndpoint`)
- Distanz berechnen (`calculatePathCoordinateDistance`)
- Route-Type normalisieren (`normalizePathSubtype`)
- Transportoption bestimmen (`getTransportOption(routeType)`)
- Transport fuer Pfad erlauben/ablehnen (`isTransportAllowedForPath(properties, transportOption)`)
- Geschwindigkeit bestimmen (`SPEED_TABLE[transportOption].[routeType]`)
- Graph-Kanten schreiben (`addGraphConnection` in beide Richtungen)
- getrennte Komponenten verbinden (`connectDetachedGraphComponents`)
- unverbundene Orte loggen

## 3. Direct Dependencies

Globale Daten/State:

- `locationData`
- `pathData`
- `syntheticPathSegments`

Globale Konstanten:

- `SPEED_TABLE`

Aufgerufene Funktionen:

- `getLocationAtPathEndpoint` (`js/map-features.js`)
- `calculatePathCoordinateDistance` (`js/map-features.js`)
- `normalizePathSubtype` (`js/map-features.js`)
- `getTransportOption` (`js/routing.js`)
- `isTransportAllowedForPath` (`js/routing.js`)
- `addGraphConnection` (`js/route-graph-core.js`)
- `connectDetachedGraphComponents` (Inline-Script)

DOM-/jQuery-/UI-Abhaengigkeiten:

- keine direkte DOM-/jQuery-Nutzung in `createGraph`
- indirekte UI-Kopplung ueber `getTransportOption` (liest Routing-Controls)

Abhaengigkeiten auf `route-graph-core.js`:

- `addGraphConnection`
- indirekt ueber `connectDetachedGraphComponents`:
  - `findGraphComponents`
  - `createLocationLookup`
  - `findNearestComponentConnection`
  - `addSyntheticGraphConnection`

Abhaengigkeiten auf `routing.js`:

- `getTransportOption`
- `isTransportAllowedForPath`

Abhaengigkeiten auf `map-features.js`:

- `getLocationAtPathEndpoint`
- `calculatePathCoordinateDistance`
- `normalizePathSubtype`

## 4. Transport Coupling

Entscheidende Transportkopplung in/um `createGraph`:

- `getTransportOption(routeType)`:
  - UI-gekoppelt (Land/Fluss/See-Checkboxen + Selects)
  - liefert ggf. `null` und blockiert dadurch Pfade
- `isTransportAllowedForPath(properties, transportOption)`:
  - nutzt `transport_domain` und `allowed_transports` aus Daten
  - fallback auf `getDefaultTransportDomainForPathSubtype(subtype)`
  - fallback auf `TRANSPORT_DOMAIN_OPTIONS[domain]`
  - Spezialfall: `Wuestenpfad` + `horseCarriage` explizit verboten
- `SPEED_TABLE`:
  - bestimmt Reisezeitgewichtung je Transport + Pfadtyp
  - fehlende Eintraege fuehren zum Ueberspringen von Pfaden
- `SYNTHETIC_ROUTE_TYPE` / `getSyntheticRouteConfig`:
  - fuer Querfeldein-Verbindungen in `connectDetachedGraphComponents`
  - ebenfalls indirekt UI-gekoppelt ueber `getTransportOption(SYNTHETIC_ROUTE_TYPE)`

## 5. Data/Core Boundary

Reine Daten-/Graph-Logik:

- Graph-Grundstruktur initialisieren
- Kantenobjekt erzeugen (`distance`, `time`, `routeType`, `id`, `transportOption`)
- Kanten in beide Richtungen schreiben
- Konnektivitaets-Nachbereitung (Komponenten verbinden) als Graph-Orchestrierung

UI-/Transport-Konfigurationslogik:

- Transportoption aus UI beziehen (`getTransportOption`)
- erlaubte Transporte aus Regelwerk/Daten entscheiden (`isTransportAllowedForPath`)
- synthetic route config aus aktivem Land-Transport ableiten

Teile mit `map-features.js`-Abhaengigkeit:

- Endpoint-Matching
- Koordinatendistanz auf Pfad-Geometrie
- Pfadtyp-Normalisierung

Teile mit `routing.js`-Abhaengigkeit:

- Transport-Resolver
- Transport-Regelpruefung

Teile, die spaeter Parameter werden koennten:

- Transport-Resolver pro `routeType`
- Transport-Eligibility-Pruefung pro Pfad
- Speed-Resolver (`transportOption` + `routeType` -> speed)
- Synthetic-Route-Konfiguration (statt intern ueber UI abzuleiten)

## 6. Refactoring Options

A. `createGraph` unveraendert lassen

- maximal stabil, kein Grenzgewinn

B. `createGraph` unveraendert nach `js/route-graph-core.js` verschieben

- technisch moeglich, aber architektonisch schlecht
- zieht indirekte UI-Kopplung in den Core

C. Kleine Helper-Funktion fuer regulaere Pfadverbindung extrahieren

- klein und risikoarm moeglich
- reduziert Funktionsgroesse, aber loest Transportkopplung nicht

D. Transport-Konfiguration vor `createGraph` berechnen und als Objekt/Resolver uebergeben

- sehr guter Zielzustand
- als sofortiger Schritt etwas breiter, aber verhaltensneutral moeglich

E. `getSyntheticRouteConfig` parameterisieren

- sinnvoll fuer spaetere Entkopplung von `connectDetachedGraphComponents`
- allein noch kein grosser Gewinn fuer regulaere Pfade

F. `isTransportAllowedForPath` aus `routing.js` herausloesen

- potenziell sinnvoll, aber aktuell quer zu bestehender Datei-/Verantwortungsgrenze
- Risiko, mehrere Bereiche gleichzeitig anzufassen

G. Zuerst Routing-Smoke-Test-Checkliste fuer Transportvarianten dokumentieren

- sehr sicher
- reduziert Risiko fuer alle naechsten kleinen Refactorings

## 7. Recommendation

Empfehlung: **G zuerst umsetzen (Routing-Smoke-Test-Checkliste fuer Transportvarianten dokumentieren).**

Begruendung:

- kleinster risikoarmer Schritt bei hohem Nutzen
- stabilisiert kommende Code-Schritte an der Transportkopplung
- keine neue UI-Kopplung in `js/route-graph-core.js`
- kein Verhalten, keine Laufzeitlogik wird angefasst

Explizit: Ein spaeterer Code-Schritt ohne Verhaltensaenderung ist moeglich.

## 8. Risk Assessment

Moegliche Regressionen bei spaeteren Eingriffen:

- deaktivierte Land-/Fluss-/See-Transportarten:
  - Pfade koennen unerwartet fehlen
- `Wuestenpfad` mit `horseCarriage`:
  - Spezialregel kann versehentlich entfallen oder doppelt greifen
- `allowed_transports` / `transport_domain` aus SQL-Daten:
  - Fallback-Reihenfolge kann kippen
- kuerzeste vs. schnellste Route:
  - falsche Speed-Aufloesung veraendert Zeitgewichtung
- synthetische Querfeldein-Verbindungen:
  - falsche synthetic-config fuehrt zu fehlenden Verbindungen
- fehlende Graph-Kanten:
  - jede falsche Skip-Bedingung reduziert Erreichbarkeit
- Warnungen:
  - "Keine Transportoption ..." / "Geschwindigkeit ... nicht definiert" koennen zunehmen und funktionale Probleme anzeigen

## 9. Next Safe Commit

Kein direkter Code-Commit als naechstes empfohlen.

Naechster besserer Analyse-/Dokuschritt:

1. `docs/routing-transport-smoke-checklist.md` anlegen.
2. Manuelle Testfaelle dokumentieren fuer:
   - shortest vs fastest
   - minimizeTransfers an/aus
   - Land/Fluss/See einzeln deaktiviert
   - `Wuestenpfad` mit/ohne Kutsche
   - Route mit synthetischer Querfeldein-Verbindung
3. Konkrete erwartete Beobachtungen/Warnungen notieren.

