import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { OperationId, UUID_PATTERN } from "../operation.ts";
import {
    WETTER_JAHR_SPALTEN,
    WETTER_PRESET_ID_MUSTER,
    WETTER_PRESET_VORGABEN,
    istAngelegtePresetId,
    istWetterTag,
    wetterJahrImRahmen,
    wetterJahrWert,
    wetterJahreswerte,
    type WetterJahreswerte,
    type WetterPresetWerte,
} from "./jahr.ts";
import { WETTERMODELL_ID_MUSTER, wettermodellWirksam, type Wettermodellwerte } from "./modell.ts";
import { WETTER_SYMBOL_ARTEN } from "./arten.ts";
import { WETTER_SYMBOL_VORGABEN, wetterSymbolStimmig, type WetterSymbolDaten } from "./symbole.ts";

/**
 * Die Schnittstelle des Wetters (WI-0288 Stufe 2): ein Leseweg für alles, Schreibwege für Presets und Icons (Editoren) und für das
 * Wettermodell (Meteorologen).
 *
 *     GET   /api/wetter                                    Presets, Icons, Wettermodell, mit Vorgaben aufgefüllt (öffentlich, ETag)
 *     POST  /api/editor/wetter/presets                     { operationId, tag }                               edit_weather (R)
 *     PATCH /api/editor/wetter/presets/:id                 { operationId, baseRevision, werte }               edit_weather (R)
 *     POST  /api/editor/wetter/presets/:id/zeitpunkt       { operationId, baseRevision, tag }                 edit_weather (R)
 *     POST  /api/editor/wetter/presets/:id/entfernen       { operationId, baseRevision }                      edit_weather (R)
 *     POST  /api/editor/wetter/symbole                     { operationId, art, x, z, reichweite, staerke, … } edit_weather (R)
 *     PATCH /api/editor/wetter/symbole/:id                 { operationId, baseRevision, aenderungen }         edit_weather (R)
 *     POST  /api/editor/wetter/symbole/:id/entfernen       { operationId, baseRevision }                      edit_weather (R)
 *     GET   /api/editor/wetter/wiki-artikel                Winde, Strömungen, Mahlströme für den Verweis      edit_weather
 *     POST  /api/admin/system/wettermodell                 { operationId, baseRevision, id, value }           manage_weather_model + Passkey
 *
 * - **Revisionen:** je Preset und je Icon eine eigene, wie bei den Kartenobjekten der Editoren. Eine Vorgabe, die noch nicht gespeichert ist,
 *   trägt 0; das Materialisieren legt die Zeilen mit 0 an, die Änderung selbst hebt auf 1. Das Wettermodell hat EINE Revision für die ganze
 *   Tafel, wie Wegfindung und Karteneinstellungen.
 * - **Angelegte Presets** (Betreiber 2026-11-08): Ein Editor legt über `POST …/presets` ein Preset an einem freien Tag an (409 `tag_belegt`);
 *   seine Werte sind die am Tag gerade übergeblendeten (`wetterNeuePresetWerte`), die Kennung vergibt der Server (`p-` und acht Kleinbuchstaben).
 *   Es lässt sich verschieben, verstellen und wieder entfernen (hart, die Werte stehen im Protokoll); die 14 festen nicht (409 `vorgabe_bleibt`),
 *   ebenso nicht das gerade unbestimmte (409 `unbestimmt_bleibt`).
 * - 🪤 **Im Anfrageinhalt sind nullbare Felder EIN Schema mit Typliste** (`type: ["number", "null"]`), keine Vereinigung: Fastifys ajv wandelt
 *   sonst `null` in 0 um (`system/wegfindung.ts`, gemessen 2026-10-19). In den Antworten bleibt `Nullable`.
 */

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const ZahlOderNull = Type.Unsafe<number | null>({ type: ["number", "null"] });

export const WETTER_URL = "/api/wetter";
export const WETTER_PRESETS_URL = "/api/editor/wetter/presets";
export const WETTER_SYMBOLE_URL = "/api/editor/wetter/symbole";
export const WETTERMODELL_URL = "/api/admin/system/wettermodell";

export const wetterPresetUrl = (id: string): string => `${WETTER_PRESETS_URL}/${encodeURIComponent(id)}`;
export const wetterPresetZeitpunktUrl = (id: string): string => `${wetterPresetUrl(id)}/zeitpunkt`;
export const wetterPresetEntfernenUrl = (id: string): string => `${wetterPresetUrl(id)}/entfernen`;
export const wetterSymbolUrl = (id: string): string => `${WETTER_SYMBOLE_URL}/${encodeURIComponent(id)}`;
export const wetterSymbolEntfernenUrl = (id: string): string => `${wetterSymbolUrl(id)}/entfernen`;

// ---------- Leseweg ----------

export const WetterPreset = Type.Object(
    {
        id: Type.String(),
        /** Tag im Jahr, 1 bis 365; `null` heißt unbestimmt. */
        tag: Nullable(Type.Integer({ minimum: 1, maximum: 365 })),
        werte: Type.Record(Type.String(), Type.Number()),
        revision: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);
export type WetterPreset = Static<typeof WetterPreset>;

export const WetterSymbol = Type.Object(
    {
        id: Type.String(),
        art: Type.Union(WETTER_SYMBOL_ARTEN.map((art) => Type.Literal(art))),
        name: Nullable(Type.String()),
        nameZeigen: Type.Boolean(),
        sichtbar: Type.Boolean(),
        x: Type.Number(),
        z: Type.Number(),
        reichweite: Type.Number(),
        staerke: Type.Number(),
        richtung: Nullable(Type.Number()),
        drehsinn: Nullable(Type.Union([Type.Literal(1), Type.Literal(-1)])),
        /** Der Titel des Wiki-Artikels (`wiki.ts`, Stufe 6); fehlt bei den Vorgaben und an einem älteren Server, `null` ohne Verweis. */
        wikiTitel: Type.Optional(Nullable(Type.String())),
        revision: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
);
export type WetterSymbol = Static<typeof WetterSymbol>;

/**
 * Woher ein Teil kommt: `vorgabe` (die Tafel ist leer, es gelten die Zahlen im Code), `gespeichert` (ein Editor hat geändert), `fehlt` (die
 * Tafel gibt es in dieser Umgebung noch nicht, vor Migration 0326, oder der Server hat keine Datenbank).
 */
export const WetterQuelle = Type.Union([Type.Literal("vorgabe"), Type.Literal("gespeichert"), Type.Literal("fehlt")]);
export type WetterQuelle = Static<typeof WetterQuelle>;

/** `GET /api/wetter`. */
export const WetterDatenAntwort = Type.Object(
    {
        /** Erst die 14 Vorgaben in ihrer Reihenfolge (`WETTER_PRESET_VORGABEN`, nicht nach Tag), danach die angelegten nach Tag. */
        presets: Type.Array(WetterPreset),
        /** Die Icons, die nicht entfernt sind, in der Reihenfolge ihrer Anlage. */
        symbole: Type.Array(WetterSymbol),
        modell: Type.Object(
            {
                /** Die Revision der Tafel (`weather_model_state`), Grundlage für `baseRevision`; `null` ohne Tafel. */
                revision: Nullable(Type.Integer({ minimum: 0 })),
                /** Die wirksamen Werte ALLER Kennungen: Vorgaben, überschrieben von den Abweichungen. */
                werte: Type.Record(Type.String(), Type.Number()),
                /** Die Kennungen, die von ihrer Vorgabe abweichen (gespeichert sind), sortiert. */
                verstellt: Type.Array(Type.String()),
            },
            { additionalProperties: false },
        ),
        quelle: Type.Object(
            { presets: WetterQuelle, symbole: WetterQuelle, modell: WetterQuelle },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type WetterDatenAntwort = Static<typeof WetterDatenAntwort>;

// ---------- Schreibwege ----------

export const WetterPresetParams = Type.Object(
    { id: Type.String({ pattern: WETTER_PRESET_ID_MUSTER }) },
    { additionalProperties: false },
);
export const WetterSymbolParams = Type.Object(
    { id: Type.String({ pattern: UUID_PATTERN }) },
    { additionalProperties: false },
);

/** Werte eines Presets ändern; jede Kennung aus `WETTER_JAHR_SPALTEN`, jede Zahl in ihren Grenzen. `null` gibt es hier nicht (400). */
export const WetterPresetWerteBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        werte: Type.Record(Type.String({ pattern: "^[a-zA-Z]{1,20}$" }), ZahlOderNull, {
            minProperties: 1,
            maxProperties: WETTER_JAHR_SPALTEN.length,
        }),
    },
    { additionalProperties: false },
);
export type WetterPresetWerteBody = Static<typeof WetterPresetWerteBody>;

/**
 * Den Zeitpunkt eines Presets ändern: ein Tag im Jahr oder `null` (unbestimmt). Liegt dort schon eines (bei `null`: das bisher unbestimmte),
 * tauschen beide. Das unbestimmte auf einen freien Tag legen geht nicht (409 `unbestimmt_bleibt`): Genau eines bleibt unbestimmt.
 */
export const WetterPresetZeitpunktBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        tag: Type.Unsafe<number | null>({ type: ["integer", "null"], minimum: 1, maximum: 365 }),
    },
    { additionalProperties: false },
);
export type WetterPresetZeitpunktBody = Static<typeof WetterPresetZeitpunktBody>;

/** Ein Preset anlegen, an einem Tag im Jahr (1 bis 365); die Werte rechnet der Server. */
export const WetterPresetAnlegenBody = Type.Object(
    { operationId: OperationId, tag: Type.Integer({ minimum: 1, maximum: 365 }) },
    { additionalProperties: false },
);
export type WetterPresetAnlegenBody = Static<typeof WetterPresetAnlegenBody>;

/** Ein angelegtes Preset entfernen (hart). Die 14 festen und das gerade unbestimmte bleiben (409). */
export const WetterPresetEntfernenBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false },
);
export type WetterPresetEntfernenBody = Static<typeof WetterPresetEntfernenBody>;

const SymbolArt = Type.Union(WETTER_SYMBOL_ARTEN.map((art) => Type.Literal(art)));
const NameOderNull = Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: 400 });
const DrehsinnOderNull = Type.Unsafe<1 | -1 | null>({ type: ["integer", "null"], enum: [1, -1, null] });
/** Der Titel eines Wiki-Artikels oder `null` (Verweis lösen); ob es den Artikel gibt, prüft der Server (`wiki_artikel_unbekannt`). */
const WikiTitelOderNull = Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: 400 });

/** Ein Icon anlegen. Wind und Strömung brauchen `richtung`, Wirbel `drehsinn`; das andere fehlt oder ist `null`. */
export const WetterSymbolAnlegenBody = Type.Object(
    {
        operationId: OperationId,
        art: SymbolArt,
        name: Type.Optional(NameOderNull),
        nameZeigen: Type.Optional(Type.Boolean()),
        sichtbar: Type.Optional(Type.Boolean()),
        x: Type.Number(),
        z: Type.Number(),
        reichweite: Type.Number(),
        staerke: Type.Number(),
        richtung: Type.Optional(ZahlOderNull),
        drehsinn: Type.Optional(DrehsinnOderNull),
        wikiTitel: Type.Optional(WikiTitelOderNull),
    },
    { additionalProperties: false },
);
export type WetterSymbolAnlegenBody = Static<typeof WetterSymbolAnlegenBody>;

/** Ein Icon ändern; die Art bleibt. */
export const WetterSymbolAenderungen = Type.Object(
    {
        name: Type.Optional(NameOderNull),
        nameZeigen: Type.Optional(Type.Boolean()),
        sichtbar: Type.Optional(Type.Boolean()),
        x: Type.Optional(Type.Number()),
        z: Type.Optional(Type.Number()),
        reichweite: Type.Optional(Type.Number()),
        staerke: Type.Optional(Type.Number()),
        richtung: Type.Optional(ZahlOderNull),
        drehsinn: Type.Optional(DrehsinnOderNull),
        wikiTitel: Type.Optional(WikiTitelOderNull),
    },
    { additionalProperties: false, minProperties: 1 },
);
export type WetterSymbolAenderungen = Static<typeof WetterSymbolAenderungen>;

export const WetterSymbolAendernBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 0 }), aenderungen: WetterSymbolAenderungen },
    { additionalProperties: false },
);
export type WetterSymbolAendernBody = Static<typeof WetterSymbolAendernBody>;

export const WetterSymbolEntfernenBody = Type.Object(
    { operationId: OperationId, baseRevision: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false },
);
export type WetterSymbolEntfernenBody = Static<typeof WetterSymbolEntfernenBody>;

/** Einen Wert des Wettermodells verstellen; `value: null` setzt auf die Vorgabe zurück (die Zeile fällt weg). */
export const WettermodellBody = Type.Object(
    {
        operationId: OperationId,
        baseRevision: Type.Integer({ minimum: 0 }),
        id: Type.String({ minLength: 1, maxLength: 60, pattern: WETTERMODELL_ID_MUSTER }),
        value: ZahlOderNull,
    },
    { additionalProperties: false },
);
export type WettermodellBody = Static<typeof WettermodellBody>;

export const WETTER_ERROR_STATUS = {
    unknown_setting: 400,
    value_out_of_range: 400,
    symbol_ungueltig: 400,
    wiki_artikel_unbekannt: 400,
    no_change: 409,
    edit_conflict: 409,
    unbestimmt_bleibt: 409,
    tag_belegt: 409,
    vorgabe_bleibt: 409,
    not_found: 404,
    wetter_unprovisioned: 503,
} as const;

// ---------- Lesen im Browser ----------

/** Die Daten, mit denen das Wetter im Browser rechnet: jede Zahl geprüft, wo nötig durch die Vorgabe ersetzt. */
export interface WetterDaten {
    readonly presets: readonly WetterPresetWerte[];
    readonly symbole: readonly WetterSymbolDaten[];
    readonly modell: Wettermodellwerte;
    /** `true`, wenn alles aus den Vorgaben kommt, weil die Antwort fehlte oder nicht zu lesen war. */
    readonly nurVorgaben: boolean;
}

/** Die Vorgaben, ohne Server. */
export const wetterDatenVorgaben = (): WetterDaten => ({
    presets: WETTER_PRESET_VORGABEN,
    symbole: WETTER_SYMBOL_VORGABEN,
    modell: wettermodellWirksam({}),
    nurVorgaben: true,
});

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

/**
 * Liest die Antwort von `GET /api/wetter` tolerant (wie `wegfindungImBrowserAus`): Ein Preset ohne gültigen Zeitpunkt oder mit doppeltem Tag
 * fällt auf seine Vorgabe zurück, ein Wert außerhalb seiner Grenzen ebenso; ein Icon, das nicht stimmig ist, fällt weg. Dazu kommen die
 * angelegten Presets der Antwort (Kennung nach Muster und keine Vorgabe, gültiger Tag, von keinem anderen belegt; sonst fällt nur dieses weg,
 * nicht alle zurück); ein Wert außerhalb der Grenzen nimmt dort die Überblendung der 14 am Tag an. Ist die Antwort im
 * Ganzen nicht zu lesen (ein älterer Server, keine Verbindung), gelten die Vorgaben, so wie vor WI-0288 Stufe 2.
 */
export function wetterDatenAus(body: unknown): WetterDaten {
    if (!istObjekt(body) || !Array.isArray(body["presets"]) || !Array.isArray(body["symbole"]))
        return wetterDatenVorgaben();
    const geliefert = new Map<string, Record<string, unknown>>();
    for (const roh of body["presets"])
        if (istObjekt(roh) && typeof roh["id"] === "string") geliefert.set(roh["id"], roh);
    const belegt = new Set<number | null>();
    const presets = WETTER_PRESET_VORGABEN.map((vorgabe): WetterPresetWerte => {
        const roh = geliefert.get(vorgabe.id);
        const tag = roh?.["tag"];
        const zeitpunkt = tag === null || istWetterTag(tag) ? tag : vorgabe.tag;
        const werteRoh = istObjekt(roh?.["werte"]) ? roh["werte"] : {};
        const werte = Object.fromEntries(
            WETTER_JAHR_SPALTEN.map((k) => {
                const zahl = werteRoh[k];
                return [k, wetterJahrImRahmen(wetterJahrWert(k)!, zahl) ? zahl : vorgabe.werte[k]];
            }),
        ) as WetterJahreswerte;
        belegt.add(zeitpunkt);
        return { id: vorgabe.id, tag: zeitpunkt, werte };
    });
    // Die angelegten Presets, jedes für sich geprüft: Kennung nach Muster und keine Vorgabe, Zeitpunkt ein Tag oder unbestimmt. Ein Zeitpunkt, den
    // eines der 14 oder ein früheres angelegtes schon hält, lässt das spätere wegfallen (nicht alle zurücksetzen).
    const kandidaten = [...geliefert.values()].flatMap((roh) => {
        const id = roh["id"] as string;
        const tag = roh["tag"];
        return istAngelegtePresetId(id) && (tag === null || istWetterTag(tag))
            ? [{ id, tag: tag as number | null, roh }]
            : [];
    });
    const waehle = (feste: readonly WetterPresetWerte[]): WetterPresetWerte[] => {
        const belegtTage = new Set<number | null>(feste.map((preset) => preset.tag));
        const gewaehlt: WetterPresetWerte[] = [];
        for (const { id, tag, roh } of kandidaten.sort(
            (x, y) => (x.tag ?? 0) - (y.tag ?? 0) || (x.id < y.id ? -1 : 1),
        )) {
            if (belegtTage.has(tag)) continue;
            belegtTage.add(tag);
            const werteRoh = istObjekt(roh["werte"]) ? roh["werte"] : {};
            const werte = Object.fromEntries(
                WETTER_JAHR_SPALTEN.map((k) => {
                    const zahl = werteRoh[k];
                    // Außerhalb der Grenzen: die Überblendung der 14 am Tag (unbestimmt: der Kartenstandard der 14).
                    return [k, wetterJahrImRahmen(wetterJahrWert(k)!, zahl) ? zahl : wetterJahreswerte(feste, tag)[k]];
                }),
            ) as WetterJahreswerte;
            gewaehlt.push({ id, tag, werte });
        }
        return gewaehlt;
    };
    // Ein Zeitpunkt doppelt oder kein unbestimmtes (weder unter den 14 noch unter den angelegten, denn auch ein angelegtes darf unbestimmt
    // sein): Die Antwort widerspricht sich, und dann gelten die Zeitpunkte der Vorgaben.
    let festePresets: WetterPresetWerte[] = presets;
    let angelegt = belegt.size === presets.length ? waehle(festePresets) : [];
    const unbestimmtDa = (liste: readonly WetterPresetWerte[]): boolean => liste.some((preset) => preset.tag === null);
    if (belegt.size !== presets.length || !(unbestimmtDa(festePresets) || unbestimmtDa(angelegt))) {
        festePresets = presets.map((preset, i) => ({ ...preset, tag: WETTER_PRESET_VORGABEN[i]!.tag }));
        angelegt = waehle(festePresets);
    }
    angelegt.sort((x, y) => (x.tag ?? 0) - (y.tag ?? 0));
    const symbole = body["symbole"].flatMap((roh): WetterSymbolDaten[] => {
        if (!istObjekt(roh) || typeof roh["id"] !== "string") return [];
        const symbol = roh as unknown as WetterSymbolDaten;
        const ohneId = {
            art: symbol.art,
            name: symbol.name ?? null,
            nameZeigen: symbol.nameZeigen,
            sichtbar: symbol.sichtbar,
            x: symbol.x,
            z: symbol.z,
            reichweite: symbol.reichweite,
            staerke: symbol.staerke,
            richtung: symbol.richtung ?? null,
            drehsinn: symbol.drehsinn ?? null,
        };
        // Der Verweis auf den Wiki-Artikel (Stufe 6) reist nur mit, wo er ein Text ist; ein älterer Server kennt ihn nicht.
        const verweis =
            typeof symbol.wikiTitel === "string" && symbol.wikiTitel !== "" ? { wikiTitel: symbol.wikiTitel } : {};
        return wetterSymbolStimmig(ohneId) ? [{ id: symbol.id, ...ohneId, ...verweis }] : [];
    });
    const modellRoh = istObjekt(body["modell"]) && istObjekt(body["modell"]["werte"]) ? body["modell"]["werte"] : {};
    return {
        presets: [...festePresets, ...angelegt],
        symbole,
        modell: wettermodellWirksam(modellRoh),
        nurVorgaben: false,
    };
}
