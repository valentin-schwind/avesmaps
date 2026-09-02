const assert = require("assert");

// Das Bauteil wird hier WIRKLICH GEFAHREN, nicht im Quelltext gelesen: gefaelschtes Overlay, gefaelschte
// Ereignisse, echte Zuhoerer. Ein Quelltexttest kann bei genau dieser Regel nichts beweisen -- sie
// besteht ausschliesslich aus der Reihenfolge dreier Ereignisse.
const {
	avesmapsDialogHintergrundSchliessen,
} = require("../dialog-hintergrund-schliessen.js");

// -----------------------------------------------------------------------------------------------
// Ein Minimal-DOM: ein Knoten sammelt seine Zuhoerer, `feuere` reicht ein Ereignis hinein. Mehr
// braucht die Regel nicht -- sie fragt nur nach `event.target` und `event.button`.
// -----------------------------------------------------------------------------------------------
function knoten() {
	const zuhoerer = new Map();
	return {
		zuhoerer,
		anzahl: 0,
		addEventListener(art, fn) {
			if (!zuhoerer.has(art)) { zuhoerer.set(art, []); }
			zuhoerer.get(art).push(fn);
			this.anzahl += 1;
		},
		feuere(art, event) {
			(zuhoerer.get(art) || []).forEach((fn) => fn(event));
		},
	};
}

// Baut ein Overlay samt Zaehler fuer die Schliessaufrufe.
function buehne() {
	const overlay = knoten();
	const dialog = {};          // der Fensterkasten IM Overlay
	const eingabefeld = {};     // ein Textfeld im Fenster
	let geschlossen = 0;
	avesmapsDialogHintergrundSchliessen(overlay, () => { geschlossen += 1; });
	return {
		overlay,
		dialog,
		eingabefeld,
		zaehler: () => geschlossen,
		// Ein vollstaendiger Mausklick: Druck, Loslassen, Klick. `klickZiel` ist im Browser der
		// naechste gemeinsame Vorfahre von Druck- und Loslass-Ziel.
		klick(druckZiel, losZiel, klickZiel, button = 0) {
			overlay.feuere("pointerdown", { target: druckZiel, button });
			overlay.feuere("pointerup", { target: losZiel, button });
			overlay.feuere("click", { target: klickZiel, button });
		},
	};
}

// -----------------------------------------------------------------------------------------------
// 1. Der Normalfall: Druck und Loslassen auf dem Hintergrund -- das Fenster geht zu.
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	b.klick(b.overlay, b.overlay, b.overlay);
	assert.strictEqual(b.zaehler(), 1, "Klick auf den Hintergrund muss schliessen");
}

// -----------------------------------------------------------------------------------------------
// 2. Ein Klick IM Fenster laesst es offen. (Der Zuhoerer haengt am Overlay, das Ereignis blubbert
//    also hindurch -- ohne die Zielpruefung schloesse jeder Klick im Formular den Dialog.)
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	b.klick(b.dialog, b.dialog, b.dialog);
	assert.strictEqual(b.zaehler(), 0, "Ein Klick im Fenster darf nicht schliessen");
}

// -----------------------------------------------------------------------------------------------
// 2b. Auch bei gesetzten Merkern zaehlt das Klickziel. Zwischen Loslassen und `click` kann ein
//     fremder Klick durchblubbern -- ein `element.click()` aus einem pointerup-Handler etwa. Ohne
//     die Zielpruefung waeren die Merker fuer ihn eine Erlaubnis, die er nie erworben hat.
//     (Diese Zusicherung fehlte zunaechst: die Mutationsprobe liess das Streichen der Zielpruefung
//     durchgehen, weil jeder andere Fall schon an den Merkern scheitert.)
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	b.overlay.feuere("pointerdown", { target: b.overlay, button: 0 });
	b.overlay.feuere("pointerup", { target: b.overlay, button: 0 });
	b.overlay.feuere("click", { target: b.dialog, button: 0 });
	assert.strictEqual(b.zaehler(), 0, "Ein Klick auf ein anderes Ziel darf nicht schliessen");
}

// -----------------------------------------------------------------------------------------------
// 3. DIE FALLE, DIE KEINE DER 25 VORHANDENEN STELLEN KENNT: Text in einem Eingabefeld markieren und
//    dabei ueber den Fensterrand hinausziehen. Losgelassen wird auf dem Hintergrund, und `click`
//    feuert am naechsten gemeinsamen Vorfahren -- das IST das Overlay. Eine Regel, die nur
//    `event.target === overlay` prueft, wirft hier ein ausgefuelltes Formular weg.
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	b.klick(b.eingabefeld, b.overlay, b.overlay);
	assert.strictEqual(b.zaehler(), 0, "Markieren ueber den Fensterrand hinaus darf nicht schliessen");
}

// -----------------------------------------------------------------------------------------------
// 4. Dieselbe Falle andersherum: auf dem Hintergrund gedrueckt, im Fenster losgelassen. Wer den
//    Zeiger zurueckzieht, hat es sich anders ueberlegt -- und `click` feuert wieder am Overlay.
//    Deshalb reicht der DRUCK-Merker allein nicht; das Loslassen muss mitzaehlen.
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	b.klick(b.overlay, b.dialog, b.overlay);
	assert.strictEqual(b.zaehler(), 0, "Im Fenster losgelassen heisst: nicht schliessen");
}

// -----------------------------------------------------------------------------------------------
// 5. DER FALL „Neue Position vorschlagen" (Owner 02.09.2026).
//    Der Ablauf blendet das Overlay aus (`hidden`), EIN Kartenklick setzt die Position, danach kommt
//    das Fenster mit ausgefuelltem Formular zurueck. Der Druck lag also auf dem Knopf IM Fenster,
//    und der naechste `click`, den das Overlay ueberhaupt zu sehen bekommt, hat kein `pointerdown`
//    auf dem Hintergrund hinter sich. Er darf nichts ausloesen -- sonst waere der halb geschriebene
//    Vorschlag im Moment der Positionswahl weg (Schliessen heisst hier `resetForm: true`).
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	const positionsKnopf = {};
	b.overlay.feuere("pointerdown", { target: positionsKnopf, button: 0 });
	// ... Overlay hidden, Kartenklick, Overlay wieder sichtbar ...
	b.overlay.feuere("click", { target: b.overlay, button: 0 });
	assert.strictEqual(b.zaehler(), 0, "Ein Klick ohne Druck auf dem Hintergrund darf nicht schliessen");
}

// -----------------------------------------------------------------------------------------------
// 6. Die Merker verfallen nach jedem Klick. Ohne das koennte EIN Hintergrunddruck zwei Klicks
//    bewerten -- und der zweite kaeme aus einem ganz anderen Ablauf.
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	b.klick(b.overlay, b.overlay, b.overlay);
	assert.strictEqual(b.zaehler(), 1);
	b.overlay.feuere("click", { target: b.overlay, button: 0 });
	assert.strictEqual(b.zaehler(), 1, "Ein zweiter Klick ohne neuen Druck darf nicht noch einmal schliessen");
}

// -----------------------------------------------------------------------------------------------
// 7. Nur die linke Taste. Ein Rechtsklick oeffnet auf der Karte das Kontextmenue; er darf keinen
//    Merker setzen, der einem spaeteren Klick als Erlaubnis dient.
// -----------------------------------------------------------------------------------------------
{
	const b = buehne();
	b.klick(b.overlay, b.overlay, b.overlay, 2);
	assert.strictEqual(b.zaehler(), 0, "Rechtsklick darf nicht schliessen");
}

// -----------------------------------------------------------------------------------------------
// 8. Doppelanmeldung. Die teuerste Falle des Hauses (AGENTS.md, Sammelmenue 23.08.2026): zwei
//    Zuhoerer, zwei Schliessaufrufe -- und beim Fenster faellt es nicht auf, weil es ohnehin zugeht.
//    Auffallen wuerde es erst dort, wo das Schliessen etwas kostet.
// -----------------------------------------------------------------------------------------------
{
	const overlay = knoten();
	let geschlossen = 0;
	avesmapsDialogHintergrundSchliessen(overlay, () => { geschlossen += 1; });
	const nachErstem = overlay.anzahl;
	avesmapsDialogHintergrundSchliessen(overlay, () => { geschlossen += 1; });
	assert.strictEqual(overlay.anzahl, nachErstem, "Ein zweiter Aufruf darf keine zweiten Zuhoerer anhaengen");

	overlay.feuere("pointerdown", { target: overlay, button: 0 });
	overlay.feuere("pointerup", { target: overlay, button: 0 });
	overlay.feuere("click", { target: overlay, button: 0 });
	assert.strictEqual(geschlossen, 1, "Doppelanmeldung darf nicht doppelt schliessen");
}

// -----------------------------------------------------------------------------------------------
// 9. Faellt offen aus. Ein fehlendes Overlay (umbenannte oder entfernte Kennung -- `#label-edit-
//    overlay` ist genau so gestorben) darf den Rest der Verdrahtung nicht mitreissen: bootstrap.js
//    haengt in EINEM Durchgang sieben Fenster an.
// -----------------------------------------------------------------------------------------------
{
	assert.doesNotThrow(() => avesmapsDialogHintergrundSchliessen(null, () => {}));
	assert.doesNotThrow(() => avesmapsDialogHintergrundSchliessen(undefined, () => {}));
	assert.doesNotThrow(() => avesmapsDialogHintergrundSchliessen(knoten(), null));
	// ... und ohne Schliesser wird auch nichts gerufen.
	const overlay = knoten();
	avesmapsDialogHintergrundSchliessen(overlay, null);
	assert.doesNotThrow(() => {
		overlay.feuere("pointerdown", { target: overlay, button: 0 });
		overlay.feuere("pointerup", { target: overlay, button: 0 });
		overlay.feuere("click", { target: overlay, button: 0 });
	});
}

console.log("dialog-hintergrund-schliessen.test.js: alle Zusicherungen erfuellt");
