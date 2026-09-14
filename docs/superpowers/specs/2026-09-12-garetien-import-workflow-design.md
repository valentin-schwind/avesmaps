# Der Import-Workflow des Garetien-Importers — Entwurf

**Stand:** 12.09.2026 · **Mockup:** `docs/garetien-import-workflow-mockup.html` ·
**Befunde:** `docs/superpowers/plans/2026-09-12-garetien-importer-befunde.md` ·
**Übergabe:** `docs/superpowers/plans/2026-09-12-garetien-importer-UEBERGABE.md` ·
**Gebaut:** nichts.

> 🔴 **Dieser Entwurf ist die eine Hälfte.** Die andere liegt in einer Sitzung, auf die diese
> hier keinen Zugriff hat — der Plan `2026-09-09-garetien-fragmente-verbund.md` existiert auf
> keinem Zweig dieses Repos. Vor dem Bauen sind beide zusammenzuführen; das Verfahren steht in
> §0 und §4 der Übergabe.

---

## 0 · Owner-Entscheide vom 12.09.2026

Wörtlich, weil die Formulierung mehrfach schärfer ist als jede Zusammenfassung:

1. **Auf „Offen“ wird nichts eingestellt.** *„bei ‚offen‘ sollten bspw keine einstellungen am
   label vorgenommen werden“*
2. **Eine Handlung, Form schon sichtbar.** Der Weg auf die Stage ist **ein** Knopf; der Vorschlag
   („→ Fläche · Wald“) ist dabei sichtbar, geändert wird er erst auf der Stage.
3. **Die Knöpfe am Fuß der linken Spalte sind redundant** mit denen ganz unten.
4. **Die Stage bleibt eine flache Liste** — „aber sauber“; die Struktur steckt in der rechten
   Spalte, nicht in Gruppierungen der Liste.
5. **Die Merge-Gruppe ist ein Vorschlag, den der Editor bestätigt** — die Teile bleiben einzeln
   sichtbar, nichts passiert ohne Klick.
6. **Die Teile einer Gruppe müssen sich nicht berühren:** *„das können lose flächen sein **aber
   teil einer region**“*
7. **„Nur Quelle“ gehört zum Innerorts-Fall**, und *„bestehende quellen ergänzen gibts auch“*.
   *„neu einfügen soll als option erscheinen wenn innerorts aktiv ist“* — es verschwindet nicht.
8. **Maßstäbe für den vereinigten Plan:** *„wichtig sind fehlerfreiheit, usability und
   einstellungsmöglichkeiten“*

---

## 1 · Die tragende Regel: ein Vorwärtsknopf, ein Schreibknopf

| Station | was man dort tut | was geschrieben wird |
|---|---|---|
| **Offen** | ansehen, vergleichen, auf die Stage legen oder ablehnen | **nichts** |
| **Stage** | Ziel wählen, Name, Art, Beschriftung, Zoomband einstellen; Vorschau auf der Karte | **nichts** |
| **Import** | ein Knopf in der Fußleiste, eine Rückfrage | **alles auf einmal** |

💣 **Daran fällt jeder Einzel-Schreibweg aus der Objektleiste** — zuerst „Innerorts einfügen (X)“.
Heute ist er der **einzige schreibende Knopf des Fensters ohne jede Bestätigung**, steht neutral
gefärbt neben „Auf die Stage“, und zwar schon auf „Offen“, während der Tooltip am Fenster
verspricht: *„Es wird nichts geschrieben, bis du ‚Stage importieren‘ drückst.“* Der Owner-Satz
dazu steht seit dem 05.09.2026 als Kommentar im Code: *„es macht doch keinen sinn, dass sachen
eingefügt werden können, wenn es noch nicht auf der stage liegt.“*

💣 **Und die zwei Häkchen „Neu einfügen“ / „Als Quelle einfügen“ fallen als Häkchen.** Zwei
unabhängige Schalter können sich widersprechen — genau daraus entstand der Schadensfall (§3).
Sie werden Werte **einer** Zielwahl.

---

## 2 · Die Zielwahl

Eine Liste, eine Wahl. Was darin steht, ergibt sich aus den Befunden des Abgleichs:

| Ziel | steht zur Wahl, wenn … |
|---|---|
| **Auf die Karte** | **immer** — auch bei aktivem Innerorts-Befund; es verschwindet nie (Owner 7) |
| **Stätte in „X“** | eine Siedlung im Umkreis liegt |
| **Nur Quelle + Artikel an „X“** | dasselbe — die kleinere Antwort auf denselben Befund |
| **Quelle an das bestehende Objekt ergänzen** | das Objekt deckt sich mit einem, das wir schon haben |
| **Nichts — nur ansehen** | immer |

🔴 **Der Umkreis-Spinner (0–20 Meilen, Vorgabe 5) hängt an der Bauwerksklasse, nicht am Treffer.**
Jedes Bauwerk bekommt die Zeile samt Spinner, auch wenn nichts gefunden wurde — sonst fehlt genau
dann das Feld, mit dem man von 5 auf 12 stellt, wenn man es braucht. Das ist gebaut und bleibt.

⚠️ **Was das gewählte Ziel nicht braucht, wird abgeblendet, nicht ausgeblendet** — sonst springt
die Spalte bei jedem Wechsel und der Editor verliert den Bezug. (Dieselbe Begründung wie im
Innerorts-Entwurf vom 02.09.2026 für den Kasten unter dem Knopf.)

💣 **„Quelle an ein bestehendes Objekt ergänzen“ ist kein neues Datenmodell** — es ist das
vorhandene *Ergänzungs-Item*: `AVESMAPS_GARETIEN_ERGAENZUNG_FELDER = ['quelle']` plus
`AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT = false`. Geometrie und Name bleiben unberührt, der Server
weist alles Weitergehende ab. Es fehlt nichts am Modell, nur die Benennung in der Oberfläche:
heute heißt es „Als Quelle einfügen“ und sagt weder an wen noch an wie viele.

---

## 3 · Der Zusatz-Fall — der Schaden, der wieder offensteht

💣 Bei einem Objekt, das sich mit einem unserer deckt, erzwingt „Neu einfügen“ intern
`quelle = true`. Ein Klick legt die **Dublette** an **und** hängt garetien.de als Quelle an
**unser bestehendes Objekt** — also genau die Aussage, die der Editor mit „trotzdem neu anlegen“
gerade bestreitet. Am Dump gezählt: **334 Objekte** dieser Bauart. Die Rückfrage, die es beim
Auflegen gäbe, fehlt am Häkchen, und **serverseitig gibt es keinen Riegel** — er lebt nur als
Vorbelegung im Browser.

Das ist der Schadensfall vom 30.08.2026, dessen Kommentar im Code den Owner zitiert:
*„hat unsere ganze karte zerstoert“.*

**Die Zielwahl löst ihn, indem sie die drei Fälle ausschließend macht:**

- Quelle an „Natter“ ergänzen — unser Objekt bleibt, wie es ist
- Auf die Karte — ein eigenes neues Objekt, „Natter“ bleibt unberührt
- **Auf die Karte — zusätzlich zu „Natter“** — beides, **mit Rückfrage**, nie als stille Folge

💣 Der Riegel gehört **zusätzlich in den Server**: ein `apply` mit zwei Items desselben Objekts
wird abgewiesen. „Eine Sperre nur im Browser ist keine“ (AGENTS.md).

---

## 4 · Die Merge-Regel

**Erkannt am Namen:** gleicher Stamm, mindestens zwei Teile, **dieselbe Art**, **dieselbe Ebene**.

| Suffix | Beispiel | Stamm |
|---|---|---|
| Zahl | `Silber Hain 1 … 4` | Silber Hain |
| Himmelsrichtung, kurz | `WaldZX O · W · N · S` | WaldZX |
| Himmelsrichtung, zweistellig | `WaldZX NO · SW` | WaldZX |
| ausgeschrieben *(ungemessen)* | `Farindel Nord · Süd` | Farindel |
| beides | `Wald 2 O` | Wald |

🔴 **Berühren müssen sich die Teile nicht** — lose Flächen, **und trotzdem Flächen EINER Region**
(Owner 6). Getrennt liegende Stücke sind der Normalfall; eine Abstandsprüfung würde genau die
Fälle verwerfen, für die die Regel gemacht ist.

🔴 **Was entsteht: eine Region mit N Flächen** — nicht ein verschmolzenes Polygon. Das ist das
Modell, das die Landschaften ohnehin haben (`ecosystem_region` → N `ecosystem_area`), es lässt die
Teile einzeln bearbeitbar und ergibt **eine** Beschriftung statt vier. Der Stamm ohne Suffix ist
zugleich der Name, unter dem der Wiki-Artikel gefunden wird — „Silber Hain 1“ trifft nichts.

💣 **Zusammengelegt wird nur, wo unser Zielmodell einen benannten Behälter mit mehreren
Geometrien kennt — heute ausschließlich `ecosystem_region`.** Das Kriterium ist nachprüfbar und
keine Geschmacksfrage:

| Art | Behälter bei uns | Merge? |
|---|---|---|
| Fläche (See, Wald, Gebirge, Sumpf) | `ecosystem_region` → N Flächen | **ja** — der Fall „Silber Hain 1–4“ |
| Weg / Fluss / Bach | Namensgruppe, implizit über `wpGroupKeyOf` | **nein** — gleichnamige Abschnitte sind schon *ein* Weg |
| Ort / Bauwerk | keiner | **nein** — zwei gleichnamige Dörfer sind zwei Dörfer |
| Gipfel / Bergkette | keiner (ein Label ist ein Punkt) | **nein** — geht nicht: man verlöre eine Position. Für eine Kette ist die richtige Antwort eine **Gebirgsfläche** |

💣 **Verschmolzen wird im PLAN, nicht im Browser.** Der Klick bestellt es; der Server macht daraus
**ein** Objekt mit **einem** Schlüssel, in dem die Quellzeilen aufgeführt sind. Im Client gebaut
zählte der Fußknopf vier und legte eines an, eine Auswahl von gestern wäre nicht mehr auflösbar,
und die Rücknahme versuchte dieselbe Fläche viermal zu löschen.

💣 **Die Rücknahme muss auf der FLÄCHE sitzen, nicht auf der Region.** Heute löscht
„Silber Hain 3 zurücknehmen“ die ganze Region mit allen vier Flächen und allen Labels; die drei
übrigen Items zeigen danach auf eine tote Region. Die Region fällt erst, wenn die letzte Fläche
fällt.

🔴 **Die Voraussetzung, ohne die der Merge nicht sauber baubar ist:** ein Objekt ohne Wiki-Artikel
wird heute über seine **Zeilennummer im Export** identifiziert, und daran hängt `sync_decision`.
Eine Gruppe bekommt zwangsläufig einen neuen, fünften Schlüssel — ohne eine Schlüsselwanderung
verlieren ihre vier Teile alles, was je über sie entschieden wurde. **Das ist der Hauptaufwand
der Merge-Regel, nicht das Zusammenfassen.**

---

## 5 · Liste und Leisten

- **Die Zeile sagt ihr Ziel.** „→ Weg · Bach“, „→ Stätte in ‚Wandleth‘“, „nur Ansicht“ — und auf
  „Offen“, ob sie schon auf der Stage liegt. ⭐ Der Bauer dafür existiert
  (`garetienStageZeile2`) und hat **keinen einzigen Aufrufer** außer dem Test.
- **Suche und der Filter „Objekttyp“ wirken auf der Stage.** Sie sind heute hart gesperrt, und
  die Stage hat keinen Deckel: wer eine Ebene auflegt, sucht in mehreren tausend Zeilen von Hand
  nach dem einen Objekt, das der nächste Klick schreibt.
- **Zwei Leisten, zwei Zuständigkeiten.** Links **nur die Auswahl** (sichtbar, solange etwas
  gewählt ist; jede Kachel trägt die Zahl der gewählten Zeilen). Unten **nur die ganze Stage**
  (leeren, zentrieren, importieren). **Kein Knopf steht in beiden** — „Alle wählen“ wandert als
  Häkchen in den Listenkopf.
- **Ein Ziel gewählt heißt: der Fußknopf zählt es.** Nie wieder „0 von 1“, weil eine Einstellung
  den Weg zum Server nicht findet.

---

## 6 · Was der Entwurf NICHT abdeckt

Er ist der **Workflow-Schnitt**. Von den 82 Befunden deckt er etwa ein Viertel ab. Ausdrücklich
nicht enthalten und je eigene Vorhaben:

- **Der Abgleich** (Median-Deckung · Eckpunkt statt Kante · Berge · gleichnamige Orte · Küste ·
  Linien-Schwelle je Familie) — das ist „Paket 2“ aus dem Stage-Entwurf, nie beauftragt.
- **Die Strecke vor dem Fenster** (halber Lauf wird der geltende · Laufstatus lügt · `plan` ohne
  Zeitlimit).
- **Das Fenster als Fläche** (am Telefon nachweislich unbedienbar, aus drei Gründen).
- **Stufe 5, Territorien** (585 Junkertümer gegen die Baronie-Geometrie) — als einziges Vorhaben
  verändert es **bestehende** Gebiete sichtbar.
- **Der Bestand** (512 übernommene Objekte mit Endkreuzungs-Waisen, Wiki-Schlüssel am falschen
  Träger, ohne Bauwerksart).

---

## 7 · Die zehn offenen Entscheidungen

Ohne 1–4 lässt sich der Plan nicht in Aufgaben schneiden.

1. **Umfang und Reihenfolge.** Vorschlag: (a) Sofortschäden — Telefon, die zwei Schreibwege ohne
   Rückfrage, der Zusatz-Fall; (b) der Workflow-Umbau dieses Entwurfs; (c) der Abgleich;
   (d) Territorien als eigenes Vorhaben.
2. **Wird die Identität stabil?** (Inhalts-Schlüssel statt Zeilennummer, plus Wanderung) —
   Voraussetzung für den Merge.
3. **Was soll das Telefon können** — „nicht kaputt“ (ein CSS-Block) oder „bedienbar“
   (einspaltig, umschaltbar)?
4. **Kommt Stufe 5 hinein?** Vorschlag: nein — aber die risikofreie Hälfte („Knoten + Quelle,
   keine Geometrie“) wäre sofort machbar.
5. **Bleibt „auf die Karte *zusätzlich* zu X“** als ausdrückliche Wahl, oder fällt der Fall ganz?
6. **Berge:** Punkt gegen Punkt messen — oder Bergflächen als eigene Form?
7. **Was wird aus der Küste?** (20 Linien, für die keine Zielform stimmt)
8. **Ab wann heißt „deckt sich“ wirklich deckt sich?** Vorschlag: unter 75 % Deckung
   Zweifelsfall statt stiller Ausgang, mit sichtbarer Quote.
9. **Strömungsrichtung beim Import** offenlassen (129 Flüsse erscheinen im Prüfhaken) oder
   annehmen?
10. **Wird der Bestand nachgezogen?** Reparaturläufe wie bei den bbox-Spalten — oder nur ab jetzt
    richtig?

**Und vier Messungen**, die in dieser Umgebung unmöglich waren: die Suffix-Verteilung · wie viele
gleichnamige Orte jenseits der 0,9-Meilen-Schwelle liegen · wie grob unsere Geometrien gezeichnet
sind · **ein Trockenlauf der Merge-Erkennung, bevor sie scharf wird**.

⭐ Zur letzten: als am 08.09.2026 die Wegquellen verteilt wurden, meldete der Trockenlauf **1070**
statt der erwarteten ~50 — die Differenz war kein Rechenfehler, sondern eine ganze Objektklasse,
die niemand bedacht hatte. Der Trockenlauf ist die Messung, die kein Test leisten kann.

---

## 8 · Abnahmeliste dieses Entwurfs

Die 💣/🔴-Zeilen, einzeln abzuhaken oder ausdrücklich zu verwerfen (AGENTS.md §9):

- [ ] Auf „Offen“ trägt die rechte Spalte **kein bedienbares Feld** (heute: 16)
- [ ] „Innerorts einfügen“ und jeder andere Einzel-Schreibweg sind **gefallen**
- [ ] Die zwei Häkchen sind **eine** Zielwahl, „Auf die Karte“ verschwindet nie
- [ ] „Beides“ ist eine benannte Wahl **mit Rückfrage**, und der Server weist zwei Items
      desselben Objekts ab
- [ ] Die Zeile trägt ihre Ziel-Marke (der Bauer existiert)
- [ ] Suche und Objekttyp-Filter wirken auf der Stage
- [ ] Kein Knopf steht in beiden Leisten; „alle n“ ist ein Häkchen im Listenkopf
- [ ] Ein gewähltes Ziel wird vom Fußknopf **gezählt**
- [ ] Die Merge-Gruppe ist **ein** Vorschlag mit **einem** Klick, verschmolzen wird im Plan
- [ ] Die Rücknahme sitzt auf der **Fläche**; die Region fällt zuletzt
- [ ] Lose Teile sind erlaubt, gehören aber **einer** Region
- [ ] Der Umkreis-Spinner steht auch ohne Treffer da
- [ ] Abgeblendet, nicht ausgeblendet
