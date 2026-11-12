import { Type, type Static } from "@sinclair/typebox";

/**
 * Die wirksame Darstellungstafel der Landschaften (WI-0064).
 *
 * 🔴 SIE ENTSTEHT AUS ZWEI QUELLEN, UND LEGACY HAELT SIE GETRENNT. Legacys Endpunkt `ecosystem-display.php` liefert nur die
 * UEBERSTEUERUNGEN der Redaktion (`display`, dazu den Stempel `stamp`). Die Vorgaben stehen in Legacys Code
 * (`js/map-features/ecosystem-display.js`), und ihr Server "kennt sie ausdruecklich nicht". Was auf Legacys Karte gilt, ist
 * beides zusammen:
 *
 *   wirksam = Uebersteuerung, wo sie eine Zahl (beziehungsweise einen Wahrheitswert) traegt,
 *             sonst die Vorgabe dieser Art, sonst die Grundvorgabe.
 *
 * Diese Reihenfolge ist die von `avesmapsEcosystemDisplayVorgabe`, `avesmapsEcosystemDisplayGroesse` und
 * `avesmapsEcosystemKollisionAus` in Legacy; sie wird hier nachgebaut und in `test/landscape-display.test.ts` an Legacys
 * eigenen Faellen gehalten. Die Vorgaben selbst liegen als erzeugte Datei im Repo (`config/landscape-display/`), samt Commit und
 * Blob der Legacy-Datei, aus der sie kamen.
 *
 * 🔴 EINE TAFEL, DIE NUR RAET (Legacy, Owner 24.08. und 02.09.2026). Zoomband, Prioritaet, Hoechstzahl der Kurvennamen und
 * Schriftgroesse einer Art gelten in Legacy nur dort, wo eine Beschriftung KEINEN eigenen Wert traegt; der eigene Wert des Labels
 * gewinnt. Genau so wird die Tafel hier angewendet (Migration 0057: die Renderansichten fallen auf sie zurueck, wo ein Label
 * keinen eigenen Wert hat). Wer die Tafel "gelten" lassen will, indem sie den Wert des Labels schlaegt, kehrt eine
 * Betreiberentscheidung von Legacy um.
 */

/**
 * Legacys Karte endet bei Zoom 7; seine Tafel nimmt nur 0..7 an. Eine QUELLgrenze: sie prueft Legacys Antwort und die Abschrift
 * der Vorgaben. Im Ziel (Tabelle `landscape_display_art`) steht Legacys `bis = 7` als 8 (WI-0129, `upperBandFromLegacy`).
 */
export const DISPLAY_BAND_MAX = 7;
/** Neun Schriftgroessen je Art: z0 bis z8. */
export const DISPLAY_SIZE_BANDS = 9;
/** Der Schluessel der Grundvorgabe in der Tabelle: sie gilt fuer jede Art, die keine eigene Zeile hat. */
export const DISPLAY_FALLBACK_ART = "*";
/** Das sind die Landschaftsebenen, deren Deckkraft die Tafel fuehrt. */
export const DISPLAY_LAYERS = ["derographisch", "vegetation", "topographie", "klima"] as const;

const Vorgabe = Type.Object(
    {
        ab: Type.Integer({ minimum: 0, maximum: DISPLAY_BAND_MAX }),
        bis: Type.Integer({ minimum: -1, maximum: DISPLAY_BAND_MAX }),
        curveMax: Type.Integer({ minimum: 1, maximum: 3 }),
        prio: Type.Integer({ minimum: 1, maximum: 5 }),
    },
    { additionalProperties: false },
);

const Kollision = Type.Object({ teil: Type.Boolean(), fest: Type.Boolean() }, { additionalProperties: false });

const Grenze = Type.Object({ min: Type.Number(), max: Type.Number() }, { additionalProperties: false });

/** Die Vorgaben aus Legacys Code, wie `scripts/dev/extract-legacy-display-defaults.ts` sie erzeugt. */
export const LandscapeDisplayDefaults = Type.Object(
    {
        $comment: Type.Optional(Type.String()),
        schemaVersion: Type.Literal(1),
        mapDomain: Type.String(),
        source: Type.Object(
            {
                repository: Type.String(),
                file: Type.String(),
                commit: Type.String({ pattern: "^[0-9a-f]{40}$" }),
                blob: Type.String({ pattern: "^[0-9a-f]{40}$" }),
            },
            { additionalProperties: false },
        ),
        bandMax: Type.Literal(DISPLAY_BAND_MAX),
        base: Vorgabe,
        perArt: Type.Record(Type.String(), Type.Partial(Vorgabe)),
        sizeByBand: Type.Array(Type.Number(), { minItems: DISPLAY_SIZE_BANDS, maxItems: DISPLAY_SIZE_BANDS }),
        sizeLimits: Grenze,
        collision: Type.Object(
            { base: Kollision, perArt: Type.Record(Type.String(), Type.Partial(Kollision)) },
            { additionalProperties: false },
        ),
        opacity: Type.Object(
            {
                perLayer: Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 })),
                perArea: Type.Record(Type.String(), Type.Number({ minimum: 0, maximum: 1 })),
                waterAreas: Type.Array(Type.String()),
            },
            { additionalProperties: false },
        ),
        spacing: Type.Object(
            {
                defaults: Type.Object(
                    { repel: Type.Number(), versatz: Type.Number(), drift: Type.Number() },
                    { additionalProperties: false },
                ),
                limits: Type.Record(Type.String(), Grenze),
            },
            { additionalProperties: false },
        ),
    },
    { $id: "LandscapeDisplayDefaults", additionalProperties: false },
);

export type LandscapeDisplayDefaults = Static<typeof LandscapeDisplayDefaults>;

export type DisplayVorgabe = Static<typeof Vorgabe>;
export type DisplayKollision = Static<typeof Kollision>;

/** Ein unbrauchbarer Stand: unlesbar, unvollstaendig oder in sich widerspruechlich. Nie ein stiller Rueckfall. */
export class LandscapeDisplayError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LandscapeDisplayError";
    }
}

/** Die Uebersteuerungen, soweit wir sie lesen. Fehlt ein Abschnitt, gilt die Vorgabe. */
export interface DisplayOverrides {
    vorgabe: Record<string, Partial<DisplayVorgabe>>;
    groesse: Record<string, number[]>;
    kollision: Record<string, Partial<DisplayKollision>>;
    global: Record<string, { an?: boolean; wert?: number }>;
    abstaende: Partial<Record<"repel" | "versatz" | "drift", number>>;
    /**
     * Abschnitte, die Legacy fuehrt und wir NICHT anwenden (Farben, Deckkraft je Flaeche, Kurvenfeinheiten, Gebirgsformen):
     * nur ihre Zahl an Eintraegen, damit der Bericht sagt, was mitkam. Sie sind auf Form geprueft (ein Objekt), nicht auf Inhalt.
     */
    unapplied: Record<string, number>;
    /** Abschnitte, die es bei der Fassung dieses Werkzeugs noch nicht gab. Ein Grund hinzusehen, kein Fehler. */
    unknownSections: string[];
}

export interface LandscapeDisplayResponse {
    /** Legacys Stempel der Tafel (Unix-Sekunden der letzten Speicherung), als Text wie geliefert. */
    stamp: string;
    overrides: DisplayOverrides;
}

const APPLIED_SECTIONS = ["vorgabe", "groesse", "kollision", "global", "abstaende"] as const;
const UNAPPLIED_SECTIONS = ["farbe", "flaeche", "deckkraft", "gebirgsformen", "kurve"] as const;
const ART_KEY = /^[a-z_]{1,32}$/;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isNumberIn(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function requireObject(value: unknown, where: string): Record<string, unknown> {
    if (!isObject(value)) {
        throw new LandscapeDisplayError(`${where}: kein Objekt`);
    }
    return value;
}

/**
 * Liest Legacys Antwort `{ ok, display, stamp }`.
 *
 * 🔴 KEIN STEMPEL HEISST KEIN STAND. Legacys Endpunkt faellt offen aus: jeder Fehler ergibt `display: null` und einen leeren
 * Stempel, nie ein 500. Ein Ausfall sieht damit aus wie "nichts uebersteuert" - und liesse unsere Tafel still auf die
 * Vorgaben zurueckfallen. Ein leerer Stempel bricht deshalb ab. `display: null` MIT Stempel ist dagegen Legacys Ruecksetzen
 * ("Auf Vorgabe zuruecksetzen" loescht die Zeile und stempelt neu) und gilt als: nichts uebersteuert.
 *
 * 🔴 STRENG, WO WIR ANWENDEN. Die Grenzen sind die des Legacy-Servers (`avesmapsEcosystemDisplayValidate`); was er beim Speichern
 * ablehnt, kann hier nicht ankommen, und was doch ankommt, ist ein Fehler, den man sehen soll.
 */
export function parseLandscapeDisplayResponse(payload: unknown): LandscapeDisplayResponse {
    const response = requireObject(payload, "Antwort");
    if (response["ok"] !== true) {
        throw new LandscapeDisplayError("Antwort: ok ist nicht true");
    }
    const stamp = response["stamp"];
    if (typeof stamp !== "string" || !/^[0-9]{1,12}$/.test(stamp)) {
        throw new LandscapeDisplayError(
            "Antwort: kein gueltiger Stempel (Legacys Endpunkt faellt offen aus: ein leerer Stempel heisst Ausfall oder nie gespeichert)",
        );
    }
    const display = response["display"];
    const overrides: DisplayOverrides = {
        vorgabe: {},
        groesse: {},
        kollision: {},
        global: {},
        abstaende: {},
        unapplied: {},
        unknownSections: [],
    };
    if (display === null) {
        return { stamp, overrides };
    }
    const section = requireObject(display, "display");
    if (section["version"] !== 1) {
        throw new LandscapeDisplayError(`display.version ist ${JSON.stringify(section["version"])}, erwartet 1`);
    }

    if (section["vorgabe"] !== undefined) {
        const limits = {
            ab: [0, DISPLAY_BAND_MAX],
            bis: [-1, DISPLAY_BAND_MAX],
            curveMax: [1, 3],
            prio: [1, 5],
        } as const;
        for (const [art, row] of Object.entries(requireObject(section["vorgabe"], "display.vorgabe"))) {
            if (!ART_KEY.test(art))
                throw new LandscapeDisplayError(`display.vorgabe: Artenschluessel "${art}" unzulaessig`);
            const entry: Partial<DisplayVorgabe> = {};
            for (const [field, value] of Object.entries(requireObject(row, `display.vorgabe.${art}`))) {
                if (!(field in limits))
                    throw new LandscapeDisplayError(`display.vorgabe.${art}: Feld "${field}" unbekannt`);
                const [min, max] = limits[field as keyof typeof limits];
                if (!isInteger(value, min, max)) {
                    throw new LandscapeDisplayError(
                        `display.vorgabe.${art}.${field}: ${JSON.stringify(value)} ist keine ganze Zahl in ${String(min)}..${String(max)}`,
                    );
                }
                entry[field as keyof DisplayVorgabe] = value;
            }
            overrides.vorgabe[art] = entry;
        }
    }

    if (section["groesse"] !== undefined) {
        for (const [art, row] of Object.entries(requireObject(section["groesse"], "display.groesse"))) {
            if (!ART_KEY.test(art))
                throw new LandscapeDisplayError(`display.groesse: Artenschluessel "${art}" unzulaessig`);
            if (!Array.isArray(row) || row.length > DISPLAY_SIZE_BANDS) {
                throw new LandscapeDisplayError(
                    `display.groesse.${art}: keine Liste mit hoechstens ${String(DISPLAY_SIZE_BANDS)} Werten`,
                );
            }
            row.forEach((cell, band) => {
                // Hier gilt Legacys Schranke [4, 30] (`SIZE_LIMITS`); die Grenzen der Vorgaben stehen in der Datei.
                if (!isNumberIn(cell, 4, 30)) {
                    throw new LandscapeDisplayError(
                        `display.groesse.${art}[${String(band)}]: ${JSON.stringify(cell)} ausserhalb 4..30`,
                    );
                }
            });
            overrides.groesse[art] = row as number[];
        }
    }

    if (section["kollision"] !== undefined) {
        for (const [art, row] of Object.entries(requireObject(section["kollision"], "display.kollision"))) {
            if (!ART_KEY.test(art))
                throw new LandscapeDisplayError(`display.kollision: Artenschluessel "${art}" unzulaessig`);
            const entry: Partial<DisplayKollision> = {};
            for (const [field, value] of Object.entries(requireObject(row, `display.kollision.${art}`))) {
                if ((field !== "teil" && field !== "fest") || typeof value !== "boolean") {
                    throw new LandscapeDisplayError(
                        `display.kollision.${art}.${field}: erwartet teil/fest als Wahrheitswert`,
                    );
                }
                entry[field] = value;
            }
            overrides.kollision[art] = entry;
        }
    }

    if (section["global"] !== undefined) {
        for (const [layer, row] of Object.entries(requireObject(section["global"], "display.global"))) {
            if (!ART_KEY.test(layer))
                throw new LandscapeDisplayError(`display.global: Ebenenschluessel "${layer}" unzulaessig`);
            const entry: { an?: boolean; wert?: number } = {};
            const fields = requireObject(row, `display.global.${layer}`);
            if (fields["an"] !== undefined) {
                if (typeof fields["an"] !== "boolean")
                    throw new LandscapeDisplayError(`display.global.${layer}.an: kein Wahrheitswert`);
                entry.an = fields["an"];
            }
            if (fields["wert"] !== undefined) {
                if (!isNumberIn(fields["wert"], 0, 1))
                    throw new LandscapeDisplayError(`display.global.${layer}.wert: ausserhalb 0..1`);
                entry.wert = fields["wert"];
            }
            overrides.global[layer] = entry;
        }
    }

    if (section["abstaende"] !== undefined) {
        const limits = { repel: [0, 20], versatz: [2, 24], drift: [0, 150] } as const;
        for (const [key, value] of Object.entries(requireObject(section["abstaende"], "display.abstaende"))) {
            if (!(key in limits)) throw new LandscapeDisplayError(`display.abstaende: Schluessel "${key}" unbekannt`);
            const [min, max] = limits[key as keyof typeof limits];
            if (!isNumberIn(value, min, max)) {
                throw new LandscapeDisplayError(
                    `display.abstaende.${key}: ${JSON.stringify(value)} ausserhalb ${String(min)}..${String(max)}`,
                );
            }
            overrides.abstaende[key as keyof typeof limits] = value;
        }
    }

    for (const name of UNAPPLIED_SECTIONS) {
        if (section[name] !== undefined) {
            overrides.unapplied[name] = Object.keys(requireObject(section[name], `display.${name}`)).length;
        }
    }
    const known = new Set<string>(["version", ...APPLIED_SECTIONS, ...UNAPPLIED_SECTIONS]);
    overrides.unknownSections = Object.keys(section)
        .filter((name) => !known.has(name))
        .sort();
    return { stamp, overrides };
}

/** Eine Art, wie sie WIRKT: Vorgabe oder Uebersteuerung, Zeile fuer Zeile aufgeloest. */
export interface EffectiveArt {
    ab: number;
    bis: number;
    curveMax: number;
    prio: number;
    /** Schriftgroesse in Pixeln je Band z0..z8. */
    size: number[];
    collision: { teil: boolean; fest: boolean };
}

export interface EffectiveLandscapeDisplay {
    mapDomain: string;
    stamp: string;
    /** Wo die Vorgaben herkamen, fuer den Bericht. */
    defaultsRef: string;
    /** Die Grundvorgabe: gilt fuer jede Art ohne eigene Zeile. */
    base: EffectiveArt;
    /** Jede Art, die Legacys Vorgaben oder Uebersteuerungen nennen, nach Schluessel geordnet. */
    arts: Record<string, EffectiveArt>;
    /**
     * Was Legacy NICHT-angewendet fuehrt, aber wirksam meldet (Deckkraft je Ebene, Abstaende der Namen). Es steht hier, damit die
     * Abweichungsliste gegen Legacys wirksamen Wert rechnen kann und nicht gegen eine Vermutung. Avesmaps3D wendet es nicht an.
     */
    notApplied: {
        layerOpacity: Record<string, number>;
        spacing: { repel: number; versatz: number; drift: number };
    };
}

/** Der Bezug der Vorgaben, wie er in Bericht und Tabelle steht: `d9ec0e669` (der Commit, der Legacys Datei zuletzt beruehrte). */
export function defaultsRef(defaults: LandscapeDisplayDefaults): string {
    return `${defaults.source.file}@${defaults.source.commit.slice(0, 9)}`;
}

function pick<T>(own: T | undefined, perArt: T | undefined, base: T): T {
    return own !== undefined ? own : perArt !== undefined ? perArt : base;
}

function resolveArt(art: string, defaults: LandscapeDisplayDefaults, overrides: DisplayOverrides): EffectiveArt {
    const own = overrides.vorgabe[art] ?? {};
    const perArt = defaults.perArt[art] ?? {};
    const collisionOwn = overrides.kollision[art] ?? {};
    const collisionPerArt = defaults.collision.perArt[art] ?? {};
    const sizeOwn = overrides.groesse[art] ?? [];
    const { min, max } = defaults.sizeLimits;
    const resolved: EffectiveArt = {
        ab: pick(own.ab, perArt.ab, defaults.base.ab),
        bis: pick(own.bis, perArt.bis, defaults.base.bis),
        curveMax: pick(own.curveMax, perArt.curveMax, defaults.base.curveMax),
        prio: pick(own.prio, perArt.prio, defaults.base.prio),
        // Eine Lücke an einer Stufe faellt fuer diese Stufe auf die Vorgabe zurueck, nicht die ganze Zeile (Legacy).
        size: defaults.sizeByBand.map((fallback, band) => {
            const cell = sizeOwn[band];
            return typeof cell === "number" && cell >= min && cell <= max ? cell : fallback;
        }),
        collision: {
            teil: pick(collisionOwn.teil, collisionPerArt.teil, defaults.collision.base.teil),
            fest: pick(collisionOwn.fest, collisionPerArt.fest, defaults.collision.base.fest),
        },
    };
    // `bis = -1` ist "aus" (Legacy: bis < ab); ein Band mit 0 <= bis < ab waere dasselbe, aber nie so gemeint - und ein
    // Zeichen, dass Vorgabe und Uebersteuerung einer Art sich nicht zusammensetzen lassen.
    if (resolved.bis >= 0 && resolved.ab > resolved.bis) {
        throw new LandscapeDisplayError(
            `${art}: das wirksame Band ist widerspruechlich (ab ${String(resolved.ab)} > bis ${String(resolved.bis)}); ` +
                "'aus' heisst bis = -1, nicht ein Band, das vor seinem Anfang endet",
        );
    }
    return resolved;
}

/** Setzt Vorgaben und Uebersteuerungen zur wirksamen Tafel zusammen (siehe Kopf dieser Datei). */
export function effectiveLandscapeDisplay(
    defaults: LandscapeDisplayDefaults,
    response: LandscapeDisplayResponse,
): EffectiveLandscapeDisplay {
    const { overrides } = response;
    const names = new Set<string>([
        ...Object.keys(defaults.perArt),
        ...Object.keys(defaults.collision.perArt),
        ...Object.keys(overrides.vorgabe),
        ...Object.keys(overrides.groesse),
        ...Object.keys(overrides.kollision),
    ]);
    const arts: Record<string, EffectiveArt> = {};
    for (const art of [...names].sort()) {
        arts[art] = resolveArt(art, defaults, overrides);
    }
    const layerOpacity: Record<string, number> = {};
    for (const [layer, fallback] of Object.entries(defaults.opacity.perLayer)) {
        const global = overrides.global[layer];
        layerOpacity[layer] = global?.an === true && typeof global.wert === "number" ? global.wert : fallback;
    }
    const spacing = { ...defaults.spacing.defaults };
    for (const key of ["repel", "versatz", "drift"] as const) {
        const own = overrides.abstaende[key];
        if (own !== undefined) spacing[key] = own;
    }
    return {
        mapDomain: defaults.mapDomain,
        stamp: response.stamp,
        defaultsRef: defaultsRef(defaults),
        base: resolveArt(DISPLAY_FALLBACK_ART, defaults, {
            ...overrides,
            // Die Grundvorgabe traegt keine Uebersteuerung: der Artenschluessel `*` waere bei Legacy gar nicht zulaessig.
            vorgabe: {},
            groesse: {},
            kollision: {},
        }),
        arts,
        notApplied: { layerOpacity, spacing },
    };
}
