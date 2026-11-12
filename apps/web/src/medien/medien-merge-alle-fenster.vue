<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import type { JobSummary, MediaMergePreview } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { createMedienClient, istAbbruch, type MedienClient } from "./medien-client";
import { Handlung, createMedienOperationen, operationsFehler, type MedienOperationen } from "./medien-operationen";
import { zahl } from "./medien-text";

/**
 * „Alle bytegleichen Duplikate zusammenführen“ (WI-0068, Betreiber 2026-10-17, wörtlich: „Vor der Ausführung soll eine Vorschau die
 * Zahl der Gruppen, betroffenen Assets, umzuhängenden Verwendungen und Konflikte anzeigen. Gruppen mit unterschiedlichen oder unklaren
 * Rechten werden aus dem automatisierten Lauf ausgeschlossen und separat zur manuellen Prüfung angeboten.“).
 *
 * - **Vorschau**: die Zahlen des Servers (`merge/preview`); die Gruppen mit abweichenden Rechten einzeln, jede öffnet ihr Werk im
 *   Inspector, wo „⊕ Zusammenführen …“ die einzelne Gruppe nimmt.
 * - **Ein Klick** (nur Betreiber, frischer Passkey): Der Körper ist genau diese Vorschau; hat sich seitdem etwas geändert, sagt der
 *   Server 409 und das Blatt lädt neu.
 * - **Fortschritt**: Der Lauf ist ein Auftrag der Warteschlange; das Blatt liest seinen Stand alle zwei Sekunden, bis er endet. Den
 *   Bericht je Gruppe (übersprungen, gescheitert) trägt der Auftrag auf der Statusseite.
 */
const props = defineProps<{
    client?: MedienClient | undefined;
    operationen?: MedienOperationen | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ asset: [id: string]; fertig: [] }>();

const client = props.client ?? createMedienClient();
const ops = props.operationen ?? createMedienOperationen();
const handlung = new Handlung();
const vorschau = shallowRef<MediaMergePreview | undefined>(undefined);
const laedt = ref(false);
const sendet = ref(false);
const fehler = ref<string | undefined>(undefined);
const auftragId = ref<string | undefined>(undefined);
const auftrag = shallowRef<JobSummary | undefined>(undefined);
let ladeAbbruch: AbortController | undefined;
let takt: ReturnType<typeof setTimeout> | undefined;

async function lade(): Promise<void> {
    ladeAbbruch?.abort();
    const abbruch = new AbortController();
    ladeAbbruch = abbruch;
    laedt.value = true;
    try {
        vorschau.value = await client.zusammenfuehrenVorschau(abbruch.signal);
    } catch (error) {
        if (!istAbbruch(error, abbruch.signal)) fehler.value = operationsFehler(error).text;
    } finally {
        if (ladeAbbruch === abbruch) laedt.value = false;
    }
}

watch(
    offen,
    (jetzt) => {
        if (!jetzt) return;
        fehler.value = undefined;
        auftragId.value = undefined;
        auftrag.value = undefined;
        void lade();
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    ladeAbbruch?.abort();
    if (takt !== undefined) clearTimeout(takt);
});

const sauber = computed(() => vorschau.value?.groups.filter((gruppe) => !gruppe.rightsDiffer) ?? []);
const konflikte = computed(() => vorschau.value?.groups.filter((gruppe) => gruppe.rightsDiffer) ?? []);
const zahlen = computed(() => {
    const summen = vorschau.value?.totals;
    if (summen === undefined) return [];
    return [
        { name: t("medien.mergeAlle.gruppen"), wert: summen.groups, testid: "gruppen" },
        { name: t("medien.mergeAlle.werke"), wert: summen.members, testid: "werke" },
        { name: t("medien.mergeAlle.gehenAuf"), wert: summen.members - summen.groups, testid: "gehen-auf" },
        { name: t("medien.mergeAlle.ziehenUm"), wert: summen.moves, testid: "ziehen-um" },
        { name: t("medien.mergeAlle.zurueckgezogen"), wert: summen.retires, testid: "zurueckgezogen" },
        { name: t("medien.mergeAlle.konflikte"), wert: summen.withDifferingRights, testid: "konflikte" },
    ];
});
const beendet = computed(() => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(auftrag.value?.state ?? ""));
const laeuft = computed(() => auftragId.value !== undefined && !beendet.value);
const gesperrt = computed(() => {
    if (sendet.value) return t("medien.bearbeiten.sendet");
    if (laeuft.value) return t("medien.mergeAlle.laeuftNoch");
    if (sauber.value.length === 0) return t("medien.mergeAlle.nichts");
    return undefined;
});
const stand = computed(() => {
    const job = auftrag.value;
    if (auftragId.value === undefined) return undefined;
    if (job === undefined || job.state === "QUEUED") return t("medien.mergeAlle.wartet");
    if (job.state === "RUNNING")
        return t("medien.mergeAlle.fortschritt", { prozent: zahl(Math.round((job.progress ?? 0) * 100)) });
    if (job.state === "SUCCEEDED") return t("medien.mergeAlle.fertig");
    return t("medien.mergeAlle.gescheitert", { grund: job.errorSummary ?? job.state });
});

async function beobachte(): Promise<void> {
    const id = auftragId.value;
    if (id === undefined || !offen.value) return;
    try {
        auftrag.value = (await client.auftrag(id, new AbortController().signal)) ?? auftrag.value;
    } catch {
        // Ohne Stand bleibt die letzte Zeile; der nächste Takt fragt wieder.
    }
    if (beendet.value) {
        emit("fertig");
        await lade();
        return;
    }
    takt = setTimeout(() => void beobachte(), 2000);
}

async function starte(): Promise<void> {
    const summen = vorschau.value?.totals;
    if (gesperrt.value !== undefined || summen === undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        const quittung = await handlung.fuehreAus((operationId) =>
            ops.alleZusammenfuehren({
                operationId,
                groups: sauber.value.map(({ fileGroup, keepAssetId }) => ({ fileGroup, keepAssetId })),
                expected: {
                    groups: summen.groups,
                    members: summen.members,
                    moves: summen.moves,
                    retires: summen.retires,
                },
            }),
        );
        auftragId.value = quittung.derivedWork.find((arbeit) => arbeit.kind === "media_merge_all")?.jobId;
        void beobachte();
    } catch (error) {
        const meldung = operationsFehler(error);
        fehler.value = meldung.text;
        // Die Vorschau war veraltet: neu laden, damit der nächste Klick den heutigen Stand trägt.
        if (meldung.code === "merge_preview_stale") await lade();
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="t('medien.mergeAlle.titel')"
        :zusatz="t('medien.mergeAlle.zusatz')"
        testid="medien-merge-alle-fenster"
    >
        <div class="merge-alle">
            <p v-if="laedt && !vorschau" class="merge-alle__satz">{{ t("medien.mergeAlle.laedt") }}</p>
            <dl v-if="vorschau" class="merge-alle__zahlen" data-testid="medien-merge-alle-zahlen">
                <template v-for="eintrag in zahlen" :key="eintrag.testid">
                    <dt>{{ eintrag.name }}</dt>
                    <dd :data-testid="`medien-merge-alle-${eintrag.testid}`">{{ zahl(eintrag.wert) }}</dd>
                </template>
            </dl>
            <AvmHinweis ton="neutral" testid="medien-merge-alle-satz">{{ t("medien.mergeAlle.satz") }}</AvmHinweis>
            <section
                v-if="konflikte.length > 0"
                class="merge-alle__konflikte"
                data-testid="medien-merge-alle-konfliktliste"
            >
                <h5 class="merge-alle__kopf">{{ t("medien.mergeAlle.konflikteKopf") }}</h5>
                <p class="merge-alle__satz">{{ t("medien.mergeAlle.konflikteSatz") }}</p>
                <ul class="merge-alle__liste">
                    <li v-for="gruppe in konflikte" :key="gruppe.fileGroup">
                        <AvmKnopf
                            groesse="zeile"
                            testid="medien-merge-alle-pruefen"
                            @click="emit('asset', gruppe.keepAssetId)"
                            >{{ t("medien.mergeAlle.pruefen", { n: zahl(gruppe.members) }) }}</AvmKnopf
                        >
                    </li>
                </ul>
            </section>
            <AvmHinweis v-if="stand" ton="neutral" rolle="status" testid="medien-merge-alle-stand">{{
                stand
            }}</AvmHinweis>
            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" testid="medien-merge-alle-fehler">{{
                fehler
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-merge-alle-schliessen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="gesperrt" testid="medien-merge-alle-starten" @click="starte">{{
                t("medien.mergeAlle.knopf", { n: zahl(sauber.length) })
            }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.merge-alle {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.merge-alle__zahlen {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2) var(--space-6);
    margin: 0;
    font-size: var(--font-size-small);
}

.merge-alle__zahlen dt {
    color: var(--color-text);
}

.merge-alle__zahlen dd {
    margin: 0;
    color: var(--color-text-strong);
    text-align: right;
    font-variant-numeric: tabular-nums;
}

.merge-alle__kopf {
    margin: 0;
    font-size: var(--font-size-small);
    color: var(--color-text-strong);
}

.merge-alle__satz {
    margin: 0;
    font-size: var(--font-size-small);
}

.merge-alle__liste {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
</style>
