# Entwurf: der Garetien Importer als SICHTwerkzeug

**Stand:** 2026-08-29 · **Übergabe:** `docs/superpowers/plans/2026-08-29-garetien-importer-sichtwerkzeug-UEBERGABE.md`
**Auftrag (gilt weiter):** `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md` — insbesondere **§5.5 Abbau-Bedingung**
**Mockup:** `docs/garetien-importer-mockup.html` — ⚠️ an der **Interaktion** überholt, an der **Darstellung** gültig

---

## 1. 🔴 Der Satz, um den es geht

Owner, 29.08.2026, wörtlich:

> „für mich ist DAS SEHEN das wichtigste. der importer soll mir die flächen/orte/punkte whatever
> eindeutig anzeigen, sodass man sieht, was man importiert oder ablehnt."
>
> „ich will, dass alles was importiert werden kann angezeigt werden kann"
>
> „ich baue das tool für die editoren."

Und der Fall, an dem er es festmacht:

> „Krähensee gibt es im import als auch bei uns. er will beide sehen, um zu entscheiden, ob der
> See behalten oder ersetzt werden soll."

🔴 **Das Fenster wurde als ENTSCHEIDUNGSwerkzeug gebaut. Es wird ein SICHTwerkzeug ZUR
Entscheidungsfindung.** Anzeigen ist die Hauptsache; Übernehmen ist der seltene Schluss.

⚠️ **Gewässer, Stufen und das Tor sind hier KEIN Thema.** Der Owner hat dreimal gesagt, dass sie
ihm egal sind; die Gewässer importieren später die Editoren. Wer das wieder aufmacht, arbeitet an
seinem eigenen Thema.

---

## 2. Was neu ist gegenüber der Übergabe

Die Übergabe §2 zerlegt den Umbau der **Bedienung**. Dieser Entwurf ergänzt, was der Owner am
selben Tag über die **Darstellung** gesagt hat — und das steht sonst nirgends:

> „Die aktuelle Beschreibung, was bei uns an derselben Stelle liegt, der Grund und die Quelle, die
> mitreist sind genau diese Entscheidungsmerkmale, die gewünscht sind."

✅ **Die Einzelansicht ist damit richtig und wird nicht angefasst.** Sie ist die abgenommene
Entscheidungsgrundlage. Was fehlt, ist ihre Entsprechung **auf der Karte**.

> „WIchtig ist die farbliche Ergänzung und unterscheidung bei uns auf der karte. Ideal wär wenn der
> import das eigentliche objekt bereits anzeigt (farblich und von der größe aber gelb leuchtend)
> und ‚so tut', als sei es auf der Karte. Kollisionen (oder Ergänzungsfragen) mit bestehenden
> können durch rotes glühen ergänzt werden."

Daraus die drei Regeln in §4.

---

## 3. Die Anzeige-Menge — und warum sie dem Fenster gehört

💣 **Der Konstruktionsfehler (Übergabe §3):** die heutige Liste hängt an `sync_plan_item.selected`.
Von 8213 Objekten haben **7930 gar keinen Vorschlag** — sie können nie ein Häkchen tragen und damit
nie auf die Karte. Gemessen im Code: `avesmapsGaretienAufDerKarte()` filtert auf
`avesmapsGaretienHatAuswahl`, und ein Objekt ohne Item hat `items: []`.

🔴 **Also führt das Fenster eine EIGENE Menge** — client-seitig, unabhängig von Vorschlag, Stufe
und Typ:

- es ist ein Arbeitsmittel der Sitzung, kein dauerhafter Zustand;
- eine Server-Tabelle dafür verstieße gegen die Abbau-Regel (Auftrag §5.5) — sie wäre eine dritte
  Import-Tabelle, die jemand später finden und abbauen müsste;
- die Objekte liegen ohnehin schon im Fenster.

⚠️ **Gemerkt wird das OBJEKT, nicht sein Schlüssel.** Der Server liefert je Abruf nur die
gefilterte Seite; ein Schlüssel ohne Objekt wäre nach dem nächsten Filterwechsel nicht mehr
auflösbar, und die Karte verlöre genau das, was der Editor gerade zusammengetragen hat.

### 3.1 Die vier Reiter

| Reiter | Quelle | |
|---|---|---|
| **Offen** | Server (`stand`) | was noch zu tun ist |
| **Anzeigen** | **Client** (die Menge) | was gerade auf der Karte liegt |
| **Abgelehnt** | Server (`stand`) | |
| **Übernommen** | Server (`stand`) | |

🔴 **Der Reiter „Anzeigen" filtert NICHT.** Er ist die Antwort auf „was liegt gerade auf der
Karte" — ein Filter dort ließe Liste und Karte auseinanderlaufen, und das ist das eine, was dieses
Werkzeug nie tun darf. Die Filterleiste bleibt sichtbar, wirkt aber erkennbar nur auf die drei
Server-Reiter.

### 3.2 Das Häkchen wird ein MARKER

💣 Heute schreibt jeder Häkchenklick `selected` auf den Server, `stand` wird daraus abgeleitet
(`avesmapsGaretienListeObjektStand`: irgendein `selected` ⇒ `vorgemerkt`) — die Zeile **springt**
aus „Offen" heraus und ist dort nicht mehr abhakbar. Owner: **„Markieren ändert nichts."**

🔴 **Neue Regel:** das Häkchen ist eine client-seitige Markierung. Es schreibt nichts, es verschiebt
nichts. Sein einziger Zweck ist der Knopf **„Markierte anzeigen"**.

⭐ Damit erledigt sich die offene Owner-Frage 2 der Übergabe §7 („im Reiter Offen ist ein Häkchen
eine Einbahntür") von selbst — genau wie dort vorhergesagt.

⚠️ **`vorgemerkt` fällt aus der `stand`-Leiter**, sonst springt die Zeile weiterhin. Die Zahl bleibt
in der Fußzeile („14 vorgemerkt · 3 abgelehnt · 0 übernommen") — sie ist weiter wahr, sie ist nur
kein Reiter mehr.

### 3.3 Die drei Knöpfe

| Knopf | tut |
|---|---|
| **Markierte anzeigen** | legt die markierten Zeilen ZUSÄTZLICH in die Anzeige — sie **bleiben in „Offen"** („sie sind ja immer noch offen") |
| **Anzeige leeren** | leert die Menge; die Karte wird leer |
| **Alle angezeigten einfügen (n von m)** | der einzige Schreibweg |

🔴 **„Nur angezeigte können übernommen werden"** (Owner) — Anzeige ist die Vorstufe, nicht der
Ersatz. ⚠️ Und der Fußknopf sagt **ehrlich**, wie viele der Angezeigten überhaupt einen Vorschlag
haben: „Alle angezeigten einfügen (37 von 244)". 7930 Objekte haben keinen; ein Knopf, der „244
einfügen" verspricht und 37 einfügt, ist eine Falschaussage über die nächste Handlung.

🔴 **Die Anzeige startet LEER.** Heute stehen 244 Objekte vorangehakt da, weil sie `new` sind —
der Owner öffnete das Fenster und hatte 244 Dinge „drin", ohne etwas getan zu haben.

---

## 4. Die Darstellung auf der Karte

### 4.1 🔴 Das Objekt tut so, als läge es schon auf der Karte

> „Ideal wär wenn der import das eigentliche objekt bereits anzeigt (farblich und von der größe
> aber gelb leuchtend) und ‚so tut', als sei es auf der Karte."

Heute wird **alles** als gestrichelte goldene Linie mit Breite 3 gezeichnet — ein See sieht aus wie
ein Fluss, eine Ortschaft wie ein Ring. Das beantwortet die Frage „sieht das bei uns richtig aus?"
nicht.

🔴 **Neu: Form, Farbe und Größe kommen aus der ART des Objekts**, das Leuchten sagt, wem es gehört.

⚠️ **Und die Auskunft ist zweistufig, weil die Datenlage es ist** — live gemessen 29.08.2026:

| | `geometrie_typ` | `subtyp` | ihr `typ` | Geometrie |
|---|---|---|---|---|
| **283** Objekte mit Vorschlag | ✅ | ✅ | ✅ | ✅ |
| **7930** ohne Vorschlag | leer | leer | ✅ | ✅ |

Beide leeren Felder stammen aus `after`, das es ohne Vorschlag nicht gibt
(`api/_internal/import/garetien-liste.php`, Zweig 5). `geo_art` hilft nicht — es unterscheidet nur
`koordinaten` von `verweise`.

🔴 **Die Ordnung (eine Ordnung, keine Auswahl — dieselbe Bauform wie die Art-Regel der Landschaft,
AGENTS.md §11):**

1. **`geometrie_typ` gewinnt**, wenn es da ist. Es ist die Auskunft des Erzeugers über sich selbst.
2. **Sonst entscheidet eine SICHT-TAFEL über ihren `typ`** — Form, Farbtoken, Strichbreite.
3. **Unbekannter Typ ⇒ neutral** (Linie, Gold, Breite 3 — das heutige Bild). Nie ein Fehler, nie
   eine Ausnahme.

💣 **Die Tafel ist DATEN, kein `if` im Zeichner** — dieselbe Bauform wie
`AVESMAPS_GARETIEN_URTEIL_ZEILE`. Rund 50 Quelltypen sind noch nicht zugeordnet (Übergabe §7.4);
eine Tafel wächst um eine Zeile, eine `if`-Kette um einen Zweig.

⭐ **Und der Rückfall wird GEMELDET, nicht verschwiegen** — die Bilanzzeile nennt, wie viele
Objekte neutral gezeichnet wurden und welche Typen dafür verantwortlich sind
(„8 neutral · Typ ‚Binge', ‚Warte' unbekannt"). Ein stiller Rückfall sähe aus wie „so sieht das
Objekt eben aus"; genannt ist er die Arbeitsliste für die Sicht-Tafel. Das ist die Regel
„ein Prüfhaken zeigt seine Funde".

### 4.2 🔴 Das Leuchten sagt, WEM es gehört

| | gezeichnet als | Leuchten |
|---|---|---|
| **ihr** Objekt (garetien.de / koschwiki.de) | seine echte Kartenform | **gold** — `--color-marker-active` |
| **unser** Objekt an derselben Stelle | seine echte Kartenform | **magenta** — `--color-garetien-unsere` |
| **Kollision / Ergänzungsfrage** | — | **rot** zusätzlich — `--color-garetien-kollision` |

💣 **Das Leuchten ist IMMER ein Strich, auch unter einer Fläche.** Eine zu 55 % gefüllte Fläche
überdeckte den See darunter vollständig — man sähe die Hervorhebung, aber nicht mehr, was
hervorgehoben ist. (Diese Regel steht schon im Code und bleibt.)

⚠️ **Rot ist eine ERGÄNZUNG, kein Ersatz** (Owner: „können durch rotes glühen ergänzt werden") —
es liegt als zweiter, weiterer Hof außen um das gold- bzw. magentafarbene Leuchten. Wer es statt
der Herkunftsfarbe zeichnete, nähme dem Bild genau die Auskunft, um die es geht.

🔴 **Wann rot:** `urteil` ∈ `widerspruch` · `zweifel` · `ergaenzung` — also genau dann, wenn bei uns
etwas an derselben Stelle liegt und eine Frage offen ist. **Nicht** bei `neu` (da liegt nichts),
**nicht** bei `deckt_sich` (da ist nichts zu entscheiden).

### 4.3 Die zwei Knöpfe

> „mach zwei farbige knöpfe und jeder der knöpfe zeigt in seiner farbe seine fläche an oder blendet
> sie aus. Dann kann man direkt vergleichen was besser ist"

Zwei Umschalter im Menüband — **Ihre Geometrie** (gold) und **Unsere Geometrie** (magenta), jeder
mit seinem Farbtupfer. Beide starten **an**.

🔴 **Der Zustand sind zwei Wahrheitswerte und sonst nichts** — kein `is-open` an einem Knopf, aus
dem später eine zweite Buchführung wird. An genau dem sind das Anzeige-Menü der Karte und die
Ansichts-Kacheln schon gescheitert (AGENTS.md §11).

### 4.4 Der Tooltip

> „dass ich seh welches objekt welchs ist"

Überfahren zeigt den Namen und die Herkunft: `Krähensee — garetien.de` bzw. `Krähensee — bei uns`.

💣 **Er kollidiert mit einer bestehenden 🔴-Regel.** Beide Panes stehen auf
`pane.style.pointerEvents = "none"` — „die Zeichnung ist eine AUSKUNFT, kein Bedienelement: sie
darf weder Klicks auf unsere Wege noch das Ziehen der Karte schlucken."

⭐ **Auflösung ohne die Regel zu brechen:** die **Pane bleibt** auf `none`; nur die einzelnen
Strich-Ebenen bekommen `interactive: true`. Leaflet hängt ihnen `.leaflet-interactive` an, und
`css/third-party/leaflet.css:254` setzt darauf `pointer-events: auto` — ein Nachfahre darf
`pointer-events` zurückholen, auch wenn ein Vorfahr `none` sagt. Alles andere in der Pane bleibt
durchklickbar.

💣 **Die Schein-Ebenen bleiben inert.** Sie sind breiter als der Strich (13 gegen 3) und lägen sonst
als unsichtbarer 13-px-Streifen über unseren Wegen.

💣 **Eine Fläche wird für den Tooltip in Füllung und Kante GETRENNT gezeichnet** — Füllung inert,
Kante interaktiv. Sonst schluckt eine einzige angezeigte Seefläche jeden Klick in ihrem ganzen
Inneren, und der Editor kommt an die Objekte darunter nicht mehr heran. ⚠️ `bubblingMouseEvents`
steht bei Leaflet ohnehin auf `true`, ein Klick erreicht die Karte also weiterhin — aber nicht mehr
die Ebene **darunter**, und genau die will man hier anfassen.

⚠️ **Im Browser gegenzumessen, nicht zu glauben:** dass ein Klick auf unseren Weg unter einer
angezeigten Fläche weiterhin ankommt.

---

## 5. Was NICHT gebaut wird

- 🔴 **Keine Server-Tabelle für die Anzeige** — Auftrag §5.5.
- 🔴 **Kein Löschweg** — Auftrag §5.5, unverändert.
- 🔴 **Die Einzelansicht wird nicht umgebaut.** Der Owner hat sie ausdrücklich als richtig benannt
  (§2).
- 🔴 **Der Abgleich, die Zuordnung und die Übernahme werden nicht angefasst.** Dieses Vorhaben
  ändert, was man SIEHT, nicht was beim Einfügen passiert.
- ⚠️ **Die Stufen 2–4 bleiben offen** (Übergabe §7.4). Die Sicht-Tafel zeigt ihre Objekte, die
  Übernahme kann sie weiterhin nicht anfassen — und der Fußknopf sagt genau das mit seinem
  „n von m".

---

## 6. 🔧 Was der Owner entscheidet, nicht wir

Unverändert aus der Übergabe §7 und §8:

1. Die `widerspruch`-Zeile der Knopf-Tabelle ist an echten Daten tot.
2. ~~Das Häkchen als Einbahntür~~ — ✅ erledigt sich mit §3.2.
3. Der `widerspruch`-Abschnitt trägt „nichts zu ersetzen" neben „Deckung Median 8,95".
4. Die Stufen 2, 3 und 4 sind nicht gebaut — rund 50 Quelltypen brauchen je eine Entscheidung.
5. 🔴 **Der Ablauf mit angemeldeter Sitzung ist nie gelaufen** — ungeprüft ist damit, ob die Quelle
   (CC BY-NC-SA 3.0, „VolkoV / garetien.de") am übernommenen Objekt wirklich dransteht. **Der
   einzige Punkt mit Rechtsfolge.**
