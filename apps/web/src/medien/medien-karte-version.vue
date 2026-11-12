<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { KARTE_VERSION_MAX, type MamKarteBild, type MamKarteDetail } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { t } from "../i18n/i18n";
import { versionsBezeichnung } from "./medien-karte-neu-modell";
import { bildFreigabeSatz } from "./medien-karte-vorschau-modell";
import { bildRolle, sichtbaresBild } from "./medien-karten-modell";
import { kreisDerVerwendung, kreisName } from "./medien-kreis";
import { Handlung, operationsFehler, type MedienOperationen } from "./medien-operationen";

/**
 * Eine Version der Karte im Platz „Die Karte“ (WI-0287 Stufe 2; Vali: „"Die Karte" darf mehrere einträge haben“; Entwurf Fassung 5, `platzKarte`, `version__feld`): Daumen, Kreis,
 * Titel, der Satz der Freigabe, das Feld „Version“ (die Bezeichnung, gespeichert beim Verlassen des Felds), „Im Inspector öffnen“, „↑ Zuerst zeigen“ ab der zweiten und
 * „— Vom Eintrag lösen“. Ein Ändern gibt es nicht: Ersetzt wird durch Lösen und Zuweisen. Ohne Recht steht die Bezeichnung als Zeile da, nur „Im Inspector öffnen“ bleibt.
 *
 * 🔴 Jede Handlung ist eine Operation gegen den gesehenen Stand (`citymap.version`, `citymap.image_remove` mit `assetId`); danach liest der Eintrag neu. Ein Konflikt liest ebenso
 * neu, damit der nächste Versuch den neuen Stand trägt.
 */
const props = defineProps<{
    karte: Pick<MamKarteDetail, "id" | "revision" | "active">;
    bild: MamKarteBild;
    /** Die Stelle unter den Versionen (ab 0); die erste hat kein „Zuerst zeigen“. */
    stelle: number;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
}>();
const emit = defineEmits<{
    oeffneBild: [assetId: string];
    /** Bezeichnung oder Reihenfolge geändert, oder ein Konflikt: den Eintrag neu lesen. */
    geaendert: [];
    /** Vom Eintrag gelöst: Der Platz sagt, wo das Werk bleibt, und liest neu. */
    geloest: [];
}>();

const feldId = useId();
const bezeichnung = ref(props.bild.versionLabel ?? "");
// Ein neuer Stand vom Server (nach dem Speichern, nach einem Konflikt) gilt, solange niemand tippt.
watch(
    () => props.bild.versionLabel,
    (neu) => {
        bezeichnung.value = neu ?? "";
    },
);

const freigabeSatz = computed(() => bildFreigabeSatz(props.bild, props.karte.active));
const laeuft = ref(false);
const fehler = ref<string | undefined>(undefined);
const bezeichnungHandlung = new Handlung();
const zuerstHandlung = new Handlung();
const loesenHandlung = new Handlung();

async function fuehre(lauf: () => Promise<unknown>): Promise<boolean> {
    if (laeuft.value) return false;
    laeuft.value = true;
    fehler.value = undefined;
    try {
        await lauf();
        return true;
    } catch (error) {
        const meldung = operationsFehler(error);
        fehler.value = meldung.text;
        if (meldung.code === "edit_conflict") emit("geaendert");
        return false;
    } finally {
        laeuft.value = false;
    }
}

/** Beim Verlassen des Felds (und mit Enter): nur, wenn sich die Bezeichnung wirklich ändert. */
async function speichereBezeichnung(): Promise<void> {
    const neu = versionsBezeichnung(bezeichnung.value);
    if (neu === (props.bild.versionLabel ?? null)) return;
    const ok = await fuehre(() =>
        bezeichnungHandlung.fuehreAus((operationId) =>
            props.operationen.karteVersion(props.karte.id, {
                operationId,
                baseRevision: props.karte.revision,
                assetId: props.bild.assetId,
                op: "label",
                label: neu,
            }),
        ),
    );
    if (ok) emit("geaendert");
}

async function zuerst(): Promise<void> {
    const ok = await fuehre(() =>
        zuerstHandlung.fuehreAus((operationId) =>
            props.operationen.karteVersion(props.karte.id, {
                operationId,
                baseRevision: props.karte.revision,
                assetId: props.bild.assetId,
                op: "first",
            }),
        ),
    );
    if (ok) emit("geaendert");
}

async function loesen(): Promise<void> {
    const ok = await fuehre(() =>
        loesenHandlung.fuehreAus((operationId) =>
            props.operationen.karteBildLoesen(props.karte.id, {
                operationId,
                baseRevision: props.karte.revision,
                role: "map_full",
                assetId: props.bild.assetId,
            }),
        ),
    );
    if (ok) emit("geloest");
}
</script>

<template>
    <li class="version" data-testid="medien-platz-version">
        <div class="version__zeile">
            <span class="version__daumen">
                <img v-if="sichtbaresBild(bild)" :src="sichtbaresBild(bild)!.url" alt="" loading="lazy" />
            </span>
            <span class="version__text">
                <span class="version__l1">
                    <AvmKreis :fuellung="kreisDerVerwendung(bild)" :name="kreisName(kreisDerVerwendung(bild))" />
                    <span class="version__name">{{ bild.title ?? bildRolle(bild) }}</span>
                </span>
                <span class="version__l2" data-testid="medien-platz-version-satz">{{ freigabeSatz }}</span>
            </span>
        </div>
        <label v-if="bearbeitbar" class="version__feld" :for="feldId">
            <span class="version__l2">{{ t("medien.karten.version.feld") }}</span>
            <AvmEingabe
                :id="feldId"
                v-model="bezeichnung"
                :placeholder="t('medien.karten.version.platzhalter')"
                :gesperrt="laeuft ? t('medien.bearbeiten.sendet') : undefined"
                :maxlength="KARTE_VERSION_MAX"
                testid="medien-platz-version-feld"
                @change="speichereBezeichnung"
            />
        </label>
        <p v-else-if="bild.versionLabel" class="version__l2 version__lesend">
            {{ t("medien.karten.version.lesend", { version: bild.versionLabel }) }}
        </p>
        <div class="version__knoepfe">
            <AvmKnopf groesse="zeile" testid="medien-platz-version-oeffnen" @click="emit('oeffneBild', bild.assetId)">{{
                t("medien.karten.bild.oeffnen")
            }}</AvmKnopf>
            <template v-if="bearbeitbar">
                <AvmKnopf
                    v-if="stelle > 0"
                    groesse="zeile"
                    :gesperrt="laeuft ? t('medien.bearbeiten.sendet') : undefined"
                    testid="medien-platz-version-zuerst"
                    @click="zuerst"
                >
                    <template #zeichen>↑</template>
                    {{ t("medien.karten.version.zuerst") }}
                </AvmKnopf>
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="laeuft ? t('medien.bearbeiten.sendet') : undefined"
                    testid="medien-platz-version-loesen"
                    @click="loesen"
                >
                    <template #zeichen>—</template>
                    {{ t("medien.karten.platz.loesen") }}
                </AvmKnopf>
            </template>
        </div>
        <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" testid="medien-platz-version-fehler">{{
            fehler
        }}</AvmHinweis>
    </li>
</template>

<style scoped>
/* Eine Version (Entwurf `.version`): die Zeile wie im Platz, darunter das Feld und die Knöpfe; zwischen den Versionen ein feiner Strich. */
.version {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

.version + .version {
    padding-top: var(--space-8);
    border-top: 1px solid var(--color-divider);
}

.version__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.version__daumen {
    flex: none;
    width: 72px;
    height: 54px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.version__daumen img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.version__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.version__l1 {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.version__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.version__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.version__lesend {
    margin: 0;
}

/* „Version“ und das Feld in einer Zeile, wie im Entwurf: die Beschriftung in der Breite der Daumen, das Feld füllt den Rest. */
.version__feld {
    display: grid;
    grid-template-columns: 72px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-6);
}

.version__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}
</style>
