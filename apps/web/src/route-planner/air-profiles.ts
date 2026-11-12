import { AVENTURIA_TRAVEL_MODEL, CUSTOM_AIR, type SharePayload } from "@avesmaps3d/shared";
import { formatDecimal, t } from "../i18n/i18n";
import { ICON_BASE, type SummaryPart } from "./planner-model";

/**
 * Die Flugmittel des Routenplaners (WI-0050, WI-0051): zwölf Air Transport Profiles in vier Gruppen und ein
 * eigenes, je mit Reisegeschwindigkeit und Standardflughöhe (Plan 6.35).
 *
 * 🔴 Die Werte stehen im Reisemodell (`flug` in `config/travel-model/aventuria.json`, mit Herkunft); nach
 * ihnen rechnet der Router. Hier stehen nur, was die Oberfläche braucht: Gruppe, Reihenfolge und Bild.
 *
 * Die Flughöhe ist eine fachliche Regel des Routings, keine Koordinate des Renderers (Plan 6.35):
 * „Schritt über Grund“ ist die Reisehöhe (F-E1 = C, Betreiber 2026-09-28).
 */

export type AirGroup = "devices" | "mounts" | "summoned" | "extraordinary";

/** Die Gruppen in der Reihenfolge des Zielbilds. */
export const AIR_GROUPS: readonly AirGroup[] = ["devices", "mounts", "summoned", "extraordinary"];

export type AirProfileId =
    | "witchFlight"
    | "flyingCarpet"
    | "airship"
    | "flyingLizard"
    | "hippogriff"
    | "giantAuk"
    | "skySteed"
    | "westwindDragon"
    | "airDjinn"
    | "karakil"
    | "irrhalk"
    | "griffin";

export interface AirProfile {
    id: AirProfileId;
    group: AirGroup;
    /** Reisegeschwindigkeit in Meilen je Stunde. */
    speedMph: number;
    /** Standardflughöhe in Schritt. */
    altitudePaces: number;
    icon: string;
}

/** Das Bild je Flugmittel; Tempo und Höhe kommen aus dem Reisemodell. */
const AIR_ICONS: Readonly<Record<AirProfileId, string>> = {
    witchFlight: `${ICON_BASE}Hexenflug.webp`,
    flyingCarpet: `${ICON_BASE}FliegenderTeppich.webp`,
    airship: `${ICON_BASE}Flugschiff.webp`,
    flyingLizard: `${ICON_BASE}Flugechse.webp`,
    hippogriff: `${ICON_BASE}Hippogriff.webp`,
    giantAuk: `${ICON_BASE}Riesenalk.webp`,
    skySteed: `${ICON_BASE}Himmelsross.webp`,
    westwindDragon: `${ICON_BASE}Westwinddrache.webp`,
    airDjinn: `${ICON_BASE}Luftdschinn.webp`,
    karakil: `${ICON_BASE}Karakil.webp`,
    irrhalk: `${ICON_BASE}Irrhalk.webp`,
    griffin: `${ICON_BASE}Greif.webp`,
};

/**
 * Das neutrale Bild für ein EIGENES Flugmittel (Betreiber 2026-10-05: „schau nochmal ins verzeichnis, beide icons
 * ergänzt“). 🔴 Es ersetzt keinen Rückfall auf das erste Profil: Ein eigenes Flugmittel als Hexenflug zu zeichnen
 * war eine Behauptung (Befund WI-0079 §8a), und mit diesem Bild gibt es sie nicht mehr.
 */
export const CUSTOM_AIR_ICON = `${ICON_BASE}EigenesFluggeraet.webp`;

const AIR_MODEL = AVENTURIA_TRAVEL_MODEL.flug.wert;

export const AIR_PROFILES: readonly AirProfile[] = AIR_MODEL.profile.flatMap((profile) =>
    profile.id in AIR_ICONS
        ? [
              {
                  id: profile.id as AirProfileId,
                  group: profile.gruppe as AirGroup,
                  speedMph: profile.tempo,
                  altitudePaces: profile.reisehoehe,
                  icon: AIR_ICONS[profile.id as AirProfileId],
              },
          ]
        : [],
);

/** Die Wahl „Eigenes Flugmittel“: Name und beide Routingwerte stehen dann in `custom`. */
export { CUSTOM_AIR };
export type AirChoiceId = AirProfileId | typeof CUSTOM_AIR;

export interface AirCustom {
    /** Leer heißt „Eigenes Flugmittel“. */
    name: string;
    speedMph: number;
    altitudePaces: number;
}

/** Genau ein Flugmittel ist gewählt; die eigenen Werte bleiben, auch wenn ein anderes gewählt ist. */
export interface AirChoice {
    profile: AirChoiceId;
    custom: AirCustom;
}

export const DEFAULT_AIR_CHOICE: AirChoice = {
    profile: "witchFlight",
    custom: {
        name: "",
        speedMph: AIR_MODEL.eigenes.tempo.vorgabe,
        altitudePaces: AIR_MODEL.eigenes.reisehoehe.vorgabe,
    },
};

export function copyAirChoice(choice: AirChoice): AirChoice {
    return { profile: choice.profile, custom: { ...choice.custom } };
}

/** Die Grenzen der Felder aus dem Reisemodell: dieselben, die der Server prüft. */
const limitsOf = (limit: { min: number; max: number; nachkommastellen: number }) =>
    ({ min: limit.min, max: limit.max, digits: limit.nachkommastellen }) as const;
export const AIR_SPEED_LIMITS = limitsOf(AIR_MODEL.eigenes.tempo);
export const AIR_ALTITUDE_LIMITS = limitsOf(AIR_MODEL.eigenes.reisehoehe);
/** So viele Zeichen trägt der Name, bevor die Zeile ihn kürzt. */
export const AIR_NAME_MAX = 40;

/** Ein Feldwert, gerundet auf seine Stellen und in seinen Grenzen; Unlesbares behält den bisherigen Wert. */
export function clampAirValue(
    value: number,
    limits: { min: number; max: number; digits: number },
    fallback: number,
): number {
    if (!Number.isFinite(value)) return fallback;
    const step = 10 ** limits.digits;
    return Math.min(limits.max, Math.max(limits.min, Math.round(value * step) / step));
}

export function airProfilesOf(group: AirGroup): AirProfile[] {
    return AIR_PROFILES.filter((profile) => profile.group === group);
}

export function airGroupLabel(group: AirGroup): string {
    return t(`planner.air.group.${group}`);
}

export function airProfileLabel(id: AirProfileId): string {
    return t(`planner.air.opt.${id}`);
}

/** „40 Meilen/h · 100 Schritt“, „12,5 Meilen/h · 1.000 Schritt“. */
export function airValues(speedMph: number, altitudePaces: number): string {
    return t("planner.air.values", {
        speed: formatDecimal(speedMph, AIR_SPEED_LIMITS.digits),
        altitude: formatDecimal(altitudePaces, AIR_ALTITUDE_LIMITS.digits),
    });
}

/** Das gewählte Flugmittel, aufgelöst: sein Name, sein Bild und beide Routingwerte. */
export function selectedAir(choice: AirChoice): {
    name: string;
    icon?: string;
    speedMph: number;
    altitudePaces: number;
} {
    const profile = AIR_PROFILES.find((candidate) => candidate.id === choice.profile);
    if (profile) {
        return {
            name: airProfileLabel(profile.id),
            icon: profile.icon,
            speedMph: profile.speedMph,
            altitudePaces: profile.altitudePaces,
        };
    }
    const { name, speedMph, altitudePaces } = choice.custom;
    // Das eigene Flugmittel trägt das neutrale Bild (Betreiber 2026-10-05), nie das eines fremden Profils.
    return { name: name.trim() || t("planner.air.custom"), icon: CUSTOM_AIR_ICON, speedMph, altitudePaces };
}

export function isAirProfileId(id: string): id is AirProfileId {
    return AIR_PROFILES.some((profile) => profile.id === id);
}

/** Wie ein Flugmittel heißt, nach seiner Kennung: ein Profil mit seinem Namen, das eigene mit dem eigenen oder „Eigenes Flugmittel“. */
export function airDeviceName(id: string, customName = ""): string {
    return isAirProfileId(id) ? airProfileLabel(id) : customName.trim() || t("planner.air.custom");
}

/** Das Bild eines Flugmittels, nach seiner Kennung: ein Profil sein eigenes, jedes andere das neutrale. */
export function airDeviceIcon(id: string): string {
    return AIR_PROFILES.find((profile) => profile.id === id)?.icon ?? CUSTOM_AIR_ICON;
}

/**
 * Die Flugparameter der Routen-API (WI-0051 F1): ein Profil beim Namen oder das eigene Flugmittel mit
 * seinen Werten. Der Name des eigenen Flugmittels reist nicht mit: Er rechnet nicht.
 */
export function airQuery(choice: AirChoice): Record<string, string> {
    if (choice.profile !== CUSTOM_AIR) return { air: choice.profile };
    return {
        air: CUSTOM_AIR,
        air_speed: String(choice.custom.speedMph),
        air_altitude: String(choice.custom.altitudePaces),
    };
}

/** Die Adressparameter des Flugs; Legacy kennt keine, die Namen folgen seiner Schreibweise (camelCase). */
export const AIR_LINK_PARAMS = ["air", "airSpeed", "airAltitude", "airName"] as const;

/** `air=griffin`, beim eigenen Flugmittel `air=custom&airSpeed=40&airAltitude=250&airName=Besen`. */
export function writeAirLink(choice: AirChoice): string[] {
    if (choice.profile !== CUSTOM_AIR) return [`air=${choice.profile}`];
    const { name, speedMph, altitudePaces } = choice.custom;
    const parts = [`air=${CUSTOM_AIR}`, `airSpeed=${String(speedMph)}`, `airAltitude=${String(altitudePaces)}`];
    if (name.trim() !== "") parts.push(`airName=${encodeURIComponent(name.trim())}`);
    return parts;
}

/** Der Flug aus einer Adresse; `null` ohne `air` oder mit unbekanntem Flugmittel. */
export function readAirLink(params: URLSearchParams): AirChoice | null {
    const id = (params.get("air") ?? "").trim();
    const choice = copyAirChoice(DEFAULT_AIR_CHOICE);
    if (isAirProfileId(id)) {
        choice.profile = id;
        return choice;
    }
    if (id !== CUSTOM_AIR) return null;
    choice.profile = CUSTOM_AIR;
    const fallback = DEFAULT_AIR_CHOICE.custom;
    choice.custom = {
        name: (params.get("airName") ?? "").trim().slice(0, AIR_NAME_MAX),
        speedMph: clampAirValue(Number(params.get("airSpeed") ?? Number.NaN), AIR_SPEED_LIMITS, fallback.speedMph),
        altitudePaces: clampAirValue(
            Number(params.get("airAltitude") ?? Number.NaN),
            AIR_ALTITUDE_LIMITS,
            fallback.altitudePaces,
        ),
    };
    return choice;
}

/** Der Flug im Kurzlink: ein benanntes Flugmittel nur mit Namen, das eigene mit seinen Werten. */
export function airShare(choice: AirChoice): NonNullable<SharePayload["air"]> {
    if (choice.profile !== CUSTOM_AIR) return { profile: choice.profile };
    // Der Name bleibt draußen: Der Kurzlink speichert keinen freien Text (share.ts).
    const { speedMph, altitudePaces } = choice.custom;
    return { profile: CUSTOM_AIR, speedMph, altitudePaces };
}

/** Der Flug aus einem Kurzlink; ein unbekanntes Flugmittel ergibt `null` (die Route reist dann über Land). */
export function airFromShare(shared: NonNullable<SharePayload["air"]>): AirChoice | null {
    const choice = copyAirChoice(DEFAULT_AIR_CHOICE);
    if (isAirProfileId(shared.profile)) {
        choice.profile = shared.profile;
        return choice;
    }
    if (shared.profile !== CUSTOM_AIR) return null;
    const fallback = DEFAULT_AIR_CHOICE.custom;
    choice.profile = CUSTOM_AIR;
    choice.custom = {
        name: "",
        speedMph: clampAirValue(shared.speedMph ?? Number.NaN, AIR_SPEED_LIMITS, fallback.speedMph),
        altitudePaces: clampAirValue(shared.altitudePaces ?? Number.NaN, AIR_ALTITUDE_LIMITS, fallback.altitudePaces),
    };
    return choice;
}

/** Was die zugeklappte Leiste „Transportmittel“ im Flug zeigt: „Hexenfluggerät · 40 Meilen/h · 100 Schritt“. */
export function airSummary(choice: AirChoice): SummaryPart[] {
    const air = selectedAir(choice);
    return [
        air.icon ? { icon: air.icon, text: air.name } : { text: air.name },
        { text: airValues(air.speedMph, air.altitudePaces) },
    ];
}
