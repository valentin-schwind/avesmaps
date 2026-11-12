import { stat } from "node:fs/promises";
import { basename } from "node:path";
import {
    WIKISYNC_AUFTRAGSARTEN,
    WIKISYNC_BEREICHE,
    WIKI_DUMP_HOLEN_ART,
    type WikisyncAuftrag,
    type WikisyncDumpHolen,
    type WikisyncDumpNamensraum,
    type WikisyncDumpStand,
    type WikisyncKategorienDatei,
    type WikisyncStand,
    type WikisyncVorschauStand,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { KEIN_UMSTAND, wartegrund, type Warteumstand } from "../../jobs/wartegrund.ts";
import { isMissingTable } from "../../system/state-row.ts";
import { dumpHolenErlaubt, wikiKonfiguration } from "../config.ts";
import { waehleDump } from "../dump/datei.ts";
import { waehleKategorienDatei } from "../kategorien/datei.ts";
import { standAusDateiname } from "../dump/manifest.ts";
import { legacyZugLaeuft } from "./legacy-zug.ts";

/**
 * Der Stand des WikiSync für den Reiter der Systemsteuerung (WI-0253 UI-1): der Dump im Ordner, der jüngste Lauf der Vorschau und die Aufträge, die
 * warten oder laufen. 🔴 Nur gelesen, nichts angestoßen, und das Wiki wird nie gefragt: Der Dump ist eine Datei im Ordner (`WIKI_DUMP_ROOT`), seine
 * Prüfsumme und Seiten kommen aus dem, was ein Einlesen (`wiki_dump_einlesen`) oder eine Vorschau über GENAU diese Datei abgelegt haben.
 *
 * Fehlt eine Tafel (vor Migration 0224) oder der Ordner, ist der Teil unbekannt, nichts bricht.
 */

type Zeile = Record<string, unknown>;

const zeit = (wert: unknown): string | null => (wert instanceof Date ? wert.toISOString() : null);
const text = (wert: unknown): string | null => (typeof wert === "string" ? wert : null);
const ganz = (wert: unknown): number | null =>
    typeof wert === "number" && Number.isInteger(wert)
        ? wert
        : typeof wert === "string" && /^\d+$/u.test(wert)
          ? Number(wert)
          : null;

const LEER: WikisyncDumpStand = {
    ordner: false,
    datei: null,
    geholtAm: null,
    groesse: null,
    stand: null,
    seiten: null,
    sha256: null,
    vollstaendig: null,
    namensraeume: [],
};

/** Die jüngste Dump-Datei des Ordners: Name, Dateizeit, Größe. Ohne Ordner oder Datei `null`. */
async function dumpDatei(
    environment: NodeJS.ProcessEnv,
): Promise<{ ordner: boolean; datei: string | null; zeit: Date | null; groesse: number | null }> {
    const wurzel = wikiKonfiguration(environment).dumpWurzel;
    if (wurzel === undefined) return { ordner: false, datei: null, zeit: null, groesse: null };
    try {
        const pfad = await waehleDump(wurzel, undefined);
        const eintrag = await stat(pfad);
        return { ordner: true, datei: basename(pfad), zeit: eintrag.mtime, groesse: eintrag.size };
    } catch {
        // Kein Ordner oder keine Datei: Der Ordner zählt als eingerichtet, wenn er sich lesen lässt.
        const ordner = await stat(wurzel)
            .then((eintrag) => eintrag.isDirectory())
            .catch(() => false);
        return { ordner, datei: null, zeit: null, groesse: null };
    }
}

/** Die jüngste Kategorien-Datei (`dump_categorylinks-*.sql.gz`, WI-0294) im Dump-Ordner: Name, Dateizeit, Größe, Datum aus dem Namen. Ohne Ordner oder Datei alles `null`. */
async function kategorienDatei(environment: NodeJS.ProcessEnv): Promise<WikisyncKategorienDatei> {
    const leer: WikisyncKategorienDatei = { datei: null, geholtAm: null, groesse: null, stand: null };
    const wurzel = wikiKonfiguration(environment).dumpWurzel;
    if (wurzel === undefined) return leer;
    try {
        const pfad = await waehleKategorienDatei(wurzel, undefined);
        const eintrag = await stat(pfad);
        const name = basename(pfad);
        return {
            datei: name,
            geholtAm: eintrag.mtime.toISOString(),
            groesse: eintrag.size,
            stand: standAusDateiname(name),
        };
    } catch {
        // Kein Ordner oder keine Datei: Es gibt keine Kategorien-Datei (die Übernahme der Bereiche mit Kategorien steht dann aus).
        return leer;
    }
}

/** Das jüngste Einlesen genau dieser Datei: Prüfsumme, Stand, Seiten, Namensräume. */
async function einlesenDerDatei(db: Queryable, datei: string): Promise<Partial<WikisyncDumpStand> | undefined> {
    const zeilen = await db<{ result: unknown }[]>`
        SELECT result FROM job
         WHERE kind = 'wiki_dump_einlesen' AND state = 'SUCCEEDED' AND result IS NOT NULL
         ORDER BY finished_at DESC NULLS LAST, id DESC
         LIMIT 10
    `;
    for (const { result } of zeilen) {
        const manifest = (result as { manifest?: Zeile } | null)?.manifest;
        if (manifest === undefined || manifest["datei"] !== datei) continue;
        const stand = (manifest["stand"] as { wert?: unknown } | undefined)?.wert;
        const raeume = Array.isArray(manifest["namensraeume"]) ? (manifest["namensraeume"] as Zeile[]) : [];
        const namensraeume: WikisyncDumpNamensraum[] = raeume.flatMap((raum) => {
            const nr = ganz(raum["nr"]);
            const seiten = ganz(raum["seiten"]);
            return nr === null || seiten === null ? [] : [{ nr, name: text(raum["name"]), seiten }];
        });
        return {
            sha256: text(manifest["sha256"]),
            stand: text(stand),
            seiten: ganz(manifest["seiten"]),
            vollstaendig: typeof manifest["vollstaendig"] === "boolean" ? manifest["vollstaendig"] : null,
            namensraeume,
        };
    }
    return undefined;
}

/** Der jüngste Lauf der Vorschau, gleich in welchem Zustand. */
async function juengsteVorschau(db: Queryable): Promise<WikisyncVorschauStand | null> {
    const [zeile] = await db<Zeile[]>`
        SELECT l.id::int AS id, l.status, l.bereiche, l.gestartet_am, l.beendet_am, l.fehler, l.dump_datei, l.dump_sha256, l.dump_stand,
               l.kategorien_datei, l.kategorien_sha256, l.kategorien_stand, l.kategorien_zeilen::int AS kategorien_zeilen,
               l.dump_seiten::int AS dump_seiten, l.dump_vollstaendig, l.tafel_revision::int AS tafel_revision,
               COALESCE(p.display_name, l.ausgeloest_label) AS wer
          FROM wikisync_lauf l
          LEFT JOIN avesmaps_auth.person p ON p.id = l.ausgeloest_von
         WHERE l.art = 'vorschau'
         ORDER BY l.id DESC
         LIMIT 1
    `;
    if (zeile === undefined) return null;
    const bereiche = (Array.isArray(zeile["bereiche"]) ? (zeile["bereiche"] as string[]) : []).filter(
        (bereich): bereich is WikisyncVorschauStand["bereiche"][number] =>
            (WIKISYNC_BEREICHE as readonly string[]).includes(bereich),
    );
    return {
        id: Number(zeile["id"]),
        status: zeile["status"] as WikisyncVorschauStand["status"],
        bereiche,
        gestartetAm: zeit(zeile["gestartet_am"]) ?? "",
        beendetAm: zeit(zeile["beendet_am"]),
        fehler: text(zeile["fehler"]),
        dumpDatei: text(zeile["dump_datei"]),
        dumpStand: text(zeile["dump_stand"]),
        kategorien:
            text(zeile["kategorien_sha256"]) !== null && zeile["kategorien_stand"] instanceof Date
                ? {
                      datei: text(zeile["kategorien_datei"]) ?? "",
                      stand: zeile["kategorien_stand"].toISOString(),
                      zeilen: ganz(zeile["kategorien_zeilen"]) ?? 0,
                  }
                : null,
        tafelRevision: ganz(zeile["tafel_revision"]),
        ausgeloestVon: text(zeile["wer"]),
    };
}

/** Was die jüngste fertige Vorschau über GENAU diese Datei weiß (wenn es kein Einlesen gibt). */
async function vorschauDerDatei(db: Queryable, datei: string): Promise<Partial<WikisyncDumpStand> | undefined> {
    const [zeile] = await db<Zeile[]>`
        SELECT dump_sha256, dump_stand, dump_seiten::int AS dump_seiten, dump_vollstaendig
          FROM wikisync_lauf
         WHERE art = 'vorschau' AND status = 'fertig' AND dump_datei = ${datei}
         ORDER BY id DESC
         LIMIT 1
    `;
    if (zeile === undefined) return undefined;
    return {
        sha256: text(zeile["dump_sha256"]),
        stand: text(zeile["dump_stand"]),
        seiten: ganz(zeile["dump_seiten"]),
        vollstaendig: typeof zeile["dump_vollstaendig"] === "boolean" ? zeile["dump_vollstaendig"] : null,
    };
}

/**
 * Die Aufträge des WikiSync, die warten oder laufen. Ein wartender sagt, worauf er wartet, wenn es einen Grund gibt: ein Legacy-Zug, der läuft (hier oder, laut Stand des Dirigenten, in einer
 * anderen Umgebung desselben Hosts): `wartetAuf: "legacy_zug"`; oder, beim Holen des Dumps, das der Korridor ausführt, dass es auf dessen Abholung wartet: `"abholung"`.
 */
async function auftraege(db: Queryable, zugAnderswo: boolean, umstand: Warteumstand): Promise<WikisyncAuftrag[]> {
    const zug = zugAnderswo || (await legacyZugLaeuft(db));
    const zeilen = await db<Zeile[]>`
        SELECT j.kind, j.state, j.phase, j.progress::float8 AS progress, j.queued_at, j.started_at, p.display_name, j.input_ref,
               j.public_id::text AS public_id, j.wait_reason
          FROM job j
          LEFT JOIN avesmaps_auth.person p ON p.id::text = j.actor_ref
         WHERE j.state IN ('QUEUED', 'RUNNING') AND j.kind = ANY (${[...WIKISYNC_AUFTRAGSARTEN]}::text[])
         ORDER BY (j.state = 'RUNNING') DESC, j.queued_at
         LIMIT 20
    `;
    return zeilen.map((zeile) => {
        const bereiche = bereicheDesAuftrags(zeile["kind"], zeile["input_ref"]);
        const wartet = zeile["state"] === "QUEUED";
        // Nur das Holen des Dumps hat eine Abholart; für jede andere Art bleibt es beim Legacy-Zug.
        const abholung =
            wartet &&
            zeile["kind"] === WIKI_DUMP_HOLEN_ART &&
            wartegrund(
                {
                    kind: String(zeile["kind"]),
                    state: "QUEUED",
                    waitReason: text(zeile["wait_reason"]),
                    publicId: String(zeile["public_id"]),
                },
                umstand,
            ) === "waits_pickup";
        return {
            art: zeile["kind"] as WikisyncAuftrag["art"],
            zustand: zeile["state"] as WikisyncAuftrag["zustand"],
            phase: text(zeile["phase"]),
            fortschritt: typeof zeile["progress"] === "number" ? zeile["progress"] : null,
            eingereihtAm: zeit(zeile["queued_at"]) ?? "",
            gestartetAm: zeit(zeile["started_at"]),
            ausgeloestVon: text(zeile["display_name"]),
            ...(abholung
                ? { wartetAuf: "abholung" as const }
                : zug && wartet
                  ? { wartetAuf: "legacy_zug" as const }
                  : {}),
            ...(bereiche === undefined ? {} : { bereiche }),
        };
    });
}

/**
 * Die Bereiche, für die ein Auftrag im verketteten Lauf arbeitet (WI-0253 §20): bei der Vorschau die Bereiche ihrer Folge, bei der Übernahme ihre `bereiche`. Eine Vorschau ohne Folge nennt keine: Sie gehört zu keinem solchen Lauf.
 */
function bereicheDesAuftrags(art: unknown, eingabe: unknown): WikisyncAuftrag["bereiche"] {
    const roh = eingabe as { folge?: { bereiche?: unknown }; bereiche?: unknown } | null | undefined;
    const liste =
        art === "wiki_vorschau" ? roh?.folge?.bereiche : art === "wiki_uebernehmen" ? roh?.bereiche : undefined;
    if (!Array.isArray(liste)) return undefined;
    return WIKISYNC_BEREICHE.filter((bereich) => liste.includes(bereich));
}

/** Das jüngste beendete Holen des Dumps über die Warteschlange: wann, wer, mit welchem Satz des Betriebs. Ein Holen des Timers läuft außerhalb und steht hier nicht. */
async function juengstesHolen(db: Queryable): Promise<WikisyncDumpHolen["letzter"]> {
    const [zeile] = await db<Zeile[]>`
        SELECT j.state, j.finished_at, j.error_summary, j.result->>'zusammenfassung' AS zusammenfassung, p.display_name
          FROM job j
          LEFT JOIN avesmaps_auth.person p ON p.id::text = j.actor_ref
         WHERE j.kind = ${WIKI_DUMP_HOLEN_ART} AND j.finished_at IS NOT NULL
         ORDER BY j.finished_at DESC, j.id DESC
         LIMIT 1
    `;
    if (zeile === undefined) return null;
    const status =
        zeile["state"] === "SUCCEEDED" ? "fertig" : zeile["state"] === "FAILED" ? "fehlgeschlagen" : "abgebrochen";
    const meldung = (status === "fertig" ? text(zeile["zusammenfassung"]) : text(zeile["error_summary"]))?.trim() ?? "";
    return {
        status,
        beendetAm: zeit(zeile["finished_at"]) ?? "",
        ausgeloestVon: text(zeile["display_name"]),
        meldung: meldung === "" ? null : meldung.slice(0, 500),
    };
}

async function ohneTafel<T>(lesen: () => Promise<T>, sonst: T): Promise<T> {
    try {
        return await lesen();
    } catch (error) {
        if (isMissingTable(error)) return sonst;
        throw error;
    }
}

export async function leseWikisyncStand(
    db: Queryable,
    jetzt: Date,
    environment: NodeJS.ProcessEnv,
    optionen: { zugAnderswo?: boolean; umstand?: Warteumstand } = {},
): Promise<WikisyncStand> {
    const datei = await dumpDatei(environment);
    let dump: WikisyncDumpStand = { ...LEER, ordner: datei.ordner };
    if (datei.datei !== null) {
        const belegt =
            (await ohneTafel(() => einlesenDerDatei(db, datei.datei!), undefined)) ??
            (await ohneTafel(() => vorschauDerDatei(db, datei.datei!), undefined));
        dump = {
            ...dump,
            datei: datei.datei,
            geholtAm: datei.zeit?.toISOString() ?? null,
            groesse: datei.groesse,
            stand: standAusDateiname(datei.datei),
            ...belegt,
        };
        // Der Dateiname schlägt das Einlesen nicht: Steht ein Datum darin, ist es der Stand, den das Wiki selbst gesetzt hat.
        dump.stand = standAusDateiname(datei.datei) ?? belegt?.stand ?? null;
    }
    const [tafel] = await ohneTafel<{ revision: number }[]>(
        async () => [
            ...(await db<{ revision: number }[]>`SELECT revision::int AS revision FROM canon_table_state WHERE id = 1`),
        ],
        [],
    );
    const urteil = dumpHolenErlaubt(environment);
    return {
        jetzt: jetzt.toISOString(),
        dump,
        kategorienDatei: await kategorienDatei(environment),
        dumpHolen: {
            erlaubt: urteil.erlaubt,
            grund: urteil.erlaubt ? null : urteil.grund,
            letzter: await ohneTafel(() => juengstesHolen(db), null),
        },
        vorschau: await ohneTafel(() => juengsteVorschau(db), null),
        tafelRevision: tafel?.revision ?? null,
        auftraege: await auftraege(db, optionen.zugAnderswo === true, optionen.umstand ?? KEIN_UMSTAND),
    };
}
