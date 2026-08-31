#!/usr/bin/env node
// DER ABLAUF DES SCHREIBWEGS: einen Abzug wirklich gestueckelt hochladen, uebernehmen lassen
// und danach ueber den Leseendpunkt zurueckholen. Lauf:
//   node tools/svg-export/__tests__/ablage-ablauf.js
//
// 🔴 MIT ECHTER config.local.php. Der Token kommt seit 23.08.2026 von dort (Owner: „unsere
// token werden in der config.local gesammelt"); ein Test, der nur die Umgebungsvariable
// benutzt, prueft den RUECKFALL und laesst den Hauptweg ungefahren. Die Datei wird angelegt
// und am Ende restlos entfernt -- eine VORHANDENE wird nie angefasst.
//
// ⚠️ Traegt bewusst KEIN `.test.js`: startet einen `php -S` und braucht freie Ports -- das
// gehoert nicht in das Testtor des Deploys, das bei einem einzigen roten Test NICHTS hochlaedt.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const FX = require("./fixture.js");
const P = require("../abzug-pruefung.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const CONFIG = path.join(WURZEL, "api", "config.local.php");
const ABLAGE = path.join(WURZEL, "uploads", "svg-export");
const LESE_TOKEN = "lesen-" + crypto.randomBytes(12).toString("hex");
const ABLAGE_TOKEN = "ablegen-" + crypto.randomBytes(12).toString("hex");
const { freierPort } = require("./freier-port.js");
let PORT = 0;

let server = null;
let configAngelegt = false;

function ende(code) {
	if (server) { server.kill(); }
	if (configAngelegt) { try { fs.unlinkSync(CONFIG); } catch { /* schon weg */ } }
	try {
		for (const f of fs.readdirSync(ABLAGE)) { fs.unlinkSync(path.join(ABLAGE, f)); }
		fs.rmdirSync(ABLAGE);
	} catch { /* nicht da */ }
	process.exit(code);
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const sagen = (t) => console.log(t);

async function main() {
	// 🔴 Eine echte config.local.php darf dieser Test NIEMALS ueberschreiben -- dort steht die
	// Datenbank des Owners drin.
	if (fs.existsSync(CONFIG)) {
		console.error("ABBRUCH: api/config.local.php existiert bereits. Dieser Test legt eine "
			+ "eigene an und wuerde die vorhandene zerstoeren. Bitte in einem frischen "
			+ "Arbeitsbaum laufen lassen.");
		process.exit(2);
	}
	fs.writeFileSync(CONFIG, "<?php\nreturn [\n"
		+ "    'svg_export' => [\n"
		+ `        'token' => '${LESE_TOKEN}',\n`
		+ `        'deposit_token' => '${ABLAGE_TOKEN}',\n`
		+ "    ],\n];\n", "utf8");
	configAngelegt = true;

	// 💣 Kein gewuerfelter Port -- siehe freier-port.js.
	[PORT] = await freierPort(1);
	server = spawn("php", ["-S", "127.0.0.1:" + PORT, "-t", WURZEL],
		{ stdio: ["ignore", "ignore", "ignore"] });
	const lesen = "http://127.0.0.1:" + PORT + "/api/svg-export.php";
	const ablegen = "http://127.0.0.1:" + PORT + "/api/svg-export-deposit.php";
	for (let i = 0; i < 60; i += 1) {
		try { await fetch(lesen, { method: "HEAD" }); break; } catch { await warte(150); }
	}

	// Ein Abzug, gross genug fuer die Mindestgroesse (64 KB) und fuer mehrere Stuecke.
	const teile = FX.baueFixtureAbzug().parts;
	const kern = teile.join("");
	// ⚠️ Aufgeblasen ueber einen KOMMENTAR, nicht ueber wiederholte Elemente: der Inhalt muss
	// die Abnahmeliste weiterhin bestehen, und doppelte ids taeten das nicht.
	// 🔴 UEBER 2 MB, damit der Upload WIRKLICH mehrere Stuecke braucht. Mit 300 KB lief er
	// in EINEM Stueck durch -- und genau das Anhaengen ueber mehrere ANFRAGEN hinweg ist der
	// riskante Teil: jede Anfrage ist ein eigener PHP-Prozess, ein Dateihandle ueberlebt sie
	// nicht. Ein Test, der nie ein zweites Stueck schickt, prueft davon nichts.
	const fuellung = "<!-- " + "f".repeat(5 * 1024 * 1024) + " -->\n";
	const svg = kern.replace("</svg>", fuellung + "</svg>");
	const roh = Buffer.from(svg, "utf8");
	const sha = crypto.createHash("sha256").update(roh).digest("hex");
	assert.ok(roh.length > 64 * 1024, "die Probe ist gross genug fuer die Mindestgroesse");
	assert.ok(roh.length > 2 * 2 * 1024 * 1024,
		"und gross genug fuer mindestens DREI Stuecke -- sonst prueft der Upload nichts");
	assert.deepStrictEqual(P.pruefeAbzug(svg).befunde, [], "die Probe besteht die Abnahmeliste");

	const rufen = (url, opt) => fetch(url, opt);
	const mitToken = (t, extra) => Object.assign(
		{ headers: Object.assign({ Authorization: "Bearer " + t }, (extra || {}).headers || {}) },
		extra || {}, { headers: Object.assign({ Authorization: "Bearer " + t }, (extra || {}).headers || {}) });

	// ---- 1. Der LESE-Token darf NICHT schreiben ----------------------------------------
	// 🔴 Das ist die Zusicherung, wegen der es zwei Token gibt: der Lesetoken geht an fremde
	// Werkzeuge, und wer ihn hat, darf nichts ablegen.
	const fremd = await rufen(ablegen + "?action=start",
		mitToken(LESE_TOKEN, { method: "POST" }));
	assert.strictEqual(fremd.status, 401, "der Lesetoken oeffnet den Schreibweg NICHT");
	sagen(`1. Lesetoken schreibt        -> ${fremd.status} (abgewiesen)`);

	// ---- 2. Ganz ohne Token ------------------------------------------------------------
	const ohne = await rufen(ablegen + "?action=start", { method: "POST" });
	assert.strictEqual(ohne.status, 401);
	// ⚠️ GET ist hier kein erlaubtes Verb -- der Schreibweg ist POST.
	const falschesVerb = await rufen(ablegen + "?action=start",
		mitToken(ABLAGE_TOKEN, { method: "GET" }));
	assert.strictEqual(falschesVerb.status, 405);
	sagen(`2. ohne Token / GET          -> ${ohne.status} / ${falschesVerb.status}`);

	// ---- 3. Der echte, gestueckelte Upload ----------------------------------------------
	const start = await (await rufen(ablegen + "?action=start",
		mitToken(ABLAGE_TOKEN, { method: "POST" }))).json();
	assert.strictEqual(start.ok, true);
	assert.ok(/^[0-9a-f]{32}$/.test(start.upload_id), "die Kennung hat die erwartete Form");

	const STUECK = 2 * 1024 * 1024;
	let stuecke = 0;
	for (let ab = 0; ab < roh.length; ab += STUECK) {
		const antwort = await rufen(
			`${ablegen}?action=chunk&upload_id=${start.upload_id}`,
			mitToken(ABLAGE_TOKEN, { method: "POST", body: roh.subarray(ab, ab + STUECK) }));
		const j = await antwort.json();
		assert.strictEqual(antwort.status, 200, "jedes Stueck wird angenommen");
		stuecke += 1;
		assert.strictEqual(j.bytes, Math.min(ab + STUECK, roh.length),
			"der Server zaehlt mit -- sonst merkt niemand ein verlorenes Stueck");
	}

	const fertig = await (await rufen(
		`${ablegen}?action=finish&upload_id=${start.upload_id}`,
		mitToken(ABLAGE_TOKEN, { method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				dateiname: "avesmaps-karte-2026-08-23-r88513-inkscape.svg",
				dialekt: "inkscape", kartenfassung: "88513",
				landschaftsfassung: "29637", exportiert: FX.EXPORTIERT,
			}) }))).json();
	assert.strictEqual(fertig.ok, true, "die Uebernahme gelingt");
	assert.strictEqual(fertig.sha256, sha, "der Server hat GENAU diese Bytes zusammengesetzt");
	assert.strictEqual(fertig.bytes, roh.length);
	// 🔴 Die Herkunft bestimmt der Riegel: mit dem Ablage-Token ist es die Routine.
	assert.strictEqual(fertig.quelle, "routine");
	sagen(`3. Upload in ${stuecke} Stuecken     -> ok, ${(fertig.bytes / 1024).toFixed(0)} KB, `
		+ `sha stimmt, quelle=${fertig.quelle}`);

	// ---- 4. Die Sperre ist da, und zwar von PHP angelegt --------------------------------
	const sperre = path.join(ABLAGE, ".htaccess");
	assert.ok(fs.existsSync(sperre), "PHP hat die Ablage gesperrt -- ohne CI, ohne Repo-Kopie");
	assert.ok(fs.readFileSync(sperre, "utf8").includes("Require all denied"));
	sagen("4. Sperre von PHP angelegt   -> ok");

	// ---- 5. Und der Leseweg liefert genau diese Datei -----------------------------------
	const gelesen = await rufen(lesen, mitToken(LESE_TOKEN));
	assert.strictEqual(gelesen.status, 200);
	assert.strictEqual(gelesen.headers.get("etag"), '"' + sha + '"');
	assert.strictEqual(gelesen.headers.get("x-avesmaps-quelle"), "routine");
	assert.strictEqual(gelesen.headers.get("x-avesmaps-kartenfassung"), "88513");
	assert.strictEqual(gelesen.headers.get("content-disposition"),
		'attachment; filename="avesmaps-karte-2026-08-23-r88513-inkscape.svg"');
	const zurueck = Buffer.from(await gelesen.arrayBuffer());
	assert.ok(zurueck.equals(roh), "byte-identisch wieder heraus");
	sagen(`5. Leseweg liefert zurueck   -> ${gelesen.status}, byte-identisch, quelle=routine`);

	// ---- 6. Zu klein wird ABGEWIESEN, und die gute Datei bleibt stehen ------------------
	// 💣 Der wahrscheinlichste stille Fehlschlag: der Bauer baut aus leeren Endpunktantworten
	// ein gueltiges, aber leeres SVG. Es darf die gute Datei nicht ersetzen.
	const s2 = await (await rufen(ablegen + "?action=start",
		mitToken(ABLAGE_TOKEN, { method: "POST" }))).json();
	await rufen(`${ablegen}?action=chunk&upload_id=${s2.upload_id}`,
		mitToken(ABLAGE_TOKEN, { method: "POST",
			body: Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>') }));
	const winzig = await rufen(`${ablegen}?action=finish&upload_id=${s2.upload_id}`,
		mitToken(ABLAGE_TOKEN, { method: "POST",
			headers: { "Content-Type": "application/json" }, body: "{}" }));
	const winzigJson = await winzig.json();
	assert.strictEqual(winzig.status, 422);
	assert.strictEqual(winzigJson.error.code, "deposit_rejected");
	assert.ok(winzigJson.error.message.includes("klein"), "und sagt WARUM");
	const nochDa = await rufen(lesen, mitToken(LESE_TOKEN));
	assert.strictEqual(nochDa.headers.get("etag"), '"' + sha + '"',
		"der gute Abzug steht unveraendert");
	sagen(`6. Zu kleiner Abzug          -> ${winzig.status} ${winzigJson.error.code}, `
		+ "guter Abzug unberuehrt");

	// ---- 7. Kein SVG wird abgewiesen ----------------------------------------------------
	const s3 = await (await rufen(ablegen + "?action=start",
		mitToken(ABLAGE_TOKEN, { method: "POST" }))).json();
	await rufen(`${ablegen}?action=chunk&upload_id=${s3.upload_id}`,
		mitToken(ABLAGE_TOKEN, { method: "POST", body: Buffer.alloc(100000, 0x41) }));
	const keinSvg = await rufen(`${ablegen}?action=finish&upload_id=${s3.upload_id}`,
		mitToken(ABLAGE_TOKEN, { method: "POST",
			headers: { "Content-Type": "application/json" }, body: "{}" }));
	assert.strictEqual(keinSvg.status, 422);
	assert.ok((await keinSvg.json()).error.message.includes("SVG"));
	sagen("7. Kein SVG                  -> 422, abgewiesen");

	// ---- 8. Eine Kennung mit Pfad wird nie zu einem Dateinamen --------------------------
	const boese = await rufen(
		`${ablegen}?action=chunk&upload_id=${encodeURIComponent("../../../api/config.local")}`,
		mitToken(ABLAGE_TOKEN, { method: "POST", body: Buffer.from("x") }));
	assert.strictEqual(boese.status, 400, "eine Kennung mit Pfad wird abgewiesen");
	assert.ok(fs.existsSync(CONFIG), "und die Konfiguration steht unangetastet");
	sagen(`8. Kennung mit ../           -> ${boese.status}, config.local.php unberuehrt`);

	// ---- 9. Aufbewahrung: der aktuelle faellt nie ---------------------------------------
	// Zwei weitere gueltige Abzuege hinterlegen; danach duerfen hoechstens 3 dastehen und der
	// zuletzt hinterlegte MUSS dabei sein.
	let letzterSha = "";
	for (const n of [1, 2]) {
		const s = await (await rufen(ablegen + "?action=start",
			mitToken(ABLAGE_TOKEN, { method: "POST" }))).json();
		const variante = Buffer.from(svg.replace("</svg>",
			"<!-- " + "g".repeat(5 * 1024 * 1024 + n) + " --></svg>"), "utf8");
		letzterSha = crypto.createHash("sha256").update(variante).digest("hex");
		await rufen(`${ablegen}?action=chunk&upload_id=${s.upload_id}`,
			mitToken(ABLAGE_TOKEN, { method: "POST", body: variante }));
		const r = await (await rufen(`${ablegen}?action=finish&upload_id=${s.upload_id}`,
			mitToken(ABLAGE_TOKEN, { method: "POST",
				headers: { "Content-Type": "application/json" }, body: "{}" }))).json();
		assert.strictEqual(r.ok, true);
	}
	const abzuege = fs.readdirSync(ABLAGE).filter((f) => /^abzug-.*\.svg$/.test(f));
	assert.ok(abzuege.length <= 3, `hoechstens drei bleiben, gezaehlt: ${abzuege.length}`);
	assert.ok(abzuege.includes("abzug-" + letzterSha.slice(0, 16) + ".svg"),
		"der zuletzt hinterlegte ist dabei -- er faellt NIE");
	const letzte = await rufen(lesen, mitToken(LESE_TOKEN));
	assert.strictEqual(letzte.status, 200, "und der Zeiger geht nicht ins Leere");
	sagen(`9. Aufbewahrung              -> ${abzuege.length} Abzuege, der neueste steht, Leseweg ${letzte.status}`);

	// ---- 10. Die GEGLAETTETE Fassung ordnet sich SELBST ein -----------------------------
	// 🔴 DAS IST DIE REGEL DIESES SCHRITTS: der Rumpf sagt NICHT, welche Fassung das ist --
	// der Server liest `avm:geglaettet` aus dem Wurzelelement der hochgeladenen Datei.
	// Duerfte der Aufrufer es behaupten, koennte ein eckiger Handabzug in der glatten
	// Schublade landen, und `?smooth=1` lieferte Stuetzpunkt-Polygone aus.
	const glattKern = FX.baueFixtureAbzug({ glatt: true }).parts.join("");
	const glattSvg = glattKern.replace("</svg>", "<!-- " + "h".repeat(5 * 1024 * 1024) + " -->\n</svg>");
	const glattRoh = Buffer.from(glattSvg, "utf8");
	const glattSha = crypto.createHash("sha256").update(glattRoh).digest("hex");
	assert.deepStrictEqual(P.pruefeAbzug(glattSvg, false, { glatt: true }).befunde, [],
		"die glatte Probe besteht ihre Abnahmeliste");

	const sg = await (await rufen(ablegen + "?action=start",
		mitToken(ABLAGE_TOKEN, { method: "POST" }))).json();
	for (let ab = 0; ab < glattRoh.length; ab += STUECK) {
		await rufen(`${ablegen}?action=chunk&upload_id=${sg.upload_id}`,
			mitToken(ABLAGE_TOKEN, { method: "POST", body: glattRoh.subarray(ab, ab + STUECK) }));
	}
	const glattFertig = await (await rufen(`${ablegen}?action=finish&upload_id=${sg.upload_id}`,
		mitToken(ABLAGE_TOKEN, { method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				dateiname: "avesmaps-karte-2026-08-23-r88513-inkscape-glatt.svg",
				dialekt: "inkscape", kartenfassung: "88513",
				landschaftsfassung: "29637", exportiert: FX.EXPORTIERT,
				// 💣 Eine LUEGE im Rumpf -- sie darf nichts bewirken. Der Inhalt ist glatt, also
				// gehoert die Datei in die glatte Schublade, egal was hier steht.
				variante: "roh", geglaettet: "nein",
			}) }))).json();
	assert.strictEqual(glattFertig.ok, true, "die glatte Uebernahme gelingt");
	assert.strictEqual(glattFertig.variante, "glatt",
		"der SERVER ordnet nach dem Inhalt ein, nicht nach dem Rumpf");
	assert.strictEqual(glattFertig.datei, "abzug-glatt-" + glattSha.slice(0, 16) + ".svg",
		"und legt sie in den eigenen Namensraum");

	// Der Leseweg: mit Parameter die glatte, ohne die rohe -- und die rohe ist unberuehrt.
	const glattGelesen = await rufen(lesen + "?smooth=1", mitToken(LESE_TOKEN));
	assert.strictEqual(glattGelesen.status, 200);
	assert.strictEqual(glattGelesen.headers.get("x-avesmaps-variante"), "glatt");
	assert.strictEqual(glattGelesen.headers.get("x-avesmaps-sha256"), glattSha);
	assert.ok(Buffer.from(await glattGelesen.arrayBuffer()).equals(glattRoh), "byte-identisch");

	const rohNochDa = await rufen(lesen, mitToken(LESE_TOKEN));
	assert.strictEqual(rohNochDa.status, 200, "die rohe Fassung steht unberuehrt daneben");
	assert.strictEqual(rohNochDa.headers.get("x-avesmaps-variante"), "roh");
	assert.strictEqual(rohNochDa.headers.get("x-avesmaps-sha256"), letzterSha,
		"und zwar die zuletzt hinterlegte rohe -- die glatte hat den Zeiger NICHT umgebogen");

	// 💣 UND DIE AUFRAEUMUNG HAT KEINE ROHE FASSUNG MITGENOMMEN. Das `glob` sucht `abzug-*.svg`,
	// und `abzug-glatt-…` faengt genauso an -- ohne die Trennung nach Variante raeumte die eine
	// Fassung die andere weg, genau dann, wenn beide frisch hinterlegt wurden.
	const alleRoh = fs.readdirSync(ABLAGE).filter((f) => /^abzug-[0-9a-f]{16}\.svg$/.test(f));
	const alleGlatt = fs.readdirSync(ABLAGE).filter((f) => /^abzug-glatt-[0-9a-f]{16}\.svg$/.test(f));
	assert.ok(alleRoh.includes("abzug-" + letzterSha.slice(0, 16) + ".svg"),
		"die aktuelle rohe Datei liegt noch da");
	assert.strictEqual(alleGlatt.length, 1, "eine glatte");
	sagen(`10. Glatte Fassung          -> ${glattGelesen.status}, aus dem INHALT eingeordnet, `
		+ `${alleRoh.length} rohe + ${alleGlatt.length} glatte nebeneinander`);

	sagen("\nablage-ablauf: alle 10 Schritte durchlaufen.");
}

main().then(() => ende(0)).catch((fehler) => {
	console.error("\nFEHLGESCHLAGEN:", fehler && fehler.message ? fehler.message : fehler);
	if (fehler && fehler.actual !== undefined) {
		console.error("  gemessen:", fehler.actual, "\n  erwartet:", fehler.expected);
	}
	ende(1);
});
