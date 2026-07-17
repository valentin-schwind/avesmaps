# Design: Kartensammlung — Arrangement und Dialog neu gedacht

**Datum:** 2026-07-17 · **Status:** freigegeben, NICHT gebaut
**Auftraggeber-Zitate:** *„kannst du das design der kartensammlung nochmal komplett überdenken"* ·
*„das problem sind nicht die leeren bilder sondern das arrangement in den items und der dialog"* ·
*„B ohne die spalte »Ausführung« oder die Trennung »umgebungskarten«. beim klicken auf ein item werden
mehr details sichtbar (so dargestellt wie in A)"* · *„der übergang soll animiert sein"* ·
*„die aktuellen filter sind übertrieben"*

Vorgänger: `2026-07-17-kartensammlung-zeile-aufklappen-design.md` (das Aufklappen, LIVE `49311e72`) und
`2026-07-17-karten-mehrfachlinks-design.md` (die Fundstellen). Diese Spec ersetzt deren **Optik**, nicht
deren Verhalten — das Aufklappen bleibt, es sieht nur anders aus.

## 1. Warum — die Datenlage, nicht der Geschmack

Der Dialog ist für eine Datenlage gebaut, die es nicht gibt. Gemessen am 2026-07-17 an der Live-Antwort
von `GET /api/app/citymaps.php` (419 Karten, ein einzelner Request):

| Worauf das Design setzt | Was wirklich drinsteht |
|---|---|
| Vorschaubild je Karte (96×68, aufklappbar auf 280×196) | **1 von 419** Karten hat eins — und das ist ein eigener Upload |
| 13 Filter über der Liste | 6 greifen auf ≤2 Karten; `is_multilevel` (0 von 419 erfasst) und „Spoiler zeigen" (0 Spoilerkarten) können **nie** etwas treffen |
| Eine Sammlung zum Durchblättern | **168 von 245 Orten (69 %) haben genau eine Karte**; 202 von 245 haben ≤2. Havena (10) und Gareth (9) sind die Spitze |
| Reiche Merkmale je Karte | `art` 10/419 · `author` 6/419 · `width_px` 1/419 · `is_official` 1/419 · `is_labeled` 2/419 |
| Unterscheidbare Einträge | **86 % der Titel sind die Formel „{Typ} von {Ort} ({Quelle})"** — und Typ und Quelle stehen darunter nochmal, in einem Dialog, der schon „Kartensammlung von Gareth" heißt |

Die einzige Eigenschaft mit echter Abdeckung ist **`is_color`** (331 von 419 bekannt, davon **238 auf
„nein"**) — und die Zeile druckt sie nur bei „ja". Folge: **21 Titelpaare in der Datenbank unterscheiden
sich ausschließlich in farbig/schwarzweiß** (Farbtafel + S/W-Fassung im selben Band) und sehen für den
Leser aus wie eine Dublette. Genau das steht im Screenshot des Owners.

**Owner-Korrektur, die die Richtung bestimmt** (2026-07-17): *„das problem sind nicht die leeren bilder
sondern das arrangement"*. Die Bildspalte bleibt also. Die Zeile muss **mit und ohne Bild** funktionieren
— nicht ohne Bild gebaut werden.

**Zweck der Fläche** (Owner-Entscheidung 2026-07-17): **Nachschlagewerk**, nicht Bildergalerie. „Welche
Karten von Gareth wurden veröffentlicht, in welchem Band, farbig oder s/w, wo bekomme ich sie?" Das deckt
sich mit der Datenlage: 87 % verweisen auf Wiki oder Shop, Vorschaubilder sind lizenzgesperrt und werden
es bleiben (`unknown_other` ist bei fremder Kartografie der Default und **nicht** frei — siehe
`citymaps-feature-task-c`).

## 2. Was am Arrangement kaputt ist

Die heutige Zeile (`buildCityMapRowMarkup`, `map-features-place-extras.js:381`) ist ein Grid aus
`96px | minmax(0,1fr) | 196px`. Konkret:

1. **Fünf gleich aussehende Meta-Zeilen.** `meta`, `facts`, `traits`, `source`, `note` sind fünf `<div>`,
   alle 11.5px, alle muted (nur `traits` gold). Der Leser kann nicht erkennen, dass Zeile 2 Herkunft und
   Zeile 3 Eigenschaft ist — und die Gruppierung ist willkürlich: „bis 1038 BF" steht neben
   „4635 × 3278 px" und „Hannah Möllmann", „farbig" steht allein.
2. **Eine Abschnittsüberschrift im Listeneintrag.** „Zu finden bei" hat eine eigene Unterlinie und
   wiederholt sich pro Zeile — bei Gareth neunmal. Überschriften gruppieren Einträge, sie wohnen nicht in
   einem.
3. **Die Zeilenhöhe kommt vom 68px-Thumb, nicht vom Inhalt.** Zeilen mit zwei Fakten haben darum ~40px
   Loch, und zwischen Mitte und rechter Spalte steht ein Whitespace-Canyon.
4. **`(online)` in Grün an jedem Link** — Linkchecker-Status, also Redakteursinfo auf einer Leserfläche.
5. **Vier Klick-Semantiken in einer Zeile** (Thumb, Titel, Zeile, Links), und die Semantik der Zeile
   wechselt beim Aufklappen.

## 3. Die neue Zeile

### 3.1 Zugeklappt — einzeilig

Drei Spalten, feste Breiten: `56px | minmax(0,1fr) | 148px`.

```
[48×34]  Herz des Reiches · Stadtplan · farbig                    Karte ↗
```

- **Bild** 48×34, immer da (auch leer — Owner: die leeren Rahmen sind nicht das Problem).
- **Titelzeile**: der **Band** in `--color-link`, danach `· Typ · Ausführung` in `--color-text-muted`,
  Schriftgröße `--font-size-caption`.
- **Fundstelle** rechtsbündig; ohne Link steht „keine Fundstelle" in muted.

**Woher der Band kommt** (in dieser Reihenfolge): `sources[0].label` (87 % Abdeckung, echtes Datenfeld) →
sonst die Klammer aus dem Titel (die Formel trägt 86 %) → sonst der volle Titel. Kein Titel-Parsing als
erste Wahl: `sources` ist strukturiert, die Klammer ist geraten.

**Warum Typ und Ausführung in der Titelzeile stehen und nicht als Spalte oder Gruppe:** der Owner hat
beides gestrichen (*„B ohne die spalte Ausführung oder die Trennung umgebungskarten"*). Ohne beides hießen
vier der neun Gareth-Zeilen wortgleich „Herz des Reiches", und die Phantom-Dubletten aus §1 wären zurück —
diesmal schlimmer, weil auch Stadtplan und Umgebungskarte kollidierten. Als **Spalte** weg, als
**Information** da. Owner-bestätigt 2026-07-17.

**`is_color === false` wird als „schwarzweiß" gedruckt.** Das ist kein Bruch von §3.1 („Unbekanntes wird
weggelassen"), sondern dessen Anwendung: `false` ist **bekannt**, nicht unbekannt. Dieselbe Begründung,
mit der „kostenlos" sichtbar wurde (`citymaps-feature-task-c`). `null` bleibt weg.

### 3.2 Aufgeklappt — animiert

Klick auf die Zeile klappt sie auf; **Akkordeon** (nur eine offen), wie heute.

| | zu | offen |
|---|---|---|
| Grid | `56px \| 1fr \| 148px` | `256px \| 1fr \| 148px` |
| Bild | 48×34 | 248×174 |
| Band | `--font-size-small`, regular | `--font-size-reading`, bold |
| Details | verborgen | entfaltet |
| „+ Neuer Fundort" | verborgen | sichtbar |

Details sind **die Fakten, die es gibt** — Art, `offiziell`, Gültigkeit, Urheber, Pixelmaße, Format und
Maßstab (die stecken heute als Freitext in `note`: *„Format: A4 · Maßstab: 1:12.750.000"*). Kein Feld
kommt neu dazu. Trägt eine Karte gar nichts, steht „Keine weiteren Angaben erfasst."

### 3.3 Wie animiert wird — drei Festlegungen

1. **Kein `<table>`.** Die Spalten sind ein CSS-Grid mit festen Breiten: gleiche Ausrichtung wie eine
   Tabelle, aber `<tr>`-Höhen lassen sich nicht verlässlich animieren, `grid-template-columns` mit
   Längenwerten schon.
2. **Entfalten über `grid-template-rows: 0fr → 1fr`** (Wrapper `display:grid`, Inhalt `overflow:hidden`).
   Damit endet die Animation exakt an der echten Inhaltshöhe — kein geratenes `max-height`, das bei einer
   Karte mit drei Faktenzeilen zu früh und bei einer mit sieben zu spät aufhört.
3. **Dasselbe `<img>` wächst per CSS.** Ein zweites, verstecktes Bild für den großen Zustand lädt jede
   Karte doppelt — die Falle steht bereits so im Code (`2026-07-17-kartensammlung-zeile-aufklappen-design.md`).

Dauer **0,32 s**, `cubic-bezier(.4, 0, .2, 1)`, auf `grid-template-columns`, `padding`, Bildbreite/-höhe,
Bandgröße und `grid-template-rows`. Der Detailtext blendet mit 0,25 s und 0,12 s Verzögerung ein, damit er
nicht vor seinem Platz da ist.

Die Handler bleiben **auf `document` delegiert** — die Zeilen entstehen bei jedem Dialog-Bau neu, und der
Spoiler-Deckel muss seinen `stopPropagation`-Vorrang behalten (sonst deckt derselbe Klick, der aufklappt,
ein Spoilerbild auf).

### 3.4 Sortierung

Nach Typ, dann nach Band. Ohne Gruppenüberschriften (Owner), aber die Reihenfolge hält die
Farbe/Schwarzweiß-Paare nebeneinander — so lesen sie sich als Paar statt als Dublette.

## 4. Der Dialog

### 4.1 Filterleiste — von 13 auf 4

**Vokabular** (Owner 2026-07-17, *„Wir brauchen: Zeitraum, farbig, offiziell, kostenlos"*):
`Zeitraum (BF)`, `farbig`, `offiziell`, `kostenlos`.

**Regel: ein Filter erscheint nur, wenn er diese Liste wirklich teilt** — mindestens eine Karte passt
**und** mindestens eine nicht. `Zeitraum` erscheint nur, wenn mindestens zwei Karten ein Jahr tragen und
die Jahre sich unterscheiden. Bei den 168 Orten mit einer Karte bleibt die Leiste damit **ganz weg**.

Gerechnet an Gareth (9 Karten): `farbig` trifft 4/9 → **zeigen** · `offiziell` 1/9 → **zeigen** ·
`kostenlos` 1/9 → **zeigen** · `Zeitraum`: nur eine Karte trägt überhaupt ein Jahr → **ausblenden**.
Ergebnis: drei Chips statt dreizehn Steuerelementen.

**Ersatzlos gestrichen** (Owner: *„der rest könnte unter »weitere Filter« oder ganz weg erstmal"* → ganz
weg): Typ-Chips, `Art`-Select, `Quelle`-Select, `mehrstöckig`, `beschriftet`, `nur kostenpflichtige`,
`Spoiler zeigen`. Kein „weitere Filter"-Aufklapper: er wäre ein Behälter für tote Schalter
(`mehrstöckig` = 0 von 419 erfasst), und mit der Regel oben erschiene darin ohnehin nie etwas. Kommt die
Datenlage, kommen sie über dieselbe Regel zurück.

> **⚠️ Zwei Umkehrungen, die niemand „reparieren" darf.**
> 1. **`nur kostenpflichtige` fliegt raus.** Am **2026-07-17** hat der Owner bei den Mehrfach-Links
>    ausdrücklich **beide** Richtungen verlangt (`citymaps-multilinks`), weil sie nicht komplementär sind.
>    Am **selben Tag**, in dieser Spec, hat er den Filtersatz auf vier reduziert und „kostenpflichtig"
>    nicht genannt. Der spätere Wunsch gewinnt.
> 2. **`Spoiler zeigen` fliegt raus, der Deckel BLEIBT.** Der Chip regelte nur die *Listung* und startete
>    ohnehin aktiv; der Schutz ist und bleibt das Overlay über Bild und Titel
>    (`citymaps-feature-task-c`). Ohne Chip ist das Verhalten identisch zum heutigen Startzustand.

### 4.2 Fußzeile

**Hinweistext** (Owner-Diktat, wörtlich):

> Karten sind externe Inhalte. Vorschau nur mit freier Lizenz/Genehmigung.

Das ersetzt „Karten sind externe Verweise. Vorschau nur bei freier Lizenz." — Default in
`tr("cityMaps.footHint", …)`. **Das englische Overlay muss nachziehen**
(`js/app/i18n-en.js:483`, heute *„Maps are external references. Preview only where the licence permits."*)
→ *„Maps are external content. Preview only with a free licence or permission."* Deutsch bleibt Default,
Englisch ist nur das Overlay (AGENTS.md §8).

**Knöpfe:** `Sammlung bearbeiten` (soft/outline) links neben `Karte vorschlagen` (gefüllt). Eine gefüllte
Hauptaktion je Fläche (AGENTS.md §12) — das Melden ist die Aktion für alle, das Bearbeiten die für
Redakteure.

### 4.3 „Sammlung bearbeiten" (neu)

**Sichtbar nur bei `IS_EDIT_MODE`** — das ist `INITIAL_SEARCH_PARAMS.get("edit") === "1"`
(`js/config.js:197`), **kein** Capability-Check. Die Durchsetzung sitzt serverseitig
(`avesmapsRequireUserWithCapability`); der Client zeigt Redakteursflächen bei `?edit=1`. Der Knopf folgt
damit derselben Konvention wie jede andere Editor-Fläche und schafft keine neue Auth-Oberfläche.

**Verhalten:** schließt den Kartensammlungs-Dialog und ruft `window.openAvesmapsCitymapEditorOverlay()`
(`js/review/review-settlement-list.js:587`).

> **⚠️ Ohne das Schließen täte der Knopf sichtbar nichts.** Die Dialog-Hülle liegt auf `z-index: 3000`
> (`css/features/place-extras.css:372`, hartkodiert an den `--z-dialog`-Tokens vorbei), das
> Editor-Overlay öffnet auf `1500` (`review-settlement-list.js:605`). Der Editor ginge **hinter** dem
> Dialog auf. Schließen ist die richtige Lösung und nicht nur die billige: das Overlay ist 1400×880 und
> verdeckt den Dialog ohnehin komplett, und beim Schließen lädt es den Katalog bereits neu
> (`avesmapsReloadCitymapCatalog`) — der Dialog wäre also sowieso veraltet.

Der `Escape`-Riegel des Dialogs braucht **keinen** neuen Fall (anders als beim Vorschlags-Dialog): der
Dialog ist beim Öffnen des Editors bereits zu.

**Kein Vorauswählen der offenen Zeile.** `openAvesmapsCitymapEditorOverlay(selectPublicId)` könnte es, aber
der Knopf sitzt in der Fußzeile und meint die **Sammlung**; „bearbeite die Karte, die ich zufällig
aufgeklappt hatte" wäre eine andere Aktion an der falschen Stelle. Der Editor hat seine eigene Liste.

## 5. Der Editor (`html/citymap-editor.html`)

### 5.1 „Linktext" (neu)

Heute steht das Label des Karten-Links als **Konstante** im Server:
`'label' => 'Karte'` (`api/_internal/app/citymaps.php:318`). Die zusätzlichen Fundorte haben das Feld
längst (`citymap_link.label`); der Karten-Link zieht nach.

- **Spalte** `map_url_label VARCHAR(120) NULL` — inline-DDL **und** selbstheilendes `ALTER` (das Schema
  lebt im PHP, nicht in `sql/` — AGENTS.md §10).
- **Feld** im Editor, direkt unter „Karten-Link (extern) *", `data-cm-field="map_url_label"`.
  **Nicht** `data-cl-field` — das ist die Link-Tabelle, und `gatherStamm()` sweept `[data-cm-field]`.
- **`editableFields`**-Allowlist (`citymaps.php:964`) + die Ausgabe-Abbildung (`:906`) + die **explizite
  Spaltenliste** des öffentlichen Katalogs. Der Editor-Detail-Read ist `SELECT *` und bekommt sie
  geschenkt (`citymaps-feature-task-c`).
- **`avesmapsCitymapLinks()`**: `'label' => $label !== '' ? $label : 'Karte'`.

**Fallback bleibt serverseitig „Karte".** Der Client-seitige Fallback wäre für die i18n schöner
(`tr("cityMaps.linkDefault", …)`), aber `avesmapsCitymapLinks()` speist **auch den Linkchecker**, und ein
leeres Label dort wäre eine zweite Baustelle. Die i18n-Lücke ist vorhanden und bleibt vorerst — sie ist
älter als diese Spec.

### 5.2 „Vorschau-Link (extern)" raus — und `thumb_url` stillgelegt

Owner 2026-07-17: *„raus … Vorschau-Link (extern) (das feld ist abgedeckt durch Vorschaubild)"*, und auf
Rückfrage: **ganz stilllegen**.

`thumb_url` ist heute nicht nur ein Eingabeweg, sondern ein **Anzeigeweg**:
`avesmapsCitymapPublicThumbUrl()` (`citymaps.php:524`) nimmt `thumb_url`, wenn kein eigener Upload da ist.

- **Feld raus** aus `renderDetail()` (`html/citymap-editor.html:850`).
- **Anzeigeweg raus**: `avesmapsCitymapPublicThumbUrl()` liefert nur noch `thumb_local_url`. Öffentlich
  wird also nur noch, was jemand mit Capability `edit` selbst hochgeladen hat.

**Warum stilllegen und nicht nur das Feld entfernen:** ohne den Anzeigeweg-Stopp entstünde ein Zustand,
den der Editor **anzeigt, aber nicht beheben kann**. Der Community-Vorschlagsdialog darf `thumb_url`
befüllen (bewusst so — der Prüfer soll sehen, was der Melder gefunden hat, `citymaps-feature-task-c`), das
Editor-Vorschaubild zeigt ihn (`avesmapsCitymapEditorThumbUrl`), aber einen „Entfernen"-Knopf gibt es nur
für Uploads und Autoget. Ein schlechter Fremdlink wäre über die UI nicht mehr loszuwerden.

**Kostet heute nichts:** von 419 Karten zeigt genau **eine** überhaupt eine Vorschau, und die ist ein
Upload unter `/uploads/kartensammlungen/`. Kein Leser sieht derzeit ein `thumb_url`.

**Was bleibt:** die **Spalte** `thumb_url` (Daten), der Community-Weg (der Melder darf weiter einen Link
vorschlagen), und die Sichtbarkeit für den Prüfer in der Meldung. Er lädt das Bild dann selbst hoch, wenn
die Lizenz es erlaubt. `thumb_auto_url` (Autoget, editor-only per Konstruktion) ist davon **nicht**
berührt.

### 5.3 „Identität" nach oben — über „Vorschaubild" und „Karte"

Owner 2026-07-17: *„im Kartensammlungseditor will man das was zu »Identität« gehört über »Vorschaubild«
und »Karte« haben, damit klar ist, dass das autoget den link anzapft."*

Heute baut `renderDetail()` (`html/citymap-editor.html:846`) erst `ce-imgcols` (Vorschaubild + Karte),
dann die Gruppe „Identität". **Der Autoget-Knopf sitzt damit über dem Feld, das er liest**: er crawlt
`map_url` (`html/citymap-editor.html:789`, `disabled` ohne Karten-Link) — und der steht darunter. Die
Reihenfolge dreht sich um; der Editor liest sich dann von oben nach unten als Ursache → Wirkung.

Reine Reihenfolge, kein neues Feld: die beiden Blöcke tauschen im `body.innerHTML`-Ausdruck den Platz.

### 5.4 Der `is_paid`-Erklärsatz fliegt raus

`html/citymap-editor.html:873` trägt einen dreizeiligen `ce-hint`, der begründet, warum „kostenpflichtig"
kein Auto-Abgleich mit dem Shop ist. Owner 2026-07-17: *„der satz kann weg"*.

Die **Begründung** ist damit nicht widerrufen — sie bleibt in `citymaps-feature-task-c` und in dieser
Spec: ein Preis ist eine Momentaufnahme, `isPwyw` ist weder frei noch bezahlt, und die Ulisses-API kennt
das Produkt, nicht die Karte im Buch. Nur der Editor muss sie nicht bei jedem Öffnen erzählen. Wer später
einen Auto-Abgleich bauen will, findet das Nein weiterhin dokumentiert.

## 6. Was NICHT dazugehört

- **Der Streifen im Infopanel.** Der Owner hat „die Items und der Dialog" gesagt; die 116px-Kacheln haben
  dieselbe Krankheit, sind aber nicht beauftragt. Eigene Session.
- **Die 21 Farbe/Schwarzweiß-Paare als Datenfrage.** Ob sie sachlich stimmen (Farbtafel + S/W-Fassung) oder
  ein Sync-Artefakt sind, klärt der Wiki-Sync — **anzeigen** muss man den Unterschied so oder so, und das
  tut §3.1.
- **`note` in Format/Maßstab zerlegen.** 94 von 419 Karten tragen dort *„Format: A4 · Maßstab: Ja · Mit
  Nummern"* — halbstrukturierter Sync-Output mit sichtbaren Parse-Fehlern (*„Maßstab: Forum"*). Eigene
  Spalten wären richtig, sind aber ein Datenprojekt, kein Design.
- **`z-index: 3000` auf die Tokens umstellen.** Die Hülle trägt drei Dialoge; der Sweep gehört nicht in
  diese Spec. Hier wird nur um ihn herum gebaut (§4.3).

## 7. Betroffene Dateien

| Datei | Was |
|---|---|
| `js/map-features/map-features-place-extras.js` | `buildCityMapRowMarkup` (neue Zeile), `citymapFiltersMarkup` (4 statt 13), Band-Ableitung, „schwarzweiß" |
| `js/map-features/map-features-citymaps-dialog.js` | `filterState` + `TOGGLES` ausdünnen, adaptive Leiste, „Sammlung bearbeiten"-Handler, Sortierung |
| `js/map-features/map-features-citymaps.js` | `avesmapsCitymapFacetOptions` (nur noch trennende Facetten), Filter-Prädikate ausdünnen |
| `css/features/place-extras.css` | Zeile als Grid + Animation, Filterleiste, Fußzeile |
| `js/app/i18n-en.js` | `cityMaps.footHint` + Wegfall der gestrichenen Filter-Keys |
| `html/citymap-editor.html` | „Linktext" rein, „Vorschau-Link (extern)" raus |
| `api/_internal/app/citymaps.php` | `map_url_label` (DDL/ALTER/Allowlist/Ausgabe/`avesmapsCitymapLinks`), `avesmapsCitymapPublicThumbUrl` stilllegen |
| `js/map-features/__tests__/citymaps-render.test.js` | Zeilen-Markup, „schwarzweiß", Band-Ableitung |
| `api/_internal/app/__tests__/citymap-gate-test.php` | `thumb_url` nicht mehr öffentlich |

## 8. Abnahme

1. `?siedlung=Gareth` → Kartensammlung öffnen: **drei** Filter-Chips (farbig, offiziell, kostenlos), kein
   Zeitraum, neun einzeilige Einträge, kein Scrollen.
2. Die vier „Herz des Reiches"-Zeilen sind unterscheidbar (Stadtplan farbig / Stadtplan schwarzweiß /
   Umgebungskarte …).
3. Klick auf eine Zeile: Bild wächst animiert auf 248×174, Details entfalten, nur eine Zeile offen.
4. Ein Ort mit **einer** Karte: **keine** Filterleiste.
5. `?edit=1` → „Sammlung bearbeiten" sichtbar, öffnet den Editor **vor** dem Dialog (nicht dahinter).
6. Editor: „Linktext" = „Plan im Wiki" → Leser sieht „Plan im Wiki ↗" statt „Karte ↗"; leer → „Karte ↗".
7. Editor: „Vorschau-Link (extern)" ist weg; eine Karte mit gesetztem `thumb_url` und freier Lizenz zeigt
   dem Leser **keine** Vorschau mehr.
8. Kein `(online)` mehr in der Leserzeile.
