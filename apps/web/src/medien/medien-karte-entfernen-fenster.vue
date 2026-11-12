<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import { KARTE_VERSION_MAX, type MamKarteDetail, type MamKarteZeile, type OperationReceipt } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { istAbbruch, type MedienClient } from "./medien-client";
import MedienKarteZielwahl from "./medien-karte-zielwahl.vue";
import { versionenDerKarte } from "./medien-karte-neu-modell";
import { erstesWort, vorschlagVersion, zusammenlegenFolgen } from "./medien-karte-zusammenlegen-modell";
import { bildRolle } from "./medien-karten-modell";
import { Handlung, operationsFehler, type MedienOperationen } from "./medien-operationen";

/**
 * Das Blatt „Eintrag entfernen“ der Kartensammlung (WI-0287, Entwurf Fassung 5 `zeichneEntfernen`). Es sagt VORHER, was die Handlung trifft. Zwei Wege:
 *
 * - **Nur entfernen** (Stufe 1, `citymap.retire`): Besucher sehen den Eintrag nicht mehr, er lässt sich jederzeit zurückholen; die Bilder bleiben in den Listen, nur ohne diese
 *   Verwendung; Orte, Fundstellen und Publikationen bleiben am stillgelegten Eintrag.
 * - **Bilder an anderen Eintrag geben** (Stufe 2, `citymap.merge`): Der Eintrag, der sie bekommt, wird gesucht (ohne Suchwort die Namensvettern); das Feld „Version“ ist mit dem
 *   Rest des Titels vorbelegt (ohne Karte gibt es kein Feld), darunter die Folgen. Ohne gewähltes Ziel steht ein Satz statt des Sendens. Danach ist das Ziel gewählt.
 *
 * Entfernt wird nie gelöscht. 🔴 Das Zusammenlegen geht gegen den gesehenen Stand BEIDER Einträge: Der des Ziels kommt aus seinem frisch gelesenen Eintrag (die Liste kennt keine
 * Revision); ein Konflikt liest ihn neu, damit der nächste Versuch den neuen Stand trägt.
 */
const props = defineProps<{
    karte: MamKarteDetail;
    operationen: MedienOperationen;
    client: Pick<MedienClient, "karten" | "karte">;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{
    /** Entfernt; `ziel` ist der Eintrag, der die Bilder bekam. */
    fertig: [quittung: OperationReceipt, ziel: { id: string; title: string } | undefined];
    /** Ein Konflikt am Eintrag selbst: Er liest neu. */
    neuLaden: [];
}>();

type Weg = "nur" | "uebergeben";
const weg = ref<Weg>("nur");
const wegWahl = computed(() => [
    { value: "nur", label: t("medien.karten.entfernen.nur") },
    { value: "uebergeben", label: t("medien.karten.entfernen.uebergeben") },
]);
const wegModell = computed({
    get: (): string => weg.value,
    set: (neu: string) => {
        weg.value = neu === "uebergeben" ? "uebergeben" : "nur";
        ohneZiel.value = false;
    },
});

const handlung = new Handlung();
const zusammenHandlung = new Handlung();
const sendet = ref(false);
const fehler = ref<string | undefined>(undefined);
const ohneZiel = ref(false);
const feldId = useId();

const bilder = computed(() => props.karte.images.map((bild) => bild.title ?? bildRolle(bild)).join(", "));
const hatKarte = computed(() => versionenDerKarte(props.karte).length > 0);
const wort = computed(() => erstesWort(props.karte.title));

// --- Das Ziel: gewählt in der Liste, gelesen als ganzer Eintrag (Versionen, Vorschau, Revision) ---
const ziel = shallowRef<MamKarteZeile | undefined>(undefined);
const zielEintrag = shallowRef<MamKarteDetail | undefined>(undefined);
const zielFehler = ref(false);
const version = ref("");
let zielLauf: AbortController | undefined;
let zielGelesen: Promise<MamKarteDetail | undefined> = Promise.resolve(undefined);

function liesZiel(id: string): void {
    zielLauf?.abort();
    const abbruch = new AbortController();
    zielLauf = abbruch;
    zielFehler.value = false;
    zielGelesen = props.client.karte(id, abbruch.signal).then(
        (eintrag) => {
            if (abbruch.signal.aborted) return undefined;
            zielEintrag.value = eintrag;
            return eintrag;
        },
        (error: unknown) => {
            if (!istAbbruch(error, abbruch.signal)) zielFehler.value = true;
            return undefined;
        },
    );
}
// Ein neu gewähltes Ziel nimmt den Satz eines früheren Fehlers weg; das Zurücksetzen nach „stillgelegt“ lässt ihn stehen.
watch(ziel, (neu) => {
    zielEintrag.value = undefined;
    ohneZiel.value = false;
    if (neu === undefined) {
        zielLauf?.abort();
        return;
    }
    fehler.value = undefined;
    version.value = vorschlagVersion(props.karte.title, neu.title);
    liesZiel(neu.id);
});
onBeforeUnmount(() => zielLauf?.abort());

const folgen = computed(() =>
    zielEintrag.value === undefined ? undefined : zusammenlegenFolgen(props.karte, zielEintrag.value),
);

watch(offen, (jetzt) => {
    if (!jetzt) return;
    fehler.value = undefined;
    sendet.value = false;
});

async function senden(): Promise<void> {
    if (sendet.value) return;
    if (weg.value === "uebergeben" && ziel.value === undefined) {
        ohneZiel.value = true;
        return;
    }
    sendet.value = true;
    fehler.value = undefined;
    try {
        if (weg.value === "nur") {
            const quittung = await handlung.fuehreAus((operationId) =>
                props.operationen.karteEntfernen(props.karte.id, { operationId, baseRevision: props.karte.revision }),
            );
            emit("fertig", quittung, undefined);
        } else {
            const eintrag = zielEintrag.value ?? (await zielGelesen);
            if (eintrag === undefined) {
                fehler.value = t("medien.karten.zielwahl.fehler");
                return;
            }
            const quittung = await zusammenHandlung.fuehreAus((operationId) =>
                props.operationen.karteZusammenlegen(props.karte.id, {
                    operationId,
                    baseRevision: props.karte.revision,
                    targetId: eintrag.id,
                    targetBaseRevision: eintrag.revision,
                    ...(hatKarte.value ? { versionLabel: version.value } : {}),
                }),
            );
            emit("fertig", quittung, { id: eintrag.id, title: eintrag.title });
        }
        offen.value = false;
    } catch (error) {
        const meldung = operationsFehler(error);
        fehler.value = meldung.text;
        // Wer hat zuerst geändert, die Quelle oder das Ziel? Beide neu lesen: Der nächste Versuch trägt den neuen Stand.
        if (meldung.code === "edit_conflict") {
            emit("neuLaden");
            if (ziel.value !== undefined) liesZiel(ziel.value.id);
        }
        if (meldung.code === "citymap_target_retired") ziel.value = undefined;
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
        :titel="t('medien.karten.entfernen.titel', { titel: karte.title })"
        testid="medien-karte-entfernen-fenster"
    >
        <div class="entfernen">
            <AvmHinweis ton="warnung" testid="medien-karte-entfernen-wirkung">{{
                t("medien.karten.entfernen.hinweis")
            }}</AvmHinweis>
            <AvmSegmente
                v-model="wegModell"
                :options="wegWahl"
                :label="t('medien.karten.entfernen.wahl')"
                gestapelt="auto"
                testid="medien-karte-entfernen-weg"
            />
            <ul v-if="weg === 'nur'" class="entfernen__liste" data-testid="medien-karte-entfernen-folgen">
                <li>
                    {{
                        karte.images.length > 0
                            ? t("medien.karten.entfernen.bilder", { bilder })
                            : t("medien.karten.entfernen.keineBilder")
                    }}
                </li>
                <li>{{ t("medien.karten.entfernen.bleibt") }}</li>
                <li>{{ t("medien.karten.entfernen.loeschen") }}</li>
            </ul>
            <template v-else>
                <MedienKarteZielwahl
                    v-model="ziel"
                    :client="client"
                    :wort="wort"
                    :ausser="karte.id"
                    :gesperrt="sendet"
                    testid="medien-karte-entfernen-ziel"
                />
                <template v-if="ziel">
                    <label v-if="hatKarte" class="entfernen__feld" :for="feldId">
                        <span class="entfernen__beschriftung">{{ t("medien.karten.version.feld") }}</span>
                        <AvmEingabe
                            :id="feldId"
                            v-model="version"
                            :placeholder="t('medien.karten.version.platzhalter')"
                            :maxlength="KARTE_VERSION_MAX"
                            :gesperrt="sendet ? t('medien.bearbeiten.sendet') : undefined"
                            testid="medien-karte-entfernen-version"
                        />
                    </label>
                    <ul v-if="folgen" class="entfernen__liste" data-testid="medien-karte-entfernen-folgen">
                        <li v-for="titel in folgen.neu" :key="`neu-${titel}`">
                            {{ t("medien.karten.entfernen.wirdVersion", { titel, ziel: ziel.title }) }}
                        </li>
                        <li v-for="titel in folgen.doppelt" :key="`doppelt-${titel}`">
                            {{ t("medien.karten.entfernen.schonDort", { titel }) }}
                        </li>
                        <li v-if="folgen.vorschau === 'zieht'">{{ t("medien.karten.entfernen.vorschauZieht") }}</li>
                        <li v-else-if="folgen.vorschau === 'bleibt'">
                            {{
                                t("medien.karten.entfernen.vorschauBleibt", {
                                    liste: t("medien.typMehrzahl.map_preview"),
                                })
                            }}
                        </li>
                        <li>{{ t("medien.karten.entfernen.ergaenzt") }}</li>
                    </ul>
                    <p v-else-if="!zielFehler" class="entfernen__satz">{{ t("medien.treffer.laedt") }}</p>
                    <AvmHinweis v-else ton="gefahr" rolle="alert">{{ t("medien.karten.zielwahl.fehler") }}</AvmHinweis>
                </template>
            </template>
            <AvmHinweis v-if="ohneZiel" ton="warnung" rolle="alert" testid="medien-karte-entfernen-ohne-ziel">{{
                t("medien.karten.entfernen.zielFehlt")
            }}</AvmHinweis>
            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" testid="medien-karte-entfernen-fehler">{{
                fehler
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-karte-entfernen-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf
                art="gefahr"
                :gesperrt="sendet ? t('medien.bearbeiten.sendet') : undefined"
                testid="medien-karte-entfernen-senden"
                @click="senden"
            >
                <template #zeichen>{{ weg === "nur" ? "✕" : "⇄" }}</template>
                {{ t(weg === "nur" ? "medien.karten.entfernen.senden" : "medien.karten.entfernen.uebergebenSenden") }}
            </AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.entfernen {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.entfernen__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding-left: var(--space-16);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* „Version“ und das Feld in einer Zeile, wie im Entwurf (`version__feld`): die Beschriftung links, das Feld füllt den Rest. */
.entfernen__feld {
    display: grid;
    grid-template-columns: var(--avm-fenster-version-label) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6);
}

.entfernen__beschriftung,
.entfernen__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
