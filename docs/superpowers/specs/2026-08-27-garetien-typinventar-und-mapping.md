# Garetien-Import: das vollständige Typinventar und die Mappingtabelle

**Stand:** 2026-08-27 · **Auftraggeber:** Owner (*„insgesamt wär mal eine vollständige
mappingtabelle sinnvoll"* · *„interessant vor dem import wäre zu sehen, welche
objekt-kategorien garetien hat, die wir gebrauchen könnten"*)

**Gemessen**, nicht geschätzt: alle 18 Exportseiten am 27.08.2026 abgerufen und mit dem
Hausparser (`avesmapsGaretienParseZeile`) gezählt. **8348 Zeilen, 64 Typen** — deckungsgleich
mit der Messung vom 26.08.2026 im Architekturentwurf.

> ⚠️ Die Rohseiten liegen **nicht** im Repo (`docs/repository-data-policy.md`). Wer die Zahlen
> nachrechnen will, ruft die 18 Seiten aus `AVESMAPS_GARETIEN_EBENEN` erneut ab — der Abruf ist
> ein einfacher GET ohne Login.

---

## 1. 🔴 Die Befunde, die das Mapping ändern

### 1.1 💣 `Berg` ist bei ihnen eine FLÄCHE, kein Gipfel — 78 von 79

Der Architekturentwurf (§3.4) bildet `Berg` auf `map_features.label` mit
`feature_subtype='berggipfel'` ab, also auf einen **Punkt**. Gemessen:

| | |
|---:|---|
| **79** | `Berg`-Objekte insgesamt |
| **1** | trägt einen einzigen Stützpunkt („Schroffenstein") |
| **78** | tragen 3 bis **211** Stützpunkte, Median **23** |

Beispiele: „Retokuppe" 11 · „Torbelstein" 12 · „Grüne Zwillinge O" 8 · „Wasserburger
Vorgebirge" 88 · „Schlunder Vorgebirge" 127.

✅ **ENTSCHIEDEN 27.08.2026 vom Owner — es bleibt beim `berggipfel`-Label.** Wörtlich: *„Berg
soll Berggipfel werden (das label mit dem dreieck). unsere kategorie ‚gebirge' erkennt dann
automatisch berggipfel und rechnet die ins gebirge ein. ohne gebirge sind berggipfel nur labels
mit position (die kategorie existiert schon)."*

⭐ Damit ist die Messung **kein Widerspruch mehr, sondern eine Umsetzungsanweisung**: die Fläche
wird auf ihren Mittelpunkt reduziert und als Gipfelmarke gesetzt. Was ein Gipfel *bedeutet*,
entsteht bei uns aus der Nachbarschaft — liegt er in einem `gebirge`, zählt er dazu; liegt er
allein, ist er eine Marke mit Position. Eine eigene Fläche `topographie/berg` braucht es nicht,
und der Import verliert dabei nichts, was wir nutzen würden.

💣 **Was daran offen BLEIBT, und zwar für Stufe 3:** ein `berggipfel` ist bei uns zusätzlich ein
**Stützpunkt des Höhenfelds** (`terrain-store.php` liest `is_active = 1` + `height_schritt`).
**Volkers Daten tragen keine Höhe.** 79 Gipfel ohne Höhe verändern das Geländemodell nicht — aber
einer *mit falscher* Höhe schon, und wer sie später von Hand füllt, muss wissen, dass er damit
das Relief verstellt. Der Architekturentwurf §3.4 nennt das bereits; hier steht die Zahl dazu.

⚠️ **Und die Reduktion ist eine Entscheidung, keine Rechnung:** aus 211 Stützpunkten wird ein
Punkt. Der Flächenschwerpunkt ist nicht der Gipfel — bei einem hufeisenförmigen Bergzug liegt er
im Tal. Für 78 kleine Flächen (Median 23 Punkte) ist das vertretbar; wer es genauer will, setzt
den Punkt im Editor um. Das gehört in den Bauplan von Stufe 3, nicht in diese Tabelle.

### 1.2 „Vorgebirge" ist kein Typ — es sind vier Objekte mit dem Wort im Namen

Der Owner hatte es gesehen. Gemessen: **kein** Typ `Vorgebirge`. Vier Objekte tragen das Wort:

| Typ | Name | Stützpunkte |
|---|---|---:|
| `Gebirge` | Raschtulswall, Vorgebirge südlich von Weißbarûn | 16 |
| `Gebirge` | Raschtulswall, Vorgebirge in Aranien | 23 |
| `Berg` | Schlunder Vorgebirge | 127 |
| `Berg` | Wasserburger Vorgebirge | 88 |

⭐ Die Beobachtung war trotzdem richtig und hat auf §1.1 gezeigt: die zwei `Berg`-Vorgebirge
sind mit 88 und 127 Stützpunkten die deutlichsten Belege, dass `Berg` keine Gipfelmarke ist.
Ein eigener Typ wäre eine **fünfte** Art neben gebirge/huegelland/berg und ist nicht nötig —
„Vorgebirge" ist ein Name, keine Form.

### 1.3 Zwei Typen sind in sich uneinheitlich

- **`JunkertumsflaecheD`** (116) ist der einzige Flächentyp, der **beides** trägt: meist
  Verweise auf Grenzzüge, aber einzelne Zeilen mit eigenen Koordinaten (29 Punkte). Der
  Flächenauflöser aus Entwurf §4 muss beide Formen aushalten.
- **`Strasse`** (87) ist zu 86 Koordinaten und **einmal** ein Verweis.

⚠️ Beides ist kein Fehler, sondern Volkers Freiheit in der Vorlage — aber ein Importer, der
je Typ genau eine Geometrieform annimmt, fällt darüber.

### 1.4 🔴 NEU: der Wege-Subtyp `Bach` — 143 Objekte, und er ändert Stufe 1

**Owner 27.08.2026:** *„führe die neue kategorie ‚Bach' ein — das sind wie flusswege, die aber
nicht befahren werden können."* Und zur Herkunft: *„bach gibts auch als kategorie im wiki
(`Kategorie:Bach`), die werden wir nachziehen sobald der neue dump da ist."*

⭐ **Das war vorbereitet.** AGENTS.md §11 hält seit dem 15.08.2026 fest: *„🔧 Bäche kommen (Owner:
‚wir werden bald flüsse bauen die überquert werden können') — die Entscheidung ‚Wand oder nicht'
steht an **genau einer** Stelle, `avesmapsCollectRouteRiverBarrierLines`; dort fällt der Bach
durch eine zusätzliche Bedingung heraus und nirgends sonst."* Die schwierigste Frage ist damit
schon beantwortet, bevor sie gestellt wurde.

💣 **Es ist trotzdem kein Eintrag in einer Tabelle, sondern ein eigenes Stück Arbeit.** Ein neuer
Wege-Subtyp berührt mindestens:

| Stelle | Was |
|---|---|
| `PATH_SUBTYPE_KEYS` (`js/config.js:92`) | der Schlüssel selbst |
| **`SPEED_TABLE`** | 💣 **dreifach gespiegelt** — `js/config.js`, `AVESMAPS_ROUTE_CLIENT_SPEED_TABLE` (`client-graph.php`), `WP_SPEEDS` (`wege-editor-model.js`). Der Kommentar dort sagt: eine ohne die anderen zu ändern macht `wege-editor-model.test.js` rot — „that is its job" |
| `avesmapsDefaultTransportDomainForPathSubtype` | welche Verkehrsmittel gelten? „nicht befahrbar" ist **keine** der drei heutigen Domänen (`land`/`river`/`sea`) |
| `avesmapsCollectRouteRiverBarrierLines` | die EINE Stelle „Wand oder nicht" — ein Bach ist überquerbar, fällt also heraus |
| `--color-path-*` + Wege-Editor | Farbe und Listendarstellung |

🔧 **Die eine echte Entwurfsfrage:** ein Bach ist weder befahrbar noch begehbar — er ist gar kein
Reiseweg. Wird er (a) eine vierte Transport-Domäne ohne Verkehrsmittel, oder (b) gar keine
Graph-Kante, sondern nur eine gezeichnete Linie? ⚠️ (b) ist sauberer für das Routing, ändert aber
die Annahme „jeder `path` ist eine Kante", auf der der Graphbau steht.

⚠️ **Folge für Stufe 1: 143 der 289 Objekte wandern.** Die Zuordnung `'Bach' => Flussweg` steht
heute in `AVESMAPS_GARETIEN_TYP_MAP` und ist **gebaut**. Sie zu ändern ist eine Zeile — aber erst,
wenn der Subtyp existiert. **Bis dahin darf Stufe 1 nicht übernommen werden**, sonst liegen 143
Bäche als befahrbare Flusswege in der Karte und müssen einzeln umgetragen werden.

### 1.5 🔴 NEU: `Stadtviertel` — 22 Objekte, doch nicht „kein Gegenstück"

**Owner 27.08.2026:** *„Stadtviertel: führe sie als kategorie ein und übernimm deren — aber sie
sind wie gebäude innerorts."*

Die frühere Einordnung („kein Gegenstück, nicht importieren") ist damit überholt. 22 Objekte,
alle Punkte, alle in `ggp/Ortschaften_*`.

⚠️ **„wie Gebäude, aber innerorts" ist genau die Unterscheidung, die unsere Ortsklassen heute
nicht führen** — `gebaeude` sagt nichts darüber, ob etwas in einer Stadt liegt. Ob daraus eine
eigene `settlement_class` wird oder ein Merker am `gebaeude`, gehört in den Bauplan von Stufe 4.
⭐ Es hängt an derselben Frage wie die acht Bauwerksarten in §3.3: bekommen unsere Ortsklassen
eine Unterteilung, oder nicht?

---

## 2. Die vollständige Tabelle — alle 64 Typen

**Form** ist gemessen am Median der Stützpunkte; **Spanne** ist `min-median-max`.
🔴 = Owner-Entscheid offen · ✅ = gebaut · ⚪ = kommt in seiner Stufe · ⛔ = kommt nie.

### Stufe 1 — Gewässer (289) ✅ gebaut

| Ihr Typ | Anzahl | Form | Spanne | → bei uns |
|---|---:|---|---|---|
| `Bach` | 143 | Linie | 4-27-327 | 🔴 **NEUER Subtyp `Bach`** — Owner 27.08., siehe §1.4 |
| `See` | 96 | Fläche | 6-13-61 | `topographie/see` + Label ✅ |
| `Fluss` | 30 | Linie | 10-39-141 | `path` / `Flussweg` ✅ |
| `Sumpf` | 15 | Fläche | 15-36-93 | `vegetation/suempfe_moore` + Label ✅ |
| `Meer` | 2 | Fläche | 69-69-125 | `topographie/meer` + Label ✅ |
| `Strom` | 2 | Linie | 119-119-294 | `path` / `Flussweg` ✅ |

### Stufe 2 — Wege (731) ⚪

| Ihr Typ | Anzahl | Form | Spanne | → bei uns |
|---|---:|---|---|---|
| `Pfad` | 411 | Linie | 2-12-111 | `path` / `Pfad` |
| `Weg` | 226 | Linie | 2-13-74 | `path` / `Weg` |
| `Strasse` | 87 | Linie | 2-17-134 | `path` / `Strasse` ⚠️ 1× Verweis (§1.3) |
| `Reichsstrasse` | 7 | Linie | 37-146-280 | `path` / `Reichsstrasse` |

### Stufe 3 — Gelände (764) ⚪

| Ihr Typ | Anzahl | Form | Spanne | → bei uns |
|---|---:|---|---|---|
| `Wald` | 442 | Fläche | 6-25-463 | `vegetation/wald` + Label |
| `Gebirge` | 99 | Fläche | 7-25-97 | `topographie/gebirge` + Label |
| `Huegel` | 84 | Fläche | 10-56-148 | `topographie/huegelland` + Label |
| **`Berg`** | **79** | **Fläche** | **1-23-211** | ✅ `map_features.label` / `berggipfel` (Punkt) — Owner 27.08. |
| `Kueste` | 20 | Linie | 9-93-985 | `topographie/kueste` + Label |
| `Insel` | 16 | Fläche | 9-32-432 | `topographie/insel` + Label |
| `Forst` | 8 | Fläche | 1-12-35 | `vegetation/wald` + Label |
| `Urwald` | 8 | Fläche | 7-32-134 | `vegetation/urwald` — **neue Art**, Owner 26.08. |

### Stufe 4 — Ortschaften und Bauwerke (2519) ⚪

🔴 **„Ortschaften" ist der Name der SEITE, nicht ihr Inhalt.** Rund **1127** echte Ortschaften
und rund **1356** einzelne Bauwerke. **Alle sind Punkte** (durchgehend 1 Stützpunkt) — für
Stufe 4 gilt deshalb der Owner-Entscheid vom 27.08.2026: *„ausnahme sind natürlich orte, hier
wollen wir nur die position behalten oder ersetzen."*

| Ihr Typ | Anzahl | → bei uns |
|---|---:|---|
| `Dorf` | 868 | `dorf` |
| `Burg` | 471 | `gebaeude` |
| `Gutshof` | 365 | `gebaeude` |
| `Tempel` | 212 | `gebaeude` |
| `Markt` | 143 | `kleinstadt` |
| `Gebaeude` | 137 | `gebaeude` |
| `Stadt` | 94 | `stadt` |
| `Kloster` | 76 | `gebaeude` |
| `Gasthaus` | 75 | `gebaeude` — ⚠️ nur `kosch/Ortschaften_1` |
| `Reichsstadt` | 18 | `grossstadt` |
| `Pfalz` | 14 | `gebaeude` |
| `Binge` | 13 | `dorf` — Owner 26.08. |
| `Akademie` | 4 | `gebaeude` |
| `Koenigsstadt` | 4 | `grossstadt` |
| `Magierturm` | 2 | `gebaeude` — ⚠️ nur `kosch/Ortschaften_1` |
| `Stadtviertel` | 22 | 🔴 **NEUE Kategorie `stadtviertel`** — wie `gebaeude`, aber innerorts. Owner 27.08. |
| `Unbekannte Art` | 1 | ⚠️ „Brakenmoor" — laut Artikelname ein Dorf |
| `Hasengrube!Hasengrube` | 1 | ⚠️ Zeile **ohne Typ**, der Parser liest den Namen als Typ |

### Stufe 5 — Territorien: Flächen (759) ⚪

💣 **Die Suffixe A–E sind Farbvarianten, keine Ränge.** Wer sie als fünf Typen liest, legt fünf
Hierarchiestufen an, die es nicht gibt.

| Ihr Typ | Anzahl | Form | → bei uns |
|---|---:|---|---|
| `JunkertumsflaecheA` | 162 | Verweise | `political_territory`, Rang Junkertum |
| `JunkertumsflaecheB` | 140 | Verweise | dito |
| `JunkertumsflaecheC` | 120 | Verweise | dito |
| `JunkertumsflaecheD` | 116 | **gemischt** | dito ⚠️ §1.3 |
| `JunkertumsflaecheE` | 47 | Verweise | dito |
| `BaronieflaecheB` | 37 | Verweise | Rang Baronie |
| `BaronieflaecheC` | 37 | Verweise | dito |
| `BaronieflaecheA` | 35 | Verweise | dito |
| `BaronieflaecheD` | 32 | Verweise | dito |
| `BaronieflaecheE` | 2 | Verweise | dito |
| `GrafschaftsflaecheA` | 8 | Verweise | Rang Grafschaft |
| `GrafschaftsflaecheB` | 8 | Verweise | dito |
| `GrafschaftsflaecheC` | 8 | Verweise | dito |
| `GrafschaftsflaecheD` | 7 | Verweise | dito |

### Stufe 5 — Territorien: Grenzbausteine (2293) ⚪

Keine eigenen Objekte bei uns — sie sind das **Material**, aus dem die Flächen oben entstehen
(Entwurf §4: Fläche → Grenzzug → Fragment).

| Ihr Typ | Anzahl | Form | Spanne |
|---|---:|---|---|
| `Junkertumsgrenze` | 970 | Linie | 2-9-90 |
| `Baroniegrenze` | 583 | Linie | 2-7-37 |
| `Grenzzug` | 317 | Verweise | — |
| `Provinzgrenze` | 167 | Linie | 2-8-117 |
| `Grafschaftsgrenze` | 137 | Linie | 2-6-21 |
| `Reichsgrenze` | 119 | Linie | 2-10-432 |

### ⛔ Wird nie importiert (1001)

💣 **NACHGEMESSEN 27.08.2026: die `*Klein`-Typen sind KEINE Stadtkarten — es sind DUBLETTEN.**
Der Architekturentwurf vermutete „Innenansichten von Städten" (§3.6). Gemessen ist etwas anderes:
**alle 982** `*Klein`-Objekte tragen einen gleichnamigen Zwilling ohne `Klein` — mit **identischen
Koordinaten** und **identischer LOD-Spanne**.

| | Klein | Zwilling |
|---|---|---|
| „Finster" | `BurgKlein` · LOD 7!14 · `-100573 -269317` | `Burg` · LOD 7!14 · `-100573 -269317` |
| „Dohlentrutz" | `GebaeudeKlein` · LOD 7!14 · `-98426 -259424` | `Gebaeude` · LOD 7!14 · `-98426 -259424` |
| „Schwertsleyda" | `GutshofKlein` · LOD 7!14 · `-116693 -257148` | `Gutshof` · LOD 7!14 · `-116693 -257148` |

⭐ Es sind vermutlich zwei Zeichenebenen derselben Objekte in Volkers SVG (ein kleineres Symbol).
Für uns heisst das: **nicht importieren bleibt richtig — aber aus einem anderen Grund als
gedacht.** Sie sind keine zusätzliche Information, sondern dieselbe zweimal.

🔴 **Und die Antwort auf „können wir die als Stadtkarten importieren/verlinken": nein.** Eine
Stadtkarte ist bei uns ein Bild mit eigener Seite (`citymap`, aus Wiki Aventurica). Volkers Daten
enthalten **kein einziges Bild und keine Kartenseite** — nur denselben Punkt ein zweites Mal.
⚠️ Die Ortschaften selbst können sehr wohl Stadtkarten haben; die kommen aber aus dem
WikiSync-Kartenkatalog, nicht aus diesem Import.

| Ihr Typ | Anzahl | Warum |
|---|---:|---|
| `BurgKlein` | 385 | Dublette von `Burg`, identische Position |
| `GutshofKlein` | 314 | Dublette von `Gutshof` |
| `TempelKlein` | 120 | Dublette von `Tempel` |
| `GebaeudeKlein` | 99 | Dublette von `Gebaeude` |
| `KlosterKlein` | 67 | Dublette von `Kloster` |
| `PfalzKlein` | 12 | Dublette von `Pfalz` |
| `AkademieKlein` | 3 | Dublette von `Akademie` |
| `Kontinent` | 1 | kein Gegenstück |

---

## 3. Welche Kategorien könnten wir gebrauchen?

Die Frage des Owners, beantwortet in beide Richtungen.

### 3.1 Die neuen Kategorien — alle vier entschieden

| Kategorie | Anzahl | Entscheid |
|---|---:|---|
| `vegetation/urwald` | 8 | Owner 26.08. — ein Urwald ist nicht dasselbe wie ein Dschungel (Zustand gegen Klima) |
| `topographie/insel` | 16 | Owner 26.08. — gab es bereits, keine neue Art nötig |
| **Wege-Subtyp `Bach`** | **143** | Owner 27.08. — wie ein Flussweg, aber nicht befahrbar. §1.4 · 💣 eigenes Stück Arbeit, und Stufe 1 wartet darauf |
| **`stadtviertel`** | **22** | Owner 27.08. — wie `gebaeude`, aber innerorts. §1.5 |

⭐ `Berg` brauchte **keine** neue Fläche: er wird eine Gipfelmarke, und was er bedeutet, ergibt
sich aus der Nachbarschaft (§1.1). Damit hat **jeder** der 64 Typen ein Ziel — zugeordnet,
Material oder bewusst ausgeschlossen.

### 3.2 Was wir haben und ihre Daten NIE füllen

Der Import lässt **fünfzehn** unserer Arten unberührt — nützlich zu wissen, damit niemand nach
dem Import erwartet, die Landschaftsebene sei vollständig:

- **Topographie:** `wadi` · `schlucht` · `hochebene` · `tiefebene` · `tal` · `flussdelta`
- **Vegetation:** `steppe` · `tundra` · `auenlandschaft` · `wueste` · `graslandschaft` ·
  `flussland_flusstal` · `dschungel` · `wuestenoase` · `kulturlandschaft`
- **Derographisch:** `inselgruppe` · `kontinent` · `sonstiges`

⚠️ Das ist erwartbar: Volkers Gebiet ist Garetien, Greifenfurt, Perricum und der Kosch — dort
gibt es keine Wüstenoase und keinen Dschungel.

### 3.3 Was sie feiner führen als wir

🔴 **KORRIGIERT 27.08.2026 — hier stand, die acht Bauwerksarten gingen verloren. Das war
falsch.** Der Owner: *„warum? wir haben doch unterkategorien bei ‚Besondere Gebäude/Stätten'."*
Er hat recht: `settlement_class = 'gebaeude'` ist nur die **Grösse**; die **Art** trägt
`building_type` (`AVESMAPS_WIKI_SETTLEMENT_LEGACY_BUILDING_TYPES`, `place-kinds.php`) — **108
Ortsarten**, aus den Wiki-Kategorien abgeleitet („Kategoriename == building_type"). Es geht nichts
verloren, **solange der Importer `building_type` mitfüllt**.

Gemessen, welche der acht es schon gibt:

| Ihr Typ | Anzahl | Unsere Ortsart |
|---|---:|---|
| `Tempel` | 212 | ✅ `Tempel` |
| `Kloster` | 76 | ✅ `Kloster` |
| `Gutshof` | 365 | ✅ `Gutshof` |
| `Akademie` | 4 | ✅ `Akademie` |
| `Binge` | 13 | ✅ `Binge` (zusätzlich zu `settlement_class = dorf`) |
| **`Burg`** | **471** | 🔴 **fehlt.** `Festung`, `Schloss`, `Ruine` gibt es — eine Burg ist keins davon |
| **`Gasthaus`** | **75** | 🔴 **fehlt.** Nächstes wäre `Karawanserei`, und das ist etwas anderes |
| `Pfalz` | 14 | ⚠️ nur `Kaiserpfalz` — eine nicht-kaiserliche Pfalz hat keine Art |
| `Magierturm` | 2 | ⚠️ `Turm` und `Magierakademie` gibt es; `Magierturm` ist beides nicht |
| `Stadtviertel` | 22 | 🔴 **fehlt** (Owner 27.08.: neue Kategorie, §1.5) |

🔧 **Damit ist die Frage klein und konkret:** drei bis fünf Ortsarten anhängen (`Burg`,
`Gasthaus`, `Stadtviertel`, evtl. `Pfalz`, `Magierturm`) — statt einer Grundsatzfrage über
Ortsklassen. ⚠️ Neue Arten kommen **ans ENDE** der Liste: die ersten 24 Einträge sind
byte-genau festgenagelt (`avesmapsPlaceKindLegacyPrefix`), weil der Erste, der einen Titel
beansprucht, gewinnt — ein neuer Eintrag weiter vorn würde Artikel umklassifizieren, die der
Dump heute schon einordnet.

| Ihre Unterscheidung | Bei uns | Verlust |
|---|---|---|
| `Markt` | `kleinstadt` | Markt ist bei uns keine eigene Klasse |
| `Forst` | `wald` | ein Forst ist ein bewirtschafteter Wald |
| `Binge` | `dorf` | Owner-Entscheid 26.08., Präzedenz: 2 von 13 führen wir schon so |

🔧 **Das ist die zweite Frage, die vor Stufe 4 zu klären wäre:** ob die acht Bauwerksarten
wirklich alle `gebaeude` werden sollen, oder ob unsere Ortsklassen eine Unterteilung
bekommen. 1356 Objekte sind zu viele, um es beiläufig zu entscheiden — und ein späteres
Auseinandersortieren wäre Handarbeit an jedem einzelnen.

---

## 4. Wie das gemessen wurde

18 GETs mit `curl` gegen die Adressen aus `AVESMAPS_GARETIEN_EBENEN`, dann durch
`avesmapsGaretienSeitentext` + `avesmapsGaretienParseZeile` — **derselbe Parser, den der
Import benutzt**, kein zweiter Zählweg. Kontrollsumme: 8348 Zeilen über 64 Typen, identisch
zur unabhängigen Messung vom 26.08.2026.

⚠️ Alle Seiten antworteten mit HTTP 200; `ggp/Gewaesser` lieferte 158539 Bytes — dieselbe Zahl,
die der Owner am 27.08. auf der STRATO-Servershell gemessen hat. Der Abruf ist von aussen wie
von innen erreichbar.
