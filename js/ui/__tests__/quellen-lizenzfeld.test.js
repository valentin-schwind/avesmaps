// Die Lizenz einer Quelle und wen sie nennt -- ZWEI Felder, weil CC zwei getrennte Dinge
// verlangt: WAS gilt und WEN man nennt (Owner 27.08.2026: „quellen fehlt das lizenz-feld").
//
// 💣 SIE SIND DATEN, NICHT CODE. Bis zum selben Tag stand im Renderer eine Wirt-Tabelle:
// garetien.de -> „VolkoV / garetien.de, CC BY-NC-SA 3.0", fest verdrahtet. Das war fuer zwei
// Wirte richtig und beim dritten falsch -- jede weitere Quelle haette eine Zeile im Renderer
// gebraucht, und der Editor haette die Lizenz nirgends eintragen koennen.
//
// 🔴 LEER HEISST „NICHT ERFASST", NIE „KEINE LIZENZ". Die 1694 vorhandenen Quellen starten leer
// und zeigen wie bisher nichts. Wer „keine freie Lizenz" sagen will, sagt es mit dem Schluessel
// `unfree`. Die beiden gleichzusetzen waere eine Rechtsaussage, die niemand getroffen hat.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/quellen-lizenzfeld.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const markup = require(path.join(wurzel, "js", "ui", "feature-source-markup.js"));
const lizenz = markup.featureSourceLicenseText;

let pruefungen = 0;

// ---- A. Die beiden Felder, einzeln und zusammen ----------------------------------------------
assert.deepStrictEqual(
  lizenz({ license: "cc-by-nc-sa-3.0", attribution: "VolkoV / garetien.de" }),
  { text: "VolkoV / garetien.de, CC BY-NC-SA 3.0", url: "https://creativecommons.org/licenses/by-nc-sa/3.0/deed.de" },
);
// Nur die Lizenz -- eine Quelle darf gemeinfrei sein, ohne dass jemand zu nennen waere.
assert.strictEqual(lizenz({ license: "cc-by-sa-3.0" }).text, "CC BY-SA 3.0");
// Nur die Namensnennung -- und das ist kein halber Zustand, sondern ein gueltiger: wer genannt
// werden will, muss nicht auch eine Lizenz eingetragen haben.
assert.strictEqual(lizenz({ attribution: "Volker Strunk" }).text, "Volker Strunk");
pruefungen += 3;

// ---- B. Leer ist leer, und ein unbekannter Schluessel wird NICHT geraten ----------------------
assert.strictEqual(lizenz({}).text, "", "ohne Eintrag steht nichts da");
assert.strictEqual(lizenz({ license: "", attribution: "" }).text, "");
assert.strictEqual(lizenz(null).text, "");
// 🪤 Ein Tippfehler im Schluessel gibt "" -- und NICHT die erste Lizenz der Liste. Eine geratene
// Lizenz ist eine Rechtsaussage, die niemand getroffen hat.
assert.strictEqual(lizenz({ license: "cc-by-nc-sa-3" }).text, "");
assert.strictEqual(lizenz({ license: "erfunden" }).text, "");
pruefungen += 5;

// 🔴 „Keine freie Lizenz" IST eine Aussage und wird angezeigt -- der Unterschied zu leer.
assert.strictEqual(lizenz({ license: "unfree" }).text, "Keine freie Lizenz");
assert.strictEqual(lizenz({ license: "unfree" }).url, "", "und sie hat nichts zu verlinken");
assert.strictEqual(lizenz({ license: "public-domain" }).url, "", "gemeinfrei ebenso");
pruefungen += 3;

// ---- C. Im Markup: am EINZELNEN Eintrag, nie unter der Zeile ----------------------------------
// 💣 Dieselbe Regel wie beim Wiki-Aventurica-Hinweis: eine Fussnote unter der ganzen Quellenzeile
// behauptete die Lizenz auch fuer alles andere, was dort steht.
const html = markup.buildSourceListMarkup("", [
  {
    label: "Briefspiel (Garetien)",
    url: "https://www.garetien.de/index.php?title=Garetien:Blutmoor",
    type: "briefspiel",
    license: "cc-by-nc-sa-3.0",
    attribution: "VolkoV / garetien.de",
  },
  // ⚠️ Ein FREMDES Briefspiel ohne Eintrag -- live gibt es 96 Briefspiel-Quellen, und 94 davon
  // haben mit dieser Lizenz nichts zu tun. Die Kategorie entscheidet nichts.
  { label: "Briefspiel (Weiden)", url: "https://www.herzogtum-weiden.net/x", type: "briefspiel" },
]);
assert.ok(html.includes("VolkoV / garetien.de, CC BY-NC-SA 3.0"), "die Angabe steht da");
assert.ok(html.includes("creativecommons.org/licenses/by-nc-sa/3.0"), "und ist verlinkt");
const abWeiden = html.slice(html.indexOf("Briefspiel (Weiden)"));
assert.ok(!abWeiden.includes("CC BY"), "die Quelle ohne Eintrag traegt nichts");
pruefungen += 3;

// 🔴 Ohne Adresse ein <span>, kein Link ins Leere.
const ohneLink = markup.buildSourceListMarkup("", [
  { label: "Irgendwas", url: "https://example.org/x", type: "sonstiges", license: "unfree" },
]);
assert.ok(ohneLink.includes('<span class="fs-src-lic'), "gemeinfrei/unfrei rendern als span");
assert.ok(!/<a[^>]*fs-src-lic/.test(ohneLink), "und nicht als Link");
pruefungen += 2;

// 🔴 Und ein Eintrag MIT Angabe wird zusammengehalten. Die Angabe ist lang genug, um umzubrechen
// -- und dann stand sie im Browser gemessen (27.08.2026) in einer Zeile mit der NAECHSTEN Quelle:
// „VolkoV / garetien.de, CC BY-NC-SA 3.0 · Kosch:Bodrin". Wer das liest, haengt die Lizenz an das
// falsche Stueck, und damit ist die Namensnennung nicht erfuellt, sondern irrefuehrend.
assert.ok(html.includes('<span class="fs-src-item">'), "der Eintrag mit Angabe ist eine Einheit");
assert.ok(html.includes("fs-src-lic--attrib"), "und die Angabe darf umbrechen");
pruefungen += 2;

// ---- D. Der Absatz im Fenster „Hinweise" steht in BEIDEN Sprachen ----------------------------
// ⚠️ Der Absatz ist die Sammelangabe; die Zeile in der Infobox ist die Einzelnennung. Beides
// verlangt die Lizenz, und beides muss unter ?lang=en lesbar bleiben (AGENTS.md §8).
const indexHtml = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const i18nEn = fs.readFileSync(path.join(wurzel, "js", "app", "i18n-en.js"), "utf8");
assert.ok(indexHtml.includes('data-i18n="legal.garetien.body"'), "der Absatz steht im Fenster");
assert.ok(indexHtml.includes("CC BY-NC-SA 3.0") && indexHtml.includes("VolkoV"), "mit Lizenz und Urheber");
assert.ok(i18nEn.includes('"legal.garetien.body"'), "auch in der englischen Fassung");
assert.ok(i18nEn.includes("CC BY-NC-SA 3.0") && i18nEn.includes("VolkoV"), "dort ebenfalls");
// 🔴 Die Genehmigung wird beim Namen genannt -- ohne sie liest der Absatz sich wie eine
// Selbstermaechtigung.
assert.ok(indexHtml.includes("Freundeskreis") && indexHtml.includes("12.08.2026"), "samt Genehmigung");
pruefungen += 5;

// ---- E. EINE Tafel, EIN Erzeuger -------------------------------------------------------------
// 💣 Dieselbe Regel wie bei der Seitenkuerzung: die Lizenztafel darf nicht ein zweites Mal
// nachgebaut werden. Der Editor holt sie ueber einen Weiterreicher, der LAUT wirft, wenn die
// Datei fehlt -- ein stiller Rueckfall waere ein Auswahlfeld ohne Auswahl, und niemand saehe,
// dass die Datei fehlt: er saehe nur, dass es keine Lizenzen gibt.
const dateien = [];
const sammle = (dir) => {
  for (const eintrag of fs.readdirSync(dir, { withFileTypes: true })) {
    const voll = path.join(dir, eintrag.name);
    if (eintrag.isDirectory()) {
      if (eintrag.name === "third-party" || eintrag.name === "__tests__") { continue; }
      sammle(voll);
    } else if (eintrag.name.endsWith(".js")) {
      dateien.push(voll);
    }
  }
};
sammle(path.join(wurzel, "js"));
const definitionen = dateien.filter((f) => /var\s+FEATURE_SOURCE_LICENSES\s*=/.test(fs.readFileSync(f, "utf8")));
assert.strictEqual(definitionen.length, 1, "genau eine Tafel: " + definitionen.join(", "));
const editor = fs.readFileSync(path.join(wurzel, "js", "review", "review-feature-sources.js"), "utf8");
assert.ok(editor.includes("featureSourceLicenseTable"), "der Editor holt sie ueber den Weiterreicher");
assert.ok(/throw new Error\([^)]*Lizenztafel/.test(editor), "und wirft laut, wenn sie fehlt");
pruefungen += 3;

// 🔴 Und der Editor kann sie ueberhaupt eintragen -- ohne das Feld waere die Spalte Zierde, und
// nur der Import koennte sie fuellen.
assert.ok(editor.includes("fs-add-license"), "das Auswahlfeld steht in der Eingabezeile");
assert.ok(editor.includes("fs-add-attribution"), "und das Feld fuer die Namensnennung");
assert.ok(/license:\s*String\(/.test(editor) && /attribution:\s*String\(/.test(editor),
  "beide werden beim Absenden auch GELESEN -- ein Feld, das niemand ausliest, ist Zierde");
assert.ok(editor.includes('fs-row__license'), "und die Zeile zeigt an, was gesetzt ist");
pruefungen += 4;


// ---- F. Zelle und Spaltenvorlage wandern GEMEINSAM -------------------------------------------
// 💣 Das Raster liegt JE ZEILE mit derselben Vorlage, und `.fs-row` und `.fs-col-heads` tragen
// dieselbe -- eine zweite liefe beim ersten geaenderten Mass auseinander. Wer eine Zelle
// hinzufuegt, ohne die Vorlagen zu verbreitern, schiebt das ✕ aus dem Raster und alles rechts
// vom neuen Feld eine Spalte nach links. Genau das ist beim Bau passiert (27.08.2026): die
// Lizenzzelle war da, die Vorlage kannte fuenf Spalten.
const css = fs.readFileSync(path.join(wurzel, "css", "features", "feature-sources.css"), "utf8");
const editorJs = fs.readFileSync(path.join(wurzel, "js", "review", "review-feature-sources.js"), "utf8");

// Wie viele Zellen baut eine Zeile, und wie viele Ueberschriften stehen darueber?
const zeilenBlock = editorJs.slice(
  editorJs.indexOf("function renderFeatureSourceRow"),
  editorJs.indexOf("function", editorJs.indexOf("function renderFeatureSourceRow") + 10),
);
// 🪤 Gezaehlt werden VERSCHIEDENE Zellenklassen, nicht Vorkommen: eine Zelle mit leerem
// Rueckfall steht zweimal im Quelltext (`x ? '<span class="a">…' : '<span class="a"></span>'`),
// und die erste Fassung dieser Zaehlung kam so auf 9 statt 6.
const zellen = new Set(
  [...zeilenBlock.matchAll(/class="(fs-row__[a-z]+)"/g)].map((t) => t[1]),
).size;
const kopfBlock = editorJs.slice(
  editorJs.indexOf("function renderFeatureSourceColumnHeads"),
  editorJs.indexOf("function renderFeatureSourceWikiAutoGroup"),
);
const koepfe = (kopfBlock.match(/kopf\(|<span><\/span>/g) || []).length;
assert.strictEqual(zellen, koepfe, "so viele Zellen wie Ueberschriften: " + zellen + " gegen " + koepfe);
pruefungen++;

// Und die Vorlage nennt genauso viele Spalten -- an BEIDEN Stellen, mit demselben Mass.
const vorlagen = [...css.matchAll(/grid-template-columns:\s*minmax\(0, 1fr\)([^;]*);/g)].map((t) => t[0]);
const breit = vorlagen.filter((v) => !v.includes("74px 22px;") || v.includes("104px"));
assert.ok(breit.length >= 2, "Zeile und Ueberschrift tragen je eine Vorlage");
assert.strictEqual(new Set(breit).size, 1, "und es ist DIESELBE: " + breit.join(" | "));
const spalten = breit[0].split(/\s+/).filter((t) => /px|1fr\)/.test(t)).length;
assert.strictEqual(spalten, zellen, "die Vorlage nennt so viele Spalten wie die Zeile Zellen hat: "
  + spalten + " gegen " + zellen);
pruefungen += 3;

console.log("OK: " + pruefungen + " Pruefungen");
