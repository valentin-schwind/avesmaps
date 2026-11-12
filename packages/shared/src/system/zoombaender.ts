import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { DESIGN_CANON } from "../design-canon-registry.ts";
import { AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS } from "../landscape-display-registry.ts";
import { OperationId } from "../operation.ts";
import { AVENTURIA_PATH_CARTOGRAPHY } from "../path-cartography-registry.ts";
import { AVENTURIA_POWERLINE_CARTOGRAPHY } from "../powerline-cartography-registry.ts";
import { AVENTURIA_ZOOM_BANDS } from "../zoom-bands-registry.ts";
import { MAX_BAND, RENDER_ZOOM_OFFSET, upperBandFromLegacy } from "../zoom-bands.ts";

/**
 * Die Zoombänder der Systemsteuerung (WI-0221; Idee des Betreibers 2026-10-17: „welche feature wann sichtbar sein soll. global .
 * in der systemsteuerung . reiter: Zoombänder. alle features, marker, wenn vorhanden labels - 0 - 8“; Vorlage Fassung 4 am
 * 2026-10-18 abgenommen).
 *
 * 🔴 **Was ein Zoomband ist** (Betreiber 2026-10-17, F1): „die zoombänder sind nur garantien, dass sachen nicht über die zoombänder
 * hinaus angezeigt werden“. Außerhalb seiner Spanne erscheint eine Art nie; innerhalb kann MapLibre wegen Kollisionen ausblenden.
 * 🔴 **Wer gewinnt:** Die Einstellung hier überschreibt die Vorgabe aus Legacy oder dem Code, gespeichert nur als Abweichung
 * (Tafel `zoom_band_setting`). Einzelne Objekte mit eigener Spanne gehen vor (F2: „ansonsten gilt A, einzelne features können
 * ausnahmen haben“, ADR-0006). **Ausnahme Herrschaftsgebiete:** ihre Spannen bleiben, wie sie sind; der Reiter zeigt sie nur.
 *
 * Die Vorgaben kommen aus den Stellen, die sie heute schon tragen (keine zweite Liste), mit einer Ausnahme: Für die Orte gilt als
 * Anfangsstand Legacys GESPEICHERTER Stand (Betreiber 2026-10-10 zu WI-0129 §16 D1: „ja auf jeden fall“, Werte MCS-032), nicht die
 * ältere Vorgabe in `config/zoom-bands/aventuria.json`, die nur noch die Größen trägt.
 */

/** Eine Spanne in Bändern 0 bis 8, beide Grenzen eingeschlossen. */
export interface Zoomspanne {
    von: number;
    bis: number;
}

export const ZOOMBAND_GRUPPEN = ["orte", "wege", "landschaften", "gebiete", "kraftlinien", "gelaende"] as const;
export type ZoombandGruppe = (typeof ZOOMBAND_GRUPPEN)[number];

/** Was an der Zeile sichtbar wird: das Zeichen, der Name, die Linie, die Kontur, die Fläche, die Zahl an der Linie. */
export type ZoombandSpurArt = "zeichen" | "name" | "linie" | "kontur" | "flaeche" | "zahl";

/**
 * Was eine Änderung braucht. `stil`: beim nächsten Laden der Karte. Außerhalb von `grenze` braucht es mehr: `namen` (die
 * Namensläufe neu berechnen) oder `kacheln` (die Kacheln liefern es erst ab dort).
 */
export interface ZoombandSpur {
    /** `<gruppe>.<zeile>.<spur>`, etwa `orte.dorf.name`; der Schlüssel der Tafel `zoom_band_setting`. */
    id: string;
    gruppe: ZoombandGruppe;
    /** Die Zeile im Reiter (Ortsklasse, Wegart, Landschaftsart …). */
    zeile: string;
    spur: ZoombandSpurArt;
    vorgabe: Zoomspanne;
    /** Nur zur Ansicht (Herrschaftsgebiete) oder fest (Seewege abgeschaltet). */
    nurAnsicht?: "gebiete" | "abgeschaltet";
    grenze?: Zoomspanne & { folge: "namen" | "kacheln" };
}

const ALLES: Zoomspanne = { von: 0, bis: MAX_BAND };
const ab = (von: number): Zoomspanne => ({ von, bis: MAX_BAND });

/** Die erste Zelle über 0 einer Reihe (Größe, Breite); `null`, wenn es keine gibt. */
function ersteGefuellte(reihe: readonly (number | null)[]): number | null {
    const index = reihe.findIndex((wert) => wert !== null && wert > 0);
    return index < 0 ? null : index;
}

/** MapLibre-Zoom eines Kanonwerts als Band (Band n beginnt bei n + 1, `RENDER_ZOOM_OFFSET`). */
const bandAusZoom = (zoom: number): number => Math.max(0, Math.ceil(zoom - RENDER_ZOOM_OFFSET));

/**
 * Legacys gespeicherte Ortszoombänder (MCS-032, Erscheinungsstufe je Klasse): der Anfangsstand der Orte. Stadtviertel hat Legacy
 * nie gespeichert; es gilt seine Vorgabe aus der Tafel.
 */
const ORTE_LEGACY_GESPEICHERT: Readonly<Record<string, { zeichen: number; name: number }>> = {
    metropole: { zeichen: 0, name: 1 },
    grossstadt: { zeichen: 1, name: 2 },
    stadt: { zeichen: 2, name: 3 },
    kleinstadt: { zeichen: 3, name: 4 },
    dorf: { zeichen: 4, name: 5 },
    gebaeude: { zeichen: 5, name: 6 },
};

function orte(): ZoombandSpur[] {
    const spuren: ZoombandSpur[] = [];
    for (const klasse of Object.keys(AVENTURIA_ZOOM_BANDS.marker)) {
        const gespeichert = ORTE_LEGACY_GESPEICHERT[klasse];
        const zeichen = gespeichert?.zeichen ?? ersteGefuellte(AVENTURIA_ZOOM_BANDS.marker[klasse] ?? []) ?? 0;
        const name = gespeichert?.name ?? ersteGefuellte(AVENTURIA_ZOOM_BANDS.label[klasse] ?? []) ?? 0;
        spuren.push({
            id: `orte.${klasse}.zeichen`,
            gruppe: "orte",
            zeile: klasse,
            spur: "zeichen",
            vorgabe: ab(zeichen),
        });
        spuren.push({ id: `orte.${klasse}.name`, gruppe: "orte", zeile: klasse, spur: "name", vorgabe: ab(name) });
    }
    spuren.push({
        id: "orte.bauwerk.zeichen",
        gruppe: "orte",
        zeile: "bauwerk",
        spur: "zeichen",
        vorgabe: ab(AVENTURIA_ZOOM_BANDS.structure.diamondFromBand),
    });
    spuren.push({
        id: "orte.goldring.zeichen",
        gruppe: "orte",
        zeile: "goldring",
        spur: "zeichen",
        vorgabe: ab(AVENTURIA_ZOOM_BANDS.capital.fromBand),
    });
    // Die Nodices der Kraftlinien-Ansicht: Legacy zeigt und beschriftet jeden auf jeder Stufe (WI-0025); die Spanne kann das begrenzen.
    spuren.push({ id: "orte.nodix.zeichen", gruppe: "orte", zeile: "nodix", spur: "zeichen", vorgabe: ALLES });
    spuren.push({ id: "orte.nodix.name", gruppe: "orte", zeile: "nodix", spur: "name", vorgabe: ALLES });
    // 🔴 Verborgene Orte (OPS-068, Idee des Betreibers über Vali: „Verborgene Orte sollen nur ab Zoom 8 sichtbar werden, andernfalls
    // findet man sie bereits auf große Entfernung“): Ihre Marke (der Name steht nie, WI-0080) erscheint erst ab dem NAHEN Ende der
    // Bänder, gleichgültig, welche Klasse der Ort hat - sie kommt zur Spanne der Klasse HINZU (beide müssen zutreffen). „Zoom 8“ ist die
    // fachliche Zoomstufe, die der Editor als ZOOM anzeigt (`bandForRenderZoom`), nicht der MapLibre-Zoom. Wer sie früher zeigen will,
    // verstellt diese Zeile; ohne Release. Im Editor-Modus gilt sie nicht (`place-layers.ts`, `hiddenPlacesAlways`).
    spuren.push({
        id: "orte.verborgen.zeichen",
        gruppe: "orte",
        zeile: "verborgen",
        spur: "zeichen",
        vorgabe: ab(MAX_BAND),
    });
    return spuren;
}

/** Die Wegarten in der Reihenfolge der Tafel; „bach“ ist ein Merkmal der Flusswege, keine eigene Art (eigene Breite). */
export const ZOOMBAND_WEGARTEN = [
    "Reichsstrasse",
    "Strasse",
    "Weg",
    "Pfad",
    "Gebirgspass",
    "Wuestenpfad",
    "bach",
] as const;

function wege(): ZoombandSpur[] {
    const spuren: ZoombandSpur[] = [];
    for (const art of ZOOMBAND_WEGARTEN) {
        const von = ersteGefuellte(AVENTURIA_PATH_CARTOGRAPHY.widthScale[art] ?? []) ?? 0;
        spuren.push({ id: `wege.${art}.linie`, gruppe: "wege", zeile: art, spur: "linie", vorgabe: ab(von) });
        // Die Namen folgen ihrem Schriftlauf; die Spanne begrenzt sie zusätzlich je Art (Betreiber 2026-10-18: „hat ja nix damit
        // zu tun, dass sie nicht ein zoomband haben können“). Bäche haben ihre eigene: Der Schriftlauf trägt `is_bach` (Migration 0199).
        spuren.push({ id: `wege.${art}.name`, gruppe: "wege", zeile: art, spur: "name", vorgabe: ALLES });
    }
    spuren.push({ id: "wege.Flussweg.linie", gruppe: "wege", zeile: "Flussweg", spur: "linie", vorgabe: ALLES });
    spuren.push({
        id: "wege.Flussweg.kontur",
        gruppe: "wege",
        zeile: "Flussweg",
        spur: "kontur",
        vorgabe: ab(AVENTURIA_PATH_CARTOGRAPHY.water.outlineFromBand),
    });
    spuren.push({ id: "wege.Flussweg.name", gruppe: "wege", zeile: "Flussweg", spur: "name", vorgabe: ALLES });
    spuren.push({
        id: "wege.Seeweg.linie",
        gruppe: "wege",
        zeile: "Seeweg",
        spur: "linie",
        vorgabe: ALLES,
        nurAnsicht: "abgeschaltet",
    });
    return spuren;
}

function landschaften(): ZoombandSpur[] {
    const anzeige = AVENTURIA_LANDSCAPE_DISPLAY_DEFAULTS;
    const spuren: ZoombandSpur[] = [
        {
            id: "landschaften.flaechen.flaeche",
            gruppe: "landschaften",
            zeile: "flaechen",
            spur: "flaeche",
            vorgabe: ALLES,
        },
    ];
    for (const [art, werte] of Object.entries(anzeige.perArt)) {
        const von = werte.ab ?? anzeige.base.ab;
        const bis = upperBandFromLegacy(werte.bis ?? anzeige.base.bis);
        spuren.push({
            id: `landschaften.${art}.name`,
            gruppe: "landschaften",
            zeile: art,
            spur: "name",
            vorgabe: { von, bis },
            // Die Namen stehen in Schriftläufen, die nur in der Spanne der Vorgabe gerechnet sind: enger wirkt sofort, weiter
            // braucht ein Neuberechnen der Namensläufe.
            grenze: { von, bis, folge: "namen" },
        });
    }
    return spuren;
}

function gebiete(): ZoombandSpur[] {
    const politik = { innengrenzen: 1, grenznamen: 4 };
    return [
        {
            id: "gebiete.reiche.flaeche",
            gruppe: "gebiete",
            zeile: "reiche",
            spur: "flaeche",
            vorgabe: { von: 0, bis: 1 },
            nurAnsicht: "gebiete",
        },
        {
            id: "gebiete.ebenen.flaeche",
            gruppe: "gebiete",
            zeile: "ebenen",
            spur: "flaeche",
            vorgabe: { von: 2, bis: 2 },
            nurAnsicht: "gebiete",
        },
        {
            id: "gebiete.innengrenzen.linie",
            gruppe: "gebiete",
            zeile: "innengrenzen",
            spur: "linie",
            vorgabe: ab(politik.innengrenzen),
            nurAnsicht: "gebiete",
        },
        {
            id: "gebiete.grenznamen.name",
            gruppe: "gebiete",
            zeile: "grenznamen",
            spur: "name",
            vorgabe: ab(politik.grenznamen),
            nurAnsicht: "gebiete",
        },
    ];
}

function kraftlinien(): ZoombandSpur[] {
    return [
        {
            id: "kraftlinien.kraftlinien.linie",
            gruppe: "kraftlinien",
            zeile: "kraftlinien",
            spur: "linie",
            vorgabe: ALLES,
        },
        {
            id: "kraftlinien.kraftlinien.name",
            gruppe: "kraftlinien",
            zeile: "kraftlinien",
            spur: "name",
            vorgabe: ab(AVENTURIA_POWERLINE_CARTOGRAPHY.label.fromLegacyZoom),
        },
    ];
}

function gelaende(): ZoombandSpur[] {
    const kontur = DESIGN_CANON.topography.contour;
    // Je Stufe [Hunderter, Fünfhunderter, Tausender]; die Kacheln liefern eine Linie erst ab ihrem Band.
    const stufen = [
        { zeile: "hoehen100", index: 0 },
        { zeile: "hoehen500", index: 1 },
        { zeile: "hoehen1000", index: 2 },
    ] as const;
    const spuren: ZoombandSpur[] = [];
    for (const { zeile, index } of [...stufen].reverse()) {
        const von = bandAusZoom(kontur.minZoom[index]!);
        spuren.push({
            id: `gelaende.${zeile}.linie`,
            gruppe: "gelaende",
            zeile,
            spur: "linie",
            vorgabe: ab(von),
            grenze: { von, bis: MAX_BAND, folge: "kacheln" },
        });
        spuren.push({
            id: `gelaende.${zeile}.zahl`,
            gruppe: "gelaende",
            zeile,
            spur: "zahl",
            vorgabe: ab(bandAusZoom(kontur.labelMinZoom[index]!)),
        });
    }
    const gipfel = bandAusZoom(DESIGN_CANON.topography.peak.minZoom);
    spuren.push({
        id: "gelaende.gipfel.zeichen",
        gruppe: "gelaende",
        zeile: "gipfel",
        spur: "zeichen",
        vorgabe: ab(gipfel),
    });
    spuren.push({ id: "gelaende.gipfel.name", gruppe: "gelaende", zeile: "gipfel", spur: "name", vorgabe: ab(gipfel) });
    return spuren;
}

/** Jede Spur des Reiters, in der Reihenfolge der Panele. Die eine Liste; Karte, Server und Reiter lesen sie. */
export const ZOOMBAND_SPUREN: readonly ZoombandSpur[] = [
    ...orte(),
    ...wege(),
    ...landschaften(),
    ...gebiete(),
    ...kraftlinien(),
    ...gelaende(),
];

export function zoombandSpur(id: string): ZoombandSpur | undefined {
    return ZOOMBAND_SPUREN.find((spur) => spur.id === id);
}

/** Ob eine Spanne gültig ist: ganze Bänder 0 bis 8, `von` nicht hinter `bis`. */
export function zoomspanneGueltig(spanne: unknown): spanne is Zoomspanne {
    if (typeof spanne !== "object" || spanne === null) return false;
    const { von, bis } = spanne as Record<string, unknown>;
    return (
        Number.isInteger(von) &&
        Number.isInteger(bis) &&
        (von as number) >= 0 &&
        (bis as number) <= MAX_BAND &&
        (von as number) <= (bis as number)
    );
}

/**
 * Die wirksamen Spannen: je Spur die Abweichung, wo eine gilt, sonst die Vorgabe. Unbekannte Schlüssel, Spannen außerhalb der
 * Bänder und Abweichungen an Spuren nur zur Ansicht werden übergangen (tolerant lesen: ein Rückweg auf ein älteres Release
 * überlebt eine Spur, die es noch nicht kennt).
 */
export function wirksameZoombaender(abweichungen: Readonly<Record<string, unknown>>): Record<string, Zoomspanne> {
    const wirksam: Record<string, Zoomspanne> = {};
    for (const spur of ZOOMBAND_SPUREN) {
        const eigen = abweichungen[spur.id];
        wirksam[spur.id] =
            spur.nurAnsicht === undefined && zoomspanneGueltig(eigen)
                ? { von: eigen.von, bis: eigen.bis }
                : spur.vorgabe;
    }
    return wirksam;
}

/** Was eine Spanne braucht, bis sie auf der Karte gilt (Zeile „Folge“ im Reiter). */
export function zoombandFolge(spur: ZoombandSpur, spanne: Zoomspanne): "stil" | "namen" | "kacheln" {
    if (spur.grenze === undefined) return "stil";
    return spanne.von < spur.grenze.von || spanne.bis > spur.grenze.bis ? spur.grenze.folge : "stil";
}

// ── Lesewege und Schreibweg ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Öffentlich: die Abweichungen für den Start der Karte (no-cache mit ETag). */
export const ZOOM_BANDS_URL = "/api/zoom-bands";
/** Verwaltung: lesen mit `view_operations`, ändern mit `manage_display_settings` und Passkey. */
export const ZOOMBAENDER_URL = "/api/admin/system/zoombaender";

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const Spanne = Type.Object(
    { von: Type.Integer({ minimum: 0, maximum: MAX_BAND }), bis: Type.Integer({ minimum: 0, maximum: MAX_BAND }) },
    { additionalProperties: false },
);

/** `GET /api/zoom-bands`: nur die Abweichungen; der Browser rechnet mit `wirksameZoombaender` zusammen. Nur hinzufügen. */
export const ZoomBandsPublic = Type.Object(
    { abweichungen: Type.Record(Type.String(), Spanne) },
    { additionalProperties: false },
);
export type ZoomBandsPublic = Static<typeof ZoomBandsPublic>;

export const AdminZoombaender = Type.Object(
    {
        now: Type.String(),
        revision: Nullable(Type.Integer({ minimum: 0 })),
        source: Type.Union([Type.Literal("database"), Type.Literal("unprovisioned")]),
        zeilen: Type.Array(
            Type.Object(
                {
                    id: Type.String(),
                    spanne: Spanne,
                    changedAt: Type.String(),
                    changedBy: Nullable(Type.String()),
                },
                { additionalProperties: false },
            ),
        ),
        unknownKeys: Type.Array(Type.String()),
    },
    { additionalProperties: false },
);
export type AdminZoombaender = Static<typeof AdminZoombaender>;

/** Mehrere Spannen auf einmal („Übernehmen“ oben); `spanne: null` heißt zurück auf die Vorgabe. */
export const ZoombaenderBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        aenderungen: Type.Array(
            Type.Object(
                { id: Type.String({ minLength: 1, maxLength: 80 }), spanne: Nullable(Spanne) },
                { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 200 },
        ),
    },
    { additionalProperties: false },
);
export type ZoombaenderBody = Static<typeof ZoombaenderBody>;

// ── Anwenden auf die Karte (rein, ohne MapLibre; getestet in `packages/shared/test/zoombaender.test.ts`) ─────────────────────

/**
 * Eine Reihe je Band (Größe, Breite) auf eine Spanne gebracht: vor `von` leer, ab `von` der Wert der Reihe, und wo die Reihe dort
 * noch leer ist (die Spanne beginnt früher als die alte Vorgabe), ihr erster gefüllter Wert. Hinter `bis` bleibt die Reihe stehen;
 * die Obergrenze zieht ein Filter (`spannenObergrenze`), damit eine Größe 0 nie als „unsichtbar, aber da“ kollidiert.
 */
export function reiheMitSpanne<T extends number | null>(reihe: readonly T[], spanne: Zoomspanne, leer: T): T[] {
    const erste = reihe.find((wert) => wert !== null && wert !== 0) ?? leer;
    return reihe.map((wert, band) => {
        if (band < spanne.von) return leer;
        return wert === null || wert === 0 ? erste : wert;
    });
}

/**
 * Der Filter der Obergrenzen je Klasse: `true`, wo alle bis 8 reichen; sonst je Klasse `["<", ["zoom"], Beginn von bis + 1]`.
 * `["zoom"]` ist im Filter der ganzzahlige Kachelzoom, also genau die Bandgrenze.
 */
export function spannenObergrenze(bisJeKlasse: Readonly<Record<string, number>>, klassenEigenschaft: string): unknown {
    const faelle: unknown[] = [];
    for (const [klasse, bis] of Object.entries(bisJeKlasse)) {
        if (bis >= MAX_BAND) continue;
        faelle.push(klasse, ["<", ["zoom"], bis + 1 + RENDER_ZOOM_OFFSET]);
    }
    return faelle.length === 0 ? true : ["match", ["get", klassenEigenschaft], ...faelle, true];
}

/**
 * Der Filter ganzer Spannen je Klasse (Namen der Wegarten, Landschaftsnamen je Art): `true`, wo eine Klasse über alle Bänder reicht;
 * sonst `von` und `bis` als Zoomgrenzen. Eine Klasse ohne Eintrag bleibt unbegrenzt.
 */
export function spannenFilter(spannen: Readonly<Record<string, Zoomspanne>>, klassenEigenschaft: string): unknown {
    const faelle: unknown[] = [];
    for (const [klasse, spanne] of Object.entries(spannen)) {
        const bedingung = spannenBedingung(spanne);
        if (bedingung !== true) faelle.push(klasse, bedingung);
    }
    return faelle.length === 0 ? true : ["match", ["get", klassenEigenschaft], ...faelle, true];
}

/** Die Bedingung EINER Spanne im Filter (`["zoom"]` ist dort der ganzzahlige Kachelzoom); `true`, wenn sie alles zulässt. */
export function spannenBedingung({ von, bis }: Zoomspanne): unknown {
    const grenzen: unknown[] = [];
    if (von > 0) grenzen.push([">=", ["zoom"], von + RENDER_ZOOM_OFFSET]);
    if (bis < MAX_BAND) grenzen.push(["<", ["zoom"], bis + 1 + RENDER_ZOOM_OFFSET]);
    return grenzen.length === 0 ? true : grenzen.length === 1 ? grenzen[0] : ["all", ...grenzen];
}
