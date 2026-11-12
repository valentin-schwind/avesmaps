import {
    MEDIA_INSTAGRAM_URL_PATTERN,
    MEDIA_PUBLIC_URL_PATTERN,
    mediaInstagramUrl,
    mediaPublicUrl,
} from "@avesmaps3d/shared";
import { instagramKey, storageKey } from "./storage.ts";

/**
 * Die Übersetzung einer öffentlichen Medienadresse in einen Speicherschlüssel (WI-0063 MEDIA-M12,
 * `project-control/migration/contracts/media.yaml` → `storage.oeffentlich`).
 *
 * 🔴 Diese Funktion trifft KEINE Entscheidung darüber, was öffentlich ist. Die Entscheidung fällt beim Import
 * (`policy.ts`): eine Datei liegt nur dann unter `published/`, wenn `publish` galt. Der Auslieferweg bildet darum nur
 * `/media/…` auf `published/…` ab und kennt keinen zweiten Weg: Der Speicherschlüssel beginnt immer mit `published/`,
 * `private/source/`, `private/evidence/`, `master/`, `derivatives/` und `incoming/` sind von hier aus unerreichbar.
 *
 * 🔴 Hereinkommen darf nur die EINE Form des Vertrags (`MEDIA_PUBLIC_URL_PATTERN`), unverschlüsselt und kanonisch.
 * Alles andere - ein `..`-Segment, eine prozentkodierte oder doppelt kodierte Schreibweise, eine andere Endung, ein
 * Grossbuchstabe im Hash, ein Fach, das nicht zu seinem Hash passt - ergibt `undefined` und damit 404.
 *
 * Neben der WebP gibt es genau EINE zweite Form (WI-0268 C12b): die Instagram-Fassung `<hash>.ig.jpg` (`MEDIA_INSTAGRAM_URL_PATTERN`). Sie wird nur ausgeliefert, solange ihre WebP neben ihr liegt
 * (`companionKey`): eine Fassung ohne WebP ist eine Waise und hat keine Adresse.
 */

/** Die Form des Vertrags: so und nur so sieht eine öffentliche Medienadresse aus. */
const PUBLIC_URL = new RegExp(MEDIA_PUBLIC_URL_PATTERN);

/** Dieselbe Form mit Gruppen, um die beiden Fächer und den Hash zu lesen. */
const PUBLIC_URL_PARTS = /^\/media\/sha256\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.webp$/;

/** Dieselbe Form für die Instagram-Fassung, mit Gruppen. */
const INSTAGRAM_URL = new RegExp(MEDIA_INSTAGRAM_URL_PATTERN);
const INSTAGRAM_URL_PARTS = /^\/media\/sha256\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})\.ig\.jpg$/;

/** Der Medientyp einer veröffentlichten Datei. Es gibt genau einen (Migration 0064 prüft ihn als CHECK). */
export const PUBLISHED_MIME_TYPE = "image/webp";

/** Der Medientyp der Instagram-Fassung (Instagram nimmt über die Graph-Schnittstelle nur JPEG). */
export const INSTAGRAM_MIME_TYPE = "image/jpeg";

/**
 * Eine Revision gibt es nicht: die Adresse IST der Inhalt. Ein Jahr unveränderlich, wie eine Rasterkachel unter ihrer
 * Revision - neue Bytes ergeben eine neue Adresse (WI-0063 26.10, kein `?v=mtime`).
 */
export const MEDIA_IMMUTABLE = "public, max-age=31536000, immutable";

/** Der Pfad einer Anfrage ohne Abfrageteil, genau so, wie der Client ihn geschickt hat (nicht dekodiert). */
export function pathnameOf(url: string): string {
    const cut = url.search(/[?#]/);
    return cut === -1 ? url : url.slice(0, cut);
}

/** Eine gültige öffentliche Medienadresse: der Hash ihrer Bytes und der Schlüssel unter `published/`. */
export interface PublishedAddress {
    sha256: string;
    key: string;
    /** Der Medientyp, mit dem die Datei kommt. */
    mimeType: string;
    /** Nur bei der Instagram-Fassung: der Schlüssel der WebP, neben der sie liegen muss, um ausgeliefert zu werden. */
    companionKey?: string;
    /** Nur bei der Instagram-Fassung `"instagram"`: trennt den ETag von dem der WebP. */
    variant?: "instagram";
}

/**
 * Die angefragte veröffentlichte Datei, oder `undefined`, wenn die Adresse nicht genau die Form des Vertrags hat.
 * `pathname` ist der rohe Pfad der Anfrage, nicht ein dekodierter Routenparameter.
 */
export function publishedAddressForUrl(pathname: string): PublishedAddress | undefined {
    if (INSTAGRAM_URL.test(pathname)) return instagramAddressForUrl(pathname);
    if (!PUBLIC_URL.test(pathname)) return undefined;
    const parts = PUBLIC_URL_PARTS.exec(pathname);
    if (parts === null) return undefined;
    const [, first, second, sha256] = parts as unknown as [string, string, string, string];
    // Die beiden Fächer sind die ersten vier Zeichen des Hashes: eine Datei hat GENAU EINE Adresse.
    if (first !== sha256.slice(0, 2) || second !== sha256.slice(2, 4)) return undefined;
    // Gegenprobe gegen die Adressbildung selbst: was hereinkam, ist die kanonische Adresse dieses Hashes.
    if (mediaPublicUrl(sha256) !== pathname) return undefined;
    return { sha256, key: storageKey("published", sha256, "webp"), mimeType: PUBLISHED_MIME_TYPE };
}

/** Die Instagram-Fassung: dieselben Wächter wie für die WebP, der Schlüssel entsteht aus dem Hash, die WebP daneben ist die Bedingung. */
function instagramAddressForUrl(pathname: string): PublishedAddress | undefined {
    const parts = INSTAGRAM_URL_PARTS.exec(pathname);
    if (parts === null) return undefined;
    const [, first, second, sha256] = parts as unknown as [string, string, string, string];
    if (first !== sha256.slice(0, 2) || second !== sha256.slice(2, 4)) return undefined;
    if (mediaInstagramUrl(sha256) !== pathname) return undefined;
    return {
        sha256,
        key: instagramKey(sha256),
        mimeType: INSTAGRAM_MIME_TYPE,
        companionKey: storageKey("published", sha256, "webp"),
        variant: "instagram",
    };
}

/**
 * Der starke ETag einer veröffentlichten Datei: der Hash ihrer Bytes, und sonst nichts. Die Instagram-Fassung trägt denselben Hash wie ihre WebP, ist aber eine andere Darstellung unter einer anderen Adresse: Sie
 * hängt `-ig` an, damit keine bedingte Anfrage die eine mit dem Stand der anderen beantwortet.
 */
export function etagFor(sha256: string, variant?: "instagram"): string {
    return variant === "instagram" ? `"${sha256}-ig"` : `"${sha256}"`;
}

/**
 * Trifft `If-None-Match` unseren ETag? Der Browser schickt zurück, was er bekam; eine Liste und `*` sind erlaubt,
 * ein schwacher Vergleich (`W/"…"`) ebenso - bei einem inhaltsadressierten Namen ist beides dasselbe.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
    if (header === undefined) return false;
    return header.split(",").some((candidate) => {
        const value = candidate.trim();
        return value === "*" || value === etag || value === `W/${etag}`;
    });
}
