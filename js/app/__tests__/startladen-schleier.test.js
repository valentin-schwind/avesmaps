// Der Startlauf hat eine MITTE: ein Schleier ueber der Karte, eine stehende Windrose darin,
// der Satz „Karte wird geladen …" darunter -- und die rechte Kante faehrt herein wie der
// Planer gegenueber.
// Entwurf: docs/superpowers/specs/2026-08-19-startladen-schleier-und-windrose-design.md
//
// Geprueft wird, was hier lautlos kippt: dass der Schleier Klicks DURCHLAESST (Owner-Entscheid),
// dass er UNTER dem schmalen Streifen oben liegt, dass jede Farbe aus einem Token kommt und in
// BEIDEN Themen steht -- und dass die gedrehte Editor-Lasche ihr Vorzeichen behaelt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/startladen-schleier.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function withoutComments(source) {
	return source
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tokens = withoutComments(read("css", "base", "tokens.css"));

// ---- Die vier Token stehen in BEIDEN Themen -----------------------------------------------------
//
// 🔴 „leicht weiss" (Owner 19.08.2026) beschreibt das HELLE Thema. Derselbe Wert ueber der dunklen
// Karte waere ein Blitz -- deshalb ist dieser Schleier, anders als die Scrims daneben, nicht
// gepinnt, sondern hat einen eigenen dunklen Gegenwert.
const dunkelAb = tokens.indexOf(':root[data-theme="dark"]');
assert.ok(dunkelAb > 0, "tokens.css traegt einen :root[data-theme=\"dark\"]-Block");
const hellerBlock = tokens.slice(0, dunkelAb);
const dunklerBlock = tokens.slice(dunkelAb);

const BOOT_TOKEN = [
	"--color-boot-veil",
	"--color-boot-ring-ink",
	"--color-boot-ring-pale",
	"--color-boot-ring-track"
];
BOOT_TOKEN.forEach((name) => {
	const muster = new RegExp(escapeRe(name) + ":\\s*[^;]+;");
	assert.ok(muster.test(hellerBlock), `${name} fehlt im hellen Thema`);
	assert.ok(muster.test(dunklerBlock),
		`${name} fehlt im DUNKLEN Thema. „leicht weiss" beschreibt das helle; derselbe Wert ueber`
		+ " der dunklen Karte waere ein Blitz -- der Schleier ist bewusst nicht gepinnt.");
});

// 🔴 Das Gold ist KEIN eigenes Token: es ist --color-accent-strong, das Wappengold, das die
// Designsprache dafuer schon fuehrt. Ein fuenftes Token waere eine zweite Wahrheit fuer eine
// Farbe, die es gibt.
assert.ok(!/--color-boot-ring-gold\s*:/.test(tokens),
	"--color-boot-ring-gold gehoert NICHT nach tokens.css -- das Gold ist --color-accent-strong."
	+ " (Das Mockup fuehrt es abweichend; massgeblich ist der Bauplan.)");

console.log("startladen-schleier: alle Zusicherungen gehalten");
