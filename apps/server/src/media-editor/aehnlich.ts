import type { Database, Queryable } from "../database.ts";
import { RASTER_LIMITS } from "../media/raster/limits.ts";
import { WAHRNEHMUNG_REZEPT, wahrnehmungsAbstand, wahrnehmungsHash } from "../media/raster/wahrnehmung.ts";
import type { MediaStore } from "../media/storage.ts";

/**
 * Ähnliche Bilder (WI-0068 D2): den Wahrnehmungs-Hash für den Bestand nachholen und die Abstände am Bestand messen, damit eine Schwelle je
 * Asset-Typ entschieden werden kann, BEVOR „ähnlich“ in der Oberfläche erscheint (Plan
 * `project-control/handovers/2026-10-11-medien-duplikate-bewertung.md` §1: „Kalibrieren vor dem Korb“).
 *
 * - **Nachholen** liest je Original ohne Hash die Bytes und schreibt NUR die Spalte `media_file.perceptual_hash`. Kein Rendern, keine
 *   Bindung, keine Veröffentlichung. Gilt für die Bytes ein Notaus, liest es sie nicht (Schutzregel wie `migrate:media-files`). Ein gelöschtes Original (`bytes_deleted_at`,
 *   WI-0275) hat keine Bytes und zählt nicht als offen.
 * - **Bericht** liest nur: je Asset-Typ die Verteilung der Abstände zwischen Originalen mit VERSCHIEDENEN Bytes und die nächsten Paare mit
 *   Namen. Bytegleiche Gruppen sind die Gegenprobe (ihr Abstand muss 0 sein). Aufgegangene Werke (D1) zählen nicht.
 */

/** Höchstgröße eines Originals beim Lesen: die Grenze der Pipeline (Raster 6 MiB, SVG kleiner). */
const LESEGRENZE = Math.max(RASTER_LIMITS.maxRasterBytes, RASTER_LIMITS.maxSvgBytes);

export interface NachholBericht {
    rezept: string;
    schreiben: boolean;
    /** Originale ohne Hash, die der Lauf angesehen hat. */
    offen: number;
    gerechnet: number;
    geschrieben: number;
    /** Ein Notaus gilt für die Bytes: nicht gelesen. */
    notaus: number;
    /** Datei fehlt oder ließ sich nicht lesen oder rechnen (je Asset die öffentliche Kennung und der Grund). */
    fehler: { asset: string; grund: string }[];
}

interface OffeneZeile {
    id: string;
    asset: string;
    storage_key: string;
    gehalten: boolean;
}

/** Den Hash für Originale ohne ihn nachholen; ohne `schreiben` nur rechnen. */
export async function holeWahrnehmungNach(
    database: Database,
    store: MediaStore,
    optionen: { schreiben: boolean; limit?: number | undefined },
): Promise<NachholBericht> {
    const zeilen = await database<OffeneZeile[]>`
        SELECT f.id::text AS id, a.public_id::text AS asset, f.storage_key,
               EXISTS (SELECT 1 FROM media_publication_suspension s WHERE s.source_sha256 = f.sha256 AND s.lifted_at IS NULL)
                   AS gehalten
          FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
         WHERE f.storage_class = 'private_source' AND f.perceptual_hash IS NULL AND f.bytes_deleted_at IS NULL
         ORDER BY f.id
         ${optionen.limit === undefined ? database`` : database`LIMIT ${optionen.limit}`}
    `;
    const bericht: NachholBericht = {
        rezept: WAHRNEHMUNG_REZEPT,
        schreiben: optionen.schreiben,
        offen: zeilen.length,
        gerechnet: 0,
        geschrieben: 0,
        notaus: 0,
        fehler: [],
    };
    for (const zeile of zeilen) {
        if (zeile.gehalten) {
            bericht.notaus += 1;
            continue;
        }
        let hash: string;
        try {
            hash = await wahrnehmungsHash(await store.read(zeile.storage_key, LESEGRENZE));
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            bericht.fehler.push({
                asset: zeile.asset,
                grund:
                    code === "ENOENT"
                        ? "Datei fehlt"
                        : error instanceof Error
                          ? error.message.slice(0, 120)
                          : "unbekannt",
            });
            continue;
        }
        bericht.gerechnet += 1;
        if (!optionen.schreiben) continue;
        // Nur, wo noch keiner steht: Ein Abgleich, der inzwischen rechnete, gewinnt.
        const geschrieben = await database`
            UPDATE media_file SET perceptual_hash = ${hash} WHERE id = ${zeile.id}::bigint AND perceptual_hash IS NULL
        `;
        bericht.geschrieben += geschrieben.count;
    }
    return bericht;
}

export interface AehnlichPaar {
    abstand: number;
    a: { id: string; titel: string | null; masse: string };
    b: { id: string; titel: string | null; masse: string };
}

export interface AehnlichTyp {
    typ: string;
    /** Originale mit Hash (ohne aufgegangene Werke). */
    werke: number;
    /** Verschiedene Bytes darunter (je SHA-256 einmal gezählt). */
    dateien: number;
    /** Die Gegenprobe: bytegleiche Gruppen und ihr größter Abstand (muss 0 sein). */
    bytegleich: { gruppen: number; groessterAbstand: number };
    /** Wie viele Paare verschiedener Bytes welchen Abstand haben, Index = Abstand 0 bis 64. */
    verteilung: number[];
    /** Die nächsten Paare verschiedener Bytes, aufsteigend nach Abstand. */
    naechste: AehnlichPaar[];
}

export interface AehnlichBericht {
    rezept: string;
    ohneHash: number;
    typen: AehnlichTyp[];
    /** Abstände ausdrücklich genannter Paare (Sollfälle, etwa Fasar in 128 und 2000 Pixeln). */
    paare: { a: string; b: string; abstand: number | null }[];
}

interface HashZeile {
    id: string;
    titel: string | null;
    typ: string;
    sha256: string;
    hash: string;
    breite: number | null;
    hoehe: number | null;
}

const masse = (zeile: HashZeile): string =>
    zeile.breite === null || zeile.hoehe === null ? "–" : `${String(zeile.breite)} × ${String(zeile.hoehe)}`;

/** Der Bericht zur Kalibrierung; liest nur. `naechste` begrenzt die Liste der nächsten Paare je Typ. */
export async function aehnlichkeitsBericht(
    db: Queryable,
    optionen: { naechste?: number; paare?: readonly (readonly [string, string])[] } = {},
): Promise<AehnlichBericht> {
    const zeilen = await db<HashZeile[]>`
        SELECT a.public_id::text AS id, a.title AS titel, coalesce(a.asset_type, a.media_kind) AS typ, f.sha256,
               f.perceptual_hash AS hash, f.width AS breite, f.height AS hoehe
          FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
         WHERE f.storage_class = 'private_source' AND f.perceptual_hash IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM media_merge m WHERE m.merged_asset_id = a.id AND m.lifted_at IS NULL)
         ORDER BY a.public_id
    `;
    const [ohne] = await db<{ n: number }[]>`
        SELECT count(*)::int AS n FROM media_file
         WHERE storage_class = 'private_source' AND perceptual_hash IS NULL AND bytes_deleted_at IS NULL
    `;
    const grenze = optionen.naechste ?? 40;
    const typen: AehnlichTyp[] = [];
    for (const typ of [...new Set(zeilen.map((zeile) => zeile.typ))].sort()) {
        const werke = zeilen.filter((zeile) => zeile.typ === typ);
        const jeDatei = new Map<string, HashZeile[]>();
        for (const werk of werke) jeDatei.set(werk.sha256, [...(jeDatei.get(werk.sha256) ?? []), werk]);
        let gruppen = 0;
        let groessterAbstand = 0;
        for (const gruppe of jeDatei.values()) {
            if (gruppe.length < 2) continue;
            gruppen += 1;
            for (const werk of gruppe) {
                groessterAbstand = Math.max(groessterAbstand, wahrnehmungsAbstand(gruppe[0]!.hash, werk.hash));
            }
        }
        const dateien = [...jeDatei.values()].map((gruppe) => gruppe[0]!);
        const verteilung = Array.from({ length: 65 }, () => 0);
        const naechste: AehnlichPaar[] = [];
        for (let i = 0; i < dateien.length; i += 1) {
            for (let j = i + 1; j < dateien.length; j += 1) {
                const a = dateien[i]!;
                const b = dateien[j]!;
                const abstand = wahrnehmungsAbstand(a.hash, b.hash);
                verteilung[abstand] = (verteilung[abstand] ?? 0) + 1;
                if (naechste.length < grenze || abstand < naechste[naechste.length - 1]!.abstand) {
                    naechste.push({
                        abstand,
                        a: { id: a.id, titel: a.titel, masse: masse(a) },
                        b: { id: b.id, titel: b.titel, masse: masse(b) },
                    });
                    naechste.sort((x, y) => x.abstand - y.abstand);
                    if (naechste.length > grenze) naechste.pop();
                }
            }
        }
        typen.push({
            typ,
            werke: werke.length,
            dateien: dateien.length,
            bytegleich: { gruppen, groessterAbstand },
            verteilung,
            naechste,
        });
    }
    const hashVon = new Map(zeilen.map((zeile) => [zeile.id, zeile.hash]));
    const paare = (optionen.paare ?? []).map(([a, b]) => {
        const ha = hashVon.get(a);
        const hb = hashVon.get(b);
        return { a, b, abstand: ha === undefined || hb === undefined ? null : wahrnehmungsAbstand(ha, hb) };
    });
    return { rezept: WAHRNEHMUNG_REZEPT, ohneHash: ohne?.n ?? 0, typen, paare };
}
