// Der Anfrage-Umschlag (09.10.2026). STRATOs Webserver weist JSON-Anfragen mit mehr als 1000 einzelnen
// Werten mit einer HTML-400 ab, bevor PHP sie sieht -- live gemessen an Fläche-058 (Discord). Die
// Abhilfe sitzt an `fetch` (js/app/json-umschlag.js) und auf dem Server in avesmapsReadJsonRequest
// (Gegenstück: api/_internal/__tests__/json-umschlag-test.php).
//
// ⭐ AUSGEFÜHRT, NICHT GELESEN: die Umhüllung läuft hier gegen ein gefälschtes `fetch`, und der Rumpf,
// der dort ankommt, ist die Antwort.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/json-umschlag.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const {
	UMSCHLAG_AB_WERTEN,
	zaehleWerte,
	avesmapsJsonUmschlagRumpf,
	avesmapsJsonUmschlagInstallieren,
} = require("../json-umschlag.js");

let pruefungen = 0;
const pruefe = (bedingung, text) => { pruefungen++; assert.ok(bedingung, text); };

// Eine Fläche mit n Ecken -- genau die Form, an der es live gescheitert ist.
const flaeche = (n) => ({
	action: "update_area_geometry",
	public_id: "5eef5e3d-7366-4b53-b289-4cdf2f9084f8",
	expected_revision: 31,
	geometry_geojson: {
		type: "Polygon",
		coordinates: [Array.from({ length: n }, (_, i) => [Math.round(500 + 100 * Math.cos(i)), Math.round(500 + 100 * Math.sin(i))])],
	},
});

// ---- A. Was gezählt wird ------------------------------------------------------------------------
pruefe(zaehleWerte(flaeche(498), 5000) === 996 + 4,
	"gezählt werden die EINZELWERTE (996 Zahlen + 4 Felder) -- die Behälter nicht: genau diese Anfrage"
	+ " ging live durch, obwohl 500 Arrays mitreisten");
pruefe(zaehleWerte({ a: [], b: {} }, 10) === 2, "ein leerer Behälter zählt als ein Wert (vorsichtige Richtung)");
pruefe(zaehleWerte(flaeche(5000), 10) === 11, "das Zählen hört auf, sobald die Grenze überschritten ist");

// ---- B. Was verpackt wird -------------------------------------------------------------------------
const klein = JSON.stringify(flaeche(400));
pruefe(avesmapsJsonUmschlagRumpf(klein) === klein,
	"🔴 eine gewöhnliche Anfrage geht ZEICHEN FÜR ZEICHEN unverändert hinaus -- der Riegel fasst nur an,"
	+ " was der Webserver sonst abwiese");

const gross = JSON.stringify(flaeche(657)); // Fläche-058 vereinigt mit den Windhagbergen
const verpackt = avesmapsJsonUmschlagRumpf(gross);
const aussen = JSON.parse(verpackt);
pruefe(Object.keys(aussen).length === 1 && typeof aussen.avesmaps_umschlag === "string",
	"💣 eine Anfrage mit 657 Ecken reist als EINE Zeichenkette -- unverpackt wies der Webserver sie mit 400 ab");
pruefe(aussen.avesmaps_umschlag === gross,
	"im Umschlag steckt Zeichen für Zeichen der Rumpf des Aufrufers, nicht ein neu geschriebenes Objekt");
pruefe(zaehleWerte(aussen, 5000) === 1, "für den Webserver ist der Umschlag ein einziger Wert");
pruefe(avesmapsJsonUmschlagRumpf(verpackt) === verpackt, "schon verpackt wird nicht ein zweites Mal verpackt");

const grenze = UMSCHLAG_AB_WERTEN;
pruefe(grenze < 1000 && grenze >= 500, `die Schwelle (${grenze}) liegt unter der Grenze des Webservers (1000)`);
const knapp = JSON.stringify({ werte: Array.from({ length: grenze }, (_, i) => i) });
const druber = JSON.stringify({ werte: Array.from({ length: grenze + 1 }, (_, i) => i) });
pruefe(avesmapsJsonUmschlagRumpf(knapp) === knapp, "genau auf der Schwelle bleibt alles, wie es ist");
pruefe(avesmapsJsonUmschlagRumpf(druber) !== druber, "ein Wert darüber wird verpackt");

const liste = JSON.stringify(Array.from({ length: 2000 }, (_, i) => i));
pruefe(avesmapsJsonUmschlagRumpf(liste) === liste, "eine Liste auf oberster Ebene bleibt -- der Server packt nur ein Objekt aus");
pruefe(avesmapsJsonUmschlagRumpf("kein json ".repeat(400)) === "kein json ".repeat(400), "was kein JSON ist, bleibt");

// ---- C. Die Umhüllung von fetch -----------------------------------------------------------------
function welt() {
	const gesehen = [];
	const fenster = {
		location: { href: "https://avesmaps.de/html/wege-editor.html", origin: "https://avesmaps.de" },
		fetch(eingabe, optionen) {
			gesehen.push({ eingabe, optionen, dies: this });
			return Promise.resolve({ ok: true });
		},
	};
	pruefe(avesmapsJsonUmschlagInstallieren(fenster) === true, "die Umhüllung wird installiert");
	pruefe(avesmapsJsonUmschlagInstallieren(fenster) === false, "ein zweites Laden umhüllt NICHT ein zweites Mal");
	return { fenster, gesehen };
}

{
	const { fenster, gesehen } = welt();
	const json = { "Content-Type": "application/json" };
	const optionenDesAufrufers = { method: "POST", headers: json, body: gross };
	fenster.fetch("/api/edit/map/ecosystem.php", optionenDesAufrufers);
	pruefe(JSON.parse(gesehen[0].optionen.body).avesmaps_umschlag === gross,
		"ein grosser JSON-POST an /api/ dieser Herkunft geht verpackt hinaus");
	pruefe(optionenDesAufrufers.body === gross, "die Optionen des Aufrufers werden nicht angefasst (Kopie)");
	pruefe(gesehen[0].optionen.method === "POST" && gesehen[0].optionen.headers === json, "alles andere reist unverändert mit");

	fenster.fetch("api/edit/map/ecosystem.php", { method: "post", headers: { "content-type": "application/json; charset=utf-8" }, body: gross });
	pruefe(JSON.parse(gesehen[1].optionen.body).avesmaps_umschlag === gross,
		"💣 auch eine RELATIVE Adresse ohne führenden Schrägstrich -- so heissen die Endpunkte im Haus");

	const kleinOptionen = { method: "POST", headers: json, body: klein };
	fenster.fetch("/api/route/", kleinOptionen);
	pruefe(gesehen[2].optionen === kleinOptionen, "eine kleine Anfrage geht mit denselben Optionen hinaus, unberührt");

	fenster.fetch("https://example.org/api/x", { method: "POST", headers: json, body: gross });
	pruefe(gesehen[3].optionen.body === gross, "eine FREMDE Herkunft wird nie verpackt");

	fenster.fetch("/api/edit/map/ecosystem.php", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: gross });
	pruefe(gesehen[4].optionen.body === gross, "nur JSON -- ein Datenstück (SVG-Abzug) bleibt roh");

	fenster.fetch("/api/app/map-features.php", { method: "GET", headers: json });
	pruefe(gesehen[5].optionen.method === "GET", "GET bleibt unberührt");

	fenster.fetch("/html/irgendwas", { method: "POST", headers: json, body: gross });
	pruefe(gesehen[6].optionen.body === gross, "nur Ziele unter /api/");

	const headers = { get: (name) => (name === "Content-Type" ? "application/json" : null) };
	fenster.fetch("/api/edit/political/territories.php", { method: "PATCH", headers, body: gross });
	pruefe(gesehen[7].optionen.body === gross, "nur POST");
	fenster.fetch("/api/edit/political/territories.php", { method: "POST", headers, body: gross });
	pruefe(JSON.parse(gesehen[8].optionen.body).avesmaps_umschlag === gross, "Headers-Objekte werden gelesen");
	pruefe(gesehen[8].dies === fenster, "das echte fetch wird mit seinem `this` gerufen (sonst: Illegal invocation)");
}

// ---- D. 🔴 Verdrahtung: JEDE Seite, die selbst etwas schickt, lädt den Umschlag ZUERST -----------
// Jede Editorseite ist ein eigenes iframe-Dokument mit eigenem `fetch` -- ein Riegel in index.html
// erreicht sie nicht. Geprüft wird jede Seite, deren Skripte (eingebunden oder inline) `fetch(` rufen.
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
const seiten = ["index.html",
	...fs.readdirSync(path.join(wurzel, "html")).filter((f) => f.endsWith(".html")).map((f) => "html/" + f),
	...fs.readdirSync(path.join(wurzel, "edit")).filter((f) => f.endsWith(".php")).map((f) => "edit/" + f)];
const ohneKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
// 🪤 Auch die JS-Kommentare raus: das Vorabruf-Skript im Kopf von index.html ERKLÄRT `fetch()` nur,
// es ruft es nicht -- mit Kommentar gelesen hielte der Test es für den ersten Absender der Seite.
const ohneJsKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
let gepruefteSeiten = 0;
for (const seite of seiten) {
	const html = ohneKommentare(lies(seite));
	const skripte = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => {
		const src = (m[1].match(/src\s*=\s*["']([^"']+)["']/) || [])[1] || "";
		let inhalt = m[2];
		if (src && !/^https?:/.test(src)) {
			const rel = src.split("?")[0].replace(/^(\.\.\/)+/, "").replace(/^\//, "");
			try { inhalt = lies(rel); } catch (fehler) { inhalt = ""; }
		}
		return { src, inhalt: ohneJsKommentare(inhalt), index: m.index };
	});
	const erstesFetch = skripte.find((s) => /\bfetch\(/.test(s.inhalt) && !/json-umschlag\.js/.test(s.src));
	if (!erstesFetch) {
		continue;
	}
	gepruefteSeiten++;
	const umschlag = skripte.find((s) => /(^|\/)js\/app\/json-umschlag\.js(\?|$)/.test(s.src));
	pruefe(umschlag, `💣 ${seite} schickt Anfragen (${erstesFetch.src || "Inline-Skript"}), lädt aber js/app/json-umschlag.js nicht`
		+ " -- grosse Speichervorgänge scheitern dort wieder am Webserver");
	pruefe(umschlag.index < erstesFetch.index,
		`${seite}: json-umschlag.js muss VOR dem ersten Skript stehen, das fetch ruft (${erstesFetch.src || "Inline-Skript"})`);
	if (seite.endsWith(".php")) {
		// AGENTS.md §7: .php-Seiten erreicht der Stempel des Deploys nicht -- der ?v= steht von Hand.
		pruefe(/json-umschlag\.js\?v=/.test(umschlag.src), `${seite}: .php-Seite braucht einen ?v= von Hand`);
	}
}
pruefe(gepruefteSeiten >= 10, `nur ${gepruefteSeiten} Seiten mit fetch gefunden -- die Suche ist kaputt, nicht die Seiten`);

// ---- E. Der Server packt an JEDER Tür aus ---------------------------------------------------------
// Wer seinen Rumpf an avesmapsReadJsonRequest vorbei selbst liest, muss den Umschlag selbst auspacken.
const phpDateien = [];
const sammle = (rel) => {
	for (const name of fs.readdirSync(path.join(wurzel, rel))) {
		const pfad = rel + "/" + name;
		if (name === "__tests__") continue;
		if (fs.statSync(path.join(wurzel, pfad)).isDirectory()) sammle(pfad);
		else if (name.endsWith(".php")) phpDateien.push(pfad);
	}
};
sammle("api");
// Gemeint ist der AUFRUF, nicht die Erwähnung: sync-monitor.php nennt php://input nur im Kommentar.
// Ausgenommen mit Grund: bootstrap.php IST der Auspacker, die Discord-Endpunkte bekommen nur Post von
// Discord, und svg-export-deposit.php liest dort rohe Datenstücke (octet-stream) -- sein JSON-Teil
// geht über avesmapsReadJsonRequest.
const selbstLeser = phpDateien.filter((p) => /file_get_contents\(\s*['"]php:\/\/input/.test(lies(p))
	&& !/^api\/(_internal\/bootstrap\.php|discord\/|svg-export-deposit\.php)/.test(p));
selbstLeser.forEach((p) => {
	pruefe(/avesmapsJsonUmschlagAuspacken\(/.test(lies(p)),
		`${p} liest php://input selbst, packt den Umschlag aber nicht aus -- eine verpackte Anfrage käme dort als`
		+ " {avesmaps_umschlag: …} an");
});
pruefe(selbstLeser.length >= 1, "die Prüfung der Selbstleser hat nichts gefunden -- curve-labels-run.php liest seit jeher selbst");

console.log(`ok - json-umschlag (${pruefungen} Prüfungen, ${gepruefteSeiten} Seiten)`);
