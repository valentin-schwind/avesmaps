# Auftrag: Der Wiki-Override für alle Objektarten

> **Für eine eigene Sitzung.** Dieser Auftrag ist in sich vollständig — du brauchst
> keine Vorgeschichte zu kennen, aber alles Nötige steht hier.

## Was der Owner will, in seinen Worten

> „Der Territoriumseditor ist viel besser, weil er mit ‚Editieren' explizit die Textlabels frei
> schaltet und beim Speichern anzeigt, was sich gegenüber dem WikiSync verändert hat. UND ICH KANN
> ES SOGAR ZURÜCKSETZEN."

und, als er gefragt wurde, ob das nur für eine Objektart gelten soll:

> „nein wir wollen den override für alles."

Dazu der Satz, der den Zweck des ganzen WikiSync benennt:

> „das ist der grund, warum ich wikisync überhaupt haben wollte. weil ich sehen will, **was gesynct
> und was von uns editiert ist**."

## Das Vorbild, das es schon gibt

Der **Territoriumseditor** (Kartendialog, `#region-edit-dialog`, montiert von
`js/review/review-region-wiki-picker.js`) macht drei Dinge, die kein anderes Fenster macht:

1. **Der Zustand ist explizit.** Ein Knopf „Editieren" schaltet die Felder frei. Vorher ist alles
   nur lesbar — kein versehentliches Ändern.
2. **Die Abweichung ist dauerhaft sichtbar**, in der Leseansicht, ohne dass man etwas drückt:
   ~~Fürstkomturei Maraskan~~ → **Fürstkomturei Tobimora** · (leer) → **MAR**
3. **Jedes Feld einzeln zurücksetzbar** — ein ↺ neben der Feldbeschriftung nimmt genau diesen
   Override zurück, ohne die anderen anzufassen.

Erst 2 und 3 zusammen machen es stark: man sieht die Abweichung **und** kann sie punktgenau
rückgängig machen.

Die Ablage dafür ist `metadata_overrides_json` am Wiki-Knoten (`wiki_territory_model`) — ein
**ausdrücklicher Override-Datensatz**, kein blosser Wert.

## Was fehlt

Alle anderen Objektarten zeigen die Abweichung **nur auf Knopfdruck**, in der Sync-Vorschau, und
kennen kein Zurücksetzen. Betroffen sind acht Objektarten in elf Oberflächen:
`ort · weg · landschaft · landschaftslabel · kraftlinie · literatur · karte` (plus `territorium`,
das es schon hat).

## 🔴 Die halbe Miete liegt schon da — such sie, bevor du baust

Am 16.08.2026 wurde die Wiki-Zuweisung auf **ein** Bauteil vereinheitlicht. Dabei ist genau die
Infrastruktur entstanden, die dieser Auftrag braucht:

- **`js/ui/wiki-assign-registry.js` — das Feldregister.** Es erklärt je Objektart, **welches
  Wiki-Feld welchem Kartenfeld entspricht** (`felder: [{ wiki, karte, label }]`). Das ist exakt,
  was ein ↺ wissen muss, um ein einzelnes Feld auf den Wiki-Wert zurückzusetzen — und was eine
  Abweichungsanzeige wissen muss, um zu wissen, welche zwei Werte sie vergleicht.
- **`js/ui/wiki-assign-diff.js` — die Diff-Rechnung.** Sie rechnet den Unterschied Karte↔Wiki
  bereits aus, rein, ohne DOM. Sie wird heute nur zum **falschen Zeitpunkt** aufgerufen (beim
  Klick auf „Sync"), nicht beim Laden.
- **`js/ui/wiki-assign.js` — das Bauteil**, das aus der Erklärung Zustände, Suche, Trefferliste
  und Vorschau ableitet. 🔴 Es **kennt keine Objektart** (kein `if (subject === …)`), und das muss
  so bleiben.

**Lies den Kopfkommentar von `js/ui/wiki-assign.js` zuerst.** Dort steht der Vertrag und die
Fallen, die vierzehn Prüfrunden gekostet haben.

## 💣 Die Grenze, die du kennen musst, bevor du planst

Beim **Territorium** gibt es einen echten Override-Datensatz: dort steht ausdrücklich „dieses Feld
haben wir überschrieben". **Bei Ort, Weg, Landschaft und den übrigen gibt es das nicht** — dort ist
der Kartenwert einfach der Wert.

Daraus folgt: du kannst heute zeigen **„weicht vom Wiki ab"**, aber **nicht** unterscheiden zwischen

- *„das haben wir bewusst geändert"* und
- *„das wurde nie gesynct"*.

Der Owner will die echte Unterscheidung („was gesynct und was von uns editiert ist"). **Das heisst,
dieser Auftrag ist nicht nur Anzeige — er braucht eine Herkunftsangabe je Feld**, dort wo sie
fehlt. Wie die aussieht, ist die erste Entwurfsfrage. Vorbilder im Haus:

- `metadata_overrides_json` (Territorium) — der direkte Vorfahr
- `field_origins_json` (`adventure`, Literatur) — ⚠️ **existiert schon und ist grosszügig**: jeder
  je gespeicherte Eintrag trägt dort überall `manual`. Wer das ungeprüft als Herkunft liest,
  bekommt „alles von Hand" und damit Rauschen statt Auskunft. Miss es, bevor du es benutzt.
- `feature_sources.origin` (`wiki_publication|manual|community`) — dasselbe Muster eine Ebene
  höher, für Quellen

## ⭐ Was dieser Auftrag nebenbei repariert

Die **Sync-Vorschau** hakt heute **nichts** vor, wenn auf der Karte schon ein Wert steht
(Owner-Entscheid 16.08.2026, „konservativ"). Der Grund war ausdrücklich: *es gibt keine
Herkunftsangabe je Feld, also kann niemand wissen, ob ein Wert von Hand kam.* Mit dem Override
ist genau diese Angabe da — die Vorhäkelung kann wieder **genau** statt **vorsichtig** sein, und
`avesmapsWikiAssignDiff` hat für den Fall bereits einen Parameter (`handgesetzt`), der heute von
keiner Oberfläche gefüllt wird.

**Nenn das im Entwurf.** Es ist die zweite Hälfte des Nutzens und macht aus einer Anzeige eine
Verbesserung des Abgleichs.

## Vorgehen

1. 🔴 **Entwurf zuerst, kein Code.** Nutze `superpowers:brainstorming`, dann
   `superpowers:writing-plans`. Der Owner will den Entwurf sehen, bevor gebaut wird — das ist eine
   stehende Regel in diesem Projekt.
2. **Miss den Ist-Zustand je Objektart**, statt ihn anzunehmen: wo liegt der Kartenwert, wo der
   Wiki-Wert, gibt es eine Herkunftsangabe, und wie schreibt die Oberfläche.
3. **Eine Objektart zuerst, ganz.** Empfehlung: der **Ort** — er hat mit Name, Art, Einwohner,
   Lage, Herrscher die meisten Felder und damit den grössten Nutzen. Sitzt es dort, kostet jede
   weitere fast nichts, weil sie ihre Felder ohnehin schon erklärt hat.
4. **Dann die übrigen.**

## Bindende Hausregeln (AGENTS.md)

- **§5 — eine Ablage, kein zweites System.** Wer `CREATE TABLE <feature>_override` schreibt, hat es
  falsch verstanden. Das ist im Haus einmal passiert (Lore-Quellen) und hat eine Schemaerweiterung
  plus Datenmigration gekostet.
- **§8 — Kommentare, Commit-Nachrichten und Beschriftungen auf DEUTSCH.**
- **§9 — Abnahme heisst ABLAUF, nicht Mass.** Vor „fertig" wird in jeder Oberfläche wirklich
  editiert, zurückgesetzt, gespeichert. ⚠️ Und: sichtbare Änderungen gehen **einzeln** live, der
  Owner sieht jede. Der Umbau vom 16.08. hat davon eine Ausnahme bekommen — verlass dich nicht
  darauf, dass du sie auch bekommst.
- **§12 — Designsprache.** Keine Farbe, kein Radius, kein Abstand hartkodiert; nur Token aus
  `css/base/tokens.css`. Kein Blau in der Bedienoberfläche. 💣 Eine erweiterte Selektorliste trifft
  fremde Seiten — einengen und die Spezifität gegen **alle** Fremderzeuger rechnen.
- **Geteilter Arbeitsbaum:** niemals `git add -A`. Und arbeite in einem **eigenen Worktree** —
  `git checkout -b` im Hauptbaum stellt HEAD für alle Parallelsitzungen um; das hat am 16.08.
  binnen 65 Sekunden einen fremden Commit auf den falschen Zweig gezogen.

## ⚠️ Die Lehre dieses Vorgängers, und sie ist teuer bezahlt

Im Umbau vom 16.08. sind **neun** Zusicherungen durchgerutscht, die richtig aussahen. Der
Formenkatalog, damit du sie wiedererkennst:

1. **Eine Textprobe misst die FORM des Codes statt sein Verhalten.** „Steht `avesmapsX(` im
   Rumpf?" ist erfüllt von `try { return avesmapsX() } catch { return {} }` — also vom Gegenteil.
2. **Eine Zahl, die sich wie eine vollständige Liste liest.** „ZWEI Zuweiser" im Kommentar; ersetzt
   durch eine Dateiliste, die sich genauso vollständig las; ersetzt durch eine zweite. 💣 Die Zahl
   verschwindet nicht, sie wandert eine Ebene höher. **Zähl zur Laufzeit über den Baum.**
3. **Die Probe erfüllt sich aus ihrem eigenen Kommentar** — `indexOf("lage")` traf das Wort
   „vi**llage**" in einem englischen Nachbarkommentar.
4. **Eine Fixture, die nur eine Richtung fährt.** Startet sie mit gesetztem Merker, enden beide
   Handgriffe bei `false`, und ein Riegel, der `true` nie schickt, bleibt grün.
5. **Die Attrappe ist zu freundlich** — nicht die Zusicherung war blind, sondern das Modell.
6. **Bündel-Mutation.** Vier Zeilen auf einmal entfernt, roter Lauf gesehen — rot wurde er durch
   zwei davon. Sie beweist nur, dass **irgendeine** Zusicherung greift.
7. **Die Mutation selbst danebengesetzt.** Der eingebaute Gegenbeweis landete neben einem
   vorhandenen Riegel und war damit korrekter Code.

**Also: mutiere jede neue Zusicherung EINZELN** — Gegenstand kaputtmachen, roten Lauf mit der
echten Meldung festhalten, zurücksetzen. Und prüf, dass die Mutation trifft, was sie treffen soll.

⭐ Und die Technik, die am Ende entstand: statt einer Zeilennummer einen **zitierten Anker** in den
Kommentar setzen — *eine Zahl verschiebt sich lautlos, ein zitierter Anker nicht.* Dasselbe gilt
für die **Prosa**: ein Umbau macht auch die eigenen Sätze unwahr, nicht nur die Zahlen.

## Das Testfeld, vollständig

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```
```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
```
```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```

💣 **Der dritte Lauf ist der, den das dokumentierte Muster NICHT findet** — 21 Tests unter
`tools/wikidump/`, die weder in `__tests__` liegen noch auf `-test.php` enden. Genau dort ist am
16.08. ein fremder Test umgefallen und hat einen Umbau erzwungen.
⚠️ Vorbestehend rot ist **genau einer**: `api/_internal/linkcheck/__tests__/link-url-test.php`
(echter DNS-Abruf). Jeder weitere ist eine Regression.

## Was NICHT zu diesem Auftrag gehört

- 🔧 Die **Namensvarianten-Ernte** bei den Orten: 821 Orte tragen keine Wiki-Zuweisung, und eine
  Stichprobe von fünf hatte **jedes Mal** einen Artikel unter abweichendem Namen („Shinadra" ↔
  „Feste Shinadra", „Naumstein" ↔ „Burg Naumstein", „Osenbruck" ↔ „Osenbrück"). Das ist die
  grösste offene Ernte im Bestand — aber ein eigener Auftrag (toleranterer Vorschlag: Präfixe wie
  Burg/Feste/Kloster ignorieren, Diakritika falten).
- 🔧 Der **Merker `wiki_no_article`** wird von den Massenläufen überfahren. Heute folgenlos (kein
  Weg und kein Label trägt ihn), aber sobald Editoren im Konfliktzentrum welche setzen, räumt ein
  Lauf sie ab. Reparatur: je eine Zeile in den zwei Kandidatenabfragen plus eine benannte Ausnahme
  in `weg-wiki-no-article-test.php` und `label-wiki-no-article-test.php`.
- 🔧 Das neue **„Abbrechen"** ist nur bei **einer von sieben** Oberflächen im Ablauf geprüft; die
  übrigen sechs deckt eine Textprobe. Der brisanteste ungeprüfte Fall ist der **Anlegefall des
  Orts** (`js/review/review-settlement-wiki.js`, die einzige `schreibt`-Übersteuerung im Haus) —
  alle drei Fixtures setzen ein nicht-leeres `publicId`, sodass der Fall nie entsteht.
