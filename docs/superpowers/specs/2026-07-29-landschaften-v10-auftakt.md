# Landschaften V10 — „Führt durch" + Flora am Routensegment — Auftakt

> **Kein fertiger Entwurf.** Diese Datei hält fest, was am 2026-07-29 bereits entschieden
> und gemessen wurde, damit die nächste Sitzung nicht bei null anfängt. Sie ersetzt die
> Brainstorming-Runde nicht — sie kürzt sie ab.

**Vorgänger:** V9 ✅ live und abgenommen 2026-07-29 (9.091 Zeilen, 0,4 s).
Spec `2026-07-29-landschaften-v9-vorberechnung-design.md`.
**Fahrplan-Zeile:** `docs/superpowers/plans/2026-07-24-landschaften.md` Zeile 2132.

---

## 1. Owner-Entscheid 2026-07-29 — der Umfang

**„Namen + Anteil, Flora nachgeladen."** An einer Routen-Etappe steht:

> **Führt durch:** Farindelwald (62 %), Winhaller Land (38 %)
> *darunter, faul nachgeladen:* die Flora/Fauna aus dem Lore-System

- **Nach Anteil sortiert**, das Größte zuerst.
- **Winzlinge unter ~5 % weggelassen** — die genaue Schwelle ist noch zu bestimmen; sie
  gehört an den Livebestand geeicht, nicht geraten.
- Beide Abstraktionsebenen aus V9 werden genutzt (Owner: „zählen, %e, binär — genau die
  Levels brauchen wir"), und die Zeile beantwortet die drei Beispielfragen des Owners:
  *führt der Weg durch einen Wald / durch die Region Heldentrutz / durch ein Gebirge*.

---

## 2. 🔴 Der Befund, der die Architektur entscheidet

**Die Route wird im BROWSER gerechnet, nicht auf dem Server.**
`USE_SERVER_ROUTING = false` (`js/routing/route-graph-routing.js:6`); die Oberfläche ruft
`calculateRouteClientLegacy` (`route-engine.js:456`), und der Kommentar bei
`calculateRouteByMode` sagt warum: Server-Routing ist async und noch nicht
`RouteResult`-kompatibel.

**Folge:** die Zuordnung kann **nicht** mit der Routenantwort mitreisen — es gibt keine.
Sie muss eigens geholt werden. Damit fallen zwei naheliegende Entwürfe aus:

| Weg | warum nicht |
|---|---|
| in der Antwort von `POST /api/route/` | die Oberfläche ruft diesen Endpunkt gar nicht |
| in der `map-features`-Nutzlast | +1,3 MB auf 18 MB, für jeden Besucher, ob er routet oder nicht |

**Also ein eigener Lese-Endpunkt.** Bereits entschieden:

- **Eine Anfrage je ROUTE**, nicht je Etappe. Eine Route hat 10–30 Etappen; ein Abruf je
  aufgeklapptem Popup wäre genau das Fan-out, das schon einmal wehgetan hat.
- **Faul, beim ERSTEN Aufklappen** — nie beim Markup-Bau.
  💣 Der Pool-Vorfall vom 2026-07-21 ist der Grund: Lore-Abrufe haben den PHP-Pool
  gesättigt. `buildLoreMarkup` (`map-features-lore.js:417`) liefert deshalb sofort einen
  leeren Container und lädt über einen DOM-Observer nach. V10 macht es genauso.
- **Je Route zwischengespeichert**, damit das zweite Popup nichts mehr holt.

---

## 3. Was aus V9 bereitsteht

- `path_ecosystem` mit `basis` **1 = gezeichnete Kurve** — das ist der Bezug für alles
  Gezeichnete, also auch für eine Einfärbung. `basis 0` (Sehne) ist der Bezug, in dem die
  Etappengrenzen des Graphen stehen. **Beim Schneiden von Etappe × Intervall muss der
  Bezug zusammenpassen** — Etappen kommen aus dem Graphen, also `basis 0`.
- Der Anteil ist `SUM(exit − enter) / Gesamtlänge`, die binäre Antwort ein `EXISTS`, die
  Zahl ein `COUNT` — alle drei aus denselben Zeilen.
- Die Typ-Frage („ein Gebirge") ist ein Join `path_ecosystem → ecosystem_area →
  ecosystem_region → region_type`.

---

## 4. 💣 Drei Fallen, schon gemessen

1. **Die Richtung.** Die Intervalle stehen in der **Zeichenrichtung des Wegs**. Eine Route
   kann ein Segment rückwärts befahren; dann wird aus „Eintritt bei 3,28" ein Austritt bei
   `Gesamtlänge − 3,28`. Wer das vergisst, lässt die Route den Wald verlassen, bevor sie
   ihn betritt.
2. **Nicht aufzählen.** Ein Flussweg durchquert dieselbe Region bis zu 13-mal, weil Flüsse
   selbst Grenzen sind (396 von 401 Mehrfach-Zeilen sind Flusswege). „Winhaller Land (13×)"
   wäre Unsinn — **zusammenfassen**, und zwar über den Anteil.
   ⚠️ **Keine Abstandsschwelle:** die Lücken zwischen zwei Durchquerungen liegen im Median
   bei **2,09 Meilen**, p75 bei 4,32 — das ist echte Geographie, kein Zittern. Bei 0,6
   Meilen Schwelle verschmelzen nur 97 von 597 Lücken.
3. **Ein Name, viele Segmente.** 15 aktive Wege heißen „Tommel". Eine Aussage über *den
   Fluss* muss über seine Segmente aggregieren; eine Aussage über *die Etappe* nicht.

---

## 5. Was noch offen ist

- Die Schwelle, unter der eine Landschaft nicht mehr genannt wird (Vorschlag ~5 %,
  **am Livebestand zu eichen**).
- Ob die Zeile auch im **Routenplaner-Text** steht oder nur im Etappen-Popup.
- Ob Meer/Kontinent/Küste hier sichtbar werden sollen — sie sind in V9 per
  `affects_paths = 0` gar nicht erst gerechnet, also heute unsichtbar.
- Der Zuschnitt des Lese-Endpunkts: öffentlich (`api/app/`) oder gated. **Öffentlich**,
  denn V10 ist eine Besucher-Ansicht — aber die Form (Wege-Liste rein, Zuordnung raus)
  gehört entworfen.

---

## 6. Einbaustellen

| | |
|---|---|
| Etappen-Popup | `buildRouteLegPopupHtml` (`js/routing/route-plan.js:196`), Zeilen-Helfer `:210`, letzte Zeile `:222` |
| Flora | `buildLoreMarkup` (`js/map-features/map-features-lore.js:417`) — **nur über den DOM-Observer** |
| Daten | `path_ecosystem` (V9), neuer Lese-Endpunkt |
