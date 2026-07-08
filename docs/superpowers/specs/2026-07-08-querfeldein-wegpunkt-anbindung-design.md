# Querfeldein-Anbindung an den nächsten Land-Weg-Punkt

**Datum:** 2026-07-08
**Status:** Design freigegeben (Owner), Implementierung offen
**Kontext:** Karten-Meldung #39 (Xoltax) — Reiseroute „Friedhof der Seeschlangen → Boran"

## 1. Problem & Ausgangslage

Der Routing-Graph ist stark fragmentiert (~1615 abgetrennte Komponenten, viele davon
isolierte Einzelorte ohne Weganbindung). Die Brückenlogik verbindet **jede** abgetrennte
Komponente per synthetischer „Querfeldein"-Kante mit der **größten** (Anchor-)Komponente,
am nächsten Knotenpaar detached↔Anchor:

- Client (maßgeblich, UI nutzt `USE_SERVER_ROUTING=false`):
  `connectDetachedGraphComponents` in `js/routing/route-graph-routing.js`
  (Hilfen `findNearestComponentConnection`, `addSyntheticGraphConnection` in `route-graph-core.js`).
- Server-Spiegel: `avesmapsConnectClientCompatibleDetachedGraphComponents` in
  `api/_internal/routing/client-graph.php`.

Folge: Ein reiner See-Ort wie der **Friedhof der Seeschlangen** (nur Seewege, keine Land-Wege)
ist bei nur-Land isoliert und wird an die zufällig weit entfernte Anchor gehängt (Kreuzung-33,
87 Einheiten ≈ 260 Meilen quer über die Karte) → absurder West-Umweg (cost 2334).

**Zwischenlösung (2026-07-07, Commit `358d704e`): ein Distanzlimit** von 15 Einheiten für
Brücken. Wird hiermit **verworfen** — es wirft legitime lange Querfeldein-Strecken (z. B. eine
Dschungel-Durchquerung) mit den absurden Umwegen in einen Topf und meldet dort fälschlich
„keine Route".

## 2. Ziel & Nicht-Ziele

**Ziel:** Ein isolierter **Reise-Wegpunkt** wird per Querfeldein an den **nächstgelegenen
Punkt auf einem Land-Weg** angebunden (kürzeste Luftlinie zum Wegenetz), statt an einen fernen
Hub. Sehr lange Querfeldein-Etappen bekommen einen Hinweis in der Etappen-Liste.

**Nicht-Ziele (YAGNI):**
- Die ~1600 sonstigen isolierten Orte werden **nicht** einzeln umgestellt (nur die vom Nutzer
  gewählten Reise-Wegpunkte). Grund: Punkt-zu-Weg über alle Orte ≈ 24 Mio Rechenschritte pro
  Graph-Build → auf STRATO riskant, bräuchte einen räumlichen Index.
- Andockung an **Fluss- oder Seewege** ist ausgeschlossen (nur Land-Wege).
- Kein Distanzlimit / keine „keine Route" für weit entfernte Orte — sie werden immer verbunden.

## 3. Design

### A. Distanzlimit entfernen
Rücknahme von `358d704e`: die Konstante `SYNTHETIC_ROUTE_MAX_BRIDGE_DISTANCE` (config.js) bzw.
`AVESMAPS_ROUTE_CLIENT_SYNTHETIC_MAX_BRIDGE_DISTANCE` (client-graph.php) und der `> LIMIT →
continue`-Check in beiden Brückenschleifen. Die Komponenten-Brücken (Anchor) bleiben **unverändert**
erhalten und garantieren weiterhin die Grund-Vernetzung (Dijkstra findet immer einen Weg).

### B. Wegpunkt-Anbindung an den nächsten Land-Weg-Punkt (Kern)
Neuer Schritt beim Graph-Bau, **nachdem** der reguläre Graph (inkl. Komponenten-Brücken) steht,
für jeden Reise-Wegpunkt `W` ∈ {from, to, via…}:

1. **Isoliert-Prüfung:** Hat der Knoten `W` mindestens eine **Land-Weg-Kante** (routeType ∈
   {`Reichsstrasse`,`Strasse`,`Weg`,`Pfad`,`Gebirgspass`,`Wuestenpfad`})? Wenn ja → nichts tun
   (W hängt bereits am Wegenetz). Kreuzungen und weg-angebundene Orte sind damit ausgenommen.
2. **Nächsten Weg-Punkt suchen:** Über alle Land-Wegsegmente die minimale **Punkt-zu-Polyline-
   Distanz** von `W` bestimmen. Ergebnis: Zielsegment `S` (zwischen Graph-Knoten `A` und `B`),
   Projektionspunkt `P` (nächster Punkt auf `S`), Luftlinien-Distanz `d`.
3. **Segment an `P` teilen:** Neuen Knoten `P` einfügen; die Kante `A↔B` durch `A↔P` und `P↔B`
   ersetzen (Geometrie an `P` aufgeteilt, Distanz/Zeit anteilig, Transport-Typ von `S` geerbt).
   Fällt `P` mit `A` oder `B` zusammen (Projektion trifft einen Endknoten), entfällt der Split —
   dann direkt an diesen Knoten anbinden.
4. **Querfeldein-Kante:** `W ↔ P` als synthetische Querfeldein-Kante (Distanz `d`, Kosten
   `d × SYNTHETIC_ROUTE_DISTANCE_COST_FACTOR`, Geometrie = Luftlinie `W→P`) — dieselbe Bauart wie
   die bestehenden Brücken (`addSyntheticGraphConnection`).

Da diese Anbindung die kürzeste Luftlinie zum Wegenetz nutzt, ist sie i. d. R. günstiger als die
ferne Anchor-Brücke → Dijkstra wählt sie, der Umweg verschwindet. Die Anchor-Brücke bleibt als
Rückfall bestehen (falls `P` in einer Teil-Komponente liegt, die selbst nur über die Anchor
erreichbar ist).

### C. Warnhinweis bei langer Querfeldein-Etappe
Nach dem Routing: Enthält die fertige Route eine **Querfeldein**-Etappe, deren Länge die Schwelle
`SYNTHETIC_ROUTE_LONG_LEG_WARN_DISTANCE` (Vorschlag **20 Einheiten ≈ 60 Meilen**, anpassbare
Konstante in config.js) überschreitet, bekommt **dieser Abschnitt** in der Etappen-Liste einen
dezenten Zusatz, z. B. *„lange Querfeldein-Strecke — über See evtl. kürzer"*. Rein visuell; keine
Auswirkung auf die Routenberechnung.

## 4. Datenfluss

```
Route angefordert (from/to/via, aktive Transporte)
  → Graph bauen (Kanten aus Wegen; Komponenten-Brücken wie bisher, OHNE Limit)   [A]
  → für jeden Wegpunkt: isoliert? → nächsten Land-Weg-Punkt anbinden (Split + Querfeldein)  [B]
  → Dijkstra
  → Etappen rendern; lange Querfeldein-Etappe? → Hinweis am Abschnitt   [C]
```

## 5. Client + Server
- **Client (maßgeblich):** `js/routing/route-graph-core.js` / `route-graph-routing.js` — neuer
  Anbindungsschritt + Segment-Split-Helfer; Warnhinweis im Etappen-Renderer (`js/routing/route-plan.js`
  o. Ä.). Konstanten in `js/config.js`.
- **Server-Spiegel:** `api/_internal/routing/client-graph.php` — gleicher Anbindungsschritt, damit
  `POST /api/route/` konsistent bleibt (stabile API). Warnhinweis ist rein clientseitig (UI).
- **Reihenfolge/Anker:** Wegpunkt-Namen kommen aus dem normalisierten Request (from/to/via).

## 6. Edge-Cases & Fehlerbehandlung
- **Kein Land-Transport aktiv** (nur Fluss/See): Querfeldein-Domäne aus → weder Brücken noch
  Wegpunkt-Anbindung (bestehender Guard) → ggf. „keine Route", korrekt.
- **Wegpunkt schon am Weg:** Schritt B1 überspringt.
- **Kein Land-Wegsegment im Graph:** keine Anbindung möglich → Grund-Konnektivität über Anchor
  greift (oder „keine Route").
- **Projektion trifft Endknoten:** kein Split, direkt anbinden (siehe B3).
- **Mehrere isolierte Wegpunkte:** jeder einzeln; Splits sind unabhängig (unterschiedliche Segmente
  oder derselbe Weg an verschiedenen Punkten).

## 7. Testing (Verifikation)
- **Server-API (`POST /api/route/`):**
  - Friedhof→Boran, nur Land → **eine plausible Route** (kurzer Querfeldein-Schlag zum nächsten
    Weg Richtung Boran + Straße), cost deutlich unter dem alten Umweg (2334) und keine 87u-
    Querfeldein-Kante mehr.
  - Friedhof→Boran, mit See → unverändert cost 7,7 (See-Route gewinnt).
  - Punin→Kuslik / Gareth→Punin, nur Land → unverändert reine Straßenrouten, 0 Querfeldein.
- **Isolierter Unit-Test (PHP):** Ort neben einem Weg-Segment → Anbindung am Projektionspunkt
  (nicht am Endknoten); Ort direkt auf einem Knoten → kein Split.
- **Client/UI:** Friedhof→Boran nur-Land live im Browser → kurze Querfeldein-Linie zum Weg sichtbar,
  Etappen-Liste zeigt den Warnhinweis an der langen Querfeldein-Etappe.
- **Regressions-Runde:** einige gemischte Routen (Land+See) auf unveränderte Kosten prüfen.

## 8. Offene Detail-Entscheidungen (für den Plan)
- Genaue Graph-/Geometrie-Datenstruktur des Client-Graphen für den Segment-Split (Kanten-Geometrie,
  wie Kreuzungen/Splits heute schon eingefügt werden — vgl. bestehendes Splitten an inneren
  Location-Vertices).
- Exakter Wortlaut des Warnhinweises (Owner-Freigabe, DE).
- Warnschwelle final (Startwert 20u).
