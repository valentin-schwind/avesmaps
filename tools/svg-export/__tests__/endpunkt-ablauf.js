#!/usr/bin/env node
// DER ABLAUF, nicht das Mass: GET /api/svg-export.php wird wirklich ueber HTTP gefahren --
// ohne Token, mit falschem, mit richtigem, und noch einmal mit If-None-Match. Lauf:
//   node tools/svg-export/__tests__/endpunkt-ablauf.js
//
// 🔴 WARUM ES DAS BRAUCHT. „Eine Pruefseite, die Rechtecke misst, ist kein Beleg, dass etwas
// funktioniert" (AGENTS.md sec.9). Der Unit-Test daneben prueft die Entscheidung; er kann
// nicht sehen, ob Apache/CGI den Authorization-Kopf durchreicht, ob readfile() den Puffer
// wirklich leert oder ob ein Kopf zweimal gesetzt wird. Dafuer muss ein Server laufen.
//
// ⚠️ Traegt bewusst KEIN `.test.js`: er startet einen `php -S` und braucht einen freien Port
// -- das gehoert nicht in das Testtor des Deploys, das bei einem einzigen roten Test NICHTS
// hochlaedt. Diese Probe faehrt man von Hand (und der Autor hat sie gefahren).
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const FX = require("./fixture.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const ABLAGE = path.join(WURZEL, "uploads", "svg-export");
const TOKEN = "probe-" + require("crypto").randomBytes(16).toString("hex");
const PORT = 8000 + Math.floor(Math.random() * 900);

let server = null;
const aufgeraeumt = [];

function ende(code) {
	aufgeraeumt.forEach((p) => { try { fs.unlinkSync(p); } catch { /* schon weg */ } });
	// 💣 AUCH DIE SPERRE, die der Endpunkt SELBST angelegt hat. Sie steht in keiner
	// `aufgeraeumt`-Liste, weil dieser Test sie nicht geschrieben hat -- die Selbstheilung tat
	// es. Blieb sie liegen, sah der naechste Unit-Test eine Datei, die er fuer eine Repo-Kopie
	// hielt, und wurde rot: ein Testlauf, der den naechsten vergiftet.
	try {
		for (const f of fs.readdirSync(ABLAGE)) { fs.unlinkSync(path.join(ABLAGE, f)); }
		fs.rmdirSync(ABLAGE);
	} catch { /* nicht da, oder ein echter Abzug liegt drin -- dann anfassen wir nichts */ }
	if (server) { server.kill(); }
	process.exit(code);
}

async function schlafen(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
	// ---- Fixture ablegen, genau so, wie der naechtliche Lauf es taete --------------------
	const abzug = FX.baueFixtureAbzug();
	const inhalt = abzug.parts.join("");
	const sha = require("crypto").createHash("sha256").update(Buffer.from(inhalt, "utf8")).digest("hex");
	const datei = "abzug-" + sha.slice(0, 16) + ".svg";
	fs.mkdirSync(ABLAGE, { recursive: true });

	const zeigerPfad = path.join(ABLAGE, "aktuell.json");
	// ⚠️ Einen echten Zeiger, falls einer daliegt, nicht ueberbuegeln.
	const zeigerVorher = fs.existsSync(zeigerPfad) ? fs.readFileSync(zeigerPfad) : null;

	fs.writeFileSync(path.join(ABLAGE, datei), inhalt, "utf8");
	aufgeraeumt.push(path.join(ABLAGE, datei));
	fs.writeFileSync(zeigerPfad, JSON.stringify({
		datei: datei,
		dateiname: "avesmaps-karte-2026-08-23-r76178-inkscape.svg",
		bytes: Buffer.byteLength(inhalt, "utf8"),
		sha256: sha,
		etag: '"' + sha + '"',
		kartenfassung: "76178",
		landschaftsfassung: FX.ECO_REVISION,
		exportiert: FX.EXPORTIERT,
		dialekt: "inkscape",
	}, null, 2));
	if (zeigerVorher === null) { aufgeraeumt.push(zeigerPfad); }

	// ---- Server starten ------------------------------------------------------------------
	// 💣 Der Token geht ueber die UMGEBUNG hinein, nirgends sonst -- genau der Weg, den der
	// Server spaeter benutzt.
	server = spawn("php", ["-S", "127.0.0.1:" + PORT, "-t", WURZEL], {
		env: Object.assign({}, process.env, { AVESMAPS_SVG_EXPORT_TOKEN: TOKEN }),
		stdio: ["ignore", "ignore", "pipe"],
	});
	server.stderr.on("data", () => { /* der eingebaute Server plaudert; uninteressant */ });

	const basis = "http://127.0.0.1:" + PORT + "/api/svg-export.php";
	for (let i = 0; i < 40; i += 1) {
		try { await fetch(basis, { method: "HEAD" }); break; } catch { await schlafen(150); }
	}

	const hole = (koepfe, methode) => fetch(basis, { method: methode || "GET", headers: koepfe || {} });
	const sagen = (t) => console.log(t);

	// ---- 1. ohne Token -> 401 -----------------------------------------------------------
	const ohne = await hole();
	assert.strictEqual(ohne.status, 401, "ohne Token muss 401 kommen");
	const ohneJson = await ohne.json();
	assert.strictEqual(ohneJson.ok, false);
	assert.strictEqual(ohneJson.error.code, "unauthorized");
	assert.ok((ohne.headers.get("www-authenticate") || "").includes("Bearer"));
	assert.ok(!JSON.stringify(ohneJson).includes(TOKEN), "die Antwort verraet den Token nicht");
	sagen(`1. ohne Token              -> ${ohne.status} ${ohneJson.error.code}`);

	// ---- 2. falscher Token -> 401 -------------------------------------------------------
	const falsch = await hole({ Authorization: "Bearer voellig-falsch" });
	assert.strictEqual(falsch.status, 401, "ein falscher Token muss 401 geben");
	const falschJson = await falsch.json();
	assert.strictEqual(falschJson.error.code, "unauthorized");
	// 💣 DIE REGEL IST NICHT „alle 401 sind gleich", sondern: der Endpunkt verraet nichts ueber
	// den TOKEN. Code und Meldung sind darum in jedem Fall dieselben...
	assert.strictEqual(falschJson.error.code, ohneJson.error.code);
	assert.strictEqual(falschJson.error.message, ohneJson.error.message);
	// ...und ZWEI verschiedene falsche Token antworten identisch. Das ist die eigentliche
	// Zusicherung gegen einen Probierer: er lernt nie, ob sein Format, seine Laenge oder sein
	// Praefix stimmt.
	const falsch2 = await hole({ Authorization: "Bearer voellig-anders-und-viel-laenger-" + TOKEN.slice(0, 5) });
	assert.deepStrictEqual(await falsch2.json(), falschJson,
		"zwei falsche Token sind nicht auseinanderzuhalten");
	// ⚠️ `auth_header_seen` unterscheidet sehr wohl -- aber nur, OB ein Kopf ankam, was der
	// Aufrufer selbst weiss. Ohne diese Angabe hat am 23.08.2026 eine halbe Stunde gefehlt:
	// STRATO reichte den Kopf nicht durch, jeder Token wirkte falsch, und die 401 sah aus wie
	// ein gewoehnlicher Fehlversuch.
	assert.strictEqual(ohneJson.error.auth_header_seen, false, "ohne Kopf: nicht gesehen");
	assert.strictEqual(falschJson.error.auth_header_seen, true, "mit Kopf: gesehen");
	sagen(`2. falscher Token          -> ${falsch.status} ${falschJson.error.code}`);

	// ---- 3. Praefix des richtigen Tokens -> 401 -----------------------------------------
	const kurz = await hole({ Authorization: "Bearer " + TOKEN.slice(0, -1) });
	assert.strictEqual(kurz.status, 401, "ein um ein Zeichen gekuerzter Token ist falsch");
	sagen(`3. Token minus 1 Zeichen   -> ${kurz.status}`);

	// ---- 4. richtiger Token -> 200 + valides SVG ----------------------------------------
	const gut = await hole({ Authorization: "Bearer " + TOKEN });
	assert.strictEqual(gut.status, 200, "der richtige Token muss 200 geben");
	assert.strictEqual(gut.headers.get("content-type"), "image/svg+xml; charset=utf-8");
	assert.strictEqual(gut.headers.get("cache-control"), "private, no-cache");
	assert.strictEqual(gut.headers.get("x-avesmaps-kartenfassung"), "76178");
	assert.strictEqual(gut.headers.get("x-avesmaps-landschaftsfassung"), FX.ECO_REVISION);
	assert.strictEqual(gut.headers.get("x-avesmaps-exported-at"), FX.EXPORTIERT);
	assert.strictEqual(gut.headers.get("content-disposition"),
		'attachment; filename="avesmaps-karte-2026-08-23-r76178-inkscape.svg"');
	const etag = gut.headers.get("etag");
	assert.strictEqual(etag, '"' + sha + '"', "der ETag steht auf dem echten Inhalt");
	// 🔴 Kein CORS auf einem Token-Endpunkt.
	assert.strictEqual(gut.headers.get("access-control-allow-origin"), null);

	const geliefert = await gut.text();
	assert.strictEqual(geliefert, inhalt, "Byte fuer Byte die abgelegte Datei");
	assert.strictEqual(Number(gut.headers.get("content-length")),
		Buffer.byteLength(inhalt, "utf8"), "Content-Length stimmt");

	const P = require("../abzug-pruefung.js");
	const abnahme = P.pruefeAbzug(geliefert);
	assert.deepStrictEqual(abnahme.befunde, [], "das Ausgelieferte besteht die Abnahmeliste");
	assert.deepStrictEqual(P.pruefeStruktur(geliefert).befunde, []);
	sagen(`4. richtiger Token         -> ${gut.status}, ${geliefert.length} Zeichen, `
		+ `${abnahme.geprueft} Abnahmepunkte, ETag ${etag.slice(0, 12)}…`);

	// ---- 5. If-None-Match -> 304 --------------------------------------------------------
	const wieder = await hole({ Authorization: "Bearer " + TOKEN, "If-None-Match": etag });
	assert.strictEqual(wieder.status, 304, "unveraendert muss 304 geben");
	assert.strictEqual((await wieder.text()).length, 0, "ein 304 traegt keinen Rumpf");
	assert.strictEqual(wieder.headers.get("etag"), etag, "und nennt denselben Tag");
	sagen(`5. If-None-Match (gleich)  -> ${wieder.status}`);

	// Ein schwacher Tag und eine Liste muessen ebenfalls treffen (RFC 9110).
	assert.strictEqual((await hole({ Authorization: "Bearer " + TOKEN,
		"If-None-Match": 'W/' + etag })).status, 304, "W/ davor ist derselbe Tag");
	assert.strictEqual((await hole({ Authorization: "Bearer " + TOKEN,
		"If-None-Match": '"fremd", ' + etag })).status, 304, "eine Liste wird durchsucht");
	assert.strictEqual((await hole({ Authorization: "Bearer " + TOKEN,
		"If-None-Match": '"ein-anderer"' })).status, 200, "ein fremder Tag holt die Datei");
	sagen("6. W/, Liste, fremder Tag  -> 304 / 304 / 200");

	// ---- 7. If-None-Match OHNE Token bleibt 401 -----------------------------------------
	// 💣 Sonst waere „ist es noch dasselbe?" ohne Token zu beantworten -- ein 304 ist eine
	// Auskunft ueber den Inhalt.
	assert.strictEqual((await hole({ "If-None-Match": etag })).status, 401,
		"der Riegel steht VOR dem ETag-Vergleich");
	sagen("7. If-None-Match ohne Token-> 401");

	// ---- 8. HEAD und ein verbotenes Verb ------------------------------------------------
	const kopf = await hole({ Authorization: "Bearer " + TOKEN }, "HEAD");
	assert.strictEqual(kopf.status, 200);
	assert.strictEqual(kopf.headers.get("x-avesmaps-kartenfassung"), "76178");
	const post = await hole({ Authorization: "Bearer " + TOKEN }, "POST");
	assert.strictEqual(post.status, 405, "der Endpunkt ist nur lesend");
	assert.ok((post.headers.get("allow") || "").includes("GET"));
	sagen(`8. HEAD / POST             -> ${kopf.status} / ${post.status}`);

	// ---- 9. Der Token darf NICHT ueber die Adresse gehen --------------------------------
	const ueberUrl = await fetch(basis + "?token=" + encodeURIComponent(TOKEN));
	assert.strictEqual(ueberUrl.status, 401,
		"ein Token in der Adresse steht im Serverprotokoll und darf nie gelten");
	sagen(`9. Token als URL-Parameter -> ${ueberUrl.status}`);

	// ---- 10. Ohne eingerichteten Token: 503, nicht 401 ----------------------------------
	// Ein zweiter Server, diesmal ohne die Umgebungsvariable.
	const port2 = PORT + 1;
	const server2 = spawn("php", ["-S", "127.0.0.1:" + port2, "-t", WURZEL],
		{ env: Object.assign({}, process.env, { AVESMAPS_SVG_EXPORT_TOKEN: "" }),
			stdio: ["ignore", "ignore", "ignore"] });
	const basis2 = "http://127.0.0.1:" + port2 + "/api/svg-export.php";
	for (let i = 0; i < 40; i += 1) {
		try { await fetch(basis2, { method: "HEAD" }); break; } catch { await schlafen(150); }
	}
	const ohneEinrichtung = await fetch(basis2, { headers: { Authorization: "Bearer " + TOKEN } });
	const oeJson = await ohneEinrichtung.json();
	assert.strictEqual(ohneEinrichtung.status, 503, "eine fehlende Umgebungsvariable ist kein 401");
	assert.strictEqual(oeJson.error.code, "export_not_configured");
	server2.kill();
	sagen(`10. Server ohne Token      -> ${ohneEinrichtung.status} ${oeJson.error.code}`);

	sagen("\nendpunkt-ablauf: alle 10 Schritte durchlaufen.");
}

main().then(() => ende(0)).catch((fehler) => {
	console.error("\nFEHLGESCHLAGEN:", fehler && fehler.message ? fehler.message : fehler);
	if (fehler && fehler.actual !== undefined) {
		console.error("  gemessen:", fehler.actual, "\n  erwartet:", fehler.expected);
	}
	ende(1);
});
