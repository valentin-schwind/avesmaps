import type { AuditEntry } from "@avesmaps3d/shared";
import { isMessageKey, t, tafelVon } from "../i18n/i18n";
import { schalterName } from "./inhalte";

/**
 * Die Sätze der Verwaltung (WI-0120 A10): Protokolleinträge, Restlaufzeiten, Anmeldewege, Namen von Rollen und Rechten. Die Wörter
 * stehen nur in den Sprachtafeln; was dort fehlt, erscheint mit seinem Schlüssel, statt zu verschwinden.
 */

/** Der Name zu einem Wert (`auth.role.editor`), sonst der Wert selbst. */
export function label(prefix: string, value: unknown): string {
    const key = `${prefix}.${String(value)}`;
    return isMessageKey(key) ? t(key) : String(value);
}

/**
 * Ein Eintrag des Protokolls als Satz (Mockup „Protokoll“): eine Überschrift („Rolle geändert“), dahinter die Einzelheiten,
 * mit Mittelpunkt getrennt („Traviabold: Reviewer → Editor“). Was auf Gefahr deutet (Sperren, Zugang entzogen, Drossel,
 * Zählerrückschritt, Notzugang), steht im Gefahrton.
 */
export interface EventText {
    title: string;
    details: string[];
    danger: boolean;
}

const DANGER = new Set([
    "person.locked",
    "access.revoked",
    "password.disabled",
    "passkey.counter_regression",
    "recovery.started",
    "login.throttled",
]);

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : typeof value === "number" ? String(value) : null;
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const days = (n: number | null): string | null =>
    n === null ? null : n === 1 ? t("admin.detail.day") : t("admin.detail.days", { n });

export function describeEvent(entry: AuditEntry): EventText {
    const d = entry.details;
    const target = entry.target?.displayName ?? null;
    const details: string[] = [];
    const push = (value: string | null | undefined): void => {
        if (value !== null && value !== undefined && value !== "") details.push(value);
    };
    const method = (): void => push(d["method"] === undefined ? null : label("admin.method", d["method"]));
    const reason = (): void => push(d["reason"] === undefined ? null : label("admin.reason", d["reason"]));
    const sessions = (key: string): void => {
        const n = count(d[key]);
        push(n === null || n === 0 ? null : t("admin.detail.sessionsEnded", { n }));
    };
    switch (entry.action) {
        case "login.success":
        case "login.throttled":
        case "confirm.success":
            method();
            break;
        case "login.failure":
            method();
            reason();
            break;
        case "invitation.created":
            push(label("auth.role", d["role"]));
            push(days(count(d["validDays"])));
            push(text(d["note"]) === null ? null : t("admin.detail.for", { note: text(d["note"])! }));
            push(d["bound"] === true ? t("admin.detail.bound") : null);
            break;
        case "invitation.accepted":
            push(label("auth.role", d["role"]));
            method();
            break;
        case "invitation.revoked":
        case "invitation.reissued":
            push(text(d["tokenHint"]) === null ? null : t("admin.detail.hint", { hint: text(d["tokenHint"])! }));
            break;
        case "person.role_changed":
            push(
                t("admin.detail.roleChange", {
                    name: target ?? "?",
                    from: label("auth.role", d["from"]),
                    to: label("auth.role", d["to"]),
                }),
            );
            push(
                Array.isArray(d["revokedCapabilities"]) && d["revokedCapabilities"].length > 0
                    ? t("admin.detail.grantsEnded")
                    : null,
            );
            push(d["restored"] === true ? t("admin.detail.restored") : null);
            break;
        case "person.locked":
            push(target);
            push(text(d["reason"]));
            sessions("sessions");
            break;
        case "access.revoked":
            push(target);
            push(d["role"] === undefined ? null : label("auth.role", d["role"]));
            sessions("sessions");
            break;
        case "person.renamed":
            push(text(d["from"]) === null ? null : `${String(d["from"])} → ${String(d["to"])}`);
            break;
        // „Verantwortlich für:“ (WI-0133): der Text steht nie im Protokoll, nur für wen, ob selbst und ob geleert.
        case "person.responsibility_changed":
            push(target);
            push(d["via"] === undefined ? null : label("admin.responsibility.via", d["via"]));
            push(d["cleared"] === true ? t("admin.responsibility.cleared") : null);
            break;
        case "capability.granted":
        case "capability.revoked":
            push(target);
            push(d["capability"] === undefined ? null : label("auth.capability", d["capability"]));
            push(text(d["reason"]));
            break;
        // Sonderrollen (WI-0279): Rolle, Regionen und Grund.
        case "sonderrolle.vergeben":
        case "sonderrolle.entzogen":
            push(target);
            push(d["sonderrolle"] === undefined ? null : label("auth.sonderrolle", d["sonderrolle"]));
            push(Array.isArray(d["regionen"]) && d["regionen"].length > 0 ? d["regionen"].join(", ") : null);
            push(text(d["grund"]));
            break;
        case "sonderrolle.abgeglichen":
            push(
                d["ruht"] === true
                    ? t("admin.sonderrollen.abgleich.protokollRuht")
                    : t("admin.sonderrollen.abgleich.protokoll", {
                          neu: String(d["neu"] ?? 0),
                          entzogen: String(d["entzogen"] ?? 0),
                      }),
            );
            break;
        case "sonderrolle.eingeladen":
            push(target);
            push(
                Array.isArray(d["sonderrollen"]) && d["sonderrollen"].length > 0 ? d["sonderrollen"].join(", ") : null,
            );
            push(
                Array.isArray(d["uebersprungen"]) && d["uebersprungen"].length > 0
                    ? t("admin.sonderrollen.uebersprungen", { rollen: d["uebersprungen"].join(", ") })
                    : null,
            );
            break;
        case "access_link.created":
            push(target);
            push(d["kind"] === undefined ? null : label("admin.linkKind", d["kind"]));
            push(count(d["validHours"]) === null ? null : t("admin.detail.hours", { n: count(d["validHours"])! }));
            break;
        case "access_link.used":
            push(d["kind"] === undefined ? null : label("admin.linkKind", d["kind"]));
            break;
        case "session.revoked":
            push(target);
            sessions("count");
            push(d["reason"] === undefined ? null : label("admin.reason", d["reason"]));
            break;
        case "password.set":
        case "recovery.started":
            push(target);
            push(d["via"] === undefined ? null : label("admin.via", d["via"]));
            break;
        case "password.disabled":
            push(target);
            push(count(d["failures"]) === null ? null : t("admin.detail.failures", { n: count(d["failures"])! }));
            break;
        case "discord.linked":
            push(text(d["discordUsername"]));
            break;
        case "passkey.registered":
        case "passkey.counter_regression":
            push(target);
            push(text(d["label"]));
            break;
        case "passkey.revoked":
            push(target);
            push(text(d["label"]));
            push(count(d["count"]) === null ? null : t("admin.detail.passkeys", { n: count(d["count"])! }));
            sessions("sessions");
            break;
        case "legacy.mapped":
            push(target);
            push(text(d["legacyName"]));
            push(text(d["evidence"]));
            break;
        case "legacy.unmapped":
            push(target);
            push(text(d["legacyName"]));
            break;
        case "backup.downloaded":
            push(text(d["name"]));
            break;
        // Der Abzugs-Schlüssel (WI-0251): „angelegt für 90 Tage“ oder „widerrufen“; die Kennung steht im Ziel, nie der Wert.
        // Karten herunterladen (WI-0280): die Kennung und die Karten, nie der Wert.
        case "system.karten_zugang":
        case "system.karten_abruf":
            push(text(d["kennung"]));
            if (Array.isArray(d["karten"])) push(d["karten"].map(String).join(", "));
            break;
        case "system.abzug_schluessel":
            push(
                d["aktion"] === "angelegt"
                    ? t("admin.abzug.schluessel.event.angelegt", { n: count(d["tage"]) ?? 0 })
                    : t("admin.abzug.schluessel.event.widerrufen"),
            );
            break;
        // Betriebszustand (WI-0127 SYS-5): „Normal → Eingeschränkt · „Wiederherstellung prüfen““, „Kartensperre: Offen → Gesperrt“.
        case "system.mode_changed":
            push(`${label("admin.system.mode", d["from"])} → ${label("admin.system.mode", d["to"])}`);
            push(text(d["reason"]) === null ? null : t("admin.system.quoted", { text: text(d["reason"])! }));
            break;
        case "system.lock_changed": {
            const state = (locked: unknown): string =>
                t(locked === true ? "admin.system.lock.locked" : "admin.system.lock.open");
            push(
                `${label("admin.system.lock", `${String(d["lock"])}.title`)}: ${state(d["from"])} → ${state(d["to"])}`,
            );
            push(text(d["reason"]) === null ? null : t("admin.system.quoted", { text: text(d["reason"])! }));
            break;
        }
        // Die Warteschlange pausieren und fortsetzen (WI-0160): „Läuft → Pausiert · „Datenbank wird gesichert““.
        case "system.queue_changed": {
            const state = (paused: unknown): string =>
                t(paused === true ? "admin.system.queue.paused" : "admin.system.queue.running");
            push(`${state(d["from"])} → ${state(d["to"])}`);
            push(text(d["reason"]) === null ? null : t("admin.system.quoted", { text: text(d["reason"])! }));
            break;
        }
        // Betreiber-Kanal (WI-0124): nur die OPS-Nummer, ohne Inhalt.
        case "system.kanal_purged":
        case "system.kanal_image_removed":
            push(text(d["ops"]));
            break;
        // Wiederherstellungsantrag (WI-0124 K5): „OPS-000141 · Datenbank“; der Grund steht im Vorgang, nicht im Protokoll.
        case "system.restore_requested":
            push(text(d["ops"]));
            push(label("admin.restore.umfang", d["umfang"]));
            break;
        // Abgleiche (WI-0127 SYS-14): „Legacy-Zug“ bzw. „Medien aus Legacy“.
        case "system.sync_requested":
            push(label("admin.sync.source", d["source"]));
            break;
        // Inhaltsschalter (WI-0127 SYS-10): „Kartenvorschauen: aus“.
        case "system.content_switch_changed":
            push(
                `${schalterName(String(d["key"]))}: ${t(d["to"] === true ? "admin.content.detail.on" : "admin.content.detail.off")}`,
            );
            break;
        // Höhenmodell (WI-0127 SYS-13): „Fassung 18 → Fassung 17 · Zurückschalten · „Grund““.
        case "system.terrain_activated": {
            const version = (value: unknown): string =>
                count(value) === null ? "?" : t("admin.terrain.version", { n: count(value)! });
            push(`${version(d["from"])} → ${version(d["to"])}`);
            push(d["rueckweg"] === true ? t("admin.terrain.backAction") : null);
            push(text(d["reason"]) === null ? null : t("admin.system.quoted", { text: text(d["reason"])! }));
            break;
        }
        // „Gelände neu rechnen“: „Fassung 18“.
        case "system.terrain_recomputed":
            push(count(d["version"]) === null ? null : t("admin.terrain.version", { n: count(d["version"])! }));
            break;
        case "system.terrain_accepted":
            push(count(d["version"]) === null ? null : t("admin.terrain.version", { n: count(d["version"])! }));
            push(text(d["reason"]) === null ? null : t("admin.system.quoted", { text: text(d["reason"])! }));
            break;
        case "system.terrain_draft_created":
            push(count(d["base"]) === null ? null : t("admin.terrain.draft", { n: count(d["base"])! }));
            push(
                Array.isArray(d["regler"])
                    ? d["regler"].map((id) => label("admin.terrain.regler", id)).join(", ")
                    : null,
            );
            push(text(d["reason"]) === null ? null : t("admin.system.quoted", { text: text(d["reason"])! }));
            break;
        // „19 (Test)“ (WI-0240): „Fassung 19“ und der Grund.
        case "system.terrain_test_changed":
            push(count(d["version"]) === null ? null : t("admin.terrain.version", { n: count(d["version"])! }));
            push(text(d["reason"]) === null ? null : t("admin.system.quoted", { text: text(d["reason"])! }));
            break;
        case "system.terrain_measure_requested":
        case "system.terrain_draft_discarded":
            break;
        default:
            push(target);
    }
    return { title: label("admin.event", entry.action), details, danger: DANGER.has(entry.action) };
}

/** Wer gehandelt hat: eine Person, die Kommandozeile auf dem Server, das System oder jemand ohne Anmeldung. */
export function actorText(entry: AuditEntry): { name: string; person: boolean } {
    if (entry.actor !== null) return { name: entry.actor.displayName, person: true };
    if (entry.actorKind === "cli") {
        const user = (entry.actorLabel ?? "").replace(/^cli:/u, "");
        return { name: t("admin.actor.cli", { user }), person: false };
    }
    if (entry.actorKind === "anonymous") return { name: t("admin.actor.anonymous"), person: false };
    return { name: t("admin.actor.system"), person: false };
}

/** Die Gruppen des Filters „Art“ und ihr Präfix in der API (`?action=person.`). */
export const EVENT_GROUPS = [
    { id: "alle", action: undefined },
    { id: "anmeldungen", action: "login." },
    { id: "personen", action: "person." },
    { id: "einladungen", action: "invitation." },
    { id: "sonderrechte", action: "capability." },
    { id: "links", action: "access_link." },
    { id: "passkeys", action: "passkey." },
] as const;

/**
 * Die Gruppen des Protokolls in der Systemsteuerung (WI-0127 SYS-15, SYS-0001 §9d.2): alle System-Ereignisse, Betrieb und Abgleiche
 * (`system.`), Notzugang (`recovery.`); mit der Rolle Betreiber dazu „Alles“, auch die Konten-Ereignisse. Die Kontenverwaltung zeigt
 * `EVENT_GROUPS` im Bereich `konten`. „Fix-Berichte“ (KANAL-0001 §3.1) liest nicht das Sicherheitsprotokoll, sondern die Änderungen des
 * Kanals (`/api/kanal/aenderungen`), und steht nur mit `use_operator_channel` da.
 */
export const SYSTEM_EVENT_GROUPS = [
    { id: "alle", action: undefined },
    { id: "betrieb", action: "system." },
    { id: "notzugang", action: "recovery." },
    { id: "gesamt", action: undefined },
    { id: "aenderungen", action: undefined },
] as const;
export type EventGroup = (typeof EVENT_GROUPS)[number]["id"] | (typeof SYSTEM_EVENT_GROUPS)[number]["id"];

/** Der Filter einer Gruppe im Protokoll eines Fensters: der Bereich des Fensters, nur „Alles“ ohne ihn. */
export function groupFilter(
    tafel: "konten" | "system",
    gruppe: EventGroup,
): { bereich?: "konten" | "system"; action?: string } {
    const groups: readonly { id: string; action: string | undefined }[] =
        tafel === "konten" ? EVENT_GROUPS : SYSTEM_EVENT_GROUPS;
    const action = groups.find((group) => group.id === gruppe)?.action;
    return {
        ...(gruppe === "gesamt" ? {} : { bereich: tafel }),
        ...(action === undefined ? {} : { action }),
    };
}

/** Die Zeiträume des Protokolls in Tagen; `alles` ohne Grenze. */
export const AUDIT_RANGES = ["7", "30", "90", "alles"] as const;
export type AuditRange = (typeof AUDIT_RANGES)[number];

/** Der Beginn eines Zeitraums als ISO-Zeit, oder nichts. */
export function rangeStart(range: AuditRange, now: Date): string | undefined {
    if (range === "alles") return undefined;
    return new Date(now.getTime() - Number(range) * 86_400_000).toISOString();
}

/** Wie lange etwas noch gilt: „noch 7 Tage“, „noch 19 Std.“, „noch 12 Min.“; vorbei heißt „abgelaufen“. */
export function remainingText(iso: string, now: Date): string {
    const ms = new Date(iso).getTime() - now.getTime();
    if (!Number.isFinite(ms) || ms <= 0) return t("admin.remaining.over");
    const hours = ms / 3_600_000;
    if (hours >= 24) {
        const days = Math.floor(hours / 24);
        return days === 1 ? t("admin.remaining.day") : t("admin.remaining.days", { n: days });
    }
    if (hours >= 1) return t("admin.remaining.hours", { n: Math.floor(hours) });
    return t("admin.remaining.minutes", { n: Math.max(1, Math.floor(ms / 60_000)) });
}

/** Die Anmeldewege einer Person: „Discord · Passwort · 2 Passkeys“. */
export function methodsText(methods: readonly string[], passkeyCount: number): string {
    const parts = methods.filter((method) => method !== "passkey").map((method) => label("admin.methodName", method));
    if (passkeyCount === 1) parts.push(t("admin.methodName.passkey"));
    if (passkeyCount > 1) parts.push(t("admin.methodName.passkeys", { n: passkeyCount }));
    return parts.join(" · ");
}

const EVENT_PREFIX = "admin.event.";
/** Alle Handlungen, die einen Titel haben (`admin.event.<handlung>`); aus der geladenen Tafel, denn beim Bau kommen die Texte der Verwaltung nach (`spaete-texte.ts`). */
const handlungen = (): string[] =>
    Object.keys(tafelVon("de"))
        .filter((key) => key.startsWith(EVENT_PREFIX))
        .map((key) => key.slice(EVENT_PREFIX.length));

/**
 * Die Handlungen, deren Titel in der Sprache der Seite den Suchtext enthält (`qAktionen` der Protokoll-Suche): In der Datenbank steht
 * `person.locked`, angezeigt wird „Gesperrt“. Ohne Groß und Klein; höchstens 80 (so viele nimmt der Server).
 */
export function aktionenMitTitel(text: string): string[] {
    const gesucht = text.trim().toLocaleLowerCase();
    if (gesucht === "") return [];
    return handlungen()
        .filter((handlung) => label("admin.event", handlung).toLocaleLowerCase().includes(gesucht))
        .slice(0, 80);
}
