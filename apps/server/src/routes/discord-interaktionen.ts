import { setTimeout as warte } from "node:timers/promises";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Queryable } from "../database.ts";
import {
    AUFGESCHOBEN,
    HILFE,
    INTERAKTION,
    MELDE_BEFEHLE,
    PONG,
    SAETZE,
    befehlDesFormulars,
    folgeantwort,
    formular,
    formularWerte,
    hatOption,
    liesInteraktion,
    meldungAus,
    melderAus,
    nachricht,
    nummerAus,
    oeffentlicherSchluessel,
    operationAus,
    signaturGueltig,
    websiteNummerAus,
    type Interaktion,
    type MeldeBefehl,
} from "../discord/interaktion.ts";
import { ApiError } from "../http/api-error.ts";
import { communityBruecke, type BrueckeGrund } from "../discord/community-bruecke.ts";
import { discordKonfiguration, meldungsKanal } from "../discord/konfig.ts";
import { postMeldung } from "../discord/meldungs-post.ts";
import { erledige, offenAntwort, websiteZurueckziehenSatz } from "../discord/vorgaenge.ts";
import { discordMelden } from "../kanal/db.ts";

/**
 * Der Empfänger der Discord-Befehle (WI-0255 Paket 2; Handover `project-control/handovers/2026-10-26-discord-befehle-paket-2-an-claudia.md`):
 *
 *     POST /api/discord/interactions        der Pfad, den Vali im Portal eingetragen hat
 *     POST /api/discord/interactions.php    der alte Pfad aus Legacy (Nachtrag 2: beide gleich behandelt)
 *
 * - **Nur wo der Kanal lebt** (Vali wählte A, `discord/konfig.ts`): mit `DISCORD_PUBLIC_KEY`, auf Stage oder Production mit echtem Release, `KANAL`
 *   nicht `aus`. Sonst antworten beide Pfade 404, wie eine Route, die es nicht gibt. Heute heißt das: die Stage; nginx reicht auf avesmaps.de die
 *   zwei Pfade an sie weiter.
 * - 🔴 **Signatur auf dem ROHEN Rumpf:** Dieses Plugin ersetzt den JSON-Leser durch einen, der die Bytes behält (Grenze 64 KiB). Ed25519 über
 *   `X-Signature-Timestamp` + Rumpf mit dem öffentlichen Schlüssel der Anwendung; fehlt sie oder stimmt sie nicht: 401. Keine Anmeldung, keine
 *   Sitzung, kein Cookie.
 * - **Antworten:** PING → PONG; `/hilfe` → die Übersicht; `/bug`, `/idee`, `/frage` → ein Formular; ein abgeschicktes Formular → ein Vorgang im
 *   Kanal (`zu_sichten`, Melder „Discord · <Name>“) und eine kurze Antwort mit der Vorgangsnummer, nur für die meldende Person. `/offen` und
 *   `/erledigt` lesen und schließen Vorgänge aus Discord (`discord/vorgaenge.ts`), ebenfalls nur für die Person, die fragt.
 * - **Website-Meldungen** (WI-0268 C8, Discord-Seite; Fachkonzept §8.3a): Ist die Brücke nach Production eingerichtet (`COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL`,
 *   `discord/community-bruecke.ts`), zeigt `/offen` unter den Discord-Fällen die eigenen Meldungen von der Website, und `/erledigt meldung:COM-…` zieht eine
 *   zurück. Die Brücke hat eine Zeitgrenze von 1,5 s und wirft nie; fehlt sie oder fällt sie aus, bleibt alles wie vor C8 (bei Ausfall mit einem Satz dazu).
 *   Die Website-Meldung liegt in Production: Für `meldung:` braucht die Stage ihre Datenbank nicht.
 * - **Drei Sekunden:** Discord wartet so lange auf die erste Antwort. Ist der Vorgang nach zwei Sekunden nicht angelegt, kommt „Avesmaps denkt
 *   nach …“ (Typ 5), und die Antwort folgt über den Webhook der Interaktion (`folgeantwort`). Discord stellt eine Interaktion höchstens einmal zu;
 *   die Operation folgt aus ihrer Kennung, also entsteht auch bei einer Wiederholung nur ein Vorgang.
 * - **Grenzen:** je Discord-Person fünf Meldungen in der Stunde, aus Discord insgesamt sechzig. Darüber ein Satz, kein Vorgang.
 * - **Post in den Kanal** (Vali 2026-11-02): `/bug` und `/idee` posten zusätzlich eine kurze Fassung der Meldung in ihren eigenen Kanal (`DISCORD_BUG_KANAL`,
 *   `DISCORD_IDEE_KANAL`, `discord/meldungs-post.ts`), mit der meldenden Person als einziger Erwähnung. Ohne den Wert oder auf Production geschieht nichts; ein
 *   Fehler des Posts ändert weder Vorgang noch Dank und landet nur im Protokoll.
 * - Schreibklasse `kanal`: Wie jede Meldung im Kanal geht sie auch unter Karten- und Systemsperre. Kein Protokolleintrag je Meldung: Der Vorgang
 *   ist die Akte, und es handelt keine angemeldete Person; protokolliert wird die Freigabe durch den Betreiber (`system.kanal_gesichtet`).
 */

export const DISCORD_INTERAKTION_PFADE = ["/api/discord/interactions", "/api/discord/interactions.php"] as const;
/** Ein Formular mit 4000 Zeichen samt den Angaben, die Discord mitschickt, bleibt weit darunter. */
export const DISCORD_RUMPF_GRENZE = 64 * 1024;
export const DISCORD_GRENZE_JE_PERSON = 5;
export const DISCORD_GRENZE_GESAMT = 60;
const FRIST_MS = 2000;

export const discordInteraktionenRoutes: FastifyPluginAsync = async (app) => {
    const konfig = app.config.discordInteraktionen;
    // Die Bot-Konfiguration des Berichts: Schlüssel und die Kanäle, in die `/bug` und `/idee` ihre Meldung kurz posten (`discord/meldungs-post.ts`).
    const discord = app.config.discord ?? discordKonfiguration({});
    const schluessel = konfig === undefined ? undefined : oeffentlicherSchluessel(konfig.schluessel);
    const umgebung = app.config.auth?.environment;
    const bruecke = communityBruecke(konfig?.bruecke);
    // Ohne Datenbank (nur Tests und Werkzeuge) antworten PING, Hilfe und Formulare; ein abgeschicktes Formular bekommt den Satz „gestört“.
    const bereit = schluessel !== undefined && umgebung !== undefined ? { schluessel, umgebung } : undefined;

    if (bereit !== undefined) app.log.info({ bruecke: bruecke.eingeschaltet }, "discord: Befehle nehmen Anfragen an");

    // Ausgeschaltet gibt es die Route nicht: dieselbe 404 wie für jeden unbekannten Pfad, bevor ein Byte gelesen wird.
    app.addHook("onRequest", async (_request, reply) => {
        if (bereit !== undefined) return;
        reply.callNotFound();
        return reply;
    });

    // 🔴 Der Rumpf bleibt Bytes: Die Signatur gilt für genau das, was Discord sandte.
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
        "application/json",
        { parseAs: "buffer", bodyLimit: DISCORD_RUMPF_GRENZE },
        (_request, rumpf, fertig) => fertig(null, rumpf),
    );

    const behandle = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
        if (bereit === undefined) {
            reply.callNotFound();
            return reply;
        }
        const rumpf = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
        if (
            !signaturGueltig(
                bereit.schluessel,
                request.headers["x-signature-ed25519"],
                request.headers["x-signature-timestamp"],
                rumpf,
            )
        ) {
            throw new ApiError(401, "discord_signature_invalid", "Die Signatur von Discord fehlt oder stimmt nicht.");
        }
        let roh: unknown;
        try {
            roh = JSON.parse(rumpf.toString("utf8"));
        } catch {
            throw new ApiError(400, "invalid_json", "Der Rumpf ist kein JSON.");
        }
        const interaktion = liesInteraktion(roh);
        if (interaktion === undefined)
            throw new ApiError(400, "discord_interaction_invalid", "Das ist keine Interaktion.");

        if (interaktion.typ === INTERAKTION.ping) return PONG;
        if (interaktion.typ === INTERAKTION.befehl) {
            if (interaktion.name === "hilfe") return nachricht(HILFE);
            if (interaktion.name !== undefined && Object.hasOwn(MELDE_BEFEHLE, interaktion.name))
                return formular(
                    interaktion.name as MeldeBefehl,
                    meldungsKanal(discord, interaktion.name as MeldeBefehl) !== null,
                );
            if (interaktion.name === "offen" || interaktion.name === "erledigt") {
                const db = app.database;
                const kennung = melderAus(interaktion).kennung;
                if (interaktion.name === "erledigt") {
                    // Genau eine Angabe: die Nummer einer Meldung aus Discord (Datenbank der Stage) oder die einer Meldung von der Website (Brücke).
                    const mitMeldung = hatOption(interaktion, "meldung");
                    if (mitMeldung && hatOption(interaktion, "nummer")) return nachricht(SAETZE.nurEine);
                    if (mitMeldung) {
                        // Die Website-Meldung liegt in Production: Dafür braucht die Stage ihre Datenbank nicht.
                        const com = websiteNummerAus(interaktion);
                        if (com === undefined) return nachricht(SAETZE.websiteNummerUngueltig);
                        return await antworte(
                            sicher(websiteZurueckziehenSatz(bruecke, kennung, com, brueckeAusgefallen)),
                            interaktion,
                            reply,
                        );
                    }
                }
                if (db === undefined) return nachricht(SAETZE.gestoert);
                if (interaktion.name === "offen")
                    return await antworte(
                        sicher(offenAntwort(db, bereit.umgebung, kennung, bruecke, brueckeAusgefallen)),
                        interaktion,
                        reply,
                    );
                const nummer = nummerAus(interaktion);
                if (nummer === undefined) return nachricht(SAETZE.nummerFehlt);
                if (interaktion.id === undefined) return nachricht(SAETZE.nichtUnterstuetzt);
                const ops = String(nummer);
                const satz = erledige(db, bereit.umgebung, nummer, kennung, operationAus(interaktion.id)).then(
                    (urteil) =>
                        urteil === "erledigt"
                            ? SAETZE.erledigt(ops)
                            : urteil === "geschlossen"
                              ? SAETZE.schonGeschlossen(ops)
                              : SAETZE.fremd(ops),
                );
                return await antworte(sicher(satz), interaktion, reply);
            }
            return nachricht(SAETZE.unbekannt);
        }
        if (interaktion.typ === INTERAKTION.formular) {
            const befehl = befehlDesFormulars(interaktion.formular);
            if (befehl === undefined || interaktion.id === undefined) return nachricht(SAETZE.nichtUnterstuetzt);
            const db = app.database;
            if (db === undefined) return nachricht(SAETZE.gestoert);
            return await melde(db, bereit.umgebung, { ...interaktion, id: interaktion.id }, befehl, reply);
        }
        return nachricht(SAETZE.nichtUnterstuetzt);
    };

    /** Den Vorgang anlegen; dauert es länger als die Frist, aufgeschoben antworten und den Satz über den Webhook nachreichen. */
    async function melde(
        datenbank: Queryable,
        environment: string,
        interaktion: Interaktion & { id: string },
        befehl: MeldeBefehl,
        reply: FastifyReply,
    ): Promise<unknown> {
        return antworte(legeAn(datenbank, environment, interaktion, befehl), interaktion, reply);
    }

    /** Die Brücke nach Production lieferte nichts: nur die Klasse des Grundes ins Protokoll, nie Kennung, Schlüssel oder Antwort. */
    function brueckeAusgefallen(grund: BrueckeGrund): void {
        app.log.warn({ grund }, "discord: Brücke zu Production nicht erreichbar");
    }

    /** Ein Satz, der nie wirft: Eine Störung wird zum Satz „gestört“ und landet ohne Text und ohne Kennung im Protokoll. */
    function sicher(satz: Promise<string>): Promise<string> {
        return satz.catch((fehler: unknown) => {
            const art = fehler instanceof Error ? { name: fehler.name, code: (fehler as { code?: unknown }).code } : {};
            app.log.error({ fehler: art }, "discord: Befehl nicht ausgeführt");
            return SAETZE.gestoert;
        });
    }

    /** Antwortet mit dem Satz; dauert er länger als die Frist, aufgeschoben, und der Satz folgt über den Webhook der Interaktion. */
    async function antworte(satz: Promise<string>, interaktion: Interaktion, reply: FastifyReply): Promise<unknown> {
        const frist = konfig?.fristMs ?? FRIST_MS;
        const sofort = await Promise.race([satz, warte(frist).then(() => undefined)]);
        if (sofort !== undefined) return nachricht(sofort);
        const { anwendung, token } = interaktion;
        if (anwendung === undefined || token === undefined) return nachricht(await satz);
        // Erst die aufgeschobene Antwort, dann die Folgeantwort: Vor der ersten Antwort kennt Discord die Nachricht `@original` nicht.
        await reply.send(AUFGESCHOBEN);
        void satz.then(async (spaeter) => {
            const status = await folgeantwort(konfig?.abruf ?? fetch, anwendung, token, spaeter);
            // Nie der Token, nie der Text: nur, ob die Folgeantwort ankam.
            if (status < 200 || status >= 300) app.log.warn({ status }, "discord: Folgeantwort nicht angekommen");
        });
        return reply;
    }

    /** Der Satz für die meldende Person; wirft nie (ein Fehler wird zum Satz und landet ohne Text im Protokoll). */
    async function legeAn(
        datenbank: Queryable,
        environment: string,
        interaktion: Interaktion & { id: string },
        befehl: MeldeBefehl,
    ): Promise<string> {
        const meldung = meldungAus(befehl, formularWerte(interaktion));
        if (meldung === undefined) return SAETZE.leer;
        const melder = melderAus(interaktion);
        try {
            const [zahl] = await datenbank<{ person: number; alle: number }[]>`
                SELECT count(*) FILTER (WHERE melder_kennung = ${melder.kennung})::int AS person, count(*)::int AS alle
                  FROM avesmaps_kanal.vorgang
                 WHERE quelle = 'discord' AND environment = ${environment} AND gemeldet_at > now() - interval '1 hour'
                   AND operation_id <> ${operationAus(interaktion.id)}::uuid
            `;
            if ((zahl?.person ?? 0) >= DISCORD_GRENZE_JE_PERSON || (zahl?.alle ?? 0) >= DISCORD_GRENZE_GESAMT)
                return SAETZE.grenze;
            const id = await discordMelden(
                datenbank,
                {
                    environment,
                    kategorie: MELDE_BEFEHLE[befehl],
                    titel: meldung.titel,
                    nachricht: meldung.nachricht,
                    melderName: melder.name,
                    melderKennung: melder.kennung,
                    kontext: { umgebung: environment, release: app.config.releaseId },
                },
                operationAus(interaktion.id),
            );
            // Zusätzlich kurz in den Kanal des Befehls (nur `/bug` und `/idee`, nur mit gesetztem Kanal). Nicht abgewartet: Der Dank wartet nicht auf Discord, und
            // ein Fehler dort ändert am Vorgang nichts (`postMeldung` wirft nie und meldet nur die Art des Fehlers, ohne Text).
            if (befehl === "bug" || befehl === "idee") {
                void postMeldung(
                    discord,
                    {
                        befehl,
                        nummer: id,
                        titel: meldung.titel,
                        nachricht: meldung.nachricht,
                        melderKennung: melder.kennung,
                        interaktionsId: interaktion.id,
                    },
                    (art) => app.log.warn({ befehl, art }, "discord: Post der Meldung nicht angekommen"),
                );
            }
            return SAETZE.eingegangen(befehl, String(id), meldungsKanal(discord, befehl) !== null);
        } catch (fehler) {
            // Ohne Text und ohne Melder: nur, welcher Fehler es war.
            const art = fehler instanceof Error ? { name: fehler.name, code: (fehler as { code?: unknown }).code } : {};
            app.log.error({ fehler: art }, "discord: Vorgang nicht angelegt");
            return SAETZE.gestoert;
        }
    }

    for (const pfad of DISCORD_INTERAKTION_PFADE) {
        app.post(
            pfad,
            { bodyLimit: DISCORD_RUMPF_GRENZE, config: { writeClass: "kanal", errorEnvelope: true } },
            behandle,
        );
    }
};
