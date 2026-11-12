<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ReleaseTestSchritt, ReleaseTestTeil } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import { useKopieren } from "../controls/avm-kopierfeld";
import FensterKarte from "../fenster/fenster-karte.vue";
import { locale, t, type MessageKey } from "../i18n/i18n";
import { copyToClipboard } from "../route-planner/use-share-link";
import { dauerText, uhrzeitGenau, zeitpunkt } from "./freigabe";
import { freigabeZustand } from "./freigabe-zustand";
import AktionenBlock from "./umgebungen-release-test-aktionen.vue";
import { dataLabel } from "../status/format";
import {
    andererStand,
    auftragWartet,
    bereicheText,
    berichtText,
    dauerGrob,
    faelleText,
    ladeTakt,
    releaseTestAktiv,
    releaseTestKnopf,
    schrittName,
    startGescheitert,
    teilBezeichnung,
    versuchOffen,
    wiederholungText,
    type ReleaseTest,
} from "./release-test";

/**
 * Die Karte „Release-Test“ im Reiter „Umgebungen“ der LOKALEN Systemsteuerung (WI-0248 L; Betreiber 2026-10-23: der Test wird hier ausgelöst, nicht
 * von einer geplanten Aufgabe). Sie steht dort, wo Lokal sonst nur sagt, dass es hier keine Freigaben gibt, und nur, wenn die Route antwortet (die
 * gibt es nur auf dem Entwicklungsrechner).
 *
 * Von oben: der Stand, der geprüft würde (die Freigabe, sonst der Stage-Stand), die erwartete Dauer, der Lauf mit seinen Schritten und dem Balken
 * nach erwarteter Dauer, die Knöpfe und, bei Rot oder Abbruch, der Fehlerbericht zum Weitergeben. Alle Zahlen kommen vom Starter; die Karte rechnet
 * nur die Sekunden zwischen zwei Abfragen weiter. Solange etwas läuft, fragt sie alle 30 Sekunden nach (`ladeTakt`).
 *
 * 🔴 **Die vier Browserteile stehen nach Thema** (WI-0248): Name, Bereiche, Zahl der Fälle, Zustand und Zeit je Teil, statt vier Zeilen „Browser n von 4“.
 * Der Lauf geht bis zum Ende, auch wenn ein Teil rot ist; im Bericht nennt jeder rote Fall seinen Teil. „Rote Teile wiederholen“ steht nur, wenn der Lauf
 * des Kandidaten rot oder abgebrochen ist: Es startet denselben Stand, und nur die roten oder fehlenden Teile laufen neu.
 *
 * 🔴 **Ein Start hat das Wort vor dem Lauf davor.** Baut ein Start das Testpaket oder ist er gescheitert („Start gescheitert: …“, mit dem Grund
 * des Starters), steht das ganz oben im Kasten; der Lauf von früher steht darunter als „Vorheriger Lauf“, ohne Schritte und Balken (sie sähen aus
 * wie der Fortschritt des neuen Starts). Gehört ein gezeigter Lauf zu einem anderen Stand als der Kandidat, sagt die Karte das dazu.
 *
 * 🔴 **Ein Druck räumt die Karte** (Vali 2026-10-25: „nicht klar, ob ich den button gedrückt habe … wenn dann die fehler wieder kommen sollen alles
 * ok, aber dann weiß ich, dass es die fehler aus dem neuen lauf … sind“): Vom Druck bis zur Antwort des Starters steht nur „Starte Lauf …“; der alte
 * Lauf, sein Bericht und seine Fehler sind so lange weg. Eine Abweisung trägt die Uhrzeit des Versuchs, der alte Lauf steht danach als „Vorheriger Lauf“.
 */
const props = defineProps<{ test: ReleaseTest }>();

const sicht = computed(() => props.test.sicht.value);
const lauf = computed(() => sicht.value?.lauf ?? null);
const kandidat = computed(() => sicht.value?.kandidat ?? null);
const knopf = computed(() => releaseTestKnopf(sicht.value));
const start = computed(() => sicht.value?.start ?? null);
/** Läuft ein Test oder baut ein Start sein Paket? Sonst steht oben „Kein Release-Test läuft“ und der Knopf direkt darunter, der alte Lauf danach. */
const aktiv = computed(() => releaseTestAktiv(sicht.value));
/** Die Abweisung des letzten Versuchs (Server oder Starter lehnten ab, oder der Stand hatte sich bewegt): rote Zeile oben, bis der nächste Versuch beginnt. */
const abweisung = computed(() => props.test.abweisung.value);
const abgewiesenUm = computed(() => uhrzeitGenau(props.test.abgewiesenAm.value, locale.value));
/** Vom Druck bis zur Antwort des Starters: nur „Starte Lauf …“, nichts vom Lauf davor. */
const imVersuch = computed(() => versuchOffen(sicht.value, props.test.versuch.value));
const startFehler = computed(() => startGescheitert(sicht.value));
/** Der Auftrag in der Warteschlange (WI-0248): wartend mit Platz und dem, worauf er wartet; laufend, solange er noch keinen Lauf hat. */
const auftrag = computed(() => sicht.value?.auftrag ?? null);
const wartend = computed(() => auftragWartet(sicht.value));
const auftragOhneLauf = computed(
    () => auftrag.value?.zustand === "laeuft" && start.value === null && lauf.value?.zustand !== "laeuft",
);
/** Ein Auftrag, der wartet oder gerade den Starter ruft, hat das Wort wie ein Start: Der Lauf davor ist dann der „Vorherige Lauf“. */
const auftragHatWort = computed(() => wartend.value !== null || auftragOhneLauf.value);
const eingereihtSatz = computed(() => {
    const w = wartend.value;
    if (w === null) return "";
    const teile = [
        w.platz === null
            ? t("admin.umgebungen.releaseTest.eingereiht")
            : t("admin.umgebungen.releaseTest.eingereihtPlatz", { platz: w.platz }),
    ];
    // Der Volltest (WI-0264) sagt, dass er einer ist: Er gibt nichts frei.
    if (auftrag.value?.volltest === true) teile.unshift(t("admin.umgebungen.releaseTest.volltest"));
    // Die Pause sagt mehr als der laufende Auftrag: Auch wenn er endet, startet nichts.
    if (w.grund === "waits_queue_paused") teile.push(dataLabel("status.wait", w.grund));
    else if (w.wartetAuf !== null)
        teile.push(t("admin.umgebungen.releaseTest.wartetAuf", { art: dataLabel("status.kind", w.wartetAuf) }));
    else if (w.grund !== null) teile.push(dataLabel("status.wait", w.grund));
    return teile.join(" · ");
});
const anderer = computed(() => andererStand(sicht.value));
const fehler = computed(() => lauf.value?.fehler ?? null);
/** Die Browserteile nach Thema; fehlen sie (ein älterer Starter), zeigt die Karte die Schritte „Browser n von 4“ wie bisher. */
const teile = computed<readonly ReleaseTestTeil[]>(() => lauf.value?.teile ?? []);
const wiederholung = computed(() => lauf.value?.wiederholung ?? null);

const kurz = (sha: string): string => sha.slice(0, 7);
const zeit = (iso: string | null | undefined): string => zeitpunkt(iso ?? null, locale.value);

// --- Uhr und Nachfragen ---------------------------------------------------------------------------------------------

const jetzt = ref(Date.now());
let uhr: ReturnType<typeof setInterval> | undefined;
let letzteFrage = Date.now();
onMounted(() => {
    uhr = setInterval(() => {
        jetzt.value = Date.now();
        const takt = ladeTakt(sicht.value);
        if (takt === null || document.hidden || props.test.busy.value || jetzt.value - letzteFrage < takt) return;
        letzteFrage = jetzt.value;
        void props.test.laden();
    }, 1000);
});
onBeforeUnmount(() => clearInterval(uhr));

/** Die Millisekunden seit der letzten Antwort des Servers: Die Zeiten der Schritte rechnet der Starter, die Karte zählt nur bis zur nächsten weiter. */
const seitLaden = computed(() => Math.max(0, jetzt.value - (props.test.geladenAm.value ?? jetzt.value)));

// --- Kandidat -------------------------------------------------------------------------------------------------------

/** Die jüngste Freigabe aus dem Start (WI-0248): Sie entsteht mit dem Knopf und sagt, ob der Stand nach Production geht. */
const freigabe = computed(() => kandidat.value?.freigabe ?? null);
const freigabeSatz = computed(() => {
    const z = freigabeZustand(freigabe.value);
    return t(z.key, z.params);
});
const kandidatSatz = computed(() => {
    const k = kandidat.value;
    const commit = knopf.value.commit;
    // Geprüft und freigegeben wird der aktuelle Stage-Stand (WI-0248).
    if (k?.stage != null && k.stage.sha === commit) {
        const f = k.freigabe;
        return f !== undefined && f.sha === commit && f.von !== null && f.zustand !== "abgebrochen"
            ? t("admin.umgebungen.releaseTest.kandidatFreigabe", { zeit: zeit(k.stage.zeit), wer: f.von })
            : t("admin.umgebungen.releaseTest.kandidatStage", { zeit: zeit(k.stage.zeit) });
    }
    if (k?.freigabe !== undefined && k.freigabe.sha === commit) return freigabeSatz.value;
    if (k?.auftrag != null)
        return t("admin.umgebungen.releaseTest.kandidatAuftrag", { ops: k.auftrag.ops, zeit: zeit(k.auftrag.zeit) });
    return "";
});

// --- Stand des Laufs ------------------------------------------------------------------------------------------------

const laeuft = computed(() => lauf.value?.zustand === "laeuft");
const zustandSatz = computed(() => {
    const l = lauf.value;
    if (l === null || l.zustand === "keiner") return t("admin.umgebungen.releaseTest.zustand.keiner");
    if (l.zustand === "laeuft" && l.lebt === false) return t("admin.umgebungen.releaseTest.abgestuerzt");
    const verstrichen =
        l.start === undefined ? 0 : Math.max(0, Date.parse(l.jetzt) - Date.parse(l.start)) + seitLaden.value;
    return t(`admin.umgebungen.releaseTest.zustand.${l.zustand}` as MessageKey, {
        zeit: zeit(l.zustand === "laeuft" ? l.start : (l.ende ?? l.start)),
        dauer: dauerText(verstrichen),
    });
});
/** Ein Lauf des Volltests (WI-0264): welcher Teil, und bei Teil 2, wie Teil 1 (der Schnelltest) endete. Leer bei jedem anderen Lauf. */
const volltestSatz = computed(() => {
    const l = lauf.value;
    if (l === null || l.volltest !== true) return "";
    const teil = t(
        l.profil === "voll"
            ? "admin.umgebungen.releaseTest.volltestTeil.voll"
            : "admin.umgebungen.releaseTest.volltestTeil.tor",
    );
    const v = l.vorlauf;
    return v === undefined
        ? teil
        : `${teil} · ${t("admin.umgebungen.releaseTest.volltestVorlauf", {
              zustand: t(`admin.umgebungen.releaseTest.zustandWort.${v.zustand}` as MessageKey),
          })}`;
});
/** Die Farbe des Laufs selbst; die Zeile des Starts hat ihre eigene. */
const laufTon = computed(() => {
    const z = lauf.value?.zustand;
    if (z === "gruen") return "gut";
    if (z === "rot" || z === "abgebrochen" || (z === "laeuft" && lauf.value?.lebt === false)) return "rot";
    return "";
});
/** Gibt es einen früheren Lauf zu zeigen? */
const hatLauf = computed(() => lauf.value !== null && lauf.value.zustand !== "keiner");
/** „Kein Release-Test läuft“: Nichts läuft, kein Start baut, nichts wurde abgewiesen, und es gibt einen alten Lauf, der sonst wie ein laufender wirken könnte. */
const keinerLaeuft = computed(
    () => !aktiv.value && start.value === null && abweisung.value.length === 0 && hatLauf.value && !imVersuch.value,
);
/** Der alte Lauf ist ausdrücklich der LETZTE, wo nichts läuft und kein Start das Wort hat (mit einem Start heißt er „Vorheriger Lauf“). */
const letzterLauf = computed(
    () => !aktiv.value && start.value === null && abweisung.value.length === 0 && hatLauf.value && !imVersuch.value,
);

/** Die Farbe des Kastens: Ein gescheiterter Start oder eine Abweisung färbt ihn rot, ein startender lässt ihn neutral (der Lauf davor zählt nicht). */
const zustandTon = computed(() => {
    if (imVersuch.value) return "";
    if (startFehler.value !== null || abweisung.value.length > 0) return "rot";
    if (start.value !== null || auftragHatWort.value) return "";
    return laufTon.value;
});
/** Hat ein Start oder ein Auftrag das Wort? Dann ist der gezeigte Lauf der von früher. */
const andererHatWort = computed(() => start.value !== null || auftragHatWort.value);
/** Die Schritte und der Balken zeigen den Lauf, der gerade zählt; neben einem Start, der baut oder scheiterte, sähen die eines früheren Laufs wie dessen Fortschritt aus. */
const zeigeSchritte = computed(
    () => lauf.value !== null && lauf.value.zustand !== "keiner" && !andererHatWort.value && !imVersuch.value,
);
/** Die Zeile des Laufs entfällt, wo ein Start das Wort hat und es keinen früheren Lauf gibt. */
const zeigeLaufzeile = computed(
    () => !imVersuch.value && (!andererHatWort.value || (lauf.value !== null && lauf.value.zustand !== "keiner")),
);
/** Über dem alten Lauf steht „Vorheriger Lauf“, wo ein Start, ein Auftrag oder eine Abweisung das Wort hat. */
const vorheriger = computed(() => zeigeLaufzeile.value && (andererHatWort.value || abweisung.value.length > 0));
const prozent = computed(() => Math.round((lauf.value?.fortschritt ?? 0) * 100));
/** Die verbleibende Zeit, wie der Starter sie rechnet, abzüglich der Zeit seit der letzten Antwort. */
const restSatz = computed(() => {
    const l = lauf.value;
    if (l?.zustand !== "laeuft" || l.lebt === false || l.verbleibendMs === undefined) return "";
    const ms = Math.max(0, l.verbleibendMs - seitLaden.value);
    const key = l.erwartetSchaetzung
        ? "admin.umgebungen.releaseTest.restSchaetzung"
        : "admin.umgebungen.releaseTest.rest";
    return t(key as MessageKey, { dauer: dauerGrob(ms, locale.value) });
});

/** Die Schritte in der Liste: Mit den Teilen nach Thema stehen die vier Browser-Schritte dort nicht noch einmal. */
const schritteSichtbar = computed<readonly ReleaseTestSchritt[]>(() => {
    const alle = lauf.value?.schritte ?? [];
    return teile.value.length === 0 ? alle : alle.filter((s) => !s.id.startsWith("browser-"));
});

/** Die Zeit eines Teils: übernommen und entfallen ohne Zeit, offen die erwartete mit „≈“, sonst verstrichen (der laufende zählt weiter). */
function teilZeit(teil: ReleaseTestTeil): string {
    if (teil.uebernommen) return t("admin.umgebungen.releaseTest.teile.uebernommen");
    if (teil.zustand === "uebersprungen") return t("admin.umgebungen.releaseTest.teile.zustand.uebersprungen");
    if (teil.zustand === "offen") return `≈ ${dauerText(teil.erwartetMs)}`;
    return dauerText((teil.dauerMs ?? 0) + (teil.zustand === "laeuft" ? seitLaden.value : 0));
}
const teilTitel = (teil: ReleaseTestTeil): string =>
    teil.zustand === "offen" || teil.zustand === "laeuft"
        ? `${dauerText(teil.erwartetMs)} · ${t("admin.umgebungen.releaseTest.schaetzung")}`
        : "";
const teilFuellung = (teil: ReleaseTestTeil): "voll" | "halb" | "leer" =>
    teil.zustand === "gruen" ? "voll" : teil.zustand === "laeuft" ? "halb" : "leer";

/** Die Zeit eines Schrittes: verstrichen, solange er begonnen hat (der laufende zählt weiter), sonst die erwartete mit „≈“. */
function schrittZeit(s: ReleaseTestSchritt): string {
    if (s.zustand === "uebernommen") return t("admin.umgebungen.releaseTest.teile.uebernommen");
    if (s.zustand === "uebersprungen") return t("admin.umgebungen.releaseTest.teile.zustand.uebersprungen");
    if (s.zustand === "offen") return `≈ ${dauerText(s.erwartetMs)}`;
    const ms = (s.dauerMs ?? 0) + (s.zustand === "laeuft" ? seitLaden.value : 0);
    return dauerText(ms);
}
const schrittTitel = (s: ReleaseTestSchritt): string =>
    `${dauerText(s.erwartetMs)}${s.schaetzung ? ` · ${t("admin.umgebungen.releaseTest.schaetzung")}` : ""}`;

// --- Bericht --------------------------------------------------------------------------------------------------------

const { zustand: kopierZustand, kopiere } = useKopieren(copyToClipboard);
const kopierSatz = computed(() => {
    if (kopierZustand.value === "kopiert") return t("admin.umgebungen.releaseTest.fehler.kopiert");
    if (kopierZustand.value === "fehler") return t("admin.umgebungen.releaseTest.fehler.kopierFehler");
    return "";
});
/**
 * 🔴 Der eine Bericht (WI-0248; Vali 2026-10-26: „Am Ende gibt es eine einzige Seite mit allem, was rot ist … und darunter, was noch offen ist“):
 * `bericht.md` des Laufs, auf Nachfrage geladen. „Bericht kopieren“ legt ihn in die Zwischenablage; gibt es ihn nicht (ein Lauf von vorher, ein
 * älterer Starter), die Zusammenfassung der Karte wie bisher.
 */
const seiteSichtbar = computed(() => {
    const z = lauf.value?.zustand;
    return (
        lauf.value?.sha !== undefined &&
        (z === "gruen" || z === "rot" || z === "abgebrochen") &&
        !imVersuch.value &&
        !auftragHatWort.value
    );
});
const seiteStempel = computed(() => lauf.value?.ende ?? lauf.value?.start ?? "");
const seiteText = computed(() => {
    const s = props.test.seite.value;
    return s !== null && s.commit === lauf.value?.sha && s.stempel === seiteStempel.value ? s.text : null;
});
function seiteAufgeklappt(ereignis: Event): void {
    const sha = lauf.value?.sha;
    if (sha !== undefined && (ereignis.target as HTMLDetailsElement).open)
        void props.test.seiteLaden(sha, seiteStempel.value);
}
async function berichtKopieren(): Promise<void> {
    const sha = lauf.value?.sha;
    const seite = sha === undefined ? null : await props.test.seiteLaden(sha, seiteStempel.value);
    const text = seite ?? berichtText(sicht.value, t);
    if (text !== null) await kopiere(text);
}
</script>

<template>
    <FensterKarte :titel="t('admin.umgebungen.releaseTest.titel')" class="release-test" data-testid="release-test">
        <p class="satz satz--leise">{{ t("admin.umgebungen.releaseTest.satz") }}</p>

        <p
            v-if="sicht !== null && !sicht.verfuegbar"
            class="satz satz--fehler"
            role="alert"
            data-testid="release-test-nicht-verfuegbar"
        >
            {{ t("admin.umgebungen.releaseTest.nichtVerfuegbar", { grund: sicht.fehler ?? "–" }) }}
        </p>

        <template v-else-if="sicht !== null">
            <dl class="fakten" data-testid="release-test-kandidat">
                <dt>{{ t("admin.umgebungen.releaseTest.kandidat") }}</dt>
                <dd v-if="knopf.commit !== null">
                    <strong class="sha" data-testid="release-test-kandidat-sha">{{ kurz(knopf.commit) }}</strong>
                    · {{ kandidatSatz }}
                </dd>
                <dd v-else class="fakten__leise">{{ t("admin.umgebungen.releaseTest.keinKandidat") }}</dd>
                <template v-if="kandidat?.stage != null">
                    <dt>{{ t("admin.umgebungen.releaseTest.stage") }}</dt>
                    <dd>
                        <span class="sha">{{ kurz(kandidat.stage.sha) }}</span> ·
                        {{ t("admin.umgebungen.seit", { zeit: zeit(kandidat.stage.zeit) }) }}
                    </dd>
                </template>
                <dt>{{ t("admin.umgebungen.releaseTest.freigabe") }}</dt>
                <dd v-if="freigabe !== null" data-testid="release-test-freigabe">
                    {{ freigabeSatz }} · {{ zeit(freigabe.zeit) }}
                </dd>
                <dd v-else-if="kandidat?.auftrag != null">
                    {{ kandidat.auftrag.ops }} · <span class="sha">{{ kurz(kandidat.auftrag.sha) }}</span> ·
                    {{ zeit(kandidat.auftrag.zeit) }}
                </dd>
                <dd v-else class="fakten__leise">{{ t("admin.umgebungen.releaseTest.keine") }}</dd>
                <dt>{{ t("admin.umgebungen.releaseTest.erwartet") }}</dt>
                <dd data-testid="release-test-erwartet">
                    {{
                        t("admin.umgebungen.releaseTest.erwartetWert", {
                            dauer: dauerGrob(lauf?.erwartetMs ?? 0, locale),
                        })
                    }}
                    <AvmPille
                        v-if="lauf?.erwartetSchaetzung"
                        ton="warnung"
                        testid="release-test-schaetzung"
                        :title="t('admin.umgebungen.releaseTest.schaetzungTitel')"
                        >{{ t("admin.umgebungen.releaseTest.schaetzung") }}</AvmPille
                    >
                </dd>
            </dl>

            <section
                class="stand"
                :class="zustandTon === '' ? '' : `stand--${zustandTon}`"
                aria-live="polite"
                data-testid="release-test-stand"
            >
                <p v-if="imVersuch" class="stand__zeile" data-zustand="versuch" data-testid="release-test-versuch">
                    <span class="umgebungen-puls"
                        ><AvmKreis fuellung="halb" :name="t('admin.umgebungen.releaseTest.versuch')"
                    /></span>
                    <span>{{ t("admin.umgebungen.releaseTest.versuch") }}</span>
                </p>
                <p
                    v-else-if="start?.zustand === 'baut'"
                    class="stand__zeile"
                    data-zustand="startet"
                    data-testid="release-test-startet"
                >
                    <span class="umgebungen-puls"
                        ><AvmKreis fuellung="halb" :name="t('admin.umgebungen.releaseTest.startet')"
                    /></span>
                    <span class="sha">{{ kurz(start.commit) }}</span>
                    <span>{{ t("admin.umgebungen.releaseTest.startet") }}</span>
                </p>
                <p
                    v-else-if="wartend !== null && auftrag !== null"
                    class="stand__zeile"
                    data-zustand="eingereiht"
                    data-testid="release-test-eingereiht"
                >
                    <span class="umgebungen-puls"
                        ><AvmKreis fuellung="leer" :name="t('admin.umgebungen.releaseTest.eingereiht')"
                    /></span>
                    <span class="sha">{{ kurz(auftrag.commit) }}</span>
                    <span>{{ eingereihtSatz }}</span>
                </p>
                <p
                    v-else-if="auftragOhneLauf && auftrag !== null"
                    class="stand__zeile"
                    data-zustand="auftrag-startet"
                    data-testid="release-test-auftrag-startet"
                >
                    <span class="umgebungen-puls"
                        ><AvmKreis fuellung="halb" :name="t('admin.umgebungen.releaseTest.auftragStartet')"
                    /></span>
                    <span class="sha">{{ kurz(auftrag.commit) }}</span>
                    <span>{{ t("admin.umgebungen.releaseTest.auftragStartet") }}</span>
                </p>
                <p
                    v-else-if="startFehler !== null"
                    class="stand__zeile stand__zeile--rot"
                    role="alert"
                    data-zustand="start-fehler"
                    data-testid="release-test-start-fehler"
                >
                    <span class="schritt__fehler" aria-hidden="true">✕</span>
                    <span class="sha">{{ kurz(startFehler.commit) }}</span>
                    <span>{{
                        t("admin.umgebungen.releaseTest.startFehler", { grund: startFehler.grund ?? "–" })
                    }}</span>
                </p>
                <p
                    v-if="auftrag?.abbruch === true"
                    class="satz satz--leise"
                    data-testid="release-test-abbruch-angefordert"
                >
                    {{ t("admin.umgebungen.releaseTest.abbruchAngefordert") }}
                </p>
                <p
                    v-if="abweisung.length > 0"
                    class="stand__zeile stand__zeile--rot"
                    role="alert"
                    data-zustand="abgewiesen"
                    data-testid="release-test-abweisung"
                >
                    <span class="schritt__fehler" aria-hidden="true">✕</span>
                    <strong>{{ t("admin.umgebungen.releaseTest.abgewiesen", { zeit: abgewiesenUm }) }}</strong>
                    <span
                        v-for="(satz, i) in abweisung"
                        :key="i"
                        class="stand__satz"
                        data-testid="release-test-abweisung-satz"
                        >{{ t(satz.key, satz.params) }}</span
                    >
                </p>
                <p v-if="keinerLaeuft" class="stand__zeile" data-zustand="kein-lauf" data-testid="release-test-keiner">
                    <AvmKreis fuellung="leer" :name="t('admin.umgebungen.releaseTest.keinerLaeuft')" />
                    <strong>{{ t("admin.umgebungen.releaseTest.keinerLaeuft") }}</strong>
                </p>

                <!-- Wo nichts läuft, steht der Knopf gleich unter dem Satz; der alte Lauf kommt danach. Läuft etwas, steht er unter dem Lauf (unten). -->
                <AktionenBlock v-if="!aktiv" :test="props.test" />

                <p v-if="letzterLauf" class="satz satz--leise" data-testid="release-test-letzter">
                    {{ t("admin.umgebungen.releaseTest.letzterLauf") }}
                </p>

                <p v-if="vorheriger" class="satz satz--leise" data-testid="release-test-vorheriger">
                    {{ t("admin.umgebungen.releaseTest.vorherigerLauf") }}
                </p>
                <p
                    v-if="zeigeLaufzeile"
                    class="stand__zeile"
                    :class="laufTon === '' ? '' : `stand__zeile--${laufTon}`"
                    :data-zustand="lauf?.zustand ?? 'keiner'"
                >
                    <span
                        v-if="lauf?.zustand === 'rot' || lauf?.zustand === 'abgebrochen'"
                        class="schritt__fehler"
                        aria-hidden="true"
                        >✕</span
                    >
                    <span v-else :class="{ 'umgebungen-puls': laeuft }">
                        <AvmKreis
                            :fuellung="lauf?.zustand === 'gruen' ? 'voll' : laeuft ? 'halb' : 'leer'"
                            :name="
                                t(`admin.umgebungen.releaseTest.zustandWort.${lauf?.zustand ?? 'keiner'}` as MessageKey)
                            "
                        />
                    </span>
                    <span v-if="lauf?.sha !== undefined" class="sha">{{ kurz(lauf.sha) }}</span>
                    <span data-testid="release-test-zustand">{{ zustandSatz }}</span>
                </p>
                <p
                    v-if="zeigeLaufzeile && volltestSatz !== ''"
                    class="satz satz--leise"
                    data-testid="release-test-volltest-teil"
                >
                    {{ volltestSatz }}
                </p>

                <p
                    v-if="anderer !== null && !imVersuch"
                    class="satz satz--leise"
                    data-testid="release-test-anderer-stand"
                >
                    {{
                        t("admin.umgebungen.releaseTest.andererStand", {
                            lauf: kurz(anderer.lauf),
                            kandidat: kurz(anderer.kandidat),
                        })
                    }}
                </p>

                <template v-if="zeigeSchritte && lauf !== null">
                    <div
                        class="balken"
                        role="progressbar"
                        :aria-label="t('admin.umgebungen.releaseTest.balken')"
                        :aria-valuenow="prozent"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        data-testid="release-test-balken"
                    >
                        <span class="balken__fuell" :style="{ width: `${String(prozent)}%` }"></span>
                    </div>
                    <p class="satz satz--leise" data-testid="release-test-rest">
                        {{ String(prozent) }} %<template v-if="restSatz !== ''"> · {{ restSatz }}</template>
                    </p>
                    <ol class="schritte" data-testid="release-test-schritte">
                        <li
                            v-for="s in schritteSichtbar"
                            :key="s.id"
                            class="schritt"
                            :class="`schritt--${s.zustand}`"
                            :data-schritt="s.id"
                            :data-zustand="s.zustand"
                        >
                            <span v-if="s.zustand === 'fehler'" class="schritt__fehler" aria-hidden="true">✕</span>
                            <span v-else-if="s.zustand === 'uebersprungen'" class="schritt__aus" aria-hidden="true"
                                >–</span
                            >
                            <span v-else :class="{ 'umgebungen-puls': s.zustand === 'laeuft' }">
                                <AvmKreis
                                    :fuellung="
                                        s.zustand === 'fertig' || s.zustand === 'uebernommen'
                                            ? 'voll'
                                            : s.zustand === 'laeuft'
                                              ? 'halb'
                                              : 'leer'
                                    "
                                    :name="schrittName(s.id, t)"
                                />
                            </span>
                            <span class="schritt__name">{{ schrittName(s.id, t) }}</span>
                            <span class="schritt__zeit" :title="schrittTitel(s)">{{ schrittZeit(s) }}</span>
                        </li>
                    </ol>
                </template>
                <template v-if="teile.length > 0 && !andererHatWort && !imVersuch">
                    <h4 class="teile__titel">{{ t("admin.umgebungen.releaseTest.teile.titel") }}</h4>
                    <ul class="teile" data-testid="release-test-teile">
                        <li
                            v-for="teil in teile"
                            :key="teil.id"
                            class="teil"
                            :class="`teil--${teil.zustand}`"
                            :data-teil="teil.id"
                            :data-zustand="teil.zustand"
                            :data-uebernommen="teil.uebernommen ? 'ja' : 'nein'"
                        >
                            <span v-if="teil.zustand === 'rot'" class="schritt__fehler" aria-hidden="true">✕</span>
                            <span v-else-if="teil.zustand === 'uebersprungen'" class="schritt__aus" aria-hidden="true"
                                >–</span
                            >
                            <span v-else :class="{ 'umgebungen-puls': teil.zustand === 'laeuft' }">
                                <AvmKreis
                                    :fuellung="teilFuellung(teil)"
                                    :name="
                                        t(`admin.umgebungen.releaseTest.teile.zustand.${teil.zustand}` as MessageKey)
                                    "
                                />
                            </span>
                            <span class="teil__name" data-testid="release-test-teil-name">{{
                                teilBezeichnung(teil.id, t)
                            }}</span>
                            <span class="schritt__zeit" :title="teilTitel(teil)" data-testid="release-test-teil-zeit">{{
                                teilZeit(teil)
                            }}</span>
                            <span class="teil__info" data-testid="release-test-teil-info">
                                <span data-testid="release-test-teil-bereiche">{{ bereicheText(teil, t) }}</span>
                                <template v-if="faelleText(teil, t) !== null">
                                    · <span data-testid="release-test-teil-faelle">{{ faelleText(teil, t) }}</span>
                                </template>
                                <template v-if="teil.rot !== undefined && teil.rot > 0">
                                    ·
                                    <span class="teil__rot" data-testid="release-test-teil-rot">{{
                                        t("admin.umgebungen.releaseTest.teile.rot", { n: teil.rot })
                                    }}</span>
                                </template>
                                ·
                                <span data-testid="release-test-teil-zustand">{{
                                    t(`admin.umgebungen.releaseTest.teile.zustand.${teil.zustand}` as MessageKey)
                                }}</span>
                                <template v-if="teil.zustand === 'uebersprungen' && teil.grund !== undefined">
                                    · {{ teil.grund }}
                                </template>
                            </span>
                        </li>
                    </ul>
                </template>
                <p
                    v-if="wiederholung !== null && !andererHatWort && !imVersuch"
                    class="satz satz--leise"
                    data-testid="release-test-wiederholung"
                >
                    {{ wiederholungText(wiederholung, t) }}
                </p>
            </section>

            <AktionenBlock v-if="aktiv" :test="props.test" />

            <section
                v-if="fehler !== null && lauf !== null && !imVersuch && !auftragHatWort"
                class="bericht"
                data-testid="release-test-bericht"
            >
                <h4 class="bericht__titel">{{ t("admin.umgebungen.releaseTest.fehler.titel") }}</h4>
                <p v-if="fehler.schritt !== null" class="satz" data-testid="release-test-bericht-schritt">
                    {{ t("admin.umgebungen.releaseTest.fehler.schritt", { schritt: schrittName(fehler.schritt, t) }) }}
                </p>
                <pre class="bericht__text" data-testid="release-test-bericht-grund">{{ fehler.grund }}</pre>

                <template v-if="fehler.faelle.length > 0">
                    <p class="satz">
                        {{ t("admin.umgebungen.releaseTest.fehler.faelle", { gesamt: fehler.faelleGesamt }) }}
                        <span v-if="fehler.faelle.length < fehler.faelleGesamt" class="satz--leise"
                            >·
                            {{ t("admin.umgebungen.releaseTest.fehler.gekuerzt", { n: fehler.faelle.length }) }}</span
                        >
                    </p>
                    <ul class="faelle" data-testid="release-test-faelle">
                        <li v-for="(fall, i) in fehler.faelle" :key="i" class="fall">
                            <span class="fall__kopf"
                                ><span
                                    v-if="fall.teil !== undefined"
                                    class="fall__teil"
                                    data-testid="release-test-fall-teil"
                                    >{{ teilBezeichnung(fall.teil, t) }} </span
                                ><span class="fall__datei">{{ fall.datei }}</span
                                ><span v-if="fall.name !== ''" class="fall__name"> › {{ fall.name }}</span></span
                            >
                            <pre v-if="fall.meldung.length > 0" class="bericht__text">{{
                                fall.meldung.join("\n")
                            }}</pre>
                        </li>
                    </ul>
                </template>
                <p v-else class="satz satz--leise">{{ t("admin.umgebungen.releaseTest.fehler.keine") }}</p>

                <template v-if="fehler.protokollEnde.length > 0">
                    <p class="satz">
                        {{
                            t("admin.umgebungen.releaseTest.fehler.protokoll", {
                                schritt: fehler.schritt === null ? "–" : schrittName(fehler.schritt, t),
                            })
                        }}
                    </p>
                    <pre class="bericht__text bericht__text--lang" data-testid="release-test-protokoll">{{
                        fehler.protokollEnde.join("\n")
                    }}</pre>
                </template>

                <p v-if="lauf.ordner !== undefined" class="satz satz--leise">
                    {{ t("admin.umgebungen.releaseTest.fehler.ordner") }}:
                    <span class="bericht__pfad" data-testid="release-test-ordner">{{ lauf.ordner }}</span>
                </p>
                <div class="aktionen">
                    <AvmKnopf testid="release-test-bericht-kopieren" @click="void berichtKopieren()">{{
                        t("admin.umgebungen.releaseTest.fehler.kopieren")
                    }}</AvmKnopf>
                    <span class="satz satz--leise" role="status" data-testid="release-test-kopiert">{{
                        kopierSatz
                    }}</span>
                </div>
            </section>

            <!-- Der eine Bericht (WI-0248): eine Seite mit allem, was rot ist, und was offen ist; aufklappbar, weil er lang sein kann. -->
            <section v-if="seiteSichtbar" class="seite" data-testid="release-test-seite">
                <details @toggle="seiteAufgeklappt($event)">
                    <summary class="seite__titel">{{ t("admin.umgebungen.releaseTest.seite.titel") }}</summary>
                    <p v-if="props.test.seiteZustand.value === 'laedt'" class="satz satz--leise">
                        {{ t("admin.umgebungen.releaseTest.seite.laedt") }}
                    </p>
                    <p
                        v-else-if="seiteText === null && props.test.seiteZustand.value === 'fehlt'"
                        class="satz satz--leise"
                        data-testid="release-test-seite-fehlt"
                    >
                        {{ t("admin.umgebungen.releaseTest.seite.fehlt") }}
                    </p>
                    <pre
                        v-if="seiteText !== null"
                        class="bericht__text seite__text"
                        data-testid="release-test-seite-text"
                        >{{ seiteText }}</pre>
                    <!-- Bei Rot steht „Bericht kopieren“ schon oben im Fehlerbericht und kopiert dieselbe Seite. -->
                    <div v-if="fehler === null" class="aktionen">
                        <AvmKnopf testid="release-test-seite-kopieren" @click="void berichtKopieren()">{{
                            t("admin.umgebungen.releaseTest.fehler.kopieren")
                        }}</AvmKnopf>
                        <span class="satz satz--leise" role="status">{{ kopierSatz }}</span>
                    </div>
                </details>
            </section>
        </template>

        <p
            v-for="problem in props.test.abweisung.value.length === 0 && !imVersuch ? props.test.problems.value : []"
            :key="problem.key"
            class="satz satz--fehler"
            role="alert"
            data-testid="release-test-problem"
        >
            {{ t(problem.key, problem.params) }}
        </p>
    </FensterKarte>
</template>

<style scoped>
.release-test {
    margin-top: var(--space-12);
}

.satz {
    margin: 0;
    color: var(--color-text-muted);
    line-height: var(--leading-snug);
}

.satz--leise {
    font-size: var(--font-size-small);
}

.satz--fehler {
    color: var(--color-danger-soft-text);
}

.sha {
    font-variant-numeric: tabular-nums;
}

.fakten {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: var(--space-6) 0 0;
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.fakten dt {
    color: var(--color-text-muted);
}

.fakten dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

.fakten__leise {
    color: var(--color-text-muted);
}

.stand {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin-top: var(--space-8);
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.stand--gut {
    border-color: var(--color-success-soft-border);
}

.stand--rot {
    border-color: var(--color-danger-soft-border);
}

.stand__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-6);
    margin: 0;
    color: var(--color-text-strong);
}

.stand__zeile--gut {
    color: var(--color-success-soft-text);
}

.stand__zeile--rot {
    color: var(--color-danger-soft-text);
}

/* Der Balken nach erwarteter Dauer: dieselbe Form wie der Balken einer Zeile der Warteschlange. */
.balken {
    height: 4px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.balken__fuell {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .balken__fuell {
        transition: none;
    }
}

/* Die Schritte untereinander (vierzehn passen nicht auf eine Linie): Kreis, Name, Zeit am Zeilenende. */
.schritte {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.schritt {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
}

.schritt > :first-child {
    display: inline-flex;
}

.schritt__fehler {
    color: var(--color-danger);
    font-size: var(--font-size-small);
    line-height: 1;
}

.schritt__name {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.schritt--fertig .schritt__name {
    color: var(--color-text);
}

.schritt--laeuft .schritt__name {
    color: var(--color-text-strong);
}

.schritt--fehler .schritt__name {
    color: var(--color-danger-soft-text);
}

.schritt__aus {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: 1;
}

.schritt--uebernommen .schritt__name,
.schritt--uebersprungen .schritt__name {
    color: var(--color-text-muted);
}

.teile__titel {
    margin: var(--space-4) 0 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

/* Die vier Browserteile: Kreis, Name und Zeit in einer Zeile, darunter Bereiche, Zahl der Fälle und Zustand. */
.teile {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.teil {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    min-width: 0;
}

.teil > :first-child {
    display: inline-flex;
}

.teil__name {
    min-width: 0;
    color: var(--color-text);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.teil--laeuft .teil__name {
    color: var(--color-text-strong);
}

.teil--rot .teil__name {
    color: var(--color-danger-soft-text);
}

.teil--offen .teil__name,
.teil--uebersprungen .teil__name {
    color: var(--color-text-muted);
}

.teil__info {
    grid-column: 2 / -1;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.teil__rot {
    color: var(--color-danger-soft-text);
}

.fall__teil {
    color: var(--color-text-muted);
}

.schritt__zeit {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.stand__satz {
    min-width: 0;
    overflow-wrap: anywhere;
}

/* Die Knöpfe des Berichts („Bericht kopieren“) stehen in einer eigenen Reihe unter dem Bericht. */
.aktionen {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-8) var(--space-12);
    margin-top: var(--space-8);
}

.bericht {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin-top: var(--space-8);
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-danger-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.bericht__titel {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-body);
}

.bericht__text {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
}

.bericht__text--lang {
    max-height: 18em;
    overflow-y: auto;
}

.faelle {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.fall {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.fall__kopf {
    min-width: 0;
}

.fall__datei {
    color: var(--color-text-strong);
}

.fall__name {
    color: var(--color-text);
}

.bericht__pfad {
    overflow-wrap: anywhere;
}

/* Der eine Bericht (WI-0248): aufklappbar, eine Seite; lang darf er sein, er rollt in sich. */
.seite {
    margin-top: var(--space-8);
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.seite__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    cursor: pointer;
}

.seite__text {
    max-height: 70vh;
    margin-top: var(--space-8);
    overflow-y: auto;
}
</style>
