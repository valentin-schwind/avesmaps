# Create Graph Next Helper Plan

## 1. Current createGraph Loop

Aktuell laeuft in `createGraph` (`index.html:1470`) ein `pathData.forEach(...)`, das pro Feature folgendes macht:

- Endpunkte bestimmen:
  - `startNode = getLocationAtPathEndpoint(coordinates[0])`
  - `endNode = getLocationAtPathEndpoint(coordinates[coordinates.length - 1])`
- nur bei vorhandenen Endpunkten weiter
- Distanz berechnen: `calculatePathCoordinateDistance(coordinates)`
- `routeType` normalisieren: `normalizePathSubtype(...)`
- `transportOption` bestimmen: `getTransportOption(routeType)`
  - bei `null`: `console.warn(...)` und `return` (skip)
- Transportregel pruefen: `isTransportAllowedForPath(properties, transportOption)`
  - bei `false`: `return` (skip)
- Geschwindigkeit aufloesen: `SPEED_TABLE[transportOption]?.[routeType]`
  - bei fehlender speed: `console.warn(...)` und `return` (skip)
- Connection bauen:
  - `{ distance, time: distance / speed, routeType, id: properties.id, transportOption }`
- bidirektionale Kanten schreiben:
  - `addGraphConnection(graph, startNode.name, endNode.name, connection)`
  - `addGraphConnection(graph, endNode.name, startNode.name, connection)`

## 2. Candidate Helper Boundaries

### A. `buildRegularPathConnection(pathFeature)` gibt Daten oder `null` zurueck

- Vorteil:
  - trennt "connection bauen" von "in Graph schreiben"
  - klar testbare Rueckgabe (`null` oder Payload)
- Nachteil:
  - braucht weiterhin Endpoint-Aufloesung ausserhalb oder als zusaetzlichen Rueckgabeteil
  - etwas mehr Umbau im Loop (Destructuring/Null-Checks)

### B. `addRegularPathToGraph(graph, pathFeature)` schreibt direkt in `graph`

- Vorteil:
  - kleinster diff im `createGraph`-Loop (pro Iteration nur ein Helper-Aufruf)
  - Skip-/Warnlogik kann 1:1 uebernommen werden
  - bidirektionales Schreiben bleibt lokal zusammenhaengend
- Nachteil:
  - Funktion bleibt gemischt (Daten + Transportregeln), aber in kleinerem, benannten Block

### C. `resolvePathTransportConfig(properties)` kapselt nur `transportOption/speed`

- Vorteil:
  - fokussiert auf Transportkopplung
- Nachteil:
  - zu klein fuer echten Entlastungseffekt in `createGraph`
  - Endpoint/Distance/Connection-Aufbau bleiben weiterhin im Hauptloop
  - mehr Zwischenvariablen/Glue-Code im Loop

### D. Keine Extraktion, `createGraph` unveraendert lassen

- Vorteil:
  - kein Risiko
- Nachteil:
  - kein Fortschritt bei Lesbarkeit/Schrittweiser Entkopplung

## 3. Recommended Helper

Empfehlung: **Variante B: `addRegularPathToGraph(graph, pathFeature)`**

Begruendung:

- kleinster realistischer Diff
- keine Verhaltensaenderung noetig (Warntexte, Skip-Reihenfolge, Datenfluss bleiben identisch)
- gute Lesbarkeit: `createGraph` wird sichtbar orchestrierend
- geringe Regressionflaeche: nur eine lokale Extraktion im selben Inline-Script
- keine neue UI-Kopplung in `js/route-graph-core.js` (Helper bleibt vorerst in `index.html`)
- guter spaeterer Nutzen fuer Parameterisierung, weil der regulaere Pfadblock klar abgegrenzt ist

## 4. Exact Proposed Function

Skizze fuer den naechsten Code-Schritt (nahezu exakter Code, **noch nicht umsetzen**):

```js
function addRegularPathToGraph(graph, { geometry: { coordinates }, properties }) {
	const startNode = getLocationAtPathEndpoint(coordinates[0]);
	const endNode = getLocationAtPathEndpoint(coordinates[coordinates.length - 1]);
	if (startNode && endNode) {
		const distance = calculatePathCoordinateDistance(coordinates),
			routeType = normalizePathSubtype(properties?.feature_subtype || properties?.name),
			transportOption = getTransportOption(routeType);
		if (!transportOption) {
			console.warn(`Keine Transportoption fuer ${routeType} gefunden. Pfad wird uebersprungen.`);
			return;
		}
		if (!isTransportAllowedForPath(properties, transportOption)) {
			return;
		}
		const speed = SPEED_TABLE[transportOption]?.[routeType];
		if (!speed) {
			console.warn(`Geschwindigkeit fuer ${transportOption} auf ${routeType} nicht definiert. Pfad wird uebersprungen.`);
			return;
		}
		const connection = { distance, time: distance / speed, routeType, id: properties.id, transportOption };
		addGraphConnection(graph, startNode.name, endNode.name, connection);
		addGraphConnection(graph, endNode.name, startNode.name, connection);
	}
}
```

Und in `createGraph` nur:

```js
pathData.forEach((pathFeature) => {
	addRegularPathToGraph(graph, pathFeature);
});
```

## 5. Required Checks

Fuer den spaeteren Code-Commit:

- Definition/Callsite-Suche:
  - `rg -n "function addRegularPathToGraph|addRegularPathToGraph\\(" index.html js`
  - `rg -n "function createGraph|pathData\\.forEach\\(" index.html`
- Diff-/Dateigrenze:
  - nur `index.html` geaendert
- Invarianzpruefung:
  - Warntexte exakt gleich:
    - `Keine Transportoption ...`
    - `Geschwindigkeit ... nicht definiert ...`
  - Skip-Reihenfolge unveraendert
  - bidirektionale `addGraphConnection`-Aufrufe weiterhin vorhanden
- Syntax:
  - kein direkter `node --check` fuer Inline-Script; manuell im Browser pruefen
- Manuelle Smoke-Faelle (aus `docs/routing-transport-smoke-checklist.md`) mindestens:
  - Abschnitt 3 (Baseline-Routing)
  - Abschnitt 4 (Umstiege minimieren)
  - Abschnitt 5 (Transportarten an/aus)
  - Abschnitt 6 (Transportmittel wechseln)
  - Abschnitt 9 (synthetische Querfeldein-Verbindungen)

## 6. Risk Assessment

Wichtige Risiken bei der Extraktion:

- Skip-Bedingungen:
  - `!transportOption`, `!isTransportAllowedForPath`, `!speed` muessen identisch bleiben
- Reihenfolge:
  - Warnungen nur in den bisherigen Faellen
- `console.warn`-Texte:
  - unveraendert lassen fuer bestehende Diagnose-Workflows
- speed lookup:
  - `SPEED_TABLE[transportOption]?.[routeType]` exakt beibehalten
- `transportOption === null`:
  - darf nicht spaeter geprueft werden als bisher
- `Wuestenpfad + horseCarriage`:
  - bleibt in `isTransportAllowedForPath`; keine Umgehung einbauen
- `allowed_transports` / `transport_domain`:
  - Regelweg unveraendert ueber `isTransportAllowedForPath`
- bidirektionale Kanten:
  - beide Richtungen muessen erhalten bleiben

## 7. Next Safe Commit

Praeziser naechster Code-Commit:

1. In `index.html` neue Funktion `addRegularPathToGraph(graph, pathFeature)` direkt oberhalb `createGraph` einfuegen.
2. Bestehenden Block innerhalb `createGraph`-`pathData.forEach` 1:1 in diese Funktion verschieben.
3. In `createGraph` den Loop auf einen Helper-Aufruf reduzieren.
4. Keine weiteren Aenderungen.

Vorgesehene Commit-Message:

- `Extract regular path graph helper`


