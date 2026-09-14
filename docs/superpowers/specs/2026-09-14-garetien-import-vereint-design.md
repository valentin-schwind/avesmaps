# Garetien-Importer: Verbund und Workflow in einem Plan — Entwurf

**Stand:** 14.09.2026 · **Mockup:** `docs/garetien-import-vereint-mockup.html` ·
**Bauplan:** `docs/superpowers/plans/2026-09-14-garetien-import-vereint.md` ·
**Zweig:** `garetien-fragmente-verbund` · **Gebaut:** nichts (die zehn Aufgaben des Verbund-Plans
liegen gebaut auf dem Zweig; dieser Entwurf baut auf ihnen auf und korrigiert sie)

**Die zwei Hälften, aus denen dieser Entwurf entsteht:**

| Name hier | Sitzung | Dokumente | Zustand |
|---|---|---|---|
| **Verbund** | 09.09.2026, lokal | `specs/2026-09-09-garetien-fragmente-verbund-design.md` · `plans/2026-09-09-garetien-fragmente-verbund.md` · `docs/garetien-fragmente-mockup.html` | Aufgaben 1–10 von 11 gebaut, auf diesem Zweig |
| **Workflow** | 12.09.2026, Cloud | `specs/2026-09-12-garetien-import-workflow-design.md` · `plans/2026-09-12-garetien-importer-befunde.md` (82 Befunde) · `plans/2026-09-12-garetien-importer-UEBERGABE.md` · `docs/garetien-import-workflow-mockup.html` | nichts gebaut |

> ⚠️ **„A" bis „G" bezeichnen in diesem Entwurf ausschließlich die Blöcke der Einzelansicht.** Die
> zwei Hälften heißen „Verbund" und „Workflow" — sonst liest sich „Block B" wie „der Stand B".

---

## 0 · Owner-Entscheide

Wörtlich, soweit sie wörtlich vorliegen. Ältere gelten weiter, wo kein jüngerer ihnen widerspricht.

**31.08.2026** — *„es gibt neu oder nix — kein verändern, kein ersetzen"* (Ergänzungen tragen nur
eine Quelle, `AVESMAPS_GARETIEN_ERSETZEN_ERLAUBT = false`).

**06.09.2026** (Stage-Entwurf) — Stage-Semantik: Klick ist Vorschau, „Auf die Stage" macht fest ·
Stätte und „Nur Quelle + Artikel" sind **Formen** · Endkreuzungen bleiben an.

**09.09.2026** (Verbund)
1. **Vorschlag + Bestätigung.** „Holen & Rechnen" erkennt die Verbünde; zusammengelegt wird **auf
   der Stage, per Klick**, nie automatisch beim Rechnen.
2. **Gemischte Verbünde:** nur die erzeugenden Fragmente werden ein Objekt; ein `deckt_sich`-Fragment
   bleibt eine Quelle am vorhandenen Objekt.
3. **Ein Klick, Name danach änderbar.** Das Zusammenlegen macht sofort ein Objekt mit dem
   Stammnamen, korrigiert wird im Namensfeld. Kein Bestätigungsfenster.
4. **Ein Objekt, N Flächen** — keine Geometrie-Vereinigung.
5. **Solange ein Objekt „offen" ist, bleiben Darstellung sowie Wiki & Quellen ausgeblendet.**
   *„die sind alle auf der stage erst wichtig"*
6. **Mehr Struktur:** benannte Blöcke — und *„bleiben — mach sie nur einheitlich"*: die Buchstaben
   bleiben und müssen fluchten.

**12.09.2026** (Workflow)
1. *„bei ‚offen' sollten bspw keine einstellungen am label vorgenommen werden"*
2. **Eine Handlung, Form schon sichtbar.** Der Weg auf die Stage ist **ein** Knopf; der Vorschlag ist
   sichtbar, geändert wird er erst auf der Stage.
3. **Die Knöpfe am Fuß der linken Spalte sind redundant** mit denen ganz unten.
4. **Die Stage bleibt eine flache Liste** — „aber sauber"; die Struktur steckt in der rechten Spalte.
5. **Die Merge-Gruppe ist ein Vorschlag, den der Editor bestätigt** — die Teile bleiben einzeln sichtbar.
6. *„das können lose flächen sein **aber teil einer region**"*
7. **„Nur Quelle" gehört zum Innerorts-Fall**, *„bestehende quellen ergänzen gibts auch"*,
   *„neu einfügen soll als option erscheinen wenn innerorts aktiv ist"*.
8. **Maßstäbe:** *„wichtig sind fehlerfreiheit, usability und einstellungsmöglichkeiten"*

**14.09.2026** — Widersprüche zwischen den Hälften werden **nach dem Verfahren der Übergabe §4
entschieden, nicht per Rückfrage** (*„genau deswegen den plan"*); GO für Entwurf, Mockup, Bauplan.

---

## 1 · Wie die Widersprüche entschieden wurden

Verfahren der Übergabe §4: **(a)** was beide sagen, ist belastbar · **(b)** was nur eine Hälfte hat,
gehört hinein · **(c)** ein Widerspruch wird **am Code nachgemessen**, und wo der Code nichts
entscheidet, entscheiden die drei Maßstäbe vom 12.09.

Gemessen am 14.09.2026 von zwei Prüfläufen, die die echten Funktionen **ausgeführt** haben (Client unter
Node mit gefälschtem DOM, Server auf der SQLite-Fixture der Verbund-Tests), gegen `origin/master`
(`2dc620041`) und den Zweig (`df8d9ec4c`). 🔴 **Nichts davon lief gegen die echte Datenbank oder in
einem Browser.** Außerdem: Probe-Merge Zweig → master konfliktfrei, ganzes Testfeld auf dem
zusammengeführten Stand grün (553 JS, 411 PHP; rot nur der vorbestehende DNS-Test und ein
CRLF-Artefakt der Arbeitskopie).

### (a) Gemeinsam — nicht mehr nachmessen

- Zusammengelegt wird nur auf Klick, und der Klick gehört **auf die Stage** (Verbund-Owner 1,
  Workflow-Owner 5 und beide Entwürfe).
- Ergebnis ist **eine Region mit N Flächen**, keine Vereinigung; die Teile dürfen weit auseinander
  liegen (Verbund gemessen: **0 von 174** Fragmentpaaren berühren sich).
- Zurückgenommen wird **je Fläche**, die Region fällt mit der letzten.
- Orte und Berggipfel bilden **nie** einen Verbund.
- Der Stamm ist der Name, unter dem der Wiki-Artikel gefunden wird.
- Auf „Offen" gehören **keine Einstellungen** hin.

### (b) Ergänzungen

- **Nur im Verbund:** die Messung am Dump vom 08.09. (41 Verbünde, 115 Zeilen, 74 Objekte weniger;
  22 Flächen-, 19 Wege-Verbünde) · die live vorkommenden Marken (`1a`, `Reichsforst1`, `I–XV`, `(2)`,
  `Mitte`) · *ein Fragment ohne Marke gehört dazu* (20 von 22 Wege-Verbünden) · die drei Felder, die
  an der Region hängen (`is_locked`, `curve_label`, `curve_label_max`) · der Vermerk `verbund:<stamm>`
  in `apply_note` · die Gliederung A–G.
  ⭐ Damit ist die erste der vier Messungen erledigt, die dem Workflow fehlten (die Suffix-Verteilung).
- **Nur im Workflow:** die Zielwahl · der Zusatz-Fall (334 Objekte) samt Server-Riegel · der Wegfall
  von „Innerorts einfügen" · die Ziel-Marke in der Zeile · Suche und Filter auf der Stage · die
  Aufteilung der Leisten · rund 60 Befunde außerhalb des Zusammenlegens (§8).

### (c) Widersprüche — Messung und Entscheidung

| # | Frage | Verbund | Workflow | gemessen | es gilt |
|---|---|---|---|---|---|
| 1 | Braucht ein Verbund einen neuen Schlüssel? | nein, vier Schlüssel | ja, „Hauptaufwand" | Zweig arbeitet lauffähig mit vier Schlüsseln und vier `sync_decision`-Zeilen (S1) | **Verbund.** Der „Hauptaufwand" folgt nur aus der Designwahl „ein Objekt, ein Schlüssel" |
| 2 | Wo liegt die Entscheidung „zusammengelegt"? | Client | „im Plan, nicht im Browser" | ein loses `Set` im Modul, am Namen: überlebt „Stage leeren" und neue Läufe, verschmilzt später **einzeln** aufgelegte Fragmente still, ist nach F5 weg (K1) | **Workflow** im Ergebnis — §6.4 |
| 3 | Form und Art auf „Offen" änderbar? | ja | nur Vorschlag | im Zweig beide aktiv, dazu `garetienEingabenAendern` ohne Stage-Riegel (K2) | **Workflow** (jüngerer Owner-Entscheid 2, Fehlerfreiheit) |
| 4 | Zwei Häkchen oder eine Zielwahl? | zwei | eine | „Neu einfügen" schaltet `quelle` zwangsweise mit an — Dublette **und** Quelle am Bestand (master und Zweig gleich); im Zweig greift es zusätzlich auf ein `deckt_sich`-Geschwister über (K6) | **Workflow** (Fehlerfreiheit) |
| 5 | Liste flach? | Marke in der Zeile, Fragmente rechts | flach, aber mit eigener Vorschlagszeile in der Liste | Zweig: Offen und Stage flach mit Marke, nur „Übernommen" gefaltet (K3) | **Verbund** — erfüllt Workflow-Owner 4 besser als das Workflow-Mockup selbst |
| 6 | „Alkenstieg" + „Alkenstieg 2" ein Weg? | ja, per Name = Stamm | nein, „gleichnamige Abschnitte sind schon einer" | nicht gleichnamig: `wpGroupKeyOf` ergibt zwei Gruppen; der Import setzt kein `wiki_path` (S2) | **Verbund** — aber die Umbenennung ist **nicht gebaut** (§6.6) |
| 7 | Suche und Filter auf der Stage | gesperrt | wirksam | im Zweig gesperrt (`garetienStageFilterSperreSetzen`) | **Workflow** (Usability) |
| 8 | Wo steht der Verbund-Knopf? | Mockup: „Verbund auf die Stage" auf **Offen**; Entwurf: auf der Stage | „Zusammenfassen" auf der Stage | Zweig: auf Offen, und er legt auf **und** verschmilzt in einem Klick | **beide Entwürfe** — der Bau weicht von beiden ab (§6.3) |
| 9 | Hängt der Verbund an der Wortanfang-Regel? | — | „rettet die Merge-Gruppe" | die Erkennung ruft sie nicht; die Regel rettet nur „Silber Hain 1" gegen **unser** stammbenanntes „Silber Hain" im Abgleich (S5) | **keiner ganz** — sie darf verengt werden, wenn der Abgleich dafür den Stamm vergleicht (gehört zum Abgleich-Vorhaben, §8) |

### Fehler im gebauten Zweig, die keiner der beiden Entwürfe kannte

Gemessen, jeder mit Fundstelle im Bauplan:

1. **Der Name wird nie auf den Stamm gesetzt** — Verbund-Entwurf §0.3, §3 und §6 sagen es zu. Die
   Region heißt „Silker Hain 1", die Wiki-Suche fragt `silkerhain1`, Wege bleiben zwei Gruppen.
2. **„Süd" wird nicht erkannt** — `strtoupper('Süd')` ergibt `SüD`, die Liste führt `SÜD`.
3. **Ein Einzelbuchstabe gilt als Marke** — „Pfad A" + „Pfad B" werden ein Verbund; Verbund-Entwurf §3
   schließt genau das aus.
4. **`verbund_n` zählt nur nach Stamm**, gruppiert aber nach Ebene + Typ + Stamm.
5. **Ein `deckt_sich`-Fragment wird Mitglied** — der Urteil-Filter der Erkennung ist an der echten
   Aufrufstelle tot (der SELECT des Planbaus liest `urteil` nicht; im Ledger vermerkt). Verstößt
   gegen Verbund-Owner 2.
6. **Das zuerst berührte Fragment bestimmt die Form für alle.** Ist es klein genug für einen
   Berggipfel, schickt der ganze Verbund `ziel: label` — und es entsteht gar kein Verbund.
7. **Scheitert der Anführer beim Anlegen**, bleiben Beschriftung und eine leere Region als Waise; die
   übrigen Fragmente legen eine **zweite** Region an. Nichts davon ist zurücknehmbar.
8. **Die Faltung auf „Übernommen" verschwindet** nach jedem „Holen & Rechnen" (liest nur den
   aktuellen Lauf).
9. **Die Garetien-Quelle einer zurückgenommenen NEUEN Fläche wird nie gelöst** — sie bleibt an der
   deaktivierten Region stehen. 🪤 Die Workflow-Befundliste las den Quellen-Zweig
   (`avesmapsGaretienQuelleRuecknahmeLoesen`, „löst alle Verknüpfungen der Entität"); der hat aber nur einen
   Aufrufer, den Zweig für Ergänzungs-Items. Beim Bau der Aufgabe 3 am Code nachgemessen (master und Zweig).
   Mit dem Verbund wird die Zusage nötig, die es nie gab: die Quelle fällt mit der **letzten** Fläche.
10. **Die Verbund-Einstellungen überleben** „Stage leeren", neue Läufe und „Verbund auflösen"; die
    sechs `…Vergessen`-Funktionen haben keinen Aufrufer.

---

## 2 · Die tragende Regel: entscheiden, einstellen, schreiben

| Reiter | was man dort tut | was geschrieben wird |
|---|---|---|
| **Offen** | ansehen, vergleichen — **mitnehmen oder ablehnen** | nichts |
| **Stage** | Ziel wählen, Name, Form, Art, Darstellung, Wiki; zusammenlegen | nichts |
| **Import** | **ein** Knopf in der Fußleiste, eine Rückfrage | alles auf einmal |

💣 **Daran fällt jeder Einzel-Schreibweg** — zuerst „Innerorts einfügen (X)": der einzige
schreibende Knopf ohne Rückfrage, schon auf „Offen", neben einem Tooltip, der verspricht, dass
nichts geschrieben wird, bis „Stage importieren" gedrückt ist (K7). Was er konnte, kann die Zielwahl.

💣 **Die zwei Häkchen fallen als Häkchen** und werden Werte **einer** Zielwahl (§5).

🔴 **Ablehnen** bleibt auf beiden Reitern: es ist keine Einstellung, sondern die zweite Antwort auf
„mitnehmen?".

---

## 3 · Die Einzelansicht: sieben Blöcke

🔴 Die Buchstaben bleiben und **fluchten** (Owner 09.09.). Gruppiert wird über Überschrift und
Trennlinie, nie über Rahmen (AGENTS.md §12). `.gi-block.gi-acts` nimmt das Eigenpolster von
`.gi-acts` zurück, sonst rückt F um 14 px ein.

| Block | Titel | Offen | Stage | Übernommen |
|---|---|---|---|---|
| **A** | Auf der Karte | ✦ Zentrieren · Garetien/Avesmaps · Abschnitte + Deckung · Grund | ebenso | angelegte Objekte |
| **B** | Verbund | nur bei Verbund: die Fragmente, **nur Anzeige** | Fragmente mit ✕ · **„Zusammenlegen (n)"** bzw. „Verbund auflösen (n)" | Fragmente mit ↩ |
| **C** | Ziel & Identität | **Vorschlag als Text**: Ziel · Form · Art — „Erst auf der Stage einstellbar." | **Zielwahl** (§5) · Name · Form · Art | — (nichts mehr einzustellen; der Satz „Liegt bereits auf der Karte …" steht in A) |
| **D** | Darstellung | — (ausgeblendet) | Fläche · Beschriftung · je Form Höhe, Flussrichtung, Endkreuzungen, Ruine, Verborgen | — |
| **E** | Wiki & Quellen | — (ausgeblendet) | Wiki-Landschaft · Quelle · Verweise | — |
| **F** | Handlung | „Auf die Stage" · „Ablehnen" | „Von der Stage nehmen" · „Ablehnen" | „Zurücknehmen" · „Ganzen Verbund zurücknehmen (n)" |
| **G** | Weiter importieren | Typ-Auswahl · „Imports in der Nähe wählen" · Umkreis | ebenso | — |

- **C heißt „Ziel & Identität"** (Verbund: „Identität"), **F heißt „Handlung"** (Verbund: „Einfügen")
  — die Häkchen, die dort standen, sind jetzt die Zielwahl in C.
- 🔴 **Auf „Offen" trägt die rechte Spalte kein Einstellfeld.** Ausgenommen ist nur G: Typ-Auswahl und
  Umkreis sind ein **Auswahl**werkzeug für die Liste, keine Eigenschaft des Objekts.
- ⚠️ **Auf der Stage wird abgeblendet, nicht ausgeblendet**, was das gewählte Ziel nicht braucht
  (Form, Art und der ganze Block D bei Stätte, Ergänzung, „Nur Quelle" und „Nichts") — in voller Höhe,
  grau und gesperrt, sonst springt die Spalte bei jedem Wechsel. E bleibt immer bedienbar.
- 🔴 **„Übernommen" zeigt A, B (nur bei einem Verbund) und F.** Ein übernommenes Objekt hat nichts mehr
  einzustellen; C bis E und G fehlen dort (Owner 14.09.2026: der Bestand). Auf „Offen"
  bleiben D und E dagegen ganz weg (Owner 09.09.: 1388 → 786 px).
- ⚠️ **Die Handlung eines Objekts und die Handlung einer Auswahl sind zwei Gegenstände.** F wirkt auf
  das angezeigte Objekt, die Auswahlleiste links auf die angehakten Zeilen, die Fußleiste auf die
  ganze Stage. Keine Handlung steht in zwei dieser drei Leisten (§7).

---

## 4 · Offen: ein Knopf auf die Stage

- **„Auf die Stage"** legt das Objekt auf — und bei einem Fragment **alle erzeugenden Fragmente
  seines Verbunds**, einzeln. Die zweite Zeile des Knopfs sagt es: „mit 3 weiteren Fragmenten".
  Zusammengelegt wird dabei **nichts** (Owner 09.09./1 und 12.09./5).
- Wer nur eines der Fragmente will, nimmt die übrigen auf der Stage mit ✕ wieder herunter.
- 💣 Ein `deckt_sich`-Fragment desselben Namens ist **kein** Mitglied und wird nicht mit aufgelegt
  (Owner 09.09./2; heute tot, Fehler 5).
- Die Zeile auf „Offen" sagt, ob das Objekt schon auf der Stage liegt.

---

## 5 · Die Zielwahl

Eine Liste, eine Wahl, in Block C, **nur auf der Stage**. Was darin steht, folgt aus dem Befund des
Abgleichs:

| Ziel | steht zur Wahl, wenn … | wird zu |
|---|---|---|
| **Auf die Karte** | sobald es ein Neu- oder Zusatz-Item gibt — eine Siedlung im Umkreis nimmt es **nie** weg (Owner 12.09./7). Ohne beides (z. B. „übersprungen") stünde dort eine Wahl, die still nichts täte | ein neues Objekt der gewählten Form |
| **Stätte in „X"** | eine Siedlung im Umkreis liegt (Bauwerke) | eine Stätte an „X", nicht auf der Karte |
| **Nur Quelle + Artikel an „X"** | dasselbe | keine neue Zeile; Quelle und Artikel an „X" — 🔧 **neu im Server**: der Innerorts-Weg legt heute immer eine Stätte an |
| **Quelle an „X" ergänzen** | das Objekt deckt sich mit einem, das wir haben | das Ergänzungs-Item; Geometrie und Name von „X" bleiben |
| **Auf die Karte — zusätzlich zu „X"** | dasselbe | neues Objekt **und** Quelle an „X" — **mit Rückfrage** |
| **Nichts — nur ansehen** | immer | bleibt auf der Stage, wird nicht importiert, **wird nicht gezählt** |

- ⚠️ **„Stätte in X" ist heute keine Form**, sondern die Innerorts-Auswahl neben der Formwahl
  (`garetienInnerortsWahlZu`); die Formen kennen nur `region`, `label`, `location`, `path`
  (`AVESMAPS_GARETIEN_FORMEN`). Der Stage-Entwurf vom 06.09. wollte beides als Formen, gebaut wurde es
  nie. In der Zielwahl werden Form und Innerorts zu Werten **derselben** Liste.
- 🔴 **Der Umkreis-Spinner (0–20 Meilen) steht bei jedem Bauwerk**, auch ohne Treffer — sonst fehlt
  genau dann das Feld, mit dem man von 5 auf 12 stellt.
- 💣 **„Zusätzlich zu X" ist eine eigene, benannte Wahl** und nie die Folge eines Häkchens. Die
  Rückfrage nennt beides beim Namen: *„Neues Objekt „Natter" anlegen UND die Garetien-Quelle an das
  bestehende „Natter" hängen?"* Workflow-Entscheidung 5 ist damit entschieden: der Fall bleibt,
  aber nie mehr still.
- 💣 **Der Riegel steht zusätzlich im Server.** Ein `apply`, das für **dasselbe Objekt** ein Neu- und
  ein Ergänzungs-Item enthält, wird abgewiesen — **außer** das Objekt ist im Rumpf ausdrücklich als
  `beides` bestätigt. ⚠️ Ohne diese Ausnahme wiese der Riegel genau die Wahl ab, die ihn braucht —
  der Workflow-Entwurf verlangt beides und sagt nicht, wie beides zugleich gilt.
- 💣 **„Stätte in X" muss den Server erreichen.** Heute springt der Fußknopf nach dieser Wahl auf
  „0 von 1", weil `innerorts` den Weg über die Stage nie findet.
- ⭐ **Die Zeile nennt Ziel und Zahl:** „Quelle an 6 Abschnitte der Rakula", nie „Als Quelle einfügen".
- Vorbelegung: **„Quelle an X ergänzen"**, wenn sich das Objekt deckt; sonst **„Auf die Karte"**.
  Das ist die heutige Vorbelegung — nur ohne den stillen Zusatz.

---

## 6 · Der Verbund

### 6.1 Erkennung

| Regel | Stand |
|---|---|
| Gruppe = **Ebene + Typ + Stamm**, mindestens zwei Zeilen, mindestens eine mit Marke | gebaut |
| **Nur erzeugende Zeilen** (nie `deckt_sich`, nie `uebersprungen` — das Urteil entsteht erst im Abgleich, der Planbau läuft deshalb in zwei Durchgängen) | 💣 **Fehler 5** — der Filter muss dort greifen, wo `urteil` gelesen wird |
| Marken: Zahl · Zahl+Buchstabe · ohne Trenner · römisch I–XV · `(n)` · Himmelsrichtung kurz und ausgeschrieben, **in jeder Schreibung** | 💣 **Fehler 2** — „Süd" |
| **Kein Einzelbuchstabe** als Marke | 💣 **Fehler 3** |
| Ziel `location` und `label` nie | gebaut |
| Ein Fragment ohne Marke gehört dazu, wenn ein Geschwister eine trägt | gebaut |
| `verbund_n` = Größe der **Gruppe**, nicht des Stamms | 💣 **Fehler 4** |
| ⚠️ Kombi-Marken („Wald 2 O") | **nicht** — ungemessen; der Filter „Verbünde" (§7) macht sichtbar, ob sie gebraucht werden |

### 6.2 Auf die Stage — siehe §4.

### 6.3 Zusammenlegen

- **Ein Klick auf der Stage** in Block B: „Zusammenlegen (4)". Das Gegenstück heißt „Verbund
  auflösen (4)". Der Knopf auf „Offen" entfällt (Widerspruch 8).
- Danach: **Name = Stamm**, änderbar im Namensfeld; alle Einstellungen gelten dem Verbund
  (Block-Notiz „gilt dem ganzen Verbund").
- 💣 **Vorbelegt wird aus dem größten Fragment**, nicht aus dem zuerst berührten (Fehler 6).
- 💣 **Zusammenlegen geht nur, wenn das Ziel „Auf die Karte" mit Form Fläche oder Weg ist — an JEDEM
  aufgelegten Mitglied.** Sonst ist der Knopf gesperrt und sagt warum, mit dem Namen des Fragments
  („… bei „Silker Hain 2""). Ein Verbund, der als Punkt ankommt, ist keiner; und ein „Nichts" an einem
  kleinen Fragment fiele nach dem Zusammenlegen sonst still auf „Auf die Karte" zurück.
- 🔴 **Wege-Verbünde sind gesperrt, bis der Owner sie freigibt** (`AVESMAPS_GARETIEN_VERBUND_WEGE_FREI`,
  eine Zeile) — erst nach seinem Blick auf die 19 Wege-Verbünde (§6.6).
- ⚠️ Zusammengelegt heißt: **alle Fragmente auf der Stage**. Nimmt ✕ eines herunter, bleibt der Rest
  zusammen; fallen weniger als zwei, ist der Verbund aufgelöst.

### 6.4 Wo die Entscheidung lebt

🔴 **Die Entscheidung „zusammengelegt" lebt an derselben Stelle wie die Stage selbst** — und stirbt mit
ihr. Im Einzelnen:

- 🔴 **Die Stage lebt nur im Browser** (`zustand.stage`, eine `Map`; auf dem Server gibt es sie nicht,
  `selected` wird erst beim Import gesetzt). Die Entscheidung wird deshalb **am Stage-Eintrag** geführt,
  nicht in einem eigenen `Set` daneben: was einen Eintrag von der Stage nimmt, nimmt die Entscheidung
  mit, und ein Neuladen der Seite leert beide gemeinsam;
- sie fällt mit **„Stage leeren"**, **„Verbund auflösen"**, einem **neuen Lauf** und wenn weniger als
  zwei Mitglieder auf der Stage liegen;
- 💣 **ein Fragment, das nach „Stage leeren" einzeln wieder aufgelegt wird, ist nicht zusammengelegt**
  (K1: heute wird es still verschmolzen);
- die Verbund-Einstellungen fallen **mit** der Entscheidung (Fehler 10), und „Stage leeren" sowie ein
  neuer Lauf rufen die vorhandenen `…Vergessen`-Funktionen.

### 6.5 Zählen

- Der Fußknopf zählt **Objekte, die entstehen**: „Stage importieren · 1 Objekt aus 4 Zeilen".
- Die Rückfrage nennt die Folge: *„1 Fläche „Silker Hain" mit 4 Teilen anlegen?"* — nie „4 Objekte".
- Ein Ziel „Nichts — nur ansehen" zählt nicht.

### 6.6 Übernahme

- Anführer bleibt das Item mit der kleinsten `sync_plan_item.id` (gebaut).
- 💣 **Name = Stamm** (Fehler 1): der Client schickt ihn als Vorbelegung, und der Server setzt ihn
  selbst, wenn `verbund` gesetzt und kein Name gewählt ist — eine Sperre nur im Browser ist keine.
- Die **Wiki-Zuweisung sucht mit dem Namen**, also mit dem Stamm; der **Wiki-Schlüssel landet an der
  Region**, nicht nur an der Beschriftung (Workflow-Befund `wiki-am-schild`; mit einem Verbund trägt
  die Region vier Flächen, und an ihr hängen Kanon und Statuskreis). ⚠️ `avesmapsCreateEcosystemRegion`
  liest keinen Schlüssel, sondern leitet ihn aus `wiki_url` ab — die Übernahme reicht dafür die Adresse
  des Treffers mit.
- **Wege:** Name = Stamm macht die Abschnitte über `name:<Wegart>:<Stamm>` zu **einem** Weg.
  🔧 **Bevor das live geht, sieht der Owner die 19 Wege-Verbünde** im Filter „Verbünde" — ob „X" und
  „X 2" bei Wegen wirklich derselbe Weg sind, kann nur der Bestand sagen.
- 💣 **Scheitert der Anführer** (Fehler 7), räumt die Übernahme auf, was er schon angelegt hat, und
  bucht das Item als gescheitert. **Kein Teil hängt sich an eine Region ohne Fläche.**
- ⚠️ Die Kurvenbeschreibung ist bei einem Verbund **vorbelegt aus**: niemand hat eine Kurve über vier
  Stücke gesehen, die Meilen auseinanderliegen; eingeschaltet wird sie im Landschaften-Editor.

### 6.7 Rücknahme

- Je Fläche, die Region fällt mit der letzten (gebaut, auf master noch nicht).
- 💣 **Die Garetien-Quelle an der Region wird erst gelöst, wenn die letzte Fläche geht** (Fehler 9).

### 6.8 Übernommen

- Eine Zeile je Verbund, **aus dem Vermerk und laufübergreifend** (Fehler 8) — nie aus der
  Erkennungsregel.

### 6.9 Getragen, nicht behoben

Zwei Races ohne Sperre (Anführer-Suche; Rücknahme der letzten zwei Flächen). Sie brauchen zwei Tabs
oder einen Doppelklick desselben Editors; beide Schäden sind sichtbar und im Haus bekannt (Klasse
„read-then-write", Muster der verwaisten Außenhüllen). Kein Teil dieses Plans.

---

## 7 · Liste und Leisten

- **Die Liste bleibt flach** auf „Offen" und „Stage" (Owner 12.09./4); nur „Übernommen" faltet einen
  Verbund zu einer Zeile.
- **Die Zeile trägt:** die Fragment-Marke „⧉ 4 Fragmente" **neben** dem Namen · auf „Offen" die Marke
  „auf der Stage" · auf der Stage ihr **Ziel** („→ Fläche · Wald", „→ 1 Fläche aus 4 Teilen",
  „→ Stätte in „Wandleth"", „→ Quelle an 6 Abschnitte"). ⭐ Der Bauer dafür existiert
  (`garetienStageZeile2`) und hat heute keinen Aufrufer.
- **Suche und der Filter „Objekttyp" wirken auf der Stage.** Der Filter bekommt die Wahl **„nur
  Verbünde"** — sie ist zugleich der Trockenlauf der Erkennung, bevor Wege-Verbünde live gehen.
  💣 **Gefiltert wird heute nur auf dem Server**; die Stage-Antwort entsteht im Browser
  (`garetienStageAntwortBauen`) und liest keinen Filter. Die Sperre fallen zu lassen genügt nicht — ohne
  Filter im Browser wären Suchfeld und Knopf bedienbar und wirkungslos, und der Wert wirkte erst beim
  nächsten Reiterwechsel.
- **Drei Leisten, drei Gegenstände, kein Knopf in zweien:**

| Leiste | Gegenstand | Knöpfe |
|---|---|---|
| Listenkopf | alle Zeilen der Ansicht | Häkchen **„alle n"** |
| **Auswahlleiste** (links, nur mit Auswahl) | die angehakten Zeilen | Offen: „Auswahl auf die Stage (n)" · „Auswahl ablehnen (n)" · „Auswahl aufheben" — Stage: „Auswahl von der Stage nehmen (n)" · „Auswahl ablehnen (n)" · „Auswahl aufheben" |
| **Fußleiste** | die ganze Stage | „Stage leeren" · „Alle zentrieren" · **„Stage importieren"** (die einzige gefüllte Handlung) |

- 💣 **„Alle wählen" wandert aus der Fußleiste** in den Listenkopf — als Häkchen, das auch wieder löst,
  und je Reiter mit genau der Menge, die „Alle wählen" dort heute wählt.
- Die Zeile auf der Stage trägt **Ziel · Urteil · Grund**; die Zahl im Listenkopf lautet auf „Offen"
  „n von m", auf der Stage „n auf der Stage · k Objekte".

---

## 7a · Der Bestand

Der Importer ist live und trägt echte Fälle — übernommene, abgelehnte, offene Zeilen und übernommene Objekte
auf der Karte. Der Verbund-Zweig war nie live.

- 🔴 **Keine Migration.** `entity_key`, `sync_decision` und die `apply_note`-Vermerke bleiben, wie sie sind.
  Übernommenes bleibt zurücknehmbar, Abgelehntes bleibt abgelehnt — auch mit den alten Vermerkformen (nackte
  `public_id`; `area:… | region:…` ohne `verbund:`). Jede Aufgabe, die einen Lese- oder Rücknahmeweg ändert,
  testet mit genau diesem Bestand.
- **Ein `after_json` ohne `verbund_stamm`/`verbund_n` heißt „kein Verbund".** Marke und Filter „nur Verbünde"
  erscheinen erst nach dem nächsten „Holen & Rechnen"; bis dahin sagt der leere Filter, warum er leer ist.
- **Der Riegel „beides" zählt nur angehakte, noch nicht übernommene Items** — eine abgelehnte Zeile löst ihn nie aus.
- **„Nur Quelle + Artikel" bekommt einen eigenen Vermerk** `nur_quelle:<siedlung>` und einen eigenen
  Rücknahme-Zweig. 💣 Mit dem nackten Vermerk hätte die Rücknahme die **Siedlung** gelöscht.
- ✅ **Wiki-Schlüssel an bestehenden Flächen nachziehen** (Owner 14.09.2026: „ja, mit Trockenlauf"): Aufgabe 13,
  ein Admin-Lauf, Trockenlauf als Vorgabe. Neue Importe tragen den Schlüssel ab Aufgabe 2 selbst.
- 🔧 **Verwaiste Garetien-Quellen früher zurückgenommener Flächen** (Fehler 9): jede vor dem Deploy
  zurückgenommene neue Fläche hat ihre Quellenverknüpfung an einer deaktivierten Region behalten. Ab Aufgabe 3
  entsteht keine neue; ob die alten aufgeräumt werden, entscheidet der Owner.

## 8 · Was dieser Plan nicht abdeckt

Je ein eigenes Vorhaben, jedes mit seinen Befunden in der Workflow-Befundliste:

- **Der Abgleich** — Median-Deckung, Eckpunkt statt Kante, Berge, gleichnamige Orte, Küste,
  Linien-Schwelle je Wegart, Stadtviertel, Wortanfang-Regel (Widerspruch 9), 16-Abschnitte-Deckel.
- **Die Strecke vor dem Fenster** — halber Lauf wird der geltende, Laufstatus lügt, Plan ohne
  Zeitlimit, Parser, Upload-Lauf, Staging ohne Transaktion.
- **Das Fenster als Fläche** — Telefon (Workflow-Entscheidung 3 offen), Fensterbreite 1000 px
  (Owner 06.09.), Tastatur, Fokus, Zentrieren hinter dem Fenster.
- **Territorien** (Workflow-Entscheidung 4) · **der Bestand** (Entscheidung 10) · **Bauwerksarten**
  (1356 Objekte, Owner) · **Bach als Art** · Strömung (Entscheidung 9) · Endkreuzungen einrasten ·
  Massenimport-Abbruch · „Rückgängig" stirbt beim nächsten Klick · Lizenz an Stätten.
- **Die Identität als Zeilennummer** bleibt ein Befund, ist aber **keine Voraussetzung** dieses Plans
  mehr (Widerspruch 1).

**Die zehn Entscheidungen des Workflow-Entwurfs §7:** 1 (Umfang) — dieser Plan · 2 (Identität) — nicht
nötig · 5 (zusätzlich zu X) — bleibt, benannt und mit Rückfrage · **3, 4, 6, 7, 8, 9, 10 offen**, sie
gehören zu den Vorhaben oben.

---

## 9 · Zusicherungen — die Abnahmeliste

Jede Zeile wird vor „fertig" abgehakt oder ausdrücklich verworfen (AGENTS.md §9).

**Offen**
- [ ] Die rechte Spalte trägt **kein aktives Einstellfeld** außer Block G
- [ ] C zeigt Ziel, Form und Art **als Text** mit „Erst auf der Stage einstellbar."
- [ ] „Innerorts einfügen" und jeder andere Einzel-Schreibweg sind **gefallen**
- [ ] „Auf die Stage" legt alle **erzeugenden** Fragmente auf und sagt es in der zweiten Zeile
- [ ] Die Zeile sagt, ob das Objekt auf der Stage liegt

**Stage**
- [ ] Die Zielwahl ist **eine** Wahl; „Auf die Karte" verschwindet nie
- [ ] „Zusätzlich zu X" ist eine eigene Wahl **mit Rückfrage**; der Server weist Neu + Ergänzung
      desselben Objekts ab, außer `beides` ist bestätigt
- [ ] „Stätte in X" erreicht den Server und wird vom Fußknopf gezählt
- [ ] Der Umkreis-Spinner steht bei jedem Bauwerk, auch ohne Treffer
- [ ] Nicht Gebrauchtes wird **abgeblendet**, nicht ausgeblendet
- [ ] Die Zeile trägt ihr Ziel; Suche und Objekttyp-Filter wirken; „nur Verbünde" ist wählbar

**Verbund**
- [ ] `deckt_sich` ist nie Mitglied · „Süd" in jeder Schreibung · kein Einzelbuchstabe · `verbund_n`
      je Gruppe
- [ ] „Zusammenlegen (n)" steht **nur auf der Stage**, in Block B
- [ ] Vorbelegung aus dem **größten** Fragment; gesperrt mit Grund, wenn das Ziel kein Fläche/Weg ist
- [ ] Die Entscheidung lebt und stirbt mit der Stage; nach „Stage leeren" einzeln Aufgelegtes ist
      **nicht** zusammengelegt
- [ ] Fußknopf und Rückfrage zählen **entstehende Objekte**
- [ ] Name = Stamm (Client **und** Server); Wiki-Suche mit dem Stamm; Wiki-Schlüssel an der Region
- [ ] Ein gescheiterter Anführer hinterlässt **nichts**
- [ ] Die Garetien-Quelle der Region fällt erst mit der letzten Fläche
- [ ] „Übernommen" faltet laufübergreifend aus dem Vermerk
- [ ] 🔧 Der Owner hat die 19 Wege-Verbünde gesehen, bevor die Wege-Umbenennung live geht

**Einzelansicht und Leisten**
- [ ] Sieben Blöcke A–G, Buchstaben fluchten, Trennlinie statt Rahmen
- [ ] Kein Knopf steht in zwei Leisten; „alle n" ist ein Häkchen im Listenkopf

**Immer**
- [ ] Jede sichtbare Aufgabe geht **einzeln** live, mit dem Blick des Owners (AGENTS.md §9)
- [ ] Vor jedem Push das **ganze** Testfeld nach dem Muster des Workflows, Dateizahl gegengezählt
- [ ] Nach dem Push die Live-Seite **als Besucher** laden und die Konsole lesen
- [ ] Der Ablauf wird im Browser gefahren, nicht gemessen: auflegen → zusammenlegen → importieren →
      ein Fragment zurücknehmen → alle zurücknehmen

---

## 10 · Offene Punkte

- 🔧 Die 19 Wege-Verbünde (§6.6) — Owner-Blick vor dem Live-Gang der Wege-Umbenennung.
- 🔧 Die Beschriftung sitzt auf dem Schwerpunkt des Anführers, nicht der Mitte des Verbunds
  („Wald im Koschgebirge": 15 Fragmente über 71 Einheiten). Verschiebbar; nicht Teil dieses Plans.
- 🔧 Ob ein **aufgelöster** Verbund sich merken muss, dass er nicht wieder vorgeschlagen wird.
- 🔧 Nach der Abnahme des Mockups bekommt es **VERTRAG-Marken** für die neuen Regeln (Zielwahl), und
  zwar im selben Commit, der sie baut — eine Marke auf ungebautem CSS machte das Deploy-Tor rot.
