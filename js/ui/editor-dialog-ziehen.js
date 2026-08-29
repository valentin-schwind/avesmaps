// Einen Editor-Dialog am Kopf verschieben. Abhaengigkeitsfrei wie js/ui/ribbon-menu.js daneben.
//
// 🔴 Owner 29.08.2026 zum Kraftlinien-Editor: „der editor muss zur seite geschoben werden koennen".
// Der Grund ist die Kurvenform -- man stellt sie ein, waehrend man die Linie auf der Karte sieht,
// und dafuer muss der Editor aus dem Weg.
//
// 💣 VERSCHOBEN WIRD PER `transform`, NICHT ueber `left`/`top`. Der Dialog sitzt in einem Flex-
// Overlay, das ihn zentriert; ein `left` wuerde gegen diese Zentrierung arbeiten und beim ersten
// Fenstergroessen-Wechsel springen. Eine Transform verschiebt nur das gemalte Ergebnis und laesst
// das Layout in Ruhe.

function avesmapsEditorDialogZiehbar(griff, dialog) {
	if (!griff || !dialog || griff._avmZiehen) {
		// 💣 Ein zweiter Aufruf auf demselben Griff meldete sonst ein ZWEITES Mal an -- die
		// Doppelanmeldung, die das Sammelmenue im Menueband schon gekostet hat. Dort bewegte sich
		// der Dialog dann doppelt so weit wie der Zeiger.
		return griff && griff._avmZiehen ? griff._avmZiehen : null;
	}

	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	let zeiger = null;

	const setzen = () => {
		dialog.style.transform = (x === 0 && y === 0) ? "" : "translate(" + x + "px, " + y + "px)";
	};

	const beiBewegung = (event) => {
		if (zeiger === null || event.pointerId !== zeiger) { return; }
		x = event.clientX - startX;
		y = event.clientY - startY;
		setzen();
	};

	const loslassen = (event) => {
		if (zeiger === null || (event && event.pointerId !== zeiger)) { return; }
		zeiger = null;
		// ⚠️ Die Handler haengen am DOKUMENT, nicht am Griff: wer schnell zieht, ist mit dem Zeiger
		// laengst neben dem Kopf, und ein Handler am Griff verloere die Bewegung mitten im Zug.
		document.removeEventListener("pointermove", beiBewegung);
		document.removeEventListener("pointerup", loslassen);
		document.removeEventListener("pointercancel", loslassen);
	};

	const aufnehmen = (event) => {
		// ⚠️ Nur die linke Taste, und nicht auf einem Bedienelement im Kopf -- sonst zieht man den
		// Dialog beim Klick auf „Schliessen".
		if (event.button !== 0) { return; }
		if (event.target && event.target.closest && event.target.closest("button, a, input, select")) { return; }
		zeiger = event.pointerId;
		startX = event.clientX - x;
		startY = event.clientY - y;
		document.addEventListener("pointermove", beiBewegung);
		document.addEventListener("pointerup", loslassen);
		document.addEventListener("pointercancel", loslassen);
		// Kein preventDefault: der Kopf traegt Text, und das Markieren zu verbieten ist Sache des
		// CSS (user-select: none) -- ein preventDefault hier verschluckte auch den Fokus.
	};

	griff.addEventListener("pointerdown", aufnehmen);

	const steuerung = {
		zuruecksetzen() { x = 0; y = 0; setzen(); },
		verschieben(neuX, neuY) { x = Number(neuX) || 0; y = Number(neuY) || 0; setzen(); },
		stand() { return { x: x, y: y }; },
	};
	griff._avmZiehen = steuerung;

	return steuerung;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsEditorDialogZiehbar };
}
