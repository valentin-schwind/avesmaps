import { shallowRef, type ShallowRef } from "vue";
import {
    AVENTURIA,
    UUID_PATTERN,
    mapPointRef,
    readObjectLink,
    type ResolveLinkCandidate,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";
import { artNebenName, unnamedLandscapeLabel, unnamedPathLabel } from "../i18n/unnamed";
import type { SubjectClient } from "./subject-client";
import type { SubjectSelection } from "./subject-selection";

/**
 * Die Legacy-Objektlinks beim Start (WI-0063 4.6, Betreiber 2026-10-04): Die Wiki Aventurica verlinkt öffentlich auf
 * avesmaps.de, und jeder Link muss dasselbe öffnen wie heute (AGENTS.md „Links von Legacy bleiben gültig“).
 *
 * - **Die Schlüssel bleiben Legacys:** `siedlung`, `staat`, `region`, `strasse`, `fluss`, `place`, `pin`; die englischen Namen
 *   (`settlement`, `state`, `road`, `river`) sind zusätzliche Aliase auf dieselbe Auflösung. Nach der Normalisierung gilt Legacys
 *   feste Priorität (`readObjectLink` in `@avesmaps3d/shared`): `place`, dann `siedlung`, `staat`, `region`, `strasse`,
 *   `fluss`; stehen deutsch und englisch gleicher Bedeutung zugleich da, gewinnt der deutsche.
 * - **EINE Naht:** Der Link wird auf einen `SubjectRef` aufgelöst (der Server, `GET /api/subjects/resolve-link`; ein `pin`
 *   braucht keinen Server) und über `openSubject` geöffnet - dieselbe Öffnung wie Suche und Karte. Die Kamera fliegt hin.
 * - **Nie still die Startansicht vortäuschen** (Kap. 9.57): Mehrdeutig heißt Auswahlliste, nichts gefunden heißt ein Hinweis,
 *   ein Fehler beim Auflösen heißt auch einer.
 * - **Reihenfolge wie Legacy** (WI-0029): Zuerst der Kurzlink, dann die Reise (beides macht `app.vue` vorher), danach `pin`,
 *   zuletzt der Objektlink - der spätere ersetzt den früheren, wie dort.
 */

const space = AVENTURIA.coordinateSpace;
const WORLD = space.bounds;

/** `?pin=lat,lng` mit drei Stellen (`532.969,551.625`): Legacys Leaflet-Reihenfolge, also `y = lat`, `x = lng`. */
const PIN = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export type PinReading = { x: number; y: number } | "invalid" | "outside";

/** Liest den Wert von `pin`; `invalid`, wenn er keine zwei Zahlen sind, `outside` außerhalb der Karte (Legacy `layer-state.js`). */
export function readPin(value: string): PinReading {
    const match = PIN.exec(value);
    if (!match) return "invalid";
    const y = Number(match[1]);
    const x = Number(match[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return "invalid";
    if (x < WORLD.minX || x > WORLD.maxX || y < WORLD.minY || y > WORLD.maxY) return "outside";
    return { x, y };
}

/** Ein Eintrag der Auswahlliste: der Ref, der Name und die Art in der Sprache der Seite. */
export interface LinkChoice {
    ref: SubjectRef;
    name: string;
    type: string;
}

export interface LinkChoices {
    entries: LinkChoice[];
}

/** Die Art eines Kandidaten als Text: Ortsklasse, Landschaftsart, Wegart aus den Sprachtafeln; Gebietsarten sind Daten. */
function candidateType(candidate: ResolveLinkCandidate): string {
    const key = candidate.type ?? "";
    if (key === "") return "";
    const prefix: Partial<Record<SubjectRef["kind"], string>> = {
        place: "place.",
        area: "landscape.type.",
        path: "path.",
    };
    const name = `${prefix[candidate.ref.kind] ?? ""}${key}`;
    return prefix[candidate.ref.kind] !== undefined && isMessageKey(name) ? t(name as MessageKey) : key;
}

/**
 * Die Auswahlliste aus den Kandidaten; ein namenloser Gegenstand heißt nach dem Satz seiner Art
 * („Unbezeichneter Pfad“, „Wald“).
 *
 * 🔴 Bis WI-0105 stand hier die blanke Art, und beim Weg der rohe Griff - der Server schickte ihn als Titel
 * (`resolve-link.ts`, `pathCandidate`). Beides ist weg: der Griff schon in der Antwort, die blanke Art hier.
 */
export function choicesOf(candidates: readonly ResolveLinkCandidate[]): LinkChoice[] {
    return candidates.map((candidate) => {
        const name = candidate.title ?? unnamedLinkLabel(candidate);
        // Seit OPS-073 heißt eine namenlose Fläche nur noch nach ihrer Art („Wald“); die Art steht dann nicht noch einmal daneben.
        return { ref: candidate.ref, name, type: artNebenName(name, candidateType(candidate)) };
    });
}

/** Der Satz der Art eines Kandidaten, nach seiner Gattung; was keinen hat, heißt „Ohne Namen“. */
function unnamedLinkLabel(candidate: ResolveLinkCandidate): string {
    const key = candidate.type ?? "";
    if (candidate.ref.kind === "path") return unnamedPathLabel(key);
    if (candidate.ref.kind === "area") return unnamedLandscapeLabel(key);
    return key === "" ? t("infoPanel.untitled") : key;
}

export interface ObjectLinkDeps {
    selection: Pick<SubjectSelection, "openSubject">;
    client: Pick<SubjectClient, "resolveLink">;
    /** Der vorhandene Meldungsweg (Toast, wie „Kurzlink nicht gefunden“). */
    notify: (text: string) => void;
    /**
     * Die Kennung einer Sprache zu ihrem Schlüssel (`?sprache=garethi`, WI-0261 S5b); `null`, wenn es sie nicht (aktiv) gibt. Ohne Angabe fragt der Link
     * `GET /api/sprachen/{schluessel}`.
     */
    spracheId?: (schluessel: string) => Promise<string | null>;
}

/** Der Schlüssel einer Sprache in der Adresse: die Form der Tafel (`sprache_schluessel_format`, Migration 0254). */
const SPRACH_SCHLUESSEL = /^[a-z][a-z0-9_-]{0,63}$/u;
/** Die Kennung eines Wetter-Icons in der Adresse (`?wetter=`), wie `UUID_PATTERN` des Vertrags. */
const UUID = new RegExp(UUID_PATTERN, "u");

/** Die Kennung einer Sprache über ihre Leseroute (öffentlich, WI-0261 S2); `null` bei 404. */
export async function spracheIdUeberRoute(
    schluessel: string,
    holen: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<string | null> {
    const antwort = await holen(`/api/sprachen/${encodeURIComponent(schluessel)}`, { cache: "no-cache" });
    if (antwort.status === 404) return null;
    if (!antwort.ok) throw new Error(`/api/sprachen/${schluessel} antwortete ${String(antwort.status)}`);
    const id = ((await antwort.json()) as { id?: unknown }).id;
    return typeof id === "string" && id !== "" ? id : null;
}

export interface ObjectLink {
    /** Die Auswahlliste, solange sie offen ist (mehrdeutiger Link). */
    choices: Readonly<ShallowRef<LinkChoices | undefined>>;
    /** Öffnet, was die Adresse nennt: erst `pin`, dann der Objektlink. Ohne beides geschieht nichts. */
    open(search: string): Promise<void>;
    /** Ein Eintrag der Liste öffnet seinen Gegenstand. */
    choose(ref: SubjectRef): void;
    dismiss(): void;
}

export function createObjectLink(deps: ObjectLinkDeps): ObjectLink {
    const choices = shallowRef<LinkChoices | undefined>(undefined);

    const show = (ref: SubjectRef): void => {
        deps.selection.openSubject(ref, { source: "link", camera: "target" });
    };

    function openPin(value: string): void {
        const point = readPin(value);
        if (point === "invalid" || point === "outside") {
            deps.notify(t(point === "invalid" ? "objectLink.pinInvalid" : "objectLink.pinOutside"));
            return;
        }
        show(mapPointRef(point.x, point.y));
    }

    /** `?sprache=garethi` (WI-0261 S5b): die Infobox der Sprache, die Kamera fliegt auf ihre Hauptteile. */
    async function openSprache(schluessel: string): Promise<void> {
        const wert = schluessel.trim().toLowerCase();
        if (!SPRACH_SCHLUESSEL.test(wert)) {
            deps.notify(t("objectLink.notFound", { value: schluessel }));
            return;
        }
        let id: string | null;
        try {
            id = await (deps.spracheId ?? spracheIdUeberRoute)(wert);
        } catch (error) {
            console.error("Objektlink: Sprache nicht aufgelöst", error);
            deps.notify(t("objectLink.failed"));
            return;
        }
        if (id === null) deps.notify(t("objectLink.notFound", { value: schluessel }));
        else show({ kind: "sprache", id });
    }

    /** `?wetter=<Kennung>` (WI-0288): das Infopanel eines Wetter-Icons mit Wiki-Verweis; ob es eines gibt, sagt die Antwort des Servers (404: der Hinweis des Panels). */
    function openWetter(wert: string): void {
        const id = wert.trim().toLowerCase();
        if (UUID.test(id)) show({ kind: "wetterSymbol", id });
        else deps.notify(t("objectLink.notFound", { value: wert }));
    }

    async function openObject(search: URLSearchParams): Promise<void> {
        const link = readObjectLink((name) => search.get(name));
        if (link === null) return;
        const shownValue = link.value.replaceAll("_", " ");
        let answer;
        try {
            answer = await deps.client.resolveLink(link);
        } catch (error) {
            console.error("Objektlink: nicht aufgelöst", error);
            deps.notify(t("objectLink.failed"));
            return;
        }
        if ("ref" in answer) {
            show(answer.ref);
        } else if ("candidates" in answer) {
            choices.value = { entries: choicesOf(answer.candidates) };
        } else {
            deps.notify(t("objectLink.notFound", { value: shownValue }));
        }
    }

    return {
        choices,
        async open(search) {
            const params = new URLSearchParams(search);
            const pin = params.get("pin");
            if (pin !== null && pin.trim() !== "") openPin(pin);
            const sprache = params.get("sprache");
            if (sprache !== null && sprache.trim() !== "") await openSprache(sprache);
            const wetter = params.get("wetter");
            if (wetter !== null && wetter.trim() !== "") openWetter(wetter);
            await openObject(params);
        },
        choose(ref) {
            choices.value = undefined;
            show(ref);
        },
        dismiss() {
            choices.value = undefined;
        },
    };
}
