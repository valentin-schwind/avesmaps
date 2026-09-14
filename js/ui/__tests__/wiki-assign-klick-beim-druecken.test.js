// 💣 EIN TREFFER WIRD BEIM DRUECKEN GEWAEHLT, NICHT BEIM LOSLASSEN.
//
// ANLASS (Owner 02.09.2026, „es wird angezeigt aber ich kanns nicht anklicken"; der Befund blieb
// bis zum 14.09.2026 offen). Die Wiki-Zuweisung waehlte auf `click`. Ein `click` entsteht erst beim
// LOSLASSEN, und der Browser stellt ihn nur zu, wenn Druecken und Loslassen dasselbe Element
// treffen -- sonst landet er am gemeinsamen Vorfahren, oder er kommt gar nicht.
//
// 🔴 IM ECHTEN CHROME GEMESSEN (14.09.2026, echte Eingabe, Probeseite mit dem echten Bauteil):
//   1. Klick ohne Bewegung: pointerdown → mousedown → pointerup → mouseup → click, `detail=1`. Geht.
//      Und schon dabei wandert der Fokus: beim `mousedown` steht er im Suchfeld, beim `pointerup`
//      auf `body` -- das Suchfeld verliert ihn beim DRUECKEN.
//   2. Dieselbe Geste, aber die Trefferliste wird zwischen Druecken und Loslassen neu gezeichnet
//      (eine Suchantwort, die in diesem Augenblick eintrifft): mousedown UND mouseup liegen beide
//      in derselben Zeile -- und es kommt KEIN `click`. `zuweisen` lief nie. Der Zeiger hat die
//      Zeile dabei nicht verlassen.
// Dazu die zweite Haelfte derselben Klasse, die die Befundsitzung beschrieben hat: der Zeiger
// rutscht zwischen Druecken und Loslassen in den 3-px-Spalt zwischen zwei Zeilen -- der `click`
// faellt dann auf die LISTE, `closest("[data-wa-treffer]")` findet nichts.
//
// ⭐ DAS HAUS HATTE DIE LOESUNG ZWEI ZENTIMETER TIEFER IM SELBEN DIALOG: der Quellen-Autocompleter
// (js/ui/source-autocomplete.js) waehlt auf `mousedown` mit `preventDefault()`. Dasselbe jetzt hier,
// EINMAL im geteilten Bauteil, fuer alle acht Objektarten in elf Oberflaechen.
//
// DIESER TEST faehrt die Ereignisfolge durch das echte Bauteil. Das DOM ist eine Attrappe, aber sie
// bildet genau die zwei gemessenen Regeln des Browsers nach (Fokus wandert beim Druecken; ein
// ausgetauschtes Druckziel bekommt keinen `click`) -- und sonst nichts.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/wiki-assign-klick-beim-druecken.test.js
"use strict";

const assert = require("assert");
const { avesmapsWikiAssignSubject } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
global.avesmapsWikiAssignSubject = avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;
const { avesmapsWikiAssignMount } = require("../wiki-assign.js");

let pruefungen = 0;
const pruefe = (bedingung, was) => { assert.ok(bedingung, was); pruefungen++; };
const gleich = (ist, soll, was) => { assert.deepStrictEqual(ist, soll, was); pruefungen++; };
const mikro = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); } };

// ── Die DOM-Attrappe ─────────────────────────────────────────────────────────────────────────────
// Nur, was das Bauteil anfasst: innerHTML am Behaelter und an der Liste, querySelector nach einem
// Merkmal, closest/contains, Fokus. Das Markup wird NICHT geparst, nur nach den Merkmalen abgesucht,
// an denen der Klickpfad entscheidet.

function baueSeite() {
	const seite = { aktiv: null };
	const body = knoten({}, null);
	seite.body = body;

	function knoten(merkmale, eltern) {
		const k = { merkmale: Object.assign({}, merkmale), parentNode: eltern, kinder: [], value: "", textContent: "" };
		k.getAttribute = (n) => (Object.prototype.hasOwnProperty.call(k.merkmale, n) ? String(k.merkmale[n]) : null);
		k.hasAttribute = (n) => Object.prototype.hasOwnProperty.call(k.merkmale, n);
		k.setAttribute = (n, w) => { k.merkmale[n] = String(w); };
		k.removeAttribute = (n) => { delete k.merkmale[n]; };
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
		k.focus = () => { seite.aktiv = k; };
		k.setSelectionRange = () => {};
		if (eltern) {
			eltern.kinder.push(k);
		}
		return k;
	}

	function abhaengen(k) {
		k.kinder.forEach((kind) => { kind.parentNode = null; });
		k.kinder = [];
	}

	function zeilenBauen(liste, html) {
		abhaengen(liste);
		const re = /data-wa-treffer="(\d+)"/g;
		let m;
		while ((m = re.exec(html)) !== null) {
			const zeile = knoten({ "data-wa-treffer": m[1] }, liste);
			// Gedrueckt wird in der Praxis auf den NAMEN in der Zeile, nicht auf die Zeile selbst
			// (gemessen: `mousedown@in-ZEILE1(label-wiki-picker-list__name)`).
			zeile.name = knoten({}, zeile);
		}
	}

	const zuhoerer = {};
	const behaelter = knoten({ id: "host" }, body);
	behaelter.addEventListener = (typ, fn) => { (zuhoerer[typ] = zuhoerer[typ] || []).push(fn); };
	behaelter.removeEventListener = (typ, fn) => {
		zuhoerer[typ] = (zuhoerer[typ] || []).filter((f) => f !== fn);
	};
	behaelter.zuhoererZahl = (typ) => (zuhoerer[typ] || []).length;
	let behaelterHtml = "";
	Object.defineProperty(behaelter, "innerHTML", {
		get: () => behaelterHtml,
		set: (html) => {
			behaelterHtml = String(html);
			abhaengen(behaelter);
			if (behaelterHtml.includes("data-wa-suche")) {
				knoten({ "data-wa-suche": "" }, behaelter);
			}
			if (behaelterHtml.includes("data-wa-hinweis")) {
				knoten({ "data-wa-hinweis": "" }, behaelter);
			}
			const aktionen = /data-wa-aktion="([\w-]+)"/g;
			let a;
			while ((a = aktionen.exec(behaelterHtml)) !== null) {
				knoten({ "data-wa-aktion": a[1] }, behaelter);
			}
			if (behaelterHtml.includes("data-wa-liste")) {
				const liste = knoten({ "data-wa-liste": "" }, behaelter);
				let listenHtml = "";
				Object.defineProperty(liste, "innerHTML", {
					get: () => listenHtml,
					set: (inhalt) => { listenHtml = String(inhalt); zeilenBauen(liste, listenHtml); },
				});
				zeilenBauen(liste, behaelterHtml);
			}
		},
	});
	behaelter.querySelector = (selektor) => {
		const m = /^\[([\w-]+)\]$/.exec(selektor);
		const suche = (k) => {
			for (const kind of k.kinder) {
				if (m && kind.hasAttribute(m[1])) {
					return kind;
				}
				const tief = suche(kind);
				if (tief) {
					return tief;
				}
			}
			return null;
		};
		return suche(behaelter);
	};
	behaelter.textContent = "";

	seite.behaelter = behaelter;
	seite.verbunden = (k) => {
		for (let x = k; x; x = x.parentNode) {
			if (x === body) {
				return true;
			}
		}
		return false;
	};
	seite.suchfeld = () => behaelter.querySelector("[data-wa-suche]");
	seite.liste = () => behaelter.querySelector("[data-wa-liste]");
	seite.zeile = (index) => (seite.liste() ? seite.liste().kinder.find((z) => z.getAttribute("data-wa-treffer") === String(index)) : null) || null;

	// Ein Ereignis steigt vom Ziel auf; das Bauteil hoert NUR am Behaelter. Ein abgehaengtes Ziel
	// erreicht den Behaelter nicht -- wie im Browser.
	seite.feuere = (typ, ziel, extra) => {
		const ereignis = Object.assign({ type: typ, target: ziel, defaultPrevented: false, button: 0, detail: 0 }, extra || {});
		ereignis.preventDefault = () => { ereignis.defaultPrevented = true; };
		ereignis.stopPropagation = () => {};
		ereignis.stopImmediatePropagation = () => {};
		if (ziel && behaelter.contains(ziel)) {
			(zuhoerer[typ] || []).slice().forEach((fn) => fn(ereignis));
		}
		return ereignis;
	};

	seite.gemeinsamerVorfahr = (a, b) => {
		for (let x = a; x; x = x.parentNode) {
			if (x.contains(b)) {
				return x;
			}
		}
		return null;
	};

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
			const ziel = seite.gemeinsamerVorfahr(unten, oben);
			if (ziel) {
				seite.feuere("click", ziel, { button: 0, detail: 1 });
			}
		}
		await mikro();
		return { druck };
	};

	return seite;
}

const ARTIKEL = ["Gareth", "Garetien", "Garether Pforte", "Gareth-Nord"].map((name) => ({
	name: name, wiki_url: "https://x/" + name, wiki_key: name.toLowerCase(), werte: {},
}));

/** Ein Kasten in der geoeffneten Suche. `zuweisen` bestimmt, wie der „Server" antwortet. */
async function kastenInDerSuche(zuweisen) {
	const seite = baueSeite();
	const gewaehlt = [];
	const steuerung = avesmapsWikiAssignMount(seite.behaelter, {
		subject: "kraftlinie",
		skin: "label-wiki",
		laden: () => ({ artikel: null, kartenwerte: {}, listen: { wiki_articles: ARTIKEL } }),
		zuweisen: (treffer) => { gewaehlt.push(treffer.name); return zuweisen(treffer); },
		verwerfen: () => {},
	});
	await steuerung.neuLaden();
	const zuweisenKnopf = seite.behaelter.querySelector("[data-wa-aktion]");
	seite.feuere("click", zuweisenKnopf, { detail: 1 });
	await mikro();
	pruefe(seite.zeile(3) !== null, "die Trefferliste steht (sonst prueft der Rest nichts): " + seite.behaelter.innerHTML);
	return { seite, gewaehlt, steuerung };
}

const haengt = () => new Promise(() => {});

(async () => {
	// ── A) DIE LISTE WIRD ZWISCHEN DRUECKEN UND LOSLASSEN NEU GEZEICHNET ──────────────────────────
	// Genau der im Chrome gemessene Fall 2. Ausloeser ist hier ein Tastendruck im Suchfeld (die
	// Listen-Suche antwortet in einer Mikroaufgabe); live ist es eine Server-Suchantwort, die in
	// diesem Augenblick eintrifft.
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		await seite.geste({
			drueckeAuf: () => seite.zeile(2).name,
			zwischen: () => {
				const feld = seite.suchfeld();
				feld.value = "Gare";
				seite.feuere("input", feld);
			},
			loslassenAuf: () => seite.zeile(2).name,
		});
		gleich(gewaehlt, ["Garether Pforte"],
			"🔴 die Liste wurde zwischen Druecken und Loslassen neu gezeichnet -- der Treffer muss "
				+ "trotzdem gewaehlt sein (vorher: kein click, keine Zuweisung)");
	}

	// ── B) DER ZEIGER RUTSCHT IN DEN SPALT ZWISCHEN ZWEI ZEILEN ───────────────────────────────────
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		await seite.geste({
			drueckeAuf: () => seite.zeile(1).name,
			loslassenAuf: () => seite.liste(),
		});
		gleich(gewaehlt, ["Garetien"],
			"🔴 Loslassen im Spalt der Liste -- gewaehlt ist, was GEDRUECKT wurde (vorher: click auf "
				+ "der Liste, keine Zeile, nichts)");
	}

	// ── C) DRUECKEN AUF EINER ZEILE, LOSLASSEN AUF DER NAECHSTEN ──────────────────────────────────
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		await seite.geste({
			drueckeAuf: () => seite.zeile(0).name,
			loslassenAuf: () => seite.zeile(1).name,
		});
		gleich(gewaehlt, ["Gareth"], "gewaehlt ist die GEDRUECKTE Zeile, nicht die beim Loslassen");
	}

	// ── D) DER GEWOEHNLICHE KLICK: GENAU EINE ZUWEISUNG ───────────────────────────────────────────
	// 💣 Druecken waehlt, und der `click` danach darf nicht ein zweites Mal waehlen.
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		const { druck } = await seite.geste({
			drueckeAuf: () => seite.zeile(3).name,
			loslassenAuf: () => seite.zeile(3).name,
		});
		gleich(gewaehlt, ["Gareth-Nord"], "ein ruhiger Klick weist genau EINMAL zu");
		// 🔴 Wie beim Autocompleter: das Suchfeld behaelt den Fokus, weil `mousedown` verhindert wird.
		pruefe(druck.defaultPrevented, "🔴 der Druck auf einen Treffer wird verhindert (sonst verliert das Suchfeld den Fokus)");
	}

	// ── E) EIN KLICK, DER NICHT VOM ZEIGER KOMMT, WAEHLT WEITERHIN ────────────────────────────────
	// ⚠️ Ein Screenreader (oder `element.click()`) loest einen `click` OHNE vorheriges `mousedown`
	// aus, mit `detail === 0`. Den darf der Umbau nicht verlieren.
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		seite.feuere("click", seite.zeile(1).name, { detail: 0 });
		await mikro();
		gleich(gewaehlt, ["Garetien"], "ein click ohne Zeiger (detail 0) waehlt den Treffer");
	}

	// ── F) ENTER GEHT DURCH DENSELBEN PFAD ────────────────────────────────────────────────────────
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		const feld = seite.suchfeld();
		seite.feuere("keydown", feld, { key: "ArrowDown" });
		seite.feuere("keydown", seite.suchfeld(), { key: "Enter" });
		await mikro();
		gleich(gewaehlt, ["Garetien"], "↓ und Enter waehlen weiterhin");
	}

	// ── G) RECHTS- UND MITTELKLICK WAEHLEN NICHTS ─────────────────────────────────────────────────
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		const rechts = await seite.geste({ knopf: 2, drueckeAuf: () => seite.zeile(0).name, loslassenAuf: () => seite.zeile(0).name });
		const mitte = await seite.geste({ knopf: 1, drueckeAuf: () => seite.zeile(1).name, loslassenAuf: () => seite.zeile(1).name });
		gleich(gewaehlt, [], "ein Rechts- oder Mittelklick weist nichts zu");
		pruefe(!rechts.druck.defaultPrevented && !mitte.druck.defaultPrevented,
			"und er wird nicht verhindert (das Kontextmenue bleibt, wie es ist)");
	}

	// ── H) DER DRUCK AUSSERHALB EINER ZEILE BLEIBT UNBERUEHRT ─────────────────────────────────────
	// ⚠️ Die Bildlaufleiste der Liste IST die Liste -- ein verhinderter Druck dort liesse sich nicht
	// mehr ziehen.
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		const druck = seite.feuere("mousedown", seite.liste(), { button: 0, detail: 1 });
		pruefe(!druck.defaultPrevented, "ein Druck auf die Liste selbst (Bildlaufleiste) wird nicht verhindert");
		const aufsFeld = seite.feuere("mousedown", seite.suchfeld(), { button: 0, detail: 1 });
		pruefe(!aufsFeld.defaultPrevented, "ein Druck ins Suchfeld wird nicht verhindert (Zeiger setzen, markieren)");
		gleich(gewaehlt, [], "und keiner der beiden weist zu");
	}

	// ── I) DER RIEGEL GEGEN DIE ZWEITE ZUWEISUNG STEHT WEITER ──────────────────────────────────────
	// 🔴 AGENTS.md §10 (Wiki-Drossel): 12 bis 22 POSTs eines Browsers binnen zwanzig Sekunden. Der
	// Riegel sitzt in `trefferWaehlen`, und der Druckpfad geht durch genau diese Funktion.
	{
		const { seite, gewaehlt } = await kastenInDerSuche(haengt);
		await seite.geste({ drueckeAuf: () => seite.zeile(0).name, loslassenAuf: () => seite.zeile(0).name });
		await seite.geste({ drueckeAuf: () => seite.zeile(0).name, loslassenAuf: () => seite.zeile(0).name });
		await seite.geste({ drueckeAuf: () => seite.zeile(2).name, loslassenAuf: () => seite.zeile(2).name });
		gleich(gewaehlt, ["Gareth"], "🔴 waehrend eine Zuweisung laeuft, schickt kein weiterer Druck eine zweite ab");
	}

	// ── J) EIN BROWSER, DER DEN KLICK DOCH ZUSTELLT, WAEHLT NICHT DOPPELT ─────────────────────────
	// 💣 Die gefaehrlichste Folge des Umbaus waere eine DOPPELTE Zuweisung: der Server sagt sofort ab,
	// der Riegel faellt, die Liste wird neu gezeichnet -- und ein Browser, der den `click` dann auf
	// die neue Zeile an derselben Stelle zustellt, liesse ihn ein zweites Mal waehlen. Chrome stellt
	// ihn nicht zu (gemessen); die Regel darf sich darauf nicht verlassen.
	{
		const { seite, gewaehlt } = await kastenInDerSuche(() => Promise.reject(new Error("Ziel-Ort nicht gefunden.")));
		await seite.geste({
			drueckeAuf: () => seite.zeile(1).name,
			loslassenAuf: () => seite.zeile(1).name,
			klickTrotzAustausch: true,
		});
		gleich(gewaehlt, ["Garetien"], "🔴 der Zeiger-click nach einer sofortigen Absage waehlt NICHT ein zweites Mal");
		// ⚠️ In der HINWEISZEILE, nicht im `innerHTML` des Behaelters: nach einer Absage zeichnet das
		// Bauteil nur Liste und Hinweis nach (`zeichneTreffer`), der Behaelter selbst bleibt stehen.
		const hinweis = seite.behaelter.querySelector("[data-wa-hinweis]");
		pruefe(hinweis !== null && hinweis.textContent.includes("Ziel-Ort nicht gefunden."),
			"und die Absage steht in der Hinweiszeile: " + (hinweis ? hinweis.textContent : "(keine Hinweiszeile)"));
	}

	// ── K) ZERSTOEREN NIMMT AUCH DEN NEUEN ZUHOERER AB ────────────────────────────────────────────
	{
		const { seite, steuerung } = await kastenInDerSuche(haengt);
		pruefe(seite.behaelter.zuhoererZahl("mousedown") === 1, "das Bauteil hoert auf mousedown, genau einmal");
		steuerung.zerstoeren();
		pruefe(seite.behaelter.zuhoererZahl("mousedown") === 0, "und `zerstoeren` nimmt den Zuhoerer wieder ab");
		pruefe(seite.behaelter.zuhoererZahl("click") === 0, "wie den click-Zuhoerer");
	}

	console.log("OK - wiki-assign-klick-beim-druecken: " + pruefungen + " Pruefungen erfuellt");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
