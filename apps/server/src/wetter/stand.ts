import { randomInt } from "node:crypto";
import {
    WETTER_JAHR_SPALTEN,
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOL_GRENZEN,
    WETTER_SYMBOL_VORGABEN,
    istWetterSymbolArt,
    istWetterTag,
    wetterJahrImRahmen,
    wetterJahrWert,
    wetterJahreswerte,
    wetterNeuePresetWerte,
    wettermodellImRahmen,
    wettermodellPaarFehler,
    wettermodellWert,
    wettermodellWirksam,
    wetterPresetVorgabe,
    wetterSymbolName,
    wetterSymbolStimmig,
    type WetterDatenAntwort,
    type WetterJahreswerte,
    type WetterPreset,
    type WetterPresetWerte,
    type WetterQuelle,
    type WetterSymbol,
    type WetterSymbolAenderungen,
    type WetterSymbolAnlegenBody,
    type WetterSymbolDaten,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { isMissingTable } from "../system/state-row.ts";
import { wetterWikiVerweis } from "./wiki.ts";

/**
 * Das Wetter auf dem Server (WI-0288 Stufe 2, Migration 0326): lesen mit Vorgaben aufgefüllt, Presets und Icons materialisieren und ändern,
 * das Wettermodell verstellen. Die Tafeln samt Vorgaben und Grenzen stehen im geteilten Paket (`packages/shared/src/wetter/`); hier liegt
 * KEINE zweite Liste. Vorbild ist die Wegfindung (`system/wegfindung.ts`).
 *
 * - **Leere Tafel heißt Vorgaben.** Presets und Icons materialisieren getrennt: Die erste Änderung an einem Preset legt alle 14 an, die erste
 *   an einem Icon (auch das Anlegen eines neuen) alle Icons des Prototyps, jeweils in der Transaktion der Änderung und mit Revision 0.
 * - **Alle Schreibwege nacheinander** (`WETTER_SPERRE`, Beratungssperre bis zum Ende der Transaktion), sonst materialisierten zwei Editoren
 *   gleichzeitig. Kein `SELECT … FOR UPDATE`: Das verlangte das UPDATE-Recht an der Revisionstafel des Modells, das die App nicht hat.
 * - Alle Funktionen laufen in der Transaktion des Aufrufers, der im selben Zug das Protokoll schreibt (`adminOperation`).
 * - **Fehlerrichtung:** Fehlt eine Tafel (vor 0326) oder die Datenbank, gelten beim Lesen die Vorgaben; Schreiben antwortet 503.
 * - **Angelegte Presets** (Betreiber 2026-11-08): `legePresetAn` fügt ein Preset an einem freien Tag ein (Revision 1, Werte = die am Tag übergeblendeten),
 *   `entfernePreset` löscht es hart; die 14 festen und das gerade unbestimmte bleiben (409). Beide laufen unter derselben Sperre wie alle Schreibwege.
 * - **Der Wiki-Artikel eines Icons** (`wiki_titel`, Stufe 6): ein Verweis, den ein Editor setzt; geprüft gegen die Artikel des Derographie-Zugs (`wiki.ts`), nie von einem Abgleich geschrieben.
 */

export const WETTER_SPERRE = "wetter:schreiben";

export interface Akteur {
    personId: string | null;
    label: string;
}

/** Der Tag im Jahr, wie die Tafel ihn speichert: 0 heißt unbestimmt. */
const tagInTafel = (tag: number | null): number => tag ?? 0;
const tagAusTafel = (tag: number): number | null => (tag === 0 ? null : tag);

function fehlt(): ApiError {
    return new ApiError(503, "wetter_unprovisioned", "Die Tafeln des Wetters fehlen noch in dieser Umgebung.");
}

/** Wirft 503, wenn die Tafel fehlt; jeden anderen Fehler unverändert. */
async function tafel<T>(arbeit: () => Promise<T>): Promise<T> {
    try {
        return await arbeit();
    } catch (error) {
        if (isMissingTable(error)) throw fehlt();
        throw error;
    }
}

// ---------- Lesen ----------

interface PresetZeile {
    preset_id: string;
    tag: number;
    werte: unknown;
    revision: number;
    changed_at: Date;
}

interface SymbolZeile {
    public_id: string;
    art: string;
    name: string | null;
    name_zeigen: boolean;
    sichtbar: boolean;
    x: number;
    z: number;
    reichweite: number;
    staerke: number;
    richtung: number | null;
    drehsinn: number | null;
    wiki_titel: string | null;
    revision: number;
    changed_at: Date;
}

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

/**
 * Die Werte eines Presets aus der Tafel: je Spalte die gespeicherte Zahl, wenn sie in ihren Grenzen liegt, sonst der Rückfall — bei einer
 * Vorgabe ihre eigene Zahl, bei einem angelegten Preset die Überblendung der 14 an seinem Tag (`rueckfallWerte`).
 */
function presetWerte(roh: unknown, rueckfall: Readonly<Record<string, number>>): Record<string, number> {
    const werte = istObjekt(roh) ? roh : {};
    return Object.fromEntries(
        WETTER_JAHR_SPALTEN.map((k) => {
            const zahl = werte[k];
            return [k, wetterJahrImRahmen(wetterJahrWert(k)!, zahl) ? zahl : rueckfall[k]!];
        }),
    );
}

/** Der Rückfall für ein Preset: seine Vorgabe, sonst die Überblendung der übrigen 14 (`festePresets`) an seinem Tag. */
function rueckfallWerte(id: string, tag: number | null, festePresets: readonly WetterPresetWerte[]): WetterJahreswerte {
    return wetterPresetVorgabe(id)?.werte ?? wetterJahreswerte(festePresets, tag);
}

const VORGABE_PRESETS: WetterPreset[] = WETTER_PRESET_VORGABEN.map((preset) => ({
    id: preset.id,
    tag: preset.tag,
    werte: { ...preset.werte },
    revision: 0,
}));

const symbolAusZeile = (zeile: SymbolZeile): WetterSymbol => ({
    id: zeile.public_id,
    art: zeile.art as WetterSymbol["art"],
    name: zeile.name,
    nameZeigen: zeile.name_zeigen,
    sichtbar: zeile.sichtbar,
    x: zeile.x,
    z: zeile.z,
    reichweite: zeile.reichweite,
    staerke: zeile.staerke,
    richtung: zeile.richtung,
    drehsinn: zeile.drehsinn === null ? null : zeile.drehsinn < 0 ? -1 : 1,
    wikiTitel: zeile.wiki_titel,
    revision: zeile.revision,
});

const VORGABE_SYMBOLE: WetterSymbol[] = WETTER_SYMBOL_VORGABEN.map((symbol) => ({ ...symbol, revision: 0 }));

async function lesePresets(db: Queryable): Promise<{ presets: WetterPreset[]; quelle: WetterQuelle }> {
    let zeilen: PresetZeile[];
    try {
        zeilen = await db<PresetZeile[]>`SELECT preset_id, tag, werte, revision, changed_at FROM weather_preset`;
    } catch (error) {
        if (isMissingTable(error)) return { presets: VORGABE_PRESETS, quelle: "fehlt" };
        throw error;
    }
    if (zeilen.length === 0) return { presets: VORGABE_PRESETS, quelle: "vorgabe" };
    const nachId = new Map(zeilen.map((zeile) => [zeile.preset_id, zeile]));
    // Ein Preset, das die Tafel nicht kennt, wird übergangen; eines, das ihr fehlt (ein späteres Release), steht mit seiner Vorgabe da.
    const feste = WETTER_PRESET_VORGABEN.map((vorgabe): WetterPreset => {
        const zeile = nachId.get(vorgabe.id);
        if (zeile === undefined) return { id: vorgabe.id, tag: vorgabe.tag, werte: { ...vorgabe.werte }, revision: 0 };
        return {
            id: vorgabe.id,
            tag: tagAusTafel(zeile.tag),
            werte: presetWerte(zeile.werte, vorgabe.werte),
            revision: zeile.revision,
        };
    });
    // Die angelegten Presets danach, nach Tag (ein angelegtes, das unbestimmt wurde, zuerst).
    const angelegt = zeilen
        .filter((zeile) => wetterPresetVorgabe(zeile.preset_id) === undefined)
        .sort((a, b) => a.tag - b.tag || (a.preset_id < b.preset_id ? -1 : 1))
        .map((zeile): WetterPreset => {
            const tag = tagAusTafel(zeile.tag);
            return {
                id: zeile.preset_id,
                tag,
                werte: presetWerte(
                    zeile.werte,
                    rueckfallWerte(zeile.preset_id, tag, feste as unknown as WetterPresetWerte[]),
                ),
                revision: zeile.revision,
            };
        });
    const presets = [...feste, ...angelegt];
    return { presets, quelle: "gespeichert" };
}

async function leseSymbole(db: Queryable): Promise<{ symbole: WetterSymbol[]; quelle: WetterQuelle }> {
    let zeilen: SymbolZeile[];
    let gesamt: number;
    try {
        zeilen = await db<SymbolZeile[]>`
            SELECT public_id::text AS public_id, art, name, name_zeigen, sichtbar, x, z, reichweite, staerke, richtung, drehsinn,
                   wiki_titel, revision, changed_at
              FROM weather_symbol WHERE entfernt_at IS NULL ORDER BY id
        `;
        const [zahl] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM weather_symbol`;
        gesamt = zahl?.n ?? 0;
    } catch (error) {
        if (isMissingTable(error)) return { symbole: VORGABE_SYMBOLE, quelle: "fehlt" };
        throw error;
    }
    if (gesamt === 0) return { symbole: VORGABE_SYMBOLE, quelle: "vorgabe" };
    return { symbole: zeilen.map(symbolAusZeile), quelle: "gespeichert" };
}

async function leseModell(
    db: Queryable,
): Promise<{ revision: number | null; abweichungen: Record<string, number>; quelle: WetterQuelle }> {
    try {
        const [state] = await db<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM weather_model_state WHERE id = 1`;
        const zeilen = await db<{ key: string; value: number }[]>`SELECT key, value FROM weather_model_setting`;
        const abweichungen: Record<string, number> = {};
        for (const zeile of zeilen) {
            const wert = wettermodellWert(zeile.key);
            if (wert !== undefined && wettermodellImRahmen(wert, zeile.value)) abweichungen[zeile.key] = zeile.value;
        }
        return {
            revision: state?.revision ?? null,
            abweichungen,
            quelle: Object.keys(abweichungen).length > 0 ? "gespeichert" : "vorgabe",
        };
    } catch (error) {
        if (isMissingTable(error)) return { revision: null, abweichungen: {}, quelle: "fehlt" };
        throw error;
    }
}

/** Der Leseweg: Presets, Icons und Wettermodell, mit Vorgaben aufgefüllt. Ohne Datenbank die Vorgaben. */
export async function leseWetter(db: Queryable | undefined): Promise<WetterDatenAntwort> {
    if (db === undefined) {
        return {
            presets: VORGABE_PRESETS,
            symbole: VORGABE_SYMBOLE,
            modell: { revision: null, werte: { ...wettermodellWirksam({}) }, verstellt: [] },
            quelle: { presets: "fehlt", symbole: "fehlt", modell: "fehlt" },
        };
    }
    const [presets, symbole, modell] = [await lesePresets(db), await leseSymbole(db), await leseModell(db)];
    return {
        presets: presets.presets,
        symbole: symbole.symbole,
        modell: {
            revision: modell.revision,
            werte: { ...wettermodellWirksam(modell.abweichungen) },
            verstellt: Object.keys(modell.abweichungen).sort(),
        },
        quelle: { presets: presets.quelle, symbole: symbole.quelle, modell: modell.quelle },
    };
}

// ---------- Schreiben: gemeinsam ----------

async function sperre(tx: Queryable): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${WETTER_SPERRE}))`;
}

export interface Konflikt {
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

async function konflikt(input: Konflikt, revision: number, changedAt: Date): Promise<ApiError> {
    return input.conflict
        ? input.conflict({ revision, changedAt })
        : new ApiError(409, "edit_conflict", "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.");
}

function ausserhalb(feld: string, min: number, max: number, vorgabe?: number): ApiError {
    return new ApiError(
        400,
        "value_out_of_range",
        `Erlaubt ist ${String(min)} bis ${String(max)}.`,
        vorgabe === undefined ? { feld, min, max } : { feld, min, max, vorgabe },
    );
}

// ---------- Presets ----------

/** Legt die 14 Presets mit ihren Vorgaben an, wenn die Tafel leer ist (Revision 0). `true`, wenn es diesmal geschah. */
async function materialisierePresets(tx: Queryable, akteur: Akteur): Promise<boolean> {
    const [zahl] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM weather_preset`;
    if ((zahl?.n ?? 0) > 0) return false;
    for (const preset of WETTER_PRESET_VORGABEN) {
        await tx`
            INSERT INTO weather_preset (preset_id, tag, werte, revision, changed_by, changed_by_label)
            VALUES (${preset.id}, ${tagInTafel(preset.tag)}, ${tx.json({ ...preset.werte })}, 0,
                    ${akteur.personId}::uuid, ${akteur.label})
        `;
    }
    return true;
}

async function presetZeile(tx: Queryable, id: string): Promise<PresetZeile> {
    const [zeile] = await tx<PresetZeile[]>`
        SELECT preset_id, tag, werte, revision, changed_at FROM weather_preset WHERE preset_id = ${id}
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Dieses Preset gibt es nicht.");
    return zeile;
}

/** Der Rückfall für die Zeile eines Presets; für ein angelegtes liest er die 14 aus der Tafel (nur dann, sonst ist es die Vorgabe). */
async function rueckfallVon(tx: Queryable, zeile: PresetZeile): Promise<WetterJahreswerte> {
    const vorgabe = wetterPresetVorgabe(zeile.preset_id);
    if (vorgabe !== undefined) return vorgabe.werte;
    const { presets } = await lesePresets(tx);
    const feste = presets.filter((preset) => wetterPresetVorgabe(preset.id) !== undefined);
    return rueckfallWerte(zeile.preset_id, tagAusTafel(zeile.tag), feste as unknown as WetterPresetWerte[]);
}

export interface PresetWerteAendern extends Konflikt {
    id: string;
    baseRevision: number;
    werte: Readonly<Record<string, number | null>>;
    akteur: Akteur;
}

/**
 * Ändert Werte eines Presets (eines der 14 oder ein angelegtes). Unbekannte Kennung: 400 `unknown_setting`; `null` oder außerhalb der Grenzen: 400 `value_out_of_range`;
 * veraltete Revision: 409 `edit_conflict`; nichts anders als vorher: 409 `no_change`. Gibt die geänderten Kennungen und die neue Revision.
 */
export async function aenderePresetWerte(
    tx: Queryable,
    input: PresetWerteAendern,
): Promise<{ werte: string[]; revision: number; materialisiert: boolean }> {
    for (const [k, zahl] of Object.entries(input.werte)) {
        const wert = wetterJahrWert(k);
        if (wert === undefined) throw new ApiError(400, "unknown_setting", `Den Wert „${k}“ hält kein Preset.`);
        if (!wetterJahrImRahmen(wert, zahl)) throw ausserhalb(k, wert.min, wert.max);
    }
    return tafel(async () => {
        await sperre(tx);
        const materialisiert = await materialisierePresets(tx, input.akteur);
        const zeile = await presetZeile(tx, input.id);
        if (zeile.revision !== input.baseRevision) throw await konflikt(input, zeile.revision, zeile.changed_at);
        const vorher = presetWerte(zeile.werte, await rueckfallVon(tx, zeile));
        const geaendert = Object.keys(input.werte)
            .filter((k) => vorher[k] !== input.werte[k])
            .sort();
        if (geaendert.length === 0) throw new ApiError(409, "no_change", "Die Werte stehen schon so.");
        const neu = { ...vorher, ...(input.werte as Record<string, number>) };
        const [ergebnis] = await tx<{ revision: number }[]>`
            UPDATE weather_preset
               SET werte = ${tx.json(neu)}, revision = revision + 1, changed_at = now(),
                   changed_by = ${input.akteur.personId}::uuid, changed_by_label = ${input.akteur.label}
             WHERE preset_id = ${input.id}
            RETURNING revision
        `;
        return { werte: geaendert, revision: ergebnis!.revision, materialisiert };
    });
}

export interface PresetZeitpunkt extends Konflikt {
    id: string;
    baseRevision: number;
    /** Tag im Jahr, oder `null` für unbestimmt. */
    tag: number | null;
    akteur: Akteur;
}

/**
 * Legt ein Preset auf einen anderen Zeitpunkt. Liegt dort schon eines (bei `null`: das bisher unbestimmte), tauschen beide, in EINER
 * Anweisung (die Eindeutigkeit der Tafel ist aufschiebbar). Das unbestimmte auf einen freien Tag: 409 `unbestimmt_bleibt`. Schon dort:
 * 409 `no_change`. Geprüft wird die Revision des verschobenen Presets; beide heben ihre Revision.
 */
export async function setzePresetZeitpunkt(
    tx: Queryable,
    input: PresetZeitpunkt,
): Promise<{
    tag: number | null;
    getauscht: { id: string; tag: number | null; revision: number } | null;
    revision: number;
    materialisiert: boolean;
}> {
    return tafel(async () => {
        await sperre(tx);
        const materialisiert = await materialisierePresets(tx, input.akteur);
        const zeile = await presetZeile(tx, input.id);
        if (zeile.revision !== input.baseRevision) throw await konflikt(input, zeile.revision, zeile.changed_at);
        const ziel = tagInTafel(input.tag);
        if (zeile.tag === ziel) throw new ApiError(409, "no_change", "Das Preset liegt schon dort.");
        const [belegt] = await tx<{ preset_id: string }[]>`
            SELECT preset_id FROM weather_preset WHERE tag = ${ziel} AND preset_id <> ${input.id}
        `;
        if (belegt === undefined) {
            if (zeile.tag === 0) {
                throw new ApiError(
                    409,
                    "unbestimmt_bleibt",
                    "Ein Preset muss unbestimmt bleiben. Dafür ein anderes Preset auf „Unbestimmt“ stellen; an einem freien Tag liegt keins.",
                );
            }
            const [ergebnis] = await tx<{ revision: number }[]>`
                UPDATE weather_preset
                   SET tag = ${ziel}, revision = revision + 1, changed_at = now(),
                       changed_by = ${input.akteur.personId}::uuid, changed_by_label = ${input.akteur.label}
                 WHERE preset_id = ${input.id}
                RETURNING revision
            `;
            return { tag: input.tag, getauscht: null, revision: ergebnis!.revision, materialisiert };
        }
        const zeilen = await tx<{ preset_id: string; tag: number; revision: number }[]>`
            UPDATE weather_preset
               SET tag = CASE preset_id WHEN ${input.id} THEN ${ziel}::smallint ELSE ${zeile.tag}::smallint END,
                   revision = revision + 1, changed_at = now(),
                   changed_by = ${input.akteur.personId}::uuid, changed_by_label = ${input.akteur.label}
             WHERE preset_id IN (${input.id}, ${belegt.preset_id})
            RETURNING preset_id, tag, revision
        `;
        const eigene = zeilen.find((z) => z.preset_id === input.id)!;
        const andere = zeilen.find((z) => z.preset_id === belegt.preset_id)!;
        return {
            tag: input.tag,
            getauscht: { id: andere.preset_id, tag: tagAusTafel(andere.tag), revision: andere.revision },
            revision: eigene.revision,
            materialisiert,
        };
    });
}

const KLEIN = "abcdefghijklmnopqrstuvwxyz";
/** Eine neue Kennung: `p-` und acht zufällige Kleinbuchstaben (passt zu `WETTER_PRESET_ID_MUSTER` und zum CHECK der Tafel). */
const neueKennung = (): string => "p-" + Array.from({ length: 8 }, () => KLEIN[randomInt(KLEIN.length)]!).join("");

export interface PresetAnlegen {
    /** Der Tag im Jahr, 1 bis 365; angelegte Presets sind immer datiert. */
    tag: number;
    akteur: Akteur;
}

/**
 * Legt ein Preset an einem freien Tag an (davor, bei leerer Tafel, die 14): Es hält die am Tag gerade übergeblendeten Werte
 * (`wetterNeuePresetWerte`), damit sich am Wetter nichts ändert, bis jemand es verstellt. Tag belegt: 409 `tag_belegt`; kein Tag im Jahr:
 * 400 `value_out_of_range`. Gibt Kennung, Tag, Werte und Revision (1).
 */
export async function legePresetAn(
    tx: Queryable,
    input: PresetAnlegen,
): Promise<{ id: string; tag: number; werte: WetterJahreswerte; revision: number; materialisiert: boolean }> {
    if (!istWetterTag(input.tag)) throw ausserhalb("tag", 1, 365);
    return tafel(async () => {
        await sperre(tx);
        const materialisiert = await materialisierePresets(tx, input.akteur);
        const [belegt] = await tx<
            { preset_id: string }[]
        >`SELECT preset_id FROM weather_preset WHERE tag = ${input.tag}`;
        if (belegt !== undefined)
            throw new ApiError(409, "tag_belegt", "An diesem Tag liegt schon ein Preset.", { tag: input.tag });
        const { presets } = await lesePresets(tx);
        const werte = wetterNeuePresetWerte(presets as unknown as WetterPresetWerte[], input.tag);
        let id = neueKennung();
        // Bei einem Zusammenstoß neu würfeln (26^8 Möglichkeiten: kaum je nötig).
        for (let versuch = 0; versuch < 20; versuch += 1) {
            const [da] = await tx<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM weather_preset WHERE preset_id = ${id}`;
            if ((da?.n ?? 0) === 0) break;
            id = neueKennung();
        }
        const [zeile] = await tx<{ revision: number }[]>`
            INSERT INTO weather_preset (preset_id, tag, werte, revision, changed_by, changed_by_label)
            VALUES (${id}, ${input.tag}, ${tx.json({ ...werte })}, 1, ${input.akteur.personId}::uuid, ${input.akteur.label})
            RETURNING revision
        `;
        return { id, tag: input.tag, werte, revision: zeile!.revision, materialisiert };
    });
}

export interface PresetEntfernen extends Konflikt {
    id: string;
    baseRevision: number;
    akteur: Akteur;
}

/**
 * Entfernt ein angelegtes Preset (hart; die Werte nennt das Protokoll). Eines der 14: 409 `vorgabe_bleibt`; das gerade unbestimmte: 409
 * `unbestimmt_bleibt` (erst ein anderes Preset unbestimmt stellen); unbekannt: 404; veraltete Revision: 409 `edit_conflict`. Gibt Tag und
 * Werte der entfernten Zeile und die Revision, die sie danach gehabt hätte.
 */
export async function entfernePreset(
    tx: Queryable,
    input: PresetEntfernen,
): Promise<{ tag: number | null; werte: Record<string, number>; revision: number; materialisiert: boolean }> {
    if (wetterPresetVorgabe(input.id) !== undefined)
        throw new ApiError(409, "vorgabe_bleibt", "Die festen Presets bleiben; nur angelegte lassen sich entfernen.");
    return tafel(async () => {
        await sperre(tx);
        const materialisiert = await materialisierePresets(tx, input.akteur);
        const zeile = await presetZeile(tx, input.id);
        if (zeile.tag === 0)
            throw new ApiError(
                409,
                "unbestimmt_bleibt",
                "Dieses Preset ist gerade der Kartenstandard („Unbestimmt“) und bleibt. Dafür ein anderes Preset unbestimmt stellen.",
            );
        if (zeile.revision !== input.baseRevision) throw await konflikt(input, zeile.revision, zeile.changed_at);
        const werte = presetWerte(zeile.werte, await rueckfallVon(tx, zeile));
        await tx`DELETE FROM weather_preset WHERE preset_id = ${input.id}`;
        return { tag: tagAusTafel(zeile.tag), werte, revision: zeile.revision + 1, materialisiert };
    });
}

// ---------- Icons ----------

/** Legt die Icons des Prototyps an, wenn die Tafel leer ist (Revision 0, feste Kennungen). `true`, wenn es diesmal geschah. */
async function materialisiereSymbole(tx: Queryable, akteur: Akteur): Promise<boolean> {
    const [zahl] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM weather_symbol`;
    if ((zahl?.n ?? 0) > 0) return false;
    for (const symbol of WETTER_SYMBOL_VORGABEN) await fuegeSymbolEin(tx, symbol, 0, akteur);
    return true;
}

async function fuegeSymbolEin(
    tx: Queryable,
    symbol: Omit<WetterSymbolDaten, "id"> & { id?: string; wikiTitel?: string | null },
    revision: number,
    akteur: Akteur,
): Promise<{ id: string; revision: number }> {
    const [zeile] = await tx<{ public_id: string; revision: number }[]>`
        INSERT INTO weather_symbol (public_id, art, name, name_zeigen, sichtbar, x, z, reichweite, staerke, richtung, drehsinn, wiki_titel,
                                    revision, changed_by, changed_by_label)
        VALUES (COALESCE(${symbol.id ?? null}::uuid, gen_random_uuid()), ${symbol.art}, ${symbol.name}, ${symbol.nameZeigen},
                ${symbol.sichtbar}, ${symbol.x}, ${symbol.z}, ${symbol.reichweite}, ${symbol.staerke}, ${symbol.richtung},
                ${symbol.drehsinn}, ${symbol.wikiTitel ?? null}, ${revision}, ${akteur.personId}::uuid, ${akteur.label})
        RETURNING public_id::text AS public_id, revision
    `;
    return { id: zeile!.public_id, revision: zeile!.revision };
}

/** Name, Richtung und Drehsinn einer Eingabe in die Form der Tafel; 400 `symbol_ungueltig` mit dem Feld, das nicht passt. */
function pruefeSymbol(symbol: Omit<WetterSymbolDaten, "id">): void {
    for (const feld of ["x", "z", "reichweite", "staerke"] as const) {
        const g = WETTER_SYMBOL_GRENZEN[feld];
        const zahl = symbol[feld];
        if (!(Number.isFinite(zahl) && zahl >= g.min && zahl <= g.max)) throw ausserhalb(feld, g.min, g.max);
    }
    if (
        symbol.richtung !== null &&
        !(Number.isFinite(symbol.richtung) && symbol.richtung >= 0 && symbol.richtung < 360)
    )
        throw ausserhalb("richtung", 0, 360);
    if (!wetterSymbolStimmig(symbol)) {
        throw new ApiError(
            400,
            "symbol_ungueltig",
            symbol.art === "wirbel" || symbol.art === "mahlstrom"
                ? "Ein Wirbel oder Mahlstrom hat einen Drehsinn (1 oder −1) und keine Richtung."
                : "Wind und Strömung haben eine Richtung (0 bis unter 360 Grad) und keinen Drehsinn.",
            { art: symbol.art },
        );
    }
}

function nameAusEingabe(eingabe: string | null | undefined): string | null {
    const name = wetterSymbolName(eingabe ?? null);
    if (name === undefined)
        throw new ApiError(400, "value_out_of_range", "Der Name ist zu lang.", {
            feld: "name",
            max: WETTER_SYMBOL_GRENZEN.name.max,
        });
    return name;
}

export interface SymbolAnlegen {
    body: Omit<WetterSymbolAnlegenBody, "operationId">;
    akteur: Akteur;
}

/** Legt ein Icon an (davor, bei leerer Tafel, die Icons des Prototyps), auf Wunsch gleich mit Wiki-Artikel. Gibt Kennung und Revision (1). */
export async function legeSymbolAn(
    tx: Queryable,
    input: SymbolAnlegen,
): Promise<{ id: string; revision: number; materialisiert: boolean }> {
    const b = input.body;
    if (!istWetterSymbolArt(b.art)) throw new ApiError(400, "symbol_ungueltig", "Diese Art gibt es nicht.");
    const symbol: Omit<WetterSymbolDaten, "id"> = {
        art: b.art,
        name: nameAusEingabe(b.name),
        nameZeigen: b.nameZeigen ?? false,
        sichtbar: b.sichtbar ?? true,
        x: b.x,
        z: b.z,
        reichweite: b.reichweite,
        staerke: b.staerke,
        richtung: b.richtung ?? null,
        drehsinn: b.drehsinn ?? null,
    };
    pruefeSymbol(symbol);
    const wikiTitel = (await wetterWikiVerweis(tx, b.wikiTitel)) ?? null;
    return tafel(async () => {
        await sperre(tx);
        const materialisiert = await materialisiereSymbole(tx, input.akteur);
        const neu = await fuegeSymbolEin(tx, { ...symbol, wikiTitel }, 1, input.akteur);
        return { ...neu, materialisiert };
    });
}

async function symbolZeile(tx: Queryable, id: string): Promise<SymbolZeile> {
    const [zeile] = await tx<SymbolZeile[]>`
        SELECT public_id::text AS public_id, art, name, name_zeigen, sichtbar, x, z, reichweite, staerke, richtung, drehsinn, wiki_titel,
               revision, changed_at
          FROM weather_symbol WHERE public_id = ${id}::uuid AND entfernt_at IS NULL
    `;
    if (zeile === undefined) throw new ApiError(404, "not_found", "Dieses Icon gibt es nicht (mehr).");
    return zeile;
}

export interface SymbolAendern extends Konflikt {
    id: string;
    baseRevision: number;
    aenderungen: WetterSymbolAenderungen;
    akteur: Akteur;
}

/** Ändert ein Icon; die Art bleibt. Gibt die geänderten Felder (`wikiTitel` für den Verweis, ohne seinen Wert) und die neue Revision. */
export async function aendereSymbol(
    tx: Queryable,
    input: SymbolAendern,
): Promise<{ felder: string[]; revision: number; materialisiert: boolean }> {
    return tafel(async () => {
        await sperre(tx);
        const materialisiert = await materialisiereSymbole(tx, input.akteur);
        const zeile = await symbolZeile(tx, input.id);
        if (zeile.revision !== input.baseRevision) throw await konflikt(input, zeile.revision, zeile.changed_at);
        const vorher = symbolAusZeile(zeile);
        const a = input.aenderungen;
        const nachher: Omit<WetterSymbolDaten, "id"> = {
            art: vorher.art,
            name: a.name === undefined ? vorher.name : nameAusEingabe(a.name),
            nameZeigen: a.nameZeigen ?? vorher.nameZeigen,
            sichtbar: a.sichtbar ?? vorher.sichtbar,
            x: a.x ?? vorher.x,
            z: a.z ?? vorher.z,
            reichweite: a.reichweite ?? vorher.reichweite,
            staerke: a.staerke ?? vorher.staerke,
            richtung: a.richtung === undefined ? vorher.richtung : a.richtung,
            drehsinn: a.drehsinn === undefined ? vorher.drehsinn : a.drehsinn,
        };
        pruefeSymbol(nachher);
        const verweis = await wetterWikiVerweis(tx, a.wikiTitel);
        const wikiTitel = verweis === undefined ? (vorher.wikiTitel ?? null) : verweis;
        const felder: string[] = (Object.keys(nachher) as (keyof typeof nachher)[]).filter(
            (feld) => nachher[feld] !== vorher[feld],
        );
        if (wikiTitel !== (vorher.wikiTitel ?? null)) felder.push("wikiTitel");
        felder.sort();
        if (felder.length === 0) throw new ApiError(409, "no_change", "Das Icon steht schon so.");
        const [ergebnis] = await tx<{ revision: number }[]>`
            UPDATE weather_symbol
               SET name = ${nachher.name}, name_zeigen = ${nachher.nameZeigen}, sichtbar = ${nachher.sichtbar}, x = ${nachher.x},
                   z = ${nachher.z}, reichweite = ${nachher.reichweite}, staerke = ${nachher.staerke}, richtung = ${nachher.richtung},
                   drehsinn = ${nachher.drehsinn}, wiki_titel = ${wikiTitel}, revision = revision + 1, changed_at = now(),
                   changed_by = ${input.akteur.personId}::uuid, changed_by_label = ${input.akteur.label}
             WHERE public_id = ${input.id}::uuid
            RETURNING revision
        `;
        return { felder, revision: ergebnis!.revision, materialisiert };
    });
}

export interface SymbolEntfernen extends Konflikt {
    id: string;
    baseRevision: number;
    akteur: Akteur;
}

/** Entfernt ein Icon (weich). Das Wetter verliert den Antrieb sofort; wer es nur nicht sehen will, blendet es aus. */
export async function entferneSymbol(
    tx: Queryable,
    input: SymbolEntfernen,
): Promise<{ revision: number; materialisiert: boolean }> {
    return tafel(async () => {
        await sperre(tx);
        const materialisiert = await materialisiereSymbole(tx, input.akteur);
        const zeile = await symbolZeile(tx, input.id);
        if (zeile.revision !== input.baseRevision) throw await konflikt(input, zeile.revision, zeile.changed_at);
        const [ergebnis] = await tx<{ revision: number }[]>`
            UPDATE weather_symbol
               SET entfernt_at = now(), revision = revision + 1, changed_at = now(),
                   changed_by = ${input.akteur.personId}::uuid, changed_by_label = ${input.akteur.label}
             WHERE public_id = ${input.id}::uuid
            RETURNING revision
        `;
        return { revision: ergebnis!.revision, materialisiert };
    });
}

// ---------- Wettermodell ----------

export interface ModellVerstellen extends Konflikt {
    id: string;
    /** Der neue Wert, oder `null`: zurück auf die Vorgabe (die Zeile wird gelöscht). */
    value: number | null;
    baseRevision: number;
    akteur: Akteur;
}

/**
 * Verstellt einen Wert des Wettermodells oder setzt ihn zurück, wie die Karteneinstellungen: unbekannt 400 `unknown_setting`, außerhalb
 * der Grenzen (oder gegen die Reihenfolge eines Paars, `WETTERMODELL_PAARE`) 400 `value_out_of_range`, veraltet 409 `edit_conflict`, steht
 * schon so 409 `no_change`. Wer genau die Vorgabe schickt, setzt zurück.
 */
export async function verstelleWettermodell(
    tx: Queryable,
    input: ModellVerstellen,
): Promise<{ from: number | null; to: number | null; revision: number }> {
    const wert = wettermodellWert(input.id);
    if (wert === undefined) throw new ApiError(400, "unknown_setting", "Diese Einstellung gibt es nicht.");
    if (input.value !== null && !wettermodellImRahmen(wert, input.value)) {
        throw new ApiError(
            400,
            "value_out_of_range",
            wert.auswahl === undefined
                ? `Erlaubt ist ${String(wert.min)} bis ${String(wert.max)}; die Vorgabe ist ${String(wert.vorgabe)}.`
                : `Erlaubt ist eines von ${wert.auswahl.join(", ")}; die Vorgabe ist ${String(wert.vorgabe)}.`,
            wert.auswahl === undefined
                ? { min: wert.min, max: wert.max, vorgabe: wert.vorgabe }
                : { auswahl: [...wert.auswahl], vorgabe: wert.vorgabe },
        );
    }
    const ziel = input.value !== null && input.value === wert.vorgabe ? null : input.value;
    return tafel(async () => {
        await sperre(tx);
        const [state] = await tx<{ revision: number; updated_at: Date }[]>`
            SELECT revision::int AS revision, updated_at FROM weather_model_state WHERE id = 1
        `;
        if (state === undefined) throw fehlt();
        if (state.revision !== input.baseRevision) throw await konflikt(input, state.revision, state.updated_at);
        const zeilen = await tx<{ key: string; value: number }[]>`SELECT key, value FROM weather_model_setting`;
        const gespeichert = Object.fromEntries(zeilen.map((zeile) => [zeile.key, zeile.value]));
        const vorher = gespeichert[input.id];
        const from = vorher !== undefined && wettermodellImRahmen(wert, vorher) ? vorher : null;
        if ((vorher === undefined && ziel === null) || (ziel !== null && from === ziel))
            throw new ApiError(409, "no_change", "Der Wert steht schon so.");
        const danach = { ...gespeichert };
        if (ziel === null) delete danach[input.id];
        else danach[input.id] = ziel;
        const paar = wettermodellPaarFehler(wettermodellWirksam(danach));
        if (paar !== undefined) {
            const wirksam = wettermodellWirksam(danach);
            throw new ApiError(
                400,
                "value_out_of_range",
                `„${paar.kleiner}“ (${String(wirksam[paar.kleiner])}) muss kleiner sein als „${paar.groesser}“ (${String(wirksam[paar.groesser])}).`,
                { kleiner: paar.kleiner, groesser: paar.groesser },
            );
        }
        if (ziel === null) await tx`DELETE FROM weather_model_setting WHERE key = ${input.id}`;
        else
            await tx`
                INSERT INTO weather_model_setting (key, value, changed_at, changed_by, changed_by_label)
                VALUES (${input.id}, ${ziel}, now(), ${input.akteur.personId}::uuid, ${input.akteur.label})
                ON CONFLICT (key) DO UPDATE SET
                    value = EXCLUDED.value, changed_at = now(), changed_by = EXCLUDED.changed_by,
                    changed_by_label = EXCLUDED.changed_by_label
            `;
        const [neu] = await tx<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM weather_model_state WHERE id = 1`;
        return { from, to: ziel, revision: neu!.revision };
    });
}
