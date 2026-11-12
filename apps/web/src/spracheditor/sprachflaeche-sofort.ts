import { landscapeBooleanConsumesTarget, type OperationReceipt } from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import type { NimmErgebnis } from "../editor-sperre/sperre";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { t } from "../i18n/i18n";
import type { FlaechenSofort, SofortAntwort, ZielFeature } from "../map/geometrie/flaechen-quelle";
import { SPRACHE_FILL_LAYER_ID } from "../map/sprachen-layers";
import type { SprachenDaten } from "./sprachen-daten";
import type { SprachSperre } from "./sprach-sperre";

/**
 * Die Teilfläche einer Sprache als Quelle der sofort schreibenden Werkzeuge der Derographie (WI-0261 Stufe 3; Betreiber 2026-10-31: „bau weiter“;
 * `FlaechenSofort` in `map/geometrie/flaechen-quelle.ts`): „Unterflächen ›“, „Zerschneiden“ und „Mit anderer Fläche ›“ laufen als dieselben Modi mit ihren
 * Leisten (`landschaftseditor/unterflaechen.ts`, `zerschneiden.ts`, `mit-anderer-flaeche.ts`); hier steht nur, was die Sprache anders hat.
 *
 * - **Lesen:** die Form der Teilfläche (`GET …/sprachen/:id/flaechen/:flaeche`); eine stillgelegte gibt es nicht.
 * - **Schreiben:** `POST …/flaechen/:flaeche/parts`, `split`, `boolean`, sofort wie an der Landschaft (Ausnahme von EDIT-0003 G4). 🔴 Der Server verlangt die
 *   Sperre der Sprache: jeder Weg nimmt sie für diesen einen Schreibweg (`SprachSperre.unter`) und gibt sie danach ab, es sei denn, ein Entwurf hält sie ohnehin.
 *   Legt „Mit anderer Fläche“ die andere Teilfläche still („vereinigen“, „ausschneiden“), nimmt er auch die Sperre ihrer Sprache.
 * - **Ziele** von „Mit anderer Fläche“: nur Teilflächen ANDERER Sprachen in der Ebene `sprachen-fill` (Editor-Orchestrierung 2026-10-31, keine Derographie); bei
 *   mehreren unter dem Zeiger die kleinste, wie beim Klick auf eine Sprache (`sprachenAnStelle`).
 * - **„Alle Unterflächen vereinigen“** nimmt die Teilflächen derselben Sprache mit, die mit ihr zusammenhängen: Ob es etwas zu verschmelzen gibt, sagt der Server.
 * - 🔴 **„Unterfläche löschen …“ fragt nach** (Betreiber 2026-10-31: „Ja, nachfragen“; das „…“ des Eintrags, EDIT-0003 R6): Bevor geschrieben wird, steht die
 *   Bestätigung im Fenster der Sprache, die Teilfläche gewählt (`frageLoeschen`). Abgebrochen schreibt nichts; der Weg antwortet mit dem Satz „Die
 *   Unterfläche bleibt.“, und der Modus steht wieder bei der Wahl (wie nach einer Ablehnung des Servers). Die Landschaft fragt nicht (Owner 2026-07-27).
 * - **Geschrieben:** die Seite liest nach (Kacheln, die berührten Sprachen, Liste; die Teilfläche bleibt gewählt, G3); nach „Mit anderer Fläche“ sagt der Hinweis
 *   „gespeichert“ mit dem Namen der Sprache, wie an der Landschaft mit dem Namen der Landschaft.
 * - Ohne Verbindung wirft jeder Weg; die Modi sagen es („nichts ist geschrieben“).
 */

export interface SprachflaecheSofortOptionen {
    readonly daten: Pick<
        SprachenDaten,
        "form" | "flaecheTeile" | "flaecheSchneiden" | "flaecheVorschau" | "flaecheVerknuepfen"
    >;
    readonly sperre: Pick<SprachSperre, "unter">;
    /** Das Werkzeug des Spracheditors: Seine Liste zieht ein, solange ein Modus läuft. */
    readonly werkzeug: string;
    /** Geschrieben: Kacheln neu, die berührten Sprachen nachlesen, die Liste; die Teilfläche der Quelle bleibt gewählt. */
    geschrieben(quittung: OperationReceipt, spracheId: string, flaecheId: string): void;
    /** Ein Hinweis unten (Toast). */
    melde(text: string, ton: "warning" | "success"): void;
    /**
     * „Unterfläche löschen …“: die Frage im Fenster der Sprache, ob die Unterfläche `teil` (ab 0) dieser Teilfläche gelöscht wird; `true`: ja, schreiben.
     */
    frageLoeschen(spracheId: string, flaecheId: string, teil: number): Promise<boolean>;
}

/** Ein Schreibweg unter den Sperren dieser Sprachen, in dieser Folge; hält ein anderer eine, kommt sein Ergebnis zurück, ohne zu schreiben. */
async function unterSperren<Q>(
    sperre: Pick<SprachSperre, "unter">,
    sprachen: readonly string[],
    schreibe: () => Promise<SchreibAntwort<Q>>,
): Promise<SchreibAntwort<Q> | Exclude<NimmErgebnis, { art: "genommen" }>> {
    const [erste, ...weitere] = sprachen;
    if (erste === undefined) return schreibe();
    return sperre.unter(erste, () => unterSperren(sperre, weitere, schreibe));
}

/** Die Antwort eines Schreibwegs für die Modi: der Wert oder der Satz; ohne Verbindung wirft sie. */
function alsAntwort<Q>(ergebnis: SchreibAntwort<Q> | Exclude<NimmErgebnis, { art: "genommen" }>): SofortAntwort<Q> {
    if ("art" in ergebnis)
        return ergebnis.art === "gesperrt"
            ? { ok: false, satz: t("entwurf.gesperrt", { wer: ergebnis.sperre.person.name }) }
            : { ok: false, satz: t("entwurf.sperrfehler") };
    if (ergebnis.ok) return { ok: true, wert: ergebnis.quittung };
    if (ergebnis.status === 0) throw new Error(ergebnis.fehler.message);
    return { ok: false, satz: ergebnis.fehler.message };
}

/**
 * Die Quelle für EINE Teilfläche einer Sprache (`flaecheId`, sie bleibt nach dem Schreiben gewählt): `name` steht in den Leisten (etwa „Garethi · Teilfläche 3“), `spracheName` im Hinweis nach „Mit anderer
 * Fläche“. Die Modi starten mit der Sprache als Objekt und der Teilfläche als Fläche.
 */
export function sprachflaecheSofort(
    optionen: SprachflaecheSofortOptionen,
    sprache: { readonly id: string; readonly flaecheId: string; readonly name: string; readonly spracheName: string },
): FlaechenSofort {
    const { daten, sperre } = optionen;
    /** Je Ziel seine Sprache, wie die Karte sie nennt: Legt „Mit anderer Fläche“ das Ziel still, braucht es auch deren Sperre. */
    const zielSprache = new Map<string, string>();
    return {
        werkzeug: optionen.werkzeug,
        async lies(id, flaecheId) {
            try {
                const form = await daten.form(id, flaecheId, new AbortController().signal);
                return {
                    ok: true,
                    wert:
                        form === null || !form.aktiv
                            ? undefined
                            : { name: sprache.name, teile: form.polygons, revision: form.revision },
                };
            } catch (error) {
                if (error instanceof ApiFailure && error.status !== 0) return { ok: false, satz: error.message };
                throw error;
            }
        },
        async teile(id, flaecheId, body) {
            if (body.operation === "loeschen" && !(await optionen.frageLoeschen(id, flaecheId, body.part ?? 0)))
                return { ok: false, satz: t("spracheditor.unterflaechen.bleibt") };
            return alsAntwort(await unterSperren(sperre, [id], () => daten.flaecheTeile(id, flaecheId, body)));
        },
        schneide: async (id, flaecheId, body) =>
            alsAntwort(await unterSperren(sperre, [id], () => daten.flaecheSchneiden(id, flaecheId, body))),
        vorschau: async (id, flaecheId, body, signal) =>
            alsAntwort(await daten.flaecheVorschau(id, flaecheId, body, signal)),
        async verknuepfe(id, flaecheId, body) {
            const andere = zielSprache.get(body.targetAreaId);
            const sprachen =
                landscapeBooleanConsumesTarget(body.operation) && andere !== undefined ? [id, andere] : [id];
            return alsAntwort(
                await unterSperren(sperre, sprachen, () => daten.flaecheVerknuepfen(id, flaecheId, body)),
            );
        },
        zielEbenen: () => [SPRACHE_FILL_LAYER_ID],
        ziel(features: readonly ZielFeature[], flaecheId: string) {
            let beste: { id: string; sprache: string; flaeche: number } | undefined;
            for (const feature of features) {
                const p = feature.properties;
                const andere = p["sprache_public_id"];
                const teil = p["public_id"] ?? feature.id;
                if (typeof andere !== "string" || andere === sprache.id) continue;
                if (typeof teil !== "string" || teil === "" || teil === flaecheId) continue;
                const flaeche = Number(p["area"]);
                const groesse = Number.isFinite(flaeche) ? flaeche : Infinity;
                if (beste === undefined || groesse < beste.flaeche)
                    beste = { id: teil, sprache: andere, flaeche: groesse };
            }
            if (beste !== undefined) zielSprache.set(beste.id, beste.sprache);
            return beste?.id;
        },
        geschrieben(quittung, werkzeug) {
            optionen.geschrieben(quittung, sprache.id, sprache.flaecheId);
            if (werkzeug === "mitAnderer")
                optionen.melde(t("landschaftseditor.mitAnderer.gespeichert", { name: sprache.spracheName }), "success");
        },
        vereinigtMitAnderen: true,
        saetze: {
            herausgeloest: "spracheditor.unterflaechen.herausgeloest",
            geschnitten: "spracheditor.zerschneiden.geschnitten",
        },
    };
}
