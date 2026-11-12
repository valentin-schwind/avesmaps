import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
    KARTENSERIE_STUECK_BYTES,
    istKartenserieKennung,
    type KartenserieUpload,
    type KartenserieUploadZiel,
} from "@avesmaps3d/shared";

/**
 * Die Ablage der Kartenquellen (WI-0220 Schnitt 3; Vertrag mit Claudio 2026-10-18, seine Antwort §2):
 *
 *     <MAP_SOURCES_ROOT>/uploads/<uploadId>.part   die Bytes eines laufenden Uploads
 *     <MAP_SOURCES_ROOT>/uploads/<uploadId>.json   was angelegt wurde (Ziel, Größe, Kante, Person)
 *     <MAP_SOURCES_ROOT>/<serie>/<sha12>.png       die Quellen einer Serie, höchstens zwei (Neuzerlegung, Rückweg)
 *
 * - Ohne `MAP_SOURCES_ROOT` liegt die Ablage neben den Kacheln (`<TILE_ROOT>/../map-sources`); auf der Stage ergibt das genau
 *   `/srv/avesmaps3d/staging/shared/map-sources`. Nie im Repository, nie auf C: des Entwicklungsrechners außer unter `TILE_ROOT`.
 * - Ordner legen App und Auftrag beim ersten Gebrauch selbst an (`mode 0o750`): Dann stimmen Besitzer und Rechte von selbst. 🪤 Das gilt
 *   NUR hier unter `map-sources`; unter `TILE_ROOT` braucht Nginx 0755 (`kachelOrdner` in `fassungen.ts`).
 * - Ein Upload ohne Fortschritt seit 24 Stunden wird beim nächsten Anlegen weggeräumt.
 * - Die Originale gehen nicht in die Nachtsicherung (F2, Betreiber 2026-10-17: „wir haben die dateien sicher“).
 */

export const UPLOAD_FRIST_MS = 24 * 60 * 60 * 1000;
/** Freier Platz, der nach einem Upload bleiben muss (Claudio 2026-10-17: ein Dateisystem für alles, 294 GB). */
export const MIN_FREI_GB_VORGABE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export interface Ablage {
    wurzel: string;
    uploads: string;
}

/** Die Ablage aus der Umgebung; `undefined`, wenn weder `MAP_SOURCES_ROOT` noch `TILE_ROOT` gesetzt ist. */
export function ablageAus(env: NodeJS.ProcessEnv, tileRoot: string | undefined): Ablage | undefined {
    const gesetzt = env["MAP_SOURCES_ROOT"]?.trim();
    const wurzel = gesetzt ? resolve(gesetzt) : tileRoot ? resolve(tileRoot, "..", "map-sources") : undefined;
    return wurzel === undefined ? undefined : { wurzel, uploads: join(wurzel, "uploads") };
}

/** Die Grenze in Bytes aus `MAP_SERIES_MIN_FREE_GB` (Vorgabe 20). */
export function grenzeBytes(env: NodeJS.ProcessEnv): number {
    const gb = Number(env["MAP_SERIES_MIN_FREE_GB"] ?? MIN_FREI_GB_VORGABE);
    return (Number.isFinite(gb) && gb >= 0 ? gb : MIN_FREI_GB_VORGABE) * 1024 ** 3;
}

export async function ordner(pfad: string): Promise<void> {
    await mkdir(pfad, { recursive: true, mode: 0o750 });
}

/** Freier Platz des Dateisystems unter der Ablage (die Wurzel muss dafür noch nicht bestehen: der nächste vorhandene Elternordner). */
export async function freieBytes(pfad: string): Promise<number> {
    let ort = pfad;
    for (let i = 0; i < 32; i += 1) {
        try {
            const s = await statfs(ort);
            return s.bavail * s.bsize;
        } catch {
            const oben = dirname(ort);
            if (oben === ort) break;
            ort = oben;
        }
    }
    return 0;
}

/** Was zu einem Upload gespeichert ist; `empfangen` kommt nicht hierher, sondern aus der Größe der Teildatei. */
export interface UploadEintrag {
    uploadId: string;
    ziel: KartenserieUploadZiel;
    bytes: number;
    kante: number;
    personId: string;
    angelegt: string;
}

const teil = (ablage: Ablage, id: string) => join(ablage.uploads, `${id}.part`);
const eintrag = (ablage: Ablage, id: string) => join(ablage.uploads, `${id}.json`);

export async function legeUploadAn(ablage: Ablage, wert: UploadEintrag): Promise<void> {
    await ordner(ablage.uploads);
    await writeFile(teil(ablage, wert.uploadId), new Uint8Array(0), { mode: 0o640, flag: "wx" });
    await writeFile(eintrag(ablage, wert.uploadId), `${JSON.stringify(wert)}\n`, { mode: 0o640 });
}

export async function leseUpload(ablage: Ablage, id: string): Promise<UploadEintrag | undefined> {
    if (!UUID.test(id)) return undefined;
    try {
        return JSON.parse(await readFile(eintrag(ablage, id), "utf8")) as UploadEintrag;
    } catch {
        return undefined;
    }
}

export async function empfangen(ablage: Ablage, id: string): Promise<number> {
    try {
        return (await stat(teil(ablage, id))).size;
    } catch {
        return -1;
    }
}

export function uploadSicht(wert: UploadEintrag, bekommen: number): KartenserieUpload {
    return {
        uploadId: wert.uploadId,
        ziel: wert.ziel,
        bytes: wert.bytes,
        empfangen: Math.max(0, bekommen),
        kante: wert.kante,
        stueckBytes: KARTENSERIE_STUECK_BYTES,
        angelegt: wert.angelegt,
    };
}

/** Alle offenen Uploads (für das Lesemodell und für die Frage, ob eine Kennung schon unterwegs ist). */
export async function offeneUploads(ablage: Ablage): Promise<{ wert: UploadEintrag; bekommen: number }[]> {
    let namen: string[];
    try {
        namen = await readdir(ablage.uploads);
    } catch {
        return [];
    }
    const aus: { wert: UploadEintrag; bekommen: number }[] = [];
    for (const name of namen.filter((n) => n.endsWith(".json")).sort()) {
        const wert = await leseUpload(ablage, name.slice(0, -5));
        if (wert === undefined) continue;
        const bekommen = await empfangen(ablage, wert.uploadId);
        if (bekommen >= 0) aus.push({ wert, bekommen });
    }
    return aus;
}

/**
 * Ein Stück anhängen. Nur am Ende der Teildatei: Ein anderer Versatz heißt, der Browser weiß nicht, was angekommen ist; die Antwort
 * nennt den Stand, und er setzt dort fort.
 */
export async function haengeAn(
    ablage: Ablage,
    wert: UploadEintrag,
    versatz: number,
    stueck: Uint8Array,
): Promise<{ ok: true; empfangen: number } | { ok: false; empfangen: number }> {
    const bisher = await empfangen(ablage, wert.uploadId);
    if (bisher !== versatz || versatz + stueck.length > wert.bytes)
        return { ok: false, empfangen: Math.max(0, bisher) };
    await appendFile(teil(ablage, wert.uploadId), stueck);
    return { ok: true, empfangen: bisher + stueck.length };
}

/** Die ersten Bytes der Teildatei (Kopf des PNG). */
export async function kopfVon(ablage: Ablage, id: string, laenge = 33): Promise<Uint8Array> {
    const datei = await open(teil(ablage, id), "r");
    try {
        const puffer = new Uint8Array(laenge);
        const { bytesRead } = await datei.read(puffer, 0, laenge, 0);
        return puffer.subarray(0, bytesRead);
    } finally {
        await datei.close();
    }
}

/**
 * Den fertigen Upload an seine Serie übergeben: `<serie>/eingang-<uploadId>.png`. Den endgültigen Namen (`<sha12>.png`) gibt der
 * Auftrag, wenn er die Prüfsumme nachgerechnet hat.
 */
/** Benennt einen Eingang nach seiner Prüfsumme (`<sha12>.png`), wie es der Auftrag des Zerlegens tut, und hält die Zahl der Quellen klein. Für `ziel.art: "quelle"`, WI-0280. */
export async function legeQuelleAb(ablage: Ablage, serie: string, eingang: string): Promise<string> {
    const quellen = join(ablage.wurzel, serie);
    const hash = createHash("sha256");
    for await (const stueck of createReadStream(join(quellen, eingang), { highWaterMark: 4 * 1024 * 1024 })) {
        hash.update(stueck as Buffer);
    }
    const name = `${hash.digest("hex").slice(0, 12)}.png`;
    await rename(join(quellen, eingang), join(quellen, name));
    await raeumeQuellenAuf(quellen, name);
    return name;
}

export async function uebergib(ablage: Ablage, wert: UploadEintrag): Promise<string> {
    if (!istKartenserieKennung(wert.ziel.id)) throw new Error("Kennung");
    const ziel = join(ablage.wurzel, wert.ziel.id);
    await ordner(ziel);
    const name = `eingang-${wert.uploadId}.png`;
    await rename(teil(ablage, wert.uploadId), join(ziel, name));
    await rm(eintrag(ablage, wert.uploadId), { force: true });
    return name;
}

export async function verwirf(ablage: Ablage, id: string): Promise<void> {
    if (!UUID.test(id)) return;
    await rm(teil(ablage, id), { force: true });
    await rm(eintrag(ablage, id), { force: true });
}

/** Uploads ohne Fortschritt seit der Frist wegräumen; gibt zurück, wie viele es waren. */
export async function raeumeAuf(ablage: Ablage, jetzt: number): Promise<number> {
    let weg = 0;
    for (const { wert } of await offeneUploads(ablage)) {
        try {
            const zuletzt = (await stat(teil(ablage, wert.uploadId))).mtimeMs;
            if (jetzt - zuletzt > UPLOAD_FRIST_MS) {
                await verwirf(ablage, wert.uploadId);
                weg += 1;
            }
        } catch {
            // schon weg
        }
    }
    return weg;
}

export async function juengsteQuelle(quellen: string): Promise<string | undefined> {
    const pngs: { name: string; zeit: number }[] = [];
    for (const name of await readdir(quellen).catch(() => [] as string[])) {
        if (/^[0-9a-f]{12}.png$/u.test(name)) pngs.push({ name, zeit: (await stat(join(quellen, name))).mtimeMs });
    }
    return pngs.sort((a, b) => b.zeit - a.zeit)[0]?.name;
}

/** Höchstens zwei Quellen je Serie (WI-0220 §4.2): die neue und die jüngste davor. */
export async function raeumeQuellenAuf(quellen: string, neu: string): Promise<void> {
    const pngs: { name: string; zeit: number }[] = [];
    for (const name of await readdir(quellen)) {
        if (!/^[0-9a-f]{12}\.png$/u.test(name) || name === neu) continue;
        pngs.push({ name, zeit: (await stat(join(quellen, name))).mtimeMs });
    }
    for (const { name } of pngs.sort((a, b) => b.zeit - a.zeit).slice(1))
        await rm(join(quellen, name), { force: true });
}
