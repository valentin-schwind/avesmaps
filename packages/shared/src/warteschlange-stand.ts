import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { WAIT_REASONS } from "./jobs.ts";

/**
 * Der Stand der gemeinsamen Warteschlange (WI-0163; Betreiber 2026-10-15: „eine gemeinsame queue, ich seh ob ein job von stage
 * oder production is, die ordnen sich da der reihe nach ein, jeder weiß, dass da was am arbeiten ist und keiner ist uninformiert").
 *
 * 🔴 **Die Tafeln bleiben je Umgebung, die Reihenfolge wird gemeinsam.** Jede Umgebung hat ihre Datenbank mit eigener Tafel `job`;
 * eingereiht wird dort, in derselben Transaktion wie die Fachänderung. Der **Dirigent** (`apps/server/src/jobs/dirigent/`) liest
 * alle Schlangen des Hosts NUR LESEND, ordnet sie, hält die Pause und startet den nächsten Auftrag über einen Ausführer mit den
 * Rechten seiner Umgebung. Was er weiß, legt er als **diese Datei** ab (`QUEUE_STAND_FILE`, auf dem VPS
 * `/var/lib/avesmaps3d/warteschlange/stand.json`); jede App liest sie, um die Reihe beider Umgebungen zu zeigen. Er schreibt in
 * keine Datenbank.
 *
 * 🔴 **Gelesen wird tolerant** (AGENTS.md, Verträge nur hinzufügen): Der Dirigent läuft aus dem Stage-Stand, Production liest mit
 * einem älteren. Unbekannte Felder bleiben unbeachtet; eine fehlende oder kaputte Datei heißt „Zustand unbekannt", nie „läuft".
 */

/** Die Umgebungen, wie sie `AVESMAPS_ENV` nennt (`apps/server/src/auth/config.ts`). */
export const WARTESCHLANGE_UMGEBUNGEN = ["development", "staging", "production", "test"] as const;
export type WarteschlangeUmgebung = (typeof WARTESCHLANGE_UMGEBUNGEN)[number];

/** Älter als das: Die Oberfläche sagt „Zustand unbekannt (der Dirigent meldet sich nicht)". Zehn Takte zu 2 s plus Puffer. */
export const WARTESCHLANGE_STAND_ALT_S = 30;

function literals<const T extends readonly string[]>(values: T): TSchema {
    return Type.Union(values.map((value) => Type.Literal(value)));
}

function Nullable<T extends TSchema>(schema: T) {
    return Type.Union([schema, Type.Null()]);
}

const Zeitpunkt = Type.String({ minLength: 1, maxLength: 40 });

/**
 * Ein Auftrag, den der Ausführer immer wieder gleich abweist (WI-0179; Anlass 2026-10-15: Seit 07:25 wies der Wrapper jeden
 * Korridor-Auftrag mit Exit 3 ab, und der Dirigent versuchte es acht Stunden lang still alle fünf Minuten neu). Der Dirigent setzt
 * das Feld, sobald derselbe Versuch (`attempt`) mit demselben Grund oft genug hintereinander zurückgestellt wurde
 * (`HAENGT_AB_ABLEHNUNGEN`, `apps/server/src/jobs/dirigent/haengt.ts`); jede App zeigt ihn dann rot, und die App SEINER Umgebung
 * meldet ihn einmal den Betreibern.
 *
 * 🔴 **Nur hinzugefügt** (Verträge nur hinzufügen): Ein älterer Leser übergeht das Feld, ein älterer Dirigent schreibt es nicht.
 * `grund` ist darum ein Kürzel und keine geschlossene Liste: Ein neuer Grund eines neueren Dirigenten macht den Stand für ältere
 * Apps nicht unlesbar. Bekannt sind `exit_3` (Ausführung fehlt), `exit_2` (Aufruffehler) und `unveraendert` (der Ausführer
 * endete, ohne den Auftrag zu übernehmen; `code` sagt womit, etwa 70 für einen Einrichtungsfehler).
 */
export const WarteschlangeHaengt = Type.Object({
    /** Wann die Serie der Ablehnungen begann. */
    seit: Zeitpunkt,
    /** Wie oft hintereinander abgewiesen, mit demselben Grund. */
    ablehnungen: Type.Integer({ minimum: 1 }),
    grund: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
    /** Der Exitcode der letzten Ablehnung; `null`, wenn der Ausführer nicht startete. */
    code: Nullable(Type.Integer()),
    /** Der Versuch des Auftrags (`job.attempt`): Mit Umgebung und Kennung der Schlüssel der Meldung. */
    attempt: Type.Integer({ minimum: 0 }),
});
export type WarteschlangeHaengt = Static<typeof WarteschlangeHaengt>;

/** Ein Auftrag in der gemeinsamen Reihe: wartend oder laufend. Fertige stehen nicht darin. */
export const WarteschlangeAuftrag = Type.Object({
    umgebung: literals(WARTESCHLANGE_UMGEBUNGEN),
    /** Die Kennung in der Tafel `job` SEINER Umgebung; nur zusammen mit `umgebung` eindeutig. */
    id: Type.Integer({ minimum: 1 }),
    publicId: Type.String({ minLength: 1, maxLength: 64 }),
    kind: Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" }),
    label: Nullable(Type.String({ maxLength: 200 })),
    state: literals(["QUEUED", "RUNNING"] as const),
    origin: literals(["queued", "recorded"] as const),
    /** Platz in der gemeinsamen Reihe (1 = als Nächstes dran); nur für wartende, `null` für laufende. */
    platz: Nullable(Type.Integer({ minimum: 1 })),
    queuedAt: Zeitpunkt,
    startedAt: Nullable(Zeitpunkt),
    phase: Nullable(Type.String({ maxLength: 80 })),
    progress: Nullable(Type.Number({ minimum: 0, maximum: 1 })),
    /**
     * Warum er wartet; `null` bei laufenden und bei dem, der gerade gestartet wird. 🔴 Gelesen wird jede kurze Kennung, nicht nur
     * die heute bekannten: Der Dirigent läuft aus dem Stage-Stand, Production liest mit einem älteren Release, und ein neuer Grund
     * darf dort nicht den ganzen Stand unlesbar machen. Die Oberfläche zeigt einen unbekannten Grund als Text (`status.wait.free`).
     */
    wartegrund: Nullable(Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" })),
    /** Ein schwerer Auftrag: Von ihnen läuft auf dem ganzen Host immer nur einer. */
    schwer: Type.Boolean(),
    /** Nur bei einem wartenden Auftrag, den der Ausführer immer wieder gleich abweist (WI-0179). */
    haengt: Type.Optional(WarteschlangeHaengt),
    /**
     * Wer ihn ausgelöst hat, als Art (`AUSLOESER_ARTEN`, WI-0293). 🔴 Nie `actor_ref`: Eine Kennung der einen Umgebung lässt sich in der
     * anderen nicht auflösen. Wie `wartegrund` eine kurze Kennung statt einer geschlossenen Liste: Eine neue Art eines neueren Dirigenten
     * macht den Stand für ältere Apps nicht unlesbar (die App zeigt sie als „unbekannt“). Nur hinzugefügt.
     */
    ausloeser: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_]{0,39}$" })),
    /**
     * Der heutige Anzeigename der Person, die ihn ausgelöst hat (WI-0293; Betreiber 2026-11-09: „Ja, Namen zeigen“), damit auch die
     * andere Umgebung sagt, wer ihn gestartet hat. Nur bei `ausloeser = person`, und nur wenn die Leserolle des Dirigenten Kennung und
     * Anzeigename lesen darf (`auth-grants.psql`); sonst fehlt das Feld. Kein anderes Merkmal der Person, keine E-Mail.
     */
    ausloeserName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    /**
     * Frühester Start (`job.not_before`): Ein Auftrag, der noch Speicherungen sammelt (`debouncing`), nennt damit seine Restzeit („Wird
     * gesammelt, noch 13 s.“, WI-0293). Ohne die Angabe stand dort in der anderen Umgebung „{time}“. Nur hinzugefügt.
     */
    notBefore: Type.Optional(Nullable(Zeitpunkt)),
});
export type WarteschlangeAuftrag = Static<typeof WarteschlangeAuftrag> & {
    umgebung: WarteschlangeUmgebung;
    state: "QUEUED" | "RUNNING";
    origin: "queued" | "recorded";
    wartegrund: (typeof WAIT_REASONS)[number] | null;
};

/**
 * Die wirksame Pause. 🔴 Gespeichert wird je Umgebung die letzte Anweisung (`system_state.queue_paused`, `queue_changed_at`;
 * WI-0160, Migration 0133); wirksam ist **die jüngste über alle Umgebungen**. So schreibt keine Umgebung in die Datenbank der
 * anderen, und es gibt trotzdem nur einen Schalter: Wer zuletzt drückt, entscheidet.
 */
export const WarteschlangePause = Type.Object({
    paused: Type.Boolean(),
    /** Wo zuletzt geschaltet wurde; `null`: noch nie. */
    umgebung: Nullable(literals(WARTESCHLANGE_UMGEBUNGEN)),
    changedAt: Nullable(Zeitpunkt),
    since: Nullable(Zeitpunkt),
    /** Die pseudonyme `person.id` in der schaltenden Umgebung; nur dort lässt sie sich in einen Namen auflösen. */
    by: Nullable(Type.String({ maxLength: 64 })),
    /** `cli:<Systembenutzer>`, wenn die Kommandozeile geschaltet hat. */
    byLabel: Nullable(Type.String({ maxLength: 80 })),
    reason: Nullable(Type.String({ maxLength: 300 })),
});
export type WarteschlangePause = Static<typeof WarteschlangePause> & { umgebung: WarteschlangeUmgebung | null };

export const WarteschlangeQuelle = Type.Object({
    name: literals(WARTESCHLANGE_UMGEBUNGEN),
    /** Konnte der Dirigent diese Umgebung im letzten Takt lesen? */
    erreichbar: Type.Boolean(),
    /** Hält dieser Dirigent die Planersperre dieser Umgebung (nur einer plant je Umgebung)? */
    planer: Type.Boolean(),
});
export type WarteschlangeQuelle = Static<typeof WarteschlangeQuelle> & { name: WarteschlangeUmgebung };

export const WarteschlangeStand = Type.Object({
    schema: Type.Literal(1),
    /** Wann der Dirigent die Datei zuletzt geschrieben hat; er schreibt in jedem Takt. */
    at: Zeitpunkt,
    dirigent: Type.Object({
        instanz: Type.String({ minLength: 1, maxLength: 80 }),
        release: Nullable(Type.String({ maxLength: 80 })),
        taktS: Type.Number({ exclusiveMinimum: 0 }),
    }),
    pause: WarteschlangePause,
    umgebungen: Type.Array(WarteschlangeQuelle),
    /** Laufende zuerst, dann die wartenden nach `platz`. */
    auftraege: Type.Array(WarteschlangeAuftrag),
});
export type WarteschlangeStand = Omit<Static<typeof WarteschlangeStand>, "pause" | "umgebungen" | "auftraege"> & {
    pause: WarteschlangePause;
    umgebungen: WarteschlangeQuelle[];
    auftraege: WarteschlangeAuftrag[];
};

/**
 * Liest die Datei tolerant: unbekannte Felder bleiben unbeachtet (das Schema verbietet sie nicht), alles Bekannte muss stimmen.
 * `null` heißt „nicht lesbar" — die Oberfläche sagt dann „Zustand unbekannt".
 */
export function leseWarteschlangeStand(json: unknown): WarteschlangeStand | null {
    return Value.Check(WarteschlangeStand, json) ? (json as WarteschlangeStand) : null;
}

/** Ist der Stand zu alt, um ihm zu glauben? Ohne Zeitpunkt oder mit kaputtem Zeitpunkt: ja. */
export function warteschlangeStandVeraltet(stand: Pick<WarteschlangeStand, "at">, nowMs: number): boolean {
    const atMs = Date.parse(stand.at);
    return !Number.isFinite(atMs) || nowMs - atMs > WARTESCHLANGE_STAND_ALT_S * 1000;
}

/**
 * Die wirksame Pause aus den Anweisungen der Umgebungen: die jüngste gewinnt. Eine Umgebung ohne Zeitpunkt (nie geschaltet oder
 * vor Migration 0133) zählt nicht. Ohne jede Anweisung läuft die Warteschlange.
 */
export function wirksamePause(
    anweisungen: readonly (Omit<WarteschlangePause, "umgebung"> & { umgebung: WarteschlangeUmgebung })[],
): WarteschlangePause {
    let juengste: (typeof anweisungen)[number] | null = null;
    for (const anweisung of anweisungen) {
        if (anweisung.changedAt === null) continue;
        if (juengste === null || Date.parse(anweisung.changedAt) > Date.parse(juengste.changedAt ?? ""))
            juengste = anweisung;
    }
    if (juengste === null)
        return { paused: false, umgebung: null, changedAt: null, since: null, by: null, byLabel: null, reason: null };
    return juengste.paused ? juengste : { ...juengste, since: null, reason: null };
}
