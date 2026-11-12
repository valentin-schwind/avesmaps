import { createHash, randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
    ApiErrorBody,
    COMMUNITY_DISCORD_BILDER_MAX_BYTES,
    COMMUNITY_DISCORD_BILD_MAX_BYTES,
    COMMUNITY_DISCORD_OFFEN_PFAD,
    COMMUNITY_DISCORD_RUMPF_GRENZE,
    COMMUNITY_DISCORD_SIGNATUR_KOPF,
    COMMUNITY_DISCORD_UEBERNAHME_GRENZE,
    COMMUNITY_DISCORD_UEBERNEHMEN_PFAD,
    COMMUNITY_DISCORD_ZEIT_KOPF,
    COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD,
    CommunityDiscordOffenAnfrage,
    CommunityDiscordOffenAntwort,
    CommunityDiscordUebernehmenAnfrage,
    CommunityDiscordUebernehmenAntwort,
    CommunityDiscordZurueckziehenAnfrage,
    CommunityDiscordZurueckziehenAntwort,
    brueckeSchluesselTaugt,
    comNummer,
    communityNachrichtAusDiscord,
    leseCom,
    pruefeSignatur,
} from "@avesmaps3d/shared";
import { CommunityFehler, ausDiscord, discordOffen, discordZurueckziehen } from "../community/db.ts";
import { zeileAus } from "../community/discord-zeilen.ts";
import { bezugAus } from "../community/discord-bezug.ts";
import { bestenfalls, neueMeldung } from "../community/glocke.ts";
import { rollenAmEingang } from "../community/rollen.ts";
import { dateiAblage } from "../community/mail/ablage.ts";
import { leseAblage } from "../community/mail/konfiguration.ts";
import { isNotProvisioned } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { RasterRejection, inspectImage } from "../media/raster/inspect.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";

/**
 * Die Production-Seite der Brücke für Website-Meldungen in Discord (WI-0268 C8; Fachkonzept `project-control/planning/community-fachkonzept.md` §8.3a, Betriebsvertrag
 * `project-control/handovers/2026-10-31-wi0268-c8-discord-bruecke-an-claudio.md`, Vertrag `packages/shared/src/community-discord.ts`). Der Bot lebt auf der Stage; er fragt hier nach den offenen
 * Meldungen einer Discord-Kennung und zieht eine eigene zurück (`apps/server/src/discord/community-bruecke.ts` ist sein Client).
 *
 *     POST /api/community/discord/offen            { discordId }           → { zeilen: [{ nummer, stand, kurztitel }] }, höchstens 20
 *     POST /api/community/discord/zurueckziehen    { discordId, nummer }   → { ergebnis: zurueckgezogen | nicht_gefunden | schon_abgeschlossen }
 *     POST /api/community/discord/uebernehmen      { operationId, ops, discordId, name, art, titel, text, bilder }   → { nummer }   (WI-0297, Grenze 9 MiB)
 *
 * - **Weiterleiten aus dem Kanal** (WI-0297; Vali 2026-11-09): Ein Betreiber leitet bei der Sichtung auf der Stage eine Meldung aus Discord an die Redaktion weiter. Hier entsteht seit WI-0297 Teil 3
 *   (gewählte Option vom 2026-11-10) eine MELDUNG mit Eingang `discord`, Objekt oder Stelle aus dem „Wo:“, wenn bekannt (`community/discord-bezug.ts`), und dem Melder mit Kennung (sein Rückweg:
 *   `/offen`, `/erledigt meldung:`); die Glocke zählt sie bei den Meldungen. Schreibklasse `community`.
 * - 🔴 **Nur mit dem Dienstschlüssel:** `COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL` (mindestens 32 Zeichen, Secret der Umgebung, nie in der Datenbank). Fehlt er oder ist er zu kurz, gibt es die zwei Wege nicht: dieselbe
 *   404 wie für jeden unbekannten Pfad, bevor ein Byte gelesen wird. Keine Sitzung, kein Cookie, kein Ursprung: Die Anfrage kommt von einem Dienst, nicht von einer Seite.
 * - 🔴 **Die Signatur gilt dem ROHEN Rumpf:** Dieses Plugin ersetzt den JSON-Leser durch einen, der die Bytes behält (Grenze 2 KiB); HMAC-SHA256 über `<zeit>\n<rumpf>`, höchstens 60 s alt (`pruefeSignatur`).
 *   Jede abgelehnte Anfrage bekommt dieselbe 401, ohne zu sagen, ob Schlüssel, Zeit oder Rumpf der Grund war; ins Protokoll kommt nur die Klasse des Urteils.
 * - **Grenzen** (nur im Speicher, gezählt erst nach der Signatur): 30 je Minute je Discord-Kennung (als Hash) und 300 je Minute insgesamt.
 * - 🔴 **Antworten streng nach dem Vertrag:** je Zeile Nummer, Stand und Kurztitel (Kategorie in Alltagssprache und Bezugsname); nie Meldetext, Name, Adresse oder Kennung. Das Antwortschema ist `additionalProperties: false`:
 *   Fastify lässt ein weiteres Feld gar nicht erst heraus. Ein Vorgang einer anderen Kennung ist `nicht_gefunden`, so wie ein unbekannter.
 * - 🔴 **Die Discord-Kennung steht in keiner Antwort, keinem Fehlertext, keinem Protokoll:** Das Protokoll trägt feste Schlüssel (Weg, Urteil, Ergebnis, Zahl der Zeilen).
 * - Schreibklassen: `offen` ist `public` (es liest nur), das Zurückziehen `community` (wie die Redaktion der Community); beide hängen an keiner Sperre (`system/write-guard.ts`).
 */

/** Wie viele Anfragen je Minute für EINE Discord-Kennung zugelassen sind. */
export const BRUECKE_GRENZE_JE_KENNUNG = 30;
/** Wie viele Anfragen je Minute insgesamt. */
export const BRUECKE_GRENZE_GESAMT = 300;
const MINUTE_MS = 60_000;

/** Der Dienstschlüssel dieser Umgebung, oder `undefined`: Dann gibt es die Brücke nicht. Bei jeder Anfrage gelesen (die Unit setzt ihn beim Start; Tests setzen ihn je Fall). */
function dienstSchluessel(): string | undefined {
    const wert = process.env["COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL"]?.trim();
    return brueckeSchluesselTaugt(wert) ? wert : undefined;
}

/** Ein kurzer Hash der Kennung für die Drossel: Die Kennung selbst steht nur im Speicher dieser Anfrage. */
const kennungHash = (kennung: string): string =>
    createHash("sha256").update(kennung, "utf8").digest("base64").slice(0, 16);

const FEHLER = { 400: ApiErrorBody, 401: ApiErrorBody, 429: ApiErrorBody, 503: ApiErrorBody };
const KOPF_ZEIT = COMMUNITY_DISCORD_ZEIT_KOPF.toLowerCase();
const KOPF_SIGNATUR = COMMUNITY_DISCORD_SIGNATUR_KOPF.toLowerCase();

export const communityBrueckeRoutes: FastifyPluginAsync = async (app) => {
    const jeKennung = createRateLimiter(BRUECKE_GRENZE_JE_KENNUNG, MINUTE_MS);
    const gesamt = createRateLimiter(BRUECKE_GRENZE_GESAMT, MINUTE_MS);

    // Ohne Schlüssel gibt es die zwei Wege nicht: dieselbe 404 wie für jeden unbekannten Pfad, bevor ein Byte gelesen wird.
    app.addHook("onRequest", async (_request, reply) => {
        if (dienstSchluessel() !== undefined) return;
        reply.callNotFound();
        return reply;
    });

    // 🔴 Der Rumpf bleibt Bytes: Die Signatur gilt für genau das, was die Stage sandte.
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
        "application/json",
        { parseAs: "buffer", bodyLimit: COMMUNITY_DISCORD_RUMPF_GRENZE },
        (_request, rumpf, fertig) => fertig(null, rumpf),
    );

    /** Prüft Signatur und Form des Rumpfes und die Grenzen; gibt die Anfrage zurück, sonst wirft es. */
    async function annehmen<S extends TSchema>(request: FastifyRequest, schema: S, weg: string): Promise<Static<S>> {
        const schluessel = dienstSchluessel();
        if (schluessel === undefined) throw new ApiError(404, "not_found", "Diesen Pfad gibt es nicht.");
        const rumpf = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        const urteil = await pruefeSignatur({
            schluessel,
            zeit: request.headers[KOPF_ZEIT],
            signatur: request.headers[KOPF_SIGNATUR],
            rumpf,
        });
        if (urteil !== "gueltig") {
            // Nur die Klasse des Urteils; nie Schlüssel, Rumpf, Signatur oder Kennung.
            request.log.info({ weg, urteil }, "Community-Brücke: Anfrage abgelehnt");
            throw new ApiError(401, "bruecke_nicht_zugelassen", "Die Anfrage ist nicht zugelassen.");
        }
        let roh: unknown;
        try {
            roh = JSON.parse(rumpf.toString("utf8"));
        } catch {
            throw new ApiError(400, "invalid_json", "Der Rumpf ist kein JSON.");
        }
        if (!Value.Check(schema, roh)) {
            throw new ApiError(400, "bruecke_anfrage_ungueltig", "Die Anfrage ist unvollständig oder falsch geformt.");
        }
        const anfrage = roh as Static<S>;
        // Ohne Kennung (eine Meldung aus dem Kanal ohne Discord-Kennung, WI-0297) zählt die Herkunft.
        const { discordId, ops } = anfrage as { discordId: string | null; ops?: string };
        const schluesselDerKennung = kennungHash(discordId ?? ops ?? "");
        if (!jeKennung.allows(schluesselDerKennung) || !gesamt.allows("alle")) {
            throw new ApiError(429, "bruecke_rate", "Zu viele Anfragen. Gleich noch einmal versuchen.", {
                retryAfterSeconds: 60,
            });
        }
        jeKennung.record(schluesselDerKennung);
        gesamt.record("alle");
        return anfrage;
    }

    /** Datenbank da und bereit: sonst 503 statt eines 500 (eine Instanz vor `migrate` oder `db-grants`). */
    async function mitDatenbank<T>(lauf: (db: NonNullable<typeof app.database>) => Promise<T>): Promise<T> {
        const db = app.database;
        if (db === undefined)
            throw new ApiError(503, "community_unavailable", "Die Community ist hier nicht eingerichtet.");
        try {
            return await lauf(db);
        } catch (fehler) {
            if (fehler instanceof CommunityFehler) throw new ApiError(422, fehler.code, fehler.message);
            if (isNotProvisioned(fehler))
                throw new ApiError(503, "community_unavailable", "Die Community ist hier nicht eingerichtet.");
            throw fehler;
        }
    }

    const konfig = <K extends "public" | "community">(writeClass: K) => ({
        auth: "public" as const,
        errorEnvelope: true as const,
        writeClass,
    });
    const keinZwischenspeicher = (reply: FastifyReply): void => void reply.header("cache-control", "no-store");

    app.post(
        COMMUNITY_DISCORD_OFFEN_PFAD,
        {
            config: konfig("public"),
            bodyLimit: COMMUNITY_DISCORD_RUMPF_GRENZE,
            schema: { response: { 200: CommunityDiscordOffenAntwort, ...FEHLER } },
        },
        async (request, reply) => {
            keinZwischenspeicher(reply);
            const { discordId } = await annehmen(request, CommunityDiscordOffenAnfrage, "offen");
            const zeilen = await mitDatenbank((db) => discordOffen(db, discordId));
            request.log.info({ weg: "offen", zeilen: zeilen.length }, "Community-Brücke: offen");
            return { zeilen: zeilen.map(zeileAus) };
        },
    );

    app.post(
        COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD,
        {
            config: konfig("community"),
            bodyLimit: COMMUNITY_DISCORD_RUMPF_GRENZE,
            schema: { response: { 200: CommunityDiscordZurueckziehenAntwort, ...FEHLER } },
        },
        async (request, reply) => {
            keinZwischenspeicher(reply);
            const { discordId, nummer } = await annehmen(
                request,
                CommunityDiscordZurueckziehenAnfrage,
                "zurueckziehen",
            );
            const id = leseCom(nummer);
            const ergebnis =
                id === undefined
                    ? ("nicht_gefunden" as const)
                    : await mitDatenbank((db) => discordZurueckziehen(db, randomUUID(), discordId, id));
            request.log.info({ weg: "zurueckziehen", ergebnis }, "Community-Brücke: zurückziehen");
            return { ergebnis };
        },
    );

    // An die Community weiterleiten (WI-0297): eine Meldung aus dem Kanal der Stage wird eine Meldung der Redaktion mit Eingang `discord`. Die Bilder prüft diese
    // Seite selbst (nur WebP, Grenzen je Bild und zusammen) und legt sie in die Ablage, bevor die Datenbank sie kennt.
    app.post(
        COMMUNITY_DISCORD_UEBERNEHMEN_PFAD,
        {
            config: konfig("community"),
            bodyLimit: COMMUNITY_DISCORD_UEBERNAHME_GRENZE,
            schema: { response: { 200: CommunityDiscordUebernehmenAntwort, ...FEHLER } },
        },
        async (request, reply) => {
            keinZwischenspeicher(reply);
            const anfrage = await annehmen(request, CommunityDiscordUebernehmenAnfrage, "uebernehmen");
            const bilder = await bilderAblegen(anfrage.bilder);
            const umgebung = app.authConfig?.environment;
            const id = await mitDatenbank((db) =>
                db.begin(async (tx) => {
                    const angelegt = await ausDiscord(tx, {
                        operationId: anfrage.operationId,
                        text: communityNachrichtAusDiscord(anfrage.titel, anfrage.text),
                        name: anfrage.name,
                        discordId: anfrage.discordId,
                        ops: anfrage.ops,
                        bilder,
                        bezug: await bezugAus(tx, anfrage.text),
                    });
                    // Eine Meldung wie vom Meldeformular: Die Glocke zählt sie bei den Meldungen (gebündelt, an alle, die Meldungen bearbeiten).
                    if (umgebung !== undefined) {
                        await bestenfalls(tx, request.log, "Meldung aus dem Kanal", (q) =>
                            neueMeldung(q, umgebung, angelegt),
                        );
                        // Wie jeder Eingang einer Meldung (WI-0279): Avesmaps setzt die passenden Sonderrollen, wenn jemand sie hat.
                        await rollenAmEingang(tx, request.log, umgebung, angelegt);
                    }
                    return angelegt;
                }),
            );
            request.log.info({ weg: "uebernehmen", bilder: bilder.length }, "Community-Brücke: übernommen");
            return { nummer: comNummer(id) };
        },
    );
};

/** Prüft die Bilder einer Weiterleitung (nur WebP, je Bild und zusammen in den Grenzen) und legt sie in die Ablage; gibt ihre Zeilen für die Datenbank zurück. */
async function bilderAblegen(
    roh: readonly { daten: string }[],
): Promise<{ datei: string; name: string; mime: string; groesse: number }[]> {
    if (roh.length === 0) return [];
    const ungueltig = (): ApiError =>
        new ApiError(400, "bruecke_anfrage_ungueltig", "Die Anfrage ist unvollständig oder falsch geformt.");
    const verzeichnis = leseAblage(process.env);
    if (verzeichnis === undefined)
        throw new ApiError(503, "community_unavailable", "Die Ablage der Community ist hier nicht eingerichtet.");
    const ablage = dateiAblage(verzeichnis);
    const geprueft: Buffer[] = [];
    let summe = 0;
    for (const bild of roh) {
        const bytes = Buffer.from(bild.daten, "base64");
        summe += bytes.length;
        if (bytes.length > COMMUNITY_DISCORD_BILD_MAX_BYTES || summe > COMMUNITY_DISCORD_BILDER_MAX_BYTES)
            throw ungueltig();
        try {
            if (inspectImage(bytes).format !== "webp") throw ungueltig();
        } catch (fehler) {
            if (fehler instanceof RasterRejection) throw ungueltig();
            throw fehler;
        }
        geprueft.push(bytes);
    }
    const zeilen: { datei: string; name: string; mime: string; groesse: number }[] = [];
    for (const [i, bytes] of geprueft.entries()) {
        zeilen.push({
            datei: await ablage.schreibe(bytes),
            name: `bild-${String(i + 1)}.webp`,
            mime: "image/webp",
            groesse: bytes.length,
        });
    }
    return zeilen;
}
