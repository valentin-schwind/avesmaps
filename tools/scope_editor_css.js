"use strict";

/*
 * Scopes the standalone political-territory editor stylesheets under a single
 * container selector so they can be loaded inline in the main map page without
 * the full-page reset (*, body, html, button, input ...) leaking onto the map.
 *
 * Hard safety property: EVERY emitted style-rule selector is prefixed with the
 * root. If anything is wrong, only the inline editor looks off — never the map.
 *
 * Run: node tools/scope_editor_css.js
 * Output: css/pages/political-territory-editor-inline.css
 */

const fs = require("fs");
const path = require("path");

const ROOT = "#political-territory-editor-host";
const REPO = path.resolve(__dirname, "..");
const SOURCES = [
	"css/pages/political-territory-editor.css",
	"css/pages/political-territory-editor-layout.css",
	"css/pages/political-territory-wiki-tree.css",
	// Das Quellen-Bauteil (mountFeatureSourceEditor) wird im Editor montiert. Seine Regeln muessen
	// MIT der Host-ID im Bauprodukt stehen -- sonst schlagen die gescopten Elementregeln des Editors
	// (button, select, a, p: (1,0,1) und mehr) jede Modulklasse (0,1,0), und der Kasten saehe hier
	// anders aus als an den acht anderen Montagestellen. Als LETZTE Quelle, damit die Modulregeln
	// bei gleicher Spezifitaet die spaeteren sind. Keine zweite Rezeptur: dieselbe Datei, eingefaltet.
	// (docs/superpowers/specs/2026-09-03-quellen-herrschaftsgebiete-design.md §2.2)
	// Der Rahmenkasten (css/components/rahmenkasten.css) aus demselben Grund -- der
	// Quellen-Kasten benutzt ihn, und seine Regeln muessen MIT der Host-ID im Bauprodukt
	// stehen. VOR feature-sources.css, damit dessen Spezifika bei gleicher Spezifitaet
	// die spaeteren sind.
	"css/components/rahmenkasten.css",
	"css/features/feature-sources.css",
];
const OUT = "css/pages/political-territory-editor-inline.css";

// Split a CSS string into top-level tokens: comments, at-rules, style rules.
// Brace/paren/string aware. Returns array of { type, raw, ... }.
function tokenize(css) {
	const tokens = [];
	let i = 0;
	const n = css.length;

	function skipString(quote) {
		i++; // opening quote
		while (i < n) {
			const c = css[i];
			if (c === "\\") { i += 2; continue; }
			if (c === quote) { i++; return; }
			i++;
		}
	}

	function readBlock() {
		// assumes css[i] === '{'; returns substring inclusive of matching '}'
		const start = i;
		let depth = 0;
		while (i < n) {
			const c = css[i];
			if (c === '"' || c === "'") { skipString(c); continue; }
			if (c === "/" && css[i + 1] === "*") { i += 2; while (i < n && !(css[i] === "*" && css[i + 1] === "/")) i++; i += 2; continue; }
			if (c === "{") { depth++; i++; continue; }
			if (c === "}") { depth--; i++; if (depth === 0) return css.slice(start, i); continue; }
			i++;
		}
		return css.slice(start, i);
	}

	while (i < n) {
		const c = css[i];
		// whitespace
		if (/\s/.test(c)) { let s = i; while (i < n && /\s/.test(css[i])) i++; tokens.push({ type: "ws", raw: css.slice(s, i) }); continue; }
		// comment
		if (c === "/" && css[i + 1] === "*") { let s = i; i += 2; while (i < n && !(css[i] === "*" && css[i + 1] === "/")) i++; i += 2; tokens.push({ type: "comment", raw: css.slice(s, i) }); continue; }
		// at-rule
		if (c === "@") {
			let s = i;
			// read prelude until { or ;
			while (i < n && css[i] !== "{" && css[i] !== ";") {
				const cc = css[i];
				if (cc === '"' || cc === "'") { skipString(cc); continue; }
				if (cc === "/" && css[i + 1] === "*") { i += 2; while (i < n && !(css[i] === "*" && css[i + 1] === "/")) i++; i += 2; continue; }
				i++;
			}
			const prelude = css.slice(s, i);
			if (css[i] === ";") { i++; tokens.push({ type: "at-statement", raw: prelude + ";" }); continue; }
			const block = readBlock(); // includes braces
			tokens.push({ type: "at-block", prelude, block });
			continue;
		}
		// style rule: read selector until '{'
		let s = i;
		while (i < n && css[i] !== "{") {
			const cc = css[i];
			if (cc === '"' || cc === "'") { skipString(cc); continue; }
			if (cc === "/" && css[i + 1] === "*") { i += 2; while (i < n && !(css[i] === "*" && css[i + 1] === "/")) i++; i += 2; continue; }
			if (cc === "}") { break; } // stray; bail
			i++;
		}
		const selector = css.slice(s, i);
		if (css[i] !== "{") { tokens.push({ type: "stray", raw: selector }); continue; }
		const block = readBlock();
		tokens.push({ type: "rule", selector, block });
	}
	return tokens;
}

// Split a selector list on top-level commas (paren/bracket/string aware).
function splitSelectorList(sel) {
	const out = [];
	let depth = 0, s = 0;
	for (let i = 0; i < sel.length; i++) {
		const c = sel[i];
		if (c === "(" || c === "[") depth++;
		else if (c === ")" || c === "]") depth--;
		else if (c === "," && depth === 0) { out.push(sel.slice(s, i)); s = i + 1; }
	}
	out.push(sel.slice(s));
	return out;
}

function prefixOneSelector(rawSel) {
	const lead = rawSel.match(/^\s*/)[0];
	const trail = rawSel.match(/\s*$/)[0];
	let sel = rawSel.trim();
	if (sel === "") return rawSel;

	// :root / html / body act as the container itself.
	if (sel === ":root" || sel === "html" || sel === "body") return lead + ROOT + trail;
	// "html ..." / "body ..." -> root + remainder
	let m = sel.match(/^(html|body)\b\s*(.*)$/s);
	if (m) {
		const rest = m[2];
		return lead + (rest ? ROOT + " " + rest : ROOT) + trail;
	}
	// universal reset: keep on container + descendants
	if (sel === "*") return lead + ROOT + ", " + ROOT + " *" + trail;
	if (/^\*::(before|after)$/.test(sel)) return lead + ROOT + sel.slice(1) + ", " + ROOT + " " + sel + trail;

	// default: descendant of root
	return lead + ROOT + " " + sel + trail;
}

function prefixSelectorList(sel) {
	return splitSelectorList(sel).map(prefixOneSelector).join(",");
}

function transformRules(tokens) {
	let out = "";
	for (const t of tokens) {
		if (t.type === "ws" || t.type === "comment" || t.type === "at-statement" || t.type === "stray") { out += t.raw; continue; }
		if (t.type === "rule") { out += prefixSelectorList(t.selector) + t.block; continue; }
		if (t.type === "at-block") {
			const name = (t.prelude.match(/^@([a-zA-Z-]+)/) || [, ""])[1].toLowerCase();
			if (name === "media" || name === "supports" || name === "container" || name === "layer") {
				// recurse into inner rules; strip the outer braces of block, transform, re-wrap
				const inner = t.block.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
				out += t.prelude + "{" + transformRules(tokenize(inner)) + "}";
			} else {
				// keyframes / font-face / page: leave inner untouched (no element selectors to leak)
				out += t.prelude + t.block;
			}
			continue;
		}
	}
	return out;
}

// Line endings: the body inherits them from the source files — a Windows checkout hands
// them over as CRLF, a Linux one as LF (`.gitattributes` says `*.css text`). So the
// generator commits to ONE form and writes its own lines — the header and the section
// markers — the same way. While those were hardcoded to "\n", the written file mixed both
// forms, and the byte-exact comparison in tools/__tests__/scope-editor-css.test.js was red
// on every Windows machine without a single character of styling being different.
const NL = fs.readFileSync(path.join(REPO, SOURCES[0]), "utf8").includes("\r\n") ? "\r\n" : "\n";

let combined = `/* AUTO-GENERATED by tools/scope_editor_css.js — do not edit by hand.${NL}   Scopes the standalone editor stylesheets under ${ROOT} for inline use. */${NL}`;
for (const src of SOURCES) {
	const css = fs.readFileSync(path.join(REPO, src), "utf8").replace(/^﻿/, "");
	combined += `${NL}/* ===== scoped from ${src} ===== */${NL}`;
	combined += transformRules(tokenize(css));
	combined += NL;
}

// One form for the whole file, whatever a single source may carry: a stylesheet saved with
// foreign line endings would otherwise mix them back into the product.
combined = combined.replace(/\r\n|\r|\n/g, NL);

fs.writeFileSync(path.join(REPO, OUT), combined, "utf8");

// Safety verification: re-tokenize OUTPUT at top level; every style rule selector
// (outside @keyframes) must reference ROOT. Report any leak.
const leaks = [];
function verify(tokens, insideKeyframes) {
	for (const t of tokens) {
		if (t.type === "rule" && !insideKeyframes) {
			for (const s of splitSelectorList(t.selector)) {
				if (s.trim() && !s.includes(ROOT)) leaks.push(s.trim());
			}
		}
		if (t.type === "at-block") {
			const name = (t.prelude.match(/^@([a-zA-Z-]+)/) || [, ""])[1].toLowerCase();
			const kf = name === "keyframes" || name === "-webkit-keyframes";
			const inner = t.block.replace(/^\s*\{/, "").replace(/\}\s*$/, "");
			verify(tokenize(inner), kf);
		}
	}
}
verify(tokenize(combined), false);

console.log("WROTE " + OUT + " (" + combined.length + " bytes)");
console.log("LEAKING_SELECTORS=" + leaks.length);
if (leaks.length) { console.log(leaks.slice(0, 40).join("\n")); process.exitCode = 2; }
