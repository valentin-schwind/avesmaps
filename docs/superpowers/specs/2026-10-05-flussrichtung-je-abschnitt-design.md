# Strömungsrichtung je Abschnitt — Entwurf (2026-10-05)

> Meldung von **Thomas** (#7996): „Bei der Funktion ‚Richtung vervollständigen‘ kommt ein Fehler:
> Main Chain is already fully directed. Konsequenz: Fehlende Strömungsrichtung an einigen
> Teilabschnitten. Außerdem macht er an einigen Teilabschnitten die Strömungsrichtung falsch und
> die einzelnen Abschnitte lassen sich nicht umkehren, nur der gesamte Fluss. Wo? Großer Fluss –
> Delta.“
>
> Vorgänger: `2026-07-05-flussrichtung-design.md` (§6) und
> `2026-07-06-flussrichtung-set-dir-anker-design.md`. Dessen §103 hat diesen Fall benannt und
> aufgeschoben: **„KEIN Richten von Abzweigen (GF-Drift bleibt dirlos; eigenes Feature, falls je
> gewünscht).“** — „GF“ ist der Große Fluss. Es ist jetzt gewünscht.

## 1. Der Befund, gemessen

Alle drei Teile der Meldung sind echt und haben **eine** Wurzel: `set_dir` richtet ausschließlich
die **Hauptkette** (längster Pfad zwischen zwei losen Enden, je Komponente). Ein Delta besteht
fast nur aus Abschnitten *daneben*.

Live gemessen am 2026-10-05 (Nutzlast-Revision 166587, die echten Serverfunktionen auf der echten
Geometrie — `avesmapsPathFlowChainOrientation` / `…PlanSetDir`):

| Der Große Fluss | |
|---|---|
| Abschnitte | **79** |
| gerichtet | 55 |
| **ohne Richtung** | **24** |
| davon auf der Hauptkette | **0** |
| davon Abzweigungen | 22 |
| davon zu kurze Stummel | 2 |
| Hauptkette umfasst | 44 von 79 |
| `set_dir` würde richten | **0** → der Fehler |

**Bestand: 28 Flüsse** werfen denselben Fehler, zusammen **58 Abschnitte ohne Richtung** — und das
sind **zwei unabhängige Ursachen**:

- **29 Abzweigungen** (22 davon allein im Großen Fluss) — der Delta-Fall.
- **29 Stummel** — Abschnitte **kürzer als `AVESMAPS_PATH_FLOW_ENDPOINT_EPS` (1,0)**. Der
  Endpunkt-Clusterer zieht ihre beiden Enden zu *einem* Knoten zusammen (`$keyA === $keyB` →
  `continue`), sie sind damit aus dem Kantengraph geworfen und **nie** richtbar. Betrifft 27
  weitere Flüsse (Yaquir, Born, Tommel, Szinto …) und hat mit Deltas nichts zu tun.

**Die falschen Richtungen sind belegt**, über die Massenerhaltung geprüft (an einem Knoten mit
Grad ≥ 2 muss mindestens ein Arm hinein *und* einer hinaus fließen): **5 Knoten in 3 Flüssen**
widersprechen sich — Großer Fluss `[343,4 | 496,4]` (Grad 3, rein=0, raus=2: dort entsteht Wasser
aus nichts), dazu Mhanadi-Delta (2) und Rathil (2), beide ebenfalls Deltas.

## 2. Warum keine Automatik

🔴 **Eine Geometrie-Automatik löst das nicht, und das ist gemessen, nicht vermutet.** Von den 22
Armen des Großen Flusses sind in einem Durchgang **0** eindeutig entscheidbar: 13 berühren die
gerichtete Kette nur mit *einem* Ende, 8 mit *keinem*, 1 ist mehrdeutig. Das Delta ist ein
zusammenhängendes Netz ungerichteter Arme.

Der Grund ist grundsätzlich und steht schon im Code: ob ein Arm an einer Verzweigung ein **Zufluss**
oder ein **Deltaarm** ist, ist geometrisch unentscheidbar. Am Knoten sieht beides gleich aus
(Kette rein, Kette raus, dritter Arm offen). Entscheiden kann das nur, wer die Karte kennt.

⭐ Daher ist **Thomas' dritter Punkt die Lösung für seine ersten zwei**: Richtung je Abschnitt
setzen und umkehren. Das räumt alle drei Befunde ab **und** die 29 Stummel, die sonst ein eigenes
Feature bräuchten. Eine Delta-Automatik bleibt denkbar (Fortpflanzung von den Berührpunkten,
Meer-Erkennung) und ist ausdrücklich **nicht** Teil dieses Entwurfs.

## 3. Was gebaut wird

### 3.1 Server: `set_flow` lernt den Abschnitt

Heute nimmt `avesmapsWikiPathSetFlow` genau drei Wünsche, **alle way-weit**: `flip`, `set_dir`,
`factor`. Neu:

- **`scope: "segment"`** (Vorgabe `"way"`) — begrenzt `flip` auf den genannten `public_id`.
- **`dir: "forward" | "reverse"`** — setzt die Richtung **eines** Abschnitts direkt. Das ist der
  Parameter, den `2026-07-05-flussrichtung-design.md` §6 als `flip?|dir?` schon vorsah und den
  nie jemand gebaut hat.

🔴 **`scope` gilt NUR für `flip`.** Der Strömungsfaktor ist per Owner-Design way-weit („gilt
weg-weit“, §6 des Ursprungsentwurfs) und wird nicht angefasst; `set_dir` ist von Natur aus eine
Aussage über die Kette. Ein `scope` an allen dreien wäre eine Regel mit drei Bedeutungen.

💣 **`dir` und `set_dir` schließen sich aus**, genau wie `flip` und `set_dir` heute — und `dir`
verlangt `scope: "segment"` nicht, es **ist** segmentbezogen. Beides wird am Eingang abgewiesen,
nicht stillschweigend sortiert.

💣 **Die Zielmenge bleibt die Way-Gruppe, auch beim Einzelschreiben.** `avesmapsWikiPathFlowApplyWrites`
nimmt `$waySegments` und schreibt nur, was dort steht — ein `public_id`, der nicht zur Gruppe
gehört, darf nicht durch eine Abkürzung hineinkommen. Der Einzelfall ist ein **gefiltertes**
`$writes`, keine zweite Schreibfunktion. Audit (`avesmapsWikiSyncAuditFeaturePropsChange`),
Revisionsbump und Undo-Fähigkeit bleiben damit unverändert gültig.

⚠️ `source` wird beim Einzelschreiben `editor` — wie bei jedem Handgriff. Ein späterer
Wiki-Sync-Apply überschreibt das (Anforderung 4 des Ursprungsentwurfs); das ist unverändert und
gilt für Abzweigungen ohnehin nicht, weil der Verlauf-Sync sie nie erreicht.

### 3.2 „Nichts zu tun“ ist kein Fehler mehr

💣 Heute wirft `set_dir` bei fertiger Hauptkette eine `RuntimeException` → HTTP 409 → der Client
zeigt den **englischen** Satz „Main chain is already fully directed (use flip).“ Editoren sehen
eine deutsche Oberfläche, und der Satz sagt das Falsche: fertig ist die *Hauptkette*, nicht der
Fluss — während 24 Abschnitte ohne Richtung sind.

Neu antwortet dieser Fall mit **`ok: true`** und einer Zusammenfassung (`directed: 0`, dazu die
Zahl der offenen Abzweigungen und Stummel). Die Oberfläche sagt dann, was wirklich gilt:

> „Die Hauptkette ist vollständig gerichtet. 22 Abzweigungen und 2 sehr kurze Abschnitte brauchen
> eine Entscheidung — dafür gibt es ‚Richtung setzen‘ am einzelnen Abschnitt.“

🔴 **Die anderen Absagen bleiben Fehler** (`anchors_conflict`, `no_anchor_on_chain`, `no_chain`):
dort ist wirklich etwas zu klären. Nur „es gibt nichts zu tun“ hört auf, ein Fehler zu sein.
⚠️ Der Client prüft `result.ok !== true` und wirft — mit `ok: true` läuft er in den Erfolgspfad,
die Meldung muss also im Erfolgspfad richtig sein, nicht im `catch`.

### 3.3 Oberfläche: „dieser Abschnitt“ neben „ganzer Fluss“

Die Strömungs-Sektion (`#path-flow-section`, zwei Spalten seit 31.08.2026) bekommt links eine
Trennung in zwei Gruppen — **durch Zwischenzeile, nicht durch Kästen** (AGENTS §12):

```
Richtung: unbekannt
  Dieser Abschnitt   [ Richtung setzen ]
  Ganzer Fluss       [ Richtung festlegen ]  [ Richtung vervollständigen ]
```

Bei gerichtetem Abschnitt heißt der erste Knopf **„Pfeil umdrehen“**, bei gerichtetem Fluss der
zweite **„Richtung umdrehen (ganzer Fluss)“** (unverändert).

🔴 **Die Richtungswahl ist ein Pfeil, kein Koordinatensystem.** „Richtung setzen“ setzt
`dir: "forward"` — also entlang der Zeichenrichtung — und der Editor *sieht* den Pfeil und dreht
ihn bei Bedarf mit einem Klick. Das ist genau das Muster, das der Ursprungsentwurf für die ganze
Kette schon festgelegt hat: „welches Ende, ist egal — der Editor prüft die Pfeile und drückt bei
Bedarf einmal ‚umdrehen‘“. ⚠️ `forward`/`reverse` sind Zeichenrichtung und für einen Menschen
bedeutungslos; die Wörter erscheinen **nie** in der Oberfläche.

⚠️ Alle Knöpfe bleiben weich/outline (`--color-button-soft`): keiner davon ist die Haupthandlung
des Dialogs, das ist „Speichern“.

💣 **Die Strömungspfeile sind nur im Bearbeiten-Modus sichtbar** (`map-features-river-flow-arrows.js`).
Ein Knopf, dessen Wirkung man nicht sieht, ist unbedienbar — die Sektion gehört ohnehin in den
Editor-Dialog, aber der Nachzug (`avesmapsRedrawRiverFlowArrows`) ist nach dem Einzelschreiben
genauso Pflicht wie heute nach dem way-weiten.

💣 **Der Popup-Shortcut (`submitPathFlowShortcut`) bleibt way-weit.** Er hat genau zwei Zustände
(gerichtet → umkehren, ungerichtet → festlegen) und ist der Ein-Klick-Weg für den Normalfall. Ein
dritter Zustand dort wäre ein Menü im Popup; der Einzelgriff gehört ins Detailpanel. ⚠️ Das ist
dieselbe Grenze, die der Anker-Entwurf schon gezogen hat („Vervollständigen bleibt bewusst im
Detailpanel“).

## 4. Fallen, die beim Bauen zuschlagen werden

- 💣 **Der Knopf „Richtung vervollständigen“ ist heute an `directedCount < waySegments.length`
  gebunden** und wird deshalb bei offenen Abzweigungen gezeigt, obwohl er nichts tun kann. Er
  bleibt sichtbar — aber er antwortet jetzt mit einer Auskunft statt mit einem Fehler. Die
  Sichtbarkeitsregel selbst wird **nicht** verschärft: ob ein offener Abschnitt auf der Kette
  liegt, weiß nur der Server, und ein Client, der es nachrechnet, wäre die zweite Wahrheit.
- 💣 **`avesmapsPathFlowPlanFlip` darf nicht verbogen werden.** Es ist eine reine Funktion über
  eine Flow-Tafel; der Einzelfall reicht ihr eine Tafel mit **einem** Eintrag, statt in ihr einen
  Scope-Zweig zu bauen. Sie hat heute drei Aufrufer-Pfade, und ein Zweig in ihr wäre in allen drei
  zu prüfen.
- ⚠️ **Ein Einzel-`flip` auf einem ungerichteten Abschnitt tut nichts** (PlanFlip überspringt
  dirlose Segmente, „flip never invents direction“). Dann greift „Richtung setzen“ — die
  Oberfläche zeigt je Zustand nur den passenden Knopf, aber der Server muss den Fall trotzdem
  klar beantworten statt leer zu laufen.
- ⚠️ **Die zwei Stummel des Großen Flusses sind Daten, keine Anzeige.** Sie werden mit diesem
  Umbau richtbar, aber sie bleiben aus dem Kantengraph geworfen — `set_dir` wird sie auch künftig
  nie erreichen, und das ist richtig: ein Abschnitt von 0,44 Einheiten hat keine verlässliche
  Lage im Knotengraph. 🔧 Ob die 29 Stummel repoweit zusammengelegt oder verlängert werden
  sollten, ist eine Datenfrage für den Owner, kein Code-Problem.
- 🪤 **Die Fehlermeldung steht in einem `match`-Ausdruck** über `$plan['reason']`. Der Fall „alles
  gerichtet“ läuft heute *nicht* darüber, sondern über ein eigenes `if` danach — wer nur das
  `match` liest, findet ihn nicht.

## 5. Abnahme

Tests:

- `tools/paths/test-path-flow-engine.php` — die Nulllinie ist **57 Checks, 0 Fehler** (gemessen
  2026-10-05). Neu: Einzel-`flip` über eine Ein-Eintrag-Tafel, `dir` auf einem Abschnitt, und die
  Zusicherung, dass die Way-Tafel dabei unberührt bleibt.
- `api/_internal/wiki/__tests__/flussrichtung-je-abschnitt-test.php` (neu) — `scope`/`dir` am
  Eingang (Ausschlüsse, fremder `public_id` wird abgewiesen), und dass „Hauptkette fertig“ mit
  `ok: true` antwortet statt zu werfen.
- `js/review/__tests__/stroemung-zwei-spalten.test.js` — bestehend, hält die Zwei-Spalten-Form;
  wird um die zwei Gruppen erweitert. Der Zustandsbauer `renderPathFlowSection` wird dabei
  **ausgeführt**, nicht gelesen (die Lehre aus dem Ribbon-Unterzeilen-Fehler vom 10.09.2026: ein
  Regex über den Quelltext hätte dort sechs Tage lang nichts gemerkt).

Ablauf am echten Fall (⚠️ **Abnahme heißt Ablauf, nicht Maß**, AGENTS §9):

1. Großer Fluss, Delta bei `[345 | 500]`, Bearbeiten-Modus: einen Deltaarm anklicken, „Richtung
   setzen“ → ein Pfeil erscheint **an diesem** Abschnitt, die anderen 78 bleiben, wie sie waren.
2. „Pfeil umdrehen“ → der Pfeil dreht sich, und **nur** dieser.
3. „Richtung vervollständigen“ → deutsche Auskunft, kein Fehler, und sie nennt die richtige Zahl.
4. Den Widerspruchsknoten `[343,4 | 496,4]` auflösen und gegenmessen: die Massenerhaltungs-Probe
   (Skript aus dieser Sitzung) muss für den Großen Fluss auf **0** Knoten fallen.
5. Gegenprobe „ganzer Fluss“: „Richtung umdrehen (ganzer Fluss)“ dreht weiterhin alle 55+ Pfeile.

🔧 **Für den Owner:** Schritt 1–4 brauchen eine angemeldete Editor-Sitzung; ich kann sie bauen und
im Browser gegen die Live-Daten prüfen, aber das Schreiben gegen die echte Datenbank läuft unter
deinem Login.

## 6. Nicht-Ziele

> ⚠️ Lies dazu auch **§7 (Nachtrag vom Bau)** -- drei Zusagen dieses Entwurfs haben sich beim
> Bauen als falsch erwiesen.

- **Keine Delta-Automatik** (§2) — eigener Entwurf, falls gewünscht.
- **Kein Anfassen des Strömungsfaktors** — bleibt way-weit.
- **Keine Meer-Erkennung**, keine Höhendaten-Auswertung für die Flussrichtung.
- **Kein Umbau der 29 Stummel** in den Daten (🔧 Owner-Frage).
- **Keine Routing-Änderung** — `flow.dir` wird gelesen wie bisher.

## 7. Nachtrag vom Bau (2026-10-05, nach den Prüfagenten)

> 🪤 Dieser Abschnitt steht hier, weil der Entwurf an drei Stellen **falsch** war. Er wird
> bewusst **nicht rückwirkend geschönt** — die Korrektur steht hier, die Irrtümer bleiben oben
> lesbar. Gefunden haben das die Agenten `usability-konsistenz` und `mockup-treue`, nicht die
> Tests.

### 7.1 💣 §3.1 war falsch: der Verlauf-Sync LÖSCHT Handarbeit an Abzweigungen

Oben steht: *„Ein späterer Wiki-Sync-Apply überschreibt das … und gilt für Abzweigungen ohnehin
nicht, weil der Verlauf-Sync sie nie erreicht."* Das war eine **Annahme, keine Messung**, und sie
ist falsch. `avesmapsPathFlowPlanWrites` macht `unset($new['dir'], $new['source'])` für **jeden**
Abschnitt, der nicht in der abgeleiteten Tafel steht — unabhängig von `source`. Durch Ausführung
belegt: ein Abzweig mit `source: editor` wird auf `null` gesetzt, einer mit Faktor behält nur den
Faktor.

**Folge ohne Korrektur:** ein Editor richtet 22 Deltaarme von Hand, und das nächste „Verlauf
übernehmen" am Großen Fluss löscht sie still. Genau die Arbeit, für die dieser Knopf bestellt
wurde.

🔴 **Die Korrektur zieht die Grenze an der Hauptkette:** der Verlauf-Sync besitzt die **Kette**
(ein Editor-Flip dort wird weiterhin überschrieben — Anforderung 4 des Ursprungsentwurfs), der
Editor besitzt die **Abzweigungen**. Das ist dieselbe Grenze, die `avesmapsPathFlowPlanSetDir`
seit dem 06.07.2026 schon zieht („*Anchors off the chain (spurs) … are only protected, never
consulted*") — der Sync-Pfad zog sie nicht. Neu: `avesmapsPathFlowEditorSpurDirs` (rein) und ein
dritter, **optionaler** Parameter an `PlanWrites`. ⚠️ Die Vorgabe ist leer: ein Aufrufer, der den
Schutz vergisst, verhält sich wie vorher — er löscht zu viel, er schreibt nichts Falsches. Das ist
die sichere Richtung. Es gibt genau **einen** Aufrufer (gezählt, nicht vermutet).

### 7.2 💣 Die Reihenfolge ist nicht frei: erst die Kette, dann die Arme

Nicht vorhergesehen: `avesmapsPathFlowPlanSetDir` wirft `no_anchor_on_chain`, sobald es Anker
gibt, aber **keinen auf der Kette**. Wer an einem ganz richtungslosen Fluss zuerst einen Abzweig
richtet, kann die Hauptkette danach **nicht mehr per Knopf** richten — am Großen Fluss wären das
44 Abschnitte von Hand. An der T-Form-Fixture gemessen.

⭐ Gelöst als **UI-Regel, nicht als Engine-Eingriff**: der Abschnitts-Knopf erscheint nur, wenn
der Fluss schon eine Richtung hat (`mehrteilig && wayHasDirection`). Das ist auch fachlich richtig
— wohin ein Deltaarm fließt, kann niemand entscheiden, solange der Hauptstrom keine Richtung hat
— und es kostet nichts, weil „Richtung festlegen (ganzer Fluss)" in genau diesem Zustand daneben
steht. Die Engine bleibt damit unangetastet; `no_anchor_on_chain` ist unverändert ein Fehler.

### 7.3 💣 Ein Leerlauf darf den Kartenstempel nicht anfassen

Weil „die Kette ist fertig" jetzt `ok: true` ist statt eines Wurfs, lief der Klick **durch** bis
zum `avesmapsWikiSyncNextMapRevision` im Endpunkt — vorher endete er davor. Jeder Klick auf
„Richtung vervollständigen" bei fertiger Kette hätte damit den ETag der ~21-MB-Kartennutzlast für
**jeden Besucher** entwertet, ohne dass sich ein Byte geändert hat. Der Bump hängt für `set_flow`
jetzt an `writes > 0`; `avesmapsWikiPathFlowApplyWrites` bumpt ohnehin selbst, sobald es schreibt.

### 7.4 ⚠️ Abweichungen von §3.3, bewusst

- **Kein Layout mit Zwischenzeilen.** §3.3 skizziert zwei Gruppen („Dieser Abschnitt" / „Ganzer
  Fluss"). Gebaut ist die **Beschriftungs-Variante**: „(dieser Abschnitt)" gegen „(ganzer Fluss)".
  Grund: die Zwischenzeilen hätten eine neue CSS-Rezeptur gebraucht, die Beschriftung kostet keine
  — und „(ganzer Fluss)" ist seit dem Ursprungsentwurf die Hausformel. Das Mockup zeigt die
  gebaute Form.
- **Der Zusatz „(ganzer Fluss)" gilt BEIDEN Zweigen.** Der erste Bau band ihn nur an „festlegen",
  während „umdrehen" ihn unbedingt trug (so stand es schon vor diesem Umbau da) — ein einteiliger,
  gerichteter Fluss zeigte „Richtung umdrehen (ganzer Fluss)" ohne Gegenstück. Eine Regel an einem
  von zwei Erzeugern ist keine Regel.
- **Der Satz nennt auch offene KETTEN-Abschnitte** und verweist dann auf „Richtung
  vervollständigen" statt auf den Einzelknopf. Der Server liefert `undirected_on_chain`; zuerst
  hat es niemand gelesen, und die Meldung hätte den Editor von Hand durch etwas geschickt, das ein
  Klick erledigt.
- **Der Popup-Shortcut nutzt denselben Satzbauer.** Er trug seinen eigenen, zahllosen Wortlaut,
  während der Kommentar am Satzbauer einen einzigen Erzeuger behauptete.

### 7.5 🔧 Offen

- Der **Ablauf gegen die echte Datenbank** (angemeldete Editor-Sitzung) steht weiter aus — Punkt
  1–4 der Abnahme in §5.
- `anchors_conflict`, `no_anchor_on_chain` und `no_chain` bleiben Fehler, aber **kein Test hält
  das fest**. Die Reihenfolge-Sperre (7.2) macht `no_anchor_on_chain` in der Oberfläche
  unerreichbar; wer sie je lockert, braucht den Test.
- Die **29 Stummel** im Bestand bleiben eine Datenfrage für den Owner.
