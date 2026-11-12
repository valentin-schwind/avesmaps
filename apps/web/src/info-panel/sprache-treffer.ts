import {
    SUBJECT_API_BASE,
    subjectKey,
    type SprachTrefferArt,
    type SprachTrefferEintrag,
    type SubjectRef,
    type SubjectSprachTrefferSection,
} from "@avesmaps3d/shared";
import { t, type MessageKey } from "../i18n/i18n";
import { LORE_GROUP_LID_MIN, loreNamesOf, type LoreGroupModel } from "./lore-model";
import { createRevisionCache } from "./subject-cache";
import { editorFetchUrl, fetchUnderLoad } from "./subject-client";

/**
 * Die Trefferzeilen unter „Wo sie gesprochen wird“ (WI-0261; Betreiber 2026-10-31: „das ist falsch designt, kannst du dich hier an das design der bisherigen item
 * in der infobox halten“): DIESELBE Rezeptur wie eine Vorkommens- oder Stättenzeile (`info-lore-row.vue`) - Deckel mit Zählsatz, beim Aufklappen Suchfeld,
 * Gruppenköpfe mit Zahl und die Namen im Buchstabenregister in zwei Spalten. Verschieden ist nur, wen die Zeile fragt und woraus die Gruppen entstehen:
 *
 * - **Gefragt wird erst beim Aufklappen**, je Art eine Antwort (`GET …/sprache/{id}/treffer/{art}`): Garethi trifft rund 4 700 Orte und ebenso viele Wege, die gehören
 *   nicht in die Detailantwort. Sie kommt in einen kurzen Cache wie jede Sektion.
 * - **Die Gruppen sind der Anteil**: Herrschaftsgebiete und Regionen, die ganz im Sprachgebiet liegen, und die, die es nur teilweise berühren. Orte liegen immer ganz darin
 *   (Punkt in Fläche), Wege stehen als Straße ihres Namens: Sie haben EINE Gruppe. Der Kopf steht immer, wie bei den Vorkommen.
 */

/** Ab diesem Anteil zählt ein Gebiet als ganz im Sprachgebiet (gerundet auf ganze Prozent: 99,5 %). */
const GANZ_AB = 0.995;

const cache = createRevisionCache<SubjectSprachTrefferSection>({ ttlMs: 60_000, size: 16 });
const schluessel = (ref: SubjectRef, art: SprachTrefferArt): string => `${subjectKey(ref)}:${art}`;

/** Die Antwort aus dem Cache, damit eine schon geholte Zeile ohne Wartezeile aufklappt. */
export const cachedSprachTreffer = (ref: SubjectRef, art: SprachTrefferArt): SubjectSprachTrefferSection | undefined =>
    cache.get(schluessel(ref, art));

/** Holt alle Treffer einer Art, zuerst aus dem Cache; `null` bei 404 (die Sprache gibt es nicht mehr), sonst wirft ein Fehler. */
export async function loadSprachTreffer(
    ref: SubjectRef,
    art: SprachTrefferArt,
    signal?: AbortSignal,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<SubjectSprachTrefferSection | null> {
    const hit = cachedSprachTreffer(ref, art);
    if (hit !== undefined) return hit;
    if (ref.kind !== "sprache") throw new Error(`Treffer gibt es nur an einer Sprache, nicht an ${ref.kind}`);
    const url = `${SUBJECT_API_BASE}/sprache/${encodeURIComponent(ref.id)}/treffer/${art}`;
    const response = await fetchUnderLoad(fetcher, editorFetchUrl(url), signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url} antwortete ${String(response.status)}`);
    const answer = (await response.json()) as SubjectSprachTrefferSection;
    cache.set(schluessel(ref, art), answer);
    return answer;
}

/** Das Suchfeld nennt, was es durchsucht („Gebiete durchsuchen“). */
export const sprachTrefferSuche = (art: SprachTrefferArt): string => t(`sprache.treffer.suche.${art}` as MessageKey);

const istGanz = (eintrag: SprachTrefferEintrag): boolean => eintrag.anteil === undefined || eintrag.anteil >= GANZ_AB;

/**
 * Die Gruppen einer Trefferliste nach der Regel der Vorkommen (`loreGroupsOf`): Geklappt wird nur, wenn es mehrere Gruppen gibt UND die Zeile mindestens
 * {@link LORE_GROUP_LID_MIN} Namen trägt; dann steht nur die erste offen.
 */
export function sprachTrefferGroupsOf(answer: SubjectSprachTrefferSection): LoreGroupModel[] {
    const mitAnteil = answer.art === "territory" || answer.art === "region";
    const ganz = mitAnteil ? answer.eintraege.filter(istGanz) : [...answer.eintraege];
    const teilweise = mitAnteil ? answer.eintraege.filter((eintrag) => !istGanz(eintrag)) : [];
    const gruppen = [
        {
            key: "ganz",
            heading: t(mitAnteil ? "sprache.treffer.gruppe.ganz" : "sprache.treffer.gruppe.alle"),
            eintraege: ganz,
        },
        { key: "teilweise", heading: t("sprache.treffer.gruppe.teilweise"), eintraege: teilweise },
    ].filter((gruppe) => gruppe.eintraege.length > 0);
    const collapsible = gruppen.length > 1 && answer.eintraege.length >= LORE_GROUP_LID_MIN;
    return gruppen.map((gruppe, at) => {
        const key = `treffer:${answer.art}:${gruppe.key}`;
        return {
            key,
            heading: gruppe.heading,
            count: gruppe.eintraege.length,
            collapsible,
            open: !collapsible || at === 0,
            names: loreNamesOf(
                gruppe.eintraege.map((eintrag) => ({ name: eintrag.name, ref: eintrag.ref })),
                key,
            ),
        };
    });
}
