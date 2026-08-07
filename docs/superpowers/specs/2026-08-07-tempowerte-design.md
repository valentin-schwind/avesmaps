# Tempowerte — die GA-Zahlen an einer Stelle, sichtbar und einstellbar

**Stand:** 2026-08-07 · **Mockup:** `docs/tempowerte-mockup.html` · **Owner-Abstimmung:** diese Sitzung

---

## 1. Der Anlass, und warum er sich beim Messen gedreht hat

Owner-Meldung: „bei der Wegfindung berücksichtigt A\* zwar die Gebirge aber noch nicht die
einzelnen Regionstypen, Wälder und Sümpfe sollen isotrop verlangsamen sodass er gezwungen ist
drumherum zu gehen."

**Der Mechanismus existiert und wirkt.** Gemessen am 07.08.2026, ein einzelner
`POST /api/route/` mit zwei Punkten mitten in der Waldwildnis (x 377,4 → 382,4 / y 581,5),
`terrain:false`, damit nur der Boden übrig bleibt:

| | |
|---|---:|
| `distance_units` | 5,144 |
| `cost_units` | 7,172 |
| Grundtempo Querfeldein (`groupFoot`) | 0,96 |
| **effektiver Bodenfaktor** | **1,338** |
| `terrain_factors_known` | `true` |

`ecosystem_region_type.offroad_factor` steht für `wald` auf 1,40; 1,338 heißt, die Linie lag zu
rund 85 % in gezeichneten Waldflächen. Und der Faktor wirkt bereits isotrop —
[`offroad-grid.php:429`](../../../api/_internal/routing/offroad-grid.php) nimmt das **Maximum**
beider Zellen, damit ein Schritt in beide Richtungen gleich teuer ist.

**Der wirkliche Befund ist ein anderer.** Drückt man den Live-Bestand in die Einheit der Quelle
(Geländefaktor, Straße = 1,0), sind die *Verhältnisse* grob in Ordnung — der Sumpf steht mit
0,104 fast genau auf der GA-Zeile 0,1 —, aber **der Bezug ist um Faktor 2,4 zu langsam**:
Querfeldein liegt bei 0,313, die Quelle sagt 0,75 („offenes Gelände", GA S. 120–123). Das drückt
jede Landschaft nach unten und nimmt dem Wald genau den Kontrast, um den es geht.

Dazu zwei Dinge, die den Bau überhaupt erst nötig machen:

1. **Die Zahlen sind unsichtbar.** `offroad_factor` wird im ganzen Repo nur von der Saat
   geschrieben und vom A\* gelesen — kein Endpunkt, kein Editorfeld. Der Kommentar bei
   [`ecosystem.php:820`](../../../api/_internal/app/ecosystem.php) sagt „🔧 sie sind DATENZEILEN:
   der Owner ändert sie in der Datenbank" — es gibt dafür aber keine Oberfläche.
2. **Eine Codeänderung erreicht die Live-Datenbank nicht.** Der Saatblock steckt in
   `if (!$typeColumnExists($pdo, 'offroad_factor'))`; der Wächter feuert nur in dem Lauf, der die
   Spalte anlegt, und das war der 29.07.2026. Die Werte im Code umzuschreiben wäre wirkungslos.
   Das ist die zweite Hälfte von Befund **A35** (`docs/systemtest-2026-08-05/1-akut.md`).

---

## 2. Was der Owner entschieden hat

1. **Grundlage ist die Quelle** (Geographia Aventurica S. 120–123), einschließlich eines neuen
   Querfeldein-Grundtempos.
2. **Die Wirkung der Höhenprofile und der Pässe bleibt, wie sie ist.** `terrain-factor.php` und
   der `pass_normalizer` werden nicht angefasst.
3. **Die Verlangsamungen kumulieren.** Boden × Steigung, multiplikativ, wie heute. Keine Eichung,
   kein Sonderfall für vermessene Gebirge.
4. **Gezeichnete Wege tragen keinen Bodenfaktor** — unverändert; eine Straße durch den
   Reichsforst ist eine Straße.
5. **Alles, was bei uns eine GA-Konstante ist, wird einstellbar**, in einem Fenster namens
   **„Tempowerte"**, mit einem Knopf **„Auf GA-Werte zurücksetzen"** je Abschnitt.
6. Die Kachel sitzt im Menüband des Wege-Editors **zwischen „Wegprofile rechnen" und
   „Wegprofile kalibrieren"**.

---

## 3. Eine Einheit, und sie existiert schon

Alles in diesem Fenster steht in **einer** Einheit: dem **Geländefaktor der Quelle, Straße = 1,0**.

💣 **Das ist keine neue Skala.** `AVESMAPS_SEASON_GROUND_PATH_FACTORS`
([`season-ground.php:49`](../../../api/_internal/routing/season-ground.php)) *ist* diese Spalte,
inklusive `'Querfeldein' => 0.75`, und der Jahreszeiten-Abzug rechnet bereits darauf. Eine zweite
Skala daneben zu bauen wäre exakt der Fehler, den das Quellensystem 2026-07-21 einmal bezahlt hat
(AGENTS.md §5). Die Konstante wird also **abgelöst durch den Speicher**, nicht ergänzt.

💣 **Die alte Spalte `offroad_factor` wird nicht umgedeutet.** Sie hält den *Kehrwert* (1,40 für
Wald). Dieselbe Spalte mit 0,50 zu füllen hieße, dass jeder Altbestand, den die Migration nicht
erwischt — ein zurückgespieltes Backup, eine Entwicklungsdatenbank —, klaglos als „Wald ist 1,4×
schneller als eine Straße" gelesen wird, also als Beschleunigung. Es kommt eine **neue Spalte mit
eindeutiger Einheit**; die alte bleibt liegen und wird von niemandem mehr gelesen (der Deploy
löscht ohnehin nicht, AGENTS.md §10).

---

## 4. Was das Fenster enthält — die vollständige Liste der GA-Konstanten

Aufgenommen wird, was aus der *Geographia Aventurica* stammt. Was aus einer Messung oder aus
unserer eigenen Skalierung kommt, steht mit im Fenster, aber **gesperrt** — das ist der Unterschied
zwischen „Quelle" und „unsere Rechnung", und er muss sichtbar sein.

### 4.1 Tagesleistung je Reisemittel — GA S. 118 · 123 · 129 · 131 (11 Zahlen)

Fußgruppe 30 · Einzelwanderer 40 · berittene Gruppe 35 · Einzelreiter 50 · Karawane 30 ·
Kutsche 50 · Flusskahn 40 · Flusssegler 60 · Lastensegler 120 · Galeere 100 · Schnellsegler 250.

**Stimmen heute alle.** Der Bauplan bleibt der dokumentierte:
`Wert = Tagesleistung × mean_G × TIME_SCALE ÷ Reisestunden` — nachgerechnet für alle elf, auf 1 %.

⚠️ Die berittene Gruppe trägt einen echten Quellenwiderspruch (Tabelle 35, Fließtext S. 118
„kaum mehr als 40"); die Zeile sagt das, sie löst es nicht auf.

### 4.2 Geländespalte, Wegtypen — GA S. 120–123 (7 Zahlen)

| Wegtyp | heute | GA | |
|---|---:|---:|---|
| Reichsstraße | 1,12 | 1,10 | ≠ |
| Straße | 1,00 | 1,00 | Bezug |
| Weg | 0,88 | 0,80 | ≠ |
| Pfad | 0,75 | 0,80 | ≠ |
| Gebirgspass | 0,37 | 0,40 | ≠ |
| Wüstenpfad | 0,63 | 0,50 | ≠ |
| **Querfeldein** | **0,31** | **0,75** | ≠ — der Bezug für alles Querfeldein |

### 4.3 Geländespalte, Landschaften querfeldein — GA S. 120–123 (20 Zeilen)

Mit Quellenzeile (9): Wald 0,5 · Sümpfe/Moore 0,1 · Dschungel („Regenwald") 0,2 ·
Wüste („Sand-/Geröllwüste") 0,5 · Tundra („Eisgebiet, freie Fläche") 0,7 · Steppe 0,75 ·
Graslandschaft 0,75 · Gebirge („Gebirge ohne Klettern") 0,2 · Hügelland 0,75.

⚠️ Hügelland stammt aus der **Steigungs**tabelle (S. 122 f.), nicht aus der Geländetabelle. Die
Zeile sagt das.

Ohne Quellenzeile (11): Auenlandschaft · Flussland/Flusstal · Wüstenoase · Tal · Wadi · Hochebene ·
Tiefebene · Schlucht · Flussdelta · Küste · Insel. Die GA nennt für Küsten und Flusslandschaften
**ausdrücklich keinen** Landfaktor. Diese Zeilen behalten den Wert des Owners, und der Rücksetzer
lässt sie stehen.

Flächenbestand, gemessen am 07.08. über einen Abruf von `/api/app/ecosystem-areas.php`
(801 Flächen): gebirge 56 · wald 54 · sümpfe 15 · flussland 15 · wüstenoase 9 · hügelland 8 ·
tal 6 · wadi 4 · steppe 4 · grasland 4 · hochebene 3 · tiefebene 3 · wüste 3 · flussdelta 2 ·
auenlandschaft 2 · küste 1 · **dschungel 0** · **tundra 0**. Die Zahl steht in der Zeile: ein
Faktor ohne Fläche ist eine Einstellung ohne Wirkung, und das soll man sehen.

### 4.4 Boden nach Jahreszeit — GA S. 122 f. (6 Zahlen)

aufgeweicht −0,10 · Tauboden −0,10 · leichter Schnee −0,10 · Tiefschnee −0,20 · Eis −0,20 ·
Untergrenze 0,05. Stimmen heute alle. Die Zuordnung *Klimazone × Jahreszeit → Bodenzustand* ist
**nicht** Quelle, sondern unsere Tabelle, und bleibt außerhalb dieses Fensters.

### 4.5 Fluss und Eichung — GA S. 123 · 129 (2 Zahlen)

stromauf : stromab = 2,00 · Eichziel Fußgruppe auf Straße = 30 Meilen/Tag. Stimmen heute.

### 4.6 Gesperrt — steht nicht in der GA (6 Zeilen, nur zum Nachsehen)

Zeitmaßstab 1,19 · `mean_G` 1,032 (gemessen) · Reisetag 12 h (24 h nur Schnellsegler) ·
Leistungskilometer 100 / 150 / 20 % / Deckel 4,0 · Pass-Normalisierer 1,2847 (gemessen) ·
Aufschlag auf Reparaturkanten ×25.

---

## 5. 💣 Das Raster ist die Wahrheit, die zwei Listen sind die Anzeige

**Unsere Tempotabelle ist kein Produkt aus Tagesleistung × Geländespalte.** Gemessen am Bestand,
Verhältnis Pfad zu Straße je Reisemittel: Fußgruppe 0,749 · Einzelwanderer 0,799 · berittene
Gruppe 0,693 · Einzelreiter 0,750 · Karawane 0,713 · Kutsche 0,545. Ein Fenster, das nur
11 + 7 Zahlen speichert und die rund 60 daraus ableitet, schriebe beim ersten Speichern still
etwa 40 Werte um.

Daraus folgt die Bauart, und sie ist nicht verhandelbar:

- **Gespeichert wird das Raster** — Reisemittel × Wegtyp, so wie es heute ist. Die Migration
  ändert daran genau **eine Spalte**: `Querfeldein`.
- **Angezeigt werden die zwei Listen.** Die Tagesleistung liest die `Straße`-Spalte, die
  Geländespalte liest die `Fußgruppe`-Zeile. Eine Fußnote nennt, wie viele Reisemittel in dieser
  Spalte abweichen — verschwiegen wird nichts.
- **Der Rücksetzer ist das Einzige, was das Raster auf das Produkt zieht.** „Auf GA-Werte
  zurücksetzen" für einen Wegtyp schreibt `Tagesleistung(Reisemittel) × GA-Faktor` in alle elf
  Zellen — mit einer Ausnahme: die **Kutschenregel** (halbe Geschwindigkeit auf Weg und
  Gebirgspass, S. 123) ist eine Regel, kein Gelände, und wird danach wieder aufgesetzt.

⚠️ **Die Migration setzt die Wegtypen NICHT zurück.** Sie zieht nur die Querfeldein-Spalte und die
Landschaftsfaktoren. Alles, was eine Straßen-Reisezeit ändern würde, passiert erst auf Klick — und
die Befundzeile im Fenster sagt bis dahin, dass sechs von sieben Wegtypen abweichen. Ein Deploy,
der jede Reisezeit auf jeder Straße verschiebt, ist keine Nebenwirkung eines Wald-Features.

---

## 6. Datenmodell

### 6.1 Landschaftsfaktoren — neue Spalte an der Art

```sql
ALTER TABLE ecosystem_region_type
  ADD COLUMN terrain_speed_factor DECIMAL(4,3) NULL;
```

`NULL` heißt **„keine eigene Aussage"** und wird gelesen wie offener Boden. Das ist nicht dasselbe
wie 0,750: eine Art, die noch nie eingestellt wurde, unterscheidet sich von einer, die der Owner
ausdrücklich auf „wie offenes Gelände" gesetzt hat, und nur so kann eine spätere Saat sie
nachtragen, ohne eine Entscheidung zu überschreiben. (Dieselbe `null`≠`0`-Regel wie in V11.)

Die Spalte sitzt an der Art, neben `affects_paths`, `terrain_grain`, `sort_order` — das ist das
Hausmuster für „Eigenschaft einer Landschaftsart".

### 6.2 Alles andere — eine Zeile JSON

```
app_setting['travel_values'] = { "day_miles": {...}, "path_factors": {...},
                                 "grid": {...}, "ground_penalties": {...},
                                 "river_ratio": 2.0, "calibration_target_miles": 30 }
```

**Eine Zeile, und das ist der Grund:** ein halb gespeichertes Tempo-Raster ist ein kaputter Router.
Ein JSON-Wert wird atomar geschrieben; sechsundzwanzig Zeilen in einer Schlüssel-Wert-Tabelle
nicht. `app_setting` existiert bereits und braucht kein neues DDL.

### 6.3 Migration

Reihenfolge, und alle drei Bedingungen aus Befund A35 müssen halten:

1. Der `south_type_key`-Nachtrag bleibt **vor** `avesmapsEcosystemSeedRegionTypes()`.
2. Die Migration läuft **nach** der Saat — sonst trifft sie auf einer frischen Datenbank null
   Zeilen, genau der Fehler, den A35 beschreibt.
3. Sie läuft **genau einmal**, an einem **eigenen Merker** (`app_setting['travel_values_v1']`),
   nicht an „wurde gerade eine Spalte angelegt". Ein vom Owner nachgeschärfter Wert darf nie von
   der Saat überfahren werden.

💣 **DDL committet implizit.** Das `ALTER TABLE` läuft **vor** der Transaktion, nie darin.

Was sie schreibt: die neun Landschaftsarten mit Quellenzeile auf ihren **GA-Wert**, die elf ohne
auf **`0,75 ÷ offroad_factor`**, das Raster unverändert aus `AVESMAPS_ROUTE_CLIENT_SPEED_TABLE`,
die Querfeldein-Spalte auf `Tagesleistung × 0,75`.

💣 **Für die elf ist „verhaltensgleich" die falsche Regel, und der Unterschied ist keine
Feinheit.** `offroad_factor` misst gegen den *Querfeldein-Bezug*, und genau der wandert. Wer die
heutige absolute Geschwindigkeit einfriert, bekommt eine Landschaft, die **langsamer ist als gar
keine**: `flussland_flusstal` (15 Flächen) steht heute auf 1,00, also „bremst nicht" — eingefroren
bliebe es bei 0,96 Meilen/h, während der ungezeichnete Boden daneben auf 2,30 geht. Eine
gezeichnete Aue wäre dann ein Hindernis, weil jemand sie gezeichnet hat. Die elf behalten deshalb
ihr **Verhältnis** zum offenen Boden und fahren mit ihm hoch: Wadi 1,50 → `0,75 ÷ 1,50` = 0,50,
Flussland 1,00 → 0,75 (= offener Boden).

---

## 7. Was am A\* geändert wird — und was nicht

**Die Kostenformel nicht.** `Strecke ÷ Tempo × Steigungsfaktor × Bodenfaktor` bleibt Zeile für
Zeile, wie sie ist; die Verlangsamungen kumulieren (Owner-Entscheid).

Zwei Änderungen, beide klein:

1. 💣 **Der Byte-Maßstab der Faktorebene muss von 50 auf 25.** Die Ebene trägt einen Faktor als
   *ein Byte* (`AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE = 50`), also höchstens **5,10**. Der Sumpf
   ergibt in der Multiplikator-Lesart `0,75 ÷ 0,10 = 7,50` und passt nicht hinein — er würde
   stillschweigend auf 5,10 gedeckelt und wäre 32 % zu schnell. Bei Maßstab 25 liegt der Deckel
   bei 10,20 (Auflösung 0,04).
2. **Der Lader liest die neue Spalte.** `avesmapsOffroadLoadFactorPlane` joint auf
   `terrain_speed_factor` statt `offroad_factor` und rechnet `Basis ÷ Faktor`; der Filter
   `> 1.00` wird zu „Faktor kleiner als die Basis". `NULL` fällt heraus wie heute die 1,00.

⚠️ Der `try { … } catch (Throwable) { return ''; }` in `offroad-data.php` bleibt — aber genau er
hat verhindert, dass jemals jemand merkt, wenn die Ebene leer ist. Die Antwort trägt
`terrain_factors_known` bereits; **der Bau ergänzt eine Zeile im Fenster**, die sagt, ob die letzte
Route Bodenfaktoren gefunden hat. Ein stiller Not-Aus ohne Anzeige ist ein Ausfall.

### 7.1 Das Grundtempo je Reisemittel

`AVESMAPS_ROUTE_CLIENT_SPEED_TABLE` wird aus dem Speicher gelesen statt aus der Konstante — mit
der Konstante als Rückfall, wenn keine Zeile da ist (frische Datenbank, Diagnose ohne PDO).

💣 **Sie hat drei Spiegel**, und alle drei müssen aus derselben Quelle kommen:
`SPEED_TABLE` (`js/config.js`), `AVESMAPS_ROUTE_CLIENT_SPEED_TABLE` (`client-graph.php`) und
`WP_SPEEDS` (`js/pages/wege-editor-model.js`), dazu die ausgeschriebenen Zahlen in der Auswahlliste
(`index.html`, `i18n-en.js`). Bewacht von
`js/routing/__tests__/speed-table-and-rest-rule.test.js`, das sie heute schon aneinanderbindet.
Der Client bekommt die Werte über den bestehenden Weg — **der Server besitzt die Regel**
(`normalizer-parity`), der Client spiegelt.

---

## 8. Das Fenster

Kachel `wpTempo` zwischen `wpProfiles` und `wpCalibrate`
([`wege-editor.html:52`](../../../html/wege-editor.html)). ⚠️ Der Kommentar darüber sagt
„FOUR tiles, all the same width" — er wird mit geändert, und die gleiche Breite ist bei fünf
Kacheln zu prüfen (💣 `flex: 1 1 0` mit `border-box` ergibt *un*gleiche Spalten).

Unterzeile der Kachel: die Befundzahl („6 Werte weichen von der GA ab") — Status gehört in den
Knopf.

Das Fenster ist ein `.wp-modal` im selben Dokument, wie „Funktionen anzeigen"
([`wege-editor.html:105`](../../../html/wege-editor.html)). Sechs Abschnitte nach §4, getrennt
durch **Trennlinie und Überschrift**, nicht durch gerahmte Kästen. Genau **ein gefüllter Knopf**
(„Speichern"); jeder Rücksetzer ist weich/outline — eine Abschnittshandlung ist nicht die
Haupthandlung der Seite (AGENTS.md §12, 2026-08-07). Kein hartkodierter Farbwert, kein
hartkodierter Radius.

Jede Zeile zeigt: Name · unser Wert (Eingabe) · GA-Wert · **die Wirkung in Meilen/h** · Anmerkung
mit Flächenzahl. Die Wirkung steht daneben, weil eine Zahl ohne ihre Folge keine Entscheidung
erlaubt.

### 8.1 Endpunkt

`POST /api/edit/map/travel-values.php`, Fähigkeit `edit`, Aktionen `get` / `save` / `reset`.
`reset` nimmt einen Abschnitt (`day_miles` | `path_factors` | `landscapes` | `ground` | `misc` |
`all`) und schreibt die GA-Werte serverseitig — **die GA-Tabelle steht im Server**, nicht im
Browser, sonst gäbe es sie zweimal.

Schreiben hebt `map_revision` **nicht** — es ändert kein Kartenobjekt —, aber es muss den
Tempo-Speicher-Stempel heben, den der Routen-Endpunkt liest. Eine Protokollzeile je Speichern in
`map_audit_log` (`feature_id = NULL`), nie eine je Wert.

---

## 9. Was das an den Reisezeiten ändert

Fußgruppe, Meilen/h, nach der Migration (Wegtypen unverändert):

| Boden | heute | neu |
|---|---:|---:|
| offen, ohne Weg | 0,96 | **2,30** |
| Wald | 0,69 | **1,54** |
| Dschungel | 0,40 | 0,61 |
| **Sumpf** | 0,32 | **0,31** |
| Wüste | 0,60 | 1,54 |
| Gebirge (ohne Höhenraster) | 0,44 | 0,61 |
| Gebirge (mit Raster, Steigung ~1,5) | 0,29 | 0,41 |

Der Sumpf bleibt absolut fast stehen, während der offene Boden 2,4× schneller wird: sein Abstand
wächst von 3,0 auf **7,5**, und genau das zwingt den A\* außen herum. Der Wald dagegen bremst
künftig um Faktor 1,50 statt um 1,40 — das *ist* die Quelle, mehr gibt sie für „Wald" nicht her.
Wem das zu wenig ist, dem hilft nicht ein größerer Wert, sondern die
Art **`dichter Wald`** (GA 0,2 → 3,75) neben `wald`; das ist eine eigene Sitzung, in der 54
Waldflächen einsortiert werden.

⚠️ Der Umweg-Auslöser (`AVESMAPS_ROUTE_OFFROAD_DETOUR_THRESHOLD` 3,0) vergleicht gefahrene Strecke
gegen Luftlinie und prüft zweitens die Zeit. Ein 2,4× schnelleres Querfeldein macht die Querung
attraktiver — **die Schwelle wird nach dem Bau an ein paar echten Routen nachgemessen**, nicht
vorher geraten.

---

## 10. Prüfung

- **Einheiten-Test** — jede der 20 Landschaftsarten und jeder der 7 Wegtypen: gespeicherter Wert →
  effektives Tempo → zurück. Ein Kehrwert, der sich einschleicht, ist der teuerste Fehler hier.
- **Byte-Maßstab** — Sumpf 7,50 überlebt Hin- und Rückweg durch die Faktorebene. 💣 Der Test muss
  beim alten Maßstab 50 **rot** werden (Deckelung auf 5,10), sonst prüft er nichts.
- **Migration** — gegen sqlite: leere Tabelle → Saat → Migration; ein von Hand geänderter Wert
  überlebt einen zweiten Lauf.
- **Drei Spiegel** — der bestehende `speed-table-and-rest-rule.test.js` muss weiter grün sein,
  jetzt gegen den Speicher statt gegen drei Konstanten.
- **Rücksetzer** — ein Wegtyp zurückgesetzt schreibt elf Zellen; die Kutschenregel steht danach
  wieder (Kutsche auf Weg = halbe Straße).
- **Live, nach dem Deploy** — dieselbe Sonde wie in §1, ein einziger Abruf: der effektive
  Bodenfaktor im Waldwildnis muss von 1,338 auf ~1,50 gehen.

---

## 11. Ausdrücklich nicht in dieser Sitzung

- `dichter Wald` als eigene Landschaftsart (GA 0,2) und das Einsortieren der 54 Waldflächen.
- `Pfad` auf seine Quellenzeile 0,8 heben (24 statt 22,5 Meilen/Tag) — das ist die Straßentabelle.
- Die 37 Gebirge ohne Höhenraster vermessen.
- Die Zuordnung *Klimazone × Jahreszeit → Bodenzustand* — die ist unsere Tabelle, keine Quelle.
- Die GA-Zeile „Regenwald/Gebirge 0,1", die für die Überlagerung zweier Ebenen **weder** das
  Produkt (0,04) **noch** das Maximum (0,2) nennt. Unsere Maximum-Regel bleibt; die Quelle
  widerspricht ihr an genau dieser einen Stelle, und das ist notiert, nicht gelöst.
