import { setTimeout as warte } from "node:timers/promises";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    DISCORD_ADMIN_URL,
    DISCORD_ERROR_STATUS,
    DISCORD_PROMPT_VORGABE,
    DISCORD_ZEITPLAN,
    DiscordEinstellungenBody,
    DiscordRoutineBody,
    DiscordStand,
    DiscordVorschau,
    DiscordWiederholenBody,
    DiscordZustellungParams,
    OperationReceipt,
    sendefenster,
    type DiscordZustellung,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import {
    archiv,
    leseRoutine,
    setzeEinstellungen,
    setzeRoutine,
    teileVon,
    uebersetzt,
    zeileMitId,
    type ZustellZeile,
} from "../discord/ablage.ts";
import { bereinigterPrompt } from "../discord/formulierer.ts";
import { pruefeKanal, type KanalUrteil } from "../discord/kanalpruefung.ts";
import {
    discordKonfiguration,
    kanalWert,
    sendeSperre,
    wirksam,
    zielKanal,
    type DiscordKonfig,
} from "../discord/konfig.ts";
import { discordRest } from "../discord/rest.ts";
import { NACHRICHTEN_TRENNER } from "../discord/teilung.ts";
import { berichtstag } from "../discord/zeit.ts";
import { beanspruchVonHand, entwirf, wiederhole, wiederholbar, type ZustellDeps } from "../discord/zustellung.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Der Reiter „Discord“ unter Systemsteuerung › Neuigkeiten (WI-0255).
 *
 *     GET  /api/admin/system/discord                                   Betriebsstand, Zeitplan, Routine, Sendearchiv      view_operations
 *     GET  /api/admin/system/discord/vorschau                          der Bericht, wie er jetzt hinausginge (sendet nie)  view_operations
 *     POST /api/admin/system/discord/routine                           die tägliche Routine an oder aus                   manage_news + Passkey
 *     POST /api/admin/system/discord/einstellungen                     Prompt, Uhrzeit und Berichtskanal                  manage_news + Passkey
 *     POST /api/admin/system/discord/zustellungen/:id/wiederholen      eine heutige, fehlgeschlagene Zustellung erneut    manage_news + Passkey
 *
 * - 🔴 **Kein Geheimnis in einer Antwort:** Der Stand sagt nur, OB ein Schlüssel hinterlegt ist; die Fehlerdiagnose ist schon bereinigt
 *   (`rest.ts`). Kanalkennungen sind kein Geheimnis.
 * - 🔴 **Senden prüft der Server**, nicht die Oberfläche: Auf Stage und lokal antwortet das Wiederholen 409 `discord_sendet_nicht`.
 * - Das Recht ist `manage_news` (die Redaktion der Neuigkeiten, WI-0139), an diesen Handgriffen mit frischem Passkey: Die Routine schreibt
 *   öffentlich im Namen von Claudia und Claudio. Ein eigenes Recht entsteht nicht.
 * - Die Vorschau ruft keinen Formulierer (kein Modell, keine Kosten) und speichert nichts.
 * - 🔴 Es gibt nur den Berichtskanal (Vali 2026-10-26: „du sollst den testkanal nicht mehr benutzen“). Kein Feld, keine Route und kein Modus führt in einen anderen
 *   Kanal; die Spalte `discord_routine.test_kanal` ist mit Migration 0294 gefallen.
 * - Die Einstellungen (WI-0255, Migration 0227) stehen in `discord_routine`, je Umgebung. 🔴 Der Kanal wird beim Speichern geprüft, wenn ein Bot-Schlüssel
 *   da ist (`kanalpruefung.ts`: sehen und schreiben); ist er nicht prüfbar, wird nichts gespeichert. Ohne Schlüssel (Stage, lokal) entfällt die Prüfung.
 *   Kanalkennungen sind kein Geheimnis, der Schlüssel steht nie in einer Antwort, einem Protokolleintrag oder einer Fehlermeldung.
 */

const iso = (wert: Date | null): string | null => wert?.toISOString() ?? null;

export const discordRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const lesen = protect("view_operations");
    const schalten = protect("manage_news", { confirm: "passkey", writeClass: "system" });
    const konfig = app.config.discord ?? discordKonfiguration({});
    const deps = (wirksamKonfig: DiscordKonfig = konfig): ZustellDeps => ({
        db: app.database!,
        konfig: wirksamKonfig,
        rest:
            wirksamKonfig.botToken === undefined ? undefined : discordRest(wirksamKonfig.botToken, wirksamKonfig.abruf),
        jetzt: () => new Date(),
        warte: async (ms) => {
            await warte(ms);
        },
    });

    const zustellung = (zeile: ZustellZeile, heute: string, wirksamKonfig: DiscordKonfig): DiscordZustellung => ({
        id: Number(zeile.id),
        tag: zeile.berichtstag,
        kanal: zeile.kanal,
        status: zeile.status,
        messageId: zeile.message_id,
        // Bei mehreren Nachrichten alle, mit dem Trenner der Vorschau dazwischen (die Tafel hält in `text` nur die erste).
        text: teileVon(zeile)
            .map((teil) => teil.inhalt.content)
            .join(NACHRICHTEN_TRENNER),
        formulierung: zeile.formulierung,
        versuche: zeile.versuche,
        fehler: zeile.fehler,
        ausgeloest: zeile.ausgeloest,
        erstelltAt: zeile.erstellt_at.toISOString(),
        zugestelltAt: iso(zeile.zugestellt_at),
        wiederholbar: wiederholbar(zeile, wirksamKonfig, heute),
    });

    const personName = async (id: string | null): Promise<string | null> => {
        if (id === null) return null;
        const [person] = await app.database!<{ name: string }[]>`
            SELECT display_name AS name FROM avesmaps_auth.person WHERE id = ${id}::uuid
        `.catch(uebersetzt);
        return person?.name ?? null;
    };

    app.get(DISCORD_ADMIN_URL, { ...lesen, schema: { response: { 200: DiscordStand, ...ADMIN_ERRORS } } }, async () => {
        const db = app.database!;
        const heute = berichtstag(new Date());
        const [routine, zeilen] = await Promise.all([leseRoutine(db), archiv(db)]);
        const eff = wirksam(konfig, routine);
        const fenster = sendefenster(routine.uhrzeit);
        const [geaendertVon, einstellungenVon] = await Promise.all([
            personName(routine.geaendert_von),
            personName(routine.einstellungen_von),
        ]);
        const erfolg = zeilen.find((zeile) => zeile.status === "zugestellt");
        return {
            umgebung: konfig.umgebung,
            modus: konfig.modus,
            modusVeraltet: konfig.modusVeraltet,
            sperre: sendeSperre(eff),
            schluessel: konfig.botToken !== undefined,
            kanal: zielKanal(eff),
            formulierer: konfig.formulierer !== undefined,
            zeitplan: {
                uhrzeit: fenster.von,
                zone: DISCORD_ZEITPLAN.zone,
                fensterVon: fenster.von,
                fensterBis: fenster.bis,
            },
            einstellungen: {
                prompt: routine.prompt ?? DISCORD_PROMPT_VORGABE,
                promptEigen: routine.prompt !== null,
                uhrzeit: routine.uhrzeit,
                kanalBericht: kanalWert(routine.berichts_kanal, konfig.berichtKanal),
                geaendertAt: iso(routine.einstellungen_at),
                geaendertVon: einstellungenVon,
            },
            routine: {
                aktiv: routine.aktiv,
                geaendertAt: iso(routine.geaendert_at),
                geaendertVon,
            },
            letzterLauf:
                routine.letzter_lauf_at === null
                    ? null
                    : { at: routine.letzter_lauf_at.toISOString(), ergebnis: routine.letzter_lauf ?? "" },
            letzterErfolg:
                erfolg === undefined || erfolg.message_id === null
                    ? null
                    : { tag: erfolg.berichtstag, at: iso(erfolg.zugestellt_at) ?? "", messageId: erfolg.message_id },
            heute,
            archiv: zeilen.map((zeile) => zustellung(zeile, heute, eff)),
        };
    });

    app.get(
        `${DISCORD_ADMIN_URL}/vorschau`,
        { ...lesen, schema: { response: { 200: DiscordVorschau, ...ADMIN_ERRORS } } },
        async () => {
            const tag = berichtstag(new Date());
            const eff = wirksam(konfig, await leseRoutine(app.database!));
            const entwurf = await entwirf(deps(eff), tag, zielKanal(eff) ?? eff.berichtKanal ?? null, false);
            return {
                tag,
                text: entwurf.text,
                // Bei mehreren Nachrichten die Länge der längsten: Jede darf höchstens 2000 Zeichen haben.
                zeichen: Math.max(...entwurf.teile.map((teil) => teil.length)),
                pruefung: entwurf.pruefung,
                fakten: entwurf.fakten,
            };
        },
    );

    app.post(
        `${DISCORD_ADMIN_URL}/routine`,
        { ...schalten, schema: { body: DiscordRoutineBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } } },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, aktiv } = request.body;
            return await adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "discord.routine", aktiv } },
                async (tx) => {
                    const vorher = await setzeRoutine(tx, aktiv, session.personId);
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.discord_routine_changed",
                            targetRef: "discord:tagesbericht",
                            details: { von: vorher ? "an" : "aus", nach: aktiv ? "an" : "aus" },
                        },
                    };
                },
            );
        },
    );

    /** Das Urteil über den Berichtskanal als Fehler, oder nichts, wenn er taugt. */
    const kanalFehler = (urteil: KanalUrteil): ApiError | undefined => {
        if (urteil.art === "erlaubt") return undefined;
        if (urteil.art === "nicht_pruefbar") {
            return new ApiError(
                DISCORD_ERROR_STATUS.discord_kanal_nicht_pruefbar,
                "discord_kanal_nicht_pruefbar",
                "Der Kanal konnte gerade nicht geprüft werden. Gespeichert wird erst, wenn die Prüfung gelingt.",
                { kanal: "bericht", grund: urteil.grund },
            );
        }
        return new ApiError(
            DISCORD_ERROR_STATUS.discord_kanal_unbrauchbar,
            "discord_kanal_unbrauchbar",
            "Der Bot kann diesen Kanal nicht nutzen.",
            { kanal: "bericht", grund: urteil.art === "unbekannt" ? "unbekannt" : urteil.grund },
        );
    };

    app.post(
        `${DISCORD_ADMIN_URL}/einstellungen`,
        {
            ...schalten,
            schema: { body: DiscordEinstellungenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const db = app.database!;
            const { operationId, uhrzeit } = request.body;
            const prompt = bereinigterPrompt(request.body.prompt);
            const berichtsKanal = request.body.berichtsKanal;
            // 🔴 Ein eingefügter Schlüssel würde in der Tafel, in der Antwort des Reiters und beim Formulierer landen.
            if (
                prompt !== null &&
                konfig.botToken !== undefined &&
                konfig.botToken.length >= 8 &&
                prompt.includes(konfig.botToken)
            ) {
                throw new ApiError(
                    DISCORD_ERROR_STATUS.discord_prompt_ungueltig,
                    "discord_prompt_ungueltig",
                    "Der Prompt enthält etwas, das dort nicht stehen darf.",
                );
            }
            const vorher = await leseRoutine(db);
            // Geprüft wird, was sich ändert: Ein Discord-Ausfall hält so keine Änderung von Prompt oder Uhrzeit auf.
            if (konfig.botToken !== undefined && berichtsKanal !== null && berichtsKanal !== vorher.berichts_kanal) {
                const fehler = kanalFehler(await pruefeKanal(konfig.botToken, berichtsKanal, konfig.abruf));
                if (fehler !== undefined) throw fehler;
            }
            return await adminOperation(
                db,
                session,
                {
                    operationId,
                    body: { action: "discord.einstellungen", prompt, uhrzeit, berichtsKanal },
                },
                async (tx) => {
                    const alt = await setzeEinstellungen(tx, { uhrzeit, prompt, berichtsKanal }, session.personId);
                    const geaendert = {
                        prompt: alt.prompt !== prompt,
                        uhrzeit: alt.uhrzeit !== uhrzeit,
                        berichtskanal: alt.berichts_kanal !== berichtsKanal,
                    };
                    // Nie der Text des Prompts, nur dass er sich änderte; Uhrzeit und Kanalkennungen sind kein Geheimnis.
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.discord_einstellungen_geaendert",
                            targetRef: "discord:tagesbericht",
                            details: {
                                felder: Object.entries(geaendert)
                                    .filter(([, ja]) => ja)
                                    .map(([name]) => name)
                                    .join(","),
                                ...(geaendert.uhrzeit ? { uhrzeit } : {}),
                                ...(geaendert.berichtskanal ? { berichtskanal: berichtsKanal ?? "umgebung" } : {}),
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        `${DISCORD_ADMIN_URL}/zustellungen/:id/wiederholen`,
        {
            ...schalten,
            schema: {
                params: DiscordZustellungParams,
                body: DiscordWiederholenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const eff = wirksam(konfig, await leseRoutine(app.database!));
            const sperre = sendeSperre(eff);
            if (sperre !== null) {
                throw new ApiError(
                    DISCORD_ERROR_STATUS.discord_sendet_nicht,
                    "discord_sendet_nicht",
                    "Diese Umgebung sendet nicht nach Discord.",
                    { sperre },
                );
            }
            // Ein Behälter statt einer Variablen: Was der Rückruf darin ablegt, sieht die Flussanalyse sonst nicht.
            const gehalten: { anspruch?: NonNullable<Awaited<ReturnType<typeof beanspruchVonHand>>> } = {};
            const receipt = await adminOperation(
                app.database!,
                session,
                { operationId: request.body.operationId, body: { action: "discord.wiederholen", id } },
                async (tx) => {
                    const zeile = await zeileMitId(tx, id);
                    if (zeile === undefined) {
                        throw new ApiError(
                            DISCORD_ERROR_STATUS.discord_zustellung_fehlt,
                            "discord_zustellung_fehlt",
                            "Diese Zustellung gibt es nicht.",
                        );
                    }
                    if (!wiederholbar(zeile, eff, berichtstag(new Date()))) {
                        throw new ApiError(
                            DISCORD_ERROR_STATUS.discord_nicht_wiederholbar,
                            "discord_nicht_wiederholbar",
                            "Wiederholen geht nur heute, im aktuellen Kanal und nach einem Fehlschlag.",
                        );
                    }
                    const anspruch = await beanspruchVonHand(tx, id, session.personId);
                    if (anspruch !== undefined) gehalten.anspruch = anspruch;
                    if (anspruch === undefined) {
                        throw new ApiError(
                            DISCORD_ERROR_STATUS.discord_nicht_wiederholbar,
                            "discord_nicht_wiederholbar",
                            "Ein anderer Lauf sendet diese Zustellung gerade.",
                        );
                    }
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: "system.discord_zustellung_wiederholt",
                            targetRef: `discord:${String(id)}`,
                            details: { tag: zeile.berichtstag, von: zeile.status },
                        },
                    };
                },
            );
            // Erst nach dem Protokoll und nur beim ersten Mal: Eine wiederholte Anfrage mit derselben Kennung sendet nicht noch einmal.
            if (receipt.status === "applied" && gehalten.anspruch !== undefined) {
                await wiederhole(deps(eff), gehalten.anspruch.zeile, gehalten.anspruch.vorher);
            }
            return receipt;
        },
    );
};
