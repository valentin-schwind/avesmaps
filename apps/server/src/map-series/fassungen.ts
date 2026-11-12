import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
    KARTENSERIE_KACHEL_PX,
    RASTER_REVISION_PATTERN,
    istKartenserieKennung,
    readRasterPointer,
    type KartenserieFassung,
    type RasterPyramidPointer,
} from "@avesmaps3d/shared";

/**
 * Die Fassungen einer Pyramide (ADR-0008; WI-0220 Schnitt 3): Revisionen unter `<TILE_ROOT>/<serie>/<revision>/z/x/y.webp`, der
 * Zeiger `<serie>/current.json`. Neben jeder Revision, die der Auftrag baut, liegt ihr Zeiger als `<revision>.json`: Der Rückweg
 * schreibt ihn nur nach `current.json`, ohne etwas neu zu rechnen.
 *
 * - **Manifest** wie im Handover der Rasterkacheln (`ops/deploy/raster-publish.sh`, `manifest_hash`): je Datei `<sha256>  <pfad>`,
 *   nach Pfad sortiert (Bytefolge), darüber SHA-256. Die ersten 12 Zeichen sind die Revision.
 * - **Umschalten ist atomar:** erst `.current.json.tmp`, dann `rename`. Eine offene Karte sieht die alte oder die neue Fassung, nie
 *   eine halbe.
 * - 🔴 **Lesbar für Nginx** (Claudio 2026-10-18, Antwort zum Production-Weg, Ergänzung A): Nginx liefert die Kacheln als `www-data`
 *   direkt von der Platte. Unter `TILE_ROOT` darum Ordner 0755, Kacheln und Zeiger 0644; 0750 gilt nur unter `map-sources`.
 */

const REVISION = new RegExp(RASTER_REVISION_PATTERN, "u");

async function dateienUnter(wurzel: string, praefix = ""): Promise<string[]> {
    const aus: string[] = [];
    for (const eintrag of await readdir(join(wurzel, praefix), { withFileTypes: true })) {
        const relativ = praefix === "" ? eintrag.name : `${praefix}/${eintrag.name}`;
        if (eintrag.isDirectory()) aus.push(...(await dateienUnter(wurzel, relativ)));
        else if (eintrag.isFile()) aus.push(relativ);
    }
    return aus;
}

async function sha256Datei(pfad: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const stueck of createReadStream(pfad)) hash.update(stueck as Buffer);
    return hash.digest("hex");
}

/** Ein Ordner unter `TILE_ROOT`: für Nginx lesbar (0755), auch wenn die Umgebung eine strengere umask setzt. */
export async function kachelOrdner(pfad: string): Promise<void> {
    await mkdir(pfad, { recursive: true, mode: 0o755 });
    await chmod(pfad, 0o755);
}

/** Eine fertige Fassung für Nginx lesbar machen: Ordner 0755, Dateien 0644 (libvips und `mkdir` folgen sonst der umask). */
export async function lesbarFuerNginx(verzeichnis: string): Promise<void> {
    await chmod(verzeichnis, 0o755);
    for (const eintrag of await readdir(verzeichnis, { withFileTypes: true })) {
        const pfad = join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) await lesbarFuerNginx(pfad);
        else if (eintrag.isFile()) await chmod(pfad, 0o644);
    }
}

export async function existiert(pfad: string): Promise<boolean> {
    try {
        await stat(pfad);
        return true;
    } catch {
        return false;
    }
}

/** Der Manifest-Hash eines Revisionsverzeichnisses (wie `manifest_hash` in `raster-publish.sh`). */
export async function manifestHash(verzeichnis: string): Promise<{ hash: string; dateien: number }> {
    const dateien = (await dateienUnter(verzeichnis)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const gesamt = createHash("sha256");
    for (const datei of dateien) gesamt.update(`${await sha256Datei(join(verzeichnis, datei))}  ${datei}\n`);
    return { hash: gesamt.digest("hex"), dateien: dateien.length };
}

export function zeigerFuer(serie: string, manifest: string, maxNativeZoom: number): RasterPyramidPointer {
    return {
        schemaVersion: 1,
        series: serie,
        revision: manifest.slice(0, 12),
        manifest,
        format: "webp",
        tileSize: KARTENSERIE_KACHEL_PX,
        maxNativeZoom,
    };
}

/** Die Zeile des Zeigers, Schlüssel in der Reihenfolge des Handovers (byte-gleich mit `raster-publish.sh`). */
export function zeigerZeile(zeiger: RasterPyramidPointer): string {
    return `${JSON.stringify({
        schemaVersion: zeiger.schemaVersion,
        series: zeiger.series,
        revision: zeiger.revision,
        manifest: zeiger.manifest,
        format: zeiger.format,
        tileSize: zeiger.tileSize,
        maxNativeZoom: zeiger.maxNativeZoom,
    })}\n`;
}

/** Eine Datei atomar ersetzen: schreiben unter `.name.tmp`, dann umbenennen. */
export async function schreibeAtomar(pfad: string, inhalt: string): Promise<void> {
    const tmp = join(dirname(pfad), `.${basename(pfad)}.tmp`);
    await writeFile(tmp, inhalt, { mode: 0o644 });
    await rename(tmp, pfad);
}

export async function leseZeiger(tileRoot: string, serie: string): Promise<RasterPyramidPointer | null> {
    if (!istKartenserieKennung(serie)) return null;
    try {
        return readRasterPointer(JSON.parse(await readFile(join(tileRoot, serie, "current.json"), "utf8")), serie);
    } catch {
        return null;
    }
}

/** Die Fassungen auf der Platte, die neueste zuerst (nach dem Zeitpunkt des Verzeichnisses). */
export async function fassungenVon(tileRoot: string | undefined, serie: string): Promise<KartenserieFassung[]> {
    if (tileRoot === undefined || !istKartenserieKennung(serie)) return [];
    let eintraege;
    try {
        eintraege = await readdir(join(tileRoot, serie), { withFileTypes: true });
    } catch {
        return [];
    }
    const aktuell = (await leseZeiger(tileRoot, serie))?.revision;
    const liste: { revision: string; zeit: number }[] = [];
    for (const e of eintraege) {
        if (!e.isDirectory() || !REVISION.test(e.name)) continue;
        const s = await stat(join(tileRoot, serie, e.name));
        liste.push({ revision: e.name, zeit: s.mtimeMs });
    }
    return liste
        .sort((a, b) => b.zeit - a.zeit || a.revision.localeCompare(b.revision))
        .map(({ revision, zeit }) => ({
            revision,
            aktuell: revision === aktuell,
            seit: Number.isFinite(zeit) ? new Date(zeit).toISOString() : null,
        }));
}

/**
 * Der Zeiger einer Revision für den Rückweg: aus `<revision>.json` neben ihr, sonst nachgerechnet (Revisionen von
 * `raster-publish.sh` haben keinen). Die höchste Stufe ist das höchste Verzeichnis unter der Revision.
 */
export async function zeigerDerRevision(
    tileRoot: string,
    serie: string,
    revision: string,
): Promise<RasterPyramidPointer | null> {
    if (!istKartenserieKennung(serie) || !REVISION.test(revision)) return null;
    const verzeichnis = join(tileRoot, serie, revision);
    try {
        if (!(await stat(verzeichnis)).isDirectory()) return null;
    } catch {
        return null;
    }
    try {
        const neben = readRasterPointer(JSON.parse(await readFile(`${verzeichnis}.json`, "utf8")), serie);
        if (neben.revision === revision) return neben;
    } catch {
        // kein Zeiger daneben: nachrechnen
    }
    const { hash } = await manifestHash(verzeichnis);
    if (hash.slice(0, 12) !== revision) return null;
    const stufen = (await readdir(verzeichnis)).filter((n) => /^\d+$/u.test(n)).map(Number);
    return stufen.length === 0 ? null : zeigerFuer(serie, hash, Math.max(...stufen));
}

/** Auf eine Fassung umschalten: `current.json` atomar auf den Zeiger der Revision. */
export async function schalteUmAuf(tileRoot: string, zeiger: RasterPyramidPointer): Promise<void> {
    await schreibeAtomar(join(tileRoot, zeiger.series, "current.json"), zeigerZeile(zeiger));
}

/**
 * Behält die neue und die vorige Revision; weg kommt nur, was dieser Auftrag gebaut hat (Zeiger daneben). Revisionen von
 * `raster-publish.sh` haben keinen und bleiben stehen (dort räumt Claudios Werkzeug nach Frist).
 */
export async function raeumeRevisionenAuf(
    tileRoot: string,
    serie: string,
    behalten: (string | null)[],
): Promise<string[]> {
    const ordnerDerSerie = join(tileRoot, serie);
    const weg: string[] = [];
    for (const e of await readdir(ordnerDerSerie, { withFileTypes: true })) {
        if (!e.isDirectory() || !/^[0-9a-f]{12}$/u.test(e.name) || behalten.includes(e.name)) continue;
        if (!(await existiert(join(ordnerDerSerie, `${e.name}.json`)))) continue;
        await rm(join(ordnerDerSerie, e.name), { recursive: true, force: true });
        await rm(join(ordnerDerSerie, `${e.name}.json`), { force: true });
        weg.push(e.name);
    }
    return weg;
}
