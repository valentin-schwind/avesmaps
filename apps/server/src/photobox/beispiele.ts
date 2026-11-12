import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_LIMITS,
    PHOTOBOX_TERMS_VERSION,
    PHOTOBOX_USAGE_GRANTS,
    photoboxGrantAllowed,
    type PhotoboxEinreichung,
} from "@avesmaps3d/shared";
import { AUTH_ENVIRONMENTS, type AuthEnvironment } from "../auth/config.ts";
import type { Database, Queryable } from "../database.ts";
import { settleAssetFiles } from "../media-editor/settle.ts";
import { zieheQuarantaeneNach } from "../media/quarantine.ts";
import { PUBLISHED_VARIANT } from "../media/roles.ts";
import type { MediaStore } from "../media/storage.ts";
import { technikNachziehen } from "./db.ts";
import { einreichen } from "./einreichen.ts";
import { gibFreiOhneKonto } from "./redaktion.ts";

/**
 * Die persistenten Beispielbilder (WI-0272 S4, Aufgabe 24): acht Reisebilder auf der Karte der Stage und des Release-Tests, damit Bündel, Fahnen, Leiste und Lizenznennung
 * dort zu sehen und zu prüfen sind. Sie laufen den echten Weg (Einreichen, Rechnen, Freigeben, Veröffentlichen) über `npm run photobox:beispiele`; erkennbar sind sie an
 * `media_submission.terms_version = 'beispielbild-1:<schlüssel>'`, ohne neue Spalte. Das Manifest (`config/photobox/beispiele.json`) und die Bilder (`config/photobox/beispiele/`)
 * liegen im Release, denn `config/` ist dort, `public/` nicht.
 *
 * - 🔴 **Nie in Production:** Das Kommando verweigert bei `AVESMAPS_ENV=production`, bei der Umgebung `production` und bei einer Datenbank, deren Name `production` enthält
 *   (`pruefeKeineProduktion`, die erste Handlung von {@link legeBeispieleAn}, also für jeden Aufrufer). Beispielbilder auf einer echten Karte wären falsche Bilder von echten Orten.
 * - **Wiederholbar:** Ein zweiter Lauf legt nichts Neues an. Eine Einreichung, die der erste Lauf nicht zu Ende brachte (Abbruch, fehlende Regel), führt der nächste zu Ende.
 *   Der Abzug aus Production verdeckt die Texte der Einreichungen; der Lauf setzt sie aus dem Manifest zurück.
 * - **Kartendaten bleiben unberührt:** Der Ort wird nur gelesen (aktiv, nicht verborgen, Name genau, bei mehreren der erste nach `public_id`); `map_mutation = false`.
 * - **Keine Glocke, kein Handelnder:** Die Einreichung läutet nicht (`glocke: false`), die Freigabe handelt als anonymer `photobox` (`gibFreiOhneKonto`) mit eigener Operationskennung,
 *   denn `media_operation` überlebt den Zug von Production. Der Statusschlüssel ist zufällig und wird verworfen: Niemand kann diese Einreichungen verändern.
 * - **Rechnen im Kommando**, mit der Rolle der Anwendung und sharp (wie `migrate:media-files`), nie im Fastify-Prozess. Öffentlich wird ein Bild nur mit der Freigaberegel der Rolle
 *   `photobox` (`npm run media:regeln`); ohne sie steht es in `unveroeffentlicht`.
 */

export const BEISPIEL_FASSUNG = "beispielbild-1";
/** Jede Beschreibung beginnt so: Die Oberfläche muss ein Beispiel auch im Text als solches erkennen. */
export const BEISPIEL_PRAEFIX = "Beispielbild:";
/** Die größte Datei eines Beispielbildes in Bytes (jedes Bild kommt in den Release). */
export const BEISPIEL_DATEI_MAX = 120 * 1024;

/** Die Zeitfalle des Formulars gilt hier nicht (kein Mensch tippt), aber das Einreichen verlangt eine Angabe in Millisekunden. */
const FALLE_DAUER_MS = 8000;

export const BEISPIEL_VERZEICHNIS = fileURLToPath(new URL("../../../../config/photobox/", import.meta.url));

const strict = { additionalProperties: false } as const;
const literals = <const T extends string>(values: readonly T[]) =>
    Type.Union(values.map((value) => Type.Literal(value)));

export const BeispielBild = Type.Object(
    {
        schluessel: Type.String({ pattern: "^[a-z0-9]+(-[a-z0-9]+)*$", maxLength: 40 }),
        /** Der Dateiname im Ordner `beispiele/`, nie ein Pfad. */
        datei: Type.String({ pattern: "^[a-z0-9][a-z0-9_-]*\\.webp$", maxLength: 80 }),
        /** Der Name des Ortes, von dem aus die Stelle gemessen wird (`place.name`, genau). */
        ort: Type.String({ minLength: 1, maxLength: 120 }),
        /** Die Stelle des Bildes: Lage des Ortes plus dieser Versatz, in Karteneinheiten. */
        versatz: Type.Tuple([Type.Number(), Type.Number()]),
        /** Nur ein gebundenes Bild hängt mit `place_id` an dem Ort (die Fahne am Ortsmarker); die übrigen stehen frei an ihrer Stelle. */
        gebunden: Type.Boolean(),
        beschreibung: Type.String({
            minLength: 1,
            maxLength: PHOTOBOX_LIMITS.descriptionMax,
            pattern: "^Beispielbild:",
        }),
        name: Type.Optional(Type.String({ minLength: 1, maxLength: PHOTOBOX_LIMITS.attributionMax })),
        entstehung: literals(PHOTOBOX_CREATION_KINDS),
        nutzung: literals(PHOTOBOX_USAGE_GRANTS),
        blickrichtung: Type.Optional(Type.Integer({ minimum: 0, maximum: PHOTOBOX_LIMITS.viewDirections - 1 })),
    },
    strict,
);
export type BeispielBild = Static<typeof BeispielBild>;

export const BeispielManifest = Type.Object(
    {
        fassung: Type.String({ pattern: "^beispielbild-[0-9]+$" }),
        bilder: Type.Array(BeispielBild, { minItems: 1, maxItems: 32 }),
    },
    strict,
);
export type BeispielManifest = Static<typeof BeispielManifest>;

/** Das gelesene Manifest samt dem Ordner seiner Bilder. */
export interface GeladeneBeispiele {
    manifest: BeispielManifest;
    /** Der Ordner mit den Bilddateien (`beispiele/`). */
    bilder: string;
}

/** Das Manifest lesen und prüfen (Form, eindeutige Schlüssel, keine Aufnahme aus Avesmaps unter CC BY); eine Datei, die fehlt, scheitert erst beim Lesen des Bildes. */
export async function ladeBeispiele(verzeichnis: string = BEISPIEL_VERZEICHNIS): Promise<GeladeneBeispiele> {
    const text = await readFile(`${verzeichnis.replace(/[\\/]+$/u, "")}/beispiele.json`, "utf8");
    const roh: unknown = JSON.parse(text);
    if (!Value.Check(BeispielManifest, roh)) {
        const erster = [...Value.Errors(BeispielManifest, roh)][0];
        throw new Error(`beispiele.json ist ungültig (${erster?.path ?? "?"}: ${erster?.message ?? "?"})`);
    }
    const schluessel = new Set<string>();
    for (const bild of roh.bilder) {
        if (schluessel.has(bild.schluessel))
            throw new Error(`beispiele.json: Schlüssel ${bild.schluessel} kommt doppelt vor`);
        schluessel.add(bild.schluessel);
        if (!photoboxGrantAllowed(bild.entstehung, bild.nutzung)) {
            throw new Error(`beispiele.json: ${bild.schluessel}: eine Aufnahme aus Avesmaps gibt es nicht unter CC BY`);
        }
    }
    return { manifest: roh, bilder: `${verzeichnis.replace(/[\\/]+$/u, "")}/beispiele` };
}

/** Das Kennzeichen einer Einreichung in `terms_version`: `beispielbild-1:gareth-1`. */
export const kennzeichen = (fassung: string, schluessel: string): string => `${fassung}:${schluessel}`;

export interface BeispielErgebnis {
    /** Neu angelegte Einreichungen dieses Laufs. */
    angelegt: number;
    /** Schon vorhandene (sie wurden, wo nötig, zu Ende geführt). */
    vorhanden: number;
    /** Die Namen der Orte, die es nicht gibt (aktiv, nicht verborgen): Die Bilder dazu entstehen nicht. */
    ohneOrt: string[];
    /** Die Schlüssel der Bilder, die nach dem Lauf nicht öffentlich sind (meist fehlt die Freigaberegel der Rolle `photobox`). */
    unveroeffentlicht: string[];
}

export interface BeispielOptionen {
    /** Ein anderes Manifest (die Tests); Vorgabe: `config/photobox/`. */
    beispiele?: GeladeneBeispiele;
    /** Die Umgebungsvariablen, aus denen die Production-Sperre liest; Vorgabe `process.env`. */
    env?: NodeJS.ProcessEnv;
}

/** Das Kommando läuft nicht gegen Production (siehe `pruefeKeineProduktion`). Der Satz ist für Menschen. */
export class ProduktionVerweigert extends Error {
    constructor(grund: string) {
        super(`Beispielbilder gibt es nie in Production: ${grund}`);
        this.name = "ProduktionVerweigert";
    }
}

/**
 * 🔴 Die Sperre: Production bekommt nie Beispielbilder. Sie greift bei `AVESMAPS_ENV=production`, bei der Umgebung `production` des Aufrufers und bei einer Datenbank, deren Name
 * `production` enthält. Wirft {@link ProduktionVerweigert}, bevor etwas gelesen oder geschrieben wird.
 */
export async function pruefeKeineProduktion(
    db: Queryable,
    umgebung: AuthEnvironment,
    env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
    if (env["AVESMAPS_ENV"]?.trim().toLowerCase() === "production") {
        throw new ProduktionVerweigert("AVESMAPS_ENV ist production.");
    }
    if (umgebung === "production") throw new ProduktionVerweigert("die Umgebung ist production.");
    const [zeile] = await db<{ name: string }[]>`SELECT current_database() AS name`;
    const name = zeile?.name ?? "";
    if (name.toLowerCase().includes("production")) {
        throw new ProduktionVerweigert(`die Datenbank „${name}“ gehört zu Production.`);
    }
}

/** Ist die Umgebung eine bekannte? (`AVESMAPS_ENV` des Aufrufs; sonst gilt die lokale Entwicklung.) */
export function umgebungAusEnv(env: NodeJS.ProcessEnv = process.env): AuthEnvironment {
    const genannt = env["AVESMAPS_ENV"];
    return (AUTH_ENVIRONMENTS as readonly string[]).includes(genannt ?? "")
        ? (genannt as AuthEnvironment)
        : "development";
}

interface EinreichungZeile {
    id: string;
    public_id: string;
    state: string;
    description: string | null;
    attribution_name: string | null;
    pending_description: string | null;
    editor_message: string | null;
    asset_id: string | null;
    asset_public_id: string | null;
}

/** Die Einreichung zum Kennzeichen samt ihrem aktuellen Asset (das des jüngsten Eingangs). */
async function findeEinreichung(db: Queryable, kennz: string): Promise<EinreichungZeile | undefined> {
    const [zeile] = await db<EinreichungZeile[]>`
        SELECT s.id::text AS id, s.public_id::text AS public_id, s.state, s.description, s.attribution_name, s.pending_description, s.editor_message,
               a.id::text AS asset_id, a.public_id::text AS asset_public_id
          FROM media_submission s
          LEFT JOIN LATERAL (
              SELECT a.id, a.public_id FROM media_ingest i JOIN media_asset a ON a.id = i.media_asset_id
               WHERE i.submission_id = s.id ORDER BY i.id DESC LIMIT 1
          ) a ON TRUE
         WHERE s.terms_version = ${kennz}
         ORDER BY s.id
         LIMIT 1
    `;
    return zeile;
}

/** Der Ort für ein Bild: nur gelesen, aktiv, nicht verborgen, Name genau, bei mehreren der erste nach `public_id`. */
async function liesOrt(db: Queryable, name: string): Promise<{ publicId: string; x: number; y: number } | undefined> {
    const [ort] = await db<{ public_id: string; x: number; y: number }[]>`
        SELECT p.public_id::text AS public_id, ST_X(p.geom) AS x, ST_Y(p.geom) AS y
          FROM place p
         WHERE p.name = ${name} AND p.is_active AND NOT p.is_hidden
         ORDER BY p.public_id
         LIMIT 1
    `;
    return ort === undefined ? undefined : { publicId: ort.public_id, x: ort.x, y: ort.y };
}

/** Liegt die öffentliche Fassung (Zeile UND Datei) und die Kachel vor? */
async function oeffentlichVollstaendig(db: Queryable, store: MediaStore, assetId: string): Promise<boolean> {
    const zeilen = await db<{ variant: string; storage_key: string }[]>`
        SELECT variant, storage_key FROM media_file WHERE media_asset_id = ${assetId}::bigint AND storage_class = 'published'
    `;
    for (const variante of [PUBLISHED_VARIANT.photobox, "photobox_kachel"]) {
        const zeile = zeilen.find((eintrag) => eintrag.variant === variante);
        if (zeile === undefined || !(await store.exists(zeile.storage_key))) return false;
    }
    return true;
}

/** Ist die Hauptfassung öffentlich (Zeile da)? Danach richtet sich `unveroeffentlicht`. */
async function hatHauptfassung(db: Queryable, assetId: string): Promise<boolean> {
    const [zeile] = await db<{ da: boolean }[]>`
        SELECT EXISTS (
            SELECT 1 FROM media_file WHERE media_asset_id = ${assetId}::bigint AND storage_class = 'published' AND variant = ${PUBLISHED_VARIANT.photobox}
        ) AS da
    `;
    return zeile?.da === true;
}

/**
 * Legt die Beispielbilder an oder führt sie zu Ende (siehe Kopf). Je Eintrag, erkannt am Kennzeichen:
 *
 * 1. Gibt es die Einreichung: die verdeckten Texte aus dem Manifest zurücksetzen; ist sie nicht fertig, dort weitermachen, wo sie stehen blieb.
 * 2. Sonst den Ort lesen (fehlt er: `ohneOrt`, weiter), mit `einreichen(…, { glocke: false })` einreichen (Zufallsschlüssel, der verworfen wird; das Kennzeichen steht gleich in
 *    `terms_version`), die Technik rechnen (`settleAssetFiles`), die Einreichung nachziehen (`technikNachziehen`), freigeben (`gibFreiOhneKonto`) und veröffentlichen
 *    (`settleAssetFiles`). Bleibt die Datei aus, steht der Schlüssel in `unveroeffentlicht`.
 */
export async function legeBeispieleAn(
    db: Database,
    store: MediaStore,
    umgebung: AuthEnvironment,
    optionen: BeispielOptionen = {},
): Promise<BeispielErgebnis> {
    await pruefeKeineProduktion(db, umgebung, optionen.env);
    const { manifest, bilder: ordner } = optionen.beispiele ?? (await ladeBeispiele());
    const ergebnis: BeispielErgebnis = { angelegt: 0, vorhanden: 0, ohneOrt: [], unveroeffentlicht: [] };

    for (const bild of manifest.bilder) {
        const kennz = kennzeichen(manifest.fassung, bild.schluessel);
        let zeile = await findeEinreichung(db, kennz);
        if (zeile !== undefined) {
            ergebnis.vorhanden += 1;
        } else {
            const ort = await liesOrt(db, bild.ort);
            if (ort === undefined) {
                if (!ergebnis.ohneOrt.includes(bild.ort)) ergebnis.ohneOrt.push(bild.ort);
                continue;
            }
            const bytes = await readFile(`${ordner}/${bild.datei}`);
            const body: PhotoboxEinreichung = {
                operationId: randomUUID(),
                // Zufällig und verworfen: Niemand kennt den Schlüssel dieser Statusseite, also kann niemand die Einreichung verändern.
                schluessel: randomBytes(32).toString("base64url"),
                bild: { name: bild.datei, dataBase64: bytes.toString("base64") },
                lage: { x: ort.x + bild.versatz[0], y: ort.y + bild.versatz[1] },
                ...(bild.gebunden ? { placeId: ort.publicId } : {}),
                ...(bild.blickrichtung === undefined ? {} : { blickrichtung: bild.blickrichtung }),
                entstehung: bild.entstehung,
                nutzung: bild.nutzung,
                beschreibung: bild.beschreibung,
                ...(bild.name === undefined ? {} : { name: bild.name }),
                bedingungen: PHOTOBOX_TERMS_VERSION,
                falle: { feld: "", dauerMs: FALLE_DAUER_MS },
            };
            await einreichen(db, store, umgebung, body, undefined, { glocke: false, kennzeichen: kennz });
            zeile = await findeEinreichung(db, kennz);
            if (zeile === undefined)
                throw new Error(`Beispielbild ${bild.schluessel}: die Einreichung ist nicht zu finden`);
            ergebnis.angelegt += 1;
        }

        // Die verdeckten Texte zurück (der Abzug aus Production verdeckt Beschreibung, Nennung, wartende Beschreibung und Nachricht der Redaktion).
        if (
            zeile.description !== bild.beschreibung ||
            zeile.attribution_name !== (bild.name ?? null) ||
            zeile.pending_description !== null ||
            zeile.editor_message !== null
        ) {
            await db`
                UPDATE media_submission
                   SET description = ${bild.beschreibung}, attribution_name = ${bild.name ?? null}, pending_description = NULL, editor_message = NULL
                 WHERE id = ${zeile.id}::bigint
            `;
        }

        if (zeile.asset_id === null || zeile.asset_public_id === null) continue;
        const asset = { id: zeile.asset_id, publicId: zeile.asset_public_id };
        // Weiter, wo die Einreichung steht: erst die Technik, dann (aus `incoming`/`pending`) die Freigabe, dann die öffentliche Fassung.
        if (zeile.state === "incoming" || zeile.state === "pending") {
            await settleAssetFiles(db, store, { assetPublicId: asset.publicId, role: "photobox" });
            await technikNachziehen(db, zeile.id);
            await gibFreiOhneKonto(db, umgebung, zeile.public_id);
            zeile = (await findeEinreichung(db, kennz)) ?? zeile;
        }
        if (zeile.state === "approved" && !(await oeffentlichVollstaendig(db, store, asset.id))) {
            await settleAssetFiles(db, store, { assetPublicId: asset.publicId, role: "photobox" });
        }
        if (!(await hatHauptfassung(db, asset.id))) ergebnis.unveroeffentlicht.push(bild.schluessel);
    }

    // Eine ausgeschaltete Art soll auch ihre neuen Dateien nicht unter `published/` stehen lassen (wie der Abgleich im Job); scheitert das, holt der Auftrag es nach.
    await zieheQuarantaeneNach(db, store).catch(() => null);
    return ergebnis;
}
