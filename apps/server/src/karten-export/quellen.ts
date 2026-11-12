import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { crc32 } from "node:zlib";
import {
    AVENTURIA_SERIES,
    KARTEN_SVG_GLATT,
    KARTEN_SVG_ROH,
    LEGAL_NOTICES,
    wirksamerKatalog,
    type KartenEintrag,
    type KartenSvgQuelle,
    type MapSeries,
    type MapSeriesLicense,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ablageAus, juengsteQuelle } from "../map-series/ablage.ts";
import { leseZeiger } from "../map-series/fassungen.ts";
import { leseKartenserien } from "../map-series/stand.ts";
import { planeZip, type ZipEintrag, type ZipPlan } from "./zip.ts";

/**
 * Welche Kartendateien es auf diesem Server gibt (WI-0280): je Kartenserie die Quelle unter `map-sources/<serie>/` (dieselbe Datei, aus der ihre Kacheln
 * entstanden, unverändert), dazu die Abzüge der Vektorkarte unter `karten-export/`. Der Katalog der Serien ist der wirksame aus `map_series`: Eine neue Serie
 * erscheint von selbst, eine im Papierkorb nicht mehr.
 *
 * - **Die Prüfsumme liegt neben der Datei** (`<datei>.pruefung.json`, gültig für Größe und Änderungszeit): Das ZIP braucht sie, bevor sein erstes Byte hinausgeht
 *   (`zip.ts`), und über 1,8 GB rechnet man sie nicht je Abruf. `stand` stößt sie beim Öffnen des Fensters an, sonst der erste Abruf, einmal je Datei
 *   (`laufend`). Ist der Ordner nicht beschreibbar, bleibt sie im Speicher.
 * - 🔴 **Fehlt eine Quelle, sagt die Zeile das** (`bytes: null`). Ersatzweise aus den Kacheln gebaut wird nichts: Das wäre eine andere, verlustbehaftete Datei unter
 *   demselben Namen.
 */

export interface KartenDatei {
    readonly eintrag: KartenEintrag;
    /** `null`: Die Datei liegt hier nicht vor. */
    readonly pfad: string | null;
    readonly zeit: Date | null;
    readonly nennung: string | null;
    /** Nur bei SVG-Abzügen: wer ihn erzeugt hat (`X-Avesmaps-Quelle`). */
    readonly quelle?: KartenSvgQuelle;
}

export interface Pruefung {
    readonly bytes: number;
    readonly mtimeMs: number;
    readonly crc32: number;
    readonly sha256: string;
}

const laufend = new Map<string, Promise<Pruefung>>();
const gemerkt = new Map<string, Pruefung>();

/** Die Wurzel der Abzüge: neben `map-sources`, also dort, wo App und Auftrag schreiben dürfen. */
export function exportWurzel(env: NodeJS.ProcessEnv, tileRoot: string | undefined): string | undefined {
    const ablage = ablageAus(env, tileRoot);
    return ablage === undefined ? undefined : resolve(ablage.wurzel, "..", "karten-export");
}

async function rechnePruefung(pfad: string, bytes: number, mtimeMs: number): Promise<Pruefung> {
    const hash = createHash("sha256");
    let crc = 0;
    for await (const stueck of createReadStream(pfad)) {
        hash.update(stueck as Buffer);
        crc = crc32(stueck as Buffer, crc);
    }
    return { bytes, mtimeMs, crc32: crc, sha256: hash.digest("hex") };
}

function gilt(pruefung: Pruefung | undefined, bytes: number, mtimeMs: number): pruefung is Pruefung {
    return pruefung !== undefined && pruefung.bytes === bytes && pruefung.mtimeMs === mtimeMs;
}

/** Die schon bekannte Prüfsumme, ohne zu rechnen; `null`, wenn sie noch fehlt. */
export async function bekanntePruefung(pfad: string): Promise<Pruefung | null> {
    const datei = await stat(pfad);
    const imSpeicher = gemerkt.get(pfad);
    if (gilt(imSpeicher, datei.size, datei.mtimeMs)) return imSpeicher;
    try {
        const vonPlatte = JSON.parse(await readFile(`${pfad}.pruefung.json`, "utf8")) as Pruefung;
        if (gilt(vonPlatte, datei.size, datei.mtimeMs)) {
            gemerkt.set(pfad, vonPlatte);
            return vonPlatte;
        }
    } catch {
        // Noch keine da oder unlesbar: neu rechnen.
    }
    return null;
}

/** Die Prüfsumme der Datei; rechnet sie höchstens einmal zugleich und merkt sie sich neben der Datei. */
export function pruefeDatei(pfad: string): Promise<Pruefung> {
    const offen = laufend.get(pfad);
    if (offen !== undefined) return offen;
    const lauf = (async (): Promise<Pruefung> => {
        const bekannt = await bekanntePruefung(pfad);
        if (bekannt !== null) return bekannt;
        const datei = await stat(pfad);
        const neu = await rechnePruefung(pfad, datei.size, datei.mtimeMs);
        gemerkt.set(pfad, neu);
        await writeFile(`${pfad}.pruefung.json`, JSON.stringify(neu)).catch(() => undefined);
        return neu;
    })().finally(() => laufend.delete(pfad));
    laufend.set(pfad, lauf);
    return lauf;
}

/** Die Quelle, aus der die aktuelle Fassung zerlegt wurde; ohne diesen Auftrag (die drei Serien der Vorgabe) die jüngste Datei im Ordner. */
async function quelleVon(
    db: Queryable | undefined,
    wurzel: string,
    serie: string,
    revision: string | null,
): Promise<string | null> {
    if (db !== undefined && revision !== null) {
        const [zeile] = await db<{ quelle: string | null }[]>`
            SELECT result->>'quelle' AS quelle FROM job
             WHERE kind = 'map_series_tile' AND state = 'SUCCEEDED'
               AND input_ref->>'serie' = ${serie} AND result->>'revision' = ${revision}
             ORDER BY finished_at DESC, id DESC LIMIT 1
        `;
        const name = zeile?.quelle ?? null;
        if (name !== null && /^[0-9a-f]{12}\.png$/u.test(name)) {
            const pfad = join(wurzel, serie, name);
            if (
                await stat(pfad).then(
                    () => true,
                    () => false,
                )
            )
                return pfad;
        }
    }
    const juengste = await juengsteQuelle(join(wurzel, serie));
    return juengste === undefined ? null : join(wurzel, serie, juengste);
}

async function pngZeile(
    db: Queryable | undefined,
    serie: MapSeries,
    wurzel: string | undefined,
    tileRoot: string | undefined,
): Promise<KartenDatei> {
    const zeiger = tileRoot === undefined ? null : await leseZeiger(tileRoot, serie.id);
    const revision = zeiger?.revision ?? null;
    const pfad = wurzel === undefined ? null : await quelleVon(db, wurzel, serie.id, revision);
    const datei = pfad === null ? null : await stat(pfad).catch(() => null);
    const pruefung = pfad === null || datei === null ? null : await bekanntePruefung(pfad).catch(() => null);
    return {
        eintrag: {
            id: serie.id,
            art: "png",
            name: serie.label,
            beschreibung: serie.description,
            datei: `avesmaps-${serie.id}-${String(serie.sourcePixels)}px.png`,
            bytes: datei?.size ?? null,
            stand: datei?.mtime.toISOString() ?? null,
            fassung: revision,
            pixel: serie.sourcePixels,
            sha256: pruefung?.sha256 ?? null,
            nurEditoren: serie.visibility === "EDITOR_ONLY",
        },
        pfad: datei === null ? null : pfad,
        zeit: datei?.mtime ?? null,
        nennung: serie.attribution,
    };
}

export interface SvgAbzug {
    readonly datei: string;
    readonly fassung: string;
    readonly erstellt: string;
    readonly name: string;
    readonly pixel: number;
    readonly beschreibung: string;
    /** Fehlt bei Zeigern von vor dem 2026-11-05: Die waren die Routine, so hat es angefangen (Legacy ebenso). */
    readonly quelle?: KartenSvgQuelle;
}

export interface SvgZeiger {
    readonly abzuege: Readonly<Record<string, SvgAbzug>>;
}

export const SVG_ZEIGER = "aktuell.json";
const SVG_ZEILEN = [KARTEN_SVG_ROH, KARTEN_SVG_GLATT] as const;

/** Der Zeiger der Abzüge. 🔴 Er ist die Wahrheit, nicht der Ordner: Er wird zuletzt geschrieben und nennt nur fertige Dateien (Legacy: „newest file“ gäbe halbe heraus). */
export async function leseSvgZeiger(wurzel: string | undefined): Promise<SvgZeiger> {
    if (wurzel === undefined) return { abzuege: {} };
    try {
        return JSON.parse(await readFile(join(wurzel, SVG_ZEIGER), "utf8")) as SvgZeiger;
    } catch {
        return { abzuege: {} };
    }
}

async function svgZeile(wurzel: string | undefined, id: string, abzug: SvgAbzug | undefined): Promise<KartenDatei> {
    const pfad = wurzel === undefined || abzug === undefined ? null : join(wurzel, abzug.datei);
    const datei = pfad === null ? null : await stat(pfad).catch(() => null);
    const pruefung = pfad === null || datei === null ? null : await bekanntePruefung(pfad).catch(() => null);
    return {
        eintrag: {
            id,
            art: "svg",
            name: abzug?.name ?? id,
            beschreibung: abzug?.beschreibung ?? "",
            datei: `avesmaps-karte-${id.replace(/^svg-/u, "")}.svg`,
            bytes: datei?.size ?? null,
            stand: abzug?.erstellt ?? null,
            fassung: abzug?.fassung ?? null,
            pixel: abzug?.pixel ?? null,
            sha256: pruefung?.sha256 ?? null,
            nurEditoren: false,
        },
        pfad: datei === null ? null : pfad,
        zeit: datei?.mtime ?? null,
        nennung: null,
        quelle: abzug?.quelle === "manuell" ? "manuell" : "routine",
    };
}

export interface KartenBestand {
    readonly dateien: readonly KartenDatei[];
    readonly lizenz: MapSeriesLicense;
}

/** Alle Karten dieses Servers, in der Reihenfolge des Katalogs: erst die Serien, dann die festen Abzüge, dann die eigenen. */
export async function leseKartenBestand(
    db: Queryable | undefined,
    tileRoot: string | undefined,
    env: NodeJS.ProcessEnv = process.env,
): Promise<KartenBestand> {
    const stand = await leseKartenserien(db);
    const katalog = wirksamerKatalog(AVENTURIA_SERIES, stand.zeilen);
    const ablage = ablageAus(env, tileRoot);
    const wurzel = exportWurzel(env, tileRoot);
    const zeiger = await leseSvgZeiger(wurzel);
    const eigene = Object.keys(zeiger.abzuege).filter((id) => !(SVG_ZEILEN as readonly string[]).includes(id));
    const dateien = await Promise.all([
        ...katalog.series.map((serie) => pngZeile(db, serie, ablage?.wurzel, tileRoot)),
        ...[...SVG_ZEILEN, ...eigene].map((id) => svgZeile(wurzel, id, zeiger.abzuege[id])),
    ]);
    return { dateien, lizenz: katalog.license };
}

/** Stößt die fehlenden Prüfsummen im Hintergrund an, damit der erste Abruf nicht darauf wartet. */
export function pruefungenAnstossen(dateien: readonly KartenDatei[]): void {
    for (const datei of dateien) {
        if (datei.pfad !== null && datei.eintrag.sha256 === null) void pruefeDatei(datei.pfad).catch(() => undefined);
    }
}

const LOGO_NAME = "dsa-fanprojekt-logo.webp";

/** Das Logo aus dem Bau der Oberfläche, im Entwicklungsstand aus `public`; wie die Kopfbilder (`media-editor/type-images.ts`). */
async function leseLogo(): Promise<Buffer | null> {
    for (const ort of ["apps/web/dist/img", "apps/web/public/img"]) {
        const inhalt = await readFile(resolve(process.cwd(), ort, LOGO_NAME)).catch(() => null);
        if (inhalt !== null) return inhalt;
    }
    return null;
}

/** Die Lizenz, die jeder Verbreitung beiliegen muss: `license.terms` im Katalog („eine Kopie der Lizenz oder ihre vollständige Internetadresse“). */
export function lizenzText(lizenz: MapSeriesLicense, nennungen: readonly string[]): string {
    const zeilen = [
        "Avesmaps: Karten von Aventurien",
        "",
        ...nennungen,
        "",
        lizenz.name,
        lizenz.uri,
        "",
        lizenz.terms,
        "",
        "Avesmaps ist ein nicht-kommerzielles Fanprojekt. Bitte kennzeichne Bearbeitungen als Fanprojekt und verwende das beiliegende DSA-Fanprojekt-Logo.",
        `Ulisses-Fanrichtlinien: ${LEGAL_NOTICES.project.fanGuidelinesUri}`,
        "",
    ];
    return zeilen.join("\r\n");
}

export interface KartenPaket {
    readonly plan: ZipPlan;
    readonly dateien: readonly KartenDatei[];
    readonly nennungen: readonly string[];
    readonly fassung: string | null;
}

/** Plant das ZIP aus fertigen Dateien; rechnet fehlende Prüfsummen und liest Lizenz und Logo. */
export async function baueKartenPaket(dateien: readonly KartenDatei[], lizenz: MapSeriesLicense): Promise<KartenPaket> {
    const nennungen = [...new Set(dateien.map((d) => d.nennung).filter((n): n is string => n !== null))];
    if (nennungen.length === 0) nennungen.push(...new Set(AVENTURIA_SERIES.series.map((s) => s.attribution)));
    const eintraege: ZipEintrag[] = [];
    let juengste = new Date(0);
    for (const datei of dateien) {
        if (datei.pfad === null || datei.zeit === null) throw new Error(`Datei fehlt: ${datei.eintrag.id}`);
        const pruefung = await pruefeDatei(datei.pfad);
        eintraege.push({
            name: datei.eintrag.datei,
            bytes: pruefung.bytes,
            crc32: pruefung.crc32,
            zeit: datei.zeit,
            inhalt: { art: "datei", pfad: datei.pfad },
        });
        if (datei.zeit > juengste) juengste = datei.zeit;
    }
    const text = Buffer.from(lizenzText(lizenz, nennungen), "utf8");
    eintraege.push({
        name: "LIZENZ.txt",
        bytes: text.length,
        crc32: crc32(text),
        zeit: juengste,
        inhalt: { art: "puffer", daten: text },
    });
    const logo = await leseLogo();
    if (logo !== null) {
        eintraege.push({
            name: LOGO_NAME,
            bytes: logo.length,
            crc32: crc32(logo),
            zeit: juengste,
            inhalt: { art: "puffer", daten: logo },
        });
    }
    const svg = dateien.find((d) => d.eintrag.art === "svg");
    return { plan: planeZip(eintraege), dateien, nennungen, fassung: svg?.eintrag.fassung ?? null };
}
