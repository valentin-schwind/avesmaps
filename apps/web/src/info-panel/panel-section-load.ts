import { subjectKey, subjectSectionUrl, type SubjectRef, type SubjectSection } from "@avesmaps3d/shared";
import { createRevisionCache, type RevisionCache } from "./subject-cache";
import { editorFetchUrl, editorSicht, fetchUnderLoad } from "./subject-client";

/**
 * Wie das Panel eine Sektion nachlädt (`GET /api/subjects/{kind}/{id}/{sektion}`) - EINE Rezeptur für alle: Kartensammlung,
 * Literatur, Bewertungen und die Vorkommen (WI-0063 19, P8; WI-0091 §4.1).
 *
 * 🔴 Schwere Listen gehören nicht in die Detailantwort. Das Panel baut einen Abschnitt oder eine Zeile nur, wo die Detailantwort
 * ihn zählt (`counts`), und holt den Inhalt erst, wenn er gebraucht wird - bei den Vorkommen beim Aufklappen (Median 47 geerbte
 * Einträge je Ort, höchstens 256; die eifrige Liste wäre an jedem Ort dreistellig).
 *
 * 🔴 Gecacht wird NUR unter (`revision`, `subjectKey`) und kurz (`subject-cache.ts`): Wer denselben Gegenstand zweimal anklickt,
 * soll den Server nicht spüren. Eine Absage wegen Last (503) fragt der Dienst selbst noch einmal (`fetchUnderLoad`, die Regel des
 * Planers); `null` bei 404 (den Gegenstand gibt es nicht mehr), jeder andere Fehler wirft - die Stelle zeigt dann ihren kleinen
 * Fehlerzustand, der Rest des Panels bleibt benutzbar.
 */

/**
 * Sieht dieser Betrachter ausgeblendete Abschnitte echt (WI-0127 SYS-11, SYS-0001 §3.4)? Ein Editor mit `use_editor_menu` im Editor-Modus:
 * Er fragt mit `?editor=true`, der Server prüft das Recht selbst und antwortet mit dem Vermerk `publicHidden`. Ein Besucher fragt ohne.
 */
export const editorSektionen = editorSicht;

/** Die Adresse einer Sektion, für einen Editor mit `editor=true`. */
export function sectionFetchUrl(url: string, editor: boolean = editorSektionen()): string {
    return editorFetchUrl(url, editor);
}

/** Jede Sektion hat ihren eigenen kurzen Cache; sie werden beim ersten Zugriff angelegt. */
const caches = new Map<SubjectSection, RevisionCache<{ revision: string }>>();

const cacheOf = <T extends { revision: string }>(section: SubjectSection): RevisionCache<T> => {
    const known = caches.get(section);
    if (known !== undefined) return known as RevisionCache<T>;
    const fresh = createRevisionCache<T>();
    caches.set(section, fresh as RevisionCache<{ revision: string }>);
    return fresh;
};

/** Holt die Liste einer Sektion, ohne Cache. */
export async function fetchSection<T extends { revision: string }>(
    section: SubjectSection,
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<T | null> {
    const url = subjectSectionUrl(ref, section);
    if (url === null) throw new Error(`Subject ${ref.kind} hat keine Sektion ${section}`);
    const response = await fetchUnderLoad(fetcher, sectionFetchUrl(url), signal);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url} antwortete ${String(response.status)}`);
    return (await response.json()) as T;
}

/** Die frische Liste aus dem Cache - oder `undefined`; sie erlaubt der Stelle, ohne Wartezeile zu zeichnen. */
export const cachedSection = <T extends { revision: string }>(
    section: SubjectSection,
    ref: SubjectRef,
    store: RevisionCache<T> = cacheOf<T>(section),
): T | undefined => store.get(subjectKey(ref));

/** Holt die Liste, zuerst aus dem Cache; eine gefundene Liste wandert hinein. */
export async function loadSection<T extends { revision: string }>(
    section: SubjectSection,
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher?: typeof fetch,
    store: RevisionCache<T> = cacheOf<T>(section),
): Promise<T | null> {
    const hit = cachedSection(section, ref, store);
    if (hit !== undefined) return hit;
    const answer = await fetchSection<T>(section, ref, signal, fetcher);
    if (answer !== null) store.set(subjectKey(ref), answer);
    return answer;
}

/**
 * Holt die Liste am kurzen Cache UND am Zwischenspeicher des Browsers vorbei und legt die frische Antwort in den Cache (WI-0269): Wer gerade eine Bewertung geschrieben hat, soll sie
 * sehen, nicht den Stand von vor einer Minute (`public, max-age=60`).
 */
export async function reloadSection<T extends { revision: string }>(
    section: SubjectSection,
    ref: SubjectRef,
    signal?: AbortSignal,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    store: RevisionCache<T> = cacheOf<T>(section),
): Promise<T | null> {
    const url = subjectSectionUrl(ref, section);
    if (url === null) throw new Error(`Subject ${ref.kind} hat keine Sektion ${section}`);
    const response = await fetchUnderLoad(fetcher, sectionFetchUrl(url), signal, "reload");
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url} antwortete ${String(response.status)}`);
    const answer = (await response.json()) as T;
    store.set(subjectKey(ref), answer);
    return answer;
}
