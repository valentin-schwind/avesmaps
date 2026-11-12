import type {
    GemeinsameWarteschlange,
    GemeinsamerAuftrag,
    JobSummary,
    JobsOverview,
    QueueEntry,
} from "@avesmaps3d/shared";
import { isMessageKey, t } from "../i18n/i18n";
import { dataLabel, formatDuration, secondsSince, secondsUntil } from "./format";

/**
 * Die gemeinsame Warteschlange in der Oberfläche (WI-0163 §1.7; Betreiber 2026-10-15: „ich seh ob ein job von stage oder production
 * is, die ordnen sich da der reihe nach ein, jeder weiß, dass da was am arbeiten ist und keiner ist uninformiert“). Was Statusseite
 * und Verwaltung aus `gemeinsam` bzw. `warteschlange` rechnen, ohne Browser prüfbar; jeder Satz aus den Sprachtafeln.
 *
 * 🔴 Ein Auftrag der anderen Umgebung steht mit Umgebung, Art, Bezeichnung, Platz, Zustand, Grund und Auslöser da, nie mit einer
 * Kennung (den Namen des Auslösers liest der Dirigent in seiner Umgebung, WI-0293). 🔴 Ohne frischen Stand heißt es „Zustand
 * unbekannt“, nie „läuft“.
 */

/** Der Name einer Umgebung („Stage“, „Production“); ohne Eintrag der Rohwert. */
export function umgebungName(umgebung: string): string {
    return dataLabel("status.umgebung.name", umgebung);
}

/** Wo etwas geschah, als Satzteil („auf der Stage“, „auf Production“); ohne Eintrag der Rohwert. */
export function umgebungOrt(umgebung: string): string {
    return dataLabel("status.umgebung.at", umgebung);
}

/** Der Ton der Pille einer Umgebung, wie in der Kopfleiste: Stage gelb, Production grün, sonst neutral. */
export function umgebungTon(umgebung: string): "neutral" | "erfolg" | "warnung" {
    return umgebung === "staging" ? "warnung" : umgebung === "production" ? "erfolg" : "neutral";
}

/**
 * Hängt der wartende Auftrag (WI-0179)? Dann weist der Ausführer ihn immer wieder gleich ab, und er kommt so nicht von selbst weiter:
 * Die Ansichten zeigen ihn rot. Den Grund setzt allein der Server (`grundAusStand`), hier wird er nur erkannt.
 */
export function haengtGrund(reason: string | null): boolean {
    return reason === "waits_executor_stuck";
}

/**
 * „Wird gesammelt, noch 13 s.“: die Restzeit bis zum frühesten Start (`notBefore`). Ohne ihn heißt sie „unbekannt“, nie `{time}` und nie
 * eine geratene Zahl (WI-0293: In den Zeilen der anderen Umgebung stand der Platzhalter wörtlich da).
 */
export function sammelSatz(notBefore: string | null | undefined, nowMs: number): string {
    const bis = secondsUntil(notBefore ?? null, nowMs);
    return t("status.wait.debouncing", { time: bis === null ? t("status.unknown") : formatDuration(bis) });
}

/**
 * Warum ein Auftrag wartet, als Satz; ohne Grund der Satz zum nächsten Takt. Ein sammelnder Auftrag nennt seine Restzeit, wenn der
 * Aufrufer den frühesten Start kennt (`sammelSatz`).
 */
export function warteText(reason: string | null, notBefore?: string | null, nowMs: number = Date.now()): string {
    if (reason === "debouncing") return sammelSatz(notBefore, nowMs);
    const key = `status.wait.${reason ?? "none"}`;
    return isMessageKey(key) ? t(key) : t("status.wait.free", { text: reason ?? "" });
}

/** Der Fortschritt in Prozent, gerundet; ohne Angabe `null`. */
export function prozentVon(progress: number | null): number | null {
    return progress === null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/**
 * „Zustand der Warteschlange unbekannt.“ samt dem Grund, wenn die Stand-Datei eingerichtet ist, aber kein frischer Stand vorliegt;
 * sonst `null` (frisch oder ohne Stand-Datei, dann gilt die eigene Tafel wie bis WI-0163).
 */
export function unbekanntSatz(
    gemeinsam: GemeinsameWarteschlange | undefined,
    nowMs: number,
): { lead: string; satz: string } | null {
    if (gemeinsam === undefined || gemeinsam.zustand === "ok") return null;
    const satz =
        gemeinsam.zustand === "veraltet"
            ? t("status.shared.unknown.veraltet", {
                  time: formatDuration(secondsSince(gemeinsam.stand, nowMs) ?? 0),
              })
            : t(`status.shared.unknown.${gemeinsam.zustand}`);
    return { lead: t("status.shared.unknown.lead"), satz };
}

export type ReihenEintrag =
    | { art: "eigen"; key: string; job: JobSummary | QueueEntry }
    | { art: "fremd"; key: string; auftrag: GemeinsamerAuftrag };

/** Ein Schlüssel für einen Auftrag der anderen Umgebung: Er trägt keine Kennung. */
function fremdKey(auftrag: GemeinsamerAuftrag, index: number): string {
    return `${auftrag.umgebung}:${auftrag.kind}:${auftrag.queuedAt}:${String(index)}`;
}

/**
 * Die Abschnitte „läuft“ und „wartet“ der Statusseite: die eigenen Aufträge wie bisher, mit frischem Stand dazu die der anderen
 * Umgebung, und die wartenden in der Reihenfolge der GEMEINSAMEN Reihe (der Platz der eigenen kommt schon vom Server).
 */
export function gemeinsameAbschnitte(overview: JobsOverview): { running: ReihenEintrag[]; queued: ReihenEintrag[] } {
    const eigenLaeuft: ReihenEintrag[] = overview.running
        .filter((job) => !job.stalled)
        .map((job) => ({ art: "eigen", key: job.id, job }));
    const eigenWartet = overview.queued.map((job) => ({
        platz: job.position,
        eintrag: { art: "eigen", key: job.id, job } as ReihenEintrag,
    }));
    const gemeinsam = overview.gemeinsam;
    if (gemeinsam === undefined || gemeinsam.zustand !== "ok") {
        return { running: eigenLaeuft, queued: eigenWartet.map((zeile) => zeile.eintrag) };
    }
    const fremd = gemeinsam.reihe
        .map((auftrag, index) => ({ auftrag, key: fremdKey(auftrag, index) }))
        .filter(({ auftrag }) => !auftrag.eigen);
    const running: ReihenEintrag[] = [
        ...eigenLaeuft,
        ...fremd
            .filter(({ auftrag }) => auftrag.state === "RUNNING")
            .map(({ auftrag, key }) => ({ art: "fremd" as const, key, auftrag })),
    ];
    const queued = [
        ...eigenWartet,
        ...fremd
            .filter(({ auftrag }) => auftrag.state === "QUEUED")
            .map(({ auftrag, key }) => ({
                platz: auftrag.platz ?? Number.MAX_SAFE_INTEGER,
                eintrag: { art: "fremd", key, auftrag } as ReihenEintrag,
            })),
    ]
        .sort((a, b) => a.platz - b.platz)
        .map((zeile) => zeile.eintrag);
    return { running, queued };
}
