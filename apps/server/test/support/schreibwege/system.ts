import { createHash, randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { KARTENSERIE_STUECK_PRUEFSUMME } from "@avesmaps3d/shared";
import { leseKatalog } from "../../../src/abzug/katalog.ts";
import { baueAbzugPlan } from "../../../src/abzug/plan.ts";
import { ladeRegeln } from "../../../src/abzug/regeln.ts";
import { discordKonfiguration, type DiscordKonfig } from "../../../src/discord/konfig.ts";
import { ersteZeile } from "../../../src/discord/vorlage.ts";
import { berichtstag } from "../../../src/discord/zeit.ts";
import { neueNonce } from "../../../src/discord/zustellung.ts";
import { TEST_ORIGIN } from "../auth-fixture.ts";
import { schreibeAbzug } from "../abzug-export.ts";
import { gestellteGilde } from "../discord-gilde.ts";
import { betroffen, FREIGABE_DATEI, type Faelle, type Person, type Welt } from "./welt.ts";

/**
 * Die Systemsteuerung (WI-0127, WI-0139, WI-0153, WI-0166, FREIGABE-0001): jeder Schreibweg einmal, Rezepte aus
 * `system-protokollpflicht.test.ts`. Eine Betreiberin mit frischem Passkey und einer Passkey-Zeile darf alles hier. Was den Betrieb
 * umstellt (eingeschränkt, Sperre, Pause), stellt der Fall über dieselbe Route gleich wieder zurück; das Aufräumen nach jedem Fall
 * setzt den Betriebszustand ohnehin zurück und bricht offene Aufträge ab.
 */

const operationId = (): string => randomUUID();

/**
 * Was der Ersatz-Starter des Release-Tests (`support/release-test-starter.mjs`) antwortet (WI-0248 L): ein Kandidat, eine Vorprüfung, die den Start
 * zulässt, und ein laufender Test, den der Fall abbrechen darf.
 */
export const RELEASE_TEST_STAND = "a".repeat(40);
export const RELEASE_TEST_ZUSTAND = {
    kandidat: { stage: { sha: RELEASE_TEST_STAND, zeit: "2026-10-23T08:00:00Z" }, auftrag: null },
    trocken: { status: "trocken", grund: "Würde starten." },
    start: { status: "gestartet", grund: "Release-Test gestartet" },
    abbrechen: { status: "abbruch-angefordert", grund: "Abbruch angefordert" },
} as const;
const URL = "/api/admin/system";

/**
 * Der Discord-Tagesbericht im Rauchtest (WI-0255): die Konfiguration, mit der allein die Stage sendet (Stage, echtes Release, `senden`,
 * Schlüssel, Berichtskanal; `discord/konfig.ts`), und ein gestelltes Discord statt `fetch`. 🔴 Kein Fall spricht mit Discord: Die Kennungen
 * sind erfunden, im Format von Discord. Die Kanalprüfung beim Speichern der Einstellungen beantwortet die gestellte Gilde
 * (`support/discord-gilde.ts`, Bot darf sehen und senden); eine Nachricht nimmt `abruf` an, merkt sich ihren Kanal in `DISCORD_GESENDET`
 * und antwortet mit einer neuen Kennung. Lokal und in Production sperrt die Route das Senden mit 409 (`discord-zustellung.test.ts`).
 */
export const DISCORD_BERICHT_KANAL = "1000000000000000031";
export const DISCORD_GESENDET: string[] = [];
const discordGilde = gestellteGilde();
export const DISCORD_BERICHT: DiscordKonfig = {
    ...discordKonfiguration({
        AVESMAPS_ENV: "staging",
        RELEASE_ID: "wi-0189-rauchtest",
        DISCORD_BERICHT: "senden",
        DISCORD_BOT_TOKEN: "rauchtest.SCHLUESSEL.discord-bericht",
        DISCORD_BERICHT_KANAL,
    }),
    abruf: async (url, init) => {
        const kanal = /\/channels\/(\d+)\/messages$/u.exec(url)?.[1];
        if (kanal !== undefined && init.method === "POST") {
            DISCORD_GESENDET.push(kanal);
            const id = String(1_430_000_000_000_000_000n + BigInt(DISCORD_GESENDET.length));
            return new Response(JSON.stringify({ id }), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        // Nachsehen im Kanal: noch nichts da.
        if (/\/channels\/\d+\/messages\?/u.test(url)) return new Response("[]", { status: 200 });
        return discordGilde.abruf(url, init);
    },
};

const betreiberin = (welt: Welt): Promise<Person> => welt.jemand("operator", { frisch: true, passkey: true });

async function zahl(welt: Welt, sql: string): Promise<number> {
    const [row] = await welt.cluster.admin.unsafe<{ n: number | null }[]>(sql);
    return row?.n ?? 0;
}

const systemRevision = (welt: Welt) => zahl(welt, "SELECT revision::int AS n FROM system_state WHERE id = 1");
const terrainRevision = (welt: Welt) => zahl(welt, "SELECT revision::int AS n FROM terrain_recipe_choice");
const wegfindungRevision = (welt: Welt) =>
    zahl(welt, "SELECT revision::int AS n FROM routing_setting_state WHERE id = 1");

/** Ruft `url` und stellt danach mit `zurueck` wieder her; das Ergebnis ist der erste Aufruf. */
async function undZurueck(
    welt: Welt,
    person: Person,
    url: string,
    hin: object,
    zurueck: object,
): Promise<LightMyRequestResponse> {
    const antwort = await welt.post(url, person.cookie, {
        operationId: operationId(),
        baseRevision: await systemRevision(welt),
        ...hin,
    });
    if (antwort.statusCode === 200) {
        welt.muss(
            await welt.post(url, person.cookie, {
                operationId: operationId(),
                baseRevision: await systemRevision(welt),
                ...zurueck,
            }),
        );
    }
    return antwort;
}

async function hoehenmodell17(welt: Welt, person: Person): Promise<LightMyRequestResponse> {
    return welt.post(`${URL}/hoehenmodell/waehlen`, person.cookie, {
        operationId: operationId(),
        baseRevision: await terrainRevision(welt),
        version: 17,
        reason: "Rauchtest",
    });
}

async function entwurf(welt: Welt, person: Person): Promise<string> {
    welt.muss(
        await welt.post(`${URL}/hoehenmodell/entwurf`, person.cookie, {
            operationId: operationId(),
            basis: 18,
            aenderungen: { saturation: 12 },
            reason: "Rauchtest",
        }),
    );
    const [row] = await welt.cluster.admin<{ id: string }[]>`
        SELECT id::text AS id FROM terrain_recipe_draft WHERE state = 'entwurf' ORDER BY created_at DESC LIMIT 1
    `;
    return row!.id;
}

async function wegfindung(welt: Welt, person: Person, value: number): Promise<LightMyRequestResponse> {
    return welt.post(`${URL}/wegfindung`, person.cookie, {
        operationId: operationId(),
        baseRevision: await wegfindungRevision(welt),
        id: "endSnap",
        value,
    });
}

const KANTE = 8192;

/** Eine Kennung für eine neue Kartenserie: nur Kleinbuchstaben (`KARTENSERIE_KENNUNG_MUSTER`), jede Serie ein eigenes Wort. */
const serienKennung = (): string => Array.from({ length: 12 }, () => String.fromCharCode(97 + randomInt(26))).join("");

/** Ein PNG, das nur aus seinem Kopf besteht (Signatur, IHDR, Breite, Höhe) und aufgefüllt ist: genug für die Prüfung beim Abschluss. */
function pngDatei(laenge: number): Buffer {
    const kopf = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const masse = Buffer.alloc(8);
    masse.writeUInt32BE(KANTE, 0);
    masse.writeUInt32BE(KANTE, 4);
    return Buffer.concat([kopf, masse, Buffer.alloc(laenge - 24, 7)]);
}

/**
 * Das Hochladen einer Kartenserie legt Dateien in der Ablage der Quellen ab (`MAP_SOURCES_ROOT`, gelesen bei jedem Aufruf aus der
 * Umgebung). Der Fall bekommt einen Ordner unter dem Wegwerf-Ordner der Welt und keine Mindestgröße freien Platzes; danach ist die
 * Umgebung wie vorher und die angelegte Serie weg, damit kein Fall dem nächsten eine halbe Serie hinterlässt.
 */
async function mitAblage<T>(welt: Welt, serie: string, arbeit: () => Promise<T>): Promise<T> {
    const vorher = { wurzel: process.env["MAP_SOURCES_ROOT"], platz: process.env["MAP_SERIES_MIN_FREE_GB"] };
    process.env["MAP_SOURCES_ROOT"] = join(welt.ordner, "map-sources");
    process.env["MAP_SERIES_MIN_FREE_GB"] = "0";
    try {
        return await arbeit();
    } finally {
        for (const [name, wert] of [
            ["MAP_SOURCES_ROOT", vorher.wurzel],
            ["MAP_SERIES_MIN_FREE_GB", vorher.platz],
        ] as const) {
            if (wert === undefined) delete process.env[name];
            else process.env[name] = wert;
        }
        await welt.cluster.admin`DELETE FROM map_series WHERE series_id = ${serie}`;
    }
}

/** Den Upload einer neuen Serie anlegen, wie der Browser es täte; gibt seine Kennung zurück. */
async function uploadAnlegen(welt: Welt, person: Person, serie: string, bytes: number): Promise<string> {
    const antwort = welt.muss(
        await welt.post(`${URL}/kartenserien/uploads`, person.cookie, {
            operationId: operationId(),
            ziel: { art: "neu", id: serie, anlage: { label: "Rauchserie", labelsInImage: false, nurEditoren: true } },
            bytes,
            kante: KANTE,
        }),
    );
    return betroffen(antwort, "map_series_upload").id;
}

/** Ein Stück des Uploads, als Bytes mit seiner Prüfsumme (`welt.post` schickt nur JSON). */
function uploadStueck(welt: Welt, person: Person, uploadId: string, bytes: Buffer): Promise<LightMyRequestResponse> {
    return welt.app.inject({
        method: "PUT",
        url: `${URL}/kartenserien/uploads/${uploadId}?versatz=0`,
        headers: {
            host: "avesmaps.test",
            origin: TEST_ORIGIN,
            "user-agent": "Rauchtest",
            cookie: person.cookie,
            "content-type": "application/octet-stream",
            [KARTENSERIE_STUECK_PRUEFSUMME]: createHash("sha256").update(bytes).digest("hex"),
        },
        payload: bytes,
    });
}

/** Eine offene Freigabe sperrt den nächsten Weg nach Production; der Fall räumt seinen Vorgang wieder weg. */
async function ohneFreigaben(welt: Welt): Promise<void> {
    // Abgelöste und abgebrochene Freigaben tragen einen Verlauf (WI-0234); der geht zuerst.
    await welt.cluster.admin`
        DELETE FROM avesmaps_kanal.eintrag
         WHERE vorgang_id IN (SELECT id FROM avesmaps_kanal.vorgang WHERE art = 'freigabe' AND environment = 'test')
    `;
    await welt.cluster.admin`DELETE FROM avesmaps_kanal.vorgang WHERE art = 'freigabe' AND environment = 'test'`;
}

export const SYSTEM: Faelle = {
    "POST /api/admin/system/mode": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return undZurueck(
                welt,
                person,
                `${URL}/mode`,
                { mode: "restricted", reason: "Rauchtest" },
                { mode: "normal" },
            );
        },
    },
    "POST /api/admin/system/lock": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return undZurueck(
                welt,
                person,
                `${URL}/lock`,
                { lock: "map", locked: true, reason: "Rauchtest" },
                { lock: "map", locked: false },
            );
        },
    },
    "POST /api/admin/system/queue": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return undZurueck(welt, person, `${URL}/queue`, { paused: true, reason: "Rauchtest" }, { paused: false });
        },
    },
    "POST /api/admin/system/abgleiche/start": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/abgleiche/start`, person.cookie, { operationId: operationId(), quelle: "medien" });
        },
    },
    "POST /api/admin/system/backup/start": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/backup/start`, person.cookie, { operationId: operationId() });
        },
    },
    "POST /api/admin/system/backup/wiederherstellung": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/backup/wiederherstellung`, person.cookie, {
                operationId: operationId(),
                sicherung: "letzte",
                umfang: "datenbank",
                grund: "Rauchtest",
            });
        },
    },
    "POST /api/admin/system/content-switches": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/content-switches`, person.cookie, {
                operationId: operationId(),
                baseRevision: await zahl(welt, "SELECT content_revision::int AS n FROM system_state WHERE id = 1"),
                key: "panel.reviews",
                enabled: false,
            });
        },
    },
    "POST /api/admin/system/wegfindung": {
        erwartet: 200,
        async rufe(welt) {
            return wegfindung(welt, await betreiberin(welt), 0.03);
        },
    },
    "POST /api/admin/system/wegfindung/freigeben": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            welt.muss(await wegfindung(welt, person, 0.031));
            return welt.post(`${URL}/wegfindung/freigeben`, person.cookie, {
                operationId: operationId(),
                baseRevision: await wegfindungRevision(welt),
            });
        },
    },
    "POST /api/admin/system/karteneinstellungen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/karteneinstellungen`, person.cookie, {
                operationId: operationId(),
                baseRevision: await zahl(welt, "SELECT revision::int AS n FROM map_setting_state WHERE id = 1"),
                id: "startZoom",
                value: 3,
            });
        },
    },
    "POST /api/admin/system/hoehenmodell/waehlen": {
        erwartet: 200,
        async rufe(welt) {
            return hoehenmodell17(welt, await betreiberin(welt));
        },
    },
    "POST /api/admin/system/hoehenmodell/neu-rechnen": {
        erwartet: 200,
        async rufe(welt) {
            return welt.post(`${URL}/hoehenmodell/neu-rechnen`, (await betreiberin(welt)).cookie, {
                operationId: operationId(),
            });
        },
    },
    "POST /api/admin/system/hoehenmodell/zurueck": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            welt.muss(await hoehenmodell17(welt, person));
            return welt.post(`${URL}/hoehenmodell/zurueck`, person.cookie, {
                operationId: operationId(),
                baseRevision: await terrainRevision(welt),
                reason: "Rauchtest",
            });
        },
    },
    "POST /api/admin/system/hoehenmodell/abnehmen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/hoehenmodell/abnehmen`, person.cookie, {
                operationId: operationId(),
                version: 18,
                reason: "Rauchtest",
            });
        },
    },
    "POST /api/admin/system/hoehenmodell/entwurf": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/hoehenmodell/entwurf`, person.cookie, {
                operationId: operationId(),
                basis: 18,
                aenderungen: { saturation: 12 },
                reason: "Rauchtest",
            });
        },
    },
    // „19 (Test)“ (WI-0240): die Werte über der Datei der offenen Fassung setzen; INSERT der ersten Zeile und der Verlauf.
    // 🪤 Die Testdatei stellt die Rezeptdatei per `mitOffenerFassung19` auf „19 offen“; die Werkstatt fragt aber AUCH die Datenbank
    // (`abnahmen`, `gesperrt_am`). Im Datenstand des Release-Tests (`SCHREIBWEGE_DUMP`) ist Fassung 19 seit 2026-11-07 abgenommen und ihre
    // Testzeile gesperrt: 409 `terrain_test_closed` (Release-Test fbf80b18 rot, 2026-11-08), ohne Dump lokal grün. Deshalb nimmt der Fall
    // beides im Wegwerf-Cluster für seinen Aufruf zurück und stellt es danach wieder her; die übrigen Fälle sehen den Datenstand wie vorher.
    "POST /api/admin/system/hoehenmodell/test": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const admin = welt.cluster.admin;
            const abnahmen = await admin<Record<string, unknown>[]>`
                SELECT * FROM terrain_recipe_acceptance WHERE version = 19
            `;
            const gesperrt = await admin<{ map_domain_id: string; gesperrt_am: Date }[]>`
                SELECT map_domain_id, gesperrt_am FROM terrain_recipe_test WHERE version = 19 AND gesperrt_am IS NOT NULL
            `;
            await admin`DELETE FROM terrain_recipe_acceptance WHERE version = 19`;
            await admin`UPDATE terrain_recipe_test SET gesperrt_am = NULL WHERE version = 19`;
            try {
                const [zeile] = await admin<{ revision: number }[]>`
                    SELECT revision FROM terrain_recipe_test WHERE version = 19
                `;
                return await welt.post(`${URL}/hoehenmodell/test`, person.cookie, {
                    operationId: operationId(),
                    baseRevision: zeile?.revision ?? 0,
                    werte: { regler: { continentalHeight: 310 + (zeile?.revision ?? 0) } },
                    reason: "Rauchtest",
                });
            } finally {
                if (abnahmen.length > 0)
                    await admin`
                        INSERT INTO terrain_recipe_acceptance OVERRIDING SYSTEM VALUE
                        SELECT * FROM jsonb_populate_recordset(NULL::terrain_recipe_acceptance, ${admin.json(abnahmen as never)})
                    `;
                for (const zeile of gesperrt)
                    await admin`
                        UPDATE terrain_recipe_test SET gesperrt_am = ${zeile.gesperrt_am}
                         WHERE map_domain_id = ${zeile.map_domain_id} AND version = 19
                    `;
            }
        },
    },
    "POST /api/admin/system/hoehenmodell/entwurf/messen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/hoehenmodell/entwurf/messen`, person.cookie, {
                operationId: operationId(),
                draft: await entwurf(welt, person),
            });
        },
    },
    "POST /api/admin/system/hoehenmodell/entwurf/verwerfen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/hoehenmodell/entwurf/verwerfen`, person.cookie, {
                operationId: operationId(),
                draft: await entwurf(welt, person),
            });
        },
    },
    "POST /api/admin/system/news": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/news`, person.cookie, {
                operationId: operationId(),
                datum: "2026-10-16",
                titel: "Rauchtest",
                text: "Ein Eintrag des Rauchtests.",
                rubrik: "karte",
            });
        },
    },
    "POST /api/admin/system/news/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            welt.muss(
                await welt.post(`${URL}/news`, person.cookie, {
                    operationId: operationId(),
                    datum: "2026-10-16",
                    titel: "Rauchtest",
                    text: "Ein Eintrag des Rauchtests.",
                    rubrik: "karte",
                }),
            );
            const id = await zahl(welt, "SELECT max(id)::int AS n FROM public.news_entry");
            return welt.post(`${URL}/news/${String(id)}`, person.cookie, {
                operationId: operationId(),
                zustand: "versteckt",
            });
        },
    },
    // Der Discord-Tagesbericht (WI-0255): Die Zeile der Routine wird gesperrt (`FOR UPDATE`) und gesetzt, als App-Rolle, ohne Anfrage an Discord.
    "POST /api/admin/system/discord/routine": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/discord/routine`, person.cookie, { operationId: operationId(), aktiv: false });
        },
    },
    // Das Panel Mailpostfach (WI-0268 C6c): Die Funktion des Schalters läuft als App-Rolle (SECURITY DEFINER, kein Tafelrecht); aus- und wieder einschalten ruft auch die Liste der wartenden Mails (keine) und
    // schreibt je ein Ereignis in derselben Transaktion.
    "POST /api/admin/system/mail/routine": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            await welt.post(`${URL}/mail/routine`, person.cookie, {
                operationId: operationId(),
                art: "versand",
                aktiv: false,
            });
            return welt.post(`${URL}/mail/routine`, person.cookie, {
                operationId: operationId(),
                art: "versand",
                aktiv: true,
            });
        },
    },
    "POST /api/admin/system/discord/einstellungen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/discord/einstellungen`, person.cookie, {
                operationId: operationId(),
                prompt: "Knapp und freundlich.",
                uhrzeit: "10:15",
                berichtsKanal: "1000000000000000021",
            });
        },
    },
    // Eine fehlgeschlagene Zustellung von heute von Hand wiederholen (WI-0255), auf dem Sendepfad der Stage (`DISCORD_BERICHT`): ohne frischen
    // Passkey 403; mit ihm beansprucht die App-Rolle die Zeile, schreibt das Ereignis in derselben Transaktion, sendet danach genau eine
    // Nachricht in den geltenden Kanal und hält Zustellung und Lauf fest. Dieselbe Anfrage noch einmal quittiert nur und sendet nicht.
    "POST /api/admin/system/discord/zustellungen/:id/wiederholen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const tag = berichtstag(new Date());
            // Der geltende Kanal: der aus dem Reiter (den der Fall der Einstellungen einträgt), sonst der der Umgebung.
            const [routine] = await welt.cluster.admin<{ kanal: string }[]>`
                SELECT coalesce(
                    (SELECT berichts_kanal FROM public.discord_routine WHERE art = 'tagesbericht'),
                    ${DISCORD_BERICHT_KANAL}
                ) AS kanal
            `;
            const kanal = routine!.kanal;
            const nonce = neueNonce(tag);
            const [zeile] = await welt.cluster.admin<{ id: string }[]>`
                INSERT INTO public.discord_zustellung
                    (berichtstag, kanal, kanal_art, status, nonce, inhalt, text, fakten, ausgeloest, versuche, fehler)
                VALUES (${tag}::date, ${kanal}, 'bericht', 'fehlgeschlagen', ${nonce},
                        ${welt.cluster.admin.json({ content: "Ein Bericht des Rauchtests.", nonce })},
                        ${`${ersteZeile(tag)}\nEin Bericht des Rauchtests.`}, '{}'::jsonb, 'zeitplan', 1, 'Discord gestört (HTTP 502)')
                RETURNING id::text AS id
            `;
            const id = zeile!.id;
            const url = `${URL}/discord/zustellungen/${id}/wiederholen`;
            const vorher = DISCORD_GESENDET.length;
            const ereignisse = async (): Promise<number> =>
                zahl(
                    welt,
                    `SELECT count(*)::int AS n FROM avesmaps_auth.security_event
                      WHERE action = 'system.discord_zustellung_wiederholt' AND target_ref = 'discord:${id}'`,
                );

            const ohnePasskey = await welt.jemand("operator", { passkey: true });
            const abgewiesen = welt.muss(await welt.post(url, ohnePasskey.cookie, { operationId: operationId() }), 403);
            if (!abgewiesen.body.includes("reauth_required")) throw new Error(`ohne Passkey: ${abgewiesen.body}`);
            if (DISCORD_GESENDET.length !== vorher || (await ereignisse()) !== 0) {
                throw new Error("ohne Passkey gesendet oder protokolliert");
            }

            const kennung = operationId();
            const antwort = await welt.post(url, person.cookie, { operationId: kennung });
            if (antwort.statusCode !== 200) return antwort;
            const [stand] = await welt.cluster.admin<
                { status: string; message_id: string | null; ausgeloest: string }[]
            >`
                SELECT status, message_id, ausgeloest FROM public.discord_zustellung WHERE id = ${id}::bigint
            `;
            const gesendet = DISCORD_GESENDET.slice(vorher);
            if (stand?.status !== "zugestellt" || stand.message_id === null || stand.ausgeloest !== "hand") {
                throw new Error(`Zustellung nicht festgehalten: ${JSON.stringify(stand)}`);
            }
            if (gesendet.length !== 1 || gesendet[0] !== kanal)
                throw new Error(`gesendet: ${JSON.stringify(gesendet)}`);
            if ((await ereignisse()) !== 1) throw new Error("kein Ereignis system.discord_zustellung_wiederholt");

            // Idempotent: dieselbe Kennung noch einmal ist eine Quittung, keine zweite Nachricht und kein zweites Ereignis.
            welt.muss(await welt.post(url, person.cookie, { operationId: kennung }));
            if (DISCORD_GESENDET.length !== vorher + 1 || (await ereignisse()) !== 1) {
                throw new Error("dieselbe Anfrage hat noch einmal gesendet oder protokolliert");
            }
            return antwort;
        },
    },
    "POST /api/admin/system/production/release": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            await ohneFreigaben(welt);
            try {
                return await welt.post(`${URL}/production/release`, person.cookie, {
                    operationId: operationId(),
                    commit: FREIGABE_DATEI.stage.commit.slice(0, 7),
                });
            } finally {
                await ohneFreigaben(welt);
            }
        },
    },
    "POST /api/admin/system/production/rollback": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            await ohneFreigaben(welt);
            try {
                return await welt.post(`${URL}/production/rollback`, person.cookie, { operationId: operationId() });
            } finally {
                await ohneFreigaben(welt);
            }
        },
    },
    // Der Reiter „Kartenserien“ (WI-0220 Schnitt 2): ein Text der Vorgabe-Serie, dann zurück; Sperre, Revision und Zeile `map_series`.
    "POST /api/admin/system/kartenserien": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const revision = () => zahl(welt, "SELECT revision::int AS n FROM map_series_state WHERE id = 1");
            const antwort = await welt.post(`${URL}/kartenserien`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(),
                id: "modern",
                aktion: { art: "texte", texte: { description: "Ein Text des Rauchtests." } },
            });
            if (antwort.statusCode === 200) {
                welt.muss(
                    await welt.post(`${URL}/kartenserien`, person.cookie, {
                        operationId: operationId(),
                        baseRevision: await revision(),
                        id: "modern",
                        aktion: { art: "texte", texte: { description: null } },
                    }),
                );
            }
            return antwort;
        },
    },
    // „Nach Production übernehmen“ (WI-0220 Schnitt 4): reiht den Auftrag `map_series_production` ein (`job_enqueue`). Die Route liest
    // den Zeiger der Fassung unter `TILE_ROOT`; der Rauchtest hat keinen, also zeigt der Fall für die Dauer des Aufrufs auf einen eigenen.
    "POST /api/admin/system/kartenserien/production": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const kacheln = join(welt.ordner, "kacheln");
            const revision = "aaaaaaaaaaaa";
            await mkdir(join(kacheln, "original"), { recursive: true });
            await writeFile(
                join(kacheln, "original", "current.json"),
                `${JSON.stringify({
                    schemaVersion: 1,
                    series: "original",
                    revision,
                    manifest: `${revision}${"0".repeat(52)}`,
                    format: "webp",
                    tileSize: 512,
                    maxNativeZoom: 6,
                })}\n`,
            );
            const config = welt.app.config as { tileRoot: string | undefined };
            const vorher = config.tileRoot;
            config.tileRoot = kacheln;
            try {
                return await welt.post(`${URL}/kartenserien/production`, person.cookie, {
                    operationId: operationId(),
                    id: "original",
                });
            } finally {
                config.tileRoot = vorher;
            }
        },
    },
    // Hochladen einer Kartenserie (WI-0220 Schnitt 3): Anlegen, ein Stück, Abschluss. Anlegen und Abschluss laufen in `adminOperation`;
    // der Abschluss legt die Zeile `map_series` an und reiht den Auftrag `map_series_tile` ein.
    "POST /api/admin/system/kartenserien/uploads": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const serie = serienKennung();
            return mitAblage(welt, serie, () =>
                welt.post(`${URL}/kartenserien/uploads`, person.cookie, {
                    operationId: operationId(),
                    ziel: {
                        art: "neu",
                        id: serie,
                        anlage: { label: "Rauchserie", labelsInImage: false, nurEditoren: true },
                    },
                    bytes: 1000,
                    kante: KANTE,
                }),
            );
        },
    },
    "PUT /api/admin/system/kartenserien/uploads/:id": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const serie = serienKennung();
            return mitAblage(welt, serie, async () => {
                const bytes = pngDatei(1000);
                return uploadStueck(welt, person, await uploadAnlegen(welt, person, serie, bytes.length), bytes);
            });
        },
    },
    "POST /api/admin/system/kartenserien/uploads/:id/abschluss": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const serie = serienKennung();
            return mitAblage(welt, serie, async () => {
                const bytes = pngDatei(1000);
                const uploadId = await uploadAnlegen(welt, person, serie, bytes.length);
                welt.muss(await uploadStueck(welt, person, uploadId, bytes));
                return welt.post(`${URL}/kartenserien/uploads/${uploadId}/abschluss`, person.cookie, {
                    operationId: operationId(),
                });
            });
        },
    },
    // Die Zoombänder (WI-0221): eine Spur auf eine eigene Spanne, dann zurück auf die Vorgabe (die Zeile fällt wieder weg).
    "POST /api/admin/system/zoombaender": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const revision = () => zahl(welt, "SELECT revision::int AS n FROM zoom_band_state WHERE id = 1");
            const antwort = await welt.post(`${URL}/zoombaender`, person.cookie, {
                operationId: operationId(),
                baseRevision: await revision(),
                aenderungen: [{ id: "wege.Weg.linie", spanne: { von: 2, bis: 8 } }],
            });
            if (antwort.statusCode === 200) {
                welt.muss(
                    await welt.post(`${URL}/zoombaender`, person.cookie, {
                        operationId: operationId(),
                        baseRevision: await revision(),
                        aenderungen: [{ id: "wege.Weg.linie", spanne: null }],
                    }),
                );
            }
            return antwort;
        },
    },
    // Der Release-Test auf dem Entwicklungsrechner (WI-0248 L): Starten und Abbrechen gegen den Ersatz-Starter; beide schreiben ihr Ereignis ins Protokoll.
    "POST /api/admin/system/release-test/starten": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/release-test/starten`, person.cookie, {
                operationId: operationId(),
                commit: RELEASE_TEST_STAND,
            });
        },
    },
    "POST /api/admin/system/release-test/abbrechen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/release-test/abbrechen`, person.cookie, {
                operationId: operationId(),
                commit: RELEASE_TEST_STAND,
            });
        },
    },
    // Der Abzug für lokal auf Stage und Production (WI-0251): Erstellen reiht den Auftrag ein (job_enqueue als App-Rolle), der Link braucht
    // einen abgelegten Abzug in der Ablage und schreibt sein Ereignis.
    "POST /api/admin/system/abzug/erstellen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/abzug/erstellen`, person.cookie, { operationId: operationId() });
        },
    },
    "POST /api/admin/system/abzug/link": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const kennung = "20261024T120000Z-rauchtest";
            const regeln = ladeRegeln();
            let katalog = await leseKatalog(welt.cluster.migrator);
            const echteDaten = welt.cluster.dump !== undefined;
            if (echteDaten) {
                // Auf echten Daten (SCHREIBWEGE_DUMP, WI-0264) bringt die Quelle Tafeln mit, die keine Migration anlegt: Reste von Versuchen der
                // Entwicklungsdatenbank (`scratch_inner_old`, `spike_label_run`). Auf Stage und Production gibt es sie nicht, und dass jede
                // Tafel eingeordnet ist, prüft `abzug-regeln.test.ts` am migrierten Schema. Dieser Fall prüft den Link, nicht die
                // Sauberkeit der Quelle: Ohne Einordnung bleibt die Tafel aus dem Plan.
                const eingeordnet = [...katalog.tafeln].filter(
                    ([voll, tafel]) =>
                        regeln.regeln.tafeln[voll] !== undefined ||
                        regeln.regeln.schemataWeglassen[tafel.schema] !== undefined,
                );
                katalog = { ...katalog, tafeln: new Map(eingeordnet) };
            }
            let plan = baueAbzugPlan(katalog, regeln, "staging");
            if (echteDaten) {
                // Der Link braucht eine Datei in der Ablage mit gültigem Manifest (mindestens eine Tafel), nicht den Inhalt der Tafeln.
                // `schreibeAbzug` (Test-Export) liest sie in einer Transaktion über `readable()`; bei einer Tafel über etwa 16 KiB pausiert
                // postgres.js den Socket (Gegendruck) und lässt ihn nach dem Ende des Stroms pausiert: Die nächste Anweisung hängt ohne Fehler
                // (gemessen am Dump: `climate_divider` nach `climate_band_smooth`, die Migrationsverbindung bleibt belegt, und jeder Fall danach,
                // der `migrator` braucht, läuft in die Zeitgrenze). Darum geht nur die kleinste Tafel des Plans ins Tar; Kopf, Journal,
                // Kartendomänen und Medienliste bleiben die des Plans.
                const groessen = await welt.cluster.admin<{ voll: string; groesse: string }[]>`
                    SELECT n.nspname || '.' || c.relname AS voll, pg_total_relation_size(c.oid)::text AS groesse
                      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relkind = 'r'
                `;
                const groesse = new Map(groessen.map((zeile) => [zeile.voll, Number(zeile.groesse)]));
                const kleinste = [...plan.tafeln].sort(
                    (a, b) => (groesse.get(a.tafel) ?? Infinity) - (groesse.get(b.tafel) ?? Infinity),
                )[0];
                if (kleinste === undefined) throw new Error("Der Plan des Abzugs hat keine Tafel");
                plan = { ...plan, tafeln: [kleinste] };
            }
            const ordner = join(welt.ordner, "abzug", "staging", kennung);
            await mkdir(ordner, { recursive: true });
            await schreibeAbzug(welt.cluster.migrator, plan, {
                ziel: join(ordner, "abzug.tar"),
                kennung,
                quelle: "staging",
            });
            return welt.post(`${URL}/abzug/link`, person.cookie, { operationId: operationId(), kennung });
        },
    },
    // Den Abzug selbst abholen (WI-0251): Ein Abzugs-Schlüssel schreibt eine Zeile in avesmaps_auth.abzug_schluessel (App-Rolle: lesen, anlegen, ändern) und
    // sein Ereignis; Widerrufen ändert sie.
    "POST /api/admin/system/abzug/schluessel": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            return welt.post(`${URL}/abzug/schluessel`, person.cookie, { operationId: operationId(), tage: 30 });
        },
    },
    "POST /api/admin/system/abzug/schluessel/widerrufen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            const angelegt = welt
                .muss(
                    await welt.post(`${URL}/abzug/schluessel`, person.cookie, { operationId: operationId(), tage: 30 }),
                )
                .json<{ id: string }>();
            return welt.post(`${URL}/abzug/schluessel/widerrufen`, person.cookie, {
                operationId: operationId(),
                id: angelegt.id,
            });
        },
    },
    // Eine Nacht-Freigabe abbrechen (WI-0234): erst eine anlegen, wie die Route es mit `nachts` in der Statusdatei täte.
    "POST /api/admin/system/production/abbrechen": {
        erwartet: 200,
        async rufe(welt) {
            const person = await betreiberin(welt);
            await ohneFreigaben(welt);
            try {
                const [vorgang] = await welt.cluster.admin<{ id: string }[]>`
                    SELECT avesmaps_kanal.kanal_freigabe_anlegen(
                        ${randomUUID()}::uuid, 'test', ${person.id}::uuid, 'nacht', 'Für Production freigegeben: rauchtest',
                        'Stand abcdef1 wird jetzt vollständig geprüft; ist die Prüfung grün, geht er im nächsten Nachtfenster (04:30–07:00) nach Production.'
                    )::text AS id
                `;
                return await welt.post(`${URL}/production/abbrechen`, person.cookie, {
                    operationId: operationId(),
                    ops: `OPS-${(vorgang?.id ?? "0").padStart(6, "0")}`,
                });
            } finally {
                await ohneFreigaben(welt);
            }
        },
    },
};
