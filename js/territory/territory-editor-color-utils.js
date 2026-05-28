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
		const hsv = rgbToHsv(rgb.red, rgb.green, rgb.blue);
		const depth = Math.max(1, Number(options.depth || 1));
		const siblingIndex = Math.max(0, Number(options.siblingIndex || 0));
		const siblingCount = Math.max(1, Number(options.siblingCount || 1));
		const range = options.range || { min256: 10, max256: 20 };
		let span = Math.min(24, 14 / (1 + ((depth - 2) * 0.45)) + Math.min(12, Math.max(0, siblingCount - 1) * 0.55));

		span = Math.max((range.min256 / 256) * 360, Math.min(span, (range.max256 / 256) * 360));
		const position = siblingCount > 1 ? siblingIndex / (siblingCount - 1) : 0.5;
		const offset = ((position * 2) - 1) * span;
		const jitter = (((seededUnit(`${options.seedText || ""}:jitter`) * 2) - 1) * Math.max(0.75, Math.min(2.5, span * 0.18)));

		return hsvToHex((hsv.hue + offset + jitter + 360) % 360, hsv.saturation, hsv.value);
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
