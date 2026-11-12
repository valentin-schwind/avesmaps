import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Value } from "@sinclair/typebox/value";
import {
    RELEASE_STAMM,
    ReleaseNotizen,
    kurzinfoAus,
    releaseStamm,
    ReleaseVerlauf,
    VERLAUF_DATEI,
    neuerungenAlsKurzinfo,
    standAus,
    type Kurzinfo,
    type ReleaseKurz,
    type ReleaseVoll,
} from "@avesmaps3d/shared";

/**
 * Liest die Release-Notizen (WI-0137, VERSION-0001 §3) aus `config/releases/` des laufenden Release; kein Git, kein Netz. Das Artefakt
 * trägt `config/` mit (`ops/deploy/build-release.sh`), also liegen die Dateien auf Stage neben dem Server. `RELEASE_NOTES_DIR` setzt einen
 * anderen Ordner (Tests). Eine kaputte Datei fehlt in der Liste; der Aufrufer sagt es einmal im Log.
 *
 * Die neueste Datei ist die neueste Release-Notiz, nicht zwingend das laufende Release: Seit dem Freigabe-Knopf (FREIGABE-0001)
 * schneidet der Betreiber selbst, und nicht jede Freigabe bringt eine Notiz mit. 🔴 Für „Neu auf avesmaps.de“ taugt sie deshalb nicht;
 * deren Text kommt aus dem Freigabe-Bündel und trägt Claudios Korridor ein (Betreiber 2026-10-15: „B“).
 */

/** `config/releases` neben dem Server: aus `apps/server/{src,dist}/versionen/` vier Ebenen hinauf zur Wurzel des Release. */
export function releaseOrdner(): string {
    return process.env["RELEASE_NOTES_DIR"] ?? resolve(import.meta.dirname, "../../../../config/releases");
}

export interface GeleseneReleases {
    releases: (ReleaseVoll & { kurzinfo: string | null })[];
    kaputt: string[];
}

export async function leseReleases(ordner: string = releaseOrdner()): Promise<GeleseneReleases> {
    const dateien = await readdir(ordner).catch(() => [] as string[]);
    const releases: GeleseneReleases["releases"] = [];
    const kaputt: string[] = [];
    for (const datei of dateien.filter((name) => name.endsWith(".json") && name !== VERLAUF_DATEI).sort()) {
        const stamm = datei.slice(0, -".json".length);
        try {
            const inhalt: unknown = JSON.parse(await readFile(join(ordner, datei), "utf8"));
            if (!RELEASE_STAMM.test(stamm) || !Value.Check(ReleaseNotizen, inhalt)) throw new Error("Schema");
            if (releaseStamm(inhalt.datum, inhalt.bis) !== stamm) throw new Error("Stamm");
            const md = dateien.includes(`${stamm}.md`) ? await readFile(join(ordner, `${stamm}.md`), "utf8") : null;
            const doku = inhalt.commits.filter((commit) => commit.doku).length;
            releases.push({
                stamm,
                titel: inhalt.titel,
                datum: inhalt.datum,
                von: inhalt.von,
                bis: inhalt.bis,
                zahl: inhalt.commits.length - doku,
                doku,
                pakete: inhalt.pakete,
                commits: inhalt.commits,
                kurzinfo: md,
            });
        } catch {
            kaputt.push(datei);
        }
    }
    // Älteste zuerst; Gleichstand nach Stamm.
    releases.sort((a, b) => Date.parse(a.datum) - Date.parse(b.datum) || a.stamm.localeCompare(b.stamm));
    return { releases, kaputt };
}

export const kurzVon = ({ stamm, titel, datum, von, bis, zahl, doku }: ReleaseVoll): ReleaseKurz => ({
    stamm,
    titel,
    datum,
    von,
    bis,
    zahl,
    doku,
});

export const vollVon = (release: GeleseneReleases["releases"][number]): ReleaseVoll => ({
    ...kurzVon(release),
    pakete: release.pakete,
    commits: release.commits,
});

/**
 * Die Notizen des LAUFENDEN Release: die Datei, deren `bis` der Stand im Namen des Release ist (`RELEASE_ID`, `…-3ab71b9`).
 *
 * 🔴 **Nicht die jüngste Datei** (Befund des Betreibers 2026-10-17: „bei den systemmeldungen in production kommt immer nur diese
 * meldung“). Release-Notizen entstanden beim Release-Schnitt; seit Stage jeden Push ausrollt und Production über die Freigabe kommt,
 * schreibt sie niemand mehr (die jüngste ist vom 2026-10-12). „Neue Version verfügbar“ zeigte deshalb bei jedem Release dieselbe
 * Kurzinfo vom 12.10., samt ihres Satzes für die Stage. Gibt es zum laufenden Stand keine Datei, gibt es keine.
 *
 * Ohne Stand im Namen (lokal `dev`) die jüngste Datei: Wer Notizen schreibt, sieht sie so vor dem Release.
 */
export function laufendesRelease(
    gelesen: GeleseneReleases,
    releaseId: string,
): GeleseneReleases["releases"][number] | undefined {
    const stand = standAus(releaseId);
    if (stand === null) return gelesen.releases.at(-1);
    return gelesen.releases.findLast((release) => release.bis.startsWith(stand));
}

/** Die Kurzinfo des laufenden Release; ohne Datei oder ohne geschriebene Kurzinfo keine Abschnitte (Vorgabe 3). */
export function kurzinfoVon(gelesen: GeleseneReleases, releaseId: string): Kurzinfo {
    const laufend = laufendesRelease(gelesen, releaseId);
    if (laufend === undefined) return { stand: null, abschnitte: [] };
    return {
        stand: laufend.datum,
        abschnitte: laufend.kurzinfo === null ? [] : kurzinfoAus(laufend.kurzinfo).abschnitte,
    };
}

/**
 * Die jüngsten `max` Commits des Verlaufs für „Versionen“ (neueste zuerst, wie im Bau), ohne die lange Beschreibung; `null` ohne Verlauf. Stage rollt
 * jeden Push ohne Release-Schnitt aus, dort ist das die Historie des laufenden Stands, auf Production ebenso.
 */
export function verlaufVon(
    verlauf: ReleaseVerlauf | null,
    max: number,
): { bis: string; commits: ReleaseVerlauf["commits"] } | null {
    if (verlauf === null) return null;
    return {
        bis: verlauf.bis,
        commits: verlauf.commits.slice(0, max).map((commit) => {
            const kurz = { ...commit };
            delete kurz.beschreibung;
            return kurz;
        }),
    };
}

/** `config/releases/verlauf.json` (WI-0137, „Neue Version“); fehlt sie oder passt sie nicht zum Schema, `null`. */
export async function leseVerlauf(ordner: string = releaseOrdner()): Promise<ReleaseVerlauf | null> {
    try {
        const inhalt: unknown = JSON.parse(await readFile(join(ordner, VERLAUF_DATEI), "utf8"));
        return Value.Check(ReleaseVerlauf, inhalt) ? inhalt : null;
    } catch {
        return null;
    }
}

/**
 * Was die Meldung „Neue Version“ zeigt (Betreiber 2026-10-17): Mit dem Stand des offenen Tabs die Neuerungen bis zum laufenden Stand aus dem
 * Verlauf (Abschnitte „Neu“ und „Achtung“); ohne Tab-Stand oder ohne Verlauf die Kurzinfo des laufenden Release. Immer mit `release`, damit
 * die Seite beim Start ihren Stand kennt.
 */
export function neueVersionVon(
    gelesen: GeleseneReleases,
    verlauf: ReleaseVerlauf | null,
    releaseId: string,
    seit: string | undefined,
): Kurzinfo {
    const bis = standAus(releaseId) ?? verlauf?.bis ?? null;
    if (seit !== undefined && verlauf !== null && bis !== null) {
        const neu = neuerungenAlsKurzinfo(verlauf, seit, bis);
        return {
            stand: null,
            abschnitte: neu.abschnitte,
            release: releaseId,
            ...(neu.unredigiert.length > 0 ? { unredigiert: neu.unredigiert } : {}),
            ...(neu.mehr ? { mehr: true } : {}),
        };
    }
    return { ...kurzinfoVon(gelesen, releaseId), release: releaseId };
}
