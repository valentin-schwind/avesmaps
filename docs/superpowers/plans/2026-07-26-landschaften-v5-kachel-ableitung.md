# Landschaften V5 — Kachel-Ableitung Land/Wasser — Implementierungsplan

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Schritte tragen `- [ ]` zum Abhaken.

**Stand:** 2026-07-26. Basis `origin/master` = `e47e178c`. Übergeordneter Plan:
`docs/superpowers/plans/2026-07-24-landschaften.md` (V5-Zeile der „Danach"-Tabelle).
Entscheidungsgrundlage: `docs/superpowers/specs/2026-07-26-landschaften-v4-messung.md` §9.

**Ziel:** Aus den ausgelieferten Kartenkacheln Land- und Wasserflächen ableiten und sie als
Landschaftsflächen in `ecosystem_region` / `ecosystem_area` schreiben — ohne Handarbeit,
in **einem** gedrosselten, wiederaufsetzbaren Lauf.

**Architektur:** Ein reines Offline-Werkzeug unter `tools/ecosystem/`. Es liest die lokalen
Kacheln aus `tiles/stylized/`, baut eine Farbmaske, zerlegt sie in Zusammenhangskomponenten,
ordnet **jeder Komponente ein vorhandenes Label zu** (Name und Wiki-Link kommen von dort,
nie aus dem Werkzeug), vereinfacht die Umrisse und schreibt eine **Manifest-Datei**. Ein
zweites, getrenntes Skript spielt dieses Manifest über die **bestehenden** Schreibaktionen
`create_region` / `create_area` ein. Kein neuer Endpunkt, kein direkter DB-Zugriff, keine
Änderung am Client.

**Technik:** Python 3 + OpenCV 4.13 + NumPy 2.3 + Pillow 12 (alle lokal vorhanden, geprüft).
Serverseitig unverändert: `api/edit/map/ecosystem.php`, `api/_internal/app/ecosystem.php`.

---

## Global Constraints

Gelten in **jeder** Aufgabe, zusätzlich zu den „Globalen Regeln" des Hauptplans (§65 dort).

1. 🔴 **Keine politische Datei wird angefasst oder aufgerufen.** Nicht
   `js/map-features/map-features-region-*`, nicht `js/territory/*`, nicht
   `api/_internal/political/*`. Prüfung: `git status` zeigt keine.
2. 🔴 **Ein Flächen-Save fasst `map_revision` nie an.** Der Import läuft ausschließlich
   über `create_region` / `create_area`; beide rufen nur `avesmapsNextEcosystemRevision`
   (V4-Messung §4.1, statisch bewiesen). **Kein `feature_sources`-Schreibpfad** — das ist
   V4a und nicht Teil dieses Vorhabens.
3. 🔴 **`wiki_region_key` entsteht serverseitig.** `avesmapsEcosystemWikiRegionKey`
   (`api/_internal/app/ecosystem.php:688`) leitet ihn aus `wiki_url` ab. Das Manifest
   schickt **`wiki_url`**, niemals einen selbst gebauten Key.
4. 🔴 **Namen und Wiki-Links werden nicht erfunden.** Beide kommen aus dem zugeordneten
   `map_features`-Label. Eine Fläche ohne Label bekommt keinen Namen und wird **nicht**
   importiert, sondern gemeldet.
4a. 🔴 **Land und Wasser landen in verschiedenen Ebenen und dürfen nie vermischt werden.**
   Eine Insel ist **derographisch**, ein See ist **topographie** — zwei `kind`-Werte, zwei
   `ecosystem_region`-Zeilen, zwei Leaflet-Panes (`ecosystemPaneDerographisch` z-index 250,
   `ecosystemPaneTopographie` 252, `js/app/bootstrap.js:75–77`). Durchgesetzt an **einer**
   Stelle, `REGION_KIND_BY_SUBTYPE` (Aufgabe 4), und dort per Test festgenagelt:

   | Label-Subtyp | `kind` | woher die Form kommt |
   |---|---|---|
   | `insel`, `kontinent` | **derographisch** | aus der **Land**maske, Festland ausgeschlossen |
   | `see`, `kueste` | **topographie** | aus der **Wasser**maske, Ozean ausgeschlossen |
   | `wueste` | vegetation | (nicht ableitbar, siehe unten) |

   💣 **Die Falle, die das verhindert:** Insel und umgebender See teilen sich dieselbe
   Pixelkante. Ohne die Trennung nach `kind` entstünden zwei Flächen mit demselben Umriss in
   derselben Ebene — eine sichtbare Doppelung, die niemand mehr auseinanderhält. Deshalb
   laufen die beiden Klassen durch **getrennte Komponentenmengen** (`land` bzw. `lake`) und
   werden in `derive_areas.py` getrennt verarbeitet, nicht in einem gemeinsamen Durchlauf.
5. 🔴 **149 Flächen sind kein Schleifenbetrieb gegen STRATO.** Ein Lauf, gedrosselt
   (Standard 1,0 s zwischen zwei Schreibaufrufen), wiederaufsetzbar über eine
   Zustandsdatei. Die Ableitung selbst ist vollständig offline und braucht **null**
   Serveranfragen.
6. ⚠️ **`dsa5-atlas/` im Nachbarrepo wird nicht angefasst** — Ulisses-Material.
   Aus `C:/GIT/avesmaps-map-processing/scripts/` wird **gelesen und abgeschrieben**
   (`13_make_landmass_rgba.py`, `24_make_water_rgba_from_original_sea_mask.py`,
   `27_polygonize_town_tiles.py`), nie importiert — das Nachbarrepo ist zur Laufzeit
   dieses Werkzeugs nicht vorausgesetzt.
7. **Koordinaten:** GeoJSON ist `[x, y]`, Leaflet `L.CRS.Simple` ist `[lat, lng] = [y, x]`.
   Das Manifest trägt **GeoJSON-Reihenfolge**, unverschränkt — genau wie
   `api/_internal/app/ecosystem.php` sie erwartet.
8. **Kacheldateien tragen negative y** (`map_{x}_{-y}.webp`, AGENTS.md §10). Die oberste
   Kachelreihe hat das **negativste** y.
9. **Deutsch in der Oberfläche, Englisch in Code, Kommentaren und Commits.**
10. **Geteilter Arbeitsbaum:** nie `git add -A`. Nur eigene Pfade einzeln stagen.
11. Alle Grenzwerte des Werkzeugs sind **CLI-Argumente mit den hier gemessenen Vorgaben** —
    kein hartkodierter Wert im Code, damit die Entwurfsrunde (Aufgabe 6) ohne Codeänderung
    nachjustieren kann.
12. **Nutzlast, Manifest, Bericht und Zustandsdatei liegen im Scratchpad, nicht im Repo.**
    Sie sind Zwischenstände eines Laufs, kein Bestand. In allen Befehlen unten steht dafür
    `$SCRATCH`; einmal je Sitzung setzen:

    ```bash
    export SCRATCH="C:/Users/mail/AppData/Local/Temp/claude/C--GIT-avesmaps/<session>/scratchpad"
    ```

    Die einzige Ausnahme ist `entwurf.json` in Aufgabe 6 — die Datei muss neben
    `verify-ecosystem-v5-entwurf.html` liegen, damit `fetch` sie erreicht, und wird danach
    wieder entfernt.

---

## Die vier Fragen — beantwortet, gemessen am 2026-07-26

Diese vier Antworten sind **gemessen, nicht geschätzt**. Herleitung und Zahlen stehen jeweils
dabei; die Aufgaben unten setzen sie voraus und leiten sie nicht neu her.

### Frage 1 — Welche Farbschwelle trennt Land von Wasser?

**Die Produktionsschwelle aus `13_make_landmass_rgba.py:316` (`build_water_mask`), mit
genau einer gemessenen Korrektur.** Ein Pixel ist Wasser, wenn **alle** gelten:

| Bedingung | Produktionswert | **hier** |
|---|---|---|
| HSV-Farbton (OpenCV, 0–179) | `75 ≤ H ≤ 125` | unverändert |
| HSV-Sättigung | `S ≥ 35` | unverändert |
| Blau über Grün | `B ≥ G + 10` | 🔴 **`B ≥ G − 20`** |
| Blau über Rot | `B ≥ R + 20` | unverändert |
| Nachbearbeitung | `MORPH_CLOSE` 3×3, Komponenten `< 4 px` verwerfen | unverändert |

> 💣 **Warum die Korrektur tragend ist — und was ohne sie kaputtgeht.** Der Flachwassersaum
> der ausgelieferten Kacheln ist **grün**dominantes Türkis, kein Blau. Gemessene Beispiele
> aus dem Saum: RGB (91,171,158) → `B−G = −13`; (132,178,160) → `−18`; (122,154,143) → `−11`.
> Bei `B ≥ G + 10` fällt dieser Saum als **Land** an — und verschweißt benachbarte Inseln zu
> **einer** Komponente. Gemessen an zwei Archipelen:
>
> | | `B ≥ G+10` | `B ≥ G+0` | **`B ≥ G−20`** |
> |---|---:|---:|---:|
> | Archipel A (4 Label: Sigorast, Gandar, Serreka, Aso), z3 | 1 Komponente | 2 | **3** |
> | Archipel A, z5 | 1 | 3 | **4** ✅ |
> | Archipel B (5 Label: Inirk, Sorkten, Karkis, Adrak, Dirak), z3 | 1 | 3 | **5** ✅ |
> | Archipel B, z5 | 4 | 4 | **5** ✅ |
> | Ganze Karte z2: unterscheidbare Inselkomponenten | 70 | 78 | **83** |
> | Ganze Karte z2: `see`-Label mit eigener Komponente | 42 | 43 | **44** |
> | **Ganze Karte z3** (die Empfehlung): Inseln aufgelöst / eigene Form / umstritten | 90 / 70 / 11 | 91 / 79 / 10 | **92 / 86 / 6** |
> | **Ganze Karte z3:** `see` aufgelöst / eigene Form | — | 44 / 43 | **44 / 43** |
>
> **Die Schwelle war die Fessel, nicht die Auflösung.** Bei z5 und Produktionswert bleiben
> vier sichtbar getrennte Inseln eine einzige Komponente; bei `G−20` trennen sie sich schon
> bei z3. Jenseits von `−20` ändert sich nichts mehr (gemessen bis `−45`: identisch).
>
> ⚠️ **Der Preis, den die Entwurfsrunde prüfen muss:** bei `G−20` liegen **4 von 68**
> `wald`-Labelpunkten auf Wasser (bei `G+10`: 0). Das sind mutmaßlich Flüsse und Waldseen
> unter dem Labelpunkt, kein Fehlalarm der Schwelle — für V5 ohne Belang, weil V5 nur Seen
> und Inseln ableitet. Nachgeprüft wird es trotzdem in Aufgabe 6.

**Grundlage:** die Maske stammt aus derselben Werkzeugkette, die die Kacheln erzeugt hat;
`24_make_water_rgba_from_original_sea_mask.py` hat die *Original*-Kacheln maskiert und daraus
das Wasser der stilisierten Kacheln gemalt. Deshalb liegt die Kante dort, wo sie gezeichnet
ist — und nicht dort, wo ein selbst erfundener Schwellenwert sie vermuten würde.

### Frage 2 — Wie wird aus der Rasterfläche ein Ring?

Fünf Schritte, jeder mit einer Entscheidung, die belegt ist.

**(a) Raster:** Die lokalen Kacheln aus `C:/GIT/avesmaps/tiles/stylized/{z}/map_{x}_{-y}.webp`
werden zu **einem** Bild zusammengesetzt. **Zoom 3** = 32×32 Kacheln à 256 px = **8192×8192**,
also **8 px je Karteneinheit**. Geprüft: z0…z5 liegen vollständig lokal (z5: 16.384 Dateien),
z3 baut in ~90 s und braucht 201 MB.

> **Warum z3 und nicht z5:** z5 wäre 32 px/Einheit und 3,2 GB im Speicher. Die
> Archipel-Messung oben zeigt, dass z5 gegenüber z3 **nur** dort noch etwas beiträgt, wo die
> Schwelle bereits sitzt (Archipel A 3 → 4). Das ist ein Sonderfall für die Nacharbeit, kein
> Grund, den ganzen Lauf zwölfmal so teuer zu machen. `--zoom` ist ein Argument; ein
> einzelner Streitfall lässt sich nachträglich bei z5 nachziehen.

**(b) Drei Mengen aus einer Maske:**

| Menge | Regel |
|---|---|
| **Ozean** | Wasserkomponenten, die den **Bildrand** berühren |
| **See** | Wasser, das den Rand **nicht** berührt — also von Land umschlossen |
| **Land** | alles, was nicht Wasser ist |

Die Randregel ist wörtlich `border_connected_components`
(`24_make_water_rgba_from_original_sea_mask.py:196`). Sie ist der ganze Trick: **sie trennt
Meer von See ohne jede Formheuristik.** Gemessen bei `B ≥ G+10`/z2: 874 Wasserkomponenten,
davon 7 randberührend → Ozean; 867 Seen.

**(c) 🔴 Label-getrieben, nie blind.** Die 867 „Seen" aus (b) sind zum größten Teil
**Flüsse** — blaue Linien, die den Rand nicht erreichen. Eine Formheuristik dagegen
(Fläche/Umfang, Erosion) wäre eine erfundene Regel mit erfundenen Grenzwerten. Stattdessen:

> **Jedes der 46 `see`- und 95 `insel`-Label sucht seine Komponente, nicht umgekehrt.**
> Vom Labelpunkt aus wird nach außen gesucht, bis eine Komponente getroffen ist, gedeckelt
> bei **8 Karteneinheiten**. Was kein Label findet, wird nie zu einer Fläche. Damit sind die
> Flüsse in einem Zug erledigt *und* die Namensfrage beantwortet.

> 🪤 **Bekannte Grenze, sichtbar am Ochsenwasser:** ein Fluss, der in einen See mündet und den
> Bildrand nicht erreicht, gehört zur **selben** Wasserkomponente wie der See — die abgeleitete
> Seefläche trägt dann einen Flussarm mit. Das ist keine Fehlfunktion der Schwelle, sondern die
> ehrliche Folge der Randregel. Es ist **nicht** automatisch reparierbar, ohne eine
> Formheuristik zu erfinden; ein Öffnungsschritt (`MORPH_OPEN`) würde dünne Arme kappen und
> zugleich schmale echte Seen zerschneiden. **Behandlung:** die Entwurfsrunde (Aufgabe 6)
> enthält Ochsenwasser genau deshalb als Fall 2, und betroffene Flächen werden im Bericht
> benannt, damit ein Editor den Arm in zwei Handgriffen wegzieht (V3.3 Vertex-Editor steht).

Zwei Feinheiten, beide gemessen:

- **Inseln liegen selten unter ihrem Label.** Nur **14 von 95** `insel`-Labelpunkten liegen
  direkt auf ihrer Insel — der Rest steht daneben, weil die Insel für den Schriftzug zu
  klein ist. Die Suche nach außen ist deshalb Pflicht, nicht Komfort. Bei `see` liegen
  **40 von 46** direkt darauf; größter nötiger Radius bei z3: **1,88 Einheiten**.
- **Die umgekehrte Zuordnung ist schlechter und wurde verworfen.** „Jede Komponente nimmt
  ihr nächstes Label" (Schwerpunkt-Abstand) erreichte nur **61 von 95** Labeln — der
  Schwerpunkt einer großen Insel liegt weiter vom Randlabel entfernt als der Deckel erlaubt.
  Die Vorwärtssuche erreicht **91–93**.

**(d) Ring:** `cv2.findContours(..., RETR_CCOMP, CHAIN_APPROX_NONE)` je Komponente. `RETR_CCOMP`
liefert zwei Ebenen — **äußerer Ring plus Löcher**. Das ist nicht theoretisch: ein See in
einer Insel und eine Insel in einem See kommen beide vor. Mehrere Komponenten für **ein**
Label (Archipel unter einem Sammelnamen) werden zu **einem MultiPolygon** — der Schreibpfad
nimmt das ausdrücklich (`avesmapsEcosystemNormalizeGeometry`, `api/_internal/app/ecosystem.php:354`).

**(e) Pixel → Karte:**

```
x = col / ppu
y = 1024 − row / ppu          # ppu = Bildbreite / 1024
```

> 💣 **Die y-Spiegelung ist die gefährlichste Zeile des Vorhabens** — falsch herum sieht
> alles plausibel aus und liegt spiegelverkehrt. Sie ist deshalb **empirisch entschieden**,
> nicht hergeleitet:
>
> | Labelklasse | mit Spiegelung (oben = 1024) | ohne Spiegelung |
> |---|---:|---:|
> | `wald` (68) auf Wasser | **0** ✅ | 7 |
> | `gebirge` (60) auf Wasser | **1** ✅ | 25 |
> | `meer` (35) auf Wasser | **35 / 35** ✅ | 23 |
>
> Diese Probe ist in Aufgabe 2 ein ausführbarer Befehl und muss vor jedem Lauf grün sein.

### Frage 3 — Wie stark wird vereinfacht?

**Douglas-Peucker (`cv2.approxPolyDP`), ε aber nicht absolut, sondern als Anteil am
Umfang der Form: `ε = Umfang × 0,004`, Untergrenze 0,75 px.**

> 🔴 **Ein absolutes ε ist hier falsch, und das ist gemessen, nicht gemeint.** Die Formen
> unterscheiden sich um den Faktor 28 im Umfang — Maraskan hat 5.602 Rohecken, die Insel
> Sigorast 200. Ein ε, das Maraskan gut tut, macht aus Sigorast ein Dreieck:
>
> | Form | roh | abs. ε = 0,5 | abs. ε = 1,0 | abs. ε = 2,0 | **Umfang × 0,004** | Umfang × 0,008 |
> |---|---:|---:|---:|---:|---:|---:|
> | Maraskan (Insel) | 5.602 | 254 | 126 | 74 | **46** | 24 |
> | Ochsenwasser (See) | 830 | 28 | 18 | 11 | **28** | 19 |
> | Angbarer See | 408 | 22 | 10 | 4 | **37** | 23 |
> | Sigorast (kleine Insel) | 200 | 11 | **4** 💥 | **3** 💥 | **34** | 19 |
>
> Bei absolut ε = 1,0 ist Sigorast ein Viereck und der Angbarer See ein Zehneck, das quer
> über das Ufer schneidet. Die umfangsrelative Vereinfachung hält **jede** Form bei einer
> vergleichbaren Eckenzahl, unabhängig von ihrer Größe.
>
> Das ist zugleich das Hausmuster: `27_polygonize_town_tiles.py:139` rechnet genauso
> (`epsilon = max(0.75, perimeter * simplify_ratio)`).

**Der Maßstab, gegen den das geprüft wird**, ist die live gemessene Baronie-Dichte:
**Median 49 Ecken je Fläche, p90 85, max 147.** Bei Verhältnis 0,004 liegen alle vier
Probeformen zwischen **28 und 46 Ecken** — also unter der Baronie-Dichte, und um den Faktor
10 bis 120 unter der rohen Pixelkante. Das ist gewollt: die Ebene ist edit-only, Besucher
sehen die Polygone nie, sondern nur ihre Wirkungen (Reisezeit, „führt durch …", Suche). Ein
Waldrand muss ungefähr stimmen, nicht genau.

**Das Renderbudget hält mit großem Abstand.** Gemessen: 500 Flächen mit 27.347 Ecken bei
Zoom 0 kosten 56 ms je Zoomschritt und 150 ms für einen 8-Schritt-Pan; die politische Ebene
zeichnet heute 88.571 Ecken. 122 Flächen à ~35 Ecken sind rund **4.300** — ein Zwanzigstel
dessen, was die politische Ebene heute zeichnet.

> ⚠️ **Das Verhältnis ist ein CLI-Argument (`--simplify-ratio`, Vorgabe 0,004) und der
> eigentliche Gegenstand der Entwurfsrunde (Aufgabe 6).** Wer gröber will, nimmt 0,008
> (jede Form ~20 Ecken); 0,015 ist messbar zu grob — Ochsenwasser schneidet dort über das
> Ufer. Genau deshalb wird der Entwurf **vor** dem Massenimport gezeigt: „Ein Massenimport
> in falscher Vereinfachungsstufe ist teurer rückgängig zu machen als noch einmal zu rechnen."

### Frage 4 — Auf welchem Weg landen die Flächen in `ecosystem_region` / `ecosystem_area`?

**Über die bestehenden Schreibaktionen, einzeln, gedrosselt, wiederaufsetzbar.** Kein neuer
Endpunkt, kein `INSERT`, kein Massen-Import-Verb.

Je abgeleiteter Landschaft **zwei** Aufrufe an `POST /api/edit/map/ecosystem.php`
(Fähigkeit `edit`):

```jsonc
// 1) die Region traegt Namen, Art und die Wiki-Bruecke
{ "action": "create_region",
  "kind": "topographie",              // aus dem Label-Subtyp abgeleitet, s. Tabelle
  "region_type": "see",               // = der Label-Subtyp
  "name": "Angbarer See",             // aus dem Label
  "wiki_url": "https://de.wiki-aventurica.de/wiki/Angbarer_See",   // aus dem Label
  "label_public_id": "…"              // die Bruecke zur Label-Zeile
}
// -> { ok: true, region: { public_id: "…" }, … }

// 2) die Flaeche haengt an dieser Region
{ "action": "create_area",
  "region_public_id": "…",
  "geometry_geojson": { "type": "Polygon", "coordinates": [ [ [x,y], … ] ] },
  "is_trial": false }
```

**Abbildung Label-Subtyp → `kind` / `region_type`** (der Seed in
`api/_internal/app/ecosystem.php:68` gibt sie vor, nichts wird erfunden):

| Label-Subtyp | `kind` | `region_type` |
|---|---|---|
| `see` | `topographie` | `see` |
| `insel` | `derographisch` | `insel` |
| `kontinent` | `derographisch` | `kontinent` |
| `kueste` | `topographie` | `kueste` |
| `wueste` | `vegetation` | `wueste` |

Vier Eigenschaften dieses Weges, die ihn tragen:

1. **`wiki_region_key` entsteht serverseitig** aus `wiki_url` (`ecosystem.php:636`, `:688`).
   Das Manifest schickt ihn nie.
2. **`is_trial: false` wird ausdrücklich gesetzt.** `create_area` liest sonst
   `app_setting['ecosystem_trial']` (`ecosystem.php:960`) — der Import hinge dann daran, ob
   der Owner `promote_trial` schon ausgeführt hat. Ausdrücklich gesetzt hängt er an nichts.
3. **`map_revision` bleibt unberührt.** Beide Aktionen rufen nur
   `avesmapsNextEcosystemRevision` (V4-Messung §4.1).
4. **Wiederaufsetzbar:** eine Zustandsdatei hält je Label fest, welche `region_public_id` /
   `area_public_id` schon existiert. Ein abgebrochener Lauf setzt fort und legt nichts doppelt an.

🔧 **DU (Owner):** Der Importlauf braucht eine Editor-Sitzung (Fähigkeit `edit`). Das Skript
liest sie aus einer Cookie-Datei, die der Owner bereitstellt; es fragt nie nach Zugangsdaten
und enthält keine. Der Lauf wird vom Owner gestartet.

---

## 🔴 Die Zielmenge ist nicht 149 — was gemessen wirklich geht

Der Hauptplan nennt **149** (`insel` 95 + `see` 46 + `kueste` 2 + `kontinent` 2 + `wueste` 4).
Gemessen an den echten Kacheln trägt diese Summe nicht. **Das ist der wichtigste Befund
dieser Vorbereitung, und er gehört vor das GO, nicht hinter den Import.**

Gemessen bei der **empfohlenen** Einstellung (z3, `B ≥ G−20`, Vereinfachung Umfang × 0,004):

| Klasse | Plan | **gemessen ableitbar** | Befund |
|---|---:|---:|---|
| `see` | 46 | **42** | 44 Label finden eine Komponente, 43 Formen — **eine** Form trägt zwei Namen und fällt damit auf die Prüfliste. 2 ohne Komponente: „Cichanebi-Salzsee", „Al'Birkabrah". Max. Suchradius 1,88 Einheiten |
| `insel` | 95 | **80** | 92 Label finden eine Komponente, 86 Formen — **6** Formen tragen je zwei Namen (Archipele unter Einzelnamen) und fallen auf die Prüfliste. 3 ohne Komponente, darunter „Zyklopeninseln", „Olportsteine" |
| `kontinent` | 2 | **0–1** | 🔴 **Aventurien und Riesland treffen dieselbe Komponente** (20,2 Mio. px). Das Raster trennt sie nicht — sie hängen zusammen. Und ein Kontinent ist mit ~70.000 Rohecken ein anderes Tier als ein 400-Ecken-See |
| `kueste` | 2 | **0** | 🔴 Beide Labelpunkte liegen **im Wasser** (Kap Sanin RGB 52,122,150; Schwadenküste 26,107,149). Eine Küste ist eine **Linie**, keine Rasterfläche |
| `wueste` | 4 | **0** | 🔴 Wüsten sind **Land**. Keine Farbschwelle trennt sie: „Gor" (169,120,97) und „Khôm" (160,136,82) sind sandig, „Wüstenei von Dragenfeld" (65,81,61) und „Tote Lande" (94,114,45) sind von Wald und Steppe nicht zu unterscheiden — und „Gorische Steppe" (153,138,76) sieht sandiger aus als zwei der vier Wüsten |
| **Summe** | **149** | **122** | dazu **7 Formen auf der Prüfliste** und **5 ohne Komponente** |

**Empfehlung — und sie ist der Vorschlag, über den das GO mitentscheidet:**

- ✅ **`see` und `insel` automatisch ableiten** (**122 Flächen**). Das ist der Kern und er trägt.
- 🔴 **`kueste` (2) und `wueste` (4) aus V5 herausnehmen.** Sie sind mit einer
  Land/Wasser-Schwelle nicht ableitbar — kein Grenzwert rettet das, es ist die falsche
  Fragestellung. Sechs Flächen von Hand sind billiger als eine erfundene zweite Heuristik.
- 🟡 **`kontinent` als eigenen, einzelnen Schalter** (`--include-mainland`, Vorgabe **aus**),
  und dann nur **Aventurien** und mit gröberem ε (1,0 → 1.539 Ecken statt 4.877). Riesland
  bleibt Handarbeit. Grund: eine 20-Mio.-Pixel-Fläche gehört nicht unbesehen in denselben
  Massenlauf wie 122 Seen und Inseln.
- 📋 **Die 7 umstrittenen Formen kommen auf eine Prüfliste**, nicht in eine automatische
  Auflösung. Wer entscheidet, welcher von zwei Namen die eine Form bekommt, ist eine
  inhaltliche Frage, keine Rechenfrage. Vorgabe: **keine** wird importiert, alle stehen im
  Bericht.

> ⭐ **Wenn der Owner die 149 will:** Die 6 nicht ableitbaren gehen als Handarbeit im Editor
> (V3.2 steht), die 7 umstrittenen Formen und die 5 ohne Komponente nach Sichtprüfung. V5
> nimmt dann **122 von 149** ab — was die V4-Hochrechnung nur unwesentlich verschiebt
> (352 → 379 Handarbeitsflächen, bei t_A = 3 min sind das **+1,35 h**) und an der
> Entscheidung „weiterbauen, V5 zuerst" nichts ändert. **Der Hebel bleibt intakt.**

---

## File Structure

| Datei | Verantwortung |
|---|---|
| `tools/ecosystem/ecosystem_raster.py` | **neu** — Kachel-Zusammenbau, Wassermaske, Ozean/See/Land-Zerlegung, Pixel↔Karte. Kennt keine Label und keine Datenbank. |
| `tools/ecosystem/ecosystem_shapes.py` | **neu** — Komponente → Ring(e) mit Löchern, Douglas-Peucker, GeoJSON-Bau. Kennt kein Raster-IO. |
| `tools/ecosystem/ecosystem_labels.py` | **neu** — Label aus einer `map-features`-Nutzlast lesen, Vorwärtssuche Label→Komponente, Konflikte erkennen, Subtyp→`kind`/`region_type`. |
| `tools/ecosystem/derive_areas.py` | **neu** — CLI, das die drei Module zu einem Lauf verbindet und `manifest.json` + `report.md` schreibt. Schreibt **nie** in die Datenbank. |
| `tools/ecosystem/import_areas.py` | **neu** — CLI, das ein Manifest über `POST /api/edit/map/ecosystem.php` einspielt: gedrosselt, wiederaufsetzbar, `--dry-run` als Vorgabe. |
| `tools/ecosystem/test_ecosystem_v5.py` | **neu** — Einheitentests auf **synthetischen** Rastern. Keine Kachel, kein Netz, kein Zufall. |
| `verify-ecosystem-v5-entwurf.html` | **neu, nicht deployt** — Leaflet-Vorschau der Entwurfsflächen auf den echten Kacheln (Aufgabe 6). |
| `docs/superpowers/plans/2026-07-24-landschaften.md` | **ändern** — V5-Zeile abhaken (Aufgabe 8). |
| `docs/stylized-map-tiles.md` | **ändern** — Abschnitt „Ableitung von Landschaftsflächen" (Aufgabe 8). |

**Warum drei Module und nicht eine Datei:** Raster-IO (200 MB Arrays), Geometrie (reine
Mathematik) und Label-Zuordnung (Domänenwissen) haben verschiedene Testbarkeit. Die Geometrie
ist auf einem 64×64-Fixture vollständig prüfbar; das Raster-IO ist es nicht. In einer Datei
wäre der Geometrietest an den Kachelbestand gefesselt.

---

## Task 1: Wassermaske und die drei Mengen

**Files:**
- Create: `tools/ecosystem/ecosystem_raster.py`
- Test: `tools/ecosystem/test_ecosystem_v5.py`

**Interfaces:**
- Produces: `water_mask(rgb, hue=(75,125), sat_min=35, blue_over_green=-20, blue_over_red=20, min_area=4) -> np.ndarray[bool]`;
  `split_water(water) -> tuple[np.ndarray, np.ndarray, np.ndarray]` als `(ocean, lake, land)`;
  `assemble_tiles(tiles_root: Path, zoom: int) -> np.ndarray` (uint8, HxWx3, RGB).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```python
# tools/ecosystem/test_ecosystem_v5.py
import numpy as np
import pytest
from ecosystem_raster import water_mask, split_water

DEEP_WATER = (40, 90, 170)      # deep ocean blue: B-G=80, B-R=130, hue ~108
SHALLOW = (91, 171, 158)        # measured shallow shelf: B-G=-13 -> the whole point
LAND = (150, 140, 95)           # dry parchment land: B < R, must never be water


def make_scene():
    """64x64: ocean everywhere, two land squares separated ONLY by a shallow strip,
    plus one enclosed lake inside the left square."""
    rgb = np.zeros((64, 64, 3), dtype=np.uint8)
    rgb[:, :] = DEEP_WATER
    rgb[20:44, 8:28] = LAND          # left island
    rgb[20:44, 36:56] = LAND         # right island
    rgb[20:44, 28:36] = SHALLOW      # the strip between them
    rgb[28:36, 14:22] = DEEP_WATER   # a lake inside the left island
    return rgb


def test_shallow_shelf_counts_as_water():
    water = water_mask(make_scene())
    assert water[30, 31], "the shallow strip must be water, else the islands weld together"


def test_two_islands_stay_separate():
    _, _, land = split_water(water_mask(make_scene()))
    import cv2
    count, _, _, _ = cv2.connectedComponentsWithStats(land.astype(np.uint8), connectivity=8)
    assert count - 1 == 2, f"expected 2 land components, got {count - 1}"


def test_lake_is_not_ocean():
    ocean, lake, _ = split_water(water_mask(make_scene()))
    assert lake[31, 17] and not ocean[31, 17], "an enclosed lake must not be ocean"
    assert ocean[2, 2] and not lake[2, 2], "the border-connected sea must be ocean"


def test_production_offset_would_weld_them():
    """Guards the correction itself: with the production +10 the test scene fails."""
    import cv2
    _, _, land = split_water(water_mask(make_scene(), blue_over_green=10))
    count, _, _, _ = cv2.connectedComponentsWithStats(land.astype(np.uint8), connectivity=8)
    assert count - 1 == 1, "with B>=G+10 the shelf is land and the islands become one"


def test_land_is_never_water():
    water = water_mask(make_scene())
    assert not water[22, 10], "dry land must not be water"
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v
```

Erwartet: `ModuleNotFoundError: No module named 'ecosystem_raster'`.

- [ ] **Schritt 3: Die minimale Umsetzung schreiben**

```python
# tools/ecosystem/ecosystem_raster.py
"""Land/water raster derivation for the Landschaften layer (plan V5).

The colour rule is NOT invented here. It is the production water mask of the tool chain that
produced these tiles -- 13_make_landmass_rgba.py:316 (build_water_mask) in the neighbouring
repo avesmaps-map-processing -- with exactly ONE measured correction, see WATER_BLUE_OVER_GREEN.

The ocean/lake split is border connectivity, copied from
24_make_water_rgba_from_original_sea_mask.py:196 (border_connected_components). It separates
sea from lake without a single shape heuristic: a lake does not touch the map edge.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# Production defaults from 13_make_landmass_rgba.py
WATER_HUE = (75, 125)          # OpenCV hue, 0..179 -> roughly 150deg..250deg, cyan through blue
WATER_SAT_MIN = 35
WATER_BLUE_OVER_RED = 20
WATER_MIN_AREA = 4

# 🔴 The one deviation, and it is load-bearing. Production demands B >= G + 10. The shallow-water
# shelf of the DEPLOYED tiles is GREEN-dominant turquoise -- measured samples: RGB(91,171,158)
# B-G=-13, (132,178,160) -13->-18, (122,154,143) -11. At +10 that shelf counts as LAND and welds
# neighbouring islands into one component: Archipel A (Sigorast/Gandar/Serreka/Aso) collapses from
# 4 islands to 1, even at zoom 5. At -20 both test archipelagos separate fully. Beyond -20 nothing
# changes any more (measured to -45).
WATER_BLUE_OVER_GREEN = -20

TILE_SIZE = 256
MAP_SPAN = 1024.0              # js/config.js: IMG_WIDTH/IMG_HEIGHT, MAP_BOUNDS [[0,0],[1024,1024]]


def water_mask(
    rgb: np.ndarray,
    hue: tuple[int, int] = WATER_HUE,
    sat_min: int = WATER_SAT_MIN,
    blue_over_green: int = WATER_BLUE_OVER_GREEN,
    blue_over_red: int = WATER_BLUE_OVER_RED,
    min_area: int = WATER_MIN_AREA,
) -> np.ndarray:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    red = rgb[:, :, 0].astype(np.int16)
    green = rgb[:, :, 1].astype(np.int16)
    blue = rgb[:, :, 2].astype(np.int16)

    candidate = (
        (hsv[:, :, 0] >= hue[0]) & (hsv[:, :, 0] <= hue[1])
        & (hsv[:, :, 1] >= sat_min)
        & (blue >= green + blue_over_green)
        & (blue >= red + blue_over_red)
    )

    binary = candidate.astype(np.uint8) * 255
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), dtype=np.uint8))

    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    cleaned = np.zeros_like(binary)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == index] = 255
    return cleaned > 0


def split_water(water: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(ocean, lake, land). Ocean = water touching the image border, lake = the rest of the water."""
    count, labels, _, _ = cv2.connectedComponentsWithStats(water.astype(np.uint8), connectivity=8)
    if count <= 1:
        empty = np.zeros_like(water)
        return empty, water.copy(), ~water

    border: set[int] = set()
    for edge in (labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]):
        border.update(np.unique(edge).tolist())
    border.discard(0)

    ocean = np.isin(labels, list(border)) if border else np.zeros_like(water)
    return ocean, (water & ~ocean), ~water


def assemble_tiles(tiles_root: Path, zoom: int) -> np.ndarray:
    """Stitch tiles/stylized/<zoom>/map_<x>_<-y>.webp into one RGB image.

    💣 Tile files carry NEGATIVE y (AGENTS.md section 10): the TOP row of pixels is the MOST
    negative tile index. At zoom 0 the top row is map_0_-4 .. map_3_-4, the bottom row map_0_-1.
    """
    per_axis = 4 * (2 ** zoom)
    size = per_axis * TILE_SIZE
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    zoom_dir = tiles_root / str(zoom)

    for row in range(per_axis):                 # row 0 = top
        tile_y = -(per_axis - row)
        for col in range(per_axis):
            path = zoom_dir / f"map_{col}_{tile_y}.webp"
            if not path.is_file():
                raise SystemExit(f"missing tile: {path}")
            with Image.open(path) as image:
                canvas[row * TILE_SIZE:(row + 1) * TILE_SIZE,
                       col * TILE_SIZE:(col + 1) * TILE_SIZE] = np.array(image.convert("RGB"))
    return canvas
```

- [ ] **Schritt 4: Tests laufen lassen, alle grün**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v
```

Erwartet: 5 passed.

- [ ] **Schritt 5: Commit**

```bash
git commit -m "feat(ecosystem): land/water raster mask with the measured shallow-shelf correction" -- tools/ecosystem/ecosystem_raster.py tools/ecosystem/test_ecosystem_v5.py
```

---

## Task 2: Pixel ↔ Karte, mit der Orientierungsprobe als Befehl

**Files:**
- Modify: `tools/ecosystem/ecosystem_raster.py`
- Modify: `tools/ecosystem/test_ecosystem_v5.py`
- Create: `tools/ecosystem/verify_orientation.py`

**Interfaces:**
- Consumes: `assemble_tiles`, `water_mask` aus Task 1.
- Produces: `pixels_per_unit(size: int) -> float`; `pixel_to_map(row, col, size) -> tuple[float, float]`;
  `map_to_pixel(x, y, size) -> tuple[int, int]` (gibt `(row, col)`, geklemmt auf das Bild).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```python
# append to tools/ecosystem/test_ecosystem_v5.py
from ecosystem_raster import map_to_pixel, pixel_to_map, pixels_per_unit


def test_top_row_is_y_1024():
    """💣 The single most dangerous line in V5. Wrong way round, everything looks plausible
    and lies mirrored. js/config.js MAP_BOUNDS = [[0,0],[1024,1024]] with lat = y, and the
    decoration anchors (compass [18,1006] bottom-right, logo [1006,18] top-left) fix which
    end is up: y = 1024 is the TOP."""
    assert pixel_to_map(0, 0, 8192) == (0.0, 1024.0)
    assert map_to_pixel(0.0, 1024.0, 8192) == (0, 0)


def test_bottom_right_is_x_1024_y_0():
    x, y = pixel_to_map(8191, 8191, 8192)
    assert round(x, 3) == 1023.875 and round(y, 3) == 0.125


def test_roundtrip_is_stable():
    for x, y in [(522.0, 496.25), (1010.0, 749.0), (0.5, 1023.5)]:
        row, col = map_to_pixel(x, y, 8192)
        rx, ry = pixel_to_map(row, col, 8192)
        assert abs(rx - x) <= 0.125 and abs(ry - y) <= 0.125


def test_pixels_per_unit():
    assert pixels_per_unit(8192) == 8.0
    assert pixels_per_unit(4096) == 4.0
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v -k "y_1024 or bottom_right or roundtrip or pixels_per_unit"
```

Erwartet: `ImportError: cannot import name 'map_to_pixel'`.

- [ ] **Schritt 3: Die Umsetzung schreiben**

```python
# append to tools/ecosystem/ecosystem_raster.py

def pixels_per_unit(size: int) -> float:
    return size / MAP_SPAN


def pixel_to_map(row: int, col: int, size: int) -> tuple[float, float]:
    """Pixel centre -> map coordinate (x, y) in GeoJSON order.

    💣 y is FLIPPED: image row 0 is the TOP of the map, and the top is y = 1024.
    Verified empirically against live labels, not derived -- see verify_orientation.py.
    """
    ppu = pixels_per_unit(size)
    return (col + 0.5) / ppu, MAP_SPAN - (row + 0.5) / ppu


def map_to_pixel(x: float, y: float, size: int) -> tuple[int, int]:
    ppu = pixels_per_unit(size)
    row = int(round((MAP_SPAN - y) * ppu - 0.5))
    col = int(round(x * ppu - 0.5))
    return max(0, min(row, size - 1)), max(0, min(col, size - 1))
```

- [ ] **Schritt 4: Tests laufen lassen, alle grün**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v
```

Erwartet: 9 passed.

- [ ] **Schritt 5: Die Probe am echten Bestand als Befehl schreiben**

```python
# tools/ecosystem/verify_orientation.py
"""Proves the y flip against real tiles and a real map-features payload.

The unit test pins the arithmetic; this pins REALITY. Run it before every derivation run.
Expected (measured 2026-07-26, zoom 2, payload revision 40455):
    wald    0 / 68 on water      (unflipped:  7)  <- forests are not in the sea
    gebirge 1 / 60 on water      (unflipped: 25)
    meer   35 / 35 on water      (unflipped: 23)  <- seas are
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ecosystem_raster import assemble_tiles, map_to_pixel, water_mask, MAP_SPAN


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify the pixel<->map orientation against live labels.")
    parser.add_argument("--tiles", default=r"C:\GIT\avesmaps\tiles\stylized")
    parser.add_argument("--payload", required=True, help="A saved GET /api/app/map-features.php body.")
    parser.add_argument("--zoom", type=int, default=2)
    args = parser.parse_args()

    rgb = assemble_tiles(Path(args.tiles), args.zoom)
    size = rgb.shape[0]
    water = water_mask(rgb)

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    points: dict[str, list[tuple[float, float]]] = {}
    for feature in payload["features"]:
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if properties.get("feature_type") != "label" or geometry.get("type") != "Point":
            continue
        points.setdefault(properties.get("feature_subtype") or "?", []).append(tuple(geometry["coordinates"]))

    print(f"zoom {args.zoom}, {size}x{size} px, payload revision {payload.get('revision')}")
    print(f"{'subtype':12s} {'n':>4} {'flipped':>9} {'unflipped':>11}   verdict")
    failures = 0
    for subtype, expect_water in (("wald", False), ("gebirge", False), ("meer", True)):
        pts = points.get(subtype, [])
        flipped = sum(1 for x, y in pts if water[map_to_pixel(x, y, size)])
        unflipped = sum(1 for x, y in pts if water[map_to_pixel(x, MAP_SPAN - y, size)])
        ok = (flipped > unflipped) if expect_water else (flipped < unflipped)
        failures += 0 if ok else 1
        print(f"{subtype:12s} {len(pts):4d} {flipped:9d} {unflipped:11d}   {'OK' if ok else 'FAILED'}")

    if failures:
        raise SystemExit("orientation check FAILED -- do not run the derivation")
    print("orientation OK")


if __name__ == "__main__":
    main()
```

- [ ] **Schritt 6: Die Probe gegen den echten Bestand laufen lassen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python verify_orientation.py --payload "$SCRATCH/map-features.json" --zoom 2
```

Erwartet: `wald 0 vs 7`, `gebirge 1 vs 25`, `meer 35 vs 23`, Abschluss `orientation OK`.
Die Nutzlast wird **einmal** geholt (eine Anfrage, kein Schleifenbetrieb):
`curl -s -o map-features.json https://avesmaps.de/api/app/map-features.php`

- [ ] **Schritt 7: Commit**

```bash
git commit -m "feat(ecosystem): pixel<->map coordinates with a live orientation check" -- tools/ecosystem/ecosystem_raster.py tools/ecosystem/verify_orientation.py tools/ecosystem/test_ecosystem_v5.py
```

---

## Task 3: Komponente → Ring mit Löchern → vereinfachtes GeoJSON

**Files:**
- Create: `tools/ecosystem/ecosystem_shapes.py`
- Modify: `tools/ecosystem/test_ecosystem_v5.py`

**Interfaces:**
- Consumes: `pixel_to_map`, `pixels_per_unit` aus Task 2.
- Produces: `component_rings(component: np.ndarray) -> list[list[np.ndarray]]` (je Teil: äußerer Ring, dann Löcher, in Pixelkoordinaten);
  `simplify_ring(ring, ratio, floor_px=0.75) -> np.ndarray`;
  `build_geometry(parts, size, ratio, decimals=4) -> dict` (GeoJSON `Polygon` oder `MultiPolygon`, `[x, y]`, geschlossene Ringe).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```python
# append to tools/ecosystem/test_ecosystem_v5.py
from ecosystem_shapes import build_geometry, component_rings, simplify_ring


def square_with_hole():
    mask = np.zeros((64, 64), dtype=bool)
    mask[10:50, 10:50] = True
    mask[24:34, 24:34] = False        # a hole -> a lake inside an island
    return mask


def test_rings_find_the_hole():
    parts = component_rings(square_with_hole())
    assert len(parts) == 1, "one connected component"
    assert len(parts[0]) == 2, "an outer ring and one hole"


def test_simplify_reduces_a_square_to_its_corners():
    parts = component_rings(square_with_hole())
    simplified = simplify_ring(parts[0][0], ratio=0.004)
    assert len(simplified) == 4, f"a square simplifies to 4 corners, got {len(simplified)}"


def test_relative_epsilon_treats_a_small_shape_like_a_large_one():
    """🔴 The reason simplification is relative, not absolute. A big and a small blob of the
    SAME shape must end up with the SAME corner count -- an absolute epsilon would flatten the
    small one into a triangle (measured: Sigorast 200 raw corners -> 4 at absolute eps 1.0)."""
    def disc(radius: int) -> np.ndarray:
        size = radius * 4
        mask = np.zeros((size, size), dtype=np.uint8)
        cv2.circle(mask, (size // 2, size // 2), radius, 1, -1)
        return mask.astype(bool)

    small = simplify_ring(component_rings(disc(12))[0][0], ratio=0.004)
    large = simplify_ring(component_rings(disc(120))[0][0], ratio=0.004)
    assert abs(len(small) - len(large)) <= 4, (
        f"relative simplification must not depend on size: {len(small)} vs {len(large)}")


def test_geometry_is_closed_and_in_geojson_order():
    geometry = build_geometry(component_rings(square_with_hole()), size=512, ratio=0.004)
    assert geometry["type"] == "Polygon"
    outer = geometry["coordinates"][0]
    assert outer[0] == outer[-1], "GeoJSON rings must be closed"
    assert len(geometry["coordinates"]) == 2, "outer ring plus hole"
    xs = [p[0] for p in outer]
    ys = [p[1] for p in outer]
    # the mask sits at rows/cols 10..49 of a 64px image scaled to 512 -> 0.5 px per unit at size 512
    assert all(0.0 <= v <= 1024.0 for v in xs + ys), "every position must sit inside the map"
    assert max(ys) > min(ys), "y must vary -- a flat ring means the flip collapsed"


def test_multipart_becomes_multipolygon():
    mask = np.zeros((64, 64), dtype=bool)
    mask[5:15, 5:15] = True
    mask[40:50, 40:50] = True
    parts = component_rings(mask)
    geometry = build_geometry(parts, size=512, ratio=0.004)
    assert geometry["type"] == "MultiPolygon"
    assert len(geometry["coordinates"]) == 2


def test_positions_are_rounded_to_four_decimals():
    geometry = build_geometry(component_rings(square_with_hole()), size=512, ratio=0.004)
    for x, y in geometry["coordinates"][0]:
        assert x == round(x, 4) and y == round(y, 4)
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v -k "ring or geometry or multipart or rounded"
```

Erwartet: `ModuleNotFoundError: No module named 'ecosystem_shapes'`.

- [ ] **Schritt 3: Die Umsetzung schreiben**

```python
# tools/ecosystem/ecosystem_shapes.py
"""Raster component -> simplified GeoJSON ring (plan V5, question 2 and 3).

Technique borrowed from 27_polygonize_town_tiles.py in the neighbouring repo (findContours +
approxPolyDP). Two deliberate differences: that script writes PIXELS back into a tile and may
therefore jitter its polygons for looks; this one writes MAP COORDINATES into the database and
must not invent a single corner. And it uses RETR_CCOMP, not RETR_EXTERNAL, because a lake
inside an island is a hole, not a separate area.
"""
from __future__ import annotations

import cv2
import numpy as np

from ecosystem_raster import pixel_to_map, pixels_per_unit

MIN_RING_POSITIONS = 3          # api/_internal/app/ecosystem.php:414 refuses anything smaller
MIN_HOLE_AREA_PX = 16           # below this a "hole" is mask noise, not a lake
SIMPLIFY_FLOOR_PX = 0.75        # 27_polygonize_town_tiles.py:139 uses the same floor


def component_rings(component: np.ndarray) -> list[list[np.ndarray]]:
    """[[outer, hole, hole, ...], [outer, ...]] in pixel coordinates, one entry per part."""
    contours, hierarchy = cv2.findContours(
        component.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )
    if hierarchy is None:
        return []

    hierarchy = hierarchy[0]
    parts: list[list[np.ndarray]] = []
    index_of_outer: dict[int, int] = {}

    for index, (contour, node) in enumerate(zip(contours, hierarchy)):
        if node[3] != -1:                       # has a parent -> it is a hole
            continue
        if len(contour) < MIN_RING_POSITIONS:
            continue
        index_of_outer[index] = len(parts)
        parts.append([contour.reshape(-1, 2)])

    for index, (contour, node) in enumerate(zip(contours, hierarchy)):
        parent = node[3]
        if parent == -1 or parent not in index_of_outer:
            continue
        if len(contour) < MIN_RING_POSITIONS or cv2.contourArea(contour) < MIN_HOLE_AREA_PX:
            continue
        parts[index_of_outer[parent]].append(contour.reshape(-1, 2))

    parts.sort(key=lambda rings: -cv2.contourArea(rings[0].astype(np.int32)))
    return parts


def simplify_ring(ring: np.ndarray, ratio: float, floor_px: float = SIMPLIFY_FLOOR_PX) -> np.ndarray:
    """Douglas-Peucker with epsilon as a FRACTION OF THE RING'S OWN PERIMETER.

    🔴 Not an absolute epsilon. The shapes differ by a factor of 28 in perimeter (Maraskan 5602
    raw corners, the island Sigorast 200), so one absolute value cannot serve both: at eps = 1.0
    map units Maraskan keeps 126 corners while Sigorast collapses to 4 and the Angbarer See to a
    10-gon cutting across its own shore. Relative keeps every shape at a comparable corner count:
    at ratio 0.004 the same four shapes land at 46 / 28 / 37 / 34.

    Same arithmetic as 27_polygonize_town_tiles.py:139 in the neighbouring repo.
    """
    contour = ring.astype(np.int32)
    epsilon = max(cv2.arcLength(contour, True) * ratio, floor_px)
    simplified = cv2.approxPolyDP(contour, epsilon, True).reshape(-1, 2)
    return simplified if len(simplified) >= MIN_RING_POSITIONS else ring


def build_geometry(
    parts: list[list[np.ndarray]], size: int, ratio: float, decimals: int = 4
) -> dict:
    """GeoJSON Polygon / MultiPolygon in [x, y] order, every ring closed.

    🔴 [x, y], NOT swapped. Leaflet's L.CRS.Simple wants [lat, lng] = [y, x]; the swap happens in
    the CLIENT (js/map-features/map-features-ecosystem-rendering.js), never here and never in the
    database. api/_internal/app/ecosystem.php:396 says the same thing from the other side.
    """
    polygons: list[list[list[list[float]]]] = []
    for rings in parts:
        built: list[list[list[float]]] = []
        for ring in rings:
            simplified = simplify_ring(ring, ratio)
            positions = []
            for col, row in simplified:
                x, y = pixel_to_map(int(row), int(col), size)
                positions.append([round(x, decimals), round(y, decimals)])
            if len(positions) < MIN_RING_POSITIONS:
                continue
            if positions[0] != positions[-1]:
                positions.append(list(positions[0]))
            built.append(positions)
        if built:
            polygons.append(built)

    if not polygons:
        raise ValueError("component produced no usable ring")
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


def count_positions(geometry: dict) -> int:
    if geometry["type"] == "Polygon":
        return sum(len(ring) for ring in geometry["coordinates"])
    return sum(len(ring) for polygon in geometry["coordinates"] for ring in polygon)
```

- [ ] **Schritt 4: Tests laufen lassen, alle grün**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v
```

Erwartet: 14 passed.

- [ ] **Schritt 5: Commit**

```bash
git commit -m "feat(ecosystem): raster component to simplified GeoJSON rings, holes included" -- tools/ecosystem/ecosystem_shapes.py tools/ecosystem/test_ecosystem_v5.py
```

---

## Task 4: Label lesen und Komponenten zuordnen

**Files:**
- Create: `tools/ecosystem/ecosystem_labels.py`
- Modify: `tools/ecosystem/test_ecosystem_v5.py`

**Interfaces:**
- Consumes: `map_to_pixel`, `pixels_per_unit` aus Task 2.
- Produces: `LandscapeLabel` (dataclass: `name`, `subtype`, `x`, `y`, `wiki_url`, `public_id`);
  `read_labels(payload: dict, subtypes: set[str]) -> list[LandscapeLabel]`;
  `resolve(labels, component_labels, size, cap_units=8.0, exclude=None) -> tuple[dict[int, int], list[LandscapeLabel]]`
  (Abbildung Label-Index → Komponenten-Id, plus die nicht auflösbaren);
  `contested(assignment) -> dict[int, list[int]]` (Komponenten-Id → mehrere Label-Indizes);
  `REGION_KIND_BY_SUBTYPE: dict[str, str]`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```python
# append to tools/ecosystem/test_ecosystem_v5.py
from ecosystem_labels import (
    REGION_KIND_BY_SUBTYPE,
    LandscapeLabel,
    contested,
    read_labels,
    resolve,
)


def three_blob_scene():
    """A 512px image with three separate blobs; component ids come from OpenCV."""
    import cv2
    mask = np.zeros((512, 512), dtype=np.uint8)
    mask[100:140, 100:140] = 1        # blob A, map x~200 y~1024-240
    mask[100:140, 300:340] = 1        # blob B
    mask[400:440, 400:440] = 1        # blob C
    _, labels, _, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    return labels


def test_label_on_the_blob_resolves_at_radius_zero():
    labels = three_blob_scene()
    # pixel (120,120) at size 512 -> 0.5 px per unit -> x = 120.5/0.5 = 241, y = 1024 - 241
    point = LandscapeLabel("A", "insel", 241.0, 1024.0 - 241.0, "", "id-a")
    assignment, unresolved = resolve([point], labels, size=512)
    assert not unresolved and assignment[0] == labels[120, 120]


def test_label_beside_a_small_island_still_finds_it():
    """Only 14 of 95 island labels sit ON their island; the rest stand beside it, because the
    island is too small to hold the text. x = 285 lands at column 142 -- blob A ends at column
    139, so this point is genuinely OUTSIDE the blob, 3 px = 6 map units away."""
    labels = three_blob_scene()
    point = LandscapeLabel("A", "insel", 285.0, 1024.0 - 241.0, "", "id-a")
    assert labels[120, 142] == 0, "the fixture must place this point off the blob"
    assignment, unresolved = resolve([point], labels, size=512, cap_units=8.0)
    assert not unresolved and assignment[0] == labels[120, 120]


def test_label_beyond_the_cap_stays_unresolved():
    labels = three_blob_scene()
    point = LandscapeLabel("nowhere", "insel", 900.0, 900.0, "", "id-x")
    assignment, unresolved = resolve([point], labels, size=512, cap_units=8.0)
    assert not assignment and [u.name for u in unresolved] == ["nowhere"]


def test_two_labels_on_one_component_are_reported_not_resolved():
    labels = three_blob_scene()
    first = LandscapeLabel("A1", "insel", 241.0, 1024.0 - 241.0, "", "id-1")
    second = LandscapeLabel("A2", "insel", 243.0, 1024.0 - 243.0, "", "id-2")
    assignment, _ = resolve([first, second], labels, size=512)
    conflicts = contested(assignment)
    assert len(conflicts) == 1 and sorted(next(iter(conflicts.values()))) == [0, 1]


def test_excluded_component_is_never_claimed():
    """The mainland must not be handed to an island label standing on the coast."""
    labels = three_blob_scene()
    mainland = labels[120, 120]
    point = LandscapeLabel("A", "insel", 241.0, 1024.0 - 241.0, "", "id-a")
    assignment, unresolved = resolve([point], labels, size=512, exclude=mainland)
    assert not assignment and unresolved


def test_subtype_maps_to_the_seeded_kind():
    assert REGION_KIND_BY_SUBTYPE == {
        "see": "topographie",
        "insel": "derographisch",
        "kontinent": "derographisch",
        "kueste": "topographie",
        "wueste": "vegetation",
    }


def test_land_and_water_never_share_a_kind():
    """🔴 An island and the water around it share the same pixel edge. If both ended up in the
    same kind, two areas with the same outline would sit in the same Leaflet pane and nobody
    could tell them apart. Land is derographisch, water is topographie -- always."""
    land_kinds = {REGION_KIND_BY_SUBTYPE[s] for s in ("insel", "kontinent")}
    water_kinds = {REGION_KIND_BY_SUBTYPE[s] for s in ("see", "kueste")}
    assert land_kinds == {"derographisch"}
    assert water_kinds == {"topographie"}
    assert not (land_kinds & water_kinds)


def test_read_labels_keeps_only_points_of_the_wanted_subtypes():
    payload = {"features": [
        {"properties": {"feature_type": "label", "feature_subtype": "see", "name": "L",
                        "wiki_url": "https://example.invalid/wiki/L", "public_id": "p1"},
         "geometry": {"type": "Point", "coordinates": [10.0, 20.0]}},
        {"properties": {"feature_type": "label", "feature_subtype": "wald", "name": "W",
                        "public_id": "p2"},
         "geometry": {"type": "Point", "coordinates": [1.0, 2.0]}},
        {"properties": {"feature_type": "location", "feature_subtype": "see", "name": "X",
                        "public_id": "p3"},
         "geometry": {"type": "Point", "coordinates": [3.0, 4.0]}},
    ]}
    found = read_labels(payload, {"see"})
    assert [label.name for label in found] == ["L"]
    assert found[0].x == 10.0 and found[0].y == 20.0 and found[0].public_id == "p1"
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v -k "label or resolve or subtype or contested or excluded"
```

Erwartet: `ModuleNotFoundError: No module named 'ecosystem_labels'`.

- [ ] **Schritt 3: Die Umsetzung schreiben**

```python
# tools/ecosystem/ecosystem_labels.py
"""Existing map labels drive the derivation (plan V5, question 2c).

🔴 Names and wiki links are NEVER invented. They come from the map_features label row, and a
component that no label claims never becomes an area. That rule does two jobs at once: it answers
"what is this shape called" and it filters out the rivers -- measured at zoom 2, 867 of 874 water
components do not touch the border, and most of them are rivers, not lakes.

Direction matters: every LABEL searches outward for its component, not the other way round.
Measured on the live payload: forward search resolves 91-93 of 95 island labels; the inverse
(each component takes its nearest label by centroid distance) resolves only 61 -- the centroid of a
large island is further from an edge-placed label than any sane cap.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ecosystem_raster import map_to_pixel, pixels_per_unit

# The seeded vocabulary of ecosystem_region_type (api/_internal/app/ecosystem.php:68).
# Nothing here is invented: every key is an existing map_features label subtype AND a seeded
# region_type of exactly this kind.
REGION_KIND_BY_SUBTYPE: dict[str, str] = {
    "see": "topographie",
    "insel": "derographisch",
    "kontinent": "derographisch",
    "kueste": "topographie",
    "wueste": "vegetation",
}


@dataclass(frozen=True)
class LandscapeLabel:
    name: str
    subtype: str
    x: float
    y: float
    wiki_url: str
    public_id: str


def read_labels(payload: dict, subtypes: set[str]) -> list[LandscapeLabel]:
    found: list[LandscapeLabel] = []
    for feature in payload.get("features", []):
        properties = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        if properties.get("feature_type") != "label":
            continue
        if properties.get("feature_subtype") not in subtypes:
            continue
        if geometry.get("type") != "Point":
            continue
        x, y = geometry["coordinates"][0], geometry["coordinates"][1]
        found.append(LandscapeLabel(
            name=(properties.get("name") or "").strip(),
            subtype=properties["feature_subtype"],
            x=float(x),
            y=float(y),
            wiki_url=(properties.get("wiki_url") or "").strip(),
            public_id=(properties.get("public_id") or "").strip(),
        ))
    return found


def resolve(
    labels: list[LandscapeLabel],
    component_labels: np.ndarray,
    size: int,
    cap_units: float = 8.0,
    exclude: int | None = None,
) -> tuple[dict[int, int], list[LandscapeLabel]]:
    """label index -> component id, plus the labels that found nothing within cap_units."""
    cap = int(round(cap_units * pixels_per_unit(size)))
    height, width = component_labels.shape
    assignment: dict[int, int] = {}
    unresolved: list[LandscapeLabel] = []

    for index, label in enumerate(labels):
        row, col = map_to_pixel(label.x, label.y, size)
        top, bottom = max(0, row - cap), min(height, row + cap + 1)
        left, right = max(0, col - cap), min(width, col + cap + 1)
        window = component_labels[top:bottom, left:right].copy()
        if exclude is not None:
            window[window == exclude] = 0

        rows, cols = np.nonzero(window)
        if rows.size == 0:
            unresolved.append(label)
            continue
        distance = (rows + top - row) ** 2 + (cols + left - col) ** 2
        nearest = int(np.argmin(distance))
        assignment[index] = int(window[rows[nearest], cols[nearest]])

    return assignment, unresolved


def contested(assignment: dict[int, int]) -> dict[int, list[int]]:
    """component id -> the label indices fighting over it. Reported, never auto-resolved:
    which of five archipelago names owns the one shape is an editorial question."""
    by_component: dict[int, list[int]] = {}
    for label_index, component in assignment.items():
        by_component.setdefault(component, []).append(label_index)
    return {component: indices for component, indices in by_component.items() if len(indices) > 1}
```

- [ ] **Schritt 4: Tests laufen lassen, alle grün**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v
```

Erwartet: 21 passed.

- [ ] **Schritt 5: Commit**

```bash
git commit -m "feat(ecosystem): labels claim raster components, contested ones are reported" -- tools/ecosystem/ecosystem_labels.py tools/ecosystem/test_ecosystem_v5.py
```

---

## Task 5: Der Ableitungslauf — Manifest und Bericht

**Files:**
- Create: `tools/ecosystem/derive_areas.py`
- Modify: `tools/ecosystem/test_ecosystem_v5.py`

**Interfaces:**
- Consumes: alles aus Task 1–4.
- Produces: `manifest.json` mit `{"generated_for_revision": int, "zoom": int, "simplify_ratio": float,
  "blue_over_green": int, "entries": [{ "name", "subtype", "kind", "region_type", "wiki_url",
  "label_public_id", "geometry", "position_count", "component_area_px" }], "contested": [...],
  "unresolved": [...]}` und `report.md`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```python
# append to tools/ecosystem/test_ecosystem_v5.py
from derive_areas import build_manifest


def test_manifest_entry_carries_label_identity_and_no_wiki_key():
    """🔴 wiki_region_key is derived server-side (api/_internal/app/ecosystem.php:688).
    A manifest that ships one would be a second, divergent key derivation."""
    import cv2
    mask = np.zeros((512, 512), dtype=np.uint8)
    mask[100:140, 100:140] = 1
    _, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    label = LandscapeLabel("Testinsel", "insel", 241.0, 1024.0 - 241.0,
                           "https://de.wiki-aventurica.de/wiki/Testinsel", "label-1")

    manifest = build_manifest([label], components, stats, size=512, simplify_ratio=0.004,
                              zoom=1, revision=40455, blue_over_green=-20)

    assert len(manifest["entries"]) == 1
    entry = manifest["entries"][0]
    assert entry["name"] == "Testinsel"
    assert entry["kind"] == "derographisch" and entry["region_type"] == "insel"
    assert entry["wiki_url"].endswith("/Testinsel")
    assert entry["label_public_id"] == "label-1"
    assert "wiki_region_key" not in entry, "the key belongs to the server, never to the manifest"
    assert entry["geometry"]["type"] == "Polygon"
    assert entry["position_count"] >= 4


def test_manifest_skips_contested_components():
    import cv2
    mask = np.zeros((512, 512), dtype=np.uint8)
    mask[100:140, 100:140] = 1
    _, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    first = LandscapeLabel("A1", "insel", 241.0, 1024.0 - 241.0, "", "l1")
    second = LandscapeLabel("A2", "insel", 243.0, 1024.0 - 243.0, "", "l2")

    manifest = build_manifest([first, second], components, stats, size=512, simplify_ratio=0.004,
                              zoom=1, revision=1, blue_over_green=-20)

    assert manifest["entries"] == []
    assert len(manifest["contested"]) == 1
    assert sorted(manifest["contested"][0]["names"]) == ["A1", "A2"]


def test_manifest_records_the_settings_it_was_built_with():
    import cv2
    mask = np.zeros((512, 512), dtype=np.uint8)
    mask[100:140, 100:140] = 1
    _, components, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    manifest = build_manifest([], components, stats, size=512, simplify_ratio=0.008,
                              zoom=3, revision=40455, blue_over_green=-20)
    assert manifest["simplify_ratio"] == 0.008
    assert manifest["zoom"] == 3
    assert manifest["blue_over_green"] == -20
    assert manifest["generated_for_revision"] == 40455
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v -k manifest
```

Erwartet: `ModuleNotFoundError: No module named 'derive_areas'`.

- [ ] **Schritt 3: Die Umsetzung schreiben**

```python
# tools/ecosystem/derive_areas.py
"""Derive Landschaften areas from the deployed map tiles (plan V5).

Writes a manifest and a report. It NEVER touches the database and needs no credentials --
import_areas.py does that, separately and on the owner's trigger.

Run:
    python derive_areas.py --payload map-features.json --out manifest.json --report report.md
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from ecosystem_labels import REGION_KIND_BY_SUBTYPE, LandscapeLabel, contested, read_labels, resolve
from ecosystem_raster import WATER_BLUE_OVER_GREEN, assemble_tiles, split_water, water_mask
from ecosystem_shapes import build_geometry, component_rings, count_positions

WATER_SUBTYPES = {"see"}
LAND_SUBTYPES = {"insel"}


def build_manifest(
    labels: list[LandscapeLabel],
    components: np.ndarray,
    stats: np.ndarray,
    size: int,
    simplify_ratio: float,
    zoom: int,
    revision: int,
    blue_over_green: int,
    exclude: int | None = None,
) -> dict:
    assignment, unresolved = resolve(labels, components, size, exclude=exclude)
    conflicts = contested(assignment)

    entries = []
    for label_index, component_id in sorted(assignment.items()):
        if component_id in conflicts:
            continue
        label = labels[label_index]
        left = int(stats[component_id, cv2.CC_STAT_LEFT])
        top = int(stats[component_id, cv2.CC_STAT_TOP])
        width = int(stats[component_id, cv2.CC_STAT_WIDTH])
        height = int(stats[component_id, cv2.CC_STAT_HEIGHT])
        window = components[top:top + height, left:left + width] == component_id

        padded = np.zeros((height + 2, width + 2), dtype=bool)
        padded[1:-1, 1:-1] = window          # 1px frame so a border-touching shape keeps its ring
        parts = component_rings(padded)
        if not parts:
            continue
        shifted = [[ring + np.array([left - 1, top - 1]) for ring in rings] for rings in parts]

        try:
            geometry = build_geometry(shifted, size, simplify_ratio)
        except ValueError:
            continue

        entries.append({
            "name": label.name,
            "subtype": label.subtype,
            "kind": REGION_KIND_BY_SUBTYPE[label.subtype],
            "region_type": label.subtype,
            "wiki_url": label.wiki_url,
            "label_public_id": label.public_id,
            "geometry": geometry,
            "position_count": count_positions(geometry),
            "component_area_px": int(stats[component_id, cv2.CC_STAT_AREA]),
        })

    return {
        "generated_for_revision": revision,
        "zoom": zoom,
        "simplify_ratio": simplify_ratio,
        "blue_over_green": blue_over_green,
        "entries": entries,
        "contested": [
            {"component": component,
             "names": [labels[i].name for i in indices],
             "label_public_ids": [labels[i].public_id for i in indices]}
            for component, indices in sorted(conflicts.items())
        ],
        "unresolved": [{"name": label.name, "subtype": label.subtype} for label in unresolved],
    }


def write_report(path: Path, manifest: dict) -> None:
    entries = manifest["entries"]
    counts = [entry["position_count"] for entry in entries] or [0]
    by_subtype: dict[str, int] = {}
    for entry in entries:
        by_subtype[entry["subtype"]] = by_subtype.get(entry["subtype"], 0) + 1

    lines = [
        "# Landschaften V5 -- Ableitungsbericht",
        "",
        f"- Zoom: {manifest['zoom']}  (Kartenaufloesung {4 * 2 ** manifest['zoom'] * 256} px)",
        f"- Vereinfachung: epsilon = Umfang x {manifest['simplify_ratio']}",
        f"- Wasserschwelle: B >= G {manifest['blue_over_green']:+d}",
        f"- Nutzlast-Revision: {manifest['generated_for_revision']}",
        "",
        f"**{len(entries)} Flaechen abgeleitet**  "
        + ", ".join(f"{key}: {value}" for key, value in sorted(by_subtype.items())),
        "",
        "Je Ebene (Land und Wasser muessen getrennt bleiben, global constraint 4a):",
        "",
    ]
    by_kind: dict[str, int] = {}
    for entry in entries:
        by_kind[entry["kind"]] = by_kind.get(entry["kind"], 0) + 1
    for kind, value in sorted(by_kind.items()):
        lines.append(f"- {kind}: {value}")
    lines += [
        "",
        f"- Ecken je Flaeche: Median {int(np.median(counts))}, "
        f"p90 {int(np.percentile(counts, 90))}, max {max(counts)}, Summe {sum(counts)}",
        f"- Vergleichsmass Baronie-Dichte (live gemessen): Median 49, p90 85, max 147",
        "",
        f"## Umstritten -- NICHT importiert ({len(manifest['contested'])})",
        "",
    ]
    for conflict in manifest["contested"]:
        lines.append(f"- eine Form, {len(conflict['names'])} Namen: {', '.join(conflict['names'])}")
    lines += ["", f"## Ohne Komponente ({len(manifest['unresolved'])})", ""]
    for item in manifest["unresolved"]:
        lines.append(f"- {item['name']} ({item['subtype']})")
    lines += ["", "## Die groessten Flaechen", ""]
    for entry in sorted(entries, key=lambda e: -e["position_count"])[:15]:
        lines.append(f"- {entry['name']} ({entry['subtype']}): {entry['position_count']} Ecken")

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Derive Landschaften areas from the map tiles.")
    parser.add_argument("--tiles", default=r"C:\GIT\avesmaps\tiles\stylized")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--zoom", type=int, default=3)
    parser.add_argument("--simplify-ratio", type=float, default=0.004,
                        help="Douglas-Peucker epsilon as a fraction of each ring's own perimeter.")
    parser.add_argument("--blue-over-green", type=int, default=WATER_BLUE_OVER_GREEN)
    parser.add_argument("--only", nargs="+", default=None, help="Restrict to these label names.")
    parser.add_argument("--out", default="manifest.json")
    parser.add_argument("--report", default="report.md")
    args = parser.parse_args()

    payload = json.loads(Path(args.payload).read_text(encoding="utf-8"))
    revision = int(payload.get("revision") or 0)

    rgb = assemble_tiles(Path(args.tiles), args.zoom)
    size = rgb.shape[0]
    _, lake, land = split_water(water_mask(rgb, blue_over_green=args.blue_over_green))

    _, lake_components, lake_stats, _ = cv2.connectedComponentsWithStats(
        lake.astype(np.uint8), connectivity=8)
    land_count, land_components, land_stats, _ = cv2.connectedComponentsWithStats(
        land.astype(np.uint8), connectivity=8)
    mainland = 1 + int(np.argmax([land_stats[i, cv2.CC_STAT_AREA] for i in range(1, land_count)]))

    def pick(labels: list[LandscapeLabel]) -> list[LandscapeLabel]:
        if not args.only:
            return labels
        wanted = set(args.only)
        return [label for label in labels if label.name in wanted]

    water_manifest = build_manifest(
        pick(read_labels(payload, WATER_SUBTYPES)), lake_components, lake_stats,
        size, args.simplify_ratio, args.zoom, revision, args.blue_over_green)
    land_manifest = build_manifest(
        pick(read_labels(payload, LAND_SUBTYPES)), land_components, land_stats,
        size, args.simplify_ratio, args.zoom, revision, args.blue_over_green, exclude=mainland)

    manifest = water_manifest
    manifest["entries"] += land_manifest["entries"]
    manifest["contested"] += land_manifest["contested"]
    manifest["unresolved"] += land_manifest["unresolved"]

    Path(args.out).write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(Path(args.report), manifest)
    print(f"{len(manifest['entries'])} areas -> {args.out}")
    print(f"{len(manifest['contested'])} contested, {len(manifest['unresolved'])} unresolved")


if __name__ == "__main__":
    main()
```

- [ ] **Schritt 4: Tests laufen lassen, alle grün**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v
```

Erwartet: 24 passed.

- [ ] **Schritt 5: Den echten Lauf ausführen und die Zahlen gegen die Messung prüfen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python derive_areas.py --payload "$SCRATCH/map-features.json" --zoom 3 --simplify-ratio 0.004 --out "$SCRATCH/manifest.json" --report "$SCRATCH/report.md"
```

Erwartet, gegen die Vorabmessung vom 2026-07-26 bei genau dieser Einstellung
(z3, `B ≥ G−20`, Umfang × 0,004):

| | erwartet |
|---|---:|
| Flächen im Manifest | **122** (42 `see` + 80 `insel`) |
| umstrittene Formen | **7** (1 `see` + 6 `insel`) |
| ohne Komponente | **5** (2 `see` + 3 `insel`), darunter Cichanebi-Salzsee, Al'Birkabrah, Zyklopeninseln, Olportsteine |
| Ecken je Fläche | Median in der Größenordnung **10–16**, weit unter der Baronie-Dichte (Median 49) |

🔴 **Weicht die Zahl der Flächen um mehr als ±5 ab, nicht weitermachen.** Dann stimmt eine
Annahme nicht, und Aufgabe 6 würde einen falschen Entwurf zeigen. Ebenso, wenn der Median der
Ecken über 49 liegt — dann ist ε zu klein geraten und die Flächen sind feiner als eine Baronie.

- [ ] **Schritt 6: Commit**

```bash
git commit -m "feat(ecosystem): derive lake and island areas from the deployed tiles into a manifest" -- tools/ecosystem/derive_areas.py tools/ecosystem/test_ecosystem_v5.py
```

---

## Task 6: ⭐ Der Entwurf — drei bis fünf Umrisse auf der Karte, VOR dem Import

**Files:**
- Create: `verify-ecosystem-v5-entwurf.html`

> ⭐ **Das ist das Tor, nicht eine Formalität.** „Ein Massenimport in falscher
> Vereinfachungsstufe ist teurer rückgängig zu machen als noch einmal zu rechnen."
> Es wird **nichts** in die Datenbank geschrieben, bis der Owner diesen Entwurf gesehen hat.

**Interfaces:**
- Consumes: `manifest.json` aus Task 5.

- [ ] **Schritt 1: Fünf Fälle auswählen und als kleines Manifest ausschneiden**

Nicht die fünf schönsten, sondern die fünf, die etwas beweisen:

| # | Fall | was er zeigt |
|---|---|---|
| 1 | **Angbarer See** (`see`, Labelpunkt direkt drauf) | der einfache Normalfall |
| 2 | **Ochsenwasser** (`see`, 830 Rohecken, mit angehängtem Flussarm) | ob die Vereinfachung bei einer zerklüfteten Form am Ufer bleibt |
| 3 | **Maraskan** (`insel`, große Insel mit Binnenstruktur) | ob Löcher und Küstenlinie stimmen |
| 4 | **Sigorast** (`insel`, aus Archipel A) | ob die Schwellen-Korrektur die Nachbarinsel wirklich abtrennt |
| 5 | **Buli** (`insel`, winzig, Label steht daneben) | ob die Vorwärtssuche die richtige Kleininsel greift |

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python derive_areas.py --payload "$SCRATCH/map-features.json" --zoom 3 --simplify-ratio 0.004 --only "Angbarer See" "Ochsenwasser" "Maraskan" "Sigorast" "Buli" --out "$SCRATCH/entwurf.json" --report "$SCRATCH/entwurf.md"
```

- [ ] **Schritt 2: Die Vorschauseite schreiben**

```html
<!-- verify-ecosystem-v5-entwurf.html -- local draft review, never deployed. -->
<!doctype html>
<meta charset="utf-8">
<title>Landschaften V5 — Entwurf</title>
<link rel="stylesheet" href="js/third-party/leaflet/leaflet.css">
<style>
  html, body { margin: 0; height: 100%; background: #1b1512; color: #efe6d8;
               font: 14px/1.5 system-ui, sans-serif; }
  #map { position: absolute; inset: 0 320px 0 0; }
  #side { position: absolute; inset: 0 0 0 auto; width: 320px; overflow: auto; padding: 12px 14px; }
  h1 { font-size: 15px; margin: 0 0 10px; }
  button { display: block; width: 100%; margin: 4px 0; padding: 6px; cursor: pointer; }
  .num { font-variant-numeric: tabular-nums; }
</style>
<div id="map"></div>
<div id="side"><h1>V5-Entwurf</h1><div id="list"></div><pre id="meta"></pre></div>
<script src="js/third-party/leaflet/leaflet.js"></script>
<script>
const map = L.map("map", { crs: L.CRS.Simple, minZoom: 0, maxZoom: 7 }).setView([500, 520], 3);
L.tileLayer("tiles/stylized/{z}/map_{x}_{y}.webp", { tileSize: 256, minZoom: 0, maxZoom: 7,
  maxNativeZoom: 5, noWrap: true, bounds: [[0, 0], [1024, 1024]] }).addTo(map);

// 🔴 GeoJSON is [x, y]; L.CRS.Simple wants [lat, lng] = [y, x]. The swap happens HERE and only here.
const swap = ring => ring.map(([x, y]) => [y, x]);
const toLatLngs = g => g.type === "Polygon" ? g.coordinates.map(swap)
                                            : g.coordinates.map(p => p.map(swap));

fetch("entwurf.json").then(r => r.json()).then(manifest => {
  document.getElementById("meta").textContent =
    `zoom ${manifest.zoom}\nUmfang x ${manifest.simplify_ratio}\nB>=G ${manifest.blue_over_green}`;
  const list = document.getElementById("list");
  manifest.entries.forEach(entry => {
    const layer = L.polygon(toLatLngs(entry.geometry), {
      color: "#d8a441", weight: 2, fillColor: "#d8a441", fillOpacity: 0.28
    }).addTo(map).bindTooltip(`${entry.name} — ${entry.position_count} Ecken`);
    const button = document.createElement("button");
    button.innerHTML = `${entry.name}<br><span class="num">${entry.position_count} Ecken · ${entry.component_area_px} px</span>`;
    button.onclick = () => map.fitBounds(layer.getBounds(), { padding: [40, 40] });
    list.appendChild(button);
  });
});
</script>
```

- [ ] **Schritt 3: Die Vorschau öffnen und die fünf Umrisse ansehen**

`entwurf.json` neben die HTML-Datei legen, dann über den lokalen Vorschau-Server öffnen
(`preview_start`), nicht per `file://` — `fetch` scheitert sonst an der Herkunftsregel.
Auf jeden der fünf Knöpfe klicken und mit der Kachel darunter vergleichen.

- [ ] **Schritt 4: Nachweis erzeugen — je ein Bildschirmfoto der fünf Fälle**

Fünf Aufnahmen, jede mit dem Umriss auf der echten Kachel. Sie sind der Beleg, der dem Owner
gezeigt wird — **nicht** eine Beschreibung dessen, was zu sehen wäre.

- [ ] **Schritt 5: 🔧 DU (Owner): Abnahme der Vereinfachungsstufe**

Drei mögliche Antworten, alle billig:

| Antwort | was passiert |
|---|---|
| „passt" | weiter zu Aufgabe 7 |
| „zu grob" | `--simplify-ratio 0.002` und Aufgabe 6 wiederholen (Rechenzeit ~3 min, kein Rückbau) |
| „zu fein" | `--simplify-ratio 0.008` und Aufgabe 6 wiederholen |

🔴 **Vor dieser Abnahme wird nichts importiert.**

- [ ] **Schritt 6: Commit**

```bash
git commit -m "feat(ecosystem): local draft preview for the V5 derivation before any import" -- verify-ecosystem-v5-entwurf.html
```

---

## Task 7: Der Import — ein Lauf, gedrosselt, wiederaufsetzbar

**Files:**
- Create: `tools/ecosystem/import_areas.py`
- Modify: `tools/ecosystem/test_ecosystem_v5.py`

**Interfaces:**
- Consumes: `manifest.json` aus Task 5, abgenommen in Aufgabe 6.
- Produces: `state.json` (`{"<label_public_id>": {"region_public_id": "…", "area_public_id": "…"}}`).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```python
# append to tools/ecosystem/test_ecosystem_v5.py
from import_areas import build_requests, pending_entries


def sample_entry():
    return {
        "name": "Angbarer See", "subtype": "see", "kind": "topographie", "region_type": "see",
        "wiki_url": "https://de.wiki-aventurica.de/wiki/Angbarer_See",
        "label_public_id": "label-42",
        "geometry": {"type": "Polygon", "coordinates": [[[1.0, 2.0], [3.0, 2.0], [3.0, 4.0], [1.0, 2.0]]]},
        "position_count": 4, "component_area_px": 900,
    }


def test_region_request_sends_wiki_url_and_never_a_key():
    region, area = build_requests(sample_entry())
    assert region["action"] == "create_region"
    assert region["kind"] == "topographie" and region["region_type"] == "see"
    assert region["wiki_url"].endswith("/Angbarer_See")
    assert region["label_public_id"] == "label-42"
    assert "wiki_region_key" not in region, "the server derives it (ecosystem.php:636)"
    assert area["action"] == "create_area"


def test_area_request_states_is_trial_false_explicitly():
    """Otherwise create_area falls back to app_setting['ecosystem_trial'] (ecosystem.php:960)
    and the import would depend on whether the owner already ran promote_trial."""
    _, area = build_requests(sample_entry())
    assert area["is_trial"] is False


def test_empty_wiki_url_is_omitted_not_sent_empty():
    entry = sample_entry() | {"wiki_url": ""}
    region, _ = build_requests(entry)
    assert "wiki_url" not in region, "19 of 149 labels have none -- an empty string is not a URL"


def test_already_imported_entries_are_skipped():
    state = {"label-42": {"region_public_id": "r1", "area_public_id": "a1"}}
    assert pending_entries([sample_entry()], state) == []
    assert len(pending_entries([sample_entry()], {})) == 1


def test_half_finished_entry_resumes_at_the_area():
    state = {"label-42": {"region_public_id": "r1"}}
    pending = pending_entries([sample_entry()], state)
    assert len(pending) == 1, "a region without its area must be finished, not skipped"
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v -k "request or imported or resumes or wiki_url_is_omitted"
```

Erwartet: `ModuleNotFoundError: No module named 'import_areas'`.

- [ ] **Schritt 3: Die Umsetzung schreiben**

```python
# tools/ecosystem/import_areas.py
"""Import a derived manifest through the EXISTING ecosystem write endpoint (plan V5, question 4).

🔴 No new endpoint, no direct SQL, no bulk verb. Two ordinary calls per landscape:
create_region, then create_area -- exactly what a human editor's client sends.

🔴 149 areas are not a loop against STRATO (AGENTS.md, Claude notes). One run, throttled
(--delay, default 1.0 s), resumable through a state file. --dry-run is the DEFAULT; the real
run needs --commit.

🔧 The session cookie comes from a file the owner provides. This script never asks for
credentials and contains none.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = "/api/edit/map/ecosystem.php"


def build_requests(entry: dict) -> tuple[dict, dict]:
    """(create_region payload, create_area payload without region_public_id)."""
    region = {
        "action": "create_region",
        "kind": entry["kind"],
        "region_type": entry["region_type"],
        "name": entry["name"],
        "label_public_id": entry["label_public_id"],
    }
    if entry.get("wiki_url"):
        region["wiki_url"] = entry["wiki_url"]

    area = {
        "action": "create_area",
        "geometry_geojson": entry["geometry"],
        # Explicit, so the import does not depend on app_setting['ecosystem_trial'].
        "is_trial": False,
    }
    return region, area


def pending_entries(entries: list[dict], state: dict) -> list[dict]:
    pending = []
    for entry in entries:
        done = state.get(entry["label_public_id"]) or {}
        if done.get("area_public_id"):
            continue
        pending.append(entry)
    return pending


def post(base_url: str, cookie: str, payload: dict, timeout: float) -> dict:
    request = urllib.request.Request(
        base_url.rstrip("/") + ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Cookie": cookie},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"HTTP {error.code} on {payload['action']}: {body}") from error


def main() -> None:
    parser = argparse.ArgumentParser(description="Import derived Landschaften areas, throttled.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--base-url", default="https://avesmaps.de")
    parser.add_argument("--cookie-file", help="File holding the editor session Cookie header.")
    parser.add_argument("--state", default="import-state.json")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between two writes.")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--limit", type=int, default=0, help="Stop after N areas (0 = all).")
    parser.add_argument("--commit", action="store_true", help="Actually write. Default is a dry run.")
    args = parser.parse_args()

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    state_path = Path(args.state)
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.is_file() else {}

    todo = pending_entries(manifest["entries"], state)
    if args.limit:
        todo = todo[:args.limit]

    print(f"{len(manifest['entries'])} in manifest, {len(todo)} to write, "
          f"{'COMMIT' if args.commit else 'DRY RUN'}, delay {args.delay}s")
    if not args.commit:
        for entry in todo[:10]:
            region, _ = build_requests(entry)
            print(f"  would create: {region['kind']}/{region['region_type']} "
                  f"{region['name']!r} ({entry['position_count']} positions)")
        print("  ... (--commit to write)")
        return

    cookie = Path(args.cookie_file).read_text(encoding="utf-8").strip()
    for index, entry in enumerate(todo, start=1):
        key = entry["label_public_id"]
        done = state.get(key) or {}
        region_payload, area_payload = build_requests(entry)

        if not done.get("region_public_id"):
            result = post(args.base_url, cookie, region_payload, args.timeout)
            done["region_public_id"] = result["region"]["public_id"]
            state[key] = done
            state_path.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
            time.sleep(args.delay)

        area_payload["region_public_id"] = done["region_public_id"]
        result = post(args.base_url, cookie, area_payload, args.timeout)
        done["area_public_id"] = result["area"]["public_id"]
        state[key] = done
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")

        print(f"[{index}/{len(todo)}] {entry['name']} -> revision {result.get('revision')}")
        time.sleep(args.delay)

    print("done")


if __name__ == "__main__":
    main()
```

- [ ] **Schritt 4: Tests laufen lassen, alle grün**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python -m pytest test_ecosystem_v5.py -v
```

Erwartet: 29 passed.

- [ ] **Schritt 5: Trockenlauf ansehen**

```bash
cd C:/GIT/avesmaps/.claude/worktrees/landschaften-v5/tools/ecosystem && python import_areas.py --manifest "$SCRATCH/manifest.json"
```

Erwartet: `122 in manifest, 122 to write, DRY RUN` und zehn Beispielzeilen. Kein Netzverkehr.

- [ ] **Schritt 6: 🔧 DU (Owner): der scharfe Lauf**

Erst eine kleine Probe, dann der Rest — nie beides in einem Rutsch:

```bash
python import_areas.py --manifest manifest.json --cookie-file cookie.txt --commit --limit 3
```

Drei Flächen, im Editor unter `?landschaften=1` ansehen. Erst dann:

```bash
python import_areas.py --manifest manifest.json --cookie-file cookie.txt --commit
```

Nach dem Lauf prüfen, dass **`map_revision` unverändert** ist (V4-Messung §4.3, ein einzelner
`If-None-Match`-Aufruf, kein Schleifenbetrieb):

```bash
curl -s -o /dev/null -D - -H 'If-None-Match: W/"mf-8-40455-3eb416223e"' -w "http=%{http_code}\n" "https://avesmaps.de/api/app/map-features.php"
```

**304 = Regel 3 hält.** (Den ETag vorher frisch holen, falls fremde Editorarbeit ihn
zwischenzeitlich gedreht hat.)

- [ ] **Schritt 7: Commit**

```bash
git commit -m "feat(ecosystem): throttled, resumable import of derived areas through the existing write endpoint" -- tools/ecosystem/import_areas.py tools/ecosystem/test_ecosystem_v5.py
```

---

## Task 8: Dokumentation und Abschluss

**Files:**
- Create: `tools/ecosystem/README.md`
- Modify: `docs/stylized-map-tiles.md`
- Modify: `docs/superpowers/plans/2026-07-24-landschaften.md`

- [ ] **Schritt 1: `tools/ecosystem/README.md` schreiben**

Inhalt, knapp: der Ablauf in vier Befehlen (Nutzlast holen → `verify_orientation.py` →
`derive_areas.py` → `import_areas.py`), die drei Grenzwerte mit ihren gemessenen Vorgaben
(`--zoom 3`, `--simplify-ratio 0.004`, `--blue-over-green -20`) und **je einem Satz, warum**, plus der
Hinweis, dass `import_areas.py` ohne `--commit` nichts tut und eine Owner-Sitzung braucht.

- [ ] **Schritt 2: `docs/stylized-map-tiles.md` um einen Abschnitt ergänzen**

Ein Abschnitt „Landschaftsflächen aus den Kacheln ableiten" mit dem Verweis auf
`tools/ecosystem/` und **dem einen Satz, der später Zeit spart:** die Kacheln sind nicht nur
Anzeige, sie sind die Datenquelle der Landschaftsebene — wer sie neu baut, macht die
abgeleiteten Flächen um seine Änderung falsch.

- [ ] **Schritt 3: Die V5-Zeile im Hauptplan abhaken**

In `docs/superpowers/plans/2026-07-24-landschaften.md` die V5-Zeile der „Danach"-Tabelle auf
✅ setzen, mit der **tatsächlich** erreichten Zahl (nicht 149), und die drei nicht ableitbaren
Klassen (`kueste`, `wueste`, `kontinent`) als Handarbeit benennen.

- [ ] **Schritt 4: Prüfen, dass keine politische Datei angefasst wurde**

```bash
git diff --name-only origin/master...HEAD
```

Erwartet: nur `tools/ecosystem/*`, `verify-ecosystem-v5-entwurf.html`, `docs/*`.
Kein `js/map-features/map-features-region-*`, kein `js/territory/*`, kein `api/_internal/political/*`.

- [ ] **Schritt 5: Commit**

```bash
git commit -m "docs(ecosystem): document the V5 tile derivation and tick it off in the plan" -- tools/ecosystem/README.md docs/stylized-map-tiles.md docs/superpowers/plans/2026-07-24-landschaften.md
```

---

## Nicht Gegenstand dieses Vorhabens

Ausdrücklich benannt, damit es nicht hineinwächst:

- **`meer` (35 Labels)** — der Hauptplan nennt sie „Schneidearbeit". Das Ozeanpolygon ist die
  Umkehrung des Kontinents; es in 35 benannte Meere zu zerschneiden braucht Grenzen, die im
  Raster nicht existieren. Eigenes Vorhaben.
- **`gebirge` (60 Labels)** — „Startumriss" laut Hauptplan. Ein Gebirge ist keine Farbfläche,
  sondern Relief; das ist **V8** (Höhenfeld), nicht V5.

> 📐 **Vorabmessung 2026-07-26 zu „ließen sich Wälder und Gebirge auch erkennen?"** — auf
> Nachfrage des Owners gemessen, damit die Antwort nicht geraten werden muss. **Sie sind
> trennbar, aber nicht mit einer Schwelle**, und deshalb ist es kein V5-Nachschlag, sondern
> ein eigenes Vorhaben. Gemessen an 33×33-px-Fenstern um jeden Labelpunkt (z3):
>
> | | Farbton | Sättigung | G−R | Textur (σ Laplace) |
> |---|---:|---:|---:|---:|
> | `wald` (68) | 55,5 | 103 | **23,6** | 41,8 |
> | `gebirge` (60) | 36,5 | 82 | **4,7** | **62,2** |
> | `steppe` (10) | 36,0 | 125 | 10,8 | **18,9** |
> | `suempfe_moore` (28) | 46,5 | 109 | 18,4 | 35,9 |
>
> Bester **einzelner** Schwellenwert Wald gegen Gebirge: `G−R` trennt **89,1 %** richtig,
> Textur 84,4 %, Farbton 81,2 %. Steppe und Gebirge haben denselben Farbton (36) und sind
> nur über Sättigung und Textur zu trennen — ein Gebirge ist rau, eine Steppe glatt.
>
> **Was daraus folgt:** ein kleiner Klassifikator über Farbe **und** Textur (nicht eine
> Schwelle) käme grob in die Gegend von 90 % je Bildfenster. Das reicht für einen
> **Startumriss**, den ein Editor korrigiert — es reicht **nicht** für den V5-Weg „ableiten
> und ungesehen importieren". Drei Gründe, alle unabhängig:
> 1. **90 % je Fenster heißt gesprenkelt**, nicht 90 % richtige Fläche. Der Rand ist die
>    eigentliche Aufgabe, und der Rand ist genau dort am unsichersten, wo Wald ausdünnt.
> 2. **Wald und Gebirge überlappen physisch** — ein bewaldeter Hang ist beides. Die
>    V5-Grundannahme „ein Label = eine Form" bricht hier.
> 3. **Es gibt keine Randregel wie bei Land/Wasser.** Die Meer-See-Trennung war umsonst zu
>    haben, weil „berührt den Bildrand" eine harte, richtige Regel ist. Für Wälder existiert
>    nichts Vergleichbares.
>
> Das gehört damit zu **V7/V8** („gibt 61 `gebirge` einen Startumriss") und wird als eigenes
> Vorhaben beauftragt — mit einem eigenen Entwurfstor, weil ein 90-%-Umriss eine ganz andere
> Abnahme braucht als eine Küstenlinie.
- **V4a Quellen** (`entity_type='ecosystem'`) — eigene Aufgabe, hinter V4.
- **`copy_regions`** — durch V4 gestrichen.
- Jede Änderung am Client, an den Endpunkten oder am Schema. V5 schreibt **nur** in
  `tools/` und benutzt, was V2 und V3 gebaut haben.
