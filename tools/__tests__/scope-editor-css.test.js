// Der Territoriumseditor und seine erzeugte Stilvorlage.
//
// 💣 Der Anlass: `css/pages/political-territory-editor-inline.css` ist ein BAUPRODUKT
// (`tools/scope_editor_css.js` erzeugt es aus den drei Quelldateien). Dreimal wurde eine
// neue Regel direkt in das Bauprodukt geschrieben -- die Hierarchie-Level-Tabelle
// (e5cb8f1b), die Transparenz-Zeile (127a7c78) und der Wiki-Sync-Knopf (5fa1f323).
// Jede davon wirkte sofort und sah richtig aus. Beim naechsten Neuerzeugen (0bc22ffc)
// waren alle vierzehn Regeln weg, lautlos, ohne Fehler und ohne Zeile im Diff, die
// „hier verschwindet Gestaltung" gesagt haette. Sichtbar wurde es erst zwei Wochen
// spaeter am Farbwaehler, der rechts aus seinem Kasten stand.
//
// 🔴 Test A ist der eigentliche Riegel: er haette bei der HAND-Aenderung rot gezeigt,
// nicht erst beim Verlust. Test B faengt die Folge -- eine Klasse im Markup ohne jede
// Regel. Was B NICHT beweist: dass die Regel das Richtige tut. Das misst nur ein
// Browser (Breite der Sektion gegen Breite des Farbwaehlers), siehe Fundstelle.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/__tests__/scope-editor-css.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const GENERATED = path.join(ROOT, "css", "pages", "political-territory-editor-inline.css");
const EDITOR_HTML = path.join(ROOT, "html", "political-territory-editor.html");

// ---- A: Das Bauprodukt steht auf seinen Quellen -----------------------------------------------
//
// Erzeugen in eine Kopie des Baums waere teuer; stattdessen wird die echte Datei gesichert,
// der Erzeuger laufen gelassen und danach zurueckgeschrieben. Faellt der Test aus, bleibt die
// erzeugte Fassung stehen -- das ist genau die, die eingecheckt gehoert.
{
	const before = fs.readFileSync(GENERATED, "utf8");
	const backup = path.join(os.tmpdir(), "political-territory-editor-inline.css.bak");
	fs.writeFileSync(backup, before, "utf8");

	execFileSync(process.execPath, [path.join(ROOT, "tools", "scope_editor_css.js")], { cwd: ROOT });
	const after = fs.readFileSync(GENERATED, "utf8");

	if (after !== before) {
		fs.writeFileSync(GENERATED, before, "utf8"); // Baum unveraendert lassen, der Test meldet nur
	}
	assert.strictEqual(
		after,
		before,
		"css/pages/political-territory-editor-inline.css weicht von tools/scope_editor_css.js ab.\n" +
		"    Entweder wurde das Bauprodukt von Hand bearbeitet (dann gehoert die Regel in die\n" +
		"    Quelldatei css/pages/political-territory-editor*.css), oder eine Quelle wurde ohne\n" +
		"    `node tools/scope_editor_css.js` geaendert. Beides verliert beim naechsten Lauf."
	);
}

// ---- B: Keine Klasse im Markup ohne jede Regel -------------------------------------------------
//
// Gesucht wird ueber ALLE Stilvorlagen plus den <style>-Block der Seite -- eine Klasse darf
// woanders gestaltet werden, nur nirgends darf sie sein.
{
	const html = fs.readFileSync(EDITOR_HTML, "utf8");

	const used = new Set();
	for (const match of html.matchAll(/class="([^"]+)"/g)) {
		for (const name of match[1].split(/\s+/)) if (name) used.add(name);
	}
	// Der Wiki-Sync-Knopf entsteht erst im Javascript (js/territory/territory-editor-embedded.js)
	// und faellt durch das Markup-Raster -- er ist beim selben Neuerzeugen mitgestorben.
	used.add("info-origin-link");

	let css = "";
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".css")) css += fs.readFileSync(full, "utf8");
		}
	};
	walk(path.join(ROOT, "css"));
	for (const match of html.matchAll(/<style>([\s\S]*?)<\/style>/g)) css += match[1];

	const styled = new Set();
	for (const match of css.matchAll(/\.([A-Za-z0-9_-]+)/g)) styled.add(match[1]);

	// Diese fuenf tragen bewusst keine Regel: Haken fuer Javascript bzw. Elemente, die ihre
	// paar Werte im style-Attribut mitbringen. Wer hier etwas eintraegt, entscheidet das
	// bewusst -- und genau darum ist die Liste kurz und namentlich.
	const DELIBERATELY_UNSTYLED = new Set([
		"contested-list",            // Behaelter, den contested-row fuellt
		"inherit-opacity-button",    // erbt .secondary
		"manual-data-panel",         // Haken fuer die Sichtbarkeitssteuerung
		"manual-data-warning",       // traegt style="..." im Markup
		"territory-claim-banner__text",
	]);

	const missing = [...used].filter((name) => !styled.has(name) && !DELIBERATELY_UNSTYLED.has(name)).sort();
	assert.deepStrictEqual(
		missing,
		[],
		"Klassen im Territoriumseditor ohne jede CSS-Regel: " + missing.join(", ") +
		"\n    Entweder fehlt die Gestaltung (siehe Test A), oder sie gehoert bewusst in\n" +
		"    DELIBERATELY_UNSTYLED -- aber nicht stillschweigend nirgendwo."
	);
}

// ---- C: Die zwei Eigenschaften, an denen der Kasten haengt -------------------------------------
//
// 💣 `table-layout: fixed` + `width: 100%` sind hier TRAGEND, nicht Kosmetik. Ohne sie bestimmt
// der Inhalt die sechs Spaltenbreiten; die Mindestbreite der Tabelle (gemessen: 428px) steigt
// ueber die Spalte der Sektion (340px). Weil die Sektion ein Grid ist und Grid-Elemente
// `min-width: auto` haben, zieht die Tabelle die ganze Spalte auf 428 -- und der Farbwaehler
// darueber, der `width: 100%` hat, steht 88px rechts aus dem Panel heraus.
{
	const generated = fs.readFileSync(GENERATED, "utf8");
	const block = generated.match(/\.variance-levels-table \{([^}]*)\}/);
	assert.ok(block, ".variance-levels-table hat keine Regel");
	assert.match(block[1], /table-layout:\s*fixed/, "ohne table-layout: fixed sprengt die Tabelle ihre Spalte");
	assert.match(block[1], /width:\s*100%/, "ohne width: 100% waechst die Tabelle ueber die Spalte hinaus");

	// 💣 Und die Regel muss auch GEWINNEN. css/components/political-territory-editor-columns.css
	// setzt `.manual-data-section table { table-layout: auto }` und wird spaeter geladen -- bei
	// gleicher Spezifitaet gewinnt sie. Beim ersten Versuch stand `table-layout: fixed` genau so
	// in der Datei, und der Browser meldete trotzdem `auto`: die Zusicherung oben allein haette
	// gruen gezeigt und nichts bewiesen. Also wird hier die Spezifitaet mitgemessen.
	const mineHasSection = /(#political-territory-editor-host [^{]*\.manual-data-section[^{]*)\.variance-levels-table \{/.test(generated);
	assert.ok(
		mineHasSection,
		".variance-levels-table muss ueber .manual-data-section adressiert werden, sonst schlaegt\n" +
		"    das `table-layout: auto` aus political-territory-editor-columns.css die Regel tot."
	);

	const columns = fs.readFileSync(
		path.join(ROOT, "css", "components", "political-territory-editor-columns.css"), "utf8");
	assert.match(
		columns, /\.manual-data-section table \{/,
		"Die Gegenregel ist weg -- dann darf der Abschnitt oben aus dem Selektor verschwinden\n" +
		"    (und dieser Test mit ihm). Solange sie steht, ist er tragend."
	);
}

console.log("scope-editor-css: alle Zusicherungen erfuellt");
