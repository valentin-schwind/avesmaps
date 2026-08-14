# Übergabe: Tempowerte Schritt 2 — Landschaftsfaktoren, Migration, Byte-Maßstab

**Stand:** 14.08.2026 · **Vorgänger-Commits:** `d68ba38b` (Fenster) · `a855bb4c` (Router liest den Speicher)
**Entwurf:** `docs/superpowers/specs/2026-08-07-tempowerte-design.md` §6, §7

---

## 1 · Wo wir stehen

Drei Commits sind heute gelandet. Alle drei sind **live und grün**
(140/140 PHP, 127/127 JS).

| Commit | Was | Wirkung |
|---|---|---|
| `e3122aac` | Querfeldein als **Teilstrecke** statt Ersatz der ganzen Reise | Routen ändern sich |
| `d68ba38b` | Kachel **„Tempowerte"** im Wege-Editor | nur sichtbar |
| `a855bb4c` | Router liest die Tempowerte **aus dem Speicher** | erst wirksam, wenn gespeichert wird |

Der Zustand ist damit: Das Fenster zeigt die GA-Zahlen, kann sie speichern und
zurücksetzen, und der Router benutzt, was dort steht. **Solange niemand
speichert, ist alles bit-identisch zu vorher** — der Leser fällt auf
`AVESMAPS_ROUTE_CLIENT_SPEED_TABLE` zurück.

---

## 2 · Was Schritt 2 umfasst

### 2.1 Landschaftsfaktoren — neue Spalte

```sql
ALTER TABLE ecosystem_region_type
  ADD COLUMN terrain_speed_factor DECIMAL(4,3) NULL;
```

`NULL` heißt **„keine eigene Aussage"** und wird gelesen wie offener Boden. Das ist
*nicht* dasselbe wie 0,750: eine Art, die nie eingestellt wurde, unterscheidet sich
von einer, die der Owner ausdrücklich auf „wie offenes Gelände" gesetzt hat — nur so
kann eine spätere Saat nachtragen, ohne eine Entscheidung zu überschreiben.
(Dieselbe `null` ≠ `0`-Regel wie in V11.)

Die Spalte sitzt an der Art, neben `affects_paths`, `terrain_grain`, `sort_order`.

### 2.2 Migration

Drei Bedingungen, alle aus Befund A35, **alle müssen halten**:

1. Der `south_type_key`-Nachtrag bleibt **vor** `avesmapsEcosystemSeedRegionTypes()`.
2. Die Migration läuft **nach** der Saat — sonst trifft sie auf einer frischen
   Datenbank null Zeilen.
3. Sie läuft **genau einmal**, an einem **eigenen Merker**
   (`app_setting['travel_values_v1']`), nicht an „wurde gerade eine Spalte angelegt".

> 💣 **DDL committet implizit.** Das `ALTER TABLE` läuft **vor** der Transaktion, nie darin.

Was sie schreibt: die **neun** Landschaftsarten mit Quellenzeile auf ihren GA-Wert
(Wald 0,5 · Sümpfe 0,1 · Dschungel 0,2 · Wüste 0,5 · Tundra 0,7 · Steppe 0,75 ·
Grasland 0,75 · Gebirge 0,2 · Hügelland 0,75), die **elf** ohne Quellenzeile auf
`0,75 ÷ offroad_factor`.

> 💣 **Für die elf ist „verhaltensgleich" die FALSCHE Regel.** `offroad_factor` misst
> gegen den Querfeldein-Bezug, und genau der wandert. Wer die heutige absolute
> Geschwindigkeit einfriert, bekommt eine Landschaft, die **langsamer ist als gar
> keine**: `flussland_flusstal` (15 Flächen) steht auf 1,00, „bremst also nicht" —
> eingefroren bliebe es bei 0,96 Meilen/h, während der ungezeichnete Boden daneben
> auf 2,30 geht. Eine gezeichnete Aue wäre dann ein Hindernis, *weil* jemand sie
> gezeichnet hat. Die elf behalten ihr **Verhältnis**: Wadi 1,50 → 0,50,
> Flussland 1,00 → 0,75.

### 2.3 Byte-Maßstab 50 → 25

> 💣 Die Faktorebene trägt einen Faktor als **ein Byte**
> (`AVESMAPS_ROUTE_OFFROAD_FACTOR_SCALE = 50`), also höchstens **5,10**. Der Sumpf
> ergibt in der Multiplikator-Lesart `0,75 ÷ 0,10 = 7,50` und passt nicht hinein — er
> würde **stillschweigend gedeckelt** und wäre 32 % zu schnell. Bei Maßstab 25 liegt
> der Deckel bei 10,20 (Auflösung 0,04).

⚠️ Der Test muss beim **alten** Maßstab 50 **rot** werden, sonst prüft er nichts.

### 2.4 Der Lader

`avesmapsOffroadLoadFactorPlane` joint auf `terrain_speed_factor` statt
`offroad_factor` und rechnet `Basis ÷ Faktor`; der Filter `> 1.00` wird zu „Faktor
kleiner als die Basis". `NULL` fällt heraus wie heute die 1,00.

⚠️ Der `try { … } catch (Throwable) { return ''; }` in `offroad-data.php` bleibt —
aber genau er verhindert, dass jemand merkt, wenn die Ebene leer ist. Die Antwort
trägt `terrain_factors_known`; **eine Zeile im Fenster** soll sagen, ob die letzte
Route Bodenfaktoren gefunden hat. Ein stiller Not-Aus ohne Anzeige ist ein Ausfall.

### 2.5 Die Client-Spiegel

`SPEED_TABLE` (`js/config.js`), `WP_SPEEDS` (`js/pages/wege-editor-model.js`) und die
**ausgeschriebenen Zahlen in der Auswahlliste** (`index.html`, `js/app/i18n-en.js`,
„Karawane (3,07 Meilen/h)").

⚠️ Die Auswahlliste zeigt den **rohen** Wert ohne `TIME_SCALE_FACTOR` — die Angabe
liegt also 19 % zu hoch. Gilt genauso für die große Tabelle im Geschwindigkeits-Dialog.
Bewacht von `js/routing/__tests__/speed-table-and-rest-rule.test.js`.
**Der Server besitzt die Regel, der Client spiegelt.**

---

## 3 · Was das an Reisezeiten ändert (Entwurf §9)

Fußgruppe, Meilen/h, nach der Migration — **Wegtypen unverändert**:

| Boden | heute | neu |
|---|---:|---:|
| offen, ohne Weg | 0,96 | **2,30** |
| Wald | 0,69 | **1,54** |
| Sumpf | 0,32 | 0,31 |
| Wüste | 0,60 | 1,54 |
| Gebirge (ohne Raster) | 0,44 | 0,61 |

> ⚠️ **Die Migration setzt die Wegtypen NICHT zurück.** Sie zieht nur die
> Querfeldein-Spalte und die Landschaftsfaktoren. Alles, was eine *Straßen*-Reisezeit
> ändern würde, passiert erst auf Klick im Fenster. Ein Deploy, der jede Reisezeit auf
> jeder Straße verschiebt, ist keine Nebenwirkung eines Wald-Features.

> 🔴 **Und das Querfeldein-Problem wird dadurch zunächst GRÖSSER.** Querfeldein wird
> 2,4× schneller, der Umweg-Auslöser schlägt danach **häufiger** an, nicht seltener.
> Der Entwurf verlangt deshalb: **die Schwelle nach dem Bau an echten Routen
> nachmessen**, nicht vorher raten.

---

## 4 · Der offene Fall dahinter: Luring → Salmingen

Der Auslöser dieser ganzen Kette. Vollständig diagnostiziert, Entwurf und Bau in
`docs/superpowers/specs/2026-08-14-querfeldein-teilstrecken-design.md`.

**Stand heute** (nach `e3122aac`): Die Route läuft „quer bis Spinnried, dann
Reichsstraße 6" — 32,4 Meilen, Zeit 7,362. Vorher lief sie zu 100 % querfeldein.

**Was der Owner will:** gar kein Querfeldein, solange ein Ort an Wegen hängt.

**Die Datenlage, gemessen und mehrfach abgesichert:**
- Zwischen Spinnried und Salmingen liegen **15,8 Meilen ohne Knoten und ohne Landweg**.
- Der kürzeste Straßenweg ist **107,3 Meilen** (Zeit 10,96 = 39,1 Stunden) über
  Avestreu → Rottan → Ferdok → Rakulbruck → Spinnried.
- Der Umweg-Faktor ist 4,22; der lange Teil ist **Rakulbruck → Spinnried mit 34,2
  Meilen** Reichsstraße, nicht der Talloner Hügelsteig.
- **Ausgeschlossen** (jeweils geprüft, nicht vermutet): verschmolzene Knotennamen
  (0 Dubletten bei 4.883), fehlende Kreuzungen (0 echte Schnittpunkte ohne Knoten),
  ein Weg der durchläuft ohne zu verbinden, ein für `groupFoot` gesperrter Weg.

**Drei Hebel, alle noch offen:**

1. 🔑 **Querfeldein quert keine Flüsse** (Owner-Idee, 14.08.). Der aussichtsreichste:
   V13 (`landschaften-v13-querfeldein-wasser`) meidet heute nur `meer`/`see`-**Flächen**;
   Flusslinien waren nie dabei. Die Rakula liegt genau zwischen Spinnried und
   Salmingen. Kanonisch begründbar und ohne erfundenen Zuschlag — die Welt kennt die
   Regel bereits: *Tarnelfurt*, *Rakulbruck*.
   💣 Bei der Umsetzung an V13s Küstentoleranz denken: **571 von 4.653 Orten liegen
   geometrisch im Wasser**; ohne Toleranz bricht das Feature Häfen.
2. **Querfeldein-Zuschlag** als `cost_factor` (wie der ×25). ×1,75 ließe hier die
   Straße gewinnen. 🔴 **Nicht durch die GA gedeckt** — die Quelle sagt 0,75, live
   läuft 0,313, mit Zuschlag wären es 0,156. Müsste ausgewiesen werden wie die
   Steigungsregel (Naismith/Langmuir), sonst liest es sich als Regelwerksangabe.
3. **Einen Weg erfassen.** Redaktionsarbeit, behebt den Fall vollständig.

---

## 5 · Was sonst noch offen ist

- 🔧 **Der Einheitenfehler** (`client-graph.php:397`): `distance_units / speed` teilt
  Karteneinheiten durch ein Tempo in **Meilen/h**. Jede Graph-Zeit ist dadurch um
  Faktor 3 zu klein — gleichmäßig, deshalb ist die Kantenwahl unverzerrt. Wirksam wird
  er nur, wo eine **absolute** Stundengröße *addiert* statt multipliziert wird: am
  Umsteigezuschlag (`response.php:144`), der dadurch dreifach wiegt. Owner-Befund.
- 🔧 **Der Avesweg** (Avestreu ↔ Rakulbruck, 30,3 Meilen) steht auf
  `allowed_transports: ["lightWalker"]` — nur Einzelwanderer. Einziger solcher Fall
  unter 61 Landwegen im Ausschnitt; sieht nach Versehen aus.
- 🔧 **Der Tempo-Dialog nennt „1,25–2,5 Meilen/h"** für Querfeldein, die Tabelle führt
  0,96–1,6. Bei der Eichung am 03.08. nicht nachgezogen.
- 🔧 **Der Dialog verspricht Verhalten, das nicht eintritt:** „darum bevorzugt die
  Berechnung selbst große Umwege über richtige Straßen und Pfade."

---

## 6 · Wie geprüft wird

**Das GANZE Testfeld, nie nur die eigenen Tests** (AGENTS.md §9 — ein roter Test lädt
nichts hoch, und der Fehlschlag vergiftet danach den `?v=`-Stempel):

```bash
for t in $(find api tools -path '*__tests__*' -name '*test*.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll -d extension=php_curl.dll "$t"; done
```

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```

⚠️ **Ohne die Extensions sind 63 Tests rot** — ausnahmslos umgebungsbedingt
(`mbstring`, `pdo_sqlite`, `gd`, `curl` sind in der lokalen `php.ini` nicht aktiv).
Das ist kein Befund, das ist die Kommandozeile.

**Abnahme heißt Ablauf, nicht Maß.** Nach dem Deploy die Routen wirklich anfordern:

```bash
curl -s https://avesmaps.de/api/route/ -H "Content-Type: application/json" -d '{"from":"Salmingen","to":"Luring","optimize":"fastest","transports":{"land":"groupFoot","synthetic":"groupFoot"},"enabled_transports":{"land":true,"river":true,"sea":false}}'
```

Zu lesen: `route.segments[].subtype` (die Aufteilung) und
`route.debug.context.detour` (`reason`, `ratio`, `chord_nodes`, `chords`).

⚠️ PHP-Deploys greifen mit **2–4 Minuten** Verzug (OPcache). Ein 404 direkt nach dem
Push heißt „noch nicht da", nicht „kaputt".

---

## 7 · Hausregeln, die hier zweimal gegriffen haben

- 💣 **Geteilter Arbeitsbaum — niemals `git add -A`.** Parallel laufen andere
  Sitzungen mit uncommitteten Änderungen (heute: `js/routing/routing.js`,
  `js/ui/popups.js`, drei CSS-Dateien, ein Worktree unter `.claude/worktrees/`).
  Immer `git status`, dann **nur die eigenen Pfade** einzeln stagen.
- 💣 **CRLF.** Die Dateien haben `\r\n`. Ein Suchmuster mit `\n` über mehrere Zeilen
  findet **nichts** und scheitert dabei lautlos. Zeilenweise ersetzen.
- 💣 **Signaturen prüfen, nicht unterstellen.** Heute dreimal danebengelegen:
  `avesmapsWriteMapAuditLog` nimmt sechs Einzelparameter (kein Array), `.wp-btn`
  existiert nicht (die Konvention ist `.wp-savebar button.is-primary`), und das
  Überschriften-Token heißt `--color-text-strong`, **nicht** `--color-heading` — ein
  falscher Tokenname hinterlässt eine wirkungslose Regel, die niemandem auffällt.
- 💣 **Sichtbare Änderungen gehen EINZELN live**, und der Owner sieht jede.
