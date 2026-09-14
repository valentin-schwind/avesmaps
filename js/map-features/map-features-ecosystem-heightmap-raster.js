// Landschaften — die KODIERREGEL der gespeicherten Höhenraster (V11): uint16 = Höhe in Schritt,
// little-endian, base64. Sie muss mit `avesmapsHeightmapDecode` (api/_internal/app/heightmap.php)
// übereinstimmen -- nachgebaut wäre das die zweite Wahrheit, und ihr Fehler sähe aus wie ein kaputtes
// Gebirge, nicht wie ein Kodierfehler.
//
// 🔴 HIER WIRD NICHT GERECHNET. Bis zum 14.09.2026 standen in dieser Datei auch ein Rasterer
// (`rasterizeEcosystemHeightField`) und sein Gitterbauer (`ecosystemHeightmapGrid`), die das alte
// V8-Höhenfeld abtasteten. Ihr einziger Aufrufer war der Sammellauf „Höhenraster" des
// Landschaften-Editors; der ruft seither je Gebirge den Speicherweg der Karte
// (`gebirgsRasterHochladen`, map-features-ecosystem-height-render.js), und das Raster entsteht in der
// Gebirgssimulation (`avesmapsGebirgsRasterBauen`). Wer hier wieder ein Rasterverfahren anlegt, baut
// den zweiten Erzeuger, an dem jener Lauf zehn Tage stillgelegt war.
//
// 🔴 EIN RASTER TRÄGT NUR DAS EIGENE FELD. Der Leser verbindet überlappende per MAXIMUM
// (`avesmapsHeightmapSampleSum`, trotz des Namens) -- eine geänderte Nachbarfläche macht kein fremdes
// Raster ungültig.
//
// 🔴 DER PIXELWERT IST DIE HÖHE IN SCHRITT. Kein Weißpunkt, kein Maßstab, keine Normierung. Was auf
// dem Bildschirm steht, ist NICHT die Höhe: die Anzeige hat eigene Bezüge
// (map-features-ecosystem-height-render.js). Wer diese Pixel speicherte, bekäme je Gebirge einen
// anderen Maßstab und Steigungen, die um genau diesen Dehnfaktor falsch sind -- unterschiedlich falsch
// je Fläche, und für niemanden sichtbar.

// 0..65.535 fasst die 15.000 Schritt aus Owner-Entscheid 5 auf einen Schritt genau, mit vierfachem
// Spielraum. Ein Wert darüber ist ein Datenfehler; er wird GEKLEMMT, nie umgebrochen -- ein Umbruch
// machte aus einem Berg ein Tal.
const ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT = 65535;

// Little-endian Bytes, base64. 🔴 Der Browser komprimiert NICHT: der Server deflatet beim Schreiben
// (`gzdeflate`) und inflatet beim Lesen. Das erspart eine Formatabsprache zwischen
// `CompressionStream` und PHPs zlib -- und je Fläche sind es höchstens 286 KB roh, also 382 KB
// base64, weit unter dem üblichen `post_max_size` von 8 MB.
function ecosystemHeightmapToBase64(samples) {
	const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
	let binary = "";
	// In Blöcken, nicht in einem Rutsch: `String.fromCharCode(...bytes)` sprengt bei 572.000 Bytes
	// den Argumentstapel.
	for (let i = 0; i < bytes.length; i += 8192) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
	}

	return typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT,
		ecosystemHeightmapToBase64,
	};
}
