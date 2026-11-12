import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AVENTURIA_SERIES, KARTEN_SVG_GLATT, KARTEN_SVG_ROH, KartenSvgEinstellungen } from "@avesmaps3d/shared";
import { Value } from "@sinclair/typebox/value";
import {
    exportWurzel,
    leseSvgZeiger,
    pruefeDatei,
    SVG_ZEIGER,
    type SvgAbzug,
    type SvgZeiger,
} from "../karten-export/quellen.ts";
import type { KartenSvgEingabe } from "../karten-export/svg-auftrag.ts";
import { baueKartenSvg } from "../karten-export/svg/bauer.ts";
import { ladeKartenSvgDaten } from "../karten-export/svg/daten.ts";
import { KARTEN_SVG_GLATT as OPTIONEN_GLATT, KARTEN_SVG_ROH as OPTIONEN_ROH } from "../karten-export/svg/optionen.ts";
import type { Database } from "../database.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Der Auftrag `karten_svg` (WI-0280): die Vektorkarte aus der Datenbank zeichnen und ablegen. Die zwei festen Abzüge (roh und geglättet) entstehen aus EINEM Lesen der Daten,
 * also auf demselben Stand; ein eigener Abzug mit seinen Einstellungen.
 *
 * - **Der Zeiger kommt zuletzt** (`aktuell.json`, atomar): Er nennt nur fertige Dateien. Ein Abbruch hinterlässt höchstens eine Datei ohne Zeiger, die der nächste Lauf räumt.
 * - **Name nach Inhalt:** `<id>-<sha12>.svg`. Ein laufender Download der alten Datei liest weiter, was er angefangen hat: Die alte weicht erst beim nächsten Lauf.
 * - **Aufbewahrung:** je Kennung die aktuelle und die davor. Eigene Abzüge bleiben, solange ein Zugang sie nennt, sonst 30 Tage. Welche Karten ein gültiger Zugang
 *   nennt, sagt `avesmaps_auth.karten_zugang_karten()` (Migration 0324): An der Tafel selbst hat die Jobs-Rolle kein Recht. Darf sie die Funktion noch nicht rufen
 *   (`auth-grants.psql` spielt Claudio ein, nie der Korridor), bleibt jeder eigene Abzug: Lieber eine Datei zu viel als ein Link, der ins Leere zeigt.
 * - Liest nur; `withJobDatabase` nimmt die Jobs-Rolle. Kartendaten schreibt das nicht.
 */

const PHASE = { lesen: 0, bauen: 0.2, schreiben: 0.8 } as const;
const EIGEN_AUFBEWAHREN_MS = 30 * 86_400_000;

export function parseKartenSvgEingabe(input: Record<string, unknown>): KartenSvgEingabe {
    if (input["art"] === "standard") return { art: "standard" };
    if (
        input["art"] === "eigen" &&
        typeof input["id"] === "string" &&
        /^svg-eigen-[0-9a-f]{12}$/u.test(input["id"]) &&
        Value.Check(KartenSvgEinstellungen, input["einstellungen"])
    ) {
        return { art: "eigen", id: input["id"], einstellungen: input["einstellungen"] };
    }
    throw new JobFailure("invalid_input", "Eingabe des Auftrags karten_svg ungültig", false);
}

async function schreibeAtomar(pfad: string, inhalt: string): Promise<void> {
    const zwischen = `${pfad}.neu-${String(process.pid)}`;
    await writeFile(zwischen, inhalt);
    await rename(zwischen, pfad);
}

/** Legt einen Abzug unter seinem Inhalt ab und rechnet seine Prüfsumme vor, damit der erste Abruf nicht darauf wartet. */
async function legeAb(wurzel: string, id: string, svg: string): Promise<string> {
    const name = `${id}-${createHash("sha256").update(svg).digest("hex").slice(0, 12)}.svg`;
    await schreibeAtomar(join(wurzel, name), svg);
    await pruefeDatei(join(wurzel, name));
    return name;
}

/** Die Karten, die ein gültiger Zugang nennt; `null`, solange die Rolle die Funktion nicht rufen darf (dann bleibt jeder eigene Abzug). */
async function genannteKarten(db: Database): Promise<Set<string> | null> {
    // CASE prüft das Schema zuerst: Ohne USAGE dürfte schon das Nachschlagen der Funktion scheitern.
    const [recht] = await db<{ darf: boolean | null }[]>`
        SELECT CASE WHEN has_schema_privilege(current_user, to_regnamespace('avesmaps_auth')::oid, 'USAGE')
                    THEN has_function_privilege(current_user, to_regprocedure('avesmaps_auth.karten_zugang_karten()')::oid, 'EXECUTE')
               END AS darf
    `;
    if (recht?.darf !== true) return null;
    const [zeile] = await db<{ karten: string[] | null }[]>`SELECT avesmaps_auth.karten_zugang_karten() AS karten`;
    return new Set(zeile?.karten ?? []);
}

/** Räumt, was kein Zeiger mehr nennt und nicht die letzte Fassung davor ist. */
async function raeumeAuf(wurzel: string, zeiger: SvgZeiger, vorige: readonly string[]): Promise<void> {
    const bleibt = new Set([...Object.values(zeiger.abzuege).map((a) => a.datei), ...vorige]);
    for (const name of await readdir(wurzel)) {
        const datei = name.replace(/\.pruefung\.json$/u, "");
        if (!/^svg-[a-z0-9-]+-[0-9a-f]{12}\.svg$/u.test(datei) && !name.includes(".neu-")) continue;
        if (!bleibt.has(datei)) await rm(join(wurzel, name), { force: true });
    }
}

/** Die Einstellungen im Dateikopf einer Zeile: was der Abzug ist, ohne die Datei zu öffnen. */
function beschreibung(einstellungen: KartenSvgEinstellungen): string {
    const px = einstellungen.groessePx.toLocaleString("de-DE");
    const programm = einstellungen.dialekt === "inkscape" ? "Inkscape" : "Illustrator";
    return `${programm} · ${px} px · ${String(einstellungen.ebenen.length)} Ebenen`;
}

export async function runKartenSvg(
    context: JobContext,
    mitDatenbank: <T>(arbeit: (db: Database) => Promise<T>) => Promise<T> = withJobDatabase,
): Promise<Record<string, unknown>> {
    const eingabe = parseKartenSvgEingabe(context.input);
    // Ohne Angabe die Routine, wie Legacys Zeiger ohne das Feld; „SVG erzeugen“ schreibt `manuell` in die Eingabe (`svg-auftrag.ts`).
    const quelle = context.input["quelle"] === "manuell" ? "manuell" : "routine";
    const wurzel = exportWurzel(process.env, process.env["TILE_ROOT"]?.trim());
    if (wurzel === undefined) throw new JobFailure("tile_root_missing", "TILE_ROOT ist nicht gesetzt", false);
    await mkdir(wurzel, { recursive: true, mode: 0o750 });

    await context.beginPhase("lesen", PHASE.lesen);
    const { daten, genannt } = await mitDatenbank(async (db) => {
        // Ein Stand für alle zwölf Abfragen: Während des Lesens darf ein Editor speichern, ohne dass der Abzug halb davor und halb danach liegt.
        const geladen = await db.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", (tx) =>
            ladeKartenSvgDaten(tx, context.job.mapDomainId ?? AVENTURIA_SERIES.mapDomain),
        );
        return { daten: geladen, genannt: await genannteKarten(db) };
    });
    context.checkpoint();

    await context.beginPhase("bauen", PHASE.bauen);
    const erstellt = new Date().toISOString();
    const neu: Record<string, SvgAbzug> = {};
    const baue = async (
        id: string,
        name: string,
        beschrieb: string,
        optionen: Parameters<typeof baueKartenSvg>[1],
    ): Promise<void> => {
        const { svg } = baueKartenSvg(daten, optionen, { erstellt });
        context.checkpoint();
        neu[id] = {
            datei: await legeAb(wurzel, id, svg),
            fassung: daten.staende.kartenfassung,
            erstellt,
            name,
            pixel: optionen.groessePx,
            beschreibung: beschrieb,
            quelle,
        };
    };
    if (eingabe.art === "standard") {
        await baue(KARTEN_SVG_ROH, "SVG, roh", "Stützpunkte wie in den Daten, volle Semantik", OPTIONEN_ROH);
        await baue(KARTEN_SVG_GLATT, "SVG, geglättet", "Kurven wie auf der Karte, volle Semantik", OPTIONEN_GLATT);
    } else {
        await baue(eingabe.id, "SVG, eigene Einstellungen", beschreibung(eingabe.einstellungen), eingabe.einstellungen);
    }

    await context.beginPhase("schreiben", PHASE.schreiben);
    const alt = await leseSvgZeiger(wurzel);
    const jetzt = Date.now();
    const bleiben = Object.entries(alt.abzuege).filter(
        ([id, abzug]) =>
            id === KARTEN_SVG_ROH ||
            id === KARTEN_SVG_GLATT ||
            genannt === null ||
            genannt.has(id) ||
            jetzt - new Date(abzug.erstellt).getTime() < EIGEN_AUFBEWAHREN_MS,
    );
    const zeiger: SvgZeiger = { abzuege: { ...Object.fromEntries(bleiben), ...neu } };
    await schreibeAtomar(join(wurzel, SVG_ZEIGER), JSON.stringify(zeiger, null, 2));
    const vorige = Object.keys(neu)
        .map((id) => alt.abzuege[id]?.datei)
        .filter((datei): datei is string => datei !== undefined);
    await raeumeAuf(wurzel, zeiger, vorige);
    return {
        abzuege: Object.fromEntries(Object.entries(neu).map(([id, a]) => [id, a.datei])),
        fassung: daten.staende.kartenfassung,
    };
}
