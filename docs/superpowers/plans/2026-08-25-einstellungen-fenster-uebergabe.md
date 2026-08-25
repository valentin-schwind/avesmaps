# Übergabe — Das Fenster „Einstellungen" (Stand 25.08.2026)

🔴 **GEPARKT auf Owner-Entscheid, nicht abgebrochen.** Owner am 25.08.2026:
*„ok ich werde das Vorhaben zunächst nicht weiterverfolgen, weil ich auf deine Fragen keine
Antworten habe."*

**Es ist NICHTS gebaut.** Kein Endpunkt, keine Seite, keine Zeile Produktivcode. Was existiert,
sind ein Entwurf und zwei Mockups. Am Betrieb hat sich nichts geändert.

---

## §1 Was zuerst zu lesen ist

| Datei | Was drin steht |
|---|---|
| **`docs/superpowers/specs/2026-08-25-einstellungen-fenster-design.md`** | Der Entwurf. §1 ist die Bestandsaufnahme, §2.1 der Auswahlfilter, §3.4 die Reiter, §4 der Dump-Umzug samt Vorgangsanzeige, §5 die Darstellungswerte. |
| **`docs/einstellungen-mockup.html`** | Das Fenster mit sieben Reitern. Lädt die echten Tokens. |
| **`docs/vorgangsanzeige-mockup.html`** | Die Kopfleiste mit dem Vorgangs-Anzeiger, fünf Zustände, drei Breiten. Lädt die echte `css/pages/edit.css`. |

Commits auf `origin/master`, in dieser Reihenfolge:
`d8b1c119` → `766c0424` → `22bdb3c1` → `58812c2e` → `30ae0274` → `ff775c09`.

---

## §2 🔴 DIE DREI FRAGEN, AN DENEN ES HÄNGT

**Sie sind der Grund für den Halt.** Ohne Antworten darf nicht gebaut werden — jede Antwort ändert
die Bauform, nicht nur ein Detail.

### Frage 1 — Wie erfährt die Hülle vom Startwunsch?

Das Einstellungs-Fenster ist ein **eigener Tab**; der Lauf soll in der **Edit-Hülle** laufen (§4.4b
des Entwurfs). Zwei Wege:

* **`BroadcastChannel`** — sofort, kein Serververkehr. ⚠️ Wirkt nur, wenn die Hülle offen ist. Wer
  `/edit/einstellungen.php` direkt über die Adresszeile aufruft, hat keine Hülle, und der Lauf
  startet nie.
* **Eine Zeile in der Datenbank, die die Hülle pollt** — überlebt alles. ⚠️ Kostet eine Abfrage je
  Takt, und AGENTS.md §10 führt genau solche Taktabfragen als Lastquelle auf
  (`edit-mode-livesync-poll-cost`).

### Frage 2 — Angehaltener Lauf: angeboten oder automatisch fortgesetzt?

⚠️ **Automatisch heißt: das bloße Öffnen des Editors startet einen zehnminütigen Lauf, den niemand
angefordert hat.** Angeboten heißt: er bleibt liegen, bis jemand hinsieht — und wer den Editor eine
Woche nicht öffnet, hat eine Woche keinen Dump.

### Frage 3 — Erscheint die Leiste auch im Frontend?

Dort gibt es keine Kopfleiste, und ein Besucher hat mit Vorgängen nichts zu tun.
**Tendenz: nein**, aber nicht entschieden.

---

## §3 Was ENTSCHIEDEN ist (nicht neu verhandeln)

Alle vom Owner am 25.08.2026, teils gegen einen ersten Vorschlag von mir.

1. **Ort:** `/edit/einstellungen.php`, eigene Seite in einem neuen Tab, Eintrag im Drei-Strich-Menü
   der Edit-Hülle unter „Nur Admins", Riegel `admin` **zweimal** (Seite *und* Endpunkt).
   Kein Overlay — der Hamburger sitzt in der äußeren Hülle, die Karte in einem `<iframe>` darin.
2. **Stufe 1 nimmt nur, was heute NIRGENDS bedienbar ist**, plus Neues. Die elf bestehenden
   Editorkacheln bleiben unangetastet.
3. **„Dump holen" zieht VOLLSTÄNDIG um**, der Knopf im WikiSync-Panel fällt weg.
4. **Sieben Reiter**, nach Wirkung geschnitten: Karte · Beschriftung · Reisen · Inhalte ·
   Wiki & Daten · Gemeinschaft · Betrieb. Ein Reiter ohne Inhalt wird trotzdem gezeigt.
5. **Beschriftung = Kollisionsmatrix**, nichts Ortsspezifisches.
6. **Kurvenbeschriftung vollständig hierher** — alle zwölf Werte.
7. **Reisen ist wichtig, aber vertagt.**
8. **Der Lauf gehört der Hülle**, nicht dem Fenster; Fortschritt in der Kopfleiste.

---

## §4 Die Befunde, die man nicht zweimal machen sollte

🪤 **Es gibt keinen Server-Läufer.** Auf STRATO läuft kein Hintergrundprozess und kein Zeitplan im
Haus — `api/social/routine-post.php` wird von **außen** mit Token angestoßen. Ein Schrittlauf
(Dump: bis 2000 Teilschritte, je einer pro Anfrage) kommt nur voran, solange ein Browser ihn treibt.
**„Unabhängig vom Fenster" kann deshalb nur „unabhängig vom Einstellungs-Fenster" heißen.**

💣 **`POLITICAL_FRONTEND_FILL_OPACITY` ist eine ÜBERSTEUERUNG, keine Vorgabe.**
(`map-features-region-rendering.js:202`) Editoren setzen weiter 0,33 / 0,5 / 0,75 und sehen sie —
aber nur im Editor. Ein Besucher sieht **nie** eine davon. `null` gäbe sie frei, und dorthin führt
heute kein Weg (`?fillopacity=` nimmt nur Zahlen). Deshalb ist das Bedienelement zweiwertig.
⚠️ Der Owner hielt es für einen Default; die Annahme ist widerlegt und im Entwurf §5.5 begründet.

⭐ **Das Auswahlkriterium** (Entwurf §2.1): ein `?param=`, der nur existiert, damit jemand einen Wert
*sucht*, ist der Beweis, dass der Wert eine Bedienung verdient hätte. Fünf solche gibt es:
`?fillopacity=` · `?leafbg=` · `?hatchopacity=` · `?labelrepel=` · `?labelwrap=`.
Alles andere bleibt Werkstatt — das Projekt hat mehrere hundert Konstanten.

⭐ **Der Dump-Umzug ist bezahlbar:** `sync-plan-sheet.js` und `submitWikiSyncDumpAction` verlassen
die Karte längst, drei Einzelseiten laden sie. **Nur drei Helfer hängen am Panel**, und
`showFeedbackToast` sitzt ausgerechnet in `js/map-features/map-features.js` — einem Kartenmodul mit
Leaflet-Abhängigkeiten. 💣 Wer es im geteilten Treiber stehen lässt, baut eine Datei, die
**mitten im zehnminütigen Lauf** mit `ReferenceError` abbricht, nicht beim Laden.

💣 **Die Kollisionsmatrix ist DREIECKIG.** Ein Feld sagt nur *ob* zwei Arten einander beachten, nie
*wer weicht* — das entscheidet die Rangfolge, und die ist gemessen: Wegnamen vor Ortsnamen blendet
**503 zusätzliche Ortsnamen** aus.

💣 **`.edit-shell__bar button` färbt JEDEN Knopf der Kopfzeile gefüllt-braun** (0,1,1) und schlägt
eine blanke Klassenregel (0,1,0). Der Vorgangs-Anzeiger muss `.edit-shell__bar .vorgang` heißen.
🪤 Diese Falle steht als 💣-Kommentar in `edit.css`, weil sie „Abmelden" schon einmal erwischt hat —
und sie hat beim Bau des Mockups **sofort wieder** zugeschlagen. Gefunden hat sie die Messung
(`rgb(91,85,72)`), nicht das Hinsehen: der Klotz sieht aus wie Absicht.

💣 **Eine Speicherleiste je ABLAGE, nicht je Abschnitt.** Die erste Regel lautete „je Abschnitt" und
führte direkt dazu, dass **elf Bedienelemente keinen Speichern-Knopf hatten** — der Reiter „Karte"
hat drei Abschnitte, die alle dieselbe `app_setting`-Zeile schreiben.

⚠️ **Zwei geteilte Klassen bringen die Ausrichtung ihres ERSTEN Anwendungsfalls mit.** `.es-table`
wurde für die Übersicht gebaut (linksbündig, einseitig gepolstert) und in der Matrix
zweitverwendet — die Häkchen standen 5 px neben ihrer Spalte. 🪤 In drei von vier Spalten, weil
`td:last-child` zufällig symmetrisch ist; das sah aus wie ein Zufall und war keiner.

⚠️ **`scrollbar-gutter: stable` gehört ans `html`.** Ohne es springt die Seite beim Reiterwechsel
10 px zur Seite, weil zwei Reiter kürzer als das Fenster sind.

---

## §5 Wenn es weitergeht — die Reihenfolge

**Erst Frage 1–3 beantworten lassen.** Danach, grob nach Nutzen je Zeile Arbeit:

1. **Das Fenster als leere Hülle** — Seite, Riegel, sieben Reiter, `filemtime`-Verweise
   (⚠️ eine `.php`-Seite erreicht der Deploy-Stempler nie, AGENTS.md §7). Sichtbare Änderung: der
   Menüeintrag taucht auf. Geht allein live.
2. **Die zwei Autoget-Schalter** — reine Verdrahtung, die Leser existieren.
3. **Die fünf Adresszeilen-Werte** — größter Gewinn je Zeile: die Leser existieren alle und
   wechseln nur ihre Quelle.
4. **Dump-Umzug + Vorgangsanzeige** — der große Brocken, eigenes Test-Tor. Der Wegfall des
   Panel-Knopfes ist eine sichtbare Änderung und geht nach AGENTS.md §9 **allein** live.
5. Alles Weitere: Entwurf §11.

⚠️ **Die Vorgaben müssen das heutige Bild Ziffer für Ziffer reproduzieren**, mit den alten
Konstanten als Testzeugen — dieselbe Bauform wie `zoombaender-vorgabe.test.js`.

---

## §5a Nach dem Parken dazugekommen

**25.08.2026 — Alarme und Schwellwerte (Stufe 6).** Aus einem anderen Vorhaben hierher gereicht:
der API-Nutzungstafel im Editor-Reiter *Status* (Mockup `docs/api-nutzung-mockup.html`). Sie zählt
eingehende Anfragen und ausgehende Rufe; die Frage war, ob sie auch melden soll.

🔴 **Owner: nein, nicht dort — das ist eine Einstellung.** Aufgenommen als **Stufe 6** in Entwurf
**§11.1**, Platz vermerkt in **§8** (Reiter „Betrieb"). Vier Regeln, drei Fallen — darunter zwei,
die dieses Vorhaben schon kennt:

* 💣 **Kein Läufer** (§4 dieser Übergabe). Schwellen werden beim Schreiben ausgewertet und müssen
  gedeckelt sein, sonst zahlt jede Anfrage die Rechnung.
* 💣 **Alarmsturm** bei Datenbank-Ausfall: eine Meldung je Vorfall, nicht je Endpunkt.
* 🪤 **Rekursion beim Zustellweg**: Discord ist selbst ein überwachtes Ziel — ein Alarm über
  Discord, dass Discord ausgefallen ist, kommt nie an.

⚠️ **Kein Vorziehen.** Stufe 6 setzt die Zähltafel voraus (die es noch nicht gibt) *und* einen
gemessenen Normalwert. An den drei Fragen aus §2 ändert sich dadurch nichts — der Halt bleibt.

---

## §6 Kleinkram, der sonst verlorengeht

* `.claude/launch.json` trägt einen Eintrag **`einstellungen-mockup`** (Port 8951, Wurzel `.`).
  Er ist **nicht** eingecheckt (die Datei ist untracked und wird von mehreren Sitzungen geteilt).
* 💣 **Messfalle:** ist der Browser-Bereich eingeklappt, meldet `clientWidth` **0**, und jede
  Layoutmessung ist Müll — alle Bühnen erschienen „24 px breit". Vor dem Messen `resize_window` mit
  fester Größe setzen und die Prüfung abbrechen lassen, wenn die Breite 0 ist.
* In dieser Sitzung konnte **kein Screenshot** gemacht werden (Browser-Bereich eingeklappt,
  Zeitüberschreitung). Alles ist gemessen, nicht angesehen. Die zwei Fehler, die der Owner selbst
  gemeldet hat (verrutschte Häkchen, „Speichern mitten im Text"), hätte ein Blick sofort gezeigt.
