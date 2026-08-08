# Steigungsmodell: verstehen, zeichnen, auf Widersprüche prüfen

> **Auftrag an eine neue Session.** Selbsttragend — du brauchst keinen Kontext aus der
> Vorsession. Stand: 2026-08-01. Vorarbeit: Nachprüfung von Commit `59d63251`
> („Reiseplan nennt die maximale Steigung").

## 0. Warum es diesen Auftrag gibt

Am 30.07.2026 hat ein DSA-Spieler das damalige Steigungsmodell öffentlich auseinander‑
genommen — zu Recht. Es wurde noch am selben Tag durch den **Leistungskilometer** ersetzt
(`83cddd08`). Am Tag darauf haben zwei weitere Spieler im Discord die *Beschreibung* dieses
neuen Modells auseinandergenommen — ebenfalls zu Recht.

Eine Nachprüfung fand **drei Widersprüche zwischen Beschreibung und Code**. Alle drei sind
Textfehler, keine Rechenfehler: 14 von 14 numerischen Aussagen des Geschwindigkeits-Dialogs
stimmen exakt mit dem Code. Der Rechenkern ist in Ordnung und öffentlich verteidigt.

**Die strukturelle Ursache:** Die Zahlen im Dialog sind durch `terrain-factor-test.php`
gedeckt, die **Worte durch nichts**. „DIN 33466" und „keine dieser Höhen jemals als Zahl"
konnten falsch werden, ohne dass ein Test rot wurde.

> ⚠️ Der Owner hat für diesen Auftrag **noch kein GO zur Umsetzung** gegeben. Aufgabe 1 und 2
> sind Erkenntnisarbeit, Aufgabe 3 ist eine Bestandsaufnahme. **Erst das Ergebnis zeigen,
> dann fragen, was gebaut werden soll.**

---

## 1. Aufgabe: Genau verstehen, was der Leistungskilometer tut

Ziel ist eine Erklärung, die der Owner einem Spieler weitergeben kann, ohne dass jemand sie
zerlegt. Nicht abschreiben, was im Code steht — **nachrechnen**.

**Die Regel** (aus `api/_internal/routing/terrain-factor.php`):

```
Leistungsmeilen = Meilen + Aufstieg/100 + Abstieg auf Hängen über 20 % Gefälle/150
Faktor          = Leistungsmeilen / Meilen
```

Konstanten: `AVESMAPS_TERRAIN_LKM_ASCENT_SCHRITT = 100`, `…_DESCENT_SCHRITT = 150`,
`…_DESCENT_THRESHOLD = 0.20`, `…_FACTOR_MAX = 4.0`. Kein Minimum — der Faktor kann
strukturell nicht unter 1,0 fallen, weil nur nicht-negative Terme addiert werden.

**Was du herausarbeiten sollst:**

1. **Die Kurzform.** Für reine Steigung gilt `Faktor = 1 + 10 × Steigung`, gedeckelt bei 4,0.
   Leite das her (1 Schritt = 1 m, 1 Meile = 1.000 Schritt = 1 km — die irdischen Konstanten
   *sind* die aventurischen, deshalb wurde das Modell gewählt). Verifiziere gegen den Code.
2. **Warum Gefälle asymmetrisch ist:** /150 statt /100, und erst über 20 %. Was folgt daraus
   für eine Route hin und zurück?
3. **Die 20-%-Schwelle gilt je Abtastschritt** (0,25 Karteneinheiten ≈ 750 Schritt), nicht im
   Etappenmittel — siehe `avesmapsTerrainDescentIsSteep`. Erkläre, warum das den Faktor
   *erhöht* gegenüber der Faustregel.
4. **Die implizierte Steiggeschwindigkeit.** Das war das Argument, das den Leistungskilometer
   gegen die alte Kurve und gegen Tobler gewinnen ließ: am Koschberge-Pass (668,98 Schritt auf
   2,799 Meilen = 23,9 %) impliziert er 317 Hm/h, die alte Kurve 490, Tobler 466. Normwerte:
   DIN 300, SAC 400. Rechne das nach — es beantwortet auch die offene Spielerfrage
   „geübte Wanderer oder Normalbevölkerung?".
5. **Die Abgrenzung** (siehe §4, Widerspruch 1): Leistungskilometer ≠ DIN 33466 ≠
   Alpenvereins-Methode. Arbeite heraus, was der Unterschied ist, damit die korrigierte
   Beschreibung ihn nicht erneut verwischt.

---

## 2. Aufgabe: Den Graphen zeichnen

Ein Bild, das die Discord-Diskussion beantwortet, ohne dass jemand nachfragen muss.

**Muss drin sein:**
- Faktor über **Steigung** 0…40 %, mit dem Deckel bei 4,0 (greift ab 30 %).
- Faktor über **Gefälle** 0…40 %, mit der **Kante bei 20 %** — der Punkt, über den zwei
  Spieler gestolpert sind. Bis 20 % flach auf 1,0, danach Anstieg mit /150.
- Die Faustregel-Stützpunkte markiert: 5 % → 1,5 · 10 % → 2,0 · 20 % → 3,0 · ab 30 % → 4,0.
- Beschriftete Achsen in **Prozent** und **Faktor**, nicht in Rohgrößen.

**Empfehlenswert dazu:** eine zweite Kurve „implizierte Hm/h" mit den Normlinien DIN 300 /
SAC 400 — das ist die eigentliche Plausibilitätsprobe des Modells.

**Wo hin?** Erst dem Owner zeigen (Artifact oder `mcp__visualize__show_widget` genügen für die
Abstimmung). `html/landschaften-modell.html` ist die natürliche Heimat, falls er ihn
veröffentlichen will — **dann aber**: die Seite braucht `base.css`, sonst fehlen Scrollbalken
und `color-scheme` (bekannte Falle: *standalone-page-misses-base-css*), und Farben ausschließlich
aus `css/base/tokens.css` (AGENTS.md §12 — **kein Blau**, nichts hartkodieren).

---

## 3. Aufgabe: Das Steigungsmodell für alle Transportmittel prüfen

Bestandsaufnahme: **Wo behauptet ein Text etwas über Gelände, und stimmt es mit dem Code?**

### 3a. Die Kernfrage, die noch niemand gestellt hat

Der Leistungskilometer ist ein **Wandermodell**. Im Code gibt es aber **keine Unterscheidung
nach Transportmittel** — die einzige Weiche ist Land vs. Wasser
(`avesmapsRouteTerrainAppliesTo`, Deny-List `['Flussweg','Seeweg']`).

> **Ein Fußgänger und eine Kutsche bekommen bei 30 % Steigung denselben Faktor 4,0.**

Prüfe, ob das so gewollt ist, und belege die Antwort mit Zahlen statt mit Meinung. Eine Kutsche
kommt einen 30-%-Hang real gar nicht hinauf; ein Reittier verhält sich anders als ein Fußgänger.
Falls es eine bewusste Vereinfachung ist: **sagt das irgendein Text?** Falls nicht, ist es der
vierte Widerspruch — diesmal durch Auslassung.

💣 **Es gibt ZWEI Gates, nicht eins** (bekanntes Fehlermuster in diesem Projekt):
`terrain-store.php:68` schreibt für Wasserwege gar kein Profil, `avesmapsRouteTerrainAppliesTo`
wendet keins an. Ändert jemand nur eines, driften sie auseinander. Beide prüfen.

### 3b. Die Prüfliste der Texte

Der Geschwindigkeits-Dialog (`js/routing/transport-speed-info.js`) trägt diese Regeln — jede
davon macht prüfbare Aussagen:

| String | Thema | geprüft? |
|---|---|---|
| `slopeRule` | Steigung / Gelände | ✅ 14/14 Zahlen ok, ❌ Herkunftsangabe falsch |
| `landTravel` | Landreise | ⬜ offen |
| `riverTravel`, `riverNote` | Fluss + Strömung | ⬜ offen |
| `seaTravel`, `seaNote` | Seereise | ⬜ offen |
| `crossCountryRule` | Querfeldein | ⬜ offen |
| `restRule` | Rasten | ⬜ offen |
| `pathTypeHeader`, `intro`, `legend` | Wegtypen / Rahmen | ⬜ offen |

Weitere Orte mit Aussagen über Gelände:
- `js/app/i18n-en.js` — **die englische Fassung trägt dieselben Fehler**, sie ist eine zweite
  Quelle und muss mitgeprüft werden.
- `html/landschaften-modell.html` — die Modellseite (siehe Widerspruch 3).
- `js/routing/route-plan.js` — Reiseplan-Zusammenfassung und Etappenzeilen.
- `js/routing/route-speed-arrows.js` — die Geschwindigkeitspfeile.
- `docs/landschaften-*.md` — Designdokumente.

🔴 **`html/editor-handbuch.html` NICHT anfassen.** Es gehört einer nächtlichen Routine
(`avesmaps-handbuch-pflege`, 00:00). Findest du dort einen Widerspruch: **melden, nicht
editieren** (AGENTS.md §9).

### 3c. Das Ergebnis absichern

Der Prüfer aus der Vorsession hat funktioniert und sollte **als echter Test ins Repo** — er
schließt genau die Lücke, durch die alle drei Widersprüche geschlüpft sind. Muster:

```php
require 'api/_internal/routing/terrain-factor.php';
// Jede Zahl, die im Dialogtext steht, gegen den Rechenkern:
pruefe('„bei 10 % doppelt so lang" -> Faktor 2,0', 2.0, faktorFuerSteigung(0.10));
```

Sinnvoller Ort: `api/_internal/routing/__tests__/`, neben `terrain-factor-test.php`.
Er muss **fehlschlagen, wenn jemand den Text ändert, ohne den Code zu ändern** — und umgekehrt.

---

## 4. Was bereits bekannt ist (nicht neu suchen)

**Widerspruch 1 — falsche Herkunftsangabe, live im Dialog (DE + EN).**
Der Text nennt „Leistungskilometer (DIN 33466, Marschzeitrechnung der Alpenvereine)". Das sind
**drei verschiedene Verfahren**:

| Verfahren | Regel | implementiert? |
|---|---|---|
| Leistungskilometer | Aufschlag auf die *Strecke* | ✅ genau das |
| DIN 33466 | *Zeit*formel: 300 Hm/h auf, 500 Hm/h ab, 4 km/h eben, Halbierungsregel | ❌ |
| Alpenvereine (SAC) | 4 km/h, 400 Hm/h auf, 800 Hm/h ab, Halbierungsregel | ❌ |

Fundstellen: `transport-speed-info.js` (`slopeRule`), `i18n-en.js`, `terrain-factor.php:10,47`,
`route-plan.js:340`, `terrain-factor-test.php:6`.
Von zwei Spielern unabhängig gefunden. **Der Rechenkern bleibt unangetastet — nur die Klammer.**

**Widerspruch 2 — die Prozentzahl im Reiseplan ist keine Steigung.**
`max_ascent_gradient` = *totale Variation* eines Wegstücks ÷ waagerechte Länge, nicht Neigung.
Bewiesen mit echtem Code: ein Wegstück von 1000 → 1200 → 1000 → 1200 → 1000 Schritt (Anfang =
Ende, echte Neigung **0 %**) meldet **„13 % Steigung" UND „13 % Gefälle" gleichzeitig**.
Signatur im Reiseplan: **auf ≈ ab** („3.868 ↑ · 3.868 ↓"), weil beide totale Variationen sind.
Der Dialog sagt dagegen „Es zählt die Steilheit in Prozent".
💣 Wer die angezeigte Zahl in die Faustregel einsetzt, überschätzt den Zeitaufschlag live um
**Faktor 1,2 bis 17,8** (gemessen, Lowangen→Greifenfurt) — die Anzeige ist ein *Maximum eines
Wegstücks*, die Faustregel gilt fürs *Etappenmittel*.
⭐ **Die Bepreisung ist nicht betroffen**: sie rechnet mit `ascent_schritt` (Höhenmeter), und
dort *ist* die totale Variation die richtige Größe.

**Widerspruch 3 — ein gebrochenes Versprechen, und der schwerste.**
`html/landschaften-modell.html` (seit `7ebfd0c2`, 20.07.): *„Erfunden ist alles zwischen den
Gipfeln. Deshalb wird keine dieser Höhen jemals als Zahl angezeigt."* Seit `bb94193b`
(30.07.) zeigt der Reiseplan genau diese Höhen als Zahl. Der Satz sollte verhindern, dass
jemand erfundene Zwischenhöhen mit echten Gebirgshöhen vergleicht — **genau das ist dem Owner
dann passiert** („das Gebirge ist nur max. 2500 Schritt hoch"). Entweder die Zahlen zurücknehmen
oder den Absatz ehrlich machen; beides zusammen geht nicht.

**Was plausibel ist und keine Klärung braucht:** Summen sind Wandertour-Höhenmeter, nicht
Gipfelhöhe. Lowangen→Greifenfurt hat 3.868 Schritt Anstieg, erreicht aber nur **+1.589 Schritt**
über dem Start (Finsterkamm laut Wiki „bis zu 2500 Schritt" — passt). Bei „Zahl zu groß?"
immer erst **kumulativ netto** rechnen.

---

## 5. Werkzeuge und Fallen

**💣 Der lokale Arbeitsbaum hinkt hinterher.** In der Vorsession stand er 6 Commits hinter
`origin/master` — der zu prüfende Code war **gar nicht da**, und ein Grep fand die Konstanten
schlicht nicht. Immer zuerst:

```bash
git fetch origin master && git log --oneline -3 origin/master
```

Dann einen eigenen Worktree, **nie den geteilten Baum umstellen** (mehrere Sessions arbeiten
darin, teils mit unfertigen Änderungen):

```bash
git worktree add --detach <scratchpad>/pruef origin/master
```

Danach wieder `git worktree remove --force`.

**Tests, die grün bleiben müssen** (aus der Wurzel des Worktrees):

```bash
node js/routing/__tests__/route-terrain-summary.test.js
node js/routing/__tests__/route-entry-terrain.test.js
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-factor-test.php
php -d zend.assertions=1 -d assert.exception=1 api/_internal/routing/__tests__/terrain-read-test.php
```

⚠️ Ohne `-d zend.assertions=1` prüft `assert()` **nichts** und der Test meldet falsch grün.

**Live-Daten holen** — der Browser-Zugriff auf `avesmaps.de` ist in Agent-Sessions gesperrt,
also `curl`. 💣 **STRATO: EINE Anfrage, nie in einer Schleife** — ein Loop über teure Endpunkte
sättigt die PHP-Worker und sieht aus wie ein DB-Ausfall.

```bash
curl -s --max-time 90 -X POST "https://avesmaps.de/api/route/" -H "Content-Type: application/json" \
  -d '{"from":"Lowangen","to":"Greifenfurt","enabled_transports":{"land":true,"river":false,"sea":false},"include_geometry":false}'
```

Share-Link auflösen: `GET /api/app/share-link.php?code=<code>`.
Testrouten: `?s=2xibnf9f` (Lowangen→Greifenfurt, zu Fuß), `?s=VXuAZSR3` (Kutsche).

Kleine Fallen, die Zeit gekostet haben:
- Das Segmentfeld heißt **`distance_units`**, nicht `distance` (in Karteneinheiten; × 3 = Meilen).
- `$TMPDIR` ist in Git Bash unter Windows **nicht gesetzt** — Pfade ausschreiben.
- Der Profillauf **ist bereits gelaufen** (`terrain_time_factor` ≠ 1,0 live). Wer „Verhalten vor
  dem Profillauf" prüfen will, muss eine 2er-Profilzeile konstruieren, nicht die Live-Route
  befragen.

**Nicht anfassen:** `html/editor-handbuch.html` (§3b). **Nie `git add -A`** — geteilter Baum,
nur eigene Dateien mit explizitem Pfad stagen (AGENTS.md §9).

---

## 6. Abgabe

1. Die Erklärung aus Aufgabe 1 — mit nachgerechneten Zahlen, nicht mit Zitaten aus dem Code.
2. Der Graph aus Aufgabe 2.
3. Eine Liste **jeder** geprüften Aussage mit Urteil (stimmt / widerspricht / nicht prüfbar),
   die Transportmittel-Frage aus 3a beantwortet, und der Test aus 3c.
4. **Dann fragen**, was davon umgesetzt werden soll. Der Owner entscheidet insbesondere über:
   - Widerspruch 2: Prozentzahl umbenennen **oder** echte steilste Stelle nachrüsten (Letzteres
     braucht einen 5. Profilwert = DDL + neuer Profillauf, also sehr wohl „etwas Neues in der DB").
   - Widerspruch 3: Zahlen zurücknehmen **oder** den Absatz ehrlich machen.
   - 3a: ob Transportmittel je eigene Steigungsantwort bekommen sollen.
