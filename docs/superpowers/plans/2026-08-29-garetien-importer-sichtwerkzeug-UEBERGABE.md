# Übergabe: der Garetien Importer wird ein SICHTwerkzeug

**Stand:** 2026-08-29, nachmittags · **Vorgänger:** `docs/superpowers/plans/2026-08-27-garetien-importer-fenster-UEBERGABE.md`
**Auftrag:** `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md`
**Mockup:** `docs/garetien-importer-mockup.html` — 🔴 **überholt**, siehe §2
**Bauplan Tor:** `docs/superpowers/plans/2026-08-29-tor-bach-und-fuenf-ortsarten.md`

---

## 1. 🔴 DER EINE SATZ, UM DEN ES GEHT

Owner, 29.08.2026, nach dem ersten echten Gebrauch:

> **„für mich ist DAS SEHEN das allerwichtigste. der importer soll mir die flächen/orte/punkte
> whatever eindeutig anzeigen."**
>
> **„ich will, dass alles was importiert werden kann angezeigt werden kann"**

Und, nachdem ich ihm dreimal von den Gewässern erzählt hatte, obwohl er dreimal gesagt hatte, dass
sie ihm egal sind:

> **„was hast du mit deinen gewässern? ich importier heute gar nichts, ich baue das tool für die
> editoren. die entscheiden was importiert wird."**

🔴 **Das Fenster wurde als ENTSCHEIDUNGSwerkzeug gebaut (Vorschläge annehmen oder ablehnen). Es
muss ein SICHTwerkzeug sein: alles anzeigen können, unabhängig davon, ob es einen Vorschlag hat,
zu welcher Stufe es gehört oder ob es je importiert wird.** Der Owner benutzt es nicht zum
Importieren — er baut es für seine Editoren.

⚠️ **Und der Vorgänger-Auftrag ist an dieser Stelle überholt.** Er beschreibt eine Liste, die man
„Objekt für Objekt durcharbeitet"; das bleibt richtig für die Editoren, ist aber nicht mehr die
Hauptsache. Wo Auftrag/Mockup und dieser Satz sich widersprechen, gewinnt dieser Satz.

---

## 2. Was der Owner konkret bestellt hat (29.08.2026, wörtlich zerlegt)

| heute | soll werden |
|---|---|
| Reiter **„Vorgemerkt"** = „wird übernommen" | Reiter **„Anzeigen"** = „liegt gerade auf der Karte" |
| 244 Objekte vorangehakt, weil sie `new` sind | **nichts** vorangehakt · Knopf **„Anzeige leeren"** |
| Häkchen in „Offen" → Zeile springt sofort nach „Vorgemerkt" und ist dort nicht mehr abhakbar | **Markieren ändert nichts.** Knopf **„Markierte anzeigen"** → sie kommen ZUSÄTZLICH in „Anzeigen" und **bleiben in „Offen"** („sie sind ja immer noch offen") |
| `„✦ Auf der Karte zeigen — Ansicht folgt"` | **`„✦ Zentrieren"`** — Kamera fliegt hin **und** das Objekt leuchtet |
| Fußknopf „Angehakte übernehmen" | **„Alle angezeigten einfügen"** |
| eine goldene Form, Herkunft unklar | **zwei farbige Knöpfe** — *ihre* / *unsere* Geometrie, jeder schaltet seine Farbe an und aus: „dann kann man direkt vergleichen was besser ist" |
| keine Beschriftung auf der Karte | **Tooltip beim Überfahren**: „dass ich seh welches objekt welchs ist" |

🔴 **Die tragende Regel:** *„Nur angezeigte können übernommen werden (das ist gut am Workflow mit
den Vorgemerkten)."* — Anzeige ist die Vorstufe, nicht der Ersatz.

---

## 3. 💣 DER KONSTRUKTIONSFEHLER, DER DIESEN UMBAU BLOCKIERT

**Die heutige „Vorgemerkt"-Liste hängt an `sync_plan_item.selected` — also an einem VORSCHLAG.**

Von 8213 Objekten haben **7930 gar keinen Vorschlag** (sie gehören zu Stufen 2–4, für die es keine
Typ-Zuordnung gibt). Sie können damit **überhaupt nicht** in diese Liste — kein Umbenennen der
Beschriftung ändert das.

🔴 **Also: die „Anzeige" muss eine EIGENE Menge werden, die das Fenster selbst führt** —
unabhängig von Vorschlägen, Stufen und Typen. Client-seitig, denn:
- es ist ein Arbeitsmittel der Sitzung, kein dauerhafter Zustand;
- eine Server-Tabelle dafür verstieße gegen die Abbau-Regel (Auftrag §5.5: nichts außerhalb
  `api/_internal/import/` darf die Import-Tabellen kennen — eine Anzeige-Tabelle wäre eine weitere);
- die Objekte sind klein und liegen ohnehin schon im Fenster.

⚠️ **Sie muss über Filter- und Reiterwechsel hinweg halten** — also die **Objekte** merken, nicht
nur ihre Schlüssel: der Server liefert je Abruf nur die gefilterte Seite.

⚠️ **Import bleibt an `selected` gebunden.** Der Fußknopf muss deshalb ehrlich sagen, wie viele der
angezeigten überhaupt einen Vorschlag haben: **„Alle angezeigten einfügen (37 von 244)"**.

---

## 4. Was LIVE ist (Stand 29.08., 15:20)

Alles gepusht bis `b45bc5cfa`, jede Datei live gegengemessen.

**Heute repariert — vier echte Fehler, alle vom Owner gemeldet:**

1. 💣 **Ein fehlendes `</div>`** im Skelett der linken Spalte. `.gi-searchrow` ist `display: flex`,
   hat also Chips, Bilanz und die ganze Liste **nebeneinander** gelegt statt untereinander. Live
   gemessen: zwei Kinder statt fünf, die Suchzeile 527 px hoch.
   🪤 **Kein Test sah es:** alle prüfen den Skelett-**Text** (`includes(...)`) oder bauen sich im
   Prüfstand ihr eigenes, wohlgeformtes Markup. Jetzt wird das Skelett **geparst**.
2. 💣 **`widerspricht` gegen `widerspruch`.** Der Abgleich schreibt den Status `widerspricht`,
   Bilanz/Filter/Beschriftung heißen alle `widerspruch`. Ein Objekt **ohne Item** fiel überall
   durch — die Laufzeile zählte 239, die Reiter zusammen 288.
   🪤 Und es gibt **zwei** Stellen, an denen ein Urteil in die Liste eintritt; beim ersten
   Reparaturversuch war nur eine gebunden — genau die falsche.
3. 💣 **Punkte wurden nicht gezeichnet** (`if (punkte.length < 2) return`). Eine Ortschaft ist EIN
   Punkt. In Stufe 1 fällt das nie auf (Gewässer sind Linien und Flächen).
4. 💣 **Das ANGEKLICKTE Objekt wurde nicht gezeichnet** — nur das angehakte. Und ein übersprungenes
   Objekt hat gar kein Häkchen, war also auf **keine Weise** sichtbar. Owner: *„ich seh nur UNSER
   perz, das perz von garetien.de seh ich nicht"*.
   🔴 **Das war ein Fehler des AUFTRAGS, nicht des Baus:** das Mockup §2 sagt wörtlich „Natter —
   das ANGEKLICKTE Objekt: gestrichelt, benannt" und daneben „Alke — angehakt, aber nicht
   angeklickt". Der Brief zu Aufgabe 14 band ihre Geometrie fälschlich ans Häkchen.

**Ebenfalls heute live:** das Fenster ist **ziehbar** (`resize: both`, min 480×360) · **alle 18
Ebenen auf einen Klick** (eine Ebene je Anfrage, damit STRATOs Zeitlimit hält; „leer = alle").

---

## 5. Was ANGEFANGEN und nicht fertig ist

| | |
|---|---|
| **Zwei Farben, Tooltips, „Zentrieren"** | ✅ **FERTIG UND LIVE** (`a23377069`): *ihre* Fassung gold gestrichelt, *unsere* magenta durchgezogen (`--color-garetien-unsere`), beide mit Tooltip, der Knopf heißt „✦ Zentrieren". 🔧 **Ohne Bericht** — der Agent wurde gestoppt, weil eine parallele Sitzung auf die Datei wartete. Seine zwei offenen Entscheidungen stehen im Code und direkt unter dieser Tabelle. |
| **Das Tor: `Bach`** | Aufgabe 1 von 6 **fertig und committet** (`da4f0d0ad`): Schlüssel, Domäne `'none'`, Farbtoken. Aufgaben 2–6 offen, Bauplan steht. |
| **Der Anzeigen-Umbau (§2)** | **nicht angefangen.** Das ist die Hauptarbeit. |

### Die zwei Entscheidungen der Sicht-Arbeit — im Code begründet, hier festgehalten

**(a) Der Schein bleibt — als Hof unter UNSERER Form, in UNSERER Farbe.**
`.gi-map-schein { filter: drop-shadow(0 0 14px var(--color-garetien-unsere)) }`. Eine dünne Linie
auf buntem Grund ist sonst nicht auffindbar; der Hof trägt jetzt die Magenta-Aussage mit, statt
wie früher in Gold gegen die goldene Fremdgeometrie zu stehen.

**(b) `interactive: true` kostet nichts — wegen `pointer-events: stroke`.**
Ohne `interactive` gibt es keinen Tooltip; mit ihm fängt eine gefüllte Fläche die Zeigerereignisse
standardmäßig auf ihrer **ganzen Fläche**. Zwei Folgen, beide gelöst:
- 🔴 Bei einem See liegen ihre und unsere Fläche fast deckungsgleich. Fängt die **Füllung**,
  gewinnt überall die obere — unsere Fassung wäre im ganzen Überlappungsbereich nicht anzeigbar,
  **also genau dort nicht, wo man vergleicht**. Mit `stroke` ist jede der zwei Konturen für sich
  erreichbar.
- ⭐ Und gratis: das Innere eines Sees bleibt für die Karte darunter **anklickbar**. Eine
  Import-Überlagerung darf die Landschaft nicht verschlucken, über der sie liegt.
- 💣 **Die Spezifität ist tragend.** Leaflets eigene Regel
  `.leaflet-pane > svg path.leaflet-interactive` wiegt (0,2,2) und setzt `pointer-events: auto`;
  eine schlichte `.gi-map-ihre`-Regel wiegt (0,1,0) und wäre **wirkungslos** — sichtbar würde das
  erst an einem See, an dem der falsche Tooltip erscheint.

🔧 **Was NICHT abgenommen ist:** der Agent wurde vor seiner Browser-Abnahme gestoppt. Die acht
Fenstertests sind grün und das ganze Feld ebenfalls (361 JS / 327 PHP, nur der bekannte DNS-Rote) —
aber **niemand hat die zwei Farben, die zwei Knöpfe und die Tooltips im Browser wirklich gesehen**,
in hell und dunkel. Das ist der erste Handgriff der nächsten Sitzung.

💣 **Nicht parallel bauen:** Sicht-Arbeit und Anzeigen-Umbau fassen beide
`js/review/review-garetien-importer.js` an. ✅ Die Sicht-Arbeit ist committet und gepusht — die
Datei ist **frei**.

---

## 6. Zum Tor (`Bach` + fünf Ortsarten)

Bauplan: `docs/superpowers/plans/2026-08-29-tor-bach-und-fuenf-ortsarten.md`.

⭐ **Die offene Entwurfsfrage der Spec löst sich auf** — beides war schon gebaut: die Domäne
`'none'` existiert, ergibt eine leere Verkehrsmittelliste, und eine leere Liste ist **maßgeblich**
(`client-graph.php:1721`, „the upper Raller"). Ein Bach ist automatisch **keine** Geländesperre.

💣 **Der Fund, der das Tor gerettet hat:** `avesmapsReadPathSubtype` führt eine **eigene,
unabhängige** Liste erlaubter Wegarten — der serverseitige Schreibriegel, den der Importer als
erstes durchläuft. Ohne `Bach` darin wäre jeder Bach-Import mit einer Ausnahme abgebrochen. Das Tor
hätte fertig ausgesehen und nicht funktioniert.

🔧 **Offen gemeldet:** `client-graph.php` hat eine **dritte** Kopie der Domänen-Abbildung
(`avesmapsClientRouteDomain`) ohne `'Bach'`/`'none'`. Für einen ordentlich angelegten Bach
harmlos (die gespeicherte leere Liste sticht), aber Aufgabe 3 muss ihre Fixture danach bauen.

⚠️ **Der Owner braucht das Tor NICHT dringend.** Es blockiert nur das Übernehmen von Gewässern,
und er importiert nichts. **Die Sicht geht vor.**

---

## 7. Was der Owner NOCH entscheiden muss

Aus dem Vorgängervorhaben, unverändert offen — alle drei sind **derselbe Fall** („wann gilt ein
Objekt als erledigt"):

1. **Die `widerspruch`-Zeile der Knopf-Tabelle ist an echten Daten tot** — ein `widerspricht`-Objekt
   bekommt genau ein Basis-Item ohne `felder`, also haben „Geometrie ersetzen" und „Namen ersetzen"
   kein Ziel. Nur „Ablehnen" ist bedienbar. 3 von 289 in Stufe 1, und sie kommen **vorangehakt**.
2. **Im Reiter „Offen" ist ein Häkchen eine Einbahntür** — ⚠️ **erledigt sich mit dem
   Anzeigen-Umbau**, denn Markieren verschiebt dann nichts mehr.
3. **Der `widerspruch`-Abschnitt trägt „nichts zu ersetzen"** neben „Deckung Median 8,95".

Dazu neu:

4. 🔴 **Die Stufen 2, 3 und 4 sind nicht gebaut.** Die Zuordnung kennt **sechs** Quelltypen (Strom,
   Fluss, Bach, See, Meer, Sumpf) — 283 von 8213 Objekten. Die übrigen **7930** tragen nur eine
   Stufennummer. Rund 50 weitere Quelltypen brauchen je eine Entscheidung, worauf sie abgebildet
   werden und was passiert, wenn wir das Objekt schon haben. **Das ist deutlich größer als das Tor
   und steht in keinem Plan.**

---

## 8. 🔴 DAS ZWEITE, DAS NIE GELAUFEN IST

**Kein Handgriff dieses Imports lief je gegen die echte Datenbank mit angemeldeter Sitzung.**
Alle Abnahmen liefen gegen gemockte Endpunkte. Ungeprüft ist damit vor allem, ob die **Quelle**
(CC BY-NC-SA 3.0, Namensnennung „VolkoV / garetien.de") am übernommenen Objekt wirklich dransteht —
der einzige Punkt mit Rechtsfolge.

---

## 9. Die Fallen (die teuersten zuerst)

- 🪤 **Ein Quelltexttest, der `includes(...)` prüft, findet ein Element auch drei Ebenen zu tief.**
  Genau so blieb das fehlende `</div>` unentdeckt. Wo die STRUKTUR zählt: parsen und zählen.
- 🪤 **Ein Prüfbefehl in einem Kommentar ist eine Behauptung, bis man ihn fährt** — dreimal falsch
  gewesen, zuletzt fand einer **sich selbst** (`.*` traf die Zeichen `.*` im zitierenden Kommentar).
- 🪤 **Ein Quelltexttest darf Kommentare nicht mitlesen.** Mir selbst passiert: die Zusicherung
  „`overflow: hidden` muss bleiben" blieb grün, weil mein eigener Kommentar die Zeichenfolge trug.
- 🪤 **Der Größenvergleich live gegen lokal ist wertlos** — Arbeitskopie CRLF, Server LF, jede Datei
  ist live um genau ihre Zeilenzahl kleiner. Sieht aus wie ein abgebrochener Deploy.
  ⭐ `sed 's/\r$//' datei | md5sum` gegen `curl -s URL | sed 's/\r$//' | md5sum`.
- 🪤 **Eine Zahl im Kommentar liest sich wie eine vollständige Liste** — in diesem Projekt sechsmal
  falsch. Schreib die Zusicherung und wie man sie nachprüft.
- 💣 **Ein Escape im Werkzeug wird zum Steuerzeichen im Quelltext** (`\n` → echter Umbruch, `\b` →
  0x08, `"\s*"` → `"s*"`). Gegenprobe: `grep -c $'\x08'`.
- 💣 **Anführungszeichen:** Hausform ist `„…"` mit **geradem** Schlusszeichen (33 zu 5 gemessen) —
  und in einer doppelt gequoteten JS-Zeichenkette muss es **escaped** werden, sonst endet sie dort.
- 💣 **Vor jedem Push das ganze Feld**, beide Sprachen, mit der **Klammer um beide Gruppen** —
  ohne sie fährt der JS-Lauf 21 von 361 Dateien und meldet „null rot". Dateizahl gegenzählen.
  🪤 **Nach dem `git add`** — der Abbau-Wächter liest `git ls-files`.
- 💣 **Geteilter Arbeitsbaum:** nie `git add -A`. Nie force-pushen.
