# Befunde der Koordination (vor dem Start der Agenten erhoben)

## Kern
- Die vorhandenen Tests sind fast vollständig grün: **JS 79/79**, **PHP 85/86**.
- Der eine rote PHP-Test ist ein Wächter gegen eine öffentlich blamable Falschaussage —
  und er ist **rot, weil er über seine eigenen Warnkommentare stolpert**.
- Genau die Falschaussage, die er verhindern soll, **steht noch** — in `api/README.md`,
  dem Dokument, das AGENTS.md als kanonische API-Referenz benennt. Der Test schaut dort nicht hin.
- Live-Grundlinie vor dem Test (je eine Probe, keine Schleifen): statisch 0,13 s ·
  map-search 0,50 s · map-features 2,80 s / 19,6 MB · Politik-Layer zoom3 2,82 s / 3,0 MB ·
  Abenteuer 0,34 s / 1,8 MB · Landschaften 0,47 s / 1,7 MB · Route 1,42 s. Server gesund.

---

### B0-1 Der Wächter-Test gegen „DIN 33466" ist dauerhaft rot — er stolpert über seine eigenen Kommentare
- **Kategorie:** KANN
- **Fundstelle:** api/_internal/routing/__tests__/terrain-text-claims-test.php:144-152 (der
  Verbotsteil) gegen js/routing/transport-speed-info.js:177 und :186
- **Beobachtung:** Der Test liest `js/routing/transport-speed-info.js` als EINEN String ein und
  verbietet darin die Zeichenketten `DIN 33466`, `Marschzeitrechnung der Alpenvereine`,
  `alpine clubs`. Die Datei enthält das Etikett heute nur noch **in zwei Warnkommentaren**, die
  erklären, warum es nie wiederkommen darf (Z. 177: „derselbe Fehler, den das Etikett ‚DIN 33466'
  hier schon einmal gemacht hat"; Z. 186: die Begründung, warum der deutsche Wikipedia-Artikel
  NICHT verlinkt wird). Der ausgelieferte Text ist korrekt und nennt Naismith/Langmuir.
  `str_contains` kann Kommentar nicht von Oberflächentext unterscheiden.
- **Erwartet:** Der Test prüft nur, was tatsächlich an den Nutzer geht (die Vorgabetexte in den
  `tr(...)`-Aufrufen), oder er entfernt Kommentare vor der Prüfung.
- **Beleg:** `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll
  api/_internal/routing/__tests__/terrain-text-claims-test.php` → AssertionError in Zeile 147,
  Meldung „transport-speed-info.js (DE): claims „DIN 33466"". Gegenprobe:
  `grep -n "DIN 33466" js/routing/transport-speed-info.js` → genau 2 Treffer, beide innerhalb
  von `/* … */`-Blöcken.
- **Sicherheit:** BELEGT
- **Aufwand:** klein
- **Warum das mehr ist als Kosmetik:** ein dauerhaft roter Test ist schlimmer als gar keiner.
  Er gewöhnt jeden Beteiligten daran, ein rotes Ergebnis in dieser Datei zu übergehen — und
  verdeckt damit jede echte künftige Abweichung, die derselbe Test finden soll. Er ist der
  einzige rote Test im ganzen Projekt; genau das macht ihn zum blinden Fleck.

### B0-2 Die Falschaussage, gegen die der Test wacht, steht unbemerkt weiter in der öffentlichen API-Doku
- **Kategorie:** AKUT
- **Fundstelle:** api/README.md:101-102
- **Beobachtung:** Dort steht wörtlich: „**The model is the Leistungskilometer** (DIN 33466, the
  marching-time arithmetic of the German and Swiss alpine clubs)". Das ist exakt die Behauptung,
  die zwei Spieler am 2026-07-31 unabhängig voneinander als falsch erkannt haben und die deshalb
  aus der Oberfläche entfernt wurde. DIN 33466 und die Alpenvereins-Marschzeitrechnung sind
  **Zeit**formeln; implementiert ist ein **Strecken**zuschlag. Der Wächter-Test kennt nur zwei
  Dateien (`js/routing/transport-speed-info.js`, `js/app/i18n-en.js`) und schaut in die README nicht
  hinein — die Korrektur hat sie darum nie erreicht.
- **Erwartet:** api/README.md nennt dieselbe Grundlage wie die Oberfläche (Leistungskilometer nach
  Naismith/Langmuir, ausdrücklich NICHT DIN 33466), und der Wächter-Test nimmt api/README.md in
  seine Liste der geprüften Flächen auf.
- **Beleg:** `sed -n '98,112p' api/README.md` zeigt den Satz;
  `sed -n '/\$surfaces = \[/,/\];/p' api/_internal/routing/__tests__/terrain-text-claims-test.php`
  zeigt, dass nur die zwei JS-Dateien geprüft werden. AGENTS.md §4 benennt api/README.md als
  „Canonical reference" — die Datei ist also nicht intern, sondern die Auskunft für Fremdnutzer
  der stabilen Schnittstelle.
- **Sicherheit:** BELEGT
- **Aufwand:** klein
- **Zusammenhang:** B0-1 und B0-2 gehören zusammen und erzählen dieselbe Geschichte: der Test
  wurde rot, das Rot wurde als bekannt abgetan, und deshalb hat niemand gemerkt, dass die
  eigentliche Falschaussage an einer dritten Stelle überlebt hat.

### B0-3 Sechs PHP-Tests scheitern ohne zugeschaltete Erweiterungen — und melden dabei Falsches
- **Kategorie:** KANN
- **Fundstelle:** api/_internal/app/__tests__/{adventure-resolve-candidates,citymap-image-encode,
  climate-insert-zone,climate-rename,ecosystem-island-migration}-test.php,
  api/_internal/routing/__tests__/water-trial-test.php
- **Beobachtung:** Mit dem in der Projektdoku genannten Befehl (nur `mbstring` + `curl`)
  scheitern sechs Tests mit FATAL — sie brauchen zusätzlich `pdo_sqlite`, `sqlite3` bzw. `gd`.
  Mit zugeschalteten Erweiterungen sind alle sechs grün. Der Testlauf sieht ohne dieses Wissen
  aus wie „7 kaputte Tests", tatsächlich ist genau einer echt.
- **Erwartet:** Ein Befehl im Repo (oder in der Doku), der alle Tests mit den richtigen
  Erweiterungen startet, statt der Reihe nach neu zu raten.
- **Beleg:** Erster Lauf mit dem dokumentierten Befehl: 79 grün / 7 rot. Zweiter Lauf derselben
  sechs mit `-d extension=php_pdo_sqlite.dll -d extension=php_sqlite3.dll -d extension=php_gd.dll`:
  alle sechs grün. Die Tests selbst brechen sauber mit einer erklärenden FATAL-Meldung ab — sie
  sind gut gebaut, nur schlecht startbar.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

---

## Anmerkung zur Prüfumgebung (kein Avesmaps-Befund)
Der eingebaute Vorschau-Browser hat ein **0×0 großes Fenster** (`map.getSize()` = [0,0],
`document.body` 0 px hoch, 1 Kachel, 0 Vektoren). Leaflet zeichnet darin nichts, echte Mausbedienung
ist unmöglich. Alle Bedientests dieses Systemtests laufen deshalb über den echten Chrome des Owners.
Das ist eine Grenze unseres Werkzeugs, kein Fehler der Anwendung — aber es erklärt, warum frühere
Sessions Bedienbefunde nur eingeschränkt belegen konnten.
