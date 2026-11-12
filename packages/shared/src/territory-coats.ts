import { Type, type Static } from "@sinclair/typebox";
import { MEDIA_PUBLIC_URL_PATTERN, mediaPublicUrl } from "./media.ts";
import { checkPointer, readPointer } from "./pointer-reading.ts";

/**
 * Welche Herrschaftsgebiete ein öffentliches Wappen tragen, und wo das Bild liegt (WI-0121).
 *
 * Die Karte setzt das Wappen an den Namen des Gebiets (Legacy: `region-label__coat`). Die Kachel der Namen
 * (`territory_label_render`) trägt die Kennung des Gebiets, aber kein Bild - und soll keines tragen: Ein Wappen ist ein
 * Medium (Media Core, WI-0063 26.8) mit eigener Freigabe, und die Kachelsicht an ihn zu hängen hieße, jede Entscheidung über
 * Rechte, Unterdrückung und Rückzug in eine Migration zu gießen (AGENTS.md: „Eine Renderansicht wird nie aus einer alten
 * Migration abgeschrieben“). Stattdessen liest die Karte EINMAL diese Liste, aus demselben Resolver und derselben
 * Entscheidung wie das Wappen im Infopanel (`resolveTerritoryCoats`, `media/policy.ts`), und baut sie in den Stil.
 *
 * 🔴 Die Antwort ist ein Vertrag: Server und Client prüfen ihn nach demselben Schema (`pointer-reading.ts`), der Server
 * streng (`parseTerritoryCoats`), der Client tolerant (`readTerritoryCoats`) - neue Felder kommen nur hinzu.
 */
export const TERRITORY_COATS_URL = "/api/territories/coats";

const UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

export const TerritoryCoats = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        /** `territory.public_id` → die Adresse des veröffentlichten Bildes (`/media/sha256/…webp`). Fehlt ein Gebiet, hat es kein öffentliches Wappen. */
        coats: Type.Record(Type.String({ pattern: UUID_PATTERN }), Type.String({ pattern: MEDIA_PUBLIC_URL_PATTERN }), {
            // Ohne das prüft TypeBox nur die Schlüssel, die das Muster trifft, und lässt jeden anderen durch.
            additionalProperties: false,
        }),
    },
    { $id: "TerritoryCoats", additionalProperties: false },
);

export type TerritoryCoats = Static<typeof TerritoryCoats>;

/** Streng: der Server prüft die Antwort, die er sendet. */
export function parseTerritoryCoats(candidate: unknown): TerritoryCoats {
    return checkPointer(TerritoryCoats, candidate, "Gebietswappenliste");
}

/** Tolerant: der Client liest die Liste und ignoriert Felder, die eine neuere Version des Servers dazugibt. */
export function readTerritoryCoats(candidate: unknown): TerritoryCoats {
    return readPointer(TerritoryCoats, candidate, "Gebietswappenliste");
}

/** Das Präfix der Bildnamen im Stil: `coat:<sha256>`. An ihm erkennt der Auflöser der Karte, wem ein fehlendes Bild gehört. */
export const COAT_IMAGE_PREFIX = "coat:";

const COAT_IMAGE_ID = /^coat:([0-9a-f]{64})$/;
const COAT_URL_SHA = /\/([0-9a-f]{64})\.webp$/;

/**
 * Der Bildname einer Adresse: `coat:<sha256>`. Ein Bild, ein Name - zwei Gebiete mit demselben Wappen teilen ihn, und die
 * Karte holt das Bild einmal. Eine Adresse, die nicht aus `mediaPublicUrl` stammt, hat keinen Namen.
 */
export function coatImageId(url: string): string | undefined {
    const sha = COAT_URL_SHA.exec(url)?.[1];
    return sha === undefined || mediaPublicUrl(sha) !== url ? undefined : `${COAT_IMAGE_PREFIX}${sha}`;
}

/** Die Adresse zu einem Bildnamen - nur zu einem, den `coatImageId` ausgeben kann. Alles andere bleibt unbeantwortet. */
export function coatImageUrl(imageId: string): string | undefined {
    const sha = COAT_IMAGE_ID.exec(imageId)?.[1];
    return sha === undefined ? undefined : mediaPublicUrl(sha);
}

/** Die Liste für den Stil: Kennung des Gebiets → Bildname. */
export function territoryCoatImages(coats: TerritoryCoats): Record<string, string> {
    const images: Record<string, string> = {};
    for (const [territoryId, url] of Object.entries(coats.coats)) {
        const id = coatImageId(url);
        if (id !== undefined) images[territoryId] = id;
    }
    return images;
}
