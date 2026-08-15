// Der geteilte Klick-Verteiler in map-features-traffic-links.js -- jetzt fuer ZWEI Faelle:
// Verkehrswege in der Siedlungs-Infobox (data-traffic-path, Bestand) UND die Namen in "In der Naehe"
// (data-what-is-here-name, Fix-Runde 6, Befund A).
//
// 🔴 DER BEFUND, UM DEN ES GEHT: „In der Naehe" baute Knoepfe mit `data-what-is-here-name`, aber der
// registrierte document-Klick-Handler horchte nur auf `data-traffic-path` -- ein Klick auf „Ziegenhain"
// bewirkte NICHTS. Ein Quelltest, der nur nachsieht, ob die Zeichenkette „data-what-is-here-name"
// irgendwo im Text vorkommt, haette genau DAS nicht gefunden (das Markup trug das Attribut ja schon --
// der Fehler sass im Verteiler, nicht im Markup). Diese Datei simuliert deshalb echte Klicks gegen
// den TATSAECHLICH registrierten Handler, in einer vm-Sandbox, und prueft, welche Funktion dabei
// wirklich aufgerufen wird.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/traffic-links-dispatch.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

// Ein minimales DOM-Element: nur das, was der Verteiler tatsaechlich benutzt (getAttribute,
// closest mit einem einfachen `[attr], [attr2]`-Selektor -- exakt die Form, die die echte Datei
// verwendet, keine allgemeine CSS-Engine).
function fakeElement(attrs) {
	return {
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
		},
		closest(selector) {
			const treffer = selector.split(",").map((teil) => teil.trim()).some((teil) => {
				const m = /^\[([a-zA-Z0-9-]+)\]$/.exec(teil);
				return m && Object.prototype.hasOwnProperty.call(attrs, m[1]);
			});
			return treffer ? this : null;
		},
	};
}

// Laedt map-features-traffic-links.js frisch (der document-Handler wird beim Laden registriert,
// EINMAL, ueber den __avesmapsTrafficLinksBound-Riegel -- jede Sandbox startet deshalb mit eigenem,
// unverbrauchtem document).
function ladeTrafficLinks({ spotlightEntries = [], findLocation = () => null } = {}) {
	const calls = { showLocation: [], select: [], toasts: [], panTo: [] };
	let clickHandler = null;

	const sandbox = {
		console,
		getSpotlightSearchEntries: () => spotlightEntries,
		findLocationMarkerByName: findLocation,
		selectSpotlightSearchEntry: (entry) => { calls.select.push(entry); },
		showFeedbackToast: (message, type) => { calls.toasts.push({ message, type }); },
		map: { panTo: (latlng) => { calls.panTo.push(latlng); } },
		window: {
			avesmapsShowLocationInInfopanel: (entry) => { calls.showLocation.push(entry); },
		},
		document: {
			__avesmapsTrafficLinksBound: false,
			documentElement: {},
			addEventListener(type, handler) {
				if (type === "click") {
					clickHandler = handler;
				}
			},
			querySelectorAll: () => [],
		},
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(read("js", "map-features", "map-features-traffic-links.js"), sandbox, {
		filename: "map-features-traffic-links.js",
	});
	assert.strictEqual(typeof clickHandler, "function", "der Klick-Handler wurde registriert");

	return {
		calls,
		klick(attrs) {
			let prevented = false;
			clickHandler({ target: fakeElement(attrs), preventDefault: () => { prevented = true; } });
			return prevented;
		},
	};
}

const ORT = { name: "Ziegenhain", marker: { getLatLng: () => ({ lat: 12.5, lng: 34.25 }) } };
const WEG_EINTRAG = { kind: "path", name: "Eisenstraße" };

// ---- Ortschaft: der Name loest ueber findLocationMarkerByName auf ------------------------------
{
	const { calls, klick } = ladeTrafficLinks({ findLocation: (name) => (name === "Ziegenhain" ? ORT : null) });
	const prevented = klick({ "data-what-is-here-name": "Ziegenhain" });
	assert.strictEqual(prevented, true, "der Klick wird abgefangen (kein Formular-Submit o.ae.)");
	assert.deepStrictEqual(calls.showLocation, [ORT], "avesmapsShowLocationInInfopanel bekommt GENAU diesen Ort");
	assert.deepStrictEqual(calls.panTo, [{ lat: 12.5, lng: 34.25 }], "und die Karte zentriert auf ihn");
	assert.strictEqual(calls.select.length, 0, "🔴 selectSpotlightSearchEntry wird NICHT aufgerufen -- das waere der Wege-Weg");
	assert.strictEqual(calls.toasts.length, 0, "kein Toast, wenn das Ziel gefunden wurde");
}

// ---- Weg: KEIN Ort mit diesem Namen, aber ein Weg -----------------------------------------------
{
	const { calls, klick } = ladeTrafficLinks({ spotlightEntries: [WEG_EINTRAG], findLocation: () => null });
	klick({ "data-what-is-here-name": "Eisenstraße" });
	assert.deepStrictEqual(calls.select, [WEG_EINTRAG], "der Wege-Mechanismus (wie data-traffic-path) greift als Rueckfall");
	assert.strictEqual(calls.showLocation.length, 0, "kein Ort-Aufruf fuer einen Weg");
	assert.strictEqual(calls.toasts.length, 0, "kein Toast, wenn der Weg gefunden wurde");
}

// ---- Weder Ort noch Weg gefunden: NIE stillschweigend nichts tun (Vorgabe Punkt 4) --------------
{
	const { calls, klick } = ladeTrafficLinks({ spotlightEntries: [], findLocation: () => null });
	klick({ "data-what-is-here-name": "Nirgendwo" });
	assert.strictEqual(calls.showLocation.length, 0, "kein Ort-Aufruf");
	assert.strictEqual(calls.select.length, 0, "kein Wege-Aufruf");
	assert.strictEqual(calls.toasts.length, 1, "🔴 GENAU EIN Toast -- die Entscheidung aus Punkt 4: nie eine tote Kachel ohne Rueckmeldung");
	assert.strictEqual(calls.toasts[0].type, "info", "als Hinweis, nicht als Fehler");
	assert.ok(calls.toasts[0].message && calls.toasts[0].message.length > 0, "mit einem lesbaren Text");
}

// ---- Ein Ort GEWINNT vor einem gleichnamigen Weg -- kein Rueckfall, wenn der Ort schon feststeht -
{
	const { calls, klick } = ladeTrafficLinks({
		spotlightEntries: [{ kind: "path", name: "Ziegenhain" }],
		findLocation: (name) => (name === "Ziegenhain" ? ORT : null),
	});
	klick({ "data-what-is-here-name": "Ziegenhain" });
	assert.deepStrictEqual(calls.showLocation, [ORT], "der Ort gewinnt");
	assert.strictEqual(calls.select.length, 0,
		"🔴 KEIN Rueckfall auf den Weg desselben Namens -- sonst waere bei einer Namensgleichheit das falsche Ziel offen");
}

// ---- Regression: der BESTEHENDE Verkehrswege-Mechanismus (data-traffic-path) bleibt unveraendert -
{
	const { calls, klick } = ladeTrafficLinks({ spotlightEntries: [WEG_EINTRAG] });
	klick({ "data-traffic-path": "Eisenstraße" });
	assert.deepStrictEqual(calls.select, [WEG_EINTRAG], "Verkehrswege-Klick funktioniert weiterhin");
	assert.strictEqual(calls.showLocation.length, 0, "und ruft nicht versehentlich den Ort-Zweig");
}
{
	const { calls, klick } = ladeTrafficLinks({ spotlightEntries: [] });
	klick({ "data-traffic-path": "Unbekannter Weg" });
	assert.deepStrictEqual(calls.toasts, [{ message: "Dieser Weg ist gerade nicht geladen.", type: "info" }],
		"der bestehende Wege-Toast-Text bleibt woertlich erhalten (Regressionsschutz)");
}

// ---- Ein Klick, der GAR KEIN passendes Attribut trifft, loest den Handler nicht aus --------------
{
	const { calls, klick } = ladeTrafficLinks({});
	const prevented = klick({ "data-irgendwas-anderes": "x" });
	assert.strictEqual(prevented, false, "kein preventDefault fuer einen fremden Klick");
	assert.strictEqual(calls.showLocation.length + calls.select.length + calls.toasts.length, 0,
		"und keine der drei Wirkungen laeuft an");
}

// ---- M6 (Schlussprüfung, blockierend): DIE NAHT ZWISCHEN MARKUP UND VERTEILER --------------------
// 🔴 DER BEFUND: alle Faelle oben bauen ihr Klick-Element SELBST, mit hartkodiertem
// "data-what-is-here-name" -- und avesmapsWhatIsHereNearbyMarkup (map-features-what-is-here-nearby.js)
// hatte gar keinen eigenen Test. Benennt jemand das Attribut um (dort ODER im Verteiler), bleiben
// BEIDE Seiten fuer sich genommen gruen -- der tote Nachbar-Knopf waere wortwoertlich zurueck, und
// kein Test haette es gemerkt. Diese Zusicherung nimmt deshalb das ECHTE, von der Markup-Funktion
// ERZEUGTE Attribut (kein hartkodierter String) und fuettert GENAU DAS in den echten Verteiler --
// die Naht selbst ist der Pruefling, nicht eine der beiden Seiten.
const { avesmapsWhatIsHereNearbyMarkup } = require("../map-features-what-is-here-nearby.js");
const erzeugtesMarkup = avesmapsWhatIsHereNearbyMarkup([{ art: "Dorf", name: "Ziegenhain", meilen: 3.2, peilung: 90 }]);
const attributTreffer = /<button[^>]*\s(data-[a-z-]+)="([^"]*)"[^>]*>/.exec(erzeugtesMarkup);
assert.ok(attributTreffer, "das erzeugte Markup traegt ueberhaupt ein data-*-Attribut am Knopf");
const [, echtesAttribut, echterWert] = attributTreffer;
assert.strictEqual(echterWert, "Ziegenhain", "und der Wert ist der Ortsname, unveraendert");
{
	const { calls, klick } = ladeTrafficLinks({ findLocation: (name) => (name === "Ziegenhain" ? ORT : null) });
	klick({ [echtesAttribut]: echterWert });
	assert.deepStrictEqual(calls.showLocation, [ORT],
		"der Verteiler reagiert auf GENAU das Attribut aus dem echten Markup -- nicht auf einen hier hartkodierten Namen");
}
// Gegenprobe: haette das Markup ein ANDERES Attribut erzeugt (z. B. nach einer Umbenennung), duerfte
// der alte, hartkodierte Name nicht mehr greifen -- sonst waere die Zusicherung oben selbst wertlos.
assert.strictEqual(echtesAttribut, "data-what-is-here-name",
	"Dokumentation des Ist-Zustands: faellt DIESE Zusicherung kuenftig, hat sich das Attribut geaendert -- "
	+ "und die Naht-Pruefung zwei Zeilen hoeher ist es, die das kuenftig traegt, nicht dieser Name hier");

console.log("traffic-links-dispatch: alle Zusicherungen gehalten");
