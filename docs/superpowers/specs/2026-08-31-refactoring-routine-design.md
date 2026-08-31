# Die tägliche Refactoring-Routine — Entwurf

**Stand:** 2026-08-31 · **Status:** Entwurf, wartet auf GO · gebaut wird nichts, bevor der Owner zugestimmt hat.

Eine Routine, die **pro Tag einen verhaltensgleichen Innenumbau** an der Datei macht, die
gerade am meisten kostet und lange genug ruht. Kein Feature, kein Bugfix, nichts Sichtbares.

---

## 1. Der Anlass: die Aufräumarbeit von M5 ist wieder weg

M5 hat mehrere God-Files aufgeteilt und auf ihre Zielgröße gebracht. Stand heute:

| Datei | nach M5 | 2026-08-31 | |
|---|---:|---:|---:|
| `js/review/review-wiki-sync.js` | 692 | **4253** | +3561 |
| `js/review/review-settlement-list.js` | 381 | 1266 | +885 |
| `js/review/review-panels.js` | 471 | 1206 | +735 |
| `js/ui/spotlight-search.js` | 673 | 1270 | +597 |
| `js/map-features/map-features.js` | 474 | 816 | +342 |

`review-wiki-sync.js` ist auf das **Sechsfache** zurückgewachsen — nicht durch
Nachlässigkeit, sondern durch ganz normale Arbeit bei 59,2 Commits pro Tag. Es hat nur
niemand hingesehen.

🔴 **Das ist die Begründung für eine Routine statt einer weiteren Kampagne.** Eine Kampagne
räumt einmal auf und ist danach fertig; der Bestand wächst zurück. Eine Routine hält den
Stand. Wer diesen Abschnitt für Geschichte hält und die Routine abschaltet, bekommt in einem
halben Jahr dieselbe Tabelle noch einmal.

### Wo das Gewicht wirklich liegt

Von 718.858 Zeilen im Repo sind nur **344.683 Produktivcode** (48 %); der Rest ist
Dokumentation (170.246), Tests (160.785) und Mockups (33.471). Die Median-Produktivdatei hat
**256 Zeilen** — der Bestand ist gesünder, als die Gesamtzahl aussehen lässt. Das Gewicht
sitzt in wenigen Brocken: **19 Dateien über 2000 Zeilen tragen zusammen 61.865.**

---

## 2. Was sie NICHT tut

Die Abgrenzung ist wichtiger als der Auftrag, weil jede Erweiterung sie gefährlicher macht.

- **Nichts Sichtbares.** Kein Layout, kein Bedienelement, keine Kartenbedienung, kein Text.
  Owner, wörtlich: „Innenumbauten ohne sichtbare Wirkung — was anderes will ich nicht."
- **Keine Verhaltensänderung.** Auch keine „offensichtliche Verbesserung".
- **Keine Bugs.** Dafür gibt es `avesmaps-daily-fixes`.
- **Keine Features, kein Datenmodell, kein API-Vertrag, nichts Löschendes.**
- **Kein Handbuch.** `html/editor-handbuch.html` gehört `avesmaps-handbuch-pflege`
  (AGENTS.md §9) — auch wenn es als Brennpunkt oben auf der Rangliste steht.

⚠️ Fällt der Routine unterwegs etwas anderes auf — ein Bug, eine Doppelung, ein
Architekturproblem —, **fasst sie es nicht an.** Es kommt auf die Liste und in den Bericht
an den Owner.

---

## 3. Wie sie ihr Ziel wählt

### 3.1 Die Rangliste — bei JEDEM Lauf neu

Rangwert = **Zeilen × Commits der letzten 180 Tage**. Eine schlechte Struktur kostet nichts
an sich; sie kostet den, der sie lesen muss. Also zählt beides: wie dick, und wie oft jemand
hineinmuss.

💣 **Sie wird in jedem Lauf neu gerechnet, nie auf Vorrat.** Gemessen: Churn über 180 Tage
**1504 ms**, Zeilenzählung über alle Quelldateien **670 ms** — zusammen 2,2 Sekunden, rein
lokal, **ohne einen einzigen Request gegen avesmaps.de** (die STRATO-Regel aus CLAUDE.md ist
damit gar nicht berührt).

💣 **Eine wochenalte Rangliste wäre nicht nur ungenau, sondern UNSICHER.** Gemessen am
2026-08-31: in 7 Tagen wurden **471 von 739** Produktivdateien berührt (64 %), 124 allein in
24 Stunden, 220 Dateien neu angelegt. Eine alte Liste kennt bei zwei Dritteln des Bestands
die Abkühlfrist falsch — und die Abkühlfrist ist genau der Riegel, der die Routine von
laufender Arbeit fernhält. Vorratshaltung spart 2 Sekunden und kostet den Schutz.

### 3.2 Die Abkühlfrist: mindestens 5 Tage

🔴 **Nicht „alt", nicht „neu", sondern „heiß, aber gerade ruhig".**

Der naheliegende Filter „seit 2 Wochen unberührt" wäre ein **Anti-Filter**: er wählt
`api/_internal/backup/db-dump.php` (2163 Zeilen, **1 Commit in 180 Tagen**) — Code, der
funktioniert, den niemand liest und niemand ändert. Umbau = reines Risiko bei null Ertrag.
Gleichzeitig schließt er jeden echten Brennpunkt aus, denn die sind alle 0–10 Tage alt.

Umgekehrt geht „immer die heißeste" nicht, weil der Checkout geteilt ist und eine heute
berührte Datei unfertige Arbeit einer anderen Sitzung tragen kann.

Gemessen, wie viel bei welcher Frist von den Top-120-Brennpunkten übrig bleibt:

| Abkühlfrist | Kandidaten |
|---|---:|
| 3 Tage | 78 |
| **5 Tage** | **67** |
| 7 Tage | 42 |
| 14 Tage | 21 |

**5 Tage** ist der gewählte Wert: der Vorrat läuft nie leer, und die Frist leistet zweierlei
— sie hält der laufenden Sitzung aus dem Weg, und sie ist der Beleg, dass die letzte Änderung
an der Datei fünf Tage live überlebt hat (die Einzeln-live-Regel aus AGENTS.md §9).

### 3.3 Die Ausschlussliste — tragend, nicht Kür

💣 **Drei der größten Dateien dürfen nie angefasst werden, und man sieht es ihnen nicht an:**

- `css/pages/political-territory-editor-inline.css` (1980 Zeilen) ist ein **BUILD-PRODUKT**
  (`tools/scope_editor_css.js`). Eine hineingeschriebene Regel wirkt sofort und stirbt
  lautlos beim nächsten Generatorlauf. Menschen ist das dreimal passiert (AGENTS.md §10).
- `js/app/i18n-en.js` (1268 Zeilen, 237 Commits) ist eine **Stringtabelle** — groß, aber
  nichts daran ist verworren.
- `css/third-party/`, `js/third-party/` — **Fremdcode.**
- `html/editor-handbuch.html` — gehört einer anderen Routine (§2).

⚠️ Die Liste ist offen: jede weitere generierte oder reine Datentabelle kommt dazu.
**Erkennungszeichen für ein Build-Produkt:** ein Erzeuger unter `tools/`, ein Kopfkommentar
„generated", oder ein Test, der die Datei gegen ihren Generator hält.

### 3.4 Die eigene Liste = das NEGATIVE Gedächtnis

🔴 Die Liste ist **nicht die Analyse, sondern deren Gedächtnis** — und zwar nur der negative
Teil. Die Rangliste sagt jeden Tag neu, *wo*; die Liste sagt, was schon **verworfen** wurde
und **warum**: „Funktionsblock hängt an Ladezeit-Zustand", „hier letzte Woche am Push
gescheitert", „ist eine Datentabelle".

Positive Befunde werden **nicht** gespeichert — die rechnet die Rangliste in zwei Sekunden
neu, und sie veralten (§3.1). Ohne das negative Gedächtnis griffe die Routine dreißig Tage
hintereinander dieselbe Datei auf und leitete dieselbe Erkenntnis noch einmal her.

---

## 4. Was sie tut: der M5-Sicherheitsschnitt

Das Verfahren, das sich in M5 siebenmal bewährt hat: **einen zusammenhängenden Lauf globaler
Funktionsdeklarationen** in eine Geschwisterdatei ziehen, die in `index.html` (bzw. der
Editorseite) **direkt daneben** geladen wird. Verhaltensgleich, weil globale Funktionen
gehoistet sind und erst zur Laufzeit gerufen werden.

💣 **Die Grenze des Verfahrens ist scharf und wird nicht gedehnt:** kein Zustand auf oberster
Ebene, kein Ladezeit-Code im verschobenen Block. Am heutigen Top-Kandidaten
`review-wiki-sync.js` sieht man, warum: 4253 Zeilen, **77 globale Funktionen**, aber auch
**64 Zeilen** oberster Ebene (`var wikiSyncKindSyncedRaw`, `const wikiSyncVerbHomes`,
`renderWikiSyncSubjectRail()`). Die Routine nimmt einen *Lauf von Funktionen*, nie die Datei
als Ganzes.

⚠️ **Ein IIFE-Modul ist kein Kandidat.** `territory-wiki-tree.js` und
`territory-editor-embedded.js` sind Closure-Module — der Funktions-Umzug gilt dort nicht (der
Masterplan sagt das für beide ausdrücklich). Erkennungszeichen: null Funktionsdeklarationen
in Spalte 0.

### 4.1 `index.html`

🔴 Owner 2026-08-31: „klar darf sie die index anfassen, darf halt nichts kaputt machen und
das Verhalten muss bleiben."

Sie fasst `index.html` **ausschließlich additiv** an: **eine `<script>`-Zeile neben der
bestehenden.** Die Ladereihenfolge ist ein Vertrag (AGENTS.md §3) — sie wird nicht
umsortiert, nichts wird entfernt, nichts verschoben. `index.html` ist mit **957 Commits in
180 Tagen** der größte Brennpunkt des Repos und zugleich die riskanteste Datei; deshalb ist
der additive Griff die einzige erlaubte Berührung.

💣 **Kein `?v=` von Hand** (AGENTS.md §7) — der Deploy stempelt. Bei Editor-Assets
`ASSET_VERSION` bumpen; bei einer `.php`-Seite, die das Asset lädt, den Stempel **von Hand**
(die dokumentierte Ausnahme; Gegenprobe: `grep -n '?v=' <die .php-Seite>`).

---

## 5. Der Verhaltensriegel

🔴 Owner 2026-08-31: „wenn Verhalten tangiert wird, will ich's abnehmen." Das ist keine
Absichtserklärung, sondern mechanisch prüfbar.

### 5.1 Der Fingerabdruck: Einfügungen ≈ Löschungen

Die sieben M5-Splits sind erstaunlich gleichförmig:

```
3 files changed, 727 insertions(+), 720 deletions(-)
3 files changed, 392 insertions(+), 385 deletions(-)
3 files changed, 260 insertions(+), 252 deletions(-)
```

Immer drei Dateien; die Differenz ist die Handvoll Zeilen für Dateikopf und Script-Tag.
**Laufen Einfügungen und Löschungen auseinander, war es keine Verschiebung mehr.** Schwelle:
Differenz höchstens 20 Zeilen und höchstens 5 % — darüber wird **nicht gepusht**, sondern der
Befund an den Owner gemeldet und die Arbeit verworfen.

### 5.2 Das volle Testtor VOR dem Push

💣 Nicht die eigenen Tests — **das ganze Feld**, mit den Mustern des Workflows selbst
(AGENTS.md §9), denn nur die entscheiden über den Deploy. Die Muster stehen dort
zeichengenau; sie werden von dort übernommen, nicht aus dem Gedächtnis geschrieben.

💣 **Die äußere Klammer um beide Gruppen ist tragend.** Ohne sie bindet `-print0` nur an die
zweite Gruppe, der Lauf fährt 21 statt 312 Dateien und meldet „null rot" — dreimal so
passiert und geglaubt.

⭐ **Gegenprobe, die nichts kostet:** die Zahl der gefundenen Dateien gegen die Zahl aus
`.github/workflows/deploy-avesmaps-strato.yml` halten (26.08.2026: **312 JS, 310 PHP**). Eine
viel zu kleine Zahl ist der einzige Unterschied zwischen diesem Fehler und einem grünen Feld.

⚠️ PHP braucht `mbstring`, `pdo_sqlite` und `gd`, sonst melden **45 Tests** rot, die alle nur
die Erweiterung vermissen.

⚠️ Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf),
kein Regressionssignal. Bei einem **unerwarteten** Roten seriell nachfahren, bevor man ihn
glaubt; bei einem unerwarteten **Grünen** zuerst die Dateizahl nachzählen.

💣 Beim parallelen Lauf **kein `2>&1` auf die Ergebnisdatei** — eine `xargs`-Warnung darin
liest sich als roter Test und bricht den Push ab, obwohl nichts rot ist.

### 5.3 Im Zweifel: nichts

Erweist sich ein Schnitt als unklar, größer als gedacht oder verhaltensberührend →
`git restore`, Grund auf die Liste, Meldung an den Owner. **Lieber nichts als ein unsicherer
Umbau** — dieselbe Disziplin wie bei `handbuch-pflege` und `daily-fixes`.

---

## 6. Wie sie ungestört arbeitet

### 6.1 Isolation über den ORT, nicht über die Uhrzeit

Gemessen über 60 Tage: **59,2 Commits/Tag, an 60 von 60 Tagen, und es gibt kein ruhiges
Fenster.**

```
00h  232 ##########################################################
04h  159 #######################################
08h   46 ###########      <- das Minimum
14h  240 ############################################################
22h  162 ########################################
```

Also **Wegwerf-Worktree auf `origin/master`**, wie `handbuch-pflege`.

💣 **Niemals im geteilten Checkout arbeiten.** `C:\GIT\avesmaps` hing am 2026-07-30 gemessen
**333 Commits zurück** mit 41 fremden geänderten Dateien. Dort zu arbeiten hieße: eine uralte
Datei bearbeiten, neuere Arbeit rückgängig machen, und beim Push-Reject ein
`rebase --autostash` über fremde halbfertige Hunks fahren.

💣 **Niemals `git add -A` / `git add .` / `git commit -a`** — nur explizite Pfade
(AGENTS.md §9). Aufräumen am Ende, **auch bei Abbruch**: `git worktree remove --force` +
`git worktree prune`.

⚠️ **Harter Riegel vor der Arbeit:** trägt der geteilte Baum unfertige Änderungen an der
Zieldatei (`git status --porcelain -- <ziel>`), wird die Datei heute nicht angefasst —
nächster Kandidat.

### 6.2 💣 DER DEPLOY-RIEGEL — hier stört sie den Betrieb wirklich

Das ist der einzige Weg, auf dem diese Routine fremde Arbeit beschädigen kann, und er ist
still.

Ein zweiter Push, während ein Deploy läuft, **bricht dessen Lauf ab; ein abgebrochener Lauf
lädt NICHTS hoch**, und der nächste rechnet seine Dateien ab `github.event.before` — die
Dateien des abgebrochenen Commits lädt damit **nie jemand** (AGENTS.md §9). Der `?v=`-Stempel
in `index.html` ist dann der neue, die Datei dahinter die alte; die Funktion fehlt einfach.

**Wie oft das droht, gemessen an den letzten 200 Commits:** Median-Abstand 11,5 min, aber
**33 von 199 Abständen (17 %) liegen unter 3 Minuten** — also innerhalb einer Deploy-Dauer.
Ein blind gesetzter Push der Routine würde statistisch **etwa jeden sechsten Mal** einen
fremden Deploy abbrechen.

🔴 **Deshalb, zwingend, vor dem Push:**

```
gh run list --workflow=deploy-avesmaps-strato.yml --status in_progress --limit 1
```

Läuft einer → **warten**, bis er durch ist, dann erneut prüfen. Läuft nach zwei Versuchen
immer noch einer → heute nicht pushen, Arbeit verwerfen, morgen wieder. (`gh` ist vorhanden,
Version 2.92.0 geprüft.)

🔴 **Und nach dem eigenen Push:** den eigenen Lauf bis zum Ende beobachten. Bricht er ab
(weil jemand direkt danach gepusht hat), gilt der Schritt als **nicht ausgeliefert** — das
heilt nur durch eine Inhaltsänderung, nie durch einen grünen Folgelauf. Dann: melden, nicht
stillschweigend als erledigt verbuchen.

### 6.3 Push

Rebase statt Force: `git fetch` + `git rebase origin/master` (autostash) + erneut versuchen.
Danach Remote-SHA prüfen. ⚠️ Hat sich die **Zieldatei** auf `origin/master` während des Laufs
geändert, wird die Arbeit **verworfen** statt rebased — der Schnitt wurde gegen einen anderen
Dateistand geplant. Kostet einen Lauf und sonst nichts.

---

## 7. Wann sie läuft

**Täglich 08:00 Uhr Ortszeit.**

- Es ist die gemessen **ruhigste Stunde** (46 Commits über 60 Tage; das Maximum liegt bei 240
  um 14h). Das senkt genau das eine Restrisiko aus §6.2.
- Sie kollidiert mit keiner bestehenden Routine: `handbuch-pflege` 00:00, `feature-updates`
  10:00, `daily-triage` 13:00, `daily-fixes` 14:00.
- Der Owner findet das Ergebnis morgens vor, nicht mitten in der eigenen Arbeit.

---

## 8. Wieviel sie schafft

**Ein Schritt pro Tag — manchmal keiner.** Die M5-Splits sind das Maß: 3 Dateien, **250–730
verschobene Zeilen**, im Schnitt rund 400.

Hochrechnung, ehrlich gerechnet: die 19 Dateien über 2000 Zeilen tragen 61.865 Zeilen. Nicht
alles davon soll oder kann wandern (Zustand, Ladezeit-Code und IIFE-Module bleiben).
Realistisch sind die zehn größten in ein bis zwei Monaten wieder im Bereich von rund 1500
Zeilen — sofern die Routine nicht mehr gegen Rückwuchs kämpft, als sie abträgt. Genau das
misst §10.

⚠️ **Kein Tagessoll.** Ein Tag ohne Schritt ist ein gutes Ergebnis, kein Versagen —
derselbe Satz wie bei `handbuch-pflege`.

---

## 9. Merkzettel und Liste

- `state.md`: `last_run: <datum>` und `last_commit: <sha>`.
- `liste.md`: das negative Gedächtnis aus §3.4 — ein Abschnitt `## Verworfen` mit je einer
  Zeile `<datei> · <datum> · <grund>`, dazu ein Abschnitt `## Für den Owner` für Funde, die
  die Routine nicht selbst anfassen darf (§2).

Beides neben der Routine unter `…/scheduled-tasks/avesmaps-refactoring/`.

---

## 10. Die monatliche Bilanz

Einmal im Monat ein kurzer Bericht **an den Owner** (nicht nach Discord, keine Zielsuche):
Wie haben sich die 19 Brocken entwickelt — schrumpfen sie, oder wächst mehr nach, als die
Routine abträgt? Das ist die Frage, die uns `review-wiki-sync.js` (692 → 4253) gestellt hat.
Bleibt die Bilanz zwei Monate negativ, ist nicht die Routine falsch eingestellt, sondern die
Antwort lautet: es braucht wieder eine Kampagne.

---

## 11. Owner-Entscheide (2026-08-31, alle drei getroffen)

1. 🔴 **Bericht: still, außer bei einem tatsächlichen Schritt.** Kein Discord-Post — ein
   Innenumbau ist keine Neuigkeit für Editoren; die Rückmeldung geht an den Owner.
   **Ausnahme:** der allererste Lauf meldet in jedem Fall, damit der Owner den Ablauf einmal
   sieht (`runs: 0` im Merkzettel).
2. 🔴 **`daily-fixes` wird nachgezogen** — Wegwerf-Worktree statt geteiltem Checkout, plus
   der Deploy-Riegel aus §6.2. Erledigt am 2026-08-31.
3. 🔴 **Erste Ziele: frei nach Rangliste.** Kein künstlich harmloser Einstieg — die Riegel
   (Abkühlfrist, Ausschlussliste, Fingerabdruck, Testtor, „im Zweifel nichts") sind der
   Schutz, nicht die Zielauswahl.

## 12. Gebaut

- Routine `avesmaps-refactoring`, täglich 08:00 Ortszeit
  (`C:\Users\mail\.claude\scheduled-tasks\avesmaps-refactoring\`), samt `state.md` und
  `liste.md`.
- `avesmaps-daily-fixes` um Worktree- und Deploy-Riegel ergänzt.

⭐ **Die Testtor-Gegenprobe ist selbstprüfend gebaut**, nicht als feste Zahl: die Routine
zählt ihr `-print0`-Muster gegen die Form des Workflows selbst und bricht bei Abweichung ab.
Eine hart notierte Zahl veraltet — am 2026-08-31 waren es **397 JS / 341 PHP**, während in
AGENTS.md noch 312/310 vom 26.08. stehen. Verifiziert: beide Formen liefern denselben Wert,
und die Form **ohne** äußere Klammer liefert 22 statt 397 — die dokumentierte Falle ist real.

🔧 **Offen:** Der erste echte Lauf hat noch nicht stattgefunden. Bis dahin ist ungeprüft, ob
die Rangliste im Worktree genauso rechnet wie im Hauptbaum und ob der `gh`-Riegel unter der
Routine (nicht in einer Owner-Sitzung) dieselben Rechte hat.
