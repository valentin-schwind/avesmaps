// Aufgabe 4 (Garetien-Importer vereint, 14.09.2026): „Übernommen" faltet laufübergreifend -- und
// dann darf der STAMM allein nicht mehr falten.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §6.8
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-uebernommen-falten-schluessel.test.js
//
// 💣 DER VERMERK TRAEGT NUR DEN STAMM (`verbund:<stamm>`, garetien-uebernahme.php). Seit der
// Server die Vermerke ALLER Laeufe liest, liegen im Reiter „Uebernommen" Verbuende aus Wochen
// nebeneinander -- ein Wald „Silker Hain" und ein Huegel „Silker Hain" fielen mit dem Stamm
// allein zu EINER Zeile zusammen, und ihr Haekchen waehlte beide. Dieselbe Regel wie beim
// Verbundschluessel (garetienVerbundSchluessel): Ebene UND Typ gehoeren hinein.
// ⚠️ Gemessen am ECHTEN Renderweg (avesmapsGaretienListeHolen -> #garetien-list), nicht am Quelltext.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api, dom } = ladeImporter(["garetien-listcol", "garetien-tabs"]);

function fragment(key, ebene, typ, stamm) {
	return { key: key, name: key, ebene: ebene, typ: typ, verbund_angelegt: stamm, stand: "uebernommen" };
}

// ---- A. Die reinen Funktionen ------------------------------------------------------------------
{
	const objekte = [
		fragment("wald1", "Waelder", "Wald", "Silker Hain"),
		fragment("huegel1", "Berge", "Huegel", "Silker Hain"),
		fragment("wald2", "Waelder", "Wald", "Silker Hain"),
		fragment("huegel2", "Berge", "Huegel", "Silker Hain"),
	];
	const gefaltet = api.garetienUebernommenFalten(objekte);
	gleich(gefaltet.map((o) => o.key).join(","), "wald1,huegel1",
		"gleicher Stamm, verschiedene Ebene/Typ -> ZWEI Zeilen, nicht eine");
	gleich(api.garetienUebernommenMitglieder(objekte[0], objekte).map((o) => o.key).join(","), "wald1,wald2",
		"🔴 die Mitglieder der gefalteten Zeile folgen DEMSELBEN Schluessel -- sonst waehlte das "
		+ "Haekchen des Waldes den Huegel mit");
	gleich(api.garetienUebernommenMitglieder(objekte[1], objekte).map((o) => o.key).join(","), "huegel1,huegel2",
		"und die Huegel-Zeile traegt nur ihre Huegel");
}

// Ohne Vermerk bleibt jedes Objekt sein eigenes Mitglied -- auch bei gleicher Ebene und gleichem Typ.
{
	const a = fragment("a", "Waelder", "Wald", "");
	const b = fragment("b", "Waelder", "Wald", "");
	gleich(api.garetienUebernommenFalten([a, b]).length, 2, "Objekte ohne Vermerk falten nie");
	gleich(api.garetienUebernommenMitglieder(a, [a, b]).length, 1, "und haben sich selbst als einziges Mitglied");
}

// ---- B. Der echte Renderweg ---------------------------------------------------------------------
function zeilenSchluessel() {
	const treffer = dom.html("#garetien-list").match(/data-key="[^"]*"/g) || [];
	return treffer.map((t) => t.slice('data-key="'.length, -1));
}

(async function () {
	api.garetienReiterSetzen("uebernommen");
	const objekte = [
		fragment("wald1", "Waelder", "Wald", "Silker Hain"),
		fragment("wald2", "Waelder", "Wald", "Silker Hain"),
		fragment("huegel1", "Berge", "Huegel", "Silker Hain"),
	];
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7, reiter: {} }) });
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
	gleich(zeilenSchluessel().join(","), "wald1,huegel1",
		"auf „Uebernommen\" stehen Wald-Verbund und Huegel gleichen Stammes als zwei Zeilen");
	gleich((dom.html("#garetien-list").match(/2 Fragmente/g) || []).length, 1,
		"die Marke zaehlt nur die Mitglieder IHRES Verbunds: der Wald traegt „2 Fragmente\", der Huegel keine");

	console.log("OK: " + checks + " Pruefungen (garetien-uebernommen-falten-schluessel)");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
