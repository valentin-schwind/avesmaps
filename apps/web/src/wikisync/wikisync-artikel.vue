<script setup lang="ts">
/**
 * Die Zeile „Einzelner Artikel“ (Mockup `review/wi-0253/wikisync-mockup.html`, Vali 2026-10-25: „Einzelartikel: bleibt der Weg über die MediaWiki-API, eine Wiki-Anfrage ohne
 * Anmeldung, unabhängig vom Monats-Dump; das Ergebnis steht im Dump-Bericht“): ein Artikelname und „Artikel vergleichen“. Der Klick reiht einen leichten Auftrag ein und wartet nicht
 * auf die Antwort; der Auftrag stellt GENAU EINE Anfrage im 20-Sekunden-Takt und legt den Vergleich ab (`POST /api/admin/wikisync/artikel`). Geschrieben wird nichts.
 *
 * - **Recht:** ab Editor, ohne Passkey (Vali 2026-10-25; Claudias Festlegung: löst eine Wiki-Anfrage aus).
 * - **Lokal gesperrt:** Dort entsteht kein Abruf beim Wiki; der Knopf sagt es mit dem Grund, statt etwas einzureihen, das sofort scheitert.
 * - Das Ergebnis liegt im Dump-Bericht (das Fenster öffnet auf den Vergleich); die Zeile nennt nur, ob und wann er fertig war.
 */
import { computed, ref } from "vue";
import { WIKISYNC_ARTIKEL_TITEL_VERBOTEN, type WikisyncStand } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import { t } from "../i18n/i18n";
import type { Wikisync } from "./wikisync";
import WikisyncInfo from "./wikisync-info.vue";
import WikisyncZeile from "./wikisync-zeile.vue";
import { abrufSperre, artikelLage, auftragVon, kreisName, laeuftSchonSatz, prozent } from "./wikisync-text";

const props = defineProps<{
    wikisync: Wikisync;
    stand: WikisyncStand;
    jetzt: Date;
    telefon: boolean;
    darf: boolean;
    rechtSatz: (recht: string) => string;
}>();
const emit = defineEmits<{ zeige: [id: number] }>();

const ws = props.wikisync;
const titel = ref("");
const auftrag = computed(() => auftragVon(props.stand, "wiki_artikel"));
const letzter = computed(() => ws.artikel.value?.vergleiche[0]);
const lage = computed(() => artikelLage(props.stand, letzter.value, props.jetzt));

/** Dieselbe Prüfung wie die Route (`artikelTitelOk`): kein `|` und keine Zeichen, die in keinem Titel stehen; so scheitert der Klick nicht erst am Server. */
const titelUnzulaessig = computed(
    () =>
        WIKISYNC_ARTIKEL_TITEL_VERBOTEN.test(titel.value) ||
        [...titel.value].some((zeichen) => (zeichen.codePointAt(0) ?? 0) < 32 || zeichen === "\u007f"),
);

const sperre = computed((): string | undefined => {
    if (!props.darf) return props.rechtSatz("compare_wiki_article");
    const abruf = abrufSperre(ws.artikel.value?.abruf);
    if (abruf !== undefined) return abruf;
    if (auftrag.value !== undefined) return laeuftSchonSatz(auftrag.value, "admin.wikisync.fehler.artikel_laeuft");
    if (titel.value.trim() === "") return t("admin.wikisync.artikel.leer");
    if (titelUnzulaessig.value) return t("admin.wikisync.artikel.zeichen");
    return undefined;
});

const meldung = computed(() => {
    const e = ws.ergebnis.value;
    return e !== null && e.wo === "artikel" ? e.result : undefined;
});

async function vergleichen(): Promise<void> {
    await ws.artikelVergleichen(titel.value.trim());
}
</script>

<template>
    <WikisyncZeile
        :name="t('admin.wikisync.artikel.name')"
        :kreis="lage.kreis"
        :kreis-name="kreisName(lage.kreis)"
        :unter="lage.unter"
        :ton="lage.ton"
        :telefon="telefon"
        :prozent="auftrag === undefined ? null : prozent(auftrag.fortschritt)"
        testid="wsync-artikel"
    >
        <template #was
            >{{ t("admin.wikisync.artikel.was") }}<WikisyncInfo :text="t('admin.wikisync.artikel.info')"
        /></template>
        <template #knopf>
            <AvmKnopf
                groesse="zeile"
                :gesperrt="sperre"
                :breit="telefon"
                testid="wsync-artikel-knopf"
                @click="vergleichen()"
                ><span aria-hidden="true">⇄ </span>{{ t("admin.wikisync.artikel.knopf") }}</AvmKnopf
            >
        </template>
        <div class="wsync-artikel">
            <AvmEingabe
                v-model="titel"
                class="wsync-artikel__feld"
                :gesperrt="darf ? undefined : rechtSatz('compare_wiki_article')"
                :placeholder="t('admin.wikisync.artikel.feld')"
                :aria-label="t('admin.wikisync.artikel.feldName')"
                maxlength="200"
                spellcheck="false"
                autocomplete="off"
                testid="wsync-artikel-feld"
                @keydown.enter.prevent="sperre === undefined ? vergleichen() : undefined"
            />
            <button
                v-if="letzter !== undefined && letzter.status === 'fertig'"
                type="button"
                class="wsync-artikel__link"
                data-testid="wsync-artikel-zeigen"
                @click="emit('zeige', letzter.id)"
            >
                {{ t("admin.wikisync.artikel.zeigen", { titel: letzter.titel }) }}
            </button>
        </div>
        <VerwaltungMeldung :ergebnis="meldung" testid="wsync-artikel-meldung" />
    </WikisyncZeile>
</template>

<style scoped>
.wsync-artikel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    align-items: flex-start;
}

.wsync-artikel__feld {
    width: min(100%, 28rem);
}

.wsync-artikel__link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
}

.wsync-artikel__link:hover {
    text-decoration: underline;
}

.wsync-artikel__link:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring);
}
</style>
