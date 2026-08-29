// Der schwebende Schieber, mit dem die Kurvenform EINES Kraftlinien-Segments auf der KARTE
// eingestellt wird. Abhaengigkeitsfrei wie js/ui/ribbon-menu.js und js/ui/filter-menu.js daneben.
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md Abschnitt 13.3.
//
// 🔴 Das Bauteil kennt WEDER Leaflet NOCH die Kraftlinien -- es zeigt eine Liste von Stuecken, laesst
// eines waehlen und meldet Zahlen. Wer es an refreshPowerlineLayers bindet, macht aus einem Regler
// ein zweites Kartenmodul.
// 🔴 EIN KLICK WAEHLT DAS SEGMENT (Owner 29.08.2026). Das Anklicken passiert auf der KARTE; das
// Bauteil bietet dieselbe Wahl zusaetzlich als Liste an, damit dicht uebereinander liegende
// Stuecke auch dann erreichbar sind, wenn man sie nicht einzeln treffen kann.

const AVM_KURVE_REGLER_ID = "avm-kurve-regler";

function avesmapsKurveReglerText(zahl) {
	return (zahl > 0 ? "+" : "") + zahl + " %";
}

/**
 * @param {object} erklaerung
 *   name       Name der Linie (nur zur Anzeige)
 *   segmente   [{ public_id, curve, label }] -- die Stuecke der Linie
 *   aktiv      public_id des zuerst gewaehlten Stuecks (sonst das erste)
 *   aufAenderung(publicId, wert)  bei jedem Zug
 *   aufWahl(publicId)             wenn ein anderes Stueck gewaehlt wird
 *   aufFertig(werte)              einmal beim Schliessen, werte = { public_id: zahl }
 * @return {{ zerstoeren: function, waehle: function }}
 */
function avesmapsKurveReglerZeigen(erklaerung) {
	const o = erklaerung || {};
	// 💣 Erst den vorhandenen abraeumen. Zwei gestapelte Regler sind die Doppelanmeldung, die das
	// Sammelmenue im Menueband schon gekostet hat: der obere ist sichtbar, der untere schreibt mit.
	const alter = document.getElementById(AVM_KURVE_REGLER_ID);
	if (alter) { alter.remove(); }

	const segmente = Array.isArray(o.segmente) ? o.segmente.filter((s) => s && s.public_id) : [];
	// ⚠️ Der Entwurfsstand liegt HIER, nicht beim Aufrufer: „Fertig" meldet alles auf einmal, damit
	// ein Abbruch (Escape, zweiter Regler) wirklich nichts hinterlaesst.
	const werte = {};
	segmente.forEach((seg) => { werte[seg.public_id] = Number(seg.curve) || 0; });
	let aktiv = segmente.some((s) => s.public_id === o.aktiv)
		? o.aktiv
		: (segmente.length > 0 ? segmente[0].public_id : null);

	const huelle = document.createElement("div");
	huelle.setAttribute("id", AVM_KURVE_REGLER_ID);
	huelle.className = "avm-kurve-regler";

	const kopf = document.createElement("div");
	kopf.className = "avm-kurve-regler__kopf";
	huelle.appendChild(kopf);

	// Die Wahl des Stuecks. ⚠️ Bei EINEM Segment gar keine Liste -- ein Waehler fuer eine einzige
	// Moeglichkeit ist ein Klick fuer nichts.
	const wahl = document.createElement("div");
	wahl.className = "avm-kurve-regler__wahl";
	wahl.setAttribute("id", AVM_KURVE_REGLER_ID + "-wahl");
	if (segmente.length > 1) { huelle.appendChild(wahl); }

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

	const wert = document.createElement("span");
	wert.className = "avm-kurve-regler__wert";

	zeile.appendChild(eingabe);
	zeile.appendChild(wert);
	huelle.appendChild(zeile);

	const beschriftungVon = (pid) => {
		const seg = segmente.find((s) => s.public_id === pid);
		return seg && seg.label ? String(seg.label) : "";
	};

	function zeichne() {
		const jetzt = aktiv !== null ? (Number(werte[aktiv]) || 0) : 0;
		kopf.textContent = "Kurvenform · " + String(o.name || "")
			+ (aktiv !== null && beschriftungVon(aktiv) ? " · " + beschriftungVon(aktiv) : "");
		eingabe.value = String(jetzt);
		eingabe.disabled = aktiv === null;
		wert.textContent = avesmapsKurveReglerText(jetzt);
		if (segmente.length > 1) {
			wahl.textContent = "";
			segmente.forEach((seg) => {
				const knopf = document.createElement("button");
				knopf.setAttribute("type", "button");
				knopf.setAttribute("data-kurve-seg", seg.public_id);
				knopf.className = "avm-kurve-regler__stueck"
					+ (seg.public_id === aktiv ? " is-active" : "");
				knopf.setAttribute("aria-pressed", String(seg.public_id === aktiv));
				knopf.textContent = seg.label || seg.public_id;
				knopf.addEventListener("click", () => waehle(seg.public_id));
				wahl.appendChild(knopf);
			});
		}
	}

	function waehle(pid) {
		if (!segmente.some((s) => s.public_id === pid) || pid === aktiv) { return; }
		aktiv = pid;
		zeichne();
		if (typeof o.aufWahl === "function") { o.aufWahl(pid); }
	}

	eingabe.addEventListener("input", () => {
		if (aktiv === null) { return; }
		// ⚠️ ZAHL, nicht Zeichenkette: der Empfaenger rechnet damit, und "40" + 1 waere "401".
		const jetzt = Number(eingabe.value) || 0;
		werte[aktiv] = jetzt;
		wert.textContent = avesmapsKurveReglerText(jetzt);
		if (typeof o.aufAenderung === "function") { o.aufAenderung(aktiv, jetzt); }
	});

	// 🔴 `abgeraeumt` traegt den FERTIG-Riegel, nicht das Abraeumen: Element.remove() ist von sich aus
	// mehrfach gefahrlos (eine Mutationsprobe am 29.08.2026 zeigte einen zusaetzlichen frueh-return
	// hier als toten Code). Gebraucht wird das Merkmal, damit ein zweiter Klick auf den bereits
	// entfernten Fertig-Knopf nicht ein zweites Mal meldet -- der Editor kaeme sonst doppelt zurueck.
	let abgeraeumt = false;
	const zerstoeren = () => {
		abgeraeumt = true;
		huelle.remove();
	};

	const fertig = document.createElement("button");
	fertig.setAttribute("id", AVM_KURVE_REGLER_ID + "-fertig");
	fertig.setAttribute("type", "button");
	fertig.className = "avm-kurve-regler__fertig";
	fertig.textContent = "Fertig";
	fertig.addEventListener("click", () => {
		if (abgeraeumt) { return; }
		// ⚠️ Eine KOPIE: der Empfaenger haelt sie fest, und ein spaeterer Zug am (schon entfernten)
		// Regler duerfte sie nicht mehr veraendern.
		const ergebnis = Object.assign({}, werte);
		zerstoeren();
		if (typeof o.aufFertig === "function") { o.aufFertig(ergebnis); }
	});
	huelle.appendChild(fertig);

	const hinweis = document.createElement("div");
	hinweis.className = "avm-kurve-regler__hinweis";
	hinweis.textContent = segmente.length > 1
		? "Auf der Karte ein Stück anklicken oder oben wählen · Prozent der Sehne · gespeichert wird erst mit „Speichern“."
		: "Prozent der Sehne · das Vorzeichen ist die Seite · gespeichert wird erst mit „Speichern“.";
	huelle.appendChild(hinweis);

	zeichne();
	document.body.appendChild(huelle);
	return { zerstoeren: zerstoeren, waehle: waehle };
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsKurveReglerZeigen };
}
