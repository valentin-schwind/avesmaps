# Landschaften V11 — Gelände auf Reisezeiten — Design

**Stand:** 2026-07-29 · **Auftraggeber:** Owner · **Vorgänger:** V8 (Höhenfeld) und V9
(Wege × Flächen) ✅ live · **Fahrplan-Zeile:** `docs/superpowers/plans/2026-07-24-landschaften.md`,
V11 · **Nachfolger:** „Hierher reisen" mit A\* (§10) — dieselben Daten, eigene Spec.

---

## 0. Kurzfassung

Heute hat jede Wegart **ein festes Tempo**. Eine Straße ist überall gleich schnell, ob sie
durch die Ebene läuft oder einen Hang hinauf.

V11 gibt der Karte die Steigung. Ein Weg bergauf kostet mehr Zeit, ein Weg bergab weniger.

Dafür braucht es **eine gespeicherte Wahrheit über das Gelände** — ein Graustufenraster je
Fläche, in der Datenbank. Der Browser erzeugt es, der Server liest es. Und die Steigung, die
daraus folgt, ist **reines Subtrahieren** und damit auf beiden Seiten identisch.

**Ein Schalter im Landschaften-Editor entscheidet, ob es wirkt** — „Geländeabhängiges
Reisen: AN/AUS". AUS heißt: Zeile für Zeile die heutigen Zahlen.

> ⚠️ **V11 ändert veröffentlichte Reisezeiten.** `POST /api/route/` ist ein stabiler
> öffentlicher Vertrag. Die **Form** der Antwort bleibt; die **Werte** ändern sich, sobald
> der Schalter an ist. §8 sagt, wie das sichtbar und nachrechenbar bleibt.

---

## 1. Owner-Entscheide dieser Sitzung

| | Entscheid |
|---|---|
| **1** | **Ein Schalter im Landschaften-Editor**: „Geländeabhängiges Reisen: AN/AUS". *„ist es AN wird es für alle berechnet"* — kein Testparameter, kein stiller Rollout. |
| **2** | Die Steigung wirkt **überall**, auch auf `Gebirgspass`. Der Owner nimmt die Doppelzählung mit der Grundtabelle bewusst in Kauf (§4.3). |
| **3** | **Bergab ist schneller**, nicht nur „nicht langsamer". Sanftes Gefälle bringt Tempo, sehr steiles bremst wieder. Daher eine Klemme **unter** 1. |
| **4** | Das Höhenraster kommt **in die Datenbank**, nicht als Datei: *„wir haben vielleicht 20–40 gebirge"*. |
| **5** | Absolute Werte, kein Anzeige-Maßstab (§3.2). Der Owner nannte die Obergrenze **15.000 Schritt**. |
| **6** | Die A\*-Zellgröße ist **0,5 Karteneinheiten** und **einstellbar** (§10.2). |
| **7** | **Weg ≠ querfeldein**: *„ein pass leidet unter der steigung, aber querfeldein im gebirge verlangsamt nochmal generell"* (§4.2). |
| **8** | Die API bekommt den Terrain-Schalter **je Anfrage**, und wenn an, optional die Auflösung (§8.2). |
| **9** | Der Zuschnitt: V11 ist die Weg-Hälfte. A\* und „Hierher reisen" sind die nächste Stufe (§10). |

---

## 2. 🔴 Der Befund, der die Architektur entscheidet

**Der Server kann das Höhenfeld nicht selbst erzeugen — und darf es nie versuchen.**

Die Berge entstehen prozedural in **einer JavaScript-Datei**
(`js/map-features/map-features-ecosystem-height-field.js`, 996 Zeilen, rund 30 Konstanten,
drei Rauschverfahren, Warp, Ridged-Oktaven, Gipfelfenster). PHP kennt nur die Gipfelhöhen
und die Reglerstellungen — nicht die Landschaft, die daraus wird.

**Was portierbar wäre:** Das Feld ist vollständig deterministisch. **Kein `Math.random`** —
die Saat kommt aus `public_id` + `geometry_revision` (`:149`). Die Zell-Hashes benutzen
`Math.imul`, also 32-Bit-Multiplikation, in PHP mit Maskierung bitgenau nachbaubar. Plus,
Minus, Mal, Geteilt sind IEEE 754 und in beiden Sprachen identisch.

**Was es unmöglich macht:**

| Funktion | Vorkommen | Problem |
|---|---|---|
| `Math.pow` mit gebrochenem Exponenten | `:768`, **je Zelle** | ECMAScript erlaubt implementierungsabhängige Ergebnisse |
| `Math.exp` | `:972` | dito |
| `Math.hypot` | `:970` | dito |

PHP nimmt die libm des Systems. Zwei Bibliotheken → verschiedene letzte Bits. Auf STRATO
weiß niemand, welche libm läuft, und ein Hoster-Update tauscht sie ohne Ankündigung.

> 💣 **Und die letzten Bits bleiben hier nicht klein.** `:663`:
> ```js
> field.noiseScale = target / Math.pow(loudest, exponent);
> ```
> `loudest` ist der **lauteste Punkt** des Rauschens, also ein Maximum. Ein anderes letztes
> Bit in **einer** Zelle kann entscheiden, **welche** Zelle die lauteste ist. Dann ändert
> sich `noiseScale` für die **ganze Fläche**, dann die Steigung, dann der Faktor, dann die
> Route. Das ist kein Rundungsfehler — das ist eine globale Skalierung an einem Argmax.

**Also: der Browser rechnet einmal, das Ergebnis wird gespeichert, alle lesen es.** Dieselbe
Figur wie V9, hier aber nicht aus Bequemlichkeit, sondern als einzige korrekte Möglichkeit.

---

## 3. Das Höhenraster

### 3.1 Wo es liegt und wie groß es ist

Je Fläche ein Graustufenbild über ihre eigene bbox, als `MEDIUMBLOB` in einer neuen Tabelle
(§5.1). Gemessen am Livebestand (`ecosystem_revision` 3983), bei **0,25 Karteneinheiten je
Pixel** und 16 Bit:

| | |
|---|---|
| kleinste Gebirgsfläche | 6 KB (Manekh-Chanebi) |
| Median | **51 KB** |
| größte | **286 KB** (Finsterkamm) |
| 15 Gebirge zusammen | **1,01 MB** |
| hochgerechnet auf 40 Flächen | **2,68 MB** |

`MEDIUMBLOB` fasst 16 MB je Zeile. Die Größe ist keine Frage.

> ⭐ **Warum Datenbank und nicht `/uploads/`.** Nicht wegen der Größe — wegen des Stempels.
> Raster und die Angabe, **wogegen** es gerechnet wurde (Gipfel, Regler, Geometrie-Revision),
> stehen in **derselben Zeile** und werden in **einer** Transaktion geschrieben. Bei Dateien
> kann die Zeile „aktuell" sagen, während die Datei älter oder verschwunden ist. Genau dieses
> Auseinanderlaufen hat das Haus bei den Wappen schon einmal bezahlt.
>
> ⚠️ **Ein `fseek`-Argument für Dateien gibt es bei dieser Größe nicht.** Bei 51 KB holt man
> die Zeile einmal und liest **punktuell im Binärstring** (§5.4) — das schlägt tausende
> Einzelzugriffe auf eine Datei. Der vermeintliche Vorteil der Datei existiert erst bei
> Rastern, die um Größenordnungen größer wären.
>
> 💣 **„Einmal holen" heißt NICHT „als Array auspacken".** Wie genau, steht in §5.4 — und die
> erste Fassung dieser Spec zeigte hier in die falsche Richtung.

### 3.2 💣 Der Pixelwert IST die Höhe in Schritt — und warum das nicht selbstverständlich ist

**Was auf dem Bildschirm steht, ist NICHT die Höhe.** Die Anzeige kennt zwei Maßstäbe
(`js/map-features/map-features-ecosystem-height-render.js:298-300`):

| Modus | Bezug |
|---|---|
| normale Ansicht | fester Weißpunkt `HEIGHT_WHITE_SCHRITT = 5000`, global |
| **`solidMode`** (beim Bearbeiten) | `max(100, höchster Gipfel des Stapels)` — **je Fläche gedehnt** |

Der zweite existiert, damit der Editor einen 300-Schritt-Hügel überhaupt sieht (Owner). Ein
Grauwert bedeutet dort **„hoch für hier"**, nicht „hoch". Wer diese Pixel speicherte, bekäme
je Gebirge einen **anderen** Maßstab — und Steigungen, die um genau diesen Dehnfaktor falsch
sind, unterschiedlich falsch je Fläche, und für niemanden sichtbar.

**Deshalb: 16 Bit, und der Wert ist die Höhe in Schritt. Ohne jede Normierung.**

0…65.535 fasst die 15.000 Schritt aus Entscheid 5 direkt, auf **einen Schritt genau**, mit
vierfachem Spielraum. Es gibt keinen Weißpunkt, keinen Skalenfaktor und keine Dehnung — also
nichts, was jemand später falsch erinnern kann.

Die **Anzeige** bleibt unberührt: sie liest künftig aus demselben Raster und legt ihren
Weißpunkt darüber. Die Dehnung wird damit reine Darstellung, statt in den Daten zu stecken.

### 3.3 Wer es erzeugt

Der Landschaften-Editor, auf Knopfdruck, wie „Zugehörigkeit rechnen" in V9. Der Browser
rastert **das eigene Feld** einer Fläche über ihre bbox (§5.0) und lädt das Ergebnis hoch. Die
Live-Vorschau darf beim Ziehen an den Reglern weiter frei rechnen; beim Knopfdruck friert sie
ein.

> 💣 **Der Haupt-Thread wird freigegeben — je Fläche und innerhalb großer Flächen je
> Zeilenband** (`await new Promise((r) => setTimeout(r, 0))`), und der Fortschritt steht im
> Knopf („Raster 7/15 · Finsterkamm"). V9 §1 hat diese Regel wörtlich; meine erste Fassung
> hatte sie vergessen. Hochgerechnet aus der V8-Messung (203.520 Rasterpunkte = 249 ms):
> 529.531 Pixel bei 15 Flächen, **1,4 Mio bei 40** — ohne Freigabe sind das mehrere Sekunden
> eingefrorener Tab, und Chrome bietet „Seite reagiert nicht" an.

> 🔴 **Hochgeladen wird EINE ANFRAGE JE FLÄCHE**, mit Lauf-Token wie V9 §6.2 — nie alles auf
> einmal. 78 Flächen wären 5,25 MB roh, **7,0 MB base64**, über dem üblichen `post_max_size`
> von 8 MB. Je Fläche sind es höchstens 286 KB roh. Und ein Abbruch entwertet dann nicht den
> ganzen Bestand, sondern lässt die schon geschriebenen Flächen stehen.

> 🔴 **Danach liest auch der Browser das Raster**, nicht mehr das lebende Feld — überall dort,
> wo er mit dem Server übereinstimmen muss. Sonst gibt es wieder zwei Wahrheiten, und die
> eine ist die, die niemand prüft.

### 3.4 💣 Es veraltet, und zwar still

Ein altes Raster sieht aus wie ein neues. Die Gegenmaßnahme ist dieselbe wie in V9: der Stempel
steht **in der Zeile**, und der Knopf sagt, wenn er nicht mehr passt.

**Woran es genau hängt — und woran ausdrücklich nicht — steht in §5.1.** Die naheliegende
Antwort („an `ecosystem_revision`") ist die falsche und hätte den Bestand an einem einzigen
Arbeitstag 901-mal entwertet; die richtige sind zwei Fingerabdrücke, von denen einer global
sein muss. Das ist kein Detail der Tabelle, sondern der Punkt, an dem die ganze
Ungültigkeits-Mechanik steht oder fällt.

Der Besucher sieht den Stempel nie; er existiert, damit „warum ist der Pass noch schnell?" eine
Antwort hat.

---

## 4. Wie aus Höhe eine Zeit wird

### 4.1 Die Kette

```
Höhenraster ──> Anstieg/Gefälle je Wegstück ──> Steigungsfaktor ──> Kantenzeit
  (SUMME über       nur Subtrahieren            Kurve, §4.4        × Grundtempo
   alle über-
   lappenden, §5.0)
```

**Nur der erste Schritt wird gespeichert.** Anstieg, Gefälle und Faktor entstehen beim Lesen.

> 🔴 **Der Faktor wird NICHT gespeichert** — dieselbe Regel wie in V9 („speichere das
> Intervall, nicht die Antwort"). Sie zahlt sich sofort aus: Kurve ändern, Klemme ändern,
> Pässe doch ausnehmen — **kostet keinen neuen Rasterlauf**. Nur die Höhen selbst zu ändern
> kostet einen.

### 4.2 🔴 Weg und querfeldein sind verschieden

Owner 2026-07-29: *„ein pass leidet unter der steigung, aber querfeldein im gebirge
verlangsamt nochmal generell."*

```
Weg-Kante    = Strecke / Grundtempo(Wegart)      × Steigungsfaktor
Querfeldein  = Strecke / Grundtempo(Querfeldein) × Steigungsfaktor × Geländefaktor(Art)
```

**Der Geländefaktor wirkt NUR querfeldein.** Eine Straße durch den Reichsforst ist eine
Straße; der Wald bremst sie nicht. Wege gibt es gerade, um das Gelände zu neutralisieren.

*(Folge für V10: die Zeile „Führt durch: Reichsforst" beschreibt weiterhin nur, wo die Etappe
verläuft — sie sagt nichts über ihre Dauer. Das ist richtig so.)*

**Wasser ist kein Faktor, sondern unpassierbar.** Ein See wird umgangen, nicht teuer
durchquert. In V11 hat das keine Wirkung (Wege sind gezeichnet, wo man gehen kann); es ist
die Regel, auf der §10 aufbaut.

### 4.3 ⚠️ Die Doppelzählung auf dem Pass — bewusst hingenommen

Ein `Gebirgspass` ist zu Fuß **1,5 km/h**, eine `Strasse` **4,0** (`js/config.js`,
`SPEED_TABLE`). Der Pass ist also **schon heute 2,67-mal langsamer** — allein weil er ein
Pass ist. Diese Zahl enthält bereits „Bergpfad".

Wenn V11 ihn zusätzlich nach Steigung bremst, zählt der Berg **zweimal**. Der Owner hat das
gewählt (Entscheid 2), mit der Begründung, dass steile und flache Pässe sonst nicht
unterscheidbar bleiben.

> 🔴 **Die Folge muss gemessen und vorgelegt werden, bevor der Schalter angeht.** Bei einer
> oberen Klemme von 4,0 läge ein steiler Pass rechnerisch bei **0,375 km/h** — keine 10 km
> am Tag. Ob die Klemme dort bleibt, entscheidet das gemessene Bild (§7.2), nicht diese
> Spec.

### 4.4 Die Kurve — was hier NICHT entschieden wird

Bergauf langsamer, sanft bergab schneller, sehr steil bergab wieder langsamer.

**Die Zahlen dahinter werden gemessen, nicht geraten.** Verfahren in §7.2: erst die echte
Verteilung von Anstieg und Gefälle über alle 36.139 Wegstücke, dann eine Kurve so legen, dass
ein typischer Bergweg ungefähr dort landet, wo die veröffentlichte Tabelle ihn heute schon
sieht (Pass 1,5 gegen Straße 4,0 = 2,67×). Die Zahlen gehen an den Owner, **bevor** eine
davon wirkt.

**Klemme `[0,5 … 4,0]`** als Vorgabe.

> 💣 **NICHT die Flussklemme erben.** `avesmapsRouteClientNormalizeFlow` (`client-graph.php:186`)
> klemmt auf **`[1,0 … 3,0]`** — ein Fluss macht nur langsamer, nie schneller. Erbte V11 diese
> Grenze, würde jedes Gefälle auf 1,0 hochgeklemmt und **bergab wäre nie schneller als eben**;
> Entscheid 3 wäre stillschweigend zurückgenommen.

### 4.5 Die Geländefaktoren gehören in die Tabelle

`ecosystem_region_type` hält heute schon Einstellungen je Art (`affects_paths`, die
V8-Geländevorgaben). Ein `offroad_factor` gehört dorthin — dann stellt der Owner „Wald 1,4 ·
Gebirge 2,2 · Sumpf 3,0" selbst ein, ohne dass jemand Code anfasst (AGENTS.md: keine
hartkodierten Inhalte).

**In V11 wird die Spalte angelegt und gepflegt, aber noch nicht gelesen** — sie wirkt erst
querfeldein (§10). Sie steht hier, weil die Werte dann schon eingestellt sein sollen.

---

## 5. Was gespeichert wird

> 🔴 **Dieser Abschnitt wurde nach zwei feindlichen Prüfungen (Laufzeit, Skalierung) neu
> geschrieben.** Die erste Fassung hatte drei Fehler, von denen zwei **still falsch gerechnet**
> hätten, statt laut zu scheitern. Sie stehen mit Begründung in §12 — nicht aus Buchhaltung,
> sondern weil jeder von ihnen naheliegend war und der nächste Leser sie sonst wieder einbaut.

### 5.0 🔴 Was ein Raster enthält: NUR das eigene Feld

Die Regel aus V8 steht wörtlich in `map-features-ecosystem-height-combine.js:5-6`:

```
W(x,y) = EIN Gipfelfenster über ALLE Gipfel ALLER Flächen
h(x,y) = Σ über alle Flächen F:  Feld_F(x, y, W(x,y))
```

**Die Höhe an einem Punkt ist eine SUMME über alle überlappenden Flächen.** Der Owner hat die
Überlappung ausdrücklich gewollt (2026-07-28: „die überlappung und verschmelzung zu einem zug
ist ok").

Daraus folgt der Zuschnitt, und er ist an drei Stellen gleichzeitig der billigere:

| | eigenes Feld je Raster **(gewählt)** | Stapelsumme je Raster |
|---|---|---|
| Rasterlauf bei 40 Flächen | **~0,2 s** | ~7 s |
| Leser | muss überlappende Raster **addieren** | ein Zugriff |
| überlappende Fläche geändert | **kein** Raster wird ungültig | alle überlappenden werden ungültig |

Der mittlere Punkt ist der Preis, die anderen beiden sind der Grund. Vor allem der dritte:
**bei „eigenes Feld" verschwindet die Überlappungs-Invalidierung ersatzlos** — mein Feld hängt
nicht daran, wer neben mir liegt.

> 💣 **Der Leser MUSS summieren.** Wer „das Raster der Fläche, die den Punkt enthält" liest,
> bekommt in jedem Überlappungsstreifen eine zu niedrige Höhe — und sieht dabei nichts
> Auffälliges. Der Abnahmeschritt dagegen steht in §9.2.

### 5.1 `ecosystem_area_heightmap`

```sql
CREATE TABLE IF NOT EXISTS ecosystem_area_heightmap (
    area_id INT UNSIGNED NOT NULL,
    cell_size_mapunits DECIMAL(6,4) NOT NULL,   -- IMMER die Bestandsauflösung, siehe 5.3
    origin_x DECIMAL(10,4) NOT NULL,            -- linke obere Ecke in Karteneinheiten
    origin_y DECIMAL(10,4) NOT NULL,
    width_px SMALLINT UNSIGNED NOT NULL,
    height_px SMALLINT UNSIGNED NOT NULL,
    -- generiert, damit „welche Raster decken diese Kiste" eine INDIZIERTE Abfrage OHNE das Blob ist
    max_x DECIMAL(10,4) AS (origin_x + width_px  * cell_size_mapunits) STORED,
    max_y DECIMAL(10,4) AS (origin_y + height_px * cell_size_mapunits) STORED,
    samples LONGBLOB NOT NULL,                  -- uint16 little-endian, zeilenweise, = SCHRITT
    -- Stempel: wogegen wurde gerastert
    geometry_revision INT UNSIGNED NOT NULL,
    terrain_fingerprint CHAR(40) NOT NULL,      -- SHA1 ueber die Geländeregler DIESER Fläche
    peaks_fingerprint CHAR(40) NOT NULL,        -- SHA1 ueber ALLE Gipfel: (public_id, x, y, height, zugeteilte area_id)
    computed_by BIGINT UNSIGNED NULL,
    computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (area_id),
    KEY idx_heightmap_bbox (origin_x, origin_y, max_x, max_y)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

- **`samples` sind uint16 und bedeuten SCHRITT** (§3.2). Kein Maßstab, keine Normierung.
- **Little-endian, zeilenweise** — festgeschrieben, nicht unterstellt.
- **`LONGBLOB`, nicht `MEDIUMBLOB`.** Bei 0,25 E/px und 16 Bit gilt `Bytes = 32 · bbox-Fläche`.
  `MEDIUMBLOB`s 16 MB sind damit bei einer bbox von **724 × 724 Einheiten** erschöpft — die
  ganze Karte wären 32 MB. Heute unerreichbar, weil nur `gebirge` ein Höhenfeld bekommt
  (`-loader.js:330`); aber `huegelland: "warp"` steht in `-height-combine.js:57` **schon
  geschrieben** und wartet auf das Aufmachen des Riegels. Ohne `sql_mode=STRICT` **schneidet
  MySQL still ab**, und ein halbes Höhenraster sieht aus wie ein ganzes. `LONGBLOB` kostet
  nichts.
- **Drei Wächter beim Schreiben** (§9.1): `cell_size_mapunits` ≥ Bestandsauflösung,
  `width_px * height_px` ≤ Obergrenze je Fläche, und die Invariante
  `width_px * height_px * 2 = LENGTH(samples)`.

> 🔴 **`ecosystem_revision` steht NICHT im Stempel** — das war der schwerste Fund der Prüfung.
> Es ist **ein globaler Einzelzähler** (`ecosystem.php:548`, `id=1`, 11 Aufrufstellen): jede
> Bearbeitung **irgendeiner** der 686 Flächen zählt ihn hoch, auch die eines Sees, auch eine
> Umbenennung. **Belegt in diesen Specs selbst:** V9 maß am 2026-07-29 den Wert **3082**, V11
> maß am **selben Tag 3983** — **901 Sprünge an einem Arbeitstag.** Der Rasterbestand wäre an
> diesem Tag 901-mal „veraltet" gewesen, und bei 78 Flächen sind das je 8 s Neurechnen. Nach
> dem dritten Mal drückt niemand mehr den Knopf, und dann gilt ein Raster, dessen Stempel
> „veraltet" sagt.

**Was statt dessen invalidiert — und warum es genau diese zwei sind:**

| Fingerabdruck | ändert sich, wenn | Häufigkeit |
|---|---|---|
| `terrain_fingerprint` + `geometry_revision` | **diese** Fläche umgezeichnet oder ihre Regler verstellt werden | oft, aber nur diese eine Zeile |
| `peaks_fingerprint` | ein Gipfel **irgendwo** entsteht, sich bewegt, seine Höhe ändert **oder einer anderen Fläche zugeteilt wird** | selten |

> 💣 **Warum der Gipfel-Fingerabdruck GLOBAL sein muss und die Zuteilung enthält.** Zwei
> Kopplungen, die eine Fläche über die ganze Karte hinweg beeinflussen:
> 1. **`separationAt` hat keine Entfernungsgrenze** (`-height-field.js:198-211`). Wird ein
>    Gipfel gelöscht, springt die Separation seines Nachbarn auf den nächsten — der irgendwo
>    liegen kann. Über den Radius ändert das dessen Buckel, über `field.hmax` und `noiseScale`
>    **die Skalierung der ganzen Fläche**. Das ist dieselbe Argmax-Falle, vor der §2 warnt.
> 2. **`assignEcosystemPeaksToAreas`** (`-height-combine.js:88`) gibt jeden Gipfel der
>    **kleinsten enthaltenden** Fläche. Zeichnet jemand eine neue, kleinere überlappende
>    Fläche, **entzieht** sie der alten deren Gipfel — deren `geometry_revision` und deren
>    Regler ändern sich dabei **nicht**. Ohne die zugeteilte `area_id` im Fingerabdruck sagte
>    ihr Raster „aktuell" und wäre falsch. Dieser Fall trifft **heute schon**, nicht erst beim
>    Wachsen.

### 5.2 `path_terrain` — der abgeleitete Zwischenspeicher

Der Router baut den Graphen über **alle 5.655 Wege**; jede Kante braucht ihren Faktor. Alle
Raster je Anfrage zu laden ist keine Option (§5.4). Anstieg und Gefälle je Weg ändern sich
zwischen zwei Anfragen aber nicht:

```sql
CREATE TABLE IF NOT EXISTS path_terrain (
    path_id BIGINT UNSIGNED NOT NULL,        -- map_features.id (INTERN, siehe 5.5)
    ascent_schritt  INT UNSIGNED NULL,       -- NULL = keine Höhendaten (NICHT 0)
    descent_schritt INT UNSIGNED NULL,
    profile_json JSON NULL,                  -- Anstieg/Gefälle je Wegstück, fuer Teilstuecke
    path_revision BIGINT UNSIGNED NOT NULL,  -- die EIGENE map_features.revision dieses Wegs
    heightmap_stamp CHAR(40) NOT NULL,       -- ueber die Fingerabdruecke der beteiligten Raster
    computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (path_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

> 💣 **`NULL` heißt „keine Höhendaten", `0` heißt „gemessen und eben".** Nie derselbe Wert.
> Heute tragen **16 von 67** Gipfeln eine Höhe — ohne den Unterschied hielte jeder Leser die
> fehlenden 51 für gemessene Ebene. Dieselbe Lehre wie V9s leerer Lauf.

> 🔴 **`path_revision`, NICHT `map_revision`** — der zweite Fund, den **beide** Prüfer
> unabhängig gefunden haben. `map_revision` ist ein globaler Zähler
> (`features.php:2735`) und wird auch von Siedlungs-, Label-, Quellen- und Sync-Schreibvorgängen
> hochgezählt. **Und Gipfel sind `berggipfel`-LABELS in `map_features`** (V8) — eine Gipfelhöhe
> einzutragen, also die häufigste V11-Redaktionsarbeit mit **51 offenen Gipfeln**, hätte in
> einem Zug **alle 5.655 Zeilen** entwertet. Die eigene `map_features.revision` des Wegs ändert
> sich nur, wenn *dieser* Weg sich ändert — und sie reist in der Routing-Nutzlast bereits mit
> (`map-data.php:38`), der Vergleich kostet also nichts.

### 5.3 🔴 EINE Auflösung für den ganzen Bestand — und warum Entscheid 8 daran scheitert

Der Anstieg über fraktales Gelände ist eine **Totalvariation**: er wächst mit der Abtastdichte.
Bei einem Hurst-Exponenten um 0,5 heißt das ×√2 je Halbierung der Zellgröße:

| Zellgröße | relative Anstiegssumme |
|---|---|
| 0,5 | **0,71×** |
| **0,25 (Bestandsauflösung)** | **1,00×** |
| 0,125 | 1,41× |

Zwei Folgen, beide unangenehm:

1. **Owner-Entscheid 8 („wenn an, optional die Auflösung mitgeben") ist mit einem
   Zwischenspeicher nach `path_id` nicht erfüllbar.** Eine andere Auflösung heißt andere
   `ascent_schritt` — entweder ist der Schalter wirkungslos, oder jede Anfrage umgeht den
   Cache und lädt doch alle Raster.
2. **A\* würde bei 0,5er Zellen nur 0,71× des Anstiegs messen, den `path_terrain` für
   denselben Boden misst.** In einer „Hierher reisen"-Route laufen beide Preise nebeneinander —
   der Planer bevorzugte querfeldein **genau im Gebirge**, aus einem reinen Abtastartefakt.

> 🔧 **DU (Owner) — hier weiche ich von Entscheid 8 ab, und du sollst es wissen:**
> Die **Höhenintegration** läuft IMMER über die Bestandsauflösung 0,25, auch für A\*. Der
> Auflösungsregler bleibt — aber er stellt nur das **A\*-Suchgitter** (§10.2), nicht das Maß,
> in dem Steigung gemessen wird. Damit bleibt der Geist des Entscheids (du kannst A\* tunen)
> und der Widerspruch verschwindet. Sag Bescheid, wenn du es anders willst.

### 5.4 💣 Wie das Blob gelesen wird — und wie NICHT

Meine erste Fassung schrieb „bei 51 KB lädt man die Zeile einmal und greift im Speicher zu".
Das zeigt in die falsche Richtung, und **beide** Prüfer haben es unabhängig beziffert:

| | Blob | `unpack('v*')` als PHP-Array |
|---|---|---|
| 15 Flächen | 1,01 MB | 8–18 MB |
| **40 Flächen** | 2,69 MB | **21–48 MB** |
| **78 Flächen** | 5,25 MB | **42–95 MB** |

`unpack('v*')` liefert ein 1-basiertes, nicht gepacktes Array — gemessen **43 Byte je
Element**. Meine „2,68 MB" waren die Blob-Größe, nicht die PHP-Größe.

> 🔴 **Das Blob wird NIE als Array materialisiert.** Es bleibt ein **Binärstring**, und ein
> einzelner Punkt wird punktuell gelesen:
> ```php
> $value = unpack('v', $samples, 2 * ($row * $width + $col))[1];
> ```
> Gemessen **0,08 µs je Zugriff bei null Zusatzspeicher**. Die Profil-Ableitung kostet damit
> O(Abtastpunkte) = 72.278 Zugriffe ≈ 6 ms — statt O(Pixel).
>
> Das Blob wird zusätzlich **deflate-komprimiert** abgelegt: glattes 16-Bit-Gelände und die
> leeren bbox-Ecken (bei einem diagonalen Gebirgszug 60–70 % der Fläche) geben typisch 3–6×.
> Entpackt wird zum **String**, nicht zum Array.

### 5.5 💣 Der Verbundschlüssel existiert in der Routing-Nutzlast NICHT

`path_terrain.path_id` ist `map_features.id`, also die **interne** Kennung. Aber
`avesmapsFetchRouteMapFeatures` (`map-data.php:29-40`) selektiert **`public_id`, `revision`,
Geometrie — nie die interne `id`**, und `avesmapsBuildRoutePathData` (`network-data.php:152`)
setzt `'id' => public_id`.

Ein naheliegendes `$terrain[$path['id']]` übersetzt, läuft und **verfehlt jede einzelne Zeile**.
Das Ergebnis ist Faktor 1,0 überall — also **genau der Wert, der laut §8.2 auch „Schalter aus"
und „hier ist es flach" bedeutet**. Abnahmeschritt 1 wäre grün, Schritt 2 sähe aus wie ein
Kurvenproblem.

> 💣 **Das ist dieselbe Fehlerklasse, die V10 am selben Tag live einen Totalausfall gekostet
> hat** — ein Feld namens `id`, das nicht die `id` ist (siehe die Korrektur in
> `2026-07-29-landschaften-v10-fuehrt-durch-design.md` §5.1). Zweimal an einem Tag, zweimal im
> Routing. **Regel: bevor irgendein neuer Bestand an die Routing-Nutzlast angeschlossen wird,
> wird nachgesehen, welche Kennung sie tatsächlich führt.**

**Also vorverbunden lesen**, und die PHP-Abbildung über `public_id` schlüsseln:

```sql
SELECT f.public_id, t.ascent_schritt, t.descent_schritt, t.profile_json, t.path_revision
FROM path_terrain t JOIN map_features f ON f.id = t.path_id
```

Und in §9.2 ein **harter Zähler**: „N Wege tragen ein Profil" muss > 0 sein — nicht bloß „der
Faktor sieht plausibel aus".

### 5.6 🔴 Wer den Zwischenspeicher füllt — und wer NIEMALS

Meine erste Fassung schrieb, der Server rechne ein fehlendes Profil „beim nächsten Anlass"
nach. Ohne Auslöser, ohne Budget, ohne Sperre. Gemessen wäre das gewesen: der erste Aufruf nach
einem Rasterlauf hat **5.655 Fehlschläge**, lädt alle Raster, tastet 72.278 Punkte ab und
schreibt 5.655 Zeilen — **1,7–5,7 s** bei 30 s Zeitlimit. Und ein Fehlschlag trifft nie einen:
**alle gleichzeitigen Besucher** starten dieselbe Füllung und halten je einen PHP-Worker. Das
ist die Form des Pool-Vorfalls vom 2026-07-17.

| Lage | was passiert |
|---|---|
| **Zeile fehlt oder ist veraltet, mitten in einer Route** | `ascent_schritt: null`, Faktor **1,0**. **Es wird NICHTS nachgerechnet.** |
| Nachrechnen | **owner-getriggerte Aktion**, gestückelt, mit Lauf-Token, Budget und Cursor — dieselbe Maschinerie wie V9 §6.2 und die Dump-Phasen |

> 💣 **V9 durfte den Stapellauf ersatzlos streichen, weil dort der BROWSER in 0,4 s rechnete.
> Hier rechnet der Server.** Die Begründung überträgt sich nicht, und die Maschinerie muss
> zurück.

### 5.7 Aufräumen

`ecosystem_area_heightmap` bekommt beim Löschen einer Fläche seine Zeile mitgelöscht, und der
Rasterlauf entfernt Waisen. Ohne das schleppt jedes „alle Raster laden" Blobs gelöschter
Flächen mit — und die Zeile behauptet weiter Gültigkeit.

---

## 6. Der Eingriff im Routing-Kern

### 6.1 Wo die Zeit entsteht — nachgeprüft, nicht abgeschrieben

`api/_internal/routing/client-graph.php` hat 891 Zeilen. **Die Zeilennummern der
Fahrplan-Zeile stimmen nicht mehr**, und ihre Zählung auch nicht:

| Fahrplan | tatsächlich | was dort passiert |
|---|---|---|
| `:144` | **`:152`** | ganzer Weg, kein Knoten dazwischen |
| `:157` | **`:163–165`** | `array_slice` an Kreuzungen/Orten **auf** dem Weg |
| `:534–553`, `:538` | **`:508/513` → `:542`**, Rekonstruktion **`:546`**, angewandt **`:549`** | Wegpunkt-Anker: Teilung am projizierten Punkt |

> ⭐ **Es sind nicht drei Stellen, sondern zwei.** Die ersten beiden münden beide in
> `avesmapsAddClientCompatiblePathSliceConnection` (`:190`); die Zeitrechnung steht dort
> **einmal**, in `:194`. Das halbiert die Angriffsfläche.

### 6.2 💣 Die Rückrechnung ist mit Terrain nicht reparierbar, sondern überflüssig

`:546`:

```php
$speed = $originalTime > 0.0 ? $originalDistance / $originalTime : 0.0;
```

Das ist **keine Geschwindigkeit**, sondern Geschwindigkeit geteilt durch den
**Durchschnittsfaktor der Elternkante**. `:549` wendet sie auf ein Teilstück an und schiebt
damit das Gelände des *ganzen* Wegs auf ein Stück mit anderer Steigung.

**Heute ist das korrekt** — weil der einzige Faktor in `time` der **Flussfaktor** ist, und
der ist über den ganzen Weg **konstant**. Er kürzt sich heraus.

> **Die Regel dahinter, ausgeschrieben:** Die Rückrechnung gilt genau so lange, wie der
> Faktor entlang des Wegs konstant ist. Für den Fluss ist er das. Für die Steigung nie.

V11 repariert sie deshalb nicht, sondern macht sie überflüssig: der Teilstück-Bauer holt sich
Anstieg und Gefälle **seiner eigenen** Stücke aus `profile_json` und rechnet den Faktor
selbst. Schneidet der Server mitten in ein Wegstück (Wegpunkt-Anker), wird anteilig geteilt.

Erschwerend: `$original` ist bereits **eine der beiden Richtungsvarianten**, das Teilstück
erbt also auch deren Richtung.

### 6.3 Die Orientierung bleibt, wie sie ist

`:207–211`, Kommentar `:218–219`, wörtlich: *„from/to fields stay the STORED orientation on
both variants — the verlauf flow derivation's chain walk depends on that."*

V11s Vorwärts-/Rückwärtsfaktor folgt derselben Regel: die **gespeicherte Zeichenrichtung**
entscheidet, welcher welcher ist. `from`/`to` werden **nicht** getauscht. Anstieg in
Zeichenrichtung ist Gefälle dagegen — mehr braucht es nicht.

---

## 7. Der Schalter und die Eichung

### 7.1 „Geländeabhängiges Reisen: AN/AUS"

Eine Einstellung in `app_setting`, umgelegt im Landschaften-Editor, neben dem vorhandenen
Not-Aus der Ebene. **AUS = Zeile für Zeile die heutigen Zahlen.** AN = für alle.

💣 **Gelesen wird sie OHNE die selbstheilende DDL.** `avesmapsAppSettingGet` führt bei jedem
Aufruf ein `CREATE TABLE IF NOT EXISTS` aus; im Routing-Pfad, der bei jeder Route läuft, ist
das genau der Hotspot, den AGENTS.md §10 für `territories-endpoint.php` beschreibt. **Die
Funktionsform steht schon da** — `avesmapsPathLandscapesEcosystemEnabled`
(`api/_internal/app/path-landscapes.php:79`, V10): direkt lesen, fehlende Tabelle heißt AUS.
Wiederverwenden, nicht eine dritte Kopie schreiben.

⚠️ **Und sie kostet KEINE zweite Datenbankverbindung.** `avesmapsLoadRouteMapData`
(`map-data.php:5-15`) erzeugt sein eigenes PDO und **gibt es nicht zurück**; Schalter und
`path_terrain` naiv gelesen wären zwei bis drei Verbindungen je Route, auf Hosting mit
`max_user_connections`. Das PDO wird zurückgegeben und durchgereicht — eine Zeile.

### 7.2 Die Messung, die vor dem Einschalten steht

1. **Verteilung** von Anstieg und Gefälle über alle 36.139 Wegstücke — Median, p90, Maximum.
2. **Kurve** so legen, dass ein typischer Bergweg nahe der 2,67× landet, die die
   veröffentlichte Tabelle heute schon unterstellt.
3. **Das Bild vorlegen**: die zehn am stärksten verlangsamten Wege mit Namen, die zehn
   schnellsten, und dieselbe Route (Gareth → Thorwal) mit und ohne Schalter.
4. **Erst dann** wird über die obere Klemme entschieden (§4.3).

> ⚠️ **Der Schalter geht nicht an, bevor der Owner dieses Bild gesehen hat.** Eine Zahl, die
> leise falsch ist, merkt niemand — und Reisezeiten sind die eine Zahl, die Leute aus dieser
> Karte übernehmen.

---

## 8. Die öffentliche API

### 8.1 Was sich ändert

`cost` und `segments[].cost_units` ändern sich. **`distance_units` nicht** — Entfernung ist
Geometrie. Die **Form der Antwort bleibt identisch**.

> Die Werte waren nie stabil: `api/README.md` sichert die **Endpunkte** zu, nicht die Zahlen,
> und die ändern sich heute schon, sobald eine Straße verlegt wird. Gelände ist ein größerer
> Sprung auf einmal, aber keine neue Art von Änderung.

### 8.2 Was dazukommt

**Der Präzedenzfall steht schon in der Antwort.** Jede Etappe trägt heute `flow_time_factor`
und `flow_state` — die Flussströmung wird nicht nur eingerechnet, sondern **ausgewiesen**.
Gelände wird genauso behandelt:

| Feld | Ort | Bedeutung |
|---|---|---|
| `terrain_time_factor` | je Segment | der angewandte Faktor, `1.0` wenn ohne Wirkung |
| `ascent_schritt` / `descent_schritt` | je Segment | **`null`**, wo keine Höhendaten liegen |
| `terrain_enabled` | `debug` | war der Schalter an |
| `terrain` | **Anfrage** | `false` schaltet **ab**, nie an (§8.3) |
| `terrain_cell_size` | **Anfrage** + `debug` | nur das **A\*-Suchgitter**, nie das Maß der Steigung (§5.3) |

> 💣 **`1.0` bedeutet drei verschiedene Dinge:** „Gelände ist aus", „hier ist es flach", „hier
> weiß ich nichts". Der Schalterzustand in `debug` trennt das erste ab; `null` bei
> Anstieg/Gefälle trennt das dritte vom zweiten. Ohne beides ist eine geänderte Zahl für
> einen Abnehmer nicht erklärbar.

### 8.3 🔴 Die zwei Schalter sind nicht gleichberechtigt

Der Editor-Schalter ist ein **Not-Aus**. Der API-Schalter darf nur **ab**schalten, nie an.
Sonst könnte ein Fremder einschalten, was der Owner ausgeschaltet hat — und der Not-Aus wäre
keiner. **Global AUS gewinnt immer.**

> ⚠️ **`terrain: false` liefert nicht dieselbe Route mit anderen Zahlen, sondern eine ANDERE
> ROUTE.** Der Planer sucht den billigsten Weg; ändert sich der Preis der Berge, ändert sich
> die Wahl. Mit Gelände geht die Route außen herum, ohne Gelände über den Pass. Beide sind
> richtig — aber es sind zwei Reisen, nicht zwei Preisschilder für dieselbe. **Genau so muss
> es in `api/README.md` stehen**, sonst hält ein Entwickler es für Kosmetik.

### 8.4 Was mitwandern muss

- `api/README.md` bekommt einen Absatz: neue Felder, der Anfrage-Schalter, und der Satz aus §8.3.
- Die Tempo-Tabelle im Handbuch bedeutet dann „Grundtempo **vor** Gelände". Die Datei gehört
  der Nachtroutine (AGENTS.md §9) — **hier wird sie nur angemeldet, nicht angefasst.**

---

## 9. Nachweis

### 9.1 Unit-Tests

`api/_internal/routing/__tests__/terrain-factor-test.php` (rein, ohne DB):

| Fall | Erwartung |
|---|---|
| Anstieg 0, Gefälle 0 | Faktor exakt `1.0` |
| Anstieg `null` (keine Daten) | Faktor `1.0`, **und als „unbekannt" erkennbar** |
| starker Anstieg | Faktor > 1, an der oberen Klemme gekappt |
| sanftes Gefälle | Faktor < 1 |
| sehr steiles Gefälle | Faktor wieder > sanftes Gefälle |
| Klemme | nie außerhalb `[0,5 … 4,0]` |
| Flussweg mit Strömung **und** Steigung | beide Faktoren multiplizieren, Flussklemme bleibt `[1,0 … 3,0]` |
| Teilstück eines Wegs | Faktor aus **seinen** Stücken, nicht aus dem Elterndurchschnitt |
| Teilstück, das mitten in ein Wegstück schneidet | anteilig geteilt |
| Schalter AUS | Faktor `1.0` überall, Zeiten bit-identisch mit heute |

`api/_internal/routing/__tests__/heightmap-read-test.php`:

| Fall | Erwartung |
|---|---|
| punktueller `unpack('v', …, $offset)` gegen einen im Browser erzeugten Blob | identische Werte |
| **zwei überlappende Raster** | Höhe ist die **Summe** beider, nicht die des „enthaltenden" (§5.0) |
| Punkt außerhalb aller bbox | „keine Daten", **nicht 0** |
| fehlende Raster-Zeile | „keine Daten", kein Fehler |
| Stempel passt nicht | als veraltet gemeldet, Antwort trotzdem geliefert |
| `width_px * height_px * 2 ≠ LENGTH(samples)` | **abgelehnt**, nicht halb gelesen |
| `cell_size` unter der Bestandsauflösung | abgelehnt |
| Blob als PHP-Array materialisiert | **kommt im Code nicht vor** (§5.4) — per Suche geprüft, nicht per Laufzeit |

### 9.2 Abnahme am Livebestand

1. **Schalter AUS**: Gareth → Thorwal liefert `cost` **bit-identisch** mit heute. Der
   wichtigste Test der ganzen Spec — er beweist, dass V11 im Ruhezustand nichts anfasst.
2. 🔴 **Der harte Zähler ZUERST**: „wie viele Wege dieser Route tragen ein Profil?" muss
   **> 0** sein. Ohne ihn ist Schritt 1 auch dann grün, wenn der Verbundschlüssel jede Zeile
   verfehlt (§5.5) — und Schritt 3 sähe dann aus wie ein Kurvenproblem.
3. **Schalter AN**: dieselbe Route, `terrain_time_factor` je Segment plausibel, die
   Koschberge-Etappe langsamer als vorher.
4. **Ein Weg ohne Höhendaten**: `ascent_schritt: null`, Faktor `1.0`.
5. **Ein Wegpunkt mitten auf einer Bergstraße**: die beiden Teilstücke ergeben zusammen
   dieselbe Zeit wie die ungeteilte Kante (±Rundung). **Der Test, der die Rückrechnung
   erschlägt.**
6. **Ein Weg durch einen Überlappungsstreifen zweier Gebirge**: der Anstieg ist größer als der
   aus **einem** der beiden Raster allein (§5.0).
7. **Zeitmessung** des Routing-Endpunkts mit und ohne Schalter, je eine Anfrage, dazu
   `memory_get_peak_usage` — der Routen-Endpunkt hält heute schon 62 MB, gemessen 152 MB Spitze.
8. **Nach einem Rasterlauf**: die erste Route antwortet **normal schnell** und mit Faktor 1,0,
   wo noch kein Profil steht — sie füllt nichts nach (§5.6).

> ⚠️ **Vor der Abnahme neu zählen.** Alle Zahlen dieser Spec stehen gegen
> `ecosystem_revision` 3983 / 16 von 67 Gipfeln. Der Bestand wächst täglich.

---

## 10. Was NICHT in V11 gehört — und was davon schon entschieden ist

**„Hierher reisen": Rechtsklick auf die Karte, Schuh-Symbol, dann Dijkstra über den Graphen
bis zum nächstgelegenen Ort und von dort querfeldein per A\* zum Ziel.** Das ist das Ziel,
auf das V11 zuarbeitet. Es ist **nicht** Teil dieser Spec: V11 fasst Zahlen an, die es gibt,
A\* baut etwas, das es nicht gibt. Zusammen wären es zwei Risiken in einem Sprung, und eine
komische Zahl hinterher ließe sich keinem von beiden zuordnen.

**Entschieden ist es trotzdem schon** — damit es nicht neu hergeleitet werden muss:

| | Entscheid |
|---|---|
| **Ausstieg** | die vorhandene Funktion **„Nächsten Ort finden"** (`findNearestLocationToLatLng`) — nächster **benannter** Ort per Luftlinie, Kreuzungen ausgeschlossen. Deterministisch und für den Nutzer vorhersagbar. |
| **Suchraum** | eine **Kiste** aus Ausstiegsort und Ziel plus Rand — nicht die ganze Karte |
| **Zellgröße** | **0,5 Karteneinheiten** (1.500 Schritt), **einstellbar** (§10.2) |
| **Geländearten** | **zur Anfragezeit** aus den Polygonen in die Kiste gerastert — **kein zweites gespeichertes Raster** (§10.3) |
| **Höhe** | aus dem gespeicherten Raster (§3), abgetastet in dieselbe Kiste |
| **Wasser** | unpassierbar, nicht teuer |
| **Kosten** | `Strecke / Grundtempo(Querfeldein) × Steigungsfaktor × Geländefaktor(Art)` (§4.2) |
| **Symbol** | `schuh.png`, vorhanden in `C:\GIT\avesmaps-map-processing\icons\menu\` |

### 10.1 Wie groß die Kiste wird — gemessen

Luftlinie von einem beliebigen Kartenpunkt zum nächsten benannten Ort (2.666 Orte, Gitter
über die ganze Karte):

| | Karteneinheiten | ≈ Meilen |
|---|---|---|
| p50 | **39,5** | 120 |
| p90 | 157,8 | 470 |
| max | 290,0 | 870 |

Der lange Schwanz kommt fast nur vom offenen Meer und den unbezeichneten Rändern. Zellen bei
0,5 Karteneinheiten und einem Rand von 30 %:

| | Zellen |
|---|---|
| Median-Fahrt | **10.600** |
| p90 | 168.900 |
| schlimmster Fall | **568.000** |

### 10.2 Warum 0,5 und nicht 1,0 — die Seen entscheiden

Schmalste bbox-Seite je Art, gemessen:

| Art | n | p10 | **p50** | p90 | schmaler als 1 Zelle bei 1,0 |
|---|---|---|---|---|---|
| Meer | 35 | 57,6 | 129,9 | 237,9 | 0 |
| Gebirge | 15 | 12,4 | **26,4** | 57,8 | 0 |
| Wald | 25 | 3,9 | **15,0** | 30,1 | 0 |
| **See** | 296 | 1,0 | **1,6** | 3,8 | **24** |

Für Meer, Gebirge und Wald reichte **1,0** locker — ein Gebirge wäre 26 Zellen breit. **Seen
sind eine Größenordnung feiner.** Beim Rastern von Hindernissen ist „Zelle wird berührt =
Wasser" die sichere Wahl (lieber außen herum als hindurch) — damit würde bei 1,0 aus einem
1 km schmalen, 20 Einheiten langen See eine **3 km breite Mauer** und ein 60-km-Umweg. Bei
**0,5** ist der typische See drei Zellen breit und die Form stimmt.

**Einstellbar, mit Geländer:** die Zellgröße ist eine Owner-Einstellung neben dem Schalter;
der Code hat eine **Zellobergrenze**. Reicht eine Anfrage darüber hinaus, vergröbert er **für
diese eine Anfrage** und schreibt die tatsächlich benutzte Größe in die Antwort.

> 🔴 **Die Obergrenze liegt bei 150.000–200.000 Zellen, nicht bei 568.000.** Gemessen, PHP 8.5
> auf einem schnellen Entwicklerrechner, mit einem **minimalen** A\* ohne jede Geländemathematik:
>
> | Zellen | Zeit | geöffnet |
> |---|---|---|
> | 10.609 (Median) | **16 ms** | 8.878 |
> | ~168.900 (p90) | ~242 ms | 140.437 |
> | 568.516 (max) | **816 ms** | 469.235 |
>
> Das echte A\* addiert je Relaxation eine Höhenabfrage, die Kurve, ein Geländebyte und eine
> Multiplikation — realistisch 3–5×, und STRATO-Shared nochmals 2–3× langsamer: **5–12 s im
> schlimmsten Fall.** Und das im **selben** Request, der schon den 5.655-Wege-Graphen baut.
> Der Median bleibt bei 50–150 ms und ist unbedenklich.
>
> Der Lauf bestätigt §10.4 nebenbei quantitativ: mit schwacher Heuristik öffnet A\* **83 %**
> der Kiste.

> 💣 **Das Gitter ist NIE ein PHP-Array.** Gemessen **33,2 Byte je Zelle** — 568.000 Ganzzahlen
> sind **18 MB**, derselbe Inhalt als Binärstring **0,5 MB**. Sowohl das Geländeraster aus
> §10.3 als auch die Abschlussmenge gehören in `str_repeat` / `$s[$i]`.

### 10.3 🔴 Warum die Geländearten NICHT gespeichert werden — anders als die Höhe

Zwei verschiedene Probleme, zwei verschiedene Antworten:

| | Höhe | Geländeart |
|---|---|---|
| Quelle | prozedurales Rauschen, **nur in JS** | **Polygone in MySQL** |
| kann PHP es erzeugen? | **nein** (§2) | **ja** |
| also | **gespeichert**, mit Stempel | **je Anfrage gerastert**, kein Stempel |

Sobald die Kiste feststeht, malt PHP die Flächen hinein, die sie überhaupt schneiden — ein
Scanline-Fill, dessen Kosten an der **Kistengröße** hängen, nicht an A\*s Schritten. Danach ist
„was ist hier?" ein Byte-Zugriff.

> ⚠️ **„10–20 Flächen" war gegen den heutigen Bruchteil gemessen.** Es sind 686 Flächen, davon
> **296 Seen**, und der Zielstand ist ~937 (V9 §3.2). Eine p90-Kiste (205 × 205 Einheiten) über
> einer Seenlandschaft schneidet schon heute deutlich mehr. Die Kosten bleiben trotzdem an der
> Kiste hängen — aber die Zahl im Text war zu klein und ist hiermit korrigiert.

> 🔴 **Ein Byte je Zelle reicht NICHT — es sind drei Ebenen.** V10 hat gemessen, dass sich
> Landschaftsanteile nicht auf 100 % summieren, weil `derographisch`, `vegetation` und
> `topographie` **übereinanderliegen**: eine Zelle ist gleichzeitig „Kosch" **und** „Wald"
> **und** „Gebirge". Also **drei Byte-Ebenen je Zelle, eine je `kind`**.
>
> Und damit gehört eine Entscheidung hierher, die §4.5 sonst offenließe: **wie die drei
> `offroad_factor` zusammenkommen.** Vorschlag: das **Maximum**, nicht das Produkt — sonst
> multipliziert sich „Wald im Gebirge in einer derographischen Region" zu einem Faktor, den
> niemand mehr erklärt. Die Spalte wird in V11 angelegt (§4.5); die Verknüpfungsregel gehört
> in denselben Commit, sonst erfindet sie später jemand.

> ⭐ **Der Nebengewinn ist der eigentliche: kein Veralten.** Ein heute gezeichneter See wird
> heute umgangen. Beim Höhenraster braucht es einen Knopfdruck; hier nie.

### 10.4 ⚠️ Was der Bergab-Bonus A\* kostet

A\* braucht eine Schätzung der Restkosten, die **nie zu hoch** liegt — sonst findet er nicht
mehr den besten Weg. Er muss also annehmen, der Rest laufe so schnell wie überhaupt möglich.

| Klemme | A\* muss annehmen | Folge |
|---|---|---|
| `[1,0 … 4,0]` | höchstens heutiges Tempo | Schätzung so scharf wie heute |
| **`[0,5 … 4,0]`** | überall **doppeltes** Tempo möglich | Schätzung halb so scharf, viel mehr geöffnete Knoten |

Entscheid 3 (bergab schneller) kostet A\* also Schärfe. **Der Ausweg ist messbar:** A\* muss
nicht die *theoretische* Klemme annehmen, sondern den **kleinsten tatsächlich vorkommenden**
Faktor. Liegt der im echten Bestand bei 0,82 statt 0,5, verliert die Schätzung 18 % statt
50 %. Diese Zahl steht dann in den Profilen — sie wird gemessen, nicht angenommen.

### 10.5 Der Rest

| | wohin |
|---|---|
| Geschwindigkeitspfeile im Editor | **V12** — das Mikroskop für V11, ohne V11 zeigt es nichts Neues |
| die 51 Gipfel ohne Höhe | Redaktionsarbeit; V11 rechnet dort mit `null` → Faktor 1,0 |
| die ~46 fehlenden Gebirgsflächen | dito, V8s offener Punkt |
| Handbuch-Tabelle | Nachtroutine, hier nur angemeldet |

---

## 11. Aufwand und Risiko

| | |
|---|---|
| Rasterer im Browser (mit Freigabe + Fortschritt) + Hochladen je Fläche | ~230 Zeilen JS |
| Speicher-Endpunkt + DDL + Wächter + Lauf-Token | ~220 Zeilen PHP |
| Profil-Ableitung als **gestückelte Owner-Aktion** (Token, Budget, Cursor) | ~220 Zeilen PHP |
| Faktor + Einbau in die zwei Zeitstellen | ~120 Zeilen PHP |
| Schalter + Editor-Oberfläche | ~90 Zeilen |
| API-Felder + `api/README.md` | ~60 Zeilen |
| Tests | ~380 Zeilen |
| **Risiko** | **mittel bis hoch.** Nicht wegen der Menge, sondern wegen des Ziels: es sind veröffentlichte Reisezeiten. Der Schutz sind Abnahmeschritt 1 (AUS = bit-identisch), **2 (der harte Zähler)**, 5 (geteilte Kante = ungeteilte Kante) und die Regel, dass der Schalter erst nach dem vorgelegten Bild angeht. |

*(Der Aufwand ist nach der Prüfung um rund 150 Zeilen gestiegen — fast alles davon ist
Stapellauf-Maschinerie, die die erste Fassung sich gespart hatte, weil sie V9s Begründung
übernahm, ohne zu prüfen, ob sie noch trägt. V9 durfte sie streichen, weil dort der Browser
rechnete.)*

---

## 12. Was zwei feindliche Prüfungen geändert haben

Zwei Agenten sind über die erste Fassung gegangen, einer auf Laufzeit, einer auf Skalierung
(Owner-Auftrag 2026-07-29). Sie fanden **elf** Punkte; die tragenden sind hier, weil jeder
davon naheliegend war.

| | Fund | Folge, wenn niemand ihn findet |
|---|---|---|
| 💣 | `ecosystem_revision` im Stempel — **ein globaler Zähler**, 3082 → 3983 am selben Tag | 901-mal „veraltet" an einem Arbeitstag; nach dem dritten Mal drückt niemand mehr den Knopf |
| 💣 | `map_revision` je `path_terrain`-Zeile — ebenfalls global, **und Gipfel sind Labels darin** | eine Gipfelhöhe eintragen entwertet alle 5.655 Zeilen |
| 💣 | Der Verbundschlüssel **existiert in der Routing-Nutzlast nicht** | Faktor 1,0 überall — nicht unterscheidbar von „Schalter aus" |
| 💣 | Der Zwischenspeicher hätte sich **in einem Request** gefüllt | 5.655 Fehlschläge, alle Besucher gleichzeitig, Form des Pool-Vorfalls |
| 🔴 | Die Spec sagte nicht, ob ein Pixel **eigenes Feld oder Stapelsumme** trägt | Faktor 40 in der Laufzeit — und die Frage war schlicht offen |
| 🔴 | Die **Leseregel** stand nirgends, obwohl V8 sie als **Summe** definiert | in jedem Überlappungsstreifen eine zu niedrige Höhe, unauffällig |
| 🔴 | Der Anstieg ist **auflösungsabhängig** (×√2 je Halbierung) | A\* bevorzugte querfeldein im Gebirge — aus einem Abtastartefakt |
| ⚠️ | „2,68 MB in den PHP-Speicher" war die **Blob**-Größe | ×16 bis ×36 daneben; bei 78 Flächen über jedem Limit |
| ⚠️ | `MEDIUMBLOB` reißt bei einer bbox von 724 × 724 | still abgeschnittene Raster, die gültig aussehen |
| ⚠️ | Kein Wächter gegen `cell_size` → `SMALLINT`-Überlauf | dito |
| ⚠️ | Ein Byte je A\*-Zelle kann **drei Ebenen** nicht ausdrücken | die Verknüpfungsregel hätte später jemand erfunden |

> 💣 **Zwei Muster, die über diesen einen Tag hinausgehen:**
>
> **Ein Feld namens `id` ist nicht die `id`.** Derselbe Fehler hat am Vormittag V10 live einen
> Totalausfall gekostet und stand am Nachmittag ungeprüft wieder in dieser Spec. Beide Male im
> Routing, beide Male still.
>
> **Eine übernommene Begründung ist keine geprüfte Begründung.** „V9 brauchte keinen
> Stapellauf" stimmt — weil dort der Browser in 0,4 s rechnete. Hier rechnet der Server. Die
> Zeile wurde übernommen, die Bedingung nicht.
