# Agent 12 — Die tägliche Pflege: acht Objektarten anlegen, pflegen, zurücknehmen

## Kern

- **Speichern schließt den Editor.** In Karten *und* Abenteuer wirft „Speichern" wie „Verwerfen"
  einen aus dem ganzen Fenster. Wer zehn Karten pflegt, öffnet zehnmal neu und tippt zehnmal die
  Suche (B1).
- **Und danach ist der Eintrag nicht da:** ein frisch angelegtes Abenteuer fehlt in der Liste des
  Editors, der es angelegt hat — obwohl der Endpunkt es liefert. Erst ein voller Seiten-Neuladen
  bringt es (B2). Das Formular sagt „Erst speichern, dann Orte zuordnen" — genau das geht nicht.
- **Drei von acht Arten haben kein Änderungsprotokoll und kein Rückgängig:** Karten, Abenteuer,
  Vorkommen. Anlegen, Umbenennen, Löschen — live geprüft, **null** Protokollzeilen (B3).
- **Ein Territorium kann man anlegen, aber über keine Oberfläche löschen** (B4).
- **Vorkommen kann man weder anlegen noch löschen**, und der Editor hat keinen Speichern-Knopf:
  jede Eingabe wirkt beim Fokusverlust sofort und ist nicht zurücknehmbar (B5).
- **Editorfenster stapeln sich.** Jeder geöffnete Editor bleibt als lebendes iframe liegen; schließt
  sich der neue, taucht der alte in seinem alten Zustand wieder auf (B6). Am Ende: 3 tote Editoren.
- **Die Kartensammlung hat keinen Quellen-Editor** — bei 347 von 457 Karten mit Quelle (B7).
- **Agent 11s Quellen-Befund unabhängig reproduziert und verschärft:** auch **„Rückgängig"** lässt
  den Quellenverweis öffentlich stehen (B17).
- Teil B: alle Editoren haben 336/336/336-Spalten — **außer Vorkommen** (320/310/310). Menübänder
  haben 3, 4, 5, 5, 5, 7 und 9 Kacheln; drei Hüllen, fünf Klassenpräfixe; „Löschen" sitzt an vier
  verschiedenen Stellen; vier Wörter für „zuletzt gesynct" (B11, B12, B15).
- **Aufgeräumt: restlos.** Kein `ZZ-Systemtest`-Objekt übrig. Server gesund (session.php 24 ms).

---

## Prüfumgebung

Alles live gegen https://avesmaps.de am **2026-08-05, 09:29–10:40 Ortszeit (MESZ)**, als
`valentin | admin`, teils über die Editor-Hülle `/edit/`, teils über die Karte `/?edit=1`.
Fenster durchgehend **1045 × 496 CSS-px** (dpr 1,5) — alle Maße unten sind bei dieser Größe
gemessen, damit sie vergleichbar sind.

Bestand zu Beginn: `Rev 56838 | 11.511 Features` (09:29), am Ende `Rev 56857 | 11.514` (10:29).
Parallel schrieb `thomas` durchgehend mit (Audit 54008–54019 in meinem Zeitfenster). Zahlen sind
deshalb immer mit Zeitpunkt notiert.

**Zwei Grenzen meines Werkzeugs, ehrlich benannt** (keine Avesmaps-Befunde):
1. **Mausgesten erreichen die Leaflet-Karte nicht.** Rechtsklick auf die Karte öffnete nie das
   Kartenmenü, und im Zeichenmodus entstand kein einziger Stützpunkt. Ich habe das Kartenmenü
   deshalb mit einem echten `contextmenu`-Event auf `#map` geöffnet (der App-eigene Pfad, nur
   programmatisch ausgelöst). Was **danach** kam — Formular, Autovervollständigung, Speichern —
   lief über die normale Oberfläche.
2. **Deshalb konnte ich Weg, Landschaftsregion, Territoriums-Polygon und Kraftlinie nicht
   anlegen** — alle vier brauchen gezeichnete Geometrie. Diese vier Zeilen der Tabelle sind
   „geprüft, nicht ausgeführt" und entsprechend gekennzeichnet. Ich habe für sie stattdessen die
   Anlege-/Lösch-Angebote der Oberfläche und das Protokollverhalten belegt.

---

## Tabelle 1 — Objektart → anlegen → Protokoll → rückgängig → sauber?

| Objektart | Anlegen | Änderungsprotokoll | Rückgängig | Nach dem Löschen sauber? |
|---|---|---|---|---|
| **Ort** (`map_features`) | ✅ Kartenmenü → „Hier hinzufügen" → „Neuer Ort". Pflicht: Name + Ortsgröße. **Fehlender Name: gar keine Meldung** (B9) | ✅ `create_point` 54020, WER+WANN+Name; WAS fehlt (Agent 11 B6) | ✅ vollständig; Kette 54020→54021→54022 exakt zurück | ✅ **nur wenn man die Quelle vorher löst.** Sonst bleibt sie öffentlich stehen — auch nach „Rückgängig" (B17) |
| **Weg** | ⚠️ nur Kartengeste („Neuer Weg"); der Wege-Editor hat **kein „+ Neu"** (`paths-editor.php` ist GET-only). *Nicht ausgeführt* | ✅ (fremde Wege-Einträge im Protokoll gesehen) | ✅ laut Registry | ❌ `feature_sources` (`path`) werden nie geräumt |
| **Landschaftsregion** | ⚠️ nur Kartengeste („Neue Derographische Region"), Zeichenmodus startete korrekt. *Nicht ausgeführt* | ✅ **und besser als der Rest:** eigene Tabelle, im selben Reiter, mit Gestenbündelung — gesehen: „Mit anderer vereinigen **(3 Schritte)**" | ✅ gestenweise („Rückgängig" am Bündel) | ❌ `feature_sources`, `ecosystem_area_heightmap` bleiben |
| **Kraftlinie** | ❌ **im Kraftlinien-Editor gar nicht** — er kann nur eine *vorhandene* Linie verlängern („+ Nodix hinzufügen"). Neue Linie nur als Kartengeste zwischen zwei Nodices (B10). *Bewusst nicht ausgeführt: eine neue Kante kann in eine fremde Linie verschmelzen* | ✅ je Segment | ⚠️ „Linie löschen" schreibt N Einträge → N Klicks zurück | ⚠️ Quellen werden auf das neue Ankersegment umgehängt; fällt das letzte, verwaisen sie |
| **Territorium** | ⚠️ „Neues Herrschaftsgebiet" ist im Landschaften-Modus **ausgeblendet** (nur im Politik-Modus). Der Territorien-Editor hat kein „+ Neu". *Nicht ausgeführt* | ❌ **für die Territoriumszeile selbst gar keins** — nur Geometrie-Aktionen werden protokolliert | ❌ nur für Geometrie | ❌ **Löschen existiert in keiner Oberfläche** (B4) |
| **Abenteuer** | ✅ „+ Neu". Pflicht: nur Titel („**Titel fehlt.**") | ❌ **null Einträge** für Anlegen, Umbenennen, Ort-Zuordnung, Löschen | ❌ keins | ✅ hartes Löschen räumt `adventure_place`/`_link` mit; Bestätigung nennt „(mit 1 Ort)" |
| **Kartensammlung** | ✅ „+ Neu". Pflicht: Titel + Karten-Link („**Ein Titel ist erforderlich.**") | ❌ **null Einträge** | ❌ keins | ✅ hartes Löschen räumt Orte/Typen/Links mit; sehr gute Bestätigungsfrage |
| **Vorkommen** | ❌ **gar nicht** — der Editor kennt nur `detail, add_place, remove_place, set_field, …`. Einträge kommen ausschließlich aus dem Wiki-Sync (B5) | ❌ null | ❌ keins, und **kein Speichern-Knopf**: jedes Feld wirkt beim Fokusverlust | ❌ kein Löschen in der Oberfläche |

Legende: ✅ vorhanden und selbst durchlaufen · ⚠️ eingeschränkt / nicht ausgeführt · ❌ nicht vorhanden

---

## Tabelle 2 — Editor-Vergleich (Teil B), alles gemessen bei 1045 × 496 CSS-px

| | Orte | Wege | Kraftlinien | Territorien | Abenteuer | Karten | Vorkommen |
|---|---|---|---|---|---|---|---|
| **Fenster-Hülle** | **`avm-editor-dialog`** | **`avm-editor-dialog`** | **`avm-editor-dialog`** | `political-territory-editor-dialog` | dito political | dito political | **`location-report-dialog` + `wiki-sync-conflicts-dialog`** |
| **Klassenpräfix innen** | *(keins)* `controls`/`cols` | **`avm-`** | *(keins)* | *(keins)* | **`ae-`** | **`ce-`** | **`lore-`** |
| **Menüband: Kacheln** | **7** | **4** | **3** | **9** | **5** | **5** | **5** |
| **Kachelbreite** | 134,85 px | 240,50 px | 322,67 px | **103,55 px** | 191,20 px | 191,20 px | 187,20 px |
| **Kachel-Abstand** | 6 px | 6 px | 6 px | 6 px | 6 px | 6 px | **8 px** |
| **Kachelhöhe** | 48 px | 48 px | 48 px | 48 px | **49 px** | 48 px | **51 px** |
| **Spaltenbreiten** | 336/336/336 | 336/336/336 | 336/336/336 | 335,6/336,2/336,2 | 336/336/336 | 336/336/336 | **320 / 310,3 / 310,3** |
| **Spaltentitel** | Territorien · Orte · Eigenschaften & Overrides | Wege · Eigenschaften · Höhenprofil | Kraftlinien · Eigenschaften · Nodices | *ganze Sätze*, zweizeilig | Abenteuer · Stammdaten · Orte | Karten · Stammdaten · Orte | Vorkommen · Stammdaten · Orte |
| **Titelfarbe/-größe** | `rgb(220,199,126)` / 16 px **fett** — in **allen** gleich ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Suchfeld** | „Name suchen…" | „Weg suchen …" | „Kraftlinie suchen …" | „In dieser Auswahl suchen…" | „Abenteuer suchen …" | „Karte suchen …" | „Name oder Art suchen …" |
| **Filter im Editor** | ja | ja | **nein** | **zwei** + „Kontinente" | ja | **nein** | ja |
| **„+ Neu"** | nein | nein | nein | nein | **ja** | **ja** | nein |
| **Speicherleiste** | nur Speichern | Verwerfen/Speichern | nur Speichern | Abbrechen/Speichern | Verwerfen/Speichern | **Löschen**/Verwerfen/Speichern | **keine (Auto)** |
| **„Löschen" sitzt** | Marker-Popup | — | Spalte 2 | **nirgends** | **Detailkopf oben rechts** | **Speicherleiste unten links** | — |
| **Sync-Etikett** | „Letzte Sync:" | „Zuletzt gesynct:" | „Zuletzt gesynct:" | „letzte Sync:" | „Letzte Sync:" | **„Dump:"** | „Zuletzt gesynct:" (+ **falsche Zeit**) |
| **Löschbestätigung** | `confirm` „X wirklich löschen?" | — | ? | — | **Knopf wird rot: „Wirklich löschen? (mit 1 Ort)"** | `confirm`, 3 Sätze | — |
| **Pflichtfeld-Meldung** | **keine** | — | — | — | „Titel fehlt." | „Ein Titel ist erforderlich." | — |
| **Zahlformat** | 3414 | 4126 | 59 | 1038 | 1352 | 456 | **5.104** (Tausenderpunkt) |

---

### B1 „Speichern" und „Verwerfen" schließen den ganzen Editor — in Karten wie in Abenteuer
- **Kategorie:** AKUT
- **Fundstelle:** `html/citymap-editor.html` (`#ceSave` :567, `#ceDiscard` :566),
  `html/adventure-editor.html` (`#aeSave` :549, `#aeDiscard` :548) gegen das Overlay
  `political-territory-editor-overlay` in der Kartenseite
- **Beobachtung:** Ich habe im Kartensammlungs-Editor mit einem **echten Mausklick** auf
  „Speichern" gedrückt. Der Datensatz wurde gespeichert — und das gesamte Fenster „Karten
  bearbeiten" verschwand; ich stand wieder auf der Karte. Dasselbe bei „Verwerfen" (das die
  Änderung korrekt zurücknimmt und **dann** schließt). Im Abenteuer-Editor genauso: nach
  „Speichern" ging sein Overlay auf `display:none`, nach einem echten Klick auf „Verwerfen"
  standen **alle** Overlays auf `none`.
  Für die tägliche Arbeit heißt das: jede einzelne gespeicherte Änderung kostet danach
  Editor öffnen → Suchbegriff neu tippen → Eintrag neu wählen. Bei zehn Karten zehnmal.
- **Erwartet:** Speichern bestätigt in der Statuszeile und **bleibt** im Datensatz (der
  Abenteuer-Editor kann das sogar: er zeigt „✓ gespeichert" in der Leiste — nur sieht man es
  nicht mehr). Schließen gehört an das ✕ und an sonst nichts.
- **Beleg:** Live, 2026-08-05. Karten: echter Klick auf „Speichern" bei (1456, 689) →
  Bildschirmfoto zeigt die Karte ohne Editor; der Titel war trotzdem geändert
  (`GET /api/app/citymaps.php` liefert „ZZ-Systemtest Karte GEAENDERT (Agent 12)").
  Abenteuer: echter Klick auf „Verwerfen" bei (1113, 642) → alle drei
  `.political-territory-editor-overlay` auf `display:none`, Titel korrekt zurückgesetzt.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B2 Ein frisch angelegtes Abenteuer fehlt in der Liste des Editors, der es angelegt hat
- **Kategorie:** AKUT
- **Fundstelle:** `html/adventure-editor.html` (Liste) gegen `POST /api/edit/map/adventures.php`
  `action:list`; Ursache-Verdacht: das Overlay-iframe wird beim erneuten Öffnen wiederverwendet
  statt neu geladen (siehe B6)
- **Beobachtung:** Nach „+ Neu" → Titel → „Speichern" (Leiste: „✓ gespeichert") schloss sich der
  Editor (B1). Ich habe ihn wieder geöffnet und nach `ZZ-Systemtest` gesucht: **„0 von 1352"**.
  Die Suche funktioniert (nach „Siegelbruch": „1 von 1352"), aber die Gesamtzahl war die von
  **vor** dem Anlegen. Der Endpunkt hingegen lieferte zu diesem Zeitpunkt **1353** Einträge,
  darunter meinen mit `origin: "manual"`. Erst ein vollständiger Neuaufbau der Seite brachte
  „1 von 1353". Das Anlegen-Formular sagt selbst: **„Erst ein Abenteuer speichern, dann Orte
  zuordnen."** — und genau dieser nächste Schritt ist danach nicht erreichbar.
- **Erwartet:** Nach dem Speichern steht der neue Eintrag ausgewählt im Editor (so wie „+ Neu"
  ihn hinterlässt), mindestens aber in der Liste.
- **Beleg:** Live, 10:05–10:09. UI: `1352` Gesamtzahl, Suche `ZZ-Systemtest` → „Keine Abenteuer."
  Gleichzeitig `POST /api/edit/map/adventures.php {action:'list'}` → 1353 Einträge, darunter
  `{public_id:"c443afdc-e61d-456f-8884-a0f606d11895", title:"ZZ-Systemtest Abenteuer (Agent 12)",
  origin:"manual"}`. Nach `location.reload()` der Editor-Hülle: „1 von 1353".
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Karten, Abenteuer und Vorkommen hinterlassen keine einzige Zeile im Änderungsprotokoll
- **Kategorie:** AKUT
- **Fundstelle:** `api/_internal/app/citymaps.php`, `api/_internal/app/adventures.php`,
  `api/_internal/app/lore-edit.php` — keiner der drei ruft `avesmapsWriteMapAuditLog`
  (`api/_internal/map/features.php:2891`) oder einen der beiden anderen Audit-Schreiber
  (`avesmapsEcosystemWriteAuditLog`, `avesmapsPoliticalWriteGeometryAuditLog`)
- **Beobachtung:** Ich habe an einem Tag eine Karte angelegt, umbenannt, ihr einen Ort zugeordnet
  und sie gelöscht; dasselbe mit einem Abenteuer. **Sieben schreibende Vorgänge — null
  Protokollzeilen.** Im Reiter „Änderungen" steht dazwischen nur die Arbeit eines fremden
  Editors. Damit ist für drei der acht Objektarten nicht feststellbar, wer wann was getan hat,
  und es gibt für sie folgerichtig auch kein „Rückgängig". Zum Vergleich: das Verschieben eines
  Labels um drei Pixel wird protokolliert und ist rückgängig zu machen.
- **Erwartet:** Dieselbe Behandlung wie Kartenobjekte — Konto, Zeitpunkt, Aktion, Objekt.
  (Ein Entwurf dafür liegt bereits: `docs/audit-ueberarbeitung-instruction.md`, Status „nicht
  gebaut".)
- **Beleg:** Live, jeweils Zeitstempel gegen `GET /api/edit/map/audit-log.php?limit=6`:
  Karte angelegt ~09:45, umbenannt 09:51, Ort zugeordnet 09:54, gelöscht 09:57 — jüngste
  Protokollzeilen in diesem Fenster: 54008 (09:38:46, thomas), 54009 (09:50:23, thomas),
  54012 (09:56:17, thomas). Abenteuer angelegt 10:02, Ort zugeordnet 10:07, gelöscht 10:10 —
  jüngste Zeilen 54014 (10:01:32), 54018 (10:10:22), beide thomas. Keine einzige eigene.
  Gegenprobe, dass mein Konto sonst protokolliert wird: der Ort erzeugte 54020–54023.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B4 Ein Territorium lässt sich anlegen, aber über keine Oberfläche löschen
- **Kategorie:** AKUT
- **Fundstelle:** `api/_internal/political/territories-endpoint.php:207` → `territories-write.php:555`
  (`delete_territory`, weiches Löschen) — **ohne jeden Frontend-Aufrufer**; die Zeichenkette
  `delete_territory` kommt repoweit nur in diesen beiden PHP-Dateien vor
- **Beobachtung:** Im Territorien-Editor bietet die Eigenschaften-Spalte eines gewählten Gebiets
  genau zwei Knöpfe: „🔓 Eltern hier sperren" und „✎ Editieren" — **kein Löschen**. Das
  Kartenmenü auf einem Gebiet hat zwar „Löschen", das entfernt aber die **Geometrie**, nicht das
  Gebiet. Ein versehentlich angelegtes oder doppeltes Herrschaftsgebiet bleibt damit dauerhaft
  im Baum (1653 Knoten) und in jeder Auswahlliste stehen. Die Aktion existiert im Server, ist aber
  nur per direktem API-Aufruf erreichbar.
- **Erwartet:** Entweder ein Löschknopf mit Warnung über Kinder und Geometrien, oder — wenn
  Löschen bewusst verboten ist — ein sichtbarer Satz, der das sagt, plus ein Archivieren.
- **Beleg:** Territorien-Editor live geöffnet, Knoten „Aguaduron" gewählt; Spalte 3 enthält
  `["🔓 Eltern hier sperren", "✎ Editieren"]`, `/Lösch|Entfern/` findet nichts im Spaltentext.
  Kartenmenü `#region-context-menu` ausgelesen: „… Neues Gebiet herauslösen / **Löschen**" —
  im Geometrie-Block. Serverseite: `delete_territory` ohne JS-Aufrufer (Fremdrecherche im Repo).
- **Sicherheit:** BELEGT (Oberfläche selbst geprüft; die Aussage „kein Aufrufer" ist eine
  Repo-Suche, nicht von mir zeilenweise nachgelesen → für diesen Teil PLAUSIBEL)
- **Aufwand:** mittel

### B5 Vorkommen: kein Anlegen, kein Löschen, kein Speichern-Knopf — jede Eingabe wirkt sofort
- **Kategorie:** AKUT
- **Fundstelle:** `js/review/review-wiki-sync.js:3256` (`document.addEventListener("change", …)` →
  `loreEditAction("set_field", …)`), Kommentar :3254 wörtlich: „kein Speichern-Knopf, der
  vergessen werden kann"; `api/edit/map/lore.php:54-134` (Aktionsliste ohne `create`)
- **Beobachtung:** Der Vorkommen-Editor hat **226 Knöpfe und keinen davon heißt Speichern,
  Verwerfen oder Abbrechen**. Er hat auch kein „+ Neu" und kein Löschen für einen Eintrag; die
  einzigen Verben sind „Hinzufügen" (Quelle), „+ Ort" und „✕". Ein Vorkommen entsteht
  ausschließlich im Wiki-Sync. Für den Redakteur heißt das: er kann 5.104 Einträge bearbeiten,
  aber keinen anlegen, keinen entfernen, und jede Korrektur ist mit dem Verlassen des Feldes
  endgültig — ohne Protokoll (B3) und ohne Rückgängig. Ein Vertipper im Namensfeld ist nur
  durch einen zweiten Vertipper zurückzuholen.
- **Erwartet:** Mindestens eine Rückmeldung („gespeichert") und ein Weg zurück. Wenn Auto-Speichern
  bewusst ist, dann mit derselben Sorgfalt wie anderswo: Protokolleintrag + Rückgängig.
- **Beleg:** Live: `#wiki-sync-lore-dialog` vollständig ausgelesen, 226 `button`-Elemente,
  Filter `/Speich|Verwerf|Abbrech|Sicher|Übernehm/` → **leer**; sichtbare Kurzknöpfe:
  `["×","🚨 Vorkommen syncen","Fauna (1382)","Flora (1004)","Waren (2531)","Spezies (187)",
  "Filter ▾", …, "✕","Hinzufügen","+ Ort"]`. Ich habe **kein** Feld eines fremden Eintrags
  geändert (die Regel dieser Sitzung), die Wirkung ist über den Quelltext belegt.
- **Sicherheit:** BELEGT (Oberfläche) / BELEGT (Quelltextstelle aus Fremdrecherche, Kommentar
  wörtlich zitiert)
- **Aufwand:** mittel

### B6 Editorfenster stapeln sich — der geschlossene Editor kommt beim Schließen des nächsten zurück
- **Kategorie:** AKUT
- **Fundstelle:** `.political-territory-editor-overlay` / `…__frame` **und** `.avm-editor-overlay`
  in der Kartenseite — beim Öffnen eines zweiten Editors wird ein zweites Overlay angelegt, das
  erste aber nur versteckt, nie entladen. Betrifft beide Hüllen (siehe B11)
- **Beobachtung:** Nachdem ich den Kartensammlungs-Editor benutzt und den Abenteuer-Editor
  geöffnet hatte, lagen **drei** `political-territory-editor-dialog` im DOM und **zwei lebende
  iframes** („Karten bearbeiten" und „Abenteuer bearbeiten"), beide 1008 × 366 px,
  `display:block`, `visibility:visible`. Als der Abenteuer-Editor sich nach „Speichern" schloss
  (B1), wurde **der Karten-Editor wieder sichtbar** — in genau dem Zustand, in dem ich ihn
  verlassen hatte: Statuszeile „Löscht …", Liste „0 von 456 / Keine Karten.", ein halb
  ausgefülltes „Neue Karte"-Formular. Wer nicht weiß, was passiert ist, hält das für einen
  Absturz. Am Ende meiner Sitzung waren bei **null sichtbaren Overlays** noch **drei** iframes
  geladen (Orte, Wege, Kraftlinien) — jedes mit seiner vollen Liste im Speicher.
  Das erklärt vermutlich auch B2: die Liste wird beim Wiederöffnen nicht neu geholt.
- **Erwartet:** Ein Editor-Overlay, das beim Schließen entladen wird (`src=""` oder Entfernen aus
  dem DOM), und beim Öffnen frisch geladen.
- **Beleg:** Live ausgelesen: `document.querySelectorAll('.political-territory-editor-dialog')`
  → 3 Treffer, davon einer 1009 × 420 px (`display:flex` am Wirt), zwei 0 × 0 (`display:none`);
  `frames.length` = 2 mit den Titeln „Avesmaps – Karten bearbeiten" und „Avesmaps – Abenteuer
  bearbeiten". Bildschirmfoto des zurückgekehrten Karten-Editors vorhanden. Endstand 10:40:
  `overlaysOffen: 0`, `frames: 3`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B7 Die Kartensammlung hat keinen Quellen-Editor — obwohl 347 von 457 Karten eine Quelle tragen
- **Kategorie:** AKUT
- **Fundstelle:** `html/citymap-editor.html` (Spalten „Stammdaten" und „Orte", kein Quellenblock)
  gegen `api/edit/map/feature-sources.php:56` und `api/app/feature-sources.php:37`, deren
  Whitelist `citymap` ausdrücklich enthält
- **Beobachtung:** Karten sind vollwertige Bürger des gemeinsamen Quellensystems: der öffentliche
  Lesepfad liefert für eine Karte dieselbe `feature_sources`-Zeile wie für einen Ort. Aber der
  Karteneditor bietet keine Stelle, an der man eine Quelle hinzufügen, korrigieren oder entfernen
  könnte — `/Quelle/` kommt im gesamten Detailbereich nicht vor. Zum Vergleich: der Ort-Dialog,
  der Kraftlinien-Editor und der Vorkommen-Editor haben alle drei einen vollständigen
  Quellenblock mit „Hinzufügen" und „✕". Eine falsche Kartenquelle ist damit nur über einen
  erneuten Wiki-Sync zu korrigieren — also gar nicht, wenn sie aus dem Wiki so kommt.
- **Erwartet:** Derselbe Quellenblock wie im Ort-Dialog, an derselben Stelle der
  Eigenschaften-Spalte (Reihenfolge laut Designsprache: … → Quellen zuletzt).
- **Beleg:** Live. Detailbereich des Karteneditors ausgelesen: Abschnitte IDENTITÄT · WEITERE
  LINKS · EINORDNUNG · EIGENSCHAFTEN, `hasQuellen: false`. Gegenprobe am Datenmodell:
  `GET /api/app/citymaps.php` → **347 von 457** Karten mit nicht-leerem `sources`; für
  „Al'Anfa und das Regengebirge" (`6efdaae9-…`) liefert
  `GET /api/app/feature-sources.php?entity_type=citymap&entity_public_id=6efdaae9-…`
  dieselbe Quelle → sie liegt in der gemeinsamen Tabelle, nicht in einem Sonderfeld.
- **Sicherheit:** BELEGT
- **Aufwand:** klein (die Komponente existiert und wird dreimal wiederverwendet)

### B8 Ein von Hand angelegtes Abenteuer ist ungefragt „Offizielles Produkt"
- **Kategorie:** AKUT
- **Fundstelle:** Anlegen-Formular `html/adventure-editor.html` (Kasten „Offizielles Produkt")
  gegen die Antwort von `GET /api/app/adventures.php`
- **Beobachtung:** Ich habe ein Abenteuer nur mit Titel und Wiki-Link angelegt und den Haken
  „Offizielles Produkt" nie berührt. Der öffentliche Endpunkt lieferte danach
  `"is_official": true`, und im Editor stand der Haken gesetzt. Bei einer Fan-Datenbank, die
  offizielle von inoffiziellen Quellen unterscheiden will, ist „offiziell" die eine Angabe, die
  nicht raten darf. Der Karteneditor macht es an derselben Stelle vorbildlich anders und erklärt
  es sogar: „**„unbekannt" ist eine gültige Antwort und keine Lücke**: der Leser sieht die
  Eigenschaft dann gar nicht, statt ein erfundenes „nein"." Genau diese Haltung fehlt hier.
  Nebenbefund derselben Anlage: aus dem erfundenen Titel wurde ungefragt ein öffentlicher
  Suchlink zur Deutschen Nationalbibliothek erzeugt.
- **Erwartet:** Vorbelegung „unbekannt"/aus, oder — wenn ein Dreizustand zu teuer ist — wenigstens
  aus.
- **Beleg:** Live. Angelegt 10:02 nur mit Titel + Wiki-URL; `GET /api/app/adventures.php`
  (anonym) liefert für `c443afdc-…`: `"is_official": true`, `"links":[{"key":"wiki",…},
  {"key":"dnb","label":"Dt. Nationalbibliothek","url":"…query=ZZ-Systemtest%20Abenteuer…"}]`.
  Bildschirmfoto zeigt den gesetzten Haken mit der Marke „manuell".
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B9 Der meistgebrauchte Anlegen-Dialog ist der einzige, der bei fehlender Pflichtangabe schweigt
- **Kategorie:** KANN
- **Fundstelle:** `index.html` `#location-edit-form` (`novalidate`), `#location-edit-status`
  bleibt leer; Gegenstücke `html/citymap-editor.html` („Ein Titel ist erforderlich.") und
  `html/adventure-editor.html` („Titel fehlt.")
- **Beobachtung:** „Neuer Ort" mit leerem Namensfeld und **echtem** Klick auf „Speichern":
  nichts passiert. Kein Text, keine Färbung, kein `aria-invalid`, der Fokus springt nicht ins
  Feld, der Dialog bleibt offen. Das Feld ist zwar `required`, aber das Formular trägt
  `novalidate`, also unterdrückt auch der Browser seine eigene Meldung („Fülle dieses Feld aus.").
  Drei Anlegen-Dialoge, drei Verhaltensweisen — und der am häufigsten benutzte ist der stumme.
- **Erwartet:** Eine Meldung an derselben Stelle wie in den anderen beiden, und der Fokus ins Feld.
  Am besten für alle drei derselbe Satz.
- **Beleg:** Live. Echter Mausklick auf „Speichern" (1480/1104 CSS) → `#location-edit-status`
  `innerText` = `""`, `class` unverändert, `document.activeElement` = `BODY`,
  `name.className` = `""`, `aria-invalid` = null. Gegenprobe:
  `name.required = true`, `name.checkValidity() = false`,
  `validationMessage = "Fülle dieses Feld aus."`, `form.noValidate = true`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B10 Der Kraftlinien-Editor kann keine Kraftlinie anlegen
- **Kategorie:** KANN
- **Fundstelle:** Kraftlinien-Editor (Verben: „Hinzufügen", „Speichern", „Linie löschen", „◎",
  „✕", „+ Nodix hinzufügen") gegen `js/map-features/map-features-powerlines.js:684`
  (`create_powerline` als Kartengeste) und `html/wiki-sync-powerline-editor.html:527`
  (dasselbe, aber mit `name` = **vorhandener** Linienname)
- **Beobachtung:** Der Editor listet 59 Kraftlinien und kann eine vorhandene verlängern, umbenennen
  und löschen — aber es gibt kein „+ Neu". Eine neue Linie entsteht nur auf der Karte, indem man
  zwei Nodices verbindet; sie bekommt dann den automatischen Namen „A - B". Wer eine benannte
  Linie neu anlegen will, muss sie erst auf der Karte erzeugen und dann umbenennen — und beim
  Umbenennen auf einen vorhandenen Namen **verschmelzen die Gruppen**. Das ist die eine
  Objektart, bei der ich das Anlegen bewusst **nicht** ausgeführt habe: eine neue Kante kann in
  eine fremde Linie hineinwachsen, und „Linie löschen" hätte dann die fremde Linie mitgenommen.
- **Erwartet:** „+ Neu" im Editor mit Namensfeld und zwei Nodix-Auswahlfeldern — dieselben beiden
  Autovervollständigungen, die „+ Nodix hinzufügen" schon hat.
- **Beleg:** Live: sichtbare Knöpfe des Editors nach Auswahl einer Linie:
  `["Dubletten zeigen", "Hinzufügen", "Speichern", "Linie löschen", "◎", "✕",
  "+ Nodix hinzufügen"]`. Kartenmenü `#map-context-menu` vollständig ausgelesen — enthält
  „Neuer Ort / Neue Kreuzung / Neuer Weg / Neues Label / Neues Herrschaftsgebiet / Neue
  Derographische Region / Neue Vegetation / Neue Topographie / Grenze aus Territorien …",
  **keine** Kraftlinie.
- **Sicherheit:** BELEGT (Oberfläche); die Verschmelzungsgefahr ist aus Spec + Code hergeleitet →
  PLAUSIBEL
- **Aufwand:** klein

### B11 Drei Fensterhüllen, fünf Klassenpräfixe, sieben verschiedene Menübänder
- **Kategorie:** KANN
- **Fundstelle:** die sechs Editor-Overlays plus der Ort-Dialog (Maße in Tabelle 2)
- **Beobachtung:** Die Editoren sehen von weitem gleich aus und sind von nahem sieben Varianten:
  * **Hülle — drei Stück, sauber nach Herkunft getrennt, aber nie zusammengeführt:**
    Orte, Wege und Kraftlinien liegen in **`avm-editor-dialog`** (eigene Overlay-Ids
    `avesmaps-settlement-editor-overlay` / `…-path-editor-overlay` / `…-powerline-editor-overlay`),
    Territorien, Abenteuer und Karten in **`political-territory-editor-dialog`**, und Vorkommen
    in **`location-report-dialog` + `wiki-sync-conflicts-dialog`** — also in der Hülle des
    Meldeformulars und des Konfliktzentrums, die es sich zusätzlich mit dem „Neuer Ort"-Dialog
    teilt.
  * **Präfix innen:** `ce-` (Karten), `ae-` (Abenteuer), `lore-` (Vorkommen), `avm-` (Wege) und
    **gar keins** bei Orte/Territorien/Kraftlinien — dort heißen die tragenden Container
    `controls` und `cols`, zwei Wörter, die jedes fremde Stylesheet ebenfalls benutzen könnte.
  * **Menüband:** 3 / 4 / 5 / 5 / 5 / 7 / 9 Kacheln bei 322,7 / 240,5 / 191,2 / 191,2 / 187,2 /
    134,9 / **103,6** px Breite. Das ist keine gemeinsame Zeile mehr, sondern siebenmal dieselbe
    Idee.
  * **Kachelabstand und -höhe** sind überall 6 px / 48 px — außer Vorkommen (**8 px / 51 px**) und
    Abenteuer (49 px).
  **Was gut ist und so bleiben soll:** die Spaltentitel sind in **allen** Editoren identisch
  (16 px, fett, `rgb(220,199,126)`), und die Spalten sind in **sechs von sieben** exakt
  336/336/336 px — die Owner-Regel „drei gleiche Spalten" trägt. Nur Vorkommen weicht ab:
  **320 / 310,3 / 310,3 px** (25,7 px schmaler und in sich ungleich), weil es als einziges nicht
  ein Drei-, sondern ein Zwei-Raster (`320px 636px`) mit einer Unterteilung ist.
- **Erwartet:** Eine Hülle, ein Präfix, ein Menüband-Raster. Vorkommen zuerst — es ist der
  einzige, der aus der Reihe fällt, und er benutzt zusätzlich die Zeilenklasse des
  Abenteuer-Editors (`wiki-sync-adv-picker__row`) für seine Liste.
- **Beleg:** Hüllen live über die Elternkette jedes Editor-iframes ausgelesen:
  `{"Orte":"avm-editor-dialog__frame | host=avm-editor-dialog#avesmaps-settlement-editor-overlay",
  "Wege":"…#avesmaps-path-editor-overlay", "Kraftlinien":"…#avesmaps-powerline-editor-overlay"}`;
  Karten/Abenteuer/Territorien über `document.querySelectorAll('.political-territory-editor-dialog')`
  (drei Treffer); Vorkommen über die Kette `.location-report-dialog__header` →
  `#wiki-sync-lore-dialog.location-report-dialog.wiki-sync-conflicts-dialog` →
  `#wiki-sync-lore-overlay`.
  Alle Maße live gemessen bei 1045 × 496 CSS-px über `getComputedStyle` /
  `getBoundingClientRect`; Rohwerte in Tabelle 2. Beispiel Vorkommen:
  `lore-dlg__body { grid-template-columns: 320px 636px }`,
  `lore-detail__cols { 310.333px 310.333px }`, `lore-ribbon { 5 × 187.198px, gap 8px }`.
  Beispiel Territorien: `controls { 9 × 103.552px, gap 6px }`, Spalten 335,55/336,23/336,22.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B12 „Zuletzt gesynct" heißt viermal anders — und bei Vorkommen stehen zwei verschiedene Zeiten für dieselbe Tatsache
- **Kategorie:** KANN
- **Fundstelle:** Reiterschiene `#wiki-sync-subject-rail` (`title`-Text) gegen die Verbzeile
  darunter und gegen die Menübänder der Editoren
- **Beobachtung:** Dieselbe Angabe trägt vier Namen: „**Zuletzt gesynct:**" (Schiene, Wege,
  Kraftlinien), „**Letzte Sync:**" (Orte, Abenteuer), „**letzte Sync:**" (Territorien),
  „**Dump:**" (Karten). Schlimmer ist der Zahlenwert bei **Vorkommen**: die Schiene sagt
  „Vorkommen — Zuletzt gesynct: **26.07.2026, 09:01**", die Verbzeile zwei Zeilen darunter
  „Zuletzt gesynct: **26.7.2026, 11:01:16**". Zwei Stunden Unterschied (UTC gegen Ortszeit),
  dazu einstellige Monatszahl und Sekunden. Bei allen anderen sieben Subjekten stimmen die
  beiden Angaben zeichengleich überein. Und: die Schiene zeigt für Vorkommen **gar kein Datum**,
  bis man das Subjekt einmal geöffnet hat.
- **Erwartet:** Ein Wort, ein Format, eine Zeitzone — und der Wert beim ersten Aufbau der Schiene.
- **Beleg:** Live ausgelesen. `title`-Attribute der acht Schienenzeilen:
  `"Orte — Zuletzt gesynct: 03.08.2026, 01:19"` … `"Vorkommen — Zuletzt gesynct: 26.07.2026, 09:01"`.
  Verbknopf desselben Subjekts: `"Vorkommen bearbeitenZuletzt gesynct: 26.7.2026, 11:01:16"`.
  Zum Vergleich Orte: Knopf `"Orte bearbeitenZuletzt gesynct: 03.08.2026, 01:19"` — identisch.
  Vor dem ersten Öffnen las die Schienenzeile nur `"Vorkommen"`, danach `"Vorkommen26.07."`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B13 Für dieselbe Menge Wege nennt die Oberfläche drei verschiedene Zahlen
- **Kategorie:** KANN
- **Fundstelle:** Panel-Sichtreiter, Panel-Statuszeile und Wege-Editor
- **Beobachtung:** Im selben Fenster, übereinander: Reiter „Alle (**4126**)", darunter
  „**596** Wege · 5788 Karten-Segmente", und im Editor „**4073** Wege · 5788 **Abschnitte**".
  Drei Zahlen und zwei Wörter für dieselbe Sache. Dazu hat der Editor **fünf** Sichten
  (Alle/Platziert/Fehlt/Konflikte/Flussrichtung unbekannt), das Panel **sechs** — im Editor
  fehlt „Ausreißer". Auch das Zahlformat ist uneinheitlich: nur Vorkommen setzt Tausenderpunkte
  („5.104", „1.382"), alle anderen schreiben „4126", „3414", „1038".
- **Erwartet:** Eine Zählung, ein Wort, ein Format. (Welche der drei Zahlen richtig ist, kann ich
  von außen nicht sagen — genau das ist das Problem.)
- **Beleg:** Live abgelesen, 09:35 und 10:37. Panel: `"Alle (4126)"` und
  `"596 Wege · 5788 Karten-Segmente"`. Editor „Wege bearbeiten": Statuszeile
  `"Bereit. 5788 Wege geladen, 605 mit Höhenprofil."`, Listenkopf
  `"4073 Wege · 5788 Abschnitte"`. Bildschirmfoto vorhanden.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B14 „1 Orte" — der Zähler kennt keinen Singular
- **Kategorie:** KANN
- **Fundstelle:** Listenzeile im Karteneditor und im Abenteuer-Editor
- **Beobachtung:** Beide Editoren schreiben in die Listenzeile „**1 Orte**" (und „0 Orte").
  Die Spaltenüberschrift daneben macht es richtig: „Orte (1)". Kleinigkeit, aber sie steht in
  zwei Editoren an der prominentesten Stelle und wird bei jedem zweiten Datensatz sichtbar.
- **Erwartet:** „1 Ort" / „2 Orte", oder die Klammerform der Überschrift auch in der Liste.
- **Beleg:** Live: Karteneditor-Listenzeile `"ZZ-Systemtest Karte GEAENDERT (Agent 12) 1 Orte"`,
  Abenteuer-Listenzeile `"ZZ-Systemtest Abenteuer (Agent 12) gruppenabenteuer — · 1 Orte · manuell"`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B15 „Löschen" sitzt in jedem Editor woanders — und heißt jedes Mal anders zurückgefragt
- **Kategorie:** KANN
- **Fundstelle:** `html/citymap-editor.html:564` (`#ceDelete` in der Speicherleiste),
  `html/adventure-editor.html:798` (`#aeDelete` im Detailkopf), Kraftlinien-Editor (Spalte 2),
  Ort (Marker-Popup), Territorium (nirgends)
- **Beobachtung:** Vier Orte für dieselbe Handlung:
  * **Karten**: unten links **in** der Speicherleiste, direkt neben „Verwerfen" und „Speichern"
    (gemessen y = 342, dieselbe Zeile) — die gefährlichste Nachbarschaft von allen.
  * **Abenteuer**: oben rechts im Detailkopf (gemessen y = 109, Speicherleiste bei y = 777).
  * **Kraftlinien**: als „Linie löschen" mitten in der Eigenschaftenspalte.
  * **Ort**: gar nicht im Bearbeiten-Dialog, sondern im Popup des Markers.
  Und die Rückfrage ist dreimal verschieden gebaut: Karten und Ort benutzen einen
  Browser-Bestätigungsdialog, Abenteuer verwandelt den Knopf in einen roten
  „**Wirklich löschen? (mit 1 Ort)**" (zweiter Klick bestätigt).
  **Ausdrücklich gut:** die Texte selbst sind vorbildlich. Karten fragt:
  „„ZZ-Systemtest Karte GEAENDERT (Agent 12)" wirklich endgültig löschen? / Entfernt die Karte
  samt Orten, Typen und Fundort-Links. Eine Wiki-Karte kommt beim nächsten „Karten syncen"
  zurück; eine eigene/manuelle Karte ist dann weg." Das nennt das Objekt, die Folgen **und**
  den Unterschied zwischen Wiki- und Eigenbestand. Diesen Text sollten die anderen erben.
- **Erwartet:** Eine Position (Vorschlag: Detailkopf, weit weg von „Speichern"), ein Muster für
  die Rückfrage — das In-Ort-Muster des Abenteuer-Editors ist das robustere, weil es die
  Fernsteuerung/Barrierefreiheit nicht an einen Browserdialog abgibt.
- **Beleg:** Positionen live gemessen (`getBoundingClientRect`), Bestätigungstexte über ein
  protokollierendes `window.confirm` mitgeschnitten und danach wiederhergestellt.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B16 Vorkommen öffnet auf „Fauna", obwohl „Alle" davorsteht
- **Kategorie:** KANN
- **Fundstelle:** Sichtreiter des Subjekts „Vorkommen" im Editor-Panel
- **Beobachtung:** Die Reiterzeile lautet „Alle (5.104) · Fauna (1.382) · Flora (1.004) ·
  Waren (2.531) · Spezies (187)"; aktiv ist beim Öffnen **Fauna**. Alle sieben anderen Subjekte
  öffnen auf ihrem ersten Reiter („Alle"). Wer nach einer Ware sucht, sucht zunächst in 1.382
  Tieren und findet nichts.
- **Erwartet:** „Alle" ist aktiv, oder „Alle" steht nicht an erster Stelle.
- **Beleg:** Live: `document.querySelectorAll('#review-panel button.is-active')` →
  `["WikiSync", "Vorkommen26.07.", "Fauna (1.382)"]`, direkt nach dem Wechsel auf das Subjekt.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B17 Auch „Rückgängig" lässt den Quellenverweis öffentlich stehen (Bestätigung und Verschärfung von Agent 11 B5)
- **Kategorie:** AKUT
- **Fundstelle:** `api/app/feature-sources.php` (öffentlicher Lesepfad ohne Aktiv-Filter) gegen
  `undo_create_point` / `delete_feature` in `api/_internal/map/features.php` — beide fassen
  `feature_sources` nicht an
- **Beobachtung:** Ich habe einen Ort **mit** Quelle angelegt und ihn dann nicht gelöscht,
  sondern über den Reiter „Änderungen" **rückgängig gemacht**. Der Ort verschwand aus der Suche;
  der **anonyme** Aufruf von `feature-sources.php` lieferte die Quelle unverändert weiter, und
  der gemeinsame Quellenkatalog zählte sie weiter als benutzt (`uses: 1`). „Rückgängig" ist damit
  nicht das Gegenteil von „Anlegen" — es lässt einen öffentlich abrufbaren Rest zurück, und zwar
  einen, den die Oberfläche danach nicht mehr anzeigt (das Feld gehört ja zu einem Ort, den es
  nicht mehr gibt).
  Zweiter Teil desselben Befunds: **das Lösen einer Quelle über „✕" wirkt sofort, ohne Rückfrage
  und ohne Protokollzeile.** Zwischen 54022 (10:29:34) und 54023 (10:32:35) steht nichts,
  obwohl ich um ~10:31 einen Verweis gelöst habe.
- **Erwartet:** `undo_create_point` und `delete_feature` deaktivieren die Verweise mit (und
  `undo_delete_feature` holt sie zurück — dieser Weg funktioniert bereits vollständig), oder der
  öffentliche Lesepfad filtert auf aktive Objekte.
- **Beleg:** Live, 10:27–10:32, Ort `ee3cea33-6b17-41ab-9df9-c22880d47fe9`.
  Nach „Rückgängig": `map-search.php?q=ZZ-Systemtest` → **0 Treffer**;
  `feature-sources.php?entity_type=settlement&entity_public_id=ee3cea33-…` mit
  `credentials:'omit'` → **1 Quelle**; `source-search.php?q=ZZ-Systemtest` → `uses: 1`.
  Nach Wiederherstellen + „✕" + Löschen: Suche 0, Quellen 0, `uses: 0`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B18 Im Wege-Editor rutscht die fünfte Sicht aus der Reiterzeile
- **Kategorie:** KANN
- **Fundstelle:** Listenspalte des Wege-Editors
- **Beobachtung:** Die Reiterzeile trägt „Alle · Platziert · Fehlt · Konflikte"; die fünfte Sicht
  „**Flussrichtung unbekannt**" bricht auf eine eigene Zeile darunter um und steht dort ohne
  Reiter-Optik — sie sieht aus wie eine Bildunterschrift, nicht wie etwas Klickbares. Gemessen:
  die vier oberen Reiter liegen auf y = 135, „Flussrichtung unbekannt" auf y = 168, das Suchfeld
  darunter auf y = 213.
- **Erwartet:** Umbruch mit gleicher Reiter-Optik, oder die seltene Sicht in den Filter-Trichter.
- **Beleg:** Live gemessen (`getBoundingClientRect().y` je Knopf) + Bildschirmfoto.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B19 Im Territorien-Menüband sind vier von neun Beschriftungen abgeschnitten
- **Kategorie:** KANN
- **Fundstelle:** `controls`-Raster des Territorien-Editors — neun Kacheln zu je 103,55 px
- **Beobachtung:** Bei 1045 px Fensterbreite lesen sich vier der neun Kacheln als
  „**Daten über…**", „**Modell über…**", „**Wappen lok…**", „**🔗 Links pr…**". Der volle Text
  wäre „Daten übernehmen", „Modell übernehmen", „Wappen lokalisieren", „Links prüfen" — also
  genau die Knöpfe, deren Wirkung man vor dem Drücken kennen möchte. Zum Vergleich: dieselbe
  Zeile hat bei Kraftlinien 322,7 px je Kachel. Der Titel steht als `title`-Attribut nicht zur
  Verfügung; man erfährt den Rest erst durch Ausprobieren.
- **Erwartet:** Zwei Reihen zu vier bis fünf Kacheln statt einer Reihe zu neun, oder ein `title`.
- **Beleg:** Live gemessen: `controls { grid-template-columns: 9 × 103.552px; gap: 6px }`,
  `text-overflow: clip`; Bildschirmfoto zeigt die vier gekürzten Beschriftungen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B20 Es gibt keinen Entwurfszustand — mit dem ersten Speichern ist alles öffentlich
- **Kategorie:** ZUKUNFT
- **Fundstelle:** `GET /api/app/citymaps.php`, `GET /api/app/adventures.php` (beide öffentlich,
  ohne Zustandsfilter)
- **Beobachtung:** Eine Karte mit dem Titel „ZZ-Systemtest Karte (Agent 12)" und einem erfundenen
  Link war **in dem Moment**, in dem ich „Speichern" drückte, für jeden anonymen Besucher
  abrufbar — ebenso das Abenteuer, und ebenso dessen Zuordnung zur echten Stadt Ferdok, die in
  deren Infobox als „spielt hier (Spoiler)" erschienen wäre. Für eine Redaktion, die einen
  Eintrag über mehrere Sitzungen aufbaut (der Karteneditor hat rund 25 Felder), ist das
  unangenehm: es gibt keinen Weg, etwas anzufangen, ohne es zu veröffentlichen.
  Die Bausteine wären da — `adventure` und `citymap` kennen bereits `origin`/`status`, Bewertungen
  kennen `is_hidden`.
- **Erwartet:** Ein Zustand „Entwurf", der im Editor sichtbar ist und aus dem öffentlichen
  Lesepfad herausfällt; sichtbar in der Liste (die Marke „manuell" ist die halbe Miete).
- **Beleg:** Live: unmittelbar nach dem Anlegen liefert `fetch('/api/app/citymaps.php',
  {credentials:'omit'})` den Datensatz `dc57edc3-58c9-4e48-a5f4-d67a6eae607f` mit; ebenso
  `adventures.php` den Datensatz `c443afdc-…` samt `places:[{raw_name:"Ferdok", …}]`.
- **Sicherheit:** BELEGT
- **Aufwand:** groß

---

## Was gut ist (und beim Aufräumen nicht verlorengehen darf)

1. **Die Erklärtexte im Karteneditor sind das Beste, was ich in diesem System gesehen habe.**
   Sie erklären nicht das Feld, sondern die *Entscheidung*: „„Urheber" ist, wer die Karte
   gezeichnet hat (Ina Kramer). „Verlag" ist, wer den Band gedruckt hat …", und vor allem
   „**„unbekannt" ist eine gültige Antwort und keine Lücke**". Das ist der Ton, den die anderen
   Editoren übernehmen sollten.
2. **Die Ort-Autovervollständigung im Abenteuer-Editor** trennt sauber zwischen Stadt,
   Herrschaftsgebiet, Bauwerk *in* der Stadt und Freitext („‚Ferdok' als freien Ort hinzufügen").
   Sieben Treffer mit Typmarke, dazu der Freitext-Ausweg — das ist gelöst.
3. **Der Quellenblock im Ort-Dialog** zeigt einen noch nicht gespeicherten Verweis als
   „**WIRD BEIM ANLEGEN ÜBERNOMMEN**". Ein Zustand, den man sofort versteht.
4. **Die Rückgängig-Kette bei Kartenobjekten ist exakt.** create → Rückgängig →
   Wiederherstellen (54020 → 54021 → 54022) traf den Ausgangszustand punktgenau, und die
   Bestätigungsfragen nennen immer das Objekt beim Namen.
5. **Die Landschaften-Einträge im Protokoll bündeln die Geste** — „Mit anderer vereinigen
   **(3 Schritte)**". Genau diese Angabe (WAS ist passiert) fehlt den Kartenobjekt-Einträgen,
   die nur „Ort geändert" sagen. Die bessere Fassung existiert also schon im Haus.
6. **Drei gleiche Spalten und gleiche Spaltentitel** halten in sechs von sieben Editoren
   pixelgenau. Die Designsprache trägt; es sind die Ränder, die auseinanderlaufen.

---

## Was ich nicht wegbekommen habe

**Nichts.** Alle vier Objekte, die ich angelegt habe, sind nachweislich wieder entfernt:

| Objekt | Bezeichner | Nachweis (10:38 Ortszeit) |
|---|---|---|
| Kartensammlung | `ZZ-Systemtest Karte GEAENDERT (Agent 12)`, `dc57edc3-58c9-4e48-a5f4-d67a6eae607f` | anonym `citymaps.php`: 457 → **456**, kein Treffer |
| Abenteuer | `ZZ-Systemtest Abenteuer (Agent 12)`, `c443afdc-e61d-456f-8884-a0f606d11895` | anonym `adventures.php`: 1353 → **1352**, kein Treffer |
| Ort | `ZZ-Systemtest Ortsprobe (Agent 12)`, `ee3cea33-6b17-41ab-9df9-c22880d47fe9` | `map-search.php?q=ZZ-Systemtest` → **`results: []`**; `feature-sources.php` → **leer** |
| Quellenverweis | Verweis auf `source_id 1224935` | gelöst; Katalog wieder **`uses: 0`** |

**Bewusst nicht angefasst** (und daher auch nichts zurückzunehmen): Weg, Landschaftsregion,
Territorium, Kraftlinie — Begründung oben unter „Prüfumgebung" und in B10.

**Nicht von mir, bleibt aber liegen:** die Katalogzeile `sources` **id 1224935**
(`ZZ-Systemtest Quellenband (Agent 11)`, jetzt wieder `uses 0`). Ich habe sie **absichtlich
wiederverwendet**, statt eine zweite Waise anzulegen — sie war Agent 11s Rest und ist es
geblieben. 🔧 **DU:** die eine Zeile von Hand entfernen; eine Oberfläche dafür gibt es nicht
(Agent 11 B14).

**Am Browser des Owners zurückgesetzt:** das protokollierende `window.confirm` (in der Kartenseite
und in den Editor-iframes) wieder auf das Original; alle Editor-Overlays geschlossen.
**Nicht verändert:** Farbschema (`dark`), Kartenmodus („Landschaften"), Sprache, Zoom-Einstellungen.
Die Kartenansicht ist zu meinem Testort geflogen — reine Sitzungsanzeige, kein gespeicherter Wert.

---

## Serverzustand am Ende

Antwortbereit, kein Ausfall. Einzelproben 10:38–10:40 Ortszeit: `session.php` **24 ms** (200),
`map-search.php?q=…` **423 ms** (Grundlinie 500 ms aus `0-koordination.md`). Ich habe **keine**
teure Aktion ausgelöst: kein „Dump holen", kein Sync/Reconcile, keine „Vorschauen holen", kein
„Wegprofile rechnen/kalibrieren", kein „Zugehörigkeit rechnen", kein Backup, keinen Linkchecker,
keinen Massenlauf. Kein Endpunkt wurde in einer Schleife abgefragt.
Fremde Objekte habe ich in keinem Editor verändert; die einzigen Klicks auf fremde Datensätze
waren Auswahlklicks zum Lesen (Aal, Aguaduron, Akrabaal – Kreuzung, Aarenstieg).
