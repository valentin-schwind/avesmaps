"use strict";

(function initPoliticalTerritoryEditorColorUtils() {
	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function normalizeHexColor(color) {
		const normalized = normalizeText(color);
		return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : "";
	}

	function parseHexToRgb(color) {
		const normalized = normalizeHexColor(color);
		return normalized
			? {
				red: Number.parseInt(normalized.slice(1, 3), 16),
				green: Number.parseInt(normalized.slice(3, 5), 16),
				blue: Number.parseInt(normalized.slice(5, 7), 16)
			}
			: null;
	}

	function rgbToHsv(red, green, blue) {
		const r = red / 255;
		const g = green / 255;
		const b = blue / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const delta = max - min;
		let hue = 0;

		if (delta > 0) {
			if (max === r) hue = ((g - b) / delta) % 6;
			else if (max === g) hue = ((b - r) / delta) + 2;
			else hue = ((r - g) / delta) + 4;

			hue *= 60;
			if (hue < 0) hue += 360;
		}

		return {
			hue,
			saturation: max <= 0 ? 0 : delta / max,
			value: max
		};
	}

	function hsvToHex(hue, saturation, value) {
		const chroma = value * saturation;
		const huePrime = hue / 60;
		const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
		const match = value - chroma;
		const [r, g, b] = huePrime < 1
			? [chroma, secondary, 0]
			: huePrime < 2
				? [secondary, chroma, 0]
				: huePrime < 3
					? [0, chroma, secondary]
					: huePrime < 4
						? [0, secondary, chroma]
						: huePrime < 5
							? [secondary, 0, chroma]
							: [chroma, 0, secondary];

		return `#${[r, g, b].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
	}

	function seededUnit(value) {
		let hash = 2166136261;
		for (const char of String(value || "")) {
			hash ^= char.charCodeAt(0);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0) / 4294967295;
	}

	function createHueVariant(parentColor, options = {}) {
		const rgb = parseHexToRgb(parentColor) || { red: 136, green: 136, blue: 136 };
		const range = options.range || { min256: 30, max256: 30 };
		const variance256 = Math.max(Number(range.min256) || 0, Number(range.max256) || 0);
		// ALLE Variation hängt an der Varianz (dem UI-Regler): bei 0 kommt EXAKT die Elternfarbe zurück
		// (Eingabe 0,0,0,0 => überall dieselbe Farbe).
		if (variance256 <= 0) {
			return normalizeHexColor(parentColor) || parentColor;
		}
		const varFactor = Math.min(1, variance256 / 256);
		const hsv = rgbToHsv(rgb.red, rgb.green, rgb.blue);
		const depth = Math.max(1, Number(options.depth || 1));
		const siblingIndex = Math.max(0, Number(options.siblingIndex || 0));
		const siblingCount = Math.max(1, Number(options.siblingCount || 1));

		// HUE = HAUPT-Stellschraube (aus dem Farbraum): gleichmäßig über die Spanne (= Varianz in Grad).
		const span = varFactor * 360;
		const position = siblingCount > 1 ? siblingIndex / (siblingCount - 1) : 0.5;
		const offset = ((position * 2) - 1) * span;
		// Jitter proportional zur Spanne (kein fester Sockel -> bei kleiner Varianz nahe 0).
		const jitter = ((seededUnit(`${options.seedText || ""}:jitter`) * 2) - 1) * span * 0.1;

		let value = hsv.value;
		let saturation = hsv.saturation;
		if (siblingCount > 1) {
			const valuePos = (typeof options.valueIndex === "number")
				? options.valueIndex / Math.max(1, siblingCount - 1)
				: seededUnit(`${options.seedText || ""}:light`);
			const satUnit = seededUnit(`${options.seedText || ""}:sat`);
			// HELLIGKEIT variiert am WENIGSTEN: kleine Amplitude (gleichmäßig via valueIndex, de-korreliert vom Hue),
			// nur um gleich-farbige Geschwister minimal zu trennen. SÄTTIGUNG als sekundäre Trennung (stärker als
			// Helligkeit, schwächer als Hue). Beides proportional zur Varianz -> bei 0 keine Variation.
			value = Math.max(0.3, Math.min(0.95, value + (valuePos - 0.5) * varFactor * 0.12));
			saturation = Math.max(0.06, Math.min(1, saturation * (1 + (satUnit - 0.5) * varFactor * 0.9)));
		}
		// Ebenen-Staffelung der Helligkeit (Tiefe) ebenfalls an die Varianz koppeln -> bei 0 keine.
		const valueShift = Math.min(0.2, (depth - 1) * 0.05) * varFactor;
		value = Math.max(0.3, Math.min(0.95, value + (hsv.value < 0.6 ? valueShift : -valueShift)));

		return hsvToHex((hsv.hue + offset + jitter + 360) % 360, saturation, value);
	}

	window.AvesmapsPoliticalTerritoryEditorColorUtils = {
		normalizeHexColor,
		parseHexToRgb,
		rgbToHsv,
		hsvToHex,
		seededUnit,
		createHueVariant
	};
})();
