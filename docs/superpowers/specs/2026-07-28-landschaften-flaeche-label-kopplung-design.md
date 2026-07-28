# Landschaften — Fläche und Label als ein Ding

**Stand:** 2026-07-28. Gemessen gegen `master` = `0a76ddbd`.
Zweig: `claude/sad-haslett-f28d54` (Worktree `priceless-roentgen-4014eb`).
Vorgänger: `docs/superpowers/specs/2026-07-26-landschaften-v4-messung.md`,
Plan `docs/superpowers/plans/2026-07-24-landschaften.md`.

> **Wozu dieses Dokument.** Eine Landschaftsfläche und ihre Beschriftung(en) sind zwei
> Zeilen in zwei Tabellen, die dasselbe Ding meinen. Heute wissen sie nur halb voneinander:
> Änderungen wandern in eine Richtung, Löschungen in gar keine, und der Lesemodus kennt die
> Beziehung überhaupt nicht. Dieses Dokument legt fest, wie aus den beiden **ein** Ding wird.
>
> **Die Quellen-Vereinheitlichung (§6) hängt daran** und ist deshalb Phase 2, nicht Phase 1:
> sie braucht genau die Zugehörigkeit, die §2 herstellt.

---

## 1. Der Auftrag

Owner, 2026-07-28, wörtlich:

1. **Bidirektionale Eigenschaften.** Fläche umbenannt → das zugehörige Label wird umbenannt.
   Label umbenannt → die zugehörige Fläche wird umbenannt. Dasselbe für **Art** und **Wiki-Eintrag**.
2. **Label-Dialogtitel** je Ebene: „Vegetations-Label bearbeiten", „Derographie-Label bearbeiten",
   „Topographie-Label bearbeiten".
3. **Flächen-Dialogtitel** je Ebene: „Vegetations-Fläche bearbeiten", „Derographie-Fläche bearbeiten",
   „Topographie-Fläche bearbeiten".
4. **Tooltip:** die Art nicht kleinschreiben; zusätzlich „Flächen (N) und Labels (M)" anzeigen.
5. **Letztes Label gelöscht → die Fläche geht mit.**
6. **Letzte Fläche gelöscht → alle verbliebenen Labels gehen mit.**
7. **Kein Ausblenden von Flächen-Labels wegen Kollision** (anders als Siedlungen und gewöhnliche Labels).
8. **Boolesche Operationen:** verschwindet eine Fläche durch die Operation, verschwindet ihr Label mit.
9. **Überlappungen der derographischen Ebene** lösen. → Entscheidung in §5.

Zusätzlich, aus der ersten Sitzungshälfte (Quellen), wörtlich:
„an beiden, ändere/adde/lösche ich bei einem eine quelle, änderts/added's/löscht's bei dem andern mit,
beide sind immer identisch." → §6, Phase 2.

---

## 2. Befund: was heute wirklich passiert

Nachgelesen, nicht vermutet. Vier der acht Punkte sind keine fehlenden Funktionen, sondern
stille Datenschäden.

### 2.1 Die Rückrichtung fehlt — und verliert

`renameLinkedEcosystemLabel` und `applyRegionToLabels`
(`js/map-features/map-features-ecosystem-properties.js:536,573`) tragen Name, Art, Nodix und
Wiki-Landschaft von der **Fläche an ihre Labels**. Die Gegenrichtung gibt es nicht:
`handleLabelEditFormSubmit` (`js/review/review-editor-submit.js:207`) schreibt ausschließlich die
`map_features`-Zeile.

Folge: wer ein Label umbenennt, hat zwei Namen für dieselbe Landschaft — und der nächste
Speichervorgang im Flächendialog überschreibt den Label-Namen wieder. Die Richtung ist nicht
bloß fehlend, sie **verliert Arbeit**.

### 2.2 Die Löschkaskade fehlt komplett, und der Code behauptet das Gegenteil

`avesmapsDeleteEcosystemRegion` (`api/_internal/app/ecosystem.php:1118`) löscht die Region und
ihre Flächen in **einer** Transaktion — die Labels **nicht**. `avesmapsDeleteEcosystemArea`
(`:1290`) löscht eine Fläche und sonst nichts.

Der Kommentar in `map-features-ecosystem-properties.js:479-483` sagt jedoch:

> „‚Löschen' nimmt das Label genauso mit wie die Flächen."

Das stimmt heute nicht. Die Trägerzeile („Diese Region trägt N Flächen und 1 Label.")
verspricht dem Editor dasselbe. Zurück bleiben Labels ohne Fläche.

Dieselbe Lücke trifft die **booleschen Operationen**: `union` und `difference` fressen ihre
Zielfläche (`ecosystemBooleanConsumesTarget`, `map-features-ecosystem-boolean.js:34`) und rufen
`deleteArea` (`map-features-ecosystem-geometry-ops.js:130`). War das die letzte Fläche ihrer
Region, bleibt deren Label als Geist auf der Karte stehen.

Es gibt serverseitig **kein** `delete_label`; Labels gehen über das generische `delete_feature`
→ `avesmapsDeleteMapFeature` (`api/edit/map/features.php:56`).

### 2.3 Der Tooltip zeigt einen Datenschlüssel

`formatEcosystemAreaTooltip` (`map-features-ecosystem-rendering.js:151`) setzt
`area.region_type` ein — das ist der **type_key** (`wald`), nicht die Bezeichnung („Wald").
Er ist kleingeschrieben, weil er ein Schlüssel ist. Die Bezeichnung steht in
`ecosystem_region_type.label` und reist im öffentlichen Lesepfad heute nicht mit.

### 2.4 Flächen-Labels laufen durch die normale Kollisionsauflösung

`getCollisionEntries` (`map-features-label-collisions.js:234`) nimmt alle Labels auf; wer keinen
freien Platz findet, bekommt `is-colliding` (`:332`) und ist weg. Die Ausnahme „Labels
**derselben** Fläche dürfen einander überlappen" existiert bereits als `group`
(`:243-249`) — gegen **fremde** Labels wird weiterhin ausgeblendet.

### 2.5 Die Zugehörigkeit ist im Lesemodus unsichtbar

Das ist die Wurzel von 2.3, 2.4 und der Zählungen aus Punkt 4.

| Richtung | Wo gespeichert | Bestand (live, 2026-07-28) |
|---|---|---|
| Label → Region | `map_features.properties.ecosystem_region_public_id` | **10** von 590 Labels, auf 9 Regionen |
| Region → Label | `ecosystem_region.label_public_id` | **137** von 139 Regionen |

Beide zusammen decken 137 Regionen ab; 9 davon tragen mehrere Labels. Keine der beiden
Richtungen allein genügt — das ist der Grund, warum `ecosystemRegionOfLabel` beide liest.

`ecosystemRegionOfLabel` (`map-features-ecosystem-region-store.js:155`) liest beide — aber die
Regionsliste kommt aus `list_regions` **hinter der `edit`-Berechtigung**, und
`ecosystem-areas.php` wird nur im Landschaften-Modus geladen (Editor). Im **Lesemodus** ist die
Region eines Labels damit unbekannt. Punkt 7 betrifft aber genau den Lesemodus.

### 2.6 Statische Dialogtitel

`index.html:1435` trägt fest „Region-Label bearbeiten".
`openEcosystemPropertiesDialog` (`…-properties.js:392-396`) baut `${kindLabel} bearbeiten` aus
`ECOSYSTEM_KIND_LABELS` → „Vegetation bearbeiten", „Derographische Region bearbeiten",
„Topographie bearbeiten".

---

## 3. Der tragende Balken: ein serverseitig aufgelöstes Zugehörigkeitsfeld

Fast alles oben scheitert an §2.5. Also löst der **Server** die Beziehung auf und legt sie in
die Nutzlast, statt jeden Client sie aus zwei halben Zeigern zusammenrechnen zu lassen.

### 3.1 `map-features.php` füllt `ecosystem_region_public_id` an jedem Label

Für **jedes** Label, das zu einer Region gehört, aus **beiden** Richtungen ermittelt:

* der am Label gespeicherte Zeiger (10 Labels), **oder**
* `ecosystem_region.label_public_id` (137 Regionen).

Zwei kleine Abfragen (139 Regionen), kein N+1, keine Schreiboperation.

> **Ausgegeben, nicht gespeichert.** Der gespeicherte Zeiger bleibt die dauerhafte Wahrheit;
> das Feld in der Nutzlast ist seine aufgelöste Sicht. Eine Rückschreib-Migration hieße, sich
> für 137 Regionen eine zweite Wahrheit anzulegen, die auseinanderlaufen kann.

Der Client liest das Feld bereits (`map-features-labels.js:23` →
`label.ecosystemRegionPublicId`). Es ist damit sofort in **beiden** Modi verfügbar, und
`ecosystemRegionOfLabel` braucht für die Gruppenfrage keinen Regionen-Zwischenspeicher mehr.

Gewacht: fehlen die Ecosystem-Tabellen (frische Installation), entfällt das Feld und alles
verhält sich wie heute. `AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION` wird erhöht (ETag-Formwächter).

### 3.2 `ecosystem-areas.php` liefert drei Regionsangaben mit

Je Flächenzeile zusätzlich:

| Feld | Herkunft | Wofür |
|---|---|---|
| `region_type_label` | `ecosystem_region_type.label` (Join auf kind+type_key) | Punkt 4, Art nicht kleingeschrieben |
| `region_area_count` | `COUNT` aktiver `ecosystem_area` je Region | Punkt 4, „Flächen (N)" |
| `region_label_count` | Labels mit diesem `ecosystem_region_public_id` ∪ `label_public_id` | Punkt 4, „Labels (M)" |

> 💣 **Die Zahlen kommen vom Server, nicht aus den geladenen Ebenen.** Der Lader ist
> bbox-gefiltert (`map-features-ecosystem-loader.js:193`) — geladene Layer zu zählen ergäbe
> „Flächen im Bild", und der Tooltip änderte seine Aussage beim Verschieben der Karte.
> Dieselbe Lehre steht schon an der Trägerzeile (`review-labels.js:56-59`).

`AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION` wird erhöht.

---

## 4. Die Regeln im Einzelnen

### 4.1 Punkt 1 — Label → Region schreibt zurück

Nach erfolgreichem `update_label` ruft der Label-Dialog `update_region` für Name, Art und
Wiki-Zuweisung, danach die vorhandene `applyRegionToLabels` für die **Geschwister**. Damit
erreicht ein Umbenennen an Label A in einem Zug die Fläche **und** Label B.

Es gelten dieselben Wächter wie in der Gegenrichtung:

* **Nur bei echter Änderung.** Unverändert → kein Aufruf (Vorbild `renameLinkedEcosystemLabel:637`).
* **Wiki wandert nur, wenn gesetzt.** Ein leeres Wiki am Label löscht die Zuweisung der Region
  **nicht** — spiegelbildlich zur bestehenden Abwärtsregel (`…-properties.js:630-634`), die
  genau deshalb dort steht.
* **Die Art ist der Art-Schlüssel.** Der Subtyp des Labels **ist** der `type_key` der Region;
  der V5-Import hat die beiden Vokabulare gleichgesetzt (`review-labels.js:102`). Keine
  Übersetzungstabelle — die wäre die zweite Wahrheit.
* **Darstellung reist nie mit.** Größe, Drehung, Zoom-Band, Priorität gehören dem einzelnen
  Label; ein zweites Label existiert gerade deshalb, weil es anders stehen soll.
* **Scheitern ist eine Meldung, kein Rücklauf.** Das Label *ist* gespeichert; ein
  zurückgerollter Name wäre die schlechtere Antwort (Haltung wie `…-properties.js:466-469`).
* Gilt nur für Labels **mit** Region. Kontinente, Meere und freie Kartentitel sind unberührt.

### 4.2 Punkte 2 und 3 — Dialogtitel

Eine Tabelle, die genau die Wörter des Owners trägt:

```
ECOSYSTEM_KIND_PREFIX = {
  derographisch: "Derographie",
  vegetation:    "Vegetations",
  topographie:   "Topographie",
}
```

→ `${prefix}-Label bearbeiten` bzw. `${prefix}-Fläche bearbeiten`, beides über `tr()` mit
deutschem Rückfall (AGENTS §8 — der Landschaften-Editor hängt seit `2951ffc2` an der
`?lang=en`-Auflage).

Label **ohne** Region behält „Label bearbeiten". Der Titel wird zweistufig gesetzt: erst
neutral beim Öffnen, dann verfeinert, sobald die Region bekannt ist — `renderLabelCarrierNote`
ist asynchron, und ein flackernder Titel wäre schlimmer als ein später richtiger. Dasselbe
Muster nutzt das Art-Vokabular schon (`review-labels.js:110`).

### 4.3 Punkt 4 — Tooltip

```
Mein Wald 1 (Wald, Vegetation) · Flächen (3) und Labels (2)
```

Art aus `region_type_label`, mit Rückfall auf den Schlüssel, wenn er fehlt. Zahlen aus §3.2.

### 4.4 Punkte 5, 6 und 8 — die Kaskade

**Eine Regel, serverseitig, drei Aufrufpunkte.** Neue Funktion in der Ecosystem-Bibliothek:

> Entfernt ein Löschvorgang die **letzte** Fläche einer Region oder ihr **letztes** Label, so
> verschwindet die ganze Region: ihre restlichen Flächen, ihre restlichen Labels und die
> Regionszeile — in **einer** Transaktion.

Gerufen von `avesmapsDeleteEcosystemArea`, `avesmapsDeleteEcosystemRegion` (Label-Hälfte) und
`avesmapsDeleteMapFeature`, dort gefiltert auf `feature_type = 'label'` mit Region.

> 💣 **Die Regel gilt für den ÜBERGANG, nicht für den Zustand.** Sie feuert nur, wenn dieser
> Löschvorgang die letzte gelöscht hat — nicht, wenn schon vorher keine da war. Ohne diese
> Unterscheidung würden die **2 Regionen ohne jedes Label** beim nächsten Anfassen
> mitgerissen. Das ist der Unterschied zwischen der Regel und einem Datenverlust.
>
> Gezählt am Live-Bestand (2026-07-28, beide Zeigerrichtungen geprüft): 137 der 139 Regionen
> haben mindestens ein Label, **9** haben mehrere. Ohne Label sind genau zwei: `Wald-001` und
> `Wald-002`, beide Vegetation, je eine Fläche.

> ⚠️ **Wie groß der Sprengsatz heute ist.** Am Live-Bestand hat **jede** der 139 Regionen
> genau **eine** Fläche. „Die letzte Fläche" ist damit derzeit *jede* Fläche: eine Fläche zu
> löschen löscht ihre Region und deren Labels — immer. Das ist genau, was Punkt 6 verlangt,
> aber es heißt, dass die Rückfrage nicht kosmetisch ist, sondern die einzige Bremse. Sie muss
> die Zahlen nennen und darf nicht die harmlose Fassung „Fläche löschen?" bleiben.

Weitere Festlegungen:

* **Weich gelöscht** (`is_active = 0`) wie überall im Haus, mit Audit-Zeile für jede Fläche
  und jedes Label — nach dem Vorbild in `avesmapsDeleteEcosystemRegion:1128-1145`.
* **Beide Zähler steigen:** `ecosystem_revision` **und** `map_revision`. Labels reisen in der
  ETag-gecachten Kartennutzlast; ohne den zweiten Sprung behielten warme Clients ein gelöschtes
  Label über ein 304.
* **Die Rückfrage nennt die Folge**, bevor sie eintritt: „… mit 3 Flächen und 2 Labels
  löschen?" — dasselbe Muster wie `formatRegionDeleteConfirmation` (`…-properties.js:752`),
  das genau dafür gebaut wurde. Betrifft `formatEcosystemAreaDeleteConfirmation` und die
  Label-Rückfrage in `deleteLabelEntry` (`map-features-labels.js:715`).
* **Punkt 8 ist damit erledigt, ohne eigenen Code.** Die booleschen Operationen rufen
  `delete_area` und erben die Regel. Nachzuziehen ist nur der Client: `refreshAfterWrite`
  (`…-geometry-ops.js:140`) lädt heute nur Flächen nach — die Labels müssen mit.

### 4.5 Punkt 7 — Flächen-Labels verschwinden nicht mehr

Ein Label mit `ecosystem_region_public_id` wird **festgesetzt**: es bekommt nie `is-colliding`.
Es weicht weiterhin aus, wenn ein freier Platz da ist, und blockiert weiterhin fremde Labels —
es wird nur nicht mehr ausgeblendet. Findet es keinen freien Platz, nimmt es seinen
Grundversatz und überlappt.

Umsetzung: `getCollisionEntries` liefert `pinned` (= hat eine Region), `resolveLabelCollisions`
schreibt für solche Einträge nie die Klasse. Die Gruppenzugehörigkeit kommt jetzt direkt aus
`label.ecosystemRegionPublicId` (§3.1) und funktioniert damit auch im Lesemodus.

---

## 5. Punkt 9 — Überlappungen der derographischen Ebene

**Befund.** Der Kern ist **Verschachtelung**, nicht Teilüberlappung: Kontinent ⊃ Insel ⊃
Provinz. Alle Flächen einer Ebene liegen in **einer** SVG-Gruppe in Ladereihenfolge — wer
zuletzt kam, liegt oben und nimmt den Klick. Dass die kleine Fläche unter der großen
verschwindet, ist Zufall der Ladereihenfolge, kein Entwurf.

**Entscheidung des Owners, 2026-07-28 — zwei Maßnahmen, die zusammen wirken:**

### 5.1 Größensortierung (das Fundament)

Nach jedem Laden werden die Flächen je Ebene nach Flächeninhalt **absteigend** gestapelt: groß
unten, klein oben. `ecosystemGeometryArea` gibt es bereits (die booleschen Operationen rechnen
damit); die Reihenfolge stellt `bringToFront()` her. Damit liegt eine enthaltene Region
**immer** auf ihrem Behälter und ist immer anklickbar. Kosten: eine Sortierung je Ladevorgang,
keine Schemaänderung, keine neue Bedienregel.

### 5.2 Das Label als garantierter Anfasser

Ein Klick auf das Label wählt seine Fläche aus — auch eine vollständig verdeckte.
`selectEcosystemAreaOfLabel` (`map-features-labels.js:749`) tut das im Ansatz schon und wechselt
dabei die Arbeitsebene mit. **Verlässlich** wird es erst durch Punkt 7: seit ein Flächen-Label
nicht mehr wegkollidieren kann, hat jede Fläche garantiert einen sichtbaren Griff.

### 5.3 Verworfen

* **Klick blättert durch den Stapel** (kleinste zuerst, zweiter Klick eine Ebene nach außen) —
  löst auch echte Teilüberlappungen, kostet aber eine Bedienregel, die man kennen muss.
* **Derographisch nur als Umriss** (keine Füllung, auch als aktive Ebene) — ändert das Aussehen
  der Ebene spürbar.

Beide bleiben offen, falls die Sortierung in der Praxis nicht reicht.

---

## 6. Phase 2 — die Quellen (entworfen, noch nicht freigegeben)

Aus der ersten Sitzungshälfte, hier festgehalten, damit sie nicht verlorengeht. **Nicht Teil
von Phase 1.**

**Auftrag (Owner, wörtlich):** „an beiden, ändere/adde/lösche ich bei einem eine quelle,
änderts/added's/löschts bei dem andern mit, beide sind immer identisch."

**Entwurf: eine Liste, zwei Türen.** Ein Spiegel aus zwei Beständen wäre bei einer Fläche mit
mehreren Labels N+1 Kopien, die jeder Schreibvorgang alle treffen muss; ein einziger
fehlgeschlagener Nachzug ließe sie dauerhaft verschieden stehen. Bearbeiten dagegen beide
Dialoge **dieselbe** Liste, ist „identisch" der Normalzustand statt eines Versprechens.

* `ecosystem_region` wird ein `entity_type` im geteilten Quellensystem — die Zwei-Zeilen-Änderung
  aus AGENTS §5 (`api/edit/map/feature-sources.php:49`, `api/app/feature-sources.php:33`).
  Keine neue Tabelle. 💣 Kein zweites Quellensystem, siehe die Lore-Lehre in AGENTS §5.
* Der vorhandene `mountFeatureSourceEditor` kommt in **beide** Dialoge, beide adressieren
  `ecosystem_region:<region_public_id>`. Das Label löst seine Region über §3.1 auf.
* `map-features.php` faltet die Quellen der Fläche auf **jedes** ihrer Labels; die Popups
  bleiben unverändert.
* Labels **ohne** Fläche (580 von 590) bleiben unangetastet: eigene Liste unter
  `region:<label>`, „Andere Quelle" wie heute. Das am 2026-07-28 wiederhergestellte Feld wird
  nicht angefasst.
* **Migration: null.** Gemessen an der Live-Nutzlast tragen 260 Elemente noch ein nicht
  übernommenes `properties.other_source` — 225 Siedlungen, 30 Wege und **5 Labels** (Mittener
  See, Waldsee, Mironsee, Einhornwälder, Ebersbusch), davon **kein einziges Landschafts-Label**.
* **Meldeweg:** „Änderungen vorschlagen" bleibt am **Label** — das ist, was ein Leser anklickt
  (Owner, 2026-07-28). Die Meldung nennt weiter `region` + Label-ID; die Auflösung zur Fläche
  passiert erst in der Freigabe. Dabei ist der Nebenbefund zu erledigen: eine
  Label-Änderungsmeldung landet heute im **Anlege**-Dialog (`js/routing/routing.js:641`) und
  erzeugte ein zweites Label — nur Siedlungen haben den Änderungszweig.

---

## 7. Was nicht gebaut wird

* Kein `parent_region_id` / keine explizite Verschachtelungshierarchie.
* Kein Klick-Durchblättern, keine reine Umrissdarstellung (§5.3).
* Keine Rückschreib-Migration des Zugehörigkeitsfelds (§3.1).
* Kein zweites Quellensystem (§6).
* Die Handbuch-Pflege bleibt der Nachtroutine (AGENTS §9). Verpflichtung hier: **jede
  editor-sichtbare Änderung steht in der Commit-Betreffzeile.**

---

## 8. Abnahme

| | Wie |
|---|---|
| Dialogtitel (2, 3) | lokal, `?edit=1` |
| Tooltip-Format (4) | Einheitentest der reinen Formatfunktion + live |
| Kaskaden-Entscheidung (5, 6, 8) | Einheitentest der reinen Übergangsregel (letzte gelöscht ja/nein) |
| Stapelreihenfolge (9.1) | Einheitentest der Sortierung |
| Kollisions-Festsetzung (7) | Einheitentest + live im **Lesemodus** |
| Rückrichtung (1), Kaskade live, Zählungen | **erst live nach dem Deploy** — es gibt hier keine Datenbank |

Einheitentests laufen mit `zend.assertions=1` bzw. `node --test` (siehe Memory
`php-js-test-commands`).

---

## 9. Risiken

1. **Die Kaskade ist zerstörerisch.** Ein Label zu löschen kann eine Region mit vielen Flächen
   mitnehmen. Gegenmittel: weiches Löschen, Audit-Zeile je Objekt, und eine Rückfrage, die die
   Zahlen nennt, **bevor** gelöscht wird.
2. **Die 2 Regionen ohne Label** dürfen nicht mitgerissen werden → Übergangsregel (§4.4).
3. **`map_revision` muss bei serverseitig gelöschten Labels steigen**, sonst behalten warme
   Caches sie über ein 304.
4. **Der heiße Kartenpfad bekommt zwei Abfragen dazu** (AGENTS §10 führt genau diesen Pfad als
   Hotspot). Beide sind indiziert und über 139 Regionen; kein N+1.
5. **Zwei Nutzlast-Versionen** müssen steigen (`AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION`,
   `AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION`), sonst hält ein ETag-Cache die alte Form fest.
6. `ASSET_VERSION` ist **nicht** betroffen — es sind keine dynamisch geladenen Editor-Assets im
   Spiel (AGENTS §7).
