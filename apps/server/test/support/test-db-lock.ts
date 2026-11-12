/**
 * Die Testdatenbank gehört einer Testdatei zur Zeit, auch über Prozessgrenzen (WI-0101).
 *
 * 🔴 **Warum eine Sperre und nicht ein eigener Namensraum je Datei.** Die Fixtures sind schon je Paket
 * namensgeraumt (`public_id`-Präfixe wie `64000000-`, `80000000-`, Marken wie `p68t-`). Das hilft nur
 * INNERHALB eines Prozesses. Laufen zwei Sitzungen gleichzeitig, benutzen beide DIESELBEN Präfixe:
 * der scope-genaue `DELETE … WHERE public_id LIKE '68000000-%'` der einen trifft dann die Zeilen der
 * anderen. Gemessen am 2026-10-07 mit zwei gleichzeitigen Läufen desselben Satzes von 25 Dateien:
 * Lauf A 10 Dateien rot, Lauf B 6, Überschneidung 3; Meldungen
 * `place_wiki_assignment_place_id_fkey`, `place_wiki_assignment_snapshot_id_fkey`,
 * `terrain_peak_wiki_assignment_snapshot_id_fkey`, `lore_place_target_terrain_peak_id_fkey`,
 * `media_file_media_asset_id_fkey`, `publication_rule_one_active`, dazu Zähl- und Paritätsfälle.
 * Ein Namensraum JE LAUF wäre die Alternative, bedeutet aber, dass jede feste Kennung in Fixture und
 * Erwartung mitwandert. Und für `job*` und die domänenweit arbeitenden Importer (`importPlaces`
 * stellt alles still, was in seinem Fenster liegt) gibt es überhaupt keine Kennung zum Wandern.
 *
 * `vitest.config.ts` hält mit `fileParallelism: false` denselben Vertrag innerhalb eines Prozesses.
 * Diese Sperre ist seine Fortsetzung über Prozesse hinweg, nichts anderes.
 *
 * 🪤 Die Sperre ist eine Sitzungssperre (`pg_advisory_lock`): bricht ein Lauf ab, fällt sie mit der
 * Verbindung. Eine Leiche kann sie also nicht werden.
 */

/** Die Klasse der Sperre. Eigener Name, damit sie sich nie mit der Ableitungssperre (`derive-lock.ts`) kreuzt. */
const LOCK_CLASS = "avesmaps3d:test-database";

/** Wie lange eine Datei höchstens auf die Testdatenbank wartet, in Sekunden. */
export const DEFAULT_WAIT_S = 420;

/** Wie oft nachgefragt wird, in Millisekunden. */
const POLL_MS = 200;

/** Nach wie vielen Sekunden Wartezeit eine Zeile ins Log geht. */
const REPORT_EVERY_S = 60;

export interface TestDatabaseLease {
    /** Wurde die Sperre wirklich genommen? `false` heißt: die Wartezeit lief ab, die Datei läuft ungeschützt weiter. */
    readonly held: boolean;
    /** Wie lange gewartet wurde, in Millisekunden. */
    readonly waitedMs: number;
    release(): Promise<void>;
}

function waitLimitMs(): number {
    const raw = process.env["AVESMAPS_TEST_DB_LOCK_WAIT_S"];
    const seconds = raw === undefined ? DEFAULT_WAIT_S : Number(raw);
    return (Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_WAIT_S) * 1000;
}

/**
 * Nimmt die Testdatenbank für den Aufrufer in Besitz und gibt sie mit `release()` wieder zurück.
 *
 * `who` steht nur im Log; die Sperre selbst ist eine einzige, globale.
 */
export async function leaseTestDatabase(databaseUrl: string, who: string): Promise<TestDatabaseLease> {
    // 🪤 Erst hier geladen, nicht oben: `vitest.setup.ts` lädt dieses Modul für JEDE der rund 360
    // Testdateien, auch für die ohne Datenbank. Nur die mit Datenbank zahlen den Treiber.
    const postgres = (await import("postgres")).default;
    // 💣 NICHT `createDatabase`: das setzt `idle_timeout: 30`, und eine Sitzungssperre fällt mit ihrer
    // Verbindung. Die Sperrverbindung fragt genau einmal und liegt danach still: nach 30 s hätte
    // postgres.js sie geschlossen und die Sperre lautlos freigegeben. Gemessen am 2026-10-07: genau die
    // Dateien, die länger als 30 s laufen (`verify-media` 37 s, `subjects` 42 s), kollidierten weiter,
    // alle kürzeren waren grün. `idle_timeout: 0` heißt „nie von selbst schließen".
    const lock = postgres(databaseUrl, { max: 1, idle_timeout: 0, connect_timeout: 10, onnotice: () => {} });
    const started = Date.now();
    const limit = waitLimitMs();
    let reportedAtS = 0;
    let held = false;
    try {
        for (;;) {
            const [row] = await lock<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${LOCK_CLASS})) AS ok`;
            if (row?.ok === true) {
                held = true;
                break;
            }
            const waited = Date.now() - started;
            if (waited >= limit) {
                // Kein stilles Weiterlaufen: wer die Zeile sieht, weiß, warum ein roter Fall nichts bedeutet.
                process.stderr.write(
                    `[WI-0101] ${who}: die Testdatenbank blieb ${String(Math.round(waited / 1000))} s belegt. ` +
                        `diese Datei läuft OHNE Alleinbesitz weiter, ein roter Fall kann Fremdlast sein.\n`,
                );
                break;
            }
            const waitedS = Math.floor(waited / 1000);
            if (waitedS - reportedAtS >= REPORT_EVERY_S) {
                reportedAtS = waitedS;
                process.stderr.write(
                    `[WI-0101] ${who}: wartet seit ${String(waitedS)} s auf die Testdatenbank (eine andere Sitzung prüft).\n`,
                );
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
    } catch (error) {
        await lock.end({ timeout: 5 }).catch(() => undefined);
        throw error;
    }
    const waitedMs = Date.now() - started;
    return {
        held,
        waitedMs,
        release: async () => {
            if (held) {
                // 🔴 `pg_advisory_unlock` gibt `false`, wenn diese Sitzung die Sperre NICHT mehr hielt.
                // Das wäre ein verlorener Alleinbesitz und muss sichtbar sein, nicht stillschweigend:
                // genau das war der Fehler, den `idle_timeout: 30` erzeugte.
                const [row] = await lock<{ ok: boolean }[]>`
                    SELECT pg_advisory_unlock(hashtext(${LOCK_CLASS})) AS ok
                `.catch(() => [{ ok: true }]);
                if (row?.ok === false) {
                    process.stderr.write(
                        `[WI-0101] ${who}: der Alleinbesitz der Testdatenbank war VERLOREN, als die Datei endete. ` +
                            `rote Fälle dieser Datei können Fremdlast sein.\n`,
                    );
                }
            }
            await lock.end({ timeout: 5 }).catch(() => undefined);
        },
    };
}
