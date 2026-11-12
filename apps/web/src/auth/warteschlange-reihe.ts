import type { AdminSystemOverview, GemeinsamerAuftrag, QueuePauseView } from "@avesmaps3d/shared";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { dataLabel } from "../status/format";
import { haengtGrund, prozentVon, umgebungName, umgebungOrt, umgebungTon, warteText } from "../status/gemeinsam-view";
import { phaseText } from "../status/job-view";

/**
 * Die Karte „Warteschlange“ der Verwaltung mit der gemeinsamen Warteschlange (WI-0163 §1.6, §1.7): was sie aus
 * `GET /api/admin/system` rechnet. Reine Funktionen, damit Vitest sie ohne Browser prüft; wie es aussieht, steht in
 * `verwaltung-betrieb-warteschlange.vue` und `verwaltung-betrieb-reihe.vue`.
 *
 * 🔴 Ein Schalter für alle Umgebungen: Gezeigt wird die WIRKSAME Pause (die jüngste Anweisung über alle Umgebungen), mit dem Ort, an
 * dem sie gegeben wurde. Die Person steht nur da, wo geschaltet wurde; anderswo steht die Umgebung („auf der Stage“).
 */

/**
 * Ist die Warteschlange gerade pausiert, so wie die Karte sie zeigt? Mit frischem Stand des Dirigenten die WIRKSAME Pause, sonst die
 * letzte Anweisung dieser Umgebung (so vergleicht auch der Server). `null` heißt unbekannt: Dann ist keine Stellung gewählt, nie
 * „läuft“.
 */
export function warteschlangePausiert(overview: AdminSystemOverview, bekannt: boolean): boolean | null {
    const gemeinsam = overview.warteschlange;
    if (gemeinsam?.zustand === "ok" && gemeinsam.pause !== null) return gemeinsam.pause.paused;
    if (!bekannt || overview.configured === null) return null;
    return overview.configured.queuePause.paused;
}

/**
 * Die wirksame Pause als Satz: „seit heute, 03:12 · Valentin · auf der Stage · „Datenbank wird gesichert““. Wurde in der anderen
 * Umgebung pausiert, fehlt die Person: „seit heute, 03:12 · auf Production · …“.
 */
export function wirksamSeitText(pause: QueuePauseView, umgebung: string, now: Date): string {
    const teile: string[] = [];
    if (pause.since !== null) {
        const wann = relativeTime(new Date(pause.since), now, locale.value, "zeitpunkt");
        if (wann !== "") teile.push(t("admin.system.since", { time: wann }));
    }
    const anderswo = pause.anderswo ?? null;
    if (anderswo === null && pause.by !== null) {
        teile.push(pause.by.startsWith("cli:") ? t("admin.system.byCli", { user: pause.by.slice(4) }) : pause.by);
    }
    teile.push(umgebungOrt(anderswo ?? umgebung));
    if (pause.reason !== null && pause.reason !== "") teile.push(t("admin.system.quoted", { text: pause.reason }));
    return teile.join(" · ");
}

/** Eine Zeile der gemeinsamen Reihe in Legacys Listenform: Name mit Kreis, darunter die Unterzeile, rechts die Umgebung. */
export interface ReiheZeile {
    key: string;
    eigen: boolean;
    name: string;
    umgebung: string;
    ton: "neutral" | "erfolg" | "warnung";
    /** ○ wartet, ◐ läuft (das Stilmittel jeder Liste; die Bedeutung steht in der Legende darunter). */
    kreis: "leer" | "halb";
    kreisName: string;
    unter: string;
    /** Der Auftrag hängt (WI-0179): Die Unterzeile steht rot. */
    haengt: boolean;
    /** Der Fortschritt eines laufenden Auftrags in Prozent; sonst `null`. */
    prozent: number | null;
}

/** Die Kreise der Reihe in der Reihenfolge der Legende: von leer nach voll, wie in jeder Liste. */
export const REIHE_LEGENDE = [
    { state: "QUEUED", kreis: "leer" },
    { state: "RUNNING", kreis: "halb" },
] as const;

export function reiheKreisName(state: GemeinsamerAuftrag["state"]): string {
    return t(`admin.system.queue.circle.${state}`);
}

/** `nowMs` rechnet die Restzeit eines sammelnden Auftrags („Wird gesammelt, noch 13 s.“, WI-0293). */
export function reiheZeilen(reihe: readonly GemeinsamerAuftrag[], nowMs: number = Date.now()): ReiheZeile[] {
    return reihe.map((auftrag, index) => {
        const art = dataLabel("status.kind", auftrag.kind);
        const name = auftrag.label !== null && auftrag.label !== "" ? auftrag.label : art;
        const wartet = auftrag.state === "QUEUED";
        const prozent = wartet ? null : prozentVon(auftrag.progress);
        const teile: (string | null)[] = name === art ? [] : [art];
        if (wartet) {
            teile.push(auftrag.platz === null ? null : t("status.row.position", { n: auftrag.platz }));
            teile.push(warteText(auftrag.waitReason, auftrag.notBefore, nowMs));
        } else {
            teile.push(t("status.state.RUNNING"));
            teile.push(auftrag.phase === null ? null : phaseText(auftrag.kind, auftrag.phase));
            teile.push(prozent === null ? null : t("status.row.percent", { percent: prozent }));
        }
        return {
            key: auftrag.jobId ?? `${auftrag.umgebung}:${auftrag.kind}:${auftrag.queuedAt}:${String(index)}`,
            eigen: auftrag.eigen,
            name,
            umgebung: umgebungName(auftrag.umgebung),
            ton: umgebungTon(auftrag.umgebung),
            kreis: wartet ? "leer" : "halb",
            kreisName: reiheKreisName(auftrag.state),
            unter: teile.filter((teil): teil is string => teil !== null).join(" · "),
            haengt: wartet && haengtGrund(auftrag.waitReason),
            prozent,
        };
    });
}
