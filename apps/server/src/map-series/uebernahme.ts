import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
    AVENTURIA_SERIES,
    KARTENSERIE_UEBERNAHME_ART,
    KartenserieUebernahme,
    seriesSwitchKey,
    type KartenserieEinstellungen,
    type MapSeries,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { ablageAus, raeumeQuellenAuf } from "./ablage.ts";
import { leseZeiger, raeumeRevisionenAuf, schalteUmAuf, zeigerDerRevision } from "./fassungen.ts";
import { KARTENSERIEN_SPERRE } from "./schreiben.ts";
import { kartenserienKatalog, leseKartenserien } from "./stand.ts";

/**
 * „Nach Production übernehmen“ (WI-0220 Schnitt 4; Vorlage Fassung 4, Weg A „von Stage übernehmen“, Betreiber 2026-10-18 abgenommen).
 * Zwei Hälften, beide hier, damit die Eingabe an EINER Stelle entsteht und gelesen wird:
 *
 * 1. **Stage** (`uebernahmeEingabe`, gerufen von der Route): was mitgeht. Die Fassung, auf die `current.json` zeigt, die Quelle, aus der
 *    sie zerlegt wurde (aus dem Ergebnis ihres Auftrags `map_series_tile`; `null` für Serien, deren Original nur bei den Betreibern liegt),
 *    und die Einstellungen, wie die Stage sie zeigt. Daraus wird der Auftrag `map_series_production`.
 * 2. **Production** (`uebernimm`, gerufen von `kartenserie-uebernehmen` auf der Kommandozeile, nachdem Claudios Korridor Fassung und
 *    Quelle kopiert hat): Zeiger und Manifest der Fassung prüfen, die Einstellungen in `map_series` schreiben, `current.json` umschalten.
 *    Die vorige Fassung bleibt für den Rückweg; Älteres, das eine Übernahme oder ein Auftrag gebracht hat, räumt sie weg.
 *
 * 🔴 Keine Anwendung schreibt in die Datenbank einer anderen Umgebung, und Production wird nicht neu zerlegt. Vorgabe und Papierkorb
 * bleiben Sache jeder Umgebung; nur eine Serie, die auf der Stage die Vorgabe ist, wird es auch auf Production.
 */

/** Was die Stage von einer Serie zeigt, als Einstellungen der Übernahme (nicht nur die Abweichungen). */
function einstellungenAus(serie: MapSeries, stelle: number, istVorgabe: boolean): KartenserieEinstellungen {
    return {
        label: serie.label,
        description: serie.description,
        visibility: serie.visibility,
        labelsInImage: serie.labelsInImage,
        sortOrder: stelle * 10,
        thumb: serie.thumb ?? null,
        author: serie.author,
        origin: serie.origin,
        derivation: serie.derivation,
        permissionStatement: serie.permission.statement,
        attribution: serie.attribution,
        en: { ...serie.en },
        sourcePixels: serie.sourcePixels,
        maxNativeZoom: serie.maxNativeZoom,
        istVorgabe,
    };
}

/** Die Quelle, aus der eine Fassung zerlegt wurde: das Ergebnis ihres letzten erfolgreichen Auftrags `map_series_tile`. */
async function quelleDerFassung(tx: Queryable, serie: string, revision: string): Promise<string | null> {
    const [row] = await tx<{ quelle: string | null }[]>`
        SELECT result->>'quelle' AS quelle FROM job
         WHERE kind = 'map_series_tile' AND state = 'SUCCEEDED'
           AND input_ref->>'serie' = ${serie} AND result->>'revision' = ${revision}
         ORDER BY finished_at DESC, id DESC LIMIT 1
    `;
    const quelle = row?.quelle ?? null;
    return quelle !== null && /^[0-9a-f]{12}\.png$/u.test(quelle) ? quelle : null;
}

/**
 * Die Eingabe der Übernahme auf der Stage. Fehler: 404 `unknown_series`, 409 `series_not_ready` (im Papierkorb oder nicht zerlegt),
 * 503 `kartenserien_ablage_fehlt` (keine Kacheln auf dieser Instanz), 409 `kartenserien_fassung_fehlt` (kein lesbarer Zeiger),
 * 409 `kartenserien_auftrag_laeuft` (Zerlegen oder Übernahme derselben Serie wartet oder läuft), 409 `kartenserien_ausgeblendet`
 * (Stufe „Niemand“: Der Inhaltsschalter gehört der Umgebung und ginge nicht mit).
 */
export async function uebernahmeEingabe(
    tx: Queryable,
    input: { id: string; tileRoot: string | undefined },
): Promise<KartenserieUebernahme> {
    const stand = await leseKartenserien(tx);
    const katalog = kartenserienKatalog(stand);
    const stelle = katalog.series.findIndex((s) => s.id === input.id);
    if (stelle < 0) {
        const bekannt =
            stand.zeilen.some((z) => z.id === input.id) || AVENTURIA_SERIES.series.some((s) => s.id === input.id);
        if (!bekannt) throw new ApiError(404, "unknown_series", "Diese Kartenserie gibt es nicht.");
        throw new ApiError(
            409,
            "series_not_ready",
            "Diese Kartenserie ist nicht fertig zerlegt oder liegt im Papierkorb.",
        );
    }
    // „Niemand“ ist der Inhaltsschalter dieser Umgebung; er geht nicht mit. Ausgeblendet übernommen, wäre sie auf Production sichtbar.
    const [aus] = await tx<{ key: string }[]>`
        SELECT key FROM content_switch WHERE key = ${seriesSwitchKey(input.id)} AND NOT enabled
    `;
    if (aus !== undefined) {
        throw new ApiError(
            409,
            "kartenserien_ausgeblendet",
            "Eine ausgeblendete Serie geht nicht nach Production; erst sichtbar machen.",
        );
    }
    if (input.tileRoot === undefined) {
        throw new ApiError(503, "kartenserien_ablage_fehlt", "Auf dieser Instanz liegen keine Kacheln.");
    }
    const zeiger = await leseZeiger(input.tileRoot, input.id);
    if (zeiger === null) {
        throw new ApiError(
            409,
            "kartenserien_fassung_fehlt",
            "Die Fassung dieser Serie ist auf dem Server nicht lesbar.",
        );
    }
    const [offen] = await tx<{ kind: string }[]>`
        SELECT kind FROM job
         WHERE kind IN ('map_series_tile', ${KARTENSERIE_UEBERNAHME_ART}) AND state IN ('QUEUED', 'RUNNING')
           AND input_ref->>'serie' = ${input.id}
         LIMIT 1
    `;
    if (offen !== undefined) {
        throw new ApiError(409, "kartenserien_auftrag_laeuft", "Für diese Serie läuft schon ein Auftrag.");
    }
    const serie = katalog.series[stelle]!;
    return {
        serie: input.id,
        revision: zeiger.revision,
        quelle: await quelleDerFassung(tx, input.id, zeiger.revision),
        einstellungen: einstellungenAus(serie, stelle, katalog.defaultSeries === input.id),
    };
}

// ── Production: die Einstellungen schreiben und umschalten ─────────────────────────────────────────────────────────────────────

/** Liest die Eingabedatei des Korridors; wirft eine verständliche Meldung statt eines Stapels. */
export async function leseUebernahme(datei: string): Promise<KartenserieUebernahme> {
    let roh: unknown;
    try {
        roh = JSON.parse(await readFile(datei, "utf8"));
    } catch {
        throw new ApiError(400, "kartenserien_eingabe", `Die Eingabe ${datei} ist nicht lesbar oder kein JSON.`);
    }
    if (!Value.Check(KartenserieUebernahme, roh)) {
        const erster = [...Value.Errors(KartenserieUebernahme, roh)][0];
        throw new ApiError(
            400,
            "kartenserien_eingabe",
            `Die Eingabe passt nicht zur Übernahme (${erster?.path ?? "?"}: ${erster?.message ?? "?"}).`,
        );
    }
    return roh;
}

/** Ein Wert gleich der Vorgabe der JSON wird nicht gespeichert (wie im Schreibweg des Reiters). */
function abweichung<T>(wert: T, vorgabe: T | undefined): T | null {
    return vorgabe !== undefined && wert === vorgabe ? null : wert;
}

export interface UebernahmeErgebnis {
    vorher: string | null;
    revision: string;
    weggeraeumt: string[];
}

/**
 * Übernimmt eine Serie in DIESE Umgebung (Production). Erwartet die Fassung schon unter `<TILE_ROOT>/<serie>/<revision>/` (kopiert vom
 * Korridor). Schreibt die Einstellungen und schaltet um, in einer Transaktion unter der Sperre der Kartenserien; das Protokoll schreibt
 * der Aufrufer in derselben Transaktion (`protokoll`). Fehler: 404 `kartenserien_fassung_fehlt`, 409 `kartenserien_fassung_passt_nicht`.
 */
export async function uebernimm(
    db: Database,
    eingabe: KartenserieUebernahme,
    optionen: {
        tileRoot: string;
        protokoll: (tx: Queryable, ergebnis: Omit<UebernahmeErgebnis, "weggeraeumt">) => Promise<void>;
    },
): Promise<UebernahmeErgebnis> {
    const { serie, revision, einstellungen: e } = eingabe;
    const zeiger = await zeigerDerRevision(optionen.tileRoot, serie, revision);
    if (zeiger === null) {
        throw new ApiError(
            404,
            "kartenserien_fassung_fehlt",
            `Die Fassung ${revision} von „${serie}“ liegt in dieser Umgebung nicht (oder ihr Manifest stimmt nicht).`,
        );
    }
    if (zeiger.maxNativeZoom !== e.maxNativeZoom || zeiger.tileSize * 2 ** zeiger.maxNativeZoom !== e.sourcePixels) {
        throw new ApiError(
            409,
            "kartenserien_fassung_passt_nicht",
            "Kante und Stufe der Fassung passen nicht zu den Einstellungen der Übernahme.",
        );
    }
    const vorgabe = AVENTURIA_SERIES.series.find((s) => s.id === serie);
    const ergebnis = await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${KARTENSERIEN_SPERRE}))`;
        const [bisher] = await tx<{ is_default: boolean }[]>`
            SELECT is_default FROM map_series WHERE series_id = ${serie}
        `;
        const fuerAlle = e.visibility === "PUBLIC" && !e.labelsInImage;
        const istVorgabe = fuerAlle && (e.istVorgabe || bisher?.is_default === true);
        if (istVorgabe && bisher?.is_default !== true)
            await tx`UPDATE map_series SET is_default = false WHERE is_default`;
        const en =
            vorgabe === undefined
                ? e.en
                : Object.fromEntries(
                      (Object.keys(e.en) as (keyof typeof e.en)[])
                          .filter((feld) => e.en[feld] !== vorgabe.en[feld])
                          .map((feld) => [feld, e.en[feld]]),
                  );
        const thumbVorgabe = vorgabe?.thumb;
        const thumbGleich =
            (e.thumb === null && thumbVorgabe === undefined) ||
            (e.thumb !== null &&
                thumbVorgabe !== undefined &&
                e.thumb.x === thumbVorgabe.x &&
                e.thumb.y === thumbVorgabe.y);
        const thumb = thumbGleich ? null : e.thumb;
        await tx`
            INSERT INTO map_series (
                series_id, label, description, visibility, labels_in_image, sort_order, thumb_x, thumb_y, author, origin,
                derivation, permission_statement, attribution, texts_en, source_pixels, max_native_zoom, is_default, status,
                papierkorb_at, changed_at, changed_by, changed_by_label
            ) VALUES (
                ${serie}, ${abweichung(e.label, vorgabe?.label)}, ${abweichung(e.description, vorgabe?.description)},
                ${abweichung(e.visibility, vorgabe?.visibility)}, ${vorgabe === undefined ? e.labelsInImage : null},
                ${e.sortOrder}, ${thumb?.x ?? null}, ${thumb?.y ?? null}, ${abweichung(e.author, vorgabe?.author)},
                ${abweichung(e.origin, vorgabe?.origin)}, ${abweichung(e.derivation, vorgabe?.derivation)},
                ${abweichung(e.permissionStatement, vorgabe?.permission.statement)},
                ${abweichung(e.attribution, vorgabe?.attribution)},
                ${Object.keys(en).length === 0 ? null : tx.json(en as never)}, ${e.sourcePixels}, ${e.maxNativeZoom},
                ${istVorgabe}, 'aktiv', NULL, now(), NULL, 'Übernahme von Stage'
            )
            ON CONFLICT (series_id) DO UPDATE SET
                label = EXCLUDED.label, description = EXCLUDED.description, visibility = EXCLUDED.visibility,
                labels_in_image = EXCLUDED.labels_in_image, sort_order = EXCLUDED.sort_order, thumb_x = EXCLUDED.thumb_x,
                thumb_y = EXCLUDED.thumb_y, author = EXCLUDED.author, origin = EXCLUDED.origin, derivation = EXCLUDED.derivation,
                permission_statement = EXCLUDED.permission_statement, attribution = EXCLUDED.attribution,
                texts_en = EXCLUDED.texts_en, source_pixels = EXCLUDED.source_pixels, max_native_zoom = EXCLUDED.max_native_zoom,
                is_default = EXCLUDED.is_default, status = 'aktiv', papierkorb_at = NULL, changed_at = now(),
                changed_by = NULL, changed_by_label = EXCLUDED.changed_by_label
        `;
        const vorher = (await leseZeiger(optionen.tileRoot, serie))?.revision ?? null;
        await optionen.protokoll(tx, { vorher, revision: zeiger.revision });
        // Zuletzt, noch in der Transaktion: Scheitert das Umschalten, bleibt auch die Zeile, wie sie war.
        if (vorher !== zeiger.revision) await schalteUmAuf(optionen.tileRoot, zeiger);
        return { vorher, revision: zeiger.revision };
    });
    // Danach aufräumen wie nach dem Zerlegen: die übernommene und die vorige Fassung bleiben, höchstens zwei Quellen.
    const weggeraeumt = await raeumeRevisionenAuf(optionen.tileRoot, serie, [ergebnis.revision, ergebnis.vorher]);
    const ablage = ablageAus(process.env, optionen.tileRoot);
    if (ablage !== undefined && eingabe.quelle !== null) {
        await raeumeQuellenAuf(join(ablage.wurzel, serie), eingabe.quelle).catch(() => undefined);
    }
    return { ...ergebnis, weggeraeumt };
}
