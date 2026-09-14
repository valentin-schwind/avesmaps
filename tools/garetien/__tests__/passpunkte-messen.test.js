/**
 * Der Messlauf zum Einfügen (tools/garetien/passpunkte-messen.js), AUSGEFÜHRT statt gelesen.
 * Ausführen: node tools/garetien/__tests__/passpunkte-messen.test.js
 *
 * 💣 Das Skript ist das, was der Owner in die Browserkonsole kopiert -- und seine Sätze sind die
 * Auskunft, nach der er handelt. Zwei davon waren nach dem Messlauf vom 14.09.2026 falsch oder
 * fehlten: bei `invalid_action` nannte es einen längst gemergten Zweig, und von den 37
 * Falschpaaren sagte es nichts (es gab keinen Riegel, der sie hätte melden können).
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const QUELLE = fs.readFileSync(path.join(__dirname, "..", "passpunkte-messen.js"), "utf8");
let pruefungen = 0;

/** Fährt das Skript gegen eine gestellte Antwort und gibt alles zurück, was es in die Konsole schrieb. */
async function fahre(antwort, status) {
	const zeilen = [];
	const merke = (...teile) => zeilen.push(teile
		.map((t) => (typeof t === "string" ? t : JSON.stringify(t)))
		.join(" "));
	const kontext = vm.createContext({
		fetch: async () => ({ status, text: async () => JSON.stringify(antwort) }),
		console: { log: merke, warn: merke, error: merke, table: merke },
		navigator: { clipboard: { writeText: async () => {} } },
		window: {},
	});
	// Der Abschlusswert des Skripts ist die Zusage seiner async-IIFE.
	await vm.runInContext(QUELLE, kontext);
	return zeilen.join("\n");
}

const sauber = {
	ok: true,
	bericht: {
		lauf: 20, paare: 167, ihre_ortspunkte: 1990, unsere_ortspunkte: 3011,
		mehrdeutig_verworfen: 35, nur_bei_ihnen: 1750,
		falschpaare_verworfen: 2, falschpaar_schranke_meilen: 25,
		falschpaare: [
			{ name: "Dreiwegen", betrag: 1468.2, richtung: "Nord", dx: -12, dy: 1468 },
			{ name: "Waldheim", betrag: 402.1, richtung: "Ost", dx: 402, dy: 3 },
		],
		doppelungen_aufgeloest: ["Eslamsroden"],
	},
	selbstpruefung: { ok: true, n: 167, falschpaare: 2, median: 1.33, mittel: 2.97, p90: 8.03, max: 21.6, warnung: "" },
	urteil: { stufe: "traegt_nicht", satz: "Eine Korrektur aus Fixpunkten TRAEGT NICHT." },
	nachbarprobe: [], globaler_versatz: {}, west_sued_trend: {}, residuen: [],
};

(async () => {
	// ── 1. Der Riegel wird VORGELESEN, nicht verschwiegen ────────────────────────────────────
	const ok = await fahre(sauber, 200);
	assert.ok(/Falschpaare[^\n]*: 2$/m.test(ok), "die Zahl der Falschpaare steht da:\n" + ok);
	pruefungen++;
	assert.ok(ok.includes("Dreiwegen") && ok.includes("1468"), "mit Namen und Betrag:\n" + ok);
	pruefungen++;
	assert.ok(ok.includes("Eslamsroden"), "die aufgelöste Doppelung wird genannt:\n" + ok);
	pruefungen++;
	// 💣 Der Median allein hat am 14.09.2026 "bestanden" gesagt -- das Mittel gehört daneben.
	assert.ok(ok.includes("Mittel 2.97"), "die Selbstprüfung nennt das Mittel:\n" + ok);
	pruefungen++;

	// ── 2. `invalid_action` nennt keinen Zweig, den es nicht mehr gibt ─────────────────────────
	const alt = await fahre({ ok: false, error: { code: "invalid_action", message: "Unbekannte Aktion." } }, 400);
	assert.ok(!alt.includes("claude/garetien-coordinate-transformation"),
		"der Zweig ist seit dem 14.09.2026 gemergt und darf nicht mehr genannt werden:\n" + alt);
	pruefungen++;
	assert.ok(alt.includes("Deploy"), "der Grund bleibt: der Server hat den Stand noch nicht:\n" + alt);
	pruefungen++;

	// ── 3. Bei offener Selbstprüfung gibt es kein Urteil ──────────────────────────────────────
	const verdacht = await fahre({
		...sauber,
		selbstpruefung: { ...sauber.selbstpruefung, ok: false, warnung: "3 Paare liegen ueber 25 Meilen -- nicht abgetrennt." },
	}, 200);
	assert.ok(verdacht.includes("KEIN URTEIL"), "das Urteil wird zurückgehalten:\n" + verdacht);
	pruefungen++;
	assert.ok(!verdacht.includes("TRAEGT_NICHT"), "und kein Banner steht darunter:\n" + verdacht);
	pruefungen++;

	console.log(`OK: ${pruefungen} Pruefungen`);
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
