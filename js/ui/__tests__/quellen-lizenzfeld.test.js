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
assert.ok(html.includes("VolkoV / garetien.de"), "die Namensnennung steht da");
assert.ok(html.includes("CC BY-NC-SA 3.0"), "die Lizenzbeschriftung steht da");
assert.ok(html.includes("creativecommons.org/licenses/by-nc-sa/3.0"), "und ist verlinkt");
const abWeiden = html.slice(html.indexOf("Briefspiel (Weiden)"));
assert.ok(!abWeiden.includes("CC BY"), "die Quelle ohne Eintrag traegt nichts");
pruefungen += 4;

// 🔴 MELDUNG (30.08.2026): NAMENSNENNUNG UND LIZENZ ZEIGEN AUF ZWEI VERSCHIEDENE ZIELE. Bis dahin
// klebte hier EIN Text zusammen und der GANZE Text zeigte auf die Lizenzadresse -- ein Klick auf
// "VolkoV / garetien.de" landete beim CC-Lizenztext, nicht beim Urheber. Jetzt ist die
// Namensnennung reiner Text, und NUR die Lizenzbeschriftung ist verlinkt.
assert.ok(/<span class="fs-src-lic fs-src-lic--attrib">VolkoV \/ garetien\.de<\/span>/.test(html),
  "die Namensnennung steht als eigener, unverlinkter Text");
const lizenzLink = html.match(/<a class="fs-src-lic fs-src-lic--attrib" href="[^"]*creativecommons[^"]*"[^>]*>([\s\S]*?)<\/a>/);
assert.ok(lizenzLink, "die Lizenz ist eigens verlinkt");
assert.ok(!lizenzLink[1].includes("VolkoV"), "der Lizenzlink nennt NICHT auch den Urheber");
assert.ok(lizenzLink[1].includes("CC BY-NC-SA 3.0"), "sondern nur die Lizenzbeschriftung");
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
// ⭐ SEIT DEM 01.09.2026 TRAEGT DAS EINE ANDERE BAUFORM: jede Quelle steht in ihrem eigenen
// <li>, die Trennung ist also die Zeile selbst und nicht mehr ein `inline-block`-Kniff
// (`fs-src-item`). Die ZUSICHERUNG ist dieselbe geblieben und wird hier weiter geprueft -- nur
// eben am neuen Mechanismus. Ein geloeschter Test waere eine aufgegebene Zusicherung.
assert.ok(html.includes('<ul class="fs-src-list">'), "die Quellen stehen in einer Liste");
const zeilen = html.match(/<li><span class="fs-src-row">/g) || [];
assert.ok(zeilen.length >= 2, "je Quelle eine eigene Zeile");
assert.ok(html.includes("fs-src-lic--attrib"), "und die Angabe darf umbrechen");
// 💣 Die Angabe muss INNERHALB ihrer Zeile stehen -- genau das war der Fehler vom 27.08.2026.
const ersteZeile = html.slice(html.indexOf('<li><span class="fs-src-row">'), html.indexOf("</li>"));
assert.ok(ersteZeile.includes("fs-src-lic"), "die Angabe steht in der Zeile ihrer Quelle");
pruefungen += 4;

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

// ---- H. DER WEG VON DER KARTENNUTZLAST BIS IN DIE INFOBOX -------------------------------------
// 💣 DIESER ABSCHNITT IST DIE LUECKE, DIE DEN FEHLER DREI TAGE GETRAGEN HAT. Alles darueber prueft
// den REINEN Renderer -- und der war von Anfang an richtig. Auf der Karte stand die Angabe
// trotzdem nirgends, weil zwischen `sources` und dem Renderer zwei Stellen liegen, die die zwei
// Felder einfach nicht weiterreichten: der Sammler der Nutzlast (jetzt
// api/_internal/app/feature-sources.php, gewacht von quellen-lizenz-in-der-karte-test.php) und
// resolveFeatureSourceList hier. Live gemessen am 30.08.2026: 0 von 1695 Katalogeintraegen der
// Nutzlast trugen eine Lizenz.
//
// 🔴 Gefahren wird deshalb die ECHTE Kette: die zwei Funktionen aus popups.js, gefuettert mit
// einem Katalog in der Form, die api/app/map-features.php wirklich ausliefert.
const vm = require("vm");
const popupsQuelle = fs.readFileSync(path.join(wurzel, "js", "ui", "popups.js"), "utf8");
const kettenVon = popupsQuelle.indexOf("function resolveFeatureSourceList");
const kettenBis = popupsQuelle.indexOf("function locationIconMarkup");
assert.ok(kettenVon >= 0 && kettenBis > kettenVon, "die Quellenkette muss in popups.js auffindbar sein");
const kette = {
  console,
  tr: (schluessel, deutsch) => deutsch,
  WIKI_TEXT_LICENSE_URL: "https://creativecommons.org/licenses/by-sa/3.0/deed.de",
  window: {
    buildSourceListMarkup: markup.buildSourceListMarkup,
    // So sieht der Katalog aus, den map-features.php liefert: die leeren Felder FEHLEN, sie
    // stehen nicht als "" da.
    __sourceCatalog: {
      1322124: {
        url: "https://www.garetien.de/index.php?title=Avesmaps_Garetien:Eupelmunder_Moor",
        label: "Briefspiel (Garetien)", type: "briefspiel", official: false,
        license: "cc-by-nc-sa-3.0", attribution: "VolkoV / garetien.de",
      },
      7: { url: "https://ulisses.example/gf", label: "Goldene Fluegel", type: "abenteuer", official: true },
    },
    __featureSourceRefs: {
      "region:eupelmunder-moor": [{ source_id: 1322124 }],
      "settlement:gareth": [{ source_id: 7 }],
    },
  },
};
kette.globalThis = kette;
vm.createContext(kette);
vm.runInContext(popupsQuelle.slice(kettenVon, kettenBis), kette, { filename: "popups.js" });

const aufgeloest = kette.resolveFeatureSourceList("region", "eupelmunder-moor");
assert.strictEqual(aufgeloest.length, 1);
assert.strictEqual(aufgeloest[0].license, "cc-by-nc-sa-3.0",
  "resolveFeatureSourceList muss die Lizenz aus dem Katalog durchreichen");
assert.strictEqual(aufgeloest[0].attribution, "VolkoV / garetien.de",
  "und die Namensnennung -- sie gehoert zur QUELLE, nicht zur Verknuepfung");
pruefungen += 3;

// Der gemeldete Fall, bis zum fertigen Markup: die Zeile der Infobox nennt beides.
const zeile = kette.renderFeatureSourceLine("region", "eupelmunder-moor", "", "region-info-box__link");
assert.ok(zeile.includes("Briefspiel (Garetien)"), "die Quelle steht in der Zeile");
assert.ok(zeile.includes("VolkoV / garetien.de") && zeile.includes("CC BY-NC-SA 3.0"),
  "und die CC-Angabe daneben -- ohne sie ist die Namensnennung nicht erfuellt, sondern nur "
  + "unterlassen. Gerendert wurde: " + zeile);
// 🔴 MELDUNG (30.08.2026), an der ECHTEN Kette gemessen: der Lizenzlink darf den Urheber nicht
// mitnennen -- genau das war der gemeldete Fehler ("Briefspiel (Garetien) ↗" ging an den Artikel,
// aber die Namensnennung ging an den Lizenztext statt an den Urheber).
const zeilenLizenzLink = zeile.match(/<a class="fs-src-lic fs-src-lic--attrib" href="[^"]*creativecommons[^"]*"[^>]*>([\s\S]*?)<\/a>/);
assert.ok(zeilenLizenzLink, "die Lizenz ist eigens verlinkt");
assert.ok(!zeilenLizenzLink[1].includes("VolkoV"), "der Lizenzlink nennt nicht auch den Urheber");
pruefungen += 3;

// 🔴 Und eine Quelle OHNE die Felder bleibt still: leer heisst "nicht erfasst", nie "keine Lizenz".
const ohneAngabe = kette.renderFeatureSourceLine("settlement", "gareth", "", "region-info-box__link");
assert.ok(ohneAngabe.includes("Goldene Fluegel"), "sie wird trotzdem genannt");
assert.ok(!ohneAngabe.includes("fs-src-lic--attrib"),
  "aber ohne Lizenz-Fussnote -- eine leere Angabe behauptet nichts");
pruefungen += 2;

console.log("OK: " + pruefungen + " Pruefungen");
