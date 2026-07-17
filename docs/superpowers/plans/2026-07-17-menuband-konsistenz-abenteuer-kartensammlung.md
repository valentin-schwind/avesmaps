# Menüband-Konsistenz Abenteuer ↔ Kartensammlung — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beide Editor-Menübänder auf eine identische Kachel-Leiste angleichen und den fehlenden
Feature-Schalter „Abenteuer an/aus" ergänzen.

**Architecture:** Reine Frontend- (zwei self-contained Editor-HTML-Dateien) + Flag-Arbeit (ein
neues `app_setting`-Flag `adventures_enabled`, 1:1 nach dem bestehenden `citymaps_enabled`). Kein
neuer last-erzeugender Endpunkt. Der öffentliche Abenteuer-Katalog liefert bei „aus" eine leere
Liste — der Client baut daraus leere Indizes, wodurch schwebende Kachel und Infopanel-Sektionen
ohne jede Frontend-Änderung verschwinden (dieselbe Mechanik wie Kartensammlung).

**Tech Stack:** PHP 8 (strict types) + PDO, vanilla JS (kein Build), `app_setting`-KV-Store.

**Spec:** `docs/superpowers/specs/2026-07-17-menuband-konsistenz-abenteuer-kartensammlung-design.md`

## Global Constraints

- Keine hartkodierten Farben/Radien — nur Tokens aus `css/base/tokens.css` (AGENTS.md §12). Die
  Editoren binden `tokens.css` direkt.
- Kein Blau; Icon-Politik: **nur** die Sync-Kachel trägt ein Icon (🚨).
- Deutsche UI-Strings bleiben deutsch; Code/Kommentare/`error.code` englisch (AGENTS.md §8).
- `app_setting`-Kill-Switch-Konvention: Default `'1'` (an), nur gespeichertes `'0'` = aus.
- STRATO: keine Live-Endpunkte loopen; Verifikation über lokalen Repro, nicht gegen Prod.
- Geteilter Working-Tree: nur eigene Pfade stagen, nie `git add -A`.
- Editoren werden dynamisch mit `?v=Date.now()` geladen → **kein** `ASSET_VERSION`-Bump nötig
  (in Task 4 verifizieren); nie ein `?v=` von Hand schreiben.

---

## Task 1: Backend-Flag `adventures_enabled`

**Files:**
- Modify: `api/_internal/app/adventures.php` (Getter/Setter nach Zeile 153; Katalog-Gate in
  `avesmapsAdventuresReadCatalog` ab Zeile 332; Editor-list-Payload Zeile 725)
- Modify: `api/app/adventures.php` (öffentlicher GET-Payload, Zeile 72–77)
- Modify: `api/edit/map/adventures.php` (Dispatcher-Action, nach Zeile 90)

**Interfaces:**
- Produces: `avesmapsAdventuresEnabled(PDO): bool`, `avesmapsSetAdventuresEnabled(PDO, bool): array`
  (Rückgabe `['adventures_enabled' => bool]`), Payload-Feld `adventures_enabled` in beiden
  Katalog-Antworten, Edit-Action `set_adventures_enabled`.

- [ ] **Step 1: Getter/Setter einfügen** — in `api/_internal/app/adventures.php` direkt nach
  `avesmapsSetAdventuresCoversEnabled` (Zeile 153):

```php
// ---- feature kill switch (whole adventure access on the public frontend) ----------------------------
// A WIDER switch than the cover one above: this hides the entire adventure feature on the public
// frontend -- the floating "Abenteuer" tile AND every infopanel section ("beginnt/spielt", the
// "Abenteuer in ..." lists) -- while the capability-gated editor keeps working. Same mechanic as
// citymaps_enabled: the public catalog returns an empty list, so the client builds empty indices and
// every place shows zero adventures (no frontend change needed). Default ENABLED; only a stored '0'
// disables.
const AVESMAPS_ADVENTURES_SETTING = 'adventures_enabled';

function avesmapsAdventuresEnabled(PDO $pdo): bool
{
    return avesmapsAppSettingGet($pdo, AVESMAPS_ADVENTURES_SETTING, '1') !== '0';
}

function avesmapsSetAdventuresEnabled(PDO $pdo, bool $enabled): array
{
    avesmapsAppSettingSet($pdo, AVESMAPS_ADVENTURES_SETTING, $enabled ? '1' : '0');
    return ['adventures_enabled' => $enabled];
}
```

- [ ] **Step 2: Katalog-Gate einfügen** — in `avesmapsAdventuresReadCatalog`, direkt nach
  `avesmapsAdventuresEnsureTables($pdo);` (Zeile 334), VOR der SELECT-Query:

```php
    // Feature kill switch: off -> empty catalog, exactly like citymaps. The client then builds empty
    // indices, so the floating tile goes disabled and no infopanel section renders. Checked right after
    // EnsureTables so "off" skips the query entirely.
    if (!avesmapsAdventuresEnabled($pdo)) {
        return [];
    }
```

- [ ] **Step 3: Öffentlichen GET-Payload erweitern** — in `api/app/adventures.php`, den
  `avesmapsJsonResponse`-Block (Zeile 72–77) um das Flag ergänzen:

```php
        avesmapsJsonResponse(200, [
            'ok' => true,
            'adventures' => $adventures,
            'territory_meta' => $territoryMeta,
            'covers_enabled' => avesmapsAdventuresCoversEnabled($pdo),
            'adventures_enabled' => avesmapsAdventuresEnabled($pdo),
        ]);
```

- [ ] **Step 4: Editor-list-Payload erweitern** — in `avesmapsListAdventuresForEdit`, den finalen
  Return (Zeile 725):

```php
    return ['adventures' => $adventures, 'covers_enabled' => avesmapsAdventuresCoversEnabled($pdo), 'adventures_enabled' => avesmapsAdventuresEnabled($pdo)];
```

- [ ] **Step 5: Dispatcher-Action ergänzen** — in `api/edit/map/adventures.php`, direkt nach der
  `set_covers_enabled`-Zeile (Zeile 90):

```php
        // The WIDER kill switch: hides the whole adventure feature on the public frontend (floating tile
        // + all infopanel sections) by emptying the public catalog. Mirrors set_citymaps_enabled.
        'set_adventures_enabled' => avesmapsSetAdventuresEnabled($pdo, (bool) ($payload['enabled'] ?? true)),
```

- [ ] **Step 6: PHP-Lint** — alle drei Dateien:

```bash
php -l api/_internal/app/adventures.php && php -l api/app/adventures.php && php -l api/edit/map/adventures.php
```
Expected: je `No syntax errors detected`.

- [ ] **Step 7: Regressions-Check der bestehenden Suite** (das Flag ist ein `app_setting`-Wrapper
  ohne reine Funktion → kein neuer Unit-Test, konsistent mit `citymap-gate-test.php`, das die
  Enable-Switches ebenfalls nicht testet). Die vorhandenen reinen Tests dürfen nicht brechen:

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/citymap-gate-test.php
```
Expected: `citymap-gate ok` + `citymap thumb_url retired ok`.

- [ ] **Step 8: Commit**

```bash
git add api/_internal/app/adventures.php api/app/adventures.php api/edit/map/adventures.php
git commit -m "feat(adventures): add adventures_enabled feature kill switch (mirrors citymaps_enabled)"
```

---

## Task 2: Kartensammlungs-Menü angleichen

**Files:**
- Modify: `html/citymap-editor.html` (`.ce-header` Zeile 416–437; busy-Labels Zeile ~1308/~1352;
  Init-Verdrahtung von `ceAutogetBtn`)

**Interfaces:**
- Consumes: nichts aus Task 1.
- Produces: die kanonische Kachel-Reihenfolge, an die Task 3 den Abenteuer-Editor angleicht.

- [ ] **Step 1: Header umsortieren + Icons entfernen + Autoget deaktivieren.** `.ce-header`
  (Zeile 416–437) auf diese Reihenfolge/Struktur bringen — `ceEnabledToggle` wandert ans Ende,
  🔗/🖼️ entfallen, `ceAutogetBtn` bekommt `disabled` + feste Sub-Zeile. `title`-Attribute
  unverändert übernehmen (hier gekürzt dargestellt):

```html
<div class="ce-header">
  <button type="button" class="ce-btn2 ce-btn2--primary" id="ceSyncBtn" title="…unverändert…">
    <span class="t1">🚨 Karten syncen</span>
    <span class="t2" id="ceSyncSub">…</span>
  </button>
  <button type="button" class="ce-btn2" id="ceLinkCheckBtn" title="…unverändert…">
    <span class="t1">Links prüfen</span>
    <span class="t2" id="ceLinkCheckSub">…</span>
  </button>
  <button type="button" class="ce-btn2" id="ceAutogetBtn" disabled title="Vorschauen-Massenlauf vorübergehend deaktiviert (Sicherheit): der Lauf hält je Schritt einen PHP-Worker und kommt mit einem Server-Riegel gegen Doppelläufe zurück. Der Einzelbild-Refetch pro Karte im Detail bleibt.">
    <span class="t1">Vorschauen holen</span>
    <span class="t2" id="ceAutogetSub">vorübergehend deaktiviert</span>
  </button>
  <button type="button" class="ce-btn2" id="cePreviewsToggle" title="…unverändert…">
    <span class="t1" id="cePreviewsLabel">Vorschauen: …</span>
    <span class="t2">öffentliche Anzeige</span>
  </button>
  <button type="button" class="ce-btn2" id="ceEnabledToggle" title="…unverändert…">
    <span class="t1" id="ceEnabledLabel">Kartensammlung: …</span>
    <span class="t2">öffentliche Anzeige</span>
  </button>
</div>
```

- [ ] **Step 2: 🔗 aus dem busy-Label von `handleLinkCheckClick`** entfernen (citymap Zeile ~1308):
  `"🔗 Links prüfen"` → `"Links prüfen"` (der Ruhezustand-Text im `isBusy ? … : "…"`-Ausdruck).

- [ ] **Step 3: `ceAutogetBtn`-Verdrahtung stilllegen.** Den `addEventListener("click",
  handleAutogetClick)` für `ceAutogetBtn` und den Init-Aufruf von `refreshCeAutogetInfo()`
  entfernen (sonst überschreibt der Refresh die feste Sub-Zeile „vorübergehend deaktiviert").
  `handleAutogetClick`/`refreshCeAutogetInfo` als Funktionen stehen lassen (toter, aber
  harmloser Code; kommt mit der Massenlauf-Session zurück) — nur nicht mehr aufrufen.

- [ ] **Step 4: Visuelle Verifikation** (Task 4 bündelt beide Editoren; hier nur Lint der HTML):
  im Browser-Repro (`?edit=1` → Kartensammlung editieren) prüfen: Reihenfolge sync · Links ·
  Vorschauen holen (grau/disabled) · Vorschauen · Kartensammlung; nur sync trägt 🚨. — In diesem
  Step nur sicherstellen, dass keine ID verwaist ist (Suche im File nach `ceEnabledToggle`,
  `ceAutogetBtn`: je genau eine Definition + erwartete Referenzen).

- [ ] **Step 5: Commit**

```bash
git add html/citymap-editor.html
git commit -m "ui(citymap-editor): align tile bar order, drop non-sync icons, disable Vorschauen-holen"
```

---

## Task 3: Abenteuer-Menü angleichen + „Abenteuer an/aus" verdrahten

**Files:**
- Modify: `html/adventure-editor.html` (`.ae-header` Zeile 322–340; `setCoversToggleState`
  Zeile 483–489; `loadList` Zeile 469–479; busy-Label `handleAeLinkCheckClick` Zeile ~1297;
  Init-Verdrahtung Zeile 1324–1327; neue Toggle-Funktionen)

**Interfaces:**
- Consumes (Task 1): Edit-Action `set_adventures_enabled`; Antwortfeld `adventures_enabled` aus
  `action:"list"`.
- Produces: nichts für spätere Tasks.

- [ ] **Step 1: Header ersetzen.** `.ae-header` (Zeile 322–340) auf die kanonische Reihenfolge
  aus Task 2 bringen: sync (🚨, nach vorn) · Links prüfen (🔗 raus) · Vorschauen holen (neu,
  `disabled`) · Vorschauen: AN/AUS (der umgebaute Cover-Toggle) · Abenteuer: AN/AUS (neu). Den
  `ae-header__spacer` am Ende behalten:

```html
<div class="ae-header">
  <button type="button" class="ae-btn2 ae-btn2--primary" id="aeSyncBtn" title="…unverändert…">
    <span class="t1">🚨 Abenteuer syncen</span>
    <span class="t2" id="aeHeaderSub">Letzte Sync: wird geladen…</span>
  </button>
  <button type="button" class="ae-btn2" id="aeLinkCheckBtn" title="…unverändert…">
    <span class="t1">Links prüfen</span>
    <span class="t2" id="aeLinkCheckSub">…</span>
  </button>
  <button type="button" class="ae-btn2" id="aeAutogetBtn" disabled title="Cover-Massenlauf (Wiki-Cover neu ziehen) — vorübergehend deaktiviert; kommt mit einem Server-Riegel gegen Doppelläufe. Einzelne Cover neu ziehen geht weiter im Detail-Panel.">
    <span class="t1">Vorschauen holen</span>
    <span class="t2">vorübergehend deaktiviert</span>
  </button>
  <button type="button" class="ae-btn2" id="aeCoversToggle" title="Notaus NUR für die Vorschaubilder (Cover): aus = keine Cover und keine „© Ulisses Spiele“-Fußnote im öffentlichen Frontend. Die Abenteuer, ihre Links und der Editor bleiben. Getrennt vom Karten-Vorschauschalter, weil die Erlaubnis nur bis auf Widerruf gilt.">
    <span class="t1" id="aeCoversToggleLabel">Vorschauen: …</span>
    <span class="t2">öffentliche Anzeige</span>
  </button>
  <button type="button" class="ae-btn2" id="aeEnabledToggle" title="Globaler Notaus für die Abenteuer: aus = die Abenteuer verschwinden auf der öffentlichen Seite (schwebende Kachel + Infopanel-Sektionen inkl. „Abenteuer in …“). Die Daten bleiben, der Editor arbeitet weiter.">
    <span class="t1" id="aeEnabledLabel">Abenteuer: …</span>
    <span class="t2">Frontend-Zugriff</span>
  </button>
  <span class="ae-header__spacer"></span>
</div>
```

- [ ] **Step 2: `setCoversToggleState` an die Kartensammlungs-Optik angleichen** (Zeile 483–489):
  Label trägt jetzt den vollen Text; `is-off`/`aria-pressed` entfallen (die Kartensammlungs-Kachel
  hat keinen Warnton, sonst sähen die beiden „AUS"-Zustände unterschiedlich aus):

```js
  function setCoversToggleState(enabled) {
    state.coversEnabled = enabled;
    const label = document.getElementById("aeCoversToggleLabel");
    if (label) label.textContent = enabled ? "Vorschauen: AN" : "Vorschauen: AUS";
  }
```

- [ ] **Step 3: 🔗 aus dem busy-Label von `handleAeLinkCheckClick`** entfernen (Zeile ~1297):
  `"🔗 Links prüfen"` → `"Links prüfen"`.

- [ ] **Step 4: Neue Toggle-Funktionen einfügen** — direkt nach `toggleCovers` (endet ~Zeile 503).
  Muster: `setCoversToggleState`/`toggleCovers`, Backend-Action aus Task 1:

```js
  // Feature kill switch: the WHOLE adventure access on the public frontend (floating tile + infopanel
  // sections). Wider than the cover switch above. Mirrors citymaps' ceEnabledToggle.
  function setAdventuresEnabledToggleState(enabled) {
    state.adventuresEnabled = enabled;
    const label = document.getElementById("aeEnabledLabel");
    if (label) label.textContent = enabled ? "Abenteuer: AN" : "Abenteuer: AUS";
  }
  async function toggleAdventuresEnabled() {
    const next = !state.adventuresEnabled;
    const btn = document.getElementById("aeEnabledToggle");
    if (btn) btn.disabled = true;
    try {
      const res = await adventurePost({ action: "set_adventures_enabled", enabled: next });
      setAdventuresEnabledToggleState(typeof res.adventures_enabled === "boolean" ? res.adventures_enabled : next);
    } catch (e) {
      alert("Umschaltung fehlgeschlagen: " + e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
```

- [ ] **Step 5: `loadList` initialisiert den neuen Toggle** (nach Zeile 473, neben der
  covers-Zeile):

```js
      if (typeof res.covers_enabled === "boolean") setCoversToggleState(res.covers_enabled);
      if (typeof res.adventures_enabled === "boolean") setAdventuresEnabledToggleState(res.adventures_enabled);
```

- [ ] **Step 6: Init-Verdrahtung** (Zeile 1324–1327) um den neuen Toggle ergänzen (der
  `aeAutogetBtn` bleibt ohne Listener — er ist `disabled`):

```js
  document.getElementById("aeCoversToggle").addEventListener("click", toggleCovers);
  document.getElementById("aeEnabledToggle").addEventListener("click", toggleAdventuresEnabled);
```

- [ ] **Step 7: Verwaisungs-Check.** Im File nach `aeEnabledToggle`, `aeEnabledLabel`,
  `aeAutogetBtn`, `aeCoversToggleLabel` suchen — jede ID genau einmal im HTML, Referenzen im JS
  wie erwartet, keine übrig gebliebene `is-off`/`aria-pressed`-Referenz auf `aeCoversToggle`.

- [ ] **Step 8: Commit**

```bash
git add html/adventure-editor.html
git commit -m "ui(adventure-editor): align tile bar with citymap; add Abenteuer an/aus switch"
```

---

## Task 4: End-to-End-Verifikation (Pool-sicher)

**Files:** keine Änderung (nur ggf. `js/territory/territory-editor-inline-host.js`, falls der
Cache-Check das verlangt — erwartet: nein).

- [ ] **Step 1: Cache-Weg der Editoren bestätigen.** Prüfen, wie
  `openAvesmapsCitymapEditorOverlay` / `openAvesmapsAdventureEditorOverlay` (in
  `js/review/review-settlement-list.js` o. ä.) die `html/*-editor.html` laden. Erwartung:
  `?v=Date.now()` → immer frisch → **kein** `ASSET_VERSION`-Bump. Falls stattdessen ein fester
  Hash/`?v=` verwendet wird: Projekt-Cache-Regel folgen (nie `?v=` von Hand).

- [ ] **Step 2: Menü-Optik beider Editoren.** Lokalen Repro starten (`php -S 127.0.0.1:8099` im
  Repo-Root; Editoren über HTTP laden, nicht `file://` — sonst fehlen die `/css`-Styles). Beide
  Editoren via `?edit=1`-Panel öffnen. Prüfen:
  - Identische Reihenfolge: `🚨 syncen · Links prüfen · Vorschauen holen · Vorschauen: AN/AUS · X: AN/AUS`.
  - Nur die Sync-Kachel trägt ein Icon.
  - „Vorschauen holen" in BEIDEN sichtbar, aber grau/`disabled`, Klick tut nichts.
  - Toggle-Kacheln zweizeilig: Zustand oben, „öffentliche Anzeige"/„Frontend-Zugriff" unten.

- [ ] **Step 3: Schreibflow `set_adventures_enabled` (gestubbt, ohne Prod).** Im Repro
  `window.adventurePost` bzw. `fetch` stubben, sodass `action:"list"` einmal
  `adventures_enabled:false` liefert → Kachel zeigt „Abenteuer: AUS"; Klick auf den Toggle ruft
  `set_adventures_enabled` mit `enabled:true`. Kein Aufruf gegen den Live-Endpunkt.

- [ ] **Step 4: Frontend-Effekt des leeren Katalogs.** In einem Infopanel-Repro
  (`?infopanel=true`) den Abenteuer-Katalog auf `[]` injizieren (leere
  `window.AVESMAPS_ADVENTURE_CATALOG` bzw. `avesmapsLoadAdventureCatalog` stubben) und bestätigen:
  schwebende „Abenteuer"-Kachel wird `aria-disabled`, keine „beginnt/spielt"- und keine
  „Abenteuer in …"-Sektion rendert. (Beweist die Gate-Mechanik ohne Loopen des Live-Endpunkts.)

- [ ] **Step 5: Abschluss-Commit / Notiz.** Falls Schritt 1 doch einen Bump verlangte, diesen
  committen; sonst keine Änderung. Ergebnis der Verifikation kurz festhalten.

---

## Self-Review (bei der Erstellung durchlaufen)

- **Spec-Abdeckung:** §4.1 → Task 2; §4.2 → Task 3 (Steps 1–3); §4.3 → Task 1 + Task 3 (Steps 4–6);
  §4.4 → Task 2 (Step 1/3) + Task 3 (Step 1); §6 Verifikation → Task 4. Vollständig.
- **Platzhalter:** keine „TBD/TODO"; alle Code-Blöcke ausgeschrieben. `title="…unverändert…"` ist
  eine bewusste Anweisung (das bestehende Attribut bleibt), kein Platzhalter.
- **Typ-Konsistenz:** `adventures_enabled` (Payload-Feld) / `set_adventures_enabled` (Action) /
  `avesmapsAdventuresEnabled` (PHP) / `state.adventuresEnabled` (JS) durchgängig gleich benannt.
