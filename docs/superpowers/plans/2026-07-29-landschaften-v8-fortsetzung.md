# V8 — Fortsetzung: Durchschnittshöhe und Ridged Noise — Instruction

> **Für agentische Arbeiter:** PFLICHT-SUB-SKILL: `superpowers:executing-plans`.
> **Eigener Worktree auf `origin/master`** (`git fetch` zuerst).

**Stand:** 2026-07-29. **Auftraggeber:** Owner. **Vorgänger:** V8 ✅ live,
Instruction `2026-07-28-landschaften-v8-topographie.md` (alle 10 Aufgaben, plus rund
20 Nachbesserungen aus dem Live-Betrieb).

---

## 0. Was schon läuft — nicht nachbauen

Höhen am `berggipfel`-Label (`height_schritt` in `properties_json`), Regler in beiden
Oberflächen, Gipfel in der Topographie-Ebene sichtbar und ziehbar, „Höhenpunkt setzen",
Höhenfeld gezeichnet, Invalidierung, drei Geländeregler **je Fläche**, Presets je Art,
Live-Vorschau, zwei Darstellungen (Bearbeiten/Ansehen).

| Datei | Rolle |
|---|---|
| `js/map-features/map-features-ecosystem-height-field.js` | Feld EINER Fläche (Buckelsumme, Fenster, Verfahren) |
| `js/map-features/map-features-ecosystem-height-combine.js` | Flächen summieren, Gipfel zuteilen, Verfahren je Art |
| `js/map-features/map-features-ecosystem-height-render.js` | Canvas-Overlay, zwei Darstellungen |
| `js/map-features/map-features-ecosystem-properties.js` | Flächendialog: Regler + Gipfelliste |
| `api/_internal/app/ecosystem.php` | Spalten `terrain_*`, Aktion `update_area_terrain` |

---

## 1. Aufgabe A — Durchschnitt und Maximum trennen

**Heute:** ein Wert, `terrain_avg_height`, und er setzt das **Maximum** des Rauschens
(`Dämpfung = Ziel / lautester Punkt`). Der Regler heißt seit `3344e4bc` ehrlich
„Maximalhöhe". Der Mittelwert liegt bei grob einem Drittel.

**Ziel:** zwei Zahlen beschreiben die **Form**, nicht nur die Spitze — ein Hochplateau
(Ø 3.000 / max 3.500) ist etwas anderes als zerklüftetes Vorland (Ø 800 / max 4.000).

**Weg:**
1. Zweite Spalte `terrain_mean_height` auf `ecosystem_area`, nachrüstbar wie die drei
   vorhandenen (Muster: `avesmapsEcosystemEnsureTables`, `information_schema.COLUMNS`).
   `NULL` = ableiten wie bisher.
2. `update_area_terrain` nimmt sie mit — bewachtes `array_key_exists`, leer = NULL.
3. Beim Feldbau **auch den Mittelwert** des rohen Rauschens messen (die Max-Messung
   läuft schon, im selben Durchgang).
4. Skalierung **und Potenz** so wählen, dass Mittel → Ø und Maximum → max. Zwei
   Zwänge, zwei Freiheitsgrade. Einmal beim Bauen, **nie** in der Malschleife.
5. Vierter Regler im Dialog, geklemmt unter die Maximalhöhe, mit „(auto)"-Vermerk und
   Zahlenfeld wie die anderen drei. Preset je Art ergänzen.

💣 **Beides muss MULTIPLIKATIV bleiben.** Ein additiver Sockel bricht die
Fußhöhe-0-Invariante — und damit die Verschmelzung zweier überlappender Flächen.
Der Unit-Test prüft das; er muss grün bleiben.

---

## 2. Aufgabe B — Ridged Noise als Basis

**Owner-Referenzbild:** scharfe helle Grate, dunkle Täler. **Keiner der drei heutigen
Algorithmen führt dorthin** — Domain Warping verzieht Buckel zu welligen Buckeln,
Slope Weighting flacht sie ab. Grate entstehen in der **Basis**, nicht in der
Nachbearbeitung.

**Weg:** `1 − |n|` über mehrere Oktaven statt der Buckelsumme, gern mit Warping darüber.

🔴 **Die zwei Invarianten sind bei der Buckelsumme geschenkt und müssen hier eigens
hergestellt werden:**
- **Gipfel liest seine Zahl** (Buckelsumme: das Gipfelfenster erledigt es)
- **Rand ist exakt 0** (Buckelsumme: Radius ≤ Randabstand erledigt es)

Ohne beide bricht die Verschmelzung, und zwar **unsichtbar** — sie fällt nur an den
Nahtstellen auf. Der vorhandene Test in `ecosystem-height-field.test.js` prüft beides
für alle Verfahren; ein viertes muss dort eingetragen werden, **bevor** es live geht.

---

## 3. Fallen, die in V8 zugebissen haben

💣 **Signatur prüfen, nie aus dem Gedächtnis schreiben.** `avesmapsEnsureEcosystemTables`
existiert nicht; sie heißt `avesmapsEcosystemEnsureTables`. Der `Throwable`-Fang machte
daraus „The ecosystem area could not be processed", und **jede** Geländespeicherung
scheiterte.

💣 **Am ECHTEN Viewport messen.** 25–36 ms stammten von 900×620. Beim Owner (2560×1271)
waren es **248,7 ms**, und neun Neuzeichnungen froren den Tab ein.

💣 **Nichts je Pixel berechnen, was je Bild reicht.** Ein `Math.max` in der inneren
Schleife läuft ~100.000-mal je Bild.

💣 **Den echten Ladeweg durchlaufen, nicht Daten einspeisen.** Zwei Fehler blieben
verborgen, weil die Abnahme die Flächen VOR dem ersten Zeichnen setzte: der gemerkte
leere Stapel und das fehlende Neuzeichnen nach dem Laden.

💣 **Deckkraft steckt an ZWEI Stellen** — CSS-Opazität des Canvas *und* Alpha je Pixel.
Wer nur eine abschaltet, ändert nichts Sichtbares.

💣 **Numerik ≠ Mathematik.** Die Neigung am Gipfel ist null — aber nur bei einer
**zentralen** Differenz. Die Vorwärtsdifferenz machte aus einem 3.000er einen 2.744er.

⚠️ **Presets/Spalten legt `avesmapsEcosystemEnsureTables` an.** Nach dem Deploy einmal
eine Aktion auslösen, sonst existieren die Spalten nicht.

---

## 4. Regeln

1. **Abnahme im Browser**, nicht „Tests grün". Keine lokale DB — der Owner kann seinen
   eingeloggten Chrome übergeben (`mcp__claude-in-chrome__*`), damit ist der
   Schreibweg messbar.
2. **Deutsch in der Oberfläche, Englisch in Code und Commits.**
3. **Kein `?v=` von Hand**, kein `ASSET_VERSION`-Bump (nichts davon ist dynamisch geladen).
4. **Geteilter Baum:** nie `git add -A`, nur eigene Pfade.
5. **JS-Tests:** `node js/map-features/__tests__/<name>.test.js` — 40 grün.
   **PHP:** `php -d extension=mbstring -d zend.assertions=1 <datei>`.
6. **Farben nur aus `css/base/tokens.css`.**

---

## 5. Fertigkriterium

1. Ø und Maximum sind getrennt einstellbar, und ein Hochplateau sieht anders aus als
   zerklüftetes Vorland.
2. Beide Invarianten stehen für **alle** Verfahren (Unit-Test).
3. Am **größten** Viewport gemessen, Zahl im Commit.
4. Vom Owner live abgenommen.
