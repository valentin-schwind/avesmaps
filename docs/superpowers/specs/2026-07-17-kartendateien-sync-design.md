# Kartendateien-Sync — Design

> **Status:** Spec, vom Owner freigegeben 2026-07-17. Noch nicht gebaut.
> **Gehört zu:** `2026-07-16-kartensammlung-wiki-sync-design.md` (Stufen 1+2, live) — dies ist eine
> **dritte Quelle** neben Stadtplanindex und Kartenindex, kein Ersatz.
> **Berührt:** `2026-07-17-kartenvorschau-autoget-design.md` (parallele Session, live seit `17a5f3bc`) —
> dessen Routen-Wähler braucht einen Riegel, siehe §6. **Das ist die wichtigste Stelle dieser Spec.**

## 1. Ziel und Rahmen

Der Stadtplanindex ist eine **Konkordanz** („welche Karte steckt in welchem Buch") und verlinkt keine
einzige Karte. Deshalb sind `author` bei uns zu 1 % gefüllt und `map_url` zeigt bei 303 von 365 Karten
auf ein **Buch** statt auf die Karte. Das ist kein Bug — der Index hat die Felder schlicht nicht.

Die echten Angaben „an der Karte" hängen an `Datei:`-Seiten im Kategorie-Baum. Diese Spec bindet sie an.
Was sie liefert:

| | Konkordanz (live) | Kartendateien (diese Spec) |
|---|---|---|
| `author` | 6 / 419 (1 %) | **161 / 161 (100 %)** |
| `map_url` zeigt auf | das **Buch** (365 Karten, nur 133 verschiedene URLs) | **die Karte selbst** |
| Ortsauflösung | 83 % | 34 % gesamt · **81 % bei `Kategorie:Stadtplan`** |
| neue Karten | — | **159** (161 minus 2 Dubletten, §5): **53 mit Ort**, 106 als `unresolved` im Editor |

**Der Kern: 86 % der Dateien sind „selbst erstellt" — Fan-Karten, die in keinem Buch stehen.** Die
Konkordanz listet Buchkarten. Die beiden Quellen sind fast disjunkt (§5).

## 2. Datenlage — gemessen 2026-07-17, nicht neu erheben

Über `https://de.wiki-aventurica.de/de/api.php`, alle 161 Wikitexte gelesen (~8 Requests).
Gegengeprüft gegen `GET /api/app/citymaps.php` (419 Karten) und `GET /api/app/map-features.php`
(10 396 Features, 2 544 Siedlungsnamen) — je **ein** Abruf, kein Loop (AGENTS.md §9).

### 2.1 Umfang und Auflösung

| Kategorie | Dateien | Ort aufgelöst | Quote |
|---|---|---|---|
| **Stadtplan** | 47 | **38** | **81 %** |
| Inoffizielle Karte *(Quer-Kategorie, überlappt)* | 58 | 36 | 62 % |
| Kartenskizze | 20 | 3 | 15 % |
| Stadtplanausschnitt | 13 | 1 | 8 % |
| Grundriss | 43 | **1** | **2 %** |
| Lageplan | 11 | **0** | **0 %** |
| **gesamt (unique)** | **161** | **55** | **34 %** |

**Die 0 % bei Grundriss/Lageplan sind echt, kein Parser-Problem** (mit einem Resolver geprüft, der jede
zusammenhängende Wortfolge probiert, CamelCase trennt und Klammern als Ortskandidat liest). Es sind
Gebäude-Innereien und Abenteuer-Schauplätze: `Gasthaus zum Eber`, `GialsTurm00–07`, `Grotte`,
`Basic House`, `Herberge Wegrast EG`, `Inquisitor burg`. Die haben keinen Ort, weil sie keinen haben.

**Owner-Entscheidung: trotzdem alle 6 Kategorien.** Die 106 ortlosen Dateien landen wie beim
Abenteuer-Sync als `target_kind='unresolved'` mit erhaltenem `raw_name` im Editor und können dort von
Hand zugeordnet werden. Das ist das etablierte Muster, kein Sonderweg.

**Die 11 Nicht-Siedlungs-Treffer sind korrekt, keine False Positives:** `Goblinpfad.jpg` → der Weg
*Goblinpfad* (`path/Pfad`), `Das Bornland.png` → die Region (`label/region`), `Baerenklamm
uebersicht.jpg` → das Gebirge, `Angbarer See und Koschberge` → der See. Die Kartensammlung hängt
ohnehin an Siedlung/Territorium/Region/Weg. ⚠️ Der Resolver darf **nicht** auf `location` beschränkt
werden, und **nicht** auf `subtype='region'` filtern (Memory `landscape-label-subtypes-not-region`).

### 2.2 Rechteinhaber — 44 Urheber, Ulisses ist keiner davon

| Urheber | Dateien |
|---|---|
| Sir Gawain | 38 |
| Robak | 33 |
| Gial | 13 |
| Martin Lorber *(offizieller DSA-Kartograf, eingestellt von „Fil")* | 14 |
| Ina Kramer *(offiziell, `{{Kartenpaket-Lizenz}}`)* | 4 |
| 39 weitere | je 1–4 |

**80 % Fan-Material** (Wiki-Benutzer als Urheber oder Quelle „selbst erstellt"), 17 % Ulisses-nah.
Das ist die Zahl, die die Lizenzfrage entscheidet (§3).

### 2.3 Lizenzen — 6 von 161 sind frei

| Lizenz | Zahl | frei? |
|---|---|---|
| `{{Copyright}}` / `{{copyright}}` — „Verwendung **in diesem Wiki** gerechtfertigt" | 60 | nein, ausdrücklich |
| CC mit **nc** (`{{CC\|40 by nc}}`, `{{CC\|30 by nc sa}}`, …) | 56 | nein |
| Freitext „Weitere Verbreitung wird **nicht gestattet**" (Fil / Martin Lorber) | 14 | nein, ausdrücklich |
| CC-BY-SA / CC-BY (Namensnennung) | 13 | nein — die Kartensammlung hat **kein** `attribution_required` |
| `{{Kartenpaket-Lizenz}}` (Ulisses-Fanprojekt) · `{{Nandurion-Lizenz}}` (CC-BY-NC, nur bestimmte Projekte) | 11 | nein |
| `{{Free Art Licence}}` (Copyleft + Namensnennung) | 1 | nein, kein Slot |
| **`{{Public domain}}` (4) + `{{CC 0}}` (2)** | **6** | **ja** |

**Und die Pointe: von den 47 `Kategorie:Stadtplan`-Dateien ist genau EINE frei** — `Datei:Then 1015
BF.png` (`{{CC 0}}`, Urheber Roban Loken), und die löst auf einen Ort auf. Die 5 anderen freien sind
Grundrisse/Kartenskizzen, also aus den Kategorien, die zu 0–15 % auflösen und damit nirgends erscheinen.

**Der Bild-Weg holt also 161 Bilder, um 1 zu zeigen.** Der Owner kennt die Zahl und hat entschieden.

## 3. Die Lizenz-Entscheidung (Owner 2026-07-17 — nicht neu verhandeln)

**Fakten für alle, Bild nur bei `cc0` / `public_domain` / `permission_granted` — für Vorschau UND
volle Karte, gleiche Regel.**

Die Begründung, damit sie niemand „repariert":

1. **Ulisses ist hier nicht der Rechteinhaber.** Die Fanrichtlinien decken Ulisses-Material. Eine
   Stadtkarte von „Sir Gawain" gehört Ulisses nicht; Ulisses kann uns daran nichts erlauben. Die
   Rechte liegen bei 44 einzelnen Fans (§2.2).
2. **Vorschau und Karte sind hier dasselbe Werk.** Bei den Abenteuer-Covern sind es zwei Dinge
   (Werbebild ↔ Produkt), und die Vorschau verlinkt in den F-Shop zurück — sie wirbt für das Produkt.
   Eine Fan-Karte hat kein Produkt, für das ihre Verkleinerung werben könnte. Der Lizenzstatus ist
   identisch.
3. **Der Fetch selbst wäre bei 74 Dateien nicht gedeckt**, unabhängig von der Anzeige: 60 erlauben
   Verwendung ausdrücklich nur *im Wiki*, 14 verbieten Weiterverbreitung wörtlich. Eine Kopie auf
   unserem Server ist eine Vervielfältigung.

**Die Wand hat eine Tür, und sie ist der eigentliche Hebel:** die Rechte sind extrem konzentriert —
**Sir Gawain (38) + Robak (33) = 71 Dateien = 44 %** bei zwei Personen. Fragt der Owner sie, flippt er
die Lizenz im Editor auf `permission_granted`, und das Bild wird geholt. **Ohne Code-Änderung.**
Daraus folgt eine harte Anforderung an den Reconcile (§7): **eine von Hand gesetzte Lizenz darf der
nächste Sync niemals zurücksetzen.**

**Was der Leser stattdessen bekommt** — und das ist kein Trostpreis, sondern das, was die Konkordanz
nie liefern konnte: Urheber (100 %), die Lizenz im Klartext, und einen Link, der auf **die Karte**
zeigt statt auf ein Buch, in dem sie steckt. Ein Link auf eine `Datei:`-Seite ist ein Verweis, genau
wie `map_url` heute — kein Bild auf unserem Server, keine Lizenzfrage.

## 4. Identität — `kartendatei:<Dateiname>`

**Der Wiki-Dateiname ist global eindeutig; das MediaWiki erzwingt es.** Der Schlüssel ist also
geschenkt und muss nicht wie bei der Konkordanz aus drei Teilen zusammengesetzt werden
(`stadtplanindex:<stadt>:<quelle>:<variante>`).

```
wiki_key   = 'kartendatei:' . avesmapsPoliticalSlug('Alriksfurt beschriftet.jpg')
index_page = 'kartendatei'          // dritter Wert neben stadtplanindex / kartenindex
```

**Die Trennung greift von selbst:** `avesmapsCitymapWriteStaging` löscht
`DELETE FROM wiki_citymap_catalog WHERE index_page = :ix` — scoped. Die drei Namensräume können sich
also nicht gegenseitig leerräumen. **Keine neue Tabelle, keine neue Spalte, kein neuer Delete-Pfad.**

Neue Konstante neben den bestehenden:

```php
const AVESMAPS_CITYMAP_INDEX_DATEI = 'kartendatei';
```

## 5. Dubletten — 2 von 47, und sie verraten sich selbst

Gemessen: **null** Dubletten bei den Fan-Karten. Acht Dateien treffen einen Ort, der schon Karten hat,
aber sieben davon sind „selbst erstellt" — Gashok hat 3 Buchkarten *und* eine Fan-Karte, das sind vier
verschiedene Karten und kein Fehler.

**Echte Dubletten sind es genau zwei**, beide Beilunk, beide Martin Lorber:

| Datei | Quelle | Konkordanz kennt |
|---|---|---|
| `Datei:BeilunkStadtplan.gif` | „S/W-Abdruck in [[Pilgerpfade]], S.89" | „Stadtplan von Beilunk (Bunte Scherben (Pilgerpfade))" |
| `Datei:Beilunk Karte Stadtviertel.jpg` | „S/W-Abdruck in hoher Qualität [[Pilgerpfade]] S.34, S.89" | dieselbe |

**Regel: überspringen, wenn die `Quelle` auf eine Seite im vorhandenen `wiki_publication_catalog`
verlinkt.** Das ist kein Raten — der Katalog ist die Liste der echten DSA-Publikationen aus
`{{Infobox Produkt}}`, gebaut von der `publication_sources`-Phase. „Pilgerpfade" steht dort,
Fanpakete wie „Heldenatelier-Fanpaket", „Nandurion Fanpaket" oder „Kartenpaket" nicht — die bleiben
also drin, obwohl ihre Quelle einen Wikilink trägt.

**Nicht** die einfachere Regel „Quelle nennt irgendeinen Wikilink" verwenden: die würde 7 legitime
Fan-Karten (Heldenatelier, Nandurion, Kartenpaket, DeviantArt) fälschlich verwerfen.

⚠️ **Beim ersten echten Lauf zu prüfen** (keine lokale DB): dass `wiki_publication_catalog`
„Pilgerpfade" wirklich enthält. Fällt die Regel aus, sind es 2 Dubletten von 55 — der Editor mergt sie
von Hand, und ein Edit adoptiert die Karte ohnehin auf `origin='manual'`, womit der nächste Sync sie
nicht mehr anfasst. Der Fallback ist also harmlos.

## 6. ⚠️ Der `Datei:`-Riegel — die wichtigste Stelle dieser Spec

**Ohne ihn macht dieser Sync 153 CC-BY-NC-Fan-Karten öffentlich** (159 angelegte minus die 6 freien).
Der Owner hat entschieden, dass der Riegel hierher gehört (2026-07-17).

Der Vorschau-Autoget (live seit `17a5f3bc`) entscheidet die Öffentlichkeit **über die Route**, und das
ist bewusst so — „a flag can be set wrongly; a route cannot". Die Wiki-Route gilt als
vertrauenswürdig genug zum Veröffentlichen, weil „a wiki page image is a **publisher cover by
construction**". Aber:

```php
// api/_internal/app/citymaps.php:601 — prüft NUR Scheme, Host, /wiki/-Präfix
function avesmapsCitymapWikiPageTitle(string $mapUrl): string
```

`https://de.wiki-aventurica.de/wiki/Datei:Alriksfurt_beschriftet.jpg` erfüllt alle drei Bedingungen
→ Route `wiki` → `thumb_license = 'permission_granted'` → **öffentlich**. Eine `Datei:`-Seite ist aber
kein Verlagscover, sondern eine Fan-Karte unter CC-BY-NC.

**Heute ist das latent: 0 von 419 `map_url` haben die `Datei:`-Form** (live gemessen, §2). Der Bug
existiert, aber nichts löst ihn aus. **Dieser Sync wäre der erste Auslöser** — er legt 159 solcher
URLs an (§1), und nur 6 der 161 Dateien tragen eine freie Lizenz.

**Fix — die Annahme explizit machen, die der Kommentar schon behauptet:**

```php
$title = trim(str_replace('_', ' ', rawurldecode(substr($path, strlen('/wiki/')))));
// A File: page is NOT a publisher cover -- it is whatever a fan uploaded, under whatever licence the
// file page states. The wiki route publishes its result by construction, so it must never see one.
if (preg_match('/^(Datei|File)\s*:/iu', $title) === 1) {
    return '';
}
return $title;
```

Der Riegel ist **unabhängig von diesem Feature korrekt**: er verhindert auch, dass ein Editor von Hand
eine `Datei:`-URL einträgt und der nächste Durchlauf sie veröffentlicht.

**Folge für die Route:** `Datei:`-URLs fallen damit auf `ogimage` durch — und das wäre ein **HTML-Crawl
auf wiki-aventurica**, also ein Bruch der Betreiber-Zusage. Deshalb muss der Autoget-Schritt sie
**ganz überspringen**, mit eigenem Zustand:

```
thumb_auto_state = 'skipped_file_page'   // kein Fetch, keine Route
```

Das passt zur bestehenden Regel „jeder Ausgang bekommt einen Zustand, sonst endet der Durchlauf nie"
(Autoget-Spec §8) und zum Bericht, der Übersprungene nennt. **Die Bilder dieser Karten holt der
Datei-Sync selbst** — er kennt die Lizenz aus dem Wikitext, der Autoget kennt sie nicht. Saubere
Arbeitsteilung:

| | Autoget-Durchlauf | Kartendateien-Sync |
|---|---|---|
| Quelle | Buch-/Produktseiten | `Datei:`-Seiten |
| Bild | Verlagscover | Fan-Karte |
| Lizenz | `permission_granted` per Route | **aus dem Wikitext klassifiziert** |
| öffentlich | ja | nur bei `cc0`/`public_domain`/`permission_granted` |

## 7. Was ankommt

| Feld | Herkunft | Abdeckung |
|---|---|---|
| `author` | `\|Urheber=` (Wiki-Benutzer-Vorlagen aufgelöst) | **161/161** |
| `map_url` | `https://de.wiki-aventurica.de/wiki/<Datei-Titel>` | 161 — zeigt auf **die Karte** |
| `type_key` | die Kategorie: Stadtplan→`stadtplan`, Grundriss→`grundriss`, Lageplan→`lageplan`, Kartenskizze→`skizze` | 161 |
| `is_official` | `false` bei Kategorie „Inoffizielle Karte" **oder** Quelle „selbst erstellt"; sonst `NULL` | 40/47 belegt |
| `is_color` | „bunt"/„Farbe" im Dateinamen → `true`; „sw"/„grau" → `false`; sonst `NULL` | |
| `is_labeled` | „beschriftet" → `true`; „unbeschriftet" → `false`; sonst `NULL` | |
| `map_license`, `thumb_license` | aus dem Wikitext klassifiziert (§8) | 6 frei |
| `map_license_note` | Lizenz + Quelle im Klartext als Nachweis | 161 |
| `note` | `\|Quelle=` | 161 |
| `publisher` | **leer** — Fan-Karten haben keinen Verlag | — |
| `format`, `has_scale` | **leer** — die Datei-Seiten nennen sie nicht | — |

**`is_official`: die Kategorie allein reicht nicht.** 27 Stadtpläne sind kategorisiert, aber 13
weitere sind nur über „selbst erstellt" als inoffiziell erkennbar — die Kategorie hätte sie fälschlich
auf `NULL` gelassen. Umgekehrt gibt es **keinen** Fall „Kategorie inoffiziell, aber nicht selbst
erstellt". 7 bleiben ehrlich `NULL` (§3.1: unbekannt ≠ false, kein Raten).

**Override-Sicherheit (die Tür aus §3 hängt daran):** Der Reconcile schreibt und löscht **nur**
`origin='wiki'`. Eine von Hand auf `permission_granted` gesetzte Lizenz überlebt jeden Sync — sonst
wäre die Genehmigung von Sir Gawain nach dem nächsten Lauf wieder weg. Ein Edit adoptiert die Karte
ohnehin auf `origin='manual'` (bestehendes Verhalten, `IF()`-gescoped).

## 8. Der Lizenz-Parser — `{{CC|…}}` ist neu

**Die Wappen-Funktion kann die Karten-Lizenzen nicht lesen.** Gemessen: sie erkennt 4 von 161
(`{{Public domain}}`) und stuft alles andere als `unknown` ein — **auch `{{CC 0}}`**, also ausgerechnet
Then, das einzige Bild, das wir zeigen dürften.

Der Grund ist die Syntax: `avesmapsWikiSyncMonitorParseLicense` sucht `/cc[\s_-]?by[\s_-]?sa/`, das
Wiki schreibt aber `{{CC|40 by nc}}` — Vorlagenname, Pipe, Version, dann die Terms. Zwischen „CC" und
„by" steht `|40 `, was `[\s_-]?` nicht matcht.

**Was wiederverwendet wird** (die Auflage „erweitern statt neu bauen" trifft genau hier zu):

- `avesmapsWikiSyncMonitorExtractFileField($wikitext, ['Urheber','Autor','Rechteinhaber'])` — der
  Feld-Extraktor ist quellenagnostisch und löst `{{Benutzer|X}}` / `[[Benutzer:X|X]]` bereits auf.
  Er ist der Grund für die 100 % Urheber-Abdeckung.

**Was neu ist:**

- Die `{{CC|<version> <terms>}}`-Erkennung: `40 by nc` → CC-BY-NC-4.0, `30 by nc sa` → CC-BY-NC-SA-3.0.
  Terms auch mit Bindestrichen (`40 by-nc-sa`, 2×) und in freier Reihenfolge (`by nc nd 3.0`, 1×).
- `{{CC 0}}` → `cc0` und `{{Public domain}}` → `public_domain`.
- Die Übersetzung ins **Karten**-Vokabular (`public_domain|cc0|ai_generated|permission_granted|unknown_other`).
  Das Wappen-Vokabular kennt `cc0` gar nicht, eine gemeinsame Funktion ginge also ohnehin nicht.
- **Alles Unbekannte → `unknown_other`** = nicht frei. Der konservative Default trägt: die 60
  `{{Copyright}}`, die 14 „nicht gestattet", `{{Kartenpaket-Lizenz}}`, `{{Nandurion-Lizenz}}` und
  `{{Free Art Licence}}` landen alle dort, ohne dass wir sie einzeln kennen müssen.

**Die Wappen-Funktion wird NICHT geändert** — sie gehört einem anderen Feature, und ihre PD-only-Policy
macht die Fehlklassifizierung dort folgenlos (CC-BY-NC wäre so oder so ausgeblendet). Der eine echte
Effekt (ein `{{CC 0}}`-Wappen wird ausgeblendet, obwohl gemeinfrei) ist als eigene Aufgabe gemeldet.

## 9. Die Quelle — Online-API, bewusst nicht der Dump

**Entscheidung: die Kategorien *und* die Wikitexte kommen über die MediaWiki-API** — ~8 Requests für
alle 161 Dateien, in dieser Sitzung ausgeführt.

```
GET /de/api.php?action=query&generator=categorymembers&gcmtitle=Kategorie:<X>
    &gcmnamespace=6&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json
```

Ein Request liefert Titel **und** Wikitext **und** Kategorie in einem — die Datei-Seiten sind winzig
(300–600 Zeichen), 161 × ~500 B ≈ 80 KB.

Warum nicht der Dump, obwohl die Policy „Dump bevorzugen" sagt:

1. **Ungeprüft und nicht prüfbar.** Ob `dewa_dump_small.xml.bz2` `Datei:`-Seiten (ns=6) überhaupt
   enthält, ist offen — der Dump ist basic-auth-geschützt und server-only. Bauen und hoffen.
2. **Die Policy erlaubt es ausdrücklich:** „Dump bevorzugen, **API ok**, KEINE HTML-Crawls". 8
   JSON-Calls sind kein Crawl. Genau diese Abwägung trifft die Autoget-Spec §3 auch.
3. **Das Projekt fährt das Muster schon:** `online_class_map`, `online_building_map`,
   `online_continent_map` — vier Phasen von „Dump holen" sind online, weil der Dump es nicht hergibt.

**Der Parser hängt an der vorhandenen `pageSource`-Naht** (`avesmapsCitymapDefaultPageSource()`:
`(dumpPath, skip) => page rows`). Der Wechsel auf den Dump bliebe damit ein Austausch der Quelle, nicht
des Parsers — falls sich später herausstellt, dass ns=6 im Dump liegt.

⚠️ **Höflichkeit:** `gcmlimit=50` (die Grenze für normale Nutzer; `highlimit`=500 bräuchte Bot-Recht,
das wir nicht haben) + Pause zwischen den Requests. Kein Loop über einen schweren Endpoint.

## 10. Was gebaut wird

| Datei | Was |
|---|---|
| `api/_internal/wiki/citymap-sync.php` | `AVESMAPS_CITYMAP_INDEX_DATEI`, der Datei-Parser (Wikitext → Karte), der Ortsauflöser aus dem Dateinamen, die Publikations-Dubletten-Regel |
| `api/_internal/wiki/citymap-file-licenses.php` (neu) | die `{{CC\|…}}`-Klassifizierung ins Karten-Vokabular (§8) — eigene Datei, weil sie weder zu den Wappen noch zum Index-Parser gehört |
| `api/_internal/app/citymaps.php` | **der `Datei:`-Riegel** in `avesmapsCitymapWikiPageTitle` (§6) + `skipped_file_page` im Zustands-Vokabular |
| `api/edit/map/citymap-autoget.php` | `Datei:`-URLs überspringen statt fetchen (§6) |
| `api/_internal/wiki/dump-hybrid-driver.php` | die Datei-Kategorien als Online-Phase in „Dump holen" |
| `api/edit/wiki/dump.php` | `sync_citymaps` liest den dritten Namensraum mit (kein neuer Knopf) |

**Kein neuer Sync-Knopf** (Owner-Muster: „Zwei Editoren, ein Button"): Die Dateien reisen im
vorhandenen „Karten syncen" mit, weil sie in dieselbe Staging-Tabelle und denselben Reconcile laufen.

## 11. Tests

**Rein und lokal beweisbar (keine DB):**

- **Lizenz-Parser:** `{{CC 0}}` → `cc0` · `{{Public domain}}` → `public_domain` · `{{CC|40 by nc}}`,
  `{{CC|30 by nc sa}}`, `{{CC|40 by-nc-sa}}`, `{{CC|by nc nd 3.0}}` → `unknown_other` ·
  `{{Kartenpaket-Lizenz}}`, `{{Nandurion-Lizenz}}`, `{{copyright}}`, „nicht gestattet" → `unknown_other`.
  **Gegen den echten Wikitext aller 161 Dateien**, nicht gegen erfundene Beispiele.
- **Der `Datei:`-Riegel:** `/wiki/Datei:X.jpg` → `''` · `/wiki/File:X.jpg` → `''` ·
  `/wiki/Datei%3AX.jpg` (prozentkodierter Doppelpunkt) → `''` · `/wiki/Dateiverzeichnis` → **Titel**
  (kein Doppelpunkt, also keine Datei-Seite — der Riegel darf nicht auf das blosse Wortpräfix feuern) ·
  `/wiki/Land des schwarzen Bären` → unverändert der Titel.
  **Plus ein Regressionstest auf `avesmapsCitymapAutogetRoute`**, der beweist, dass eine `Datei:`-URL
  nicht mehr die Route `wiki` bekommt — der Riegel wirkt sonst nur eine Ebene zu tief.
- **Ortsauflöser:** `Alriksfurt beschriftet.jpg` → „Alriksfurt" · `Zitadelle (Beilunk).jpg` → „Beilunk"
  (Klammer!) · `BeilunkStadtplan.gif` → „Beilunk" (CamelCase) · `Rosenhuegel.jpg` → „Rosenhügel"
  (ue↔ü) · `Basic House.png` → kein Treffer · `Grotte.jpg` → kein Treffer.
- **`is_official`:** Kategorie inoffiziell → `false` · nur „selbst erstellt" → `false` · weder noch →
  `NULL` (nie `true` raten).
- **`wiki_key`-Stabilität:** zweimal parsen → identischer Key, keine Dubletten.

**Erst live prüfbar** (keine lokale DB): die Online-Phase, der Reconcile, die `unresolved`-Zuordnung.
Abnahme: „Dump holen" → „Karten syncen" → `?siedlung=Alriksfurt` zeigt die Fan-Karte mit Urheber
„Heldentrutzer" und einem Link auf die Datei-Seite; **zweiter Lauf legt keine Dubletten an**; und
`?siedlung=Then` zeigt als einzige ein Bild.

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <test>
```

⚠️ Ohne `zend.assertions=1` prüft `assert()` **nichts** (Memory `php-js-test-commands`).

## 12. Risiken

- **`wiki_publication_catalog` muss „Pilgerpfade" kennen**, sonst greift die Dubletten-Regel nicht
  (§5). Fallback harmlos: 2 Dubletten von 55.
- **Der `Datei:`-Riegel fasst fremden Code an** (`api/_internal/app/citymaps.php`, gerade von der
  parallelen Session erweitert). Kleine Fläche, aber Kollisionsgefahr im geteilten Baum. Bei
  Push-Ablehnung `fetch` + `rebase origin/master`, nie force-push. **Niemals `git add -A`** — nur die
  eigenen Pfade stagen (AGENTS.md §9).
- **Der Ortsauflöser kann irren.** Er probiert jede Wortfolge; ein kurzer Dateiname könnte einen
  gleichnamigen Ort treffen, der nicht gemeint ist. Gegenmaßnahme: Mindestlänge 4 Zeichen für einen
  Match-Key, und `unresolved` ist die harmlose Alternative — im Zweifel lieber kein Ort als der falsche.
- **Kopplung an die MediaWiki-API:** Ändert sich `categorymembers`, liefert die Phase 0 Dateien
  („alle auf einmal leer" = das Signal).

## 13. Owner-Entscheidungen (nicht neu verhandeln)

1. **Gleiche Lizenzregel für Vorschau und volle Karte:** nur `cc0`/`public_domain`/`permission_granted`
   werden gehostet. Dass heute nur Then gezogen wird, ist akzeptiert — §3.
2. **Alle 6 Kategorien**, obwohl Grundriss/Lageplan zu ~0 % auflösen. Die ortlosen Dateien landen als
   `unresolved` im Editor — §2.1.
3. **Der `Datei:`-Riegel gehört in diese Spec**, nicht in einen getrennten Fix — §6.
4. **`permission_granted` ist die Tür:** Genehmigungen von Sir Gawain (38) und Robak (33) schalten
   44 % frei, ohne Code. Der Sync darf eine manuell gesetzte Lizenz niemals überschreiben — §3, §7.
