# Mehrquellen-System #2 — Implementierungsplan (Phase 1: Fundament + Referenz)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Quellen in Editoren verwalten (add/delete, Typ + offiziell); Wiki read-only; alte `other_source`
verlustfrei übernehmen. Spec: `docs/quellen-system-2-editor-design.md`. **Phase 1** = Schreib-Endpoint +
geteilte UI-Komponente + Einbindung in EINE Oberfläche (Siedlungseditor-Detail-Panel) + Live-Check.

**Architecture:** Ein authed Schreib-Endpoint (`list`/`add`/`remove` + atomarer other_source-Takeover, im
`list` getriggert) über `entity_type`+`entity_public_id` (opak → alle 4 Typen). Eine window-globale
Komponente `mountFeatureSourceEditor()` rendert die Liste + Add/Delete und wird überall eingebunden.

**Tech Stack:** PHP 8 PDO (self-healing DDL), Vanilla JS, `php -l` + `node --check` + Node-`assert`.

## Global Constraints
- **Keine Prod-DB-Writes durch den Agenten.** Die Endpoints sind Editor-Writes (Owner nutzt sie live); der Agent ruft sie NICHT selbst schreibend auf.
- Gold-Envelope `{ok:true,...}`/`{ok:false,error:{code,message}}`; capability `'edit'`; STRATO: keine Loops.
- Takeover **atomar** (Transaktion: erst Katalog-Upsert+Link, DANN Feld leeren) — kein Verlust-Fenster.
- UI Deutsch via `tr()`; Code Englisch; kein top-level `map.on`; nur eigene Dateien stagen.
- Assets: `review-feature-sources.js` in index.html verlinken (auto-Stempel) UND im Settlement-Editor-iframe laden (self-bust). Neue CSS via index.html-Link.

---

### Task 1: Write-Logik + Endpoint (Backend)

**Files:** Modify `api/_internal/app/feature-sources.php` (Logik dazu), Create `api/edit/map/feature-sources.php` (dünner Dispatcher).

**Interfaces — Produces:** `avesmapsFeatureSourceUpsert(pdo,url,label,type,official,userId):int`,
`avesmapsFeatureSourceLink(pdo,entityType,publicId,sourceId,userId):void`,
`avesmapsFeatureSourcesTakeoverOtherSource(pdo,entityType,publicId):void` (atomic),
`avesmapsListFeatureSourcesForEdit(pdo,entityType,publicId):array` (ruft Takeover, dann liest),
`avesmapsAddFeatureSource(...)`, `avesmapsRemoveFeatureSource(...)`. Endpoint `POST /api/edit/map/feature-sources.php` (actions `list`/`add`/`remove`).

- [ ] **Step 1: Write-Funktionen in `api/_internal/app/feature-sources.php` ergänzen** (nach der bestehenden `avesmapsReadFeatureSources`):

```php
// Dedup-Upsert einer Katalog-Quelle (url_hash = Identität). Gibt die sources.id zurück.
function avesmapsFeatureSourceUpsert(PDO $pdo, string $url, string $label, string $type, bool $official, int $userId): int
{
    $allowed = ['regionalband', 'abenteuer', 'briefspiel', 'sonstiges'];
    $type = in_array($type, $allowed, true) ? $type : 'sonstiges';
    $hash = hash('sha256', $url);
    $pdo->prepare(
        "INSERT INTO sources (url, url_hash, label, source_type, is_official, created_by)
         VALUES (:u, :h, :l, :t, :o, :cb)
         ON DUPLICATE KEY UPDATE label = IF(label = '', VALUES(label), label),
                                 is_official = VALUES(is_official)"
    )->execute(['u' => $url, 'h' => $hash, 'l' => $label, 't' => $type, 'o' => $official ? 1 : 0, 'cb' => $userId > 0 ? $userId : null]);
    return (int) $pdo->query('SELECT id FROM sources WHERE url_hash = ' . $pdo->quote($hash))->fetchColumn();
}

// Verknüpfung Element <-> Quelle (idempotent).
function avesmapsFeatureSourceLink(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId): void
{
    $pdo->prepare(
        "INSERT IGNORE INTO feature_sources (entity_type, entity_public_id, source_id, status, created_by)
         VALUES (:t, :id, :sid, 'approved', :cb)"
    )->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId, 'cb' => $userId > 0 ? $userId : null]);
}

// ATOMAR + verlustfrei: legacy properties.other_source -> Katalog + Verknüpfung, DANN Feld leeren.
// Nur map_features-Typen (settlement/region/path) tragen other_source. Idempotent (leer -> no-op).
function avesmapsFeatureSourcesTakeoverOtherSource(PDO $pdo, string $entityType, string $publicId, int $userId): void
{
    if (!in_array($entityType, ['settlement', 'region', 'path'], true)) {
        return;
    }
    $stmt = $pdo->prepare("SELECT id, properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $stmt->execute(['id' => $publicId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return;
    }
    $props = json_decode((string) $row['properties_json'], true);
    if (!is_array($props)) {
        return;
    }
    $other = $props['other_source'] ?? null;
    $url = is_array($other) ? trim((string) ($other['url'] ?? '')) : '';
    if ($url === '') {
        return; // nichts zu übernehmen
    }
    $label = is_array($other) ? trim((string) ($other['label'] ?? '')) : '';
    $pdo->beginTransaction();
    try {
        $sourceId = avesmapsFeatureSourceUpsert($pdo, $url, $label, 'sonstiges', false, $userId); // Quelle ist jetzt sicher im Katalog
        avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId);
        unset($props['other_source']); // ERST JETZT das alte Feld leeren
        $pdo->prepare("UPDATE map_features SET properties_json = :p, revision = :r WHERE id = :id")
            ->execute(['p' => avesmapsEncodeJson($props), 'r' => avesmapsNextMapRevision($pdo), 'id' => (int) $row['id']]);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// Liste FÜR DEN EDITOR: erst Takeover (konsolidiert other_source), dann alle Katalog-Quellen (mit source_id
// zum Löschen) + der feste Wiki-Link. Einheitlich -> keine Sonderfälle in der UI.
function avesmapsListFeatureSourcesForEdit(PDO $pdo, string $entityType, string $publicId, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    avesmapsFeatureSourcesTakeoverOtherSource($pdo, $entityType, $publicId, $userId);
    $stmt = $pdo->prepare(
        "SELECT s.id AS source_id, s.url, s.label, s.source_type, s.is_official
           FROM feature_sources fs JOIN sources s ON s.id = fs.source_id
          WHERE fs.entity_type = :t AND fs.entity_public_id = :id AND fs.status = 'approved'
          ORDER BY s.is_official DESC, s.created_at ASC, s.id ASC"
    );
    $stmt->execute(['t' => $entityType, 'id' => $publicId]);
    $sources = array_map(static fn(array $r): array => [
        'source_id' => (int) $r['source_id'], 'url' => (string) $r['url'], 'label' => (string) $r['label'],
        'type' => (string) $r['source_type'], 'official' => (int) $r['is_official'] === 1,
    ], $stmt->fetchAll(PDO::FETCH_ASSOC) ?: []);
    return ['ok' => true, 'sources' => $sources, 'wiki_url' => avesmapsFeatureSourcesReadWikiUrl($pdo, $entityType, $publicId)];
}

// Der feste Wiki-Link (read-only): settlement/region/path aus properties.wiki_url; territory aus political_territory.wiki_url.
function avesmapsFeatureSourcesReadWikiUrl(PDO $pdo, string $entityType, string $publicId): string
{
    if ($entityType === 'territory') {
        $s = $pdo->prepare("SELECT wiki_url FROM political_territory WHERE public_id = :id LIMIT 1");
        $s->execute(['id' => $publicId]);
        return trim((string) ($s->fetchColumn() ?: ''));
    }
    $s = $pdo->prepare("SELECT properties_json FROM map_features WHERE public_id = :id AND is_active = 1 LIMIT 1");
    $s->execute(['id' => $publicId]);
    $props = json_decode((string) ($s->fetchColumn() ?: ''), true);
    return is_array($props) ? trim((string) ($props['wiki_url'] ?? '')) : '';
}

function avesmapsAddFeatureSource(PDO $pdo, string $entityType, string $publicId, string $url, string $label, string $type, bool $official, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $sourceId = avesmapsFeatureSourceUpsert($pdo, $url, $label, $type, $official, $userId);
    avesmapsFeatureSourceLink($pdo, $entityType, $publicId, $sourceId, $userId);
    return avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId); // Takeover passiert hier drin
}

function avesmapsRemoveFeatureSource(PDO $pdo, string $entityType, string $publicId, int $sourceId, int $userId): array
{
    avesmapsEnsureFeatureSourceTables($pdo);
    $pdo->prepare("DELETE FROM feature_sources WHERE entity_type = :t AND entity_public_id = :id AND source_id = :sid")
        ->execute(['t' => $entityType, 'id' => $publicId, 'sid' => $sourceId]);
    return avesmapsListFeatureSourcesForEdit($pdo, $entityType, $publicId, $userId);
}
```

- [ ] **Step 2: Dispatcher `api/edit/map/feature-sources.php`** — dem Muster von `api/edit/map/features.php` folgen (bootstrap, `avesmapsRequireUserWithCapability('edit')`, JSON-Body via `avesmapsReadJsonRequest`, `entity_type` gegen `[settlement,region,path,territory]` validieren, `entity_public_id` non-empty, `match($action)` → `list`/`add`/`remove` → die Funktionen oben, Gold-Envelope). Exakte bootstrap-Helfer + Envelope an `api/edit/map/features.php` gegenprüfen und 1:1 übernehmen. Auth-Fehler/Validierung → `{ok:false,error:{code,message}}`.

- [ ] **Step 3: `php -l api/_internal/app/feature-sources.php` und `php -l api/edit/map/feature-sources.php`** → beide `No syntax errors detected` (Output melden).
- [ ] **Step 4: Commit** — `git add api/_internal/app/feature-sources.php api/edit/map/feature-sources.php && git commit -m "feat(api/sources): editor write endpoint (list/add/remove) + atomic other_source takeover"`

> Kein PHP-Unit-Harness; verifiziert über den Live-Check in Task 3 (Owner/Chrome).

---

### Task 2: Geteilte UI-Komponente + Node-Test

**Files:** Create `js/review/review-feature-sources.js`, Create `js/review/__tests__/feature-sources-render.test.js`.

**Interfaces — Produces:** `renderFeatureSourceEditorHtml(state, opts)` (reine Funktion, testbar) + `mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts)` (async: lädt `list`, wired add/remove). `window.*` + `module.exports` (Muster `map-features-point-in-polygon.js`).

- [ ] **Step 1: Failing test** `js/review/__tests__/feature-sources-render.test.js`:

```js
const assert = require("assert");
const { renderFeatureSourceEditorHtml } = require("../review-feature-sources.js");
const html = renderFeatureSourceEditorHtml(
  { wiki_url: "https://wiki/x", sources: [
    { source_id: 7, url: "https://f-shop.de/a", label: "F-Shop", type: "sonstiges", official: true },
    { source_id: 8, url: "https://bp/x", label: "Briefspiel", type: "briefspiel", official: false } ] },
  { escape: (s) => String(s == null ? "" : s) }
);
assert.ok(html.includes("Wiki Aventurica"), "wiki read-only row");
assert.ok(html.includes("F-Shop") && html.includes("Briefspiel"), "both sources listed");
assert.ok(html.includes('data-remove-source-id="7"') && html.includes('data-remove-source-id="8"'), "delete buttons carry source_id");
assert.ok(/data-fs-add/.test(html), "add row present");
console.log("feature-sources-render tests passed");
```

- [ ] **Step 2: Run → fails** (`Cannot find module`).
- [ ] **Step 3: Implementieren** `js/review/review-feature-sources.js`:
  - `renderFeatureSourceEditorHtml(state, opts)` — pure: baut (a) eine read-only Wiki-Zeile aus `state.wiki_url` (Label „Wiki Aventurica ↗", kein Löschen), (b) je `state.sources` eine Zeile `label ↗` + Typ + `*` wenn official + `<button data-remove-source-id="<source_id>">✕</button>`, (c) eine Add-Zeile mit `data-fs-add` (URL-Input, Linktext-Input, Typ-`<select>` [regionalband/abenteuer/briefspiel/sonstiges], „offiziell"-Checkbox, „Hinzufügen"-Button). Alle Strings via `opts.tr`/inline-Default; `opts.escape` injizierbar (Node-testbar).
  - `mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts)` — async: POST `list` → `containerEl.innerHTML = renderFeatureSourceEditorHtml(...)`; delegierter Click-Handler: `[data-remove-source-id]` → POST `remove` → re-render; `[data-fs-add-submit]` → POST `add` (aus den Feldern) → re-render. Fetch-Helfer `POST /api/edit/map/feature-sources.php` (`credentials:'same-origin'`, JSON).
  - `window.renderFeatureSourceEditorHtml = ...; window.mountFeatureSourceEditor = ...; module.exports = { renderFeatureSourceEditorHtml };`
- [ ] **Step 4: Run → passes.** `node --check js/review/review-feature-sources.js`.
- [ ] **Step 5: Commit** — `git add js/review/review-feature-sources.js js/review/__tests__/feature-sources-render.test.js && git commit -m "feat(ui/sources): shared feature-source editor component + node test"`

---

### Task 3: Einbindung Siedlungseditor-Detail-Panel (Referenz) + Live-Check

**Files:** Modify `html/wiki-sync-settlement-editor.html` (Detail-Panel), Modify `index.html` (Script-Link).

- [ ] **Step 1: `index.html`** — `<script src="js/review/review-feature-sources.js">` einhängen (bei den anderen `js/review/*`-Scripts). Und im Settlement-Editor-iframe (`html/wiki-sync-settlement-editor.html`) dieselbe Datei per `<script src="/js/review/review-feature-sources.js">` laden (same-origin).
- [ ] **Step 2:** Im Detail-Panel (`buildSettlementDetailHtml`/der `dtEdit`-Form, `html/wiki-sync-settlement-editor.html`): das editierbare **Wiki-URL**-Feld auf **read-only** stellen (oder entfernen; der Wiki-Link erscheint in der Komponente) und die **„Andere Quelle"**-Zeile durch einen Container `<div id="dtFeatureSources"></div>` ersetzen. Nach dem Rendern `mountFeatureSourceEditor($("dtFeatureSources"), "settlement", () => selectedPublicId, {...})` aufrufen. `other_source` NICHT mehr in `buildSettlementSavePayload` senden (der Takeover übernimmt es serverseitig; das Save-`update_point` darf `other_source` nicht mehr überschreiben — Feld aus dem Payload nehmen).
- [ ] **Step 3: `node --check`** der berührten JS + Settlement-Editor lädt ohne Konsolenfehler.
- [ ] **Step 4: Commit** (nur eigene Dateien) — `git commit -m "feat(settlement-editor): mount shared source editor in the detail panel; wiki read-only"`
- [ ] **Step 5: PUSH Phase-1-Batch + Live-Check (Controller, im Chrome):** eine Siedlung mit alter `other_source` im Editor öffnen → sie erscheint als löschbare Katalog-Quelle (Feld serverseitig geleert), Wiki read-only; eine zweite Quelle hinzufügen + wieder löschen → Endpoint + Re-Render grün; Infobox unverändert.

---

## Self-Review
- Spec-Coverage: Endpoint list/add/remove + Takeover (T1), Komponente (T2), 1 Oberfläche + Wiki-read-only + other_source-nicht-mehr-im-Payload (T3). Phasen 2–3 (übrige 5 Oberflächen) folgen nach Phase-1-Live-Check.
- Offen für den Implementer (grep): exaktes bootstrap/Envelope-Muster von `api/edit/map/features.php` (T1/2); die genaue `dtEdit`-Form-Struktur + Save-Payload (T3).
- Typkonsistenz: `avesmapsListFeatureSourcesForEdit`, `...Takeover...`, `...Upsert`, `...Link`, `renderFeatureSourceEditorHtml`, `mountFeatureSourceEditor` durchgängig.
