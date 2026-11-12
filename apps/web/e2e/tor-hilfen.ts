import { expect, type APIRequestContext } from "@playwright/test";
import { EDITOR_LOCK_KINDS, EDITOR_LOCKS_URL, type EditorLockList } from "@avesmaps3d/shared";
import { weltToken } from "./welt.ts";

/**
 * Gemeinsame Handgriffe der Tor-Specs (`tor-orte`, `tor-wege`, `tor-flaechen`, `tor-inhalte`; WI-0264).
 *
 * 🪤 Sperren überleben das Ende eines Falls: Ein Browser, den der Test schließt, gibt nichts frei (EDIT-0003 §4: „ein abgestürzter Browser
 * gibt nie frei, dafür sind die 15 Minuten da“), und dieselbe Person in einem zweiten Fenster ist ein anderer Lauf und bekommt eine Sperre
 * nicht, solange der erste schlägt. Ohne Aufräumen hängt der nächste Fall (oder die Wiederholung) am Rest des vorigen: Der Modus „Ort
 * verschieben“ beginnt nicht, der Weg ist „von Tor-Editor gesperrt“.
 */

/**
 * Hebt jede Sperre der Welt auf, mit der Sitzung von „Tor-Admin“ (Recht `manage_people`, `POST /api/editor/locks/lift`): die einzige Stelle,
 * die einen fremden Lauf löst, und derselbe Handgriff, den ein Admin am Schild hat (WI-0215).
 */
export async function hebeSperrenAuf(request: APIRequestContext, herkunft: string): Promise<void> {
    const kopf = { cookie: `avesmaps-session=${weltToken("admin")}`, origin: herkunft };
    for (const art of EDITOR_LOCK_KINDS) {
        const liste = await request.get(`${EDITOR_LOCKS_URL}?kind=${art}`, { headers: kopf });
        expect(liste.status(), `GET ${EDITOR_LOCKS_URL}?kind=${art}: ${await liste.text()}`).toBe(200);
        for (const sperre of ((await liste.json()) as EditorLockList).locks) {
            const antwort = await request.post(`${EDITOR_LOCKS_URL}/lift`, {
                headers: kopf,
                data: { kind: sperre.kind, id: sperre.id },
            });
            expect(antwort.status(), `Sperre ${sperre.kind} ${sperre.id} aufheben: ${await antwort.text()}`).toBe(204);
        }
    }
}
