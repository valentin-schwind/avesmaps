# Design: Anklickbare Items in der Weg-Infobox + „Anzeigen"-Button

**Datum:** 2026-07-17
**Status:** Vom Owner freigegeben (2026-07-17)
**Betrifft:** Weg-Infobox (`createPathPopupMarkup`), Infopanel + schwebende Box, `js/app/wiki-deeplink.js`

## 1. Ziel

Zwei Owner-Wünsche an der Weg-Infobox (Beispiel: Reichsstraße 3):

1. **Referenzierte Items anklickbar machen.** Die Felder **Verlauf**
   („Elenvina → Zinnen am Ratsforst → …") und **Lage** („Nordmarken, Fürstentum
   Kosch, …") nennen Objekte, die wir auf der Karte selbst führen. Sie sollen zu
   Links werden, die dorthin fliegen und das Infopanel öffnen.
2. **Ein dritter Button „Anzeigen"** vor „Link teilen" und „Änderungen
   vorschlagen", der dasselbe tut wie der Deep-Link
   `?strasse=Reichsstraße_3` — gelbes Band über alle Segmente, Rauszoomen auf
   die Gesamtausdehnung.

## 2. Geltungsbereich

**Alle Wegformen außer Meerwegen** (Owner, wörtlich: „alle formen von wegen!
außer meerwegen"). Also: Reichsstrasse, Strasse, Weg, Pfad, Gebirgspass,
Wuestenpfad, **Flussweg** — nicht **Seeweg**.

Gate: `normalizePathSubtype(...) !== "Seeweg"`. Flüsse sind bewusst dabei — sie
laufen durch dieselbe Funktion, und ihre Verlauf-Stationen sind ebenfalls Orte.

## 3. Ausgangslage (recherchiert, nicht vermutet)

### 3.1 Die Wiki-Keys sind bereits weg

Beide Felder sind beim Parsen zu reinem Text plattgemacht:

- `verlauf`: `avesmapsWikiPathExtractVerlaufStations` (api/_internal/wiki/paths.php)
  nimmt bei `[[Ziel|Anzeigetext]]` per `end($parts)` den **Anzeigetext**. Das
  Link-Ziel ist verloren. Gespeichert wird ein flacher String `A → B → C`.
- `lage`: läuft durch `avesmapsWikiSyncCleanPoliticalTerritoryWikiValue`
  (api/_internal/wiki/territories-parsing.php), das `[[…]]` komplett strippt —
  damit sind auch die Token-Grenzen weg.

Belegter Fall in Reichsstraße 3: das Wiki hat
`{{Straße|[[Lyngwyn (Honingen)|Lyngwyn]]}}`, wir haben nur „Lyngwyn".

**Konsequenz:** Wir lösen über **Namen** auf, nicht über Keys.

### 3.2 Warum das `verlauf`-Format nicht angefasst wird

`avesmapsWikiPathCourseHash` hasht den `verlauf`-String; der Verlauf-Sync
(`docs/refactoring-verlauf-sync.md`) erkennt daran, ob sich ein Wiki-Verlauf
geändert hat. **Ein Formatwechsel würde jeden Weg fälschlich als „geändert"
melden.** Ein zusätzliches Feld (z. B. `verlauf_links_json`) wäre additiv-sicher,
bräuchte aber ein Staging-Schema-Feld **und einen vollständigen Re-Sync**
(„Dump holen" + Sync = Owner-Aktion) — und das Feature bliebe bis dahin dunkel.
Deshalb: **client-seitige Namensauflösung auf dem Bestand.**

### 3.3 Was der Client schon hat

- **Ortsindex:** `prepareLocationData` (js/routing/routing.js:55) füllt
  `locationData` + `locationMarkers` **synchron** und läuft in derselben
  `.then()`-Kette **vor** `preparePathData` (routing.js:355-357). Wenn
  `createPathPopupMarkup` läuft, sind die Orte garantiert da — **kein Rennen**
  (vgl. `infopanel-catalog-race`, das ein *fetch*-Rennen war; hier gibt es keinen
  zweiten fetch).
- **Territorienindex:** `map-features.php` liefert pro Siedlung
  `properties.political.hierarchy = [{name, type, territory_public_id}]`
  (der `parent_id`-Walk), durchgereicht als `location.political` (routing.js:80).
  Über alle Siedlungen geerntet ergibt das jedes Gebiet mit ≥1 Siedlung.

### 3.4 Wiederverwendbare Maschinerie (nichts davon wird neu gebaut)

| Baustein | Ort | Rolle |
|---|---|---|
| `normalizeWikiDeeplinkKey` | wiki-deeplink.js:79 | Vergleichs-Normalizer (beide Seiten) |
| `wikiUrlToDeeplinkKey` | wiki-deeplink.js:103 | `/wiki/<Page>` → Key |
| `focusWholeWikiDeeplinkPath` | wiki-deeplink.js:187 | **ist** `?strasse=` |
| `avesmapsFocusPoliticalTerritory` | wiki-deeplink.js:304 | Name → Gebiet fliegen+öffnen |
| `.location-popup__political-link` + Handler | popups.js:668 / routing.js:710 | fertiger Gold-Link |
| `selectSpotlightSearchEntry` | spotlight-search-focus.js | fliegt + öffnet Panel |
| `.location-popup__action-button--accent` | location-popups-markers.css:547 | gefüllte Hauptaktion |
| Kachel-Grid `flex: 1 1 90px` | location-popups-markers.css:293 | 3. Kachel ohne neues CSS |

## 4. Entwurf

### 4.1 Auflösung (zwei Kanäle, gleicher Normalizer auf beiden Seiten)

Pro Token, in dieser Reihenfolge:

1. **wiki_url** — `normalizeWikiDeeplinkKey(token)` gegen
   `wikiUrlToDeeplinkKey(ort.wikiUrl)`. Präziser Kanal: die `wiki_url` ist die
   Identität (Invariante aus `wiki-deeplink-by-pagename`).
2. **Name** — derselbe Normalizer auf den Anzeigenamen.

Kanal 2 ist nicht bloß Kosmetik: **er rettet den Lyngwyn-Fall.** Über die
`wiki_url` (`/wiki/Lyngwyn_(Honingen)` → `lyngwynhoningen`) trifft „Lyngwyn"
(→ `lyngwyn`) nie; über den Anzeigenamen unserer Siedlung sehr wohl.

**Treffer → goldener Link. Kein Treffer → normaler Text.** (Owner-Entscheidung:
„nur verlinken was da ist" — keine toten Links.)

### 4.2 Zwei getrennte Indizes

Nötig, weil derselbe Name zwei Objekte sein kann: „Perricum" steht in *Lage* als
Territorium **und** in *Verlauf* als Stadt. Die Lage-Zeile muss zum Gebiet
führen, die Verlauf-Station zur Stadt.

- **Ortsindex:** aus den Spotlight-Einträgen `kind === "location"` (Kreuzungen
  sind dort bereits gefiltert). Liefert direkt den Eintrag, den
  `selectSpotlightSearchEntry` frisst — **der Klick braucht keinen Request**.
- **Territorienindex:** aus `locationData[].political.hierarchy[]` →
  `{name, territory_public_id}`.

Beide memoisiert, Signatur analog `getSpotlightSearchEntryCacheSignature`.

### 4.3 Splitting

- `verlauf`: an ` → ` (das vom Parser erzeugte, stabile Trennzeichen —
  `avesmapsWikiPathVerlaufStations` splittet serverseitig identisch).
- `lage`: an `,`. Freitext, also eine Heuristik — bei Fehlschlag entsteht ein
  Token, das nichts trifft und damit Text bleibt. Unter „nur verlinken was da
  ist" ist das folgenlos.

### 4.4 Klick

- **Lage-Token** tragen die bestehende Klasse `.location-popup__political-link`
  und fallen in den **existierenden** Handler (routing.js:710) →
  `avesmapsFocusPoliticalTerritory(name, publicId)`. **Kein neuer Klick-Code.**
- **Verlauf-Stationen** brauchen einen eigenen Handler, weil der politische auf
  Gebiete zielt. Er löst über denselben Index neu auf (stateless, das
  data-Attribut trägt nur den Namen) und gibt den Eintrag an
  `selectSpotlightSearchEntry`. Optisch identisch: dieselbe CSS-Regel, zweite
  Hook-Klasse.

### 4.5 „Anzeigen"-Button

- Erste Kachel im Band, vor „Link teilen".
- `--accent` (gefüllt) — Owner-Entscheidung: die einzige Aktion, die etwas auf
  der **Karte** tut; die anderen zwei öffnen Dialoge.
- Icon `img/menu/markierung.webp` (bislang unbenutzt; der Owner nennt das
  Feature selbst „die Markierung").
- Klick → `focusWholeWikiDeeplinkPath(wikiUrlToDeeplinkKey(wiki.wiki_url))`.
- Gate wie „Link teilen": nur bei verlinktem Wiki-Artikel.

## 5. Bewusste Grenzen

- **Siedlungslose Gebiete** fehlen im Territorienindex — ein solches Gebiet in
  „Lage" bliebe Text, obwohl wir es hätten. Preis dafür, dass kein neuer Request
  nötig ist. (Owner informiert.)
- **Die Trefferquote ist nicht vorab gemessen** (Owner: „einfach bauen"). Fällt
  sie unangenehm niedrig aus, ist der nächste Hebel der Re-Sync aus §3.2.
- **Meerwege** bleiben reiner Text.
- Der Parser, das `verlauf`-Format und `course_hash` werden **nicht** angefasst.

## 6. Definition of Done

1. Reichsstraße 3: Verlauf-Stationen, die wir führen, sind goldene Links; ein
   Klick fliegt hin und öffnet das Infopanel des Ortes.
2. Lage-Token, die wir als Gebiet führen, sind goldene Links; ein Klick öffnet
   das Gebiet (politische Ebene schaltet sich zu).
3. Nicht auflösbare Tokens sind normaler Text — nirgends ein toter Link.
4. „Anzeigen" steht als erste, gefüllte Kachel und markiert die ganze Straße
   (gelbes Band + Rauszoomen), identisch zu `?strasse=Reichsstraße_3`.
5. Ein Fluss (z. B. „Der Große Fluss") verhält sich gleich; ein Seeweg zeigt
   unverändert reinen Text.
6. Die Adresszeile bleibt unverändert (URL-Policy).
