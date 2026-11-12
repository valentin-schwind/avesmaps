<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
    MESSWERTE_TAKT_MS,
    MESSWERTE_URL,
    MESSWERTE_VERLAUF_URL,
    type Messwerte,
    type MesswerteVerlauf,
} from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, t } from "../i18n/i18n";
import MessWerte from "../system/mess-werte.vue";

/**
 * Der Unterreiter „Server“ (WI-0141; Betreiber 2026-10-14: „die server auslastung kannst du mit einem 24h und einen 1min
 * diagramm jeweils für CPU und RAM darstellen. auch eine wochenübersicht ‚Aktivste Zeiten‘ und ein ‚Verlauf‘ … zu sehen,
 * wo die peaks sind“).
 *
 * - **Letzte Minute** aus den eigenen Abfragen: dreißig Punkte, keine einzige Zeile in der Datenbank.
 * - **24 Stunden** aus `system_sample` (Fächer von fünf Minuten, SYS-8), **Tafel und Verlauf** aus `system_hour`.
 * - 🔴 **Eine Lücke ist keine Null.** Wo nie gemessen wurde, bleibt die Fläche leer und die Linie unterbrochen; eine 0
 *   läse sich wie ein ruhiger Server.
 */
const props = defineProps<{ aktiv: boolean; geloest?: boolean }>();
const emit = defineEmits<{ loesen: [] }>();

const BREITE = 356;
const HOEHE = 72;
/** So viele Punkte fasst die Minute: 60 s / 2 s. */
const MINUTE_PUNKTE = 30;

const jetzt = ref<Messwerte | undefined>(undefined);
const verlauf = ref<MesswerteVerlauf | undefined>(undefined);
const fehler = ref(false);
/** Die letzte Minute, jüngster Punkt zuletzt; der Browser hält sie, niemand speichert sie. */
const minute = ref<{ cpu: number | null; ram: number | null }[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;

async function hole(): Promise<void> {
    try {
        const antwort = await fetch(MESSWERTE_URL, { cache: "no-store", headers: { accept: "application/json" } });
        if (!antwort.ok) throw new Error(String(antwort.status));
        const werte = (await antwort.json()) as Messwerte;
        jetzt.value = werte;
        minute.value = [
            ...minute.value,
            {
                cpu: werte.server.cpu,
                ram: werte.server.ramGesamt > 0 ? werte.server.ramBelegt / werte.server.ramGesamt : null,
            },
        ].slice(-MINUTE_PUNKTE);
        fehler.value = false;
    } catch {
        fehler.value = true;
    }
}

async function holeVerlauf(): Promise<void> {
    try {
        const antwort = await fetch(MESSWERTE_VERLAUF_URL, {
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        if (antwort.ok) verlauf.value = (await antwort.json()) as MesswerteVerlauf;
    } catch {
        // Der Verlauf ist das Beiwerk: Fehlt er, stehen die Momentwerte trotzdem.
    }
}

function starte(): void {
    if (timer !== undefined) return;
    void hole();
    void holeVerlauf();
    timer = setInterval(() => void hole(), MESSWERTE_TAKT_MS);
}
function halte(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
}

onMounted(() => props.aktiv && starte());
watch(
    () => props.aktiv,
    (an) => (an ? starte() : halte()),
);
onBeforeUnmount(halte);

/**
 * Eine Reihe von Anteilen (0 bis 1) als Linienzüge. Eine Lücke (`null`) trennt den Zug, statt ihn auf null zu ziehen —
 * sonst stürzte die Linie in jeder Messpause auf den Boden.
 */
function zuege(werte: readonly (number | null)[], hoechst = 1): string[] {
    if (werte.length < 2) return [];
    const schritt = BREITE / (werte.length - 1);
    const stuecke: string[] = [];
    let lauf: string[] = [];
    werte.forEach((wert, i) => {
        if (wert === null) {
            if (lauf.length > 1) stuecke.push(lauf.join(" "));
            lauf = [];
            return;
        }
        lauf.push(`${(i * schritt).toFixed(1)},${(HOEHE - Math.min(1, wert / hoechst) * HOEHE).toFixed(1)}`);
    });
    if (lauf.length > 1) stuecke.push(lauf.join(" "));
    return stuecke;
}

/**
 * Die Obergrenze eines Bildes: etwas über dem höchsten Wert, mindestens 10 %.
 *
 * 🔴 Nicht fest 100 %. Ein Server, der bei sieben Prozent läuft, zeichnete sonst eine gerade Linie am Boden — und
 * genau die Bewegung darin ist das, was man sehen will.
 */
function grenze(werte: readonly (number | null)[]): number {
    const hoechst = Math.max(0, ...werte.filter((wert): wert is number => wert !== null));
    return Math.max(0.1, Math.min(1, Math.ceil(hoechst * 11) / 10));
}

/** Ein Bild: die Züge und die Zahl, die oben an der Achse steht. */
function bild(werte: readonly (number | null)[]): { zuege: string[]; grenze: number } {
    const oben = grenze(werte);
    return { zuege: zuege(werte, oben), grenze: oben };
}

const minuteCpu = computed(() => bild(minute.value.map((punkt) => punkt.cpu)));
const minuteRam = computed(() => bild(minute.value.map((punkt) => punkt.ram)));

const tagCpu = computed(() => bild((verlauf.value?.tag ?? []).map((punkt) => punkt.cpu)));
const tagRam = computed(() =>
    bild(
        (verlauf.value?.tag ?? []).map((punkt) =>
            punkt.ramBelegt !== null && punkt.ramGesamt !== null && punkt.ramGesamt > 0
                ? punkt.ramBelegt / punkt.ramGesamt
                : null,
        ),
    ),
);

/** Die Tafel „Aktivste Zeiten“: je Feld der Mittelwert, getönt wie bei den Besuchern. */
const tafel = computed(() => verlauf.value?.tafel ?? []);
const tafelHoechst = computed(() => Math.max(0.01, ...tafel.value.flat().map((wert) => wert ?? 0)));
function feldTon(wert: number | null): string {
    if (wert === null) return "var(--color-panel-soft)";
    const anteil = Math.sqrt(wert / tafelHoechst.value);
    return `color-mix(in srgb, var(--color-chart1) ${Math.round(10 + anteil * 80)}%, var(--color-panel-soft))`;
}

const tage = computed(() => verlauf.value?.tage ?? []);
const verlaufBild = computed(() => {
    const reihe = tage.value;
    if (reihe.length < 2) return undefined;
    // Mittel und Spitze teilen eine Achse: Sonst läge die Spitze scheinbar auf dem Mittel.
    const oben = grenze([...reihe.map((e) => e.cpu), ...reihe.map((e) => e.cpuSpitze)]);
    return {
        grenze: oben,
        mittel: zuege(
            reihe.map((eintrag) => eintrag.cpu),
            oben,
        ),
        spitze: zuege(
            reihe.map((eintrag) => eintrag.cpuSpitze),
            oben,
        ),
        von: reihe[0]?.tag ?? "",
        bis: reihe.at(-1)?.tag ?? "",
    };
});

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
/**
 * Ein Anteil als Prozent. Unter zehn Prozent mit einer Nachkommastelle.
 *
 * 🔴 **Eine gemessene Kleinigkeit ist keine Null.** Ein ruhiger Server verbraucht 0,4 % einer Kernzeit; auf ganze
 * Prozent gerundet stand dort „0 %“ und behauptete Stillstand (Betreiber 2026-10-14, Production). Die Stelle hinter dem
 * Komma gibt es deshalb nur unterhalb eines Prozents — darüber wäre „7,0 %“ nur Unruhe. Dass gar nicht gemessen wurde,
 * sagt weiterhin der Strich; die beiden dürfen nie gleich aussehen.
 */
function anteilText(anteil: number | null | undefined): string {
    if (anteil === null || anteil === undefined) return "–";
    const prozent = anteil * 100;
    return `${formatNumber(prozent, prozent > 0 && prozent < 1 ? 1 : 0)} %`;
}
const ramAnteil = computed(() => {
    const werte = jetzt.value?.server;
    return werte && werte.ramGesamt > 0 ? werte.ramBelegt / werte.ramGesamt : null;
});
</script>

<template>
    <div class="server">
        <p v-if="fehler" class="server__satz">{{ t("messwerte.fehler") }}</p>

        <!-- Die Werte selbst, oben: Hierher gehört der Block, den der Betreiber am 2026-10-14 in diesen Reiter wollte. -->
        <section class="server__block">
            <h3 class="server__titel">
                {{ t("messwerte.titel") }}
                <AvmKnopf art="weich" groesse="zeile" testid="statistik-messfenster" @click="emit('loesen')">{{
                    t("messwerte.loesen")
                }}</AvmKnopf>
            </h3>
            <MessWerte v-if="!props.geloest" :aktiv="props.aktiv" :zeige-online="false" />
            <p v-else class="server__satz">{{ t("messwerte.gleoest") }}</p>
        </section>

        <section class="server__block">
            <h3 class="server__titel">
                {{ t("server.jetzt") }} <span class="server__wert">{{ t("server.jetztWert") }}</span>
            </h3>
            <div class="server__paar">
                <figure class="server__figur">
                    <figcaption>
                        {{ t("server.cpu") }} · {{ anteilText(jetzt?.server.cpu) }}
                        <span class="server__grenze">{{ anteilText(minuteCpu.grenze) }}</span>
                    </figcaption>
                    <svg class="server__bild" :viewBox="`0 -4 ${BREITE} ${HOEHE + 8}`" role="img" aria-hidden="true">
                        <polyline v-for="(zug, i) in minuteCpu.zuege" :key="i" :points="zug" class="server__linie" />
                    </svg>
                </figure>
                <figure class="server__figur">
                    <figcaption>
                        {{ t("server.ram") }} · {{ anteilText(ramAnteil) }}
                        <span class="server__grenze">{{ anteilText(minuteRam.grenze) }}</span>
                    </figcaption>
                    <svg class="server__bild" :viewBox="`0 -4 ${BREITE} ${HOEHE + 8}`" role="img" aria-hidden="true">
                        <polyline
                            v-for="(zug, i) in minuteRam.zuege"
                            :key="i"
                            :points="zug"
                            class="server__linie server__linie--zwei"
                        />
                    </svg>
                </figure>
            </div>
        </section>

        <section class="server__block">
            <h3 class="server__titel">
                {{ t("server.tag") }} <span class="server__wert">{{ t("server.tagWert") }}</span>
            </h3>
            <p v-if="tagCpu.zuege.length === 0 && tagRam.zuege.length === 0" class="server__satz">
                {{ t("server.leer") }}
            </p>
            <div v-else class="server__paar">
                <figure class="server__figur">
                    <figcaption>
                        {{ t("server.cpu") }}<span class="server__grenze">{{ anteilText(tagCpu.grenze) }}</span>
                    </figcaption>
                    <svg class="server__bild" :viewBox="`0 -4 ${BREITE} ${HOEHE + 8}`" role="img" aria-hidden="true">
                        <polyline v-for="(zug, i) in tagCpu.zuege" :key="i" :points="zug" class="server__linie" />
                    </svg>
                </figure>
                <figure class="server__figur">
                    <figcaption>
                        {{ t("server.ram") }}<span class="server__grenze">{{ anteilText(tagRam.grenze) }}</span>
                    </figcaption>
                    <svg class="server__bild" :viewBox="`0 -4 ${BREITE} ${HOEHE + 8}`" role="img" aria-hidden="true">
                        <polyline
                            v-for="(zug, i) in tagRam.zuege"
                            :key="i"
                            :points="zug"
                            class="server__linie server__linie--zwei"
                        />
                    </svg>
                </figure>
            </div>
        </section>

        <section v-if="tafel.length > 0" class="server__block">
            <h3 class="server__titel">
                {{ t("server.zeiten") }} <span class="server__wert">{{ t("server.zeitenWert") }}</span>
            </h3>
            <div class="server__tafel">
                <template v-for="(zeile, i) in tafel" :key="i">
                    <span class="server__tag">{{ WOCHENTAGE[i] }}</span>
                    <span
                        v-for="(feld, stunde) in zeile"
                        :key="stunde"
                        class="server__feld"
                        :style="{ background: feldTon(feld) }"
                        :title="`${WOCHENTAGE[i]} ${String(stunde)}:00 · ${anteilText(feld)}`"
                    />
                </template>
            </div>
        </section>

        <section v-if="verlaufBild" class="server__block">
            <h3 class="server__titel">
                {{ t("server.verlauf") }} <span class="server__wert">{{ t("server.verlaufWert") }}</span>
            </h3>
            <svg class="server__bild" :viewBox="`0 -4 ${BREITE} ${HOEHE + 8}`" role="img" aria-hidden="true">
                <polyline
                    v-for="(zug, i) in verlaufBild.spitze"
                    :key="`s${i}`"
                    :points="zug"
                    class="server__linie--spitze"
                />
                <polyline v-for="(zug, i) in verlaufBild.mittel" :key="`m${i}`" :points="zug" class="server__linie" />
            </svg>
            <p class="server__fuss">
                <span>{{ verlaufBild.von }}</span>
                <span class="server__legende"
                    ><span class="server__marke" />{{ t("server.mittel") }}
                    <span class="server__marke server__marke--spitze" />{{ t("server.spitze") }}</span
                >
                <span>{{ verlaufBild.bis }}</span>
            </p>
        </section>

        <p v-if="verlauf" class="server__fussSatz">
            {{ t("server.stunden", { zahl: formatNumber(verlauf.stunden, 0) }) }}
        </p>
    </div>
</template>

<style scoped>
.server {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
}

.server__block {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.server__titel {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-8);
    margin: 0;
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--color-text-muted);
}

.server__wert {
    letter-spacing: normal;
    text-transform: none;
}

.server__satz {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

/* Zwei Bilder nebeneinander, solange sie passen; im Panel (400 px) untereinander. */
.server__paar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: var(--space-8) var(--space-12);
}

.server__figur {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.server__grenze {
    float: right;
    color: var(--color-text-muted);
}

.server__figur figcaption {
    font-size: var(--font-size-small);
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

.server__bild {
    width: 100%;
    height: auto;
    overflow: visible;
}

.server__linie {
    fill: none;
    stroke: var(--color-chart1);
    stroke-width: 1.6;
    stroke-linejoin: round;
}

.server__linie--zwei {
    stroke: var(--color-chart2);
}

.server__linie--spitze {
    fill: none;
    stroke: var(--color-chart3);
    stroke-width: 1.2;
    stroke-dasharray: 3 3;
}

/* Wochentafel wie bei den Besuchern: eine Spalte für den Tag, 24 für die Stunden. */
.server__tafel {
    display: grid;
    grid-template-columns: auto repeat(24, 1fr);
    gap: 2px;
    align-items: center;
}

.server__tag {
    padding-right: var(--space-4);
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.server__feld {
    aspect-ratio: 1;
    border-radius: 2px;
}

.server__fuss,
.server__fussSatz {
    display: flex;
    justify-content: space-between;
    gap: var(--space-8);
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.server__legende {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

.server__marke {
    display: inline-block;
    width: 14px;
    border-top: 2px solid var(--color-chart1);
}

.server__marke--spitze {
    border-top-style: dashed;
    border-top-color: var(--color-chart3);
}
</style>
