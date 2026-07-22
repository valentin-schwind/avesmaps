# Kraftlinien: Infobox + Quellenverlinkung (Design)

**Datum:** 2026-07-22 · **Auftraggeber:** Owner · **Maßstab:** AGENTS.md §5
„Sources live in ONE place", §12 Designsprache

## 1. Ausgangslage

Eine Kraftlinie ist heute eine Linie und sonst nichts. Sie liegt als
`map_features`-Zeile mit `feature_type='powerline'` und ganzen fünf
Eigenschaften vor: `name` (automatisch „Nodix A - Nodix B"), `feature_subtype`,
`show_label`, `from_public_id`, `to_public_id`
(`api/_internal/map/features.php:1365`).

Daraus folgt an drei Stellen dasselbe Nichts:

* **Popup:** `createPowerlinePopupMarkup` setzt `showDescription: false` und
  `showWikiLink: false` (`js/map-features/map-features-powerlines.js:163`).
  Sichtbar sind nur der Name, das Typ-Label „Kraftlinie" und — im Editor — die
  Knöpfe Bearbeiten/Löschen.
* **Editor:** der Dialog `#powerline-edit-form` hat zwei Felder, Name und
  „Beschriftung anzeigen" (`index.html:1044`).
* **Quellen:** gar nicht. Der Code sagt es selbst:
  `// junction/powerline have no source surface at all and are skipped.`
  (`api/_internal/app/feature-sources.php:818`).

**Der Unterschied zu Wegen, der die Form bestimmt:** Bei einem Weg kommt *jede*
Zeile der Infobox aus WikiSync — `pathWikiInfoboxMarkup` liest Lage, Länge,
Verlauf und Beschreibung ausschließlich aus `properties.wiki_path`
(`js/map-features/map-features-path-rendering.js:6`). Kraftlinien haben **heute**
keinen Sync. Das Weg-Muster wird deshalb zuerst in der **Form** übernommen, nicht
in der **Herkunft** — siehe §5, das ist eine Reihenfolge, kein Endzustand.

## 2. Der entscheidende Befund

Der Umbau ist klein, weil vier Dinge schon tragen:

**a) Die Payload trägt Quellen bereits typunabhängig.**
`avesmapsLoadFeatureSourceRefs` (`api/app/map-features.php:751`) lädt *alle*
freigegebenen Verknüpfungen ohne `entity_type`-Filter, verschlüsselt als
`"<entity_type>:<public_id>"`. Sobald `feature_sources`-Zeilen für Kraftlinien
existieren, reisen sie ohne eine einzige Änderung an der Payload mit.

**b) Neue Felder erreichen das Frontend von selbst.**
`avesmapsMapFeatureRowToGeoJsonFeature` (`api/app/map-features.php:308`) reicht
`properties_json` ungefiltert durch — es gibt keine Ausgabe-Whitelist.
`description` und `wiki_url` sind damit reine Schreib-Arbeit.

**c) Der Quellen-Editor ist generisch.**
`mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts)`
(`js/review/review-feature-sources.js:205`) ist nicht typgebunden. Hinzufügen,
Entfernen, Autocomplete und Provenienz sind ein Mount-Aufruf, kein Neubau.

**d) Der Wiki-Link-Leser fällt schon richtig durch.**
`avesmapsFeatureSourcesReadWikiUrl` (`api/_internal/app/feature-sources.php:352`)
behandelt nur `territory`, `lore` und `citymap` gesondert; alles andere liest
`map_features.properties.wiki_url`. Für `powerline` ist dort **keine Zeile**
nötig.

**e) Die Schreib-Aktion ist additiv.** `avesmapsUpdatePowerlineFeatureDetails`
(`api/_internal/map/features.php:1422`) dekodiert die vorhandenen `properties`
und überschreibt selektiv. Neue Felder brechen nichts und werden nicht von einer
Whitelist geschluckt.

## 3. Der Entwurf

### 3.1 Die Infobox

Eine neue Funktion `powerlineInfoboxMarkup(powerline)` spiegelt
`pathWikiInfoboxMarkup`: dieselbe `.region-info-box.region-info-box--settlement`-
Hülle, dieselbe `<dl class="region-info-box__data">`-Struktur, derselbe
`row()`-Helfer, der leere Werte wegfallen lässt. Sie wird — wie beim Weg — hinter
das Aktionsband in den `actionsMarkup`-Slot von `locationPopupMarkup` gehängt.

```
┌─────────────────────────────────────┐
│ ▓▓▓▓ Kraftlinien.png (16:9) ▓▓▓▓▓▓▓ │
│ Basiliuslinie                        │
│ Kraftlinie                           │
├─────────────────────────────────────┤
│ [Bearbeiten]        [Löschen]        │  ← nur im Editor
├─────────────────────────────────────┤
│ Verbindet   Ewiges Eis ↔ Südmeer     │  ← Spanne ALLER 14 Segmente
│ Beschreibung  Verläuft entlang …     │
├─────────────────────────────────────┤
│ Quelle: Aventurischer Almanach ↗     │
└─────────────────────────────────────┘
```

**Kopfbild** — `infoHeaderImageMarkup("powerline", name, "Kraftlinie")`, analog
zum Weg-Kopf (`map-features-path-rendering.js:111`). Die Vorlage liegt bereits in
`avesmaps-map-processing/icons/info_header_graphics/Kraftlinien.png`, im selben
Bestand wie die Weg-Kopfbilder unter `strassen/`.

Ziel ist **`icons/header/powerline.webp`** — nicht `img/`, und als WebP: die
Funktion baut `icons/header/<basename>.webp` (`js/ui/popups.js:287`), und die
Zuordnungstabelle schreibt vor „Dateiname = unser Subtyp-Schlüssel"
(`js/ui/popups.js:237`). Unser Schlüssel ist `powerline`. Alle 31 bestehenden
Kopfbilder folgen dieser Regel. Ein Bild für alle Kraftlinien — es gibt keine
Subtypen.

**Zeile „Verbindet"** — die Spanne der **ganzen Linie**, nicht des angeklickten
Segments.

*Warum:* am Live-Payload gemessen (2026-07-22) führt die Karte **162
powerline-Zeilen** mit rund **40 verschiedenen Namen**. Eine Kraftlinie besteht
also aus vielen Segmenten — *Basiliuslinie* aus 14, *Fächer der Macht* aus 11,
*Strick des Schwarzen Mannes* aus 8, *Yaquirlinie* aus 7. Dieselbe
1-zu-N-Form wie bei Straßen. Wer auf die Basiliuslinie klickt, will ihre Spanne
wissen, nicht welchen von vierzehn Hops er getroffen hat.

Der Aufbau: alle Segmente gleichen Namens einsammeln, ihre
`from_public_id`/`to_public_id` zu einer Kette verketten und deren beide äußeren
Enden nehmen. **Reine Kreuzungen werden übersprungen** — es zählt der äußerste
*benannte* Punkt je Richtung, sonst stünde dort „Kreuzung ↔ Kreuzung" (mehrere
Segmente heißen heute genau so). Beide Enden sind echte Orte auf unserer Karte
und werden zu Gold-Fly-to-Links, wie `linkifyPathVerlauf` es beim Weg tut; ein im
Marker-Index fehlender Endpunkt bleibt unverlinkter Text.

Ist eine Linie einsegmentig oder findet die Kette kein benanntes Ende, fällt die
Zeile weg (der `row()`-Helfer kann das schon) — lieber keine Zeile als eine
falsche.

*Das ist die tragende Entscheidung:* diese Zeile braucht kein neues Feld und
keine Editorarbeit — **jede** heute bestehende Kraftlinie hat damit sofort
Inhalt. Beschreibung und Quellen wachsen danach nach.

> **Datenlage, nicht Teil dieser Arbeit:** unter den 40 Namen stecken Dubletten
> durch Tippfehler („Elementare Hexagramm" neben „Elementares Hexagramm",
> „Elemntarlinie", „Thalusische Liniea") und ein Namensfeld, das eine URL
> enthält („Hursachquelle - https://de.wiki-aventurica.de/wiki/…"). Da die
> „Verbindet"-Zeile über den **Namen** gruppiert, zerfällt eine falsch
> geschriebene Linie in zwei Ketten. Das ist eine Editor-Aufgabe (und ein
> Kandidat fürs ⚖️ Konfliktzentrum), kein Grund, die Gruppierung anders zu bauen.

**Zeile „Beschreibung"** — neues `properties.description`, im Editor frei
getippt. Leer → Zeile fällt weg.

**Quellenzeile** — `renderFeatureSourceLine("powerline", getPowerlinePublicId(powerline),
wikiUrl, "location-popup__wiki-link")`
(Signatur: `js/ui/popups.js:124`). `wikiUrl` ist das neue
`properties.wiki_url`. Damit trägt dieselbe Zeile den Wiki-Link *und* die
Katalog-Quellen — genau wie beim Weg, offizielle zuerst.

Beide Oberflächen sind abgedeckt: das Popup baut in klassischer und in
Infopanel-Hülle über denselben `locationPopupMarkup`-Aufruf
(`map-features-powerlines.js:192`), die Box erbt also beide.

### 3.2 Quellen — drei Zeilen, keine neue Tabelle

Nach der 💣-Regel aus AGENTS.md §5 ist das ein weiterer `entity_type`:

| Datei | Zeile | Änderung |
|---|---|---|
| `api/app/feature-sources.php` | 33 | `'powerline'` in `$allowedTypes` |
| `api/edit/map/feature-sources.php` | 49 | `'powerline'` in `$allowedTypes` |
| `api/_internal/app/feature-sources.php` | 342 | `'powerline'` in `avesmapsFeatureSourcesReadRevision` |

Die dritte ist nicht kosmetisch: Kraftlinien **haben** eine
`map_features.revision`, und der Quellen-Editor braucht sie als Token fürs
optimistische Sperren. Ohne sie bekäme er `null`.

**Bewusst NICHT angefasst** — die beiden `other_source`-Stellen
(`api/_internal/app/feature-sources.php:124` und `:265`) und die
`$entityTypeOf`-Abbildung (`:819`). `other_source` ist das alte Einzelquellen-Feld
von settlement/region/path; Kraftlinien haben es nie getragen, genau wie
`citymap` und `lore` dort außen vor blieben.

### 3.3 Editor

`#powerline-edit-form` (`index.html:1044`) bekommt:

* **Beschreibung** — `<textarea>`, in der Formular-Konvention des Dialogs
  (`location-report-form__field` / `location-edit-fieldrow`).
* **Wiki-Link** — `<input type="url">`, **sichtbar**, mit `↗` in der Anzeige (§12).
* **Quellen** — ein Container plus
  `mountFeatureSourceEditor(el, "powerline", () => publicId)`.

**Beide Felder sind neu zu bauen, es gibt kein Vorbild zum Abschreiben.** Der
Weg-Dialog hat weder Beschreibung noch Wiki-Link (beides kommt dort aus
WikiSync, `index.html:989`), und der Siedlungseditor hält genau diese zwei
Felder **versteckt** (`index.html:736-737`) — `location-edit-wiki-url` ist das
Feld aus Discord #38, das den geratenen Anreicherungswert durchs Speichern zu
echten Daten machte.

Für Kraftlinien sind die Felder deshalb **sichtbar**. Was ein Editor nicht sieht,
kann er nicht prüfen; und da §4 den Rateweg für Kraftlinien zudreht, ist das eine
sichtbare Eingabe die einzige Quelle dieses Werts — das soll man dem Formular
ansehen.

`avesmapsUpdatePowerlineFeatureDetails` liest zwei Payload-Felder mehr
(`description`, `wiki_url`) und schreibt sie in `properties`. Validierung wie bei
den Weg-Pendants; der Audit-Log-Eintrag führt sie mit.

## 4. Die Falle, die wir gleich mitschließen

`avesmapsEnrichMapFeatureWikiUrl` (`api/app/map-features.php:888`) **rät** einen
`wiki_url` per Namensabgleich für *jede* `map_features`-Zeile mit leerem
`wiki_url` — Kraftlinien eingeschlossen.

Heute ist das folgenlos: der automatische Name „Nodix A - Nodix B" trifft keinen
Wiki-Schlüssel. Sobald ein Editor eine Kraftlinie aber wie eine Siedlung
benennt, erbt die Linie stillschweigend deren Artikel — dieselbe Klasse Fehler
wie Discord #38, wo ein geratener Link durch Speichern zu echten Daten wurde.

**Deshalb:** Der Kraftlinien-Wiki-Link ist ausdrücklich gesetzt oder gar nicht.
`avesmapsEnrichMapFeatureWikiUrl` bekommt einen frühen Ausstieg für
`feature_type === 'powerline'`. Ein ausdrücklich gesetzter Link war ohnehin
sicher (die Funktion steigt bei gefülltem `wiki_url` sofort aus, Zeile 889) — der
Riegel schützt die Linien *ohne* Link.

## 5. Der Wiki-Sync: gemessen, und bewusst Schritt 2

Nachgemessen am 2026-07-22 (Owner-Rückfrage „sind Kraftlinien im Dump
enthalten?"). Die Antwort ist **ja**, und deutlicher als angenommen:

* **23 Artikel** binden `{{Infobox Kraftlinie}}` ein (`list=embeddedin` auf
  `Vorlage:Infobox Kraftlinie`, ns 0) — Hexenband, Basiliuslinie, Arteria Magica,
  Yaquirlinie, Madas Kelch, Septima, Sternentreppe, Konzilslinie, Torweg,
  Schimmelader u. a. Alle im Main-Namespace, also **im Dump enthalten**.
  (Die Volltextsuche liefert nur 7 Treffer — die Vorlagen-Einbindung ist die
  belastbare Zahl.)
* Die Infobox trägt **Stärke** (kontinental/regional), **Affinität**, **Länge**
  (Lore-Einheit, z. B. „ca. 3000 Meilen"), **Regionen**, **Verlauf** (verschachtelte
  Nexus-/Nodix-Einträge) und **Bild**.
* Die Artikel haben einen **`==Publikationen==`**-Abschnitt (Ausführliche /
  Ergänzende / Erwähnungen / Inoffizielle) — dieselbe Struktur, die
  `avesmapsWikiParsePublicationsSection` bereits liest.
* Es gibt zusätzlich **`Kraftlinie/Quellenauswertung`** (~55 KB), eine
  Quellen-Auswertung über Kraftlinien und Nodices.

**Warum wir sie heute trotzdem nicht sehen:**
`avesmapsWikiDumpClassifyEntityKind` (`api/_internal/wiki/dump-entity-scan.php:172`)
prüft auf fluss/strasse, staat/herrschaftsgebiet/reich, bauwerk/festung/burg,
siedlung/stadt/ort, region/landschaft. „kraftlinie" trifft keinen Zweig und fällt
auf `''` — die Seite gilt als Nicht-Entität und wird verworfen. Das ist dieselbe
Falle, die schon ~430 Abenteuer verschluckt hat: **sie greift beim Dump, lautlos.**

**Trotzdem ist der Sync Schritt 2, nicht Teil dieser Spec.** Gründe:

1. Diese Spec ist seine **Voraussetzung**. Ohne `powerline` als `entity_type`
   hat der Publikations-Reconciler keinen Ort, an den er die Quellen schreiben
   könnte.
2. Der Sync fasst den Dump-Treiber, neue Staging-Tabellen und eine
   owner-getriggerte Reconcile-Aktion an — eigener Umfang, eigene Sitzung.
3. Die Zuordnung ist inzwischen **gemessen** und sieht gut aus, aber sie gehört
   sauber gebaut. Die Karte führt 162 powerline-Zeilen mit rund 40 Namen —
   1-Artikel-zu-N-Segmenten, wie bei Straßen. Und die Namen sind **nicht**
   automatisch, sondern echte Lore-Namen, von denen viele die Wiki-Titel direkt
   treffen: Hexenband, Basiliuslinie, Yaquirlinie, Konzilslinie, Madas Kelch,
   Septima, Wandelband, Wasserscheide, Torweg, Bann-Linie, Fächer der Macht,
   Kette der Zyklopen, Weg des Diskus, Arteria Magica, Strick des Schwarzen
   Mannes, Elementares Hexagramm. Ein **Namensabgleich** ist damit der Weg, und
   das kanonische Verfahren dafür steht schon: das Straßen-Bulk-Hopping.
   Zwei Dinge sind dabei zu erwarten und kein Gegenargument: unsere ~40 Namen
   übersteigen die 23 Artikel (Linien wie Maraskanstachel oder Drachenblick
   stehen vermutlich nur in `Kraftlinie/Quellenauswertung`), und einige Namen
   weichen leicht ab („Brücke nach Akrabaal" vs. „Brücke von Akrabaal",
   „Szepter der Macht" vs. „Szepter der Macht (Kraftlinie)").
   Das Feld gehört als `wiki_powerline`-Objekt modelliert, analog
   `properties.wiki_path`, nicht als flacher Link.

**Konsequenzen für diese Spec, damit Schritt 2 nichts zurückbauen muss:**

* Der `row()`-Aufbau der Box (§3.1) ist bewusst derselbe wie beim Weg. Stärke,
  Affinität, Länge und Regionen sind später **zusätzliche Zeilen**, kein Umbau.
* **„Länge" bleibt hier weg** — nicht aus Prinzip, sondern weil die brauchbare
  Angabe die Lore-Angabe des Wikis ist („ca. 3000 Meilen"). Eine aus der
  Geometrie gerechnete Zahl stünde in Karteneinheiten und sagte niemandem etwas.
  Die Zeile kommt mit Schritt 2, aus dem Wiki.
* Das handgesetzte `wiki_url` aus §3.3 muss ein späterer Sync **überleben**. Es
  gilt die Hausregel: ein Reconciler schreibt und löscht ausschließlich, was
  `origin='wiki'` ist; Handgesetztes bleibt unangetastet.

## 6. Was bewusst nicht gebaut wird

* **Kein `other_source` für Kraftlinien** (siehe §3.2).
* **Kein Wiki-Picker** für den Link, sondern ein sichtbares Feld (siehe §3.3).

## 7. Umfang

Neu: `icons/header/powerline.webp` (konvertiert aus
`avesmaps-map-processing/icons/info_header_graphics/Kraftlinien.png`, wie die
Weg-Kopfbilder) und `js/map-features/__tests__/powerline-span.test.js`.

Berührt: `js/map-features/map-features-powerlines.js`, `index.html`,
`api/_internal/map/features.php`, `api/app/feature-sources.php`,
`api/edit/map/feature-sources.php`, `api/_internal/app/feature-sources.php`,
`api/app/map-features.php`.

**Kein `ASSET_VERSION`-Bump.** Der gilt nur für die dynamisch geladenen Assets
des Territorien-Editors (AGENTS.md §7). Dialog und Skript hier hängen an
`index.html` und werden vom Deploy automatisch gestempelt.

**Handbuch:** editor-sichtbare Änderung → der passende Abschnitt in
`html/editor-handbuch.html` und das `Stand:`-Datum gehören in denselben Commit
(AGENTS.md §9).

## 8. Abnahme

1. Klick auf eine beliebige bestehende Kraftlinie öffnet das Infopanel mit
   Kopfbild, Namen und — im Editor — „Bearbeiten" und „Löschen".
2. Die Zeile „Verbindet" zeigt die Spanne der **ganzen** Linie: ein Klick auf ein
   beliebiges der 14 Basiliuslinien-Segmente nennt dieselben zwei Enden, und
   beide sind benannte Orte (keine „Kreuzung"). Ein Klick darauf fliegt hin.
3. Eine im Editor gespeicherte Beschreibung erscheint als eigene Zeile.
4. Eine im Editor hinzugefügte Quelle erscheint in der Quellenzeile, offizielle
   zuerst; ein gesetzter Wiki-Link erscheint mit `↗`.
5. Eine Kraftlinie ohne jede Eingabe zeigt trotzdem „Verbindet" — und **keinen**
   geratenen Wiki-Link, auch wenn ihr Name einer Siedlung gleicht.
6. Wege, Siedlungen, Regionen und Gebiete zeigen unverändert dieselben Quellen
   wie zuvor (der Whitelist-Zusatz darf nichts Bestehendes verschieben).
