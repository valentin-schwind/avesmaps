/**
 * Der kurze Cache der Subject-Antworten (WI-0063 19): Wer denselben Ort zweimal hintereinander anklickt oder zwischen zwei
 * Orten hin und her springt, soll den Server nicht spüren.
 *
 * 🔴 Gecacht wird NUR unter (`revision`, `subjectKey`): Jede Antwort trägt die `revision` des Datenstands (Satz der Legacy-Daten
 * samt abgeleiteten Gebieten). Der Cache kennt die jüngste Revision, die ihm je begegnet ist; ein Eintrag einer anderen
 * Revision gilt nie - er wäre eine Antwort auf einen Stand, den der Server nicht mehr führt. Dazu läuft jeder Eintrag nach
 * kurzer Zeit ab (`ttlMs`, wie das `max-age` des Servers), und es gibt höchstens `size` Einträge.
 */
export interface RevisionCache<T extends { revision: string }> {
    /** Der frische Eintrag unter diesem Schlüssel - oder `undefined`. */
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    /** Alles vergessen. */
    clear(): void;
    /** Die jüngste Revision, die der Cache gesehen hat. */
    revision(): string | undefined;
}

export function createRevisionCache<T extends { revision: string }>(
    options: { ttlMs: number; size: number; now?: () => number } = { ttlMs: 60_000, size: 40 },
): RevisionCache<T> {
    const now = options.now ?? (() => Date.now());
    const entries = new Map<string, { value: T; at: number }>();
    let latest: string | undefined;
    return {
        get(key) {
            const entry = entries.get(key);
            if (!entry) return undefined;
            const fresh = now() - entry.at < options.ttlMs && entry.value.revision === latest;
            if (!fresh) {
                entries.delete(key);
                return undefined;
            }
            // Zuletzt gelesen = zuletzt verdrängt.
            entries.delete(key);
            entries.set(key, entry);
            return entry.value;
        },
        set(key, value) {
            // Eine andere Revision macht alles Frühere wertlos.
            if (latest !== value.revision) {
                entries.clear();
                latest = value.revision;
            }
            entries.delete(key);
            entries.set(key, { value, at: now() });
            while (entries.size > options.size) {
                const oldest = entries.keys().next().value;
                if (oldest === undefined) break;
                entries.delete(oldest);
            }
        },
        clear() {
            entries.clear();
        },
        revision: () => latest,
    };
}
