# Design-Umstellung — Fortsetzung (Infopanel & Infobox, Runde 2)

> Fortsetzung der warmen/aventurischen Design-Umstellung. **Pflichtlektüre vorab:**
> `docs/design-language.md` (Tokens, KEIN Blau, Trenner randlos) + `AGENTS.md`
> (§9 geteilter Tree, §7 Asset-Versionierung, §12 Designsprache).
> Owner testet **live** auf `https://avesmaps.de/?infopanel=true` in **hell UND dunkel**
> (Theme-Toggle). Push → `master` → ~1–2 Min Auto-Deploy, danach Remote-SHA prüfen und
> erst nach der Deploy-Verzögerung live schauen. Screenshots sind hier oft nicht möglich
> → der Owner ist die Live-Verifikation; kleine Schritte, nachfragen.

## Stand

**Live & solide** (master): Dark-Fest-Migration (Infobox-Inhalt, Routenplaner, Dialoge,
Kontextmenü, Zoom), `--space` +2px global, größere Section-Titel, kein H-Scroll,
Routing-NaN-Crash gefixt (`c7f66fcb`).

**Bereits als eigene Sessions ausgelagert (Task-Chips):**
- **Task A:** quadratische Aktions-Kacheln (Variante A) + `img/`-Bilder 100×100.
- **Task B:** schwebende Slim-Infobox im Panel-Modus.

Diese Instruktion deckt die **4 restlichen Beobachtungen** und verzahnt Punkt 4 mit Task A.
Empfohlene Reihenfolge: **1 (Regression) → 3 (Schrift) → 4 (Icons, mit Task A) → 2 (Motion).**

---

## 1. ✅ ERLEDIGT: Randlose Trenner durch `--space` +2px verrutscht (Regression)

> **Erledigt in dieser Runde** — `--infopanel-pad-x`-Token in `css/features/infopanel.css`
> eingeführt; das Body-Padding UND alle full-bleed-Margins (Z.293–294, 306–309, 321–322,
> ehemals hartkodiert `14px`) referenzieren es jetzt. Beschreibung unten als Referenz.
> Nur noch live gegenprüfen (Trenner randlos an beide Kanten, hell + dunkel).

**Symptom (Owner):** „das Padding im oberen Bereich ist immer noch nicht richtig" — die
Kopf-/Abschnitts-Trenner im Panel laufen nicht mehr sauber randlos an die Kante.

**Diagnose:** `.avesmaps-infopanel__body` hat jetzt `padding: … var(--space-16) …` =
**18px** horizontal (nach dem +2px-Global). Die full-bleed-Sektionen setzen aber
**hartkodiert** `margin: 0 -14px` + `padding: … 14px` (infopanel.css **Z.293–294**
Kopf, **Z.306–309** Sektionen, **Z.321–322** region-info-box-Kopf) — noch auf die alten
**14px**. `18 ≠ 14` → Trenner/Kopf-Linie 4px eingerückt statt randlos → verletzt die
Hart-Regel „Trenner immer randlos" und lässt das obere Padding „falsch" wirken.

**Fix:** EIN Token fürs horizontale Panel-Padding, das Body UND full-bleed-Margins teilen —
so können sie nie wieder auseinanderlaufen.
- In `css/base/tokens.css` (oder lokal oben in infopanel.css) `--infopanel-pad-x: 18px;`.
- Body: `padding: var(--space-12) var(--infopanel-pad-x) var(--space-16);`.
- Alle `-14px`/`14px` der full-bleed-Regeln (Z.293–294, 306–309, 321–322) auf
  `margin-left/right: calc(-1 * var(--infopanel-pad-x));` +
  `padding-left/right: var(--infopanel-pad-x);` umstellen.
- Danach den oberen Abstand über dem Wappen prüfen (Body-Top `--space-12` = 14px); wirkt es
  gedrängt, `--space-16` fürs Top nehmen. Owner-Rückmeldung einholen.

**Prüfen:** linke Trenner-Kante == rechte == Panel-Rand (per DevTools messen), hell + dunkel.

---

## 2. Info-Tab klappt anders schnell ein als das Panel

**Symptom (Owner):** „‚info'-Tab hat eine andere Geschwindigkeit beim Einklappen wie das Panel".

**Diagnose:** Beide sind `0.22s ease`, aber **verschiedene Properties**: das **Panel**
animiert `transform: translateX(100%)` (infopanel.css **Z.31** — GPU-composited, butterweich);
der **Info-Tab** animiert `right` (infopanel.css **Z.188**, auch `#review-panel-toggle`
**Z.233/242** — Layout-Property, Repaint je Frame → ruckelt/desynct gegenüber dem Panel).

**Fix:** Den Rand-Tab ebenfalls per `transform: translateX(…)` bewegen (nicht `right`), im
Lockstep mit dem Panel — beide composited, beide um `--avesmaps-ip-w`.
- Gemeinsames Motion-Token, z.B. `--motion-panel: 0.22s ease;` in tokens.css; Panel,
  Info-Tab und `#review-panel-toggle` teilen es.
- Tab: statt `right: var(--ip-w) ↔ 0` zu animieren, per `transform: translateX` zwischen
  „an der Panel-Kante" und „an der Bildschirmkante" gleiten. Achtung: der Tab sitzt
  `position: fixed` an `right: var(--ip-w)` — die Offen/Zu-Umschaltung dann über
  `transform` statt `right`.
- Sicherstellen, dass die Klassen-Umschaltung (`.is-hidden` / `.avesmaps-any-panel-open`)
  für Panel + Tab im **selben Frame** passiert (kein zwischenzeitliches Layout-Reflow).

**Prüfen:** Tab und Panel-Kante bewegen sich beim Ein-/Ausklappen exakt deckungsgleich.

---

## 3. Panel-Schrift insgesamt zu klein

**Symptom (Owner):** „die Schriftart im Panel ist insgesamt zu klein".

**Diagnose:** Der Panel überschreibt nur Name (**23px**, Z.270), Typ/Beschreibung (**14px**,
Z.274/277) und `font-size: 1em` auf `.location-popup` (Z.267). Der **restliche Inhalt**
behält die kompakten **Popup-Größen (11–13px)**, weil er feste px nutzt und nicht
panel-scoped hochgezogen wird: Attribut-Tabelle (region-info-box `dt/dd` ~13px), Quelle-Zeile,
Publikations-Pills (`.fs-src-tab` 11.5px), Stadtkarten/Abenteuer-Labels (11–12px),
Bewertungen.

**Fix:** Panel-Inhalt **eine Stufe** hochskalieren (Design-Skala: caption 11 / small 12 /
body 13 / reading 14 / subhead 16 — siehe tokens.css). Zwei Wege:
- **Sauber:** `.avesmaps-infopanel` bekommt eine größere Basis-`font-size` und der
  eingespeiste Inhalt wird auf **em/rem** umgestellt (skaliert dann mit). Größerer Umbau.
- **Pragmatisch (empfohlen für den Einstieg):** die Schlüssel-Content-Größen
  **`.avesmaps-infopanel`-scoped** je eine Stufe hoch — Attribut `dt/dd` 13→**14–15**,
  Meta 11→**12**, Pills 11.5→**13**, Stadtkarten/Abenteuer-Labels →**13–14**. NUR im Panel
  (das schwebende Popup + Slim-Box bleiben kompakt). Werte als Tokens (`--font-size-*`).
- Hierarchie erhalten: Name (subhead+) > Abschnitts-Titel (subhead) > Body/Attribute
  (reading) > Meta (small). Nicht alles gleich groß machen.

**Prüfen:** Attribut-Tabelle, Quelle, Pills, Stadtkarten/Abenteuer merklich besser lesbar;
Größen-Hierarchie bleibt klar; schwebendes Popup unverändert kompakt.

---

## 4. Einheitliche Kopf-Icon-Größe über Feature-Typen (Straßen / Reiche / Regionen)

**Symptom (Owner):** „Straßen, Reiche, Regionen haben alle unterschiedliche Icon-Größen".

**Diagnose:** Kopf-**Wappen** rendern mit **130px** (`.location-popup__icon--coat`
infopanel.css **Z.285–287**; `.region-info-box__coat` **Z.325–327**), die
**Typ-Icon-Fallbacks** aber mit **48px** (`.location-popup__icon` **Z.281–283** — Siedlung
ohne Wappen; **Wege** via `pathHeaderIconMarkup` → `.location-popup__icon--path`,
`js/map-features/map-features-path-rendering.js` **Z.51–56**). Ergebnis: Ort mit Wappen
130px, Weg 48px, Reich/Region mit Wappen 130px / ohne klein → uneinheitlich.

**Fix:** EINE Hero-Icon-Größe (Token, z.B. `--icon-hero` 130px bzw. die 100×100-Box aus
**Task A**) für **alle** Kopf-Illustrationen im Panel — Wappen, Siedlungs-Typ-Icon-Fallback,
Weg-SVG (`--path`), Territorien/Regionen mit UND ohne Wappen. Jeder Feature-Typ zeigt eine
gleich große Kopf-Illustration.
- Zentral setzen (ein Token) und in path-rendering.js (`--path`), popups.js
  (`--coat` / `.location-popup__icon`) und der region-info-box (`__coat` + Typ-Fallback)
  referenzieren.
- **Verzahnung mit Task A:** dort werden die Siedlungs-Typ-Icons zu 100×100-`img/`-Bildern —
  die Hero-Box-Größe dort zentral definieren und hier für Wege/Territorien/Regionen
  mitverwenden, damit alles aus derselben Quelle kommt.
- **KEIN Blau:** das Weg-SVG nutzt Inline-Farben `#3f6fa0` (Wasser) / `#7a6647` (Straße) in
  path-rendering.js Z.54–55 → auf Tokens ziehen (`--color-link`/`--color-accent-strong` für
  Wasser, `--color-text-muted`/`--color-accent-strong` für Straße; im Zweifel Owner fragen).

**Prüfen:** Ort / Weg / Reich / Region nacheinander anklicken — Kopf-Illustration überall
gleich groß, hell + dunkel.

---

## Prinzipien (für alle Punkte)

- **Nur Tokens** (`css/base/tokens.css`); fehlt ein Wert → erst Token anlegen, dann nutzen.
  **KEIN Blau** in der UI.
- **Trenner IMMER randlos** (negative Seiten-Margin = horizontales Padding — ab Punkt 1 über
  `--infopanel-pad-x`). Eine Linie je Section.
- **Scope beachten:** Panel-Änderungen `.avesmaps-infopanel`-scoped; das schwebende
  Karten-Popup + die Slim-Box (Task B) bleiben kompakt.
- **Cache:** CSS-`@import`-Versionen in `css/styles.css` bumpen (werden NICHT auto-gestempelt);
  JS-`<script>` in index.html werden auto-gestempelt.
- **Geteilter Tree (AGENTS.md §9):** NIE `git add -A`; nur selbst berührte Dateien per Pfad
  stagen, `git status` zuerst. Kleine verifizierte Commits auf `master`, Remote-SHA prüfen.
- Antworten Deutsch; Code/Commits/interne Messages Englisch.
