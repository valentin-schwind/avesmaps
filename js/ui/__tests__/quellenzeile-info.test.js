const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Die Quellenzeile der Infobox: eine Quelle, eine Zeile — und die Rechte hinter dem ⓘ.
// Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md §4.2/§4.4
// Mockup:  docs/quellenzeile-info-mockup.html
//
// 💣 WARUM ES DAS GIBT (Owner-Meldung 01.09.2026, „die URL bringt um"): Die Namensnennung
// („herzogtum-weiden.net") stand INLINE in der Zeile und trug als einzige Angabe
// `.fs-src-lic--attrib { white-space: normal }` — eine Regel vom 27.08.2026, als die Zeile noch
// umbrechen durfte. Seit dem 01.09. ist die Zeile einzeilig (`nowrap` + Ellipse), und die alte
// Ausnahme brach sie VON INNEN auf: die erste Hälfte schnitt die Ellipse ab, die zweite rutschte
// darunter. Zwei Regeln aus zwei Entwurfsstufen, die einander nie gesehen haben.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/quellenzeile-info.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");
const markup = require(path.join(wurzel, "js/ui/feature-source-markup.js"));

let pruefungen = 0;
const pruefe = (b, t) => { assert.ok(b, t); pruefungen++; };

const MIT_RECHTEN = {
	label: "Briefspiel (Weiden)",
	url: "https://www.herzogtum-weiden.net/politik/liste-bn/baronien/hzgl-altentrallop",
	// 🪤 DIE NAMENSNENNUNG DARF NICHT IN DER ADRESSE VORKOMMEN. Live steht dort tatsaechlich
	// „herzogtum-weiden.net" -- und damit auch im `href` des Titel-Links. Eine Pruefung
	// „die Zeile enthaelt den Text nicht" war damit IMMER falsch, ganz gleich was der Code tut.
	// Der Fixture-Wert ist deshalb bewusst ein anderer als die Adresse.
	type: "briefspiel", official: false, attribution: "Freundeskreis Weiden e. V.",
};
const OHNE_RECHTE = { label: "Goldene Flügel", url: "https://f-shop.de/x", type: "abenteuer", official: true };

// ══ A. Das ⓘ steht seit dem 02.09.2026 an JEDER Quelle ══════════════════════════════════════════
// 🔴 UMKEHR EINER REGEL, und sie ist begründet. Auslöser war die NAMENSNENNUNG — live tragen 3 von
// 1374 Katalogzeilen eine, das ⓘ war also praktisch nie zu sehen. Jetzt trägt die Tafel den KANON
// (immer bekannt, Owner-Wortlaut vom 02.09.), die LIZENZ (aus der Zeile hierher gewandert) und bei
// einer Belegstelle den TITEL der Seite, weil vorn der Korpusname steht.
// 💣 Die alte Regel „ein Knopf über einer leeren Tafel ist ein Klick für nichts" ist damit NICHT
// gefallen, sondern erfüllt: es gibt jetzt immer etwas. Wer den Kanon je herausnimmt, muss den
// Auslöser zurückbauen.
{
	const mit = markup.buildSourceListMarkup("", [MIT_RECHTEN]);
	const ohne = markup.buildSourceListMarkup("", [OHNE_RECHTE]);
	pruefe(mit.includes('class="fs-src-info"'), "eine Quelle mit Namensnennung bekommt ein ⓘ");
	pruefe(ohne.includes('class="fs-src-info"'), "und eine ohne ebenso -- der Kanon ist immer da");
	pruefe(/<dt>Kanon<\/dt>/.test(ohne), "ihre Tafel trägt ihn");
	// ⚠️ Und sie behauptet nichts, was nicht dasteht: ohne Nennung keine Nennungszeile.
	pruefe(!/<dt>Nennung<\/dt>/.test(ohne), "aber keine leere Nennungszeile");
	pruefe(ohne.includes("fs-src-rights"), "und eine Tafel, die nicht leer ist");

	// ⚠️ Die WIKI-Zeile bekommt weiterhin KEINES: der Artikel-Link IST ihre Namensnennung, ihre
	// Lizenz steht sichtbar daneben, und sie ist gar keine Katalogquelle -- sie hat auch keinen
	// Kanon aus dem Katalog. Es gäbe dort wirklich nichts aufzuklappen.
	// 💣 Geprüft wird deshalb die ZAHL: die Quelle darunter bringt ihr eigenes ⓘ mit, ein blosses
	// „enthält kein fs-src-info" wäre seit dem 02.09.2026 immer falsch.
	const mitWiki = markup.buildSourceListMarkup("https://wiki.example/Perricum", [OHNE_RECHTE], {
		wikiLabel: "Wiki Aventurica", wikiLicenseLabel: "CC BY-SA 3.0",
		wikiLicenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
	});
	const wikiZeile = mitWiki.slice(mitWiki.indexOf("<li>"), mitWiki.indexOf("</li>"));
	pruefe(!wikiZeile.includes("fs-src-info"), "die Wiki-Zeile bekommt kein ⓘ");
	pruefe((mitWiki.match(/fs-src-info/g) || []).length === 1,
		"genau eines -- das der Quelle darunter");
	pruefe(mitWiki.includes("CC BY-SA 3.0"), "ihre Lizenz steht aber weiterhin sichtbar in der Zeile");
}

// ══ B. Die Namensnennung steht NICHT mehr in der Zeile ══════════════════════════════════════════
// 🔴 Das ist der gemeldete Fehler. Sie ist der längste Wert der Zeile; inline sprengte sie die
// Einzeiligkeit.
{
	const html = markup.buildSourceListMarkup("", [MIT_RECHTEN]);
	// ⚠️ Die ZEILE ist alles vor der Tafel -- ein Ausschnitt bis zum naechsten "</span></span>"
	// traf frueher die Tafel mit und maass damit gar nichts.
	const zeile = html.slice(html.indexOf('<span class="fs-src-row">'),
		html.indexOf('<div class="fs-src-rights"'));
	pruefe(!zeile.includes("Freundeskreis Weiden e. V."),
		"die Namensnennung steht nicht mehr in der Zeile — sie brach sie von innen auf");
	pruefe(html.includes("Freundeskreis Weiden e. V."), "sie ist aber weiterhin im Markup (in der Tafel)");
	// 💣 Die Klasse, die den Umbruch erlaubte, darf nicht wiederkommen.
	pruefe(!html.includes("fs-src-lic--attrib"),
		"die umbrechende Ausnahme gibt es nicht mehr");
	// Und die CSS-Regel dazu auch nicht.
	const css = lies("css/features/feature-sources.css");
	pruefe(!/^\.fs-src-lic--attrib\s*\{/m.test(css),
		"auch als CSS-Regel nicht — sonst kommt der Umbruch mit ihr zurück");
}

// ══ C. Die Tafel steht IM <li> ihrer Quelle, nie unter der Liste ════════════════════════════════
// 💣 Bei zwei Quellen wäre sonst nicht zu sehen, WESSEN Rechte dort stehen — und das sind
// zuordnungspflichtige Angaben.
{
	const html = markup.buildSourceListMarkup("", [OHNE_RECHTE, MIT_RECHTEN]);
	const lis = html.split("<li>").slice(1);
	pruefe(lis.length === 2, "zwei Quellen, zwei <li>");
	// ⭐ Seit dem 02.09.2026 hat JEDE Quelle ihre Tafel (der Kanon ist immer bekannt). Die Aussage
	// dieser Prüfung ist unverändert und sogar schärfer prüfbar: jede liegt in IHREM <li>.
	pruefe(lis[0].includes("fs-src-rights") && lis[1].includes("fs-src-rights"),
		"jede Quelle hat ihre Tafel in IHREM <li>");
	pruefe(!/<dt>Nennung<\/dt>/.test(lis[0]) && /<dt>Nennung<\/dt>/.test(lis[1]),
		"und nur die mit Nennung trägt eine -- die Tafel behauptet nichts, was nicht dasteht");
	pruefe(lis[1].indexOf("fs-src-rights") < lis[1].indexOf("</ul>"), "und damit innerhalb der Liste");

	// 🔴 Zwei Quellen mit Rechten bekommen VERSCHIEDENE ids -- sonst schaltet ein Knopf die
	// fremde Tafel um (`aria-controls` zeigt dann auf das falsche Element).
	const zwei = markup.buildSourceListMarkup("", [
		MIT_RECHTEN, Object.assign({}, MIT_RECHTEN, { label: "Briefspiel (Garetien)", url: "https://garetien.de/y" }),
	]);
	const ids = (zwei.match(/id="fsr-\d+"/g) || []);
	pruefe(ids.length === 2 && ids[0] !== ids[1], "zwei Tafeln, zwei verschiedene Kennungen");
}

// ══ D. Die Tafel: Nennung, Lizenz, und die ANKLICKBARE Adresse ══════════════════════════════════
{
	const html = markup.buildSourceListMarkup("", [
		Object.assign({}, MIT_RECHTEN, { license: "cc-by-nc-sa-3.0" }),
	]);
	const tafel = html.slice(html.indexOf('class="fs-src-rights"'));
	pruefe(/<dt>Nennung<\/dt><dd>Freundeskreis Weiden e\. V\.<\/dd>/.test(tafel), "die Nennung steht in der Tafel");
	pruefe(tafel.includes("<dt>Lizenz</dt>"), "die Lizenz ebenfalls");
	pruefe(tafel.includes("<dt>Adresse</dt>"), "und die Adresse");
	// 🔴 Owner 01.09.2026: „mach die adresse aber bei Adresse anklickbar". Ein Link, den man sieht
	// aber nicht folgen kann, ist eine Sackgasse -- und der Titel oben kürzt, hier steht sie ganz.
	const adresse = tafel.slice(tafel.indexOf("<dt>Adresse</dt>"));
	pruefe(/<a class="fs-src-rights-url" href="https:\/\/www\.herzogtum-weiden\.net\/politik\/liste-bn\/baronien\/hzgl-altentrallop"/.test(adresse),
		"die Adresse ist ein echter Link auf sich selbst");
	pruefe(adresse.includes('target="_blank"') && adresse.includes('rel="noopener"'),
		"und öffnet sicher in einem neuen Tab");

	// ⚠️ Ohne Adresse keine Adresszeile -- ein Link ins Leere ist schlimmer als eine fehlende Zeile.
	const ohneUrl = markup.buildSourceListMarkup("", [
		{ label: "Ein Buch", type: "quellenband", official: true, attribution: "Ulisses" },
	]);
	const t2 = ohneUrl.slice(ohneUrl.indexOf('class="fs-src-rights"'));
	pruefe(!t2.includes("<dt>Adresse</dt>"), "ohne Adresse fehlt die Zeile ganz");
	pruefe(t2.includes("Ulisses"), "die Nennung steht trotzdem da");
}

// ══ E. Die Zeile: Titel kürzt, Lizenz nie ═══════════════════════════════════════════════════════
// 💣 Lagen beide in EINEM ellipsierenden Kasten, schnitt die Ellipse, was hinten steht — und
// hinten steht die Lizenz. Ein abgeschnittenes „CC B…" ist kein Lizenzverweis, und CC verlangt ihn
// AN DER KOPIE.
{
	const html = markup.buildSourceListMarkup("", [Object.assign({}, MIT_RECHTEN, { license: "cc-by-nc-sa-3.0" })]);
	pruefe(html.includes('<span class="fs-src-title">'), "der Titel hat einen eigenen Kasten");
	const main = html.slice(html.indexOf('class="fs-src-main"'), html.indexOf('class="fs-src-marks"'));
	// ⭐ SEIT DEM 02.09.2026 STEHT DIE LIZENZ IN DER TAFEL, nicht mehr in der Zeile (Owner:
	// „lizenz ins ⓘ, über nennung"). Damit ist der Zielkonflikt aufgelöst, den diese Prüfung
	// bewachte: der Titel hat die Zeile für sich und kann nichts mehr abschneiden, was rechtlich
	// tragend wäre.
	pruefe(!main.includes("fs-src-lic"), "die Lizenz steht nicht mehr in der Zeile");
	pruefe(/<dt>Lizenz<\/dt>/.test(html), "sondern in der Tafel");

	const css = lies("css/features/feature-sources.css");
	// Nur der TITEL trägt die Ellipse -- `.fs-src-main` darf sie nicht haben, sonst schneidet
	// sie wieder alles hinten ab.
	const mainRegel = css.slice(css.indexOf(".fs-src-main {"), css.indexOf("}", css.indexOf(".fs-src-main {")));
	pruefe(!mainRegel.includes("text-overflow"), "die Ellipse sitzt nicht mehr am ganzen Bereich");
	const titelRegel = css.slice(css.indexOf(".fs-src-title {"), css.indexOf("}", css.indexOf(".fs-src-title {")));
	pruefe(titelRegel.includes("text-overflow: ellipsis") && titelRegel.includes("min-width: 0"),
		"sondern am Titel -- samt min-width:0, ohne das schrumpft ein Flex-Kind nicht");
	// ⚠️ Die Regel für die Lizenzmarke BLEIBT im CSS: die WIKI-Zeile trägt ihre Lizenz weiterhin
	// sichtbar (sie ist keine Katalogquelle und hat kein ⓘ). Eine gelöschte Regel nähme ihr die Form.
	pruefe(/\.fs-src-main > \.fs-src-lic \{[^}]*flex: 0 0 auto/.test(css),
		"und die Lizenz der Wiki-Zeile schrumpft nie");
}

// ══ F. Unterhalb einer Schwelle bricht die Zeile DOCH um — bewusst und gemessen ═════════════════
// 💣 Ohne die Regel fällt die Titelbreite im 400px-Infopanel auf 53px und bei 280px auf NULL: man
// sieht Lizenz, ⓘ und Etikett, aber nicht mehr, WELCHE Quelle das ist. Am Mockup gemessen.
// 🔴 Die Schwelle liegt bei 420px und damit ÜBER der Infopanel-Breite (400px) — Owner-Entscheid
// „Variante B": dort bekommt der Titel die volle Zeile statt 53px.
{
	const css = lies("css/features/feature-sources.css");
	pruefe(/@container fsbox \(max-width: 420px\)/.test(css), "die Schwelle steht bei 420px");
	pruefe(/\.fs-src \{[^}]*container-type: inline-size/.test(css),
		"und der Kasten misst SICH SELBST, nicht das Fenster");
	const block = css.slice(css.indexOf("@container fsbox"));
	pruefe(block.includes("flex-wrap: wrap"), "unterhalb bricht der Bereich um");
	pruefe(block.includes("flex: 1 1 100%"), "und der Titel bekommt die volle Zeile");
	// ⚠️ Die Markengruppe bleibt rechts -- sonst wandert das Etikett unter den Text und die
	// Zuordnung geht verloren.
	pruefe(!block.includes("fs-src-marks"), "die Markengruppe bleibt unberührt in ihrer Zeile");
}

// ══ G. Der Umschalter — re-render-sicher, wie die Publikationsreiter ════════════════════════════
// 💣 Leaflet ruft den Popup-Inhalt bei jedem `_updateContent` neu auf und ersetzt das Markup. Ein
// an einen Behälter gehängter Zuhörer wäre danach weg — die „FALLE Popup-Revert" vom 08.07.2026.
{
	const html = markup.buildSourceListMarkup("", [MIT_RECHTEN]);
	pruefe(html.includes('onclick="avesmapsToggleSourceRights(this)"'),
		"der Knopf trägt einen Inline-onclick, keinen delegierten Zuhörer");
	pruefe(typeof markup.avesmapsToggleSourceRights === "function", "und die Funktion gibt es");
	const quelle = lies("js/ui/feature-source-markup.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	pruefe(/window\.avesmapsToggleSourceRights = avesmapsToggleSourceRights;/.test(quelle),
		"🔴 sie steht GLOBAL — ein Inline-onclick wird im globalen Raum aufgelöst, sonst klappt nichts auf");

	// Der Umschalter, wirklich ausgeführt: ein winziges DOM von Hand.
	const tafel = { hidden: true };
	const li = { querySelector: (s) => (s === ".fs-src-rights" ? tafel : null) };
	const attrs = {};
	const btn = { closest: (s) => (s === "li" ? li : null), setAttribute: (k, v) => { attrs[k] = v; } };
	markup.avesmapsToggleSourceRights(btn);
	pruefe(tafel.hidden === false && attrs["aria-expanded"] === "true", "erster Klick klappt auf");
	markup.avesmapsToggleSourceRights(btn);
	pruefe(tafel.hidden === true && attrs["aria-expanded"] === "false", "zweiter klappt zu");
	// ⚠️ Er fällt still aus, wenn es nichts gibt — ein Fehler im Popup nähme die ganze Infobox mit.
	markup.avesmapsToggleSourceRights(null);
	markup.avesmapsToggleSourceRights({ closest: () => null });
	pruefe(true, "ohne Ziel wirft er nicht");
}

console.log("OK -- " + pruefungen + " Zusicherungen erfuellt (Quellenzeile und ihr ⓘ).");
