# Wiki-Zuweisung — ein Bauteil, das seine Felder aus einer Erklärung kennt

**Datum:** 2026-08-15 · **Auftraggeber:** Owner
**Auslöser:** Owner beim Ansehen der frisch gebauten Kraftlinien-Zuweisung: „kannst du die wiki
zuweisung nicht wie bei den anderen features machen mit der auto-completion suche? … ich will
generell auf das system umstellen."
**Mockup:** `docs/wiki-zuweisung-mockup.html` (zweite Fassung, mit den echten Editor-Klassen)
**Bezug:** AGENTS.md §5 (eine Ablage, kein zweites System), §9 (Abnahme heißt Ablauf), §12
(Designsprache) · `docs/superpowers/specs/2026-08-14-wikisync-listen-vereinheitlichung-design.md`
(dasselbe Muster, eine Ebene tiefer) · `docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md`
(die Vorschau-Formensprache, die hier wiederverwendet wird)

---

## 1. Ausgangslage, gemessen

Zehn Oberflächen führen dieselbe Handlung aus — „welcher Wiki-Artikel gehört zu diesem Objekt".
Der Owner hat sie am 15.08.2026 einzeln benannt und bebildert.

**Die Optik ist bereits geteilt.** `.label-wiki-reference*` und `.label-wiki-picker*` stehen einmal
in `css/components/region-sync.css` (21 Regelblöcke); die Editorfenster benutzen die `.dt-*`-Familie
aus `css/components/editor-page.css`. Vervielfältigt ist das **Verhalten**:

| Datei | Zeilen |
|---|---|
| `js/review/review-settlement-wiki.js` | 474 |
| `js/review/review-path-wiki.js` | 406 |
| `js/review/review-label-wiki.js` | 379 |
| `js/review/review-region-wiki-picker.js` | 174 |
| Landschaften-Eigenschaften (in `map-features-ecosystem-properties.js`) | verstreut |
| Kraftlinien (15.08.2026 gebaut) | Auswahlliste am Textfeld |

Rund 1.400 Zeilen für denselben Tanz: Auswahl öffnen, suchen, Treffer zeigen, wählen, zuweisen,
entfernen. Drei davon (`settlement`, `path`, `label`) rufen wortgleich
`?action=search&q=…&limit=40` gegen ihren eigenen Endpunkt und rendern eine Trefferzeile aus Name
plus einer `·`-verbundenen Meta-Zeile. Eine (`region`) filtert im Browser. Eine (Landschaften-
Eigenschaften) sucht erst **auf Knopfdruck** — der einzige Unterschied, den ein Editor sofort
bemerkt, weil dort scheinbar nichts passiert.

🔴 **Das ist dasselbe Muster wie bei den Listenzeilen** (§11 AGENTS.md): dort waren es sieben
Rezepturen, daraus wurden zwei. Hier sind es sechs.

## 2. Owner-Entscheidungen (15.08.2026)

1. 🔴 **Umgestellt wird generell** — alle Oberflächen bekommen dasselbe System
   (Zuweisen / Ändern / Sync / Entfernen plus Suche).
2. 🔴 **In EINEM Zug**, nicht Oberfläche für Oberfläche. Der Owner hat die Bündel-Warnung
   (AGENTS.md §9, „sichtbare Änderungen gehen EINZELN live") ausdrücklich gehört und anders
   entschieden. **Konsequenz, die daraus folgt:** auf `master` ist „nichts geht live, bis alles
   fertig ist" nicht machbar — jede Parallelsitzung nimmt mit ihrem Push fremde Commits mit
   (am 15.08.2026 zweimal passiert). Die Arbeit läuft deshalb auf einem **eigenen Zweig** und wird
   am Ende in einem Rutsch zusammengeführt.
3. **„Sync" behält seinen Namen** (Owner: „sync is gut").
4. 🔴 **Sync zeigt erst, was er ändern würde, und nimmt Häkchen** — statt wie heute unbedingt zu
   überschreiben.
5. **Karten (Stadtpläne) bekommen die Zuweisung**, wo das Wiki einen Artikel führt („gibt natürlich
   auch welche von uns" — die übrigen tragen den dritten Zustand).
6. **Vorkommen bleiben außen vor.** Ihr „Wiki Aventurica ↗ · fest" ist eine **Quellenangabe**, keine
   Objekt-Zuweisung.
7. **Der dritte Zustand „Kein Wiki-Artikel vorhanden" gilt für ALLE** Objektarten.
8. 🔴 **Keine automatische Felder-Erkennung.** Der Owner hatte sein GO zunächst daran geknüpft; auf
   den Widerspruch hin entschieden: **eine Erklärung je Objektart, eine Zeile je Feld** — siehe §3
   und die Begründung in §3a.
9. 🔴 **Gesperrte Eltern werden nicht neu gesynct** (Owner: „solang das ist, darf das elternteil
   nicht neu synct werden (graus aus oder so)") — siehe §7.

## 3. Das Feldregister — der Kern

Das Bauteil weiß **nichts** über Orte, Wege oder Kraftlinien. Es liest eine Erklärung je Objektart:

```
Objektart   suche:   <woher die Treffer kommen>
            treffer: <welche Felder die zweite Zeile eines Treffers bilden>
            felder:  <Wiki-Feld> → <Kartenfeld>   (je Zeile eins)
            sync:    ja | nein
            extra:   <objektart-eigene Zusätze, z. B. der dritte Zustand>
```

Daraus **leitet die Maschine ab**: die drei Zustände · die Trefferliste samt Meta-Zeile · die
Sync-Vorschau samt Diff und Vorhäkelung · welche Knöpfe erscheinen · die Warnung „hängt schon
woanders". Eine neue Objektart kostet eine Erklärung, keinen Code. Ein neues Feld kostet **eine
Zeile**.

### 3a. Warum keine Automatik — belegt, nicht behauptet

Die Zuordnung Wiki-Feld → Kartenfeld ist **nicht ableitbar**:

- 💣 Dasselbe Wiki-Feld **„Art"** zeigt je Objektart woandershin: bei der Landschaft auf den
  Regionstyp, beim Weg auf `feature_subtype`, beim Ort auf die Ortsart. Gleiche Beschriftung, drei
  verschiedene Ziele.
- 💣 Die Landschaft braucht zusätzlich `avesmapsWikiRegionArtToSubtype` **und** die Regel, dass aus
  einer mehrwertigen Art („Tal|Grube") nur die **erste** Komponente gilt
  (`map-features-ecosystem-properties.js`). Das ist eine Entscheidung, keine Ableitung.
- 💣 Die Kraftlinien führen vier Wiki-Felder (Stärke, Affinität, Länge, Regionen), die auf **gar
  kein** bearbeitbares Feld zeigen.

Eine Automatik müsste raten, und Raten schreibt echte Daten — die Fehlerklasse aus Discord #38.

### 3b. Was die Sicherheit stattdessen herstellt: eine Prüfung, die schreit

Statt eines Versprechens ein Test, der **rot wird**, wenn Erklärung und Wirklichkeit auseinandergehen:

1. Ein erklärtes **Kartenfeld**, das es bei dieser Objektart nicht gibt ⇒ rot.
2. Ein **Wiki-Feld**, das der Parser dieser Objektart liefert und das **keine** Erklärung für sich
   beansprucht ⇒ rot. *Das ist die Zeile, die „vergessen" sichtbar macht.*
3. Eine Objektart im Register **ohne** Erklärung ⇒ rot.

⭐ Eine Zusage kann gebrochen werden, eine rote Prüfung nicht übersehen. **Punkt 2 ist die
eigentliche Antwort auf die Frage des Owners** („robust genug, alle betreffenden Felder zu
erkennen").

## 4. Das Bauteil

**Drei Zustände**, in jeder Oberfläche dieselben:

| | |
|---|---|
| **offen** | „Kein Wiki-Artikel zugeordnet." · Knopf **Zuweisen** · Häkchen „Kein Wiki-Artikel vorhanden" |
| **Suche** | Suchfeld (tippt mit) · Trefferliste (Name + Meta-Zeile) · Tastatur ↑ ↓ Enter Esc |
| **zugewiesen** | Feldliste aus der Erklärung · **Wiki ↗** · Knöpfe **Ändern / Sync / Entfernen** |

⚠️ **Leere Felder fallen weg, sie stehen nicht leer da.** Am Original gemessen: „Madas Kelch" führt
weder Stärke noch Länge, „Yaquirlinie" ebenso wenig — von fünf geprüften Kraftlinien-Artikeln haben
**zwei** Lücken. Ein Kasten mit fester Zeilenzahl verspräche, was das Wiki oft nicht hergibt.

💣 **Der Sync-Knopf hängt an den FELDERN, nicht am Abgleich.** Die Kraftlinien haben einen
Massenlauf, aber kein bearbeitbares Feld, das er füllen könnte — dort erscheint kein Knopf. Die
erste Mockup-Fassung hatte das falsch herum.

### 4a. Zwei Skins, und das ist die Obergrenze

`.dt-*` im **Editorfenster**, `.label-wiki-*` im **Kartendialog**. Das ist derselbe bewusste Schnitt
wie bei den Listenzeilen (AGENTS.md §11: „es gibt ZWEI, und das ist die Obergrenze") — eine je
Behälter. **Ein Bauteil, zwei Hüllen**: gleiche Logik, gleiche Zustände, gleiche Vorschau.

🔴 **Kein dritter Skin.** Wer eine neue Oberfläche anschließt, nimmt eine der zwei.

⚠️ Die Editorfenster sind **iframes mit eigenem Dokument** und laden ihre Stylesheets selbst. Ein
Bauteil, das die Regeln aus `region-sync.css` voraussetzt, ist dort unsichtbar gestylt — die CSS
muss dort mitgeladen werden.

## 5. Die Suche

**Überall tippt man**, kein „Suchen"-Knopf. Die Erklärung sagt, *woher* die Treffer kommen — der
Server (`?action=search&q=…&limit=40`) oder der Browser (Kraftlinien: 23 gestagte Artikel, kein
Server nötig). Das Bauteil merkt den Unterschied nicht.

**Tastatur:** ↑ ↓ wählen, Enter zuweisen, Esc schließen. Bei vielen Zuweisungen hintereinander
spart das jedes Mal den Griff zur Maus.

**Ein Treffer sagt im Treffer, wenn er schon woanders hängt** — vor dem Klick, nicht danach. Die
Label-Liste kann das heute schon, die anderen fünf nicht.

🔴 **Freie Adressen bleiben draußen.** Wer eine Nicht-Wiki-Quelle hinterlegen will, tut das im
Quellen-Abschnitt (bei den Wegen heißt er schon „Andere Quelle"). Ein Zuweisungsfeld, in das man
alles tippen kann, ist der Grund, warum bei den Kraftlinien ein Tippfehler unsichtbar blieb
(15.08.2026).

## 6. Sync — erst zeigen, dann anhaken, dann übernehmen

**Was Sync heute tut** (`syncFromWikiRegion`, Landschaft — die einzige Stelle, die ihn hat): er
schreibt den Wiki-Namen und die Wiki-Art **unbedingt** in die Formularfelder und **speichert nicht**;
danach steht „Aus dem Wiki übernommen — noch nicht gespeichert". Ein von Hand getippter Name wird
ersetzt.

**Warum das nicht bleiben kann:** bei zwei Feldern geht es. Beim **Ort** sind es fünf, darunter
Einwohnerzahl und Herrscher — Angaben, die jemand von Hand korrigiert haben kann, weil das Wiki
veraltet ist. Ein Sync, der das kommentarlos zurückdreht, frisst genau die Arbeit, die jemand bewusst
gemacht hat.

**Also dieselbe Form wie bei den Massenläufen** (`docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md`):

- 💣 **Nur Unterschiede stehen in der Liste.** Was ohnehin übereinstimmt, wäre Rauschen — in einem
  Kasten voller Häkchen sucht man sonst die eine Zeile, die zählt.
- 🔴 **Vorangehakt ist, was ändert — nicht, was leert.** Sagt das Wiki zu einer Angabe nichts,
  während auf der Karte etwas steht, ist das der Fall „Gelöscht" der großen Vorschau: er steht drin,
  aber ohne Haken.
- ⚠️ Eine Angabe, die **von Hand gesetzt** wurde, ist als solche markiert und startet ungehakt.
- ⚠️ **Übernehmen füllt weiterhin nur das Formular.** Gespeichert wird mit „Speichern" — daran
  ändert die Vorschau nichts, sie nimmt nur die Überraschung heraus.
- Sind alle Angaben gleich: „Alles stimmt bereits mit dem Wiki überein — nichts zu übernehmen."
  Keine leere Liste.

## 7. 🔴 Gesperrte Eltern werden nicht neu gesynct

`parent_locked = 1` in `wiki_territory_model` ist ein **bewusster Editor-Override, den der Dump
nicht reproduzieren soll** — der Massenabgleich respektiert ihn bereits: die Drift-Prüfung schließt
gesperrte Schlüssel ausdrücklich aus (`dump-compare.php`, A2), und der Sync bewahrt sie
(`dump.php`).

**Für den neuen Knopf gilt dasselbe, aber sichtbar:** bei gesperrten Eltern ist „Sync" **ausgegraut**,
mit dem Grund daneben. 💣 **Nicht still überspringen** — ein Knopf, der drückbar aussieht und nichts
tut, ist schlimmer als einer, der erklärt, warum er nicht kann.

⚠️ Die Sperre gilt der **Elternbeziehung**, nicht dem ganzen Objekt: die übrigen Felder eines
gesperrten Territoriums dürfen weiterhin übernommen werden. Der Riegel gehört also an die
Feldzeile „Eltern", nicht an den Knopf als Ganzes — sonst sperrt eine Entscheidung über die
Hierarchie auch den Namen.

## 8. 💣 Die Falle bei den Karten: dort heißt schon zweierlei „wiki"

| Feld | was es wirklich ist | Status |
|---|---|---|
| `citymap.wiki_key` | **Bauschlüssel** `index:stadt:quelle:variante` — sagt, aus welcher Index-Seite die Zeile stammt. Keine Seitenidentität. | 🔴 unangetastet |
| `citymap.wiki_url` | Link auf die **Publikation**, aus der die Karte stammt — nicht auf die Karte. | 🔴 unangetastet |
| *neu* | der **eigene Artikel** der Karte | ⭐ eigener Name |

An den ersten beiden hängt der laufende Karten-Abgleich; sie werden nicht umgedeutet. Dieselbe
Verwechslungsklasse wie *Literatur* gegen *Quellen* und „Neuigkeiten" gegen `changelog`.

⚠️ **Folge, die mitkommt:** `avesmapsConflictLoadMapRows` schließt Karten heute **ausdrücklich** aus,
*weil* ihr Schlüssel ein Bauschlüssel ist (`rules.php`, Kommentar). Sobald eine Karte einen echten
Artikel trägt, gehört sie in die Kollisionsprüfung — eine Zeile, aber sie muss bewusst gesetzt
werden, sonst teilen sich Karte und Ort still denselben Artikel.

## 9. Die zehn Oberflächen

| Oberfläche | heute | Skin |
|---|---|---|
| Landschaft · Regionen-Editor | Formularblock mit Wiki-URL von Hand | `.dt-*` |
| Landschaft · Karten-Dialog | Ändern / Sync / Entfernen ✅ Zielform | `.label-wiki-*` |
| Ort · Orte-Editor | nur eine Zeile „Wiki-Ort … ↗" | `.dt-*` |
| Ort · Karten-Dialog | Ändern / Entfernen — **kein Sync** | `.label-wiki-*` |
| Weg · Wege-Editor | „Verknüpft … ↗" + Hinweis, dass es woanders läuft | `.dt-*` |
| Weg · Karten-Dialog | Ändern / Entfernen — **kein Sync** | `.label-wiki-*` |
| Territorium | eigene Form, Overrides-Tabelle | `.dt-*` |
| Kraftlinie | Textfeld + dritter Zustand (15.08. gebaut) | `.dt-*` |
| Literatur | Wiki-URL als freies Textfeld | `.dt-*` |
| Karte (Stadtplan) | keine Zuweisung | `.dt-*` |

## 10. Abnahme

**Tests:**
- Die Register-Prüfung aus §3b (drei Fälle, jeder einzeln rot zu bekommen).
- Die reine Diff-Rechnung der Sync-Vorschau: gleich ⇒ nicht gelistet · geändert ⇒ gehakt ·
  leerend ⇒ gelistet, **nicht** gehakt · von Hand gesetzt ⇒ markiert, nicht gehakt.
- Gesperrte Eltern: die Feldzeile „Eltern" ist gesperrt, die übrigen nicht.
- Je Objektart eine Probe, dass ihre Erklärung eine vollständige Trefferzeile und einen
  vollständigen Zuweisungs-Kasten ergibt.

🔴 **Abnahme heißt ABLAUF** (AGENTS.md §9): vor „fertig" wird in **jeder** der zehn Oberflächen
wirklich zugewiesen, wirklich gesynct, wirklich entfernt. Eine Maßtabelle ist kein Beleg.

⚠️ **Vor dem Zusammenführen läuft das ganze Testfeld**, inklusive `tools/wikidump/test-*.php` — das
dokumentierte Muster findet die nicht.

## 11. Nicht in dieser Fassung

- 🔧 **Vorkommen** (Owner-Entscheid §2.6).
- 🔧 **Ein dritter Skin.** Wer eine Oberfläche findet, in die keine der zwei Hüllen passt, meldet
  das, statt eine dritte zu bauen.
- 🔧 **Die Massenläufe** („⚡ … syncen") bleiben, wie sie sind. Sie und der Knopf im
  Zuweisungsblock heißen beide „Sync", tun aber Verschiedenes: der eine schreibt für alle Objekte
  direkt in die Daten, der andere holt für **ein** Objekt in die Formularfelder. Der Owner hat den
  Namen bewusst behalten; die Doppeldeutigkeit bleibt damit bestehen und ist hier festgehalten,
  nicht aufgelöst.
