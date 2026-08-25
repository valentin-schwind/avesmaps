# Die API-Nutzungstafel — eingehend

**Stand:** 2026-08-25 · **Fläche:** Editor → Reiter *Status* → neuer Unterreiter **API**
**Mockup:** `docs/api-nutzung-mockup.html`
**Anlass:** Owner — *„die Analyse-Statistiken um eine Übersicht der API-Nutzung erweitern"*

---

## §0 Kurzfassung

Die Karte hat 102 Endpunkte, und **keiner sagt, wie oft er gerufen wird.** Es gibt kein
Zugriffsprotokoll, keine Tabelle, keinen Zähler. Dieser Entwurf baut beides: die Erhebung und
die Anzeige.

Getragen wird das von einem Umstand, der nur für die **eingehende** Richtung gilt: es gibt genau
eine Stelle, durch die jede JSON-Antwort das Haus verlässt — `avesmapsJsonResponse()`
(`api/_internal/bootstrap.php:164`). Ein Zähler dort erfasst alle 102 Endpunkte, ohne 102 Dateien
anzufassen.

**Drei Stufen, alle eingehend:**

| Stufe | Was sie zeigt |
|---|---|
| **1** | Meistgerufene Endpunkte · Statusverteilung inkl. **leerer** Antworten · häufigste Fehler · Zonen · Lastzeiten · Speicher |
| **2** | Antwortzeiten je Endpunkt (Mittel und Ausreißer; p95 optional) |
| **3** | Fremdnutzung der offenen API: Herkunft und Client-Art für `route/` und `locations/` |

🔴 **Ausdrücklich NICHT hier:** die ausgehende Richtung (§11) und die Alarme (§2.3).

---

## §1 Der Befund

### §1.1 Es gibt heute nichts

`git grep` auf `api_request`, `request_log`, `api_usage` findet nichts. Was es an Zählwerk gibt,
sind die **vier Drosseln im Haus** (der Kommentar an `avesmapsClientIpAddress()` nennt die Zahl) —
aber die zählen je Aufrufer und je Zeitfenster, nur an ihren eigenen vier Endpunkten, und
verwerfen den Zähler danach. Als Quelle taugt das nicht.

Damit ist dieses Vorhaben **zur Hälfte ein Erhebungs-Feature.** Wer nur den Renderer baut, hat
nichts anzuzeigen.

### §1.2 Der Flaschenhals — und was daran vorbeigeht

`avesmapsJsonResponse(int $statusCode, array $payload = []): never` setzt den Status, schreibt den
Rumpf und beendet. Es gibt **drei** Antwort-Helfer, und alle drei münden in sie:

```
avesmapsServerErrorResponse(Throwable)  →  avesmapsErrorResponse(…)  →  avesmapsJsonResponse(…)
                                                                        └─ echo, exit
```

85 der Endpunktdateien rufen einen davon. Alle drei sind `: never` — nach ihnen läuft im Endpunkt
nichts mehr.

💣 **Ein Fatal Error geht daran vorbei.** Am 19.08.2026 stand in `paths-editor.php` ein `const`
hinter einem `try`-Block; PHP hoistet Funktionen, aber keine `const` auf Dateiebene. Der Endpunkt
starb vor jeder Antwort und lieferte einen **leeren Rumpf** — im Browser gelesen als
„Unexpected end of JSON input", also wie ein Netzfehler. Dieselbe Klasse trifft jeden
Speicherüberlauf und jedes Zeitlimit.

**Diese Antworten sind die wertvollsten der ganzen Tafel und die einzigen, die ein Zähler im
Flaschenhals nie sieht.** Deshalb §3.1.

### §1.3 🔴 Was dieser Server nicht kann — gemessen, nicht vermutet

💣 **`fastcgi_finish_request()` gibt es auf STRATO nicht.** Die SAPI ist `cgi-fcgi`. Eine Messung
vom 24.08.2026 (`api/discord/sapi-probe.php`, Runde 1) hat zusätzlich gezeigt, dass frühes
Abschließen auch sonst nicht trägt: **3,07 s statt 0,2 s.**

⚠️ **Folge für diesen Entwurf:** Der Zähler kann **nicht** hinter der ausgelieferten Antwort
laufen. Er liegt auf dem kritischen Pfad jeder Anfrage, und der Benutzer wartet auf ihn. Das ist
die Bedingung, unter der alles Weitere entschieden wird — ein Entwurf, der „wir zählen, nachdem
der Client bedient ist" annimmt, ist auf diesem Server falsch.

💣 **Es gibt keinen Zeitplan-Läufer.** Kein Hintergrundprozess, kein Cron im Haus
(`api/social/routine-post.php` wird von **außen** mit Token angestoßen). Aufräumen muss deshalb
faul beim Schreiben passieren, wie bei `visitor_daily_seen`.

---

## §2 Umfang

### §2.1 Was hineinkommt

Die drei Stufen aus §0. Stufe 1 ist die Grundlage; 2 und 3 hängen an ihr und können einzeln
nachziehen.

### §2.2 🔴 Die ausgehende Richtung ist nicht Teil dieses Entwurfs

Owner-Entscheid 25.08.2026: **eingehend zuerst.** Der Grund ist nicht Sparsamkeit, sondern
Risiko — Einzelheiten in §11.

### §2.3 🔴 Alarme sind nicht Teil dieser Tafel

Owner-Entscheid 25.08.2026: Schwellwerte sind eine **Einstellung**, keine Anzeige. Ihr Platz ist
das geplante Fenster „Admin-Einstellungen", Reiter *Betrieb*.

Notiert als **Stufe 6** in `docs/superpowers/specs/2026-08-25-einstellungen-fenster-design.md`
§11.1, mit den drei dort begründeten Fallen. Das Vorhaben ist geparkt.

⚠️ Die Reihenfolge stimmt auch sachlich: **eine Schwelle braucht einen Normalwert.** Diese Tafel
muss erst messen, was normal *ist*.

### §2.4 Was ausdrücklich nicht gebaut wird

* **Kein Rohprotokoll.** Eine Zeile je Anfrage wäre die bequemste Bauform und genau die Last, die
  AGENTS.md §10 als Fragilität führt. Es werden Aggregat-Zähler geschrieben, wie bei
  `visitor_metric`.
* **Keine Stichprobe bei Zählung und Fehlern.** Jede n-te Anfrage zu zählen halbiert die Kosten
  und macht seltene Ereignisse unsichtbar — und die seltenen Ereignisse *sind* der Zweck.
* **Keine zweite Wahrheit über Endpunkte.** Es gibt keine gepflegte Endpunktliste, weder im Code
  noch in der Tabelle; der Schlüssel entsteht aus dem Dateipfad (§3.3). Eine Liste würde beim
  103. Endpunkt veralten, ohne dass es jemandem auffällt.

---

## §3 Die Erhebung

### §3.1 🔴 EIN Schreiber: die Abschlussroutine

Der naheliegende Bau — „`avesmapsJsonResponse` zählt hoch" — hat zwei Fehler: er verpasst die
leeren Antworten (§1.2), und er verteilt das Zählen auf zwei Pfade, sobald man sie nachrüstet.

**Stattdessen gibt es genau einen Schreiber, und er läuft am Ende jeder Anfrage:**

```
bootstrap.php lädt  → avesmapsApiMetricsRegistrieren()   (einmal, mit Wächter)
                       └─ register_shutdown_function(...)

avesmapsJsonResponse(...)  → merkt sich Status + setzt "abgeschlossen"
                             echo, exit  ─────┐
                                              ▼
                       Abschlussroutine: schreibt EINE Zeile
                       abgeschlossen ? Statusklasse : "leer"
```

* `avesmapsJsonResponse` **zählt nicht selbst.** Sie hinterlegt nur `$status` und ein
  `$abgeschlossen = true` in einem Modulzustand. `exit` löst Abschlussroutinen aus, also läuft der
  Schreiber auch auf dem normalen Weg.
* Bricht die Anfrage vorher ab — Fatal Error, Speicherüberlauf, Zeitlimit —, ist
  `$abgeschlossen` falsch, und die Zeile trägt **`leer`**.
* 💣 **Ein Wächter gegen Doppelregistrierung ist Pflicht.** `bootstrap.php` wird an 52 Stellen mit
  `require` (nicht `require_once`) eingebunden. Dass heute nichts doppelt lädt, ist Praxis, keine
  Zusicherung — und zwei Registrierungen zählten jede Anfrage doppelt, was nach „mehr Verkehr"
  aussieht statt nach einem Fehler. Der Wächter ist ein `defined()`/statisches Flag, wie es die
  Datei für `AVESMAPS_API_ROOT` schon vormacht.
* 💣 **Der Schreiber bekommt sein eigenes `try { } catch (Throwable) { }` und schweigt im
  Zweifel.** Er läuft am Ende *jeder* Anfrage, auch der bereits gescheiterten; eine Ausnahme aus
  dem Zähler würde einen echten Fehler überschreiben oder eine gesunde Antwort nachträglich
  zerstören.

⚠️ **Er liegt auf dem kritischen Pfad** (§1.3). Ein UPSERT auf eine schmale Tabelle mit
passendem UNIQUE-Schlüssel ist der billigste Schreibvorgang, den es hier gibt — der
Besucher-Beacon fährt heute **fünf bis sieben** davon je Aufruf. Einer ist vertretbar; das ist
die Obergrenze, nicht der Anfang einer Reihe.

### §3.2 💣 Woher die Datenbankverbindung kommt

`avesmapsJsonResponse` und die Abschlussroutine liegen in `bootstrap.php` und haben **keine**
PDO-Instanz — die legt jeder Endpunkt selbst mit `avesmapsCreatePdo($config['database'])` an.

Eine **zweite** Verbindung je Anfrage aufzumachen wäre teuer und würde die Verbindungszahl auf
einem Shared-Hosting verdoppeln. Deshalb:

1. `avesmapsCreatePdo()` legt ihre Rückgabe zusätzlich in einem Modulzustand ab
   (`avesmapsLetzteDatenbankverbindung()`). Das ist eine Zeile und ändert nichts am Verhalten.
2. Der Schreiber nimmt diese Verbindung, wenn es sie gibt — der Normalfall, denn fast jeder
   Endpunkt liest oder schreibt etwas.
3. Gibt es **keine**, öffnet er selbst eine. Das ist der einzige Punkt, an dem der Zähler eine
   Verbindung kostet, die die Anfrage sonst nicht gebraucht hätte.

⭐ **Und dieser Punkt misst sich selbst:** die Zeilen aus (3) bekommen die Dimension
`ohne_verbindung`. Nach einer Woche steht in der Tafel, wie oft der Fall eintritt. Ist die Zahl
klein, war die Entscheidung richtig; ist sie groß, ist sie mit einer Zahl belegt statt geraten.

### §3.3 Der Endpunktschlüssel

Aus `$_SERVER['SCRIPT_NAME']`: den Pfad bis einschließlich `/api/` abschneiden, das `.php`
entfernen. `/api/app/map-features.php` → **`app/map-features`**.

💣 **Niemals `REQUEST_URI`.** Die trägt die Abfrageparameter mit — `?public_id=…`, `?days=…`,
`?q=…`. Das hätte zwei Folgen, beide schlimm: die Dimension wäre praktisch unbegrenzt
(eine neue Zeile je Suchbegriff, die Tabelle wüchse mit dem Verkehr statt mit den Endpunkten),
und in einer Betriebstabelle stünden **Suchbegriffe und Kennungen echter Besucher**. Der
Skriptname ist beschränkt, stabil und trägt nichts Persönliches.

⚠️ Ist `SCRIPT_NAME` leer oder unerwartet geformt, lautet der Schlüssel `unbekannt` — nie ein
Rückfall auf die Adresse.

### §3.4 Die Zonen

Aus dem Präfix des Schlüssels, in dieser Reihenfolge geprüft:

| Zone | Präfix | Bedeutung |
|---|---|---|
| `offen` | `route/`, `locations/` | die stabile öffentliche Entwickler-API (AGENTS.md §4) |
| `app` | `app/` | unsere eigene Karte |
| `edit` | `edit/` | Editoren |
| `sonstige` | alles Übrige | `discord/`, `import/`, `diagnostics/`, `social/` |

🔴 **Genau vier, und das ist kein Zufall:** der Ring im Panel zeichnet sie als vier Segmente, und
vier ist die gerechnete Grenze der Projektpalette (`docs/design-language.md`, siehe auch den
offenen Punkt beim Kartenansichts-Ring). Eine fünfte Zone bräuchte erst eine fünfte Farbe.

### §3.5 Was gezählt wird

Drei Metriken. Die Aufteilung folgt der Disziplin des Besucher-Moduls: **nur eine Metrik trägt
eine Stunde**, sonst multipliziert sich die Zeilenzahl mit 24.

| Metrik | Dimension | Stunde | Zeilen/Tag | speist |
|---|---|---|---|---|
| `antwort` | `<endpunkt>\|<klasse>` | — | ≤ 510 | Endpunkt-Rangliste (Summe über Klassen), Statusverteilung, Fehlerquote |
| `stunde` | `''` | 0–23 | 24 | die Lastkarte |
| `fehler` | `<endpunkt>\|<code>` | — | ~50 | die Fehlerliste |

Statusklassen: `2xx` · `3xx` · `4xx` · `5xx` · **`leer`**.

* Die Zone wird **nicht** mitgespeichert — sie ist aus dem Endpunktschlüssel ableitbar (§3.4), und
  zwei Speicherorte für dieselbe Aussage laufen auseinander.
* 💣 **Der Fehlercode ist geschlossen zu halten.** `avesmapsErrorResponse` bekommt den Code als
  Zeichenkette; ein dynamisch gebauter Code (etwa mit einer Kennung darin) würde die Dimension
  aufblähen wie `REQUEST_URI`. Regel: nur `^[a-z0-9_]{1,40}$` wird übernommen, alles andere zählt
  als `sonstiger_code`.
* Die Lastkarte braucht keinen eigenen Wochentag — er kommt aus `day` (`DAYOFWEEK`), wie im
  Besucher-Dashboard.

**Umfang:** rund 200–600 Zeilen am Tag, bei 400 Tagen Aufbewahrung also 80.000–240.000 Zeilen.

### §3.6 💣 Der Notausschalter — und warum nicht als Konstante

Das Besucher-Modul hat `AVESMAPS_VISITOR_ANALYTICS_ENABLED`, und dort steckt ein Fehler, der beim
Bau dieses Moduls **nicht** wiederholt werden darf: die Bibliothek definiert die Konstante beim
**Einbinden** per `if (!defined(...))`, und der Einbindungsschritt steht in allen Endpunkten
**vor** `avesmapsLoadApiConfig()`, das `config.local.php` erst zur Laufzeit lädt. Ein
`define(..., false)` in der Konfigurationsdatei käme also zu spät — der Schalter im Besucher-Modul
ist vermutlich wirkungslos (Verdacht, nicht verfolgt, betrifft jenes Modul).

🔴 **Hier deshalb kein Konstanten-Schalter.** Der Zähler liest zur **Laufzeit** aus dem
Konfigurations-Array: `$config['api_metrics']['enabled'] ?? true`. Fehlt der Eintrag, zählt er —
Vorgabe „an", weil ein Betriebszähler, der still aus ist, seinen Zweck verfehlt.

⚠️ Der Schreiber läuft in `bootstrap.php`, wo die Konfiguration bereits geladen ist, sobald der
Endpunkt sie geladen hat. Hat er das nicht getan, ist der Zähler stumm — dieselbe Regel wie in
§3.2 (3): dann ist auch keine Verbindung da.

### §3.7 🪤 Ein stummer Zähler sieht aus wie Ruhe

Läuft der Schreibvorgang in einen Fehler — STRATO entzieht bei voller Quote die Schreibrechte
(`1142 INSERT denied`), und `ERRMODE_EXCEPTION` macht daraus eine Ausnahme, die §3.1 pflichtgemäß
verschluckt —, dann steht in der Tafel **nichts**. Von „es kamen keine Anfragen" ist das nicht zu
unterscheiden. Es ist dieselbe Klasse wie die stille MySQL-Kürzung bei `app_setting`, die den
Speichern-Knopf der Tempowerte wochenlang wirkungslos machte, ohne dass jemand etwas sah.

🔴 **Gegenmittel:** der Leseendpunkt liefert **`letzte_zaehlung`** — den Zeitstempel der jüngsten
Zeile. Das Panel zeigt ihn, und liegt er mehr als eine Stunde zurück, sagt es das ausdrücklich
(„seit 3 h nichts gezählt — zählt der Server noch?") statt leere Balken zu zeichnen.
**Eine Anzeige, die zwischen „nichts passiert" und „nichts gemessen" nicht unterscheidet, ist
schlimmer als keine.**

---

## §4 Die Tabelle

Eine eigene Tabelle `api_metric`, im Muster von `visitor_metric`, mit
`CREATE TABLE IF NOT EXISTS` (Hausstil, §5 AGENTS.md).

```
api_metric
  id        BIGINT UNSIGNED AUTO_INCREMENT
  day       DATE NOT NULL                     -- UTC_DATE()
  hour      TINYINT UNSIGNED NULL             -- nur bei metric='stunde'
  metric    VARCHAR(40)  NOT NULL             -- antwort | stunde | fehler
  dimension VARCHAR(190) NOT NULL DEFAULT ''
  count     INT UNSIGNED NOT NULL DEFAULT 0
  UNIQUE KEY (day, hour, metric, dimension)
  KEY       (metric, day)
```

**Warum eine eigene Tabelle und nicht `visitor_metric`?** Die Frage ist berechtigt — AGENTS.md
warnt laut davor, ein zweites System neben ein vorhandenes zu stellen. Drei Gründe, die hier
dagegen stehen:

1. **Andere Aussage.** `visitor_metric` beantwortet „wer war da"; der Ruf eines Bots an
   `route/` ist kein Besuch. In einer Tabelle vermischt, wäre jede Besucherzahl still
   verfälscht.
2. **Andere Aufbewahrung.** Betriebszahlen altern schneller als Besuchszahlen.
3. 🔴 **Anderer Notausschalter.** `visitor_metric` darf aus Datenschutzgründen abschaltbar sein.
   Ein abgeschalteter Besucherzähler dürfte nie die Betriebsdiagnose mitnehmen.

⚠️ Die Grenze ist damit gezogen und gehört benannt: **`api_metric` speichert nichts über
Personen.** Kein Hash, keine Adresse, kein Kennzeichen — in Stufe 1 und 2 ausschließlich
Endpunktnamen, Statuszahlen und Uhrzeiten. Stufe 3 ist der einzige Punkt, an dem das berührt
wird, und hat dort seinen eigenen Abschnitt.

**Aufräumen:** faul beim Schreiben, `day < UTC_DATE() - INTERVAL 400 DAY`. ⚠️ Nicht bei jedem
Schreibvorgang — höchstens einmal je Tag, erkannt an einer Markerzeile, sonst zahlt jede Anfrage
ein `DELETE`.

💣 **`ROWS` ist in MySQL 8 reserviert.** Die Speicherabfrage aus `avesmapsVisitorStorageInfo`
schreibt deshalb `` table_rows AS `rows` `` mit Graviszeichen; ohne sie wirft die Abfrage einen
Syntaxfehler und reißt den ganzen Lesevorgang mit. Beim Abschreiben mitnehmen.

---

## §5 Der Leseendpunkt

`GET /api/app/api-metrics.php?days=N`, gebaut wie `api/app/visitor-metrics.php`:

* `avesmapsApplyCorsPolicy($config)` — 💣 **mit Argument.** Beim Besucher-Modul war der Aufruf
  ohne Argumente eine wiederkehrende Fehlerquelle; bei **einem** solchen Fund sind alle
  Helferaufrufe zu prüfen. `avesmapsCreatePdo($config['database'] ?? [])` ebenso, und
  `avesmapsRequireUserWithCapability` **beendet** das Skript, sie wirft nicht.
* Riegel: Fähigkeit **`edit`** (wie die Besucherzahlen).
* Antwort: `{ ok, enabled, days, letzte_zaehlung, metrics: { endpunkte, klassen, fehler, stunden }, storage }`.

⚠️ **Die Lese-SQL ist nur angemeldet prüfbar.** Eine unangemeldete Probe endet am Riegel; Fehler
im Leser zeigen sich erst im Editor. Das ist beim Besucher-Modul zweimal teuer geworden.

💣 **Ein Aggregat-Alias darf nicht in `HAVING` oder `ORDER BY` stehen.** MySQL antwortet mit
Fehler **1247** („reference to group function"), und weil solche Leser gern einen gemeinsamen
`try/catch` haben, reißt eine kaputte Abfrage die gesunden mit — die Geo-Karte stand deshalb leer
da, obwohl die Daten stimmten. Rohen `SUM(...)`-Ausdruck wiederholen, und je Abfrage ein eigener
`catch`.

---

## §6 Die Oberfläche

Ein dritter Unterreiter **API** neben „Besucher" und „Editoren"
(`js/review/review-status.js`, `index.html`). Er erbt die vorhandene Mechanik unverändert:
dieselbe Reiterleiste, dieselben Zeitraum-Pillen, dieselben `.va-*`-Karten, dasselbe Nachladen
beim ersten Klick.

⚠️ `activateStatusSubtab()` kennt heute genau zwei Namen und normalisiert alles Fremde auf
„editoren". Sie bekommt einen dritten Zweig — und den merkt sich die Kaskadentabelle
`REVIEW_TAB_FAMILIES` (`js/ui/ui-controls.js`) bereits von selbst; **hier keinen zweiten
Schreiber auf denselben Speicherschlüssel bauen**, das war schon einmal doppelt.

Karten wie im Mockup, alle aus derselben Aggregatzeile:

1. **KPI-Zeile** — Anfragen · Fehlerquote · (Stufe 2: Median)
2. **Meistgerufene Endpunkte** — `vaBars()`
3. **Wie geantwortet wurde** — gestapelter Balken, vier Klassen plus `leer`
4. **Häufigste Fehler** — Liste im `.va-feed`-Muster
5. **Wer ruft an** — der Vier-Segment-Ring
6. **Wann die Last liegt** — 7×24-Karte
7. **Die Tafel selbst** — Zeilen, Größe, ältester Eintrag, `letzte_zaehlung` (§3.7)

💣 **`.va-row__fill` braucht `display: block`.** Es ist ein `<span>`, und auf ein Inline-Element
wirkt `width` nicht. Genau daran standen im Besucher-Dashboard **alle acht** Balkenlisten
monatelang leer da, während die Zahl daneben stimmte — „Zahl da, Balken leer" liest sich wie
„Wert ist 0". Die Klasse trägt die Zeile heute; wer eine neue Balkenart baut, prüft sie.

💣 **Die Stunde in der Datenbank ist UTC** (`UTC_DATE()`, `gmdate('G')`). Die Lastkarte rechnet
beim Zeichnen auf die Zeitzone des Browsers um, **mitsamt Wochentag** — UTC Montag 23 Uhr ist
Dienstag 1 Uhr. `vaLocalHourShift` und `vaHeatmapGrid` tun das bereits; wiederverwenden, nicht
nachbauen. ⚠️ MySQLs `DAYOFWEEK` zählt **1 = Sonntag**.

💣 **Statusplaketten tragen ihre Schriftfarbe je Thema selbst.** `--color-warn` und
`--color-danger` werden im dunklen Thema *heller* (`#d3a04a` / `#e08272`); weiße Schrift darauf
fällt auf 2,36 bzw. 2,76 Kontrast. Die neutrale Plakette geht den anderen Weg — `--color-button`
bleibt in beiden Themen mitteldunkel und braucht helle Schrift. Eine pauschale Regel bricht immer
eine der beiden Hälften; es sind **drei Klassen**, keine Inline-Farbe (§12 der AGENTS.md verbietet
Letztere ohnehin). Im Mockup gemessen und dort schon so gebaut.

⚠️ Die Serienfarben der Diagramme (`#2a78d6`, `#1baf7a`, …) sind eine kategoriale **Daten**palette
und eine bewusste Ausnahme von der Token-Regel (Owner 2026-07-11) — kein Anlass, sie zu
„korrigieren".

---

## §7 Stufe 2 — Antwortzeiten

Median und p95 sind aus einem reinen Zähler nicht ableitbar. Zwei Ausbaustufen:

**(a) Mittel und Ausreißer — zwei Spalten.** `api_metric` bekommt `sum_ms BIGINT UNSIGNED NULL`
und `max_ms INT UNSIGNED NULL`, gefüllt nur von einer neuen Metrik `dauer`
(Dimension `<endpunkt>`, keine Stunde). Dauer aus
`microtime(true) - $_SERVER['REQUEST_TIME_FLOAT']`.

**(b) Echtes p95 — Histogramm-Fächer.** Metrik `dauer_fach`, Dimension `<endpunkt>|<grenze>`,
Grenzen 50/100/200/500/1000/2000/5000 ms. Kostet bis zu 816 Zeilen am Tag, also grob eine
Verdopplung. **Optional**; (a) zuerst.

⚠️ **Was gemessen wird, ist die PHP-Zeit, nicht die Zeit beim Benutzer.** Netz, TLS und die
Wartezeit vor dem PHP-Arbeiter fehlen. Bei einer Poolsättigung — dem Vorfall vom 17.07.2026 —
sähe die Tafel darum **gesunde** Zahlen, während die Seite steht. Das gehört an die Karte
geschrieben, sonst beweist jemand mit ihr das Gegenteil dessen, was gerade passiert.

⭐ **Der Nutzen ist konkret:** AGENTS.md §10 führt `territories-endpoint.php` seit Monaten als
Hotspot (DDL und Metadaten-Proben vor jedem Cache-Read, dazu ein N+1 über die ganze
Territorientabelle, Meilenstein M6). Bisher steht das als Text da. Diese Karte gäbe ihm eine Zahl.

---

## §8 Stufe 3 — Fremdnutzung der offenen API

Beantwortet die Frage, die heute niemand beantworten kann: **nutzt die stabile API überhaupt
jemand außer uns?**

Zwei Metriken, **nur für die Zone `offen`** (`route/`, `locations/`):

| Metrik | Dimension |
|---|---|
| `herkunft` | Host aus `Origin`, sonst aus `Referer`, sonst `ohne_origin` |
| `client` | `browser` · `skript` · `bot` |

🔴 **Datenschutz — die Grenze aus §4 wird hier berührt und muss eng bleiben:**

* **Nur der Host**, nie Pfad oder Abfrage. `https://example.org/x?y=1` → `example.org`.
* **Nur die Klasse**, nie der rohe User-Agent. Die Einordnung nutzt
  `avesmapsVisitorIsBot()` und `avesmapsVisitorDeviceClass()`, die es schon gibt — **kein
  zweiter Erkenner**.
* **Keine IP, kein Hash, keine Verknüpfung** mit `visitor_metric`.
* Unbekannte Hosts bleiben Aggregat; es entsteht keine Zeile je Anfrage.

⚠️ **Braucht eine Zeile in der Datenschutzerklärung**, bevor es live geht — dieselbe Sorgfalt wie
beim Geo-Modul, das dafür ebenfalls einen Nachtrag brauchte. Das ist kein Nebenschritt, sondern
Teil der Abnahme dieser Stufe.

---

## §9 Die Fallen, gesammelt

1. 💣 **Der Fatal Error geht am Flaschenhals vorbei** — nur die Abschlussroutine sieht ihn (§3.1).
2. 💣 **`fastcgi_finish_request` fehlt auf diesem Server**, gemessen — der Zähler liegt auf dem
   kritischen Pfad (§1.3).
3. 💣 **Doppelte Registrierung zählt doppelt** und sieht aus wie mehr Verkehr (§3.1).
4. 💣 **Niemals `REQUEST_URI` als Dimension** — unbegrenzte Kardinalität und persönliche Daten
   (§3.3).
5. 💣 **Der Notausschalter darf keine Konstante beim Einbinden sein** (§3.6).
6. 🪤 **Ein stummer Zähler sieht aus wie Ruhe** — `letzte_zaehlung` ist die Gegenmaßnahme (§3.7).
7. 💣 **`ROWS` ist reserviert** (§4).
8. 💣 **Aggregat-Alias nicht in `HAVING`/`ORDER BY`**, und je Abfrage ein eigener `catch` (§5).
9. 💣 **`.va-row__fill` braucht `display: block`** (§6).
10. 💣 **Die Stunde ist UTC**, Umrechnung mitsamt Wochentag (§6).
11. 💣 **Statusplaketten: drei Klassen, keine pauschale Schriftfarbe** (§6).
12. ⚠️ **Stufe 2 misst PHP-Zeit, nicht Benutzerzeit** (§7).
13. ⚠️ **Stufe 3 braucht die Datenschutzzeile vor dem Livegang** (§8).

---

## §10 Tests

| Test | sichert |
|---|---|
| `api/_internal/__tests__/api-metrics-schreiber-test.php` | eine abgeschlossene Antwort zählt **eine** Zeile mit ihrer Klasse; ein Abbruch ohne Abschluss zählt **`leer`**; zweimaliges Registrieren zählt trotzdem einmal |
| `api/_internal/__tests__/api-metrics-schluessel-test.php` | der Schlüssel kommt aus `SCRIPT_NAME`; eine Adresse mit Abfrageteil erzeugt **niemals** eine Dimension mit `?`; Unbekanntes wird `unbekannt`; die vier Zonen stimmen |
| `api/_internal/__tests__/api-metrics-robust-test.php` | wirft die Datenbank, kommt die Antwort **unverändert** durch und der Statuscode bleibt; der Zähler wirft nie nach außen |
| `api/_internal/app/__tests__/api-metrics-lesen-test.php` | Formprüfung, Zeitraumschranken, `letzte_zaehlung`, Aufräumgrenze; jede Abfrage hat ihren eigenen `catch` |
| `js/review/__tests__/api-metrics-render.test.js` | die sechs Karten bauen sich aus einer Beispielantwort; leere Daten ergeben „noch keine Daten", **nicht** Nullbalken; ein veraltetes `letzte_zaehlung` erzeugt den Warnsatz |
| `js/review/__tests__/api-status-subtab.test.js` | der dritte Reiter schaltet, lädt genau einmal nach, und es gibt weiterhin **einen** Schreiber auf den Speicherschlüssel |

⚠️ **Der Render-Test wird gegen Mutationen geprüft**, wie `visitor-analytics-render.test.js` es
vormacht — ein Test, der nur „es kommt Markup heraus" behauptet, hält die Zahlen nicht fest.

⚠️ Vor dem Push läuft das **ganze** Testfeld (AGENTS.md §9), samt der 21 `tools/wikidump/test-*.php`,
die das übliche Suchmuster nicht findet.

---

## §11 Danach: die ausgehende Richtung

**Eigener Entwurf, eigene Abnahme.** Owner-Entscheid 25.08.2026.

💣 **Der Grund: nach draußen gibt es keinen Flaschenhals.** Gemessen sind es **17
`curl_exec`-Aufrufe in 12 Dateien** — Wiki-Dump, Wappen-Proxy, Sync-Identität, Linkchecker,
Facebook, Instagram, Mastodon, Discord —, jeder mit eigenem `curl_init`. Ein Zähler je Aufrufer
ist die Vier-Erzeuger-Falle aus AGENTS.md: beim zwölften hat jemand vergessen, und die Tafel
meldet ruhig „0 Fehler bei Mastodon", weil dort niemand zählt.

⭐ **Der Vorschlag wäre strukturell statt per Disziplin:** ein geteiltes
`avesmapsCurlAusfuehren($ch, $ziel)` übernimmt das `curl_exec` und zählt (je Stelle eine Zeile,
die curl-Optionen bleiben, wo sie sind), **und ein repoweiter Test verbietet direktes
`curl_exec`** — dieselbe Bauart wie
`api/_internal/map/__tests__/const-vor-benutzung-test.php`. Damit kann der achtzehnte
Rufer gar nicht erst danebengehen.

🔴 **Warum es trotzdem wartet:** dieser Umbau fasst Code an, der scharf gegen fremde Konten läuft
— die drei Social-Adapter mit ihren Token und den Dump-Abruf. Das ist zu viel Bewegung an heiklen
Stellen für ein Auswertungs-Feature und gehört in einen eigenen Vorgang mit eigener Abnahme, statt
in einem Statistik-Commit mitzureisen.

⭐ **Was es zuerst sichtbar machen würde:** die Wiki-Sperre der STRATO-Ausgangs-IP. 💣 Und zwar
**an der auffällig niedrigen Dauer, nicht an der Fehlerzahl** — ein `Connection refused` kommt
nach 24 ms zurück, schneller als jede echte Antwort. Ein Median, der plötzlich *fällt*, ist dort
das schlechte Zeichen.

---

## §12 Reihenfolge

Nach AGENTS.md §9 ist keine dieser Stufen eine Änderung, die ein **Besucher** sieht — die Tafel
liegt hinter dem `edit`-Riegel. Die Einzeln-live-Regel greift also nicht; trotzdem in dieser
Folge, weil jede Stufe die vorige voraussetzt:

1. **Tabelle, Schreiber, Notausschalter** — nichts sichtbar, aber die Daten beginnen zu laufen.
   ⭐ Diese Stufe zuerst allein live zu nehmen hat einen eigenen Wert: wenn die Oberfläche
   fertig ist, zeigt sie sofort echte Zahlen statt einer leeren Tafel.
2. **Leseendpunkt + Unterreiter + die sechs Karten** (Stufe 1).
3. **Antwortzeiten** (Stufe 2a; 2b nur, wenn 2a den Bedarf zeigt).
4. **Fremdnutzung** (Stufe 3) — erst mit der Datenschutzzeile.
5. Ausgehend: §11, eigener Entwurf.

🔧 **Offen und bewusst nicht entschieden:** ob die Tafel einen eigenen Zeitraum behält oder den
der Besucher-Reiter übernimmt. Das Mockup zeigt eigene Pillen; ob das beim Bauen noch richtig
aussieht, entscheidet sich am fertigen Bild.
