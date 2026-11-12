import { randomBytes } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { Role } from "@avesmaps3d/shared";
import { TEST_ORIGIN, type AuthFixture, type SessionOptions } from "../auth-fixture.ts";
import type { VpsCluster } from "../vps-cluster.ts";

/**
 * Die Welt des Rauchtests der Schreibwege (WI-0189 Etappe 2a, `apps/server/test/schreibwege-app-rolle.test.ts`): ein Wegwerf-Cluster mit
 * allen Vorlagen, Fastify als App-Rolle, und was die Fälle brauchen, um Personen und Zeilen anzulegen. Personen und Zeilen legt der
 * Superuser an (`cluster.admin`), geschrieben wird nur über die Route.
 */

export interface Person {
    id: string;
    name: string;
    cookie: string;
}

export interface Welt {
    readonly cluster: VpsCluster;
    readonly app: FastifyInstance;
    readonly fixture: AuthFixture;
    /** Ein absoluter, leerer Ordner, in dem die Fälle Dateien ablegen dürfen (etwa die Quelle der Typbilder). */
    readonly ordner: string;
    /**
     * Eine neue Person mit Sitzung in `test`. `frisch`: Passkey vor einer Minute bestätigt (Stufe S); `passkey`: dazu eine Zeile in
     * `passkey_credential` (der eingeschränkte Betrieb verlangt eine Person, die ihn wieder verlassen kann).
     */
    jemand(
        role: Role,
        options?: { frisch?: boolean; passkey?: boolean; status?: "active" | "locked"; sitzung?: SessionOptions },
    ): Promise<Person>;
    /** Ein Aufruf wie aus dem Browser: Herkunft immer, Cookie, wenn angegeben; danach liest die Instanz den Betriebszustand neu. */
    post(
        url: string,
        cookie: string | undefined,
        payload?: object,
        method?: "POST" | "PATCH",
    ): Promise<LightMyRequestResponse>;
    /** Ein Schritt vor oder nach dem eigentlichen Aufruf muss gelingen; sonst bricht der Fall mit der Antwort ab. */
    muss(antwort: LightMyRequestResponse, status?: number): LightMyRequestResponse;
}

/** Ein Schreibweg, einmal gerufen: Vorbereitung, der Aufruf selbst (seine Antwort ist das Ergebnis), Aufräumen. */
export interface Fall {
    /** Der Status, an dem man sieht, dass der Aufruf die Datenbank erreicht hat (meist 200). */
    readonly erwartet: number;
    rufe(welt: Welt): Promise<LightMyRequestResponse>;
}

export type Faelle = Readonly<Record<string, Fall>>;

/**
 * Die Statusdatei der Production-Freigabe, so klein wie der Vertrag sie zulässt (`system-protokollpflicht.test.ts`): Production und
 * Stage verschieden, Stage grün; sonst wäre der Weg nach Production zu und die Route käme nicht bis zur Datenbank.
 */
export const FREIGABE_DATEI = {
    schema: 1,
    standAt: "2026-10-14T00:00:00.000Z",
    production: { release: "aaaaaaa", commit: "a".repeat(40), seit: "2026-10-13T00:00:00.000Z" },
    stage: { release: "bbbbbbb", commit: "b".repeat(40), seit: "2026-10-14T00:00:00.000Z" },
    stageGruen: true,
    stagePruefung: "Proben und Journal gruen",
    technik: { migrationen: [], rechte: [], umgebungswerte: [] },
    themen: [],
} as const;

/** Die Rückgabe einer Operation (ADR-0018): Was sie angelegt oder geändert hat, mit neuer Revision. */
export function betroffen(antwort: LightMyRequestResponse, kind?: string): { id: string; revision: number } {
    const affected = (antwort.json() as { affected: { kind: string; id: string; revision: number }[] }).affected;
    const eintrag = kind === undefined ? affected[0] : affected.find((entry) => entry.kind === kind);
    if (eintrag === undefined) throw new Error(`Quittung ohne ${kind ?? "Eintrag"}: ${antwort.body}`);
    return eintrag;
}

/** Ein Passkey, der nur als Zeile existiert (ohne Schlüssel): genug für Listen, Entziehen und den eingeschränkten Betrieb. */
export async function passkeyZeile(welt: Welt, personId: string): Promise<string> {
    const [row] = await welt.cluster.admin<{ id: string }[]>`
        INSERT INTO avesmaps_auth.passkey_credential (person_id, environment, rp_id, credential_id, public_key, created_via)
        VALUES (${personId}, 'test', 'avesmaps.test', ${randomBytes(16).toString("base64url")}, ${randomBytes(8)}, 'passkey')
        RETURNING id::text
    `;
    return row!.id;
}

export function welt(cluster: VpsCluster, app: FastifyInstance, fixture: AuthFixture, ordner: string): Welt {
    const self: Welt = {
        cluster,
        app,
        fixture,
        ordner,
        async jemand(role, options = {}) {
            const person = await fixture.person(role, { status: options.status ?? "active" });
            if (options.passkey === true) await passkeyZeile(self, person.id);
            const { cookie } = await fixture.session(person.id, {
                ...(options.frisch === true ? { passkeyMinutesAgo: 1 } : {}),
                ...options.sitzung,
            });
            return { ...person, cookie };
        },
        async post(url, cookie, payload, method = "POST") {
            const antwort = await app.inject({
                method,
                url,
                headers: {
                    host: "avesmaps.test",
                    origin: TEST_ORIGIN,
                    "user-agent": "Rauchtest",
                    ...(cookie === undefined ? {} : { cookie }),
                },
                ...(payload === undefined ? {} : { payload }),
            });
            await app.systemState?.refresh();
            return antwort;
        },
        muss(antwort, status = 200) {
            if (antwort.statusCode !== status) {
                throw new Error(`Vorbereitung: ${String(antwort.statusCode)} statt ${String(status)}: ${antwort.body}`);
            }
            return antwort;
        },
    };
    return self;
}
