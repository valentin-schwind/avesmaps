import {
    AVENTURIA_TRAVEL_MODEL,
    familyStepFactor,
    offeredTransports,
    SLOPE_FAMILIES,
    transportFlowFactor,
    travelDayHours,
    travelSpeed,
    type SlopeFamily,
    type TravelModel,
} from "@avesmaps3d/shared";

/**
 * Die Zahlen des Erklärfensters „Transportmittel“ (WI-0045; Legacy `js/routing/transport-speed-info.js`,
 * Guide §17.9) - gerechnet aus UNSEREM Reisemodell, nie abgeschrieben.
 *
 * 🔴 Gezeigt wird das Tempo, mit dem die Route wirklich rechnet: der Tafelwert geteilt durch den
 * Zeitfaktor. Die Tafel im Reisemodell ist um ihn überhöht („Stunden = Zeit × Meilen je Einheit ×
 * Zeitfaktor“), und Legacy zeigte die überhöhte Zahl (WI-0017, Inventur C7: „wirkliches Tempo“).
 *
 * 🔴 Was ein Mittel auf einer Wegart nie darf, steht als „–“ da, nicht als Zahl: Die Kutsche fährt
 * keinen Wüstenpfad (`nieAngeboten`); querfeldein fährt sie seit WI-0258, nur über offenes Land. Legacy zeigte dort trotzdem ihre
 * Tafelzelle.
 *
 * 💣 Die Ampel und die Querfeldein-Spanne rechnen sich aus den gezeigten Zahlen (Legacy: feste
 * Schwellen und ein getippter Satz veralteten bei jeder Kalibrierung, zweimal hintereinander).
 */

/** Die Zeilen der Tempotafel, in Legacys Reihenfolge. */
export const LAND_PATH_TYPES = [
    "Reichsstrasse",
    "Strasse",
    "Weg",
    "Pfad",
    "Gebirgspass",
    "Wuestenpfad",
    "Querfeldein",
] as const;

export type Tier = "schnell" | "mittel" | "langsam";

export interface SpeedCell {
    transport: string;
    /** Meilen je Stunde, wie die Route rechnet; `null`, wenn das Mittel diese Wegart nie nimmt. */
    speed: number | null;
    tier: Tier | null;
}

export interface SpeedRow {
    pathType: string;
    cells: SpeedCell[];
}

/** Das Tempo, mit dem die Route rechnet: Tafelwert ÷ Zeitfaktor. `null`, wo das Mittel nie fährt. */
export function realSpeed(model: TravelModel, transport: string, pathType: string): number | null {
    if (!offeredTransports(model, pathType).includes(transport)) return null;
    const speed = travelSpeed(model, transport, pathType);
    return speed === null ? null : speed / model.zeitfaktor.wert;
}

/**
 * Die Ampel in Dritteln zwischen dem langsamsten und dem schnellsten gezeigten Landtempo (Legacy
 * `landTierBounds`). Sind alle gleich, ist alles „mittel“ - besser als eine Teilung durch null.
 */
export function tierOf(speed: number, speeds: readonly number[]): Tier {
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    if (!(max > min)) return "mittel";
    const step = (max - min) / 3;
    if (speed >= min + 2 * step) return "schnell";
    return speed >= min + step ? "mittel" : "langsam";
}

/** Die Tempotafel der Landreise: Zeilen = Wegart, Spalten = Landmittel. */
export function landSpeedTable(model: TravelModel = AVENTURIA_TRAVEL_MODEL): {
    transports: readonly string[];
    /** Je Spalte die Tagesleistung auf der Straße in Meilen (`tagesleistung`, WdE; Wanderer, Einzelreiter, Karawane GA); null ohne Eintrag. */
    dayMiles: (number | null)[];
    rows: SpeedRow[];
} {
    const transports = model.transportmittel.wert.land;
    const raw = LAND_PATH_TYPES.map((pathType) => ({
        pathType,
        speeds: transports.map((transport) => realSpeed(model, transport, pathType)),
    }));
    const shown = raw.flatMap((row) => row.speeds.filter((speed): speed is number => speed !== null));
    return {
        transports,
        dayMiles: transports.map((transport) => model.tagesleistung.wert[transport]?.meilen ?? null),
        rows: raw.map((row) => ({
            pathType: row.pathType,
            cells: row.speeds.map((speed, index) => ({
                transport: transports[index] ?? "",
                speed,
                tier: speed === null ? null : tierOf(speed, shown),
            })),
        })),
    };
}

/** Ein Mittel auf dem Wasser, wie die Tafel es zeigt: alles aus dem Reisemodell (WI-0069). */
export interface WaterRow {
    transport: string;
    /** Meilen je Stunde, wie die Route rechnet; auf dem Fluss stromab. */
    speed: number | null;
    /** Nur auf dem Fluss: stromauf, wo am Weg keine eigene Strömung gespeichert ist (`transportFlowFactor`). */
    upstream: number | null;
    /** Reisestunden am Tag (`travelDayHours`): dieselbe Zahl, mit der Rast und Kalender rechnen. */
    hours: number;
    /** Die Tagesleistung der Geographia, auf dem Fluss stromab; null ohne Eintrag. */
    miles: number | null;
    /** Fährt Tag und Nacht und rastet nicht (`nachtfahrt`). */
    nonStop: boolean;
}

/** Die Mittel auf dem Wasser mit Tempo, Reisestunden und Tagesleistung, in der Reihenfolge des Modells. */
export function waterSpeeds(domain: "river" | "sea", model: TravelModel = AVENTURIA_TRAVEL_MODEL): WaterRow[] {
    const pathType = domain === "river" ? "Flussweg" : "Seeweg";
    // Die Tempotafel des Seewegs gilt auch für Schiffe, die keinen gezeichneten Seeweg fahren (Ruderboot): Die
    // freie Seefahrt rechnet mit ihr. Darum hier die Tafel selbst, nicht das Angebot der Wegart.
    return model.transportmittel.wert[domain].map((transport) => {
        const table = travelSpeed(model, transport, pathType);
        const speed = table === null ? null : table / model.zeitfaktor.wert;
        return {
            transport,
            speed,
            upstream: domain === "river" && speed !== null ? speed / transportFlowFactor(model, transport) : null,
            hours: travelDayHours(model, transport),
            miles: model.tagesleistung.wert[transport]?.meilen ?? null,
            nonStop: model.nachtfahrt.wert.includes(transport),
        };
    });
}

/** Die Mittel, die Tag und Nacht fahren und nicht rasten, in der Reihenfolge des Modells. */
export function nonStopTransports(model: TravelModel = AVENTURIA_TRAVEL_MODEL): string[] {
    const water = [...model.transportmittel.wert.river, ...model.transportmittel.wert.sea];
    return water.filter((transport) => model.nachtfahrt.wert.includes(transport));
}

/** Die Spanne querfeldein über die Landmittel, die querfeldein gehen - oder `null`, wenn keins es tut. */
export function crossCountryRange(model: TravelModel = AVENTURIA_TRAVEL_MODEL): { min: number; max: number } | null {
    const speeds = model.transportmittel.wert.land
        .map((transport) => realSpeed(model, transport, "Querfeldein"))
        .filter((speed): speed is number => speed !== null);
    return speeds.length > 0 ? { min: Math.min(...speeds), max: Math.max(...speeds) } : null;
}

/**
 * Das Beispiel der Einleitung (WI-0076): das Tempo einer Gruppe zu Fuß auf der Reichsstraße und auf dem Gebirgspass,
 * wie die Route rechnet. Der alte Satz „doppelt so schnell wie ein Gebirgspfad“ war abgeschrieben und falsch (2,75-fach).
 */
export function paceExample(model: TravelModel = AVENTURIA_TRAVEL_MODEL): { road: number; pass: number } | null {
    const road = realSpeed(model, "groupFoot", "Reichsstrasse");
    const pass = realSpeed(model, "groupFoot", "Gebirgspass");
    return road === null || pass === null ? null : { road, pass };
}

/**
 * Wie schnell geführte Tiere im Gebirge sind, als Anteil des Tempos der Gruppe zu Fuß (`steigung.sternregel.gefuehrt`,
 * „Wege des Entdeckers“ S. 161): auf dem Pfad (`path`) und querfeldein (`open`). Null, wenn das Modell sie nicht kennt.
 */
export function ledPace(model: TravelModel = AVENTURIA_TRAVEL_MODEL): { path: number; open: number } | null {
    const led = model.steigung.wert.sternregel.gefuehrt;
    const path = led["Pfad"];
    const open = led["Querfeldein"];
    return path && open ? { path: path.tier / path.fuss, open: open.tier / open.fuss } : null;
}

/** Der Längenaufschlag querfeldein: so viel länger dauert ein sehr langer Marsch ohne Weg höchstens. */
export function offroadRampMax(model: TravelModel = AVENTURIA_TRAVEL_MODEL): number {
    return model.querfeldeinLaengenaufschlag.wert.hoechstens;
}

/**
 * Ab welchem Gefälle es je Familie wieder langsamer wird als in der Ebene (Regel „Bergab ist nicht schneller“):
 * gesucht am Rechner des Routers (`familyStepFactor`), nicht aus seinen Zahlen abgeschrieben - zu Fuß ab dem steilen
 * Abstieg, Tier und Wagen früher.
 */
export function steepDownhill(model: TravelModel = AVENTURIA_TRAVEL_MODEL): Record<SlopeFamily, number> {
    const result = {} as Record<SlopeFamily, number>;
    for (const family of SLOPE_FAMILIES) {
        let flat = 0;
        let slower = 1;
        for (let step = 0; step < 50; step += 1) {
            const middle = (flat + slower) / 2;
            if (familyStepFactor(family, -middle, model) > 1) slower = middle;
            else flat = middle;
        }
        result[family] = slower;
    }
    return result;
}

/**
 * Reise- und Rastzeit je Tag aus dem Reisemodell (Regel, GA): an Land die Vorgabe des Planers, auf dem Wasser der
 * gewöhnliche Tag. Ein Schiff mit eigenem Tag zeigt seine Stunden in seiner Zeile (`waterSpeeds`).
 */
export function travelDay(model: TravelModel = AVENTURIA_TRAVEL_MODEL): {
    landHours: number;
    landRest: number;
    waterHours: number;
    waterRest: number;
} {
    const hours = model.reisetagStunden.wert;
    return { landHours: hours.land, landRest: 24 - hours.land, waterHours: hours.water, waterRest: 24 - hours.water };
}
