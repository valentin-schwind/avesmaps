import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    AVENTURIA,
    COMMUNITY_DISCORD_ARTEN,
    COMMUNITY_DISCORD_BILDER_MAX,
    COMMUNITY_DISCORD_BILDER_MAX_BYTES,
    COMMUNITY_DISCORD_BILD_MAX_BYTES,
    KanalAnCommunityBody,
    MEDIA_UPLOAD_BODY_LIMIT,
    KANAL_AUFBEWAHRUNG_TAGE,
    KANAL_BERICHTE_SEITE,
    KANAL_ERROR_STATUS,
    KANAL_GRENZE_EINTRAEGE_JE_STUNDE,
    KANAL_GRENZE_VORGAENGE_JE_STUNDE,
    KANAL_KONTEXT_FELDER,
    KANAL_URL,
    KanalAbnehmenBody,
    KanalAbschliessenBody,
    KanalSichtenBody,
    KanalBerichte,
    KanalBerichteQuery,
    KanalBildBody,
    KanalBildParams,
    KanalBildQuery,
    KanalHandlungBody,
    KanalListe,
    KanalListeQuery,
    KanalMeldenBody,
    KanalNachrichtBody,
    KanalOpsParams,
    KanalVorgang,
    KanalWiederOeffnenBody,
    KanalZaehler,
    OperationReceipt,
    leseOps,
    opsId,
    type KanalAenderung,
    type KanalReiter,
    type KanalWer,
    type KanalZeile,
} from "@avesmaps3d/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import type { Queryable } from "../database.ts";
import { likeMuster } from "../db/like-muster.ts";
import { ApiError } from "../http/api-error.ts";
import { KANAL_BILD_KIND } from "../kanal/bild-job.ts";
import { FORMAT_EXTENSION, RasterRejection, inspectImage, type RasterInspection } from "../media/raster/inspect.ts";
import { MediaStorageError, MediaStore, channelKey } from "../media/storage.ts";
import { decodeBase64 } from "../media-editor/evidence-file.ts";
import { rejectionError } from "../media-editor/upload.ts";
import { communityBruecke } from "../discord/community-bruecke.ts";
import {
    KanalFehler,
    abnehmen,
    abschliessen,
    anCommunity,
    sichten,
    kanalFehler,
    melden,
    nachricht,
    wiederOeffnen,
    type KanalFehlerCode,
} from "../kanal/db.ts";

/**
 * Der Betreiber-Kanal für die Betreiber (WI-0124, KANAL-0001 §4.2). Lesen und Schreiben mit `use_operator_channel` (Stufe V); die
 * Regeln (Übergänge, Revision, Idempotenz) prüfen die Funktionen der Migration 0106, hier wird nur gelesen, begrenzt und übersetzt.
 *
 *     GET  /api/kanal/vorgaenge?reiter=offen|abnahme|archiv&q=     Liste mit Zählern und „zuletzt abgeholt“; q sucht Freitext
 *     GET  /api/kanal/vorgaenge/:ops                            Vorgang mit Verlauf, Nachweisen, Fix-Bericht, Bildern
 *     GET  /api/kanal/zaehler                                   die Zahl „zur Abnahme“ für die Schiene
 *     GET  /api/kanal/aenderungen?vor=<id>&q=                  die Gruppe „Fix-Berichte“ im Protokoll, neueste oben, dauerhaft; q sucht
 *     POST /api/kanal/vorgaenge                                 melden
 *     POST /api/kanal/vorgaenge/:ops/nachricht                  eine Nachricht des Betreibers
 *     POST /api/kanal/vorgaenge/:ops/abnehmen                   abnehmen (jeder Betreiber, Entscheidung 17 A)
 *     POST /api/kanal/vorgaenge/:ops/abschliessen               erledigt oder abgebrochen, aus jedem offenen Status (0127)
 *     POST /api/kanal/vorgaenge/:ops/sichten                    einen Vorgang aus Discord freigeben, an Claudio oder Claudia (0231)
 *     POST /api/kanal/vorgaenge/:ops/wieder-oeffnen             wieder öffnen mit Kommentar (W2)
 *     POST /api/kanal/vorgaenge/:ops/loeschen                   „Meldung jetzt löschen“ (nur abgenommen; Protokoll ohne Inhalt)
 *     POST /api/kanal/bilder/:id/entfernen                      „Bild entfernen“ (jederzeit; Protokoll ohne Inhalt)
 *     POST /api/kanal/vorgaenge/:ops/bilder                     ein Bild anhängen (Prüfung wie die Medienverwaltung, Job `kanal_bild`)
 *     GET  /api/kanal/bilder/:id?groesse=ansicht|vorschau        eine gerenderte Fassung (nie das Original), `no-store`, `nosniff`
 *
 * - Schreibklasse `kanal`: unter Kartensperre und Systemsperre offen, denn gemeldet wird gerade dann, wenn etwas gesperrt ist.
 * - Texte gehen als Text hinaus (kein Markdown, kein HTML); die Oberfläche gibt sie so aus.
 * - Grenzen je Person und Stunde: 20 Vorgänge, 120 Einträge (429 `kanal_rate`).
 */

const STATUS_VON: Record<KanalFehlerCode, number> = {
    kanal_not_found: 404,
    kanal_conflict: 409,
    kanal_transition: 409,
    kanal_forbidden: 403,
    kanal_invalid: 422,
};

async function uebersetzt<T>(lauf: () => Promise<T>): Promise<T> {
    try {
        return await lauf();
    } catch (roh) {
        // Auch ein Fehler direkt aus einer Abfrage (SQLSTATE der Klasse KA) wird zum Fachcode.
        const error = kanalFehler(roh);
        if (error instanceof KanalFehler) throw new ApiError(STATUS_VON[error.code], error.code, error.message);
        throw error;
    }
}

function ops(text: string): number {
    const id = leseOps(text);
    if (id === undefined) throw new ApiError(404, "kanal_not_found", "Diesen Vorgang gibt es nicht.");
    return id;
}

const iso = (wert: Date | null): string | null => (wert === null ? null : wert.toISOString());
const bisAufbewahrt = (abgenommen: Date | null): string | null =>
    abgenommen === null ? null : new Date(abgenommen.getTime() + KANAL_AUFBEWAHRUNG_TAGE * 86_400_000).toISOString();

interface ZeilenRow {
    id: string;
    art: "meldung" | "wiederherstellung" | "freigabe";
    kategorie: string;
    prioritaet: "niedrig" | "normal" | "hoch" | "dringend";
    status: KanalVorgang["status"];
    zustaendig: "claudio" | "claudia" | "betreiber";
    titel: string | null;
    kurztitel: string | null;
    gemeldet_von: string | null;
    gemeldet_von_name: string | null;
    /** Nur an Vorgängen aus Discord (0231): der Anzeigename; die Kennung der Person liest diese Route nie. */
    melder_name: string | null;
    gemeldet_at: Date;
    abgenommen_at: Date | null;
    abschluss: KanalZeile["abschluss"];
    /** Nur an Vorgängen, die an die Community gingen (0332): die COM-Nummer in Production. */
    community: string | null;
    abgelaufen_at: Date | null;
    nachweise: number;
    aenderungen: number;
    fix_nachweise: number;
    letzte: Date;
}

function zeile(row: ZeilenRow) {
    return {
        ops: opsId(row.id),
        art: row.art,
        kategorie: row.kategorie,
        prioritaet: row.prioritaet,
        status: row.status,
        zustaendig: row.zustaendig,
        titel: row.titel,
        kurztitel: row.kurztitel,
        gemeldetVon: row.gemeldet_von === null ? null : { id: row.gemeldet_von, name: row.gemeldet_von_name ?? "" },
        ...(row.melder_name === null ? {} : { discordMelder: row.melder_name }),
        gemeldetAt: row.gemeldet_at.toISOString(),
        abgenommenAt: iso(row.abgenommen_at),
        abschluss: row.abschluss,
        ...(row.community === null ? {} : { community: row.community }),
        abgelaufenAt: iso(row.abgelaufen_at),
        nachweise: Math.min(4, Number(row.nachweise)),
        aenderungen: Number(row.aenderungen),
        fixNachweise: Math.min(4, Number(row.fix_nachweise)),
        letzteAktivitaet: row.letzte.toISOString(),
        aufbewahrtBis: row.abgelaufen_at === null ? bisAufbewahrt(row.abgenommen_at) : null,
    };
}

/** Die Zeilen eines Reiters (immer mit der Umgebung der Sitzung); `q` sucht in Nummer, Titeln, Meldung, Schritten und im Verlauf. */
async function zeilen(
    db: Queryable,
    environment: string,
    reiter: KanalReiter,
    q: string | undefined,
): Promise<ReturnType<typeof zeile>[]> {
    const muster = q === undefined ? null : likeMuster(q);
    const rows = await db<ZeilenRow[]>`
        SELECT v.id::text, v.art, v.kategorie, v.prioritaet, v.status, v.zustaendig, v.titel, v.kurztitel, v.gemeldet_von::text,
               p.display_name AS gemeldet_von_name, v.melder_name, v.gemeldet_at, v.abgenommen_at, v.abschluss, v.community, v.abgelaufen_at,
               (SELECT count(DISTINCT n.station) FROM avesmaps_kanal.nachweis n WHERE n.vorgang_id = v.id AND n.runde = v.runde)::int AS nachweise,
               (SELECT count(*) FROM avesmaps_kanal.aenderung a2 WHERE a2.vorgang_id = v.id AND a2.runde = v.runde)::int AS aenderungen,
               (SELECT count(DISTINCT n.station) FROM avesmaps_kanal.nachweis n
                 WHERE n.vorgang_id = v.id AND n.runde = v.runde AND n.station <> 'betreiber_abnahme')::int AS fix_nachweise,
               GREATEST(v.gemeldet_at, COALESCE((SELECT max(e.at) FROM avesmaps_kanal.eintrag e WHERE e.vorgang_id = v.id), v.gemeldet_at)) AS letzte
          FROM avesmaps_kanal.vorgang v
          LEFT JOIN avesmaps_auth.person p ON p.id = v.gemeldet_von
         WHERE v.environment = ${environment}
           AND CASE ${reiter}
                   WHEN 'offen' THEN v.status NOT IN ('zur_abnahme', 'abgenommen')
                   WHEN 'abnahme' THEN v.status = 'zur_abnahme'
                   ELSE v.status = 'abgenommen'
               END
           ${
               muster === null
                   ? db``
                   : db`AND (('OPS-' || lpad(v.id::text, 6, '0')) ILIKE ${muster} ESCAPE '\\'
                          OR v.titel ILIKE ${muster} ESCAPE '\\'
                          OR v.kurztitel ILIKE ${muster} ESCAPE '\\'
                          OR v.nachricht ILIKE ${muster} ESCAPE '\\'
                          OR v.schritte ILIKE ${muster} ESCAPE '\\'
                          OR EXISTS (SELECT 1 FROM avesmaps_kanal.eintrag e
                                      WHERE e.vorgang_id = v.id AND e.text ILIKE ${muster} ESCAPE '\\'))`
           }
         ORDER BY
               CASE WHEN ${reiter} = 'offen' THEN (v.kategorie IN ('stoerung', 'wiederherstellung')) END DESC NULLS LAST,
               -- Was aus Discord zu sichten ist, steht oben: Ohne den Klick eines Betreibers fasst es niemand an (0231).
               CASE WHEN ${reiter} = 'offen' THEN (v.status = 'zu_sichten') END DESC NULLS LAST,
               CASE WHEN ${reiter} = 'offen' THEN array_position(ARRAY['dringend', 'hoch', 'normal', 'niedrig'], v.prioritaet) END,
               CASE WHEN ${reiter} = 'archiv' THEN v.abgenommen_at END DESC NULLS LAST,
               v.gemeldet_at, v.id
         LIMIT 200
    `;
    return rows.map(zeile);
}

function wer(person: string | null, name: string | null, agent: string | null): KanalWer | null {
    if (agent === "claudio" || agent === "claudia") return { art: agent };
    if (person !== null) return { art: "person", id: person, name: name ?? "" };
    return null;
}

async function vorgang(db: Queryable, environment: string, id: number) {
    const [kopf] = await db<
        (ZeilenRow & {
            runde: number;
            revision: number;
            nachricht: string | null;
            schritte: string | null;
            kontext: Record<string, unknown>;
            abgenommen_von: string | null;
            abgenommen_von_name: string | null;
            von_hand_geloescht: boolean;
            folgt_auf: string | null;
        })[]
    >`
        SELECT v.id::text, v.art, v.kategorie, v.prioritaet, v.status, v.zustaendig, v.titel, v.kurztitel, v.gemeldet_von::text,
               p.display_name AS gemeldet_von_name, v.melder_name, v.gemeldet_at, v.abgenommen_at, v.abschluss, v.community, v.abgelaufen_at, v.runde, v.revision, v.nachricht,
               v.schritte, v.kontext, v.abgenommen_von::text, a.display_name AS abgenommen_von_name, v.von_hand_geloescht,
               v.folgt_auf::text,
               (SELECT count(DISTINCT n.station) FROM avesmaps_kanal.nachweis n WHERE n.vorgang_id = v.id AND n.runde = v.runde)::int AS nachweise,
               (SELECT count(*) FROM avesmaps_kanal.aenderung a2 WHERE a2.vorgang_id = v.id AND a2.runde = v.runde)::int AS aenderungen,
               (SELECT count(DISTINCT n.station) FROM avesmaps_kanal.nachweis n
                 WHERE n.vorgang_id = v.id AND n.runde = v.runde AND n.station <> 'betreiber_abnahme')::int AS fix_nachweise,
               GREATEST(v.gemeldet_at, COALESCE((SELECT max(e.at) FROM avesmaps_kanal.eintrag e WHERE e.vorgang_id = v.id), v.gemeldet_at)) AS letzte
          FROM avesmaps_kanal.vorgang v
          LEFT JOIN avesmaps_auth.person p ON p.id = v.gemeldet_von
          LEFT JOIN avesmaps_auth.person a ON a.id = v.abgenommen_von
         WHERE v.id = ${id} AND v.environment = ${environment}
    `;
    if (kopf === undefined) throw new ApiError(404, "kanal_not_found", "Diesen Vorgang gibt es nicht.");
    const [eintraege, nachweise, aenderungen, bilder] = await Promise.all([
        db<
            {
                seq: number;
                art: KanalVorgang["eintraege"][number]["art"];
                von_person: string | null;
                name: string | null;
                von_agent: string | null;
                von_discord: boolean;
                text: string | null;
                status_von: string | null;
                status_nach: string | null;
                bild_id: string | null;
                at: Date;
            }[]
        >`
            SELECT e.seq, e.art, e.von_person::text, p.display_name AS name, e.von_agent, e.von_discord, e.text, e.status_von, e.status_nach,
                   e.bild_id::text, e.at
              FROM avesmaps_kanal.eintrag e LEFT JOIN avesmaps_auth.person p ON p.id = e.von_person
             WHERE e.vorgang_id = ${id} ORDER BY e.seq
        `,
        db<
            {
                runde: number;
                station: KanalVorgang["alleNachweise"][number]["station"];
                commit_sha: string | null;
                release: string | null;
                notiz: string | null;
                von_person: string | null;
                name: string | null;
                von_agent: string | null;
                at: Date;
            }[]
        >`
            SELECT n.runde, n.station, n.commit_sha, n.release, n.notiz, n.von_person::text, p.display_name AS name, n.von_agent, n.at
              FROM avesmaps_kanal.nachweis n LEFT JOIN avesmaps_auth.person p ON p.id = n.von_person
             WHERE n.vorgang_id = ${id} ORDER BY n.id
        `,
        db<AenderungZeile[]>`
            SELECT a.id::text, a.vorgang_id::text, a.grund, a.runde, a.agent, a.klasse, a.art, a.was, a.dateien, a.commit_sha, a.release,
                   a.tests, a.ruecknahme, a.at, a.nachpruefung, a.nachgeprueft_at, a.nachpruefung_notiz
              FROM avesmaps_kanal.aenderung a WHERE a.vorgang_id = ${id} ORDER BY a.id
        `.then((zeilen) => mitBeobachtungen(db, zeilen)),
        db<
            {
                id: string;
                zustand: KanalVorgang["bilder"][number]["zustand"];
                format: string;
                breite: number;
                hoehe: number;
                eintrag_seq: number;
                at: Date;
                abgewiesen_grund: string | null;
            }[]
        >`
            SELECT b.id::text, b.zustand, b.format, b.breite, b.hoehe, b.eintrag_seq, b.at, b.abgewiesen_grund
              FROM avesmaps_kanal.bild b WHERE b.vorgang_id = ${id} AND b.entfernen_ab IS NULL ORDER BY b.at
        `,
    ]);
    const kontext: Record<string, string> = {};
    for (const [schluessel, wert] of Object.entries(kopf.kontext ?? {}))
        if (typeof wert === "string") kontext[schluessel] = wert;
    return {
        ...zeile(kopf),
        runde: kopf.runde,
        revision: kopf.revision,
        nachricht: kopf.nachricht,
        schritte: kopf.schritte,
        kontext,
        abgenommenVon:
            kopf.abgenommen_von === null ? null : { id: kopf.abgenommen_von, name: kopf.abgenommen_von_name ?? "" },
        vonHandGeloescht: kopf.von_hand_geloescht,
        folgtAuf: kopf.folgt_auf === null ? null : opsId(kopf.folgt_auf),
        eintraege: eintraege.map((e) => ({
            seq: e.seq,
            art: e.art,
            // Der Melder aus Discord (`/erledigt`, Migration 0260) ist keine Person der App: sein Anzeigename am Vorgang.
            von: e.von_discord
                ? { art: "discord" as const, name: kopf.melder_name ?? "unbekannt" }
                : (wer(e.von_person, e.name, e.von_agent) ?? { art: "claudio" as const }),
            text: e.text,
            statusVon: e.status_von,
            statusNach: e.status_nach,
            bild: e.bild_id,
            at: e.at.toISOString(),
        })),
        alleNachweise: nachweise.map((n) => ({
            runde: n.runde,
            station: n.station,
            commit: n.commit_sha,
            release: n.release,
            notiz: n.notiz,
            von: wer(n.von_person, n.name, n.von_agent),
            at: n.at.toISOString(),
        })),
        aenderungen: aenderungen.map(({ aenderung }) => aenderung),
        bilder: bilder.map((b) => ({
            id: b.id,
            zustand: b.zustand,
            format: b.format,
            breite: b.breite,
            hoehe: b.hoehe,
            eintragSeq: b.eintrag_seq,
            at: b.at.toISOString(),
            abgewiesenGrund: b.abgewiesen_grund,
        })),
    };
}

interface AenderungZeile {
    id: string;
    vorgang_id: string | null;
    grund: string | null;
    runde: number | null;
    agent: KanalAenderung["agent"];
    klasse: KanalAenderung["klasse"];
    art: KanalAenderung["art"];
    was: string;
    dateien: string[];
    commit_sha: string | null;
    release: string | null;
    tests: string | null;
    ruecknahme: string | null;
    at: Date;
    nachpruefung: KanalAenderung["nachpruefung"];
    nachgeprueft_at: Date | null;
    nachpruefung_notiz: string | null;
}

/** Die Änderungen samt ihren Beobachtungen, wie Vorgang und Protokoll sie zeigen; dazu Vorgang und Grund für das Protokoll. */
async function mitBeobachtungen(
    db: Queryable,
    zeilen: AenderungZeile[],
): Promise<{ aenderung: KanalAenderung; vorgang: number | null; grund: string | null }[]> {
    const ids = zeilen.map((a) => a.id);
    const beobachtungen =
        ids.length === 0
            ? []
            : await db<
                  {
                      aenderung_id: string;
                      ergebnis: KanalAenderung["beobachtungen"][number]["ergebnis"];
                      text: string | null;
                      at: Date;
                  }[]
              >`
                  SELECT b.aenderung_id::text, b.ergebnis, b.text, b.at
                    FROM avesmaps_kanal.beobachtung b WHERE b.aenderung_id = ANY(${ids}::bigint[]) ORDER BY b.id
              `;
    return zeilen.map((a) => ({
        vorgang: a.vorgang_id === null ? null : Number(a.vorgang_id),
        grund: a.grund,
        aenderung: {
            id: Number(a.id),
            runde: a.runde,
            agent: a.agent,
            klasse: a.klasse,
            art: a.art,
            was: a.was,
            dateien: a.dateien,
            commit: a.commit_sha,
            release: a.release,
            tests: a.tests,
            ruecknahme: a.ruecknahme,
            at: a.at.toISOString(),
            nachpruefung: a.nachpruefung,
            nachgeprueftAt: iso(a.nachgeprueft_at),
            nachpruefungNotiz: a.nachpruefung_notiz,
            beobachtungen: beobachtungen
                .filter((b) => b.aenderung_id === a.id)
                .map((b) => ({ ergebnis: b.ergebnis, text: b.text, at: b.at.toISOString() })),
        },
    }));
}

/**
 * Die Gruppe „Fix-Berichte“ (KANAL-0001 §3.1): alle Änderungen dieser Umgebung und die ohne Vorgang, neueste oben, seitenweise. Sie liest
 * nur `aenderung` und `beobachtung`, also nichts, was mit der Meldung abläuft.
 */
async function berichte(
    db: Queryable,
    environment: string,
    vor: number | undefined,
    q: string | undefined,
): Promise<KanalBerichte> {
    const muster = q === undefined ? null : likeMuster(q);
    const zeilen = await db<AenderungZeile[]>`
        SELECT a.id::text, a.vorgang_id::text, a.grund, a.runde, a.agent, a.klasse, a.art, a.was, a.dateien, a.commit_sha, a.release,
               a.tests, a.ruecknahme, a.at, a.nachpruefung, a.nachgeprueft_at, a.nachpruefung_notiz
          FROM avesmaps_kanal.aenderung a LEFT JOIN avesmaps_kanal.vorgang v ON v.id = a.vorgang_id
         WHERE (a.vorgang_id IS NULL OR v.environment = ${environment})
           AND (${vor ?? null}::bigint IS NULL OR a.id < ${vor ?? null}::bigint)
           ${
               muster === null
                   ? db``
                   : db`AND (a.was ILIKE ${muster} ESCAPE '\\'
                          OR a.commit_sha ILIKE ${muster} ESCAPE '\\'
                          OR a.release ILIKE ${muster} ESCAPE '\\'
                          OR a.grund ILIKE ${muster} ESCAPE '\\'
                          OR ('OPS-' || lpad(a.vorgang_id::text, 6, '0')) ILIKE ${muster} ESCAPE '\\')`
           }
         ORDER BY a.id DESC
         LIMIT ${KANAL_BERICHTE_SEITE + 1}
    `;
    const seite = zeilen.slice(0, KANAL_BERICHTE_SEITE);
    const mit = await mitBeobachtungen(db, seite);
    return {
        berichte: mit.map(({ aenderung, vorgang, grund }) => ({
            ...aenderung,
            ops: vorgang === null ? null : opsId(vorgang),
            grund,
        })),
        weiter: zeilen.length > KANAL_BERICHTE_SEITE ? Number(seite.at(-1)?.id) : null,
    };
}

/** Der Medienspeicher der Instanz; ohne `MEDIA_ROOT` nimmt der Kanal kein Bild an (503). */
function speicher(app: FastifyInstance): MediaStore {
    const root = app.config.mediaRoot;
    if (root !== undefined && root !== "") {
        try {
            return new MediaStore(root);
        } catch {
            // ein relativer Pfad: wie ohne Speicher
        }
    }
    throw new ApiError(503, "media_storage_unavailable", "Auf dieser Instanz ist kein Medienspeicher eingerichtet.");
}

/**
 * Die Kennung der Weiterleitung in Production (WI-0297): aus Umgebung und Vorgang, nicht aus dem Klick. Ein zweiter Versuch (neuer Klick, anderes Fenster,
 * eine Antwort, die unterwegs verloren ging) ergibt so denselben Community-Vorgang statt eines zweiten. Form einer UUID (Version 5, Variante RFC 4122).
 */
export function weiterleitungsKennung(environment: string, id: number): string {
    const hex = createHash("sha256")
        .update(`avesmaps-kanal-an-community:${environment}:${String(id)}`)
        .digest("hex");
    const variante = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variante}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Die fertigen Bilder eines Vorgangs für die Weiterleitung (WI-0297): die Fassung `ansicht` (WebP, ohne Metadaten), älteste zuerst, höchstens
 * `COMMUNITY_DISCORD_BILDER_MAX`, je Bild und zusammen in den Grenzen der Brücke. Was nicht passt, nicht fertig ist oder fehlt, zählt als ausgelassen.
 * Ohne Medienspeicher gehen keine Bilder mit.
 */
async function bilderFuerCommunity(
    app: FastifyInstance,
    id: number,
): Promise<{ bilder: { daten: string }[]; ausgelassen: number }> {
    const zeilen = await app.database!<{ id: string; zustand: string }[]>`
        SELECT b.id::text, b.zustand FROM avesmaps_kanal.bild b
         WHERE b.vorgang_id = ${id} AND b.entfernen_ab IS NULL ORDER BY b.at, b.id
    `;
    if (zeilen.length === 0) return { bilder: [], ausgelassen: 0 };
    let store: MediaStore;
    try {
        store = speicher(app);
    } catch {
        return { bilder: [], ausgelassen: zeilen.length };
    }
    const bilder: { daten: string }[] = [];
    let summe = 0;
    for (const zeile of zeilen) {
        if (zeile.zustand !== "bereit" || bilder.length >= COMMUNITY_DISCORD_BILDER_MAX) continue;
        try {
            const bytes = await store.read(channelKey(zeile.id, "ansicht", "webp"), COMMUNITY_DISCORD_BILD_MAX_BYTES);
            if (summe + bytes.length > COMMUNITY_DISCORD_BILDER_MAX_BYTES) continue;
            summe += bytes.length;
            bilder.push({ daten: bytes.toString("base64") });
        } catch (error) {
            if (!(error instanceof MediaStorageError)) throw error;
        }
    }
    return { bilder, ausgelassen: zeilen.length - bilder.length };
}

/** Prüft ein Bild vor jedem Byte auf der Platte wie die Medienverwaltung; ein Bildschirmfoto ist nie ein SVG (415). */
function pruefeBild(bytes: Uint8Array): RasterInspection & { width: number; height: number } {
    let inspection: RasterInspection;
    try {
        inspection = inspectImage(bytes);
    } catch (error) {
        if (error instanceof RasterRejection) throw rejectionError(error);
        throw error;
    }
    if (inspection.format === "svg" || inspection.width === null || inspection.height === null) {
        throw new ApiError(415, "unsupported_media_type", "Angenommen werden PNG, JPEG, GIF und WebP.", {
            reason: "unsupported_format",
        });
    }
    return { ...inspection, width: inspection.width, height: inspection.height };
}

async function grenze(db: Queryable, person: string, art: "vorgaenge" | "eintraege"): Promise<void> {
    const [row] =
        art === "vorgaenge"
            ? await db<{ n: number }[]>`
                  SELECT count(*)::int AS n FROM avesmaps_kanal.vorgang WHERE gemeldet_von = ${person} AND gemeldet_at > now() - interval '1 hour'
              `
            : await db<{ n: number }[]>`
                  SELECT count(*)::int AS n FROM avesmaps_kanal.eintrag WHERE von_person = ${person} AND at > now() - interval '1 hour'
              `;
    const max = art === "vorgaenge" ? KANAL_GRENZE_VORGAENGE_JE_STUNDE : KANAL_GRENZE_EINTRAEGE_JE_STUNDE;
    if ((row?.n ?? 0) >= max) {
        throw new ApiError(429, "kanal_rate", "Für diese Stunde ist die Grenze erreicht. Bitte später weiter.");
    }
}

const receipt = (environment: string, operationId: string, id: number, revision?: number): OperationReceipt => ({
    operationId,
    status: "applied",
    environment,
    affected: [{ kind: "kanal_vorgang", id: opsId(id), ...(revision === undefined ? {} : { revision }) }],
    derivedWork: [],
    warnings: [],
});

export const kanalRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // 🔴 `KANAL=aus` (Betreiber 2026-10-13, Production): Die Capability fällt schon in `auth/plugin.ts` aus jeder Sitzung, der Eintrag und
    // die Glocke verschwinden damit von selbst. Hier kommt nur der ehrliche Satz dazu — sonst stünde da 403 „Dafür fehlt das Recht“,
    // obwohl das Recht nicht fehlt, sondern der Kanal hier nicht lebt. Der Haken läuft vor jeder Route dieses Plugins.
    app.addHook("onRequest", async () => {
        if (app.config.kanal !== "aus") return;
        throw new ApiError(
            KANAL_ERROR_STATUS.kanal_unavailable,
            "kanal_unavailable",
            "Den Kanal gibt es hier nicht. Meldungen bitte auf der Stage.",
        );
    });
    const lesen = protect("use_operator_channel");
    const schreiben = protect("use_operator_channel", { writeClass: "kanal" });
    const db = (): Queryable => app.database!;
    const umgebung = async (request: FastifyRequest) => {
        const session = await adminSession(request);
        return { session, environment: session.environment };
    };

    app.get(
        `${KANAL_URL}/vorgaenge`,
        { ...lesen, schema: { querystring: KanalListeQuery, response: { 200: KanalListe, ...ADMIN_ERRORS } } },
        async (request) => {
            const { environment } = await umgebung(request);
            const reiter = request.query.reiter ?? "offen";
            const [liste, [zaehler], agenten] = await Promise.all([
                zeilen(db(), environment, reiter, request.query.q),
                db()<{ offen: number; abnahme: number; archiv: number }[]>`
                    SELECT count(*) FILTER (WHERE status NOT IN ('zur_abnahme', 'abgenommen'))::int AS offen,
                           count(*) FILTER (WHERE status = 'zur_abnahme')::int AS abnahme,
                           count(*) FILTER (WHERE status = 'abgenommen')::int AS archiv
                      FROM avesmaps_kanal.vorgang WHERE environment = ${environment}
                `,
                db()<
                    { name: "claudio" | "claudia"; zuletzt_abgeholt: Date | null }[]
                >`SELECT name, zuletzt_abgeholt FROM avesmaps_kanal.agent`,
            ]);
            const abgeholt = (name: "claudio" | "claudia"): string | null =>
                iso(agenten.find((agent) => agent.name === name)?.zuletzt_abgeholt ?? null);
            return {
                now: new Date().toISOString(),
                reiter,
                zaehler: zaehler ?? { offen: 0, abnahme: 0, archiv: 0 },
                zuletztAbgeholt: { claudio: abgeholt("claudio"), claudia: abgeholt("claudia") },
                zeilen: liste,
            };
        },
    );

    app.get(
        `${KANAL_URL}/zaehler`,
        { ...lesen, schema: { response: { 200: KanalZaehler, ...ADMIN_ERRORS } } },
        async (request) => {
            const { environment } = await umgebung(request);
            const [[row], agenten] = await Promise.all([
                db()<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM avesmaps_kanal.vorgang
                     WHERE environment = ${environment} AND status = 'zur_abnahme'
                `,
                db()<
                    { name: "claudio" | "claudia"; zuletzt_abgeholt: Date | null }[]
                >`SELECT name, zuletzt_abgeholt FROM avesmaps_kanal.agent`,
            ]);
            const abgeholt = (name: "claudio" | "claudia"): string | null =>
                iso(agenten.find((agent) => agent.name === name)?.zuletzt_abgeholt ?? null);
            return {
                abnahme: row?.n ?? 0,
                zuletztAbgeholt: { claudio: abgeholt("claudio"), claudia: abgeholt("claudia") },
            };
        },
    );

    app.get(
        `${KANAL_URL}/aenderungen`,
        { ...lesen, schema: { querystring: KanalBerichteQuery, response: { 200: KanalBerichte, ...ADMIN_ERRORS } } },
        async (request) => {
            const { environment } = await umgebung(request);
            return berichte(db(), environment, request.query.vor, request.query.q);
        },
    );

    app.get(
        `${KANAL_URL}/vorgaenge/:ops`,
        { ...lesen, schema: { params: KanalOpsParams, response: { 200: KanalVorgang, ...ADMIN_ERRORS } } },
        async (request) => {
            const { environment } = await umgebung(request);
            return vorgang(db(), environment, ops(request.params.ops));
        },
    );

    app.post(
        `${KANAL_URL}/vorgaenge`,
        { ...schreiben, schema: { body: KanalMeldenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } } },
        async (request) => {
            const { session, environment } = await umgebung(request);
            const body = request.body;
            await grenze(db(), session.personId, "vorgaenge");
            // Der Kontext: nur die bekannten Felder aus dem Browser, dazu Umgebung und Release vom Server.
            const kontext: Record<string, string> = { umgebung: environment, release: app.config.releaseId };
            for (const feld of KANAL_KONTEXT_FELDER) {
                const wert = body.kontext?.[feld];
                if (typeof wert === "string" && wert.trim() !== "") kontext[feld] = wert.trim();
            }
            const id = await uebersetzt(() =>
                melden(
                    db(),
                    {
                        environment,
                        person: session.personId,
                        kategorie: body.kategorie,
                        prioritaet: body.prioritaet,
                        titel: body.titel,
                        nachricht: body.nachricht,
                        ...(body.schritte === undefined || body.schritte.trim() === ""
                            ? {}
                            : { schritte: body.schritte }),
                        kontext,
                        ...(body.folgtAuf === undefined ? {} : { folgtAuf: ops(body.folgtAuf) }),
                    },
                    body.operationId,
                ),
            );
            return receipt(environment, body.operationId, id);
        },
    );

    app.post(
        `${KANAL_URL}/vorgaenge/:ops/nachricht`,
        {
            ...schreiben,
            schema: {
                params: KanalOpsParams,
                body: KanalNachrichtBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { session, environment } = await umgebung(request);
            const id = ops(request.params.ops);
            await vorgang(db(), environment, id);
            await grenze(db(), session.personId, "eintraege");
            await uebersetzt(() => nachricht(db(), id, session.personId, request.body.text, request.body.operationId));
            return receipt(environment, request.body.operationId, id);
        },
    );

    app.post(
        `${KANAL_URL}/vorgaenge/:ops/abnehmen`,
        {
            ...schreiben,
            schema: {
                params: KanalOpsParams,
                body: KanalAbnehmenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { session, environment } = await umgebung(request);
            const id = ops(request.params.ops);
            await vorgang(db(), environment, id);
            const revision = await uebersetzt(() =>
                abnehmen(db(), id, session.personId, request.body.baseRevision, request.body.operationId),
            );
            return receipt(environment, request.body.operationId, id, revision);
        },
    );

    app.post(
        `${KANAL_URL}/vorgaenge/:ops/abschliessen`,
        {
            ...schreiben,
            schema: {
                params: KanalOpsParams,
                body: KanalAbschliessenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { session, environment } = await umgebung(request);
            const id = ops(request.params.ops);
            await vorgang(db(), environment, id);
            const revision = await uebersetzt(() =>
                abschliessen(
                    db(),
                    id,
                    session.personId,
                    request.body.baseRevision,
                    request.body.art,
                    request.body.begruendung ?? null,
                    request.body.operationId,
                ),
            );
            return receipt(environment, request.body.operationId, id, revision);
        },
    );

    // Einen Vorgang aus Discord freigeben (WI-0255 Paket 2, Vali „Erst sichten“): Erst danach holt ihn eine Routine ab und liest seinen Text.
    // Das Recht ist das der übrigen Handlungen im Kanal, ohne Passkey: Wer den Kanal benutzt, kann ohnehin jeden Text selbst melden; der
    // Klick hebt also kein Recht, er bezeugt, dass ein Mensch die öffentliche Meldung gelesen hat. Genau ein Eintrag im Protokoll, ohne Text.
    app.post(
        `${KANAL_URL}/vorgaenge/:ops/sichten`,
        {
            ...schreiben,
            schema: {
                params: KanalOpsParams,
                body: KanalSichtenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = ops(request.params.ops);
            await vorgang(db(), session.environment, id);
            const an = request.body.an;
            return adminOperation(
                app.database!,
                session,
                { operationId: request.body.operationId, body: { action: "kanal.sichten", id, an: an ?? null } },
                async (tx) => {
                    const revision = await uebersetzt(() =>
                        sichten(tx, id, session.personId, request.body.baseRevision, an, request.body.operationId),
                    );
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "kanal_vorgang", id: opsId(id), revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.kanal_gesichtet",
                            targetRef: opsId(id),
                            details: { ops: opsId(id), an: an ?? "regel" },
                        },
                    };
                },
            );
        },
    );

    // An die Community weiterleiten (WI-0297; Vali 2026-11-09 zu OPS-000097: „ist eigentlich eine communitymeldung“). Die Redaktion arbeitet in
    // Production, der Kanal lebt hier: Die Meldung geht über die Brücke (WI-0268 C8) dorthin, und erst mit der COM-Nummer von dort endet der Vorgang.
    // Scheitert die Brücke, bleibt er zu sichten. Dasselbe Recht wie die Freigabe, ein Eintrag im Protokoll (`an: community`), ohne Text.
    const bruecke = communityBruecke(app.config.discordInteraktionen?.bruecke);
    app.post(
        `${KANAL_URL}/vorgaenge/:ops/an-community`,
        {
            ...schreiben,
            schema: {
                params: KanalOpsParams,
                body: KanalAnCommunityBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = ops(request.params.ops);
            const { baseRevision, operationId } = request.body;
            const [v] = await db()<
                {
                    status: string;
                    quelle: string;
                    revision: number;
                    kategorie: string;
                    titel: string | null;
                    nachricht: string | null;
                    melder_name: string | null;
                    melder_kennung: string | null;
                    community: string | null;
                }[]
            >`
                SELECT status, quelle, revision, kategorie, titel, nachricht, melder_name, melder_kennung, community
                  FROM avesmaps_kanal.vorgang WHERE id = ${id} AND environment = ${session.environment}
            `;
            if (v === undefined) throw new ApiError(404, "kanal_not_found", "Diesen Vorgang gibt es nicht.");
            let community = v.community;
            const warnings: { code: string; message: string }[] = [];
            if (community === null) {
                const art = COMMUNITY_DISCORD_ARTEN.find((a) => a === v.kategorie);
                if (v.status !== "zu_sichten" || v.quelle !== "discord" || art === undefined) {
                    throw new ApiError(
                        409,
                        "kanal_transition",
                        "Weiterleiten geht nur bei einer Meldung aus Discord, die noch zu sichten ist.",
                    );
                }
                if (v.revision !== baseRevision) {
                    throw new ApiError(409, "kanal_conflict", "Der Vorgang hat sich inzwischen geändert.");
                }
                if (!bruecke.eingeschaltet) {
                    throw new ApiError(
                        503,
                        "kanal_community_aus",
                        "Die Weiterleitung an die Community ist hier nicht eingerichtet.",
                    );
                }
                const { bilder, ausgelassen } = await bilderFuerCommunity(app, id);
                const antwort = await bruecke.anCommunityWeiterleiten({
                    operationId: weiterleitungsKennung(session.environment, id),
                    ops: opsId(id),
                    discordId: v.melder_kennung,
                    name: v.melder_name ?? "Discord",
                    art,
                    titel: v.titel ?? opsId(id),
                    text: v.nachricht ?? v.titel ?? opsId(id),
                    bilder,
                });
                if (antwort.art !== "ok") {
                    // Nur die Klasse des Ausfalls; nie Text, Kennung oder Antwort.
                    request.log.warn(
                        { weg: "an_community", ausfall: antwort.art === "aus" ? "aus" : antwort.grund },
                        "Kanal: Weiterleitung an die Community gescheitert",
                    );
                    throw new ApiError(
                        503,
                        antwort.art === "aus" ? "kanal_community_aus" : "kanal_community_ausfall",
                        "Die Community ist gerade nicht erreichbar. Der Vorgang bleibt zu sichten.",
                    );
                }
                community = antwort.nummer;
                if (ausgelassen > 0) {
                    warnings.push({
                        code: "kanal_bilder_ausgelassen",
                        message: `${String(ausgelassen)} Bild(er) waren zu groß oder nicht fertig und blieben im Kanal.`,
                    });
                }
            }
            const nummer = community;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "kanal.an_community", id } },
                async (tx) => {
                    const revision = await uebersetzt(() =>
                        anCommunity(tx, id, session.personId, baseRevision, nummer, operationId),
                    );
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "kanal_vorgang", id: opsId(id), revision }],
                            derivedWork: [],
                            warnings,
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.kanal_gesichtet",
                            targetRef: opsId(id),
                            details: { ops: opsId(id), an: "community", com: nummer },
                        },
                    };
                },
            );
        },
    );

    app.post(
        `${KANAL_URL}/vorgaenge/:ops/wieder-oeffnen`,
        {
            ...schreiben,
            schema: {
                params: KanalOpsParams,
                body: KanalWiederOeffnenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { session, environment } = await umgebung(request);
            const id = ops(request.params.ops);
            await vorgang(db(), environment, id);
            const revision = await uebersetzt(() =>
                wiederOeffnen(
                    db(),
                    id,
                    session.personId,
                    request.body.baseRevision,
                    request.body.kommentar,
                    request.body.operationId,
                ),
            );
            return receipt(environment, request.body.operationId, id, revision);
        },
    );

    // „Meldung jetzt löschen“: eine Handlung der Verwaltung mit genau einem Eintrag im Protokoll, ohne Inhalt (nur die OPS-ID).
    app.post(
        `${KANAL_URL}/vorgaenge/:ops/loeschen`,
        {
            ...schreiben,
            schema: {
                params: KanalOpsParams,
                body: KanalHandlungBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const id = ops(request.params.ops);
            await vorgang(db(), session.environment, id);
            return adminOperation(
                app.database!,
                session,
                { operationId: request.body.operationId, body: { action: "kanal.loeschen", id } },
                async (tx) => {
                    await uebersetzt(async () => {
                        await tx`SELECT avesmaps_kanal.kanal_loeschen(${id}::bigint, ${session.personId}::uuid)`;
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "kanal_vorgang", id: opsId(id) }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.kanal_purged",
                            targetRef: opsId(id),
                            details: { ops: opsId(id) },
                        },
                    };
                },
            );
        },
    );

    // „Bild entfernen“: jederzeit; genau ein Eintrag im Protokoll, ohne Bild und ohne Text.
    app.post(
        `${KANAL_URL}/bilder/:id/entfernen`,
        {
            ...schreiben,
            schema: {
                params: KanalBildParams,
                body: KanalHandlungBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const [bild] = await db()<{ vorgang_id: string }[]>`
                SELECT b.vorgang_id::text FROM avesmaps_kanal.bild b JOIN avesmaps_kanal.vorgang v ON v.id = b.vorgang_id
                 WHERE b.id = ${request.params.id} AND v.environment = ${session.environment}
            `;
            if (bild === undefined) throw new ApiError(404, "kanal_not_found", "Dieses Bild gibt es nicht.");
            const ref = opsId(bild.vorgang_id);
            return adminOperation(
                app.database!,
                session,
                {
                    operationId: request.body.operationId,
                    body: { action: "kanal.bild_entfernen", id: request.params.id },
                },
                async (tx) => {
                    await uebersetzt(async () => {
                        await tx`SELECT avesmaps_kanal.kanal_bild_entfernen(${request.body.operationId}::uuid, ${request.params.id}::uuid, ${session.personId}::uuid)`;
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "kanal_vorgang", id: ref }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: "system.kanal_image_removed",
                            targetRef: ref,
                            details: { ops: ref },
                        },
                    };
                },
            );
        },
    );

    // Ein Bild anhängen (KANAL-0001 §6.1 Schritt 1): prüfen wie die Medienverwaltung, das Original unter private/kanal/<bild>/ ablegen,
    // Zeile und Eintrag über die Funktion, den Job kanal_bild einreihen. Im Fastify-Prozess wird nichts dekodiert.
    app.post(
        `${KANAL_URL}/vorgaenge/:ops/bilder`,
        {
            ...schreiben,
            bodyLimit: MEDIA_UPLOAD_BODY_LIMIT,
            schema: {
                params: KanalOpsParams,
                body: KanalBildBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const { session, environment } = await umgebung(request);
            const id = ops(request.params.ops);
            const { operationId, file } = request.body;
            // Dieselbe Kennung noch einmal legt nichts zweites ab.
            const [schon] = await db()<{ id: string }[]>`
                SELECT id::text FROM avesmaps_kanal.bild WHERE operation_id = ${operationId}::uuid
            `;
            if (schon !== undefined) return { ...receipt(environment, operationId, id), status: "replayed" as const };
            await vorgang(db(), environment, id);
            await grenze(db(), session.personId, "eintraege");
            const store = speicher(app);
            const bytes = decodeBase64(file, "file");
            const bild = pruefeBild(bytes);
            const bildId = randomUUID();
            const endung = FORMAT_EXTENSION[bild.format];
            const abgelegt = await store.storeChannel(bildId, "original", bytes, endung);
            try {
                const jobId = await uebersetzt(() =>
                    app.database!.begin(async (tx) => {
                        await tx`
                            SELECT avesmaps_kanal.kanal_bild_anlegen(
                                ${operationId}::uuid, ${id}::bigint, ${session.personId}::uuid, ${bildId}::uuid, ${abgelegt.sha256},
                                ${bild.format}, ${bild.width}, ${bild.height}, ${bytes.byteLength}
                            )
                        `;
                        const [job] = await tx<{ public_id: string }[]>`
                            SELECT public_id::text AS public_id
                              FROM job_enqueue(${KANAL_BILD_KIND}, 1::smallint, ${AVENTURIA.mapDomain}, 'kanal',
                                               ${tx.json({ bild: bildId, endung })})
                        `;
                        return job!.public_id;
                    }),
                );
                return {
                    ...receipt(environment, operationId, id),
                    derivedWork: [{ kind: KANAL_BILD_KIND, jobId, state: "queued" as const }],
                };
            } catch (error) {
                // Keine Datei ohne ihre Zeile.
                await store.removeChannel(bildId).catch(() => 0);
                throw error;
            }
        },
    );

    // Eine gerenderte Fassung ausliefern (§6.1 Schritt 3): nur ansicht oder vorschau, nie das Original; vor „bereit“ 409.
    app.get(
        `${KANAL_URL}/bilder/:id`,
        // Ohne Antwortschema: Der Körper ist die Datei (wie /media/); Fehler haben die übliche Form.
        { ...lesen, schema: { params: KanalBildParams, querystring: KanalBildQuery } },
        async (request, reply) => {
            const { environment } = await umgebung(request);
            const groesse = request.query.groesse ?? "ansicht";
            const [bild] = await db()<{ zustand: string }[]>`
                SELECT b.zustand FROM avesmaps_kanal.bild b JOIN avesmaps_kanal.vorgang v ON v.id = b.vorgang_id
                 WHERE b.id = ${request.params.id}::uuid AND v.environment = ${environment} AND b.entfernen_ab IS NULL
            `;
            if (bild === undefined) throw new ApiError(404, "kanal_not_found", "Dieses Bild gibt es nicht.");
            if (bild.zustand !== "bereit") {
                throw new ApiError(409, "kanal_bild_pending", "Das Bild wird noch vorbereitet oder wurde abgewiesen.");
            }
            let datei: { path: string; byteSize: number };
            try {
                datei = await speicher(app).locate(channelKey(request.params.id, groesse, "webp"));
            } catch (error) {
                if (error instanceof MediaStorageError)
                    throw new ApiError(404, "kanal_not_found", "Dieses Bild gibt es nicht.");
                throw error;
            }
            return reply
                .header("content-type", "image/webp")
                .header("content-length", datei.byteSize)
                .header("cache-control", "no-store")
                .header("x-content-type-options", "nosniff")
                .header("content-security-policy", "default-src 'none'")
                .header("content-disposition", "inline")
                .send(createReadStream(datei.path));
        },
    );
};
