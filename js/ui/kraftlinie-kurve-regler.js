// Der schwebende Schieber, mit dem die Kurvenform einer Kraftlinie auf der KARTE eingestellt wird.
// Abhaengigkeitsfrei wie js/ui/ribbon-menu.js und js/ui/filter-menu.js daneben.
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §8.
//
// 🔴 Das Bauteil kennt WEDER Leaflet NOCH die Kraftlinien -- es meldet nur Zahlen. Wer es an
// refreshPowerlineLayers bindet, macht aus einem Regler ein zweites Kartenmodul.

const AVM_KURVE_REGLER_ID = "avm-kurve-regler";

function avesmapsKurveReglerText(zahl) {
	return (zahl > 0 ? "+" : "") + zahl + " %";
}

function avesmapsKurveReglerZeigen(erklaerung) {
	const o = erklaerung || {};
	// 💣 Erst den vorhandenen abraeumen. Zwei gestapelte Regler sind die Doppelanmeldung, die das
	// Sammelmenue im Menueband schon gekostet hat: der obere ist sichtbar, der untere schreibt mit.
	const alter = document.getElementById(AVM_KURVE_REGLER_ID);
	if (alter) { alter.remove(); }

	const start = Number(o.curve) || 0;
	const huelle = document.createElement("div");
	huelle.setAttribute("id", AVM_KURVE_REGLER_ID);
	huelle.className = "avm-kurve-regler";

	const kopf = document.createElement("div");
	kopf.className = "avm-kurve-regler__kopf";
	// ⚠️ Der Name gehoert dran: bei 62 Linien weiss man sonst nicht, welche man gerade biegt.
	kopf.textContent = "Kurvenform · " + String(o.name || "");
	huelle.appendChild(kopf);

	const zeile = document.createElement("div");
	zeile.className = "avm-kurve-regler__zeile";

	const eingabe = document.createElement("input");
	eingabe.setAttribute("id", AVM_KURVE_REGLER_ID + "-eingabe");
	eingabe.setAttribute("type", "range");
	eingabe.setAttribute("min", "-45");
	eingabe.setAttribute("max", "45");
	eingabe.setAttribute("step", "1");
	eingabe.setAttribute("aria-label", "Kurvenform in Prozent der Sehne");
	eingabe.className = "avm-kurve-regler__schieber";
	eingabe.value = String(start);

	const wert = document.createElement("span");
	wert.className = "avm-kurve-regler__wert";
	wert.textContent = avesmapsKurveReglerText(start);

	let zuletzt = start;
	eingabe.addEventListener("input", () => {
		// ⚠️ ZAHL, nicht Zeichenkette: der Empfaenger rechnet damit, und "40" + 1 waere "401".
		zuletzt = Number(eingabe.value) || 0;
		wert.textContent = avesmapsKurveReglerText(zuletzt);
		if (typeof o.aufAenderung === "function") { o.aufAenderung(zuletzt); }
	});

	zeile.appendChild(eingabe);
	zeile.appendChild(wert);
	huelle.appendChild(zeile);

	// 🔴 `abgeraeumt` traegt den FERTIG-Riegel, nicht das Abraeumen: Element.remove() ist von sich aus
	// mehrfach gefahrlos (eine Mutationsprobe am 29.08.2026 zeigte einen zusaetzlichen frueh-return
	// hier als toten Code). Gebraucht wird das Merkmal, damit ein zweiter Klick auf den bereits
	// entfernten Fertig-Knopf nicht ein zweites Mal meldet -- der Editor kaeme sonst doppelt zurueck.
	let abgeraeumt = false;
	const zerstoeren = () => {
		// Mehrfach gefahrlos: Fertig und Escape koennen kurz hintereinander kommen, und ein Wurf hier
		// liesse den Editor weggeblendet zurueck -- leere Karte, kein Weg zurueck.
		abgeraeumt = true;
		huelle.remove();
	};

	const fertig = document.createElement("button");
	fertig.setAttribute("id", AVM_KURVE_REGLER_ID + "-fertig");
	fertig.setAttribute("type", "button");
	fertig.className = "avm-kurve-regler__fertig";
	fertig.textContent = "Fertig";
	fertig.addEventListener("click", () => {
		// 🔴 Der Riegel steht VOR dem Melden, nicht nur vor dem Abraeumen: ein zweiter Klick auf den
		// (bereits entfernten, aber noch referenzierten) Knopf brachte den Editor sonst doppelt
		// zurueck und schriebe den Wert ein zweites Mal ins Formular.
		if (abgeraeumt) { return; }
		const wertJetzt = zuletzt;
		zerstoeren();
		if (typeof o.aufFertig === "function") { o.aufFertig(wertJetzt); }
	});
	huelle.appendChild(fertig);

	const hinweis = document.createElement("div");
	hinweis.className = "avm-kurve-regler__hinweis";
	hinweis.textContent = "Prozent der Sehne · das Vorzeichen ist die Seite · gespeichert wird erst mit „Speichern“.";
	huelle.appendChild(hinweis);

	document.body.appendChild(huelle);
	return { zerstoeren: zerstoeren };
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsKurveReglerZeigen };
}
