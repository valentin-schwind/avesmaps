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
// (map-features.php, eine Anfrage): 59.538 Verknuepfungen auf 1.240 zitierte Katalogzeilen --
// Median 14 Objekte je Zeile, p95 171, MAXIMUM 1.549. `pages`/`reference_kind` gelten nur an
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

// ══ C. Der Kasten: DREI Bereiche, und jeder nennt seine Reichweite ══════════════════════════════
{
	const panel = renderFeatureSourceEditPanel(QUELLE, (v) => String(v), (k, f) => f);
	pruefe(panel.includes("Nur an diesem Objekt"), "der erste Bereich sagt, dass er nur hier gilt");
	pruefe(panel.includes("Gilt für alle Objekte"), "der zweite, dass er ueberall gilt");
	// 🔴 Ohne die Zahl ist „gilt ueberall" ein Wort ohne Groesse.
	pruefe(panel.includes("1042"), "und er nennt die Zahl der zitierenden Objekte");
	// 🪤 HIER STAND „genau zwei Bereiche", und das war bis zum 02.09.2026 richtig. Seither gehoeren
	// Art, Lizenz, Nennung und Kanon dem KORPUS: eine Aenderung daran trifft jede Quelle des Wirts.
	// In der zweiten Gruppe gelassen, versprach deren Ueberschrift „gilt fuer alle Objekte, die
	// diese Quelle zitieren -- zurzeit nur dieses Objekt", waehrend ein Griff zur Lizenz 39 Quellen
	// umgeschrieben haette (Owner-Bild 02.09.2026). Die dritte Gruppe ist die Berichtigung.
	// 🪤 03.09.2026: dieselben drei Bereiche, aber aus DEMSELBEN Bauteil wie die Eingabezeile
	// (`.fs-scope`). `.fs-edit__group` war eine von vier Rezepturen fuer eine Form.
	pruefe((panel.match(/class="fs-scope"/g) || []).length === 3,
		"drei Bereiche: diese Quelle · der ganze Korpus · dieses Objekt");
	pruefe(!/fs-edit__group|fs-edit__head|fs-edit__title/.test(panel),
		"und keine der alten Rezepturen ist uebrig");
	// 🔴 Und die Zuordnung ist die eigentliche Aussage -- sie muss der des Servers entsprechen
	// (AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS), sonst sagt die Oberflaeche etwas anderes als der
	// Schreiber tut.
	// 🪤 03.09.2026: die Korpusfelder heissen `corpus_*` und sagen damit SELBST, wohin sie
	// gehoeren -- vorher entschied das ihre POSITION im Markup, und die ist beim naechsten Umbau
	// eine andere. Der blanke Name gehoert seither der Abweichung im dritten Rahmen.
	{
		const korpusRahmen = panel.indexOf("data-fs-korpus-gruppe");
		const objektRahmen = panel.indexOf("Nur an diesem Objekt");
		pruefe(korpusRahmen > 0 && objektRahmen > korpusRahmen,
			"der Korpusrahmen steht vor dem Objektrahmen");
		["source_type", "license", "attribution", "is_official", "form"].forEach((f) => {
			const i = panel.indexOf('data-fs-field="corpus_' + f + '"');
			pruefe(i > korpusRahmen && i < objektRahmen, f + " steht als corpus_" + f + " im Korpusrahmen");
		});
		// 🔴 Und die Abweichung traegt den BLANKEN Namen -- so landet ihr Wert in `sources`,
		// sobald `own_fields` ihn nennt. Sie steht im dritten Rahmen.
		["source_type", "license", "attribution"].forEach((f) => {
			pruefe(panel.indexOf('data-fs-abw-wert="' + f + '"') > objektRahmen,
				f + " weicht im Objektrahmen ab");
		});
		["url", "label"].forEach((f) => {
			pruefe(panel.indexOf('data-fs-field="' + f + '"') < korpusRahmen,
				f + " steht in der Quellen-Gruppe davor");
		});
		["pages", "reference_kind"].forEach((f) => {
			pruefe(panel.indexOf('data-fs-field="' + f + '"') > objektRahmen,
				f + " steht im Objektrahmen");
		});
	}
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
	// 🪤 03.09.2026: die Korpusfelder heissen `corpus_*`, die Abweichung traegt den blanken
	// Namen. Beide muessen ihren Ausgangswert tragen -- daraus liest der Speichern-Knopf, was sich
	// WIRKLICH geaendert hat.
	["pages", "reference_kind", "url", "label", "no_corpus",
		"corpus_source_type", "corpus_license", "corpus_attribution", "corpus_is_official", "corpus_form"]
		.forEach((feld) => {
			pruefe(new RegExp('data-fs-field="' + feld + '"').test(panel), feld + " ist im Kasten");
			const stelle = panel.indexOf('data-fs-field="' + feld + '"');
			pruefe(panel.slice(stelle, stelle + 200).includes("data-fs-orig="),
				feld + " traegt seinen Ausgangswert");
		});
	// Und die drei Abweichungsfelder tragen ihren eigenen Ausgangswert.
	["source_type", "license", "attribution"].forEach((feld) => {
		const stelle = panel.indexOf('data-fs-abw-wert="' + feld + '"');
		pruefe(stelle > 0, feld + " hat ein Abweichungsfeld");
		pruefe(panel.slice(stelle, stelle + 200).includes("data-fs-abw-orig="),
			feld + " traegt seinen Abweichungs-Ausgangswert");
	});

	// 🔴 KEIN leerer Eintrag bei der KORPUS-Quellenart -- anders als in der Eingabezeile. Ein
	// Korpus TRAEGT immer eine Art; „keine Aussage" hiesse hier loeschen, nicht korrigieren.
	const artBlock = panel.slice(panel.indexOf('data-fs-field="corpus_source_type"'));
	const artEnde = artBlock.indexOf("</select>");
	pruefe(!/<option value=""/.test(artBlock.slice(0, artEnde)),
		"die Korpus-Quellenart hat KEINEN leeren Eintrag");
	// 🪤 Das ABWEICHUNGSFELD hat dagegen einen, und der ist tragend: er bedeutet „wie der
	// Korpus". Ohne ihn koennte eine Quelle eine einmal gesetzte Abweichung nie zurueckgeben.
	const abwBlock = panel.slice(panel.indexOf('data-fs-abw-wert="source_type"'));
	pruefe(/<option value=""/.test(abwBlock.slice(0, abwBlock.indexOf("</select>"))),
		"das Abweichungsfeld hat einen leeren Eintrag -- er heisst „wie Korpus“");
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
	// 03.09.2026: `is_official` heisst im Korpusrahmen `corpus_is_official`.
	pruefe(feldIstGesperrt("corpus_is_official"), "„offiziell“ ebenso");
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
	// ⚠️ NEUN seit dem 02.09.2026: die FORM ist aus der Eingabezeile hierher gewandert (Owner:
	// „zieh die form ins ✎"). Sie ist weder Katalog- noch Verknuepfungsfeld -- sie gehoert dem
	// KORPUS und hat in `sources` keine Spalte; der Server fuehrt sie deshalb als eigene Reichweite
	// (AVESMAPS_FEATURE_SOURCE_CORPUS_ONLY_FIELDS).
	// 03.09.2026: ZWOELF. Dazugekommen sind „Kein Korpus verwenden" und die drei
	// Abweichungsfelder; die vier Korpusfelder heissen jetzt `corpus_*`.
	// 03.09.2026: DREIZEHN, und die Aufteilung ist die Aussage.
	//   Quelle (2):  url, label          -- gilt allen Objekten, die diese Quelle zitieren
	//   Quelle (1):  no_corpus           -- „Kein Korpus verwenden"
	//   Korpus (5):  corpus_form, corpus_source_type, corpus_license, corpus_attribution,
	//                corpus_is_official  -- ausdruecklich benannt, trifft ALLE Quellen des Wirts
	//   Objekt (2):  pages, reference_kind
	//   Abweichung (3): source_type, license, attribution -- der BLANKE Name, er landet ueber
	//                `own_fields` in `sources` statt im Korpus
	// 💣 Die Zahl steht hier, damit ein neues Feld auffaellt -- aber sie ist nur die Summe; was
	// zaehlt, ist die Zuordnung darueber, und die wird weiter oben einzeln geprueft.
	pruefe(panel._elemente.length === 13,
		"dreizehn Formularfelder (3 Quelle + 5 Korpus + 2 Verknuepfung + 3 Abweichung)");
	// Unberuehrt = NICHTS reist mit. Das ist die ganze Regel.
	gleich(featureSourceChangedFields(panel), {},
		"ein unberuehrter Kasten schickt KEIN einziges Feld -- sonst schriebe jedes Speichern alles");

	// Ein geaendertes Feld, und nur dieses.
	const seiten = panel._elemente.find((e) => e._name === "pages");
	seiten.value = "113-115";
	gleich(featureSourceChangedFields(panel), { pages: "113-115" }, "nur die geaenderte Seitenangabe reist mit");

	// Das Haekchen kommt als echter Boolean, nicht als "0"/"1".
	// 03.09.2026: das Haekchen heisst `corpus_is_official` -- es gehoert dem Korpus, und der Name
	// sagt das jetzt selbst, statt es aus seiner Stellung im Markup ableiten zu lassen.
	const offiziell = panel._elemente.find((e) => e._name === "corpus_is_official");
	offiziell.checked = false;
	gleich(featureSourceChangedFields(panel), { pages: "113-115", corpus_is_official: false },
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
	// ⚠️ `own_fields` ist seit dem 02.09.2026 dabei und gehoert hierher: welche Korpusfelder diese
	// ZEILE selbst besitzt, gilt ueberall, wo sie zitiert wird -- also katalogweit, nicht an der
	// einzelnen Verknuepfung. Es zaehlt damit auch in die Rueckfrage ab der Schwelle.
	// ⚠️ `no_corpus` ist seit dem 03.09.2026 dabei und gehoert hierher: „Kein Korpus verwenden" ist
	// eine Aussage ueber die QUELLE, nicht ueber eine einzelne Verknuepfung -- sie gilt ueberall,
	// wo die Quelle zitiert wird, und zaehlt damit auch in die Rueckfrage ab der Schwelle.
	gleich(katalogFelder,
		["url", "label", "source_type", "license", "attribution", "is_official", "own_fields", "no_corpus"],
		"und die Katalog-Haelfte die uebrigen acht");

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
	const kastenHtml = renderFeatureSourceEditPanel(QUELLE, (v) => String(v), (k, f) => f);
	const imKasten = (kastenHtml.match(/data-fs-field="([a-z_]+)"/g) || [])
		.map((s) => s.replace(/.*="|"/g, ""));
	// ⚠️ `own_fields` ist die AUSNAHME und muss es sein: es ist kein Eingabefeld, sondern die
	// Menge der vier Abweichungs-Haekchen (`data-fs-own`). Ein `data-fs-field="own_fields"` gaebe
	// es doppelt -- einmal als Wert, einmal als Haekchen -- und `featureSourceChangedFields`
	// nimmt dann, was zufaellig zuletzt im DOM steht.
	// ⚠️ Und die FORM: sie ist seit dem 02.09.2026 im Kasten, gehoert aber weder der Verknuepfung
	// noch dem Katalog -- sie ist die dritte Reichweite (`…CORPUS_ONLY_FIELDS`) und hat in
	// `sources` keine Spalte. Der Server kennt sie trotzdem; sie darf also nicht als „unbekannt"
	// durchfallen.
	const korpusNurFelder = php.match(/AVESMAPS_FEATURE_SOURCE_CORPUS_ONLY_FIELDS = \[([^\]]+)\]/)[1]
		.match(/'([a-z_]+)'/g).map((s) => s.replace(/'/g, ""));
	gleich(korpusNurFelder, ["form"], "die Form ist das einzige reine Korpusfeld");
	// 🪤 UMGEBAUT am 03.09.2026. Hier stand eine GLEICHHEIT (Kasten == Serverfelder); seit der
	// Kasten zwei Namensraeume traegt -- `corpus_license` fuer den Wirt, `license` fuer die
	// Abweichung -- kann sie nicht mehr stimmen, und eine Gleichheit haette bei jeder legitimen
	// Ergaenzung neu gepflegt werden muessen.
	// 🔴 Geprueft wird die eigentliche Aussage: KENNT DER SERVER JEDEN NAMEN, den der Kasten baut?
	// Ein Feld, das er nicht kennt, faellt beim Speichern lautlos weg -- der Knopf bewegt sich,
	// und der Wert ist weg.
	const praefix = (php.match(/AVESMAPS_FEATURE_SOURCE_CORPUS_PREFIX = '([a-z_]+)'/) || [])[1];
	pruefe(praefix === "corpus_", "der Server nennt das Praefix `corpus_`");
	const korpusfaehig = katalogFelder.concat(korpusNurFelder);
	imKasten.forEach((name) => {
		const ohnePraefix = name.indexOf(praefix) === 0 ? name.slice(praefix.length) : "";
		const bekannt = ohnePraefix !== ""
			? korpusfaehig.indexOf(ohnePraefix) !== -1
			: linkFelder.concat(katalogFelder).indexOf(name) !== -1;
		pruefe(bekannt, "der Server kennt das Feld " + name);
	});
	// ⚠️ `own_fields` ist die AUSNAHME und muss es sein: es ist kein Eingabefeld, sondern die Menge
	// der Abweichungen -- sie wird aus den Abweichungsfeldern GELESEN, nicht getippt.
	pruefe(imKasten.indexOf("own_fields") === -1,
		"und der Besitzstand ist kein Eingabefeld");
	// 🔴 Und die Gegenrichtung: die fuenf Korpusfelder muessen WIRKLICH als `corpus_*` dastehen.
	// Ohne diese Haelfte waere die Pruefung darueber erfuellt, wenn der Kasten sie gar nicht baut.
	["form", "source_type", "license", "attribution", "is_official"].forEach((f) => {
		pruefe(imKasten.indexOf(praefix + f) !== -1, "der Kasten baut " + praefix + f);
	});
	// 🪤 UMGEBAUT am 03.09.2026 (Owner: „eigentlich braucht es die haekchen nicht NUR felder").
	// Der Besitzstand wird aus den ABWEICHUNGSFELDERN gelesen: ein gefuellter Wert IST die
	// Abweichung. Es sind DREI -- `offiziell` ist nicht mehr ueberschreibbar.
	const abwFelder = (kastenHtml.match(/data-fs-abw-wert="([a-z_]+)"/g) || [])
		.map((s) => s.replace(/.*="|"/g, ""));
	gleich(abwFelder.slice().sort(), ["attribution", "license", "source_type"],
		"der Besitzstand steht als drei Abweichungsfelder da, nicht als Eingabefeld");
	pruefe(!/data-fs-own=/.test(kastenHtml), "und die alten Haekchen sind gefallen");
}

// ══ G. „Verknüpft statt angelegt" — der Satz, den das Adressfeld schuldig blieb ═════════════════
// 🔴 Der Katalog dedupliziert über `url_hash` (UNIQUE): eine bekannte Adresse verknüpft mit der
// bestehenden Zeile. Richtig und gewollt, aber bis zum 01.09.2026 stumm — die Kachel „bestehende
// Quelle" daneben hängt an der NAMENS-Vorschlagsliste, nicht am Adressfeld.
{
	const tr = (k, f) => f;

	// 🪤 UMGEDREHT am 03.09.2026 am Livelauf. Hier stand: „Nichts sagen heißt ‚neu angelegt‘ …
	// eine Meldung dafür wäre Lärm auf dem häufigen Weg." Der Owner hat genau das beanstandet:
	// die Zeile war angelegt, das Formular geleert — und das Einzige, was dastand, war der
	// Verknüpfungssatz. Er las sich wie ein Einwand gegen eine leere Maske. „schön wärs gewesen
	// ‚Erfolgreich hinzugefügt‘ zu lesen."
	// 🔴 Der Erfolg steht jetzt IMMER voran (`zeigeErgebnis`), und diese Funktion liefert nur
	// noch den ZUSATZ. Sie schweigt deshalb weiter beim Anlegen — dort gibt es nichts zu
	// erklären, nur zu bestätigen, und das tut der Aufrufer.
	gleich(featureSourceLinkedMessage(null, tr), "", "beim Anlegen gibt es keinen Zusatz");
	gleich(featureSourceLinkedMessage(undefined, tr), "", "und ohne Angabe erst recht");

	const schlicht = featureSourceLinkedMessage(
		{ source_id: 7, label: "Briefspiel (Weiden)", typed_label: "", official_changed: false }, tr);
	pruefe(schlicht.includes("stand schon im Katalog"), "beim Verknüpfen wird es gesagt");
	pruefe(schlicht.includes("verknüpft statt neu angelegt"), "und was daraus folgte");
	// ⚠️ Der NAME steht nicht mehr hier: ihn nennt die Erfolgsmeldung davor („Hinzugefügt: „X“."),
	// und zweimal derselbe Name in einem Satzpaar liest sich wie ein Fehler.
	pruefe(!schlicht.includes("Briefspiel (Weiden)"), "der Name steht in der Erfolgsmeldung, nicht hier");
	pruefe(!schlicht.includes("offiziell"), "ohne umgelegten Haken kein Wort darüber");

	// 🔴 Der Fall, der ohne Erklärung wie ein Fehler aussieht: man tippt „X", in der Liste steht „Y".
	const umbenannt = featureSourceLinkedMessage(
		{ source_id: 7, label: "Briefspiel (Weiden)", typed_label: "Baronie Altentrallop", official_changed: false }, tr);
	pruefe(umbenannt.includes("Baronie Altentrallop"), "der verworfene Titel wird genannt");
	// 🔴 Hier steht der gespeicherte Name sehr wohl -- der Satz stellt die beiden gegenüber, und
	// ohne ihn wäre nicht zu sehen, WOGEGEN der eingetippte verloren hat.
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
	pruefe(featureSourceLinkedMessage({ label: "X", typed_label: "" }).includes("stand schon im Katalog"),
		"er kommt ohne injizierten Übersetzer aus");

	// 🪤 Und der Aufrufer muss ihn wirklich rufen — sonst ist der Bauer ein Vakuum. Kommentare
	// vorher weg: ein Quelltext-Test, der die ERKLÄRUNG trifft statt des Aufrufs, ist im Haus schon
	// mehrfach grün geblieben, ohne etwas zu prüfen.
	const quelle = lies("js/review/review-feature-sources.js")
		.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	pruefe(/zeigeErgebnis\(daten, values\);/.test(quelle), "der Add-Knopf ruft die Meldung");
	pruefe(/featureSourceLinkedMessage\(linked, tr\)/.test(quelle),
		"und sie geht durch den geteilten Bauer");

	// 💣 ES GIBT EINE NOTIZZEILE, ALSO EINEN SCHREIBER. Hier stand bis zum 03.09.2026 die
	// umgekehrte Regel: zwei Rufe hintereinander, "die Verknüpfung überschreibt die Umtypung, weil
	// sie die umfassendere Auskunft ist". Das ging gut, solange der zweite SCHWIEG, wenn nichts zu
	// verknüpfen war. Seit die Zeile den Erfolg IMMER bestätigt, verschluckte der zweite Ruf jede
	// Umtypung -- beide Funktionen einzeln richtig, beide Hälften mit grünem Test.
	// 🔴 `zeigeErgebnis` sammelt seither alles; die Umtypung liefert ihren Satz, statt ihn zu
	// zeigen. Ob wirklich alles drei nebeneinander steht, prüft zur LAUFZEIT Abschnitt 7 in
	// `quellen-art-korrigieren.test.js` -- hier steht nur, dass der Weg dorthin verdrahtet ist.
	const addZweig = quelle.slice(quelle.indexOf('renderFromServer("add", values)'));
	pruefe(!/^[\s\S]{0,400}zeigeUmtypung/.test(addZweig),
		"der Add-Weg schreibt die Notiz genau einmal");
	pruefe(/umtypungsText\(daten\)/.test(quelle.slice(quelle.indexOf("function zeigeErgebnis"))),
		"und der eine Schreiber liest die Umtypung mit");
}

console.log("OK -- " + pruefungen + " Zusicherungen erfuellt (Quellen bearbeiten, Formular).");
