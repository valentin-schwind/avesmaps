# Editor-Handbuch — Design-Spec

- **Datum:** 2026-07-07
- **Status:** Entwurf (Ergebnis des Brainstormings, wartet auf Owner-Review)
- **Thema:** In-App-Onboarding-Handbuch für neu eingeladene Editoren

## 1. Zweck & Zielgruppe

Wir laden neue menschliche Editoren ein (vertrauenswürdige Community-Mitwirkende,
DSA-/Aventurien-Fans, in der Regel **nicht technisch**), die bei der Pflege der
Karte helfen sollen. Heute gibt es **kein Onboarding-Material**. Diese Spec
beschreibt ein **Editor-Handbuch**: eine einzelne, eigenständige Seite mit
expliziten Schritt-für-Schritt-Anweisungen „wie/wo mache ich was", die die gesamte
Bandbreite der Editorarbeit abdeckt.

- **Zielgruppe:** General-Editoren — sollen langfristig das ganze Werkzeug
  beherrschen (Karten-Features, Wiki-Verknüpfung, Territorien, WikiSync,
  Meldungen), nicht nur eine Nische.
- **Ton:** freundlich, konkret, aufgabenorientiert, nicht technisch. Echte
  UI-Bezeichnungen, kurze nummerierte Schritte, „mach das, dann das".

## 2. Umfang

**Im Umfang** — das Handbuch deckt jeden Editor-Workflow ab, gruppiert in
Abschnitte A–H (siehe §4):

- Zugang bekommen & erste Schritte (Login unter `/edit/`, Orientierung in der App).
- Karten-Features bearbeiten: Orte/Siedlungen, Wege (Flüsse/Straßen/Pfade),
  Kraftlinien, Labels, Regionen.
- Wiki-Verknüpfung: Siedlungen, Wege, Labels; „Link teilen"; Spotlight-Suche.
- Herrschaftsgebiete (Territoriumseditor): Hierarchie, Geometrie, Zoom-Bänder,
  Hauptstädte, Gültigkeit (BF-Jahre), abgeleitete Außengrenzen, umstrittene
  Gebiete.
- WikiSync: Wiki Aventurica crawlen, Fälle auflösen.
- Meldungen & Community: Meldungen, Bewertungen, Präsenz/Status.
- Spezial-Workflows: Flussrichtung, Weg-Namen-Labels, Straßen-Wiki-Zuweisung,
  Verlauf-Sync.
- Regeln, Etikette & Fallstricke.

**Nicht im Umfang (Nicht-Ziele, YAGNI):**

- Interaktive In-App-Tour (die live die UI hervorhebt).
- Mehrseitiges Handbuch / getrennte URLs pro Thema.
- Vollständige Screenshot-Abdeckung in v1 — stattdessen Platzhalter (siehe §6).
- Admin-Workflows (Nutzerkonten anlegen), außer einem kurzen „du hast Zugangsdaten
  erhalten"-Hinweis.
- Englische Übersetzung des Handbuchs (nur Deutsch; app-weite i18n ist ein
  separater, späterer Meilenstein).

## 3. Format & Auslieferung

- **Einzelne eigenständige HTML-Seite:** `html/editor-handbuch.html`, nach dem
  bestehenden `html/*.html`-Muster (z.B. `html/wiki-sync-monitor.html`). Kein
  Build-Schritt; direkt ausgeliefert; deployt automatisch über die
  STRATO-Allowlist (der `html/`-Ordner wird bereits mitgespielt).
- **Öffentlich / extern erreichbar:** kein Login-Gate. Editoren öffnen sie als
  normale Browserseite, können sie als Lesezeichen speichern, und der Owner kann
  die URL direkt in die Einladung packen. Sie enthält keine Geheimnisse.
- **Sprache:** Deutsch (Editor-Inhalt; passt zur deutschen Default-Sprachpolitik
  der App).
- **Layout:** eine Seite mit **fester Seitenleiste** (Inhaltsverzeichnis) und
  verankerten Abschnitten; per `#anker` tief verlinkbar; komplett per Strg-F
  durchsuchbar. Optik an die App angelehnt (App-CSS-Variablen / ein kleines eigenes
  Stylesheet).
- **Zurück-Link:** ein gut sichtbarer „Zurück zur Karte"-Link oben, der auf
  `https://avesmaps.de/edit/` zeigt.

## 4. Gliederung (Abschnitte A–H)

Jeder Abschnitt beschreibt den *geplanten Inhalt*, nicht den fertigen Text.

- **A. Grundlagen & erste Schritte** — Was ein Editor tut; die goldenen Regeln
  (Wiki Aventurica ist maßgeblich; kleine, sorgfältige Schritte; im Zweifel
  fragen). Zugang bekommen (du erhältst Zugangsdaten vom Betreiber — siehe §8.1).
  Anmelden unter `avesmaps.de/edit/` (Benutzername/Passwort, Editor-Rolle nötig);
  die Edit-Shell (obere Leiste mit Name | Rolle, „Abmelden"; die Karte läuft in
  einem iframe mit `?edit=1`). Orientierung: die Karte, das **„Editor"-Panel** und
  seine Reiter (Meldungen/Änderungen/WikiSync/Status), das
  **Rechtsklick-Kontextmenü**. Rollen (editor/reviewer/admin) und wer was darf.
- **B. Karten-Features bearbeiten** — Orte/Siedlungen (anlegen, verschieben, Typ
  metropole…gebäude wählen, Eigenschaften bearbeiten, Wappen); Wege/Flüsse/Straßen
  (Geometrie über Handles bearbeiten: Vertices ziehen/einfügen/löschen, Subtyp,
  Name/Label); Kraftlinien; Labels (Regionen-/Landschaftsnamen); Regionen
  (Geometrie + Zuordnung). Speichern vs. Verwerfen; der „Änderungen"-Reiter
  (Audit-Log).
- **C. Mit dem Wiki verknüpfen** — Warum verknüpfen (Wiki = Wahrheit). Siedlung ↔
  Wiki-Seite (Picker); Weg/Fluss/Straße ↔ Wiki (Namensregeln,
  Zuweisen/Ändern/Entfernen); Label ↔ Wiki; „Link teilen" (bevorzugt den
  Wiki-Link); Spotlight-Suche.
- **D. Herrschaftsgebiete (Territoriumseditor)** — Öffnen per Rechtsklick auf ein
  Gebiet → „Territoriumseditor öffnen"; Hierarchie/Breadcrumb (Eltern-Kind);
  Geometrie; Zoom-Bänder / min_zoom; Hauptstädte; Gültigkeit (BF-Jahre,
  `9999` = offen/nie aufgelöst); abgeleitete Außengrenzen; umstrittene Gebiete
  (Schraffur).
- **E. WikiSync** — Was es tut (crawlen → Staging → Fälle). Einen WikiSync-Lauf
  starten; Fälle prüfen und auflösen; Dump-vs-API-Politik.
- **F. Meldungen & Community** — Der Meldungen-Reiter (Nutzer-Meldungen
  abarbeiten); Bewertungen/Reviews; Status/Präsenz (wer bearbeitet gerade).
- **G. Spezial-Workflows** — Flussrichtung; Weg-Namen-Labels;
  Straßen-Wiki-Zuweisung (das kanonische Bulk-Verfahren); Verlauf-Sync.
- **H. Regeln, Etikette & Fallstricke** — Wiki = Wahrheit; kleine Schritte; was man
  **nicht** tut (fremde Arbeit nicht löschen, nicht blind massenhaft ändern); wo
  man Hilfe bekommt (siehe §8.2).

## 5. Einstieg: „Tutorial"-Link in der Editor-Statuszeile

- **Ort:** die Editor-Statuszeile `#map-data-status`, die **innerhalb** des
  Editor-Panels liegt (`<aside id="review-panel">`, für die Öffentlichkeit
  `hidden`) → der Link ist von Natur aus **nur für Editoren** sichtbar (für normale
  Besucher unsichtbar).
- **Gerendert von:** `updateMapDataStatus()` in `js/routing/routing.js` (~Z210-222):
  `$("#map-data-status").text("Map: … | Rev … | … Features").prop("hidden", false)`.
- **Änderung:** die dynamischen Werte über `.text(...)` escaped lassen (ein
  abschließendes `" | "` anhängen), dann per `.append()` ein mit jQuery gebautes
  `<a>`-Element anhängen (`$("<a>", { href, target, rel, text })`), damit nichts
  Dynamisches als HTML injiziert wird (keine XSS-Fläche).
- **Link-Ziel:** die **absolute** URL `https://avesmaps.de/html/editor-handbuch.html`,
  `target="_blank"`, `rel="noopener"` → öffnet als eigenständiger externer Tab und
  bricht aus dem `/edit/`-iframe aus.
- **CSS:** `.map-data-status a { pointer-events: auto; }` in
  `css/layout/map-layout.css` ergänzen (der Container setzt `pointer-events: none`,
  sonst wäre der Link nicht klickbar).
- **Begründung der absoluten URL:** genau ein Produktions-Host; Editoren erreichen
  die App immer über avesmaps.de; garantiert eine saubere Top-Level-Seite
  unabhängig vom iframe-Ursprung. Nachteil: nicht auf localhost portierbar (für
  dieses Ein-Host-Projekt akzeptabel; bewusst so notiert).
- **Reihenfolge:** die Handbuchseite **zuerst** bauen, dann den Link verdrahten
  (sonst 404).

## 6. Bebilderung

- **Text-first:** präzise UI-Bezüge — exakte deutsche Button-/Reiter-/Menü-
  Bezeichnungen.
- **Screenshot-Platzhalter:** klar markierte Slots (gestylte Figuren-Box +
  Bildunterschrift), die der Owner später füllt; das Handbuch ist schon vorher als
  Text voll nutzbar.
- **SVG-Diagramme** (inline erzeugt, keine externen Assets, kein Backend):
  1. Rollen & Rechte (editor/reviewer/admin → wer was darf).
  2. Territorien-Hierarchie (Reich → Grafschaft → Baronie über `parent_id`).
  3. Der Bearbeiten-Klick-Fluss (Rechtsklick → Kontextmenü → Dialog → Speichern →
     Audit).

## 7. Deploy- & Cache-Notizen

- Eigenständige, direkt geladene Seite (kein dynamisch geladenes Editor-Asset),
  daher **kein `ASSET_VERSION`-Bump nötig** — dieser Mechanismus betrifft nur die
  inline geladenen Territoriumseditor-Assets (AGENTS.md §7).
- Die eigenen CSS/JS-Assets der Seite sollten ein manuelles `?v=` tragen wie die
  anderen `html/`-Seiten (dem `wiki-sync-monitor.html`-Vorbild folgen), damit harte
  Reloads Änderungen ziehen.
- Prüfen, dass `html/` in der Deploy-Allowlist steht (tut es —
  `wiki-sync-monitor.html` ist live).
- Die `routing.js`- und `map-layout.css`-Änderungen deployen normal; `index.html`
  bleibt ungestempelt.

## 8. Offene Inhaltspunkte (Owner-Input nötig)

Bis zur Klärung liefert das Handbuch klar markierte Platzhalter aus.

1. **Zugang-Übergabe:** Wie erhalten neue Editoren ihren Benutzernamen/ihr Passwort
   (E-Mail? Discord?) — prägt Abschnitt A.
2. **Hilfe-Kontakt:** Wohin wenden sich Editoren bei Fragen (Discord-Kanal?
   `info@`-E-Mail?) — prägt Abschnitt H.

## 9. Erfolgskriterien (Definition of Done)

- `html/editor-handbuch.html` existiert, ist unter der öffentlichen URL erreichbar
  und rendert eigenständig **ohne** das PHP-Backend.
- Alle acht Abschnitte vorhanden, mit konkreten, korrekten
  Schritt-für-Schritt-Anweisungen und echten UI-Bezeichnungen.
- Feste Inhaltsverzeichnis-Navigation mit funktionierenden Ankern; „Zurück zur
  Karte"-Link funktioniert.
- Die 3 SVG-Diagramme rendern inline; Screenshot-Platzhalter sind sichtbar und klar
  markiert.
- Der „Tutorial"-Link erscheint in der Editor-Statuszeile (nur im Edit-Modus), ist
  klickbar und öffnet das Handbuch in einem neuen externen Tab unter der
  avesmaps.de-URL.
- Keine Regression: die Statuszeile bleibt für die Öffentlichkeit verborgen und
  inhaltlich für Editoren unverändert (bis auf den angehängten Link).

## 10. Umsetzungsreihenfolge

1. `html/editor-handbuch.html` bauen — Struktur, feste Navigation, Styles, die 3
   SVG-Diagramme, echter Schritt-für-Schritt-Inhalt, Platzhalter für die zwei
   offenen Fakten und für Screenshots.
2. Die CSS-Regel `.map-data-status a { pointer-events: auto; }` ergänzen.
3. Den „Tutorial"-Link in `updateMapDataStatus()` verdrahten.
4. Verifizieren: statische Vorschau der Seite (rendert ohne Backend); prüfen, dass
   der Link in der `/edit/`-Shell einen neuen externen Tab öffnet.
5. Später: die zwei offenen Fakten füllen, sobald geliefert; Screenshots einsetzen.
