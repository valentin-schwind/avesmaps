import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp, { type Metadata } from "sharp";
import {
    KARTENSERIE_KACHEL_PX,
    istKartenserieKennung,
    kartenserieKachelzahl,
    kartenserieStufen,
} from "@avesmaps3d/shared";
import { ablageAus, juengsteQuelle, raeumeQuellenAuf } from "../map-series/ablage.ts";
import {
    existiert,
    kachelOrdner,
    lesbarFuerNginx,
    leseZeiger,
    manifestHash,
    raeumeRevisionenAuf,
    schalteUmAuf,
    zeigerDerRevision,
    zeigerFuer,
    zeigerZeile,
} from "../map-series/fassungen.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import type { Queryable } from "../database.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Der Auftrag `map_series_tile` (WI-0220 Schnitt 3, §4.3): ein hochgeladenes PNG prüfen, in eine WebP-Pyramide zerlegen, ihr Manifest
 * bilden und `current.json` umschalten. Schwer, ein Lauf zur Zeit (Profil `config/jobs/*.json`); auf dem VPS über den Wrapper
 * `avesmaps3d-auftrag` (Claudio, zuerst nur Stage).
 *
 * Phasen: **pruefen** (Größe, SHA-256, libvips liest Quadrat und Kante) · **zerlegen** (`sharp().tile()`, Google-Layout, 512 px, WebP
 * q80, wie der Messlauf 2026-10-17) · **manifest** (umbenennen, zählen, Hash, Revision) · **umschalten** (Zeiger, Tafel, Aufräumen).
 *
 * - 🪤 libvips schreibt im Google-Layout `z/y/x`, die Karte liest `z/x/y` (ADR-0008). Ohne Umbenennen läge jede Kachel gespiegelt an der
 *   Diagonale; gemessen erst 8 bis 12 dB.
 * - **Wiederholbar:** Eine neue Revision entsteht in einem eigenen Verzeichnis neben den anderen (`.neu-<auftrag>`) und wird erst am
 *   Ende umbenannt. Ein zweiter Lauf nach einem Abbruch fängt dort neu an; eine fertige Revision mit demselben Manifest wird nur genommen.
 * - **Rückweg:** Die vorige Revision bleibt; ihr Zeiger liegt als `<revision>.json` neben ihr. Älteres, das dieser Auftrag gebaut hat,
 *   räumt er weg; Revisionen ohne Zeiger daneben (von `raster-publish.sh`) bleiben stehen.
 * - Die Tafel `map_series` bekommt Kante und höchste Stufe (Jobs-Rolle, nur diese zwei Spalten): Erst dann erscheint eine neue Serie
 *   im Fächer (`wirksamerKatalog`).
 */

export interface MapSeriesTileInput {
    serie: string;
    /** Der Name des Eingangs unter `<Ablage>/<serie>/` (`eingang-<uploadId>.png`). */
    eingang: string;
    bytes: number;
    kante: number;
    art: "neu" | "ersetzen";
}

export function parseMapSeriesTileInput(input: Record<string, unknown>): MapSeriesTileInput {
    const { serie, eingang, bytes, kante, art } = input;
    if (
        typeof serie !== "string" ||
        !istKartenserieKennung(serie) ||
        typeof eingang !== "string" ||
        !/^eingang-[0-9a-f-]{36}\.png$/u.test(eingang) ||
        typeof bytes !== "number" ||
        !Number.isSafeInteger(bytes) ||
        bytes <= 0 ||
        typeof kante !== "number" ||
        kartenserieStufen(kante) === null ||
        (art !== "neu" && art !== "ersetzen")
    ) {
        throw new JobFailure("invalid_input", "Eingabe des Auftrags map_series_tile ungültig", false);
    }
    return { serie, eingang, bytes, kante, art };
}

const PHASE = { pruefen: 0, zerlegen: 0.1, manifest: 0.8, umschalten: 0.95 } as const;

async function sha256Von(pfad: string, context: JobContext): Promise<string> {
    const hash = createHash("sha256");
    let stuecke = 0;
    for await (const stueck of createReadStream(pfad, { highWaterMark: 4 * 1024 * 1024 })) {
        hash.update(stueck as Buffer);
        stuecke += 1;
        if (stuecke % 64 === 0) context.checkpoint();
    }
    return hash.digest("hex");
}

async function zaehleDateien(wurzel: string): Promise<number> {
    let summe = 0;
    let eintraege;
    try {
        eintraege = await readdir(wurzel, { withFileTypes: true });
    } catch {
        return 0;
    }
    for (const e of eintraege) {
        if (e.isDirectory()) summe += await zaehleDateien(join(wurzel, e.name));
        else if (e.isFile() && e.name.endsWith(".webp")) summe += 1;
    }
    return summe;
}

/** libvips' Google-Layout `z/y/x.webp` in unser `z/x/y.webp` umbauen; alles außer Kacheln (Eigenschaften, Platzhalter) fällt weg. */
export async function nachXyz(wurzel: string): Promise<void> {
    for (const e of await readdir(wurzel, { withFileTypes: true })) {
        if (!e.isDirectory() || !/^\d+$/u.test(e.name)) {
            await rm(join(wurzel, e.name), { recursive: true, force: true });
            continue;
        }
        const alt = join(wurzel, e.name);
        const neu = join(wurzel, `${e.name}.xy`);
        await rm(neu, { recursive: true, force: true });
        for (const y of await readdir(alt)) {
            if (!/^\d+$/u.test(y)) continue;
            for (const datei of await readdir(join(alt, y))) {
                const x = /^(\d+)\.webp$/u.exec(datei)?.[1];
                if (x === undefined) continue;
                await mkdir(join(neu, x), { recursive: true });
                await rename(join(alt, y, datei), join(neu, x, `${y}.webp`));
            }
        }
        await rm(alt, { recursive: true, force: true });
        await rename(neu, alt);
    }
}

/**
 * Kante und höchste Stufe in die Tafel (Jobs-Rolle, nur diese zwei Spalten; `system-grants.psql`). Eine Vorgabe-Serie hat vielleicht
 * noch keine Zeile: anlegen mit nur diesen zwei Werten.
 */
export async function trageKanteEin(db: Queryable, serie: string, kante: number, stufen: number): Promise<void> {
    await db`
        INSERT INTO map_series (series_id, source_pixels, max_native_zoom)
        VALUES (${serie}, ${kante}, ${stufen})
        ON CONFLICT (series_id) DO UPDATE SET source_pixels = EXCLUDED.source_pixels, max_native_zoom = EXCLUDED.max_native_zoom
    `;
}

export async function runMapSeriesTile(
    context: JobContext,
    eintragen: (serie: string, kante: number, stufen: number) => Promise<void> = (serie, kante, stufen) =>
        withJobDatabase((db) => trageKanteEin(db, serie, kante, stufen)),
): Promise<Record<string, unknown>> {
    const input = parseMapSeriesTileInput(context.input);
    const tileRoot = process.env["TILE_ROOT"]?.trim();
    if (!tileRoot) throw new JobFailure("tile_root_missing", "TILE_ROOT ist nicht gesetzt", false);
    const ablage = ablageAus(process.env, tileRoot)!;
    const stufen = kartenserieStufen(input.kante)!;
    const quellen = join(ablage.wurzel, input.serie);
    const eingang = join(quellen, input.eingang);

    // ── prüfen ────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // Die Quelle heißt nach ihrer Prüfsumme (`<sha12>.png`). Ein zweiter Lauf nach einem Abbruch findet sie schon so benannt: Der
    // Eingang ist dann weg, und `ergebnis.quelle` des ersten Laufs steht nicht zur Verfügung; er nimmt die jüngste Quelle der Serie.
    await context.beginPhase("pruefen", PHASE.pruefen);
    let endname: string;
    if (await existiert(eingang)) {
        if ((await stat(eingang)).size !== input.bytes) {
            await rm(eingang, { force: true });
            throw new JobFailure("source_size", "Die Größe der Quelle stimmt nicht; bitte neu hochladen", false);
        }
        endname = `${(await sha256Von(eingang, context)).slice(0, 12)}.png`;
        if (await existiert(join(quellen, endname))) await rm(eingang, { force: true });
        else await rename(eingang, join(quellen, endname));
    } else {
        const juengste = await juengsteQuelle(quellen);
        if (juengste === undefined) throw new JobFailure("source_missing", "Die Quelle des Auftrags fehlt", false);
        endname = juengste;
    }
    const quelle = join(quellen, endname);
    let meta: Metadata;
    try {
        meta = await sharp(quelle, { limitInputPixels: false, unlimited: true, sequentialRead: true }).metadata();
    } catch {
        throw new JobFailure("source_unreadable", "libvips kann die Quelle nicht lesen", false);
    }
    if (meta.format !== "png" || meta.width !== input.kante || meta.height !== input.kante) {
        throw new JobFailure("source_edge", "Die Quelle ist kein Quadrat mit der angemeldeten Kante", false);
    }

    // ── zerlegen ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    await context.beginPhase("zerlegen", PHASE.zerlegen);
    const serienOrdner = join(tileRoot, input.serie);
    // 0755, nicht 0750: Nginx liest die Kacheln als www-data (Claudio 2026-10-18, Ergänzung A).
    await kachelOrdner(serienOrdner);
    const arbeit = join(serienOrdner, `.neu-${context.job.publicId}`);
    await rm(arbeit, { recursive: true, force: true });
    const erwartet = kartenserieKachelzahl(input.kante);
    let abbruch: unknown;
    const takt = setInterval(() => {
        void zaehleDateien(arbeit)
            .then((fertig) =>
                context.beginPhase(
                    "zerlegen",
                    PHASE.zerlegen + ((PHASE.manifest - PHASE.zerlegen) * fertig) / erwartet,
                ),
            )
            .catch((fehler: unknown) => {
                abbruch ??= fehler;
            });
    }, 5_000);
    try {
        sharp.concurrency(2);
        sharp.cache(false);
        await sharp(quelle, { limitInputPixels: false, unlimited: true, sequentialRead: true })
            .webp({ quality: 80 })
            .tile({ size: KARTENSERIE_KACHEL_PX, overlap: 0, layout: "google", depth: "onepixel", skipBlanks: -1 })
            .toFile(arbeit);
    } finally {
        clearInterval(takt);
    }
    if (abbruch !== undefined) {
        await rm(arbeit, { recursive: true, force: true });
        throw abbruch;
    }

    // ── Manifest ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    await context.beginPhase("manifest", PHASE.manifest);
    await nachXyz(arbeit);
    await lesbarFuerNginx(arbeit);
    const { hash, dateien } = await manifestHash(arbeit);
    if (dateien !== erwartet) {
        await rm(arbeit, { recursive: true, force: true });
        throw new JobFailure("tile_count", `Die Pyramide hat ${dateien} statt ${erwartet} Kacheln`, false);
    }
    const zeiger = zeigerFuer(input.serie, hash, stufen);
    const ziel = join(serienOrdner, zeiger.revision);
    if (await existiert(ziel)) {
        const vorhanden = await zeigerDerRevision(tileRoot, input.serie, zeiger.revision);
        await rm(arbeit, { recursive: true, force: true });
        if (vorhanden?.manifest !== hash) {
            throw new JobFailure(
                "revision_conflict",
                "Eine Revision dieses Namens liegt schon mit anderem Inhalt da",
                false,
            );
        }
    } else {
        await rename(arbeit, ziel);
    }
    await writeFile(`${ziel}.json`, zeigerZeile(zeiger), { mode: 0o644 });

    // ── umschalten ────────────────────────────────────────────────────────────────────────────────────────────────────────
    await context.beginPhase("umschalten", PHASE.umschalten);
    const vorher = (await leseZeiger(tileRoot, input.serie))?.revision ?? null;
    await schalteUmAuf(tileRoot, zeiger);
    await eintragen(input.serie, input.kante, stufen);
    const weg = await raeumeRevisionenAuf(tileRoot, input.serie, [zeiger.revision, vorher]);
    await raeumeQuellenAuf(quellen, endname);
    return {
        revision: zeiger.revision,
        vorher,
        quelle: endname,
        kacheln: dateien,
        kante: input.kante,
        stufen,
        weggeraeumt: weg,
    };
}
