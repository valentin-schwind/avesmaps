# Übergabe: das Fenster „Garetien Importer"

**Stand:** 2026-08-28, nach Aufgabe 13 · **Vorgänger-Sitzung:** Bau der Aufgaben 1–13
**Bauplan:** `docs/superpowers/plans/2026-08-27-garetien-importer-fenster.md` — **die Wahrheit**
**Auftrag:** `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md`
**Mappingtabelle:** `docs/superpowers/specs/2026-08-27-garetien-typinventar-und-mapping.md`
**Mockup:** `docs/garetien-importer-mockup.html` — die freigegebene Vorlage
**Ledger:** `.superpowers/sdd/2026-08-27-garetien-importer-fenster/progress.md` (gitignored)

---

## 1. Wo wir stehen

| | |
|---|---|
| **Fertig und LIVE** | Aufgaben 1–13 — die ganze Serverhälfte, die CSS-Extraktion, Knopf, Fensterhülle, Menüband, Liste mit Bilanz und Reitern, Filtertrichter und die **Einzelansicht**. Gepusht bis `2d60f5756` |
| **In Arbeit** | Aufgabe 13b — der Server liefert, was die Einzelansicht zeigen soll (zwei nachgetragene Lücken, siehe §4) |
| **Offen** | Aufgaben 14–16 (Karte · die vier Handlungen · Übernahme) |

**Was live funktioniert:** das Fenster steht und ist bedienbar. Der Knopf „Garetien Importer"
(nur für Admins) öffnet es, das Menüband holt einen Lauf und rechnet, die Liste zeigt ihn mit
Bilanz, Reitern und Filter, und ein Klick auf eine Zeile zeigt rechts **ihr Objekt und unsere
Abschnitte darunter**. Der **vierte Ausgang** („wir haben es, aber sie wissen mehr") ist gebaut.
Es schreibt noch **nichts** — die Handlungen kommen in Aufgabe 15.

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

**Aufgabe 13b — der Server liefert, was die Einzelansicht zeigen soll.** 🔴 **Zwei Lücken,
gemeldet vom Implementierer der Aufgabe 13 und am Code nachgeprüft.** Beide sitzen auf dem
Server, nicht im Fenster — und dass er sie **gemeldet statt im Browser umgangen** hat, ist genau
das Verhalten, das die zweite Wahrheit verhindert, vor der der Auftrag §5.5 warnt.

1. **Ein getroffener Abschnitt OHNE Item erreicht den Browser nie.** `objekte[].abschnitte` wird
   allein aus `items` gebaut. Das trifft **den Owner-Fall**: ihre „Natter" läuft über unsere
   Natter, den **Gardel** und den Darpat — der Gardel erzeugt konstruktionsbedingt kein Item und
   fehlt. Ein dreiteiliger Fall sieht damit zweiteilig aus, und der `is-full`-Zustand aus
   Aufgabe 13 ist gebaut, getestet und **tot**. Die volle Trefferliste existiert beim Planbau
   (`$urteil['abschnitte']`) und wird verworfen ⇒ neue Spalte `abschnitte_json MEDIUMTEXT`.
2. **Sechs Felder des Mockups reisen nicht mit** — darunter der ganze Abschnitt „Die Quelle, die
   mitreist", der Subtyp („Fluss → Flussweg") und der Deckungsgrad.

**Danach:** Aufgabe 14 (Karte: Glow und „Ansicht folgt") · 15 (die vier Handlungen) · 16
(„Angehakte übernehmen" durch das vorhandene Blatt).

🔧 **In Aufgabe 15 fällt zusätzlich die Reparatur aus Ruling R10 an** — der Server-Einzeiler,
ohne den der Reiter „Abgelehnt" für immer leer bleibt. Er steht mit Begründung und Messung im
Bauplan; die **Leseseite ist schon fertig und richtig**.

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
