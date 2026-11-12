import { Value } from "@sinclair/typebox/value";
import { AdminSystemOverview } from "@avesmaps3d/shared";

/**
 * Der Betriebszustand zum Anfassen ohne Datenbank (WI-0127 SYS-5): `GET /api/admin/system` und die Umschaltungen `mode` und `lock`
 * als kleiner Server im Speicher, für `verwaltung-stub.ts`. 🔴 Jede Antwort wird gegen den Vertrag aus `packages/shared` geprüft
 * (`AdminSystemOverview`), damit der Nachbau nicht still vom echten Server wegläuft; die echte Route gegen PostgreSQL prüft
 * `apps/server/test/system-state.test.ts`.
 *
 * Umschalten wirkt sofort auf „eingestellt“ und „wirksam“ (eine Instanz, die gleich nachzieht), mit Revision, Zeit und Person;
 * eine veraltete `baseRevision` gibt 409 `edit_conflict` wie der Server.
 */
type Overview = AdminSystemOverview;

export interface Person {
    id: string;
    displayName: string;
}

const open = { locked: false, since: null, by: null, byLabel: null, reason: null };

/** Eine Person, wie der Vertrag sie nennt (`PersonRef`): nur Kennung und Anzeigename, auch wenn die Sitzung mehr trägt. */
const ref = (person: Person): Person => ({ id: person.id, displayName: person.displayName });

/** Ein Stand in der Szene des Blatts: Normal seit gestern Abend, beide Sperren offen, zwei Inhaber mit Passkey. */
export function systemOverview(person: Person, change: (overview: Overview) => void = () => undefined): Overview {
    const me = ref(person);
    const now = Date.now();
    const at = (ms: number): string => new Date(now - ms).toISOString();
    const overview: Overview = {
        configured: {
            mode: { mode: "normal", since: at(17 * 3_600_000), by: me, byLabel: null, reason: null },
            mapLock: { ...open },
            systemLock: { ...open },
            queuePause: { paused: false, since: null, by: null, byLabel: null, reason: null },
            revision: 7,
            contentRevision: 1,
            updatedAt: at(17 * 3_600_000),
        },
        effective: {
            source: "database",
            mode: "normal",
            mapLock: false,
            systemLock: false,
            revision: 7,
            contentRevision: 1,
            readAt: at(4_000),
            ready: true,
        },
        restrictedAccessHolders: [
            { person: { id: "2c4e6a80-1b3d-4f5a-8c7e-9d0b1a2c3d4e", displayName: "Hesindiane" }, hasPasskey: true },
            { person: me, hasPasskey: true },
        ],
        brief: {
            now: at(0),
            releaseId: "028ec13",
            startedAt: at(17 * 3_600_000),
            map: "ready",
            login: "ready",
            routing: "ready",
            queue: { running: 1, queued: 0 },
        },
    };
    change(overview);
    return checked(overview);
}

function checked(overview: Overview): Overview {
    const errors = [...Value.Errors(AdminSystemOverview, overview)].map((error) => `${error.path}: ${error.message}`);
    if (errors.length > 0) throw new Error(`Nachbau weicht vom Vertrag ab: ${errors.join("; ")}`);
    return overview;
}

export interface SystemCall {
    method: string;
    path: string;
    body: Record<string, unknown> | null;
}

/** Der kleine Server: `handle` beantwortet GET und die zwei Umschaltungen, sonst `undefined`. */
export interface SystemServer {
    /** Der Stand im Speicher; gesetzt wird er geprüft gegen den Vertrag. */
    state: Overview;
    handle(call: SystemCall): { status: number; body: unknown } | undefined;
}

export function systemServer(person: Person, initial: Overview): SystemServer {
    const me = ref(person);
    let state: Overview = structuredClone(initial);
    const conflict = () => ({
        status: 409,
        body: {
            error: {
                code: "edit_conflict",
                message: "vom Nachbau",
                details: { currentRevision: state.configured?.revision, changedBy: null, changedAt: null },
            },
        },
    });
    function apply(change: (configured: NonNullable<Overview["configured"]>, now: string) => void) {
        const configured = state.configured!;
        const now = new Date().toISOString();
        change(configured, now);
        configured.revision += 1;
        configured.updatedAt = now;
        state.effective = {
            ...state.effective,
            mode: configured.mode.mode,
            mapLock: configured.mapLock.locked,
            systemLock: configured.systemLock.locked,
            revision: configured.revision,
            readAt: now,
        };
        return { status: 200, body: { status: "applied", operationId: "nachbau" } };
    }
    return {
        get state(): Overview {
            return state;
        },
        set state(next: Overview) {
            state = checked(structuredClone(next));
        },
        handle(call: SystemCall): { status: number; body: unknown } | undefined {
            if (call.path === "/api/admin/system" && call.method === "GET") {
                return {
                    status: 200,
                    body: checked({ ...state, brief: { ...state.brief, now: new Date().toISOString() } }),
                };
            }
            if (call.method !== "POST" || !call.path.startsWith("/api/admin/system/")) return undefined;
            const body = call.body ?? {};
            if (body["baseRevision"] !== state.configured?.revision) return conflict();
            const reason = typeof body["reason"] === "string" ? body["reason"] : null;
            if (call.path === "/api/admin/system/mode") {
                return apply((configured, now) => {
                    configured.mode = {
                        mode: body["mode"] as "normal" | "restricted",
                        since: now,
                        by: me,
                        byLabel: null,
                        reason,
                    };
                });
            }
            if (call.path === "/api/admin/system/lock") {
                const setting = {
                    locked: body["locked"] === true,
                    since: new Date().toISOString(),
                    by: me,
                    byLabel: null,
                    reason,
                };
                return apply((configured) => {
                    if (body["lock"] === "map") configured.mapLock = setting;
                    else configured.systemLock = setting;
                });
            }
            return undefined;
        },
    };
}
