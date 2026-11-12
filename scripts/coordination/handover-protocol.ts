import { createHash } from "node:crypto";
import { join } from "node:path";
/**
 * Das Protokoll der Agentenkoordination: was ein Handover ist und wen es weckt.
 *
 * Reine Funktionen, kein Git, kein Dateisystem, kein Prozess. Der Listener daneben besorgt die
 * Daten; hier steht, was sie bedeuten. Diese Trennung ist der Grund, warum sich Rollenfilter,
 * Dedup und das Betreibergate testen lassen, ohne ein Repository zu bauen.
 *
 * 🔴 DER TRAGENDE SATZ: Die Wakeup-Nachricht ist ein HINWEIS, keine Arbeitsanweisung. Sie trägt
 * Zeiger — Rolle, Status, Commit, Pfad — und niemals Inhalt. Der Empfänger liest den vollständigen
 * Handover selbst aus dem gepushten `origin/master`. Wer Inhalt in den Hinweis packt, macht den
 * lokalen Kanal zur zweiten Wahrheit und öffnet einen Weg, auf dem Text aus einer Datei zur
 * Anweisung wird.
 */

/** Die beiden Agenten. Andere Werte sind keine Rolle, sondern ein Fehler in der Datei. */
export const ROLES = ["claudia", "claudio"] as const;
export type Role = (typeof ROLES)[number];

/** Was der Listener aus einem Handover braucht. Alles andere ist Fliesstext fuer Menschen. */
export interface Handover {
    from: Role | undefined;
    to: Role | undefined;
    status: string | undefined;
    operatorGate: boolean;
    valid: boolean;
}

/**
 * Die Datei, in der ein Listener seinen zuletzt verarbeiteten Stand hält: je Rolle UND Arbeitskopie.
 *
 * 💣 Gemessen am 2026-10-18: Alle Sitzungen auf dem Entwicklungsrechner laufen als `claudia`. Mit einer Datei je Rolle schrieb der
 * Listener jeder Sitzung denselben Stand; lief der eigene Monitor ab und startete neu, setzte er beim Stand einer ANDEREN Sitzung auf,
 * und was dazwischen gepusht worden war, fiel durch. Der Schlüssel ist darum der Ordner, aus dem der Listener läuft.
 */
export function defaultStateFile(role: Role, workingDirectory: string, temporary: string): string {
    const key = createHash("sha256").update(workingDirectory.toLowerCase()).digest("hex").slice(0, 12);
    return join(temporary, `avesmaps3d-handover-${role}-${key}.state`);
}

/**
 * Status, die den Empfänger im laufenden Betrieb wecken: alle vier, auch `INFO` (Betreiber 2026-10-18, `entscheidungen.md`). Bis
 * dahin weckte `INFO` niemanden, und am 2026-10-18 blieben so eine Freigabe („Bootstrap eingespielt, darf gepusht werden“) und eine
 * Abnahme stundenlang ungelesen. Beim Start zählt weiter nur Offenes (`OPEN_STATUSES`).
 */
export const WAKING_STATUSES = ["ACTION_REQUIRED", "DONE", "BLOCKED", "INFO"];

/**
 * Was beim START zählt: nur wirklich OFFENE Stände.
 *
 * 🪤 Ein `DONE` von gestern ist keine offene Sache. Meldet der Startbestand es trotzdem, beginnt
 * jede Sitzung mit einer Handvoll erledigter Meldungen — und ein Listener, dessen Zeilen man
 * überliest, ist so gut wie keiner. Im laufenden Betrieb weckt ein frisches `DONE` weiterhin,
 * denn dort ist es die Nachricht „du kannst weiterarbeiten".
 */
export const OPEN_STATUSES = ["ACTION_REQUIRED", "BLOCKED"];

/**
 * Die Felder der Kopftabelle, Schlüssel klein geschrieben.
 *
 * Erwartet wird die Form, die `handovers/README.md` seit jeher vorgibt — `| feld | wert |`.
 *
 * 🪤 Gelesen wird ausschliesslich der KOPF, bis zur ersten Überschrift. Ein Handover zitiert im
 * Fliesstext regelmässig andere Handovers samt deren Tabellen; wer die ganze Datei durchsucht,
 * liest die Kopfzeile des zitierten statt des eigenen und weckt den Falschen.
 */
export function readHeaderFields(markdown: string): Record<string, string> {
    const header = markdown.split(/^##\s/m)[0] ?? "";
    const fields: Record<string, string> = {};
    for (const line of header.split(/\r?\n/)) {
        const match = /^\|\s*([A-Za-z_]+)\s*\|\s*(.+?)\s*\|\s*$/.exec(line);
        if (!match) {
            continue;
        }
        const key = (match[1] as string).toLowerCase();
        if (key in fields) {
            continue; // Das erste Vorkommen gilt.
        }
        fields[key] = (match[2] as string).trim();
    }
    return fields;
}

/**
 * Liest die Kopftabelle eines Handovers. Nur die Felder, die das Protokoll braucht, werden
 * gelesen; alles andere ist Fließtext für Menschen.
 */
export function parseHandover(markdown: string): Handover {
    const fields = readHeaderFields(markdown);

    const role = (value: string | undefined): Role | undefined => {
        const cleaned = (value ?? "").toLowerCase().replace(/[`*]/g, "").trim();
        return (ROLES as readonly string[]).includes(cleaned) ? (cleaned as Role) : undefined;
    };

    // `status | **ACTION_REQUIRED** (2026-09-21, zweite Fassung)` ist gängige Praxis in diesen
    // Dateien: der Status steht vorn, die Erläuterung dahinter. Gelesen wird das erste Schlüsselwort.
    //
    // 💣 Und zwar VERANKERT. Ein unverankerter Ausdruck findet das Schlüsselwort irgendwo im Text,
    // also weckt `ANSWERED (Abschluss steht als DONE in Handover x)` als `DONE`. Genau solche
    // Statuszeilen stehen in diesen Dateien. Von Claudio am Bestand gemessen, nicht ausgedacht.
    const statusMatch = /^[\s*`]*(ACTION_REQUIRED|BLOCKED|DONE|INFO(?:RMATIONAL)?)\b/.exec(fields["status"] ?? "");
    const status = statusMatch ? (statusMatch[1] as string).replace("INFORMATIONAL", "INFO") : undefined;

    // 🔴 Das Betreibergate ist standardmäßig ZU. Ein fehlendes oder unlesbares Feld heißt „ja, der
    // Betreiber entscheidet" — niemals „nein, mach nur". Eine Datei, die es vergisst, darf keine
    // autonome Arbeit auslösen.
    const gateRaw = (fields["operator_decision_required"] ?? "").toLowerCase();
    const operatorGate = !/^no\b/.test(gateRaw.replace(/[`*]/g, "").trim());

    return {
        from: role(fields["from"]),
        to: role(fields["to"]),
        status,
        operatorGate,
        valid: Boolean(role(fields["from"]) && role(fields["to"]) && status),
    };
}

/**
 * Was am Kopf nach der Vorlage in `handovers/README.md` fehlt oder falsch ist; leer heißt gültig.
 *
 * 🪤 Strenger als der Listener: Der liest ein fehlendes `operator_decision_required` als „yes“ und
 * weckt trotzdem. Die Vorlage verlangt das Feld, damit sich niemand auf diese Voreinstellung
 * verlässt. `apps/server/test/regelwerk-handover-koepfe.test.ts` prüft damit jedes neue Handover.
 */
export function headerProblems(markdown: string): string[] {
    const fields = readHeaderFields(markdown);
    const handover = parseHandover(markdown);
    const shown = (key: string): string => {
        const value = fields[key];
        return value === undefined ? "fehlt" : `„${value.length > 60 ? `${value.slice(0, 60)}…` : value}“`;
    };
    const problems: string[] = [];
    if (handover.from === undefined) problems.push(`from ist nicht claudia oder claudio (${shown("from")})`);
    if (handover.to === undefined) problems.push(`to ist nicht claudia oder claudio (${shown("to")})`);
    if (handover.status === undefined) {
        problems.push(`status beginnt nicht mit INFO, ACTION_REQUIRED, BLOCKED oder DONE (${shown("status")})`);
    }
    const gate = (fields["operator_decision_required"] ?? "").replace(/[`*]/g, "").trim().toLowerCase();
    if (!/^(no|yes)\b/.test(gate)) {
        problems.push(
            `operator_decision_required beginnt nicht mit no oder yes (${shown("operator_decision_required")})`,
        );
    }
    return problems;
}

/**
 * Geht mich dieser Handover etwas an?
 *
 * 🪤 Ein Handover an mich SELBST weckt nicht. Sonst weckt jeder eigene Push die eigene Session und
 * die beiden Listener schaukeln sich gegenseitig hoch.
 */
export function concernsRole(handover: Handover, role: Role, { startup = false } = {}): boolean {
    if (!handover.valid || handover.to !== role || handover.from === role) {
        return false;
    }
    const relevant = startup ? OPEN_STATUSES : WAKING_STATUSES;
    return relevant.includes(handover.status ?? "");
}

/**
 * Habe ich diese Änderung selbst geschrieben?
 *
 * 💣 Der Rollenfilter liest nur den KOPF der Datei — er weiss nicht, wessen Commit sie geändert
 * hat. Wer einen Handover des anderen auf `DONE` setzt (der normale Abschluss), erzeugt damit eine
 * Änderung, deren Kopf weiterhin „von ihm an mich" sagt, und weckt sich selbst. Gemessen am
 * 2026-09-21: der eigene Push meldete mir meinen eigenen Abschluss. Kein Aufschaukeln, aber genau
 * das Rauschen, das einen Listener wertlos macht.
 *
 * Geprüft wird der Autor, nicht der Committer: ein Rebase durch den anderen Agenten lässt die
 * Urheberschaft unberührt, und wer etwas geschrieben hat, muss davon nicht geweckt werden.
 *
 * 🪤 Fail-open: ist der Autor unbekannt oder gehört er niemandem von uns (der Betreiber committet
 * selbst), wird geweckt. Ein Hinweis zu viel kostet eine Zeile, einer zu wenig kostet eine Übergabe.
 */
export function authoredByRole(author: string, role: Role): boolean {
    // In Wörter zerlegen statt einen Regex zusammenzubauen: `Claudia <claudia@avesmaps3d.local>`
    // soll treffen, ein Name, der eine Rolle bloss enthält, nicht.
    return author
        .toLowerCase()
        .split(/[^a-z]+/)
        .includes(role);
}

/**
 * Der Schlüssel, unter dem ein Ereignis als „schon gemeldet" gilt.
 *
 * Pfad UND Status UND Commit: derselbe Handover darf erneut melden, wenn er einen neuen Stand
 * bekommt (ACTION_REQUIRED -> DONE) oder in einem neuen Commit erneut geändert wurde. Er darf
 * NICHT erneut melden, solange sich nichts geändert hat — sonst ruft ein Listener alle zehn
 * Sekunden dieselbe Sache aus.
 */
export function dedupeKey(path: string, handover: Handover, commit: string): string {
    return `${path}\u0000${handover.status}\u0000${commit}`;
}

/**
 * Die Wakeup-Zeile. Zeiger, kein Inhalt.
 *
 * 💣 Hier darf NIE Text aus dem Handover hinein. Die Zeile landet in einer Agentensession als
 * Ereignis; alles darin wird gelesen. Ein Betreff, ein Zitat, eine „kurze Zusammenfassung" aus der
 * Datei wäre genau der Weg, auf dem Dateiinhalt zur Anweisung wird. Deshalb stehen hier
 * ausschliesslich Werte aus einer geschlossenen Menge (Rollen, Status) plus zwei technische
 * Zeiger, und der Pfad wird auf das erwartete Muster geprüft, bevor er mitgeht.
 */
export function formatEvent(path: string, handover: Handover, commit: string, timestamp: string): string {
    if (!/^project-control\/handovers\/[A-Za-z0-9._-]+\.md$/.test(path)) {
        throw new Error(`unerwarteter Handover-Pfad: ${path}`);
    }
    if (!/^[0-9a-f]{7,40}$/.test(commit)) {
        throw new Error(`unerwarteter Commit: ${commit}`);
    }
    return [
        `[AVESMAPS3D HANDOVER ${timestamp}]`,
        `from=${String(handover.from)}`,
        `to=${String(handover.to)}`,
        `status=${String(handover.status)}`,
        `operator_gate=${handover.operatorGate ? "yes" : "no"}`,
        `commit=${commit}`,
        `path=${path}`,
    ].join("\n");
}

/** Zeitstempel mit Zonenversatz, wie im Protokoll vereinbart. */
export function localTimestamp(date: Date = new Date()): string {
    const pad = (value: number): string => String(Math.trunc(Math.abs(value))).padStart(2, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    return (
        `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
        `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
    );
}
