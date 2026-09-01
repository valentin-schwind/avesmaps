const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Der Bearbeiten-Kasten einer Quellenzeile -- und die ZWEI Reichweiten, die er sichtbar trennt.
// Entwurf: docs/quellen-bearbeiten-mockup.html (Owner-GO 01.09.2026)
//
// 💣 WARUM ES DAS GIBT (Owner-Meldung 01.09.2026): „Manuelle Quellen koennen nicht editiert
// werden." Es gab keinen Weg dafuer -- die Zeile trug nur ein `✕`.
//
// 💣 UND WARUM DAS FORMULAR GETEILT IST: `sources` ist ein KATALOG. Live gemessen am 01.09.2026
// (map-features.php, eine Anfrage): 59.538 Verknuepfungen auf 1.561 zitierte Katalogzeilen --
// Median 6 Objekte je Zeile, p95 146, MAXIMUM 1.549. `pages`/`reference_kind` gelten nur an
// diesem einen Objekt, die uebrigen fuenf Felder ueberall.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-bearbeiten-form.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");

// 🔴 feature-source-markup.js MUSS vorher im globalen Raum stehen: der Editor holt sich von dort
// die Lizenztafel und die Seitenkuerzung, und unter Node gibt es kein `window`, das beide teilt.
// Genau dieser zweite Ladeweg ist beim Umzug am 24.08.2026 fast durchgerutscht.
require(path.join(wurzel, "js/ui/feature-source-markup.js"));
const modul = require(path.join(wurzel, "js/review/review-feature-sources.js"));
const { renderFeatureSourceEditorHtml, renderFeatureSourceEditPanel,
	FEATURE_SOURCE_CONFIRM_THRESHOLD, featureSourceChangedFields,
	featureSourceLinkedMessage } = modul;

let pruefungen = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); pruefungen++; };
const gleich = (a, b, text) => { assert.deepStrictEqual(a, b, text); pruefungen++; };

const QUELLE = {
	source_id: 7, url: "https://beispiel.de/geographia", label: "Geographia Aventurica",
	type: "quellenband", official: true, origin: "manual", pages: "112",
	reference_kind: "ausfuehrlich", license: "", attribution: "",
	usage_count: 1042, wiki_owned: false,
};

// ══ A. Die Zeile bekommt ihr ✎ -- und die Puffer-Zeile NICHT ════════════════════════════════════
{
	const html = renderFeatureSourceEditorHtml({ wiki_url: "", sources: [QUELLE] });
	pruefe(html.includes('data-fs-edit-id="7"'), "die gespeicherte Zeile traegt einen Bearbeiten-Knopf");
	pruefe(html.includes('data-remove-source-id="7"'), "und weiterhin ihr Entfernen-Kreuz");

	// ⚠️ Eine noch nicht gespeicherte Zeile (Anlege-Puffer) haengt an keiner Katalogzeile: es gibt
	// weder eine Reichweite zu nennen noch etwas, das ein Server aendern koennte.
	const pending = renderFeatureSourceEditorHtml({
		wiki_url: "", sources: [Object.assign({}, QUELLE, { source_id: -1, origin: "pending" })],
	});
	pruefe(!pending.includes("data-fs-edit-id"), "eine Puffer-Zeile bekommt KEIN ✎");
	// 💣 Aber eine LEERE Zelle statt gar keiner -- sonst rutscht ihr `✕` unter die Lizenzspalte.
	pruefe(pending.includes("fs-row__edit-cell"), "sie behaelt aber die leere Rasterzelle");
}

// ══ B. Die Spaltenueberschrift traegt so viele Zellen wie die Zeile ═════════════════════════════
// 💣 Beide tragen dieselbe `grid-template-columns`. Fehlt oben eine Zelle, stehen ab da ALLE
// Ueberschriften neben ihren Spalten -- die Falle, an der die Spaltenliste am 24.08.2026 schon
// einmal haengen blieb.
{
	// ⚠️ Die Spaltenueberschrift steht heute nur ueber der Wiki-Gruppe (und erst ab zwei Zeilen) --
	// die von Hand gepflegte Liste darunter hat keine. Das ist Bestand, nicht Gegenstand dieses
	// Umbaus; gemessen wird hier, dass die Ueberschrift DORT die neue Spaltenzahl mittraegt.
	const html = renderFeatureSourceEditorHtml({
		wiki_url: "", sources: [
			Object.assign({}, QUELLE, { origin: "wiki_publication" }),
			Object.assign({}, QUELLE, { source_id: 8, origin: "wiki_publication" }),
		],
	});
	const kopf = html.match(/<div class="fs-col-heads"[^>]*>([\s\S]*?)<\/div>/);
	pruefe(kopf !== null, "es gibt eine Spaltenueberschrift (ab zwei Zeilen)");
	const zellen = (kopf[1].match(/<span/g) || []).length;
	const zeile = html.match(/<div class="fs-row" data-source-id="7">([\s\S]*?)(?=<div class="fs-row"|<div class="fs-row--add|$)/);
	const zeilenZellen = (zeile[1].match(/<(span|a|button)\b/g) || []).length;
	assert.strictEqual(zellen, 7, "die Ueberschrift hat sieben Zellen");
	pruefungen++;
	assert.strictEqual(zeilenZellen, 7, "und die Zeile ebenso -- sonst laufen die Spalten auseinander");
	pruefungen++;

	// Und das CSS muss dieselbe Zahl tragen. 🪤 Gezaehlt wird die SPALTENLISTE, nicht das Vorkommen
	// von „22px": eine Regel mit sechs Spalten sieht im Quelltext fast gleich aus.
	const css = lies("css/features/feature-sources.css");
	const vorlagen = css.match(/grid-template-columns:[^;]+;/g) || [];
	const breite = vorlagen.filter((v) => v.includes("minmax(0, 1fr) 104px"));
	pruefe(breite.length === 2, "genau zwei Regeln tragen die breite Vorlage (Zeile und Ueberschrift)");
	breite.forEach((v) => {
		pruefe((v.match(/22px/g) || []).length === 2, "und jede endet auf ZWEI 22px-Spalten: " + v.trim());
	});
	// 💣 Die Schwelle des schmalen Kastens wandert mit jeder Spalte mit. 104+104+74+150+22+22 plus
	// 6x8 Abstand = 524; bei den alten 640px blieben dem Titel 116 statt 146px, und im 500px-Dialog
	// war er beim ersten Entwurf wieder UNSICHTBAR -- das Bild aus Meldung #104, eine Spalte weiter.
	pruefe(/@container fs-liste \(max-width: 670px\)/.test(css),
		"die Container-Schwelle steht auf 670px, nicht mehr auf 640");
	const schmal = css.match(/@container fs-liste[^{]*\{[\s\S]*?grid-template-columns:([^;]+);/);
	pruefe((schmal[1].match(/22px/g) || []).length === 2,
		"und auch die schmale Vorlage hat beide Knopfspalten");
}

// ══ C. Der Kasten: zwei Bereiche, und der zweite nennt die ZAHL ═════════════════════════════════
{
	const panel = renderFeatureSourceEditPanel(QUELLE, (v) => String(v), (k, f) => f);
	pruefe(panel.includes("Nur an diesem Objekt"), "der erste Bereich sagt, dass er nur hier gilt");
	pruefe(panel.includes("Gilt für alle Objekte"), "der zweite, dass er ueberall gilt");
	// 🔴 Ohne die Zahl ist „gilt ueberall" ein Wort ohne Groesse.
	pruefe(panel.includes("1042"), "und er nennt die Zahl der zitierenden Objekte");
	pruefe((panel.match(/class="fs-edit__group"/g) || []).length === 2, "genau zwei Bereiche");
	// 🔴 Die Adresse IST seit dem 01.09.2026 ein Eingabefeld (Owner). Sie steht in der
	// Katalog-Haelfte -- sie gilt ueberall -- und ueber die volle Zeilenbreite, weil sie der
	// laengste Wert der Zeile ist.
	pruefe(/data-fs-field="url"/.test(panel), "die Adresse ist ein Eingabefeld");
	const adressStelle = panel.indexOf('data-fs-field="url"');
	pruefe(adressStelle > panel.indexOf("Gilt für alle Objekte"),
		"und sie steht in der KATALOG-Haelfte, nicht bei den Angaben dieses Objekts");
	pruefe(/fs-field--full/.test(panel), "sie bekommt eine eigene Zeile");

	// Jedes Feld traegt seinen Ausgangswert -- daraus liest der Speichern-Knopf, was sich WIRKLICH
	// geaendert hat.
	["pages", "reference_kind", "url", "label", "source_type", "license", "attribution", "is_official"]
		.forEach((feld) => {
			pruefe(new RegExp('data-fs-field="' + feld + '"').test(panel), feld + " ist im Kasten");
			const stelle = panel.indexOf('data-fs-field="' + feld + '"');
			pruefe(panel.slice(stelle, stelle + 200).includes("data-fs-orig="),
				feld + " traegt seinen Ausgangswert");
		});

	// 🔴 KEIN leerer Eintrag bei der Quellenart -- anders als in der Eingabezeile. Eine
	// Katalogzeile TRAEGT immer eine Art; „keine Aussage" hiesse hier loeschen, nicht korrigieren.
	const artBlock = panel.slice(panel.indexOf('data-fs-field="source_type"'));
	const artEnde = artBlock.indexOf("</select>");
	pruefe(!/<option value=""/.test(artBlock.slice(0, artEnde)),
		"die Quellenart hat KEINEN leeren Eintrag");
	// ⚠️ Die Lizenz dagegen SCHON: leer heisst dort „nicht erfasst", und das muss zuruecknehmbar sein.
	const lizBlock = panel.slice(panel.indexOf('data-fs-field="license"'));
	pruefe(/<option value=""/.test(lizBlock.slice(0, lizBlock.indexOf("</select>"))),
		"die Lizenz hat einen leeren Eintrag -- „nicht erfasst“ ist eine gueltige Rueckname");
}

// ══ D. Wiki-Publikation: zwei Felder fest, und der Grund steht daneben ══════════════════════════
// 💣 `avesmapsPublicationReconcileEntity` ruft den Upsert mit `refreshLabel = true` und schreibt
// `is_official` unbedingt -- eine Handkorrektur daran waere beim naechsten Lauf still
// zurueckgenommen. Also wird sie gar nicht erst angeboten.
{
	const panel = renderFeatureSourceEditPanel(
		Object.assign({}, QUELLE, { wiki_owned: true }), (v) => String(v), (k, f) => f);
	const feldIstGesperrt = (feld) => {
		const stelle = panel.indexOf('data-fs-field="' + feld + '"');
		return panel.slice(stelle, panel.indexOf(">", stelle)).includes("disabled");
	};
	// 🔴 Bei einer Wiki-Publikation gehoert die IDENTITAET dem Abgleich -- die Adresse wird dort
	// gar nicht erst als Feld angeboten, sondern nur als Text gezeigt.
	pruefe(!/data-fs-field="url"/.test(panel), "die Adresse einer Wiki-Publikation ist kein Feld");
	pruefe(/fs-edit__url/.test(panel), "sie steht dort als Text da");
	pruefe(feldIstGesperrt("label"), "der Titel ist an einer Wiki-Publikation fest");
	pruefe(feldIstGesperrt("is_official"), "„offiziell“ ebenso");
	// 🔴 Die drei anderen Katalogfelder fasst der Abgleich NICHT an.
	["source_type", "license", "attribution"].forEach((feld) => {
		pruefe(!feldIstGesperrt(feld), feld + " bleibt auch dort aenderbar");
	});
	["pages", "reference_kind"].forEach((feld) => {
		pruefe(!feldIstGesperrt(feld), feld + " gehoert diesem Objekt, nicht dem Werk");
	});
	// ⚠️ Nur ausgegraut waere von einem Fehler nicht zu unterscheiden -- der Grund gehoert daneben.
	pruefe(panel.includes("Wiki-Publikation") && panel.includes("Abgleich"),
		"und der Grund steht im Kasten -- nur ausgegraut waere von einem Fehler nicht zu unterscheiden");
	pruefe(panel.includes("fs-edit__note--locked"), "als eigener Hinweis, nicht als Warnung");
}

// ══ E. DIE TRAGENDE REGEL, wirklich AUSGEFUEHRT: nur Geaendertes reist mit ══════════════════════
// 🪤 Hier wird nicht der Quelltext gelesen, sondern der gerenderte Kasten in Formularelemente
// zerlegt und durch den ECHTEN Leser geschickt. Eine Zusicherung ueber den Quelltext haette den
// Fehler „das Formular schickt alles mit" nie gesehen -- genau der Fehler, in den
// `avesmapsUpsertGameLiterature` gelaufen ist.
function felderAusHtml(html) {
	const elemente = [];
	const re = /<(input|select)\b([^>]*)>/g;
	let treffer;
	while ((treffer = re.exec(html)) !== null) {
		const attrs = treffer[2];
		const hole = (name) => {
			const m = attrs.match(new RegExp(name + '="([^"]*)"'));
			return m ? m[1] : null;
		};
		if (hole("data-fs-field") === null) { continue; }
		const istCheckbox = /type="checkbox"/.test(attrs);
		// Bei einem <select> ist der Wert die als `selected` markierte Option -- den Rest des
		// Markups dafuer mitlesen.
		let wert = hole("value") || "";
		if (treffer[1] === "select") {
			const rest = html.slice(treffer.index);
			const sel = rest.slice(0, rest.indexOf("</select>")).match(/<option value="([^"]*)" selected>/);
			wert = sel ? sel[1] : "";
		}
		elemente.push({
			_name: hole("data-fs-field"),
			_orig: hole("data-fs-orig") || "",
			type: istCheckbox ? "checkbox" : "text",
			checked: /\bchecked\b/.test(attrs),
			value: wert,
			disabled: /\bdisabled\b/.test(attrs),
			getAttribute(a) { return a === "data-fs-field" ? this._name : (a === "data-fs-orig" ? this._orig : null); },
		});
	}
	return { querySelectorAll: () => elemente, _elemente: elemente };
}

{
	const panel = felderAusHtml(renderFeatureSourceEditPanel(QUELLE, (v) => String(v), (k, f) => f));
	pruefe(panel._elemente.length === 8, "acht Formularfelder im Kasten (6 Katalog + 2 Verknuepfung)");
	// Unberuehrt = NICHTS reist mit. Das ist die ganze Regel.
	gleich(featureSourceChangedFields(panel), {},
		"ein unberuehrter Kasten schickt KEIN einziges Feld -- sonst schriebe jedes Speichern alles");

	// Ein geaendertes Feld, und nur dieses.
	const seiten = panel._elemente.find((e) => e._name === "pages");
	seiten.value = "113-115";
	gleich(featureSourceChangedFields(panel), { pages: "113-115" }, "nur die geaenderte Seitenangabe reist mit");

	// Das Haekchen kommt als echter Boolean, nicht als "0"/"1".
	const offiziell = panel._elemente.find((e) => e._name === "is_official");
	offiziell.checked = false;
	gleich(featureSourceChangedFields(panel), { pages: "113-115", is_official: false },
		"„offiziell“ reist als Boolean, nicht als Zeichenkette");

	// Zurueckgestellt = wieder draussen. 💣 Sonst schriebe ein Hin-und-Zurueck denselben Wert an
	// bis zu 1.549 Objekten und stempelte ihn als Handarbeit.
	seiten.value = "112";
	offiziell.checked = true;
	gleich(featureSourceChangedFields(panel), {}, "zurueckgestellte Werte reisen nicht mehr mit");
}

{
	// ⚠️ Gesperrte Felder reisen NIE mit, auch wenn ihr Wert abweicht.
	const panel = felderAusHtml(renderFeatureSourceEditPanel(
		Object.assign({}, QUELLE, { wiki_owned: true }), (v) => String(v), (k, f) => f));
	panel._elemente.find((e) => e._name === "label").value = "Etwas anderes";
	gleich(featureSourceChangedFields(panel), {},
		"ein gesperrtes Feld reist nicht mit, auch wenn sein Wert abweicht");
}

// ══ F. Die Schwelle steht zweimal und muss zeichengleich sein ═══════════════════════════════════
// 💣 Der Server ist der Riegel, der Client ist die Frage davor. Laufen die Zahlen auseinander,
// fragt der Client umsonst oder der Server lehnt ab, was der Editor fuer bestaetigt haelt.
{
	const php = lies("api/_internal/app/feature-sources.php");
	const m = php.match(/const AVESMAPS_FEATURE_SOURCE_CONFIRM_THRESHOLD = (\d+);/);
	pruefe(m !== null, "die PHP-Schwelle steht als Konstante da");
	assert.strictEqual(Number(m[1]), FEATURE_SOURCE_CONFIRM_THRESHOLD,
		"JS- und PHP-Schwelle sind dieselbe Zahl");
	pruefungen++;

	// Und die beiden Feldlisten ebenso: wandert ein Feld von der einen Haelfte in die andere,
	// aendert sich, wie weit ein Klick reicht.
	const linkFelder = php.match(/AVESMAPS_FEATURE_SOURCE_LINK_FIELDS = \[([^\]]+)\]/)[1]
		.match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ""));
	gleich(linkFelder, ["pages", "reference_kind"],
		"die Verknuepfungs-Haelfte sind genau Seiten und Abdeckung");
	const katalogFelder = php.match(/AVESMAPS_FEATURE_SOURCE_CATALOG_FIELDS = \[([^\]]+)\]/)[1]
		.match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ""));
	gleich(katalogFelder, ["url", "label", "source_type", "license", "attribution", "is_official"],
		"und die Katalog-Haelfte die uebrigen sechs -- die Adresse seit dem 01.09.2026 dabei");

	// 🔴 Und die drei, die einer Wiki-Publikation gehoeren. Zwei davon (Titel, offiziell) schreibt
	// der Abgleich zurueck; bei der Adresse gehoert ihm die IDENTITAET -- gleiche Sperre, ANDERER
	// Grund, und wer die Liste je aufteilt, muss beide Gruende mitnehmen.
	const wikiFelder = php.match(/AVESMAPS_FEATURE_SOURCE_WIKI_OWNED_FIELDS = \[([^\]]+)\]/)[1]
		.match(/'([a-z_]+)'/g).map((x) => x.replace(/'/g, ""));
	gleich(wikiFelder, ["url", "label", "is_official"],
		"Adresse, Titel und offiziell gehoeren bei einer Wiki-Publikation dem Abgleich");

	// 🪤 Der Kasten muss GENAU diese Felder bauen -- keins mehr, keins weniger. Ohne diese
	// Gegenprobe koennte ein neues Serverfeld im Formular fehlen (unerreichbar) oder ein
	// Formularfeld ohne Serverpendant „unknown_field" ernten.
	const imKasten = (renderFeatureSourceEditPanel(QUELLE, (v) => String(v), (k, f) => f)
		.match(/data-fs-field="([a-z_]+)"/g) || []).map((s) => s.replace(/.*="|"/g, ""));
	gleich(imKasten.slice().sort(), linkFelder.concat(katalogFelder).sort(),
		"der Kasten baut genau die Felder, die der Server kennt");
}

// ══ G. „Verknüpft statt angelegt" — der Satz, den das Adressfeld schuldig blieb ═════════════════
// 🔴 Der Katalog dedupliziert über `url_hash` (UNIQUE): eine bekannte Adresse verknüpft mit der
// bestehenden Zeile. Richtig und gewollt, aber bis zum 01.09.2026 stumm — die Kachel „bestehende
// Quelle" daneben hängt an der NAMENS-Vorschlagsliste, nicht am Adressfeld.
{
	const tr = (k, f) => f;

	// ⚠️ Nichts sagen heißt „neu angelegt". Die frische Zeile zeigt genau das Eingetippte; eine
	// Meldung dafür wäre Lärm auf dem häufigen Weg. Dieselbe Regel wie bei `retyped`.
	gleich(featureSourceLinkedMessage(null, tr), "", "beim Anlegen wird geschwiegen");
	gleich(featureSourceLinkedMessage(undefined, tr), "", "und ohne Angabe erst recht");

	const schlicht = featureSourceLinkedMessage(
		{ source_id: 7, label: "Briefspiel (Weiden)", typed_label: "", official_changed: false }, tr);
	pruefe(schlicht.includes("gibt es schon"), "beim Verknüpfen wird es gesagt");
	pruefe(schlicht.includes("Briefspiel (Weiden)"), "und die getroffene Quelle beim Namen genannt");
	pruefe(!schlicht.includes("offiziell"), "ohne umgelegten Haken kein Wort darüber");

	// 🔴 Der Fall, der ohne Erklärung wie ein Fehler aussieht: man tippt „X", in der Liste steht „Y".
	const umbenannt = featureSourceLinkedMessage(
		{ source_id: 7, label: "Briefspiel (Weiden)", typed_label: "Baronie Altentrallop", official_changed: false }, tr);
	pruefe(umbenannt.includes("Baronie Altentrallop"), "der verworfene Titel wird genannt");
	pruefe(umbenannt.includes("Briefspiel (Weiden)"), "und der, unter dem die Zeile steht");

	// 💣 Der Haken „offiziell" überschreibt den Katalogwert unbedingt — hat er ihn umgelegt, gilt
	// das überall, wo die Quelle zitiert wird, und niemand hat es bewusst getan.
	const haken = featureSourceLinkedMessage(
		{ source_id: 7, label: "X", typed_label: "", official_changed: true, official_now: false }, tr);
	pruefe(haken.includes("offiziell"), "ein umgelegter Haken wird gemeldet");
	pruefe(haken.includes("überall"), "und dass es überall gilt");
	pruefe(haken.includes("nein"), "samt seinem neuen Wert");
	const hakenAn = featureSourceLinkedMessage(
		{ source_id: 7, label: "X", typed_label: "", official_changed: true, official_now: true }, tr);
	pruefe(hakenAn.includes("ja"), "auch in die andere Richtung");

	// ⚠️ Ohne tr() muss er trotzdem einen Satz liefern — der Vorgabe-Übersetzer gibt den Rückfall
	// zurück. Ein Bauteil, das ohne i18n-Schicht leer bleibt, wäre unter Node nicht prüfbar.
	pruefe(featureSourceLinkedMessage({ label: "X", typed_label: "" }).includes("gibt es schon"),
		"er kommt ohne injizierten Übersetzer aus");

	// 🪤 Und der Aufrufer muss ihn wirklich rufen — sonst ist der Bauer ein Vakuum. Kommentare
	// vorher weg: ein Quelltext-Test, der die ERKLÄRUNG trifft statt des Aufrufs, ist im Haus schon
	// mehrfach grün geblieben, ohne etwas zu prüfen.
	const quelle = lies("js/review/review-feature-sources.js")
		.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	pruefe(/zeigeVerknuepfung\(daten\);/.test(quelle), "der Add-Knopf ruft die Meldung");
	pruefe(/featureSourceLinkedMessage\(daten && daten\.linked, tr\)/.test(quelle),
		"und sie geht durch den geteilten Bauer");
	// 🔴 BEIDE Rückmeldungen, und die Verknüpfung ZULETZT: sie überschreibt die Umtypung in
	// derselben Zeile, weil sie die umfassendere Auskunft ist.
	pruefe(quelle.indexOf("zeigeVerknuepfung(daten);") > quelle.indexOf("zeigeUmtypung(daten);"),
		"die Verknüpfung wird nach der Umtypung gesetzt und gewinnt damit die Zeile");
}

console.log("OK -- " + pruefungen + " Zusicherungen erfuellt (Quellen bearbeiten, Formular).");
