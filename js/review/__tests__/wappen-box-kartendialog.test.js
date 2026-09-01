// Die Wappen-Box des Karten-Bearbeiten-Dialogs -- AUSGEFUEHRT, nicht gelesen.
//
// 🔴 WARUM ES DIESEN TEST GIBT: bis zum 01.09.2026 konnte diese Box weniger als der Ortseditor
// (Owner: „wappen können im editor hochgeladen/ersetzt/entfernt werden, im direkten editor aber
// nicht") -- nur Datei, kein SVG, keine Bild-URL, keine Lizenzangaben. Das Schlimmste daran war
// nicht die Unbequemlichkeit: ohne Lizenzfeld schickte sie fest license:"unknown_other", und genau
// diesen Wert wirft api/app/map-features.php wieder aus der Kartennutzlast
// (avesmapsSettlementCoatIsPublic). Der Upload gelang, der Editor sah das Bild, und auf der
// oeffentlichen Karte erschien es NIE -- ohne Fehler, ohne Meldung.
//
// 💣 GEPRUEFT WIRD DIE ABGESCHICKTE FormData, nicht der Quelltext. Die tragende Zusage lautet
// „Lizenz, Urheber und Kommentar reisen bei JEDEM Weg mit" -- eine Aussage ueber das, was den
// Browser verlaesst. Ein Quelltexttest (`includes("form.append(\"license\"")`) haette auch dann
// angeschlagen, wenn die Zeile in einem Zweig steht, den niemand nimmt; genau diese Vakuum-Falle
// hat das Haus bei applyServerTravelHours schon einmal bezahlt.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/review/__tests__/wappen-box-kartendialog.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

let pruefungen = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); pruefungen++; };
const pruefeGleich = (a, b, text) => { assert.strictEqual(a, b, text); pruefungen++; };

// ---- Ein Mini-DOM, gerade so viel, wie die drei Funktionen anfassen -------------------------
function macheElement(id, extra) {
	return Object.assign({
		id,
		value: "",
		textContent: "",
		innerHTML: "",
		hidden: false,
		disabled: false,
		className: "",
		files: null,
		attribute: {},
		setAttribute(name, wert) { this.attribute[name] = wert; },
		querySelector() { return null; },
		contains() { return true; },
	}, extra || {});
}

const elemente = new Map();
function neuesDokument() {
	elemente.clear();
	for (const id of [
		"settlement-coat-section", "settlement-coat-preview", "settlement-coat-status",
		"settlement-coat-adopt", "settlement-coat-remove", "settlement-coat-upload",
		"settlement-coat-editor", "settlement-coat-file", "settlement-coat-url",
		"settlement-coat-fields", "settlement-coat-hint", "settlement-coat-error",
		"settlement-coat-save", "settlement-coat-cancel", "location-edit-public-id",
	]) {
		elemente.set(id, macheElement(id));
	}
	elemente.get("settlement-coat-section").dataset = { publicId: "" };
	// Die drei Lizenzfelder haengen im Browser als Markup in #settlement-coat-fields; hier liefert
	// der Kasten sie direkt aus, damit saveSettlementCoat sie ueber querySelector findet.
	const felder = elemente.get("settlement-coat-fields");
	felder.kinder = {
		"[data-coat-license]": macheElement("lic"),
		"[data-coat-author]": macheElement("aut"),
		"[data-coat-note]": macheElement("not"),
	};
	felder.querySelector = (sel) => felder.kinder[sel] || null;
	return felder;
}

// ---- Globals, die review-locations.js beim Laden und Laufen erwartet -------------------------
let letzteFormData = null;
let fetchAufrufe = 0;
let fetchAntwort = { ok: true };
let letzterToast = "";

class TestFormData {
	constructor() { this.eintraege = new Map(); }
	append(name, wert) { this.eintraege.set(name, wert); }
	get(name) { return this.eintraege.has(name) ? this.eintraege.get(name) : null; }
	has(name) { return this.eintraege.has(name); }
}

global.document = {
	addEventListener() {},
	getElementById: (id) => elemente.get(id) || null,
	querySelector: () => null,
};
global.window = { confirm: () => true };
global.FormData = TestFormData;
global.fetch = async (url, optionen) => {
	fetchAufrufe++;
	if (optionen && optionen.body instanceof TestFormData) { letzteFormData = optionen.body; }
	return { json: async () => fetchAntwort };
};
global.showFeedbackToast = (text) => { letzterToast = text; };
global.apiErrorMessage = (data, rueckfall) => (data && data.error && data.error.message) || rueckfall;
global.escapeHtml = (wert) => String(wert == null ? "" : wert);
global.avesmapsMediaLicenseIsPublic = require(path.join(ROOT, "js", "app", "media-licenses.js")).avesmapsMediaLicenseIsPublic;

// Spion auf den geteilten Markup-Bauer: die Werte, mit denen der Kasten aufgeht, MUESSEN aus dem
// gelesenen coat_info kommen (siehe Abschnitt 5).
let letzteFeldwerte = null;
global.avesmapsMediaLicenseFieldsMarkup = (werte) => { letzteFeldwerte = werte; return "<div class='mlf-fields'></div>"; };

const modul = require(path.join(ROOT, "js", "review", "review-locations.js"));
const { saveSettlementCoat, renderSettlementCoatSection, openSettlementCoatEditor } = modul;

pruefe(typeof saveSettlementCoat === "function", "saveSettlementCoat wird nicht exportiert -- der Test koennte nur Quelltext lesen");

function bereite({ publicId = "L-1", current = null, coatNone = false } = {}) {
	neuesDokument();
	letzteFormData = null;
	fetchAufrufe = 0;
	fetchAntwort = { ok: true, coat: { url: "/uploads/wappen/own/x.png" }, revision: 7 };
	elemente.get("settlement-coat-section").dataset.publicId = publicId;
	// coat_info, wie renderSettlementCoatSection es hinterlassen haette.
	modulZustandSetzen(current, coatNone);
}

// settlementCoatInfo ist Modulzustand; gesetzt wird er ueber den echten Leseweg.
async function modulZustandSetzen(current, coatNone) {
	const alt = global.fetch;
	global.fetch = async () => ({ json: async () => ({ ok: true, current, wiki: null, coat_none: coatNone }) });
	await renderSettlementCoatSection(elemente.get("settlement-coat-section").dataset.publicId);
	global.fetch = alt;
	letzteFormData = null;
	fetchAufrufe = 0;
}

(async () => {

// ---- 1. Hochladen einer Datei: die drei Angaben reisen mit -----------------------------------
neuesDokument();
elemente.get("settlement-coat-section").dataset.publicId = "L-1";
await modulZustandSetzen(null, false);
fetchAntwort = { ok: true, coat: { url: "/uploads/wappen/own/x.svg" }, revision: 7 };
elemente.get("settlement-coat-file").files = ["EINE-DATEI"];
elemente.get("settlement-coat-fields").kinder["[data-coat-license]"].value = "public_domain";
elemente.get("settlement-coat-fields").kinder["[data-coat-author]"].value = "VolkoV";
elemente.get("settlement-coat-fields").kinder["[data-coat-note]"].value = "aus dem Wiki";
await saveSettlementCoat();

pruefeGleich(fetchAufrufe > 0, true, "beim Hochladen wurde gar nichts abgeschickt");
pruefeGleich(letzteFormData.get("coat"), "EINE-DATEI", "die gewaehlte Datei reist nicht mit");
pruefeGleich(letzteFormData.has("coat_url"), false, "Datei UND Adresse zugleich -- der Server nimmt die Datei, die Adresse waere still ignoriert");
pruefeGleich(letzteFormData.get("license"), "public_domain",
	"die gewaehlte Lizenz reist nicht mit. Ohne sie faellt der Endpunkt auf 'ai_generated' zurueck "
	+ "-- und der alte Weg schickte fest 'unknown_other', womit map-features.php das Wappen wieder "
	+ "aus der Kartennutzlast warf (der Fehler, um den es hier geht).");
pruefeGleich(letzteFormData.get("author"), "VolkoV", "der Urheber reist nicht mit -- beim Ersetzen waere er danach leer");
pruefeGleich(letzteFormData.get("note"), "aus dem Wiki", "der Kommentar reist nicht mit -- beim Ersetzen waere er danach leer");

// ---- 2. Bild-Adresse statt Datei -------------------------------------------------------------
neuesDokument();
elemente.get("settlement-coat-section").dataset.publicId = "L-1";
await modulZustandSetzen(null, false);
fetchAntwort = { ok: true };
elemente.get("settlement-coat-url").value = "https://example.invalid/wappen.png";
elemente.get("settlement-coat-fields").kinder["[data-coat-license]"].value = "ai_generated";
await saveSettlementCoat();

pruefeGleich(letzteFormData.get("coat_url"), "https://example.invalid/wappen.png", "die Bild-Adresse reist nicht mit");
pruefeGleich(letzteFormData.has("coat"), false, "ohne Datei darf kein leeres coat-Feld mitreisen");
pruefeGleich(letzteFormData.get("license"), "ai_generated", "auch auf dem Adress-Weg muss die Lizenz mitreisen");

// ---- 3. NUR die Angaben (Fall #112): weder coat noch coat_url --------------------------------
// 💣 Genau daran erkennt der Server den dritten Weg (avesmapsSettlementCoatMetadataOnly). Schickte
// der Client hier ein leeres `coat_url` mit, liefe die Anfrage in den Bild-Zweig -- und der baut
// den coat-Block NEU auf, inklusive Loeschen der alten Bilddatei.
neuesDokument();
elemente.get("settlement-coat-section").dataset.publicId = "L-1";
await modulZustandSetzen({ url: "/uploads/wappen/own/alt.png", source: "own", license_status: "ai_generated" }, false);
fetchAntwort = { ok: true };
elemente.get("settlement-coat-fields").kinder["[data-coat-license]"].value = "permission_granted";
elemente.get("settlement-coat-fields").kinder["[data-coat-author]"].value = "Nottel";
await saveSettlementCoat();

pruefeGleich(fetchAufrufe > 0, true, "der Weg „nur die Angaben\" hat gar nichts abgeschickt");
pruefeGleich(letzteFormData.has("coat"), false, "auf dem Weg „nur die Angaben\" darf KEIN coat mitreisen");
pruefeGleich(letzteFormData.has("coat_url"), false, "auf dem Weg „nur die Angaben\" darf KEIN coat_url mitreisen");
pruefeGleich(letzteFormData.get("license"), "permission_granted", "die geaenderte Lizenz kam nicht an");
pruefeGleich(letzteFormData.get("author"), "Nottel", "der geaenderte Urheber kam nicht an");
pruefeGleich(letzterToast, "Angaben gespeichert.", "die Rueckmeldung darf nicht „hochgeladen\" sagen, wenn kein Bild reiste");

// ---- 4. Nichts gewaehlt und noch kein Wappen: gar keine Anfrage ------------------------------
neuesDokument();
elemente.get("settlement-coat-section").dataset.publicId = "L-1";
await modulZustandSetzen(null, false);
await saveSettlementCoat();

pruefeGleich(fetchAufrufe, 0, "ohne Bild und ohne bestehendes Wappen gibt es nichts zu beschreiben -- es darf keine Anfrage rausgehen");
pruefeGleich(elemente.get("settlement-coat-error").hidden, false, "die Absage muss im Kasten stehen, nicht verschluckt werden");

// ---- 5. Der Editor geht mit dem GESPEICHERTEN Stand auf --------------------------------------
// 💣 DIE NAHT, an der „Bild ersetzen\" sonst ein stiller Datenverlust waere: der Upload-Zweig des
// Endpunkts baut den coat-Block neu auf. Startete das Formular leer, ginge beim blossen Austausch
// des Bildes die gepflegte Lizenz mit Urheber und Kommentar verloren.
neuesDokument();
elemente.get("settlement-coat-section").dataset.publicId = "L-1";
letzteFeldwerte = null;
await modulZustandSetzen({
	url: "/uploads/wappen/own/alt.png", source: "own", license_status: "permission_granted",
	author: "Nottel", note: "Freigabe per Mail", uploaded_by: "vali", uploaded_at: "2026-08-30T10:00:00Z",
}, false);
// 🪤 Erst FUELLEN, dann oeffnen. Ohne das steht unten „das Adressfeld muss leer sein" ueber einem
// Feld, das nie etwas enthielt -- die Zusicherung ist dann wahr, ohne etwas zu pruefen. Die
// Mutationsprobe hat genau diese eine Luecke gefunden, waehrend 16 andere Mutationen fielen.
elemente.get("settlement-coat-url").value = "https://example.invalid/vom-vorigen-ort.png";
elemente.get("settlement-coat-file").files = ["EINE-ALTE-DATEI"];
elemente.get("settlement-coat-error").hidden = false;
elemente.get("settlement-coat-error").textContent = "eine alte Absage";
openSettlementCoatEditor();

pruefe(letzteFeldwerte !== null, "der Editor baut die Lizenzreihe nicht -- avesmapsMediaLicenseFieldsMarkup wurde nie gerufen");
pruefeGleich(letzteFeldwerte.license, "permission_granted", "der Editor geht nicht mit der GESPEICHERTEN Lizenz auf");
pruefeGleich(letzteFeldwerte.author, "Nottel", "der Editor geht nicht mit dem gespeicherten Urheber auf");
pruefeGleich(letzteFeldwerte.note, "Freigabe per Mail", "der Editor geht nicht mit dem gespeicherten Kommentar auf");
pruefeGleich(letzteFeldwerte.uploaded_by, "vali", "die Protokollzeile bekommt ihren Namen nicht");
pruefeGleich(elemente.get("settlement-coat-editor").hidden, false, "der Editor klappt nicht auf");
pruefeGleich(elemente.get("settlement-coat-save").textContent, "Wappen speichern",
	"mit vorhandenem Wappen heisst der Knopf „Wappen speichern\" -- „hochladen\" verschweigt, dass man ihn auch ohne neue Datei druecken darf");
// 🔴 Und er sagt WAS er speichert. Direkt darunter steht die Speicherleiste des Ortes mit ihrem
// eigenen gefuellten „Speichern"; in der Abnahme standen beide rund 50 px uebereinander und waren
// nicht zu unterscheiden.
pruefe(/Wappen/.test(elemente.get("settlement-coat-save").textContent),
	"der Knopf des Wappen-Kastens muss sein Objekt nennen -- sonst steht er ununterscheidbar ueber dem „Speichern\" des Ortsformulars");
pruefeGleich(elemente.get("settlement-coat-url").value, "",
	"das Adressfeld muss beim Oeffnen leer sein -- eine stehengebliebene Adresse verpasst dem NAECHSTEN Ort ein fremdes Wappen");
pruefeGleich(elemente.get("settlement-coat-file").value, "",
	"die Datei-Auswahl muss beim Oeffnen leer sein -- sonst reist die Datei des vorigen Ortes mit");
pruefeGleich(elemente.get("settlement-coat-error").hidden, true,
	"eine alte Absage muss beim Oeffnen verschwinden -- sonst steht sie ueber einem frischen Formular");

// ---- 6. Der dritte Zustand wird BENANNT ------------------------------------------------------
// 🔴 Ohne ihn aendert sich nach einem Klick auf „Entfernen\" sichtbar nichts, und der Knopf ist von
// einem kaputten nicht zu unterscheiden.
neuesDokument();
elemente.get("settlement-coat-section").dataset.publicId = "L-1";
await modulZustandSetzen(null, true);
pruefe(/ausdrücklich so gesetzt/.test(elemente.get("settlement-coat-status").textContent),
	"bei coat_none sagt der Kasten dasselbe wie bei einem Ort, der nie ein Wappen hatte: " + elemente.get("settlement-coat-status").textContent);

// ---- 7. Eine stille Lizenz wird BENANNT ------------------------------------------------------
neuesDokument();
elemente.get("settlement-coat-section").dataset.publicId = "L-1";
await modulZustandSetzen({ url: "/uploads/wappen/own/x.png", source: "own", license_status: "unknown_other" }, false);
pruefe(/erscheint es nicht/.test(elemente.get("settlement-coat-status").textContent),
	"ein Wappen mit stiller Lizenz sieht im Editor aus wie jedes andere -- auf der Karte erscheint es aber nicht: "
	+ elemente.get("settlement-coat-status").textContent);
pruefeGleich(elemente.get("settlement-coat-remove").disabled, false, "mit aktivem Wappen muss „Entfernen\" bedienbar sein");

// ---- 8. Das Markup: SVG, Adressfeld, dauerhaft sichtbares „Entfernen" ------------------------
const indexHtml = lies("index.html");
const box = indexHtml.slice(indexHtml.indexOf('id="settlement-coat-section"'), indexHtml.indexOf('id="location-edit-status"'));

pruefe(/id="settlement-coat-file"[^>]*accept="[^"]*image\/svg\+xml/.test(box),
	"der Datei-Waehler laesst kein SVG zu -- der Endpunkt nimmt es seit 23.08.2026 an, und die Zwergenreich-Wappen SIND SVG");
pruefe(/id="settlement-coat-url"/.test(box), "das Feld fuer eine Bild-Adresse fehlt");
pruefe(/id="settlement-coat-fields"/.test(box), "der Platz fuer Lizenz/Urheber/Kommentar fehlt");
pruefe(!/id="settlement-coat-remove"[^>]*\shidden/.test(box),
	"„Entfernen\" ist wieder nur bei aktivem Wappen sichtbar -- damit laesst sich der dritte Zustand "
	+ "(coat_none) genau im Fall nicht setzen, fuer den es ihn gibt: ein Ort mit nicht gemeinfreiem Wiki-Wappen");
pruefe(/<script src="js\/app\/media-licenses\.js"><\/script>[\s\S]{0,200}<script src="js\/ui\/media-license-fields\.js"><\/script>/.test(indexHtml),
	"index.html laedt den Lizenzkatalog nicht VOR dem Markup-Bauer -- media-license-fields.js liest ihn beim Laden");

// ---- 9. Der Server sagt, ob „kein Wappen\" gewollt ist ---------------------------------------
const settlementsPhp = lies("api", "_internal", "wiki", "settlements.php");
pruefe(/'coat_none' => \(\$props\['coat_none'\] \?\? false\) === true/.test(settlementsPhp),
	"coat_info meldet den dritten Zustand nicht -- der Client kann „hier war nie eines\" nicht von "
	+ "„hier soll keines sein\" unterscheiden");

console.log(`wappen-box-kartendialog: ${pruefungen} Pruefungen bestanden.`);

})().catch((fehler) => { console.error(fehler); process.exit(1); });
