import type { JobsOverview, JobSummary, QueueEntry } from "@avesmaps3d/shared";

/**
 * Die eigenen Aufträge in der Warteschlange, wie Kopf und Fenster sie zeigen (WI-0230; Betreiber 2026-10-19 zur Probierseite „Warteschlange
 * im Kopf“: „kopf-warteschlange -> bauen“). Die Form ist die des Folge-Bands der Derographie: ein Auftrag `{ art, auftrag }` und sein Stand
 * `{ stand, rest? }`, `rest` in Sekunden. Eine Quelle für beide, damit das „wird berechnet“ im Fenster und die Leiste im Kopf nie
 * auseinanderlaufen.
 *
 * Gerechnet wird nur aus dem, was die Warteschlange schon liefert (`GET /api/jobs/overview?eigene=true`): Wartezeit (`notBefore`), Platz,
 * Schätzung (`estimate`), Fortschritt der Phase. Was der Server nicht weiß, steht nicht da („Dauer unbekannt“, nie eine geratene Zahl).
 *
 * - `gesammelt`: wartend mit `notBefore` in der Zukunft (die Sammelzeit läuft); `rest` bis zu ihrem Ende.
 * - `wartet`: wartend, Sammeln vorbei; `rest` bis zum geschätzten Start. Kennt der Server keinen Start (der Vorgänger läuft über sein p95
 *   hinaus oder hat keine bekannte Dauer), nennt `nach` die Art des eigenen Auftrags, auf den er wartet; sonst ohne beides.
 * - `laeuft`: läuft; `rest` aus dem Ende, das der Auftrag selbst meldet (`etaAt`, der Release-Test, WI-0248), sonst aus der Schätzung, die er
 *   beim Warten trug, sonst ohne. `phase` ist die Phase des Servers (Kopf und Statusseite benennen sie gleich).
 * - `fertig`: eben fertig geworden, was hier zuvor wartete oder lief; steht `FERTIG_MS` lang da.
 * - `fehlgeschlagen`: gescheitert oder abgebrochen, was hier zuvor wartete oder lief; bleibt, bis man die Warteschlange geöffnet hat.
 */

export type KopfStand = "gesammelt" | "wartet" | "laeuft" | "fertig" | "fehlgeschlagen";

export interface EigenerAuftrag {
    auftrag: { art: string; auftrag: string };
    stand: { stand: KopfStand; rest?: number; nach?: string };
    /** Die geschätzte Dauer eines Laufs in Sekunden (Median der letzten Läufe oder Startwert); `null` = unbekannt. */
    dauerS: number | null;
    /** Wie weit ein laufender ist, 0 bis 1 (Phase des Servers, sonst aus Schätzung und Startzeit); `null` = unbekannt. */
    anteil: number | null;
    /** Das Etikett des Auftrags, solange er läuft oder wartet (etwa „Gelände voll rechnen (Fassung 19 (Test))“). */
    etikett?: string;
    /** Die Phase eines laufenden Auftrags, wie der Server sie meldet (WI-0248: Schritt des Release-Tests, Phase der Freigabe). */
    phase?: string;
    /** Der Wartegrund eines wartenden Auftrags (etwa `waits_pickup`: die Freigabe wartet auf ihre Abholung). */
    grund?: string;
}

/** So lange steht ein eben fertiger Auftrag noch im Kopf („✓ berechnet“). */
export const FERTIG_MS = 4000;

/** Was sich der Kopf zwischen zwei Abrufen merkt: was er aktiv sah, die Dauer aus der Schätzung, quittierte Fehlschläge. */
export interface Gedaechtnis {
    aktiv: Set<string>;
    dauer: Map<string, number>;
    /** Wann ein Auftrag hier zum ersten Mal fertig gesehen wurde (Millisekunden). */
    fertigSeit: Map<string, number>;
    quittiert: Set<string>;
}

export function neuesGedaechtnis(): Gedaechtnis {
    return { aktiv: new Set(), dauer: new Map(), fertigSeit: new Map(), quittiert: new Set() };
}

const sekundenBis = (iso: string | null, nowMs: number): number | null =>
    iso === null ? null : (Date.parse(iso) - nowMs) / 1000;

/** Überlappen sich zwei Aufträge? Wie `scopesOverlap` der Zulassung: dieselbe Domäne, `domain` überlappt alles, sonst gemeinsame Kacheln. */
function ueberlappen(a: JobSummary, b: JobSummary): boolean {
    if (a.mapDomainId !== b.mapDomainId) return false;
    if (a.scope.kind === "domain" || b.scope.kind === "domain") return true;
    return a.scope.tiles.some((tile) => b.scope.tiles.includes(tile));
}

/**
 * Worauf ein Wartender ohne geschätzten Start wartet (Betreiber 2026-10-19: „nachdem die wegprofile gerechnet werden kommt "wegnamen
 * werden gesetzt" start unbekannt“): ein Vorgänger aus `dependsOn`, sonst der erste eigene laufende oder vor ihm eingereihte Auftrag,
 * dessen Bereich sich mit seinem überlappt (`path_profile` und `path_label_runs` halten beide die ganze Domäne).
 */
function vorgaenger(entry: QueueEntry, vor: readonly JobSummary[]): JobSummary | undefined {
    return vor.find((job) => entry.dependsOn.includes(job.id)) ?? vor.find((job) => ueberlappen(job, entry));
}

const nachArt = (job: JobSummary | undefined): EigenerAuftrag["stand"] =>
    job === undefined ? { stand: "wartet" } : { stand: "wartet", nach: job.kind };

function dauerAus(entry: QueueEntry): number | null {
    const { durationP50S, basis } = entry.estimate;
    return basis === "unknown" || durationP50S === null ? null : durationP50S;
}

function laufend(job: JobSummary, nowMs: number, dauerS: number | null): EigenerAuftrag {
    const seit = job.startedAt === null ? null : (nowMs - Date.parse(job.startedAt)) / 1000;
    // Ein Ende, das der Auftrag selbst meldet, geht der Schätzung vor: Der Release-Test kennt seine Restzeit aus dem Runner.
    const eta = job.etaAt === undefined ? Number.NaN : Date.parse(job.etaAt);
    const rest = Number.isFinite(eta)
        ? Math.max(0, (eta - nowMs) / 1000)
        : dauerS !== null && seit !== null
          ? Math.max(0, dauerS - seit)
          : undefined;
    const anteil =
        job.progress !== null
            ? Math.min(1, Math.max(0, job.progress))
            : dauerS !== null && dauerS > 0 && seit !== null
              ? Math.min(1, Math.max(0, seit / dauerS))
              : null;
    return {
        auftrag: { art: job.kind, auftrag: job.id },
        stand: rest === undefined ? { stand: "laeuft" } : { stand: "laeuft", rest },
        dauerS,
        anteil,
        ...(job.label ? { etikett: job.label } : {}),
        ...(job.phase ? { phase: job.phase } : {}),
    };
}

/**
 * Die eigenen Aufträge aus einer Übersicht, in der Reihenfolge der Warteschlange (laufende, dann wartende, dann eben fertige und
 * gescheiterte). Pflegt das Gedächtnis: neu gesehene aktive Aufträge, ihre Dauer, das erste „fertig“.
 */
export function eigeneAuftraege(overview: JobsOverview | null, nowMs: number, merk: Gedaechtnis): EigenerAuftrag[] {
    if (overview === null) return [];
    const liste: EigenerAuftrag[] = [];
    const aktiv = new Set<string>();
    for (const job of overview.running) {
        aktiv.add(job.id);
        liste.push(laufend(job, nowMs, merk.dauer.get(job.id) ?? null));
    }
    const vor: JobSummary[] = [...overview.running];
    for (const entry of overview.queued) {
        aktiv.add(entry.id);
        const dauerS = dauerAus(entry);
        if (dauerS !== null) merk.dauer.set(entry.id, dauerS);
        const sammeln = sekundenBis(entry.notBefore, nowMs);
        const start = sekundenBis(entry.estimate.startAt, nowMs);
        const stand: EigenerAuftrag["stand"] =
            sammeln !== null && sammeln > 0
                ? { stand: "gesammelt", rest: sammeln }
                : start !== null
                  ? // Die Schätzung sagt „jetzt“, solange der Auftrag auf den nächsten Takt wartet: 0 heißt „startet gleich“, nicht
                    // „unbekannt“ (Betreiber 2026-10-19: „startdatum steht nicht richtig dran“).
                    { stand: "wartet", rest: Math.max(0, start) }
                  : nachArt(vorgaenger(entry, vor));
        liste.push({
            auftrag: { art: entry.kind, auftrag: entry.id },
            stand,
            dauerS,
            anteil: null,
            ...(entry.label ? { etikett: entry.label } : {}),
            ...(entry.waitReason ? { grund: entry.waitReason } : {}),
        });
        vor.push(entry);
    }
    // Fertig oder gescheitert zählt nur, was hier zuvor aktiv stand: Die Liste „zuletzt“ trägt in der eigenen Sicht alle Aufträge.
    const vorher = merk.aktiv;
    for (const job of overview.recent) {
        if (aktiv.has(job.id) || !(vorher.has(job.id) || merk.fertigSeit.has(job.id))) continue;
        if (job.state === "SUCCEEDED") {
            const seit = merk.fertigSeit.get(job.id) ?? nowMs;
            merk.fertigSeit.set(job.id, seit);
            if (nowMs - seit < FERTIG_MS)
                liste.push({
                    auftrag: { art: job.kind, auftrag: job.id },
                    stand: { stand: "fertig" },
                    dauerS: null,
                    anteil: 1,
                });
        }
    }
    // Abgebrochen zählt wie gescheitert (Festlegung der Editoren 2026-10-19): Die Liste „zuletzt“ trägt CANCELLED neben SUCCEEDED.
    const gescheitert = [...overview.failed, ...overview.recent.filter((job) => job.state === "CANCELLED")];
    for (const job of gescheitert) {
        if (aktiv.has(job.id) || merk.quittiert.has(job.id)) continue;
        if (!(vorher.has(job.id) || merk.fertigSeit.has(job.id))) continue;
        merk.fertigSeit.set(job.id, merk.fertigSeit.get(job.id) ?? nowMs);
        liste.push({
            auftrag: { art: job.kind, auftrag: job.id },
            stand: { stand: "fehlgeschlagen" },
            dauerS: null,
            anteil: null,
        });
    }
    merk.aktiv = aktiv;
    return liste;
}

/** Was der Kopf zuerst nennt: ein Fehlschlag, sonst was läuft, was gesammelt wird, was wartet, was eben fertig wurde. */
const RANG: Record<KopfStand, number> = { fehlgeschlagen: 0, laeuft: 1, gesammelt: 2, wartet: 3, fertig: 4 };

export function vorderster(liste: readonly EigenerAuftrag[]): EigenerAuftrag | null {
    let best: EigenerAuftrag | null = null;
    for (const eintrag of liste)
        if (best === null || RANG[eintrag.stand.stand] < RANG[best.stand.stand]) best = eintrag;
    return best;
}

/** Die übrigen offenen Aufträge neben dem vordersten („+n“). */
export function weitere(liste: readonly EigenerAuftrag[], vorne: EigenerAuftrag | null): number {
    return liste.filter((eintrag) => eintrag !== vorne && eintrag.stand.stand !== "fertig").length;
}

/** Fehlschläge gelten als gesehen, sobald man die Warteschlange geöffnet hat. */
export function quittiere(liste: readonly EigenerAuftrag[], merk: Gedaechtnis): void {
    for (const eintrag of liste)
        if (eintrag.stand.stand === "fehlgeschlagen") merk.quittiert.add(eintrag.auftrag.auftrag);
}
