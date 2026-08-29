# Übergabe: das Fenster „Garetien Importer"

**Stand:** 2026-08-29, ALLE AUFGABEN FERTIG · **Vorgänger-Sitzung:** Bau der Aufgaben 1–16
**Bauplan:** `docs/superpowers/plans/2026-08-27-garetien-importer-fenster.md` — **die Wahrheit**
**Auftrag:** `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md`
**Mappingtabelle:** `docs/superpowers/specs/2026-08-27-garetien-typinventar-und-mapping.md`
**Mockup:** `docs/garetien-importer-mockup.html` — die freigegebene Vorlage
**Ledger:** `.superpowers/sdd/2026-08-27-garetien-importer-fenster/progress.md` (gitignored)

---

## 1. Wo wir stehen

| | |
|---|---|
| **Fertig und LIVE** | **Alle 18 Aufgaben** (1–16 plus die nachgetragenen 12b und 13b). Gepusht bis `bf7dff3ef`, jede Datei live gegengemessen |
| **Offen** | die drei Owner-Entscheidungen (§2b) · das Tor vor dem ersten echten Import (§2) · der Ablauf mit angemeldeter Sitzung |

**Was live funktioniert:** das ganze Fenster. Der Knopf „Garetien Importer" (nur für Admins)
öffnet es, das Menüband holt einen Lauf und rechnet, die Liste zeigt ihn mit Bilanz, Reitern und
Filter, ein Klick auf eine Zeile zeigt rechts **ihr Objekt und unsere Abschnitte darunter**, das
Häkchen lässt die Auswahl **auf der Karte wachsen**, die vier Handlungen merken vor oder lehnen
ab — und „Angehakte übernehmen" geht durch das **vorhandene** Übernahme-Blatt, beliebig oft.

🔴 **Aber es hat noch nie gegen die echte Datenbank gearbeitet.** Kein einziger Handgriff dieses
Imports lief mit angemeldeter Sitzung; alle Abnahmen liefen gegen gemockte Endpunkte. Damit ist
insbesondere **ungeprüft, ob die Quelle (CC BY-NC-SA 3.0, Namensnennung „VolkoV / garetien.de")
am übernommenen Objekt wirklich dransteht** — der einzige Punkt mit Rechtsfolge.

---

## 2. 🔴 DAS TOR — bevor zum ersten Mal wirklich importiert wird

Das Fenster darf **gebaut und angesehen** werden, ohne dass diese drei stehen. Nur der Knopf,
der schreibt, wartet. Steht im Bauplan unter „Das Tor vor dem ersten echten Import".

| | Warum | Zahl |
|---|---|---|
| ✅ Koordinaten-Fix | erledigt in Aufgabe 4b | — |
| 🔴 **Wege-Subtyp `Bach`** | sonst liegen Bäche als **befahrbare** Flusswege in der Karte | **143 von 289** in Stufe 1 |
| 🔴 **Fünf neue Ortsarten** (`Burg`, `Gasthaus`, `Pfalz`, `Magierturm`, `Stadtviertel`) | sonst verlieren Bauwerke ihre Art | ab Stufe 4 |

Beide sind **nicht** Teil des 16-Aufgaben-Plans (Ruling R8). Details in der Mappingtabelle §1.4/§3.3.

---

## 2b. 🔧 WAS DER OWNER ENTSCHEIDEN MUSS — drei Befunde, und es ist DERSELBE Fall

Alle drei kommen aus derselben Frage: **wann gilt ein Objekt als erledigt, und was passiert mit
einem Widerspruch, den man weder ersetzen noch stehenlassen will.** Sie sind gemessen, nicht
vermutet, und keiner davon ist ein Programmierfehler.

### (1) Die Zeile `widerspruch` der Knopf-Tabelle ist an echten Daten TOT

Der Bauplan sagt für diesen Fall „Die Geometriefrage steht vorn". **Sie lässt sich nicht
beantworten.** `avesmapsGaretienErgaenzungsEintraege` läuft nur für `status === 'deckt_sich'`;
ein `widerspricht`-Objekt bekommt genau **ein** Basis-Item (`anlass='artikel_widerspruch'`,
`change_type='changed'`, **ohne** `felder`). Damit haben „Geometrie ersetzen …" und „Namen
ersetzen" kein Ziel — beide ausgegraut, mit Grund; bedienbar ist nur „Ablehnen".

Und beim Übernehmen setzt `garetien-uebernahme.php:443` diese Fälle auf `stale` mit *„braucht
eine Entscheidung von Hand"* — **eine Entscheidung, die dieses Fenster nicht anbietet.**

⚠️ Es sind **3 von 289** Objekten in Stufe 1 — aber sie kommen nach der Hausregel
**vorangehakt** (`change_type='changed'`).
🪤 **Warum es niemand sah:** die Testfixture ist `{ urteil: "widerspruch", …, items: [] }` — sie
prüft die **Reihenfolge** der Knöpfe, nie ihren **bedienbaren Zustand**.

### (2) Im Reiter „Offen" ist ein Häkchen eine EINBAHNTÜR

Gemessen an der Natter: ein Abschnittshäkchen von zweien → Offen 3→2, die Zeile ist weg, die
rechte Spalte leer, der Glow erloschen. **Und das Häkchen lässt sich dort nicht mehr
zurücknehmen** — man muss den Reiter wechseln.

🔴 **Kein eigenständiger Defekt.** Die Ursache ist eine Kette aus drei Aufgaben, von denen keine
für sich falsch ist: ein Objekt gilt als `vorgemerkt`, sobald **ein** Item hakt (Aufgabe 8) · der
Filter wirft die Zeile **serverseitig** aus dem Reiter · die Einzelansicht hängt an der Zeile
(Aufgabe 13). Nach dem Neuholen hat der Browser für dieses Objekt **gar keine Daten mehr**; jede
lokale Reparatur führte entweder die Geisteransicht wieder ein, die Aufgabe 13 ausdrücklich
verbietet, oder definierte um, was „Offen" heißt.

⭐ Im Reiter **„Vorgemerkt"** läuft derselbe Ablauf einwandfrei (Glow 2→3, Panel bleibt offen).

### (3) Der `widerspruch`-Abschnitt trägt „nichts zu ersetzen"

Er erzeugt kein Abschnitts-Item, fällt also in den `is-full`-Zustand — und das steht neben
„Deckung Median 8,95" und einem Grund, der sagt „die Geometrie liegt 8.95 Einheiten entfernt".
„nichts zu ersetzen" klingt nach „passt schon", während der Fall gerade **derselbe Artikel an
zwei Stellen** ist. Eine fünfte Beschriftung wäre die naheliegende Antwort — sie muss aber zur
Knopfleiste passen, und die ist Fall (1).

---

**Dazu zwei Kleinigkeiten, die keine Entscheidung brauchen, aber genannt gehören:**
- 🔧 **R10 (b) („Offen kann nie 0 werden") ist EINE ZEILE**, nicht unmöglich: Filter
  (`garetien-liste.php:229`) und Reiterzähler (`:531`) sind zwei getrennte Stellen. Bewusst nicht
  gebaut — kein Test, kein Schritt im Bauplan, und es hängt an derselben Frage wie (2).
- 🔧 **„liegt auf Darpat" aus Mockup §3 hat in unseren Daten keine Quelle.** Der Satz steht dort
  an einem namenlosen Abschnitt und nennt den Fluss, zu dem der gehört — diese Beziehung gibt es
  nicht. Herleiten hieße eine neue Geometrie-Nachbarschaftssuche für **eine Textzeile**.

---

## 3. Alle Entscheidungen, die ich getroffen habe

Sie stehen vollständig mit Begründung und „was es kostet, wenn falsch" im Ledger. Hier die
Kurzfassung — **jede ist zurückdrehbar**.

**Vom Owner bestätigt oder angeordnet:**
- **R6** „Geometrie ersetzen" gilt für **alle** Formen (Flächen und Wege); für Orte später nur
  „Position behalten oder ersetzen". *(Nimmt R5 zurück, das ich falsch entschieden hatte.)*
- **A3** Bei mehreren getroffenen Abschnitten wird **gezeigt**, nicht geraten — der Knopf bleibt
  ausgegraut, bis der Owner es am Bild entscheidet (nach Aufgabe 14).
- `Berg` → `berggipfel`-Label · neuer Subtyp `Bach` · neue Ortsart `stadtviertel` + vier weitere.

**Von mir entschieden, offen für Widerspruch:**
- **A** Geometrie-Item nur bei **genau einem** getroffenen Abschnitt.
- **B** Das Übernahme-Blatt zeigt nur das **Angehakte** (über einen eigenen `post`, ohne
  Änderung am Blatt).
- **C** `sync-plan.php` bleibt `edit`-gegattert; der Admin-Riegel sitzt am Knopf.
- **R3** Der Quellenbestand filtert **gar nicht** auf `status` — ein `suppressed` ist der
  Grabstein einer von Hand entfernten Quelle und darf nicht wieder angeboten werden.
- **R5→R7** Der Koordinaten-Tausch wird im **Aufrufer** repariert, nie in der Hausfunktion.
- **R9** Der Endpunkt kennt die Staging-Tabellen nicht mehr (gekapselt) — ein Wächter mit
  Ausnahmeliste wäre schwächer als einer ohne.
- **R10** 🔧 **Zwei der vier Reiter sind strukturell tot** und müssen in Aufgabe 15/16 repariert
  werden: „Abgelehnt" kann nie belegt werden (`avesmapsSyncPlanRecordDecline` schreibt
  `change_type='deleted'` fest verdrahtet), „Offen" kann nie 0 werden (item-lose Objekte sind
  immer offen). **Damit wäre das Abschlusskriterium des Auftrags unerreichbar.** Entschieden:
  (a) die Ablehn-Funktion bekommt den `change_type` als Parameter mit Vorgabe `'deleted'`;
  (b) „Offen" zählt nur Objekte, an denen es etwas zu tun gibt.
- **P1–P6, R1–R4** Planfehler, die vor oder während des Baus korrigiert wurden.

---

## 4. Was JETZT ansteht

**Der Bau ist fertig. Was fehlt, ist Wirklichkeit.**

1. 🔴 **Der Ablauf mit angemeldeter Sitzung**, ein Objekt, von Hand: Lauf holen · rechnen · eine
   Zeile anklicken · anhaken · Glow sehen · übernehmen · **auf der Karte nachsehen, ob die Quelle
   wirklich dransteht**. Das ist der einzige Schritt mit Rechtsfolge und der einzige, den keine
   Sitzung dieses Vorhabens je gefahren hat.
2. 🔴 **Die drei Owner-Entscheidungen** (§2b) — sie hängen zusammen und sind vor dem ersten
   echten Import zu treffen, weil sie die Bedeutung von „erledigt" festlegen.
3. 🔴 **Das Tor** (§2): der Wege-Subtyp `Bach` (**143 von 289** Objekten der Stufe 1) und die
   fünf neuen Ortsarten. Ohne sie lägen Bäche als **befahrbare** Flusswege in der Karte.
4. 🔧 **Ein Blick über ALLE Aufgaben zusammen.** Jede einzelne hatte ihre Prüfung, ihre Fix-Runde
   und ihre Nachprüfung — ein abschließender Gesamt-Review über die 18 Aufgaben hinweg steht aus
   (das Wochenlimit der Subagenten war erreicht). ⭐ Er hat einen konkreten Anlass: die drei
   Owner-Befunde sind genau so ein **aufgabenübergreifender** Fall — jede der Aufgaben 8, 13 und
   15 ist für sich richtig, und zusammen ergeben sie eine Einbahntür.

## 5. Die Fallen, die dieses Vorhaben schon bezahlt hat

Sie sind der eigentliche Wert dieser Übergabe.

- 🪤 **Vakuum-Zusicherungen sind die häufigste Fehlerquelle hier** — sie haben einen Critical
  verdeckt und drei Runden gekostet. Formen, die aufgetreten sind: `f(x) == f(x)`;
  eine Schleife, deren Fixture einen Zweig nie erreicht; `array_filter(...) === []`, das auch
  bei leerer Eingabe hält; ein `indexOf`-Anker, der woandershin zeigt (**dreimal**).
  ⭐ **Regel:** wenn eine Zusicherung belegt, dass ein Zweig genommen wurde, muss sie am
  **Ergebnis** hängen (Status, `anlass`, der geschriebene Wert) — nie an der blossen Anwesenheit
  eines Schlüssels. Und ein Filter muss die **Differenz** belegen, nicht das Ergebnis.
- 🪤 **Ein Mockup misst die geteilte Regel nicht.** Es ist eine autarke Datei und schreibt sich
  Polsterung und Farben in dieselbe Regel. Zweimal zugeschnappt (Listenzeile, Menüband).
  ⭐ Wo eine echte Hausregel existiert, **gilt sie** — das Mockup ist die Absicht, nicht die Form.
- 🪤 **Eine Zahl im Kommentar liest sich wie eine vollständige Liste**, und niemand zählt nach.
  Zweimal aufgetreten („vier Aufrufer" — es war einer; „dreimal" — es sind vier).
- 🪤 **Ein Quelltexttest darf Kommentare nicht mitlesen.** In dieser Dateifamilie werden
  Funktionsnamen in Prosa mit leeren Klammern geschrieben. `token_get_all` statt Regex.
- 💣 **`avesmapsGaretienEnsureTables` ist MySQL-only** und wirft unter SQLite. Nie in einem Test
  auf einem SQLite-PDO rufen.
- 💣 **Die Zeilennummer beginnt je SEITE neu**, und ein Lauf umfasst mehrere Seiten — bei den
  zwei Gewässerseiten sind **43 von 289** Nummern doppelt vergeben. Jede Adressierung über
  `zeile_nr` braucht `wiki` und `ebene` dazu.
- 💣 **`avesmapsUpdatePathFeatureDetails` ist KEIN Teil-Update** — mit Vorgabewerten gerufen
  löscht es Verkehrsmittel und Saisonfenster.
- 💣 **GeoJSON `[x,y]` gegen Leaflet `[lat,lng]`** — die Hausschreiber für Wege **tauschen**;
  Flächen und Labels nicht.
- 🪤 **Ein Quelltexttest darf Kommentare nicht mitlesen.** Aufgetreten in Aufgabe 11: die Prüfung
  „es gibt genau einen `fetch(`" zählt ungestrippt **4** statt 1, weil die Datei das Wort dreimal
  in ihrer eigenen Prosa erklärt — ausgerechnet in dem Kommentar, der vor einem zweiten Ruf warnt.
- 🪤 **Ein Filter muss die DIFFERENZ belegen, nicht das Ergebnis.** `alleTreffer.forEach(prüfe)`
  ist grün, wenn `alleTreffer` leer ist. Daneben gehört ein `assert(alleTreffer.length > 0)`.
- ⚠️ **Ein Mockup-Element hat oft schon einen Bauer im Haus** — die Fußzeile der Liste zeigte in
  Aufgabe 11 eine ganz andere Kennzahl als das Mockup (`angehakt.*` statt der Aufschlüsselung nach
  Bearbeitungsstand), und beides sah für sich plausibel aus. ⭐ Beim Bauen eines Mockup-Teils die
  **Mockup-Zeile daneben legen**, nicht aus dem Gedächtnis bauen.
- 🪤 **Eine Zahl im Kommentar liest sich wie eine vollständige Liste**, und niemand zählt nach.
  In diesem Vorhaben **viermal** falsch: „vier Aufrufer" (es war einer) · „sieben Arten" (fünf) ·
  „sechs Trichter" (elf — und der Auftraggeber zählte selbst neun, also drei Versuche, drei
  Zahlen) · „drei fehlende Felder" (sechs). ⭐ **Die Antwort ist nicht die richtige Zahl, sondern
  gar keine:** schreib die Zusicherung und wie man sie nachprüft, so wie AGENTS.md §11 es an
  anderer Stelle längst vorschreibt.
- 🪤 **`overflow-wrap: break-word` senkt die min-content-Breite eines FLEX-Kindes nicht** (nur
  `anywhere` und `word-break` tun das), also pinnt `min-width: auto` das Kind. In einem
  Nicht-Flex-Kasten bricht dasselbe Wort einwandfrei — deshalb sieht die Probe richtig aus.
  Gemessen: das Typ-Label stand 159 px außerhalb seines Kastens.
- 🪤 **`hyphens: auto` wirkt in diesem Chrome bei `lang="de"` NICHT** (Höhe mit = ohne, zweimal
  unabhängig gemessen). Wer einen Umbruch damit erklärt, erklärt ihn falsch — meist bricht in
  Wahrheit ein **Mehrwortname am Leerzeichen**.
- 🪤 **Der Größenvergleich live gegen lokal ist auf diesem Rechner WERTLOS**: die Arbeitskopie
  trägt CRLF, der Server LF, jede Datei ist live um **genau ihre Zeilenzahl** kleiner. Das sieht
  aus wie ein abgebrochener Deploy und ist keiner. ⭐ Zeilenendenneutral messen:
  `sed 's/\r$//' datei | md5sum` gegen `curl -s URL | sed 's/\r$//' | md5sum`.
- 🪤 **Der Bericht eines Bauenden kann eine Probe als bestanden ausweisen, die etwas anderes
  misst.** Zweimal aufgetreten: eine Kontrasttabelle aus den **Mockup**-Tokens statt aus
  `tokens.css`, und eine Umbruchprobe an einem Mehrwortnamen, die genau den fallenden Fall als
  geprüft auswies. ⭐ Deshalb rechnet der Prüfer Zahlen **selbst** nach, statt sie zu lesen.
- 🪤 **Ein Scan-Test und die GETRACKTHEIT — beide Richtungen, und die zweite hat hier einen
  Critical gekostet.** Der Abbau-Wächter liest `git ls-files`: eine **ungetrackte** Datei ist für
  ihn unsichtbar, also grün. Nach dem Commit war das Deploy-Tor rot — und ausgerechnet die
  Zusicherung, die beweist, dass das Kartenmodul die Import-Tabellen *nicht* kennt, trug deren
  Namen als **Regex-Literal** und war damit der einzige Verstoß.
  ⭐ **Das Feld NACH dem `git add` fahren, nicht davor.** Und eine solche Nadel zur **Laufzeit**
  bauen (`new RegExp("garetien" + "_import")`), mit dem Grund als Kommentar.
  ⚠️ Die Gegenrichtung gilt weiter: ein Test, der das **Dateisystem** scannt, wird von fremden
  ungetrackten Dateien fälschlich rot.
- 🪤 **Ein Prüfbefehl in einem Kommentar ist eine Behauptung, bis man ihn fährt.** Der Griff zur
  Pane-Inventur (`grep 'style\.zIndex = [0-9]'`) fand die **eigenen zwei** Panes nicht — er sucht
  eine Ziffer, dort steht eine Variable. Wer ihn führe, hielte 360 und 465 für frei und vergäbe
  sie ein zweites Mal. Dieselbe Form wie das Zoombänder-Inventar aus AGENTS.md §11.
- 🪤 **Ein `\b` oder `\n` wird beim Erzeugen leicht zum echten Steuerzeichen** (0x08 bzw. Umbruch).
  Dreimal aufgetreten, zweimal davon beim Auftraggeber selbst. Das Muster trifft dann nie, die
  Zusicherung ist Vakuum, und es sieht völlig normal aus. ⭐ Gegenprobe: `grep -c $'\x08' datei`.
- 🪤 **Ein Prüfbefehl in einem Kommentar ist eine Behauptung, bis man ihn fährt** — **dreimal**
  falsch gewesen: ein Pane-Griff, der die eigenen zwei Panes nicht fand (er suchte eine Ziffer,
  dort stand eine Variable) · eine Ausnahme, die eine Datei herausnahm, die in der Ausgabe gar
  nicht vorkam · und einer, der **sich selbst fand**, weil sein `.*` die Zeichen `.*` im
  zitierenden Kommentar traf. ⭐ Fahren und die Zeilen zählen, bevor man aufschreibt, was er liefert.
- 🪤 **Ein Abnahme-Mock, der Treue behauptet und an der einen kritischen Stelle nachgiebiger ist,
  verschiebt den Fund auf die Live-Sitzung.** Aufgetreten in Aufgabe 16: die Prüfseite trug den
  Kommentar „Wie garetien-liste.php" und filterte dann `apply_state !== "done"` — was es
  serverseitig nicht gibt. Deshalb sah der zweite Durchgang beim Bauenden grün aus.
- 🪤 **Eine reine Hälfte kann vollständig geprüft sein, während die DOM-Hälfte daneben nackt
  ist.** In Aufgabe 16 waren **fünf** Mutationen des Fußknopfs grün — darunter eine, nach der er
  für immer bei „(0)" gesperrt bliebe: das Merkmal tot, das Feld grün. ⭐ Das Mittel dagegen liegt
  im Haus: ein gefälschtes `global.document` **vor** dem `require` (`garetien-karte.test.js`).
- 🪤 **Ein Escape im Werkzeug wird zum Steuerzeichen im Quelltext.** Dreimal aufgetreten: aus
  `\n` wurde ein echter Zeilenumbruch, aus `\b` ein **0x08**, und `"\s*"` in einem
  JS-Stringliteral ist schlicht `"s*"`. Jedes Mal traf das Muster nichts und die Zusicherung war
  Vakuum. ⭐ Gegenprobe: `grep -c $'\x08'` und die Zeilenbilanz.
- ⚠️ **Der Zähler `$pruefungen`** war in **vier von neun** Runden daneben. Immer nachrechnen.
- ⚠️ **Die Browser-Fläche dieser Sitzung liefert keine Bildschirmfotos.** Messen geht trotzdem
  (`getBoundingClientRect`, `getComputedStyle`, echte `PointerEvent`s). Was nicht geht, wird als
  **offener Punkt** gemeldet, nie als bestanden.

---

## 6. Wie hier gearbeitet wird

- **Bauplan lesen, Brief schneiden, Subagent bauen lassen, Review, Fix-Runde, Ledger.** Jede
  Aufgabe hat einen Brief in `.superpowers/sdd/…/task-N-brief.md` und einen Bericht daneben.
- **Jeder Fund wird nachgeprüft, bevor er weitergegeben wird.** In diesem Lauf hat sich das
  jedes Mal gelohnt — und zweimal lag der Reviewer in der *Begründung* daneben, obwohl der Fund
  stimmte.
- **Sichtbare Änderungen gehen EINZELN live**, mit dem Blick des Owners dazwischen
  (AGENTS.md §9). Unsichtbare dürfen gebündelt werden.
- 💣 **Vor jedem Push das ganze Testfeld**, mit dem Muster des Workflows und der **Klammer um
  beide Gruppen**. Gegenprobe: die Dateizahl muss die des Workflows sein (343 JS / 323 PHP).
  Vorbestehend rot: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- 💣 **Nach dem Push den Deploy abwarten**, bevor der nächste kommt — ein zweiter Push bricht
  den ersten ab, und dessen Dateien lädt danach nie jemand. Prüfen lässt es sich mit einem
  `curl` auf eine geänderte Datei.
- 💣 **Geteilter Arbeitsbaum:** nie `git add -A`. Nur die eigenen Pfade, einzeln benannt.
