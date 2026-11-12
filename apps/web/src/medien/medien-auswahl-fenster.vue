<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
    MAM_PAGE_LIMIT,
    MEDIA_CREATION_METHODS,
    assetTypeForRole,
    typeImageVariantAccepts,
    type MamAssetSummary,
    type MediaTypeImageVariant,
    type MediaSlotSubjectKind,
    type HeaderGraphic,
    type MediaSubjectSlots,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { auswahlEintrag, auswahlHandlung, gebundeneAssets, typbildHandlung } from "./medien-auswahl-modell";
import MedienAuswahl from "./medien-auswahl.vue";
import { createMedienClient, istAbbruch, type MedienClient } from "./medien-client";
import type { BindbareRolle, HochladenWeg } from "./medien-formular-modell";
import MedienHochladenFenster from "./medien-hochladen-fenster.vue";
import {
    Handlung,
    bindeAsset,
    bindungAusPlaetzen,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";
import { datum } from "./medien-text";

/**
 * Das Fenster „Wappen für Gareth“ bzw. „Titelbild für Gareth“ (WI-0068 P4b, WI-0126 §11j, Gesamtmockup Version 7): wählen und binden in
 * EINER Operation der Medienverwaltung, oder „↥ Neues … hochladen“ (dasselbe Formular wie überall, `medien-hochladen-fenster.vue`, mit
 * „‹ Zurück zur Auswahl“). Der Ortseditor (EDIT-0001 E19) bettet es ein; die Medienverwaltung öffnet es aus den Verwendungen.
 *
 * - Die Plätze (`MediaSubjectSlots`) lädt das Fenster beim Öffnen selbst: Daraus kommen „gebunden“ und der gesehene Stand der Bindung
 *   (`bindungAusPlaetzen`, die EINE Stelle für `baseRevision` und `baseState`).
 * - Die Liste kommt aus der Suche der Medienverwaltung, gefiltert auf den Asset-Typ der Rolle (Wappen bzw. Bild), nach Namen, seitenweise.
 * - Konflikt (409): Der Satz nennt die Person, die Plätze laden neu, die Wahl bleibt; ein zweiter Klick bindet mit dem neuen Stand.
 */
const props = defineProps<{
    subjekt: { kind: MediaSlotSubjectKind; id: string; name: string };
    rolle: BindbareRolle;
    /**
     * Statt eines Fachobjekts eine TYPBILDKATEGORIE als Ziel (WI-0068, Betreiber 2026-10-11: „erlaube, dass andere bilder aus
     * assets ausgewählt werden können, wobei das alte typbild seinen stern/status verliert“). Gesetzt, bindet das Fenster über
     * `typbildSetzen` statt über `bindeAsset`, lädt keine Plätze (eine Kategorie hat keine) und nennt die Kategorie im Titel.
     * `subjekt` bleibt Pflicht und trägt dabei nur den Namen für das Formular; Rolle ist immer `header`.
     */
    typbild?:
        | {
              kategorie: HeaderGraphic;
              label: string;
              aktuell: { assetId: string; revision: number } | null;
              /** Die Variante, die gesetzt wird (WI-0281); ohne Angabe die KI-Variante. */
              variante?: MediaTypeImageVariant | undefined;
          }
        | undefined;
    darfHochladen: boolean;
    weg?: HochladenWeg | undefined;
    operationen?: MedienOperationen | undefined;
    client?: MedienClient | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ gebunden: [ergebnis: { assetId: string; quittung: OperationReceipt | undefined }] }>();

const ops = props.operationen ?? createMedienOperationen();
const client = props.client ?? createMedienClient();

const plaetze = shallowRef<MediaSubjectSlots | undefined>();
const treffer = shallowRef<MamAssetSummary[]>([]);
const gesamt = ref(0);
const laedt = ref(false);
const suche = ref("");
const gewaehlt = ref<string | undefined>();
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const ladeFehler = ref<string | undefined>();
const handlung = new Handlung();
const hochladenOffen = ref(false);

let lauf: AbortController | undefined;
let platzLauf: AbortController | undefined;
let tippen: ReturnType<typeof setTimeout> | undefined;
/** Zurück vom Hochladen: Liste, Suche und Wahl bleiben stehen, nichts lädt neu. */
let zurueckVomHochladen = false;

async function ladePlaetze(): Promise<void> {
    // Eine Typbildkategorie hat keine Plätze: Der ★ kommt aus der Liste der Kategorien, die das Elternteil schon geladen hat.
    if (props.typbild !== undefined) return;
    platzLauf?.abort();
    platzLauf = new AbortController();
    try {
        plaetze.value = await ops.plaetze(props.subjekt.kind, props.subjekt.id, platzLauf.signal);
    } catch (error) {
        if (!istAbbruch(error)) ladeFehler.value = operationsFehler(error).text;
    }
}

async function ladeTreffer(anhaengen: boolean): Promise<void> {
    lauf?.abort();
    lauf = new AbortController();
    const signal = lauf.signal;
    laedt.value = true;
    ladeFehler.value = undefined;
    const q = suche.value.trim();
    try {
        const antwort = await client.suche(
            {
                type: assetTypeForRole(props.rolle),
                // Ein Reisebild bleibt in seiner Rolle und lässt sich nirgends einbinden (WI-0272 S5): Die Auswahl bietet es gar nicht erst an.
                ohneReisebilder: true,
                ...(q === "" ? {} : { q }),
                sort: "name",
                limit: MAM_PAGE_LIMIT.default,
                offset: anhaengen ? treffer.value.length : 0,
            },
            signal,
        );
        if (signal.aborted) return;
        treffer.value = anhaengen ? [...treffer.value, ...antwort.items] : antwort.items;
        gesamt.value = antwort.total;
    } catch (error) {
        if (!istAbbruch(error)) ladeFehler.value = operationsFehler(error).text;
    } finally {
        if (!signal.aborted) laedt.value = false;
    }
}

watch(
    offen,
    (jetzt) => {
        if (!jetzt) {
            lauf?.abort();
            platzLauf?.abort();
            return;
        }
        if (zurueckVomHochladen) {
            zurueckVomHochladen = false;
            return;
        }
        gewaehlt.value = undefined;
        fehler.value = undefined;
        void ladePlaetze();
        void ladeTreffer(false);
    },
    { immediate: true },
);

watch(suche, () => {
    if (tippen !== undefined) clearTimeout(tippen);
    tippen = setTimeout(() => void ladeTreffer(false), 250);
});

onBeforeUnmount(() => {
    lauf?.abort();
    platzLauf?.abort();
    if (tippen !== undefined) clearTimeout(tippen);
});

const gebunden = computed(() =>
    props.typbild === undefined
        ? gebundeneAssets(plaetze.value, props.rolle)
        : new Set(props.typbild.aktuell === null ? [] : [props.typbild.aktuell.assetId]),
);
const eintraege = computed(() => treffer.value.map((eintrag) => auswahlEintrag(eintrag, gebunden.value, datum)));
/** Die Variante eines Typbilds (WI-0281); bei einem Fachobjekt keine. */
const variante = computed<MediaTypeImageVariant | undefined>(() =>
    props.typbild === undefined ? undefined : (props.typbild.variante ?? "ki"),
);
const knopf = computed(() =>
    props.typbild === undefined
        ? auswahlHandlung(plaetze.value, props.rolle, gewaehlt.value, props.subjekt.name)
        : typbildHandlung(
              props.typbild.aktuell,
              gewaehlt.value,
              props.typbild.label,
              variante.value,
              treffer.value.find((eintrag) => eintrag.id === gewaehlt.value)?.creationMethod,
          ),
);
const titel = computed(() =>
    props.typbild !== undefined
        ? t(variante.value === "ohne_ki" ? "medien.typbild.titelOhneKi" : "medien.typbild.titelKi", {
              art: props.typbild.label,
          })
        : t(props.rolle === "coat" ? "medien.auswahl.titelWappen" : "medien.auswahl.titelBild", {
              ort: props.subjekt.name,
          }),
);
/** Was das Formular beim Hochladen für diese Variante zur Wahl stellt: ohne KI nur Foto, Zeichnung, Scan; KI alles andere. */
const entstehungen = computed(() =>
    variante.value === undefined
        ? undefined
        : MEDIA_CREATION_METHODS.filter((art) => typeImageVariantAccepts(variante.value!, art)),
);
const entstehungSatz = computed(() =>
    variante.value === "ohne_ki" ? t("medien.typbild.variante.hochladenOhneKi") : undefined,
);

async function binden(): Promise<void> {
    const assetId = gewaehlt.value;
    if (assetId === undefined || knopf.value.gesperrt !== undefined) return;
    const typbild = props.typbild;
    const stand = plaetze.value;
    if (typbild === undefined && stand === undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        const quittung = await handlung.fuehreAus((operationId) =>
            typbild === undefined
                ? bindeAsset(ops, bindungAusPlaetzen(stand!, props.rolle), assetId, operationId)
                : ops.typbildSetzen({
                      operationId,
                      category: typbild.kategorie,
                      assetId,
                      // Ohne bisherigen ★ geht keine Revision mit: Der Server verlangt dann, dass die Variante leer IST.
                      ...(typbild.aktuell === null ? {} : { baseRevision: typbild.aktuell.revision }),
                      variant: typbild.variante ?? "ki",
                  }),
        );
        emit("gebunden", { assetId, quittung });
        offen.value = false;
    } catch (error) {
        fehler.value = operationsFehler(error);
        // Ein Konflikt: den neuen Stand holen, die Wahl bleibt; der nächste Klick bindet damit. Bei einem Typbild lädt das
        // Elternteil die Kategorien neu (es hält den ★), deshalb nur hier der Weg über die Plätze.
        if (fehler.value.konflikt !== undefined) void ladePlaetze();
    } finally {
        sendet.value = false;
    }
}

// --- Neues hochladen: dasselbe Formular, mit „‹ Zurück zur Auswahl“ ---

function zumHochladen(): void {
    offen.value = false;
    hochladenOffen.value = true;
}

function zurueckZurAuswahl(): void {
    zurueckVomHochladen = true;
    hochladenOffen.value = false;
    offen.value = true;
}

function hochgeladen(ergebnis: { assetId: string; gebunden: boolean }): void {
    hochladenOffen.value = false;
    if (ergebnis.gebunden) {
        emit("gebunden", { assetId: ergebnis.assetId, quittung: undefined });
        return;
    }
    // 🔴 Ein Typbild wird beim Hochladen NICHT gleich der ★: Das Formular lädt nur hoch (eine Kategorie hat keine Plätze, über die
    // es binden könnte). Die Auswahl kommt zurück, das neue Asset ist gewählt, und derselbe Knopf wie sonst setzt den ★ — eine
    // Operation, ein Fachprotokoll, kein zusammengesetzter Sonderweg.
    if (props.typbild === undefined) return;
    zurueckVomHochladen = true;
    offen.value = true;
    gewaehlt.value = ergebnis.assetId;
    void zeigeHochgeladenes(ergebnis.assetId);
}

/**
 * Die Liste läuft seitenweise nach Namen: Unter tausenden Bildern stünde das neue, gewählt und unsichtbar, irgendwo weiter hinten. Die Suche nach seinem Titel holt es
 * in den Blick. Ohne Titel, oder wenn das Nachlesen scheitert, die Liste wie sie ist: Der Knopf setzt das Bild auch dann, nur sieht man die Wahl nicht.
 */
async function zeigeHochgeladenes(assetId: string): Promise<void> {
    let titel: string | null = null;
    try {
        titel = (await client.asset(assetId, new AbortController().signal)).asset.title;
    } catch (error) {
        if (istAbbruch(error)) return;
    }
    // `watch(suche)` lädt nur, wenn sich das Wort ändert.
    if (titel === null || titel === suche.value) void ladeTreffer(false);
    else suche.value = titel;
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="titel"
        :zusatz="
            typbild
                ? t(variante === 'ohne_ki' ? 'medien.typbild.zusatzOhneKi' : 'medien.typbild.zusatz')
                : t(rolle === 'coat' ? 'medien.auswahl.zusatzWappen' : 'medien.auswahl.zusatzBild')
        "
        testid="medien-auswahl-fenster"
    >
        <div class="medien-auswahl-fenster">
            <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert" testid="medien-auswahl-ladefehler">{{
                ladeFehler
            }}</AvmHinweis>
            <MedienAuswahl
                v-model:gewaehlt="gewaehlt"
                v-model:suche="suche"
                :rolle="rolle"
                :eintraege="eintraege"
                :darf-hochladen="darfHochladen"
                :laedt="laedt"
                :mehr="treffer.length < gesamt"
                :gesamt="gesamt"
                @hochladen="zumHochladen"
                @mehr-laden="ladeTreffer(true)"
            />
            <p class="medien-auswahl-fenster__satz" data-testid="medien-auswahl-satz">{{ knopf.satz }}</p>
            <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" testid="medien-auswahl-fehler">{{
                fehler.text
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-auswahl-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf
                art="gefuellt"
                :gesperrt="sendet ? t('medien.bearbeiten.sendet') : knopf.gesperrt"
                testid="medien-auswahl-binden"
                @click="binden"
                >{{ knopf.text }}</AvmKnopf
            >
        </template>
    </AvmFenster>
    <MedienHochladenFenster
        v-if="hochladenOffen"
        v-model:offen="hochladenOffen"
        :rolle="rolle"
        :ziel="typbild || plaetze === undefined ? undefined : { name: subjekt.name, plaetze }"
        :weg="weg ?? 'medien'"
        zurueck
        :operationen="ops"
        :entstehungen="entstehungen"
        :entstehung-satz="entstehungSatz"
        @zurueck="zurueckZurAuswahl"
        @fertig="hochgeladen"
    />
</template>

<style scoped>
.medien-auswahl-fenster {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.medien-auswahl-fenster__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
