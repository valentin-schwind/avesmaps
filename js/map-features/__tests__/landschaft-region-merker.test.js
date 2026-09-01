// Der Merker für die schon angelegte Region -- die Klammer, die B15 gefehlt hat.
//
// 🪤 DER BEFUND (am Livebestand gemessen, 01.09.2026): eine Fläche zu speichern sind ZWEI Aufrufe --
// `create_region`, dann `create_area`. Scheitert der zweite, steht die Region bereits; ein zweiter
// Anlauf legte bis dahin eine WEITERE an und liess die erste ohne Fläche liegen. Im Änderungs-Log
// stand genau das: 11:04:43 `create_region` „Fläche-102" ohne Partner, 11:06:52 von Hand
// zurückgenommen, 11:08:44 der geglückte zweite Anlauf. Eine von fünf Zeichnungen an diesem Tag.
//
// 💣 UND ES SIND VIER ERZEUGER DESSELBEN PAARS, nicht einer. Zwei trugen den Merker längst
// (`transferCreatedRegion` in map-features-ecosystem-transfer.js, `importCreatedRegion` in
// map-features-ecosystem-territory-import.js) -- der Zeichner und die Geometrie-Operationen nicht.
// Eine Regel, die zwei von vier Erzeugern bindet, ist keine Regel; deshalb steht sie jetzt EINMAL im
// Schreibkanal (`ecosystemAcquireRegionForNewArea`), und Abschnitt C zählt ihre Erzeuger nach.
//
// ZUR LAUFZEIT gefahren, nicht als Textvergleich: Abschnitt A lädt den echten Schreibkanal in einen
// vm-Kontext, Abschnitt B schneidet `createArea` aus der IIFE der Geometrie-Operationen heraus und
// führt es gegen genau diesen Kanal aus.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/landschaft-region-merker.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⭐ Zeilenenden-neutral (AGENTS.md §9): Arbeitskopie CRLF, CI LF.
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
const SPEICHER = "js/map-features/map-features-ecosystem-region-store.js";
const OPS = "js/map-features/map-features-ecosystem-geometry-ops.js";
let checks = 0;

// ---- Bühne ----------------------------------------------------------------------------------------

// Der ECHTE Schreibkanal in einem vm-Kontext, mit `postEcosystemEdit` als Attrappe darüber.
//
// 🔴 Die Attrappe wird NACH dem Laden gesetzt und überschreibt damit die echte Fassung: der Merker
// löst `postEcosystemEdit` erst beim Aufruf auf, sieht also die Attrappe. Wäre er andersherum gebaut
// (die Funktion beim Laden festgehalten), prüfte dieser Test eine Fassung, die niemand fährt.
function baueKanal(antwort) {
	const gesendet = [];
	const kontext = { console, JSON, Math, Number, String, Boolean, Array, Object, Promise, Map };
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(lies(SPEICHER), kontext);

	kontext.postEcosystemEdit = (aktion, rumpf) => {
		gesendet.push({ aktion, rumpf });
		const wert = antwort(aktion, rumpf);
		return wert instanceof Error ? Promise.reject(wert) : Promise.resolve(wert);
	};

	return { kontext, gesendet };
}

// Ein Server, der jede Region anlegt und fortlaufend nummeriert; alles andere scheitert.
function regionenServer() {
	let n = 0;
	return (aktion) => {
		if (aktion !== "create_region") {
			return new Error("Serverfehler beim Anlegen.");
		}
		n += 1;
		return { region: { public_id: `reg-${n}`, name: `Flaeche-${100 + n}` } };
	};
}

// `async function name(` bis zur schliessenden Klammer -- über Klammernzählung, nicht über eine
// gesuchte Zeichenfolge.
//
// 🪤 Genau daran ist am 25.08.2026 ein Test gescheitert, der auf `"\r\n}"` schnitt und per `||` auf LF
// zurückfallen wollte: `-1 + 3` ist 2, also truthy. Deshalb wird hier gezählt und nicht gesucht --
// und der Schnitt wird unten gegengeprüft.
function schneideFunktion(quelle, name) {
	const start = quelle.indexOf(`async function ${name}(`);
	assert.notStrictEqual(start, -1, `${name} steht nicht (mehr) in der Quelle`);
	let tiefe = 0;
	let gesehen = false;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i++) {
		if (quelle[i] === "{") {
			tiefe += 1;
			gesehen = true;
		} else if (quelle[i] === "}") {
			tiefe -= 1;
			if (gesehen && tiefe === 0) {
				return quelle.slice(start, i + 1);
			}
		}
	}
	throw new Error(`${name} liess sich nicht ausschneiden`);
}

async function main() {
	// ── A. DIE REGEL SELBST ──────────────────────────────────────────────────────────────────────
	{
		const { kontext, gesendet } = baueKanal(regionenServer());
		const hole = (zusatz) => kontext.ecosystemAcquireRegionForNewArea({
			kind: "vegetation", region_type: "", name: "Flaeche-101", ...zusatz,
		});

		const erste = await hole();
		assert.strictEqual(erste.publicId, "reg-1", "der erste Anlauf legt die Region an"); checks++;
		assert.strictEqual(erste.reused, false, "…und sagt, dass sie frisch ist"); checks++;

		// 💣 DER KERN: der Aufrufer hat seine Fläche NICHT gemeldet -- die Region steht also schon.
		// Der zweite Anlauf muss sie WIEDERVERWENDEN.
		const zweite = await hole();
		assert.strictEqual(zweite.publicId, "reg-1",
			"ein zweiter Anlauf nimmt die schon angelegte Region"); checks++;
		assert.strictEqual(zweite.reused, true,
			"…und sagt es, damit der Aufrufer es dem Editor sagen kann"); checks++;
		assert.strictEqual(gesendet.filter((e) => e.aktion === "create_region").length, 1,
			"…und legt keine zweite an -- genau die Waise, um die es geht"); checks++;

		// Freigeben heisst: die Fläche steht, der Merker hat seine Schuldigkeit getan.
		kontext.ecosystemReleaseCreatedRegion();
		const dritte = await hole();
		assert.strictEqual(dritte.publicId, "reg-2",
			"nach dem Freigeben ist die nächste Fläche wieder eine eigene Region"); checks++;
	}

	// ── A2. DER SCHLÜSSEL IST EBENE *UND* ART ────────────────────────────────────────────────────
	// 💣 Nicht nur die Ebene: „Zerschneiden" erbt die Art seiner Quellfläche. Ein gemerkter Wald darf
	// niemals das Gefäss für ein abgetrenntes Stück Gebirge werden -- die Art sitzt auf der REGION,
	// ein falsches Gefäss wäre also nicht bloss unordentlich, sondern eine falsche Angabe.
	{
		const { kontext, gesendet } = baueKanal(regionenServer());
		await kontext.ecosystemAcquireRegionForNewArea({ kind: "vegetation", region_type: "wald", name: "a" });
		const andereArt = await kontext.ecosystemAcquireRegionForNewArea({ kind: "vegetation", region_type: "gebirge", name: "b" });
		assert.strictEqual(andereArt.reused, false, "eine andere ART bekommt eine eigene Region"); checks++;
		const andereEbene = await kontext.ecosystemAcquireRegionForNewArea({ kind: "topographie", region_type: "gebirge", name: "c" });
		assert.strictEqual(andereEbene.reused, false, "eine andere EBENE bekommt eine eigene Region"); checks++;
		assert.strictEqual(gesendet.length, 3, "…also drei Regionen für drei verschiedene Gefässe"); checks++;

		const wieder = await kontext.ecosystemAcquireRegionForNewArea({ kind: "topographie", region_type: "gebirge", name: "c" });
		assert.strictEqual(wieder.reused, true, "…und der zuletzt angelegte bleibt greifbar"); checks++;
	}

	// ── A3. EINE ANTWORT OHNE public_id IST EIN FEHLSCHLAG ───────────────────────────────────────
	// 🔴 Derselbe Vertrag wie bei der Wiki-Zuweisung: im Fehlerfall ABLEHNEN, nie mit etwas Leerem
	// auflösen. Ein leerer Zeiger als Merker hiesse: jeder weitere Anlauf hängt seine Fläche an nichts.
	{
		const { kontext } = baueKanal(() => ({ region: {} }));
		await assert.rejects(
			() => kontext.ecosystemAcquireRegionForNewArea({ kind: "vegetation", region_type: "", name: "x" }),
			/Region/,
			"eine Antwort ohne public_id lehnt ab, statt einen leeren Merker zu setzen"
		); checks++;

		const { kontext: k2, gesendet: g2 } = baueKanal(() => ({ region: {} }));
		await k2.ecosystemAcquireRegionForNewArea({ kind: "vegetation", region_type: "", name: "x" }).catch(() => {});
		await k2.ecosystemAcquireRegionForNewArea({ kind: "vegetation", region_type: "", name: "x" }).catch(() => {});
		assert.strictEqual(g2.length, 2,
			"…und merkt sich nichts, was es nicht gibt -- der nächste Anlauf fragt neu"); checks++;
	}

	// ── B. DIE GEOMETRIE-OPERATIONEN BENUTZEN SIE WIRKLICH ───────────────────────────────────────
	// `createArea` trägt „Zerschneiden" und „Herauslösen" und liegt in einer IIFE. Statt seinen
	// Quelltext zu vergleichen, wird es HERAUSGESCHNITTEN und gegen den echten Schreibkanal gefahren.
	{
		const rumpf = schneideFunktion(lies(OPS), "createArea");
		assert.ok(rumpf.includes("create_area"),
			"der Schnitt hat wirklich `createArea` erwischt und nicht ein halbes Stück"); checks++;

		let flaechen = 0;
		const { kontext, gesendet } = baueKanal((aktion) => {
			if (aktion === "create_region") {
				return { region: { public_id: "reg-1", name: "Flaeche-101" } };
			}
			flaechen += 1;
			// Der erste Flächen-Anlauf scheitert, der zweite gelingt -- der gemessene Verlauf.
			return flaechen === 1 ? new Error("Serverfehler beim Anlegen.") : { area: { public_id: "flaeche-1" } };
		});
		kontext.ecosystemDraftRegionName = () => "Flaeche-101";
		vm.runInContext(rumpf, kontext);

		const quelle = { kind: "vegetation", region_type: "wald" };
		await kontext.createArea(quelle, { type: "Polygon", coordinates: [] }).catch(() => {});
		await kontext.createArea(quelle, { type: "Polygon", coordinates: [] });

		assert.strictEqual(gesendet.filter((e) => e.aktion === "create_region").length, 1,
			"zwei Anläufe des Zerschneidens legen EINE Region an, nicht zwei"); checks++;
		assert.deepStrictEqual(
			gesendet.filter((e) => e.aktion === "create_area").map((e) => e.rumpf.region_public_id),
			["reg-1", "reg-1"],
			"…und beide Flächen-Anläufe zielen auf dieselbe"); checks++;

		// Nach dem Erfolg ist der Merker frei -- sonst erbte das nächste Zerschneiden diese Region.
		const naechste = await kontext.ecosystemAcquireRegionForNewArea({ kind: "vegetation", region_type: "wald", name: "y" });
		assert.strictEqual(naechste.reused, false,
			"nach der geglückten Fläche gibt `createArea` den Merker frei"); checks++;
	}

	// ── C. ALLE ERZEUGER, NICHT ZWEI VON VIER ────────────────────────────────────────────────────
	// 💣 Die Lehre, die dieses Projekt mehrfach bezahlt hat, als Zusicherung: wer `create_region`
	// selbst schickt, umgeht den Merker. Erlaubt ist das nur dort, wo ein EIGENER Merker danebensteht
	// -- die beiden Dialoge, die ihn seit jeher tragen und deren Lebensdauer am FENSTER hängt, nicht
	// an der Ebene. Ein fünfter Erzeuger macht diesen Test rot und muss sich entscheiden.
	{
		const dateien = execFileSync("git", ["ls-files", "*.js"], { cwd: wurzel, encoding: "utf8" })
			.split("\n").filter((d) => d && !d.includes("__tests__") && !d.includes("third-party"));
		const erzeuger = dateien.filter((datei) => {
			let text = "";
			try {
				text = lies(datei);
			} catch {
				return false;
			}
			// Kommentare raus: sie SPRECHEN über create_region, sie schicken es nicht.
			const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
			return /postEcosystemEdit\(\s*"create_region"/.test(code);
		});

		assert.deepStrictEqual(erzeuger.sort(), [
			"js/map-features/map-features-ecosystem-region-store.js",
			"js/map-features/map-features-ecosystem-territory-import.js",
			"js/map-features/map-features-ecosystem-transfer.js",
		], "Wer `create_region` selbst schickt, braucht einen eigenen Merker daneben -- sonst geht der"
			+ " Weg über ecosystemAcquireRegionForNewArea."); checks++;
	}

	console.log(`ok -- ${checks} Zusicherungen`);
}

main().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
