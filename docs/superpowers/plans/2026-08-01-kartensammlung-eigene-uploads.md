# Eigene Uploads für die Kartensammlung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax
> for tracking.

**Goal:** Ein eigenes Vorschaubild wird beim Upload zu WebP mit längster Kante 400 px; die ganze Karte
wird unverändert gespeichert; die Lizenz reist mit dem Upload und der Server weist nicht-freie Bilder
ab, **bevor** Bytes auf die Platte gehen.

**Architecture:** Ein neuer reiner Kodierer (`api/_internal/app/citymap-image-encode.php`) ohne DB und
ohne HTTP, testbar mit echtem GD. Der bestehende Endpoint `api/edit/map/citymap-image.php` ruft ihn auf
und bestimmt die Dateiendung aus dem **Ergebnis**. Lizenzprüfung wandert vom versteckten Editor-Knopf in
den Server.

**Tech Stack:** PHP 8 (strict types), GD, Vanilla-JS-Editor (`html/citymap-editor.html`), kein Build.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-01-kartensammlung-eigene-uploads-design.md` — bei jedem
  Zweifel gilt sie.
- **Owner-Vorgabe, wörtlich bindend:** „geschützte bilder dürfen nicht bei uns landen, es sei denn sie
  sind gemeinfrei, cc0, genehmigt oder von uns."
- **Vorschaubild → WebP, längste Kante 400. Ganze Karte → gar nicht anfassen.**
- **GIF bleibt GIF** (Animation).
- **Der Upload darf NIE an der Umwandlung scheitern** — fehlt WebP im GD, gilt das heutige Verhalten.
- **Kein zweiter Upload-Weg**, kein Nachrüsten bestehender Bilder, keine Autoget-Umgehung.
- **Kein `ASSET_VERSION`-Bump nötig:** `html/citymap-editor.html` wird mit `?v=Date.now()` geladen
  (`js/review/review-settlement-list.js:776`). Kein `?v=` von Hand schreiben.
- **Geteilter Arbeitsbaum:** niemals `git add -A`/`git add .`. Nur die im Task genannten Pfade stagen.
- Kommentare und Commit-Botschaften **englisch**, UI-Texte **deutsch** (AGENTS.md §8).
- Testlauf braucht GD explizit: `php -d extension=gd` (lokal ist GD nicht per Default geladen).

---

### Task 1: Der reine Kodierer

**Files:**
- Create: `api/_internal/app/citymap-image-encode.php`
- Test: `api/_internal/app/__tests__/citymap-image-encode-test.php`

**Interfaces:**
- Consumes: `avesmapsWikiSyncMonitorDownscaleCoatBytes(string $bytes, string $ext, int $maxEdge): string`
  aus `api/_internal/wiki/sync-monitor-identity.php` (nur im Rückfallzweig).
- Produces: `avesmapsCitymapEncodeThumbBytes(string $bytes, string $ext, int $maxEdge = 400): array`
  → `['bytes' => string, 'ext' => string]`. Task 3 verlässt sich auf **beide** Schlüssel.

- [ ] **Step 1: Write the failing test**

Datei `api/_internal/app/__tests__/citymap-image-encode-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Unit test for the citymap thumb encoder. No DB, no HTTP -- but REAL GD.
 * Run (from repo root):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=gd \
 *       api/_internal/app/__tests__/citymap-image-encode-test.php
 * Exit 0 = all asserts passed.
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions is not '1' -- assert() would be a no-op.\n");
    exit(2);
}
if (!function_exists('imagewebp') || !function_exists('imagecreatefromstring')) {
    fwrite(STDERR, "FATAL: GD with WebP is required. Re-run with: php -d extension=gd " . __FILE__ . "\n");
    exit(2);
}

require __DIR__ . '/../citymap-image-encode.php';

/** Build PNG bytes of a given size, with a transparent left half. */
function tstPngBytes(int $w, int $h): string {
    $im = imagecreatetruecolor($w, $h);
    imagealphablending($im, false);
    imagesavealpha($im, true);
    imagefilledrectangle($im, 0, 0, $w - 1, $h - 1, imagecolorallocate($im, 200, 30, 30));
    imagefilledrectangle($im, 0, 0, (int) ($w / 2), $h - 1, imagecolorallocatealpha($im, 0, 0, 0, 127));
    ob_start();
    imagepng($im);
    $bytes = (string) ob_get_clean();
    imagedestroy($im);
    return $bytes;
}

// ---- a large PNG becomes WebP, bounded at 400 on the longest edge ------------------------------------
$big = tstPngBytes(1000, 500);
$out = avesmapsCitymapEncodeThumbBytes($big, 'png');
assert($out['ext'] === 'webp');
$info = getimagesizefromstring($out['bytes']);
assert(is_array($info));
assert($info[0] === 400 && $info[1] === 200); // aspect ratio preserved
assert(max($info[0], $info[1]) === 400);

// ---- a SMALL picture is still converted -------------------------------------------------------------
// "passendes WebP-Format" is the order, not "only when it pays off". Dimensions stay untouched.
$small = tstPngBytes(120, 60);
$outSmall = avesmapsCitymapEncodeThumbBytes($small, 'png');
assert($outSmall['ext'] === 'webp');
$infoSmall = getimagesizefromstring($outSmall['bytes']);
assert($infoSmall[0] === 120 && $infoSmall[1] === 60);

// ---- transparency survives the conversion -----------------------------------------------------------
$re = imagecreatefromstring($out['bytes']);
assert($re !== false);
$corner = imagecolorat($re, 2, 2);              // inside the transparent half
$alpha = ($corner >> 24) & 0x7F;                 // 127 = fully transparent
imagedestroy($re);
assert($alpha > 100);

// ---- GIF is passed through UNTOUCHED ----------------------------------------------------------------
// Converting would silently drop every frame but the first.
$gifSrc = imagecreatetruecolor(800, 800);
ob_start();
imagegif($gifSrc);
$gif = (string) ob_get_clean();
imagedestroy($gifSrc);
$outGif = avesmapsCitymapEncodeThumbBytes($gif, 'gif');
assert($outGif['ext'] === 'gif');
assert($outGif['bytes'] === $gif);

// ---- garbage in -> unchanged out, never an exception ------------------------------------------------
$outJunk = avesmapsCitymapEncodeThumbBytes('not an image', 'png');
assert($outJunk['ext'] === 'png');
assert($outJunk['bytes'] === 'not an image');
$outEmpty = avesmapsCitymapEncodeThumbBytes('', 'png');
assert($outEmpty['bytes'] === '');

echo "citymap-image-encode-test: OK\n";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=gd api/_internal/app/__tests__/citymap-image-encode-test.php
```

Expected: FAIL — `Failed to open stream ... citymap-image-encode.php` (die Datei gibt es noch nicht).

- [ ] **Step 3: Write minimal implementation**

Datei `api/_internal/app/citymap-image-encode.php`:

```php
<?php

declare(strict_types=1);

// Encoder for the Kartensammlung's PREVIEW picture (slot=thumb): longest edge 400px, always WebP.
// Owner 2026-08-01: "Vorschaubild (slot=thumb) -> soll zu webp 400px".
//
// Its own file rather than a branch inside citymaps.php: it is pure (bytes in, bytes out -- no DB, no
// HTTP), which is the only reason it can be unit-tested against real GD at all. Same motive that moved
// the app_setting store out of adventures.php.
//
// The FULL MAP (slot=map) has deliberately no counterpart here -- it is stored exactly as uploaded
// (owner: "Ganze Karte soll nicht verändert werden"). Do not "unify" the two slots.

require_once __DIR__ . '/../wiki/sync-monitor-identity.php'; // avesmapsWikiSyncMonitorDownscaleCoatBytes

const AVESMAPS_CITYMAP_THUMB_WEBP_QUALITY = 82;

/**
 * @return array{bytes: string, ext: string} The bytes to store and the extension they actually are.
 *   The caller MUST name the file after the returned ext -- naming it before calling this is how a
 *   .png ends up holding WebP bytes.
 */
function avesmapsCitymapEncodeThumbBytes(string $bytes, string $ext, int $maxEdge = 400): array
{
    $ext = strtolower($ext);
    $unchanged = ['bytes' => $bytes, 'ext' => $ext];

    // GIF may be animated: re-encoding to WebP here would keep the first frame and silently drop the
    // rest. The Wappen downscaler leaves GIF alone for the same reason.
    if ($bytes === '' || $ext === 'gif') {
        return $unchanged;
    }
    // GD without WebP support (STRATO cannot be measured in advance -- api/diagnostics/ is denied):
    // fall back to today's behaviour, original format bounded at maxEdge. An upload must never fail
    // over the conversion.
    if (!function_exists('imagewebp') || !function_exists('imagecreatefromstring')) {
        return ['bytes' => avesmapsWikiSyncMonitorDownscaleCoatBytes($bytes, $ext, $maxEdge), 'ext' => $ext];
    }

    $src = @imagecreatefromstring($bytes);
    if ($src === false) {
        return $unchanged;
    }
    try {
        $w = imagesx($src);
        $h = imagesy($src);
        if ($w < 1 || $h < 1) {
            return $unchanged;
        }
        // min(1.0, ...) -- never scale UP a small picture; only bound the large ones.
        $scale = min(1.0, $maxEdge / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $dst = imagecreatetruecolor($nw, $nh);
        if ($dst === false) {
            return $unchanged;
        }
        // Take alpha over as-is instead of blending it against black.
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        if (!imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h)) {
            imagedestroy($dst);
            return $unchanged;
        }
        ob_start();
        $ok = imagewebp($dst, null, AVESMAPS_CITYMAP_THUMB_WEBP_QUALITY);
        $out = (string) ob_get_clean();
        imagedestroy($dst);
        // Deliberately NO "keep the original unless the result is smaller" check (unlike the Wappen
        // downscaler): the stored format must not depend on how well a given picture happens to
        // compress. Only a genuinely failed encode falls back.
        if (!$ok || $out === '') {
            return $unchanged;
        }
        return ['bytes' => $out, 'ext' => 'webp'];
    } finally {
        imagedestroy($src);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=gd api/_internal/app/__tests__/citymap-image-encode-test.php
```

Expected: `citymap-image-encode-test: OK`, Exit 0.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/citymap-image-encode.php api/_internal/app/__tests__/citymap-image-encode-test.php
git commit -m "feat(citymaps): a preview upload is encoded to WebP at 400px, GIF untouched"
```

---

### Task 2: `own_work` als freie Lizenz

**Files:**
- Modify: `api/_internal/app/citymaps.php:38-40` (die drei Lizenz-Konstanten)
- Modify: `html/citymap-editor.html:581-587` (`LICENSES`, der bewusste Spiegel)
- Test: `api/_internal/app/__tests__/citymap-gate-test.php` (erweitern)

**Interfaces:**
- Consumes: nichts aus Task 1.
- Produces: der Wert `'own_work'` ist in `AVESMAPS_CITYMAP_LICENSES` **und**
  `AVESMAPS_CITYMAP_LICENSES_FREE`; Task 4 prüft gegen `avesmapsCitymapLicenseIsFree()`.

- [ ] **Step 1: Write the failing test**

An `api/_internal/app/__tests__/citymap-gate-test.php` direkt hinter die bestehende Zeile
`assert(!avesmapsCitymapLicenseIsFree('nonsense'));` anfügen:

```php
// 'own_work' -- the fan who DREW the map. Owner 2026-08-01 ("... oder von uns"): permission_granted
// reads wrong for "it is mine", and without a matching entry the dropdown had no honest answer at all.
assert(in_array('own_work', AVESMAPS_CITYMAP_LICENSES, true));
assert(avesmapsCitymapLicenseIsFree('own_work'));
assert(avesmapsCitymapNormalizeLicense('own_work') === 'own_work');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/citymap-gate-test.php
```

Expected: FAIL — `assert(in_array('own_work', AVESMAPS_CITYMAP_LICENSES, true))`.

- [ ] **Step 3: Write minimal implementation**

In `api/_internal/app/citymaps.php` die beiden Listen ergänzen (Reihenfolge: vor `unknown_other`,
das bleibt der letzte und einzige nicht-freie Wert):

```php
const AVESMAPS_CITYMAP_LICENSES = ['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'own_work', 'unknown_other'];
const AVESMAPS_CITYMAP_LICENSE_DEFAULT = 'unknown_other';
const AVESMAPS_CITYMAP_LICENSES_FREE = ['public_domain', 'cc0', 'ai_generated', 'permission_granted', 'own_work'];
```

In `html/citymap-editor.html` denselben Wert in den Spiegel (der Kommentar darüber sagt ausdrücklich,
dass beide Listen zusammen wachsen müssen):

```javascript
    { value: "permission_granted", label: "Genehmigung erteilt", free: true },
    { value: "own_work", label: "Eigene Kreation", free: true },
    { value: "unknown_other", label: "Unbekannt/Sonstiges (nicht öffentlich)", free: false },
```

- [ ] **Step 4: Run test to verify it passes**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=mbstring api/_internal/app/__tests__/citymap-gate-test.php
```

Expected: Exit 0, keine Ausgabe auf STDERR.

- [ ] **Step 5: Commit**

```bash
git add api/_internal/app/citymaps.php html/citymap-editor.html api/_internal/app/__tests__/citymap-gate-test.php
git commit -m "feat(citymaps): \"Eigene Kreation\" joins the free licences in the map editor"
```

---

### Task 3: Kodierer verdrahten — thumb wird WebP, map bleibt unangetastet

**Files:**
- Modify: `api/edit/map/citymap-image.php` — Kopfkommentar (Z. 5-24), Konstanten (Z. 37-39),
  Upload-Zweig (Z. 179-200)

**Interfaces:**
- Consumes: `avesmapsCitymapEncodeThumbBytes()` aus Task 1.
- Produces: gespeicherte Vorschaubilder heißen `.webp`; `map_local_url` zeigt auf die Originaldatei.

- [ ] **Step 1: Write the failing test**

Es gibt für diesen Endpoint keinen Unit-Test (er ist HTTP + `$_FILES` + DB). Die prüfbare Zusage ist
die **Reihenfolge**, und die deckt Task 1 bereits ab. Statt eines Scheintests hier eine **statische
Zusicherung**, die genau die Falle festnagelt — ans Ende von
`api/_internal/app/__tests__/citymap-image-encode-test.php`, vor die `echo`-Zeile:

```php
// REGRESSION GUARD: the endpoint must name the file AFTER encoding. If someone moves the filename
// back in front of the encoder, a .png will hold WebP bytes and the reader gets a wrong content type.
$endpoint = (string) file_get_contents(__DIR__ . '/../../../edit/map/citymap-image.php');
// Match the CALL, not the name: the require line mentions the function in a comment and would satisfy
// a looser search from the top of the file, making this guard pass no matter where the call moved.
$posEncode = strpos($endpoint, 'avesmapsCitymapEncodeThumbBytes($rawBytes');
$posName = strpos($endpoint, "\$filename = \$slot . '-'");
assert($posEncode !== false, 'endpoint no longer calls the encoder');
assert($posName !== false, 'filename assignment not found -- update this guard');
assert($posEncode < $posName, 'the filename must be built AFTER the encoder decided the extension');
// The full map must not be downscaled any more (owner 2026-08-01).
assert(!str_contains($endpoint, 'AVESMAPS_CITYMAP_MAP_MAX_EDGE'), 'the map slot must be stored unchanged');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=gd api/_internal/app/__tests__/citymap-image-encode-test.php
```

Expected: FAIL — `endpoint no longer calls the encoder` (der Endpoint kennt den Kodierer noch nicht).

- [ ] **Step 3: Write minimal implementation**

3a) `require` ergänzen, direkt unter der bestehenden `sync-monitor-identity.php`-Zeile (Z. 27):

```php
require_once __DIR__ . '/../../_internal/app/citymap-image-encode.php';  // avesmapsCitymapEncodeThumbBytes
```

3b) Konstante `AVESMAPS_CITYMAP_MAP_MAX_EDGE` **löschen** und den Kommentar darüber ersetzen:

```php
// Longest edge for the PREVIEW (owner 2026-08-01: thumb -> WebP at 400px). The FULL MAP has no bound
// beyond the 12 MB upload cap: it is stored exactly as uploaded, because it is the artefact people zoom
// into and re-compressing destroys precisely its purpose.
const AVESMAPS_CITYMAP_THUMB_MAX_EDGE = 400;
```

3c) Den Block Z. 184-200 (Dateiname → verschieben → in-place skalieren) **ersetzen** durch:

```php
    // Encode BEFORE naming the file: the preview becomes WebP, so only the encoder knows the real
    // extension. Naming first and rewriting in place is how a .png ends up holding WebP bytes.
    $rawBytes = (string) @file_get_contents($tmp);
    if ($rawBytes === '') {
        avesmapsErrorResponse(400, 'invalid_request', 'Die Datei konnte nicht gelesen werden.');
    }
    if ($slot === 'thumb') {
        $encoded = avesmapsCitymapEncodeThumbBytes($rawBytes, $ext, AVESMAPS_CITYMAP_THUMB_MAX_EDGE);
        $storedBytes = $encoded['bytes'];
        $ext = $encoded['ext'];
    } else {
        // slot === 'map': stored exactly as uploaded (owner 2026-08-01). No scaling, no re-encoding.
        $storedBytes = $rawBytes;
    }

    $filename = $slot . '-' . bin2hex(random_bytes(8)) . '.' . $ext;
    $target = $dir . '/' . $filename;
    if (@file_put_contents($target, $storedBytes) === false) {
        avesmapsErrorResponse(500, 'server_error', 'Datei konnte nicht gespeichert werden.');
    }
    @chmod($target, 0644);
```

> Hinweis: `move_uploaded_file` entfällt, weil die Bytes ohnehin durch den Kodierer gehen. Die
> Sicherheitsprüfung liegt weiter oben und bleibt unangetastet: `is_uploaded_file($tmp)` (Z. 166) ist
> die Zusicherung, dass `$tmp` wirklich ein Upload ist, und `finfo` hat den echten MIME-Typ gelesen.

3d) Kopfkommentar Z. 5-14 an die neue Wahrheit anpassen (die Zeile über den 4000 px muss weg):

```php
//   - UPLOAD (a file field `image` is present): validate per finfo-MIME + size, then
//     * slot 'thumb': encode to WebP at longest edge 400 via avesmapsCitymapEncodeThumbBytes()
//     * slot 'map':   store EXACTLY as uploaded -- the full map is what people zoom into
//     store under /uploads/kartensammlungen/<safeId>/ and write citymap.<slot>_local_url.
//     SVG is deliberately rejected (XSS risk on own uploads).
```

- [ ] **Step 4: Run test to verify it passes**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=gd api/_internal/app/__tests__/citymap-image-encode-test.php
php -l api/edit/map/citymap-image.php
```

Expected: `citymap-image-encode-test: OK` und `No syntax errors detected`.

- [ ] **Step 5: Commit**

```bash
git add api/edit/map/citymap-image.php api/_internal/app/__tests__/citymap-image-encode-test.php
git commit -m "feat(citymaps): preview uploads are stored as WebP, the full map exactly as uploaded"
```

---

### Task 4: Die Lizenz reist mit dem Upload — und der Server setzt sie durch

**Files:**
- Modify: `api/edit/map/citymap-image.php` — Kopfkommentar Z. 21-24, neuer Prüfblock vor dem Upload,
  Autoget-Fehlertext Z. 156
- Modify: `html/citymap-editor.html` — `uploadBtn` (Z. 900-903), `uploadImage()` (Z. 1122-1139),
  Warnzeile (Z. 924)

**Interfaces:**
- Consumes: `avesmapsCitymapLicenseIsFree()` / `avesmapsCitymapNormalizeLicense()` (Task 2),
  `$slot`, `$publicId`, `$pdo` aus dem bestehenden Endpoint.
- Produces: HTTP `403 license_not_free`, wenn die wirksame Lizenz nicht frei ist.

- [ ] **Step 1: Write the failing test**

Ans Ende von `api/_internal/app/__tests__/citymap-image-encode-test.php`, vor die `echo`-Zeile:

```php
// REGRESSION GUARD: the endpoint must refuse a non-free licence BEFORE it writes anything to disk.
// Owner 2026-08-01: "geschuetzte bilder duerfen nicht bei uns landen". Until then the endpoint said
// so in a comment and enforced nothing -- the editor merely hid the button, which is not enforcement.
$posGate = strpos($endpoint, 'license_not_free');
$posWrite = strpos($endpoint, 'file_put_contents($target');
assert($posGate !== false, 'the upload licence gate is gone');
assert($posWrite !== false, 'the file write was renamed -- update this guard');
assert($posGate < $posWrite, 'the licence must be checked BEFORE any bytes reach the disk');
```

- [ ] **Step 2: Run test to verify it fails**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=gd api/_internal/app/__tests__/citymap-image-encode-test.php
```

Expected: FAIL — `the upload licence gate is gone`.

- [ ] **Step 3: Write minimal implementation**

4a) Kopfkommentar Z. 21-24 **ersetzen** (er behauptet heute das Gegenteil der Owner-Vorgabe):

```php
// THE LICENCE IS ENFORCED HERE, before a single byte reaches the disk (owner 2026-08-01: "geschuetzte
// bilder duerfen nicht bei uns landen, es sei denn sie sind gemeinfrei, cc0, genehmigt oder von uns").
// This file used to argue the opposite -- that the read gate was enough and the editor's hidden button
// did the rest. A hidden button is not enforcement: any client with capability 'edit' could POST a
// protected image straight past it. The read gate (avesmapsCitymapPublicThumbUrl / ...MapLocalUrl)
// still stands; it now guards what may be SHOWN, while this guards what may be STORED.
//
// The licence may travel WITH the upload (field `license`), which is what makes the editor a single
// gesture instead of "set licence -> save -> upload". It addresses the slot's own column: thumb ->
// thumb_license, map -> map_license.
```

4b) Neuer Block, direkt **hinter** der Größenprüfung (heute Z. 170-172) und **vor** dem `finfo`-Sniff:

```php
    // The licence that will apply once this upload lands: the one sent with it, else the stored one.
    // Normalising first means an unknown string falls to 'unknown_other' and is refused -- never the
    // other way round.
    $licenseColumns = ['thumb' => 'thumb_license', 'map' => 'map_license'];
    $licenseColumn = $licenseColumns[$slot];
    $sentLicense = trim((string) ($_POST['license'] ?? ''));
    if ($sentLicense !== '') {
        $effectiveLicense = avesmapsCitymapNormalizeLicense($sentLicense);
    } else {
        $stored = $pdo->prepare('SELECT ' . $licenseColumn . ' FROM citymap WHERE public_id = :pid LIMIT 1');
        $stored->execute(['pid' => $publicId]);
        $effectiveLicense = avesmapsCitymapNormalizeLicense($stored->fetchColumn());
    }
    if (!avesmapsCitymapLicenseIsFree($effectiveLicense)) {
        avesmapsErrorResponse(403, 'license_not_free',
            'Ohne freie Lizenz wird kein Bild gespeichert. Erlaubt sind: gemeinfrei, CC0, von uns KI-generiert, Genehmigung erteilt, eigene Kreation.');
    }
```

4c) Direkt **nach** dem erfolgreichen Schreiben der Datei (hinter `@chmod($target, 0644);`) die Lizenz
mitschreiben, falls sie gesendet wurde — Datei und Lizenz gehören zur selben Geste:

```php
    if ($sentLicense !== '') {
        $pdo->prepare('UPDATE citymap SET ' . $licenseColumn . ' = :lic WHERE public_id = :pid')
            ->execute(['lic' => $effectiveLicense, 'pid' => $publicId]);
    }
```

4d) Im Editor den Upload-Knopf **immer** zeigen (Z. 900-903):

```javascript
    // Always offered: the licence travels with the upload, so there is no "save first" step any more.
    // The server refuses a non-free licence before storing anything -- this button cannot leak.
    const uploadBtn =
      `<label class="btn btn--sm" for="ceFile_${slot}" style="cursor:pointer">Hochladen…</label>
       <input type="file" id="ceFile_${slot}" accept="image/png,image/jpeg,image/webp,image/gif" hidden>`;
```

4e) Warnzeile Z. 924 durch einen Hinweis ersetzen, der den Weg zeigt statt ihn zu versperren:

```javascript
        ${free ? "" : `<p class="ce-warn">Zum Hochladen zuerst oben eine freie Lizenz wählen — ohne sie wird nichts gespeichert.</p>`}
```

4f) `uploadImage()` schickt die **aktuell gewählte** Lizenz mit (nicht die gespeicherte):

```javascript
  async function uploadImage(slot, input) {
    if (!state.selectedId) { imgState(slot, "Bitte zuerst die Karte speichern.", true); input.value = ""; return; }
    const file = input.files && input.files[0];
    if (!file) return;
    // The licence as it stands in the FORM, not as it was last saved: picking "Eigene Kreation" and
    // uploading is one gesture now. The server checks it again -- this is convenience, not the gate.
    const licenseField = slot === "thumb" ? "thumb_license" : "map_license";
    const select = document.querySelector(`[data-cm-field="${licenseField}"]`);
    const license = select ? select.value : "";
    if (!licenseIsFree(license)) {
      imgState(slot, "Bitte zuerst eine freie Lizenz wählen — ohne sie wird nichts gespeichert.", true);
      input.value = "";
      return;
    }
    imgState(slot, "Wird hochgeladen …", false);
    try {
      const fd = new FormData();
      fd.append("public_id", state.selectedId);
      fd.append("slot", slot);
      fd.append("license", license);
      fd.append("image", file);
      await imagePost(fd);
      await selectCitymap(state.selectedId);
    } catch (e) {
      imgState(slot, "Fehler: " + e.message, true);
    } finally {
      input.value = "";
    }
  }
```

4g) Der Autoget-Fehler soll auf den Upload zeigen statt in die Sackgasse. Der Satz wird **serverseitig**
angehängt — `api/edit/map/citymap-image.php:156`, nicht im Editor, wo man ihn zuerst sucht:

```php
            avesmapsErrorResponse($status, $code, $auto['message']
                . ' Viele Seiten (DeviantArt, Ulisses) sperren automatische Zugriffe grundsätzlich —'
                . ' das lässt sich nicht umgehen. Lizenz wählen und das Bild von Hand hochladen.');
```

- [ ] **Step 4: Run test to verify it passes**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=gd api/_internal/app/__tests__/citymap-image-encode-test.php
php -l api/edit/map/citymap-image.php
node --check html/citymap-editor.html 2>/dev/null || echo "(HTML: kein node-check, Syntax im Browser prüfen)"
```

Expected: Test OK, `No syntax errors detected`.

- [ ] **Step 5: Commit**

```bash
git add api/edit/map/citymap-image.php html/citymap-editor.html api/_internal/app/__tests__/citymap-image-encode-test.php
git commit -m "feat(citymaps): the licence travels with an image upload and the server enforces it"
```

---

## Nach dem letzten Task — Prüfung am lebenden System

Der Endpoint ist HTTP + `$_FILES` + DB und lokal nicht durchspielbar. Nach dem Deploy (Push → ~1-2 min)
gehört deshalb **ein** echter Durchlauf im Editor dazu, mit einer Einzelprobe, nie in einer Schleife:

1. Karte im Karten-Editor öffnen, Lizenz auf **„Eigene Kreation"**, ein **PNG** als Vorschau hochladen.
2. Erwartung: die Vorschau erscheint, und die gespeicherte URL endet auf **`.webp`** — das ist der
   Beweis, dass GD auf STRATO WebP kann. Endet sie auf `.png`, hat der Rückfall gegriffen: dann fehlt
   `imagewebp` auf dem Server, und das gehört dem Owner gemeldet (kein Bug, aber eine offene Zusage).
3. Lizenz auf **„Unbekannt/Sonstiges"** stellen und erneut hochladen wollen → muss mit
   `license_not_free` abgewiesen werden, **und im Upload-Verzeichnis darf nichts Neues liegen**.
4. Eine große Karte (> 4000 px) in den `map`-Slot laden → Dateigröße und Maße müssen dem Original
   entsprechen.

⚠️ **Kein `?v=` von Hand** und **kein `ASSET_VERSION`-Bump** — der Editor wird mit `?v=Date.now()`
geladen.
