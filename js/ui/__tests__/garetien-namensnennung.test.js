// Die Namensnennung der uebernommenen Kartendaten -- CC BY-NC-SA 3.0 verlangt sie, und sie ist
// die Bedingung dafuer, dass ueberhaupt etwas importiert werden darf.
//
// 🔴 Owner 27.08.2026, woertlich: „VolkoV / garetien.de" fuer die Inhalte aus Garetien und
// „VolkoV / koschwiki.de".
//
// 💣 SIE HAENGT AM WIRT, NICHT AM source_type. Beide Wikis tragen denselben Typ (`garetien`) --
// derselbe Import, dieselbe Hand, dieselbe Lizenz; verschieden ist nur der Name, der genannt
// werden muss. Ein zweiter source_type dafuer waere eine zweite Whitelist im Schreibpfad, ein
// zweiter Renderer-Zweig und beim naechsten Wiki ein dritter.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/garetien-namensnennung.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const markup = require(path.join(wurzel, "js", "ui", "feature-source-markup.js"));
const attribution = markup.featureSourceGaretienAttribution;

let pruefungen = 0;

// ---- A. Der Wirt entscheidet, und nur er ---------------------------------------------------
assert.strictEqual(
  attribution("https://www.garetien.de/index.php?title=Garetien:Blutmoor"),
  "VolkoV / garetien.de",
);
assert.strictEqual(
  attribution("https://www.koschwiki.de/index.php?title=Kosch:Bodrin"),
  "VolkoV / koschwiki.de",
);
// Ohne www -- dieselbe Seite, derselbe Name.
assert.strictEqual(attribution("https://garetien.de/x"), "VolkoV / garetien.de");
assert.strictEqual(attribution("https://koschwiki.de/x"), "VolkoV / koschwiki.de");
pruefungen += 4;

// ---- B. Alles andere bekommt NICHTS ---------------------------------------------------------
// ⚠️ Ein unbekannter Wirt gibt "" zurueck und KEINEN Rueckfall auf einen der beiden Namen. Eine
// geratene Namensnennung ist schlimmer als keine: sie schreibt einem Menschen eine Arbeit zu, die
// er nicht gemacht hat.
assert.strictEqual(attribution("https://de.wiki-aventurica.de/wiki/Gareth"), "");
assert.strictEqual(attribution(""), "");
assert.strictEqual(attribution(null), "");
assert.strictEqual(attribution("nonsense"), "");
// 🪤 Und eine Adresse, die den Wirt nur ENTHAELT, ist keine Adresse dieses Wirts. Ein Vergleich
// per "kommt vor" haette hier zugeschlagen und einer fremden Seite unsere Namensnennung verpasst.
assert.strictEqual(attribution("https://evil.example/?x=www.garetien.de"), "");
assert.strictEqual(attribution("https://garetien.de.evil.example/x"), "");
pruefungen += 6;

// ---- C. Sie steht am EINZELNEN Eintrag, mit Lizenzlink --------------------------------------
// 💣 Nicht unter der Zeile. Dieselbe Regel wie beim Wiki-Aventurica-Hinweis: eine Fussnote unter
// der ganzen Quellenzeile behauptete die Lizenz auch fuer alles andere, was dort steht.
// ⚠️ Der Typ ist `briefspiel` -- garetien.de IST eines, und die Namensnennung haengt trotzdem
// dran. Das ist die Probe auf die Regel: sie folgt dem WIRT, nicht dem Typ. Mit einem eigenen
// source_type waere sie an einer Whitelist gehangen, die jede neue Quelle nachtragen muss.
const html = markup.buildSourceListMarkup("", [
  { label: "Briefspiel (Garetien)", url: "https://www.garetien.de/index.php?title=Garetien:Blutmoor", type: "briefspiel" },
  { label: "Aventurischer Bote 42", url: "https://example.org/bote", type: "aventurischer_bote" },
]);
assert.ok(html.includes("VolkoV / garetien.de, CC BY-NC-SA 3.0"), "die Namensnennung steht da");
assert.ok(html.includes(markup.FEATURE_SOURCE_GARETIEN_LICENSE_URL), "und der Lizenzhinweis ist verlinkt");
pruefungen += 2;

// 🔴 Und sie steht NUR an der Garetien-Quelle. Der Bote daneben traegt sie nicht -- er hat mit
// dieser Lizenz nichts zu tun. 💣 Beide tragen hier verschiedene Typen, aber das entscheidet
// NICHTS: ein zweites Briefspiel von einem anderen Wirt bekaeme ebenfalls keine.
const vorBote = html.indexOf("Aventurischer Bote 42");
const nachBote = html.slice(vorBote);
assert.ok(!nachBote.includes("CC BY-NC-SA"), "die fremde Quelle traegt die Lizenz nicht");
pruefungen++;

// Eine Liste ganz ohne Garetien-Quelle nennt die Lizenz nirgends -- auch dann nicht, wenn ein
// FREMDES Briefspiel darin steht. Live gibt es 96 Briefspiel-Quellen; 94 davon haben mit dieser
// Lizenz nichts zu tun ("Albernisches Briefspiel", "AlmadaWiki", "Briefspiel (Weiden)").
const ohne = markup.buildSourceListMarkup("", [
  { label: "Aventurischer Bote 42", url: "https://example.org/bote", type: "aventurischer_bote" },
  { label: "Briefspiel (Weiden)", url: "https://www.herzogtum-weiden.net/politik/liste-bn/baronien/hzgl-altentrallop", type: "briefspiel" },
]);
assert.ok(!ohne.includes("CC BY-NC-SA"), "ein fremdes Briefspiel bekommt die Lizenz NICHT");
pruefungen++;

// ---- D. Und der Absatz im Fenster „Hinweise" steht in BEIDEN Sprachen -----------------------
// ⚠️ Der Absatz ist die Sammelangabe; die Zeile in der Infobox ist die Einzelnennung. Beides
// verlangt die Lizenz, und beides muss unter ?lang=en lesbar bleiben (AGENTS.md §8).
const indexHtml = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const i18nEn = fs.readFileSync(path.join(wurzel, "js", "app", "i18n-en.js"), "utf8");

assert.ok(indexHtml.includes('data-i18n="legal.garetien.body"'), "der Absatz steht im Fenster");
assert.ok(indexHtml.includes("CC BY-NC-SA 3.0"), "die Lizenz steht beim Namen");
assert.ok(indexHtml.includes("VolkoV"), "und der Urheber wird genannt");
assert.ok(i18nEn.includes('"legal.garetien.body"'), "auch in der englischen Fassung");
assert.ok(i18nEn.includes("CC BY-NC-SA 3.0"), "dort ebenfalls mit Lizenz");
assert.ok(i18nEn.includes("VolkoV"), "und mit Urheber");
pruefungen += 6;

// 🔴 Die Genehmigung wird beim Namen genannt -- sie ist der Grund, warum die Uebernahme ueberhaupt
// zulaessig ist, und ohne sie liest der Absatz sich wie eine Selbstermaechtigung.
assert.ok(
  indexHtml.includes("Freundeskreis") && indexHtml.includes("12.08.2026"),
  "die Genehmigung samt Datum steht im Absatz",
);
pruefungen++;

// ---- E. Die Datei ist die EINE Stelle --------------------------------------------------------
// 💣 Dieselbe Regel wie bei der Seitenkuerzung darueber: die Namensnennung darf nicht ein zweites
// Mal irgendwo nachgebaut werden. Gesucht wird die DEFINITION, nicht der Name.
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
const definitionen = dateien.filter((f) =>
  /function\s+featureSourceGaretienAttribution\s*\(/.test(fs.readFileSync(f, "utf8")),
);
assert.strictEqual(definitionen.length, 1, "genau eine Definition: " + definitionen.join(", "));
// Und niemand BAUT den Namen ein zweites Mal, also niemand setzt ihn aus Bausteinen zusammen.
// ⚠️ Die Sprachtabelle ist ausgenommen, und das ist kein Schlupfloch: dort steht der Name im
// FLIESSTEXT des Hinweis-Absatzes ("attribution is provided by ..."), er wird nicht gerendert.
// Ein Test, der das mitzaehlt, verbietet, die Regel aufzuschreiben -- dieselbe Falle wie ein
// Quelltexttest, der Kommentare mitliest.
const fremde = dateien.filter((f) => {
  if (f.endsWith("feature-source-markup.js") || f.endsWith("i18n-en.js")) { return false; }
  return /["'`]VolkoV \/ (garetien|koschwiki)/.test(fs.readFileSync(f, "utf8"));
});
assert.strictEqual(fremde.length, 0, "die Namensnennung wird nirgends abgeschrieben: " + fremde.join(", "));
pruefungen += 2;

console.log("OK: " + pruefungen + " Pruefungen");
