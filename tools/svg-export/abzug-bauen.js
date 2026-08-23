#!/usr/bin/env node
// Den semantischen SVG-Abzug bauen -- OHNE Browser, mit GENAU DEMSELBEN Bauer.
//
// Aufruf:  node tools/svg-export/abzug-bauen.js --out <verzeichnis> [--base https://avesmaps.de]
//
// 🔴 WARUM DAS HIER UND NICHT IN PHP STEHT. Der Export ist 1.356 Zeilen Kartenbild
// (js/pages/svg-export-build.js). Ihn in PHP nachzubauen hiesse, das Aussehen der Karte ein
// zweites Mal zu behaupten -- genau das, was der Entwurf
// (docs/superpowers/specs/2026-08-14-svg-export-design.md) verworfen hat, und auf dem Shared
// Hosting ausserdem ~21 MB JSON zu dekodieren. Dieser Laeufer laedt stattdessen DIESELBE
// Datei, die der Browser laedt. Ein neuer Gelaendetyp, eine neue Wegart, eine geaenderte
// Kurve wandern von selbst mit; es gibt nichts, was auseinanderlaufen koennte.
//
// 💣 DIE EINSTELLUNGEN SIND DIE DER MANUELLEN SEITE MIT ALLEN HAEKCHEN. Wer hier eine Zahl
// aendert, aendert damit, was die API ausliefert -- und der manuelle Export auf
// /edit/svg-export.php sagt dann etwas anderes. Die Werte stehen deshalb einmal, benannt,
// weiter unten in ABZUG_EINSTELLUNGEN.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const bauer = require("../../js/pages/svg-export-build.js");
const farben = require("../../js/pages/svg-export-farben.js");
const { svgxTokenLeser } = require("./tokens-tafel.js");

const REPO = path.resolve(__dirname, "..", "..");

// 💣 DIESE REIHENFOLGE IST DIE ZEICHENREIHENFOLGE, nicht Geschmack -- abgeschrieben waere
// sie eine zweite Wahrheit, deshalb steht daneben, warum sie so ist (wie im Kitt): in SVG
// liegt das Erste unten, die acht Klimabaender decken die GANZE Karte und muessen darum
// zuerst kommen, sonst laege ein Farbschleier ueber Wald, Meer und Gebirge.
const ECOSYSTEM_ARTEN = ["klima", "derographisch", "vegetation", "topographie"];

// 🔴 Der Zustand der manuellen Seite mit allen Haekchen: Inkscape-Dialekt, 32768 px,
// Semantik AN, nichts geglaettet, keine Passmarken, Strichstaerke wie auf der Karte.
// `subgroups: {}` heisst ALLES -- svgxSubgroupEnabled schliesst nur bei ausdruecklichem
// `false` aus, eine neue Unterart bleibt also von selbst dabei (statt aus einer Liste zu
// fallen, die niemand nachfuehrt). `layers: {}` ebenso: die Ebenenbauer pruefen auf
// `!== false`.
const ABZUG_EINSTELLUNGEN = {
	dialect: "inkscape",
	sizePx: 32768,
	strokeScale: 1,
	smooth: false,
	smoothAreas: false,
	tension: 0.5,
	registrationMarks: false,
	semantics: true,
	layers: {},
	subgroups: {},
};

function argument(name, vorgabe) {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : vorgabe;
}

function melde(text) {
	process.stderr.write(text + "\n");
}

// ⚠️ EINE Anfrage je Art, nie in einer Schleife ueber Werte: der Landschaften- und der
// Territorien-Endpunkt sind bekannte Perf-Brennpunkte auf dem Shared Hosting (CLAUDE.md).
// Ein Fehlschlag wird wiederholt, aber nur zweimal und mit wachsender Pause -- ein Laeufer,
// der einen ueberlasteten Server im Kreis anfaellt, ist genau der Ausfall, den CLAUDE.md
// beschreibt.
async function holen(url, versuche = 3) {
	for (let versuch = 1; versuch <= versuche; versuch += 1) {
		try {
			const antwort = await fetch(url, { headers: { Accept: "application/json" } });
			if (!antwort.ok) { throw new Error("HTTP " + antwort.status); }
			return await antwort.json();
		} catch (fehler) {
			if (versuch === versuche) { throw new Error(url + ": " + fehler.message); }
			melde("  … " + url + " fehlgeschlagen (" + fehler.message + "), Versuch "
				+ (versuch + 1) + "/" + versuche);
			await new Promise((r) => setTimeout(r, 5000 * versuch));
		}
	}
	return null;
}

// Die Farben, die der Browser einstellen WUERDE, wenn niemand ein Feld anfasst. Die Listen
// kommen aus dem Bauer (SVGX_WAY_SUBTYPES, SVGX_PLACE_KINDS) -- nicht abgeschrieben, sonst
// verlore eine neu eingefuehrte Wegart hier ihre Farbe.
function vorgabeFarben(oekosysteme, token) {
	const vorgabe = (pfad) => farben.svgxFarbeVorgabe(
		pfad, token, bauer.SVGX_WAY_COLORS, bauer.SVGX_PLACE_COLOR
	);

	const wayColors = {};
	bauer.SVGX_WAY_SUBTYPES.forEach((art) => { wayColors[art] = vorgabe("wege/" + art); });

	// ⚠️ SVGX_PLACE_KINDS fuehrt OBJEKTE ({slug, label, r}), keine Zeichenketten -- und der
	// Ortsbauer schlaegt die Farbe unter `slug` nach. Ein `forEach` ueber das Objekt selbst
	// ergibt den Schluessel "[object Object]", und weil der Bauer dann still auf
	// SVGX_PLACE_COLOR zurueckfaellt, saehe man dem Abzug nichts an.
	const placeColors = {};
	bauer.SVGX_PLACE_KINDS.forEach((art) => { placeColors[art.slug] = vorgabe("orte/" + art.slug); });

	// 💣 Die Flaechenfarben kommen aus ZWEI Quellen, und die Reihenfolge ist tragend (wie im
	// Kitt): zuerst die aus den DATEN abgeleiteten -- die decken auch einen Gelaendetyp ab,
	// den es auf der Seite noch gar nicht als Feld gibt --, darueber die Owner-Vorgaben.
	const ausDaten = farben.svgxLandschaftsFarben(oekosysteme, token);
	const ausVorgaben = {};
	Object.keys(farben.SVGX_COLOR_PRESETS).forEach((pfad) => {
		const teile = pfad.split("/");
		if (teile[0] === "landschaften" && teile.length === 3) {
			ausVorgaben[teile[2]] = farben.SVGX_COLOR_PRESETS[pfad];
		}
	});

	return {
		wayColors: wayColors,
		placeColors: placeColors,
		areaColors: Object.assign({}, ausDaten, ausVorgaben),
		boundaryColor: vorgabe("gebiete"),
		powerlineColor: vorgabe("kraftlinien"),
		labelColor: vorgabe("beschriftungen"),
		// Konturen sind auf der Seite vorbelegt, aber AUS -- eine Kontur gehoert dem
		// Bearbeiten, nicht dem Ansehen (AGENTS.md sec.12).
		wayOutlines: {},
		areaOutlines: {},
	};
}

// Die Stueckliste Stueck fuer Stueck in die Datei und durch denselben Hash. Nie ein einziger
// Riesenstring durch Aneinanderhaengen -- und der Hash IST spaeter der ETag, er wird also
// hier gebildet und nie ein zweites Mal ueber 8 MB gerechnet.
async function schreibeAbzug(teile, pfad) {
	const hash = crypto.createHash("sha256");
	let bytes = 0;
	const strom = fs.createWriteStream(pfad);
	for (const stueck of teile) {
		const puffer = Buffer.from(stueck, "utf8");
		hash.update(puffer);
		bytes += puffer.length;
		if (!strom.write(puffer)) {
			await new Promise((r) => strom.once("drain", r));
		}
	}
	await new Promise((r, j) => { strom.end(); strom.on("finish", r); strom.on("error", j); });
	return { bytes: bytes, sha256: hash.digest("hex") };
}

async function main() {
	const ziel = argument("--out", path.join(REPO, "uploads", "svg-export"));
	const basis = argument("--base", process.env.AVESMAPS_BASE_URL || "https://avesmaps.de")
		.replace(/\/+$/, "");

	melde("Abzug bauen — Quelle " + basis);
	fs.mkdirSync(ziel, { recursive: true });

	melde("  Kartendaten …");
	const mapFeatures = await holen(basis + "/api/app/map-features.php");

	melde("  Herrschaftsgebiete …");
	const territories = await holen(basis + "/api/app/political-territories.php?action=layer");

	const oekosysteme = [];
	let ecoRevision = "";
	for (const art of ECOSYSTEM_ARTEN) {
		melde("  Landschaften (" + art + ") …");
		const teil = await holen(basis + "/api/app/ecosystem-areas.php?kind=" + encodeURIComponent(art));
		bauer.svgxAsFeatures(teil).forEach((f) => oekosysteme.push(f));
		if (teil && teil.revision) { ecoRevision = String(teil.revision); }
	}

	const token = svgxTokenLeser(path.join(REPO, "css", "base", "tokens.css"));
	const exportiert = new Date().toISOString();

	melde("  Datei bauen …");
	const ergebnis = bauer.svgxBuildDocument(Object.assign({}, ABZUG_EINSTELLUNGEN, {
		mapFeatures: mapFeatures,
		territories: territories,
		ecosystems: oekosysteme,
		// 🔴 Die Fassungsnummern kommen aus den Endpunkten selbst, nicht aus einer Uhr --
		// nur damit laesst sich beweisen, dass Vektor- und Rasterabzug dieselbe Welt zeigen.
		ecoRevision: ecoRevision,
		exportedAt: exportiert,
	}, vorgabeFarben(oekosysteme, token)));

	const kartenfassung = String((mapFeatures && mapFeatures.revision) || "0");
	const roh = path.join(ziel, "abzug.unfertig.svg");
	const mass = await schreibeAbzug(ergebnis.parts, roh);
	const datei = "abzug-" + mass.sha256.slice(0, 16) + ".svg";
	fs.renameSync(roh, path.join(ziel, datei));

	// 🔴 DER ZEIGER WIRD ZULETZT GESCHRIEBEN, und er zeigt auf einen Namen, den es vorher
	// nicht gab. Damit gibt es kein Fenster, in dem der Endpunkt eine halb hochgeladene
	// Datei ausliefert: bis `aktuell.json` umspringt, kennt niemand den neuen Namen.
	const zeiger = {
		datei: datei,
		dateiname: "avesmaps-karte-" + exportiert.slice(0, 10) + "-r" + kartenfassung
			+ "-" + ABZUG_EINSTELLUNGEN.dialect + ".svg",
		bytes: mass.bytes,
		sha256: mass.sha256,
		etag: '"' + mass.sha256 + '"',
		kartenfassung: kartenfassung,
		landschaftsfassung: ecoRevision,
		exportiert: exportiert,
		dialekt: ABZUG_EINSTELLUNGEN.dialect,
		groesse_px: ABZUG_EINSTELLUNGEN.sizePx,
		geglaettet: ABZUG_EINSTELLUNGEN.smooth ? "ja" : "nein",
		flaechen_geglaettet: ABZUG_EINSTELLUNGEN.smoothAreas ? "ja" : "nein",
		ebenen: ergebnis.stats,
	};
	fs.writeFileSync(path.join(ziel, "aktuell.json"), JSON.stringify(zeiger, null, 2) + "\n", "utf8");

	melde("Fertig: " + datei + " (" + (mass.bytes / (1024 * 1024)).toFixed(1) + " MB), "
		+ "Kartenfassung " + kartenfassung + ", Landschaftsfassung " + (ecoRevision || "—"));
	Object.entries(ergebnis.stats).forEach(([ebene, anzahl]) => melde("  " + ebene + ": " + anzahl));
	process.stdout.write(datei + "\n");
}

if (require.main === module) {
	main().catch((fehler) => {
		melde("FEHLGESCHLAGEN: " + (fehler && fehler.message ? fehler.message : fehler));
		process.exit(1);
	});
}

module.exports = {
	ABZUG_EINSTELLUNGEN: ABZUG_EINSTELLUNGEN,
	ECOSYSTEM_ARTEN: ECOSYSTEM_ARTEN,
	vorgabeFarben: vorgabeFarben,
	schreibeAbzug: schreibeAbzug,
};
