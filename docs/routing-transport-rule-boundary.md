# Routing Transport Rule Boundary

## 1. Ziel

Schritt 3 vorbereiten: Transportregeln und Geschwindigkeiten fachlich zentralisieren, ohne Werte oder sichtbares Verhalten zu aendern.

## 2. Ist-Stand

Aktuelle Regel- und Geschwindigkeitsstellen:

- `SPEED_TABLE` in `js/config.js`
- `getTransportOptionForRouteType(routeType, routeOptions)` in `js/routing.js`
- `isTransportAllowedForPath(pathProperties, transportOption)` in `js/routing.js`
- `createGraph(routeOptions)` im Inline-Script von `index.html`:
  - `isTransportAllowedForPath(...)`
  - `SPEED_TABLE[transportOption]?.[routeType]`
- `getSyntheticRouteConfig(routeOptions)` im Inline-Script von `index.html`:
  - `SPEED_TABLE[transportOption]?.[SYNTHETIC_ROUTE_TYPE]`

Damit ist Schritt 2 fuer die Route-Options-Entkopplung praktisch abgeschlossen: der Graph-Aufbau liest keine Planner-Controls direkt mehr.

## 3. Boundary fuer Schritt 3

Fachliche Trennung:

- Option-Aufloesung pro Routentyp
- Transportregelpruefung pro Pfad
- Speed-Aufloesung pro `transportOption + routeType`
- Synthetic-Speed-Aufloesung fuer `SYNTHETIC_ROUTE_TYPE`

Nicht-Ziele fuer den naechsten Code-Schritt:

- keine Anpassung von `SPEED_TABLE`-Werten
- keine neuen Transportarten
- keine Aenderung an Routing-Kostenfunktion
- keine UI-Aenderungen

## 4. Naechster kleiner Code-Schritt (empfohlen)

Kleiner verhaltensneutraler Schritt:

1. In `js/routing.js` einen reinen Helper einfuehren:
   - `resolveSpeedForRouteType(routeType, transportOption)`
   - intern exakt `SPEED_TABLE[transportOption]?.[routeType]`
2. In `index.html` nur die beiden direkten `SPEED_TABLE`-Zugriffe auf diesen Helper umstellen:
   - `addRegularPathToGraph(...)`
   - `getSyntheticRouteConfig(...)`
3. Keine weiteren Umstrukturierungen in demselben Commit.

## 5. Risiken

- Falsche Parameterreihenfolge oder Tippfehler koennen Pfade ungewollt ueberspringen.
- Synthetic-Fall darf nicht von regulaeren Pfadtypen abweichen.
- Warnmeldungen muessen unveraendert sinnvoll bleiben.
