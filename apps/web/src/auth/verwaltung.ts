import { reactive, ref, type InjectionKey, type Ref } from "vue";
import {
    KONTENVERWALTUNG,
    SYSTEMSTEUERUNG,
    SYSTEMSTEUERUNG_BEREICH,
    kinder,
    sichtbar,
    type AdminInvitation,
    type AdminLegacyIdentity,
    type AdminPerson,
    type AdminPersonDetail,
    type AdminRolesOverview,
    type AuditBereich,
    type AuditEntry,
    type AuditPage,
    type Capability,
    type LinkReceipt,
    type NavEintrag,
    type OperationReceipt,
    type SonderrollenUebersicht,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "./api";
import type { AdminWindowName } from "./auth-windows";
import {
    createReadConfirmation,
    neededConfirmation,
    requestConfirmation,
    withConfirmation,
    type Need,
    type ReadConfirmation,
} from "./bestaetigen";
import { formProblems, type Phrase } from "./formular";

/**
 * Die Daten des Fensters „Verwaltung …“ (WI-0120 A10, AUTH-0001 §12.2; API A7 unter `/api/admin/*`). Jede Handlung trägt ihre
 * `operationId`, eine Änderung an einem Datensatz die gesehene Revision (409 `edit_conflict` heißt: jemand war schneller).
 * Verlangt der Server eine Bestätigung oder einen frischen Passkey, fragt `withConfirmation` nach und wiederholt mit derselben
 * Kennung. Ein Link kommt nur in der ersten Antwort.
 *
 * 🔴 **Auch Lesewege gehen über die Bestätigung** (Hotfix 2026-10-10): Fehlt der Sitzung der zweite Faktor, antwortet schon
 * `GET /api/admin/people` mit 403. Beim Öffnen laden mehrere Listen gleichzeitig; sie teilen EIN Fenster „Kurz bestätigen“
 * (`bestaetigen.ts`). Bricht die Person ab, steht je Bereich, was fehlt (`unconfirmed`), und `confirmAgain` bietet es erneut an.
 *
 * Nach jeder Handlung lädt die Verwaltung neu, was sie berührt hat, auch nach einer Ablehnung: Dann zeigt die Liste den Stand,
 * der die Ablehnung erklärt (ein Konflikt, eine inzwischen gesperrte Person).
 */
export interface AdminDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    /** Die Bestätigung der Lesewege, geteilt mit dem Betriebszustand desselben Fensters. */
    reads?: ReadConfirmation;
}

/**
 * 🔴 Die Einträge der Schiene stehen im Navigationsregister (`packages/shared/src/navigation/`; EDIT-0001 §3.3, WI-0128 E2), dieselbe
 * Tafelform wie das Editorpanel: je Eintrag Bereich, Kennung, Art und Recht. Ein neuer Eintrag ist eine Zeile dort, nie eine Bedingung
 * im Fenster. Der Server prüft trotzdem jede Anfrage; die Tafel steuert nur, was zu sehen ist. Hier steht nur, wie ein Fenster seine
 * Tafel liest: Bereiche ohne Vorsilbe (`personen`, `system`), Einträge mit Art und Recht.
 *
 * - **Zwei Tafeln, zwei Fenster** seit SYS-15 (Betreiber 2026-10-10, SYS-0001 §9d): `KONTENVERWALTUNG` („Kontenverwaltung …“) und
 *   `SYSTEMSTEUERUNG` („Systemsteuerung …“). Die Kennungen sind über beide eindeutig; Rechte und Routen sind die von vorher.
 * - Eine `ansicht` öffnet sich im Rumpf, ein `verweis` öffnet eine eigene Seite in einem neuen Tab (die Statusseite, E6), ein
 *   späterer Eintrag (`spaeter`) steht gestrichelt da und lässt sich nicht wählen.
 * - Ein Fenster und ein Bereich erscheinen nur mit mindestens einer Ansicht, die die Sitzung öffnen darf (Register: `sichtbar`).
 */
export const VERWALTUNG_TAFELN = { konten: KONTENVERWALTUNG, system: SYSTEMSTEUERUNG } as const;
/** Welches der zwei Fenster: die Kontenverwaltung oder die Systemsteuerung. */
export type VerwaltungsTafel = keyof typeof VERWALTUNG_TAFELN;
export const VERWALTUNGS_TAFELN = Object.keys(VERWALTUNG_TAFELN) as VerwaltungsTafel[];

type Tafel = (typeof VERWALTUNG_TAFELN)[VerwaltungsTafel]["eintraege"][number];
type TafelEintrag = Extract<Tafel, { unter: string }>;

export type AdminArea = TafelEintrag["unter"] extends `bereich-${infer Area}` ? Area : never;
export type AdminEntryKind = TafelEintrag["art"];

export interface AdminEntry {
    readonly id: TafelEintrag["id"];
    readonly area: AdminArea;
    readonly kind: AdminEntryKind;
    /** In welchem Fenster der Eintrag steht. */
    readonly tafel: VerwaltungsTafel;
    /** Eines dieser Rechte genügt (AUTH-0001 §12.2: nie „ist Admin“). */
    readonly capabilities: readonly Capability[];
    readonly href?: string;
}
export type AdminEntryId = AdminEntry["id"];
/** Die Einträge, die sich im Rumpf öffnen. */
export type AdminView = Extract<TafelEintrag, { art: "ansicht" }>["id"];

const areaOf = (bereich: string): AdminArea => bereich.slice(SYSTEMSTEUERUNG_BEREICH.length) as AdminArea;

function entryOf(tafel: VerwaltungsTafel, eintrag: NavEintrag): AdminEntry {
    return {
        id: eintrag.id as AdminEntryId,
        area: areaOf(eintrag.unter ?? ""),
        kind: eintrag.art as AdminEntryKind,
        tafel,
        capabilities: eintrag.rechte,
        ...(eintrag.href === undefined ? {} : { href: eintrag.href }),
    };
}

/** Alle Einträge beider Tafeln, ohne die Bereiche (für Tests und Verweise). */
export const ADMIN_ENTRIES: readonly AdminEntry[] = VERWALTUNGS_TAFELN.flatMap((tafel) =>
    (VERWALTUNG_TAFELN[tafel].eintraege as readonly NavEintrag[])
        .filter((eintrag) => eintrag.unter !== null)
        .map((eintrag) => entryOf(tafel, eintrag)),
);

/**
 * Die Ansichten, die eine Sitzung mit diesen Rechten in einem Fenster öffnen darf (ohne Fenster: in beiden); ohne eine gibt es das
 * Fenster und seinen Menüeintrag nicht.
 */
export function adminViewsFor(capabilities: readonly string[], tafel?: VerwaltungsTafel): AdminView[] {
    return (tafel === undefined ? VERWALTUNGS_TAFELN : [tafel]).flatMap((name) =>
        sichtbar(VERWALTUNG_TAFELN[name], capabilities)
            .filter((eintrag) => eintrag.art === "ansicht")
            .map((eintrag) => eintrag.id as AdminView),
    );
}

/**
 * Die Bereiche eines Fensters mit den Einträgen, die eine Sitzung sieht. Ein Bereich ohne Ansicht fällt weg, auch wenn er einen
 * Verweis oder einen späteren Eintrag hätte: Ein Verweis allein ist kein Grund für ein Verwaltungsfenster.
 */
export function adminAreasFor(
    capabilities: readonly string[],
    tafel: VerwaltungsTafel,
): { area: AdminArea; entries: AdminEntry[] }[] {
    const register = VERWALTUNG_TAFELN[tafel];
    return kinder(register, null, capabilities).map((bereich) => ({
        area: areaOf(bereich.id),
        entries: kinder(register, bereich.id, capabilities).map((eintrag) => entryOf(tafel, eintrag)),
    }));
}

/**
 * Wechselt im offenen Verwaltungsfenster die Ansicht (`provide` im Fenster, `inject` in einer Ansicht): „Statusseite“ aus dem
 * Betriebszustand öffnet sie im selben Fenster statt in einem neuen Tab (Betreiber 2026-10-11). Fehlt es, bleibt der Verweis.
 */
export const ZEIGE_ANSICHT: InjectionKey<(id: string) => void> = Symbol("zeige-ansicht");

/**
 * Öffnet im Fenster einen Vorgang des Betreiber-Kanals (WI-0124): die OPS-Nummer eines Wiederherstellungsantrags unter „Backups“. Nur
 * bereitgestellt, wenn das Fenster den Kanal trägt (`use_operator_channel`); sonst steht die Nummer als Text da.
 */
export const ZEIGE_VORGANG: InjectionKey<(ops: string) => void> = Symbol("zeige-vorgang");

/** Welches Fenster eine Tafel zeigt (`auth-windows.ts`). */
export const ADMIN_WINDOWS: Readonly<Record<VerwaltungsTafel, AdminWindowName>> = {
    konten: "kontenverwaltung",
    system: "systemsteuerung",
};

/** Der Parameter des tiefen Links in die Verwaltung (SYS-0001 §9d.1): `?verwaltung=<eintrag>`. */
export const ADMIN_LINK_PARAM = "verwaltung";

/**
 * Liest den tiefen Link `?verwaltung=<eintrag>` (WI-0127 SYS-15, SYS-0001 §9d.1) und gibt die Query ohne ihn zurück: `main.ts` nimmt
 * ihn vor dem Start aus der Adresse, damit ein Neuladen nach dem Schließen das Fenster nicht wieder öffnet. Andere Parameter bleiben.
 */
export function readAdminLink(search: string): { eintrag: string | null; ops?: string; search: string } {
    const params = new URLSearchParams(search);
    const eintrag = params.get(ADMIN_LINK_PARAM);
    if (eintrag === null) return { eintrag, search };
    params.delete(ADMIN_LINK_PARAM);
    // `&ops=OPS-000127` öffnet im Kanal gleich diesen Vorgang (WI-0136); nur in der Form einer OPS-Nummer.
    const ops = params.get("ops");
    params.delete("ops");
    const rest = params.toString();
    return {
        eintrag,
        ...(ops !== null && /^OPS-\d{6}$/u.test(ops) ? { ops } : {}),
        search: rest === "" ? "" : `?${rest}`,
    };
}

/**
 * Das Fenster, das den Eintrag eines tiefen Links trägt, mit dieser Ansicht. Die Kennungen sind über beide Tafeln eindeutig, also
 * findet ein alter Link (`?verwaltung=personen`) nach der Teilung das richtige Fenster. Ohne das Recht für die Ansicht, für einen
 * Verweis oder einen späteren Eintrag geht nichts auf.
 */
export function adminWindowFor(
    eintrag: string | null,
    capabilities: readonly string[],
): { name: AdminWindowName; eintrag: AdminView } | null {
    if (eintrag === null) return null;
    const tafel = VERWALTUNGS_TAFELN.find((name) => (adminViewsFor(capabilities, name) as string[]).includes(eintrag));
    return tafel === undefined ? null : { name: ADMIN_WINDOWS[tafel], eintrag: eintrag as AdminView };
}

export type LoadKey = "people" | "detail" | "invitations" | "roles" | "sonderrollen" | "audit" | "legacy";

export interface AuditFilter {
    /** Der Bereich des Protokolls (SYS-0001 §9d.2): `konten` oder `system`; ohne ihn alles. */
    bereich?: AuditBereich | undefined;
    action?: string | undefined;
    personId?: string | undefined;
    from?: string | undefined;
    /** Freitext (im Server) und die Handlungen, deren Titel ihn enthält (`aktionenMitTitel`). */
    q?: string | undefined;
    qAktionen?: readonly string[] | undefined;
}

export interface ActionResult {
    ok: boolean;
    problems: Phrase[];
    /** Ein Link der Handlung (Einladung, Rücksetzen, Passkey), nur beim ersten Mal; `null` heißt: schon einmal gezeigt. */
    link?: string | null;
    /** Bis wann der Link gilt. */
    expiresAt?: string | null;
    /** Der Server war schneller: wer und wann (ADR-0020). */
    conflict?: { by: string | null; at: string | null };
}

export interface Administration {
    people: Ref<AdminPerson[]>;
    detail: Ref<AdminPersonDetail | null>;
    invitations: Ref<AdminInvitation[]>;
    roles: Ref<AdminRolesOverview | null>;
    /** Zuteilungen samt Verlauf und die Regionen zur Auswahl (WI-0279). */
    sonderrollen: Ref<SonderrollenUebersicht | null>;
    audit: Ref<AuditEntry[]>;
    auditNext: Ref<string | null>;
    legacy: Ref<AdminLegacyIdentity[]>;
    /** Was gerade lädt, je Bereich. */
    loading: ReadonlySet<LoadKey>;
    /** Warum ein Bereich nicht laden konnte. */
    loadProblems: ReadonlyMap<LoadKey, Phrase[]>;
    /** Bereiche, die ohne Bestätigung leer blieben, mit dem, was fehlt (der Server sagt es: zweiter Faktor, Passkey …). */
    unconfirmed: ReadonlyMap<LoadKey, Need>;
    /** Der Knopf in der Zeile: das Fenster „Kurz bestätigen“ erneut, danach lädt jeder wartende Bereich neu. */
    confirmAgain(): void;
    loadPeople(): Promise<void>;
    loadDetail(personId: string): Promise<void>;
    closeDetail(): void;
    loadInvitations(): Promise<void>;
    loadRoles(): Promise<void>;
    loadSonderrollen(): Promise<void>;
    loadAudit(filter: AuditFilter, more?: boolean): Promise<void>;
    loadLegacy(query: string): Promise<void>;
    changeRole(person: AdminPerson, role: string): Promise<ActionResult>;
    revokeAccess(person: AdminPerson): Promise<ActionResult>;
    lock(person: AdminPerson, reason: string): Promise<ActionResult>;
    unlock(person: AdminPerson): Promise<ActionResult>;
    endSessions(person: AdminPerson, sessionId?: string): Promise<ActionResult>;
    /**
     * „Verantwortlich für:“ (WI-0133): an einer anderen Person über `set_responsibility`, am eigenen Konto über den Weg des Kontos
     * (jede Person darf ihren Eintrag ändern, auch ohne das Recht). Leer leert.
     */
    setResponsibility(person: AdminPerson, text: string): Promise<ActionResult>;
    resetLink(person: AdminPerson): Promise<ActionResult>;
    passkeyLink(person: AdminPerson): Promise<ActionResult>;
    revokePasskeys(person: AdminPerson): Promise<ActionResult>;
    grant(person: AdminPerson, capability: string, reason: string): Promise<ActionResult>;
    ungrant(person: AdminPerson, capability: string, reason: string): Promise<ActionResult>;
    vergebeSonderrolle(input: {
        personId: string;
        sonderrolle: string;
        regionen: readonly string[];
        grund: string;
    }): Promise<ActionResult>;
    entzieheSonderrolle(zuteilungId: string, grund: string): Promise<ActionResult>;
    mapLegacy(identity: AdminLegacyIdentity, person: AdminPerson, evidence: string): Promise<ActionResult>;
    unmapLegacy(person: AdminPerson, entry: { id: string; revision: number }): Promise<ActionResult>;
    createInvitation(input: {
        role: string;
        validDays: number;
        note?: string;
        discordUserId?: string;
        sonderrollen?: readonly { sonderrolle: string; regionen?: readonly string[] }[];
        sonderrollenGrund?: string;
    }): Promise<ActionResult>;
    revokeInvitation(invitation: AdminInvitation): Promise<ActionResult>;
    reissueInvitation(invitation: AdminInvitation): Promise<ActionResult>;
}

export function createAdministration(deps: AdminDeps = {}): Administration {
    const people = ref<AdminPerson[]>([]);
    const detail = ref<AdminPersonDetail | null>(null);
    const invitations = ref<AdminInvitation[]>([]);
    const roles = ref<AdminRolesOverview | null>(null);
    const sonderrollen = ref<SonderrollenUebersicht | null>(null);
    const audit = ref<AuditEntry[]>([]);
    const auditNext = ref<string | null>(null);
    const legacy = ref<AdminLegacyIdentity[]>([]);
    const loading = reactive(new Set<LoadKey>());
    const loadProblems = reactive(new Map<LoadKey, Phrase[]>());
    const unconfirmed = reactive(new Map<LoadKey, Need>());
    /** Was ein unbestätigter Bereich neu lädt, sobald die Person es noch einmal anbietet. */
    const reruns = new Map<LoadKey, () => Promise<void>>();
    /** Je Bereich die jüngste Anfrage: Eine ältere Antwort, die später ankommt, überschreibt nichts. */
    const latest = new Map<LoadKey, number>();
    let counter = 0;
    const ask = deps.ask ?? requestConfirmation;
    const reads = deps.reads ?? createReadConfirmation(ask);
    reads.onOffer(() => {
        const waiting = [...reruns.values()];
        reruns.clear();
        return Promise.all(waiting.map((rerun) => rerun()));
    });

    const confirmed = <T>(action: () => Promise<T>): Promise<T> => withConfirmation(action, ask);

    async function load<T>(key: LoadKey, url: string, apply: (body: T) => void): Promise<void> {
        const ticket = ++counter;
        latest.set(key, ticket);
        loading.add(key);
        loadProblems.delete(key);
        unconfirmed.delete(key);
        reruns.delete(key);
        try {
            const body = await withConfirmation(() => getJson<T>(url, deps.fetcher), reads.ask);
            if (latest.get(key) === ticket) apply(body);
        } catch (error) {
            if (latest.get(key) === ticket) {
                loadProblems.set(key, formProblems(error));
                const need = neededConfirmation(error);
                if (need !== null) {
                    unconfirmed.set(key, need);
                    reruns.set(key, () => load(key, url, apply));
                }
            }
        } finally {
            if (latest.get(key) === ticket) loading.delete(key);
        }
    }

    /** Eine Handlung mit Kennung; Bestätigung bei Bedarf, Konflikt mit Wer und Wann; danach wird neu geladen. */
    async function act(
        url: string,
        body: Record<string, unknown>,
        refresh: () => Promise<unknown>,
    ): Promise<ActionResult> {
        const sent = { operationId: newOperationId(), ...body };
        let result: ActionResult;
        try {
            const answer = await confirmed(() => postJson<OperationReceipt | LinkReceipt>(url, sent, deps.fetcher));
            result =
                "link" in answer
                    ? { ok: true, problems: [], link: answer.link, expiresAt: answer.expiresAt }
                    : { ok: true, problems: [] };
        } catch (error) {
            // Abgebrochen (oder nicht bestätigt): Das Neuladen gleich danach fragt nicht noch einmal.
            if (neededConfirmation(error) !== null) reads.decline();
            const failure = error as { code?: string; details?: Record<string, unknown> };
            const by = (failure.details?.["changedBy"] as { displayName?: string } | undefined)?.displayName ?? null;
            const at = typeof failure.details?.["changedAt"] === "string" ? failure.details["changedAt"] : null;
            result = {
                ok: false,
                problems: formProblems(error),
                ...(failure.code === "edit_conflict" ? { conflict: { by, at } } : {}),
            };
        }
        await refresh();
        return result;
    }

    const loadPeople = (): Promise<void> =>
        load<{ people: AdminPerson[] }>("people", "/api/admin/people", (body) => (people.value = body.people));
    const loadDetail = (personId: string): Promise<void> =>
        load<AdminPersonDetail>("detail", `/api/admin/people/${encodeURIComponent(personId)}`, (body) => {
            detail.value = body;
        });
    const loadInvitations = (): Promise<void> =>
        load<{ invitations: AdminInvitation[] }>(
            "invitations",
            "/api/admin/invitations",
            (body) => (invitations.value = body.invitations),
        );
    const loadRoles = (): Promise<void> =>
        load<AdminRolesOverview>("roles", "/api/admin/roles", (body) => (roles.value = body));
    const loadSonderrollen = (): Promise<void> =>
        load<SonderrollenUebersicht>("sonderrollen", "/api/admin/sonderrollen", (body) => (sonderrollen.value = body));

    function auditUrl(filter: AuditFilter, before?: string): string {
        const query = new URLSearchParams();
        if (filter.bereich) query.set("bereich", filter.bereich);
        if (filter.action) query.set("action", filter.action);
        if (filter.personId) query.set("personId", filter.personId);
        if (filter.from) query.set("from", filter.from);
        if (filter.q) {
            query.set("q", filter.q);
            if (filter.qAktionen !== undefined && filter.qAktionen.length > 0)
                query.set("qAktionen", filter.qAktionen.join(","));
        }
        if (before) query.set("before", before);
        query.set("limit", "50");
        return `/api/admin/audit?${query.toString()}`;
    }

    /** Eine Handlung an einer Person: die Liste und, wenn offen, ihr Detail neu; Sonderrechte stehen auch in „Rollen“. */
    function refreshPerson(personId: string): () => Promise<unknown> {
        return () =>
            Promise.all([
                loadPeople(),
                detail.value?.person.id === personId ? loadDetail(personId) : undefined,
                roles.value === null ? undefined : loadRoles(),
            ]);
    }

    const personAction = (url: string, person: AdminPerson, body: Record<string, unknown> = {}) =>
        act(url, { personId: person.id, ...body }, refreshPerson(person.id));

    return {
        people,
        detail,
        invitations,
        roles,
        sonderrollen,
        audit,
        auditNext,
        legacy,
        loading,
        loadProblems,
        unconfirmed,
        confirmAgain: () => reads.offer(),
        loadPeople,
        loadDetail,
        closeDetail(): void {
            latest.delete("detail");
            loading.delete("detail");
            unconfirmed.delete("detail");
            reruns.delete("detail");
            detail.value = null;
        },
        loadInvitations,
        loadRoles,
        loadSonderrollen,
        loadAudit(filter: AuditFilter, more = false): Promise<void> {
            const before = more ? (auditNext.value ?? undefined) : undefined;
            return load<AuditPage>("audit", auditUrl(filter, before), (page) => {
                audit.value = more ? [...audit.value, ...page.events] : page.events;
                auditNext.value = page.next;
            });
        },
        loadLegacy(query: string): Promise<void> {
            const search = new URLSearchParams({ status: "unmapped" });
            if (query.trim() !== "") search.set("q", query.trim());
            return load<{ identities: AdminLegacyIdentity[] }>(
                "legacy",
                `/api/admin/legacy?${search.toString()}`,
                (body) => (legacy.value = body.identities),
            );
        },
        changeRole: (person, role) =>
            personAction("/api/admin/people/role", person, { role, baseRevision: person.accessRevision }),
        revokeAccess: (person) =>
            personAction("/api/admin/people/access/revoke", person, { baseRevision: person.accessRevision }),
        lock: (person, reason) =>
            personAction("/api/admin/people/lock", person, { reason, baseRevision: person.revision }),
        unlock: (person) => personAction("/api/admin/people/unlock", person, { baseRevision: person.revision }),
        endSessions: (person, sessionId) =>
            personAction("/api/admin/people/sessions/revoke", person, sessionId === undefined ? {} : { sessionId }),
        setResponsibility: (person, text) =>
            person.self
                ? act(
                      "/api/account/responsibility",
                      { responsibleFor: text, baseRevision: person.revision },
                      refreshPerson(person.id),
                  )
                : personAction("/api/admin/people/responsibility", person, {
                      responsibleFor: text,
                      baseRevision: person.revision,
                  }),
        resetLink: (person) => personAction("/api/admin/people/reset-link", person),
        passkeyLink: (person) => personAction("/api/admin/people/passkey-link", person),
        revokePasskeys: (person) => personAction("/api/admin/people/passkeys/revoke", person),
        grant: (person, capability, reason) =>
            personAction("/api/admin/people/capabilities/grant", person, { capability, reason }),
        ungrant: (person, capability, reason) =>
            personAction("/api/admin/people/capabilities/revoke", person, { capability, reason }),
        vergebeSonderrolle: (input) =>
            act(
                "/api/admin/sonderrollen/vergeben",
                {
                    personId: input.personId,
                    sonderrolle: input.sonderrolle,
                    ...(input.regionen.length > 0 ? { regionen: input.regionen } : {}),
                    grund: input.grund,
                },
                loadSonderrollen,
            ),
        entzieheSonderrolle: (zuteilungId, grund) =>
            act("/api/admin/sonderrollen/entziehen", { zuteilungId, grund }, loadSonderrollen),
        mapLegacy: (identity, person, evidence) =>
            act(
                "/api/admin/legacy/map",
                { legacyIdentityId: identity.id, personId: person.id, evidence, baseRevision: identity.revision },
                refreshPerson(person.id),
            ),
        unmapLegacy: (person, entry) =>
            act(
                "/api/admin/legacy/unmap",
                { legacyIdentityId: entry.id, baseRevision: entry.revision },
                refreshPerson(person.id),
            ),
        createInvitation: (input) =>
            act(
                "/api/admin/invitations",
                {
                    role: input.role,
                    validDays: input.validDays,
                    ...(input.note ? { note: input.note } : {}),
                    ...(input.discordUserId ? { discordUserId: input.discordUserId } : {}),
                    ...(input.sonderrollen !== undefined && input.sonderrollen.length > 0
                        ? { sonderrollen: input.sonderrollen, sonderrollenGrund: input.sonderrollenGrund }
                        : {}),
                },
                loadInvitations,
            ),
        revokeInvitation: (invitation) =>
            act(
                "/api/admin/invitations/revoke",
                { invitationId: invitation.id, baseRevision: invitation.revision },
                loadInvitations,
            ),
        reissueInvitation: (invitation) =>
            act(
                "/api/admin/invitations/reissue",
                { invitationId: invitation.id, baseRevision: invitation.revision },
                loadInvitations,
            ),
    };
}
