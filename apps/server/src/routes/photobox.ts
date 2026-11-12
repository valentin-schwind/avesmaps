import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    ApiErrorBody,
    PHOTOBOX_EINREICHEN_SCHALTER,
    PHOTOBOX_GRENZEN,
    PHOTOBOX_URL,
    PhotoboxBeschreibung,
    PhotoboxBildErsetzen,
    PhotoboxEingegangen,
    PhotoboxEinreichung,
    PhotoboxGefaelltAntwort,
    PhotoboxGefaelltBody,
    PhotoboxGefaelltParams,
    PhotoboxNutzung,
    PhotoboxOffline,
    PhotoboxStand,
    PhotoboxStatus,
    PhotoboxStatusBody,
    PhotoboxZurueckziehen,
} from "@avesmaps3d/shared";
import type { FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import { ADMIN_ERRORS, noStore } from "../auth/admin-guard.ts";
import type { AuthEnvironment } from "../auth/config.ts";
import { sameOriginRequest } from "../auth/plugin.ts";
import { isNotProvisioned, type Database } from "../database.ts";
import { ApiError, apiErrorBody } from "../http/api-error.ts";
import { nichtGefunden, photoboxBereit } from "../photobox/db.ts";
import { einreichen } from "../photobox/einreichen.ts";
import { reisebildGefaellt } from "../photobox/gefaellt.ts";
import {
    beschreibungSetzen,
    bildErsetzen,
    nutzungSetzen,
    offlineNehmen,
    statusLesen,
    vorschauLesen,
    zurueckziehen,
} from "../photobox/status.ts";
import { createRateLimiter, type RateLimiter } from "../share/rate-limiter.ts";
import { istAus } from "../system/inhaltsstand.ts";
import { storeOf } from "./media-editor-operations.ts";

/**
 * Die öffentlichen Routen der Reisebilder (WI-0272 S2, §12/§13): ein Reisebild einreichen und die Statusseite des Einreichers, alles ohne Konto.
 * Die Regeln (Prüfung des Bildes, Übergänge, Idempotenz, Protokoll) stehen in `photobox/`; hier sind Herkunft, Drossel, Falle und Schalter.
 *
 *     GET  /api/photobox/stand                       nimmt der Server Einreichungen an?
 *     POST /api/photobox/einreichungen               ein Reisebild einreichen (201 `{ ok: true }`)
 *     POST /api/photobox/status                      der Stand der Einreichung zum Schlüssel (`PhotoboxStatus`)
 *     POST /api/photobox/status/vorschau             die interne Vorschau (`image/webp`), solange sie fehlt 404
 *     POST /api/photobox/status/beschreibung         Beschreibung ändern (nach der Freigabe wartet sie auf Prüfung)
 *     POST /api/photobox/status/bild                 Bild ersetzen (vor der Freigabe)
 *     POST /api/photobox/status/zurueckziehen        zurückziehen (vor der Freigabe)
 *     POST /api/photobox/status/offline              offline nehmen (nach der Freigabe, nicht rückgängig)
 *     POST /api/photobox/status/nutzung              Lizenzwahl ändern (nach der Freigabe nur zu CC BY)
 *     POST /api/photobox/reisebilder/:id/gefaellt    „Gefällt mir“ setzen (`delta` 1) oder zurücknehmen (-1); nur die Zahl (WI-0304, wie die Bewertungen)
 *
 * - 🔴 **Der Schlüssel der Statusseite** (32 Zufallsbytes, nur beim Einreicher) steht im Rumpf, nie in der Adresse, und in keiner Logzeile, keiner
 *   Fehlermeldung und keiner Antwort. In der Datenbank liegt nur sein Hash. Ein falscher Schlüssel antwortet immer mit demselben 404-Satz.
 * - 🔴 **Missbrauch:** Honigtopf und Zeitfalle verwerfen still (201, KEINE Einreichung). Die Drossel zählt je Adresse und Stunde sowie insgesamt je
 *   Tag (Einreichungen und Bildersetzungen) und je Adresse und Stunde (Statusseite: Aktionen, `/status`, `/status/vorschau`), nur im Speicher und mit
 *   gehashter Adresse, nie gespeichert.
 *   - 🔴 **Reihenfolge beim Einreichen** (Review C1): Schalter, Drossel, Honigtopf und Zeitfalle, Arbeit. Ein Fallen-Treffer zählt in die Drossel der
 *     Adresse (nicht ins Tagesbudget) und bleibt 201; über der Grenze ist auch er 429.
 *   - 🔴 **Gezählt wird beim Eintritt** (Review C2), nicht nach dem Erfolg: Prüfen und Zählen liegen ohne `await` dazwischen, und auch ein Versuch, der
 *     danach scheitert (kaputtes Bild, 409, 422, falscher Schlüssel), hat gezählt. Sonst gingen gleichzeitige Anfragen derselben Adresse alle durch.
 *   - Die Drossel sitzt im `onRequest`, also VOR dem Lesen des Rumpfs (bis 9 MiB): Eine gedrosselte Anfrage kostet weder JSON noch Schema noch Datenbank.
 *   Ist der Schalter `photobox.submissions` aus, antwortet das Einreichen 503 `photobox_paused`; bereits Eingereichtes bleibt bedienbar.
 * - 🪤 `request.ip` stimmt nur, weil die App allein dem Proxy auf derselben Maschine traut (`trustProxy: "loopback"`, `app.ts`).
 * - Schreibklasse `public`: Der Eingang hängt an keiner Sperre (`system/write-guard.ts`); Kartendaten schreibt nichts hiervon.
 */

const NICHT_BEREIT =
    "Reisebilder sind auf dieser Instanz noch nicht eingerichtet: eine Migration oder ein Recht fehlt.";

const FEHLER = { ...ADMIN_ERRORS, 422: ApiErrorBody, 429: ApiErrorBody };

/** Ein kurzer Hash der Adresse für die Drossel: Die Adresse selbst wird nirgends gehalten (wie `community.ts`, `besuch.ts`). */
const adresse = (ip: string): string => createHash("sha256").update(ip).digest("base64").slice(0, 16);

const zuViele = (): ApiError =>
    new ApiError(429, "photobox_rate", "Gerade sind zu viele Anfragen eingegangen. Später geht es wieder.", {
        reason: "drossel",
        retryAfterSeconds: 3600,
    });

/** Ein Platz in einer Drossel: der Zähler und der Schlüssel darin. */
type Platz = readonly [RateLimiter, string];

/**
 * Prüft alle Drosseln und zählt dann in allen (sonst nichts), OHNE `await` dazwischen: In einem einzigen Schritt des Event-Loops sehen gleichzeitige
 * Anfragen den Stand der vorigen (Review C2). `nurPruefen` fragt nur (der Platz wird später gezählt).
 */
function nimmPlatz(zaehlen: readonly Platz[], nurPruefen: readonly Platz[] = []): void {
    if (![...zaehlen, ...nurPruefen].every(([drossel, key]) => drossel.allows(key))) throw zuViele();
    for (const [drossel, key] of zaehlen) drossel.record(key);
}

/** Nur von der eigenen Seite (Origin passt zur öffentlichen Adresse bzw. zum Host): eine fremde Seite soll hier nichts einwerfen. */
function nurEigeneSeite(app: FastifyInstance): onRequestAsyncHookHandler {
    return async (request, reply) => {
        void reply.header("cache-control", "no-store");
        if (!sameOriginRequest(request, app.authConfig)) {
            return reply
                .code(403)
                .send(apiErrorBody("forbidden_origin", "Diese Anfrage muss von Avesmaps selbst kommen."));
        }
    };
}

/** Schema oder Recht fehlt noch (der Korridor startet Fastify vor `migrate`): 503 statt 500. */
async function uebersetzt<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (fehler) {
        if (isNotProvisioned(fehler)) throw new ApiError(503, "photobox_unavailable", NICHT_BEREIT);
        throw fehler;
    }
}

export const photoboxRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    const db = (): Database => {
        if (app.database === undefined) throw new ApiError(503, "photobox_unavailable", NICHT_BEREIT);
        return app.database;
    };
    /** Die Umgebung des Protokolls; ohne eingerichtete Anmeldung gibt es keine, und ohne sie schreibt das Protokoll nichts. */
    const umgebung = (): AuthEnvironment => {
        const gesetzt = app.authConfig.environment;
        if (gesetzt === undefined) throw new ApiError(503, "photobox_unavailable", NICHT_BEREIT);
        return gesetzt;
    };

    // Die Drossel lebt im Speicher dieser Instanz und wird nie gespeichert.
    const jeStunde = createRateLimiter(PHOTOBOX_GRENZEN.jeAdresseJeStunde, 3_600_000);
    const jeTag = createRateLimiter(PHOTOBOX_GRENZEN.jeTag, 86_400_000);
    const statusJeStunde = createRateLimiter(PHOTOBOX_GRENZEN.statusJeStunde, 3_600_000);
    const lesenJeStunde = createRateLimiter(PHOTOBOX_GRENZEN.statusLesenJeStunde, 3_600_000);
    const gefaelltJeStunde = createRateLimiter(PHOTOBOX_GRENZEN.gefaelltJeAdresseJeStunde, 3_600_000);

    /**
     * Der Schalter „Einreichungen annehmen“ (`photobox.submissions`): gelesen wird der Stand aus dem Speicher der Anwendung, nicht je Anfrage aus
     * der Datenbank. Ohne Speicher der Schalter (ohne Datenbank) gilt er nicht.
     */
    const einreichenAus = async (): Promise<boolean> => {
        const store = app.inhaltsschalter;
        return store !== undefined && istAus(await store.read(), PHOTOBOX_EINREICHEN_SCHALTER);
    };

    const herkunft = nurEigeneSeite(app);
    /** Eine Stufe vor dem Lesen des Rumpfs: erst die Herkunft, dann die Drossel der Route (`stufe`). */
    const oeffentlich = (stufe: onRequestAsyncHookHandler) => ({
        config: { auth: "public" as const, writeClass: "public" as const, errorEnvelope: true as const },
        bodyLimit: PHOTOBOX_GRENZEN.rumpfBytes,
        onRequest: [herkunft, stufe],
    });
    /** Die Aktionen der Statusseite teilen sich die Statusdrossel der Adresse. */
    const statusStufe: onRequestAsyncHookHandler = async (request) => {
        nimmPlatz([[statusJeStunde, adresse(request.ip)]]);
    };
    /** Lesen der Statusseite (`/status`, `/status/vorschau`): eine eigene, weitere Drossel, damit Aufruf und Vorschau keine Aktion verbrauchen. */
    const lesenStufe: onRequestAsyncHookHandler = async (request) => {
        nimmPlatz([[lesenJeStunde, adresse(request.ip)]]);
    };
    /**
     * Bild ersetzen zählt wie eine Einreichung (Review I2): gegen die Grenze der Adresse und die Statusdrossel beim Eintritt. Das Tagesbudget
     * aller wird hier nur geprüft und erst nach dem Erfolg gezählt: Es begrenzt den Speicher, und ein gescheiterter Versuch belegt keinen; so
     * sperren wertlose Anfragen weniger Adressen das Formular nicht für alle.
     */
    const ersetzenStufe: onRequestAsyncHookHandler = async (request) => {
        const key = adresse(request.ip);
        nimmPlatz(
            [
                [statusJeStunde, key],
                [jeStunde, key],
            ],
            [[jeTag, "alle"]],
        );
    };
    /**
     * Einreichen: erst der Schalter, dann die Drossel der Adresse (jeder Versuch zählt, auch ein Fallen-Treffer). Das Tagesbudget wird nur
     * geprüft; gezählt wird es nach der Falle in der Route, denn ein Treffer verbraucht keinen Speicher.
     */
    const einreichenStufe: onRequestAsyncHookHandler = async (request) => {
        if (await einreichenAus()) {
            throw new ApiError(
                503,
                "photobox_paused",
                "Reisebilder werden gerade nicht angenommen. Bitte später noch einmal versuchen.",
            );
        }
        nimmPlatz([[jeStunde, adresse(request.ip)]], [[jeTag, "alle"]]);
    };

    /** „Gefällt mir“: eine eigene Drossel je Adresse (nur im Speicher), beim Eintritt gezählt; sie verbraucht weder Einreichungen noch die Statusseite. */
    const gefaelltStufe: onRequestAsyncHookHandler = async (request) => {
        nimmPlatz([[gefaelltJeStunde, adresse(request.ip)]]);
    };

    app.get(
        `${PHOTOBOX_URL}/stand`,
        {
            config: { auth: "public", errorEnvelope: true },
            schema: { response: { 200: PhotoboxStand, 503: ApiErrorBody } },
            onRequest: async (_request, reply) => {
                void reply.header("cache-control", "no-store");
            },
        },
        async () => {
            if (app.database === undefined || (await einreichenAus())) return { einreichen: false };
            // Fehlt die Tafel oder das Recht, geht das Formular nicht; das ist ein Stand, kein Fehler.
            return { einreichen: await photoboxBereit(app.database) };
        },
    );

    app.post(
        `${PHOTOBOX_URL}/einreichungen`,
        {
            ...oeffentlich(einreichenStufe),
            schema: { body: PhotoboxEinreichung, response: { 201: PhotoboxEingegangen, ...FEHLER } },
        },
        async (request, reply) => {
            const body = request.body;
            // Honigtopf (ein Feld, das ein Mensch nie sieht) und Zeitfalle (schneller als ein Mensch tippt): still verwerfen. Der Bot sieht einen
            // Erfolg, es entsteht nichts. Der Treffer hat in der Stufe davor schon in der Drossel der Adresse gezählt, das Tagesbudget bleibt unberührt.
            if (body.falle.feld.trim() !== "" || body.falle.dauerMs < PHOTOBOX_GRENZEN.mindestDauerMs) {
                request.log.info("Reisebild: Einreichung von der Falle verworfen");
                return reply.code(201).send({ ok: true });
            }
            // Das Tagesbudget aller begrenzt den Speicher: geprüft vor dem ersten `await`, gezählt erst nach dem Erfolg (ein gescheiterter Versuch
            // belegt nichts). Gleichzeitige Anfragen können es um wenige überschreiten; die Drossel je Adresse hat beim Eintritt schon gezählt.
            if (!jeTag.allows("alle")) throw zuViele();
            await uebersetzt(async () => einreichen(db(), storeOf(app), umgebung(), body, request.log));
            jeTag.record("alle");
            return reply.code(201).send({ ok: true });
        },
    );

    app.post(
        `${PHOTOBOX_URL}/status`,
        {
            ...oeffentlich(lesenStufe),
            schema: { body: PhotoboxStatusBody, response: { 200: PhotoboxStatus, ...FEHLER } },
        },
        async (request) => {
            const status = await uebersetzt(() => statusLesen(db(), request.body.schluessel));
            if (status === null) throw nichtGefunden();
            return status;
        },
    );

    app.post(
        `${PHOTOBOX_URL}/status/vorschau`,
        // Keine Antwortform: die Antwort sind rohe Bytes (`image/webp`), kein JSON.
        { ...oeffentlich(lesenStufe), schema: { body: PhotoboxStatusBody } },
        async (request, reply) => {
            const bytes = await uebersetzt(() => vorschauLesen(db(), storeOf(app), request.body.schluessel));
            return reply.type("image/webp").send(bytes);
        },
    );

    /**
     * Eine Statusaktion; die Drossel hat sie schon beim Eintritt gezählt (`statusStufe`, bei `bild` `ersetzenStufe`). Die Antwort ist der neue Stand der
     * Einreichung, damit die Seite ohne zweite Anfrage weiß, wo sie steht.
     */
    async function alsEinreicher(schluessel: string, lauf: () => Promise<void>): Promise<PhotoboxStatus> {
        await uebersetzt(lauf);
        const status = await uebersetzt(() => statusLesen(db(), schluessel));
        if (status === null) throw nichtGefunden();
        return status;
    }

    const aktion = { response: { 200: PhotoboxStatus, ...FEHLER } };

    app.post(
        `${PHOTOBOX_URL}/status/beschreibung`,
        { ...oeffentlich(statusStufe), schema: { body: PhotoboxBeschreibung, ...aktion } },
        async (request) =>
            alsEinreicher(request.body.schluessel, () =>
                beschreibungSetzen(db(), umgebung(), request.body, request.log),
            ),
    );

    app.post(
        `${PHOTOBOX_URL}/status/bild`,
        { ...oeffentlich(ersetzenStufe), schema: { body: PhotoboxBildErsetzen, ...aktion } },
        async (request) => {
            const status = await alsEinreicher(request.body.schluessel, () =>
                bildErsetzen(db(), storeOf(app), umgebung(), request.body, request.log),
            );
            jeTag.record("alle");
            return status;
        },
    );

    app.post(
        `${PHOTOBOX_URL}/status/zurueckziehen`,
        { ...oeffentlich(statusStufe), schema: { body: PhotoboxZurueckziehen, ...aktion } },
        async (request) => alsEinreicher(request.body.schluessel, () => zurueckziehen(db(), umgebung(), request.body)),
    );

    app.post(
        `${PHOTOBOX_URL}/status/offline`,
        { ...oeffentlich(statusStufe), schema: { body: PhotoboxOffline, ...aktion } },
        async (request) =>
            alsEinreicher(request.body.schluessel, () => offlineNehmen(db(), storeOf(app), umgebung(), request.body)),
    );

    app.post(
        `${PHOTOBOX_URL}/status/nutzung`,
        { ...oeffentlich(statusStufe), schema: { body: PhotoboxNutzung, ...aktion } },
        async (request) => alsEinreicher(request.body.schluessel, () => nutzungSetzen(db(), umgebung(), request.body)),
    );
    // „Gefällt mir“ an einem Reisebild (WI-0304): nur die Zahl. Wer es war, wird nie gespeichert; „einmal je Browser“ hält der Browser.
    app.post(
        `${PHOTOBOX_URL}/reisebilder/:id/gefaellt`,
        {
            ...oeffentlich(gefaelltStufe),
            bodyLimit: 8 * 1024,
            schema: {
                params: PhotoboxGefaelltParams,
                body: PhotoboxGefaelltBody,
                response: { 200: PhotoboxGefaelltAntwort, ...FEHLER },
            },
        },
        async (request) => ({
            gefaellt: await uebersetzt(() => reisebildGefaellt(db(), request.params.id, request.body.delta)),
        }),
    );
};
