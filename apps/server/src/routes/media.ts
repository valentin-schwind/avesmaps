import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { etagFor, etagMatches, MEDIA_IMMUTABLE, pathnameOf, publishedAddressForUrl } from "../media/delivery.ts";
import { MediaStore, MediaStorageError } from "../media/storage.ts";

/**
 * Die Auslieferung der veröffentlichten Medien (WI-0063 MEDIA-M12, `media.yaml` → `storage`).
 *
 * 🔴 Diese Route ist NICHT, was Besucher auf Staging und Production sehen: dort zeigt Nginx `/media/` direkt auf
 * `shared/media/published/` und diese Route wird nie erreicht. Sie macht denselben Pfad, denselben Medientyp und
 * dieselben Cache-Zusagen, damit lokal ohne Nginx dasselbe gilt - genau wie `/tiles/raster/` (ADR-0004, ADR-0008).
 *
 * 🔴 **Nur `published/` wird ausgeliefert.** Was öffentlich ist, hat die Policy beim Import entschieden
 * (`media/policy.ts`): eine Datei liegt nur unter `published/`, wenn `publish` galt. Dieser Weg entscheidet es NICHT
 * zum zweiten Mal - er bildet `/media/sha256/…` auf `published/sha256/…` ab und kann nichts anderes adressieren.
 * `private/source/`, `private/evidence/`, `master/`, `derivatives/` und `incoming/` haben keine Adresse.
 *
 * Drei Schlösser hintereinander, und jedes allein genügt:
 * 1. `publishedAddressForUrl` nimmt nur die EINE Form des Vertrags am ROHEN Pfad an (kein `..`, keine Kodierung);
 * 2. der Schlüssel entsteht aus `storageKey("published", …)`, nicht aus der Anfrage;
 * 3. `MediaStore.locate` hält ihn unter der Wurzel, auch über eine Verknüpfung, und nimmt nur echte Dateien.
 *
 * Die zweite Form unter `/media/sha256/…` ist die Instagram-Fassung `<hash>.ig.jpg` (WI-0268 C12b, `image/jpeg`): Sie kommt nur, solange ihre WebP daneben liegt - eine Fassung ohne WebP (die WebP ging in
 * Quarantäne oder wurde gelöscht) ist ein 404, auch wenn die Datei noch auf der Platte läge. Dieselben Köpfe wie bei der WebP.
 */

const notFound = { error: { code: "not_found", message: "Diese Mediendatei gibt es nicht." } };

export const mediaRoutes: FastifyPluginAsync = async (app) => {
    const store = buildStore(app.config.mediaRoot, {
        warn: (message) => app.log.warn(message),
        error: (message) => app.log.error(message),
    });
    if (store) await warnIfTreeMissing(store, (message) => app.log.warn(message));

    // EINE Tür für alles unter /media/: der Wächter sitzt im Handler, nicht im Routenmuster, und jede andere Adresse
    // bekommt dieselbe Antwort wie eine unbekannte Datei - 404, ohne zu verraten, welche Ordner es gibt.
    app.get("/media/*", async (request, reply) => {
        if (!store) {
            return reply
                .code(503)
                .header("cache-control", "no-store")
                .send({
                    error: {
                        code: "media_not_configured",
                        message: "MEDIA_ROOT ist nicht konfiguriert; es werden keine Mediendateien ausgeliefert.",
                    },
                });
        }

        const address = publishedAddressForUrl(pathnameOf(request.url));
        if (!address) {
            return reply.code(404).header("cache-control", "no-store").send(notFound);
        }

        let located: { path: string; byteSize: number };
        try {
            located = await store.locate(address.key);
            // Die Instagram-Fassung nur neben ihrer WebP: ohne sie ist sie eine Waise und hat keine Adresse.
            if (address.companionKey !== undefined) await store.locate(address.companionKey);
        } catch (error) {
            if (!(error instanceof MediaStorageError)) throw error;
            // Ein Asset ohne Bytes kommt vor (`technical_state`), das ist kein Serverfehler, und es wird nicht geloggt.
            // Ein Wächterfall ist einer - er kommt ins Log, bekommt aber dieselbe Antwort: 404 verrät nichts.
            if (error.code !== "missing") request.log.warn({ err: error, key: address.key }, "Mediendatei abgewiesen");
            return reply.code(404).header("cache-control", "no-store").send(notFound);
        }

        // Erst wenn die Datei da ist: der ETag ist der Hash ihrer Bytes, die bedingte Anfrage spart ihre Übertragung.
        const etag = etagFor(address.sha256, address.variant);
        reply.header("etag", etag).header("cache-control", MEDIA_IMMUTABLE);
        if (etagMatches(request.headers["if-none-match"], etag)) {
            return reply.code(304).send();
        }

        return reply
            .header("content-type", address.mimeType)
            .header("content-length", located.byteSize)
            .header("x-content-type-options", "nosniff")
            .send(createReadStream(located.path));
    });
};

/**
 * Der Speicher, wenn `MEDIA_ROOT` brauchbar ist. Fehlt die Variable oder ist sie kein absoluter Pfad, startet der
 * Server trotzdem und sagt es EINMAL deutlich; jede Anfrage bekommt dann 503, nie ein stummes 404.
 */
function buildStore(
    mediaRoot: string | undefined,
    log: { warn(message: string): void; error(message: string): void },
): MediaStore | undefined {
    if (mediaRoot === undefined || mediaRoot.trim() === "") {
        log.warn(
            "MEDIA_ROOT ist nicht gesetzt: dieser Server liefert /media/ nicht aus (503), Wappen und Ortsbilder " +
                "bleiben leer. Lokal MEDIA_ROOT=C:\\avesmaps3d-data\\media setzen; auf Stage und Production ist es " +
                "unkritisch, solange Nginx /media/ selbst aus published/ ausliefert.",
        );
        return undefined;
    }
    try {
        return new MediaStore(mediaRoot);
    } catch (error) {
        log.error(
            `MEDIA_ROOT ist unbrauchbar (${error instanceof Error ? error.message : String(error)}): ` +
                "/media/ liefert keine Bilder aus (503).",
        );
        return undefined;
    }
}

/** Steht die Variable, fehlt aber der Baum, ist jedes Bild ein 404. Einmal gesagt ist besser als 2.484 stumme 404. */
async function warnIfTreeMissing(store: MediaStore, warn: (message: string) => void): Promise<void> {
    const published = join(store.root, "published");
    try {
        const info = await stat(published);
        if (!info.isDirectory()) warn(`${published} ist kein Verzeichnis: /media/ findet keine Dateien.`);
    } catch {
        warn(`${published} fehlt: /media/ antwortet auf jede Datei mit 404 (MEDIA_ROOT=${store.root}).`);
    }
}
