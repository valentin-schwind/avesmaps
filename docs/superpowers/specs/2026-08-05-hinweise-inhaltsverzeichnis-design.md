# Das Inhaltsverzeichnis der Hinweise — Entwurf

> **Stand 2026-08-05.** Vom Owner beauftragt und am Mockup abgenommen („mach").
> Betrifft ausschliesslich das Fenster „Hinweise" (`#legal-dialog` in `index.html`,
> Stil in `css/components/legal-dialog.css`).

## 1. Das Problem

Die Hinweise sind gewachsen: **7 Gruppen, 31 Absaetze, ~1.800 Woerter**, dazu die
Tastentabelle und das Kontaktformular — in einem Fenster von 680 px Breite und
hoechstens 760 px Hoehe. Das sind rund fuenf Fensterhoehen Scrollstrecke. Wer nur
den Impressum-Satz, das Kontaktformular oder die Tastenbelegung sucht, muss an
allem anderen vorbei, und *dass* es diese Dinge gibt, sieht man erst beim Scrollen.

## 2. Der tragende Satz

**Die Abschnitte werden zuklappbar, und der zugeklappte Zustand IST das
Inhaltsverzeichnis.** Kein zweites Bedienelement — keine Sprungleiste, keine
Reiter, kein Navigationsstreifen, der selbst wieder Platz kostet. Die Ueberschrift,
die man ohnehin liest, ist zugleich der Knopf, der hinfuehrt.

Damit passt das ganze Fenster — Logo, die beiden Kacheln, acht Zeilen — auf einen
Schirm, und die acht Zeilen beantworten die Frage „was steht hier eigentlich drin?"
ohne eine einzige Bewegung.

## 3. Wie es aussieht

Alle acht Abschnitte sind **zugeklappt**, auch „Bedienung" (Owner-Entscheid: das
Fenster soll als Verzeichnis aufgehen, nicht mit einem offenen Abschnitt). Jede
Zeile traegt

- den Punkt-Marker und die Ueberschrift in `--color-accent-strong` (unveraendert),
- **darunter eine Zeile Untertitel** in `--color-text-muted`, die verraet, was drin
  steckt („Marken, Kartenmaterial, Wappen, Bilder, Cover"),
- rechts einen Pfeil, der beim Aufklappen kippt,
- darueber die Trennlinie, die die Gruppen schon heute trennt.

Die beiden Aktionskacheln (Discord, „Was ist neu?") und das Fanprojekt-Logo bleiben
oben stehen und werden **nicht** eingeklappt: das sind Einladungen, keine Lektuere.
Der Schlusssatz „Aenderungen." bleibt als Fussnote unter der Liste.

### Die acht Zeilen

| Ueberschrift | Untertitel |
|---|---|
| Bedienung | Tastenbefehle fuer Karte, Suche und Route |
| Projekt und rechtlicher Status | Fanprojekt, keine offizielle DSA-Publikation |
| Urheberrecht und Lizenzen | Marken, Kartenmaterial, Wappen, Bilder, Cover |
| Inhalte und Datenquellen | Wegedaten, Wiki-Abgleich, Community-Meldungen |
| Technik und Lizenzen | Leaflet, jQuery, Wegfindung |
| Haftungsausschluss | Inhalte, Links, Verfuegbarkeit |
| Datenschutz | Logdaten, keine Cookies, Statistik, deine Rechte |
| Kontakt und Impressum | Betreiber, Anschrift, Nachricht schreiben |

Reihenfolge unveraendert; „Kontakt" bleibt unten (Owner-Entscheid).

## 4. Das Impressum zieht um

Der Absatz **„Betreiber/Impressum."** (Name und Anschrift des Owners) steht heute
in „Projekt und rechtlicher Status" und wandert an den **Anfang von „Kontakt und
Impressum"**, vor den Hinweistext des Formulars. Der Abschnitt heisst dann, was er
enthaelt.

In „Projekt und rechtlicher Status" bleiben zwei Absaetze: „Fanprojekt." und
„Distanzierung von offizieller Verbindlichkeit."

**Das macht das Impressum leichter auffindbar, nicht schwerer:** das Wort steht
jetzt sichtbar in der Liste, statt im dritten Absatz eines Fliesstextes zu stecken.
Erreichbar bleibt es mit zwei Klicks (Hinweise oeffnen, Zeile antippen).

## 5. Technik

`<details>` / `<summary>` — **das native Element des Browsers, kein selbstgebautes
Aufklappen.** Das ist die eigentliche Entscheidung dieses Entwurfs:

- 💣 **Strg+F findet Text in zugeklappten Abschnitten und klappt sie selbst auf.**
  Genau das kann nur die native Fassung; jede JS-Loesung mit `display: none` oder
  `hidden` nimmt der Seitensuche den Text weg. Bei einem Fenster, das Impressum und
  Datenschutzerklaerung traegt, ist das kein Komfort-, sondern ein Auffindbarkeits-
  merkmal. **Wer das spaeter durch eigenes Auf-/Zuklappen ersetzt, bricht es.**
- Tastatur und Screenreader kommen gratis: `<summary>` ist fokussierbar, reagiert
  auf Enter und Leertaste und meldet `aria-expanded` von selbst. Kein `role`, kein
  `tabindex`, kein Zustand in JS.
- Kein gespeicherter Zustand. Das Fenster oeffnet immer als Verzeichnis.

### Markup je Abschnitt

```html
<details class="legal-section">
  <summary class="legal-dialog__group">
    <h3 class="legal-dialog__group-title" data-i18n="legal.group.usage">Bedienung</h3>
    <span class="legal-dialog__group-hint" data-i18n="legal.hint.usage">Tastenbefehle …</span>
  </summary>
  … die Absaetze des Abschnitts …
</details>
```

Die Ueberschrift bleibt ein `<h3>` (Dokumentgliederung), der Untertitel ist ein
eigenes Element daneben — nicht *in* der Ueberschrift, damit die Ueberschrift kurz
bleibt. `data-i18n` sitzt auf den Blaettern, denn `js/app/i18n.js` setzt
`textContent` und wuerde ein Element mit Kindern leerraeumen.

### Stil

- `summary` wird `display: grid` (Spalten: Dreieck · Text; zwei Zeilen fuer Titel und
  Untertitel). Das entfernt zugleich das browsereigene Dreieck; fuer Safari
  zusaetzlich `::-webkit-details-marker { display: none }`.
- **Ein Zeichen je Zeile.** Der erste Bau hatte links den alten Punkt-Marker und
  rechts einen Pfeil — zwei Anzeigen fuer denselben Zustand, und der Punkt klebte am
  Rand (Owner am gebauten Stand). Stattdessen steht links, wo der Punkt stand, ein
  **Dreieck**: nach rechts, solange der Abschnitt zu ist, nach unten gekippt, wenn er
  offen ist. Der rechte Pfeil entfaellt.
- 💣 Das Dreieck ist ein `clip-path` auf einem **Quadrat**, kein Rahmen-Dreieck
  (`border-left: … solid` + durchsichtige Kanten): dessen Kaestchen ist 7x10, und
  `rotate(90deg)` drehte es um diese Mitte — sichtbar verrutscht. Ein Quadrat dreht
  sich um sich selbst.
- Der Einzug des Abschnittstextes ist die Summe der Zeile darueber (6 px Rand +
  10 px Dreieck + 8 px Spalte = 24 px), damit der Absatz unter seiner Ueberschrift
  beginnt.
- Hover und Fokus: `background: var(--color-hover-wash)`, `outline: none` — dieselbe
  Formel wie `.map-context-menu__item`.
- ⚠️ Die Trennlinie wandert von `.legal-dialog__group` (dem Titel) auf
  `.legal-section` (den Abschnitt). Sonst greift die Ausnahme
  `.legal-dialog__group:first-child`, denn im `<details>` ist das Summary **immer**
  erstes Kind — und alle acht Linien waeren weg.
- Keine negativen Seitenraender fuer den Hover-Streifen: der Scroll-Kasten hat
  `overflow-y: auto`, damit rechnet der Browser die Waagerechte auf `auto` — ein
  vollbreiter Streifen erzeugte eine waagerechte Bildlaufleiste.

## 6. Uebersetzung

Acht neue Schluessel `legal.hint.*` in `js/app/i18n-en.js` (deutsche Fassung steht
wie ueblich als Text im Markup). `legal.group.contact` heisst neu „Kontakt und
Impressum" / „Contact and imprint".

## 7. Was ausdruecklich NICHT passiert

- Kein Text wird umgeschrieben, gekuerzt oder geloescht — nur der Betreiber-Absatz
  wechselt den Abschnitt.
- Keine Reiter, keine Sprungleiste, keine zweite Navigationsebene.
- Keine Aenderung an den Aktionskacheln, am Aenderungsverlauf, am Kontaktformular
  oder an der Tastentabelle (die weiterhin aus `keyboard-shortcuts.js` gebaut wird).
- Keine URL-Anker, kein Zustand in der Adresszeile.

## 8. Pruefung

Am lokalen Vorschauserver: Fenster oeffnet mit acht zugeklappten Zeilen und ohne
Scrollbalken; jede Zeile klappt auf und zu; Strg+F auf ein Wort aus einem
zugeklappten Abschnitt (z. B. „Nobelstr.") klappt ihn auf; Tab und Enter bedienen
die Zeilen; die Tastentabelle steht in „Bedienung"; das Formular sendet weiterhin;
hell und dunkel.
