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
