// Editor-Code nur fuer Editoren (Paket 5 der Performance-Analyse, Owner-GO 14.09.2026).
//
// In index.html steht ein Skript, das nur der Editor braucht, so da:
//
//   <template data-nur-editor><script src="js/review/…"></script></template><script>avesmapsNurEditorSkripte()</script>
//
// Ein <script> in einem <template> fuehrt der Browser nicht aus. Diese Funktion setzt es im Editor
// (`?edit=1`) an GENAU dieser Stelle ein; ein Besucher laedt es nie.
//
// 💣 WARUM document.write UND NICHT document.createElement("script"): nur ein per document.write
// eingesetztes Skript ist parserblockierend. Es laeuft also an seiner alten Stelle der Ladereihenfolge
// und VOR DOMContentLoaded -- `review-path-seasons.js` haengt sich an genau dieses Ereignis, ein
// nachgereichtes Skript verpasste es und der Wegdialog bliebe stumm. Die Einschraenkung, die Chrome fuer
// document.write kennt, gilt nur fremden Hosts; diese Skripte kommen vom eigenen.
//
// 💣 DER STEMPEL KOMMT MIT: `.github/scripts/stamp-asset-versions.py` sucht jedes <script>-Tag der Seite
// ohne Ansehen des Zusammenhangs, also auch das im <template>. `innerHTML` traegt den gestempelten `?v=`
// weiter -- ein Tag von Hand darf hier so wenig stehen wie anderswo (AGENTS.md §7).
//
// 🔴 WAS HINEIN DARF: eine Datei, deren Namen ein Skript, das JEDER laedt -- auch eines unter js/review/ --,
// nur per `typeof`-Schutz ruft oder an einer Stelle, die nachweislich nur im Editor laeuft (dann steht der
// Name in ERLAUBT des Tests). Nie als Wert durchgereicht: `.on("submit", name)` wertet den Namen schon
// beim Laden aus -- dort gehoert eine Huelle hin (`function (e) { return name.call(this, e); }`).
// Die Editorfenster unter html/ duerfen per `window.parent.*` rufen, sie laufen nur im Editor.
// 💣 Der erste Bau (14.09.2026) liess js/review/ aus und brach live: preparePowerlineData (Kartendaten,
// fuer jeden) -> renderPowerlineSyncList (review-powerline-list.js, damals fuer jeden geladen) ->
// avesmapsListBalanceRender (aus einer Vorlage) -> ReferenceError beim Besucherstart.
// `js/app/__tests__/nur-editor-skripte.test.js` haelt das fest.

function avesmapsNurEditorIstEditor() {
	// Faellt OFFEN aus: ist IS_EDIT_MODE nicht da (js/config.js fehlt), wird geladen. Ein Besucher mit
	// zu viel Code ist der Zustand von frueher; ein Editor ohne seinen Code waere kaputt.
	return typeof IS_EDIT_MODE === "undefined" || IS_EDIT_MODE !== false;
}

function avesmapsNurEditorSkripte() {
	const aufruf = document.currentScript;
	const vorlage = aufruf ? aufruf.previousElementSibling : null;
	if (!vorlage || vorlage.tagName !== "TEMPLATE" || !vorlage.hasAttribute("data-nur-editor")) {
		// Laut, nicht still: ein verrutschtes Tag nimmt dem Editor sonst wortlos eine Funktion.
		console.error("avesmapsNurEditorSkripte: direkt davor steht kein <template data-nur-editor>.");
		return;
	}
	if (!avesmapsNurEditorIstEditor()) {
		return;
	}
	document.write(vorlage.innerHTML);
}
