# Sync-Übernahme, Sitzung 4 — Herrschaftsgebiete

**Stand:** 2026-08-06 · **Status:** abgestimmt (Owner, 06.08.2026) · **nicht gebaut** ·
**Bauplan:** [`docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-4.md`](../plans/2026-08-06-sync-uebernahme-sitzung-4.md) ·
**Mockup:** [`docs/sync-uebernahme-territorien-mockup.html`](../../sync-uebernahme-territorien-mockup.html) (anklickbar) ·
**Übergeordnet:** [`2026-08-06-sync-uebernahme-design.md`](2026-08-06-sync-uebernahme-design.md) §7, Sitzung 4 ·
**Verwandt:** `docs/territories.md`, `docs/political-territory-global-display-and-derived-boundaries-plan.md`

> §7 des übergeordneten Entwurfs ist für die Territorien nur eine **Zuordnungstabelle** — welcher
> heutige Knopf wird was. Dieses Dokument ist der Entwurf dazu. Es weicht an einer Stelle von der
> Tabelle ab, und zwar begründet: aus einer Vorschau werden **zwei** (§3, §7 Falle b).

---

## 1. Die nachgeprüften Tatsachen

Alles hier steht am 06.08.2026 so im Code, am Quelltext geprüft — nicht am Live-Bestand.

**1.1 Die Oberfläche** ist `html/wiki-sync-monitor.html`: der Dialog „Herrschaftsgebiete", ein iframe in
der Edit-Hülle (`openAvesmapsSyncEditorOverlay`), zusätzlich per `window.open` als eigene Seite
erreichbar. Neun Kacheln, vier davon gehören zu diesem Ablauf.

**1.2 Die Übernahme schreibt in drei Strömen**, alle nach `political_territory`:

| Aktion | schreibt | Auswahl je Zeile |
|---|---|---|
| `apply_parent_cache` | `parent_id`, als **ein** `UPDATE … JOIN` | nur **negativ** (`skip`) |
| `apply_custom_nodes` | legt eigene Knoten (`eigener-knoten:*`) an und hängt sie ein | **keine** |
| `apply_identity` | `name`, `type`, `status`, `valid_from_bf`, `valid_to_bf`, `continent` | `skip` **und** `only` ✅, mit Backup + `revert_identity` |

**1.3 „Modell übernehmen" ruft die Daten-Übernahme bereits mit auf**
(`wiki-sync-monitor.html:1333`). „Daten übernehmen" ist heute schon eine echte Teilmenge — der eine
Knopf entfernt eine **Dopplung**, er verschmilzt keine zwei gleichrangigen Handlungen.

**1.4 Gelöscht wird nie.** Kein `DELETE` gegen `political_territory` im ganzen Abgleich-Pfad.

**1.5 Angelegt wird nur der eigene Knoten.** Ein Wiki-Gebiet bekommt seine
`political_territory`-Zeile ausschließlich von Hand im Politik-Editor
(`avesmapsPoliticalCreateTerritoryFromWiki`, aus den Geometrie-/Schreibpfaden). Der Abgleich hat dafür
keinen Weg. ⇒ Die ehrliche „Neu"-Gruppe der Karte sind die **eigenen Knoten**.

**1.6 💣 Der Wiki-Spiegel hat keinen Schreiber mehr.** `avesmapsWikiSyncMonitorDiff` („Unterschiede")
vergleicht das Staging `political_territory_wiki_test` gegen die Kopie `political_territory_wiki`.
Beide Schreiber der Kopie (`avesmapsWikiSyncSyncTerritoriesFromDomCache`,
`avesmapsWikiSyncSyncTerritories`) hängen an der stillgelegten Aktion `sync_territories` —
`startWikiSyncTerritoryRun` kehrt (`review-wiki-sync.js:3516 ff.`) **vor** der Arbeit um. Weder „Syncen"
noch „Hierarchie" fasst die Kopie an. **Gelesen wird sie live:** Hauptstadt, Oberhaupt, Sprache,
Währung, Handelswaren, Blasonierung und der „Liegt in"-Auflöser
(`territories-read.php`, `territories-layer.php`, `map-features.php:589`, `conflicts/rules.php:143`).
⇒ Die drei Zahlen `neu / verschwunden / geändert` beschreiben eine Lücke, die **kein Knopf schließt**.

**1.7 Staging und Kopie haben dieselben Spalten.** Das Staging wird als
`CREATE TABLE political_territory_wiki_test LIKE political_territory_wiki` angelegt
(`sync-monitor.php:44`), und beide werden aus demselben Normalisierer befüllt
(`avesmapsPoliticalNormalizeWikiRecord`). Nachführen ist ein **Zeilen-Abgleich über den `wiki_key`**,
kein Umbau.

**1.8 Nichts hat die Kopie je von Hand bearbeitet.** Ihr einziger Schreiber war der Crawler
(`avesmapsPoliticalUpsertWikiRecord`). Beim Nachführen ist dort keine Handarbeit in Gefahr.

**1.9 Handarbeit liegt an drei Stellen**, und nur zwei davon sind heute geschützt:

| Handarbeit | wo | geschützt |
|---|---|---|
| Eigener Wert je Feld | `wiki_territory_model.metadata_overrides_json` | **ja** — der Override gewinnt (`sync-monitor-identity.php:677 ff.`) |
| Eltern gesperrt · aussortiert | `parent_locked`, `excluded` | **ja** — `rebuild_model` schreibt gesperrte Eltern nicht um (`parent_wiki_key = IF(parent_locked = 1, …)`), Aussortiertes wird übersprungen |
| Direkt im Politik-Editor geändert | `political_territory` selbst | **nein** — es gibt kein Merkmal, der Abgleich setzt es wortlos zurück |

**1.10 Das Bauteil ist eigenständig.** `js/review/sync-plan-sheet.js` + `css/components/sync-plan-sheet.css`
werden von `html/citymap-editor.html` und `html/adventure-editor.html` als gewöhnliche
`<script src>`/`<link>` geladen, ohne App-Globals und ohne Elternfenster. Die Monitor-Seite lädt heute
schon auf demselben Weg `/js/ui/filter-menu.js` und `/js/ui/dialog-drag.js`. Der iframe trägt
`?v=Date.now()` (`review-wiki-sync.js:3456`), die Seite selbst ist also nie zwischengespeichert; ihre
`<script src>`-Marken stempelt der Deploy (AGENTS.md §7). **Kein `ASSET_VERSION` betroffen** — das
gehört dem eingebetteten Politik-Editor, nicht dieser Seite.

**1.11 Sitzung 3 hat die Naht schon gebaut:** `syncPlanResolvePost` / `openSyncPlanSheet({…, post})`.
Sie wird hier **nicht** gebraucht — die zwei neuen Arten sprechen mit demselben Endpunkt wie alle
anderen. Die Naht bleibt für die Falllisten, wo sie hingehört.

---

## 2. Was entschieden ist (Owner, 06.08.2026)

| | |
|---|---|
| Der Baum-Arbeitsablauf | **bleibt**. „Eltern gesperrt", „aussortiert", die Lücken, das Ziehen: unangetastet |
| „🚨 Syncen" und „2 · Hierarchie rechnen" | **unverändert** in dem, was sie rechnen; der Sync behält Namen und Alarmzeichen wie in den anderen vier Editoren |
| Die alte Wiki-Kopie | wird **nachgeführt** — das ist der fehlende Weg, nicht nur ein Bericht |
| Verschwundene Wiki-Artikel | **Waisen löschbar, benutzte nie.** Hängt ein Kartengebiet an der Kopie, wird sie nicht angeboten |
| Handarbeit auf der Karte | wird **gezeigt**, ist abwählbar, und „Wert festhalten" macht daraus einen eigenen Wert |
| Die zwei Arten von Schreiben | **zwei Vorschauen an zwei Schritten** (§3) |
| Eltern-Umzug und Außengrenzen | **Hinweis in der Zeile, sonst nichts** — keine Neuberechnung |
| „Unterschiede" und „Test" | **fallen weg**; es bleiben drei nummerierte Kacheln — `1 · 🚨 Syncen`, `2 · Hierarchie rechnen`, `3 · Übernehmen` |

---

## 3. Der Ablauf danach

```
1 · 🚨 Syncen    2 · Hierarchie rechnen    3 · Übernehmen   │   Wappen lokalisieren · Wappen: An · 🔗 Links prüfen
```

**1 · 🚨 Syncen** liest wie bisher den Dump ins Staging und rechnet danach den Baum. Neu ist nur: **es
endet in einer Vorschau** — was die Wiki-Kopie bekäme (§4). Wie „Dump holen" seit Sitzung 2.

> ⚠️ **Der Knopf behält Namen und Zeichen** (Owner, 06.08.2026): `🚨 Syncen`, braune Kachel — so heißt
> er in allen fünf Editoren (`wiki-sync-settlement-editor.html`, `landschaften-editor.html`,
> `citymap-editor.html`, `adventure-editor.html`, hier). Ein eigener Name für denselben Vorgang wäre
> genau die Divergenz, die dieses Vorhaben abbaut. Neu ist nur die vorangestellte Nummer.

**2 · Hierarchie rechnen** bleibt Wort für Wort. Es zieht aber eine offene **Karten**-Vorschau zurück
(`state='superseded'`): die Eltern haben sich gerade geändert, ihre Zahlen gelten nicht mehr.

**3 · Übernehmen** ersetzt „Daten übernehmen" **und** „Modell übernehmen" (§1.3) und zeigt die
Karten-Vorschau (§5).

**Eine liegengebliebene Liste geht nicht verloren.** Die Statuszeile unter dem Menüband nennt jede
offene Vorschau mit ihrer Zahl und einem „öffnen"-Link. Ein Druck auf 1 oder 3 **zeigt** eine offene
Liste, statt neu zu rechnen; gerechnet wird nur, wenn keine da ist.

**Warum zwei Vorschauen und nicht eine:** Schritt 1 führt *unsere Ablage der Wiki-Angaben* nach — beim
ersten Lauf über tausend gleichförmige Zeilen. Schritt 3 ändert, *was Besucher auf der Karte sehen* —
wenige Dutzend Zeilen, jede mit Folgen. In einer Liste ständen die folgenreichen zwischen den
harmlosen; genau das soll die Vorschau verhindern.

---

## 4. Die Vorschau an Schritt 1 — die Wiki-Kopie (`kind = 'territory_wiki'`)

Vergleicht Staging gegen Kopie über den `wiki_key`. Betrifft **nur** die Kopie: Geometrie, Hierarchie
und `political_territory` bleiben unberührt. Wirkt sichtbar in der Infobox.

**Neu** — Staging kennt einen Schlüssel, die Kopie nicht. Angehäkelt: Kopie anlegen, danach
`avesmapsWikiSyncRelinkPoliticalTerritoryByWikiKey` (setzt `wiki_id` an einem Kartengebiet mit
demselben Schlüssel). Vorangehäkelt.

**Geändert** — beide da, Felder weichen ab. Die Zeile nennt Feld für Feld alt → neu, höchstens sechs,
dann „+ N weitere Felder". Vorangehäkelt.

> 💣 **Ein leerer frischer Wert ist keine Änderung.** Liefert der Dump zu einem Feld nichts und steht in
> der Kopie ein Wert, bleibt er — und das Feld taucht in der Zeile gar nicht erst auf. Diese Falle ist
> beim Kontinent schon einmal zugeschnappt und wird dort mit `COALESCE` abgefangen
> (`sync-monitor-identity.php:786`); hier gilt sie für **alle** Felder.

**Gelöscht** — Kopien ohne Staging-Schlüssel, **und nur, wenn kein aktives `political_territory` auf
sie zeigt** (`wiki_id` und `wiki_key` beide geprüft). Nicht vorangehäkelt, zweite ausdrückliche
Bestätigung. Der Vorspann der Gruppe nennt die **nicht** angebotenen beim Namen: *„Fünf weitere Kopien
haben ebenfalls keinen Artikel mehr, hängen aber an einem Gebiet auf der Karte (…). Sie bleiben stehen
und werden hier nicht angeboten."* (Gedeckelt auf zehn Namen, dann „und N weitere".)

> ⚠️ Damit fällt das `SET wiki_id = NULL` des alten Pfads (`territories-dom.php:172`) weg: es gibt keine
> Löschung mehr, bei der ein Kartengebiet abgehängt werden müsste. Die Zeile im Ausführ-Teil lautet
> „nur Waisen", nicht „abhängen und löschen".

---

## 5. Die Vorschau an Schritt 3 — die Karte (`kind = 'territory'`)

**Neu** — eigene Knoten aus dem Baum, die es auf der Karte noch nicht gibt (heute
`apply_custom_nodes.to_create`). Die Zeile nennt den künftigen Elternteil und wie viele Kinder im Baum
darauf warten. Vorangehäkelt.

**Geändert** — **eine Zeile je Herrschaftsgebiet**, Schlüssel `wiki_key`. Sie kann zeigen:

- **Datenfelder** aus `avesmapsWikiSyncMonitorApplyIdentityPreview` (Name, Staatsform, Status,
  Gegründet, Aufgelöst, Kontinent), alt → neu.
- **Eltern**, alt → neu, aus dem Vergleich Modell ↔ Live.
- **⚠ den Außengrenzen-Hinweis**, wenn ein Eltern-Umzug die Rolle eines Knotens kippt (§6d).
- **`eigener Wert`**, wenn der neue Wert aus `metadata_overrides_json` stammt und nicht aus dem Wiki.
- **`von Hand geändert`** samt Knopf **„Wert festhalten"**, wenn der Live-Wert weder dem Wiki noch
  einem Override entspricht — jemand hat ihn im Politik-Editor gesetzt. Der Knopf schreibt
  `set_field_override` und beendet die Frage dauerhaft, **ohne** das Gebiet aus der Pflege zu nehmen.
  Häkchen weg heißt weiterhin nur „diesmal nicht".

  > Ein Häkchen je Feld gibt es nicht (übergeordneter Entwurf §9). „Wert festhalten" ist kein zweites
  > Häkchen, sondern der vorhandene Override — dieselbe Mechanik, die der Baum ohnehin trägt.

**Gelöscht** — **0**, und die Gruppe sagt warum: *„Ein Herrschaftsgebiet wird nie gelöscht. Der
Abgleich hat dafür keinen Weg und hatte nie einen — auch dann nicht, wenn sein Wiki-Artikel
verschwindet. Verwaiste Kopien stehen in der Vorschau von Schritt 1."*

**Reihenfolge beim Ausführen** — wie heute, und die Reihenfolge trägt: Eltern (Wiki-Knoten) → eigene
Knoten (anlegen **und** einhängen) → Datenfelder. Das Backup von `apply_identity` und
`revert_identity` bleiben unverändert.

---

## 6. 💣 Die Fallen

**(a) Die Auswahl muss POSITIV sein.** `apply_parent_cache` kennt heute nur `skip` — „alles Divergente
außer diesen". Zwischen Vorschau und Übernahme kann eine **neue** Divergenz entstehen; die stünde in
keiner Skip-Liste und würde **ungesehen geschrieben**. Beide Schreiber bekommen deshalb eine
`only`-Liste (`AND child.wiki_key IN (…)`), wie `apply_identity` sie schon hat. `apply_custom_nodes`
ebenso. Der negative Weg bleibt bestehen, wird aus der Vorschau aber nie benutzt.

**(b) Zwei Arten, zwei Läufe, zwei Häkchenstände.** `sync_plan_run.kind` trägt `'territory_wiki'` bzw.
`'territory'` (14 bzw. 9 Zeichen, `VARCHAR(24)` reicht). Sie superseden einander **nicht**: „Syncen"
zieht nur die Kopie-Vorschau zurück, „Hierarchie rechnen" nur die Karten-Vorschau.

**(c) Leeres Staging heißt nie „alles löschen"** — und auch nie „alles geändert". Ist das Staging leer,
liefert die Rechen-Hälfte **null** Zeilen jeder Kategorie. Derselbe Riegel, den
`avesmapsCitymapRemovableKeys` seit Sitzung 1 trägt.

**(d) Die Außengrenzen bleiben ein HINWEIS.** Die abgeleitete Außengrenze gehört nur einem **reinen
Behälter** (`direct_geometry_count = 0` **und** aggregiert Kinder) oder einer Wurzel — an genau diesem
Prädikat hingen nacheinander vier Fehler, zuletzt einer, der **fail OPEN** war und seit `6e8fcccc` den
ganzen Speichervorgang mitriss, weil die Neuberechnung als Vor-Speichern-Umformung **ohne `try/catch`**
im Speicherpfad hängt (`registerBeforeSaveTransform`, `territory-derived-geometry-save-order.js:76`).

Ein Eltern-Umzug ändert die Rolle von bis zu **drei** Knoten: dem umgezogenen, seinem alten Elternteil
(verliert er sein letztes Kind, ist er kein Behälter mehr) und seinem neuen. Die Vorschau **benennt**
das, mit zwei Sammelabfragen (Geometrien je Gebiet, Kinder je Gebiet — **kein N+1**).

🔴 **Die Übernahme rechnet nichts nach, löscht nichts und ruft nichts aus dem Außengrenzen-System
auf.** Sie bleibt der eine `UPDATE`, der sie heute ist. Die Selbstheilung beim Öffnen eines Gebiets im
Editor bleibt der einzige Weg, auf dem eine überflüssige Grenze verschwindet — unverändert zu heute.

**(e) Eine Übernahme schreibt EINE Protokollzeile je Lauf** (`apply_sync_plan`), nie eine je Eintrag:
`map_audit_log` behält 200 Zeilen, und 1.203 Kopie-Zeilen einzeln zu protokollieren räumte es mit einem
Klick leer.

**(f) Die Liste veraltet.** Beim Übernehmen wird jede angehäkelte Zeile noch einmal gegen den aktuellen
Stand geprüft; was nicht mehr passt, wird `stale`, bleibt stehen und wird hinterher genannt.
`apply_identity` bekommt das geschenkt — es rechnet seine Vorschau intern neu und filtert per `only`;
ein Schlüssel ohne Treffer ist genau der veraltete Fall.

**(g) STRATO: keine Schleife, Schübe wie überall.** Die Rechen-Hälften kommen mit zwei SELECTs plus
einem Vergleich im Speicher aus — ein Schritt, kein Cursor. Die **Ausführ**-Hälften laufen im
gemeinsamen Budget (`AVESMAPS_SYNC_PLAN_APPLY_BUDGET`, 40 Zeilen je Schritt); bei 1.203 Kopie-Zeilen
sind das ~31 Schritte, die der vorhandene Client-Loop schon fährt.

**(h) Die leere Löschgruppe braucht einen eigenen Satz.** `syncPlanGroupMarkup` schreibt für
`SYNC_PLAN_KIND_DELETION[kind] === null` einen **fest verdrahteten** Satz („… steht als Verlust in der
Zeile des Eintrags"). Für die Karte stimmt er nicht — dort steht es in Schritt 1. Der `null`-Zweig
bekommt deshalb einen optionalen Text je Art.

**(i) Der Endpunkt bekommt eine eigene require-Kette.** `api/edit/wiki/sync-plan.php` kennt die
Sync-Monitor-Bibliotheken noch nicht. Am 06.08. fehlte dort schon einmal
`avesmapsWikiSyncNextMapRevision` — hinter einem `function_exists` und damit lautlos.
`__tests__/sync-plan-endpoint-chain-test.php` bewacht genau das und wird erweitert.

---

## 7. Wo es gebaut wird

**Neue Arten:** `AVESMAPS_SYNC_PLAN_KINDS` bekommt `'territory_wiki'` und `'territory'`; das Bauteil
bekommt je einen Eintrag in `SYNC_PLAN_KIND_TITLES`, `…_NOUNS` und `…_DELETION`
(`territory_wiki` = Löschtext für Waisen, `territory` = `null` plus dem Satz aus §6h).

**Rechen-Hälften** (schreiben in **keine** Nutztabelle):

- `api/_internal/wiki/territory-wiki-plan.php` → `avesmapsTerritoryWikiPlanStep`
- `api/_internal/wiki/territory-plan.php` → `avesmapsTerritoryPlanStep`

Beide setzen auf vorhandenen, unveränderten Lesern auf: `avesmapsWikiSyncMonitorApplyIdentityPreview`
(rein), die Zähl- und Beispielabfragen aus `avesmapsWikiSyncMonitorApplyParentCache` (Dry-Run-Zweig)
und `avesmapsWikiSyncMonitorApplyCustomNodes` (Dry-Run-Zweig).

**Ausführ-Hälften** (rufen die **unveränderten** Schreiber, nur mit `only`):

- `api/_internal/wiki/territory-wiki-plan-apply.php` → `avesmapsTerritoryWikiApplyStep`
- `api/_internal/wiki/territory-plan-apply.php` → `avesmapsTerritoryApplyStep`

**Geändert wird an den Schreibern nur eines:** eine `only`-Liste in `avesmapsWikiSyncMonitorApplyParentCache`
und `avesmapsWikiSyncMonitorApplyCustomNodes` (§6a). Kein neuer Schreibpfad für die Karte.

**Neu ist genau ein Schreiber:** die Kopie-Zeile. Er ruft `avesmapsPoliticalUpsertWikiRecord` mit der
Staging-Zeile — dieselbe Funktion, die die Kopie immer gefüllt hat — plus die Leer-Regel aus §4 und das
`DELETE` für Waisen.

**Oberfläche:** `html/wiki-sync-monitor.html` verlinkt `/css/components/sync-plan-sheet.css` und
`/js/review/sync-plan-sheet.js` wie `html/citymap-editor.html`; ein `<div>` unter der Statuszeile ist
der Aufhänger. Kein Griff ins Elternfenster ⇒ die eigenständige Fassung (`window.open`) funktioniert
weiter. Die Kacheln, Statuszeile und die zwei „öffnen"-Links liegen in derselben Datei.

---

## 8. Wie geprüft wird

- 🔴 **Reinheit:** in beiden Rechen-Hälften steht **kein** `INSERT|UPDATE|DELETE` auf
  `political_territory`, `political_territory_wiki`, `political_territory_geometry` oder
  `wiki_territory_model`. Am Quelltext über den ganzen Aufrufbaum, wie
  `__tests__/sync-plan-purity-test.php` es für die vier anderen Arten tut — samt Gegenprobe, dass
  dieselben Schreiber von der Ausführ-Hälfte aus **gefunden** werden.
- **Der Leer-Riegel:** leeres Staging ⇒ null Zeilen in allen drei Kategorien.
- **Die Leer-Regel:** ein Staging-Feld ohne Wert erzeugt gegen eine gefüllte Kopie **keine**
  Änderungszeile.
- **Der Waisen-Riegel:** eine Kopie, auf die ein aktives Gebiet zeigt, erzeugt **keine** Löschzeile —
  wohl aber steht sie im Vorspann.
- **Die positive Auswahl:** eine Divergenz, die **nach** der Vorschau entsteht, wird **nicht**
  geschrieben. Das ist §6a in einer Zusicherung und der eigentliche Grund für die `only`-Liste.
- **Der Behalten-Riegel:** eine Zeile mit `declined_at` erzeugt keine Löschzeile mehr, wohl aber
  weiterhin Änderungszeilen.
- **Der Außengrenzen-Hinweis:** ein Eltern-Umzug, der einem Elternteil das letzte Kind nimmt, erzeugt
  den Hinweis — und die Ausführ-Hälfte ruft trotzdem **keine** Funktion des Außengrenzen-Systems.
- **Die require-Kette** des Endpunkts (§6i).
- 💣 **Jede Zusicherung wird durch Mutation belegt.** Presence is not execution: ein `//` vor einem
  Aufruf lässt `str_contains` grün. Kommentare vor der Prüfung entfernen, Aufrufe auf
  Rumpf-Einrückung ankern.
- ⚠️ **Live nur mit Editor-Anmeldung prüfbar.** Ohne Anmeldung bleibt: die Endpunkte antworten 401
  statt 500, die öffentlichen Lesewege bleiben 200.

---

## 9. Was NICHT dazugehört

- **Keine Änderung an der Baum-Kuratierung.** Sperren, Aussortieren, Lücken, Ziehen und Ablegen
  bleiben, wie sie sind.
- **Keine Neuberechnung der Außengrenzen** (§6d). Auch kein Löschen einer überflüssig gewordenen.
- **Kein Anlegen von Kartengebieten aus dem Wiki.** Ein Wiki-Artikel wird nicht dadurch zu einem Gebiet
  auf der Karte, dass es ihn gibt — das bleibt eine Entscheidung im Politik-Editor (§1.5).
- **Kein Rückgängig einer Übernahme.** Das Identitäts-Backup (`revert_identity`) bleibt, wie es ist;
  für die Kopie gibt es keins (übergeordneter Entwurf §9).
- **Keine Häkchen je Feld.** „Wert festhalten" ist der vorhandene Override, kein zweites Häkchen (§5).
- **Schritt 1 schreibt weiterhin ohne Vorschau ins Staging** (Owner: unverändert).
  ⚠️ Nebenbefund, hier nur festgehalten: das Staging wird ebenfalls live gelesen — die Wappen-URL und
  der Lizenzstand der Politik-Ebene kommen von dort (`territories-layer.php:75 f., 183 f.`). Ein
  „Syncen" ändert also sichtbare Wappen, ohne zu fragen. Das war vorher so und ist nicht Teil dieser
  Sitzung.

---

## 10. 🔧 DU: zwei offene Punkte, beide klein

1. **Der erste Lauf wird groß.** Die Kopie wurde monatelang nicht gepflegt; „Geändert" könnte über
   tausend Zeilen haben. Gedeckelt ist auf 200 je Kategorie mit „… und N weitere (werden mit
   übernommen)" — das ist die Regel aus Sitzung 1 und bleibt. *Mein Vorschlag: so lassen und den ersten
   Lauf gemeinsam ansehen.*
2. **Waisen könnten alt sein.** Wie viele Kopien ohne Kartengebiet und ohne Wiki-Artikel es wirklich
   gibt, weiß nur die Live-Datenbank. Die Zahl steht beim ersten Lauf in der Vorschau; **angehäkelt
   wird nichts**, also ist der erste Blick gefahrlos.
