// Landschaften — das Höhenfeld EINER Fläche als gespeichertes Raster (V11).
//
// 🔴 WARUM ÜBERHAUPT GESPEICHERT WIRD. Der Server kann dieses Feld nicht selbst erzeugen und darf es
// nie versuchen: map-features-ecosystem-height-field.js benutzt je Zelle `Math.pow` mit gebrochenem
// Exponenten (:768) sowie `Math.exp` (:972) und `Math.hypot` (:970). ECMAScript erlaubt dort
// implementierungsabhängige Ergebnisse, PHP nimmt die libm des Systems, und auf STRATO weiß niemand,
// welche läuft. Das bliebe nicht klein: `field.noiseScale = target / Math.pow(loudest, exponent)`
// (:663) hängt an einem ARGMAX -- ein anderes letztes Bit in EINER Zelle entscheidet, welche die
// lauteste ist, und verschiebt damit die Skalierung der GANZEN Fläche. Also rechnet der Browser
// einmal, das Ergebnis wird gespeichert, alle lesen es.
//
// 🔴 EIN RASTER TRÄGT NUR DAS EIGENE FELD, nicht die Stapelsumme (Spec §5.0). Der Leser summiert
// überlappende Raster; dafür bezahlt er einen Zugriff je Raster und bekommt dreierlei zurück: der
// Rasterlauf kostet bei 40 Flächen ~0,2 s statt ~7 s, und eine geänderte Nachbarfläche macht KEIN
// fremdes Raster ungültig.
//
// 🔴 DER PIXELWERT IST DIE HÖHE IN SCHRITT. Kein Weißpunkt, kein Maßstab, keine Normierung. Was auf
// dem Bildschirm steht, ist NICHT die Höhe: die Anzeige kennt zwei Bezüge
// (map-features-ecosystem-height-render.js:298-300) -- den festen `HEIGHT_WHITE_SCHRITT = 5000` und,
// beim Bearbeiten, `max(100, höchster Gipfel des Stapels)`, also je Fläche GEDEHNT. Wer diese Pixel
// speicherte, bekäme je Gebirge einen anderen Maßstab und Steigungen, die um genau diesen Dehnfaktor
// falsch sind -- unterschiedlich falsch je Fläche, und für niemanden sichtbar.

// 0..65.535 fasst die 15.000 Schritt aus Owner-Entscheid 5 auf einen Schritt genau, mit vierfachem
// Spielraum. Ein Wert darüber ist ein Datenfehler; er wird GEKLEMMT, nie umgebrochen -- ein Umbruch
// machte aus einem Berg ein Tal.
const ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT = 65535;
// Wie viele Zeilen am Stück, bevor der Haupt-Thread freigegeben wird. 💣 V9 §1 hat diese Regel
// wörtlich: 529.531 Pixel bei 15 Flächen, 1,4 Mio bei 40 -- ohne Freigabe sind das mehrere Sekunden
// eingefrorener Tab, und Chrome bietet „Seite reagiert nicht" an.
const ECOSYSTEM_HEIGHTMAP_ROW_BAND = 32;

// Das Gitter EINER Fläche: deterministisch, am Zellraster ausgerichtet, allein aus der bbox.
//
// 🪤 Die Ausrichtung ist kein Schmuck. Ohne sie verschöbe schon eine winzige bbox-Änderung das ganze
// Gitter, und „hat sich das Raster geändert?" hätte keine stabile Antwort mehr.
function ecosystemHeightmapGrid(bounds, cellSize) {
	const cell = Number(cellSize) > 0 ? Number(cellSize) : 0.25;
	const originX = Math.floor(bounds.min_x / cell) * cell;
	const originY = Math.floor(bounds.min_y / cell) * cell;

	return {
		originX,
		originY,
		cellSize: cell,
		width: Math.ceil((bounds.max_x - originX) / cell) + 1,
		height: Math.ceil((bounds.max_y - originY) / cell) + 1,
	};
}

// Das Feld EINER Fläche über ihr Gitter, zeilenweise, uint16 = Schritt.
//
// `peakWindow` kommt vom Stapel und gilt über ALLE Gipfel ALLER Flächen -- je Fläche gerechnet wäre
// es wertlos, weil der Nachbargipfel dann nicht mitzählte (buildEcosystemPeakWindow).
async function rasterizeEcosystemHeightField(field, peakWindow, grid, options) {
	const settings = options || {};
	const samples = new Uint16Array(grid.width * grid.height);
	const bandCount = Math.max(1, Math.ceil(grid.height / ECOSYSTEM_HEIGHTMAP_ROW_BAND));
	const release = typeof settings.yield === "function"
		? settings.yield
		: () => new Promise((resolve) => setTimeout(resolve, 0));

	for (let band = 0; band < bandCount; band++) {
		const firstRow = band * ECOSYSTEM_HEIGHTMAP_ROW_BAND;
		const lastRow = Math.min(grid.height, firstRow + ECOSYSTEM_HEIGHTMAP_ROW_BAND);
		for (let row = firstRow; row < lastRow; row++) {
			const y = grid.originY + row * grid.cellSize;
			const offset = row * grid.width;
			for (let col = 0; col < grid.width; col++) {
				const x = grid.originX + col * grid.cellSize;
				// Genau die Abfrage, die auch die Malschleife benutzt -- das Fenster EINMAL je Punkt,
				// dann das Feld. Wer hier etwas anderes rechnet, speichert ein anderes Gelände als das
				// gezeichnete.
				const value = sampleEcosystemHeightField(field, x, y, peakWindow ? peakWindow.sample(x, y) : 1);
				const rounded = Math.round(value);
				samples[offset + col] = rounded > ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT
					? ECOSYSTEM_HEIGHTMAP_MAX_SCHRITT
					: (rounded > 0 ? rounded : 0);
			}
		}
		if (typeof settings.onRowBand === "function") {
			settings.onRowBand(band + 1, bandCount);
		}
		await release();
	}

	return samples;
}

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
		ECOSYSTEM_HEIGHTMAP_ROW_BAND,
		ecosystemHeightmapGrid,
		rasterizeEcosystemHeightField,
		ecosystemHeightmapToBase64,
	};
}
