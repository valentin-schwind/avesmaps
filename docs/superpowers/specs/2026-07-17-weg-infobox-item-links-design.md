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

- **Item-Index** (`items`): alles, was eine Verlauf-Station sein kann, als
  `key → {kind, ref}`. Aus `locationMarkers` (Orte, Kreuzungen raus), `pathData`
  (nur **wiki-verlinkte** Wege) und `labelMarkers` (Landschaften).
  Vorrang: **Ort > Weg > Label** — eine Station ist primär ein Ort, den man passiert.
- **Territorienindex:** aus `locationData[].political.hierarchy[]` →
  `{name, territory_public_id}`.

Beide memoisiert; die Signatur zählt **alle vier** Quell-Arrays (analog
`getSpotlightSearchEntryCacheSignature`) — fehlt eine, bemerkt der Index ihr
Eintreffen nie.

**Warum Wege + Labels dazugehören (live gemessen 2026-07-17, 2.946 Stationen über
320 Wege):** Orte allein lösen nur **57 %** auf. Ein Weg nennt in seinem Verlauf
legitim **andere Wege** (Abzweigungen: „Reichsstraße 1", „Fürstenstraße"; Flüsse
nennen Flüsse) und **Landschaften** („Trollzacken", „Goldene Bucht"). Von den
1.277 Nicht-Treffern sind 664 wiki-verlinkte Wege und 265 Labels — beides haben
wir. Mit ihnen: **88 %**; die restlichen ~11 % führen wir wirklich nicht.
Reichsstraße 3 lag schon mit Orten allein bei 34/37.

Wege **ohne** wiki_path bleiben außen vor (Spotlight-Policy, Owner 2026-07-05:
ein Weg ohne Wiki-Artikel ist kein suchbares Objekt, sein generischer Name
`Reichsstrasse-4903` keine Identität). Kostet nur 15 von 2.946 Stationen.

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
  Gebiete zielt. Das Markup trägt `kind` + `ref` (beim Rendern aufgelöst), der
  Handler routet nur noch — keine Namensauflösung im Klick, kein Request.
  Optisch identisch: dieselbe CSS-Regel, zweite Hook-Klasse.
  - `location` / `label` → `getSpotlightSearchLookup().byPublicId` →
    `selectSpotlightSearchEntry` (fliegt + öffnet Panel bzw. zoomt auf die Landschaft).
  - `path` → `focusWholeWikiDeeplinkPath(key)` — markiert den **ganzen** Weg, wie
    „Anzeigen". Eine Abzweigung zur „Reichsstraße 1" meint die Straße, nicht einen
    Punkt darauf. `ref` ist hier **immer der wiki_url-Key**: der Namenskanal von
    `focusWholeWikiDeeplinkPath` vergleicht den ROH-Namen eines Segments, nicht den
    Wiki-Namen — nur die wiki_url ist exakte Weg-Identität (und zahlen-genau:
    „Reichsstraße 1" sammelt nie „Reichsstraße 2" ein).

### 4.5 „Anzeigen"-Button

- Erste Kachel im Band, vor „Link teilen".
- `--accent` (gefüllt) — Owner-Entscheidung: die einzige Aktion, die etwas auf
  der **Karte** tut; die anderen zwei öffnen Dialoge.
- Icon `img/menu/markierung.webp` (bislang unbenutzt; der Owner nennt das
  Feature selbst „die Markierung").
- Klick → `focusWholeWikiDeeplinkPath(wikiUrlToDeeplinkKey(wiki.wiki_url))`.
- Gate wie „Link teilen": nur bei verlinktem Wiki-Artikel.

## 5. Ladereihenfolge (tragend!)

`prepareLabelData` läuft in `js/routing/routing.js` jetzt **vor**
`preparePathData` (vorher zuletzt). Grund: `preparePathData` baut **jedes**
Weg-Popup vorab (`createPathLayer` → `refreshPathLayerPopup`), und der Item-Index
entsteht in diesem Moment. Wären die Labels noch nicht hydratisiert, bliebe jede
Landschaft in bereits gecachtem Markup unverlinkt. `prepareLabelData` liest nur
`data.features` + `map` (und `syncLabelVisibility` fasst weder `pathData` noch
`regionPolygons` an) — es hat keine eigene Weg-Abhängigkeit. **Wer diese
Reihenfolge ändert, bricht die Landschafts-Links lautlos.**

## 6. Bewusste Grenzen

- **Siedlungslose Gebiete** fehlen im Territorienindex — ein solches Gebiet in
  „Lage" bliebe Text, obwohl wir es hätten. Preis dafür, dass kein neuer Request
  nötig ist. Live-Beispiel: „Nordmarken" (wir führen „**Herzogtum** Nordmarken";
  `short_name` ist bei **0** Territorien gesetzt, taugt also nicht als Brücke).
- **Namensvarianten sind nicht mechanisch heilbar.** Gemessen: einen trailing
  `(…)`-Zusatz zu strippen rettet **5 von 2.946** Stationen — nicht gebaut.
  „Lyngwyn" bleibt bewusst Text: wir führen „Lyngwyn (Honingen)" **und**
  „Lyngwyn (Havena)" → mehrdeutig, und ein Link auf das falsche Dorf wäre
  schlechter als keiner. (Nebenbefund: die Honinger Siedlung trägt fälschlich die
  Havena-`wiki_url` — eigener Fix.)
- **~11 % der Stationen führen wir wirklich nicht** (333 von 2.946). Der einzige
  verbleibende Hebel wäre §3.2 (additives Feld + Re-Sync).
- **Meerwege** bleiben reiner Text.
- Der Parser, das `verlauf`-Format und `course_hash` werden **nicht** angefasst.

## 7. Perf

Aufschlag bei der Hydratation, auf Produktionsmaß gemessen: **~45 ms**
(~25 ms einmaliger Index über 2.558 Orte + 5.275 Wege + ~900 Labels, ~20 ms für
1.660 Wiki-Segmente). Das Markup wird pro `(feld, wert)` memoisiert — alle
Segmente eines Weges teilen dasselbe `wiki_path`-Objekt, ohne den Cache liefe
derselbe Verlauf einmal pro **Segment** statt pro **Weg** (gemessen 190 ms → 6 ms
im ersten Zuschnitt). Der Cache stirbt mit dem Index (er trägt dessen refs).

## 8. Definition of Done

1. Reichsstraße 3: Verlauf-Stationen, die wir führen, sind goldene Links; ein
   Klick fliegt hin und öffnet das Infopanel des Ortes.
2. Eine Station, die ein **Weg** ist („Reichsstraße 1"), markiert beim Klick den
   ganzen Weg; eine Station, die eine **Landschaft** ist („Trollzacken"), zoomt
   dorthin.
3. Lage-Token, die wir als Gebiet führen, sind goldene Links; ein Klick öffnet
   das Gebiet (politische Ebene schaltet sich zu).
4. Nicht auflösbare Tokens sind normaler Text — nirgends ein toter Link.
5. „Anzeigen" steht als erste, gefüllte Kachel und markiert die ganze Straße
   (gelbes Band + Rauszoomen), identisch zu `?strasse=Reichsstraße_3`.
6. Ein Fluss (z. B. „Der Große Fluss") verhält sich gleich; ein Seeweg zeigt
   unverändert reinen Text.
7. Die Adresszeile bleibt unverändert (URL-Policy).
