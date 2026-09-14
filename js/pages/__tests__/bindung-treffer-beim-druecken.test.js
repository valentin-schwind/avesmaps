// 💣 AUCH IM BINDUNGSKASTEN DES SYNC-MONITORS WIRD EIN TREFFER BEIM DRUECKEN GEWAEHLT.
//
// Der Kasten „Wiki-Artikel zuweisen" an einem eigenen Knoten (html/wiki-sync-monitor.html, AGENTS.md
// §11 „Einen eigenen Knoten nachtraeglich an einen Wiki-Artikel binden") baut seine Trefferliste mit
// den GETEILTEN Bauern der Wiki-Zuweisung, waehlte aber mit einem EIGENEN `click`-Zuhoerer am
// Dokument. Das ist dieselbe Fehlerklasse, die am 14.09.2026 im geteilten Bauteil behoben wurde
// (js/ui/wiki-assign.js, `aufDruck`/`aufKlick`; Test js/ui/__tests__/wiki-assign-klick-beim-druecken.test.js).
// Im echten Chrome gemessen geht ein `click` verloren,
//   (a) wenn die Liste zwischen Druecken und Loslassen neu gezeichnet wird -- dann kommt GAR KEIN
//       `click`, obwohl der Zeiger die Zeile nie verlassen hat (hier: die entprellte Suchantwort, die
//       genau in diesem Augenblick eintrifft);
//   (b) wenn der Zeiger in den Spalt zwischen zwei Zeilen rutscht -- der `click` faellt auf die LISTE,
//       `closest("[data-wa-treffer]")` findet nichts.
// Beides ist still: die Vorschau oeffnet sich einfach nicht.
//
// DIESER TEST schneidet den Bindungsblock aus dem Seitenskript und FAEHRT ihn in einem vm-Kontext --
// mit dem echten js/ui/wiki-assign.js davor, wie die Seite es laedt. Das DOM ist eine Attrappe, die
// genau die zwei gemessenen Browserregeln nachbildet (Fokus wandert beim Druecken, es sei denn,
// `mousedown` wird verhindert; ein ausgetauschtes Druckziel bekommt keinen `click`) -- und sonst nichts.
// ⚠️ Anders als im geteilten Bauteil haengen die Zuhoerer hier am DOKUMENT. Deshalb steht eine zweite
// Trefferliste auf der Seite, deren Zeilen dasselbe Merkmal tragen: sie darf nicht reagieren.
//
// 🔴 Die Vorschau schreibt nichts (`wiki_binding_preview`); `wiki_binding_apply` wird hier nie gerufen.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/bindung-treffer-beim-druecken.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");

let pruefungen = 0;
const pruefe = (bedingung, was) => { assert.ok(bedingung, was); pruefungen++; };
const gleich = (ist, soll, was) => { assert.deepStrictEqual(ist, soll, was); pruefungen++; };
const mikro = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); } };

// ── Der Bindungsblock, ausgeschnitten ────────────────────────────────────────────────────────────
// Von seiner ersten Modulvariable bis vor den Sammellauf. Die Marken sind CODE, keine Kommentare --
// ein Kommentar, der umformuliert wird, soll den Schnitt nicht verschieben.
const SEITE = lies("html/wiki-sync-monitor.html");
const BLOCK_START = SEITE.indexOf("let bindungZiel = null;");
const BLOCK_ENDE = SEITE.indexOf("$('bindung-sammellauf').addEventListener(");
assert.ok(BLOCK_START > 0 && BLOCK_ENDE > BLOCK_START, "der Bindungsblock laesst sich ausschneiden");
const BLOCK = SEITE.slice(BLOCK_START, BLOCK_ENDE);
pruefe(BLOCK.includes("function bindungVorschauOeffnen"), "der Schnitt enthaelt die Vorschau (sonst prueft der Rest nichts)");

const KANDIDATEN = ["Gareth", "Garetien", "Garether Pforte", "Gareth-Nord"].map((name) => ({
	name: name, wiki_key: "wiki:" + name.toLowerCase().replace(/ /g, "-"), official: true, type: "Stadt",
}));

// ── Die DOM-Attrappe ─────────────────────────────────────────────────────────────────────────────
function baueSeite() {
	const seite = { aktiv: null, zuhoerer: {}, timer: [], anfragen: [] };

	function knoten(merkmale, eltern) {
		const k = { merkmale: Object.assign({}, merkmale), parentNode: eltern, kinder: [], value: "", textContent: "" };
		k.id = k.merkmale.id || "";
		k.getAttribute = (n) => (Object.prototype.hasOwnProperty.call(k.merkmale, n) ? String(k.merkmale[n]) : null);
		k.hasAttribute = (n) => Object.prototype.hasOwnProperty.call(k.merkmale, n);
		k.closest = (selektor) => {
			const m = /^\[([\w-]+)\]$/.exec(selektor);
			for (let x = k; x; x = x.parentNode) {
				if (m && x.hasAttribute(m[1])) {
					return x;
				}
			}
			return null;
		};
		k.contains = (anderer) => {
			for (let x = anderer; x; x = x.parentNode) {
				if (x === k) {
					return true;
				}
			}
			return false;
		};
		k.querySelector = () => null;
		k.focus = () => { seite.aktiv = k; };
		if (eltern) {
			eltern.kinder.push(k);
		}
		return k;
	}

	function abhaengen(k) {
		k.kinder.forEach((kind) => { kind.parentNode = null; });
		k.kinder = [];
	}

	// Eine Liste, deren innerHTML Zeilen mit `data-wa-treffer` baut -- mit dem NAMEN als Kind, denn
	// gedrueckt wird in der Praxis auf den Namen, nicht auf die Zeile selbst.
	function listeMitZeilen(merkmale, eltern) {
		const liste = knoten(merkmale, eltern);
		let html = "";
		Object.defineProperty(liste, "innerHTML", {
			get: () => html,
			set: (inhalt) => {
				html = String(inhalt);
				abhaengen(liste);
				const re = /data-wa-treffer="(\d+)"/g;
				let m;
				while ((m = re.exec(html)) !== null) {
					const zeile = knoten({ "data-wa-treffer": m[1] }, liste);
					zeile.name = knoten({}, zeile);
				}
			},
		});
		return liste;
	}

	const body = knoten({}, null);
	const kasten = knoten({ class: "dt-bindung avm-wiki-assign" }, body);
	const suche = knoten({ id: "bindung-suche" }, kasten);
	const treffer = listeMitZeilen({ id: "bindung-treffer" }, kasten);
	const hinweis = knoten({ id: "bindung-hinweis" }, kasten);
	const vorschau = knoten({ id: "bindung-vorschau" }, kasten);
	const abbruch = knoten({ id: "bindung-abbruch" }, kasten);
	// ⚠️ Eine FREMDE Trefferliste auf derselben Seite, mit demselben Merkmal an den Zeilen.
	const fremd = listeMitZeilen({ id: "fremde-liste" }, body);
	fremd.innerHTML = '<div data-wa-treffer="0">x</div><div data-wa-treffer="1">y</div>';
	const elemente = { "bindung-suche": suche, "bindung-treffer": treffer, "bindung-hinweis": hinweis, "bindung-vorschau": vorschau, "bindung-abbruch": abbruch };

	seite.body = body;
	seite.suche = suche;
	seite.liste = treffer;
	seite.vorschau = vorschau;
	seite.abbruch = abbruch;
	seite.fremd = fremd;
	seite.zeile = (index) => treffer.kinder.find((z) => z.getAttribute("data-wa-treffer") === String(index)) || null;
	seite.verbunden = (k) => {
		for (let x = k; x; x = x.parentNode) {
			if (x === body) {
				return true;
			}
		}
		return false;
	};

	// Alle Zuhoerer des Blocks haengen am Dokument; ein abgehaengtes Ziel erreicht es nicht.
	seite.feuere = (typ, ziel, extra) => {
		const ereignis = Object.assign({ type: typ, target: ziel, defaultPrevented: false, button: 0, detail: 0 }, extra || {});
		ereignis.preventDefault = () => { ereignis.defaultPrevented = true; };
		if (ziel && seite.verbunden(ziel)) {
			(seite.zuhoerer[typ] || []).slice().forEach((fn) => fn(ereignis));
		}
		return ereignis;
	};

	seite.laufeTimer = () => {
		const faellig = seite.timer.splice(0);
		faellig.forEach((t) => { if (!t.geloescht) t.fn(); });
	};

	seite.vorschauen = () => seite.anfragen.filter((a) => a.aktion === "wiki_binding_preview").map((a) => a.body.target_key);

	const kontext = {
		console: console,
		Promise: Promise,
		Number: Number,
		String: String,
		Object: Object,
		Map: Map,
		Error: Error,
		document: {
			addEventListener: (typ, fn) => { (seite.zuhoerer[typ] = seite.zuhoerer[typ] || []).push(fn); },
			querySelectorAll: () => [],
		},
		$: (id) => elemente[id] || null,
		esc: (s) => String(s === null || s === undefined ? "" : s),
		api: (aktion, optionen) => {
			seite.anfragen.push({ aktion: aktion, body: (optionen && optionen.body) || {} });
			if (aktion === "wiki_binding_candidates") {
				return Promise.resolve({ rows: KANDIDATEN });
			}
			// 🔴 Die Vorschau haengt -- sie schreibt ohnehin nichts, und der Test braucht nur ihren Aufruf.
			return new Promise(() => {});
		},
		BYKEY: new Map([["eigener-knoten:knoten7", { wiki_key: "eigener-knoten:knoten7", name: "Táyârret" }]]),
		selectedKey: "eigener-knoten:knoten7",
		setStatus: () => {},
		loadModel: () => Promise.resolve(),
		selectKey: () => {},
		confirm: () => { throw new Error("confirm darf in diesem Test nie gerufen werden"); },
		setTimeout: (fn) => { const t = { fn: fn, geloescht: false }; seite.timer.push(t); return t; },
		clearTimeout: (t) => { if (t) t.geloescht = true; },
	};
	kontext.window = kontext;
	vm.createContext(kontext);
	// Wie die Seite: erst das geteilte Bauteil (Huelle, Zeilenbauer, Trefferdeckel), dann das Seitenskript.
	vm.runInContext(lies("js/ui/wiki-assign.js"), kontext, { filename: "js/ui/wiki-assign.js" });
	vm.runInContext(BLOCK, kontext, { filename: "html/wiki-sync-monitor.html (Bindungsblock)" });
	seite.kontext = kontext;

	/**
	 * Eine Zeigergeste, wie der Browser sie zustellt.
	 * 🔴 Die zwei gemessenen Regeln stehen HIER und nirgends sonst:
	 *   - der Fokus verlaesst das Suchfeld beim Druecken, es sei denn, `mousedown` wird verhindert;
	 *   - ist das Druckziel beim Loslassen ausgetauscht, kommt KEIN `click`.
	 * `klickTrotzAustausch` ist die Gegenprobe fuer einen Browser, der ihn dann doch zustellt.
	 */
	seite.geste = async (optionen) => {
		const unten = optionen.drueckeAuf();
		const knopf = typeof optionen.knopf === "number" ? optionen.knopf : 0;
		const druck = seite.feuere("mousedown", unten, { button: knopf, detail: 1 });
		if (!druck.defaultPrevented) {
			seite.aktiv = body;
		}
		await mikro();
		if (typeof optionen.zwischen === "function") {
			await optionen.zwischen();
			await mikro();
		}
		const oben = optionen.loslassenAuf();
		seite.feuere("mouseup", oben, { button: knopf, detail: 1 });
		if (knopf !== 0) {
			return { druck };
		}
		if (!seite.verbunden(unten)) {
			if (optionen.klickTrotzAustausch) {
				seite.feuere("click", oben, { button: 0, detail: 1 });
			}
		} else {
			let ziel = null;
			for (let x = unten; x && !ziel; x = x.parentNode) {
				if (x.contains(oben)) {
					ziel = x;
				}
			}
			if (ziel) {
				seite.feuere("click", ziel, { button: 0, detail: 1 });
			}
		}
		await mikro();
		return { druck };
	};

	return seite;
}

/** Ein Kasten mit gefuellter Trefferliste, der Fokus im Suchfeld. */
async function kastenMitTreffern() {
	const seite = baueSeite();
	seite.suche.focus();
	seite.suche.value = "Gar";
	seite.feuere("input", seite.suche);
	seite.laufeTimer();
	await mikro();
	pruefe(seite.zeile(3) !== null, "die Trefferliste steht (sonst prueft der Rest nichts): " + seite.liste.innerHTML);
	return seite;
}

// Die entprellte Suchantwort, die genau zwischen Druecken und Loslassen eintrifft.
async function suchantwortTrifftEin(seite) {
	seite.suche.value = "Gare";
	seite.feuere("input", seite.suche);
	seite.laufeTimer();
	await mikro();
}

(async () => {
	// ── A) DIE LISTE WIRD ZWISCHEN DRUECKEN UND LOSLASSEN NEU GEZEICHNET ──────────────────────────
	{
		const seite = await kastenMitTreffern();
		await seite.geste({
			drueckeAuf: () => seite.zeile(2).name,
			zwischen: () => suchantwortTrifftEin(seite),
			loslassenAuf: () => seite.zeile(2).name,
		});
		gleich(seite.vorschauen(), ["wiki:garether-pforte"],
			"🔴 die Suchantwort kam zwischen Druecken und Loslassen -- die Vorschau des gedrueckten Treffers "
				+ "muss trotzdem aufgehen (vorher: kein click, keine Vorschau)");
	}

	// ── B) DER ZEIGER RUTSCHT IN DEN SPALT ZWISCHEN ZWEI ZEILEN ───────────────────────────────────
	{
		const seite = await kastenMitTreffern();
		await seite.geste({
			drueckeAuf: () => seite.zeile(1).name,
			loslassenAuf: () => seite.liste,
		});
		gleich(seite.vorschauen(), ["wiki:garetien"],
			"🔴 Loslassen im Spalt der Liste -- gezeigt wird, was GEDRUECKT wurde (vorher: click auf der Liste, nichts)");
	}

	// ── C) DRUECKEN AUF EINER ZEILE, LOSLASSEN AUF DER NAECHSTEN ──────────────────────────────────
	{
		const seite = await kastenMitTreffern();
		await seite.geste({
			drueckeAuf: () => seite.zeile(0).name,
			loslassenAuf: () => seite.zeile(1).name,
		});
		gleich(seite.vorschauen(), ["wiki:gareth"], "gezeigt wird die GEDRUECKTE Zeile, nicht die beim Loslassen");
	}

	// ── D) DER GEWOEHNLICHE KLICK: GENAU EINE VORSCHAU, UND DER FOKUS BLEIBT IM SUCHFELD ───────────
	{
		const seite = await kastenMitTreffern();
		const { druck } = await seite.geste({
			drueckeAuf: () => seite.zeile(3).name,
			loslassenAuf: () => seite.zeile(3).name,
		});
		gleich(seite.vorschauen(), ["wiki:gareth-nord"], "ein ruhiger Klick oeffnet genau EINE Vorschau");
		pruefe(druck.defaultPrevented, "🔴 der Druck auf einen Treffer wird verhindert (sonst verliert das Suchfeld den Fokus)");
		pruefe(seite.aktiv === seite.suche, "und das Suchfeld behaelt den Fokus -- ↑ ↓ und Enter gehen danach weiter");
		pruefe(vm.runInContext("bindungAktiv", seite.kontext) === 3, "der gewaehlte Treffer ist der aktive");
		pruefe(/aria-selected="true" data-wa-treffer="3"/.test(seite.liste.innerHTML),
			"und die neu gezeichnete Liste markiert ihn");
	}

	// ── E) EIN KLICK, DER NICHT VOM ZEIGER KOMMT, WAEHLT WEITERHIN ────────────────────────────────
	// ⚠️ Ein Screenreader (oder `element.click()`) loest einen `click` OHNE vorheriges `mousedown`
	// aus, mit `detail === 0`. Den darf der Umbau nicht verlieren.
	{
		const seite = await kastenMitTreffern();
		seite.feuere("click", seite.zeile(1).name, { detail: 0 });
		await mikro();
		gleich(seite.vorschauen(), ["wiki:garetien"], "ein click ohne Zeiger (detail 0) oeffnet die Vorschau");
	}

	// ── F) ENTER GEHT DURCH DENSELBEN PFAD ────────────────────────────────────────────────────────
	{
		const seite = await kastenMitTreffern();
		seite.feuere("keydown", seite.suche, { key: "ArrowDown" });
		seite.feuere("keydown", seite.suche, { key: "Enter" });
		await mikro();
		gleich(seite.vorschauen(), ["wiki:garetien"], "↓ und Enter zeigen weiterhin die Vorschau des aktiven Treffers");
	}

	// ── G) RECHTS- UND MITTELKLICK WAEHLEN NICHTS ─────────────────────────────────────────────────
	{
		const seite = await kastenMitTreffern();
		const rechts = await seite.geste({ knopf: 2, drueckeAuf: () => seite.zeile(0).name, loslassenAuf: () => seite.zeile(0).name });
		const mitte = await seite.geste({ knopf: 1, drueckeAuf: () => seite.zeile(1).name, loslassenAuf: () => seite.zeile(1).name });
		gleich(seite.vorschauen(), [], "ein Rechts- oder Mittelklick oeffnet keine Vorschau");
		pruefe(!rechts.druck.defaultPrevented && !mitte.druck.defaultPrevented,
			"und er wird nicht verhindert (das Kontextmenue bleibt, wie es ist)");
	}

	// ── H) DER DRUCK AUSSERHALB EINER ZEILE BLEIBT UNBERUEHRT ─────────────────────────────────────
	// ⚠️ Die Bildlaufleiste der Liste IST die Liste -- ein verhinderter Druck dort liesse sich nicht ziehen.
	{
		const seite = await kastenMitTreffern();
		const aufListe = seite.feuere("mousedown", seite.liste, { button: 0, detail: 1 });
		pruefe(!aufListe.defaultPrevented, "ein Druck auf die Liste selbst (Bildlaufleiste) wird nicht verhindert");
		const aufsFeld = seite.feuere("mousedown", seite.suche, { button: 0, detail: 1 });
		pruefe(!aufsFeld.defaultPrevented, "ein Druck ins Suchfeld wird nicht verhindert (Zeiger setzen, markieren)");
		gleich(seite.vorschauen(), [], "und keiner der beiden oeffnet eine Vorschau");
	}

	// ── I) DER ZUHOERER HAENGT AM DOKUMENT -- EINE FREMDE LISTE BLEIBT UNBERUEHRT ──────────────────
	// 💣 Eine Zeile mit `data-wa-treffer` ausserhalb des Bindungskastens gehoert einem anderen Bauteil.
	// Verhindert der Kasten dort den Druck, verliert jenes Suchfeld den Fokus nicht mehr, und waehlte er
	// dort, oeffnete ein Klick in einer ganz anderen Liste die Vorschau einer Bindung.
	{
		const seite = await kastenMitTreffern();
		const druck = seite.feuere("mousedown", seite.fremd.kinder[1], { button: 0, detail: 1 });
		seite.feuere("click", seite.fremd.kinder[1], { button: 0, detail: 0 });
		await mikro();
		pruefe(!druck.defaultPrevented, "🔴 ein Druck auf eine FREMDE Trefferzeile wird nicht verhindert");
		gleich(seite.vorschauen(), [], "und oeffnet keine Bindungsvorschau");
	}

	// ── J) EIN BROWSER, DER DEN KLICK DOCH ZUSTELLT, OEFFNET NICHT DOPPELT ────────────────────────
	// 💣 Der Druck zeichnet die Liste neu; ein Browser, der den `click` dann auf die neue Zeile an
	// derselben Stelle zustellt, liesse sonst eine zweite Vorschau abgehen -- und die spaeter
	// eintreffende Antwort gewaenne. Chrome stellt ihn nicht zu (gemessen); die Regel darf sich darauf
	// nicht verlassen.
	{
		const seite = await kastenMitTreffern();
		await seite.geste({
			drueckeAuf: () => seite.zeile(1).name,
			loslassenAuf: () => seite.zeile(1).name,
			klickTrotzAustausch: true,
		});
		gleich(seite.vorschauen(), ["wiki:garetien"], "🔴 der Zeiger-click nach dem Druck oeffnet KEINE zweite Vorschau");
	}

	// ── K) „ABBRECHEN" GEHT WEITER DURCH DENSELBEN click-ZUHOERER ─────────────────────────────────
	{
		const seite = await kastenMitTreffern();
		seite.feuere("click", seite.abbruch, { detail: 1 });
		await mikro();
		gleich(seite.liste.innerHTML, "", "Abbrechen leert die Trefferliste");
		gleich(seite.suche.value, "", "und das Suchfeld");
	}

	// ── L) GESCHRIEBEN WIRD NIE ───────────────────────────────────────────────────────────────────
	{
		const seite = await kastenMitTreffern();
		await seite.geste({ drueckeAuf: () => seite.zeile(0).name, loslassenAuf: () => seite.zeile(0).name });
		pruefe(!seite.anfragen.some((a) => a.aktion === "wiki_binding_apply"), "eine Wahl in der Liste zeigt nur die Vorschau -- sie bindet nicht");
	}

	console.log("OK - bindung-treffer-beim-druecken: " + pruefungen + " Pruefungen erfuellt");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
