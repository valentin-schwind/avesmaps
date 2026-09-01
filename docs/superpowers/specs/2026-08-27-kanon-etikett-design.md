# Kanon-Etikett: offiziell / inoffiziell, Quellenkasten, Rechteangaben — Entwurf

**Stand:** 2026-08-27 · **Owner-Freigabe:** ja (Regel, Form, Anbringung, Reihenfolge)
**Mockup:** https://claude.ai/code/artifact/5aa27c08-accc-473a-adf4-128a88144a51
**Terminkante:** Wiki Aventurica liefert `Inoffiziell:` (ns 222) **voraussichtlich ab 01.09.2026**

> 🔴 **Dieser Entwurf legt die REGEL und die DARSTELLUNG fest.** Gebaut ist nichts. Die
> Abschnitte 1–4 (Anzeige, Editor, Katalogseite) hängen an keinem Termin und können sofort
> laufen; Abschnitt 5 (Dump-Riegel) wartet auf ns 222.

---

## 0. Nachtrag 31.08.2026 — was sich seit dem Entwurf geändert hat

Zwischen dem 27. und dem 31.08. sind **182 Commits** gelaufen, davon eine Handvoll mitten in
diesem Bereich. **Die Regel (§2) und die Form (§3) stehen unverändert.** Was sich verschoben hat,
sind die Voraussetzungen — vier Punkte davon nehmen dem Bau Arbeit ab, drei kommen dazu.

### 0.1 ⭐ Der Rechenort für das Etikett EXISTIERT bereits

`api/app/map-features.php:264-265` lädt seit dem 30.08. den **ganzen Quellenkatalog plus die
per-Objekt-Verweise** in die Kartennutzlast (`avesmapsLoadFeatureSourceCatalog`,
`avesmapsLoadFeatureSourceRefs`). Lizenz und Namensnennung reisen dort mit. §6.3 („das Etikett
braucht einen Rechenort") ist damit halb erledigt: **der Ort ist da, das Feld fehlt.**

💣 **`AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` steht auf 18 und MUSS beim Hinzufügen des
Kanon-Feldes hoch** (`api/app/map-features.php:104`). Der ETag hängt an
`map_revision + PAYLOAD_VERSION`; **neue Felder bewegen die Revision nicht**. Ohne den
Versionssprung bekommt jeder Wiederbesucher sein 304 samt alter Nutzlast — die Falle steht als
Kommentar über dem Sammler und hat schon Klimastempel, Tempowerte und Wappen-Notaus erwischt.

💣 **Der Sammler fährt ZWEI ANLÄUFE**, weil dieser Pfad kein DDL fahren darf (heiße
Kartenantwort): erst mit den Zusatzspalten, bei Fehler ohne. **Der Rückfall des `try`-Blocks ist
ein LEERER Katalog** — also keine einzige Quelle mehr auf der ganzen Karte. Wer `permission`
(§4.4) ergänzt, muss beide Anläufe mitziehen.

### 0.2 ⭐ Die Quellenliste klappt schon ein — ab der sechsten

Owner-Entscheid 24.08.2026, gebaut: ab der sechsten Quelle wandert der Rest in ein natives
`<details>/<summary>` („15 weitere Quellen", `js/review/review-feature-sources.js:202-227`).
**Damit ist die offene Frage aus §7 („ab welcher Quellenzahl klappt der Kasten ein?")
beantwortet — sechs — und die Sorge um die wachsende Kastenhöhe (§6.4) erledigt.**
🔴 Nativ und nichts anderes, damit Strg+F auch zugeklappte Quellen findet.

### 0.3 💣 Der Editor ist ein SPALTENRASTER, keine freie Zeile mehr

`.fs-row` und `.fs-col-heads` tragen dieselbe Vorlage:
`minmax(0, 1fr) 104px 104px 74px 150px 22px` (`css/features/feature-sources.css:545,597`; eine
Schmalfassung bei :636). **Der Stempel braucht dort eine eigene Spalte**, kein zusätzliches
Element in einer bestehenden. ⚠️ **Ein fehlender Wert bekommt eine LEERE Zelle, nicht gar keine** —
fällt eine weg, rutscht alles rechts davon eine Spalte nach links. Und beide Vorlagen müssen
wirklich `display: grid` sein; eine Vorlage an einem Flex-Container ist inert und lässt das Raster
lautlos verschwinden.

### 0.4 ⚠️ Der Quellen-TYP ist jetzt optional — und umtypbar

Zwei Änderungen, die §3 berühren:

- Die Auswahl trägt seit dem 30.08. ein leeres „Art …" (`sources.add.typeNone`), und
  `avesmapsNormalizeSourceType` gibt `''` für „keine Aussage" zurück
  (`api/_internal/app/feature-sources.php:318-335`). **Eine Quelle darf also typlos sein** — die
  Annahme des Entwurfs, „die Typmarke steht ohnehin da", gilt nicht mehr für alle.
  ⭐ Das bestätigt die gewählte Fassung: der Stempel sagt den Kanon selbst und hängt nicht daran,
  dass ein Typ dasteht.
- `avesmapsSourceRetypeAllowed` erlaubt Umtypen **nur**, wenn der Aufrufer es darf UND die Art
  ausdrücklich gewählt ist. Der Editor meldet danach: *„Art von X auf Y geändert — das gilt
  überall, wo diese Quelle steht."* ⭐ **Das ist die Warnung, die §6.2 für die Massenaktion
  gefordert hat („an 3 Objekten"), in gebauter Form.** Die Seite „Quellen" übernimmt diesen
  Wortlaut, statt einen zweiten zu erfinden.

### 0.5 ⭐ Für die Katalogpflege gibt es zwei Endpunkte — die Seite „Quellen" setzt darauf auf

`api/edit/map/source-key-report.php` (Bericht, Berechtigung `edit`, **schreibt nichts**) und
`api/edit/map/source-merge.php` (Zusammenführung, Berechtigung `admin`, mit `source_merge_log`
und Umkehrbarkeit). Beide gehören zu `docs/quellen-wiki-key-instruction.md`, dessen **Schritt 3
„Dump neu holen" genau der Lauf von heute Nacht ist.**

🔴 **§6 baut damit nicht neu, sondern gibt diesen Endpunkten eine Oberfläche.** Und die dortige
Invariante gilt weiter: *ein Bericht, den man versehentlich ausführen kann, ist kein Bericht* —
Berichten und Anwenden bleiben getrennt.

⚠️ **Der Merge fasst ZWEI Bestände an**, nicht einen: die `feature_sources`-Verknüpfungen **und**
die Orte, die dieselbe URL noch im Altfeld `properties.other_source` tragen. Beim ersten echten
Fall waren das 4 gegenüber **33**. Wer nur die Verknüpfungen zählt, übersieht die Mehrheit.

### 0.6 ⚠️ Lizenz und Namensnennung sind seit dem 30.08. ZWEI Verweise

Bis dahin klebte ein Text aus beidem zusammen — und der **ganze** Text zeigte auf die
Lizenzadresse; ein Klick auf den Urhebernamen landete beim CC-Lizenztext
(`js/ui/feature-source-markup.js`, `attributionMarkup` / `licenseBadgeMarkup`). Die Namensnennung
ist jetzt reiner Text (es gibt keine Spalte für eine Urheber-Adresse), die Lizenz ein eigener
Link. **Die Schreibweise `(VolkoV / garetien.de, CC BY-NC-SA 3.0)` aus §4.2 ist also zwei
Elemente, kein Stück** — die offene Frage „Klammer oder Mittelpunkt" (§7) betrifft nur noch, was
zwischen den beiden steht.

### 0.7 ⚠️ Garetien-Objekte tragen seit dem 31.08. ZWEI Quellen

Der eigene Wiki-Artikel des Briefspiels wird beim Import zur zweiten Quelle („Stadt Praioslob auf
garetien.de", Commit `6856f5dd1`). **Der gemischte Fall aus §4.2 ist damit nicht die Ausnahme,
sondern der Normalfall** — und die Zeile trägt zwei inoffizielle Quellen desselben Urhebers, also
greift die noch offene Frage „Bezeichner bei mehreren" (§7 Nr. 1) sofort.

⚠️ Dazu ein neuer `origin`-Wert **`garetien`** neben `manual`, `community`, `wiki_publication`.
Wer Herkunft auswertet, muss ihn kennen.

### 0.8 🔴 Unverändert offen — alle vier Riegel stehen noch

Am 31.08. nachgesehen, nichts davon ist angefasst worden:

| Riegel | Fundstelle | Stand |
|---|---|---|
| ns 222 wird verworfen | `dump-entity-scan.php:250` | unverändert |
| `===Inoffizielle Quellen===` fällt weg | `publication-parsing.php:77-93` | unverändert |
| Publikation fest `true` | `publication-sync.php:678` | unverändert |
| `match_key` streift das Präfix | — | unverändert |
| Spalte `permission` | — | **existiert nicht** |

### 0.9 Zwei Kleinigkeiten fürs Bauen

- **Seitenkürzung ab VIER Einzelseiten** (`FEATURE_SOURCE_PAGES_MAX = 3`), volle Angabe im
  `title`, und `[title]` trägt **gestrichelte Unterlinie plus Hilfezeiger**. ⭐ Das ist das fertige
  Muster für die Ellipse aus §4.2 — ohne dieses Zeichen liest sich eine Kürzung wie die
  vollständige Angabe.
- `featureSourceShortenPages` gibt es **genau einmal**, und **fünf Seiten** laden
  `feature-source-markup.js` vor dem Editor. Wer den Renderer anfasst, fasst beide Oberflächen an.

---

## 1. Der Befund, aus dem alles folgt: „offiziell" heißt heute dreierlei

| Wo | Was es dort heißt | Fundstelle |
|---|---|---|
| `*` hinter einer Quelle | **Kanon der Quelle** | `sources.is_official`, `js/ui/feature-source-markup.js:132` |
| Reiter „Offiziell (35)" | **Abdeckung** — ausführlich + ergänzend gegen Erwähnung. Sagt *nichts* über Kanon. | `js/ui/feature-source-markup.js:222` |
| Häkchen „offiziell" | **Kanon der Quelle** beim Anlegen | `js/review/review-feature-sources.js:318` |

💣 **Deshalb wird der Reiter umbenannt: „Offiziell" → „Beschrieben".** Mit einem Kanon-Etikett
zwei Zeilen darüber liest jeder „Offiziell (35)" als „35 offizielle Quellen" — und das ist
nicht, was der Reiter zählt. **„Beschrieben (35)" gegen „Erwähnt (34)"**: reiner
Beschriftungswechsel, keine Datenänderung. ⚠️ Betrifft **beide** Sprachtabellen.

---

## 2. Die Regel

🔴 **R1 — Ein Eintrag kann nicht offiziell UND inoffiziell sein.** Hat ein offizieller Ort
zusätzlich eine Briefspielquelle, bleibt er offiziell.

🔴 **R2 — Offiziell schlägt immer inoffiziell.** Im Kopf steht dann **nur** `OFFIZIELL`, ohne
jeden Zusatz, dass es das Objekt außerdem in einem Briefspiel gibt. Das steht im Quellenkasten.

🔴 **R3 — Inoffiziell nennt immer den Urheber.** „Nicht im Kanon" allein ist keine Auskunft;
ein Briefspiel-Ort und ein Ort aus irgendeiner Fanseite trügen sonst dasselbe Etikett.

🔴 **R4 — Das Etikett wird abgeleitet, nie getippt.** Eine Spalte, die ein Editor pflegt,
driftet gegen die Quellenliste, die zwei Zeilen tiefer steht.

### 2.1 Die Ableitung — eine Rangfolge, erster Treffer gewinnt

| # | Trifft zu | Etikett |
|---|---|---|
| 1 | mindestens **eine** offizielle Quelle | `OFFIZIELL` — auch wenn der Artikel in ns 222 liegt |
| 2 | Artikel liegt in ns 222 (`Inoffiziell:`) | `INOFFIZIELL │ Wiki Aventurica` |
| 3 | nur inoffizielle Quellen | `INOFFIZIELL │ Briefspiel (Garetien)` |
| 4 | gar keine Quelle | `Ohne Quelle` — **nur im Editor**, nie für Besucher |

🔴 **Gibt es etwas Offizielles, ist ns 222 uns egal** (Owner 27.08.2026). R2 gilt ohne Ausnahme;
die offizielle Quelle steht über der Aussage des Wiki-Namensraums. Ein Objekt, das in
`Inoffiziell:` liegt und trotzdem eine offizielle Quelle trägt, wird als `OFFIZIELL` gezeigt.

🔧 **Aber genau dieser Fall ist ein Widerspruch, und der Abgleich muss ihn LÖSEN, nicht
verschlucken** (Owner: „das muss der syncer aber dann lösen"). Entweder hätte das Wiki den Artikel
aus `Inoffiziell:` herausnehmen müssen, oder unsere Quellenzuordnung ist falsch — in beiden Fällen
will das jemand sehen. **Die Anzeige entscheidet sich für „offiziell" und ist damit fertig; der
Syncer meldet das Paar in die Abgleichsliste**, so wie er heute schon widersprüchliche Felder
meldet (`api/_internal/wiki/sync-monitor-*.php`). Stillschweigend entscheiden wäre das Schlechteste
von beidem: die Anzeige wäre richtig und der Fehler bliebe unentdeckt.

⚠️ **Das ist zugleich der Grund, warum Riegel 4 (§5) nicht optional ist.** Ohne erhaltenes
`Inoffiziell:`-Präfix im Schlüssel kann der Abgleich das Paar gar nicht bilden, das er melden soll.

---

## 3. Die Form

⭐ **Die Halbpille ist gewählt, weil sie die Unvollständigkeit des Eintrags unterstreicht**
(Owner 27.08.2026). Genau das soll sie: ein Chip, dessen zweites Feld sagt, dass hier noch etwas
offen ist — wer geschrieben hat, was nicht im Kanon steht.

| Element | Aussehen | Sagt |
|---|---|---|
| `OFFIZIELL` | Pille, **gefüllt**, VERSAL, gesperrt, Gold | Gibt es das im gedruckten Aventurien? |
| `Briefspiel (Garetien)` | Pille, **neutraler Umriss**, gemischtschriftlich | Von wem stammt es? |
| `INOFFIZIELL │ Briefspiel (Garetien)` | beides als **ein Chip**, geteilte Kontur, kein Zwischenraum | zusammen genau eine Aussage |

💣 **Das rechte Feld ist NEUTRAL, nie blaugrün.** Neben einem blaugrünen `INOFFIZIELL` stoßen
sonst zwei Blaugrün aneinander und der Chip wird ein Farbfeld mit einer Naht darin. Neutral
funktioniert er in beiden Kanonlagen gleich.

🔴 **Farbe trägt danach auf der ganzen Seite GENAU EINE Bedeutung: Gold = im Kanon,
Blaugrün = nicht.** Nirgends sonst. Die frühere Idee, die Typmarke einzufärben, ist genau daran
gescheitert — sie hätte zwei Bedeutungen getragen (welcher Typ *und* welcher Kanon).

🔴 **Kein Rot für „inoffiziell".** Die Briefspiele sind der Grund, warum wir die Inhalte haben.
Ein Warnrot machte aus einer Herkunftsangabe eine Qualitätsaussage. Rot bleibt Fehlern vorbehalten.

🔴 **Halbpille nur dort, wo der Bezeichner sonst keinen Platz hat** — Objektkopf und Quellenzeile.
Wo eine Typspalte existiert (Publikationstabelle), stehen **zwei Spalten** statt eines Chips.

### 3.1 Farbwerte (an `css/base/tokens.css` angelehnt, noch nicht dort eingetragen)

| Token | hell | dunkel |
|---|---|---|
| Kanon offiziell, Grund | `#8a6b16` | `#dcc77e` |
| Kanon offiziell, Schrift | `#fffaea` | `#2b2311` |
| Kanon inoffiziell, Grund | `#1f6b64` | `#6fc7bd` |
| Kanon inoffiziell, Schrift | `#eafaf7` | `#0f2f2b` |
| „Ohne Quelle" | Umriss gestrichelt, `--color-text-muted` | dito |
| Bezeichnerfeld | transparent, `--color-border`, `--color-text-muted` | dito |

⚠️ **Kontrast gerechnet, nicht gemessen.** Schrift-auf-Grund liegt bei 4,9 (hell/gold), 5,9
(hell/blaugrün), 9,5 und 7,2 (dunkel). Über AA — aber **im echten Thema nachmessen**, siehe §6.

---

## 4. Die Flächen

### 4.1 Objektkopf

Anbringung: **unter der Zeile mit Art und Herrschaft, über der Knopfreihe** (die Stelle aus dem
Gareth-Bild). Nicht neben dem Namen — dort sähe es aus wie ein Zusatz zum Wort „Gareth".
Begründung: der Kopf ist der Ort, an dem das Objekt sagt, *was es ist* — Metropole, Hauptstadt,
im Kanon. Alle drei sind Aussagen über das Objekt und stehen nicht neben ihrem Beleg.

⚠️ „Ohne Quelle" erscheint **nur im Editor**. Besucher sehen bei einem unbelegten Objekt gar kein
Etikett — der Kopf bleibt, wie er heute ist.

### 4.2 Quellenkasten (Besucheransicht)

Aus der losen Zeile wird ein Kasten mit Rahmen, Beschriftung „Quelle:" / „Quellen:" und
**einer Quelle je Zeile**:

```
Quellen:
  Sellach ↗  (CC BY-SA 3.0)                                        [OFFIZIELL]
  Garetien:Dorf Sellach ↗  (VolkoV / garetien.de, CC BY-NC-SA 3.0)  ⓘ [INOFFIZIELL│Briefspiel (Garetien)]
  Publikationen:  [Beschrieben (2)]  [Erwähnt (1)]
```

🔴 **Eine Quelle, eine Zeile — und sie bricht nicht um** (Owner 27.08.2026). Die Zeile hat links
einen schrumpfenden Bereich (Titel + Lizenz) und rechts eine feste Gruppe (ⓘ und Etikett). Wird es
eng, **kürzt der Titel mit Ellipse**, statt die Marken in die nächste Zeile zu schieben.

💣 **Tragend dafür ist `min-width: 0` am linken Bereich.** Ohne das weigert sich ein Flex-Kind zu
schrumpfen (Vorgabe `min-width: auto`) und der lange Titel drückt die Marken aus dem Kasten —
`overflow: hidden` und `text-overflow: ellipsis` allein reichen **nicht**. Skizze:

```css
.fslist li   { display: block; }                       /* Rechtetafel darunter */
.fsrow       { display: flex; gap: 8px; flex-wrap: nowrap; }
.fsrow-main  { flex: 1 1 auto; min-width: 0;
               overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.marks       { flex: 0 0 auto; }
```

⚠️ **Der gekürzte Teil darf nicht verloren gehen** — er gehört in den `title` der Zeile, dieselbe
Regel, die `featureSourceShortenPages` für die Seitenzahlen schon fährt („die VOLLE Angabe wandert
in den Titel des Elements", `js/ui/feature-source-markup.js`).

💣 **Und die Namensnennung muss rechtlich an der Kopie stehen.** Eine weggekürzte Namensnennung ist
keine Namensnennung. Vor dem Bauen messen, wie schmal das Infopanel real wird (die Messreihe vom
27.08. ging bis 260 px); notfalls fällt die Zeile **unterhalb einer Schwelle** doch in den Umbruch
zurück — dann bewusst und gemessen, nicht als Vorgabe.

🔴 **Die Lizenz steht bei ihrer Quelle, nie im Kastenkopf.** Eine Lizenz im Kopf schiene für alles
darin zu gelten — der Fehler, der am 14.08.2026 schon einmal behoben wurde. So kann er nicht
wiederkommen.

⭐ **Die Umbruchfalle vom 27.08. verschwindet mit.** Der `inline-block`-Kniff in
`js/ui/feature-source-markup.js` existiert nur, damit die Namensnennung nicht von ihrer Quelle
abreißt und in einer Zeile mit der *nächsten* landet. Eine Quelle je Zeile braucht ihn nicht.

⭐ **Der Stern `*` entfällt ersatzlos.** An seiner Stelle steht ein Wort, das niemand nachschlagen
muss.

### 4.3 Publikationstabelle

Neue Spalte **Kanon** zwischen Titel und Typ. Heute zeigt sie überall „Offiziell" (alle
Publikationen sind fest verdrahtet offiziell); ab ns 222 steht dort ein Briefspiel-Beleg neben
einem Ulisses-Band.

🔴 **Spalte, kein dritter Reiter.** Die Reiter sortieren nach *Abdeckung*; ein Kanonreiter machte
daraus zwei Sortierachsen, und „ausführlich *und* inoffiziell" wäre nicht mehr zusammen zu sehen.

### 4.4 Rechteangaben — drei Spalten, nicht zwei

| Spalte | Frage | Beispiel | Sichtbar |
|---|---|---|---|
| `license` | Was gilt rechtlich? | CC BY-NC-SA 3.0 | ja, verlinkt |
| `attribution` | Wen muss man nennen? | VolkoV / garetien.de | ja, Pflicht |
| `permission` **(neu)** | Wer hat es erlaubt, und wann? | Freundeskreis des phantastischen Briefspiels e. V., 12.08.2026 | hinter dem ⓘ |

Begründung für die dritte Spalte: die Garetien-Inhalte stehen *unter* CC BY-NC-SA 3.0 **und** sind
*zusätzlich* freigegeben. Beides gilt gleichzeitig; eine Auswahlliste könnte das nicht abbilden.
Dieselbe Trennung, die `docs/superpowers/specs/2026-08-16-lizenzangaben-vereinheitlichung-design.md`
für Bilder schon begründet hat („permission_granted ist keine Lizenz, sondern eine Erlaubnis").

🔴 **Das ⓘ steht rechts, unmittelbar VOR dem Etikett.** Bedienelemente gehören an einen festen
Platz; mitten in der Zeile wäre es das dritte anklickbare Ding in einer Reihe, ohne sich als das
eine zu erkennen zu geben, das *nicht* wegführt. Vor dem Etikett, weil das Etikett die Zeile
abschließt.

💣 **Die Rechtetafel klappt INNERHALB ihrer Zeile auf, nie unter der Liste.** Bei zwei Quellen wäre
sonst nicht zu sehen, wessen Rechte da stehen — und das sind zuordnungspflichtige Angaben.

⚠️ **Die Lizenz bleibt ein echter Link**, auch mit dem ⓘ daneben. Den Lizenztext zum Aufklapper zu
machen und den CC-Link in die Tafel zu verlegen spart ein Bedienelement — aber CC verlangt den
Lizenzverweis *an der Kopie*, und einen Klick tief ist er das nicht mehr.

### 4.5 Eingabezeile im Editor

Aus einer umbrechenden Reihe mit neun Bedienelementen werden vier benannte Zonen:

1. **Woher** — URL zuerst, mit Wirterkennung
2. **Fundstelle** — Titel, Seite(n), Typ, Abdeckung
3. **Kanon — Pflichtangabe**, zwei Knöpfe ohne Vorauswahl
4. **Rechte** — Lizenz, Namensnennung, Genehmigung (von der Wirterkennung vorbelegt)

💣 **Das Häkchen wird zur Pflichtwahl.** Der genannte Fall — „die Briefspieler haken offiziell
nicht an" — ist kein Bedienfehler, sondern ein Formularfehler: ein leeres Kästchen kann „nein"
heißen oder „nicht gelesen", und das System kann die beiden nicht trennen. `Hinzufügen` bleibt
gesperrt, bis eine Wahl getroffen ist. ⭐ Für bekannte Wirte kostet die Pflicht nichts, weil die
Erkennung sie schon beantwortet hat.

⚠️ **Das Meldeformular muss mitwandern.** `api/app/report-location.php:405` führt `type` und
`official`, aber weder Lizenz noch Namensnennung. Für Besucher wird die Kanonfrage ausgeschrieben:
„Steht das in einer offiziellen DSA-Veröffentlichung?" statt „offiziell".

### 4.6 Seite „Quellen"

🔴 **Keine Massenaktion, sondern eine Seite.** Der Katalog `sources` hat heute **gar keine**
Oberfläche: man erreicht eine Quelle nur über ein Objekt, das sie zufällig benutzt, und ändern kann
man sie überhaupt nicht. Die Seite heißt **Quellen**, mit Ansichten *nach Wirt / nach Typ / ohne
Lizenz / alle* — die Massenaktion ist eine Sache, die man darauf tun kann, nicht ihr Zweck.

🔴 **Wirtprofil als Vorschlag, nie als Anzeige.** Im Renderer war die Wirt-Tabelle falsch, weil sie
die Lizenz jedes Mal neu behauptet und beim dritten Wirt still danebenliegt (deshalb wurde sie am
27.08. entfernt). Als Vorbelegung beim Eintragen und als Massenvorlage ist sie richtig: sie
schreibt einmal in die Daten, und ab da steht die Angabe an der Quelle.

Bestandsaufnahme (die echten Zahlen liefert diese Abfrage):

```sql
SELECT SUBSTRING_INDEX(
         SUBSTRING_INDEX(REPLACE(REPLACE(url,'https://',''),'http://',''),'/',1),
         '?', 1)                       AS wirt,
       COUNT(*)                        AS quellen,
       SUM(is_official = 1)            AS offiziell,
       SUM(license = '')               AS ohne_lizenz,
       SUM(attribution = '')           AS ohne_namensnennung
  FROM sources
 WHERE url <> ''
 GROUP BY wirt
 ORDER BY quellen DESC;
```

---

## 5. Die vier Riegel im Dump

### 5.0 💣 Es sind VIER Inhalts-Namensräume, nicht einer

Gemessen am 01.09.2026 an der Wiki-API (`https://de.wiki-aventurica.de/de/api.php`,
`meta=siteinfo&siprop=namespaces` — **anonym erreichbar**, anders als `Spezial:Alle_Seiten`).
Das Wiki führt fünf Namensräume mit `"content": true`:

| ns | Name | Inhalt | Kanon? |
|---:|---|---|---|
| 0 | (Hauptraum) | der Bestand, den wir heute lesen | offiziell |
| 218 | `DSK` | *Die Schwarze Katze* — Produktartikel, **seit 11.02.2026 dorthin verschoben** | **offiziell** (Ulisses-Ableger) |
| 220 | `Elf` | ELF-Lizenzprodukte | zu entscheiden |
| 222 | `Inoffiziell` | Fan- und Briefspielinhalte | **inoffiziell** |
| 444 | `Ilaris` | ein Fan-Regelwerk | **inoffiziell** |

🔴 **Ein Namensraum ≠ 0 heißt NICHT „inoffiziell".** `DSK` ist eine offizielle Ulisses-Produktlinie
mit eigenem Namensraum. Wer den Riegel als „alles außer ns 0 ist inoffiziell" aufmacht, stempelt
*Die Schwarze Katze* zu Fanmaterial. Die Regel aus §2.1 gilt **nur für ns 222** (und, nach
Entscheid, ns 444); jeder weitere Namensraum braucht eine ausdrückliche Haltung, keine Ableitung
aus seiner Nummer.

💣 **Und wir sind schon heute blind, nicht erst ab ns 222.** Die Produktartikel zu *Die Schwarze
Katze* liegen seit Februar 2026 in ns 218 — unser Publikationskatalog liest `{{Infobox Produkt}}`
aber nur bei `ns === 0` (`publication-sync.php:502`). **Rund ein halbes Jahr DSK-Produkte fehlen
im Katalog**, und niemand hat es gemerkt, weil ein verworfener Namensraum keine Meldung erzeugt.

🔧 **Vor dem Bauen zu klären:** ist `Elf` (ELF-Lizenzprodukte) für uns offiziell? Das Wiki hatte
dazu am 09.05.2025 eine eigene Grundsatzdiskussion („Einordnung von ELF-Lizenzprodukten"). Wir
brauchen dieselbe Entscheidung, weil sie das Etikett bestimmt.

⭐ **Die API ist anonym nutzbar** und beantwortet solche Fragen ohne Dump — nützlich als
Gegenprobe, aber **kein Ersatz**: sie unterliegt derselben Drossel (Crawl-delay 20) wie alles
andere.

### 5.0a Am Septemberdump nachgezählt (01.09.2026, zweifach unabhängig gemessen)

| Größe | Wert |
|---|---|
| Seiten im Dump | 252.902, **alle** mit `<page><id>` |
| ns 222 gesamt | 6.457 (davon 596 Weiterleitungen) |
| davon mit Karten-Infobox | **297** — 180 Siedlung, 69 Staat, 29 Bauwerk, 16 Region, 3 Fluss |
| ns 222 mit `{{Register Inoffiziell…}}` | 1.573 — **4.288 echte Seiten tragen den Marker NICHT** |
| ns 222 mit aktivem `==Publikationen==` | 337 |
| ns 218 / 220 / 444 | 662 / 101 / 1.144 |

⭐ **Die 297 sind belastbarer als eine blosse Zählung**: keine Seite trägt zwei dieser Infoboxen,
keine ist eine Weiterleitung, keine steht in einem Kommentar, und bei allen ist die Karten-Infobox
zugleich die **erste** `{{Infobox …}}` der Seite — was zählt, weil
`avesmapsWikiSyncMonitorInfoboxName` (`sync-monitor-parsing.php:50`) nur die erste liest.

⭐ **ns 444 (Ilaris) bringt keine Kartenobjekte**: 1.103 Infoboxen, aber keine einzige der fünf
Kartentypen. Karten-Infoboxen gibt es ausschliesslich in ns 0 (8.625) und ns 222 (297).

💣 **Die Kollisionszahl hängt an der Messmethode, und der erste Anlauf hat sich vertan.**

| Schlüssel | Vergleich | Treffer |
|---|---|---|
| gestrippter Titel | exakter String | 47 |
| `\|Name=` | exakter String | 57 |
| gestrippter Titel | echter Match-Key | 56 |
| **`\|Name=`** | **echter Match-Key** | **61** |

Der Code bildet den Schlüssel aus `|Name=` und schneidet den Klammerzusatz weg — **61** ist die
Zahl, die zählt. Bei 53 der 297 weicht `|Name=` vom Titel ab. ⚠️ Und zwei gern genommene
Beispiele taugen nicht: `Apfeldorn` hat gar keinen ns-0-Artikel, `Baronie Metenar` kollidiert
nicht (`|Name=Baronie Metenar/Briefspiel`). Tragfähig sind Temphis, Spogelsen, Baronie Lyngwyn.

### 5.1 Die Riegel im Einzelnen

💣 **1 · ns 222 kommt nicht an — und der Riegel liegt an FÜNF Stellen, nicht an einer.**
Nachgemessen am 01.09.2026, während der erste Lauf mit dem neuen Dump lief:

| Stelle | Wirkung |
|---|---|
| `dump-entity-scan.php:250` (`avesmapsWikiDumpClassifyPage`) | jede Seite mit `ns != 0` ist **nie** eine Entität |
| `publication-sync.php:378` | ruft dieselbe Funktion — erbt den Riegel |
| `publication-sync.php:416` | `ns !== 0` → Seite übersprungen |
| `publication-sync.php:502` | `{{Infobox Produkt}}` wird **nur** bei `ns === 0` gelesen |
| `publication-sync.php:590` | `==Publikationen==` wird **nur** bei `ns === 0` gelesen |

⚠️ **Die letzte Zeile ist die unangenehmste**: selbst wenn ns 222 durchkommt, bliebe die
Publikationsliste einer `Inoffiziell:`-Seite ungelesen. Wer nur `dump-entity-scan.php:250` öffnet,
hält den Riegel für gefallen und wundert sich, warum die Belege fehlen.

⭐ **Der LESER filtert nicht.** `dump-reader.php:168` reicht `ns` ausdrücklich durch — „filtering is
the caller's job". Es ist also wirklich nur diese Aufruferschicht, die zu ändern ist; am Strom
selbst nichts.

⭐ **Und die Dump-DATEI enthält alles.** Sie liegt unter `uploads/dumps/dewa_dump_small.xml.bz2`
(HTTP-gesperrt per `.htaccess`). Ob das Wiki ns 222 überhaupt mitliefert, lässt sich dort
unabhängig von unseren Filtern nachsehen:

```bash
bzcat uploads/dumps/dewa_dump_small.xml.bz2 | grep -c '<ns>222</ns>'
bzcat uploads/dumps/dewa_dump_small.xml.bz2 | grep -o '<title>Inoffiziell:[^<]*' | head -20
```

🔧 Erster Lauf mit dem neuen Dump: 01.09.2026.

💣 **2 · `===Inoffizielle Quellen===` wird verworfen — auch auf offiziellen Artikeln.**
`api/_internal/wiki/publication-parsing.php:77–91` kennt nur *Ausführliche*, *Ergänzende* und
*Erwähnungen*; jede andere Überschrift gibt `null` zurück und der ganze Abschnitt fällt weg. Ein
kanonischer Ort mit einer Briefspiel-Fußnote verliert sie heute lautlos. **Das ist ein eigener
Riegel und hat mit ns 222 nichts zu tun.**

🔴 **3 · Die Publikationsregel im Owner-Wortlaut:**
> *„A wiki publication is an official source **unless an entry is in namespace Inoffiziell
> (ns 222)**."*

Sie ersetzt das feste `true` samt Kommentar in `api/_internal/wiki/publication-sync.php:672`.

⚠️ **Riegel 1 und 3 sind derselbe Riegel.** Der Publikationskatalog wird aus demselben Dump gebaut,
der ns 222 verwirft — eine Publikation, die dort liegt, ist heute gar nicht im Katalog und kann
folglich auch nicht als inoffiziell erkannt werden. Vorher lässt sich die Regel nur schreiben,
nicht prüfen.

🔴 **4 · `match_key` darf `Inoffiziell:` nicht mehr abstreifen.** Das Präfix ist vom Störfaktor zum
Träger der Aussage geworden. Nebeneffekt, gleich mit erledigt: *Inoffiziell:Apfeldorn* kollidiert
nicht mehr mit einem gleichnamigen offiziellen Ort.

⚠️ **Offen dabei: die Zuordnung zum Bestand.** Behält der Schlüssel das Präfix, findet er die
Objekte nicht wieder, die aus dem Briefspiel schon **ohne** Präfix angelegt wurden — der
Garetien-Import legt sie unter dem blanken Namen an. Entweder der Abgleich versucht beide Formen,
oder die Import-Objekte bekommen den Präfix-Schlüssel einmalig nachgetragen. **Zu entscheiden, wenn
ns 222 da ist** — vorher lässt sich nicht messen, wie viele es betrifft.

---

## 6. 🔧 Woran die bauende Session FRÜH scheitern wird — bitte vorher melden

Diese Liste ist der eigentliche Zweck dieses Abschnitts. Owner-Bitte 27.08.2026: **frühzeitig auf
Probleme hinweisen, nicht erst beim Abnehmen.**

### 6.1 Helles Thema

⚠️ **Alle Mockups sind im dunklen Thema entstanden.** Die Kontraste des hellen sind *gerechnet*,
nicht am Bildschirm gesehen. Drei Dinge dort zuerst prüfen:

- **Ein gefülltes dunkelgoldenes Feld auf Pergament (`--color-panel` #fffdf9) ist laut.** Im
  dunklen Thema sitzt ein helles Feld auf dunklem Grund und wirkt ruhiger. Es kann sein, dass das
  helle Thema eine hellere Füllung mit dunkler Schrift braucht — also die *umgekehrte* Polarität.
- **Faculty Glyphic hat nur Regular** (`css/base/fonts.css`, `css/base/base.css:44-45`). Die
  Versalien tragen ihr Gewicht über Sperrung, nicht über Fettung; ein synthetisch gefettetes
  10px-Versal wird im hellen Thema matschig.
- **Der neutrale Umriss des Bezeichnerfelds** muss auf beiden Gründen sichtbar bleiben —
  `--color-border` ist hell #ddd3c3 und dunkel #514a3c, beides schwach.

### 6.2 Bulk-Aktionen

💣 **Ein Schreibweg für `sources` existiert nicht.** Heute legt man eine Quelle mit derselben URL
neu an, das füllt leere Felder; überschreiben kann man nichts. **Einzelfall und Massenaktion sind
derselbe Weg** — wer nur den Massenknopf baut, baut einen Weg, den niemand einzeln prüfen kann.

⚠️ **Eine Quelle ist geteilt.** Eine Änderung wirkt auf jedes Objekt, das sie verwendet. Die
Oberfläche muss die Zahl zeigen („an 3 Objekten"), sonst ändert jemand eine Lizenz im Glauben, es
betreffe den Ort, den er gerade offen hatte.

💣 **Nur leere Felder füllen, nie überschreiben.** Das Wirtprofil ist eine Vermutung aus der
Adresse; ein von Hand gepflegter Wert schlägt sie immer.

💣 **`sources.url_hash` trägt einen UNIQUE-Schlüssel und IST die Identität.** Wer bei einer
Massenaktion Adressen anfasst, muss die Kollisionsprüfung aus
`sql/weiden-baronielinks-liste-bn.sql` (Abschnitt 2b) übernehmen — dort steht der Fall schon
dokumentiert, inklusive der Waise, die dabei entstand.

⚠️ **`sources.id` hängt nicht nur an `feature_sources`**, sondern auch an
`adventure_place.created_from_source_id`. Ein rohes `DELETE FROM sources` lässt die stehen.

### 6.3 Karte und Zwischenspeicher

💣 **Eine Quellenänderung fasst `map_revision` heute ausdrücklich NICHT an**
(`sql/weiden-baronielinks-liste-bn.sql:290`). Das abgeleitete Etikett hängt aber an den Quellen —
ohne Anschluss zeigt die Karte nach einer Massenaktion tagelang das alte Etikett.

⚠️ **Das Etikett darf nicht zur Anzeigezeit gerechnet werden.** Es ist ein Join über alle
verknüpften Quellen; der Kartenaufbau wurde gerade erst auf 2,5 s gedrückt (und mit
Ganzkörper-Dateicache darunter). Es gehört in dieselbe Vorberechnung wie `map_revision`.

### 6.4 Darstellung

⚠️ **Die Halbpille ist eine neue Form** in einer Oberfläche, die sonst nur einfache Pillen kennt
(`fs-src-tab`, `fs-row__badge`, `fs-row__kind`, `fs-row__add` — alle `border-radius: 999px`). Sie
muss überall gleich aussehen, sonst wird sie zum Ausreißer statt zum Zeichen. **Ohne zweites Feld
ist sie einfach eine Pille** — das ist der häufigste Fall (offiziell).

⚠️ **Englisch wird breiter.** „Play-by-mail (Garetien)" (`js/app/i18n-en.js:546`) im Kopf und in
der Quellenzeile prüfen — die Quellenzeile ist enger als der Kopf.

⚠️ **Farbe allein ist keine Auszeichnung.** Der Stempel ist Text, das ist der halbe Weg; das
Bezeichnerfeld braucht `title` und eine sinnvolle Vorlesereihenfolge: *„Schild des Reiches,
offiziell, Regionalspielhilfe, Seite 69"* — nicht die Marken zuerst.

⚠️ **Die Höhe des Quellenkastens wächst jetzt linear.** Zwei Quellen: kein Problem. Acht
handgepflegte: acht Zeilen, wo ein umbrechender Absatz stand. Ab einer noch zu messenden Zahl
gehört der Kasten eingeklappt oder nach Kanon gruppiert:

```sql
SELECT entity_type, entity_public_id, COUNT(*) c
  FROM feature_sources WHERE status='approved'
 GROUP BY 1,2 ORDER BY c DESC LIMIT 20;
```

⚠️ **Die Publikationstabelle bekommt eine vierte Spalte.** `js/ui/feature-source-markup.js` setzt
dort heute ein `<colgroup>` mit **drei** Spalten (`fs-src-col-title/type/pages`) — die Breiten
müssen neu gedacht werden, und `.fs-src-col-pages` ist ausdrücklich schmal und fest.

### 6.5 Datenmodell

⚠️ **`permission` ist eine neue Spalte** an `sources`, nach dem Selbstheilungsmuster von
`avesmapsEnsureFeatureSourceTables` (`api/_internal/app/feature-sources.php`). ⚠️ **Leer heißt
„nicht erfasst", nie „keine Genehmigung"** — dieselbe Regel, die für `license` schon gilt.

⚠️ **Die Schreibwege müssen sie alle kennen**: `avesmapsFeatureSourceUpsert`,
`avesmapsAddFeatureSource`, der Editor, das Meldeformular und die Wirtprofile. Ein Weg, der sie
vergisst, wirft sie beim nächsten Anlegen still weg.

---

## 7. Offene Punkte

| # | Frage | Stand |
|---|---|---|
| 1 | Bezeichner bei mehreren inoffiziellen Urhebern | Vorschlag „Briefspiel (2)" mit den Namen im `title` — dieselbe Kürzung wie `ff.` bei Seitenzahlen |
| 2 | Lizenz in Klammern oder nach Mittelpunkt? | Klammer kollidiert mit Namen wie „Briefspiel (Garetien)" |
| 3 | Ab welcher Quellenzahl klappt der Kasten ein? | Messung, §6.4 |
| 4 | Zuordnung des `Inoffiziell:`-Präfixes zum Altbestand | erst nach dem 01.09. messbar, §5 |
| 5 | Wie meldet der Syncer das Paar „ns 222 + offizielle Quelle"? | Fläche und Wortlaut offen; die Regel steht (§2.1) |

---

## 8. Reihenfolge der Bauabschnitte

| # | Abschnitt | Bringt | Hängt an |
|---|---|---|---|
| 1 | Reiter umbenennen · Kasten um die Quellen · Stempel je Quelle | reine Anzeige, sofort sichtbar, kein Datenrisiko | — |
| 2 | Pflichtwahl Kanon im Editor und im Meldeformular | stoppt den Zufluss unbestimmter Daten | — |
| 3 | Seite „Quellen" mit Schreibweg, darauf Wirtprofil und Massenaktion | räumt die 1.694 Bestandszeilen | — |
| 4 | Objekt-Etikett samt Vorberechnung und Revisionsanschluss | das eigentliche Ziel | 3 |
| 5 | Die vier Dump-Riegel | Inoffizielles kommt automatisch herein | **ns 222 ab 01.09.** |

🔴 **Abschnitt 4 vor 5, obwohl 5 die Daten liefert — mit Absicht.** Das Etikett muss aus den Quellen
rechnen können, bevor der Dump inoffizielle nachliefert; sonst kommt am 1.9. ein Datenstrom herein,
für den es noch keine Anzeige gibt, und niemand sieht, ob er stimmt. Umgekehrt zeigt Abschnitt 4 auf
dem heutigen Bestand sofort etwas Prüfbares: die Briefspiel-Quellen, die längst von Hand gepflegt
sind.
