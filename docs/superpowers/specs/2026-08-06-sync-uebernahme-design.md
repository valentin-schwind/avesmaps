# Sync-Übernahme — Vorschau und Bestätigung für jeden Abgleich

**Stand:** 2026-08-06 · **Status:** abgestimmt · **Sitzung 1 (Fundament + Stadtkarten) gebaut am
06.08.2026**, Bauplan: [`docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-1.md`](../plans/2026-08-06-sync-uebernahme-sitzung-1.md) ·
**Sitzung 2 (Abenteuer, Publikationsquellen, Vorkommen) gebaut am 06.08.2026**, Bauplan:
[`docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-2.md`](../plans/2026-08-06-sync-uebernahme-sitzung-2.md) ·
**Sitzung 3 (Orte, Wege, Regionen) gebaut am 06.08.2026** — nur die Formensprache; die drei Kategorien
passen dort nicht (§7) ·
**Sitzung 4 (Territorien) entworfen am 06.08.2026**, eigener Entwurf:
[`2026-08-06-sync-uebernahme-territorien-design.md`](2026-08-06-sync-uebernahme-territorien-design.md) — noch nicht gebaut ·
**Mockup:** [`docs/sync-uebernahme-mockup.html`](../../sync-uebernahme-mockup.html) (anklickbar) ·
**Verwandt:** A16 (`docs/systemtest-2026-08-05/1-akut.md`), `docs/konfliktmanagement-design.md`

---

## 1. Was heute passiert

Ein Wiki-Abgleich schreibt **ohne zu fragen**. Vier von ihnen löschen dabei:

| Sync | löscht | Riegel |
|---|---|---|
| Stadtkarten | ganze Karten samt Orten, Typen, Fundort-Links und Quellenverweisen | `origin='wiki' AND status='approved'` |
| Abenteuer | zugeordnete Orte | `origin='wiki' AND status='approved'` |
| Vorkommen | Zuordnungen | `origin='wiki'` |
| Publikationen | Quellenverweise | `origin='wiki_publication' AND status='approved'` |

Die Riegel sind gut und bleiben. Sie beantworten aber nur „darf der Sync das anfassen?" — nicht
„will ein Mensch das?". Ein Wiki-Artikel, der aus Versehen gelöscht oder umbenannt wurde, nimmt beim
nächsten Lauf unsere Daten mit, und **niemand erfährt davon**.

**Orte, Wege und Regionen machen es schon fast richtig:** sie laufen über „Fälle", die einzeln
bestätigt werden. Das ist im Kern der Zielzustand — nur mit eigener Oberfläche. Wir erfinden nichts,
wir ziehen den Rest nach und vereinheitlichen die Oberfläche.

---

## 2. Was entschieden ist (Owner, 06.08.2026)

| | |
|---|---|
| Jeder Sync zeigt **erst**, was er tun würde. Geschrieben wird nur, was angehäkelt ist. | |
| Drei Kategorien, immer dieselben | **Neu · Geändert · Gelöscht** |
| Neu und Geändert | vorangehäkelt |
| Gelöscht | **nicht** vorangehäkelt, und braucht eine **zweite, ausdrückliche Bestätigung** |
| Bei Geändert sichtbar | ob ein lokaler Override den Wert festhält |
| Abgehäkelte **Änderung** | übersprungen. Kommt beim nächsten Lauf wieder, mit Vermerk „⤴ 3× übersprungen, zuletzt 28.07." |
| Abgehäkelte **Löschung** | **behalten**, dauerhaft. Wird nie wieder gefragt. |
| Eine behaltene Zeile bleibt aber ein **Wiki**-Eintrag | `origin` bleibt `wiki`, der `wiki_key` steht weiter da. Kommt der Artikel zurück, **läuft sie ohne Zutun wieder mit**. |
| „Später" | Die Liste bleibt liegen — **samt Häkchen**. Ein „Abbrechen" gibt es nicht: geschrieben wurde ohnehin nichts. |
| Gilt für | **alle** Eintragsarten, nicht nur Karten |

💣 **Deshalb ausdrücklich NICHT `origin='manual'` beim Behalten.** Das entschiede zwei Dinge auf
einmal — „nicht löschen" *und* „nie wieder aktualisieren" —, und in dem Moment denkt man nur über das
erste nach. Die Trennung ist die eigentliche Entscheidung dieses Entwurfs:

- **„Ich habe ihn bearbeitet"** → `origin='manual'`. Er gehört uns, der Abgleich ist ganz raus.
- **„Ich habe die Löschung abgelehnt"** → nur die Löschfrage ist abbestellt. Die Pflege läuft weiter.

---

## 3. Die nachgeprüften Tatsachen

Alles hier steht am 06.08.2026 so im Code.

1. **Von Hand angelegte Karten sind dreifach geschützt.** Die Kandidatenliste liest nur
   `WHERE wiki_key IS NOT NULL` (`citymap-sync.php:1910`); der Filter überspringt `origin !== 'wiki'`
   und alles, was nicht `approved` ist (`:1041`); das `DELETE` trägt nochmal `AND origin = 'wiki'`
   (`:1927`). ⇒ **Handarbeit taucht in der Vorschau überhaupt nicht auf** — weder unter Neu noch
   Geändert noch Gelöscht.
2. **Eine Wiki-Karte, die jemand von Hand bearbeitet, wird dabei automatisch unsere.**
   `origin = IF(origin = 'wiki', 'manual', origin)` (`api/_internal/app/citymaps.php:1453`, im
   Kommentar „ADOPTION"). Eine Community-Karte bleibt `community`.
3. **Der Wiki-Schlüssel überlebt alles.** `citymap.wiki_key` wird per `ALTER` nachgerüstet
   (`citymap-sync.php:1208`), und der Abgleich findet die Zeile bei jedem Lauf darüber wieder:
   `SELECT … FROM citymap WHERE wiki_key = :wk` (`:1722`). Nichts muss archiviert werden.
4. **Die Richtlinie „nicht anfassen" ist EINE Zeile**, kein Strukturmerkmal:
   `if ((string) ($current['origin'] ?? '') !== 'wiki') { return ['action' => 'skip', …]; }`
   (`avesmapsCitymapReconcilePlan`, `:957`). Dort gehört auch die neue Entscheidung hin.
5. **Die Vorlage für „eine Entscheidung überstimmt genau eine Handlung" steht im Haus.**
   `avesmapsLoreRemovePlace` setzt bei einem Wiki-Ort `status='suppressed'` und lässt `origin='wiki'`
   stehen — ein Grabstein, den kein Sync wiederbelebt, ohne dass die Zuständigkeit wechselt. Wir
   brauchen dieselbe Mechanik in die andere Richtung.
6. **Das Prinzip ist ebenfalls schon Hausrecht.** Das Konfliktzentrum: *berechnet, nie gespeichert —
   gespeichert wird nur die Entscheidung des Editors.* Ein repariertes Problem verschwindet von
   selbst, ein wieder aufgetretenes kommt von selbst zurück. Genau das brauchen wir hier.
7. 💣 **Und die Stelle, an der die Arbeit steckt:** jeder Reconcile ist eine **Cursor-Schleife, die
   im Laufen schreibt** (`avesmapsCitymapReconcileStep`, `…AdventureReconcileStep`,
   `…LoreReconcileStep`, `…PublicationReconcileStep`). Ein Lauf spannt über viele Requests, weil
   STRATO nach ~43 s abschneidet. Es gibt kein „erst rechnen, dann schreiben". **Das ist das Vorhaben:
   neun Abgleiche in zwei Hälften schneiden.** Die Oberfläche ist einmal gebaut und dann fertig.

---

## 4. 💣 Die Fallen

**(a) Der Plan muss gespeichert werden — und veraltet dadurch.**
„Später" funktioniert nur, wenn die Liste liegen bleibt. Neu berechnen kostet Minuten (kompletter
Dump-Durchlauf in Schüben). Also: Plan in die Datenbank. Preis: zwischen Berechnen und Übernehmen kann
jemand die Karte von Hand bearbeiten oder ein neuer Dump kommen. **Die Übernahme prüft deshalb jede
angehäkelte Zeile noch einmal gegen den aktuellen Stand**; was nicht mehr passt, bleibt stehen und
wird hinterher genannt. Das Alter der Liste steht sichtbar an ihr, nicht in einer Fußnote.

**(b) Zwei Arten zu behalten dürfen nicht verschmelzen.** Siehe §2. Ein Test hält sie auseinander.

**(c) Ein leerer Katalog darf nie „alles löschen" heißen.** Der Riegel existiert bereits
(`avesmapsCitymapRemovableKeys`, `:1033`: leerer Katalog ⇒ leere Entfernliste, weil „Dump holen" nie
gelaufen sein könnte). **Er muss beim Umbau erhalten bleiben** — in der neuen Welt wäre der Schaden
eine Vorschau, die 457 Löschungen vorschlägt, und irgendwann klickt jemand.

**(d) Die Wiederaufnahme darf nicht kaputtgehen.** Die Rechen-Hälfte behält die Cursor-Bauart: sie
schreibt Planzeilen statt Daten, sonst unverändert. Die Ausführ-Hälfte arbeitet die angehäkelten
Planzeilen ab — ebenfalls in Schüben, mit demselben Zeitbudget.

**(e) 💣 Das Änderungsprotokoll behält nur 200 Einträge.**
Seit `1b450f70` (A16) schreibt jede Löschung eine Protokollzeile. Eine Übernahme mit 46 Zeilen würde
46 davon schreiben und das Protokoll fluten — die eigenen Änderungen von gestern wären weg.
**Regel: eine Übernahme schreibt EINE Protokollzeile je Lauf**, mit den Zahlen und der Liste im
`after_json`, nicht eine je Eintrag. Die Einzelheiten stehen ohnehin im Plan, der liegen bleibt.

**(f) STRATO.** Nichts in einer Schleife abfragen. Die Vorschau lädt in einem Abruf; lange Listen
werden serverseitig begrenzt und sagen, dass sie begrenzt sind.

---

## 5. Das Datenmodell

Drei Tabellen. Eine für den Lauf, eine für die Zeilen, eine für die einzige dauerhafte Entscheidung.

```
sync_plan_run
  id, kind            -- 'citymap' | 'adventure' | 'lore' | 'publication' | …
  state               -- 'building' | 'open' | 'applied' | 'superseded'
  source_stamp        -- welcher Dump-Lauf; macht Veraltung erkennbar
  counts_json         -- neu / geändert / gelöscht, für die Kachel ohne Volltreffer-Abruf
  created_at, created_by, applied_at, applied_by

sync_plan_item
  id, run_id
  entity_key          -- wiki_key o. ä.; die Identität, unter der der Sync sie wiederfindet
  entity_public_id    -- NULL, solange sie noch nicht existiert
  change_type         -- 'new' | 'changed' | 'deleted'
  label               -- was in der Zeile steht ("Havena – Hafenviertel")
  before_json         -- nur die abweichenden Felder, keine ganzen Zeilen
  after_json
  override_json       -- welche Felder von Hand gesetzt sind und deshalb stehenbleiben
  selected            -- der Häkchenstand; überlebt „Später"
  apply_state         -- NULL | 'applied' | 'stale' | 'failed'
  apply_note

sync_decision         -- 🔴 die EINZIGE dauerhafte Entscheidung
  kind, entity_key, change_type      -- PRIMARY KEY
  skipped_count, last_skipped_at, last_skipped_by
  declined_at, declined_by           -- gesetzt NUR bei change_type='deleted'
```

**Warum eine Tabelle für zwei Bedeutungen:** `change_type` entscheidet, was ein Eintrag heißt.
Bei `'changed'` zählt er nur mit (`skipped_count`) und die Zeile kommt wieder; bei `'deleted'` ist
`declined_at` die dauerhafte Absage. Getrennte Tabellen wären zwei Wahrheiten über dieselbe Geste.

⚠️ **`sync_decision` wird nie automatisch geleert.** Sie ist die Erinnerung. Rücknehmbar über
„früher abgelehnte Löschungen anzeigen" in der Vorschau — eine dauerhafte Entscheidung, die man nicht
mehr sehen kann, ist ein schwarzes Loch.

⚠️ **Alles andere wird bei jedem Lauf neu gerechnet.** Kein Zustand, der nachgeführt werden muss.

---

## 6. Wie sich das Verhalten ändert — und was gleich bleibt

**Der 🚨-Knopf schreibt nicht mehr.** Er rechnet und öffnet die Vorschau. Seine Statuszeile sagt
danach „46 Unterschiede — Vorschau offen" statt „fertig".

**Ein zweiter Lauf ersetzt den offenen Plan** (`state='superseded'`). Die Entscheidungen aus
`sync_decision` überleben, die Häkchen nicht — sie gehörten zu Zahlen, die es nicht mehr gibt.

**Was gleich bleibt:** alle Riegel aus §1, die Adoption aus §3.2, die Grabsteine, der Leerkatalog-
Riegel, die Schrittbauart, die Wiederaufnahme.

---

## 7. Die vier Sitzungen

### Sitzung 1 — Fundament und Stadtkarten

Die drei Tabellen, das gemeinsame Bauteil, **ein** Abgleich als Beweis. Stadtkarten, weil dort der
echte Datenverlust sitzt (ganze Karten samt Kindern) und weil dieser Sync die klarste Zweiteilung hat:
`avesmapsCitymapReconcilePlan` ist bereits eine **reine Funktion**, die sagt, was zu tun wäre.

- `avesmapsCitymapReconcileEntityWrites` wird in „Plan schreiben" und „Plan ausführen" geschnitten.
  Die reine Plan-Funktion bleibt, wo sie ist.
- `avesmapsCitymapRemoveVanished` wird zum Erzeuger von `change_type='deleted'`-Zeilen und verliert
  sein `DELETE`. Der Leerkatalog-Riegel wandert unverändert mit.
- Der neue Riegel `declined_at IS NOT NULL` ⇒ keine Löschzeile.
- Vorschau-Endpunkte: lesen, häkeln, übernehmen. Ein „Verwerfen" gibt es nicht (§2) — von vorn
  anfangen heißt, den Sync noch einmal laufen zu lassen, und der ersetzt den offenen Plan (§6).
- Das Bauteil (HTML/CSS/JS) nach dem Mockup, mit den Tokens aus `css/base/tokens.css`.
- **Fertig heißt:** ein Wiki-Abgleich der Karten löscht nichts mehr ohne Häkchen, und die Übernahme
  hinterlässt genau eine Zeile im Änderungsverlauf.

### Sitzung 2 — Abenteuer, Publikationen, Vorkommen ✅ gebaut am 06.08.2026

Dieselbe Mechanik, drei Mal nachgezogen. Alle drei hatten bereits Plan-Funktionen
(`avesmapsAdventurePlacePlan`, `avesmapsAdventureFieldPlan`, `avesmapsLoreChildPlan`,
`avesmapsLoreFieldPlan`, `avesmapsPublicationReconcileSegmentOrder`). ⚠️ Bei den Vorkommen ist die
Löschung ein **Grabstein**, keine echte Löschung — die Zeile sagt das, sonst wirkt die Warnung
übertrieben und wird weggeklickt.

**Was beim Bauen dazukam** (Einzelheiten im Bauplan):

- 💣 **Die dritte Kategorie gehört dem Verschwinden einer ganzen EINHEIT.** Verliert eine lebende
  Einheit nur Kindzeilen (3 Orte eines Abenteuers, 2 Quellenverweise eines Ortes, 4 Vorkommen eines
  Eintrags), steht das benannt und in Warnfarbe in ihrer **Geändert**-Zeile. Zwingend, nicht
  Geschmack: die Ausführ-Hälfte ruft den unveränderten Schreiber, und der schreibt eine Einheit
  GANZ — zwei Zeilen je Einheit hießen, dass eine abgehäkelte Löschung trotzdem passiert. Abenteuer
  und Publikationsquellen haben deshalb **nie** eine Löschzeile, und ihre dritte Gruppe sagt das.
- 💣 **Drei Vorlagen antworten durch Schreiben** und brauchten read-only Zwillinge:
  `avesmapsAdventureFindOrAdoptRow` (übernimmt einen Platzhalter auf der Stelle),
  `avesmapsFeatureSourceUpsert` (legt die Quelle an, um ihre id nennen zu können) und der
  Cover-Download mitten im Schreibvorgang.
- 💣 **Der Vorkommen-Abgleich hatte keinen Schreiber je Eintrag** — der Rumpf war die Schleife
  selbst, mit einem `$dryRun`-Schalter, der die arme Fassung genau dieser Vorschau war. Der Rumpf
  wanderte wörtlich nach `lore-plan-apply.php`, der Schalter ist weg.
- ⚠️ **„Dump holen" endet jetzt in einer Vorschau** (Schritt 4/4 ist der Quellen-Abgleich).
- ⚠️ Die **zweite Tür** zum Publikations-Reconcile (die `reconcile`-Unterstufe der Dump-Phase) bleibt
  scharf: sie gehört zur Apply-Pipeline der Orte/Wege/Regionen und damit zu Sitzung 3.
- ⚠️ Nebenbei behoben: `avesmapsWikiSyncNextMapRevision` fehlte in der require-Kette des
  Vorschau-Endpunkts — die Karten-Übernahme hob die Kartenrevision nicht, lautlos hinter einem
  `function_exists`. Gefunden vom neuen `__tests__/sync-plan-endpoint-chain-test.php`.

### Sitzung 3 — Orte, Wege, Regionen ✅ gebaut am 06.08.2026

Bauplan: [`docs/superpowers/plans/2026-08-06-sync-uebernahme-sitzung-3.md`](../plans/2026-08-06-sync-uebernahme-sitzung-3.md) ·
Mockup: [`docs/sync-uebernahme-fallliste-mockup.html`](../../sync-uebernahme-fallliste-mockup.html)

Gebaut wurde die eine Hälfte dieses Abschnitts: **das Aussehen wird einheitlich.** Die Fälle behalten
ihre eigene Speicherung, ihre Verben und ihre Auflöse-Wege, genau wie im Konfliktzentrum.

💣 **Die andere Hälfte — „die drei Kategorien ersetzen die heutige Fall-Typologie" — ist nach Zählung
zurückgenommen worden** (Owner-Entscheid 06.08.2026 nach Mockup). Die drei Kategorien sind eine
Ordnung von **vorgeschlagenen Schreibungen**, die Fall-Typologie eine Ordnung von **Fragen**. Alle 16
Falltypen:

| | Zahl | welche |
|---|---|---|
| **Neu** ehrlich | 2 | `missing_wiki_with_coordinates`, `missing_wiki_without_coordinates` |
| **Geändert** ehrlich | 7 | `canonical_name_difference`, `type_conflict`, `probable_match`, `coordinate_drift`, `field_divergence`, `coat_available`, `verlauf_changed` |
| **Gelöscht** | **0** | keiner der drei Abgleiche löscht je etwas |
| **kein Zuhause** | 7 | `unresolved_without_candidate`, `duplicate_avesmaps_name`, `duplicate_wiki_title`, `missing_capital`, `course_conflict`, `station_missing`, `hops_unroutable` |

Und ein **Häkchen ist bei 2 von 16 Falltypen die richtige Form**. Sonst ist die Antwort nicht „ja",
sondern *„welcher von diesen"* und danach *„und so soll er heißen"*: „Lösen" öffnet ein **Formular**
mit den Voreinstellungen Karte/Wiki, das ein Mensch ausfüllt und abschickt
(`openWikiSyncResolveDialogForCase`; der Server nimmt `name`/`feature_subtype`/`description`/
`wiki_url`/`is_nodix`/`is_ruined` entgegen). „Position wählen" wartet auf einen Kartenklick.
„Hauptstadt zuweisen" ist ein Suchfeld. Bei den Regionen gibt es überhaupt keine Fälle, sondern eine
Arbeitsfläche zum Draufziehen.

💣 **Die teuerste Stelle wäre „Geändert" gewesen:** dort stünden die geänderten Wegverläufe
vorangehäkelt, mit einem „alle"-Knopf darüber. Genau dieser Sammelknopf wurde am **22.07.2026
ausgebaut** (`js/review/review-path-sync.js`), nachdem er an echten Daten gemessen 70 Straßensegmente
gelöst hätte — jedes ein zusammenhängendes Stück seiner *eigenen* Straße.

**Was gebaut wurde:**

- Das Bauteil nimmt seine Zeilen jetzt aus einer **austauschbaren Quelle** (`syncPlanResolvePost`,
  `openSyncPlanSheet({…, post})`). Abnehmer ist Sitzung 4 — die Territorien rechnen ihre Unterschiede
  längst als `neu / verschwunden / geändert`, also genau die drei Kategorien. Ein Test zählt am
  Quelltext nach, dass niemand am eingereichten Sender vorbei den Standard ruft.
- Die Falllisten gruppieren durch **Trennlinien statt Kästen**, die Auskunftszeilen stehen im
  **ruhigen Feld** (`.wiki-sync-case__facts`), und die Knöpfe tragen die Hierarchie des Blattes.
  ⚠️ Die Knopfregel gab es seit dem 21.07. schon — beschränkt auf `#conflict-list`, weil sie dort
  auffiel. Sie gilt jetzt für beide Oberflächen, die Kopie ist entfallen.
- Jede Fallgruppe sagt in **einem Satz**, worum es geht, aus dem EINEN Katalog (`LEGACY_RULE_INFO`).
  ⚠️ Der Satz steht im **Rumpf**, nicht rechts in der Überschrift wie im Blatt: in der 400 px schmalen
  Spalte bricht er dort auf drei Zeilen (35 → 61 px je Überschrift, bei zwölf Gruppen rund 300 px
  Scrollstrecke). Zugeklappt bleibt die Liste ihr Inhaltsverzeichnis.

⚠️ **Erfasst sind Orte, Wege und das Konfliktzentrum — die Regionen NICHT.** Die drei teilen sich die
Klassen `.wiki-sync-case*` und haben die neue Form deshalb in einem Zug geerbt (die Wege ohne eine
Zeile JS, das Konfliktzentrum, weil es `createWikiSyncCaseElement` mitbenutzt). Die Regionenliste
schreibt eigene Klassen (`region-sync__*`, `tree-item`) und ist unverändert geblieben: sie hat keine
Fälle, sondern eine Arbeitsfläche mit den Reitern Alle / Platziert / Fehlt, auf der man eine fehlende
Region auf die Karte **zieht**. Sie anzugleichen ist eine eigene, kleinere Aufgabe und war in dieser
Sitzung nicht nötig, um die Divergenz zu beenden — die saß zwischen Fallliste und Blatt.

⚠️ **Live mit echten Daten nur mit Editor-Anmeldung sichtbar.** Belegt wurde in beiden Umgebungen
(WikiSync-Panel und Konfliktzentrum) und in beiden Themes über eine Prüfseite mit der echten
CSS-Kette — nicht am echten Fallbestand.

### Sitzung 4 — Territorien

**Eigener Entwurf, abgestimmt am 06.08.2026:**
[`2026-08-06-sync-uebernahme-territorien-design.md`](2026-08-06-sync-uebernahme-territorien-design.md) ·
Mockup: [`docs/sync-uebernahme-territorien-mockup.html`](../../sync-uebernahme-territorien-mockup.html)

Zuletzt und allein. Der Baum-Arbeitsablauf **bleibt**: „Eltern gesperrt", „aussortiert" und die Lücken
sind Kuratierung *am Baum*, nicht am einzelnen Datensatz.

| heute | danach |
|---|---|
| 🚨 Syncen | **1 · 🚨 Syncen** — unverändert; Name und Alarmzeichen bleiben wie in den anderen vier Editoren |
| Hierarchie | **2 · Baum rechnen** — unverändert |
| Unterschiede (`neu / verschwunden / geändert`) | eine **eigene** Vorschau an Schritt 1 (siehe unten) |
| Test (trockene Probe der Eltern-Zuweisung) | fällt weg — die Vorschau an Schritt 3 sagt dasselbe mit Namen und Häkchen |
| Daten-Vorschau (read-only) | geht in „Geändert" auf, mit Häkchen |
| „Daten übernehmen" + „Modell übernehmen" | **3 · Übernehmen** — ein Knopf |

💣 **Diese Tabelle war eine Zuordnung, kein Entwurf — und drei Zeilen stimmten so nicht.** Beim
Nachlesen im Code:

1. **Der Territorien-Abgleich löscht nie und legt nie ein Wiki-Gebiet an.** Nur eigene Knoten
   (`eigener-knoten:*`) werden angelegt; ein Wiki-Artikel wird zum Kartengebiet ausschliesslich von
   Hand im Politik-Editor. ⇒ Die dritte Kategorie ist strukturell **0**, wie bei den Orten in
   Sitzung 3, und „Neu" sind die eigenen Knoten.
2. **„Modell übernehmen" ruft die Daten-Übernahme bereits mit auf** (`wiki-sync-monitor.html:1333`).
   Der eine Knopf entfernt eine **Dopplung**, er verschmilzt keine zwei gleichrangigen Handlungen.
3. 💣 **Den Wiki-Spiegel `political_territory_wiki` füllt seit der Stilllegung von `sync_territories`
   niemand mehr** — gelesen wird er live (Infobox, „Liegt in", Konfliktregeln). „Unterschiede" zeigte
   also Zahlen, an denen kein Knopf etwas ändern konnte. Owner-Entscheid: **die Kopie wird
   nachgeführt.** Damit hat Sitzung 4 zwei verschiedene Ziele — unsere Wiki-Ablage (über tausend
   gleichförmige Zeilen) und die Karte (wenige Dutzend folgenreiche) — und deshalb **zwei** Vorschauen
   an zwei Schritten statt einer. Ständen sie zusammen, ständen die folgenreichen zwischen den
   harmlosen.

---

## 8. Wie geprüft wird

- **Die Plan-Funktionen sind rein und werden mit echten Zeilen geprüft** — das ist der Grund, warum
  dieser Umbau überhaupt gut testbar ist.
- 💣 **Eine Zusicherung, die den Kern festhält:** in der Rechen-Hälfte darf **kein** schreibendes
  Statement auf die Nutztabellen stehen. Am Quelltext prüfbar (`INSERT|UPDATE|DELETE` gegen die
  Entitätstabellen), und genau das ist die Eigenschaft, die das Vorhaben ausmacht.
- **Der Leerkatalog-Riegel** bekommt eine eigene Zusicherung: leerer Katalog ⇒ null Löschzeilen.
- **Der Behalten-Riegel:** eine Zeile mit `declined_at` erzeugt keine Löschzeile mehr, wohl aber
  weiterhin Änderungszeilen. Das ist §2 in einer Zusicherung.
- **Die Nachprüfung beim Übernehmen:** ein Plan, dessen Zeile sich inzwischen geändert hat, wird
  `stale` und nicht ausgeführt.
- 💣 **Jede Zusicherung wird durch Mutation belegt.** Presence is not execution: ein `//` vor einem
  Aufruf lässt `str_contains` grün. Kommentare vor der Prüfung entfernen, Aufrufe auf
  Rumpf-Einrückung ankern (die Lehre aus `1b450f70`).
- ⚠️ **Live nur mit Editor-Anmeldung prüfbar.** Ohne Anmeldung bleibt: die Endpunkte antworten 401
  statt 500, die öffentlichen Lesewege bleiben 200.

---

## 9. Was NICHT dazugehört

- **Kein Rückgängig einer Übernahme.** Das ist A16 Stufe 3 und braucht ein weiches Löschen, das diese
  Tabellen nicht haben.
- **Keine Häkchen je Feld.** Eine Zeile ist die kleinste Einheit; Feld-Häkchen wären eine zweite
  Override-Mechanik neben der, die es schon gibt.
- **Keine Sperre zwischen Editoren.** Zwei Leute an derselben Liste ist selten; die Nachprüfung beim
  Übernehmen fängt den Fall ohnehin ab.
- **Keine Änderung an der Baum-Kuratierung der Territorien.**

---

## 10. 🔧 DU: zwei Fragen, beide erst für Sitzung 1 relevant

1. **Darf jeder Bearbeiter eine Löschung anhäkeln, oder nur der Betreiber?** Der Kommentar an
   `avesmapsDeleteCitymap` sagt „owner-only", der Endpunkt prüft aber nur die Fähigkeit `edit`
   (`api/edit/map/citymaps.php:32`). Diese Unstimmigkeit ist älter als dieses Vorhaben.
   *Mein Vorschlag: `edit` reicht* — die zweite Bestätigung und die Protokollzeile sind der Schutz,
   und eine Fähigkeit, die niemand hat, führt dazu, dass Löschungen nie abgearbeitet werden.
2. **Wie viele Zeilen zeigt eine Kategorie höchstens?** Ein erster Lauf kann tausende „Neu" bringen.
   *Mein Vorschlag: 200 je Kategorie, danach „… und 4.812 weitere (alle übernehmen)"* — die Zahl steht
   da, das Häkchen gilt für alle, und niemand scrollt durch 5.000 Zeilen.
