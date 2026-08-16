# Lizenzangaben Phase 4 (Die Dialoge) — Bauplan

> **Für agentische Umsetzer:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen Checkboxen.

**Entwurf:** `docs/superpowers/specs/2026-08-16-lizenzangaben-vereinheitlichung-design.md` (§3, §7)
**Vorgänger:** Phase 1 (Katalog), Phase 2 (Migration), Phase 3 (Gates).

**Ziel:** Alle fünf Upload-Flächen zeigen dieselbe Reihe — **Lizenz · Urheber · Kommentar**, darunter
die graue Protokollzeile „hochgeladen von X am TT.MM.JJJJ". Zwei Flächen bekommen zum ersten Mal
überhaupt eine Lizenzwahl.

**Bauart:** **Ein** gemeinsamer Markup-Bauer, den alle fünf einsetzen — nicht fünf Abschriften. Dann
je Fläche eine Aufgabe: Dialog, Endpunkt, Lesepfad.

---

## Globale Vorgaben

- **Kommentare und Commit-Nachrichten auf Deutsch** (AGENTS §8). Kennungen bleiben englisch.
- **Der Baum ist geteilt: niemals `git add -A`, `git add .` oder `git commit -a`.** Nur eigene Pfade
  einzeln stagen. 💣 Rote Tests, die nicht zu den eigenen Dateien gehören, sind kein Freibrief: dann
  in einem separaten Arbeitsbaum auf dem Commit-Stand prüfen.
- **Die sieben Werte in Anzeigereihenfolge** stehen in `js/app/media-licenses.js` (Phase 1) und
  dürfen **nirgends abgeschrieben** werden. Öffentlich sind fünf; `cc_by` und `unknown_other` nicht.
- 🔴 **Alle fünf Angaben bleiben im Editor.** Kein Besucher sieht Lizenz, Urheber, Kommentar oder
  Protokoll (Owner-Entscheid 16.08.2026). Diese Phase ändert am Frontend **nichts**.
- ⚠️ **`html/editor-handbuch.html` NICHT anfassen** (AGENTS §9). Es gehört einer nächtlichen Routine.
  Deine Pflicht ist ein **Commit-Betreff, der den sichtbaren Effekt nennt** — „der Karten-Dialog
  bekommt ein Urheber-Feld", nicht „Refactoring".
- ⚠️ **Designsprache (AGENTS §12):** Formularfelder in der bestehenden Gruppe, kein neuer Rahmen.
  Keine hartkodierte Farbe, kein Radius, kein Trenner — nur Token aus `css/base/tokens.css`. Keine
  Schrift unter **11px**. „Hochladen" bleibt die einzige gefüllte Schaltfläche eines Dialogs; alles in
  einer Listenzeile ist weich/outline.
- ⚠️ **Kein `?v=` von Hand** für alles, was von `index.html` oder `html/*.html` erreichbar ist — der
  Deploy stempelt. 💣 **Die eine Ausnahme:** ändert eine Aufgabe `css/pages/edit.css`, muss das
  hand­geschriebene `?v=` in `edit/index.php` mit (AGENTS §7 Regel 3; der Stamper erreicht keine
  `.php`-Seite).
- 🔴 **Diese Phase ändert keine Gates und keine Daten.**

---

## 💣 Die Falle, an der diese Phase still scheitern kann

**Phase 2 hat elf Spalten angelegt, die bis heute niemand liest.** Belegt:

```bash
grep -rn "cover_license\|cover_author\|cover_note\|cover_uploaded\|license_author\|_uploaded_by\|_uploaded_at" \
  api/ js/ --include=*.php --include=*.js | grep -v "__tests__" | grep -v "migration"
```

Erwartet heute: **nur die zwei DDL-Stellen**. Phase 4 ist die erste, die sie liest — und genau da
liegt die Falle: Die DDL läuft per self-healing, aber nur wenn jemand die Schema-Funktion aufruft.
Ein `SELECT`, der eine noch nicht angelegte Spalte nennt, fällt in sein `try/catch` und liefert eine
**leere Liste** — ein stiller Live-Ausfall, der wie „keine Daten" aussieht.

**Regel für jede Aufgabe dieser Phase:** Jeder erweiterte `SELECT` bekommt einen Rückfall, oder du
belegst im Bericht, dass die Schema-Funktion garantiert vor dem Lesen läuft. Nenne im Bericht, welchen
Weg du gewählt hast und warum.

---

## Dateien dieser Phase

| Datei | Verantwortung |
|---|---|
| `js/ui/media-license-fields.js` | **neu** — der eine Markup-Bauer für alle fünf Dialoge |
| `js/ui/__tests__/media-license-fields.test.js` | **neu** — sichert Form und Katalogtreue |
| `html/citymap-editor.html` | Karten-Dialog (hat Lizenz + Notiz, braucht `cc_by`, Urheber, Protokoll) |
| `html/wiki-sync-settlement-editor.html` | Siedlungsbilder **und** Wappen-Upload |
| `html/wiki-sync-monitor.html` | Territoriums-Wappen (zwei Radios → Auswahlfeld) |
| `html/game-literature-editor.html` | Cover (hat gar nichts) |
| `api/edit/wiki/settlement-coat-upload.php` | nimmt erstmals eine Lizenz entgegen |
| `api/edit/map/game-literature-cover.php` | dito |
| `api/_internal/wiki/sync-monitor-identity.php` | die zwei Erlaubnislisten lesen den Katalog |
| `api/_internal/app/citymaps.php` | Lesepfad um die sechs neuen Spalten |
| `api/_internal/app/game-literature.php` | Lesepfad um die fünf `cover_*` |

---

## Aufgabe 1: Der eine Markup-Bauer

🔴 **Die wichtigste Aufgabe der Phase — und die einzige Gelegenheit, es richtig zu machen.** Fünf
Dialoge, die dasselbe zeigen, sind fünf Abschriften, sobald jemand die erste kopiert. Das Haus hat
diese Rechnung schon bezahlt: die Listenzeile stand in **sieben** Rezepturen, eine davon mit dem
Kommentar „Referenz .se-row" über sich, und beim Abschreiben fiel die Schriftgröße unter die
11px-Grenze (AGENTS §11). Das wiederholen wir nicht.

**Dateien:**
- Neu: `js/ui/media-license-fields.js`
- Test: `js/ui/__tests__/media-license-fields.test.js`

**Schnittstellen:**
- Verbraucht: `AVESMAPS_MEDIA_LICENSES`, `avesmapsMediaLicenseNormalize`,
  `AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE` aus `js/app/media-licenses.js` (Phase 1, live).
- Liefert:
  - `avesmapsMediaLicenseFieldsMarkup(werte, optionen)` → `string`
    · `werte`: `{license, author, note, uploaded_by, uploaded_at}` (alle optional)
    · `optionen`: `{prefix, vorgabe, mitNotiz}` — `prefix` benennt die `data-`Attribute je Fläche,
      `vorgabe` die Katalog-Kennung für einen leeren Wert, `mitNotiz` schaltet das Kommentarfeld zu
  - `avesmapsMediaLicenseProtokollZeile(uploadedBy, uploadedAt)` → `string`
  - `avesmapsMediaLicenseNoteVorschlag(license, aktuelleNotiz)` → `string`

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Datei `js/ui/__tests__/media-license-fields.test.js`:

```js
// Der EINE Markup-Bauer der fünf Lizenz-Dialoge.
//
// 💣 WARUM ES DIESEN TEST GIBT: fünf Oberflächen zeigen dieselbe Reihe. Sobald eine davon ihr Markup
// selbst schreibt, laufen sie auseinander -- das Haus hat das mit der Listenzeile in SIEBEN
// Rezepturen bezahlt, und beim Abschreiben fiel die Schriftgröße unter die 11px-Grenze (AGENTS §11).
// Dieser Test hält fest, dass es EINEN Bauer gibt und er den Katalog liest statt einer Abschrift.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/ui/__tests__/media-license-fields.test.js

const assert = require("assert");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const katalog = require(path.join(ROOT, "js", "app", "media-licenses.js"));
const bauer = require(path.join(ROOT, "js", "ui", "media-license-fields.js"));

// ---- alle sieben Werte stehen im Auswahlfeld, in der Reihenfolge des Katalogs -----------------------
const markup = bauer.avesmapsMediaLicenseFieldsMarkup({}, { prefix: "cm", vorgabe: "unknown_other" });
const werteImMarkup = [...markup.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(
	werteImMarkup,
	katalog.AVESMAPS_MEDIA_LICENSES.map((e) => e.value),
	"Auswahlfeld weicht vom Katalog ab -- Werte oder Reihenfolge"
);

// Die Beschriftungen kommen ebenfalls aus dem Katalog, nicht aus einer Abschrift.
for (const eintrag of katalog.AVESMAPS_MEDIA_LICENSES) {
	assert.ok(markup.includes(">" + eintrag.label + "<"), "Beschriftung fehlt: " + eintrag.label);
}

// ---- die Vorgabe je Fläche greift -------------------------------------------------------------------
// Jede Fläche bringt ihre eigene mit (Entwurf §7): Karten unknown_other, Bilder und Siedlungs-Wappen
// ai_generated, Territoriums-Wappen public_domain, Cover permission_granted.
const mitVorgabe = bauer.avesmapsMediaLicenseFieldsMarkup({}, { prefix: "img", vorgabe: "ai_generated" });
assert.ok(/<option value="ai_generated"[^>]*\sselected/.test(mitVorgabe), "Vorgabe nicht vorausgewählt");
const mitWert = bauer.avesmapsMediaLicenseFieldsMarkup({ license: "cc0" }, { prefix: "img", vorgabe: "ai_generated" });
assert.ok(/<option value="cc0"[^>]*\sselected/.test(mitWert), "gespeicherter Wert schlägt die Vorgabe nicht");

// ---- die stillen Werte sind gekennzeichnet, aber wählbar --------------------------------------------
// 🔴 "nicht angezeigt" heißt NICHT "nicht wählbar": der Editor trägt die Angabe vollständig ein, nur
// die Veröffentlichung unterbleibt. Ein disabled-Attribut wäre der falsche Schluss.
assert.ok(!/<option value="cc_by"[^>]*disabled/.test(markup), "cc_by darf nicht gesperrt sein");
assert.ok(!/<option value="unknown_other"[^>]*disabled/.test(markup), "unknown_other darf nicht gesperrt sein");

// ---- der prefix trennt die Flächen -------------------------------------------------------------------
assert.ok(markup.includes('data-cm-license'), "prefix nicht in den data-Attributen");
assert.ok(mitVorgabe.includes('data-img-license'), "prefix nicht in den data-Attributen");

// ---- Urheber-Feld: immer da, bei JEDEM Wert ----------------------------------------------------------
// Owner 16.08.2026: "Bei allen soll die Möglichkeit gegeben sein den Urheber einzutragen."
assert.ok(markup.includes("data-cm-author"), "Urheber-Feld fehlt");
const mitUrheber = bauer.avesmapsMediaLicenseFieldsMarkup({ author: "Ulisses" }, { prefix: "cm", vorgabe: "unknown_other" });
assert.ok(mitUrheber.includes('value="Ulisses"'), "Urheber-Wert wird nicht übernommen");

// ---- Kommentarfeld ist zuschaltbar --------------------------------------------------------------------
assert.ok(!markup.includes("data-cm-note"), "ohne mitNotiz darf kein Kommentarfeld erscheinen");
const mitNotiz = bauer.avesmapsMediaLicenseFieldsMarkup({}, { prefix: "cm", vorgabe: "unknown_other", mitNotiz: true });
assert.ok(mitNotiz.includes("data-cm-note"), "mitNotiz schaltet das Kommentarfeld nicht zu");

// ---- Maskierung ---------------------------------------------------------------------------------------
const boese = bauer.avesmapsMediaLicenseFieldsMarkup(
	{ author: '"><script>alert(1)</script>', note: "<b>x</b>" },
	{ prefix: "cm", vorgabe: "unknown_other", mitNotiz: true }
);
assert.ok(!boese.includes("<script>"), "Urheber wird nicht maskiert");
assert.ok(!boese.includes("<b>x</b>"), "Kommentar wird nicht maskiert");

// ---- die Protokollzeile ---------------------------------------------------------------------------------
assert.strictEqual(bauer.avesmapsMediaLicenseProtokollZeile("", ""), "", "ohne Daten keine Zeile");
const protokoll = bauer.avesmapsMediaLicenseProtokollZeile("Alrik", "2026-08-16 14:54:17");
assert.ok(protokoll.includes("Alrik") && protokoll.includes("16.08.2026"), "Protokollzeile unvollständig");
// ⚠️ Leer heißt leer -- kein erfundener Name (Phase 2 hat ihn genau deshalb offengelassen).
const nurDatum = bauer.avesmapsMediaLicenseProtokollZeile("", "2026-08-16 14:54:17");
assert.ok(nurDatum.includes("16.08.2026") && nurDatum.includes("unbekannt"), "fehlender Name muss 'unbekannt' heißen");

// ---- der Vorschlagstext bei "Genehmigung erteilt" ---------------------------------------------------------
// 💣 NUR in ein LEERES Feld, nie über einen vorhandenen Text.
assert.strictEqual(
	bauer.avesmapsMediaLicenseNoteVorschlag("permission_granted", ""),
	katalog.AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE
);
assert.strictEqual(bauer.avesmapsMediaLicenseNoteVorschlag("permission_granted", "  "), katalog.AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE);
assert.strictEqual(bauer.avesmapsMediaLicenseNoteVorschlag("permission_granted", "schon was"), "schon was");
assert.strictEqual(bauer.avesmapsMediaLicenseNoteVorschlag("cc0", ""), "", "nur bei permission_granted");

// ---- 💣 keine hartkodierte Farbe, kein Radius, keine Schrift unter 11px (AGENTS §12) ------------------------
const fs = require("fs");
const quelle = fs.readFileSync(path.join(ROOT, "js", "ui", "media-license-fields.js"), "utf8");
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(quelle), "hartkodierter Farbwert im Markup-Bauer");
const groessen = [...quelle.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
for (const g of groessen) {
	assert.ok(g >= 11, "Schriftgröße " + g + "px liegt unter der 11px-Grenze");
}

console.log("media-license-fields: OK (" + werteImMarkup.length + " Werte aus dem Katalog)");
```

- [ ] **Schritt 2: Test laufen lassen und den Fehlschlag sehen**

```bash
node js/ui/__tests__/media-license-fields.test.js
```

Erwartet: **Fehlschlag** mit `Cannot find module` für `js/ui/media-license-fields.js`.

- [ ] **Schritt 3: Den Bauer schreiben**

Datei `js/ui/media-license-fields.js`. Das Gerüst steht hier vollständig; **die drei Markup-Blöcke
bleiben bewusst offen**, weil sie sich an die umgebenden Dialoge anlehnen müssen und eine hier
erfundene Form nur eine Vermutung wäre. Lies zuerst die zwei Vorbilder:

```bash
grep -n -A 8 "function ceSelect" html/citymap-editor.html
grep -n -B 2 -A 12 "dt-img-license\${im.license" html/wiki-sync-settlement-editor.html
```

```js
// Der EINE Markup-Bauer der fünf Lizenz-Dialoge.
//
// 💣 Fünf Oberflächen zeigen dieselbe Reihe -- Lizenz, Urheber, Kommentar, darunter das Protokoll.
// Sobald eine davon ihr Markup selbst schreibt, laufen sie auseinander. Das Haus hat das mit der
// Listenzeile in SIEBEN Rezepturen bezahlt, eine davon mit dem Kommentar "Referenz .se-row" über
// sich, und beim Abschreiben fiel die Schriftgröße unter die 11px-Grenze (AGENTS §11).
//
// Die WERTE kommen aus js/app/media-licenses.js und werden hier nie abgeschrieben.

/** HTML-Maskierung -- Urheber und Kommentar sind freier Editortext. */
function avesmapsMediaLicenseEscape(wert) {
	return String(wert == null ? "" : wert)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Die Reihe für einen Dialog.
 * @param {{license?:string, author?:string, note?:string, uploaded_by?:string, uploaded_at?:string}} werte
 * @param {{prefix:string, vorgabe:string, mitNotiz?:boolean}} optionen
 */
function avesmapsMediaLicenseFieldsMarkup(werte, optionen) {
	const w = werte || {};
	const o = optionen || {};
	const prefix = String(o.prefix || "ml");
	// 🔴 Der gespeicherte Wert schlägt die Vorgabe; ein leerer oder fremder fällt auf sie zurück.
	const gewaehlt = avesmapsMediaLicenseNormalize(w.license, o.vorgabe || "unknown_other");

	const optionen_html = AVESMAPS_MEDIA_LICENSES.map(function (e) {
		// ⚠️ KEIN disabled für die stillen Werte: "wird nicht angezeigt" heißt nicht "nicht wählbar".
		// Der Editor trägt die Angabe vollständig ein, nur die Veröffentlichung unterbleibt.
		return '<option value="' + e.value + '"' + (e.value === gewaehlt ? " selected" : "") + ">"
			+ avesmapsMediaLicenseEscape(e.label) + "</option>";
	}).join("");

	// --- MARKUP 1: die Auswahlzeile (data-<prefix>-license) ---------------------------------------
	// --- MARKUP 2: die Urheber-Zeile (data-<prefix>-author), IMMER da, bei jedem Wert -------------
	// --- MARKUP 3: die Kommentar-Zeile (data-<prefix>-note), nur wenn o.mitNotiz ------------------
	// Form aus den Vorbildern übernehmen. Klassen statt style="…"; das Aussehen kommt aus CSS.
	// Darunter avesmapsMediaLicenseProtokollZeile(w.uploaded_by, w.uploaded_at).
}

/**
 * "hochgeladen von X am TT.MM.JJJJ" -- oder nichts, wenn beides fehlt.
 * ⚠️ Fehlt nur der Name, heißt er "unbekannt". Phase 2 hat ihn dort bewusst leer gelassen, wo er
 * nicht belegbar war -- ein erfundener wäre von einem echten nicht zu unterscheiden.
 */
function avesmapsMediaLicenseProtokollZeile(uploadedBy, uploadedAt) {
	const name = String(uploadedBy || "").trim();
	const zeit = String(uploadedAt || "").trim();
	if (name === "" && zeit === "") {
		return "";
	}
	// Beide Formen aus Phase 2 lesen: "2026-08-16 14:54:17" (Spalten) und "2026-08-16T14:54:17Z" (JSON).
	const t = zeit.match(/^(\d{4})-(\d{2})-(\d{2})/);
	const datum = t ? t[3] + "." + t[2] + "." + t[1] : "";
	// --- MARKUP 4: die graue Zeile ---------------------------------------------------------------
}

/**
 * Der Vorschlagstext für "Genehmigung erteilt".
 * 💣 NUR in ein leeres Feld, nie über einen vorhandenen Text -- sonst überschreibt eine
 * Lizenzänderung die Notiz, die der Editor gerade getippt hat.
 */
function avesmapsMediaLicenseNoteVorschlag(license, aktuelleNotiz) {
	if (String(aktuelleNotiz || "").trim() !== "") {
		return aktuelleNotiz;
	}

	return license === "permission_granted" ? AVESMAPS_MEDIA_LICENSE_PERMISSION_NOTE : (aktuelleNotiz || "");
}

// Node-Export (im Browser wirkungslos, dort sind es Globals der Editorseiten) -- er ist es, der den
// Test das echte Markup prüfen lässt statt einer abgetippten Kopie.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsMediaLicenseFieldsMarkup: avesmapsMediaLicenseFieldsMarkup,
		avesmapsMediaLicenseProtokollZeile: avesmapsMediaLicenseProtokollZeile,
		avesmapsMediaLicenseNoteVorschlag: avesmapsMediaLicenseNoteVorschlag,
	};
}
```

⚠️ **Im Node-Lauf sind `AVESMAPS_MEDIA_LICENSES` und `avesmapsMediaLicenseNormalize` keine Globals** —
im Browser sind sie es (die Seite lädt beide Skripte), unter `node` nicht. Löse das so, wie es das
Haus tut: ein `require` unter demselben `typeof module`-Guard am Kopf der Datei. Prüf, wie
`js/app/link-status.js` und seine Tests das handhaben, bevor du eine eigene Form erfindest.

Weitere Anforderungen, die der Test festnagelt — plus diese, die er nicht sehen kann:

- **Struktur:** eine Zeile je Angabe, im Stil der umgebenden Dialoge. Sieh dir `ceSelect` in
  `html/citymap-editor.html` und `.dt-img-license` in `html/wiki-sync-settlement-editor.html` an,
  bevor du eine dritte Form erfindest.
- **Klassen statt Stile:** der Bauer schreibt Klassennamen, das Aussehen kommt aus CSS. Kein
  `style="…"` im Markup außer für Werte, die wirklich aus den Daten kommen.
- **Maskierung ist Pflicht** — Urheber und Kommentar sind freier Editortext.
- **Der Node-Export unter dem Guard** `if (typeof module !== "undefined" && module.exports)`, wie in
  `js/app/media-licenses.js` und `js/app/link-status.js`.

⚠️ **Die vier Editorseiten binden `js/app/media-licenses.js` noch NICHT ein** — Phase 1 hat bewusst
keinen Aufrufer umgestellt. Prüf das und trag beide Skripte in jeder Seite nach, die sie braucht:

```bash
grep -n "media-licenses.js\|media-license-fields.js" html/*.html
```

- [ ] **Schritt 4: Test grün, dann committen**

```bash
node js/ui/__tests__/media-license-fields.test.js
git add js/ui/media-license-fields.js js/ui/__tests__/media-license-fields.test.js
git commit -m "feat(lizenzen): ein Markup-Bauer fuer alle fuenf Lizenz-Dialoge"
```

---

## Aufgabe 2: Der Karten-Dialog

Der kleinste Eingriff — die Fläche hat Lizenz und Notiz bereits, nur in ihrer eigenen Liste.

**Dateien:** `html/citymap-editor.html` · `api/_internal/app/citymaps.php` · ggf. `api/edit/map/citymap-image.php`

- [ ] **Schritt 1: Den Bestand lesen**

```bash
grep -n -A 10 "const LICENSES = " html/citymap-editor.html
grep -n -B 4 -A 12 "ceSelect(\"Lizenz\"" html/citymap-editor.html
grep -n "map_license" api/_internal/app/citymaps.php | head
```

- [ ] **Schritt 2: Die lokale `LICENSES`-Liste durch den Katalog ersetzen**

💣 **Die lokale Liste wird gelöscht, nicht ergänzt.** Sie ist die Abschrift, die dieser ganze Umbau
beendet — ihr eigener Kommentar (Zeile ~616) sagt es bereits: „not a fourth independent list". Wer
`cc_by` dort einträgt, hat den Punkt verfehlt.

⚠️ Zeile ~637 und ~978 lesen `LICENSES.find(...)` für die Anzeige des gespeicherten Werts — beide
gehen auf `avesmapsMediaLicenseLabel()` aus dem Katalog.

- [ ] **Schritt 3: Urheber und Protokollzeile ergänzen**

Über `avesmapsMediaLicenseFieldsMarkup` mit `prefix: "cm"`, `vorgabe: "unknown_other"`,
`mitNotiz: true`. Das vorhandene Notizfeld (`map_license_note` / `thumb_license_note`) bleibt sein
Feld — der Bauer schreibt es, der Name ändert sich nicht.

- [ ] **Schritt 4: 💣 Den Lesepfad erweitern — mit Rückfall**

Der `SELECT` bei `api/_internal/app/citymaps.php:894` listet die Spalten einzeln auf. Die sechs neuen
kommen dazu. **Vorher lesen, dann erweitern**, und den Rückfall aus der Falle oben beachten.

- [ ] **Schritt 5: Speichern prüfen**

Nimmt `api/edit/map/citymap-image.php` (oder der Karten-Speicherpfad) die neuen Felder entgegen? Prüf
es und erweitere, was fehlt:

```bash
grep -n "license_note\|_POST\|readJsonRequest" api/edit/map/citymap-image.php | head
```

- [ ] **Schritt 6: Testfeld und Commit**

```bash
git add html/citymap-editor.html api/_internal/app/citymaps.php
git commit -m "ui(lizenzen): der Karten-Dialog bekommt Urheber-Feld und Hochlade-Protokoll"
```

---

## Aufgabe 3: Die Siedlungsbilder

**Dateien:** `html/wiki-sync-settlement-editor.html` · `api/edit/wiki/settlement-images.php`

- [ ] **Schritt 1: Bestand lesen**

```bash
grep -n -A 8 "SETTLEMENT_IMAGE_LICENSE_OPTIONS" html/wiki-sync-settlement-editor.html
grep -n "AVESMAPS_SETTLEMENT_IMAGE_LICENSES" api/edit/wiki/settlement-images.php
```

- [ ] **Schritt 2: Die lokale Liste durch den Katalog ersetzen**

Serverseitig ebenso: `AVESMAPS_SETTLEMENT_IMAGE_LICENSES` (vier Werte) weicht dem Katalog.
⚠️ **Die Vorgabe bleibt `ai_generated`** — Legacy-Einträge sind blanke URL-Strings und zählten seit
je so (`api/app/map-features.php:408`).

- [ ] **Schritt 3: 💣 Den Hinweistext korrigieren — er wird sachlich falsch**

`html/wiki-sync-settlement-editor.html:1549` sagt heute:

> „Wir verwenden auch **keine Bilder mit Namensnennung** oder unter sonstigen Lizenzen (CC, GNU, …)."

Verwendet werden sie weiterhin nicht — aber **hinterlegen** lassen sie sich künftig. Zieh den Text
nach, ohne die Warnung zu verwässern: erlaubt sind weiterhin nur die fünf öffentlichen Einstufungen;
`cc_by` und „Unbekannt/Sonstiges" werden gespeichert und **nicht angezeigt**.

- [ ] **Schritt 4: Urheber und Protokoll je Bild**

Die Werte liegen im `properties_json` neben `license` und `note` (Phase 2 schreibt sie dorthin) —
keine DDL. `avesmapsSettlementImageNormalizeLicense` und die `set_meta`-Aktion müssen `author`
mitnehmen.

- [ ] **Schritt 5: Testfeld und Commit**

```bash
git commit -m "ui(lizenzen): Siedlungsbilder bekommen alle sieben Einstufungen, Urheber und Protokoll"
```

---

## Aufgabe 4: Das Siedlungs-Wappen

Die Fläche, die bisher **gar keine Wahl** hatte — der Endpunkt schrieb `'own'` fest.

**Dateien:** `html/wiki-sync-settlement-editor.html` (Modal ab Zeile ~332) ·
`api/edit/wiki/settlement-coat-upload.php`

- [ ] **Schritt 1: Bestand lesen**

```bash
grep -n -B 3 -A 20 "Eigenes Wappen hochladen" html/wiki-sync-settlement-editor.html
grep -n "license_status\|_POST\[" api/edit/wiki/settlement-coat-upload.php
```

- [ ] **Schritt 2: Der Dialog bekommt die Reihe**

`avesmapsMediaLicenseFieldsMarkup` mit `prefix: "coat"`, `vorgabe: "ai_generated"`, `mitNotiz: true`.

⚠️ Die Vorgabe ist `ai_generated`, weil genau das der Bestand ist: die Editoren haben ihre Wappen mit
KI erzeugt (Owner 16.08.2026), und Phase 2 hat `'own'` deshalb dorthin zugeordnet.

- [ ] **Schritt 3: 🔴 Der Endpunkt nimmt die Lizenz entgegen**

`api/edit/wiki/settlement-coat-upload.php:98` schreibt heute:

```php
$props['coat'] = ['url' => $url, 'source' => 'own', 'license_status' => 'own'];
```

Künftig kommen `license_status`, `author` und `note` aus dem Formular, durch
`avesmapsMediaLicenseNormalize($_POST['license'] ?? null, 'ai_generated')` gefiltert.

💣 **`source` bleibt `'own'` und wird NICHT zur Lizenz.** Es sagt, **woher** das Bild kam, nicht unter
welcher Lizenz — und `avesmapsWikiSettlementSyncCoats` (`settlements.php:408`) entscheidet an ihm, ob
ein Wiki-Abgleich ein eigenes Wappen überschreiben darf. Wer die beiden verschmilzt, lässt den Sync
eigene Uploads überschreiben.

💣 **`uploaded_by` und `uploaded_at` setzt der Endpunkt selbst**, nicht das Formular — sonst wäre der
Nachweis fälschbar. Der Benutzer steht in `$user` (die `avesmapsRequireUserWithCapability`-Rückgabe),
die Zeit ist `gmdate('Y-m-d\TH:i:s\Z')` für JSON-Flächen (so hält es Phase 2).

- [ ] **Schritt 4: Der Editor zeigt, was gespeichert ist**

`avesmapsWikiSettlementCoatInfo` (`api/_internal/wiki/settlements.php:462`) liefert die Wappendaten an
den Editor — die neuen Felder müssen mit.

- [ ] **Schritt 5: Testfeld und Commit**

```bash
git commit -m "ui(lizenzen): der Wappen-Upload fragt erstmals nach Lizenz, Urheber und Kommentar"
```

---

## Aufgabe 5: Das Territoriums-Wappen

**Dateien:** `html/wiki-sync-monitor.html` (Modal ab ~Zeile 332, Radios 341-343) ·
`api/_internal/wiki/sync-monitor-identity.php`

- [ ] **Schritt 1: Bestand lesen**

```bash
grep -n -B 6 -A 14 "Unter welcher Lizenz" html/wiki-sync-monitor.html
grep -n "licName\|attribution_required" html/wiki-sync-monitor.html
grep -n "attribution_required" api/_internal/wiki/sync-monitor-identity.php
```

- [ ] **Schritt 2: Zwei Radios werden ein Auswahlfeld**

`avesmapsMediaLicenseFieldsMarkup` mit `prefix: "wp"`, `vorgabe: "public_domain"`, `mitNotiz: true`.
Das vorhandene Urheber-Feld (`coat_of_arms_author`) geht im Bauer auf.

⚠️ **`licName()` (Zeile ~744) und die Statuszeile (~765) kennen nur zwei Werte** und übersetzen
`attribution_required` zu „Namensnennung nötig". Beide gehen auf `avesmapsMediaLicenseLabel()`.

💣 **Das Inline-JS dieser Seite und von `wiki-sync-settlement-editor.html` trägt
`attribution_required` an mehreren Stellen** (Statuslabel, Farbpunkt, Formularvalidierung) — Phase 2
hat sie bewusst stehen lassen. Jetzt gehen sie mit. Prüfbefehl:

```bash
grep -n "attribution_required" html/wiki-sync-monitor.html html/wiki-sync-settlement-editor.html
```

- [ ] **Schritt 3: Die zwei serverseitigen Erlaubnislisten lesen den Katalog**

`avesmapsWikiSyncMonitorUploadCoat` (~Zeile 318) und `avesmapsWikiSyncMonitorApplyCoatsPreview`
(~Zeile 946) tragen `['public_domain', 'attribution_required', 'cc_by']`. Beide werden zu
`avesmapsMediaLicenseIsPublic()` bzw. — beim Upload — zu „ist eine Katalog-Kennung".

⚠️ **Der Upload akzeptiert alle sieben**, auch die stillen: ein Editor darf ein CC-BY-Wappen
hinterlegen, es wird nur nicht gezeigt. Die Apply-Vorschau dagegen fragt nach **öffentlich**, denn
sie entscheidet, ob ein Wappen auf die Karte kommt. Die zwei Listen sahen gleich aus und meinen
Verschiedenes — verwechsle sie nicht.

- [ ] **Schritt 4: Testfeld und Commit**

```bash
git commit -m "ui(lizenzen): der Territoriums-Wappen-Dialog bekommt alle sieben Einstufungen statt zwei"
```

---

## Aufgabe 6: Das Literatur-Cover

Die zweite Fläche ohne jede Lizenzangabe.

**Dateien:** `html/game-literature-editor.html` (~Zeile 1042) · `api/edit/map/game-literature-cover.php` ·
`api/_internal/app/game-literature.php`

- [ ] **Schritt 1: Bestand lesen**

```bash
grep -n -B 6 -A 12 "Eigenes Cover laden" html/game-literature-editor.html
grep -n "_POST\[\|cover_url" api/edit/map/game-literature-cover.php | head
grep -n "cover_url" api/_internal/app/game-literature.php | head
```

- [ ] **Schritt 2: Der Dialog bekommt die Reihe**

`prefix: "cover"`, `vorgabe: "permission_granted"`, `mitNotiz: true`.

⚠️ Die Vorgabe ist `permission_granted`, weil das der Bestand ist: Phase 2 hat alle Cover so
eingestuft, die aus dem Wiki gezogenen mit dem Urheber „Ulisses" (Ulisses-Fanrichtlinien, NOTICE.md).

- [ ] **Schritt 3: Endpunkt und Lesepfad**

Der Upload-Endpunkt nimmt Lizenz, Urheber und Kommentar entgegen und setzt `cover_uploaded_by` /
`cover_uploaded_at` **selbst** (nicht aus dem Formular). 💣 Der Lesepfad in
`api/_internal/app/game-literature.php` muss die fünf `cover_*`-Spalten liefern — mit dem Rückfall
aus der Falle oben.

⚠️ **Nur der Editor-Lesepfad**, nicht der öffentliche: die Angaben verlassen die Oberfläche nicht.
Prüf, welcher der beiden du erweiterst, und schreib es in den Bericht.

- [ ] **Schritt 4: Testfeld und Commit**

```bash
git commit -m "ui(lizenzen): der Cover-Dialog bekommt Lizenz, Urheber und Kommentar"
```

---

## Aufgabe 7: Abschluss

- [ ] **Schritt 1: Die Abhakliste**

- [ ] **eine** Markup-Quelle — keine Fläche schreibt ihr Auswahlfeld selbst
- [ ] keine lokale Lizenzliste mehr im Haus (`grep -rn "public_domain" html/ js/ | grep -v media-licenses`)
- [ ] `attribution_required` nur noch dort, wo es einen Altwert entgegennimmt
- [ ] Urheber-Feld bei **allen** sieben Werten eintragbar
- [ ] Vorschlagstext nur in ein leeres Kommentarfeld
- [ ] `uploaded_by`/`uploaded_at` immer serverseitig, nie aus dem Formular
- [ ] jeder erweiterte `SELECT` mit Rückfall oder belegter Schema-Garantie
- [ ] keine hartkodierte Farbe, keine Schrift unter 11px
- [ ] kein `?v=` von Hand — außer `edit/index.php`, falls `edit.css` angefasst wurde
- [ ] `html/editor-handbuch.html` **nicht** angefasst; jeder Commit-Betreff nennt den sichtbaren Effekt

- [ ] **Schritt 2: Die zwei Prüf-Subagenten**

⭐ Vor dem Push (AGENTS §9): **`usability-konsistenz`** (Entwurf gegen Diff, gekoppelte Werte) und
**`usability-design`** (gebauter Zustand gegen Designsprache, in hell **und** dunkel). Sie ersetzen
die Abhakliste nicht, sie fangen, was man selbst überliest.

- [ ] **Schritt 3: Das ganze Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null || echo "ROT: $t"; done
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null 2>&1 || echo "ROT: $t"; done
```

- [ ] **Schritt 4: Push**

⚠️ Fremde Arbeit im Baum → separater Arbeitsbaum, `cherry-pick`, dort testen, `push origin HEAD:master`.
Fremde ungepushte Commits werden nicht mitgenommen.

- [ ] **Schritt 5: 🔧 DU (Owner): die fünf Handgriffe**

💣 **Abnahme heißt ABLAUF, nicht Maß** (AGENTS §9). Eine Prüfseite, die Felder zählt, belegt nichts.
Die fünf echten Handgriffe, einer je Dialog:

1. Stadtkarte öffnen → Lizenz auf „Genehmigung erteilt" → **der Kommentar füllt sich vor** → Urheber
   eintragen → speichern → neu laden → steht es noch da?
2. Siedlungsbild → „CC-BY" wählen → speichern → **das Bild verschwindet aus der Karte**, bleibt aber
   im Editor sichtbar
3. Wappen hochladen → Lizenz wählen → nach dem Speichern zeigt der Dialog „hochgeladen von DIR am heute"
4. Territoriums-Wappen → die frühere Radio-Wahl ist jetzt ein Auswahlfeld mit sieben Einträgen
5. Cover → Lizenz eintragen → speichern → neu laden

⚠️ Was ein Emulator nicht beantworten kann, wird als offene Frage gemeldet, nicht als bestanden.

---

## Was diese Phase ausdrücklich NICHT tut

- **Keine Daten**, keine DDL, kein Migrationslauf.
- **Kein Gate** wird gebaut oder geändert (Phase 3).
- **Das Frontend ändert sich nicht** — Lizenz, Urheber, Kommentar und Protokoll bleiben im Editor.
- **`html/editor-handbuch.html`** bleibt unangetastet; die nächtliche Routine zieht nach.
