import type { Page, Route } from "@playwright/test";
import {
    WETTERMODELL_URL,
    WETTER_PRESET_VORGABEN,
    WETTER_SYMBOL_VORGABEN,
    wettermodellImRahmen,
    wettermodellPaarFehler,
    wettermodellWert,
    wettermodellWirksam,
    type WetterDatenAntwort,
} from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * Das Wettermodell ohne Server (WI-0288 Stufe 4): ein Nachbau von `GET /api/wetter` (Teil `modell`) und
 * `POST /api/admin/system/wettermodell` mit Revision, Grenzen, Paaren und `null` als Zurücksetzen, nach denselben Regeln wie
 * `apps/server/src/wetter/stand.ts` (`verstelleWettermodell`). 🔴 Kein Test schreibt in eine Datenbank; den echten Weg prüft
 * `apps/server/test/wetter.test.ts` auf einem Wegwerf-Cluster.
 */
export interface WettermodellServer {
    readonly abweichungen: Record<string, number>;
    readonly posts: Record<string, unknown>[];
    revision: number;
    /** Die nächste Anfrage an diese Kennung antwortet mit dieser Antwort (etwa 400), statt zu speichern. */
    antwortBei(id: string, antwort: { status: number; body: unknown }): void;
    handle(call: AdminCall): { status: number; body: unknown } | undefined;
}

const fehler = (status: number, code: string, details?: Record<string, unknown>) => ({
    status,
    body: { error: { code, message: code, ...(details === undefined ? {} : { details }) } },
});

export function wettermodellServer(start: Record<string, number> = {}): WettermodellServer {
    const abweichungen: Record<string, number> = { ...start };
    const posts: Record<string, unknown>[] = [];
    const vorab = new Map<string, { status: number; body: unknown }>();
    const server: WettermodellServer = {
        abweichungen,
        posts,
        revision: 3,
        antwortBei: (id, antwort) => void vorab.set(id, antwort),
        handle(call) {
            if (call.method !== "POST" || call.path !== WETTERMODELL_URL) return undefined;
            const body = call.body as { id: string; value: number | null; baseRevision: number };
            posts.push(body);
            const eigene = vorab.get(body.id);
            if (eigene !== undefined) {
                vorab.delete(body.id);
                return eigene;
            }
            const wert = wettermodellWert(body.id);
            if (wert === undefined) return fehler(400, "unknown_setting");
            if (body.value !== null && !wettermodellImRahmen(wert, body.value))
                return fehler(400, "value_out_of_range", { min: wert.min, max: wert.max, vorgabe: wert.vorgabe });
            if (body.baseRevision !== server.revision) return fehler(409, "edit_conflict");
            const ziel = body.value === wert.vorgabe ? null : body.value;
            if (
                (ziel === null && abweichungen[body.id] === undefined) ||
                (ziel !== null && abweichungen[body.id] === ziel)
            )
                return fehler(409, "no_change");
            const danach = { ...abweichungen };
            if (ziel === null) delete danach[body.id];
            else danach[body.id] = ziel;
            const paar = wettermodellPaarFehler(wettermodellWirksam(danach));
            if (paar !== undefined) return fehler(400, "value_out_of_range", { ...paar });
            if (ziel === null) delete abweichungen[body.id];
            else abweichungen[body.id] = ziel;
            server.revision += 1;
            return {
                status: 200,
                body: {
                    operationId: "e2e",
                    status: "applied",
                    environment: "staging",
                    affected: [{ kind: "wettermodell", id: body.id, revision: server.revision }],
                    derivedWork: [],
                    warnings: [],
                },
            };
        },
    };
    return server;
}

/** Der Leseweg des Wetters: Presets und Icons aus den Vorgaben, das Modell aus dem Nachbau. */
export async function stubWetterLeseweg(page: Page, server: WettermodellServer): Promise<void> {
    await page.route("**/api/wetter", (route: Route) => {
        const body: WetterDatenAntwort = {
            presets: WETTER_PRESET_VORGABEN.map((p) => ({ ...p, werte: { ...p.werte }, revision: 0 })),
            symbole: WETTER_SYMBOL_VORGABEN.map((s) => ({ ...s, revision: 0 })),
            modell: {
                revision: server.revision,
                werte: { ...wettermodellWirksam(server.abweichungen) },
                verstellt: Object.keys(server.abweichungen).sort(),
            },
            quelle: { presets: "vorgabe", symbole: "vorgabe", modell: "gespeichert" },
        };
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
}
