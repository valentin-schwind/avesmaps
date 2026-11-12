import { watch, type ShallowRef } from "vue";
import type { FensterStand } from "../editor-panel/fenster-verwaltung";

/**
 * Herkunft der Korrektur aus einem Community-Vorgang (WI-0268 C7; Fachkonzept WI-0263 §6: „Wer aus dem Vorgang mit ⚙ den Editor öffnet, trägt den Vorgang als Herkunft
 * mit“). ⚙ im Vorgangsfenster setzt sie (`redaktion-anbindung.ts`); jedes Schreiben am Objekt des Bezugs trägt dann die Kopfzeile `Avesmaps-Herkunft: COM-000123`, und der
 * Server merkt sie sich an der Kartenoperation (`apps/server/src/community/herkunft.ts`, `map_operation.community_vorgang`). „Änderungen“ zeigt daran „aus COM-…“.
 *
 * - 🔴 **Eng begrenzt:** nur schreibende Methoden, nur an die eigene Herkunft, nur unter `/api/editor/`, und nur eine Adresse, die die Kennung des Bezugsobjekts trägt.
 *   Ein GET, eine Kachel, eine Suche oder ein anderes Objekt im selben Editor bekommen sie nie.
 * - **Solange der Editor offen ist:** Die Herkunft endet, wenn kein Fenster des Werkzeugs mehr offen ist (auch abgelegt zählt als offen: Der Entwurf lebt weiter), oder
 *   wenn ⚙ eines anderen Vorgangs eine neue setzt.
 * - **Keine Editor-Datei ändert sich.** Die Editoren rufen `fetch` selbst; `installiereHerkunft` legt EINMAL eine dünne Hülle um `fetch`, die ohne aktive Herkunft nichts
 *   tut als weiterzureichen.
 */

export const HERKUNFT_KOPF = "Avesmaps-Herkunft";
const EDITOR_PFAD = "/api/editor/";
const LESEND = new Set(["GET", "HEAD", "OPTIONS"]);

interface Aktiv {
    readonly nummer: string;
    readonly objektId: string;
    readonly werkzeug: string;
    /** Stand das Fenster des Werkzeugs schon offen? Erst dann beendet sein Schließen die Herkunft. */
    gesehen: boolean;
}

let aktiv: Aktiv | undefined;
/** Die beobachteten Fenster (`installiereHerkunft`): Steht das Werkzeug beim Setzen schon offen, zählt es als gesehen. */
let fensterStand: Readonly<ShallowRef<FensterStand>> | undefined;

const werkzeugOffen = (stand: FensterStand | undefined, werkzeug: string): boolean =>
    stand?.fenster.some((fenster) => fenster.werkzeug === werkzeug) ?? false;

/** ⚙ im Vorgang: Ab jetzt trägt jedes Schreiben am Objekt `objektId` die Nummer `nummer` (Form „COM-000123“). */
export function setzeHerkunft(nummer: string, objektId: string, werkzeug: string): void {
    aktiv = {
        nummer,
        objektId: objektId.toLowerCase(),
        werkzeug,
        gesehen: werkzeugOffen(fensterStand?.value, werkzeug),
    };
}

export function beendeHerkunft(): void {
    aktiv = undefined;
}

/** Die Nummer, die diese Anfrage tragen soll, oder nichts. */
export function herkunftFuer(
    adresse: string,
    methode: string,
    herkunft: string = globalThis.location?.origin ?? "http://localhost",
): string | undefined {
    if (aktiv === undefined || LESEND.has(methode.toUpperCase())) return undefined;
    let url: URL;
    try {
        url = new URL(adresse, herkunft);
    } catch {
        return undefined;
    }
    if (url.origin !== new URL(herkunft).origin || !url.pathname.startsWith(EDITOR_PFAD)) return undefined;
    return url.pathname.toLowerCase().includes(aktiv.objektId) ? aktiv.nummer : undefined;
}

type Abruf = typeof fetch;
const ORIGINAL = Symbol("avesmaps-herkunft-original");

/** Legt die Hülle um `ziel.fetch` (einmal) und beobachtet die Fenster, damit die Herkunft mit dem Editor endet. Gibt den Rückweg zurück. */
export function installiereHerkunft(
    stand: Readonly<ShallowRef<FensterStand>>,
    ziel: { fetch: Abruf } = globalThis,
): () => void {
    const vorher = ziel.fetch as Abruf & { [ORIGINAL]?: Abruf };
    const original = vorher[ORIGINAL] ?? vorher;
    const huelle: Abruf & { [ORIGINAL]?: Abruf } = (eingabe, init) => {
        const adresse = typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
        const methode = init?.method ?? (typeof eingabe === "object" && "method" in eingabe ? eingabe.method : "GET");
        const nummer = herkunftFuer(adresse, methode);
        if (nummer === undefined) return original.call(globalThis, eingabe, init);
        const koepfe = new Headers(init?.headers ?? (eingabe instanceof Request ? eingabe.headers : undefined));
        koepfe.set(HERKUNFT_KOPF, nummer);
        return original.call(globalThis, eingabe, { ...init, headers: koepfe });
    };
    huelle[ORIGINAL] = original;
    ziel.fetch = huelle;
    fensterStand = stand;
    const halt = watch(
        stand,
        (jetzt) => {
            if (aktiv === undefined) return;
            if (werkzeugOffen(jetzt, aktiv.werkzeug)) aktiv.gesehen = true;
            else if (aktiv.gesehen) aktiv = undefined;
        },
        { immediate: true },
    );
    return () => {
        halt();
        fensterStand = undefined;
        ziel.fetch = original;
    };
}
