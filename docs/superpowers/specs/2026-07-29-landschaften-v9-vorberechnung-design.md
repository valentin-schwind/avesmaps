# Landschaften V9 — Vorberechnung Wege × Flächen — Design

**Stand:** 2026-07-29 · **Auftraggeber:** Owner · **Vorgänger:** V8 ✅ live
(Fortsetzung offen) · **Fahrplan-Zeile:** `docs/superpowers/plans/2026-07-24-landschaften.md`
Zeile 2131 · **Abnehmer:** V10 (Zeile 2132), V11 (Zeile 2136).

---

## 0. Kurzfassung

Die Karte kennt heute 5.650 Wege und 647 Landschaftsflächen — aber keine Verbindung
zwischen beiden. V9 baut sie: eine Tabelle, die für jeden Weg festhält, **von welcher
Bogenlänge bis zu welcher er durch welche Fläche verläuft**.

V9 ist **für sich unsichtbar**. Es ist die Grundlage für V10 („Führt durch: Farindelwald"
+ Flora am Routensegment — das erste sichtbare Ergebnis) und V11 (Terrain auf
Kantengewichte).

**Owner-Entscheid 2026-07-29:** V9 = Fahrplan-Zeile, nichts darüber hinaus.
Die Gebirgs-Bremse (`factor_forward`/`factor_backward` aus
`docs/oekosystem-instruction.md` §2, dort als „Stufe 3" markiert) gehört **zu V11**,
nicht hierher. Begründung §9.

---

## 1. Was V9 ist — und was es nicht ist

| | |
|---|---|
| **ist** | zwei Tabellen, ein Rechenkern (Geometrie), ein resumierbarer Stapellauf, ein Knopf, Neuberechnung bei Änderungen |
| **ist nicht** | Höhenfeld in PHP, Tempofaktoren, Auf-/Abstieg, Änderungen am Routing, Änderungen an der Karten-Nutzlast, eine Leseschnittstelle für V10 |

Die **Leseschnittstelle gehört zu V10**: erst dort steht fest, ob die Intervalle in die
Routenantwort, in die Karten-Nutzlast oder in einen eigenen Endpunkt gehören. V9 macht
sein Ergebnis nur über die eigene `status`-Aktion sichtbar (§7), damit der Lauf prüfbar
ist.

---

## 2. Mengengerüst — live gemessen, nicht geschätzt

Gemessen **2026-07-29** gegen den Livebestand (`ecosystem_revision` 3082): je eine
Anfrage an `GET /api/app/ecosystem-areas.php` (981 KB) und
`GET /api/app/map-features.php`, danach offline nachgerechnet.

| | Wert |
|---|---|
| Wege (`feature_type='path'`, aktiv) | **5.650** — davon laut V4 5.512 routingfähig |
| Stützpunkte aller Wege | 41.769 → **36.119 Segmente** (Median 5 je Weg, p90 14, max 99) |
| Flächen (aktiv) | **647** (davon 66 Erprobung) |
| Ecken aller Flächen | 31.797 (Median 17, p90 72, max 3.276) |

### 2.1 Zwei Flächen erzeugen 90 % der Rechenarbeit

| | alle 647 Flächen | ohne `meer`/`kontinent`/`kueste` |
|---|---|---|
| bbox-Tests | 3.655.550 | 3.655.550 |
| bbox-Paare (Treffer) | 22.688 (0,62 %) | **7.362** |
| Kantentests danach | **183.529.247** | **17.594.000** |
| Paare mit echtem Schnitt | 11.449 | 3.829 |
| **Zeilen in `path_ecosystem`** | **12.302** | **4.426** |

Die beiden Verursacher, einzeln gemessen:

| Fläche | Ecken | getroffene Wege | Kantentests | Anteil |
|---|---|---|---|---|
| `Meer-001` (topographie/meer) | 3.050 | 5.650 | 110.162.950 | **60,0 %** |
| `Aventurien` (derographisch/kontinent) | 1.539 | 5.501 | 54.542.160 | **29,7 %** |

Sie erzeugen zusammen **7.837 Zeilen ohne Aussagewert**: „diese Route führt durch
Aventurien" gilt für jede Route der Karte, und `Meer-001` trifft jeden Seeweg, der
ohnehin ein Seeweg ist.

> ⚠️ **Die Analyse (§E) unterschätzte das um Faktor 10.** Dort standen 8.329 Paare und
> 18,2 Mio Kantentests — gemessen an **175** Flächen. Mit 647 sind es 22.688 Paare und
> 183,5 Mio Tests. Der Vorfilter skaliert **nicht** unterproportional; er ist gegen ein
> kontinentgroßes Polygon wirkungslos, weil dessen bbox alles enthält.

### 2.2 Der Zielstand, nicht der heutige Bruchteil

Owner-Einwand 2026-07-29: „wir haben jetzt nur einen Bruchteil der Karte." Gegen die
Label-Bestände nachgezählt (Labels = Obergrenze der noch zu zeichnenden Flächen):

| Typ | Flächen heute | Labels | fehlen |
|---|---|---|---|
| derographische Region | 11 | 111 | 100 |
| Wald | 13 | 70 | 57 |
| Gebirge | 8 | 63 | 55 |
| Tal | 0 | 26 | 26 |
| Sümpfe/Moore | 6 | 31 | 25 |
| Auenlandschaft | 0 | 8 | 8 |
| übrige | — | — | 19 |
| **Summe** | **647** | | **~290 → Zielstand ~937** |

*(`insel` und `see` wachsen nicht mit den Labels — V5 leitete sie aus Kacheln ab,
254 bzw. 293 Flächen gegen 96 bzw. 53 Labels.)*

Die fehlenden 290 sind **kleine, handgezeichnete** Flächen. Grob hochgerechnet landet
`path_ecosystem` bei **~20.000 Zeilen** — im Rahmen der Analyse („~16.000 realistisch,
Obergrenze 72.000", §8.7) und weit unterhalb dessen, was 4-Sekunden-Schritte nicht
schaffen. **Mit** Meer und Kontinent wären es ~60.000, davon zwei Drittel Rauschen.

### 2.3 Warum nicht clientseitig

Ein naheliegender Einwand: der Browser hat die Flächen ohnehin, er könnte „welche Fläche
liegt an diesem Segment" beim Routenbau selbst rechnen. **Scheidet aus:** die
Flächengeometrie ist heute **0,94 MB** und wird beim Zielstand eher 2–3 MB. Die
öffentliche Karte lädt sie heute gar nicht und soll es nicht anfangen — ihre eigene
Nutzlast ist gemessen schon **17,79 MB** (2,6 MB übertragen). Der Server rechnet einmal,
alle lesen.

---

## 3. Die Tabellen

### 3.1 `path_ecosystem` — das Ergebnis

```sql
CREATE TABLE IF NOT EXISTS path_ecosystem (
    path_id BIGINT UNSIGNED NOT NULL,
    area_id INT UNSIGNED NOT NULL,
    seq TINYINT UNSIGNED NOT NULL,
    enter_distance_mapunits DECIMAL(10,4) NOT NULL,
    exit_distance_mapunits  DECIMAL(10,4) NOT NULL,
    PRIMARY KEY (path_id, area_id, seq),
    KEY idx_path_ecosystem_area (area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

**Spaltentypen — jede einzeln begründet:**

- `path_id BIGINT UNSIGNED` = `map_features.id`, **nicht** `public_id VARCHAR(36)`.
  Analyse §8.7: der PK wäre 41 statt 13 Bytes, die Zeile ~100 statt ~23, und jeder
  Sekundärindex schleppte ihn mit. `path_ecosystem` ist **abgeleiteter Cache**, kein
  fachlicher Link — abgeleitete Daten dürfen auf die interne `id` zeigen.
- `area_id INT UNSIGNED` — **nicht** BIGINT. `ecosystem_area.id` ist `INT UNSIGNED`;
  die Fahrplan-Zeile sagt pauschal „BIGINT", das gilt nur für `path_id`. Eine Spalte
  breiter als ihr Ziel kostet Platz und verschleiert die Herkunft.
- `seq TINYINT UNSIGNED` — der Zähler der Durchquerungen eines Paars. Gemessen:
  3.585 Paare mit 1 Intervall, das Maximum liegt bei **13**. 255 ist reichlich; der
  Rechenkern bricht bei >255 ab und schreibt den Weg als Anomalie fort (§5.4), damit
  eine kaputte Geometrie nicht still abgeschnitten wird.
  PK = 8+4+1 = **13 Bytes**, genau die Zahl aus der Analyse.
- `enter_distance_mapunits` / `exit_distance_mapunits` — Bogenlänge ab Wegbeginn in
  **Karteneinheiten**, derselben Einheit wie `map_features.min_x` und wie
  `calculatePathCoordinateDistance`. **Die Einheit steht im Feldnamen**, und zwar
  wegen der Falle, die dieses Projekt schon einmal bezahlt hat: `1 Karteneinheit =
  3.000 Schritt`. Wer die Graph-Distanz als Meilen liest, überhöht eine Steigung um
  3× und das Signal um 23× (Analyse §F, Instruction §5.0). V9 rechnet keine Steigung —
  aber V11 liest diese Spalten, und dann zählt der Name.

**Kein Surrogat-PK.** `(path_id, area_id, seq)` ist der natürliche Schlüssel, macht die
Neuberechnung idempotent, und InnoDB clustert danach: der Bulk-Read fürs Routing liest
sequenziell in Wegreihenfolge.

`KEY (area_id)` beantwortet „Fläche geändert → welche Wege sind stale?" (§6).

### 3.2 `path_ecosystem_state` — was gerechnet wurde

```sql
CREATE TABLE IF NOT EXISTS path_ecosystem_state (
    path_id BIGINT UNSIGNED NOT NULL,
    path_revision BIGINT UNSIGNED NOT NULL,
    ecosystem_revision INT UNSIGNED NOT NULL,
    interval_count SMALLINT UNSIGNED NOT NULL,
    computed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (path_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

> 💣 **Diese Tabelle existiert wegen der Null.** Von 5.650 Wegen schneiden gemessen nur
> **3.829** überhaupt eine Fläche — **1.821 Wege liefern null Zeilen**, und das ist ein
> *gültiges, endgültiges* Ergebnis. Würde „fällig" aus `path_ecosystem` selbst
> abgeleitet („hat der Weg keine Zeile, muss er gerechnet werden"), wären diese 1.821
> **für immer fällig** und der Lauf endete nie. Genau dieselbe Lehre steht wörtlich in
> `api/_internal/app/citymaps.php` („without a state for *tried, found nothing* the next
> step finds the same map due again and the run never ends — the linkchecker paid for
> that lesson"). **Jedes Ergebnis schreibt einen Zustand, auch das leere.**

- `path_revision` = `map_features.revision` des Wegs zum Rechenzeitpunkt. Damit ist
  „der Weg selbst wurde bearbeitet" ohne Zusatzaufwand erkennbar.
- `ecosystem_revision` = der globale Zähler zum Rechenzeitpunkt. Diagnose und die
  Grundlage für ein späteres „alles vor Revision N neu".
- `interval_count` — redundant zu `COUNT(*)`, aber es macht die Statusanzeige zu einer
  Aggregation über 5.650 kleine Zeilen statt über 20.000, und es unterscheidet
  „gerechnet, nichts gefunden" von „nie gerechnet" ohne Join.

### 3.3 `ecosystem_region_type.affects_paths` — welche Arten mitrechnen

```sql
ALTER TABLE ecosystem_region_type ADD COLUMN affects_paths TINYINT(1) NOT NULL DEFAULT 1
```

Startwerte beim Nachrüsten: `0` für `meer`, `kontinent`, `kueste` — **alles andere 1**.
Begründung: §2.1 (90 % der Arbeit, 64 % der Zeilen, kein Aussagewert).

> 🔧 **DU (Owner):** Das ist eine Datenzeile, kein Code. Willst du „führt durchs
> Perlenmeer" doch sehen, setzt du `affects_paths=1` für `meer` und lässt einmal
> neu rechnen. Nichts daran ist einbetoniert.

> 💣 **Der Startwert-Block wird PRO SPALTE bewacht**, nicht durch ein gemeinsames
> „war neu"-Flag. `avesmapsEcosystemEnsureTables` trägt diese Lehre schon im Kommentar:
> ein globales Flag hätte beim Nachrüsten von `terrain_mean_height` jede Owner-Anpassung
> an `terrain_grain` still auf die Werte von 2026-07-28 zurückgesetzt.

**Nicht** `affects_routing`, und **nicht** `speed_factor`. Beide stehen in
`docs/oekosystem-instruction.md` §2 und gehören zu V11. `affects_paths` beantwortet eine
andere Frage: *nimmt diese Art an der Vorberechnung überhaupt teil*. V10 ist Anzeige,
nicht Routing — ein gemeinsamer Name für beides wäre in einem halben Jahr eine Falle.

### 3.4 Wo die DDL steht

In **`avesmapsEcosystemEnsureTables`** (`api/_internal/app/ecosystem.php`), zusammen mit
den übrigen Ökosystem-Tabellen. Zwei Gründe:

1. Der **Schritt-Pfad darf kein DDL ausführen** (§5.3). Liegt die DDL in der Funktion,
   die bei jedem Flächen-Schreibvorgang und jedem `ecosystem-areas.php` ohnehin läuft,
   existieren die Tabellen garantiert, bevor der erste Schritt startet.
2. Der **Invalidierungs-Haken** (§6) schreibt aus dem Flächen-Save heraus in
   `path_ecosystem_state`. Läge die DDL woanders, müsste er eine womöglich fehlende
   Tabelle abfangen.

Kosten: zwei zusätzliche `CREATE TABLE IF NOT EXISTS` (No-Ops) plus **eine** weitere
`information_schema`-Abfrage in der Schleife, die dort schon vier macht.

---

## 4. Der Rechenkern — Geometrie

Reine Funktionen in einer neuen Datei `api/_internal/app/path-ecosystem-geometry.php`,
ohne PDO, ohne Seiteneffekte beim Einbinden — damit sie unit-testbar sind (Muster:
`api/_internal/app/autoget-run.php`).

### 4.1 Ablauf je Paar (Weg × Kandidatenfläche)

1. **Bogenlängen** des Wegs kumulieren (`hypot` je Segment) → `cum[i]`, `total`.
2. **Schnitte** jedes Wegsegments mit jeder Polygonkante, Parameterform. Für jeden
   Treffer die Bogenlänge `cum[i] + t · |Segment|` merken.
3. **Startzustand** per Ray-Cast am ersten Wegpunkt: liegt er innerhalb?
4. **Umklappen** an jedem Schnitt, sortiert nach Bogenlänge. Jedes Teilstück mit
   Zustand „innen" wird eine Zeile.

Löcher (`MultiPolygon`, innere Ringe) brauchen **keine Sonderbehandlung**: ihre Kanten
klappen den Zustand genauso um, und der Ray-Cast zählt sie über die Parität mit.

### 4.2 Die halboffene Regel

Schnittparameter gelten als Treffer für `t ∈ [0,1)` und `u ∈ [0,1)` — auf **beiden**
Seiten halboffen. Sonst zählt ein Weg, der genau durch eine Polygonecke läuft, zwei
Schnitte statt einen, und das Intervall kippt in die falsche Richtung. Mit dieser Regel
gemessen ergibt sich die plausible Verteilung aus §2.1 (3.585 × 1 Intervall, dann
schnell abfallend).

### 4.3 Was nicht gerechnet wird

Kein Höhenfeld, keine Tempokurve, keine Gauß-Quadratur, keine Auf-/Abstiegssummen. Das
ist V11 (§9).

### 4.4 Nulllängen und Entartungen

- Weg mit `total = 0` (alle Stützpunkte gleich) → 0 Intervalle, Zustand geschrieben.
- Intervall kürzer als `1e-9` Karteneinheiten → verworfen (Tangente an einer Ecke).
- Fläche ohne Kanten (leere Geometrie) → übersprungen.
- \>255 Intervalle für ein Paar → Weg wird mit `interval_count = 0` und einem Eintrag
  im Lauf-Bericht als Anomalie abgeschlossen, **nicht** stillschweigend abgeschnitten.

---

## 5. Der Stapellauf

Endpunkt **`api/edit/map/path-ecosystem-run.php`**, POST, Capability `edit`.
Vorbild in Form und Warnung: `api/edit/map/citymap-autoget.php`.

Aktionen: `status` · `run_step` · `reset`.

### 5.1 Die fällige Menge und der Cursor

```sql
SELECT p.id, p.revision, p.geometry_json, p.min_x, p.min_y, p.max_x, p.max_y
  FROM map_features p
  LEFT JOIN path_ecosystem_state s ON s.path_id = p.id
 WHERE p.feature_type = 'path' AND p.is_active = 1
   AND (s.path_id IS NULL OR s.path_revision <> p.revision)
 ORDER BY p.id
 LIMIT :batch
```

> 💣 **Kein `OFFSET`.** Über eine sich ändernde Menge überspringt es Zeilen. Der Cursor
> ist die Bedingung selbst: ein fertig gerechneter Weg bekommt sofort seinen
> Zustandssatz und fällt damit aus der Menge. `ORDER BY p.id` macht die Reihenfolge
> stabil und den Index nutzbar.

> 💣 **Kein Leasing.** Es wird nichts vorab reserviert. Der Zustand wird **je Weg direkt
> nach dessen Berechnung** geschrieben. Wer einen Stapel least und dann ins Zeitbudget
> läuft, dessen Fällig-Abfrage sieht nichts mehr, meldet `remaining=0` und erklärt einen
> halb gelaufenen Durchgang für fertig — wörtlich
> `api/_internal/app/citymaps.php:319–325`.

### 5.2 Der bbox-Vorfilter als SQL-Join

Einmal je Schritt, für die Wege des Stapels:

```sql
SELECT p.id AS path_id, a.id AS area_id
  FROM map_features p
  JOIN ecosystem_area a
    ON a.min_x <= p.max_x AND a.max_x >= p.min_x
   AND a.min_y <= p.max_y AND a.max_y >= p.min_y
  JOIN ecosystem_region r ON r.id = a.region_id AND r.is_active = 1
  LEFT JOIN ecosystem_region_type t ON t.kind = r.kind AND t.type_key = r.region_type
 WHERE p.id IN (…) AND a.is_active = 1
   AND COALESCE(t.affects_paths, 1) = 1
```

Nutzt `idx_ecosystem_area_bbox`. Erledigt gemessen 3,66 Mio Tests im Index und liefert
7.362 Paare (0,20 % der Tests). Die Geometrien der **distinkten** Flächen des Schritts
werden danach in **einer** Abfrage geholt und im Schritt im Speicher gehalten — dieselbe
Fläche kommt im Median bei 4 Wegen vor, p90 bei 6.

**Kein `ST_Intersects`.** Die Geometrie läge zweimal vor (JSON + `GEOMETRY`) und könnte
auseinanderlaufen, und der Lauf braucht keinen Booleschen Wert, sondern die
Bogenlängen — die liefert keine MySQL-Funktion.

> ⚠️ `COALESCE(t.affects_paths, 1) = 1`: eine Fläche mit `region_type IS NULL` (live: 13
> Stück) hat keine Typzeile und nimmt damit teil. Das ist die konservative Richtung —
> „unbekannte Art" darf nicht heißen „stillschweigend weggelassen".

### 5.3 Die vier Schutzmechanismen

Alle vier über **`avesmapsAutogetGuardedStep`** (`api/_internal/app/autoget-run.php`) —
feature-agnostisch, unit-getestet, schon zweimal im Einsatz.

| | |
|---|---|
| **Sperre** | `GET_LOCK`, verbindungsgebunden, nicht blockierend. **Eigener Name** `avesmaps_path_ecosystem`, nicht der geteilte `avesmaps_preview_autoget`: jener Lauf ist I/O-gebunden (wartet aufs Wiki), dieser rechnet. Sie gegeneinander zu sperren senkt kein Risiko, macht aber ein `busy` unerklärbar. Zweiter Tab / Reload / Agent bekommt `{busy:true}`. |
| **Budget** | `AVESMAPS_AUTOGET_STEP_BUDGET_SECONDS = 4.0`, **wiederverwendet, keine zweite Zahl**. Geprüft nach **jedem Weg**. Nicht die 28 s des Dumps — die sind für I/O kalibriert; ein 28-s-CPU-Schritt ist exakt `aborted: read failed`. |
| **Notaus** | `app_setting['path_ecosystem_run']`, per SQL umlegbar, **zuerst** geprüft, vor der Sperre. Stoppt tab-übergreifend (der Browser-Stop bricht nur einen Tab ab, PHP läuft nach einem Disconnect weiter). |
| **Zeitlimit** | `@set_time_limit(4 + 15)` zu Beginn des Endpunkts. |

> 💣 **Kein `EnsureTables` im Schritt-Pfad.** Es macht `information_schema`-Sonden bei
> jedem Schritt — genau die Last des Pool-Vorfalls vom 2026-07-17 — und es führt **DDL
> auf der Tabelle aus, in die der Schritt gerade schreibt**. Ein `ALTER TABLE` mitten in
> einer Transaktion beendet sie still (implizites Commit). `status` und `reset` rufen
> `EnsureTables`; `run_step` nie.

### 5.4 Idempotenz

Je Weg, in **einer** Transaktion, ohne jedes DDL:

```
BEGIN
  DELETE FROM path_ecosystem WHERE path_id = :id
  INSERT INTO path_ecosystem (…) VALUES …          -- 0..n Zeilen
  REPLACE INTO path_ecosystem_state (…) VALUES (…) -- IMMER, auch bei 0 Zeilen
COMMIT
```

Zweimal denselben Weg zu rechnen ergibt exakt dasselbe Bild. Ein Abbruch mitten im Lauf
hinterlässt keinen halben Weg.

---

## 6. Neuberechnung im Betrieb

**Niemals die ganze Karte, niemals pro Routenanfrage.** Zwei Auslöser:

1. **Weg bearbeitet** → `map_features.revision` ändert sich → die Fällig-Bedingung
   (§5.1) greift von allein. **Kein Haken nötig.**
2. **Fläche gespeichert, verschoben oder gelöscht** → ein Haken in den Schreibpfaden von
   `api/_internal/app/ecosystem.php` löscht die Zustandssätze aller Wege, deren bbox die
   **alte oder neue** bbox der Fläche schneidet:

```sql
DELETE s FROM path_ecosystem_state s
  JOIN map_features p ON p.id = s.path_id
 WHERE p.min_x <= :max_x AND p.max_x >= :min_x
   AND p.min_y <= :max_y AND p.max_y >= :min_y
```

Zustandssatz weg = Weg fällig. Die alten Zeilen in `path_ecosystem` bleiben bis zur
Neuberechnung stehen — kurzzeitig veraltet, nie widersprüchlich (V10 zeigt dann für ein
paar Minuten eine Fläche, die sich leicht verschoben hat; das ist der richtige
Kompromiss gegen ein Loch in der Anzeige).

> 💣 **Alte *und* neue bbox.** Wird eine Fläche verkleinert, liegen die Wege, die sie
> gerade verlassen hat, außerhalb der neuen bbox — nur die alte findet sie. Wer nur die
> neue nimmt, lässt genau die Wege stehen, die falsch geworden sind.

Ein Volllauf bleibt über `reset` möglich (löscht alle Zustandssätze, nicht die Daten).

---

## 7. Oberfläche

Im **Landschaften-Editor** (`html/landschaften-editor.html`,
`js/review/review-ecosystem-list.js`) ein Abschnitt „**Landschaftseinflüsse berechnen**".
Client-Schleife nach dem Muster `js/review/review-citymap-autoget.js` (101 Zeilen):
ruft `run_step`, bis `done`, und behandelt `busy` und `stopped`.

**Der Knopf trägt seinen Status** (Hausregel): *„Berechnen — 1.842 von 5.650 offen"*,
während des Laufs *„… 3.210 offen"*, danach *„Alles berechnet · 4.426 Abschnitte"*.

`status` liefert zusätzlich eine **Stichprobe**: ein gerechneter Weg mit seinen
Intervallen und den Flächennamen. Ohne sie ist ein erfolgreicher Lauf von einem
erfolgreich leeren nicht zu unterscheiden — und V9 hat sonst keine sichtbare Wirkung,
an der man ihn prüfen könnte.

---

## 8. Nachweis

### 8.1 Unit-Tests

`api/_internal/app/__tests__/path-ecosystem-geometry-test.php`, ausgeführt mit
`php -d extension=mbstring -d zend.assertions=1`:

| Fall | Erwartung |
|---|---|
| Weg außerhalb | 0 Intervalle |
| Weg quer durch ein Rechteck | 1 Intervall, Bogenlängen exakt |
| Weg startet innen, endet außen | 1 Intervall ab 0 |
| Weg vollständig innen | 1 Intervall, `0 … total` |
| konkave Fläche, drei Durchquerungen | 3 Intervalle, `seq` 0/1/2 |
| MultiPolygon mit Loch | Loch erzeugt Lücke |
| Weg genau durch eine Polygonecke | **1** Schnitt, nicht 2 (halboffene Regel) |
| Weg mit `total = 0` | 0 Intervalle, kein Fehler |
| Tangente (Intervall < 1e-9) | verworfen |

`api/_internal/app/__tests__/path-ecosystem-run-test.php`:

| Fall | Erwartung |
|---|---|
| gerechneter Weg | fällt aus der Fällig-Menge |
| **Weg mit 0 Intervallen** | fällt ebenfalls heraus — die Endlosschleifen-Sperre |
| Weg danach bearbeitet (`revision` neu) | wieder fällig |
| Fläche in seiner bbox gespeichert | wieder fällig |
| zweimal gerechnet | identische Zeilen |

### 8.2 Abnahme am Livebestand

Der Lauf muss auf dem Stand von `ecosystem_revision` 3082 exakt reproduzieren, was
offline gemessen wurde:

| | mit `affects_paths`-Filter | ohne Filter |
|---|---|---|
| bbox-Paare geprüft | 7.362 | 22.688 |
| Paare mit ≥1 Intervall | 3.829 | 11.449 |
| **Zeilen in `path_ecosystem`** | **4.426** | 12.302 |

> ⚠️ **Vor der Abnahme neu zählen.** Der Bestand wächst täglich; die Zahl ist ein
> Abgleich gegen eine offline nachgerechnete *Nutzlast*, nicht gegen eine Konstante.
> Das Verfahren (eine Anfrage je Endpunkt, danach offline) steht in §2.

### 8.3 Was **nicht** als Nachweis zählt

Eine im Browser oder in Node nachgebaute Szene. Beide Messorte kehren in diesem Projekt
schon Rangfolgen um. Der Zeitbedarf des Schritts wird **am Livebestand über den
Endpunkt** gemessen — eine einzelne Anfrage, nie in einer Schleife.

---

## 9. Abgrenzung — was ausdrücklich nicht in V9 gehört

| | wohin | warum nicht hier |
|---|---|---|
| `factor_forward` / `factor_backward` | **V11** | Verlangt das Höhenfeld in PHP. Das Feld wird **heute** umgebaut (`90a55aad` Grate in der Basis, `d1eedf55` Erhebungen bis 24; `2026-07-29-landschaften-v8-fortsetzung.md` offen). Eine Übersetzung veraltet während sie entsteht. Zudem sind V11s Klemme `[0,5…4,0]` und die Ausnahmenliste (`Gebirgspass` ist heute schon 2,67× langsamer, und die Tabelle ist **veröffentlicht**) noch nicht entschieden — ein daraus gerechneter Faktor müsste ohnehin neu gerechnet werden. |
| `ascent` / `descent` | **V11** | Anzeigewerte des Höhenprofils, dasselbe Argument. |
| Leseschnittstelle | **V10** | Dort entscheidet sich Routenantwort vs. Karten-Nutzlast vs. eigener Endpunkt. |
| Änderungen am Graph | **V11** | V9 fasst `client-graph.php` nicht an. |
| Querfeldein-Kanten | **V13/V14** | Sie sind keine `map_features`-Zeilen und entstehen zur Laufzeit aus der Transportauswahl. |

Nachrüsten kostet **zwei Spalten und einen `reset`** — die Tabelle ist genau dafür
gebaut. Das ist der Preis der Trennung, und er ist niedrig.

---

## 10. Offene Owner-Entscheidungen

| | Frage | Vorschlag |
|---|---|---|
| **1** | `affects_paths = 0` für `meer`, `kontinent`, `kueste`? | **Ja** — 90 % der Arbeit, 64 % der Zeilen, kein Aussagewert (§2.1). Jederzeit per Datenzeile umkehrbar. |
| **2** | Sollen die **66 Erprobungsflächen** (`is_trial=1`) mitrechnen? | **Ja.** Sie sind sichtbar, solange die Erprobung läuft; sie auszunehmen erzeugte eine Anzeige, die von einem unsichtbaren Schalter abhängt. |
| **3** | Alle 5.650 Wege oder nur die 5.512 routingfähigen? | **Alle 5.650.** V10 ist Anzeige, nicht Routing — ein Weg, der nicht im Graph steckt, führt trotzdem durch einen Wald. |

---

## 11. Aufwand und Risiko

| | |
|---|---|
| Rechenkern (rein, testbar) | ~180 Zeilen PHP |
| Endpunkt + Lauf | ~200 Zeilen PHP |
| DDL + Invalidierungs-Haken | ~90 Zeilen PHP |
| Oberfläche + Client-Schleife | ~120 Zeilen JS |
| Tests | ~250 Zeilen |
| **Risiko** | **mittel** — die Schutzmechanismen sind fertig und erprobt, die Geometrie ist offline gegen den Livebestand nachgerechnet. Der gefährlichste Punkt bleibt der Zeitbedarf je Schritt auf STRATO; er wird an einer einzelnen echten Anfrage gemessen, nicht geschätzt. |
