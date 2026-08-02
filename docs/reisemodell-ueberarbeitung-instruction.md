# Reisemodell: Überarbeitung nach der Quellenlage — Bauauftrag

> **Auftrag an eine neue Session.** Stand: 2026-08-02. Selbsttragend, aber die beiden
> Quellendokumente sind Pflichtlektüre:
>
> - `docs/dsa-reisegeschwindigkeiten-quellenlage.md` — was die Regelquelle sagt, mit Seitenzahlen
> - `docs/steigung-gebirgspass-entscheidung.md` — Quelle, Regelableitung und Setzung getrennt
>
> 🔴 **DREI ENTSCHEIDUNGEN STEHEN BEIM OWNER AUS** (§3). Ohne sie kann ein Teil der Arbeit nicht
> gebaut werden. Fang mit dem an, was unabhängig davon ist, und **frag, statt zu raten**.
>
> 🔴 **NICHTS AN `html/editor-handbuch.html` ÄNDERN.** Es gehört einer nächtlichen Routine. Deine
> Pflicht ist ein Commit-Betreff, der die sichtbare Wirkung nennt.

---

## 1. Die Regel, in einfachen Worten

Das Regelwerk nennt **eine Zahl je Reiseart** — zu Fuß 30 Meilen am Tag, beritten 35, Kutsche 50 —
für eine gute Straße ohne Zwischenfälle. Alles andere macht davon nur langsamer:

1. **der Wegtyp** (Reichsstraße ×1,1 · Straße ×1,0 · Weg ×0,8 · Gebirgspass ×0,4) — aus der Quelle,
2. **die Steigung des konkreten Abschnitts** — unser Beitrag, denn die Quelle kennt nur Kategorien,
3. **die Strömung** auf Flüssen.

**Die Ausnahme, um die es geht:** Auf **Gebirgspässen** enthält der Wegtyp-Faktor die Steigung
bereits (Geographia Aventurica S. 123, wörtlich). Dort darf nicht ein zweites Mal gebremst werden.

**Unser Ausweg** (Setzung, *nicht* Regel): auf Pässen entscheidet die Steigung nur noch, ob ein Pass
über oder unter dem Durchschnitt liegt. Dazu wird durch den mittleren Steigungseffekt aller Pässe
geteilt. Der Durchschnittspass landet exakt auf dem Wert der Quelle.

```
F_α(s) = 1 + α · ( F(s) / mean_pass(F) − 1 )      nur für Subtyp „Gebirgspass"
F(s)   unverändert                                 für alle anderen Landsubtypen
```

`α = 0` ist die strenge Regelumsetzung, `α = 1` die volle Umverteilung.

---

## 2. Was schon da ist

| | Stand |
|---|---|
| `mean_pass(F)`, `c`, Mittel je Wegart | ✅ berechnet und in `path_terrain_stamp` gespeichert (`api/_internal/routing/terrain-calibration.php`) |
| Auslösung | ✅ Kachel „Wegprofile kalibrieren" im Wege-Editor |
| Wirkung aufs Routing | ⛔ **keine** — nichts im Routing-Pfad liest den Wert. Das ist gewollt und muss bewusst geändert werden |
| `alpha` | ❌ existiert nirgends |
| Kurvenspiegel für die Plots | ✅ `js/pages/wege-editor-model.js`, gegen `terrain-factor.php` getestet |

---

## 3. 🔧 Die drei Owner-Entscheidungen

**A — Welche Steigungskurve?** Leistungskilometer (heute), Tobler oder Irmischer & Clarke. Bei 20 %
Steigung sagen sie 3,00 / 2,01 / 1,27 — Faktor 2,4 auseinander. ⚠️ Die DSA-Werte ×0,75 und ×0,5
taugen **nicht** als Prüfstein; die Quelle nennt sie selbst schwer angebbar und definiert weder
„Hügel" noch „Berg".

**B — Welcher Wert für `α`?** Argument für 1: die Geländeebene bleibt wirksam. Argument für 0
vorerst: 15 der 16 Gebirge laufen auf Platzhalterhöhen, B verteilte also nach Rauschen um.

**C — Wird das absolute Niveau an die Quelle angeglichen?** Wir sind an Land **11–87 %** und auf dem
Wasser **1,7–2,5×** schneller als die Tagesleistungen der Quelle. Angleichen heißt: die ganze Karte
wird spürbar langsamer. Das ist die sichtbarste Änderung von allen.

---

## 4. Arbeitspakete

### P1 — Wasser: der Skalierungsfehler *(unabhängig von A–C, größter Effekt)*

💣 Die rohen Tabellenwerte **stimmen** — sie treffen die Quelle exakt, wenn man sie mit *ihrer*
Stundenzahl multipliziert: Flusskahn 5,0 × **8 h** = 40 ✓ · Flusssegler 7,5 × 8 h = 60 ✓ ·
Lastensegler 10,0 × **12 h** = 120 ✓. Der Router lässt auf dem Wasser aber **24 Stunden** fahren,
weil dort keine Rast anfällt (`js/routing/route-result.js`, die Liste `["Seeweg","Flussweg"]`).

Die Quelle sagt dagegen ausdrücklich: Reisetag **12 Stunden**, 24-Stunden-Fahrt nur als Sonderfall
bei bekannter Strecke und gutem Wind, und *„üblicherweise gehen die Schiffe nachts vor Anker"*
(S. 131).

Zu tun: entscheiden, ob die Rastregel für Wasser fällt oder die Tabellenwerte angepasst werden —
**nicht beides**. Und `seaNote` im Dialog korrigieren, der der Quelle direkt widerspricht.

### P2 — Strömung *(unabhängig)*

Vorgabewert **1,5**, Quelle durchgehend **2,0** (Flusskahn 20/40, Flusssegler 30/60) bis 2,14
(Galeere 35/75). Klemme `[1,0 … 3,0]` in `client-graph.php` bleibt richtig, der Default nicht.
`riverNote` im Dialog nennt „1,5-fache" und muss mit.

### P3 — Kutsche auf Pässen *(unabhängig)*

Der Quelle fehlt bei uns: *„auf Karrenwegen und Pässen nur halbe Geschwindigkeit"* (S. 123). Die
übrigen Kutschenverbote sind seit `b4e43404` abgebildet und gedeckt.

### P4 — Die Normierung auf Gebirgspass *(braucht A und B)*

`α` wird gespeichert (neue Spalte neben `c` in `path_terrain_stamp`), der Router liest `mean_pass(F)`
und `α` und wendet die Formel aus §1 **nur auf `Gebirgspass`** an.

💣 **Der Wert wird gelesen, nie berechnet.** Kein impliziter Neuaufbau beim Routen, bei
Kartenänderung oder beim Profillauf ohne ausdrückliche Auslösung. Bei bewegter `map_revision` oder
`heightmap_stamp`: **„Eichung veraltet" melden, nicht nachrechnen** — dasselbe Muster wie beim
`heightmap_stamp` des Profillaufs.

### P5 — Texte *(braucht A)*

`transport-speed-info.js` (`slopeRule`, `intro`, `restRule`, `riverNote`, `seaNote`,
`crossCountryRule`) und `js/app/i18n-en.js`. ⚠️ Der Wächtertest
`api/_internal/routing/__tests__/terrain-text-claims-test.php` wird rot, wenn Text und Kurve
auseinanderlaufen — das ist seine Aufgabe, nicht sein Fehler. Nadeln mitziehen.

Im `intro` steht „doppelt so schnell wie ein Gebirgspfad": der Wegtyp heißt **Gebirgspass**, und
gemessen sind es 2,75- bis 3-fach.

### P6 — Der Wege-Editor *(braucht A und B)*

„Funktionen anzeigen" muss die **neue** Kurve zeigen, `wege-editor-model.js` bleibt Spiegel von
`terrain-factor.php`. Ergänzen: `α`, `mean_pass(F)`, und ob die Eichung veraltet ist.

---

## 5. Fallen

💣 **`js/pages/wege-editor-model.js` und `api/_internal/routing/terrain-factor.php` sind zwei
Implementierungen derselben Regel.** Beide sind gegen dieselben Stützpunkte getestet. Eine Änderung
auf einer Seite ohne die andere macht einen Test rot — genau dafür ist er da.

💣 **Querfeldein ist landschaftsabhängig** und darf nicht pauschal behandelt werden. Heute folgenlos:
synthetische Kanten tragen gar keinen Geländefaktor. ⚠️ **Für die V14-Offroad-Etappen ist das nicht
geprüft** — das ist eine offene Lücke, prüf sie.

💣 **Die Rastzeit an Land.** DSAs 30 Meilen sind ein *ganzer* Reisetag inklusive Rast; der Planer
schlägt Rast auf die Reisezeit auf. Bei Entscheidung C wird das eine Doppelzählung. Zusammen lösen.

💣 **`ASSET_VERSION`** in `js/territory/territory-editor-inline-host.js` bumpen bei dynamisch
geladenen Editor-Assets. `edit/index.php` verlinkt `css/pages/edit.css` mit handgeschriebenem `?v=`.

💣 **Geteilter Arbeitsbaum:** nie `git add -A`, eigener Worktree aus `origin/master`, Hauptbaum nicht
umstellen. Er hinkt mehrere hundert Commits hinterher — immer `git fetch` zuerst.

💣 **STRATO:** eine Anfrage, nie in einer Schleife.

---

## 6. Alle Orte, an denen das Modell auftaucht

`api/_internal/routing/terrain-factor.php` (der Rechenkern) · `terrain-calibration.php` ·
`client-graph.php` (Anwendung + Strömung) · `js/pages/wege-editor-model.js` (Spiegel) ·
`js/routing/route-plan.js` + `route-node.js` (angezeigte Zeit) · `route-result.js` (Rast) ·
`route-speed-arrows.js` · `js/routing/transport-speed-info.js` + `js/app/i18n-en.js` (Dialog) ·
`js/config.js` (`SPEED_TABLE`, `TIME_SCALE_FACTOR`) · `html/landschaften-editor.html` ·
`html/wege-editor.html` + `js/pages/wege-editor.js` · `html/landschaften-modell.html` ·
🔴 `html/editor-handbuch.html` — **nur melden, nicht anfassen**.

---

## 7. Tests

Vorhanden und grün zu halten: `terrain-factor-test`, `terrain-read-test`, `terrain-calibration-test`,
`terrain-text-claims-test`, `carriage-offroad-test` (PHP, **mit `-d zend.assertions=1`**, sonst prüft
`assert()` nichts) sowie die elf Tests in `js/routing/__tests__/` und
`js/pages/__tests__/wege-editor-model.test.js`.

Neu zu sichern: `α = 0` liefert auf Gebirgspass exakt 1,0 · `α = 1` liefert über den gespeicherten
Bestand ein längengewichtetes Mittel von exakt 1,0 · alle anderen Landsubtypen bleiben unnormiert ·
der Normierungswert wird gelesen, nie berechnet · ein veralteter Eichsatz meldet, statt zu rechnen.

---

## 8. Bekannte Lücken — bewusst nicht in diesem Auftrag

Sie stehen hier, damit sie nicht als Auslassung durchgehen:

**Aus der Quelle nicht abgebildet:** „Reittiere müssen geführt werden" auf den mit \* markierten
Geländearten (Tagesleistung fällt auf Fußgruppe) · Wetter- und Bodenmodifikatoren · Eilmarsch ·
saisonale Passsperrung · die Untergrenze 0,05 für den Gesamtmodifikator · Reichs- und Landstraßen
sind von aufgeweichtem Boden ausgenommen.

**Modellseitig offen:** die Kante bei 20 % Gefälle (Sprung von 1,0 auf 2,33; Reparatur braucht einen
zusätzlichen Profilwert und damit DDL plus neuen Profillauf) · die landschaftsabhängige Behandlung
von Querfeldein · dass für *leichter Wanderer*, *Reisegruppe beritten* und *Karawane* kein
offizieller Tagesleistungswert existiert, den man angleichen könnte.

**Nicht gemessen:** `mean_pass(F)` über den Livebestand. Der Knopf existiert, gedrückt hat ihn
niemand. **Das ist der erste Schritt** — ohne diese Zahl ist P4 nicht bewertbar.
