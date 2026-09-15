// DAS DEPLOY-TOR FAEHRT PARALLEL -- und darf dabei weder still schrumpfen noch wackeln.
//
// 🔴 Seit dem 15.09.2026 faehrt `.github/scripts/run-tests-parallel.sh` die Testdateien des Deploys
//    nebeneinander statt nacheinander (rund 4 von 5 Minuten eines Deploys waren der serielle Lauf).
//    Ein schnelleres Tor ist nur dann eines, wenn es dasselbe misst. Dieser Test FAEHRT das Skript
//    gegen Attrappen-Tests und haelt fest:
//      A. rot bleibt rot, gruen wird gezaehlt, und php laeuft mit zend.assertions=1
//      B. zwei Tests, die sich eine Datei teilen: rot im Verbund, gruen allein -> Warnung, kein Abbruch
//      C. jeder Test hat sein EIGENES Temp-Verzeichnis, und es ist danach weg
//      D. eine leere Liste ist rot
//      E. der Workflow ruft das Skript, und seine find-Muster liefern ALLE Testdateien -- die Klammer
//         um beide Gruppen ist tragend (AGENTS.md §9: ohne sie liefen 21 von 312 Dateien, „null rot")
//
// ⚠️ B und C brauchen Ueberlappung: die Attrappen warten mit grossem Rand (Sekunden, nicht Millisekunden),
//    damit ein langsamer Prozessstart unter Last die Probe nicht ins Leere laufen laesst.
//
// Aus der Wurzel des Repos:  node tools/__tests__/tor-parallel.test.js

"use strict";

const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..");
const SKRIPT = path.join(WURZEL, ".github/scripts/run-tests-parallel.sh").replace(/\\/g, "/");
const WORKFLOW = path.join(WURZEL, ".github/workflows/deploy-avesmaps-strato.yml");

// Unter Windows ist ein blankes `bash` womoeglich das von WSL; Git Bash ist die Umgebung, in der das
// Tor hier lokal laeuft.
function bashPfad() {
	if (process.platform !== "win32") { return "bash"; }
	const git = "C:\\Program Files\\Git\\bin\\bash.exe";
	return fs.existsSync(git) ? git : "bash";
}
const BASH = bashPfad();

const bau = fs.mkdtempSync(path.join(os.tmpdir(), "tor-parallel-"));
const SCHLAF = "const schlafe = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);\n";

function attrappe(name, inhalt) {
	fs.writeFileSync(path.join(bau, name), inhalt);
	return name;
}

// Das Skript bekommt ein eigenes Temp-Verzeichnis, und danach muss es LEER sein: ein Tor, das bei
// jedem Deploy seine Werkstatt (Liste, Protokolle, 900 Test-Verzeichnisse) liegen laesst, faellt auf
// dem Runner nicht auf -- lokal fuellt es /tmp.
const skriptTmp = path.join(bau, "skript-tmp");
fs.mkdirSync(skriptTmp);

function lauf(dateien, jobs) {
	const r = cp.spawnSync(BASH, [SKRIPT], {
		cwd: bau,
		input: dateien.map((d) => d + "\0").join(""),
		encoding: "utf8",
		timeout: 120000,
		env: Object.assign({}, process.env, {
			AVESMAPS_TEST_JOBS: String(jobs),
			TMPDIR: skriptTmp.replace(/\\/g, "/"),
		}),
	});
	const aus = (r.stdout || "") + (r.stderr || "") + (r.error ? String(r.error) : "");
	assert.deepStrictEqual(fs.readdirSync(skriptTmp), [], "das Skript raeumt seine Werkstatt weg:\n" + aus);
	return { code: r.status, aus };
}

// ---- A. Rot bleibt rot, gruen wird gezaehlt ---------------------------------------------------------
{
	const dateien = [
		attrappe("gruen.test.js", "console.log('ok');\n"),
		attrappe("rot.test.js", "console.error('ROT-MARKE-4711'); process.exit(1);\n"),
		// Beweist nebenbei, dass das Skript php MIT zend.assertions=1 startet -- ohne das ist jeder
		// PHP-Test gruen und beweist nichts.
		attrappe("assertions-test.php", "<?php\nif (ini_get('zend.assertions') !== '1') { fwrite(STDERR, \"assertions aus\\n\"); exit(3); }\necho \"ok\\n\";\n"),
	];
	const r = lauf(dateien, 3);
	assert.strictEqual(r.code, 1, "ein roter Test macht das Tor rot:\n" + r.aus);
	assert.ok(/::error file=rot\.test\.js::JS test failed/.test(r.aus), "der rote Test wird mit Namen gemeldet:\n" + r.aus);
	assert.ok(r.aus.includes("ROT-MARKE-4711"), "seine Ausgabe steht im Protokoll:\n" + r.aus);
	assert.ok(/PHP 1 green, JS 1 green \(3 Dateien/.test(r.aus),
		"gruen wird je Sprache gezaehlt, und php lief mit Assertions:\n" + r.aus);
	assert.ok(!/::warning/.test(r.aus), "ein auch allein roter Test ist KEINE Warnung:\n" + r.aus);
	assert.ok(/::error title=Tests failed::/.test(r.aus), "und die Sammelmeldung sagt, dass nichts hochgeladen wird");
}

// ---- B. Geteilte Datei: rot im Verbund, gruen allein -> Warnung, Deploy laeuft ----------------------
{
	const dateien = [
		attrappe("halter.test.js", SCHLAF +
			"const fs = require('fs');\nfs.writeFileSync('sperre', 'x');\nschlafe(4000);\nfs.unlinkSync('sperre');\n"),
		attrappe("pruefer.test.js", SCHLAF +
			"const fs = require('fs');\nschlafe(1500);\nif (fs.existsSync('sperre')) { console.error('SPERRE-BELEGT'); process.exit(1); }\n"),
	];
	const r = lauf(dateien, 2);
	assert.ok(r.aus.includes("SPERRE-BELEGT"),
		"Vorbedingung: die zwei Attrappen haben sich wirklich ueberlappt -- sonst misst B nichts:\n" + r.aus);
	assert.strictEqual(r.code, 0, "rot im Verbund, gruen allein haelt den Deploy NICHT auf:\n" + r.aus);
	assert.ok(/::warning file=pruefer\.test\.js,title=Nur allein gruen::/.test(r.aus),
		"aber der Test wird mit Namen als nicht parallel-sicher gemeldet:\n" + r.aus);
	assert.ok(/JS 2 green .*davon 1 erst allein gruen/.test(r.aus), "und die Zusammenfassung zaehlt ihn:\n" + r.aus);
	assert.ok(!/::error/.test(r.aus), "kein Fehler:\n" + r.aus);
}

// ---- C. Jeder Test hat sein eigenes Temp-Verzeichnis ------------------------------------------------
{
	const tmpTest = (name) => SCHLAF +
		"const fs = require('fs'), os = require('os'), path = require('path');\n" +
		"const d = os.tmpdir();\n" +
		"fs.writeFileSync(path.join(process.cwd(), '" + name + ".tmpdir'), d);\n" +
		"const f = path.join(d, 'geteilt.txt');\n" +
		"fs.writeFileSync(f, '" + name + "');\n" +
		"schlafe(2500);\n" +
		"if (fs.readFileSync(f, 'utf8') !== '" + name + "') { console.error('TMP-GETEILT'); process.exit(1); }\n";
	const dateien = [
		attrappe("tmp-a.test.js", tmpTest("tmp-a")),
		attrappe("tmp-b.test.js", tmpTest("tmp-b")),
		attrappe("tmp-c-test.php", "<?php\nfile_put_contents(getcwd() . '/tmp-c.tmpdir', sys_get_temp_dir());\n"),
	];
	const r = lauf(dateien, 3);
	assert.strictEqual(r.code, 0, "drei Tests mit demselben Dateinamen im Temp-Verzeichnis sind gruen:\n" + r.aus);
	assert.ok(!r.aus.includes("TMP-GETEILT") && !/::warning/.test(r.aus),
		"und zwar schon im Parallellauf, nicht erst im Nachlauf -- sonst teilen sie sich /tmp:\n" + r.aus);
	const verzeichnisse = ["tmp-a", "tmp-b", "tmp-c"].map((n) => fs.readFileSync(path.join(bau, n + ".tmpdir"), "utf8"));
	assert.strictEqual(new Set(verzeichnisse).size, 3, "jeder Test hatte ein eigenes Temp-Verzeichnis: " + verzeichnisse.join(" | "));
	verzeichnisse.forEach((v) => {
		assert.notStrictEqual(path.resolve(v), path.resolve(os.tmpdir()), "nicht das gemeinsame: " + v);
		assert.ok(!fs.existsSync(v), "und es ist nach dem Lauf weggeraeumt: " + v);
	});
}

// ---- C2. ... und zwar gleich nach SEINEM Test, nicht erst am Ende des ganzen Laufs ------------------
// ⚠️ Am Ende raeumt ohnehin der `trap` die ganze Werkstatt -- ohne diese Probe fiele ein fehlendes
//    Aufraeumen je Test nie auf, und ueber tausend Test-Verzeichnisse blieben bis zum Schluss liegen.
//    Ein Prozess, damit die Reihenfolge feststeht.
{
	const dateien = [
		attrappe("frueh.test.js", "require('fs').writeFileSync('frueh.tmpdir', require('os').tmpdir());\n"),
		attrappe("spaet.test.js", "const fs = require('fs');\nconst d = fs.readFileSync('frueh.tmpdir', 'utf8');\n" +
			"if (fs.existsSync(d)) { console.error('NOCH-DA ' + d); process.exit(1); }\n"),
	];
	const r = lauf(dateien, 1);
	assert.strictEqual(r.code, 0, "das Temp-Verzeichnis eines Tests ist weg, sobald der Test endet:\n" + r.aus);
}

// ---- D. Eine leere Liste ist rot ---------------------------------------------------------------------
{
	const r = lauf([], 2);
	assert.notStrictEqual(r.code, 0, "ein Tor ohne eine einzige Datei ist nicht gruen:\n" + r.aus);
	assert.ok(/::error title=Tor leer::/.test(r.aus), "und sagt, warum:\n" + r.aus);
}

// ---- E. Der Workflow ruft das Skript, und seine Muster liefern ALLE Testdateien ---------------------
{
	const zeilen = fs.readFileSync(WORKFLOW, "utf8").split(/\r?\n/);
	const i = zeilen.findIndex((l) => l.includes("- name: Run the unit tests"));
	assert.ok(i >= 0, "der Testschritt steht im Workflow");
	const j = zeilen.findIndex((l, n) => n > i && /^\s*run: \|\s*$/.test(l));
	const einzug = (zeilen[j + 1].match(/^ */) || [""])[0].length;
	const skript = [];
	for (let n = j + 1; n < zeilen.length; n++) {
		const l = zeilen[n];
		if (l.trim() !== "" && (l.match(/^ */) || [""])[0].length < einzug) { break; }
		skript.push(l.slice(einzug));
	}
	const code = skript.filter((l) => !/^\s*#/.test(l)).join("\n");
	assert.ok(/\|\s*bash \.github\/scripts\/run-tests-parallel\.sh/.test(code),
		"der Testschritt reicht die Liste an das Tor-Skript:\n" + code);
	const findZeilen = code.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("find "));
	assert.strictEqual(findZeilen.length, 2, "genau zwei find-Muster (PHP und JS): " + findZeilen.join(" / "));
	findZeilen.forEach((l) => assert.ok(/-print0$/.test(l), "NUL-getrennt: " + l));

	// Gezaehlt mit dem ECHTEN find aus dem Workflow ...
	const gezaehlt = cp.spawnSync(BASH, ["-c", "{ " + findZeilen.join("; ") + "; } | tr -dc '\\0' | wc -c"], {
		cwd: WURZEL, encoding: "utf8",
	});
	const ausFind = Number(String(gezaehlt.stdout).trim());

	// ... gegen eine Zaehlung, die find nicht benutzt. Dieselben Regeln, von Hand: `-path '*__tests__*'`
	// sieht den ganzen Pfad, `-name` nur den letzten Teil.
	let erwartet = 0;
	const lauf2 = (wurzel, passt) => {
		const stapel = [wurzel];
		while (stapel.length) {
			const dir = stapel.pop();
			for (const e of fs.readdirSync(path.join(WURZEL, dir), { withFileTypes: true })) {
				const rel = dir + "/" + e.name;
				if (passt(rel, e.name)) { erwartet++; }
				if (e.isDirectory()) { stapel.push(rel); }
			}
		}
	};
	const phpPasst = (rel, name) => (rel.includes("__tests__") && name.endsWith(".php"))
		|| (name.startsWith("test-") && name.endsWith(".php") && !rel.includes("__tests__"));
	const jsPasst = (rel, name) => (rel.includes("__tests__") && name.endsWith(".test.js"))
		|| (name.startsWith("test-") && name.endsWith(".mjs") && !rel.includes("__tests__"));
	["api", "tools"].forEach((w) => lauf2(w, phpPasst));
	["js", "tools"].forEach((w) => lauf2(w, jsPasst));

	assert.ok(erwartet > 500, "Vorbedingung: die Handzaehlung findet das Testfeld (" + erwartet + ")");
	assert.strictEqual(ausFind, erwartet,
		"die find-Muster des Workflows liefern " + ausFind + " Dateien, es gibt aber " + erwartet +
		" -- fehlt die Klammer um BEIDE Gruppen, bindet -print0 nur an die zweite (AGENTS.md §9).\n" + gezaehlt.stderr);
}

fs.rmSync(bau, { recursive: true, force: true });
console.log("tor-parallel: alle Zusicherungen gruen");
