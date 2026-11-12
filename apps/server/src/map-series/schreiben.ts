import {
    AVENTURIA_SERIES,
    SERIES_SWITCH_PREFIX,
    kartenserieStufe,
    seriesSwitchKey,
    wirksamerKatalog,
    type KartenserieAktion,
    type KartenserieZeile,
    type MapSeries,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { schalteUm } from "../system/inhaltsschalter.ts";
import { leseZeiger, schalteUmAuf, zeigerDerRevision } from "./fassungen.ts";
import { PAPIERKORB_FRIST_SQL } from "./papierkorb.ts";
import { leseKartenserien } from "./stand.ts";

/**
 * Der Schreibweg des Reiters „Kartenserien“ (WI-0220 Schnitt 2), in der Transaktion des Aufrufers, der das Protokoll im selben Zug
 * schreibt. Vorbild ist `system/karteneinstellungen.ts`: Sperre, `baseRevision`, nur Abweichungen speichern.
 *
 * Regeln, die hier gelten (und nirgends sonst):
 *
 * - 🔴 Beschriftung im Bild darf „Alle“ heißen; Besucher sehen die Serie dann nur unter „Nur Karte“ (Betreiber 2026-11-10,
 *   `nurUnterNurKarte`, `docs/regeln/oberflaeche.md` „Kartenserie `old`“). Vorgabe wird sie nie (409 `labels_in_image`), und für die
 *   Regel „mindestens eine bleibt für alle“ zählt sie nicht mit: In den übrigen Ansichten stünde jeder Name doppelt.
 * - 🔴 Die Vorgabe-Serie ist immer für alle sichtbar: Sie wird nicht „Nur Editoren“, nicht „Niemand“ und kommt nicht in den
 *   Papierkorb. Erst eine andere Serie zur Vorgabe machen.
 * - 🔴 Mindestens eine Serie ohne Beschriftung im Bild bleibt für alle sichtbar (dieselbe Regel wie 409 `last_series` der
 *   Inhaltsschalter).
 * - „Niemand“ ist der Inhaltsschalter `map.series.<id>` (`schalteUm`), keine zweite Stelle; „Alle“ und „Nur Editoren“ schalten ihn
 *   wieder ein.
 * - Ein Wert gleich der Vorgabe wird nicht gespeichert (das Feld wird leer); eine Zeile, die nichts mehr abweicht, fällt weg.
 * - Wiederherstellen nur innerhalb der Frist des Papierkorbs (`KARTENSERIE_PAPIERKORB_TAGE`, Schnitt 4).
 */

export const KARTENSERIEN_SPERRE = "map_series:schreiben";

export interface Handlung {
    id: string;
    aktion: KartenserieAktion;
    baseRevision: number;
    actor: { personId: string | null; label: string };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
    /** Wo die Pyramiden liegen (`TILE_ROOT`); nur der Rückweg auf eine Fassung braucht es (Schnitt 3). */
    tileRoot?: string | undefined;
}

/** Was im Protokoll steht: welche Handlung, vorher, nachher (kurz, nie ganze Rechtstexte). */
export interface Ergebnis {
    from: unknown;
    to: unknown;
    revision: number;
}

type Spalten = {
    label: string | null;
    description: string | null;
    visibility: MapSeries["visibility"] | null;
    sort_order: number | null;
    thumb_x: number | null;
    thumb_y: number | null;
    author: string | null;
    origin: string | null;
    derivation: string | null;
    permission_statement: string | null;
    attribution: string | null;
    is_default: boolean;
    status: "aktiv" | "papierkorb";
    /** Kante und Stufe der Pyramide: schreibt nur der Auftrag `map_series_tile` (Schnitt 3); hier nur, damit die Zeile nicht wegfällt. */
    source_pixels: number | null;
    max_native_zoom: number | null;
};

const TEXT_SPALTE = {
    label: "label",
    description: "description",
    author: "author",
    origin: "origin",
    derivation: "derivation",
    permissionStatement: "permission_statement",
    attribution: "attribution",
} as const;

function leereZeile(): Spalten {
    return {
        label: null,
        description: null,
        visibility: null,
        sort_order: null,
        thumb_x: null,
        thumb_y: null,
        author: null,
        origin: null,
        derivation: null,
        permission_statement: null,
        attribution: null,
        is_default: false,
        status: "aktiv",
        source_pixels: null,
        max_native_zoom: null,
    };
}

function spaltenAus(zeile: KartenserieZeile | undefined): Spalten {
    if (zeile === undefined) return leereZeile();
    return {
        label: zeile.label,
        description: zeile.description,
        visibility: zeile.visibility,
        sort_order: zeile.sortOrder,
        thumb_x: zeile.thumb?.x ?? null,
        thumb_y: zeile.thumb?.y ?? null,
        author: zeile.author,
        origin: zeile.origin,
        derivation: zeile.derivation,
        permission_statement: zeile.permissionStatement,
        attribution: zeile.attribution,
        is_default: zeile.isDefault,
        status: zeile.status,
        source_pixels: zeile.sourcePixels,
        max_native_zoom: zeile.maxNativeZoom,
    };
}

/** Der Wert eines Textfelds in der Vorgabe (JSON); für neue Serien gibt es keine Vorgabe. */
function vorgabeText(vorgabe: MapSeries | undefined, feld: keyof typeof TEXT_SPALTE): string | undefined {
    if (vorgabe === undefined) return undefined;
    return feld === "permissionStatement" ? vorgabe.permission.statement : vorgabe[feld];
}

function nichtsAbweichend(s: Spalten, neu: boolean): boolean {
    return (
        !neu &&
        !s.is_default &&
        s.status === "aktiv" &&
        [
            s.label,
            s.description,
            s.visibility,
            s.sort_order,
            s.thumb_x,
            s.author,
            s.origin,
            s.derivation,
            s.permission_statement,
            s.attribution,
            // Eine ersetzte Vorgabe-Serie mit anderer Kante trägt sie hier (Schnitt 3); die Zeile bleibt.
            s.source_pixels,
            s.max_native_zoom,
        ].every((v) => v === null)
    );
}

/** Die ausgeblendeten Serien (Inhaltsschalter `map.series.*` aus) und die Inhaltsrevision. */
async function schalterStand(tx: Queryable): Promise<{ aus: Set<string>; revision: number }> {
    const rows = await tx<
        { key: string }[]
    >`SELECT key FROM content_switch WHERE NOT enabled AND key LIKE 'map.series.%'`;
    const [state] = await tx<{ content_revision: number }[]>`
        SELECT content_revision::int AS content_revision FROM system_state WHERE id = 1
    `;
    return {
        aus: new Set(rows.map((r) => r.key.slice(SERIES_SWITCH_PREFIX.length))),
        revision: state?.content_revision ?? 0,
    };
}

/** Führt eine Handlung aus. Fehler: 409 `edit_conflict`, 404 `unknown_series`, 409 mit einem Grund aus den Regeln oben. */
export async function handleKartenserie(tx: Queryable, input: Handlung): Promise<Ergebnis> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${KARTENSERIEN_SPERRE}))`;
    const [state] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM map_series_state WHERE id = 1
    `;
    if (state === undefined) {
        throw new ApiError(
            503,
            "kartenserien_unprovisioned",
            "Die Tafel der Kartenserien fehlt noch in dieser Umgebung.",
        );
    }
    if (state.revision !== input.baseRevision) {
        throw input.conflict
            ? await input.conflict({ revision: state.revision, changedAt: state.updated_at })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
    const stand = await leseKartenserien(tx);
    const zeile = stand.zeilen.find((z) => z.id === input.id);
    const vorgabe = AVENTURIA_SERIES.series.find((s) => s.id === input.id);
    if (zeile === undefined && vorgabe === undefined) {
        throw new ApiError(404, "unknown_series", "Diese Kartenserie gibt es nicht.");
    }
    const katalog = wirksamerKatalog(AVENTURIA_SERIES, stand.zeilen);
    const schalter = await schalterStand(tx);
    const serie = katalog.series.find((s) => s.id === input.id);
    const imPapierkorb = zeile?.status === "papierkorb";
    // Angelegt, aber nie fertig zerlegt (Schnitt 3): Sie darf in den Papierkorb, sonst nichts.
    const unfertig = serie === undefined && !imPapierkorb && vorgabe === undefined && zeile?.sourcePixels === null;
    if (unfertig && input.aktion.art === "papierkorb") {
        await tx`UPDATE map_series SET status = 'papierkorb', papierkorb_at = now(), is_default = false, changed_at = now(),
                        changed_by = ${input.actor.personId}::uuid, changed_by_label = ${input.actor.label}
                  WHERE series_id = ${input.id}`;
        const [nachKorb] = await tx<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM map_series_state WHERE id = 1`;
        return { from: "aktiv", to: "papierkorb", revision: nachKorb!.revision };
    }
    if (serie === undefined && !imPapierkorb) {
        throw new ApiError(409, "series_not_ready", "Diese Kartenserie ist noch nicht fertig zerlegt.");
    }
    const stufeVon = (s: MapSeries) => kartenserieStufe(s, schalter.aus.has(s.id));
    // Überall für alle: „Alle“ und ohne Beschriftung im Bild (die sehen Besucher nur unter „Nur Karte“).
    const ueberallFuerAlle = (s: MapSeries) => stufeVon(s) === "alle" && !s.labelsInImage;
    const fuerAlle = katalog.series.filter(ueberallFuerAlle);
    const istVorgabe = katalog.defaultSeries === input.id;
    const letzteFuerAlle = serie !== undefined && ueberallFuerAlle(serie) && fuerAlle.length <= 1;
    const neu = vorgabe === undefined;
    const s = spaltenAus(zeile);
    let from: unknown;
    let to: unknown;
    let schalterZiel: boolean | undefined;

    const aktion = input.aktion;
    switch (aktion.art) {
        case "texte": {
            const vorher: Record<string, string | null> = {};
            const nachher: Record<string, string | null> = {};
            for (const [feld, wert] of Object.entries(aktion.texte) as [keyof typeof TEXT_SPALTE, string | null][]) {
                if (wert === undefined) continue;
                const spalte = TEXT_SPALTE[feld];
                const ziel = wert === null ? null : feld === "label" ? wert.trim() : wert;
                if (feld === "label" && ziel === "") {
                    throw new ApiError(400, "label_required", "Eine Kartenserie braucht einen Namen.");
                }
                const gespeichert = ziel !== null && ziel === vorgabeText(vorgabe, feld) ? null : ziel;
                if (s[spalte] === gespeichert) continue;
                vorher[feld] = s[spalte];
                nachher[feld] = gespeichert;
                s[spalte] = gespeichert;
            }
            if (Object.keys(nachher).length === 0) throw new ApiError(409, "no_change", "Der Text steht schon so.");
            // Ins Protokoll nur, welche Felder sich änderten, nicht die Texte selbst (Rechtstexte sind lang).
            from = Object.keys(vorher);
            to = Object.keys(nachher);
            break;
        }
        case "stufe": {
            if (serie === undefined) throw new ApiError(409, "in_papierkorb", "Diese Kartenserie liegt im Papierkorb.");
            const jetzt = stufeVon(serie);
            if (jetzt === aktion.stufe) throw new ApiError(409, "no_change", "Die Sichtbarkeit steht schon so.");
            if (aktion.stufe !== "alle" && istVorgabe) {
                throw new ApiError(
                    409,
                    "default_visible",
                    "Die Vorgabe ist für alle sichtbar. Erst eine andere Serie als Vorgabe setzen.",
                );
            }
            if (aktion.stufe !== "alle" && letzteFuerAlle) {
                throw new ApiError(409, "last_series", "Mindestens eine Kartenserie muss für alle sichtbar bleiben.");
            }
            if (aktion.stufe === "niemand") {
                schalterZiel = false;
            } else {
                const ziel: MapSeries["visibility"] = aktion.stufe === "alle" ? "PUBLIC" : "EDITOR_ONLY";
                s.visibility = vorgabe !== undefined && vorgabe.visibility === ziel ? null : ziel;
                if (schalter.aus.has(input.id)) schalterZiel = true;
            }
            from = jetzt;
            to = aktion.stufe;
            break;
        }
        case "vorgabe": {
            if (serie === undefined || stufeVon(serie) !== "alle") {
                throw new ApiError(409, "default_visible", "Vorgabe kann nur eine Serie sein, die alle sehen.");
            }
            if (serie.labelsInImage) {
                throw new ApiError(
                    409,
                    "labels_in_image",
                    "Die Beschriftung steckt im Bild. Als Vorgabe stünde in den Ansichten mit Namen jeder Name doppelt.",
                );
            }
            if (istVorgabe) throw new ApiError(409, "no_change", "Diese Serie ist schon die Vorgabe.");
            from = katalog.defaultSeries;
            to = input.id;
            await tx`UPDATE map_series SET is_default = false WHERE is_default`;
            s.is_default = true;
            break;
        }
        case "reihe": {
            const index = katalog.series.findIndex((x) => x.id === input.id);
            const nachbar = index + (aktion.richtung === "hoch" ? -1 : 1);
            if (index < 0 || nachbar < 0 || nachbar >= katalog.series.length) {
                throw new ApiError(409, "no_change", "Die Serie steht schon am Rand.");
            }
            const reihe = katalog.series.map((x) => x.id);
            [reihe[index], reihe[nachbar]] = [reihe[nachbar]!, reihe[index]!];
            // Alle Serien bekommen ihre Stelle (je 10 Abstand): eine Reihe, keine Lücken, keine Gleichstände.
            for (const [stelle, id] of reihe.entries()) {
                if (id === input.id) continue;
                await tx`
                    INSERT INTO map_series (series_id, sort_order, changed_at, changed_by, changed_by_label)
                    VALUES (${id}, ${stelle * 10}, now(), ${input.actor.personId}::uuid, ${input.actor.label})
                    ON CONFLICT (series_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
                `;
            }
            s.sort_order = reihe.indexOf(input.id) * 10;
            from = index;
            to = nachbar;
            break;
        }
        case "fassung": {
            // Rückweg (Schnitt 3): `current.json` auf eine Fassung, die schon auf der Platte liegt; dazu Kante und Stufe.
            if (input.tileRoot === undefined) {
                throw new ApiError(503, "kartenserien_ablage_fehlt", "Auf dieser Instanz liegen keine Kacheln.");
            }
            const zeiger = await zeigerDerRevision(input.tileRoot, input.id, aktion.revision);
            if (zeiger === null)
                throw new ApiError(404, "kartenserien_fassung_fehlt", "Diese Fassung liegt nicht auf dem Server.");
            const vorher = (await leseZeiger(input.tileRoot, input.id))?.revision ?? null;
            if (vorher === zeiger.revision) throw new ApiError(409, "no_change", "Diese Fassung gilt schon.");
            await schalteUmAuf(input.tileRoot, zeiger);
            const kante = zeiger.tileSize * 2 ** zeiger.maxNativeZoom;
            if (
                zeile !== undefined ||
                kante !== vorgabe?.sourcePixels ||
                zeiger.maxNativeZoom !== vorgabe.maxNativeZoom
            ) {
                await tx`
                    INSERT INTO map_series (series_id, source_pixels, max_native_zoom)
                    VALUES (${input.id}, ${kante}, ${zeiger.maxNativeZoom})
                    ON CONFLICT (series_id) DO UPDATE SET
                        source_pixels = EXCLUDED.source_pixels, max_native_zoom = EXCLUDED.max_native_zoom
                `;
            }
            const [nachFassung] = await tx<
                { revision: number }[]
            >`SELECT revision::int AS revision FROM map_series_state WHERE id = 1`;
            return { from: vorher, to: zeiger.revision, revision: nachFassung!.revision };
        }
        case "thumb": {
            const ziel = aktion.thumb;
            const gleich = ziel === null ? s.thumb_x === null : s.thumb_x === ziel.x && s.thumb_y === ziel.y;
            if (gleich) throw new ApiError(409, "no_change", "Das Bild steht schon so.");
            from = s.thumb_x === null ? null : { x: s.thumb_x, y: s.thumb_y };
            to = ziel;
            s.thumb_x = ziel?.x ?? null;
            s.thumb_y = ziel?.y ?? null;
            break;
        }
        case "papierkorb": {
            if (imPapierkorb) throw new ApiError(409, "no_change", "Die Serie liegt schon im Papierkorb.");
            if (istVorgabe) {
                throw new ApiError(
                    409,
                    "default_visible",
                    "Die Vorgabe lässt sich nicht löschen. Erst eine andere Serie als Vorgabe setzen.",
                );
            }
            if (letzteFuerAlle)
                throw new ApiError(409, "last_series", "Mindestens eine Kartenserie muss für alle sichtbar bleiben.");
            s.status = "papierkorb";
            from = "aktiv";
            to = "papierkorb";
            break;
        }
        case "wiederherstellen": {
            if (!imPapierkorb) throw new ApiError(409, "no_change", "Die Serie liegt nicht im Papierkorb.");
            // Nach der Frist sind Kacheln und Quelle weggeräumt (`papierkorb.ts`), oder sie werden es gleich: kein Zurück ohne Kacheln.
            const [frist] = await tx<{ abgelaufen: boolean }[]>`
                SELECT papierkorb_at < now() - ${PAPIERKORB_FRIST_SQL}::interval AS abgelaufen
                  FROM map_series WHERE series_id = ${input.id}
            `;
            if (frist?.abgelaufen === true) {
                throw new ApiError(
                    409,
                    "papierkorb_abgelaufen",
                    "Die Frist im Papierkorb ist abgelaufen; Kacheln und Quelle sind weggeräumt.",
                );
            }
            s.status = "aktiv";
            from = "papierkorb";
            to = "aktiv";
            break;
        }
    }

    await schreibeZeile(tx, input, s, neu);
    if (schalterZiel !== undefined) {
        await schalteUm(tx, {
            key: seriesSwitchKey(input.id),
            enabled: schalterZiel,
            baseRevision: schalter.revision,
            actor: input.actor,
        });
    }
    const [danach] = await tx<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM map_series_state WHERE id = 1`;
    return { from, to, revision: danach!.revision };
}

async function schreibeZeile(tx: Queryable, input: Handlung, s: Spalten, neu: boolean): Promise<void> {
    if (nichtsAbweichend(s, neu)) {
        await tx`DELETE FROM map_series WHERE series_id = ${input.id}`;
        return;
    }
    await tx`
        INSERT INTO map_series (
            series_id, label, description, visibility, sort_order, thumb_x, thumb_y, author, origin, derivation,
            permission_statement, attribution, is_default, status, papierkorb_at, changed_at, changed_by, changed_by_label
        ) VALUES (
            ${input.id}, ${s.label}, ${s.description}, ${s.visibility}, ${s.sort_order}, ${s.thumb_x}, ${s.thumb_y}, ${s.author},
            ${s.origin}, ${s.derivation}, ${s.permission_statement}, ${s.attribution}, ${s.is_default}, ${s.status},
            ${s.status === "papierkorb" ? new Date() : null}, now(), ${input.actor.personId}::uuid, ${input.actor.label}
        )
        ON CONFLICT (series_id) DO UPDATE SET
            label = EXCLUDED.label, description = EXCLUDED.description, visibility = EXCLUDED.visibility,
            sort_order = EXCLUDED.sort_order, thumb_x = EXCLUDED.thumb_x, thumb_y = EXCLUDED.thumb_y, author = EXCLUDED.author,
            origin = EXCLUDED.origin, derivation = EXCLUDED.derivation, permission_statement = EXCLUDED.permission_statement,
            attribution = EXCLUDED.attribution, is_default = EXCLUDED.is_default, status = EXCLUDED.status,
            papierkorb_at = CASE WHEN EXCLUDED.status = 'papierkorb'
                                 THEN COALESCE(map_series.papierkorb_at, EXCLUDED.papierkorb_at) ELSE NULL END,
            changed_at = now(), changed_by = EXCLUDED.changed_by, changed_by_label = EXCLUDED.changed_by_label
    `;
}
