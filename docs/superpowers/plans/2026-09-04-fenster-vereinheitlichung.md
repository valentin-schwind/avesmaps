# Fenster-Vereinheitlichung — die Liste

**Stand 05.09.2026 · ALLE Fenster umgestellt — die Wache zählt 52 Hüllen, 51 am Bauteil, 1 begründete
Ausnahme (Spotlight); D, E und T3 erledigt.**
Entwurf und Mockup: `docs/fensterformen-mockup.html`, Regelwerk: `docs/design-language.md`
§Fenster. Bauteile: `css/components/fenster.css` + `js/ui/fenster-kopf.js`.

🪤 **Hier stand bis zum 05.09.2026 „37 von 41".** Die Zahl war schon am Nachmittag des 04.09.
überholt — die Übernahme-Vorschau (Variante B, `084dfd76f`), die drei Fenster der
Reisegeschwindigkeiten und der Dump-Bericht (`24ef46658`), die drei Karten-Werkzeuge (`2dba67911`)
kamen nach dem Eintrag ans Bauteil, und die Überschrift zog nicht nach. Wer die Liste liest, sollte
die Wache fragen (`js/ui/__tests__/fenster-kopf-versorgt.test.js`, Abschnitt 3), nicht die
Überschrift: nur die zählt wirklich.

| Abschnitt | Stand |
|---|---|
| A · Werkzeugfenster (26) | **live** — dazu Funktionen, Tempowerte, Darstellung, Territoriumseditor, Dump-Bericht, die drei Karten-Werkzeuge (C, 04.09. nachträglich) |
| B · Blatt (15) | **live** — vier davon hatten einen Tag lang keine Breite und kein Polster (200px statt 420), geheilt in `870ee2cdd` |
| C · Unberührt (8) | eingehalten; drei davon am 04.09. versehentlich beschädigt und repariert (`c2eb849ff`); die drei Karten-Werkzeuge bekamen später doch die Kopfzeile — ihre Hülle bleibt durchlässig (`2dba67911`) |
| D · Hintergrundklick | **live** — 16 Fenster statt 7, alle über das eine Bauteil; seit 05.09. dazu die sechs Sync-Fenster (22) |
| E · Listenkopf | **live** — „Meldungen" angeglichen, zwei Filter-Kopien zeichengleich; seit 05.09. auch der ⟳ des Postfachs auf derselben Form |
| Reiter (T3) | **live** — tote Pillen-Rezeptur gefallen, `.dg-tab` auf Unterstrich; der Rest (~50 Regeln, u.a. die Dokument-Reiter der Territorien) ist ein eigener Durchgang |
| Listenzeile `.avm-row` + Bildplatz | 🔧 offen |
| Rahmenkasten (4 Rezepturen) | **live 04.09.2026** in drei Schritten (`97dd3ccb0` Quellen · `266cde7ae` Meldeformular · `12fd8b2a9` Routenplaner) — `css/components/rahmenkasten.css`, Form von `.fs-scope`, Werte von `.report-section`, klappbar = K2 |
| 6 × `modal-box` (Sync-Seiten, A21–A26) | **live 05.09.2026** — als Werkzeugfenster; `.modal-title`/`.modal-actions` gefallen, `.modal-box` trägt nur das Maß, der Rumpf scrollt statt der inneren Kästen (`.zb`, `.ident-table`, zwei Inline-Styles) |
| Übernahme-Vorschau (A12) · Reisegeschwindigkeiten (A15) | **live 04.09.2026** — die Begründung „anders gebaut" hielt nicht, siehe unten |
| Postfach (A16) | **kein Fenster** — ein Listenkopf (E); der ⟳ seit 05.09. auf der Hausform, die Reiter waren schon `.status-subtab` |
| A13 Kartensammlung · A14 Literatur · Besondere Stätten | **live als WERKZEUGfenster** — zuerst als Blatt gebaut, gegen die eigene Regel; korrigiert |

### Was der zweite Prüfagent gefunden hat — vier echte Fehler in meiner Arbeit

💣 **Eine Hülle ist mehr als eine Kopfzeile.** Beim Herauslösen der vier Blätter aus der
geteilten Liste gingen `width`, `max-height`, `overflow` und `padding` mit — und das Bauteil
liefert davon **nichts**, weil Polster Sache der ZONE ist. Gemessen: 758/200/204/196px statt 420,
Inhalt an der Kante. Kein Test kennt die Breite eines Fensters; gefunden hat es der Agent beim
Lesen.

💣 **Dieselbe Falle, vier Fenster weiter.** `.avm-editor-dialog` trug `display: grid` neben dem
`display: flex` des Bauteils — ich hatte den EINEN Fall behoben, den der erste Agent nannte, und
nicht nach dem Muster gesucht.

💣 **Drei Fenster mit der falschen Bauart** — gegen das eigene Regelwerk, das „Kartensammlung"
wörtlich als Werkzeugfenster nennt. Ein Blatt sagt „kurzes Formular, gleich weg"; diese drei
bleiben offen, während man daneben recherchiert.

💣 **Und ein Kommentar, der gelogen hat:** `.dg-tab.is-active` bekam `--color-accent` als
Unterstrich, während darüber „zeichengleich zu `.avm-tab`" stand. Im Hellen fällt das nicht auf
(102,8 gegen 86,6), im Dunkeln bricht es ein (55,4 gegen 125,1).

### Die „begründeten Ausnahmen" — und was aus jeder geworden ist

🪤 Am 04.09. früh standen hier vier Fenster als „bleiben, weil anders gebaut". **Drei der vier
Begründungen hielten nicht**, und das ist die Lehre dieses Abschnitts: eine Ausnahme, die man aus
dem Gedächtnis begründet, ist eine ungeprüfte Annahme mit Fußnote.

- **Übernahme-Vorschau** (`sheet__head`, „DREIZEILIGER Kopf, gehört dem Owner"): Mockup mit drei
  Kopfformen (`docs/uebernahme-vorschau-kopf-mockup.html`), Owner: „B" — Griff und ✕ außen, Titel
  und Befund gestapelt, Meta im Rumpf. **Live 04.09.2026** (`084dfd76f`). Nebenbei: sie trug kein
  `role="dialog"` und war damit für Screenreader kein Fenster und für die Wache unsichtbar
  (`352859b9c`).
- **Reisegeschwindigkeiten** (`tsi-head`, „Hinweisbanner mit ⓘ, kein Fensterkopf"): das ⓘ ist
  Zierat DAVOR; `.tsi-head` ist ein vollwertiger Kopf und `.tsi-dialog` die Hülle von DREI Fenstern
  (Reiseoptionen, Reisegeschwindigkeiten, Kurven). Ein Detail angesehen, aufs Ganze geschlossen.
  **Live 04.09.2026** (`24ef46658`).
- **Die sechs `modal-box`-Fenster** („Bauform bleibt, eigener Durchgang"): **live 05.09.2026** —
  Werkzeugfenster mit Kopfzeile, gefasstem ✕, scrollendem Rumpf und Fußleiste (Massenhandlung
  links, Hauptgruppe rechts). Beide Seiten in EINEM Commit, weil die Wache die zwei CSS-Kopien
  zeichengleich verlangt. 💣 Zwei fremde Tests führen den Inline-Block der Siedlungsseite in einem
  Sandkasten AUS und fielen mit `ReferenceError` auf das neu geladene Schleier-Bauteil um — die
  changelog-dialog-Falle, diesmal vom Testfeld gefangen. Wache:
  `js/pages/__tests__/sync-modale-am-bauteil.test.js`.
- **Postfach** („hat gar keinen `__head`"): die einzige Begründung, die stimmt — es ist **kein
  Fenster**, sondern ein Reiter-Panel im Editor. Seine Reiter sind seit jeher `.status-subtab`
  (Unterstrich, T3), nur der ⟳ war die zweite Form des Neu-laden-Knopfs (nackt, 16px, ohne
  Trefferfeld). Seit 05.09. trägt er `.review-panel__refresh-btn`; die eigene Klasse hält nur die
  Lage. Das ist Abschnitt E, nicht A16.

### Was die Prüfagenten gefunden haben, das ich nicht gesehen habe

💣 **Ein Entferner, der seine eigene Regelgrenze nicht kennt, verschmilzt zwei Regeln.** Beim
Herauslösen von Listengliedern wandert die öffnende Klammer auf die vorige Komma-Zeile — die
Rückwärtssuche läuft aber über das `}` hinweg in die VORIGE Regel. Zweimal passiert, und beide
Male traf es Fenster aus Abschnitt C, die gar nicht angefasst werden sollten. **Wache:**
`js/ui/__tests__/fenster-kopf-versorgt.test.js` — ein Fenster trägt entweder das Bauteil ODER
eine eigene Kopfregel; „weder noch" ist genau der kaputte Zustand.

💣 **Der Griff war ein Versprechen ohne Mechanik.** Fünf der sieben Editorfenster zeigten Griff
und Greif-Zeiger und ließen sich nicht bewegen — `dialog-drag.js` erkennt ein Fenster an
`[role="dialog"]`, und das Attribut fehlte. Beide Hälften waren für sich richtig, die NAHT nicht.

🪤 **Und eine Regression, die kein Test sah:** `changelog-dialog.js` lädt vor dem
Hintergrundklick-Bauteil. Die neue Zeile warf dort einen ReferenceError, das Modul brach mitten
drin ab, und sein Escape-Zuhörer — die nächste Zeile — war tot. Gefunden von
`read_console_messages` auf der laufenden Seite.

Owner-Entscheide: **A3 · B3 · C2 · D1 · T3**, dazu die Nachträge vom 04.09. (durchgehender
Trenner, Editor-Kacheln, alle Fenster verschiebbar, Scrollen nur im Rumpf, Listen bündig bei
Wappen/Thumbs, Bildlaufleiste im Hausstil, Titelleisten 8px schlanker, Hintergrundklick).

> Diese Datei ist die **Abhakliste**. Jede Zeile geht einzeln live, mit eigenem Commit — sichtbare
> Änderungen gehen bei diesem Projekt nie im Bündel (AGENTS.md §9).

---

## Was sich je Fenster ändert

| # | Änderung | Betrifft |
|---|---|---|
| 1 | Kopfleiste: `--avm-kopf-pad` (6/14), Titel `--font-size-subhead`, Griff `⁝⁝`, Linie `--color-divider` durchgehend | alle |
| 2 | Schließknopf: 32×32 — im Fenster gefasst, im Blatt nackt | alle |
| 3 | Hülle: `padding: 0`, `overflow: hidden`; Radius `--radius-sm` (Fenster) / `--radius-lg` (Blatt) | alle |
| 4 | Rumpf scrollt, nicht die Hülle (`flex: 1 1 auto; min-height: 0; overflow: auto`) | alle |
| 5 | Bildlaufleiste am Fenster statt am Dokument (10px, Pille, 2px Rand) | alle |
| 6 | Fußleiste: eine Rezeptur, Hauptgruppe `margin-left: auto` | alle mit Fuß |
| 7 | Reiter → `.avm-tab` (Unterstrich) | die mit Reitern |
| 8 | Listenzeile → `.avm-row`, Bildplatz reserviert | die mit Listen |
| 9 | Einklappen (`−` / `□`, bleibt stehen) | nur Werkzeugfenster |
| 10 | Hintergrundklick schließt (`avesmapsDialogHintergrundSchliessenById`) | alle mit vollem Schleier |

---

## A · Werkzeugfenster — 26

*Bleibt offen, während man daneben arbeitet; trägt Menüband oder Fußleiste; ist einklappbar.*

| # | Fenster | heutige Hülle | was zusätzlich zu 1–6 |
|---|---|---|---|
| A1 | **Garetien Importer** | `.gi-win` | nur Feinschliff — am nächsten dran, deshalb zuerst |
| A2 | **Orte bearbeiten** | `.avm-editor-dialog` | Reiter · Liste · doppelte Kopflinie |
| A3 | **Landschaften bearbeiten** | `.avm-editor-dialog` | Reiter · Liste · doppelte Kopflinie |
| A4 | **Wege bearbeiten** | `.avm-editor-dialog` | Reiter · Liste · doppelte Kopflinie |
| A5 | **Kraftlinien bearbeiten** | `.avm-editor-dialog` | Liste · doppelte Kopflinie |
| A6 | **Territorien bearbeiten** | `.political-territory-editor-dialog` | Radius `lg`→`sm` · Titel 16 · `.tree-item`→`.avm-row` · Wappen-Bündigkeit · ID-Scrollbar-Abschrift fällt |
| A7 | **Literatur bearbeiten** | dieselbe Hülle + **Inline-`style.width/height`** | dito · Cover-Bündigkeit · Inline-Maße raus |
| A8 | **Karten bearbeiten** | dieselbe Hülle + Inline-Maße | dito · Vorschau-Bündigkeit |
| A9 | **Vorkommen bearbeiten** (Natur & Waren) | `.location-report-dialog` + ID-Overrides | die angeschraubte Titelleiste fällt weg · ID-Scrollbar-Abschrift fällt |
| A10 | **Konflikte** | `.location-report-dialog` | 🔴 **Bauart-Wechsel Blatt → Fenster** · Einklappen springt heute weg, bleibt künftig stehen |
| A11 | **Social Media Hub** | `.social-hub` | Titel 17→16 · Polster 16/24→6/14 · ✕ bekommt Trefferfeld · Radius `lg`→`sm` |
| A12 | **Übernahme-Vorschau** | `.sync-plan-host .sheet` | Kopfpolster `14/18/12`→`6/14` · Zeile `9px 0`→`.avm-row` · ✅ Variante B (Owner), `084dfd76f` |
| A13 | **Kartensammlung** | `.avesmaps-citymaps-dialog` | Kopf `13/16`→`6/14` · ✕ (`5px`-Radius, `3px 7px`) → 32×32 · Zeile → `.avm-row` |
| A14 | **Literatur „Alle anzeigen"** | `.avesmaps-adv-dialog` | Titel 15→16 · ✕ 18px→32×32 · Zeile `12px 0`→`.avm-row` · Cover-Bündigkeit |
| A15 | **Reisegeschwindigkeiten** | `.tsi-*` | Kopf `--space-16/20`→`6/14` · ✕ (Titelgröße) → 32×32 · ✅ drei Fenster, `24ef46658` |
| A16 | **Postfach** | `.mail-inbox` | ⚠️ kein Fenster — Reiter-Panel; die Reiter sind `.status-subtab`, der ⟳ seit 05.09. auf `.review-panel__refresh-btn` (Abschnitt E) |
| A17 | **Regel bearbeiten** (Vorkommen) | `.lore-rule-dialog` | Kopf `--space-8/12`→`6/14` |
| A18 | **Darstellung** (Landschaften-Editor) | `.avm-modal__box` | Titel `20px`→16 · Hülle scrollt → Rumpf · Radius `lg`→`sm` |
| A19 | **Funktionen** (Wege-Editor) | `.wp-modal__box` | Kopf `--space-8/12`→`6/14` · ✕ Textknopf → 32×32 |
| A20 | **Tempowerte** (Wege-Editor) | `.wp-modal__box` | dito |
| A21–23 | **Sync-Monitor: 3 Modale** | `.modal-box` | Kopf · ✕ · Rumpf-Scroll · ✅ 05.09.2026, `.modal-box--geom` statt Inline-style |
| A24–26 | **Siedlungseditor: 3 Modale** (u. a. Zoombänder, Eigenes Wappen) | `.modal-box` | dito · ✅ 05.09.2026, `renderZoomBandsActions` baut die Fußleiste mit Massenhandlung links |

---

## B · Blatt — 15

*Kurzes Formular: ausfüllen, speichern, weg.*

| # | Fenster | was zusätzlich zu 1–6 |
|---|---|---|
| B1 | **Ort bearbeiten** | 🔴 **dein schlimmstes Beispiel** — Hülle scrollt heute komplett, Titel und „Speichern" wandern aus dem Bild |
| B2 | **Karteneintrag melden** | Titel steht auf `--font-size-subhead` statt `title` (Sonderregel fällt) |
| B3 | **Weg bearbeiten** | Rumpf-Scroll |
| B4 | **Kraftlinie bearbeiten** | Rumpf-Scroll |
| B5 | **Region bearbeiten** (Beschriftung) | Rumpf-Scroll |
| B6 | **Herrschaftsgebiet bearbeiten** | Rumpf-Scroll |
| B7 | **Neue Bewertung** | Rumpf-Scroll |
| B8 | **Hinweise** | Titel `20px`→16 · ✕ (28px, ohne Trefferfeld) → 32×32 |
| B9 | **Neuigkeiten** | dito |
| B10 | **WikiSync-Fall lösen** | Rumpf-Scroll |
| B11 | **Dump-Zugangsdaten** | Rumpf-Scroll |
| B12 | **Landschaften** (Intro) | Kopfleiste |
| B13 | **Fläche kopieren** | Hülle scrollt → Rumpf · ✕ (subhead, ohne Feld) → 32×32 |
| B14 | **Fläche zuweisen** | Kopfleiste |
| B15 | **Label zuweisen** | Kopfleiste |

---

## C · Unberührt — 8, jedes mit Grund

| Fenster / Fläche | Warum |
|---|---|
| **Fläche vereinfachen** · **Grenze aus Territorien** · **Reihenfolge und Sperren** · **Eigenschaften** | Ihre Hülle reicht Zeiger durch (`pointer-events: none`, `background: transparent`) — der Hintergrund ist die **Arbeitsfläche**, nicht der Ausgang. Owner 28.07.2026: der Schleier würde unkenntlich machen, was der Regler gerade tut. Kein Hintergrundklick, keine Titelleiste. |
| **Suchen** (Spotlight) | Eigene Form (dunkle Palette, kein Titel, kein Fuß) — kein Fenster im Sinn der Regel. |
| **Karte · Infopanel · Routenplaner** | Owner 04.09.2026: „bleiben erstmal". Behalten die 7px-Bildlaufleiste aus `base.css`. |
| **Das Editor-Menü** (2×4-Gitter) | Owner 04.09.2026: „will ich, dass dieses menü erstmal so bleibt". |
| Kontextmenü · Anzeige-Menü · Kartenfächer | Keine Fenster — Menüs mit eigener, entschiedener Formensprache. |

---

## D · Der Hintergrundklick — 💣 die Falle, die der Owner selbst genannt hat

> „pass aber auf die fenster auf, die etwas aus dem hintergrund aufpicken und wiederkommen, wie
> z.B. ‚Neue Position vorschlagen' bei Änderungen vorschlagen."

🔴 **Das Bauteil gibt es seit dem 02.09.2026** (`js/ui/dialog-hintergrund-schliessen.js`), und
**genau diese Falle ist seine tragende Zeile**: der Zuhörer hängt **je Fenster an dessen Overlay,
nie am `document`**. Am Dokument delegiert bräche `startChangePositionPick` (`review-locations.js`)
— der blendet sein Overlay auf `hidden` und lässt den Melder **einen Punkt auf der Karte** wählen;
dieser Kartenklick wäre dort ein Hintergrundklick, und Schließen heißt hier `resetForm: true`. Der
halb geschriebene Vorschlag wäre weg, im Moment der Positionswahl, und es sähe aus wie ein
verschluckter Klick.

**Stand heute:** von 26 Overlays sind **7** über die Tabelle in `bootstrap.js` verdrahtet
(Ort · Weg · Kraftlinie · Herrschaftsgebiet · Karteneintrag melden · WikiSync-Fall ·
Dump-Zugangsdaten), **1** von Hand (`#legal-overlay`), **4** sind absichtlich ausgenommen
(Abschnitt C) — **14 fehlen**.

**Zu tun:** die 14 in dieselbe Tabelle, plus `#legal-overlay` von seiner Handfassung darauf.

⚠️ Und die rund **25 älteren Abschriften** im Haus (u. a. die drei Editor-Overlays A6–A8) prüfen
nur `event.target === overlay`. Das schließt beim **Ziehen einer Textmarkierung** über den
Fensterrand hinaus: gedrückt im Fenster, losgelassen auf dem Hintergrund → `click` feuert am
gemeinsamen Vorfahren, und der **ist** das Overlay. Bei einem ausgefüllten Formular ist es weg.
Das Bauteil prüft deshalb **Druck UND Loslassen**. Wer eine dieser Zeilen anfasst, holt sie hierher.

---

## E · Der Listenkopf — die Zeile über der Liste

> „über listen seh ich auch immer wieder so fehlerchen und inkonsistente header
> (falsch hier: Meldungen)"

Gemessen: **40** Rezepturen für die Zeile über einer Liste (Zähler · Filter · Suche · Aktionen),
und der **Neu-laden-Knopf** gibt es zweimal in zwei Formen:

| | Mails (`.mail-inbox__refresh`) | Meldungen (`.review-panel__refresh-btn`) |
|---|---|---|
| Form | **nackt**, `border: 0`, `background: none` | **gefasst**, `1px solid --color-divider` |
| Größe | `font-size: 16px`, `padding: 4px` | `font-size: 15px`, `padding: 1px 9px` |
| Farbe | `--color-text-muted` | `--color-link` |
| Radius | — | `--radius-sm` |

🔴 **Meldungen ist die falsche**, und zwar messbar — sie verstößt gegen **vier** Regeln des
Guides: `15px` steht auf keiner Skalenstufe · `--radius-sm` ist die Hülle, **alle Bedienelemente**
sind `--radius-md` · `--color-link` gehört Links, nicht Knopfglyphen · `padding: 1px 9px` erreicht
die Bedienhöhe nicht (gemessen ~19px statt 32).

**Ziel — eine Rezeptur:** der Listenkopf trägt `--avm-status-pad` (6/14); links der Zähler in
`--font-size-caption` / `--color-text-muted`, rechts die Aktionen, **jede als Symbolknopf
`--avm-control-h` × `--avm-control-h` mit `--radius-md` und weichem Umriss** — dieselbe Form wie
das ✕ im Fenster und der Filter-Knopf daneben. Damit stehen Filter und Neu-laden endlich
nebeneinander gleich hoch.

✅ **Beide ⟳ tragen seit 05.09.2026 EINE Klasse** (`.review-panel__refresh-btn`); `.mail-inbox__refresh`
hält nur noch `margin-left: auto`. Im Browser gemessen: Knopf 32×32, Reiter 31,4 hoch, beide
Unterkanten auf einen halben Pixel gleich. Wache: `listenkopf.test.js`, letzter Abschnitt.

⚠️ **Und die Zähler selbst:** allein für „n Einträge neben einer Liste" stehen **sechs** Größen im
Bestand — `--font-size-caption` (11) · `--font-size-small` (12) · `12px` · `13px` · `11,5px` ·
`11px`. Die drei nackten Zahlen und die 11,5 fallen; es bleibt `--font-size-caption`.

⭐ Das ist derselbe Umbau wie die Listenzeile, eine Etage höher — und er geht mit den Fenstern
mit, statt danach: wer den Kopf einer Liste anfasst, fasst ihre Zeile ohnehin an.

---

## Reihenfolge

1. **Das geteilte Bauteil** — Kopfleiste, Schließknopf, Rumpf-Scroll, Bildlaufleiste, Fußleiste
   als *eine* Rezeptur (kein Fenster ändert sich dabei sichtbar).
2. **A1 Garetien Importer** — kleinster Diff, größter Beleg.
3. **A11 Social Media Hub** — fünf Abweichungen in einem Fenster.
4. **A10 Konflikte** — der Bauart-Wechsel.
5. **B1 Ort bearbeiten** — der gemeldete Scroll-Fall.
6. Der Rest, gruppenweise nach Hülle (`.location-report-dialog` deckt 11 Blätter auf einmal).
7. **Hintergrundklick**: die 14 fehlenden Paare, in einem Zug (unsichtbar, kein Einzeln-live nötig).
8. **Listenkopf** (E): geht je Fenster **mit** — wer die Liste anfasst, fasst ihren Kopf ohnehin an.
   Nur der Neu-laden-Knopf wird einmal zentral gerade gezogen, weil er nur zweimal vorkommt.

---

## Offene Punkte

- 🔧 **Der Rahmenkasten ist entschieden, aber nicht gebaut.** Vier Rezepturen ziehen auf eine:
  `.fs-scope` (Quellen) · `.label-wiki-reference` (Landschaften) · `.planner-group`
  (Routenplaner, der einzige klappbare) · `.report-section` (Meldung). Regelwerk in
  `docs/design-language.md` §Rahmenkasten, Mockup `docs/rahmenkasten-mockup.html`.
  🚩 **Ein Live-Fehler hängt mit dran:** `.fs-scope__head` löscht bei einem zweizeiligen Titel
  die Oberkante bis zur rechten Ecke (gemessen 9 von 244px übrig), und die Zweizeiligkeit ist
  dort kein Sonderfall — der Kommentar über der Regel dokumentiert sie ausdrücklich.
  ⚠️ Der Routenplaner ist für **Besucher** sichtbar; er geht als eigener Schritt live.
- 🔧 `--avm-col-pad` horizontal **12 → 14**: betrifft die vier Editor-iframes sichtbar.
- 🔧 `.avm-row` hat **keinen Bildplatz** — er kommt neu dazu (A7 Cover, A8 Vorschau, A6 Wappen).
- 🔧 Die drei ID-gescopten Scrollbar-Abschriften (`lore.css`,
  `political-territory-editor{,-inline}.css`) fallen mit Schritt 1 weg — gegenprüfen, dass danach
  keine Editor-Bildlaufleiste auf 7px zurückfällt.
- 🔧 `.political-territory-editor-dialog` trägt bei A7/A8 **Inline-`style.width/height`** aus dem
  JS. Die gehören in die Hülle, sonst schlagen sie jede Klassenregel.
