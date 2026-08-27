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

## 1. 🔴 Die drei Befunde, die das Mapping ändern

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

🔴 **Das Mapping des Entwurfs ist damit für 78 von 79 Objekten falsch.** Ein Gipfel ist bei uns
zusätzlich ein **Stützpunkt des Höhenfelds** (`terrain-store.php` liest `is_active = 1` +
`height_schritt`) — 78 Flächen als Gipfel einzutragen wäre nicht nur eine falsche Form, es
verzerrte das Geländemodell.

⭐ **Und hier ist die Lücke, nach der der Owner gefragt hat:** wir führen `topographie/gebirge`
(ein Gebirge**zug**) und `topographie/huegelland` (eine Hügel**landschaft**), aber **keine Art
für einen einzelnen Berg als Fläche**. Das ist die einzige echte Kategorie-Lücke im ganzen
Bestand.

🔧 **Owner-Entscheid nötig:** neue Art `topographie/berg` anlegen (wie `vegetation/urwald` am
26.08.), oder die 79 auf `gebirge` legen und die Unterscheidung aufgeben?

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

---

## 2. Die vollständige Tabelle — alle 64 Typen

**Form** ist gemessen am Median der Stützpunkte; **Spanne** ist `min-median-max`.
🔴 = Owner-Entscheid offen · ✅ = gebaut · ⚪ = kommt in seiner Stufe · ⛔ = kommt nie.

### Stufe 1 — Gewässer (289) ✅ gebaut

| Ihr Typ | Anzahl | Form | Spanne | → bei uns |
|---|---:|---|---|---|
| `Bach` | 143 | Linie | 4-27-327 | `path` / `Flussweg` ✅ |
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
| **`Berg`** | **79** | **Fläche** | **1-23-211** | 🔴 **offen — siehe §1.1** |
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
| `Stadtviertel` | 22 | ⛔ kein Gegenstück |
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

### ⛔ Wird nie importiert (1023)

| Ihr Typ | Anzahl | Warum |
|---|---:|---|
| `BurgKlein` | 385 | Innenansicht einer Stadt — dafür haben wir Stadtkarten |
| `GutshofKlein` | 314 | dito |
| `TempelKlein` | 120 | dito |
| `GebaeudeKlein` | 99 | dito |
| `KlosterKlein` | 67 | dito |
| `PfalzKlein` | 12 | dito |
| `AkademieKlein` | 3 | dito |
| `Stadtviertel` | 22 | kein Gegenstück |
| `Kontinent` | 1 | kein Gegenstück |

---

## 3. Welche Kategorien könnten wir gebrauchen?

Die Frage des Owners, beantwortet in beide Richtungen.

### 3.1 Was ihnen fehlt und uns fehlt — die eine echte Lücke

**`Berg` als Fläche (79 Objekte).** Wir führen `topographie/gebirge` und
`topographie/huegelland`; ein einzelner Berg als Fläche hat bei uns keine Art. 🔧 Entscheid
offen (§1.1). Es ist der **einzige** Typ im ganzen Bestand ohne Gegenstück auf unserer Seite —
alle übrigen 63 sind entweder zugeordnet, Material oder bewusst ausgeschlossen.

`Urwald` war die zweite und ist am 26.08. bereits entschieden.

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

| Ihre Unterscheidung | Bei uns | Verlust |
|---|---|---|
| `Burg` · `Pfalz` · `Tempel` · `Kloster` · `Gutshof` · `Gasthaus` · `Akademie` · `Magierturm` | alles `gebaeude` | **8 Arten → 1.** 1356 Bauwerke verlieren ihre Art |
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
