# Sperrzeiten und Reisemittel-Sperren in der Routenwahl — Entwurf

**Stand:** 14.09.2026, Entwurf — **wartet auf GO**. Mockup: `docs/sperrzeiten-routing-mockup.html`.

**Owner-Entscheid 14.09.2026, wörtlich:** „ja und bei den etappen entsprechen andeuten (ein Hinweis
am Anfang oder an dem Punkt in der Etappenliste, dass die route sich aufgrund einer sperrung
geändert hat)"

**Vorgeschichte:** `docs/superpowers/specs/2026-08-03-reisezeitpunkt-design.md` §6 (die Uhr-Frage)
und `docs/superpowers/plans/2026-08-03-reisezeitpunkt-instruction.md` Phase 4 („Sperrung wirkt auf
die Wegwahl") — dort mit **„exakt je Kante, gegen das akkumulierte Datum"** beantwortet (Owner
03.08.2026, §7.4). Dieser Entwurf baut genau diese Phase und den Hinweis dazu.

---

## 1. Befund — gemessen, nicht angenommen

### 1.1 Die Daten (Dump vom 08.09.2026, 6.065 aktive Wege)

| | Abschnitte | Wege |
|---|---|---|
| **Zeitfenster** (`transport_seasons`) | **92** | |
| — an Land | 38 | 7: Eisenstraße (16), Raschtulsweg (9), Saljethweg (5), Roterzpass (4), Hjaldorpass (2), Rabenpass (1), Weg-5994 (1) |
| — auf See | 54 | unbenannte `Meer-…`/`Seeweg-…`-Abschnitte, **alle** 1. Peraine – 30. Boron |
| — auf Flüssen | 0 | |
| **Reisemittel-Sperre** (Vorgabe der Wegart minus gespeicherte Liste) | | |
| — an Land | **94** | 75 Wege, 20 mit echtem Namen (Schattenbachpass, Bärenpfad, Goblinstieg, Hahnentritt …) |
| — auf Wasser | 600 | (der Normalfall: kein Segler am Oberlauf) |

### 1.2 Der Code

- **Die Reisemittel-Sperre wirkt schon heute** — im Graphbau
  (`avesmapsAddClientCompatiblePathConnection`, `api/_internal/routing/client-graph.php`: eine
  Kante, deren Weg das Mittel nicht erlaubt, entsteht gar nicht). **Still:** der Plan sagt nie,
  dass deshalb ein Umweg gefahren wird.
- **Das Zeitfenster wirkt nicht.** `avesmapsTransportOpenOn` / `avesmapsSeasonClosureFor`
  (`transport-season.php`, JS-Spiegel `transport-season.js`) sind gebaut und getestet, haben aber
  keinen Aufrufer. `route-engine.js` schickt keinen Reisebeginn an `POST /api/route/`, obwohl der
  Planer ihn längst kennt (`#travelStartMonth`, im Teilen-Link `startMonth`/`startDay`).

### 1.3 Live-Probe (14.09.2026, zwei Einzelanfragen)

**Yrramis → Greifenfurt, schnellste Route:**

| Reisemittel | Strecke | Dauer | Weg |
|---|---|---|---|
| Reisegruppe zu Fuß | **284,8 Meilen** | 14,45 Tage | Saljethweg (Yrramis–Mühlingen) → Schattenbachpass → Greifenfurt |
| Kutsche | **2.942,8 Meilen** | 36,43 Tage | Lowangen → Svellt → **über See um den Norden** → Nostria → Angbar → Greifenfurt |

Die Kutsche darf die Gebirgspass-Abschnitte des Schattenbachpasses nicht befahren (nur zu Fuß).
Der Router nimmt deshalb die zehnfache Strecke — und die Etappenliste verschweigt den Grund.
**Im Firun** wäre zusätzlich schon der erste Abschnitt zu Fuß gesperrt: Yrramis–Mühlingen gehört
zum Saljethweg (befahrbar 15. Peraine – 30. Efferd).

> 🔴 **Korrigiert nach dem Bau (Live-Probe 14.09.2026, API-Revision 16): die Kutsche bekommt KEINEN
> Hinweis — und das ist richtig.** Der Schattenbachpass besteht aus Gebirgspass-Abschnitten (nur zu Fuß
> = eine Reisemittel-Sperre) **und** aus Pfad-Abschnitten, und ein Pfad trägt die Kutsche von Hause aus
> nicht (Wegart-Vorgabe, keine Sperre). Auch ohne die Sperre käme sie nicht durch: der Vergleichslauf lief
> (`touched 1, compared 1`), fand aber keinen billigeren Weg. Der Satz oben „die Kutsche darf die
> Gebirgspass-Abschnitte nicht befahren, deshalb die zehnfache Strecke" war damit nur halb wahr.
> **Der echte Fall ist das Zeitfenster:** zu Fuß ab 3. Firun 330,7 statt 284,8 Meilen, 15,84 statt
> 14,45 Tage, Bericht „Saljethweg, am 3. Firun gesperrt", Abzweig in Yrramis, Vergleich 3,1 ms.

---

## 2. Was gebaut wird — in drei Sätzen

1. Die Anfrage bekommt ein **optionales** Reisedatum; mit ihm schließt der Router Kanten, deren
   Zeitfenster am **Tag der Durchreise** zu ist.
2. Hat eine Sperre — Zeitfenster **oder** Reisemittel — die Route verändert, rechnet der Server
   **einen Vergleichslauf ohne Sperren** und meldet, welcher Weg umgangen wurde und wo die Route
   abzweigt.
3. Der Plan zeigt das **am Anfang** (dass und wie viel länger) **und am Abzweig** (welcher Weg und
   warum); gibt es gar keinen offenen Weg, **sagt die Absage den Grund**.

---

## 3. Die Anfrage — additiv, optional

```json
{ "from": "Yrramis", "to": "Greifenfurt", "departure": { "month": "firun", "day": 3 } }
```

- **Fehlt `departure`** (oder ist `null`), wird kein Zeitfenster gefragt — die Antwort ist Zeichen
  für Zeichen die heutige. Das ist die Pflicht des stabilen Vertrags (AGENTS.md §4), und derselbe
  Satz, der schon in `transport-season.php` steht: *ohne Reisebeginn wird die Frage nicht gestellt.*
- `month` ist einer der zwölf Schlüssel aus `AVESMAPS_TRAVEL_CALENDAR_MONTHS`; ein unbekannter Monat
  ist `400 invalid_request` (wie jedes andere Enum-Feld). `day` wird auf 1…30 geklemmt, wie im
  Kalender (`avesmapsTravelCalendarDayOfYear`) — ein Link mit „31. Firun" reist am 30.
- Die Namenlosen Tage sind als Aufbruch nicht wählbar (wie im Planer); die Uhr läuft durch sie
  hindurch.
- 🔴 **Die Reisemittel-Sperre braucht kein Datum** und wirkt weiter mit und ohne `departure`. Neu ist
  für sie nur die Meldung (§5).

---

## 4. Die Sperre im Router

### 4.1 Zeitfenster: exakt je Kante, gegen die mitlaufende Uhr

- Jede Kante eines Weges trägt das **Fenster ihres Reisemittels** (`season_window`), und nur wenn es
  eins gibt — 92 von 6.065 Abschnitten. Alle anderen Kanten bleiben Byte für Byte, was sie sind.
- Der Dijkstra führt je Label die **verstrichene Kalenderzeit** mit. Beim Entspannen einer Kante mit
  Fenster wird gefragt: *liegt der Tag, an dem der Reisende hier ankommt, im Fenster?* Nein → die
  Kante wird übersprungen. Die Frage selbst stellt die vorhandene Funktion
  (`avesmapsSeasonWindowContainsDay`), keine zweite.
- 🔴 **EINE Uhr, EINE Funktion.** Die Kalenderstunden einer Kante rechnet
  `avesmapsRouteEdgeCalendarHours(connection)` — Reisestunden (`time / cost_factor × 3 × 1,19`, die
  zwei Umrechnungen aus AGENTS.md §10) mal `24 / Reisetag` des Reisemittels. Dieselbe Rechnung
  steckt heute in `avesmapsRouteDurationFromSegments`; sie wird dort herausgezogen, nicht
  abgeschrieben.
- ⚠️ **Die Uhr ist die anteilige des Servers, nicht die Portionsrast des Plans.** `duration.travel_days`
  rechnet seit jeher anteilig, der Reiseplan im Browser bucht die Nacht in ganzen Portionen
  (`avesmapsRouteRestPortions`). An einer Fenstergrenze können die beiden **um bis zu einen Tag**
  auseinanderliegen: der Plan datiert eine Etappe auf den 30. Efferd, der Server hat sie am 1. Travia
  gesehen. Benannt, nicht verborgen — der Hinweis nennt das Datum **des Servers**.
- ⚠️ **Kein Warten.** Wer vor einem Pass steht, der in drei Tagen öffnet, wartet nicht; die Route wird
  ohne ihn gesucht. Daraus folgt auch: bei Fenstern, die sich *während* der Reise öffnen, ist die
  Label-Suche eine Näherung (früher ankommen kann dort schlechter sein). Das trifft nur Routen genau
  am Rand eines Fensters.
- ⚠️ **Via-Etappen:** die Uhr läuft über die Stationen hinweg weiter.

💣 **Die Falle, die diesen Umbau zweimal kosten würde: die Teilkanten.**
`avesmapsBuildClientRouteSubPathConnection` baut beim Teilen einer Kante (Wegpunkt-Anker **und**
Ausstiegs-Mehrfachteiler) ein **neues** Array aus einer **festen Feldliste** — alles, was dort nicht
steht, geht verloren. Ein am Pass geteilter Weg führe dann mit zwei fensterlosen Hälften durch den
Winter, und kein Test ohne Teilung sähe es. Das Fenster wird **dort** mitgenommen, und ein Test fährt
genau diesen Fall.

⚠️ **Die vier Querfeldein-Erzeuger bleiben unberührt** (Komponentenbrücke, Wegpunkt-Anker,
Kartenpunkt-Anbindung, Direktkante; AGENTS.md §11). Sie tragen kein Fenster, und der Graph wird
weiter mit **allen** Kanten gebaut — eine Sperre trennt dort also keine Komponente, und es entsteht
**keine stille Querfeldein-Brücke über einen gesperrten Pass**. Ist ein Ort nur über eine gesperrte
Kante erreichbar, findet der Dijkstra nichts, und die Antwort ist eine **Absage mit Grund** (§5.4).

### 4.2 Reisemittel-Sperre: Wirkung unverändert, nur sichtbar gemacht

- Die Kante entsteht weiter nicht — **keine Verhaltensänderung**.
- Neu: die Kante wird **zusätzlich** in eine Nebenliste gelegt (`$clientGraph['gesperrt']`), die
  **kein Erzeuger liest**. Nur der Vergleichslauf (§5) nimmt sie dazu.
  🔴 Stünde sie im Graphen mit einem „gesperrt"-Vermerk, sähen Komponentensuche, Anker und
  Ausstiegskandidaten sie als offen — heute gebaute Brücken fielen weg, und Kutschenrouten würden
  ungefunden. Genau das verhindert die Nebenliste.

### 4.3 Welche Sperre ist „eine Sperrung" im Sinn des Hinweises?

| | wirkt auf die Route | erzeugt den Hinweis |
|---|---|---|
| Zeitfenster, Land | ja (neu) | ja |
| Zeitfenster, See/Fluss | ja (neu) | **ja** — die Seefahrt ruht im Winter, das muss man wissen |
| Reisemittel-Sperre, Land | ja (wie heute) | **ja** — dieselbe Regel wie die Kursivschrift: *Vorgabe der Wegart minus Liste* |
| Reisemittel-Sperre, Wasser | ja (wie heute) | **nein** — 600 Abschnitte, der Normalfall (vgl. `path-einschraenkung.js`) |

🔴 Eine **Erweiterung** (ein Editor hat eine Kutsche auf einem Pfad erlaubt) ist keine Sperre.

---

## 5. „Anders wegen Sperrung" erkennen — der Vergleichslauf

### 5.1 Wann er läuft

Nur wenn der eigentliche Lauf eine gesperrte Kante **berührt** hat: ein gesetzter Knoten, an dem
eine Kante wegen ihres Fensters übersprungen wurde oder eine Nebenlisten-Kante hängt.

⭐ **Das ist ein Beweis, keine Abkürzung:** jede billigere Route über eine Sperre beginnt an dem
Knoten vor ihrer ersten gesperrten Kante; ihr offener Anfang ist billiger als das Ziel, also hat
der Dijkstra diesen Knoten gesetzt, bevor er das Ziel erreichte. Hat er keinen solchen Knoten
gesetzt, kann keine Sperre die Route verändert haben. **Eine gewöhnliche Route zahlt nichts.**

### 5.2 Was er tut

Derselbe Dijkstra auf demselben Graphen — Zeitfenster aus, Nebenliste dazu. Einmal, am Ende, nach
der Sehnen-Verfeinerung (sonst verglichen sich zwei verschiedene Graphen).

### 5.3 Wann es einen Hinweis gibt

Genau dann, wenn die Vergleichsroute **gefunden** ist, **billiger** ist (im Gewicht des gewählten
Modus) **und mindestens eine gesperrte Kante benutzt**. Aus ihr werden gelesen:

- **der Abzweig:** die erste Kante, an der echte Route und Vergleichsroute auseinandergehen
  (`diverges_at_edge_id`, dazu der Knoten);
- **die umgangenen Wege:** je Weg eine Zeile — gruppiert wie die Kursivschrift (`wiki_key`, sonst
  Wegart + Name), mit Art, Namen, Fenster bzw. erlaubten Mitteln und dem Tag, an dem die
  Vergleichsroute dort gewesen wäre;
- **der Mehraufwand:** Kalendertage (Schnellste) bzw. Meilen (Kürzeste), aus beiden Läufen mit
  derselben Uhr.

### 5.4 Kein offener Weg

Findet der eigentliche Lauf nichts, die Vergleichsroute aber schon: `found: false` wie bisher, dazu
dieselbe Meldung mit `blocked: true`. Kein stiller Umweg, keine Notbrücke, kein „Keine Route
gefunden" ohne Grund.

---

## 6. Die Antwort — additiv

```json
"route": {
  "found": true,
  "departure": { "month": "firun", "day": 3 },
  "closures": [
    {
      "leg_index": 0,
      "blocked": false,
      "diverges_at_node": "Yrramis",
      "diverges_at_edge_id": "path-4127",
      "avoided": [
        {
          "kind": "season",
          "path_name": "Saljethweg",
          "public_ids": ["298d65bf-01a2-5ede-ade0-11ce11dd0d8f"],
          "transport": "groupFoot",
          "reached_on": { "month": "firun", "day": 3, "nameless": false },
          "open_from": { "month": "peraine", "day": 15 },
          "open_to": { "month": "efferd", "day": 30 }
        },
        {
          "kind": "transport",
          "path_name": "Schattenbachpass",
          "public_ids": ["…"],
          "transport": "horseCarriage",
          "allowed": ["groupFoot", "lightWalker"]
        }
      ],
      "unrestricted": { "distance_units": 94.9, "travel_hours": 115.6, "travel_days": 14.45 }
    }
  ]
}
```

- `closures` **fehlt**, wenn keine Sperre die Route verändert hat — die Antwort bleibt kompakt, und
  ein alter Client sieht nichts Neues. `departure` steht nur da, wenn es geschickt wurde.
- Ein unbenannter Seeweg hat keinen `path_name` (`""`); der Client beschreibt ihn über die
  Anlegestellen seiner Etappe.
- `AVESMAPS_ROUTE_API_CODE_REVISION` → 16. `api/README.md` bekommt den Abschnitt „Travel date and
  closures".
- In `debug.context.closures`: `touched`, `compared`, `ms` — damit „warum kam kein Hinweis?" ohne
  Nachbauen beantwortbar ist.

---

## 7. Der Client

- **Anfrage:** `buildServerRouteProbeRequest` schickt `departure` aus `routePlanDepartureFromPanel()`.
  💣 **Die Karte fragt je Wegpunkt-PAAR** (`buildRouteResultFromSelectedLocationsServer`). Das Datum
  des zweiten Paares ist deshalb der Reisebeginn **plus die Kalenderzeit des ersten**
  (`duration.travel_days × 24`) — dieselbe Uhr wie im Server. Ohne das begänne jedes Paar am
  Aufbruchstag, und eine Reise über drei Wegpunkte hätte dreimal den 3. Firun.
- **Anzeige (Empfehlung Variante C im Mockup):**
  - **am Anfang**, unter dem Reisetitel: *dass* die Route wegen einer Sperrung anders läuft, und um
    wie viel länger;
  - **am Abzweig**, in der Etappe, die ihn enthält: *welcher* Weg, *warum* (Fenster oder erlaubte
    Mittel) und *wann* er offen ist. Der Wegname ist ein Link und zoomt auf den gesperrten Weg.
  - 🔴 Beide Stellen sagen **Verschiedenes** — dieselbe Aussage zweimal liest sich wie zwei Angaben.
  - Die Etappe am Abzweig wird über die **Kanten-ID** gefunden (`diverges_at_edge_id` gegen
    `segment.properties.id` im Ausschnitt des Paares), nicht über den Knotennamen: der kann
    „Kreuzung-2480" oder ein Anker sein, und nach dem Verschmelzen der Etappen gibt es ihn nicht mehr.
    Wird sie nicht gefunden, bleibt der Hinweis am Anfang allein stehen.
- **Absage:** statt `alert("Keine Route … gefunden")` steht der Grund im Panel (Mockup, Karte D).
  Die übrigen Absagen bleiben, wie sie sind.
- **Wortlaut:** Satzformen der Reisemittel und die Fenster-Formulierung kommen aus
  `js/map-features/path-einschraenkung.js` — dieselben, die die Infobox des Weges zeigt. Keine zweite
  Formulierung derselben Sperre.
- 💣 **Zwei Feldlisten** (`route-result.js` und `route-view-model.js`): ein neues Etappenfeld, das in
  einer fehlt, kommt lautlos nie an (der `offroad`-/`season_ground`-Kommentar dort).
- Der Tooltip des Reisebeginns („Die Route selbst wird ohne diesen Abzug gesucht") und der
  SPERRUNG-Kommentar in `index.html` werden nachgezogen, samt `js/app/i18n-en.js`.

---

## 8. Bewusst nicht

- **Kein Warten** vor einem Pass (§4.1).
- **Keine Kartendarstellung** gesperrter Wege — die Kursivschrift gibt es schon, und der Link im
  Hinweis zoomt dorthin.
- **Kein anderer Ausstieg**, wenn der nächste erreichbare Netzpunkt eines Kartenpunkts auf einem
  gesperrten Weg liegt — das ist die Ausstiegsregel des Owners (15.08.2026); die Antwort ist dann
  eine Absage mit Grund. Kommt das vor, ist es ein eigener Entscheid.
- **Die JS-Hintertür `?clientrouting=1`** bekommt keine Sperrzeiten. Sie ist seit dem Server-Routing
  keine Routenwahl mehr, nur noch Prüfhaken-Index.
- **Wasser-Reisemittel-Sperren** erzeugen keinen Hinweis (§4.3).

---

## 9. Kosten — gemessen wird beim Bau

- Die Fensterfrage kostet eine `isset`-Prüfung je Entspannung; nur 92 Kanten tragen ein Fenster.
- Der Vergleichslauf kommt nur, wenn eine Sperre berührt wurde (§5.1). Gemessen wird: Dijkstra-Zeit
  mit/ohne `departure` an der Test-Fixture, dazu **eine** Live-Probe Yrramis → Greifenfurt vor und
  nach dem Deploy (`debug.context.closures.ms`). Heute: 1,66 s (zu Fuß), 0,83 s (Kutsche) für die
  ganze Anfrage.

---

## 10. Prüfen

**PHP (Server), Ablauf ausgeführt, nicht gegrept:**

1. Ohne `departure`: Antwort zeichengleich mit heute (Byte-Vergleich an einer Fixture).
2. Pass mit Fenster, Durchreise **im** Fenster → über den Pass, kein `closures`.
3. Durchreise **außerhalb** → Umweg; `closures` nennt Weg, Fenster, Erreichdatum, Abzweig, Mehraufwand.
4. **Die Uhr:** der Pass liegt so weit hinten, dass der Aufbruch im Fenster liegt, die Ankunft am Pass
   aber nicht → gesperrt (exakt je Kante, nicht gegen den Aufbruch).
5. **Die Teilkante:** ein Wegpunkt-Anker teilt den Pass → beide Hälften bleiben gesperrt.
6. Kein offener Weg → `found: false`, `blocked: true`, keine Querfeldein-Brücke.
7. Reisemittel-Sperre (Kutsche) → Umweg wie heute **plus** Meldung `kind: transport`; Wasser-Sperre →
   keine Meldung.
8. Nichts berührt → `debug.context.closures.compared === false`.
9. `via`: die Uhr läuft über die Station weiter.

Jeder davon gegen eine Mutation gefahren (Fenster aus der Teilkante gestrichen, Uhr auf den
Aufbruchstag gesetzt, Beweisbedingung §5.1 umgedreht, Wasser in die Hinweisregel genommen …).

**JS (Client):** `departure` reist mit; Paar 2 beginnt an Tag 1 + Kalenderzeit von Paar 1; Kopf-
Hinweis und Vermerk am Abzweig werden aus einer Antwort-Attrappe gebaut und stehen an der richtigen
Etappe; Absage im Panel; beide Feldlisten tragen das Feld.

**Abnahme (Ablauf, nicht Maß):** Yrramis → Greifenfurt zu Fuß, Reisebeginn 3. Firun → Hinweis am
Anfang („1,4 Tage länger") und an der ersten Etappe, Link zoomt zum Saljethweg. Reisebeginn 1. Praios →
Route wie heute, kein Hinweis. Mit Kutsche → der große Umweg wie heute und **kein** Hinweis (siehe die
Korrektur in §1.3). In hell und dunkel angesehen.

---

## 11. Nebenbefund — nicht Teil dieses Umbaus

`segments[].cost_units` ist die Kantenzeit **inklusive** des ×25-Aufschlags einer Querfeldein-Brücke
(`client-graph.php`: `'cost_units' => $segment['time']`, `cost_factor` daneben).
`avesmapsRouteDurationFromSegments` macht daraus Stunden, **ohne** durch `cost_factor` zu teilen — eine
Route über eine Notbrücke meldet in `duration.travel_hours` vermutlich das 25-Fache der Brückenzeit.
Die Uhr in §4.1 teilt heraus; ob `duration` es auch soll, ist ein eigener Befund.

---

## 12. Entschieden (Owner 14.09.2026: „go, C und Absage im Panel")

1. **Der Hinweis steht an beiden Stellen, mit verteilten Rollen** (Variante C): oben *dass* und *wie
   viel länger*, am Abzweig *welcher Weg* und *warum*.
2. **Die Absage steht im Panel**, nicht im Popup — nur für den Fall „nur wegen einer Sperrung keine
   Route"; die übrigen Absagen bleiben, wie sie sind.

⚠️ **Wortlaut beim Bau nachgeschärft:** die Tafel im Mockup schrieb „Umweg um den Saljethweg". Der
Artikel hängt am Geschlecht des Namens („um die Eisenstraße", „um den Rabenpass"), und die Namen
kommen aus den Daten — gebaut ist deshalb die artikelfreie Form **„Gesperrt: Saljethweg — am 3. Firun,
befahrbar vom 15. Peraine bis zum 30. Efferd."**

---

## 13. Nachtrag: Reisebeginn unbekannt (Owner 14.09.2026, während des Baus)

Owner, wörtlich: „wir müssen auch noch festlegen, dass bei ‚Unbekanntem' Reisebeginn keine Sperrungen
passieren, aber ein Hinweis kommt, dass man die Reisezeit überprüfen sollte, sofern die Routenplanung
feststellt, dass es Sperrungen geben könnte."

1. 🔴 **Ohne `departure` wird kein Zeitfenster geprüft** — das stand schon so in §3/§4.1 und bleibt.
   Die Reisemittel-Sperre wirkt weiter (sie hängt nicht am Datum) und meldet sich wie in §5.
2. **Neu: `route.seasonal_ways`** — nur ohne `departure` und nur bei gefundener Route: die Wege **auf
   der gefundenen Route**, deren Kanten ein Zeitfenster für das gewählte Reisemittel tragen. Je Weg
   `path_name`, `public_ids`, `subtype`, `transport`, `from_node`, `open_from`, `open_to`
   (`avesmapsRouteSeasonalWays`, `api/_internal/routing/closures.php`). Fehlt, wenn nichts da ist.
   ⚠️ „Könnte gesperrt sein" heißt hier: die Route **benutzt** einen Weg mit Fenster. Ein Weg, den eine
   andere Jahreszeit erst ins Spiel brächte, wird nicht gesucht — das wäre ein Vergleichslauf je
   Jahreszeit, und die Frage an den Reisenden ist dieselbe.
3. **Anzeige:** derselbe Kasten `.route-plan-sperrung` unter dem Reisetitel, keine neue CSS-Regel:
   „Ohne Reisebeginn geplant — auf der Route liegen Sperrzeiten: *Saljethweg* (befahrbar vom
   15. Peraine bis zum 30. Efferd). Bitte den Reisebeginn prüfen." Der Name ist derselbe zoombare Link.
   Keine Etappe bekommt einen Vermerk — umgangen ist nichts. Mockup: Karte „Reisebeginn unbekannt".
4. 💣 **Ein Wechsel von Monat oder Tag sucht die stehende Route NEU** (`refreshPlan` in
   `js/map-features/map-features-waypoints.js` ruft `updateMapView`, sobald `currentRouteSegments`
   gefüllt ist; ohne Route bleibt es beim Neuzeichnen). Dort stand „neu zeichnen, nicht neu suchen" —
   richtig, solange das Datum nur die Anzeige trug. Seit dieser Umbau das Datum in die Routenwahl
   nimmt, liesse bloßes Neuzeichnen den alten Hinweis und die alte Route stehen: wer auf den Hinweis hin
   den Reisebeginn setzt, sähe ihn nie verschwinden.

**Prüfen:** PHP §E in `sperrzeiten-routing-test.php` (mit Datum kein `seasonal_ways`, ohne Datum der
Saljethweg, Route ohne Fenster leer); JS `sperrzeiten-anfrage.test.js` §6, `sperrzeiten-hinweis.test.js`
Fall 10, `js/map-features/__tests__/reisebeginn-sucht-neu.test.js` (der echte `change`-Zuhörer).
**Abnahme:** Yrramis → Greifenfurt zu Fuß ohne Reisebeginn → „Bitte den Reisebeginn prüfen"; dann
3. Firun setzen → die Route wird neu gesucht und trägt den Sperrhinweis aus §12.
