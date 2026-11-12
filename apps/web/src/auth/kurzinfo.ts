import { ref, type Ref } from "vue";
import { KURZINFO_URL, standAus, type Kurzinfo } from "@avesmaps3d/shared";
import { getJson, type Fetcher } from "./api";

/**
 * Was die Meldung „Neue Version“ zeigt (WI-0137; Betreiber 2026-10-17: „ich will dass die stelle mir eigentlich anzeigt was neu ist und auf
 * was man achten muss, wenn man neu lädt“).
 *
 * - **Beim Start** merkt sich die Seite ihren Stand (`merkeStand`): das Release, das der Server dann nennt (`release`).
 * - **Erkennt N1 eine neue Version**, holt `laden` die Neuerungen seit diesem Stand (`?seit=<sha>`): „Neu“ und „Achtung“ aus den Commits
 *   (AGENTS.md: jeder feat/fix-Commit sagt mit `Neu:`/`Achtung:`, was neu ist). Ohne gemerkten Stand die Kurzinfo des laufenden Release.
 * - Wenn der Abruf scheitert oder nichts da ist, bleibt sie leer: Dann steht nur „↺ Neu laden“ da (Vorgabe 3), nie ein Fehler. Ein
 *   gescheiterter Abruf wird beim nächsten Öffnen wiederholt.
 */
export interface KurzinfoSpeicher {
    kurzinfo: Ref<Kurzinfo | null>;
    /** Der Stand dieser Seite (kurze SHA aus dem Release beim Start), sonst `null`. */
    stand: Ref<string | null>;
    merkeStand(): Promise<void>;
    laden(): Promise<void>;
}

export function createKurzinfo(fetcher?: Fetcher): KurzinfoSpeicher {
    const kurzinfo = ref<Kurzinfo | null>(null);
    const stand = ref<string | null>(null);
    let laeuft: Promise<void> | null = null;
    let gemerkt = false;
    async function merkeStand(): Promise<void> {
        if (gemerkt) return;
        gemerkt = true;
        try {
            const antwort = await getJson<Kurzinfo>(KURZINFO_URL, fetcher);
            stand.value = antwort.release === undefined ? null : standAus(antwort.release);
        } catch {
            // Ohne Anmeldung oder bei einem Fehler bleibt der Stand offen; die Meldung zeigt dann die Kurzinfo des neuen Release.
            gemerkt = false;
        }
    }
    function laden(): Promise<void> {
        if (kurzinfo.value !== null) return Promise.resolve();
        const url = stand.value === null ? KURZINFO_URL : `${KURZINFO_URL}?seit=${stand.value}`;
        laeuft ??= getJson<Kurzinfo>(url, fetcher)
            .then((antwort) => {
                kurzinfo.value = antwort;
            })
            .catch(() => undefined)
            .finally(() => {
                laeuft = null;
            });
        return laeuft;
    }
    return { kurzinfo, stand, merkeStand, laden };
}

let geteilt: KurzinfoSpeicher | undefined;

/** Eine Kurzinfo für Kasten und Glocke. */
export function useKurzinfo(): KurzinfoSpeicher {
    geteilt ??= createKurzinfo();
    return geteilt;
}
