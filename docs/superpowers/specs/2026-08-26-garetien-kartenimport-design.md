# Entwurf: Kartendaten aus Garetien/Greifenfurt/Perricum und Kosch übernehmen

**Stand:** 2026-08-26 · **Quelle:** Volker Strunk (VolkoV), garetien.de + koschwiki.de
**Freigabe:** Björn Berghausen (Freundeskreis des phantastischen Briefspiels e.V.) am
2026-08-12, „grundsätzlich verwendbar zu gleichen Bedingungen, nichtkommerziell bei
Namensnennung"; Urheber der Karte ist Volker Strunk, der die Exportseiten selbst angelegt hat.

> 🔴 **Dieser Entwurf legt die ARCHITEKTUR für alle Objektarten fest, beschreibt aber nur
> Stufe 1 (Gewässer) als zu bauen.** Wege, Wälder, Berge, Ortschaften und Territorien
> erben denselben Weg und bekommen je einen eigenen Bauplan. Wer Stufe 1 baut, baut das
> Fundament für alle — deshalb steht das Mapping hier vollständig, obwohl es nur teilweise
> umgesetzt wird.

---

## 1. Was wir bekommen — gemessen, nicht geschätzt

Volker hat am 2026-08-26 **18 Exportseiten** angelegt, je eine Ebene, in zwei Wikis:

| Wiki | Seiten | Adresse |
|---|---|---|
| Garetien/Greifenfurt/Perricum (GGP) | 12 | `https://www.garetien.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_<Ebene>` |
| Kosch | 6 | `https://www.koschwiki.de/index.php?title=Benutzer:VolkoV/MapSVG/Avesmaps_<Ebene>` |

Ebenen GGP: `Gewaesser Berge Grenzen Sonstiges Waelder Wege Ortschaften_1..4 Detail_1 Detail_2`
Ebenen Kosch: `Gewaesser Berge Grenzen Waelder Wege Ortschaften_1`

**8348 Objekte in 64 Typen, keine einzige defekte Zeile.** Gemessen am 2026-08-26:

| Ebene | GGP | Kosch | Inhalt |
|---|---:|---:|---|
| Grenzen | 2860 | 192 | Fragmente + Grenzzüge + Flächen (siehe §4) |
| Ortschaften 1–4 | 2019 | 500 | Dorf 868, Burg 471, Gutshof 365, Tempel 212, Markt 143, Stadt 94, … |
| Detail 1–2 | 1000 | — | `…Klein`-Varianten innerorts (BurgKlein 385, GutshofKlein 314, …) |
| Wege | 685 | 47 | Pfad 411, Weg 226, Strasse 87, Reichsstrasse 7 |
| Wälder | 345 | 113 | Wald 442, Urwald 8, Forst 8 |
| Gewässer | 246 | 43 | Bach 143, See 96, Fluss 30, Sumpf 15, Strom 2, Meer 2 |
| Berge | 250 | 12 | Gebirge 99, Hügel 84, Berg 79 |
| Sonstiges | 36 | — | Insel 16, Küste 20, Kontinent 1 |

### 1.1 Das Zeilenformat

```
Typ:[Namensraum:]Artikelname!Anzeigename;lodmin!lodmax;extra;Geometrie
```

```
Sumpf:Garetien:Blutmoor!Blutmoor;5!14;;-81541 -34910, -82345 -34947, …
BaronieflaecheE:Garetien:Baronie Retogau!Baronie Retogau;6!10;pop=16000!level=Baron;Raulsmark-Retogau, Feidewald-Retogau, …
```

- **Geometrie** ist entweder eine Koordinatenliste **oder** eine Liste von Verweisen (§4).
- **`extra`** trägt nur bei politischen Flächen etwas: `pop=<Einwohner>!level=<Adelsrang>`.
- **Steuerzeilen** beginnen mit `K:` und sind Kommentare der Vorlage — überspringen.
- **Trennzeichen in Verweislisten ist `,` ODER ` / `.** 💣 Beides muss der Parser kennen;
  mit nur `,` blieben 8 Flächen unauflösbar (gemessen).

**Abrufweg:** HTML holen, `div.mw-parser-output` ausschneiden, `<p>`/`<br>` in Zeilenumbrüche
wandeln, restliche Tags strippen, HTML-Entities auflösen. Kein Login, kein Token; die
MediaWiki-API und `action=raw` sind für Anonyme gesperrt, die gerenderte Seite nicht.

### 1.2 Kopfvarianten (Volker, 2026-08-26)

209 von 246 Zeilen folgen dem vollen Schema. Die übrigen sind **kein Fehler**:

- **Kein Artikel vorhanden** → die Zeile wurde von Hand in die Vorlage geschrieben statt per
  Abfrage erzeugt. Erkennbar am fehlenden Anzeigenamen: `Bach:Nebenfluss der Natter`.
- **Hauptnamensraum** → kein `XXX:`-Präfix, weil das Objekt durch mehrere Provinzen läuft
  (`Strom:Darpat!Darpat`).
- **Sammelartikel** → `Fluss:Nachbarprovinzen!Llavari` verweist auf einen Sammelartikel für
  alles außerhalb von GGP. 🔴 **Diese Zeilen werden übersprungen** — sie liegen außerhalb des
  gepflegten Gebiets und wir haben dort eigene Daten.
- Eine Zeile hat **gar keinen Namen** (`See:` mit Koordinaten). Wird übersprungen und gemeldet.

---

## 2. Die Koordinatentransformation — gelöst und belegt

Volkers System sind **„Wagenhalt-Koordinaten"**: positives X = Meilen östlich, positives Y =
Meilen **südlich** von Wagenhalt, Einheit 1/1000 Meile.

### 2.1 Die Matrix

Aus **219 namensgleichen Orten**, davon **148 nach robustem Ausreißerfilter**:

```
x_avesmaps =  3.366672e-4·gx + 6.576893e-7·gy + 547.3559
y_avesmaps =  2.419169e-6·gx − 3.311091e-4·gy + 541.8122
```

**Median 1,24 Meilen, p90 3,5 Meilen** — out-of-sample in 5-facher Kreuzvalidierung, also auf
Punkten, die nicht mitgefittet wurden. Bei 3072 Meilen Kartenbreite sind das 0,04 %.

Zwei unabhängige Belege, dass hier nichts hingebogen ist:

1. Der Fit findet den Nullpunkt bei (547,36 / 541,81); unser echtes **Wagenhalt** liegt bei
   (547,54 / 541,91) — **eine halbe Meile Abweichung**, aus 148 Punkten wiedergefunden.
2. Die reine Definitionsformel (Wagenhalt + `/3000`, weil 1 Karteneinheit = 3 Meilen =
   `AVESMAPS_TERRAIN_MEILEN_PER_MAPUNIT`) trifft ohne jede Anpassung auf 3 Meilen Median.

Die X- und Y-Skalen unterscheiden sich um 1,7 %, deshalb **affin (6 Parameter)** und nicht
nur Verschieben-und-Skalieren.

### 2.2 💣 Nicht warpen

Thin-Plate-Spline wurde gemessen und ist **schlechter**: 2,30 Meilen Median gegen 1,24 bei
affin, gleiche Kreuzvalidierung. Der Grund steht in den Residuen — sie korrelieren **null**
mit der Position (0,014 / 0,003 / −0,003 / −0,001). Es gibt keine systematische Verzerrung,
die man geradebiegen könnte; der Rest ist echte Zeichendifferenz zwischen zwei von Hand
gemalten Fankarten. Warping zieht die Geometrie dann an Rauschen. **Wer später doch warpt,
muss diese Messung zuerst widerlegen.**

### 2.3 💣 Y wird gespiegelt

Bei ihnen wächst y nach **Süden**, bei uns nach **Norden** (Riva y=790, Al'Anfa y=152). Das
Vorzeichen steckt in der Matrix (`−3.311091e-4`), aber wer sie neu berechnet, muss es
bewusst setzen. Es ist dieselbe Falle wie GeoJSON `[x,y]` gegen Leaflet `[lat,lng]`.

### 2.4 💣 Die Passpunkte enthalten Falschpaare

**70 von 219 namensgleichen Orten waren verschiedene Orte** — es gibt zwei „Hüterkloster",
zwei „Dreiwegen", zwei „Waldheim"; sie lagen bis zu 3000 Meilen auseinander. Ohne robusten
Filter zieht das den Fit kaputt: über alle 219 gerechnet steigt der Median von 1,1 auf
94 Meilen. Der Filter ist **tragend**, nicht Kosmetik. Verfahren: fitten, Residuen messen,
alles über `max(3·Median, 5 Meilen)` verwerfen, wiederholen (4 Runden reichen).

---

## 3. Das Mapping auf unser System

🔴 **Die Zuordnung ist Daten, kein Code** — eine Tabelle, die ein Editor lesen und ändern
kann, kein `if`-Baum. Sie steht in **einer** Datei und wird von Staging und Übernahme
gemeinsam gelesen.

### 3.1 Ortschaften → `map_features.location`

| Ihr Typ | Unser `settlement_class` | Bemerkung |
|---|---|---|
| `Kaiserstadt` | `metropole` | |
| `Koenigsstadt`, `Reichsstadt` | `grossstadt` | |
| `Stadt` | `stadt` | |
| `Markt` | `kleinstadt` | Markt ist bei uns keine eigene Klasse |
| `Dorf` | `dorf` | |
| `Binge` | `dorf` | Zwergenstadt; ⚠️ Owner-Entscheid nötig |
| `Burg`, `Pfalz`, `Tempel`, `Kloster`, `Gutshof`, `Gebaeude`, `Akademie`, `Gasthaus`, `Magierturm` | `gebaeude` | |
| `Stadtviertel` | — | 🔴 **nicht importieren**, wir haben kein Gegenstück |
| `*Klein` (Detail 1–2) | — | 🔴 **nicht importieren** (siehe §3.6) |

### 3.2 Wege → `map_features.path`

| Ihr Typ | Unser `PATH_SUBTYPE_KEYS` |
|---|---|
| `Reichsstrasse` | `Reichsstrasse` |
| `Strasse` | `Strasse` |
| `Weg` | `Weg` |
| `Pfad` | `Pfad` |
| `Platz` | — nicht importieren |

⚠️ Ihre Wege kennen **keinen** Gebirgspass, Wüstenpfad, Fluss- oder Seeweg. Umgekehrt
liegen ihre Flüsse in der Gewässer-Ebene, unsere in der Wege-Ebene (§3.3).

### 3.3 Gewässer → zwei verschiedene Ziele

💣 **Das ist die wichtigste Erkenntnis des Mappings: ihre Gewässer sind alle Polygone bzw.
Linienzüge in einer Ebene, unsere liegen in zwei getrennten Systemen.**

| Ihr Typ | Unser Ziel | Geometrie |
|---|---|---|
| `Strom`, `Fluss`, `Bach` | `map_features.path` mit `feature_subtype='Flussweg'` | LineString |
| `See`, `Meer` | `ecosystem_region` (`topographie`/`see` bzw. `meer`) **+** `map_features.label` | Polygon + Punkt |
| `Sumpf` | `ecosystem_region` (`vegetation`/`suempfe_moore`) **+** `label` | Polygon + Punkt |

💣 **Ein Label ist bei uns ein PUNKT** (alle 971 gemessen), die Fläche liegt in
`ecosystem_region` und hängt über `label_public_id` am Label. Wer eine Seefläche importiert,
legt **zwei** Objekte an — und das Label ist das tragende: Nach der Kaskadenregel aus
AGENTS.md nimmt das Löschen des letzten Labels Region UND Flächen mit.

⚠️ **Ein Fluss wird bei uns befahren.** `Flussweg` ist eine Graph-Kante des Routings, kein
Dekor. Ein importierter Fluss ohne Anschluss ans Wegenetz ist eine Insel im Graphen. Für
Stufe 1 gilt deshalb: **Flüsse werden als `Flussweg` angelegt, aber die Routing-Anbindung
ist ausdrücklich NICHT Teil dieser Stufe** — sie wird gemessen und berichtet, nicht gebaut.

### 3.4 Wälder und Berge → `ecosystem_region` + `label`

| Ihr Typ | Unsere Art (`kind`/`type_key`) |
|---|---|
| `Wald`, `Forst` | `vegetation`/`wald` |
| `Urwald` | `vegetation`/`dschungel` ⚠️ Owner-Entscheid: oder eigener Wert |
| `Gebirge` | `topographie`/`gebirge` |
| `Huegel` | `topographie`/`huegelland` |
| `Berg` | `map_features.label` mit `feature_subtype='berggipfel'` (Punkt, keine Fläche) |
| `Insel` | `topographie`… ⚠️ bei uns `derographisch`/`inselgruppe` **oder** Label `insel` |
| `Kueste` | `topographie`/`kueste` |
| `Kontinent` | — nicht importieren |

💣 **`berggipfel` ist ein Stützpunkt des Höhenfelds** (`terrain-store.php` liest
`is_active=1` + `height_schritt`). Ein importierter Gipfel ohne Höhe verändert das
Geländemodell nicht, aber einer **mit** falscher Höhe schon. Stufe „Berge" muss das
gesondert behandeln; ihre Daten tragen keine Höhe.

### 3.5 Politische Flächen → `political_territory`

| Ihr Typ | Unser Rang |
|---|---|
| `Grafschaftsflaeche[A-E]` | Grafschaft |
| `Baronieflaeche[A-E]` | Baronie |
| `Junkertumsflaeche[A-E]` | Junkertum ⚠️ prüfen, ob wir diesen Rang führen |

💣 **Die Suffixe A–E sind Farbvarianten, keine Typen.** Sie sorgen dafür, dass benachbarte
Flächen unterschiedlich eingefärbt werden. Wer sie als fünf Ränge liest, legt fünf
Hierarchiestufen an, die es nicht gibt.

Das `extra`-Feld liefert `pop=` (Einwohnerzahl) und `level=` (Adelsrang, z. B. `Baron`).

🔴 **Territorien sind NICHT Teil von Stufe 1** — siehe §7.

### 3.6 Was gar nicht importiert wird

- **Detail 1–2** (1000 Objekte, `…Klein`): das sind Innenansichten von Städten. Wir haben
  dafür die Stadtkarten (`citymap`), nicht die Hauptkarte.
- **Sammelartikel-Zeilen** (`Nachbarprovinzen`, `Raschtulswall`): außerhalb des gepflegten
  Gebiets, dort haben wir eigene Daten.
- **`Stadtviertel`, `Kontinent`, `Platz`**: kein Gegenstück.

---

## 4. Die Flächen — drei Ebenen, und die mittlere ist der Grund

Volker (2026-08-26), sinngemäß: Grenzkoordinaten setzen sich immer aus der **kleinsten**
Einheit zusammen (Junkertum↔Junkertum, im Kosch Baronie↔Baronie). Der Typ eines Fragments
gibt nur die **Anzeigedicke** an — eine Junkertumsgrenze, die zugleich Provinzgrenze ist,
wird als solche definiert. Darüber liegen „virtuelle" **Grenzzüge**, die namentlich auf
Fragmente verweisen, und darüber **Flächen**, die auf Grenzzüge verweisen.

```
Fläche  ──verweist auf──>  Grenzzug  ──verweist auf──>  Fragment (hat Koordinaten)
 758                          298                          1948
```

⭐ **Warum die Zwischenebene existiert:** Volker definiert eine Grafschaft bewusst über
Grenzzüge mit Grafschaftsnamen. Ändert sich darunter etwas, muss er nur den einen Grenzzug
umdefinieren, solange die Topografie gleich bleibt. Wer die Ebene wegoptimiert, verliert
genau diese Eigenschaft.

**Gemessen am Gesamtbestand (758 Flächen):**

| Toleranz | geschlossene Ringe |
|---|---|
| 500 Einheiten (0,8 km) | 489 (64,5 %) |
| 1000 (1,6 km) | 611 (80,6 %) |
| **2000 (3,2 km)** | **672 (88,7 %)** |
| 4000 (6,4 km) | 707 (93,3 %) |

💣 **Die Endpunkte sind nicht exakt.** Volker: „weil wir sie eben von Hand ins SVG malen …
da sind noch so einige historische Fehler drin." Eine Verkettung braucht deshalb eine echte
**Distanztoleranz**. 🪤 **Kein Rundungsraster** — `10,0` und `10,0005` fallen in verschiedene
Zellen, `10,0004` und `10,0006` nicht. Dieselbe Falle ist im Wege-Editor schon einmal
gebaut worden (`WP_CHAIN_TOLERANZ`, AGENTS.md §11).

⚠️ **Genau ein Verweis im Gesamtbestand ist unauflösbar:** `Retogau-Vierok(Hohenrain)` —
es existiert `Retogau(Falkenau)-Vierok(Hohenrain)`. Ein Tippfehler in den Quelldaten, kein
Strukturproblem. Er wird gemeldet, nicht geraten.

**Auflösungsregel:** Ein Flächenverweis nennt die Nachbarschaft ohne Klammerzusätze
(`Raulsmark-Retogau`); die Fragmente tragen zusätzlich die Junkertümer
(`Raulsmark(Weißhorner Forst)-Retogau(Täleshof)`) und manchmal eine angehängte Ziffer
(`…Retogau1`). Zugeordnet wird über: Klammern entfernen, angehängte Ziffern entfernen,
dann Gleichheit. **Über alle Grenzebenen hinweg suchen** — ein Fragment liegt immer auf der
höchsten Ebene, zu der es gehört (`Feidewald-Retogau` steht bei den *Grafschafts*grenzen,
weil das eine andere Grafschaft ist).

---

## 5. Architektur — vier Stufen, nur die letzte schreibt

```
1. HOLEN      18 Seiten -> Rohzeilen, unveraendert, mit Lauf-ID
2. RECHNEN    Transformation + Geometrie + Abgleich -> Vorschlagsliste
3. ANSEHEN    vorhandene Uebernahme-Vorschau (Neu / Geaendert / Geloescht)
4. UEBERNEHMEN nur Angehaktes -> map_features / ecosystem_region + Quellen
```

🔴 **Stufe 2 schreibt in KEINE Nutztabelle.** Das ist bei unseren Sync-Läufen bereits so und
wird per Test erzwungen (`sync-plan-purity-test.php`). Der Import erbt diese Zusicherung.

🔴 **Es wird KEINE zweite Übernahme-Vorschau gebaut.** Die vorhandene (`sync_plan_run`,
`sync_plan_item`, `js/review/sync-plan-sheet.js`) bekommt eine weitere Quelle. Das ist
dieselbe Lehre wie beim Quellensystem, wo eine zweite Tabelle eine Migration gekostet hat
(AGENTS.md §5).

### 5.1 Staging

Eine Tabelle `garetien_import_row`, die die Rohzeile hält:

| Spalte | Inhalt |
|---|---|
| `run_id` | Lauf |
| `wiki` | `ggp` \| `kosch` |
| `ebene` | `Gewaesser`, `Wege`, … |
| `zeile_nr` | Reihenfolge in der Quelle |
| `roh` | die unveränderte Zeile |
| `typ`, `namensraum`, `artikel`, `anzeige`, `lodmin`, `lodmax`, `extra` | zerlegt |
| `geo_art` | `koordinaten` \| `verweise` |
| `geo` | unverändert |

⭐ **Warum roh und zerlegt nebeneinander:** Wenn der Parser sich später ändert, kann man den
Lauf neu zerlegen, ohne die Quelle erneut abzurufen — und man sieht, was an dem Tag geliefert
wurde. Volker sagt selbst, dass sich die Daten „mal ändern" können.

### 5.2 Der Abgleich — der eigentlich schwierige Teil

💣 **Namensgleichheit beweist nichts, und Namensungleichheit auch nicht.** Gemessen an den
246 Gewässern: Ein reiner Namensvergleich fand 39 Treffer (16 %), aber meldete „Großer Fluss"
als neu — den führen wir als `Flussweg` unter **„Der Große Fluss"**. Und innerhalb ihres
eigenen Bestands gibt es „Ährenfeld" dreimal.

Der Abgleich läuft deshalb in dieser Reihenfolge:

1. **Wiki-Artikelname** (eindeutig, weil Wiki-Seitenname) gegen unsere `wiki_url`/`wiki_key`
2. **Geometrie**: liegt an dieser Stelle schon etwas desselben Typs? Schwelle an echten
   Fällen einstellen, nicht raten — Startwert 2 Karteneinheiten (6 Meilen), zu messen.
3. **Name**, nur als schwaches Zusatzsignal, nie allein.

Ergebnis je Zeile: `neu` · `deckt sich` · `widerspricht` · `uebersprungen` (mit Grund).

### 5.3 Quellenzuordnung

🔴 **Jedes übernommene Objekt bekommt eine Quelle**, über das vorhandene System
(`sources` + `feature_sources`) — **keine neue Tabelle**, das ist in AGENTS.md §5 die
ausdrücklich benannte Falle.

- `sources.url` = der Wiki-Artikel des Objekts, gebaut aus `namensraum` + `artikel`
- `sources.label` = Artikelname
- `feature_sources.origin` = neuer Wert **`garetien`** (neben `wiki_publication`, `manual`,
  `community`) — damit ein späterer Lauf seine eigenen Zeilen wiedererkennt und Handarbeit
  nicht überschreibt.
- Für Zeilen **ohne** Artikel (§1.2) gibt es keinen Objektlink; sie bekommen die Sammelquelle
  `https://www.garetien.de` mit dem Label „Garetien, Greifenfurt und Perricum".

⚠️ `entity_type` muss die Zielart nennen (`path`, `region`, `settlement`) — das ist die
Zwei-Zeilen-Änderung in `api/edit/map/feature-sources.php` und `api/app/feature-sources.php`,
falls eine Art noch nicht in der Whitelist steht.

---

## 6. Fallen (gemessen, nicht vermutet)

- 💣 **Warping ist schlechter als affin** (§2.2) — 2,30 gegen 1,24 Meilen.
- 💣 **70 von 219 Passpunkten sind Falschpaare** (§2.4) — ohne Filter Median 94 statt 1,1 Meilen.
- 💣 **Trennzeichen ist `,` ODER ` / `** (§1.1).
- 💣 **Flächensuffixe A–E sind Farben, keine Ränge** (§3.5).
- 💣 **Ein Label ist ein Punkt, die Fläche liegt in `ecosystem_region`** (§3.3).
- 💣 **Fragmente liegen auf der höchsten Ebene, zu der sie gehören** (§4) — wer nur die
  Baroniegrenzen durchsucht, findet 3 von 6 Nachbarschaften der Baronie Retogau nicht.
- 💣 **Y wird gespiegelt** (§2.3).
- 🪤 **Rundung ist keine Toleranz** (§4).
- ⚠️ **Sechs Exportseiten haben exakt 500 Zeilen** (Ortschaften 2–4, Detail 1–2, Kosch
  Ortschaften 1). Das ist die typische Grenze einer Semantic-MediaWiki-Abfrage. GGP ist in
  vier Blöcke geteilt, der **Kosch hat nur einen** — es ist offen, ob dort Ortschaften
  fehlen. 🔧 **Frage an Volker, vor Stufe „Ortschaften".** Für Stufe 1 (Gewässer, 246 und 43
  Zeilen) ist die Grenze nicht erreicht.

---

## 7. Stufen

| Stufe | Inhalt | Risiko | Status |
|---|---|---|---|
| **1** | **Gewässer** (289 Objekte) | gering, überwiegend additiv | **dieser Plan** |
| 2 | Wege (732) | mittel — greift ins Routing | später |
| 3 | Wälder, Berge, Sonstiges (764) | mittel — Flächen + Labels | später |
| 4 | Ortschaften (2519) | hoch — Dubletten, 500er-Frage offen | später |
| 5 | Territorien (758 Flächen) | **hoch** — eigenes Projekt | später |

🔴 **Warum die Territorien zuletzt kommen, obwohl sie technisch gelöst sind:** An
`political_territory` hängen BF-Zeitachse, abgeleitete Außengrenzen, WikiSync und das
Konfliktzentrum. Ein zweiter Datenlieferant in unserem komplexesten Subsystem ist ein eigenes
Vorhaben, kein Anhängsel an einen Gewässerimport. Die Machbarkeit ist mit der
Retogau-Rekonstruktion belegt (§4) — die Reihenfolge ist eine Risiko-, keine Könnensfrage.

---

## 8. Offen

- 🔧 **DU (Owner):** Die Lizenz ist CC BY-NC-SA 3.0. Björns Freigabe deckt nichtkommerzielle
  Nutzung mit Namensnennung, was wir erfüllen. Was **ShareAlike** für unsere offene API
  (`GET /api/locations/`, `POST /api/route/`) bedeutet, hat niemand ausdrücklich beantwortet.
  Für Staging und Vorschau ohne Schreibpfad egal — **vor der ersten echten Übernahme** sollte
  das einmal klar sein, weil Ausbauen teurer ist als Nichteinbauen.
- 🔧 **Volker:** Die 500er-Grenze (§6) — nur relevant ab Stufe 4.
- 🔧 **Owner-Entscheide im Mapping:** `Binge` → `dorf`? `Urwald` → `dschungel`? `Insel` →
  Label oder Fläche? (§3.1, §3.4)
- ⚠️ Die Anbindung importierter Flüsse ans Routing-Wegenetz ist bewusst nicht Teil von
  Stufe 1 (§3.3). Sie wird gemessen und berichtet.
