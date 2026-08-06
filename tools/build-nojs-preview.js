// Baut aus index.html eine Seite, die zeigt, was ein Besucher OHNE JavaScript sieht.
//
// Warum ueberhaupt: der <noscript>-Inhalt ist im Browser mit JavaScript unsichtbar UND ungeparst --
// er laesst sich also nicht in der laufenden Seite pruefen. Hier wird genau derselbe Quelltext
// (Stil aus dem <head>-<noscript>, Markup aus dem <body>-<noscript>) in eine gewoehnliche Seite
// gehoben, mit denselben Stylesheets. Was hier steht, steht dort.
//
// Aufruf vom Repo-Wurzelverzeichnis:  node tools/build-nojs-preview.js
// Ergebnis: verify-nojs-hinweis.html (ungetrackt), ueber einen HTTP-Server mit Repo-Wurzel ansehen.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// 💣 Erst die HTML-Kommentare weg, DANN suchen: index.html erklaert an mehreren Stellen, was ein
// noscript-Block tut, und eine solche Erwaehnung im Fliesstext eines Kommentars wurde sonst als
// oeffnendes Element gelesen -- der Auszug begann mitten im Kommentar und trug ein unverschlossenes
// style-Element davon.
const withoutComments = index.replace(/<!--[\s\S]*?-->/g, "");
const blocks = [...withoutComments.matchAll(/<noscript>([\s\S]*?)<\/noscript>/g)].map((m) => m[1]);
if (blocks.length !== 2) {
	throw new Error("index.html sollte genau zwei <noscript> tragen (Stil im <head>, Riegel im <body>), gefunden: " + blocks.length);
}
const [headBlock, bodyBlock] = blocks;
if (!/<style>/.test(headBlock)) { throw new Error("das erste <noscript> traegt keinen <style> -- Reihenfolge vertauscht?"); }
if (!/nojs__card/.test(bodyBlock)) { throw new Error("das zweite <noscript> traegt den Riegel nicht"); }

const links = [...index.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
	.map((m) => '\t<link rel="stylesheet" href="/' + m[1] + '">')
	.join("\n");

const out = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Vorschau &middot; index.html ohne JavaScript</title>
<meta name="robots" content="noindex" />
<!-- ERZEUGT von tools/build-nojs-preview.js aus index.html. Nicht von Hand aendern. -->
${links}
${headBlock.trim()}
</head>
<body>
${bodyBlock.trim()}
<div id="map" style="width: 100%; height: 100%"></div>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "verify-nojs-hinweis.html"), out);
console.log("verify-nojs-hinweis.html geschrieben (" + (out.length / 1024).toFixed(1) + " KB)");
