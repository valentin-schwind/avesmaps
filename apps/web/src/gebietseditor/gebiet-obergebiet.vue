<script setup lang="ts">
import { computed, ref } from "vue";
import type { EditorTerritoryRow } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import ZoomSpanne from "../fenster/zoomspanne.vue";
import { formatNumber, locale, t } from "../i18n/i18n";
import { neueGebietsfarbe } from "./neue-flaeche-gebiet";

/**
 * „Unter neues Obergebiet …“ (EDIT-0003 T57, Variante A, Betreiber 2026-10-19; Fassung 5, `blattOber`): ein neues Gebiet ohne eigene
 * Fläche, unter das die gewählten wandern, als EINE Operation (`territory.create_parent`) mit ↺ im Verlauf. Das Blatt steht im Kasten
 * „Im Baum“ der Mehrfachauswahl (`gebiet-mehrfach.vue`).
 *
 * - **Name:** leer heißt der erste freie wie beim Anlegen („Neues Herrschaftsgebiet“).
 * - **Zoomspanne:** Vorschlag von 0 bis ein Band vor dem frühesten gewählten (die Bedienprobe mit Valis Reich: 0–3 über zwei Reichen ab 4).
 * - **Hängt selbst unter:** dem Obergebiet, unter dem alle gewählten heute hängen; hängen sie unter verschiedenen, wird es eine Wurzel.
 * - **Farbe:** die Variante dieses Obergebiets wie bei „Neue Fläche“ (`neueGebietsfarbe`), ohne Obergebiet Legacys Grau.
 */
const props = defineProps<{
    gewaehlte: readonly EditorTerritoryRow[];
    zeilen: readonly EditorTerritoryRow[];
    kennung: string;
    gesperrt?: string | undefined;
}>();
const emit = defineEmits<{
    anlegen: [
        daten: { name: string; parent: string | undefined; color: string; zoom: { minZoom: number; maxZoom: number } },
    ];
    abbrechen: [];
}>();

const nachId = computed(() => new Map(props.zeilen.map((z) => [z.id, z])));
const eltern = computed(() => [...new Set(props.gewaehlte.map((z) => z.parent ?? ""))]);
/** Das gemeinsame Obergebiet der gewählten; verschieden oder keins: Wurzel. */
const obergebiet = computed(() =>
    eltern.value.length === 1 && eltern.value[0] !== "" ? nachId.value.get(eltern.value[0]!) : undefined,
);
const name = ref("");
const frueheste = Math.min(...props.gewaehlte.map((z) => z.minZoom ?? 0));
const spanne = ref({ von: 0, bis: frueheste <= 0 ? 0 : frueheste - 1 });

function farbe(): string {
    const ober = obergebiet.value;
    if (ober === undefined) return neueGebietsfarbe(undefined, "");
    const kette: { id: string; name: string }[] = [];
    for (let oben = ober.parent; oben !== undefined && kette.length < 64; oben = nachId.value.get(oben)?.parent)
        kette.push({ id: oben, name: nachId.value.get(oben)?.name ?? "" });
    const kinder = props.zeilen.filter((z) => z.parent === ober.id).map((z) => ({ id: z.id, name: z.name }));
    return neueGebietsfarbe({ color: ober.color, parents: kette, children: kinder }, crypto.randomUUID());
}
const namen = computed(() =>
    new Intl.ListFormat(locale.value, { type: "conjunction" }).format(props.gewaehlte.map((z) => z.name)),
);
const n = computed(() => formatNumber(props.gewaehlte.length, 0));
function anlegen(): void {
    if (props.gesperrt !== undefined) return;
    emit("anlegen", {
        name: name.value.trim(),
        parent: obergebiet.value?.id,
        color: farbe(),
        zoom: { minZoom: spanne.value.von, maxZoom: spanne.value.bis },
    });
}
</script>

<template>
    <AvmBestaetigung
        :frage="t('gebietseditor.sammel.oberFrage', { n })"
        :bestaetigen="t('gebietseditor.sammel.oberKnopf')"
        :gesperrt="gesperrt"
        :testid="`${kennung}-obergebiet-neu`"
        @bestaetigen="anlegen"
        @abbrechen="emit('abbrechen')"
    >
        <FensterFeldzeilen>
            <dt>{{ t("gebietseditor.feld.name") }}</dt>
            <dd>
                <AvmEingabe
                    v-model="name"
                    :placeholder="t('gebietseditor.sammel.oberName')"
                    :aria-label="t('gebietseditor.feld.name')"
                    :testid="`${kennung}-obergebiet-neu-name`"
                />
            </dd>
            <dt>{{ t("gebietseditor.feld.zoomspanne") }}</dt>
            <dd class="obergebiet__reihe">
                <ZoomSpanne
                    class="obergebiet__spanne"
                    :von="spanne.von"
                    :bis="spanne.bis"
                    paar
                    tippen
                    :name="t('gebietseditor.sammel.oberName')"
                    :testid="`${kennung}-obergebiet-neu-spanne`"
                    @aendere="(neu) => (spanne = { von: neu.von ?? 0, bis: neu.bis ?? 8 })"
                />
                <span>{{ t("gebietseditor.unter.spanne", { von: spanne.von, bis: spanne.bis }) }}</span>
            </dd>
            <dt>{{ t("gebietseditor.sammel.oberUnter") }}</dt>
            <dd :data-testid="`${kennung}-obergebiet-neu-unter`">
                {{ obergebiet?.name ?? t("gebietseditor.obergebiet.keins") }}
            </dd>
        </FensterFeldzeilen>
        <ul class="obergebiet__folgen" :data-testid="`${kennung}-obergebiet-neu-folgen`">
            <li>
                <b>{{ t("gebietseditor.sammel.imBaumTitel") }}:</b> {{ t("gebietseditor.sammel.oberBaum", { namen }) }}
            </li>
            <li v-if="eltern.length > 1" class="obergebiet__warn">
                <b>{{ t("gebietseditor.sammel.oberVorherTitel") }}:</b> {{ t("gebietseditor.sammel.oberVorher") }}
            </li>
            <li>
                <b>{{ t("gebietseditor.entfernen.karteTitel") }}:</b> {{ t("gebietseditor.sammel.oberKarte") }}
            </li>
            <li>
                <b>{{ t("gebietseditor.entfernen.verlaufTitel") }}:</b> {{ t("gebietseditor.sammel.oberVerlauf") }}
            </li>
        </ul>
    </AvmBestaetigung>
</template>

<style scoped>
.obergebiet__reihe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
    align-items: center;
}

.obergebiet__spanne {
    flex: 1 1 12rem;
    min-width: 9rem;
}

.obergebiet__folgen {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-12);
}

.obergebiet__warn {
    color: var(--color-warning-soft-text);
}
</style>
