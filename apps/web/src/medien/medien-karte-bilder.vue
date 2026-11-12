<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import type { MamKarteDetail } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import { createMedienClient, type MedienClient } from "./medien-client";
import MedienHochladenFenster from "./medien-hochladen-fenster.vue";
import { versionenDerKarte, type KartenRolle } from "./medien-karte-neu-modell";
import MedienKartePlatz from "./medien-karte-platz.vue";
import type { MedienOperationen } from "./medien-operationen";

/**
 * Der Kasten „Bilder“ einer Karte der Kartensammlung (WI-0287 Stufe 1, Punkt 2): zwei Plätze, „Die Karte“ und „Die Vorschau“ (`medien-karte-platz.vue`), mit Abstand. Dieser Kasten hält, was beide
 * brauchen: das Fenster zum Hochladen (`medien-hochladen-fenster.vue` mit `eintrag`) und den Satz „Liegt jetzt unter Karten als …“ danach. Reviewer und stillgelegte Einträge lesen nur (`bearbeitbar`).
 */
const props = defineProps<{
    karte: MamKarteDetail;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
    client?: MedienClient | undefined;
    /** „Vorschau erzeugen“ aus dem Inspector mit Namenskonflikt (WI-0287 Punkt 5): die Kennung des Eintrags, an dessen Platz der Konflikt erscheint. */
    erzeugenAnstoss?: string | undefined;
}>();
const emit = defineEmits<{
    oeffneBild: [assetId: string];
    /** Ein Bild des Eintrags wurde zugewiesen, geändert, gelöst oder erzeugt: Eintrag, Liste und Zahlen neu lesen. */
    geaendert: [];
    zurListe: [rolle: KartenRolle, assetId: string];
    /** „Link eintragen“ bzw. „Links bearbeiten“ im Platz „Die Karte“: der Kasten „Fundstellen“ öffnet sich. */
    links: [];
    /** Der Anstoß aus dem Inspector ist am Platz angekommen. */
    anstossErledigt: [];
}>();

const client = props.client ?? createMedienClient();
const hochladenRolle = ref<KartenRolle | undefined>(undefined);
const hochladenOffen = computed({
    get: () => hochladenRolle.value !== undefined,
    set: (jetzt: boolean) => {
        if (!jetzt) hochladenRolle.value = undefined;
    },
});
const frisch = shallowRef<{ rolle: KartenRolle; titel: string; assetId: string } | undefined>(undefined);
/** Eine Datei, die hochgeladen wurde, aber nicht am Eintrag hängt: Der Hinweis nennt die Liste, in der sie liegt. */
const loses = ref<KartenRolle | undefined>(undefined);

watch(
    () => props.karte.id,
    () => {
        frisch.value = undefined;
        loses.value = undefined;
        hochladenRolle.value = undefined;
    },
);

function hochgeladen(ergebnis: { assetId: string; gebunden: boolean; titel?: string | undefined }): void {
    const rolle = hochladenRolle.value;
    hochladenRolle.value = undefined;
    if (rolle === undefined) return;
    if (ergebnis.gebunden) {
        frisch.value = { rolle, titel: ergebnis.titel ?? "", assetId: ergebnis.assetId };
        loses.value = undefined;
    } else {
        frisch.value = undefined;
        loses.value = rolle;
    }
    emit("geaendert");
}

function nachAenderung(): void {
    frisch.value = undefined;
    loses.value = undefined;
    emit("geaendert");
}

/** Eine Vorschau ist erzeugt (WI-0287 Punkt 5): Sie hängt schon am Eintrag; der Satz nennt die Liste, in der sie liegt (Entwurf `erzeuge`). */
function erzeugt(titel: string, assetId: string): void {
    frisch.value = { rolle: "map_preview", titel, assetId };
    loses.value = undefined;
    emit("geaendert");
}

const eintrag = computed(() => ({
    id: props.karte.id,
    revision: props.karte.revision,
    titel: props.karte.title,
    zeichner: props.karte.author,
    // Wie viele Versionen die Karte schon hat (WI-0287 Stufe 2): Das Hochladefenster fragt nach der Bezeichnung und sagt, dass die neue dazukommt.
    versionen: versionenDerKarte(props.karte).length,
}));
const frischFuer = (rolle: KartenRolle) => (frisch.value?.rolle === rolle ? frisch.value : undefined);
</script>

<template>
    <FensterKarte :titel="t('medien.karten.abschnitt.bilder')">
        <div class="bilder" data-testid="medien-karte-bilder">
            <MedienKartePlatz
                class="bilder__platz"
                :karte="karte"
                rolle="map_full"
                :bearbeitbar="bearbeitbar"
                :operationen="operationen"
                :client="client"
                :frisch="frischFuer('map_full')"
                @oeffne-bild="(id: string) => emit('oeffneBild', id)"
                @geaendert="nachAenderung"
                @hochladen="hochladenRolle = 'map_full'"
                @links="emit('links')"
                @zur-liste="(id: string) => emit('zurListe', 'map_full', id)"
            />
            <MedienKartePlatz
                class="bilder__platz"
                :karte="karte"
                rolle="map_preview"
                :bearbeitbar="bearbeitbar"
                :operationen="operationen"
                :client="client"
                :frisch="frischFuer('map_preview')"
                :erzeugen-anstoss="erzeugenAnstoss"
                @oeffne-bild="(id: string) => emit('oeffneBild', id)"
                @geaendert="nachAenderung"
                @hochladen="hochladenRolle = 'map_preview'"
                @zur-liste="(id: string) => emit('zurListe', 'map_preview', id)"
                @erzeugt="erzeugt"
                @anstoss-erledigt="emit('anstossErledigt')"
            />
            <AvmHinweis v-if="loses" ton="warnung" rolle="status" testid="medien-karte-bilder-loses">{{
                t("medien.karten.platz.loses", {
                    liste: t(loses === "map_full" ? "medien.typMehrzahl.map" : "medien.typMehrzahl.map_preview"),
                })
            }}</AvmHinweis>
        </div>

        <MedienHochladenFenster
            v-if="hochladenRolle !== undefined"
            v-model:offen="hochladenOffen"
            :rolle="hochladenRolle"
            weg="kartensammlung"
            :eintrag="eintrag"
            :operationen="operationen"
            :client="client"
            @fertig="hochgeladen"
        />
    </FensterKarte>
</template>

<style scoped>
.bilder {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
}

/* Zwischen den Plätzen ein feiner Strich, wie im Entwurf. */
.bilder__platz + .bilder__platz {
    padding-top: var(--space-8);
    border-top: 1px solid var(--color-divider);
}
</style>
