# Landschaften V9 — Zugehörigkeit rechnen und speichern — Design

**Stand:** 2026-07-29 · **Auftraggeber:** Owner · **Vorgänger:** V8 ✅ live
(Fortsetzung offen) · **Fahrplan-Zeile:** `docs/superpowers/plans/2026-07-24-landschaften.md`
Zeile 2131 · **Abnehmer:** V10 (Zeile 2132), V11 (Zeile 2136).

---

## 0. Kurzfassung

Der Landschaften-Editor hat den Knopf **„Zugehörigkeit rechnen"** (`#ecoRaycast`). Er
rechnet heute **zwei** Zuordnungen im Browser und wirft sie weg:

| | was | heute |
|---|---|---|
| **A** | Fläche × Fläche — welche Vegetations-/Topographiefläche liegt in welcher derographischen Region | gerechnet, nur in `localStorage` |
| **B** | Fläche × Territorium („Liegt in") | gerechnet, nur in `localStorage` |

**V9 ergänzt die dritte und speichert alle drei serverseitig:**

| | was | neu |
|---|---|---|
| **C** | **Weg × Fläche** — von welcher Bogenlänge bis zu welcher verläuft ein Weg durch eine Fläche | gerechnet **und gespeichert** |

> **Owner-Auftrag 2026-07-29, wörtlich:** „V9 soll das nicht 1× ausrechnen, sondern mir
> im Regioneneditor beim Button *Zugehörigkeit rechnen* genau das auch ausrechnen (und
> das andere was es ausrechnet) und speichern. Dann finden wir raus wie lang das
> überhaupt dauert."

**Die Messung ist Teil des Ergebnisses**, nicht eine Nebensache: der Knopf sagt nach dem
Lauf, wie lange jeder der drei Teile gebraucht hat. Danach — und erst danach — wird
entschieden, ob überhaupt Stapellauf-Maschinerie nötig ist.

---

## 1. Was sich gegenüber der Fahrplan-Zeile ändert — und warum

Die Fahrplan-Zeile beschreibt einen **serverseitigen Stapellauf**: Sperre, 4-s-Budget,
`set_time_limit`, Cursor ohne `OFFSET`, Idempotenz je Weg, Leasing-Falle. Das setzt
voraus, dass **PHP** rechnet.

Der Owner-Auftrag setzt die Rechnung dorthin, wo die beiden anderen Zuordnungen schon
laufen: **in den Browser**. Damit entfällt der Stapellauf ersatzlos — es gibt keinen
Server-Durchgang, den man unterbrechen, wiederaufnehmen oder gegen Zeitüberschreitung
schützen müsste.

| Fahrplan-Zeile verlangt | Stand in dieser Spec |
|---|---|
| `path_ecosystem` PK `(path_id, area_id, seq)`, BIGINT | ✅ **erweitert** um `basis` im Schlüssel (Owner 2026-07-29: Sehne UND gezeichnete Kurve hinterlegen, §4.1/§5.2) |
| `path_ecosystem_state` | ❌ **entfällt** — ersetzt durch **eine** Stempelzeile (§4.4). Ohne Fällig-Abfrage gibt es keinen Zustand je Weg. |
| bbox-Vorfilter als SQL-Join | ❌ **entfällt** — der Vorfilter läuft im Browser, wie in `computeRaycast` schon heute (`boundsOverlap`) |
| Sperre, Budget, `set_time_limit`, Cursor, Idempotenz | ❌ **entfällt für die Rechnung**, ✅ **bleibt sinngemäß für das Speichern** (§6.2: Lauf-Token, gestückelte Übertragung) |
| 💣 Leasing-Falle | entfällt mit dem Lauf. Die dahinterliegende Lehre bleibt und wandert in §4.4. |

> 🔴 **Was diese Vereinfachung zurücknehmen würde.** Genau **eine** Messung:
> Braucht Teil C im Browser mehr als **30 s** (Owner 2026-07-29), oder überschreitet die
> Übertragung des Ergebnisses die gestückelten Grenzen aus §6.2 deutlich, dann ist der
> serverseitige Stapellauf der Fahrplan-Zeile doch der richtige Bau. Deshalb steht die
> Messung vor der nächsten Ausbaustufe und nicht danach.
> **Erwartung:** ~15 s für beide Bezüge zusammen, davon 1,7 s die Sehne (Herleitung §3.3).
> Fällt die Browsermessung über 30 s, ist `basis=1` das Erste, was fällt — nicht der
> ganze Lauf (§5.2).
>
> ⚠️ **30 s im Browser sind erlaubt, 30 s am Stück sind es nicht.** Der Browser kennt
> kein FastCGI-Zeitlimit — das ist der Grund, warum die Schwelle hier so hoch liegen
> darf. Aber eine ununterbrochene Schleife von 30 s friert den Tab ein, und Chrome
> bietet irgendwann „Seite reagiert nicht" an. Die Rechnung **muss deshalb alle ~200
> Wege den Haupt-Thread freigeben** (`await new Promise((r) => setTimeout(r, 0))`) —
> das ist zugleich das, was den Fortschritt im Knopf („Wege 3.100/5.650") überhaupt
> sichtbar macht. Bei 2 s wäre das Kosmetik, bei 30 s ist es Bedingung.

---

## 2. Der Widerspruch, den dieser Auftrag auflöst — offen benannt

Im Code steht heute wörtlich, warum nicht gespeichert wird:

> „Computed here, NEVER stored — exactly like the conflict centre: a moved boundary
> corrects the answer by itself, and a stored column would be a second truth about the
> same thing."

Diese Begründung war richtig, **solange nur der Editor die Antwort brauchte**. V10 ändert
die Lage: die öffentliche Karte braucht sie auch, und sie kann sie nicht selbst rechnen
(§3.4). Ein Server-Speicher ist damit kein „zweite Wahrheit aus Bequemlichkeit", sondern
die einzige Stelle, an der die Antwort für Nicht-Editoren überhaupt existiert.

**Der Preis ist real und wird bezahlt, nicht wegdiskutiert:** ein gespeichertes Ergebnis
veraltet still. Die Gegenmaßnahme ist keine neue Erfindung — sie steht schon im Code,
als `localStorage`-Schlüssel: **`ecosystem_revision`**. Jeder Schreibvorgang an einer
Fläche erhöht ihn. Der Server-Speicher bekommt denselben Stempel, dazu `map_revision`
für die Wege-Hälfte (ein Weg-Edit erhöht `ecosystem_revision` nicht). Damit ist
„veraltet" **ablesbar**, und der Knopf sagt es (§7).

> 💣 **Gespeichert heißt Schnappschuss, nicht Wahrheit.** Dieselbe Lehre wie im
> Konfliktzentrum: was gespeichert ist, war zum Zeitpunkt X richtig. Jede Anzeige, die
> daraus liest, muss den Stempel mitlesen können — sonst behauptet sie Aktualität, die
> sie nicht hat.

---

## 3. Mengengerüst — live gemessen, nicht geschätzt

Gemessen **2026-07-29** gegen den Livebestand (`ecosystem_revision` 3082): je eine
Anfrage an `GET /api/app/ecosystem-areas.php` und `GET /api/app/map-features.php`,
danach offline nachgerechnet.

| | Wert |
|---|---|
| Wege (`feature_type='path'`, aktiv) | **5.650** (V4 zählte 5.512 routingfähige) |
| Stützpunkte / Segmente | 41.769 / **36.119** |
| Flächen (aktiv) | **647** (66 Erprobung) |
| Ecken aller Flächen | 31.797 (Median 17, p90 72, max 3.276) |

### 3.1 Zwei Flächen erzeugen 90 % der Rechenarbeit

| | alle 647 Flächen | ohne `meer`/`kontinent`/`kueste` |
|---|---|---|
| bbox-Tests | 3.655.550 | 3.655.550 |
| bbox-Paare (Treffer) | 22.688 (0,62 %) | **7.362** |
| Kantentests danach | **183.529.247** | **17.594.000** |
| Paare mit ≥1 Intervall | 11.449 | 3.829 |
| **Zeilen in `path_ecosystem`** | **12.302** | **4.426** |

| Fläche | Ecken | getroffene Wege | Kantentests | Anteil |
|---|---|---|---|---|
| `Meer-001` (topographie/meer) | 3.050 | 5.650 | 110.162.950 | **60,0 %** |
| `Aventurien` (derographisch/kontinent) | 1.539 | 5.501 | 54.542.160 | **29,7 %** |

Zusammen **7.837 Zeilen ohne Aussagewert**: „führt durch Aventurien" gilt für jede Route.

> ⚠️ **Die Analyse (§E) unterschätzte das um Faktor 10** — 18,2 Mio Kantentests, gemessen
> an **175** Flächen. Der bbox-Vorfilter ist gegen ein kontinentgroßes Polygon
> wirkungslos, weil dessen bbox alles enthält. Er skaliert **nicht** unterproportional.

### 3.2 Der Zielstand, nicht der heutige Bruchteil

Owner-Einwand: „wir haben jetzt nur einen Bruchteil der Karte." Gegen die Label-Bestände
gezählt (Labels = Obergrenze der noch zu zeichnenden Flächen):

| Typ | Flächen heute | Labels | fehlen |
|---|---|---|---|
| derographische Region | 11 | 111 | 100 |
| Wald | 13 | 70 | 57 |
| Gebirge | 8 | 63 | 55 |
| Tal | 0 | 26 | 26 |
| Sümpfe/Moore | 6 | 31 | 25 |
| übrige | — | — | 27 |
| **Summe** | **647** | | **~290 → Zielstand ~937** |

*(`insel` 254 und `see` 293 wachsen nicht mit den Labels — V5 leitete sie aus Kacheln ab.)*

Die Fehlenden sind **klein und handgezeichnet**. Hochgerechnet: **~20.000 Zeilen je
Bezug, also ~40.000 mit Sehne und Kurve** (mit Meer und Kontinent ~120.000, davon zwei
Drittel Rauschen).

### 3.3 Woher die Zeiterwartung kommt

| Vergleichspunkt | gemessen |
|---|---|
| Teil A heute (124 Flächen × 20 Regionen, Boolesche Verschnitte) | **47 ms** |
| Vorfilter allein, 3,66 Mio bbox-Tests, Python | 581 ms |
| Teil C **Sehne** (36.119 Segmente), Python/numpy | **1,71 s** |
| Teil C **Kurve** (284.269 Segmente = 7,9×), Python/numpy | **13,50 s** |
| **Teil C beide Bezüge** | **15,22 s** |
| Teil C Sehne ohne `affects_paths`-Filter, 183,5 Mio Kantentests | 5,0 s |

JavaScript liegt bei dieser Art Schleife typisch zwischen Python und numpy. **Erwartung
0,5–2 s** für Teil C mit Filter — deshalb die Schwelle „mehr als ~10 s" in §1.

> 💣 **Diese Erwartung ist eine Erwartung, kein Ergebnis.** Nachgebaute Szenen und Node
> kehren in diesem Projekt schon Rangfolgen um. Es zählt allein, was der Knopf **im
> Browser am Livebestand** meldet — genau darum geht der Auftrag.

### 3.4 Warum überhaupt speichern

Der Editor hat die Geometrie ohnehin. Die **öffentliche Karte hat sie nicht** und soll sie
nicht bekommen: die Flächen sind heute 0,94 MB und beim Zielstand eher 2–3 MB, und die
Karten-Nutzlast ist gemessen schon **17,79 MB** (2,6 MB übertragen). Der Editor rechnet
einmal, alle lesen.

---

## 4. Was gespeichert wird

Vier Tabellen, DDL in `avesmapsEcosystemEnsureTables` (`api/_internal/app/ecosystem.php`),
wo die übrigen Ökosystem-Tabellen schon stehen.

### 4.1 `path_ecosystem` — Teil C, das Neue

```sql
CREATE TABLE IF NOT EXISTS path_ecosystem (
    path_id BIGINT UNSIGNED NOT NULL,
    area_id INT UNSIGNED NOT NULL,
    basis TINYINT UNSIGNED NOT NULL,          -- 0 = Sehne (roh), 1 = Kurve (gezeichnet)
    seq TINYINT UNSIGNED NOT NULL,
    enter_distance_mapunits DECIMAL(10,4) NOT NULL,
    exit_distance_mapunits  DECIMAL(10,4) NOT NULL,
    PRIMARY KEY (path_id, area_id, basis, seq),
    KEY idx_path_ecosystem_area (area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

> 🔴 **`basis` — Owner-Entscheid 2026-07-29: BEIDE Linien werden hinterlegt.** Die
> gespeicherten Bogenlängen gibt es zweimal, einmal entlang der rohen Stützpunkte
> (`basis=0`) und einmal entlang der gezeichneten Catmull-Rom-Kurve (`basis=1`).
> Begründung und Preis in §5.2 — die Kurzfassung: es sind **zwei Antworten auf zwei
> Fragen**, nicht zwei Genauigkeiten derselben.
>
> **Warum als Unterscheidungsspalte im Schlüssel und nicht als zwei weitere Spalten in
> derselben Zeile:** die beiden Linien liefern **verschiedene Intervallmengen**, nicht
> verschiedene Werte derselben. Gemessen: 3.829 Paare treffen auf der Sehne, 3.827 auf
> der Kurve, **6 nur auf der Sehne, 4 nur auf der Kurve**, und je Paar kann die Anzahl
> der Durchquerungen abweichen. Zwei Spalten in einer Zeile erzwängen eine Paarung, die
> es in 10 Fällen gar nicht gibt — und dort müsste `NULL` bedeuten „gibt es nicht",
> während es überall sonst „vergessen" heißt.
>
> `TINYINT`, nicht `VARCHAR('chord'|'curve')`: der PK wächst damit von 13 auf **14
> Bytes**; ein `VARCHAR(8)` in `utf8mb4` machte daraus bis zu 46. Für einen abgeleiteten
> Cache ist das der falsche Preis für Lesbarkeit — die steht im Kommentar.

- `path_id BIGINT UNSIGNED` = `map_features.id`, **nicht** `public_id VARCHAR(36)`.
  Analyse §8.7: der PK wäre 41 statt 13 Bytes und jeder Sekundärindex schleppte ihn mit.
  Abgeleiteter Cache darf auf die interne `id` zeigen. **Der Client kennt nur
  `public_id`; die Auflösung passiert beim Speichern serverseitig** (§6.2).
- `area_id INT UNSIGNED` — **nicht** BIGINT. `ecosystem_area.id` ist `INT UNSIGNED`; die
  Fahrplan-Zeile sagt pauschal „BIGINT", das gilt nur für `path_id`.
- `seq TINYINT UNSIGNED` — Durchquerungszähler. Gemessen: 3.585 Paare mit 1 Intervall,
  Maximum **13**. PK = 8+4+1 = **13 Bytes**, genau die Zahl der Analyse.
- `enter_/exit_distance_mapunits` — Bogenlänge ab Wegbeginn in **Karteneinheiten**,
  dieselbe Einheit wie `map_features.min_x` und `calculatePathCoordinateDistance`.
  **Die Einheit steht im Feldnamen**, weil `1 Karteneinheit = 3.000 Schritt` und wer die
  Graph-Distanz als Meilen liest, eine Steigung um 3× und das Signal um 23× überhöht
  (Analyse §F). V9 rechnet keine Steigung — V11 liest diese Spalten.

> 🔴 **Bogenlänge, NICHT x/y — Owner-Frage 2026-07-29.** Es werden keine Koordinaten
> gespeichert. Drei Gründe, in dieser Reihenfolge:
>
> 1. **Die Koordinate ist exakt ableitbar** — Stützpunkte des Wegs einmal durchgehen,
>    Strecken aufsummieren, im richtigen Segment interpolieren. Acht Zeilen, und der
>    Client hat die Stützpunkte ohnehin, er zeichnet den Weg ja. Eine gespeicherte
>    Koordinate wäre eine **Zweitkopie derselben Information**.
> 2. **Beide Abnehmer rechnen in Bogenlänge, nicht in x/y.** V10 muss ein
>    Routen-Teilstück („von Meile 12 bis 27 dieses Wegs") mit dem Intervall schneiden;
>    V11 muss Kantengewichte entlang des Wegs stückeln. Eine Koordinate müsste dafür
>    erst wieder in eine Bogenlänge zurückgerechnet werden.
> 3. **Sie altert schlechter.** Wird ein Stützpunkt verschoben, landet eine Bogenlänge
>    weiterhin **auf** dem Weg, nur etwas anders. Eine gespeicherte Koordinate kann
>    daneben liegen — und sieht dabei völlig richtig aus.
>
> Braucht eine Anzeige den Übergangspunkt („hier beginnt der Wald"), ist es dieselbe
> Interpolation. Sie gehört dann in den Kern aus §5 als eigene reine Funktion, nicht in
> die Tabelle.

#### 4.1a Wenn diese Punkte später eigene Bedeutung bekommen — was dann gilt

Owner-Idee 2026-07-29 (noch nicht beauftragt): den Ein-/Austrittspunkten selbst Bedeutung
geben — „hier endet der Wald", „hier beginnt das Gebirge". Die Daten tragen das; **eine
Einschränkung ist vorab gemessen und gehört hierher, bevor jemand darauf baut.**

Der abgeleitete Punkt liegt **exakt** auf zwei von drei Linien:

| | |
|---|---|
| auf der Flächengrenze | ✅ exakt — er ist per Konstruktion der Schnittpunkt mit einer Polygonkante, **und Flächen werden ungeglättet gezeichnet** (kein `smooth` in `map-features-ecosystem-rendering.js`) |
| auf der rohen Weggeometrie | ✅ exakt |
| **auf dem gezeichneten Weg** | ❌ **nicht exakt** — der Weg wird als Catmull-Rom-Kurve gezeichnet (§5.2) |

**Gemessen an allen 2.610 echten Ein-/Austrittspunkten** (Weganfang und -ende
ausgenommen, die liegen ohnehin auf beiden Linien) — Abstand des abgeleiteten Punkts zur
**gezeichneten** Linie:

| | Karteneinheiten | Meter | px bei z5 | px bei z7 |
|---|---|---|---|---|
| Median | 0,0157 | 47 | **0,50** | 2,01 |
| p90 | 0,0529 | 159 | 1,69 | 6,77 |
| p99 | 0,1278 | 383 | 4,09 | 16,35 |
| max | 0,4919 | 1.476 | 15,74 | 62,97 |

**74 % liegen unter einem Pixel** bei voller Kachelzoomstufe, 97,5 % unter drei; genau
**2** Punkte über zehn.

> ⚠️ **z7 ist viermal so empfindlich.** Die Karte lässt eine Stufe über die native
> Kachelzoomstufe hinaus zu (`bootstrap.js:41`, `maxZoom: 7`). Dort ist der Median schon
> 2 px und das p99 16 px. Wer die Punkte als Marker zeigt, prüft sie **dort**, nicht bei z5.

#### 4.1b 💣 „Auf der Straße" und „an der richtigen Stelle" sind zwei verschiedene Fragen

Die Tabelle oben beantwortet nur die erste. Die zweite ist **„wo verlässt die gezeichnete
Straße den Wald"** — und dort ist der Abstand um Größenordnungen größer, weil der
Übergangspunkt **entlang der Waldgrenze** wandert: läuft die Straße flach zur Grenze,
verschiebt ein winziger seitlicher Versatz den Schnittpunkt weit.

Gemessen, Abstand Sehnen-Übergang ↔ nächstgelegener **Kurven**-Übergang (beide liegen
exakt auf der Flächengrenze):

| | Karteneinheiten | Meter | px bei z5 | px bei z7 |
|---|---|---|---|---|
| Median | 0,0405 | 122 | **1,30** | 5,19 |
| p90 | 0,3375 | 1.013 | 10,80 | 43,20 |
| p99 | 1,5804 | 4.741 | 50,57 | 202,29 |
| max | 5,3354 | 16.006 | 170,73 | 682,93 |

Nur 43 % liegen bei z5 unter einem Pixel, bei z7 sind es 17,6 %. Und **12 Sehnen-Übergänge
haben überhaupt kein Kurven-Gegenstück** — dort schneidet die Sehne die Fläche, die
gezeichnete Kurve nicht.

**Genau deshalb wird die Kurve mitgespeichert** (`basis=1`, §4.1). Owner 2026-07-29:
„ich hab den Schnittpunkt von Spline und Wald und kann an der Stelle auf dem Weg einen
Punkt platzieren oder den Streckenabschnitt durch den Wald einfärben." Beides sind
Aussagen über die **gezeichnete** Linie, und mit Sehnen-Bogenlängen wären sie im Median
1,3 px und im p90 10,8 px daneben.

### 4.2 `ecosystem_region_overlap` — Teil A

```sql
CREATE TABLE IF NOT EXISTS ecosystem_region_overlap (
    region_id INT UNSIGNED NOT NULL,
    other_region_id INT UNSIGNED NOT NULL,
    share DECIMAL(6,5) NOT NULL,
    PRIMARY KEY (region_id, other_region_id),
    KEY idx_ecosystem_overlap_other (other_region_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

Beide Richtungen werden geschrieben — der Client führt die Paare schon symmetrisch
(`result.get(a).push(b)` **und** umgekehrt), und ein Leser fragt immer „was liegt in
**dieser** Region", nie „welches Paar existiert". `share` ist der Anteil an der
**kleineren** der beiden Regionen, Schwelle 10 % — die Regel bleibt unverändert
(Owner 2026-07-27). `DECIMAL(6,5)` hält `0.00000`–`9.99999`; Anteile liegen in `[0,1]`,
der Spielraum fängt Rundung ab, ohne `FLOAT`-Wackeln einzuführen.

### 4.3 `ecosystem_region_territory` — Teil B

```sql
CREATE TABLE IF NOT EXISTS ecosystem_region_territory (
    region_id INT UNSIGNED NOT NULL,
    territory_public_id CHAR(36) NOT NULL,
    share DECIMAL(6,5) NOT NULL,
    is_aggregate TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (region_id, territory_public_id),
    KEY idx_ecosystem_territory (territory_public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

> 🔴 **Hier steht `public_id`, nicht die interne `id` — mit Absicht und im Widerspruch
> zu §4.1.** Der Unterschied ist nicht Bequemlichkeit: die politische Schicht wird über
> `territory_public_id` gelesen, der Zugriff läuft über
> `api/app/political-territories.php`, und diese Zeilen sind die **einzige** Stelle, an
> der das Landschaftsmodul auf Politik zeigt. Auf eine interne Politik-`id` zu zeigen
> hieße, eine zweite Kopplung an ein fremdes Modul einzuziehen, deren Auflösung nirgends
> sonst gebraucht wird. Bei `path_id` liegt es umgekehrt: Wege und Flächen sind beide
> „unser" Bestand, es sind zehntausende Zeilen, und der PK-Umfang zählt.
> `is_aggregate` reist mit, weil der Client-Helfer je Territorium **eine** Geometrie
> behält und jeder Treffer schon heute sagt, welche es war.

### 4.4 `ecosystem_assignment_stamp` — wann und wogegen gerechnet wurde

```sql
CREATE TABLE IF NOT EXISTS ecosystem_assignment_stamp (
    id TINYINT UNSIGNED NOT NULL,
    ecosystem_revision INT UNSIGNED NOT NULL,
    map_revision BIGINT UNSIGNED NOT NULL,
    area_count INT UNSIGNED NOT NULL,
    path_count INT UNSIGNED NOT NULL,
    overlap_rows INT UNSIGNED NOT NULL,
    territory_rows INT UNSIGNED NOT NULL,
    path_rows_chord INT UNSIGNED NOT NULL,
    path_rows_curve INT UNSIGNED NOT NULL,
    duration_ms INT UNSIGNED NOT NULL,
    run_token CHAR(36) NULL,
    computed_by BIGINT UNSIGNED NULL,
    computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

Eine Zeile, `id` immer `1` — dasselbe Muster wie `map_revision` und
`ecosystem_revision`.

> 💣 **Der Stempel existiert wegen der Null.** Von 5.650 Wegen schneiden gemessen nur
> **3.829** überhaupt eine Fläche — **1.821 Wege liefern null Zeilen**, und das ist ein
> gültiges Ergebnis. Wer „wurde gerechnet?" aus dem Vorhandensein von Zeilen ableitet,
> hält jeden dieser 1.821 Wege für ungerechnet — und einen leeren Lauf für einen
> misslungenen. Dieselbe Lehre steht wörtlich in `api/_internal/app/citymaps.php`
> („without a state for *tried, found nothing* the next step finds the same map due
> again and the run never ends — the linkchecker paid for that lesson"). Hier kostet sie
> **eine Zeile** statt 5.650, weil es keine Fällig-Abfrage gibt.

`duration_ms` ist kein Schmuck: es ist die Antwort auf „wie lang dauert das überhaupt",
und sie soll auch morgen noch ablesbar sein, nicht nur im Moment des Klicks.

> ⚠️ **Die Kurvenform wird NICHT mitgestempelt — Owner-Entscheid 2026-07-29:** „keine
> Panik, die `tension` wird niemand anfassen." Ich hatte drei Spalten dafür vorgesehen
> (`curve_tension`/`curve_samples`/`curve_enabled`), damit eine geänderte Kurvenform als
> „veraltet" auffällt statt still falsche `basis=1`-Zeilen zu hinterlassen. Der Owner hat
> das abgewählt; es ist bewusst weggelassen, kein Versehen. **Wer je `tension`, `samples`
> oder die Abschaltbarkeit in `VISUAL_LINE_CATMULL_ROM_CONFIG` (`js/config.js:364`)
> anfasst, muss den Knopf einmal drücken** — sonst beschreiben die gespeicherten
> Kurven-Zeilen eine Linie, die so nicht mehr gezeichnet wird.

### 4.5 `ecosystem_region_type.affects_paths`

```sql
ALTER TABLE ecosystem_region_type ADD COLUMN affects_paths TINYINT(1) NOT NULL DEFAULT 1
```

Startwerte beim Nachrüsten: **`0` für `meer`, `kontinent`, `kueste`**, alles andere `1`.
Begründung: §3.1. Das Feld reist in `GET /api/app/ecosystem-areas.php` je Fläche mit
(Nutzlast-Version **5**), damit der Client es beim Rechnen anwenden kann.

Es wirkt **nur auf Teil C**. Teil A und B bleiben unverändert — dort ist der Kontinent
heute schon Partner, und das zu ändern wäre eine andere Entscheidung als diese.

> 💣 **Der Startwert-Block wird PRO SPALTE bewacht**, nicht durch ein gemeinsames
> „war neu"-Flag: `avesmapsEcosystemEnsureTables` trägt diese Lehre schon im Kommentar —
> ein globales Flag hätte beim Nachrüsten von `terrain_mean_height` jede Owner-Anpassung
> an `terrain_grain` still auf die Werte von 2026-07-28 zurückgesetzt.

> 🔧 **DU (Owner):** Das ist eine Datenzeile, kein Code. Willst du „führt durchs
> Perlenmeer" doch sehen, setzt du `affects_paths=1` und drückst den Knopf neu.

**Nicht** `affects_routing`, **nicht** `speed_factor` — beide stehen in
`docs/oekosystem-instruction.md` §2 und gehören zu V11. `affects_paths` beantwortet:
*nimmt diese Art an der Wege-Zuordnung teil*. V10 ist Anzeige, nicht Routing.

---

## 5. Der Rechenkern für Teil C

Neue Datei `js/map-features/map-features-ecosystem-path-assign.js`, reine Funktionen,
kein DOM, kein `fetch` — damit unit-testbar wie
`js/map-features/__tests__/ecosystem-geometry.test.js`.

> 🔴 **Bindende Regel: der Kern kennt keine Wege, nur Koordinatenlisten.**
> Die Signatur lautet `ecosystemLineIntervals(coordinates, area)` — **nicht**
> `…ForPath(pathFeature, …)`. Er darf `public_id`, `feature_subtype`, `map_features`
> oder irgendeine Datenbankvorstellung nicht kennen.
>
> Der Grund ist nicht Ästhetik, sondern V13 („Querfeldein: Wasser meiden"): eine
> Querfeldein-Kante ist eine Liste aus **zwei** Punkten, und die Frage „schneidet sie ein
> `meer`/`see`-Polygon" ist dieselbe Funktion, aufgerufen mit 2 statt 30 Punkten und
> ausgewertet als „gibt es überhaupt ein Intervall". Bindet man den Kern an gespeicherte
> Wege, wird V13 eine **zweite Umsetzung derselben Mathematik** — genau der Fehler, den
> dieses Haus beim Quellensystem schon einmal bezahlt hat.
>
> Kosten dieser Regel heute: **null.** Sie verlangt nur, dass ein Argument eine Liste ist
> statt eines Objekts.

### 5.1 Ablauf je Paar (Weg × Kandidatenfläche)

1. **Bogenlängen** des Wegs kumulieren (`hypot` je Segment) → `cum[i]`, `total`.
2. **Schnitte** jedes Wegsegments mit jeder Polygonkante, Parameterform. Je Treffer die
   Bogenlänge `cum[i] + t · |Segment|`.
3. **Startzustand** per Ray-Cast am ersten Wegpunkt.
4. **Umklappen** an jedem Schnitt, nach Bogenlänge sortiert. Jedes Teilstück mit Zustand
   „innen" wird eine Zeile.

Löcher (`MultiPolygon`, innere Ringe) brauchen **keine Sonderbehandlung**: ihre Kanten
klappen den Zustand genauso um, der Ray-Cast zählt sie über die Parität mit.

**Vorfilter:** `boundsOverlap` — dieselbe Funktion, die `computeRaycast` heute schon
benutzt. Nicht nachbauen.

> 🔴 **Kein `polygon-clipping` für Teil C.** Teil A und B fragen nach *Fläche*, dafür ist
> der Boolesche Verschnitt richtig. Teil C fragt nach **Bogenlängen entlang einer Linie** —
> die liefert kein Verschnitt, und ein Umweg darüber wäre um Größenordnungen teurer.

### 5.2 💣 Zwei Durchgänge — Sehne UND gezeichnete Catmull-Rom-Kurve

Owner-Frage 2026-07-29. Wege werden **nicht** als Streckenzug gezeichnet: sie laufen
durch `smoothLineCoordinatesForDisplay` mit `VISUAL_LINE_CATMULL_ROM_CONFIG`
(`js/config.js:364`, `samples: 8`, `tension: 0.5`) — in
`map-features-path-rendering.js:236` für die Karte und in `route-render.js:19` für die
Routenlinie selbst. Das Sichtbare ist also eine Kurve **durch** die Stützpunkte, nicht die
Verbindung zwischen ihnen.

**Nachgemessen** (die Kurvenfunktion exakt nachgebaut, beide Varianten über alle 5.650
Wege × 609 Flächen):

| | Sehne (roh) | sichtbare Kurve |
|---|---|---|
| Paare mit Treffer | 3.829 | 3.827 |
| Zeilen | 4.426 | 4.407 |

| | |
|---|---|
| Paare, die **nur** die Kurve trifft | 4 |
| Paare, die **nur** die Sehne trifft | 6 |
| in beiden | 3.823 |
| Abweichung Kurve↔Sehne | Median **0,014** Karteneinheiten (42 m), p99 0,156, **max 2,12** (6,4 Meilen) |
| Längendifferenz je Paar | Median 0,019, p99 0,77, **max 3,48** (10 Meilen) |

**10 von 3.833 Paaren unterscheiden sich — 0,26 %.** Die binäre Antwort („führt durch
einen Wald") ist praktisch identisch. Die **Ortsangabe** ist es nicht (§4.1b).

#### Warum beide gespeichert werden und nicht nur eine

Es sind **zwei Antworten auf zwei Fragen**, und jede Seite hat genau einen Verbraucher,
für den die andere falsch wäre:

| `basis=0` **Sehne** | `basis=1` **Kurve** |
|---|---|
| **V10-Etappen und V11-Kantengewichte.** Alles, was diese Bogenlängen verrechnet, misst auf der rohen Linie: `calculatePathCoordinateDistance` (`map-features-location-editing.js:10`) und `getCoordinateDistance` (`route-graph-core.js:285`) summieren `hypot` über die **gespeicherten Stützpunkte**. Daraus entsteht die Graph-Distanz, daraus die Reisezeit, daraus die Etappen. Eine Kurven-Bogenlänge stünde hier im **falschen Maßsystem** — die Kurve ist länger, „3,28" bezeichnete zwei verschiedene Orte (derselbe Fallentyp wie die ×3-/×23-Einheitenfalle, nur leiser). | **Alles Gezeichnete.** Einen Punkt auf den Weg setzen, den Abschnitt durch den Wald einfärben, den Waldrand markieren. Mit Sehnen-Werten läge das im Median 1,3 px und im p90 10,8 px daneben (§4.1b). |

> 🔴 **Der Grund, der die Sache entscheidet — und der nicht die Genauigkeit ist.**
> Die Kurve ist aus den Stützpunkten **vollständig ableitbar**, also wäre „zur
> Anzeigezeit rechnen" naheliegend. Für die öffentliche Karte geht das aber nicht:
> um Kurven-Intervalle abzuleiten, braucht man die **Flächenpolygone** — und die
> öffentliche Karte lädt **null Polygone** (§9.1, live nachgezählt). Der Editor könnte
> es, der Besucher nicht. **Gespeicherte Kurven-Intervalle sind das, was die Einfärbung
> auf der öffentlichen Karte überhaupt möglich macht, ohne 2–3 MB Polygone
> auszuliefern.** Ohne sie bräuchte jede solche Anzeige entweder die Polygone oder eine
> eigene Serverabfrage je Route.

> ⚠️ **Die Kurve hängt an `js/config.js:364`** (`tension: 0.5`, `samples: 8`, und ein
> `enabled` an `?smoothLines=0`). Owner 2026-07-29: „die `tension` wird niemand
> anfassen" — es wird deshalb **nicht** überwacht (§4.4). Wer sie doch anfasst, drückt
> den Knopf einmal neu.

> ⚠️ **Der Preis, gemessen: der Kurven-Durchgang kostet das 7,9-fache.** Die gezeichnete
> Linie hat 8 Abtastpunkte je Segment — **284.269 statt 36.119 Segmente**. Im selben
> Offline-Gerüst: Sehne **1,71 s**, Kurve **13,50 s**, beide zusammen **15,22 s**.
> Das liegt unter der 30-s-Schwelle, füllt sie aber zur Hälfte, und der Zielstand ist
> rund 1,5-mal so groß. **Wenn die Browsermessung über 30 s geht, ist `basis=1` das
> Erste, was fällt** — nicht der ganze Lauf: Sehne allein bleibt bei 1,71 s, und die
> Kurve ließe sich dann für die Handvoll Wege **einer** Route zur Anzeigezeit rechnen
> (dort ist sie Mikrosekunden; teuer ist sie nur im Massenlauf).

### 5.3 Die halboffene Regel

Schnittparameter gelten als Treffer für `t ∈ [0,1)` **und** `u ∈ [0,1)`. Sonst zählt ein
Weg, der genau durch eine Polygonecke läuft, zwei Schnitte statt einen, und das Intervall
kippt in die falsche Richtung. Mit dieser Regel entsteht die Verteilung aus §3.1
(3.585 × 1 Intervall, dann fallend).

### 5.4 Entartungen

| Fall | Verhalten |
|---|---|
| Weg mit `total = 0` | 0 Intervalle, kein Fehler |
| Intervall < `1e-9` Karteneinheiten | verworfen (Tangente an einer Ecke) |
| Fläche ohne Kanten | übersprungen |
| \>255 Intervalle für ein Paar | Paar verworfen **und im Bericht genannt** — nie stillschweigend abschneiden |

### 5.5 💣 Flusswege zerfransen — gemessen, und es ist kein Fehler

Ein Weg kann dieselbe Fläche **mehrfach** durchqueren; deshalb `seq` im Schlüssel und
mehrere Zeilen je Paar. Live nachgemessen, wie sich das über die Wegarten verteilt:

| Wegart | Paare | Zeilen | davon aus Paaren mit ≥5 Intervallen |
|---|---|---|---|
| **Flussweg** | 824 | **1.325** | **396** |
| Pfad | 1.153 | 1.181 | 0 |
| Strasse | 700 | 711 | 0 |
| Seeweg | 359 | 386 | 0 |
| Reichsstrasse | 304 | 322 | 0 |
| Weg | 250 | 251 | 0 |
| Gebirgspass | 201 | 205 | 0 |
| Wuestenpfad | 38 | 45 | 5 |
| **Summe** | **3.829** | **4.426** | **401** |

**Alle anderen Wegarten sind praktisch 1:1** — ein Weg, eine Fläche, ein Intervall. Die
Zerfransung sitzt fast vollständig bei den Flusswegen, und der Grund ist geographisch:
**Flüsse sind oft selbst die Grenze** zwischen zwei Regionen. Ein Weg, der an so einer
Grenze entlangläuft, tritt nach der reinen Geometrie dutzendfach ein und aus.

Gemessenes Beispiel, der Flussweg **„Tommel"** (`0166e831`, 16,36 Karteneinheiten =
49 Meilen, 30 Stützpunkte): **eine** Zeile in `map_features`, daraus **40** Zeilen in
`path_ecosystem` — 13 Abschnitte im „Winhaller Land", 12 in „Fläche-011", 12 in
„Fläche-010", 2 im „See-158", und **1** durchgehender über die volle Länge in den
„Tommellanden".

> ⚠️ **„Der Tommel" ist nicht ein Weg, sondern 15.** Live gezählt: 15 aktive Wege tragen
> den Namen „Tommel", zwischen 2 und 30 Stützpunkten, zusammen 162 Karteneinheiten. Das
> ist die bekannte Segmentierung („eine Linie = viele Segmente"), und sie ist für V9
> harmlos — jedes Segment bekommt seine eigenen Notizen, und die Routenetappen sind
> ebenfalls segmentweise. Für eine Frage wie „führt **der Tommel** durchs Winhaller Land"
> müsste V10 über die 15 Segmente aggregieren. Kein Grund, hier etwas anders zu
> speichern; nur ein Grund, es beim Auswerten nicht zu vergessen.

**Für V9 ist das richtig so und wird nicht geglättet.** Die Zeilen sind die Wahrheit über
die Geometrie, und 401 von 4.426 Zeilen (9 %) sind kein Mengenproblem.

> 🔴 **Warum Intervalle und nicht gleich die Antwort.** Owner 2026-07-29: „V10 darf
> sowohl zählen, als auch %e speichern, als auch binär (Weg führt durch Farindelwald,
> ja/nein). Genau die Levels an Abstraktion brauchen wir." Alle drei sind aus den
> Intervallen **billig ableitbar**, keiner ist aus einem anderen rekonstruierbar:
>
> | Ebene | aus den Intervallen | Beispiel |
> |---|---|---|
> | binär | `EXISTS` | „führt durch einen Wald" |
> | zählend | `COUNT` | „berührt 4 Regionen" |
> | anteilig | `SUM(exit − enter) / Gesamtlänge` | „zu 62 % im Winhaller Land" |
>
> Das Intervall ist die **unterste** Ebene; wer es speichert, muss sich nie entscheiden.
> Wer stattdessen nur den Prozentsatz speicherte, könnte „führt zu 62 % durch" sagen,
> aber nie „wo genau" — und V11 braucht genau das „wo genau".
>
> **Für die Anzeige heißt Zerfransen trotzdem: zusammenfassen.** „Führt durch: Winhaller
> Land (13×)" wäre Unsinn; „zu 62 % durch das Winhaller Land" ist dieselbe Wahrheit,
> lesbar. Owner: „Nutzer werden das nicht sehen" — und sollen es auch nicht.
>
> Auch die **Typ-Frage** („führt der Weg durch **ein Gebirge**", nicht durch ein
> bestimmtes) braucht keine eigene Speicherung: `path_ecosystem` → `ecosystem_area` →
> `ecosystem_region` → `region_type` ist ein Join über vorhandene Schlüssel.

### 5.6 Was nicht gerechnet wird

Kein Höhenfeld, keine Tempokurve, keine Auf-/Abstiegssummen, keine Faktoren. Das ist V11
(§9).

---

## 6. Woher die Wege kommen und wie das Ergebnis hineinkommt

### 6.1 Lesen: die Weg-Geometrie für den Editor

Der Editor lädt heute **keine** `map_features`. Die Karten-Nutzlast dafür zu ziehen wäre
17,79 MB für einen Bruchteil ihres Inhalts. Deshalb ein schlanker, **capability-gated**
Endpunkt:

```
GET /api/edit/map/paths-geometry.php   (cap 'edit')
  -> { ok:true, map_revision:int, paths:[ { public_id, geometry, bounds } ] }
```

Nur `feature_type='path'`, `is_active=1`. Geschätzt ~1,5 MB bei 41.769 Stützpunkten.

- **`api/edit/`, nicht `api/app/`:** er dient allein dem Editor-Knopf. Die öffentliche
  Lesefläche wächst nicht (AGENTS.md §4), und `list_regions` liegt aus genau diesem Grund
  schon hinter derselben Schranke.
- **Keine internen `id`s im Payload** — der Client rechnet mit `public_id`, der Server
  löst beim Speichern auf (§6.2). Interne Schlüssel bleiben intern.
- Er wird **nur beim Klick** geholt, höchstens einmal je Sitzung — dieselbe Regel, unter
  der der Politik-Layer-Fächer dort schon steht.

### 6.2 Schreiben: gestückelt, mit Lauf-Token

Neue Aktionen an `api/edit/map/ecosystem.php` (vorhandener `match($action)`-Verteiler,
cap `edit`):

| Aktion | Wirkung |
|---|---|
| `assignment_begin` | erzeugt ein `run_token`, leert die drei Tabellen in **einer** Transaktion, schreibt den Stempel als „in Arbeit" |
| `assignment_chunk` | nimmt bis zu **2.000** Zeilen einer Art, verlangt das gültige `run_token`, fügt ein |
| `assignment_commit` | schreibt Zählwerte, `duration_ms`, `ecosystem_revision`, `map_revision`, `computed_by` und macht den Stempel gültig |
| `assignment_status` | liefert den Stempel — für den Knopf und für die Abnahme |

> 💣 **Warum ein Token und keine Sperre.** `GET_LOCK` ist verbindungsgebunden und kann
> nicht über mehrere Requests hinweg halten — genau der Grund, aus dem `dump-lock.php`
> eine DB-Zeile benutzt und `autoget-run.php` nicht. Zwei Editoren, die gleichzeitig
> rechnen, würden ihre Stücke sonst ineinander schieben. Mit dem Token gewinnt der
> zweite `assignment_begin`; das nächste Stück des ersten bekommt **409** und seine
> Oberfläche sagt, dass jemand anderes gerade rechnet.

> 💣 **Kein DDL in den Schreibpfaden.** `assignment_begin` und `_chunk` rufen **kein**
> `EnsureTables`: ein `ALTER TABLE` mitten in einer Transaktion beendet sie still
> (implizites Commit), und die `information_schema`-Sonden sind genau die Last des
> Pool-Vorfalls vom 2026-07-17. Die DDL läuft dort, wo sie ohnehin läuft — beim
> Flächen-Lesen und -Schreiben.

**Auflösung `public_id` → interne `id`** einmal je `assignment_begin`, für alle drei
Bestände, die intern geschlüsselt werden: `map_features` (Wege, 5.650),
`ecosystem_area` (647) und `ecosystem_region`. Politische Territorien werden **nicht**
aufgelöst — sie bleiben `public_id` (§4.3). Ein `public_id`, den es nicht mehr gibt,
wird **verworfen und gezählt**, nicht als Fehler geworfen: zwischen Rechnen und
Speichern kann ein Weg oder eine Fläche gelöscht worden sein.

**Größe:** heute ~4.426 + Teil A + Teil B ≈ 250 KB, in 2.000er-Stücken also 2–3
Anfragen. Zielstand ~20.000 Zeilen ≈ 1,2 MB, ~11 Anfragen. Die Stückelung ist genau
deshalb von Anfang an drin: sie hält jede einzelne Anfrage klein, ganz gleich wie der
Bestand wächst.

### 6.3 Idempotenz

`assignment_begin` leert, die Stücke füllen, `assignment_commit` stempelt. Zweimal
drücken ergibt dasselbe Bild. Ein Abbruch mittendrin hinterlässt einen Stempel ohne
`commit` — für jeden Leser erkennbar „unvollständig", nicht „leer".

---

## 7. Der Knopf

`#ecoRaycast` behält Namen und Platz. Neu:

- Er rechnet **A, B und C**, speichert alle drei und **misst jeden Teil einzeln**.
- **Der Status steht im Knopf** (Hausregel), in seiner zweiten Zeile `#ecoRaycastInfo`:

| Lage | zweite Zeile |
|---|---|
| nie gerechnet | „noch nicht gerechnet" |
| läuft | „rechnet … Wege 3.100/5.650" |
| speichert | „speichert … 3 von 11" |
| fertig | „**4.426 + 4.407 Wegabschnitte · 15,2 s gerechnet, 1,1 s gespeichert**" |
| Stempel veraltet | „gerechnet 12:04 · **Stand veraltet** (Flächen geändert)" |
| jemand anderes rechnet | „ein anderer Editor rechnet gerade" |

„Veraltet" ist ein Vergleich, keine Vermutung: Stempel-`ecosystem_revision` gegen den
aktuellen Wert, Stempel-`map_revision` gegen `GET /api/app/map-revision.php`.

Der `localStorage`-Cache **bleibt** — er ist der schnelle Weg beim Öffnen des Editors.
Neu ist, dass der Server die belastbare Kopie hält und beim Öffnen liefert, wenn der
lokale Cache fehlt oder älter ist.

---

## 8. Nachweis

### 8.1 Unit-Tests

`js/map-features/__tests__/ecosystem-path-assign.test.js`
(`node js/map-features/__tests__/ecosystem-path-assign.test.js`):

| Fall | Erwartung |
|---|---|
| Weg außerhalb | 0 Intervalle |
| Weg quer durch ein Rechteck | 1 Intervall, Bogenlängen exakt |
| Weg startet innen | 1 Intervall ab 0 |
| Weg vollständig innen | 1 Intervall, `0 … total` |
| konkave Fläche, drei Durchquerungen | 3 Intervalle, `seq` 0/1/2 |
| MultiPolygon mit Loch | Loch erzeugt Lücke |
| Weg genau durch eine Polygonecke | **1** Schnitt, nicht 2 |
| `total = 0` | 0 Intervalle, kein Fehler |
| Tangente < 1e-9 | verworfen |
| Fläche mit `affects_paths=0` | gar nicht erst geprüft |

`api/_internal/app/__tests__/ecosystem-assignment-test.php`
(`php -d extension=mbstring -d zend.assertions=1`):

| Fall | Erwartung |
|---|---|
| Stück ohne gültiges Token | 409, keine Zeile geschrieben |
| zweites `begin` | neues Token, altes wird ungültig |
| unbekannte `public_id` | verworfen und gezählt, kein Abbruch |
| `commit` ohne Stücke | gültiger Stempel mit 0 Zeilen (**der leere Lauf ist ein Ergebnis**) |
| zweimal derselbe Lauf | identische Zeilen |

### 8.2 Abnahme am Livebestand

Der Lauf muss auf dem Stand von `ecosystem_revision` 3082 exakt reproduzieren, was
offline gemessen wurde:

| | `basis=0` Sehne | `basis=1` Kurve |
|---|---|---|
| bbox-Paare geprüft | 7.362 | 7.362 (+ Rand) |
| Paare mit ≥1 Intervall | 3.829 | 3.827 |
| **Zeilen in `path_ecosystem`** | **4.426** | **4.407** |
| | | |

**Summe beider Bezüge: 8.833 Zeilen** (heute; Zielstand grob 40.000).

Zur Einordnung ohne den `affects_paths`-Filter (§3.1): 22.688 bbox-Paare, 11.449 Treffer,
12.302 Zeilen je Bezug.

> ⚠️ **Vor der Abnahme neu zählen.** Der Bestand wächst täglich; das ist ein Abgleich
> gegen eine offline nachgerechnete Nutzlast, nicht gegen eine Konstante. Verfahren: eine
> Anfrage je Endpunkt, danach offline.

> 💣 **Der Kurven-Durchgang braucht einen größeren bbox-Rand.** Die gezeichnete Kurve
> weicht bis zu **2,12 Karteneinheiten** von der Sehne ab (§5.2) und kann damit aus der
> bbox des rohen Wegs herausragen. Wer für `basis=1` denselben Vorfilter benutzt,
> verliert genau die Paare, die nur die Kurve trifft — gemessen **4 Stück**. Die bbox des
> Wegs ist deshalb für den Kurven-Durchgang aus der **geglätteten** Punktliste zu bilden,
> nicht aus der rohen. Kostet nichts, die Liste liegt ohnehin vor.

### 8.3 Die Messung, um die es geht

**Im Browser, am Livebestand, über den echten Knopf** — nicht in Node, nicht an einer
nachgebauten Szene, nicht in einer Schleife gegen den Server. Festzuhalten sind:
Ladezeit der Weg-Geometrie, Rechenzeit je Teil, Speicherzeit, Zeilenzahlen. `duration_ms`
im Stempel hält das Ergebnis fest.

**Daraus folgt die nächste Entscheidung** (§1): unter **30 s** bleibt es so; darüber
kommt der serverseitige Stapellauf der Fahrplan-Zeile.

---

## 9. Abgrenzung — was ausdrücklich nicht in V9 gehört

| | wohin | warum nicht hier |
|---|---|---|
| `factor_forward` / `factor_backward`, `ascent` / `descent` | **V11** | Verlangt das Höhenfeld. Es wird **heute** umgebaut (`90a55aad` Grate in der Basis, `d1eedf55` Erhebungen bis 24; `2026-07-29-landschaften-v8-fortsetzung.md` offen). V11s Klemme `[0,5…4,0]` und die Ausnahmenliste (`Gebirgspass` ist heute schon 2,67× langsamer, und die Tabelle ist **veröffentlicht**) sind zudem nicht entschieden. |
| Anzeige im Routenplaner | **V10** | `buildRouteLegPopupHtml` (`route-plan.js:196`), Flora über `buildLoreMarkup` — und **nur** über den DOM-Observer, nie beim Markup-Bau (Pool-Vorfall 2026-07-21). |
| öffentliche Leseschnittstelle | **V10** | Dort entscheidet sich Routenantwort vs. Karten-Nutzlast vs. eigener Endpunkt. V9 liest nur über `assignment_status` zurück. |
| Änderungen am Graph | **V11** | V9 fasst `client-graph.php` nicht an. |
| Querfeldein-Kanten | **V13/V14** | Keine `map_features`-Zeilen; sie entstehen zur Laufzeit aus der Transportauswahl. |
| automatische Neuberechnung bei jeder Flächenänderung | **später, falls überhaupt** | Solange der Lauf Sekunden dauert, ist ein Knopf ehrlicher als eine unsichtbare Automatik. Der Stempel macht „veraltet" sichtbar; das genügt, bis die Messung etwas anderes sagt. |

### 9.0 Der Routensimulator — Owner-Idee, nicht beauftragt, aber richtungsweisend

Owner 2026-07-29: „ein Routensimulator, wo ich Play drücke und die Route abfahre, die die
Helden gehen; wenn der Wald kommt, kann man die Animation pausieren und sagen *ihr betretet
nun den Farindelwald*."

**Nicht Teil von V9.** Steht hier, weil es die erste Anwendung ist, für die diese Daten
gebaut werden, und weil vier Dinge daran schon jetzt entschieden sind:

1. **Er bestätigt `basis=1`.** Die Animation läuft über die **gezeichnete** Linie — das
   Männchen fährt sichtbar über die Straße, und „jetzt betrittst du den Wald" muss genau
   dann kommen, wenn es die gezeichnete Waldkante überquert. Mit Sehnen-Werten wäre der
   Auslöser im p90 um 10,8 px zu früh oder zu spät.
2. **Er arbeitet ganz in Kurvenlänge.** Position, Fortschritt und Auslöser gehören
   zusammen ins selbe Maß. Die **Reisezeit** kommt weiterhin aus dem Graphen (Sehne) —
   das ist kein Widerspruch, solange man sie nicht als Position missversteht: eine
   Erzählpause interessiert die Minute nicht.
3. 💣 **Die Richtung ist eine Falle.** Die gespeicherten Intervalle stehen in der
   **Zeichenrichtung des Wegs**. Eine Route kann ein Wegsegment rückwärts befahren; dann
   wird aus „Eintritt bei 3,28" ein Austritt bei `Gesamtlänge − 3,28`. Wer das vergisst,
   lässt die Helden den Wald verlassen, bevor sie ihn betreten. Dieselbe Falle steht für
   V11 in der Fahrplan-Zeile („`from`/`to` bleiben in gespeicherter Orientierung").
4. ⚠️ **Wiedereintritte sind echt, nicht verschmelzbar.** Der Simulator würde am Tommel
   dreizehnmal „ihr betretet das Winhaller Land" sagen. Naheliegend wäre, kurze Lücken zu
   verschmelzen — **gemessen bringt das fast nichts**, weil die Lücken keine Zittern sind,
   sondern echte Geographie:

   | Lücke zwischen zwei Durchquerungen desselben Paars | |
   |---|---|
   | Median | **2,09 Meilen** |
   | p75 | 4,32 Meilen |
   | p90 | 8,60 Meilen |

   Bei einer Schwelle von 0,6 Meilen verschmelzen **97 von 597** Lücken (4.426 → 4.329
   Ereignisse); erst bei 3 Meilen sind es 375. Die Antwort ist also **keine
   Abstandsschwelle**, sondern eine Erzählregel: je Fläche **einmal** ankündigen, oder
   ein Wiedereintritt erst nach längerer Abwesenheit. Das entscheidet der Simulator,
   nicht der Speicher — und der Speicher hält beides offen, weil er die Intervalle
   einzeln hält (§5.5).

### 9.1 🔴 Was V9 ausdrücklich **nicht** freischaltet: Idee #44 und A\*

Geprüft am 2026-07-29 auf die Frage des Owners, ob für A\* und Querfeldein hier schon
etwas vorbereitet werden muss. **Antwort: eine Regel (§5, der linienagnostische Kern) —
sonst nichts.** Die Begründung ist wichtiger als die Antwort, damit sie nicht neu
hergeleitet werden muss:

**A\* braucht von V9 gar nichts.** Es ist eine Suchstrategie mit einer Luftlinien-Heuristik
und fragt keine Landschaftsdaten. V4 hat entschieden: clientseitig, auf Abruf, nicht
vorberechnet (858–1.129 Querfeldein-Kanten, abhängig von der Transportauswahl des
Nutzers und damit zur Laufzeit veränderlich).

**Querfeldein kann strukturell nicht in `path_ecosystem` liegen.** Der PK ist
`path_id` = `map_features.id`. Eine Querfeldein-Kante hat keine solche Zeile: sie entsteht
in `connectDetachedGraphComponents` (`js/routing/route-graph-routing.js:49`) zur Laufzeit,
und zwar heute ausschließlich, um **abgetrennte Graph-Komponenten** anzubinden — eine
Kante je Komponente, nicht ein Querfeldein-Netz. Idee #44 („Zielort setzen" auf einen
beliebigen Kartenpunkt) verlangt Kanten, die es vor dem Rechtsklick überhaupt nicht gibt.

**Der echte Engpass für #44 und V13 liegt woanders — und V9 räumt ihn nicht weg:**

> 💣 **Die öffentliche Karte lädt heute NULL Polygone.** Live nachgezählt: die
> `map-features`-Nutzlast enthält 5.650 `LineString`-Wege, 163 Kraftlinien und 5.241
> Punkte — **keine einzige Fläche**. Ökosystemflächen kommen aus einem eigenen Endpunkt,
> politische Gebiete aus einem dritten. Eine clientseitige Prüfung „schneidet diese
> Luftlinie Wasser" hat also **nichts, wogegen sie prüfen könnte**. Das ist V13s erste
> Aufgabe, nicht V9s.

Zwei Wege stehen V13 dafür offen; die Entscheidung gehört in V13s eigenen Plan:

| | Weg | Preis |
|---|---|---|
| a | Wasserflächen an den Client ausliefern | 293 `see` + 36 `meer` sind der Löwenanteil der heutigen 0,94 MB — und sie wachsen |
| b | **Eine Wasser-Rastermaske** | 1024×1024 Bit = 128 KB roh, als PNG ein Bruchteil. „Schneidet die Luftlinie Wasser" wird ein Bresenham-Lauf über ein Bitfeld: Mikrosekunden, keine Polygone, kein Nutzlastproblem |

> ⭐ **Weg (b) ist fast geschenkt, und das ist der Fund dieser Prüfung:** die
> Produktions-Wassermaske **existiert bereits** — `water_mask()` in
> `tools/ecosystem/ecosystem_raster.py`, aus V5, abgeleitet aus den ausgelieferten
> Kartenkacheln und gegen die Vorlage der Kachel-Werkzeugkette geankert (samt der einen
> gemessenen Korrektur `WATER_BLUE_OVER_GREEN = -20`). Sie hat 124 Flächen erzeugt und ist
> erprobt. V13 müsste sie nicht bauen, sondern nur ausgeben.

**Idee #44 braucht zusätzlich etwas, das weder V9 noch V13 liefert:** einen beliebigen
Kartenpunkt in den Graphen einhängen — nächstgelegener Punkt **auf einem Weg**, nicht nur
nächstgelegener Knoten. Das ist Routing-Arbeit und hat mit Landschaften nichts zu tun.

---

## 10. Offene Owner-Entscheidungen

| | Frage | Vorschlag |
|---|---|---|
| **1** | `affects_paths = 0` für `meer`, `kontinent`, `kueste`? | **Ja** — 90 % der Arbeit, 64 % der Zeilen, kein Aussagewert (§3.1). Per Datenzeile umkehrbar. |
| **2** | Rechnen die **66 Erprobungsflächen** mit? | **Ja.** Sie sind sichtbar, solange die Erprobung läuft. |
| **3** | Alle 5.650 Wege oder nur die 5.512 routingfähigen? | **Alle 5.650.** V10 ist Anzeige — ein Weg außerhalb des Graphen führt trotzdem durch einen Wald. |

---

## 11. Aufwand und Risiko

| | |
|---|---|
| Rechenkern Teil C (rein, testbar, beide Bezüge) | ~170 Zeilen JS |
| Knopf: rechnen, speichern, messen, Status | ~180 Zeilen JS |
| Weg-Geometrie-Endpunkt | ~70 Zeilen PHP |
| DDL + vier Speicher-Aktionen | ~230 Zeilen PHP |
| Tests | ~250 Zeilen |
| **Risiko** | **gering bis mittel.** Der Rechenkern ist offline gegen den Livebestand nachgerechnet, der Vorfilter und die Knopf-Mechanik existieren. Der einzige offene Punkt ist die Laufzeit im Browser — und die zu messen ist der Auftrag, nicht ein Nebenprodukt. |
