import { readFile } from "node:fs/promises";
import { Value } from "@sinclair/typebox/value";
import {
    FreigabeDatei,
    ReleaseVerlauf,
    neuerungenMitKontext,
    neuerungenNachArt,
    standAus,
    type DiscordEintrag,
    type DiscordFakt,
    type DiscordFakten,
    type DiscordFaktStatus,
    type NeuerungMitKontext,
    type NeuerungsSatz,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { leseVerlauf } from "../versionen/lesen.ts";
import type { DiscordKonfig } from "./konfig.ts";
import { istIntern, satzTauglich } from "./muster.ts";

/**
 * Der Faktenbestand des Berichts (WI-0255): erst deterministisch sammeln, filtern und entdoppeln, dann formulieren. 🔴 Kein Sprachmodell
 * entscheidet hier etwas.
 *
 * | Abschnitt  | Quelle, die die App zur Laufzeit wirklich kennt                                                                  | Zustand            |
 * |------------|-------------------------------------------------------------------------------------------------------------------|--------------------|
 * | Production | der Production-Stand aus der Statusdatei der Freigabe (`production.commit`) und `config/releases/verlauf.json` des   | `live`             |
 * |            | laufenden Release (die `Neu:`-Zeilen bis zu diesem Stand)                                                        |                    |
 * | Werkstatt  | derselbe Verlauf, vom Production-Stand bis zum Stand des laufenden (Stage-)Release; Prüfung aus der Statusdatei    | `getestet`/`laufend` |
 * | Community  | Fachprotokolle `map_operation` und `media_operation` (nur gezählt, nur Personen), neue `place_review`              | gezählt            |
 *
 * 🔴 **Der Bericht läuft auf der Stage und kennt nur Quellen der Stage** (Vali 2026-10-26): keine Anfrage an die Production-App, keine Verbindung zu
 * ihrer Datenbank. Dass `verlauf.json` des Stage-Release den Stand von Production enthält, liegt daran, dass Production nie vor der Stage steht;
 * kennt er ihn nicht, steht `vergleich: "unbekannt"` da und der Bericht behauptet nichts. Die Zahlen der Community kommen aus der Datenbank der Stage, die
 * über den Production-Zug auch die Arbeit aus Production enthält (Stand des letzten Zugs), deshalb ohne Filter auf die Umgebung.
 *
 * - Nur **redigierte** Sätze (`Neu:` am Commit) erscheinen; eine Änderung ohne Satz wird gezählt, nie als Commit-Zeile gezeigt.
 * - **Interna fallen weg** (Vali 2026-11-03: „interna weg lassen ja“): Ein Satz, der selbst sagt, dass niemand etwas davon sieht, oder der von der Stage, dem
 *   Release-Test oder dem Entwicklungsrechner erzählt (`istIntern`), kommt weder als Punkt noch im Eintrag für das Modell vor; ein Commit, dessen Sätze alle so
 *   sind, auch nicht. Was sonst niemand bemerkt, beurteilt das Modell (seine Regeln in `formulierer.ts`), die Vorlage kann es nicht.
 * - Jeder Satz trägt seine **Art** (`feature` aus `feat(…)`, `fix` aus `fix(…)`; 2026-10-26). Bis dahin verlor sich die Art in `neuerungenAlsKurzinfo`,
 *   das beides in „Neu“ mischt: Behebungen standen als Merkmale da oder fielen weg, wo der Commit keine `Neu:`-Zeile trug. Der Bericht erzählt
 *   Behebungen jetzt getrennt (`fix` mit `Neu:`-Zeile); ein `fix` ohne `Neu:`-Zeile zählt weiter nur in `ohneSatz`, weil sein Betreff technisch ist.
 * - **Neu heißt neu seit dem letzten zugestellten Bericht** (`vorher`): Kennt der Verlauf den damaligen Stand nicht (Rückweg, gekappter
 *   Verlauf), wird nichts behauptet (`vergleich: "unbekannt"`) — sonst stünden nach einem Rückweg Hunderte alter Änderungen als „neu“ da.
 * - Die Werkstatt nennt nur, was seit dem letzten Bericht neu auf der Stage ist; was schon berichtet wurde, zählt `weiterhin`. Was heute live
 *   ging, steht nicht noch einmal in der Werkstatt.
 * - **Je Commit für das Modell** (`eintraege`, WI-0255 §3e): dieselben Spannen mit Betreff, Scope, Beschreibung und Bereichen, auch Commits ohne
 *   `Neu:`-Zeile. Das Modell wählt daraus aus und bündelt; die feste Vorlage erzählt weiter nur die Sätze. Die Werkstatt merkt sich, was das
 *   Modell gesehen hat (die Sätze, sonst den Betreff), die neuesten zuerst: Was es gesehen und nicht erzählt hat, war ihm nicht wichtig genug.
 * - 🔴 Keine Namen: Personen nur als Zahl, und erst ab drei.
 */

/**
 * Höchstens so viele Sätze merkt sich die Werkstatt für den Vergleich am nächsten Tag, die neuesten. Bis 2026-10-30 waren es die ältesten 100: Lag
 * die Stage weit vor Production, sah der Bericht die neuesten nie.
 */
export const WERKSTATT_GEDAECHTNIS = 500;
/** Ab so vielen Personen nennt der Bericht eine Zahl. */
export const PERSONEN_AB = 3;
/** Das Zeitfenster der Community: seit dem letzten Bericht, höchstens eine Woche, ohne Bericht 24 Stunden. */
const FENSTER_MAX_MS = 7 * 24 * 3600_000;
const FENSTER_OHNE_MS = 24 * 3600_000;

export interface CommunityZahlen {
    bearbeitungen: number;
    medien: number;
    personen: number;
    bewertungen: number;
}

export interface FaktenEingang {
    tag: string;
    jetzt: Date;
    umgebung: string;
    releaseId: string;
    produktion: ReleaseVerlauf | null;
    werkstatt: ReleaseVerlauf | null;
    freigabe: FreigabeDatei | null;
    vorher: DiscordFakten | null;
    community: CommunityZahlen;
    fenster: { von: Date; bis: Date };
}

const gleicherStand = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);
const kennt = (verlauf: ReleaseVerlauf, stand: string): boolean =>
    verlauf.commits.some((commit) => gleicherStand(commit.sha, stand));

/** Die redigierten Sätze zwischen zwei Ständen mit ihrer Art und die Zahl der Änderungen ohne Satz. */
function saetze(verlauf: ReleaseVerlauf, seit: string, bis: string): { saetze: NeuerungsSatz[]; ohneSatz: number } {
    const neu = neuerungenNachArt(verlauf, seit, bis);
    return {
        saetze: neu.saetze
            .map(({ satz, art }) => ({ satz: satz.trim(), art }))
            .filter(({ satz }) => satz !== "" && satzTauglich(satz) && !istIntern(satz)),
        ohneSatz: neu.ohneSatz,
    };
}

/**
 * Ein Commit als Eintrag für das Modell; nur Sätze, die in die Öffentlichkeit taugen (wie `saetze`). `null`, wenn der Commit Sätze trägt und ALLE ohne
 * Wirkung für Besucher und Leser sind (`istIntern`, Vali 2026-11-03: Interna weglassen): Dann gibt es nichts zu erzählen, und sein (technischer) Betreff
 * soll das Modell nicht doch dazu verleiten. Ein Commit ganz ohne `Neu:`-Zeile bleibt, das Modell entscheidet nach dem Betreff.
 */
function eintragVon(neuerung: NeuerungMitKontext, status: DiscordFaktStatus): DiscordEintrag | null {
    const roh = neuerung.saetze.map((satz) => satz.trim()).filter((satz) => satz !== "");
    if (roh.length > 0 && roh.every(istIntern)) return null;
    return {
        status,
        art: neuerung.art,
        saetze: roh.filter((satz) => satzTauglich(satz) && !istIntern(satz)),
        betreff: neuerung.betreff,
        scope: neuerung.scope,
        beschreibung: neuerung.beschreibung,
        bereich: neuerung.bereich,
    };
}

/** Die Einträge der Commits, ohne die, die nichts zu erzählen haben (`eintragVon`). */
const eintraegeVon = (neuerungen: readonly NeuerungMitKontext[], status: DiscordFaktStatus): DiscordEintrag[] =>
    neuerungen.flatMap((neuerung) => eintragVon(neuerung, status) ?? []);

/** Woran sich die Werkstatt einen Eintrag merkt: seine Sätze, ohne Sätze sein Betreff. */
export const schluesselVon = (eintrag: DiscordEintrag): string[] =>
    eintrag.saetze.length > 0 ? eintrag.saetze : [eintrag.betreff];

/** Das Fenster der Community: seit dem letzten Bericht (höchstens eine Woche), sonst die letzten 24 Stunden. */
export function communityFenster(jetzt: Date, vorher: DiscordFakten | null): { von: Date; bis: Date } {
    const damals = vorher === null ? Number.NaN : Date.parse(vorher.erhobenAt);
    const gueltig = Number.isFinite(damals) && damals < jetzt.getTime() && jetzt.getTime() - damals <= FENSTER_MAX_MS;
    return { von: new Date(gueltig ? damals : jetzt.getTime() - FENSTER_OHNE_MS), bis: jetzt };
}

/** Die Prüfung der Werkstatt aus der Statusdatei der Freigabe, nur wenn sie denselben Stage-Stand meint. */
function werkstattPruefung(
    freigabe: FreigabeDatei | null,
    stand: string | null,
): DiscordFakten["werkstatt"]["pruefung"] {
    if (freigabe === null || stand === null || !gleicherStand(freigabe.stage.commit, stand)) return "unbekannt";
    if (freigabe.stageGruen === false || freigabe.nachweis === "rot") return "rot";
    if (freigabe.probenGruen === true || freigabe.stageGruen === true) return "gruen";
    return "unbekannt";
}

/** Rein: aus den Quellen der Faktenbestand. Dieselben Quellen ergeben dieselben Fakten. */
export function rechneFakten(eingang: FaktenEingang): DiscordFakten {
    const { produktion, werkstatt, vorher } = eingang;
    const commit = standAus(eingang.releaseId);
    const seit = vorher?.production.commit ?? null;

    let vergleich: DiscordFakten["production"]["vergleich"];
    let liveSaetze: NeuerungsSatz[] = [];
    let liveEintraege: DiscordEintrag[] = [];
    let ohneSatz = 0;
    if (commit === null || produktion === null || !kennt(produktion, commit)) vergleich = "unbekannt";
    else if (seit === null) vergleich = "erster";
    else if (gleicherStand(seit, commit)) vergleich = "gleich";
    else if (!kennt(produktion, seit)) vergleich = "unbekannt";
    else {
        vergleich = "neu";
        ({ saetze: liveSaetze, ohneSatz } = saetze(produktion, seit, commit));
        liveEintraege = eintraegeVon(neuerungenMitKontext(produktion, seit, commit), "live");
    }
    const live: DiscordFakt[] = liveSaetze.map(({ satz, art }) => ({ status: "live", satz, art }));

    const stand = werkstatt?.bis ?? null;
    let werkstattVergleich: DiscordFakten["werkstatt"]["vergleich"] = "ohne_quelle";
    let alle: NeuerungsSatz[] = [];
    let alleEintraege: NeuerungMitKontext[] = [];
    if (werkstatt !== null && stand !== null) {
        if (commit === null || !kennt(werkstatt, commit)) werkstattVergleich = "unbekannt";
        else if (gleicherStand(stand, commit)) werkstattVergleich = "gleich";
        else {
            werkstattVergleich = "neu";
            alle = saetze(werkstatt, commit, stand).saetze;
            alleEintraege = neuerungenMitKontext(werkstatt, commit, stand);
        }
    }
    const pruefung = werkstattPruefung(eingang.freigabe, stand);
    const bekannt = new Set(vorher?.werkstatt.alle ?? []);
    const heuteLive = new Set(liveSaetze.map(({ satz }) => satz));
    const status = pruefung === "rot" ? "laufend" : "getestet";
    const werkstattNeu: DiscordFakt[] = alle
        .filter(({ satz }) => !bekannt.has(satz) && !heuteLive.has(satz))
        .map(({ satz, art }) => ({ status, satz, art }));
    const alleErzaehlbar = eintraegeVon(alleEintraege, status);
    const werkstattEintraege = alleErzaehlbar.filter((eintrag) =>
        schluesselVon(eintrag).some((schluessel) => !bekannt.has(schluessel) && !heuteLive.has(schluessel)),
    );
    const gemerkt = [
        ...new Set([...alle.map(({ satz }) => satz), ...alleErzaehlbar.flatMap((eintrag) => schluesselVon(eintrag))]),
    ].slice(-WERKSTATT_GEDAECHTNIS);

    const { community } = eingang;
    return {
        schema: 1,
        tag: eingang.tag,
        erhobenAt: eingang.jetzt.toISOString(),
        umgebung: eingang.umgebung,
        production: {
            release: eingang.releaseId,
            commit,
            seit,
            vergleich,
            neu: live,
            eintraege: liveEintraege,
            ohneSatz,
        },
        werkstatt: {
            commit: stand,
            vergleich: werkstattVergleich,
            pruefung,
            alle: gemerkt,
            neu: werkstattNeu,
            eintraege: werkstattEintraege,
            weiterhin: alle.filter(({ satz }) => bekannt.has(satz)).length,
        },
        community: {
            von: eingang.fenster.von.toISOString(),
            bis: eingang.fenster.bis.toISOString(),
            bearbeitungen: community.bearbeitungen,
            medien: community.medien,
            personen: community.personen >= PERSONEN_AB ? community.personen : null,
            bewertungen: community.bewertungen,
        },
    };
}

/**
 * Die Beiträge der Community im Fenster, nur gezählt: Bearbeitungen der Karte durch Personen im Editor (`map_operation`, Quelle `editor`),
 * Handgriffe von Personen in der Medienverwaltung (`media_operation`) und neue, öffentlich sichtbare Ortsbewertungen (`place_review`).
 * 🔴 Kein Name, keine Kennung einer Person verlässt diese Abfrage; die App-Rolle liest nichts aus `avesmaps_auth`.
 */
export async function zaehleCommunity(db: Queryable, fenster: { von: Date; bis: Date }): Promise<CommunityZahlen> {
    const [zeile] = await db<CommunityZahlen[]>`
        WITH karte AS (
            SELECT actor_person_id FROM public.map_operation
             WHERE source = 'editor' AND actor_kind = 'person'
               AND at >= ${fenster.von} AND at < ${fenster.bis}
        ), medien AS (
            SELECT actor_person_id FROM public.media_operation
             WHERE actor_kind = 'person'
               AND at >= ${fenster.von} AND at < ${fenster.bis}
        )
        SELECT (SELECT count(*) FROM karte)::int AS bearbeitungen,
               (SELECT count(*) FROM medien)::int AS medien,
               (SELECT count(DISTINCT actor_person_id) FROM (SELECT * FROM karte UNION ALL SELECT * FROM medien) a)::int AS personen,
               (SELECT count(*) FROM public.place_review
                 WHERE zustand IN ('neu', 'gesichtet') AND created_at >= ${fenster.von} AND created_at < ${fenster.bis})::int AS bewertungen
    `;
    return zeile ?? { bearbeitungen: 0, medien: 0, personen: 0, bewertungen: 0 };
}

async function leseJson<T>(pfad: string | undefined, pruefe: (wert: unknown) => wert is T): Promise<T | null> {
    if (pfad === undefined) return null;
    try {
        const wert: unknown = JSON.parse(await readFile(pfad, "utf8"));
        return pruefe(wert) ? wert : null;
    } catch {
        return null;
    }
}

export interface FaktenQuellen {
    db: Queryable;
    konfig: DiscordKonfig;
    jetzt: Date;
    tag: string;
    vorher: DiscordFakten | null;
    /** Der Verlauf des laufenden Release (der Stage); Tests geben ihn vor. Ohne Angabe `config/releases/verlauf.json` neben dem Server. */
    verlauf?: ReleaseVerlauf | null;
    /** Die Statusdatei der Freigabe; Tests geben sie vor. Ohne Angabe wird `konfig.freigabeStatus` gelesen. */
    freigabe?: FreigabeDatei | null;
}

/**
 * Die Kennung des Production-Stands für `rechneFakten`: das Release aus der Statusdatei, mit dem Commit am Ende, wenn der Name ihn nicht trägt.
 * Ohne Statusdatei `unbekannt` (kein Commit, also kein Vergleich).
 */
export function produktionsKennung(freigabe: FreigabeDatei | null): string {
    if (freigabe === null) return "unbekannt";
    const { release, commit } = freigabe.production;
    const stand = standAus(release);
    return stand !== null && gleicherStand(stand, commit) ? release : `${release}-${commit}`;
}

/** Sammelt die Quellen (Dateien, Datenbank) und rechnet daraus den Faktenbestand. */
export async function sammleFakten(quellen: FaktenQuellen): Promise<DiscordFakten> {
    const fenster = communityFenster(quellen.jetzt, quellen.vorher);
    const [verlauf, freigabe, community] = await Promise.all([
        quellen.verlauf !== undefined ? Promise.resolve(quellen.verlauf) : leseVerlauf(),
        quellen.freigabe !== undefined
            ? Promise.resolve(quellen.freigabe)
            : leseJson(quellen.konfig.freigabeStatus, (wert): wert is FreigabeDatei =>
                  Value.Check(FreigabeDatei, wert),
              ),
        zaehleCommunity(quellen.db, fenster),
    ]);
    return rechneFakten({
        tag: quellen.tag,
        jetzt: quellen.jetzt,
        umgebung: quellen.konfig.umgebung,
        releaseId: produktionsKennung(freigabe),
        // Ein Verlauf für beides: Er reicht bis zum Stand der Stage und enthält den von Production.
        produktion: verlauf,
        werkstatt: verlauf,
        freigabe,
        vorher: quellen.vorher,
        community,
        fenster,
    });
}
