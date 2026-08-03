/*
 * Der Griff der Jahreszeit auf den Boden: Klimazone + Jahreszeit -> Bodenzustand -> ein Tempofaktor
 * je Wegart.
 *
 * 💣 DIESE DATEI SPIEGELT DEN SERVER (api/_internal/routing/season-ground.php). Dort steht die
 * ausfuehrliche Begruendung; hier steht dieselbe Rechnung, damit die Client-Engine dieselbe Zahl
 * liefert. `js/routing/__tests__/season-ground.test.js` liest beide Tabellen aus der PHP-Datei und
 * schickt zusaetzlich jede Kombination durch BEIDE Rechner.
 *
 * Das Wesentliche in drei Zeilen:
 *   - Die Quelle SUBTRAHIERT vom Bewegungsfaktor (-0,1 / -0,2), sie schlaegt nichts prozentual auf.
 *   - Avesmaps fuehrt keinen Bewegungsfaktor, sondern Tempi. Die Subtraktion braucht deshalb eine
 *     Skala: die Spalte der Quelle, auf Strasse = 1,0 normiert (SEASON_GROUND_PATH_FACTORS).
 *   - Angewandt wird relativ: tempo_neu = tempo_alt * (max(0,05, f - abzug) / f). Ohne Reisebeginn
 *     ist der Faktor exakt 1,0 und alles rechnet wie bisher.
 */

const SEASON_GROUND_PATH_FACTORS = {
	Reichsstrasse: 1.1,
	Strasse: 1.0,
	Weg: 0.8,
	Pfad: 0.8,
	Gebirgspass: 0.4,
	Wuestenpfad: 0.5,
	Querfeldein: 0.75,
};

/** „durch Boden kann der Gesamtwert nicht unter 0,05 sinken" (Reisehandbuch §11). */
const SEASON_GROUND_FLOOR = 0.05;

/* 💣 Die Strassenausnahme gilt NUR der Naesse: „aufgeweichter Boden … Strasse ausgenommen bei
   Naesse" (§21). Schnee und Eis treffen die Strasse sehr wohl. */
const SEASON_GROUND_CONDITIONS = {
	aufgeweicht: { penalty: 0.1, roadExempt: true },
	tauboden: { penalty: 0.1, roadExempt: true },
	schnee_leicht: { penalty: 0.1, roadExempt: false },
	tiefschnee: { penalty: 0.2, roadExempt: false },
	eis: { penalty: 0.2, roadExempt: false },
};

const SEASON_GROUND_ROAD_TYPES = ["Reichsstrasse", "Strasse"];

/* Klimazone x Jahreszeit -> Bodenzustand. Vom Owner abgenommen 2026-08-03.
   ⚠️ Eine Setzung, kein Kanon -- die Quelle nennt die Bodenzustaende, aber keine Monat-x-Region-Tabelle. */
const SEASON_GROUND_TABLE = {
	polar: { winter: "eis", fruehling: "eis", sommer: "tauboden", herbst: "eis" },
	subpolar: { winter: "tiefschnee", fruehling: "aufgeweicht", sommer: "", herbst: "aufgeweicht" },
	boreal: { winter: "tiefschnee", fruehling: "aufgeweicht", sommer: "", herbst: "aufgeweicht" },
	gemaessigt: { winter: "schnee_leicht", fruehling: "aufgeweicht", sommer: "", herbst: "aufgeweicht" },
	subtropen_winterfeucht: { winter: "aufgeweicht", fruehling: "", sommer: "", herbst: "" },
	subtropisch: { winter: "", fruehling: "", sommer: "", herbst: "" },
	tropisch: { winter: "", fruehling: "", sommer: "", herbst: "" },
};

/** Wasser hat keinen Boden -- dort wirkt die Jahreszeit ausschliesslich ueber eine Sperrung. */
const SEASON_GROUND_WATER_TYPES = ["Flussweg", "Seeweg"];

/** Klimazone + Jahreszeit -> Bodenzustand, "" wenn die Jahreszeit diese Zone in Ruhe laesst. */
function seasonGroundCondition(zoneKey, season) {
	const zone = String(zoneKey === null || zoneKey === undefined ? "" : zoneKey).trim().toLowerCase();
	const seasonKey = String(season === null || season === undefined ? "" : season).trim().toLowerCase();
	if (!zone || !seasonKey || !SEASON_GROUND_TABLE[zone]) {
		return "";
	}
	return SEASON_GROUND_TABLE[zone][seasonKey] || "";
}

/**
 * Der Faktor, mit dem das Tempo einer Etappe multipliziert wird. 1,0 heisst „unveraendert" -- und
 * genau das bekommt jeder Aufrufer ohne Reisebeginn, auf dem Wasser und auf unbekannter Wegart.
 */
function seasonSpeedFactor(pathType, zoneKey, season) {
	if (SEASON_GROUND_WATER_TYPES.indexOf(pathType) !== -1) {
		return 1.0;
	}
	const condition = seasonGroundCondition(zoneKey, season);
	if (!condition || !SEASON_GROUND_CONDITIONS[condition]) {
		return 1.0;
	}
	const baseFactor = SEASON_GROUND_PATH_FACTORS[pathType];
	if (!Number.isFinite(baseFactor) || baseFactor <= 0) {
		// Eine unbekannte Wegart wird in Ruhe gelassen statt geraten: ein Fehlgriff hier waere eine
		// stille Dauerbremse auf einer Art, an die niemand gedacht hat.
		return 1.0;
	}
	const rule = SEASON_GROUND_CONDITIONS[condition];
	if (rule.roadExempt && SEASON_GROUND_ROAD_TYPES.indexOf(pathType) !== -1) {
		return 1.0;
	}
	return Math.max(SEASON_GROUND_FLOOR, baseFactor - rule.penalty) / baseFactor;
}

/**
 * Alles, was eine Etappe braucht, um sich im Plan zu erklaeren. Null, wo die Jahreszeit nichts tut --
 * damit der Vermerk ganz entfaellt, statt „+0 %" zu schreiben.
 */
function seasonGroundReport(pathType, zoneKey, season) {
	const factor = seasonSpeedFactor(pathType, zoneKey, season);
	if (factor >= 1.0) {
		return null;
	}
	const condition = seasonGroundCondition(zoneKey, season);
	return {
		condition: condition,
		penalty: SEASON_GROUND_CONDITIONS[condition].penalty,
		speedFactor: factor,
		// Zeit ist der Kehrwert des Tempos: halbes Tempo ist doppelte Zeit, nicht „50 % mehr".
		timePercent: (1 / factor - 1) * 100,
		season: String(season || "").trim().toLowerCase(),
		zone: String(zoneKey || "").trim().toLowerCase(),
	};
}

// Node-Export (im Browser wirkungslos).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SEASON_GROUND_PATH_FACTORS,
		SEASON_GROUND_FLOOR,
		SEASON_GROUND_CONDITIONS,
		SEASON_GROUND_ROAD_TYPES,
		SEASON_GROUND_TABLE,
		SEASON_GROUND_WATER_TYPES,
		seasonGroundCondition,
		seasonSpeedFactor,
		seasonGroundReport,
	};
}
