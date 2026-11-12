<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import type { MamAssetSummary, MamKarteDetail } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import FensterVerweis from "../fenster/fenster-verweis.vue";
import { t } from "../i18n/i18n";
import { istAbbruch, type MedienClient } from "./medien-client";
import {
    bildDerRolle,
    leereKarteSatz,
    namensKonflikt,
    typDerRolle,
    versionenDerKarte,
    vorbelegterTitel,
    type KartenRolle,
} from "./medien-karte-neu-modell";
import {
    andererName,
    bildFreigabeSatz,
    erzeugenSatz,
    umSprung,
    vorschauSperrSatz,
} from "./medien-karte-vorschau-modell";
import MedienKarteVersion from "./medien-karte-version.vue";
import { bildRolle, sichtbaresBild } from "./medien-karten-modell";
import { kreisDerVerwendung, kreisName } from "./medien-kreis";
import { Handlung, assetDerQuittung, operationsFehler, type MedienOperationen } from "./medien-operationen";
import { rechtsgrundName } from "./medien-text";

/**
 * Ein Platz im Kasten „Bilder“ einer Karte der Kartensammlung: „Die Karte“ (`map_full`) oder „Die Vorschau“ (`map_preview`), WI-0287 Stufe 1, Punkt 2, Entwurf Fassung 5 (`platzKarte`, `platzVorschau`,
 * `platzPanel`, `zeichneTreffer`).
 *
 * - **Die Karte (Stufe 2):** alle aktiven Versionen in ihrer Reihenfolge (`medien-karte-version.vue`), im Kopf „n Versionen“ ab zwei; darunter „⇄ Weitere Version zuweisen“ und
 *   „↥ Weitere Version hochladen“, ohne Karte „⇄ Zuweisen“, „↥ Hochladen“ und der Knopf der Links. Ein „Ändern“ gibt es an einer Version nicht: Ersetzt wird durch Lösen und Zuweisen.
 * - **Die Vorschau belegt:** Daumen, Kreis, Titel, der Satz der Freigabe (die Entscheidung der Policy an genau dieser Stelle), „Im Inspector öffnen“; mit Recht dazu „⇄ Ändern“ und
 *   „— Vom Eintrag lösen“.
 * - **Leer:** ein Satz, was fehlt (bei der Karte mit den Links, lesend; bei der Vorschau, dass die Kachel in der Infobox ohne Bild bleibt); mit Recht „⇄ Zuweisen“ und „↥ Hochladen“.
 * - **Zuweisen und Ändern** öffnen im Platz die Suche mit Vorschaubild (die Werke der Liste „Karten“ bzw. „Kartenvorschauen“; ohne Suchwort die ersten), dazu „↥ Stattdessen hochladen“ und
 *   „Abbrechen“. Ein Klick auf einen Treffer weist ihn gleich zu: eine Karte kommt als Version dazu, eine Vorschau ersetzt, was dort hing (das Werk bleibt in der Liste).
 * - Nach dem Hochladen steht im Platz „Liegt jetzt unter Karten als …“ mit Sprung in die Liste (`frisch`).
 * - **Vorschau erzeugen** (WI-0287 Punkt 5, Entwurf `erzeugenKnopf`, `erzeugenSatz`, `platzPanel` Zweig Konflikt): Im leeren Platz „Die Vorschau“ eines Eintrags mit Karte steht
 *   „✚ Vorschau erzeugen“ (gefüllt) vorn, darunter der Satz, woraus sie entsteht, oder der Sperrgrund (`vorschauSperre` der Karte, vom Server). Gibt es den Titel
 *   `Vorschau von „<Eintrag>“` unter „Kartenvorschauen“ schon, öffnet sich der Konflikt: „⇄ Vorhandene verwenden“ oder „✚ Unter diesem Namen erzeugen“ mit Namensfeld.
 *   Danach hängt die Vorschau sofort und sagt „Wird gerechnet. Das Bild erscheint von selbst.“; „Erzeugt aus <Karte>“ springt zur Karte im Inspector.
 * - 🔴 Rechte, Stand und Art des Werks prüft der Server (`citymap.image`, 409 `edit_conflict`, `media_type_mismatch`); ein fehlendes Recht sperrt hier nur die Knöpfe (`bearbeitbar`).
 */
const props = defineProps<{
    karte: MamKarteDetail;
    rolle: KartenRolle;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
    client: MedienClient;
    /** Das Werk, das eben hochgeladen und hierher gebunden wurde: Titel und Kennung für den Sprung in die Liste. */
    frisch?: { titel: string; assetId: string } | undefined;
    /**
     * Nur „Die Vorschau“: „Vorschau erzeugen“ wurde im Inspector der Karte gedrückt und fand einen gleichen Namen (Entwurf: „Aus dem Inspector heraus führt der
     * Namenskonflikt in den Eintrag“). Die Kennung des Eintrags; passt sie, startet der Platz den Ablauf selbst und zeigt den Konflikt.
     */
    erzeugenAnstoss?: string | undefined;
}>();
const emit = defineEmits<{
    oeffneBild: [assetId: string];
    /** Der Eintrag hat sich geändert (zugewiesen, gelöst oder ein Konflikt): neu lesen. */
    geaendert: [];
    hochladen: [];
    zurListe: [assetId: string];
    /** Nur „Die Karte“ ohne Bild: den Kasten „Fundstellen“ öffnen. */
    links: [];
    /** Eine Vorschau ist erzeugt und hängt am Eintrag: Titel und Kennung für „Liegt jetzt unter …“. */
    erzeugt: [titel: string, assetId: string];
    /** Der Anstoß aus dem Inspector ist angekommen. */
    anstossErledigt: [];
}>();

/** Nur „Die Vorschau“: das eine Bild. Die Karte hat Versionen (`versionen`). */
const bild = computed(() => (props.rolle === "map_preview" ? bildDerRolle(props.karte, "map_preview") : undefined));
/** Nur „Die Karte“ (WI-0287 Stufe 2): alle aktiven Versionen in ihrer Reihenfolge. */
const versionen = computed(() => (props.rolle === "map_full" ? versionenDerKarte(props.karte) : []));
const hatKarte = computed(() => bildDerRolle(props.karte, "map_full") !== undefined);
const hatVorschau = computed(() => bildDerRolle(props.karte, "map_preview") !== undefined);
/** Was hier schon hängt: Es steht in der Suche nicht noch einmal zur Wahl. */
const gebunden = computed(
    () =>
        new Set(props.karte.images.filter((eintrag) => eintrag.role === props.rolle).map((eintrag) => eintrag.assetId)),
);
const listenName = computed(() =>
    t(props.rolle === "map_full" ? "medien.typMehrzahl.map" : "medien.typMehrzahl.map_preview"),
);
// Ein Bild an einem stillgelegten Eintrag ist nicht öffentlich, weil der Eintrag es ist (Entwurf `satzVon`), nicht weil die Bindung „zurückgezogen“ wäre.
// Davor (WI-0287 Punkt 5): „Wird gerechnet …“ und „Offline: der Notaus der Karte gilt auch hier.“
const freigabeSatz = computed(() => (bild.value === undefined ? "" : bildFreigabeSatz(bild.value, props.karte.active)));
/** „Erzeugt aus <Karte>. Rechte und Notaus folgen der Karte.“: der Sprung steht an der Stelle von {karte}. */
const erzeugtAusSatz = computed(() =>
    bild.value?.erzeugtAus === null || bild.value?.erzeugtAus === undefined
        ? undefined
        : { ...umSprung("medien.karten.vorschau.erzeugtAus", "karte"), karte: bild.value.erzeugtAus },
);

const leerSatz = computed(() => {
    if (props.rolle === "map_full") {
        const satz = leereKarteSatz(props.karte.links.length > 0, hatVorschau.value);
        return t(
            satz === "keine"
                ? "medien.karten.platz.leerKeine"
                : satz === "nurLink"
                  ? "medien.karten.platz.leerNurLink"
                  : satz === "vorschauLink"
                    ? "medien.karten.platz.leerVorschauLink"
                    : "medien.karten.platz.leerVorschauOhneLink",
        );
    }
    return t(hatKarte.value ? "medien.karten.platz.vorschauKeineMitKarte" : "medien.karten.platz.vorschauKeine");
});

// --- Die Suche im Platz: Zuweisen und Ändern ---

const sucheOffen = ref(false);
const q = ref("");
const treffer = shallowRef<readonly MamAssetSummary[]>([]);
const laedt = ref(false);
const trefferFehler = ref(false);
let uhr: ReturnType<typeof setTimeout> | undefined;
let lauf: AbortController | undefined;
const RUHE_MS = 250;
const ANZAHL = 6;

function haltAn(): void {
    if (uhr !== undefined) clearTimeout(uhr);
    lauf?.abort();
}
onBeforeUnmount(haltAn);

function sucheLaden(): void {
    haltAn();
    laedt.value = true;
    trefferFehler.value = false;
    uhr = setTimeout(
        () => {
            const abbruch = new AbortController();
            lauf = abbruch;
            const wort = q.value.trim();
            props.client
                .suche(
                    {
                        type: typDerRolle(props.rolle),
                        kind: "image",
                        ohneReisebilder: true,
                        limit: ANZAHL + 1,
                        ...(wort === "" ? {} : { q: wort }),
                    },
                    abbruch.signal,
                )
                .then((antwort) => {
                    if (abbruch.signal.aborted) return;
                    // Was hier schon hängt (die Vorschau, jede Version der Karte), steht nicht noch einmal zur Wahl.
                    treffer.value = antwort.items.filter((werk) => !gebunden.value.has(werk.id)).slice(0, ANZAHL);
                    laedt.value = false;
                })
                .catch((error: unknown) => {
                    if (istAbbruch(error, abbruch.signal)) return;
                    trefferFehler.value = true;
                    laedt.value = false;
                });
        },
        q.value.trim() === "" ? 0 : RUHE_MS,
    );
}
watch(q, () => {
    if (sucheOffen.value) sucheLaden();
});

function oeffneSuche(): void {
    sage.value = undefined;
    fehler.value = undefined;
    q.value = "";
    sucheOffen.value = true;
    sucheLaden();
}
function schliesseSuche(): void {
    haltAn();
    sucheOffen.value = false;
    laedt.value = false;
}
// Ein anderer Eintrag, eine neue Fassung desselben: Die Suche gilt für den alten Stand nicht mehr.
watch(
    () => props.karte.id,
    () => {
        schliesseSuche();
        sage.value = undefined;
        fehler.value = undefined;
    },
);

// --- Handlungen ---

const laeuft = ref(false);
const fehler = ref<string | undefined>(undefined);
/** Ein ruhiger Satz nach dem Lösen (kein Fehler). */
const sage = ref<string | undefined>(undefined);
const zuweisenHandlung = new Handlung();
const loesenHandlung = new Handlung();

async function fuehre(lauf: () => Promise<unknown>): Promise<boolean> {
    if (laeuft.value) return false;
    laeuft.value = true;
    fehler.value = undefined;
    sage.value = undefined;
    try {
        await lauf();
        return true;
    } catch (error) {
        const meldung = operationsFehler(error);
        fehler.value = meldung.text;
        // Der Eintrag ist anders als gesehen: neu lesen, damit der nächste Versuch den neuen Stand trägt.
        if (meldung.code === "edit_conflict") emit("geaendert");
        return false;
    } finally {
        laeuft.value = false;
    }
}

async function zuweisen(werk: MamAssetSummary): Promise<void> {
    const ok = await fuehre(() =>
        zuweisenHandlung.fuehreAus((operationId) =>
            props.operationen.karteBildZuweisen(props.karte.id, {
                operationId,
                baseRevision: props.karte.revision,
                role: props.rolle,
                assetId: werk.id,
            }),
        ),
    );
    if (!ok) return;
    schliesseSuche();
    emit("geaendert");
}

async function loesen(): Promise<void> {
    const ok = await fuehre(() =>
        loesenHandlung.fuehreAus((operationId) =>
            props.operationen.karteBildLoesen(props.karte.id, {
                operationId,
                baseRevision: props.karte.revision,
                role: props.rolle,
            }),
        ),
    );
    if (!ok) return;
    geloest();
}

/** Nach dem Lösen (die Vorschau oder eine Version der Karte): der ruhige Satz, wo das Werk bleibt, und neu lesen. */
function geloest(): void {
    fehler.value = undefined;
    sage.value = t("medien.karten.platz.geloest", { liste: listenName.value });
    emit("geaendert");
}

/** Eine Version hat Bezeichnung oder Reihenfolge geändert: neu lesen, ein alter Satz gilt nicht mehr. */
function versionGeaendert(): void {
    sage.value = undefined;
    emit("geaendert");
}

function stattdessenHochladen(): void {
    schliesseSuche();
    emit("hochladen");
}

// --- Vorschau erzeugen (WI-0287 Punkt 5) ---

const satzId = useId();
/** Die Karte des Eintrags, aus der eine Vorschau entstünde; ohne Karte gibt es den Knopf nicht. */
const quelle = computed(() => (props.rolle === "map_preview" ? bildDerRolle(props.karte, "map_full") : undefined));
const sperrSatz = computed(() => vorschauSperrSatz(quelle.value?.vorschauSperre));
// Die erste Version ist die Quelle; trägt sie eine Bezeichnung, nennt der Satz sie (WI-0287 Stufe 2, Entwurf `erzeugenSatz`).
const erzeugenText = computed(() => erzeugenSatz(quelle.value?.vorschauSperre, quelle.value?.versionLabel));
/** Der Konflikt im Platz: das Werk, das schon so heißt, und der Name, unter dem es gesucht wurde. */
const konflikt = shallowRef<{ anderes: MamAssetSummary; name: string } | undefined>(undefined);
const neuerName = ref("");
const erzeugenHandlung = new Handlung();
const konfliktText = computed(() =>
    konflikt.value === undefined
        ? ""
        : t("medien.karten.vorschau.konflikt", { name: konflikt.value.name, liste: listenName.value }),
);

/** Erst nach einem gleichen Namen unter „Kartenvorschauen“ suchen; gibt es ihn, kündigt der Platz ihn an, sonst entsteht die Vorschau gleich. */
const sucht = ref(false);
async function erzeugen(): Promise<void> {
    const karte = quelle.value;
    if (karte === undefined || sperrSatz.value !== undefined || laeuft.value || sucht.value) return;
    fehler.value = undefined;
    sage.value = undefined;
    const titel = vorbelegterTitel("map_preview", props.karte.title);
    let anderes: MamAssetSummary | undefined;
    sucht.value = true;
    try {
        const antwort = await props.client.suche(
            { q: titel, type: "map_preview", ohneReisebilder: true, limit: 20 },
            new AbortController().signal,
        );
        anderes = namensKonflikt(titel, antwort.items);
    } catch {
        // Ohne Antwort bleibt es beim Erzeugen; der Hinweis ist eine Auskunft, kein Schutz (wie beim Hochladen).
    } finally {
        sucht.value = false;
    }
    if (anderes !== undefined) {
        konflikt.value = { anderes, name: titel };
        neuerName.value = andererName(titel);
        return;
    }
    await erzeugeMit(titel);
}

async function erzeugeMit(titel: string): Promise<void> {
    const karte = quelle.value;
    if (karte === undefined) return;
    let neu: string | undefined;
    const ok = await fuehre(async () => {
        const quittung = await erzeugenHandlung.fuehreAus((operationId) =>
            props.operationen.karteVorschauErzeugen(props.karte.id, {
                operationId,
                baseRevision: props.karte.revision,
                sourceAssetId: karte.assetId,
                title: titel,
            }),
        );
        neu = assetDerQuittung(quittung);
    });
    if (!ok) return;
    konflikt.value = undefined;
    // „erzeugt“ liest den Eintrag selbst neu (und setzt danach „Liegt jetzt unter …“); ohne Kennung bleibt es beim Neulesen.
    if (neu !== undefined) emit("erzeugt", titel, neu);
    else emit("geaendert");
}

async function unterNamenErzeugen(): Promise<void> {
    const name = neuerName.value.trim();
    if (name === "") {
        fehler.value = t("medien.karten.vorschau.nameFehlt");
        return;
    }
    await erzeugeMit(name);
}

async function vorhandeneVerwenden(): Promise<void> {
    if (konflikt.value === undefined) return;
    await zuweisen(konflikt.value.anderes);
    if (fehler.value === undefined) konflikt.value = undefined;
}

// Der Anstoß aus dem Inspector: einmal, sobald der Platz den Eintrag zeigt, für den er gedacht ist.
watch(
    () => [props.erzeugenAnstoss, props.karte.id] as const,
    ([anstoss, id]) => {
        if (anstoss === undefined || anstoss !== id || props.rolle !== "map_preview") return;
        emit("anstossErledigt");
        if (props.bearbeitbar && bild.value === undefined) void erzeugen();
    },
    { immediate: true },
);
watch(
    () => props.karte.id,
    () => {
        konflikt.value = undefined;
    },
);

const frischGeteilt = computed(() => {
    if (props.frisch === undefined) return undefined;
    // „Liegt jetzt unter {liste} als {titel}.“: Der Sprung steht mitten im Satz, an der Stelle von {liste}; die Wortfolge bestimmt die Sprache.
    const [davor = "", danach = ""] = t("medien.karten.platz.frisch", {
        liste: "\u0001",
        titel: props.frisch.titel,
    }).split("\u0001");
    return { davor, danach };
});
</script>

<template>
    <section class="platz" :data-testid="`medien-platz-${rolle}`">
        <h4 class="platz__kopf">
            {{ t(rolle === "map_full" ? "medien.karten.platz.kopfKarte" : "medien.karten.platz.kopfVorschau")
            }}<span v-if="versionen.length > 1" class="platz__zahl" data-testid="medien-platz-versionen-zahl">{{
                t("medien.karten.versionen", { n: versionen.length })
            }}</span>
        </h4>

        <!-- Die Versionen der Karte (WI-0287 Stufe 2): jede mit Feld und Knöpfen; zugewiesen und hochgeladen wird darunter. -->
        <ul v-if="versionen.length > 0" class="platz__versionen" data-testid="medien-platz-versionen">
            <MedienKarteVersion
                v-for="(version, stelle) in versionen"
                :key="version.assetId"
                :karte="karte"
                :bild="version"
                :stelle="stelle"
                :bearbeitbar="bearbeitbar"
                :operationen="operationen"
                @oeffne-bild="(id: string) => emit('oeffneBild', id)"
                @geaendert="versionGeaendert"
                @geloest="geloest"
            />
        </ul>
        <div v-else-if="bild" class="platz__zeile" :data-testid="`medien-platz-${rolle}-bild`">
            <span class="platz__daumen">
                <img v-if="sichtbaresBild(bild)" :src="sichtbaresBild(bild)!.url" alt="" loading="lazy" />
            </span>
            <span class="platz__text">
                <span class="platz__l1">
                    <AvmKreis :fuellung="kreisDerVerwendung(bild)" :name="kreisName(kreisDerVerwendung(bild))" />
                    <span class="platz__name">{{ bild.title ?? bildRolle(bild) }}</span>
                </span>
                <span class="platz__l2" :data-testid="`medien-platz-${rolle}-satz`">{{ freigabeSatz }}</span>
                <span v-if="erzeugtAusSatz" class="platz__l2" :data-testid="`medien-platz-${rolle}-erzeugt-aus`"
                    >{{ erzeugtAusSatz.davor
                    }}<button
                        type="button"
                        class="platz__sprung"
                        @click="emit('oeffneBild', erzeugtAusSatz.karte.assetId)"
                    >
                        {{ erzeugtAusSatz.karte.title ?? t("medien.karten.vorschau.karte") }}</button
                    >{{ erzeugtAusSatz.danach }}</span
                >
            </span>
        </div>
        <div v-else class="platz__leer" :data-testid="`medien-platz-${rolle}-leer`">
            <span class="platz__daumen platz__daumen--leer" aria-hidden="true"></span>
            <span class="platz__text">
                <span class="platz__l2">{{ leerSatz }}</span>
                <!-- Die Links der Karte stehen hier zum Lesen; bearbeitet werden sie im Kasten „Fundstellen“ (Knopf unten). -->
                <template v-if="rolle === 'map_full'">
                    <FensterVerweis v-for="verweis in karte.links" :key="verweis.url" :ziel="verweis.url">{{
                        verweis.label
                    }}</FensterVerweis>
                </template>
            </span>
        </div>

        <div v-if="!sucheOffen && !konflikt && versionen.length > 0 && bearbeitbar" class="platz__knoepfe">
            <AvmKnopf groesse="zeile" :testid="`medien-platz-${rolle}-zuweisen`" @click="oeffneSuche">
                <template #zeichen>⇄</template>
                {{ t("medien.karten.version.weitereZuweisen") }}
            </AvmKnopf>
            <AvmKnopf groesse="zeile" :testid="`medien-platz-${rolle}-hochladen`" @click="emit('hochladen')">
                <template #zeichen>↥</template>
                {{ t("medien.karten.version.weitereHochladen") }}
            </AvmKnopf>
        </div>
        <div v-else-if="!sucheOffen && !konflikt && versionen.length === 0" class="platz__knoepfe">
            <AvmKnopf
                v-if="bild"
                groesse="zeile"
                :testid="`medien-platz-${rolle}-oeffnen`"
                @click="emit('oeffneBild', bild.assetId)"
                >{{ t("medien.karten.bild.oeffnen") }}</AvmKnopf
            >
            <template v-if="bearbeitbar">
                <AvmKnopf
                    v-if="bild"
                    groesse="zeile"
                    :gesperrt="laeuft ? t('medien.bearbeiten.sendet') : undefined"
                    :testid="`medien-platz-${rolle}-aendern`"
                    @click="oeffneSuche"
                >
                    <template #zeichen>⇄</template>
                    {{ t("medien.karten.platz.aendern") }}
                </AvmKnopf>
                <AvmKnopf
                    v-if="bild"
                    groesse="zeile"
                    :gesperrt="laeuft ? t('medien.bearbeiten.sendet') : undefined"
                    :testid="`medien-platz-${rolle}-loesen`"
                    @click="loesen"
                >
                    <template #zeichen>—</template>
                    {{ t("medien.karten.platz.loesen") }}
                </AvmKnopf>
                <template v-else>
                    <!-- „Vorschau erzeugen“ (WI-0287 Punkt 5): die Hauptaktion im leeren Platz der Vorschau, nur mit Karte; der Grund einer Sperre steht darunter. -->
                    <AvmKnopf
                        v-if="quelle"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="sperrSatz ?? (laeuft || sucht ? t('medien.bearbeiten.sendet') : undefined)"
                        :grund-bei="sperrSatz === undefined ? undefined : satzId"
                        :testid="`medien-platz-${rolle}-erzeugen`"
                        @click="erzeugen"
                    >
                        <template #zeichen>✚</template>
                        {{ t("medien.karten.vorschau.erzeugen") }}
                    </AvmKnopf>
                    <AvmKnopf groesse="zeile" :testid="`medien-platz-${rolle}-zuweisen`" @click="oeffneSuche">
                        <template #zeichen>⇄</template>
                        {{ t("medien.karten.platz.zuweisen") }}
                    </AvmKnopf>
                    <AvmKnopf groesse="zeile" :testid="`medien-platz-${rolle}-hochladen`" @click="emit('hochladen')">
                        <template #zeichen>↥</template>
                        {{ t("medien.karten.platz.hochladen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="rolle === 'map_full'"
                        groesse="zeile"
                        :testid="`medien-platz-${rolle}-links`"
                        @click="emit('links')"
                    >
                        <template #zeichen>{{ karte.links.length > 0 ? "⊙" : "✚" }}</template>
                        {{
                            t(
                                karte.links.length > 0
                                    ? "medien.karten.links.bearbeiten"
                                    : "medien.karten.links.eintragen",
                            )
                        }}
                    </AvmKnopf>
                </template>
            </template>
        </div>

        <p
            v-if="quelle && bearbeitbar && !bild && !sucheOffen && !konflikt"
            :id="satzId"
            class="platz__frisch"
            :data-testid="`medien-platz-${rolle}-erzeugen-satz`"
        >
            {{ erzeugenText }}
        </p>
        <p v-if="sage" class="platz__frisch" role="status" :data-testid="`medien-platz-${rolle}-geloest`">{{ sage }}</p>
        <p v-if="frischGeteilt" class="platz__frisch" :data-testid="`medien-platz-${rolle}-frisch`">
            {{ frischGeteilt.davor
            }}<button type="button" class="platz__sprung" @click="emit('zurListe', frisch!.assetId)">
                {{ listenName }}</button
            >{{ frischGeteilt.danach }}
        </p>
        <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" :testid="`medien-platz-${rolle}-fehler`">{{
            fehler
        }}</AvmHinweis>

        <div v-if="sucheOffen" class="platz__panel" :data-testid="`medien-platz-${rolle}-suche`">
            <AvmEingabe
                v-model="q"
                :placeholder="
                    t(rolle === 'map_full' ? 'medien.karten.platz.suchKarte' : 'medien.karten.platz.suchVorschau')
                "
                :aria-label="
                    t(rolle === 'map_full' ? 'medien.karten.platz.suchKarte' : 'medien.karten.platz.suchVorschau')
                "
                :testid="`medien-platz-${rolle}-suchfeld`"
            />
            <ul class="platz__treffer">
                <li v-for="werk in treffer" :key="werk.id">
                    <button
                        type="button"
                        class="platz__treffer-zeile"
                        :disabled="laeuft"
                        :data-testid="`medien-platz-${rolle}-treffer`"
                        @click="zuweisen(werk)"
                    >
                        <span class="platz__daumen platz__daumen--klein">
                            <img
                                v-if="werk.preview ?? werk.privatePreview"
                                :src="(werk.preview ?? werk.privatePreview)!.url"
                                alt=""
                                loading="lazy"
                            />
                        </span>
                        <span class="platz__text">
                            <span class="platz__name einzeilig">{{ werk.title ?? bildRolle({ role: rolle }) }}</span>
                            <span class="platz__l2">{{
                                t("medien.karten.platz.treffer", {
                                    grundlage: werk.rightsBasis === null ? "—" : rechtsgrundName(werk.rightsBasis),
                                    n: werk.usageCount,
                                })
                            }}</span>
                        </span>
                    </button>
                </li>
                <li v-if="!laedt && !trefferFehler && treffer.length === 0" class="platz__l2 platz__nichts">
                    {{ t("medien.karten.platz.nichtsGefunden") }}
                </li>
                <li v-if="trefferFehler" class="platz__l2 platz__nichts">{{ t("medien.fehler.sonst") }}</li>
            </ul>
            <div class="platz__knoepfe">
                <AvmKnopf groesse="zeile" :testid="`medien-platz-${rolle}-stattdessen`" @click="stattdessenHochladen">
                    <template #zeichen>↥</template>
                    {{ t("medien.karten.platz.stattdessenHochladen") }}
                </AvmKnopf>
                <AvmKnopf groesse="zeile" :testid="`medien-platz-${rolle}-abbrechen`" @click="schliesseSuche">{{
                    t("medien.bearbeiten.abbrechen")
                }}</AvmKnopf>
            </div>
        </div>

        <!-- Der Namenskonflikt beim Erzeugen (Entwurf `platzPanel`, Zweig Konflikt): das vorhandene nehmen oder unter einem anderen Namen erzeugen. -->
        <div v-if="konflikt" class="platz__panel" :data-testid="`medien-platz-${rolle}-konflikt`">
            <AvmHinweis ton="warnung" rolle="status">
                <span class="platz__konflikt">
                    <span class="platz__daumen platz__daumen--klein">
                        <img
                            v-if="konflikt.anderes.preview ?? konflikt.anderes.privatePreview"
                            :src="(konflikt.anderes.preview ?? konflikt.anderes.privatePreview)!.url"
                            alt=""
                            loading="lazy"
                        />
                    </span>
                    <span>{{ konfliktText }}</span>
                </span>
            </AvmHinweis>
            <AvmEingabe
                v-model="neuerName"
                :placeholder="t('medien.karten.vorschau.andererName')"
                :aria-label="t('medien.karten.vorschau.andererName')"
                :testid="`medien-platz-${rolle}-konflikt-name`"
            />
            <div class="platz__knoepfe">
                <AvmKnopf
                    groesse="zeile"
                    :gesperrt="laeuft ? t('medien.bearbeiten.sendet') : undefined"
                    :testid="`medien-platz-${rolle}-konflikt-verwenden`"
                    @click="vorhandeneVerwenden"
                >
                    <template #zeichen>⇄</template>
                    {{ t("medien.karten.vorschau.vorhandeneVerwenden") }}
                </AvmKnopf>
                <AvmKnopf
                    art="gefuellt"
                    groesse="zeile"
                    :gesperrt="laeuft ? t('medien.bearbeiten.sendet') : undefined"
                    :testid="`medien-platz-${rolle}-konflikt-erzeugen`"
                    @click="unterNamenErzeugen"
                >
                    <template #zeichen>✚</template>
                    {{ t("medien.karten.vorschau.unterNamen") }}
                </AvmKnopf>
                <AvmKnopf
                    groesse="zeile"
                    :testid="`medien-platz-${rolle}-konflikt-abbrechen`"
                    @click="konflikt = undefined"
                    >{{ t("medien.bearbeiten.abbrechen") }}</AvmKnopf
                >
            </div>
        </div>
    </section>
</template>

<style scoped>
.platz {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

.platz__kopf {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* „4 Versionen“ hinter „Die Karte“ (Entwurf `platz__zahl`): leise, ohne Versalien. */
.platz__zahl {
    margin-left: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: normal;
    text-transform: none;
}

.platz__versionen {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}

.platz__zeile,
.platz__leer {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

.platz__leer {
    align-items: flex-start;
}

.platz__daumen {
    flex: none;
    width: 72px;
    height: 54px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.platz__daumen img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.platz__daumen--leer {
    box-sizing: border-box;
    border: 1px dashed var(--color-border-strong);
    background: transparent;
}

.platz__daumen--klein {
    width: 44px;
    height: 33px;
}

.platz__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.platz__l1 {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.platz__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.platz__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.platz__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.platz__frisch {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.platz__sprung {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: color 120ms ease;
}

.platz__sprung:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.platz__sprung:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.platz__panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.platz__treffer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 232px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
    scrollbar-width: thin;
}

.platz__treffer-zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    width: 100%;
    min-width: 0;
    padding: var(--space-2) var(--space-4);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.platz__treffer-zeile:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.platz__treffer-zeile:active:not(:disabled) {
    background: var(--color-active-wash);
}

.platz__treffer-zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.platz__treffer-zeile:disabled {
    opacity: 0.6;
    cursor: default;
}

.platz__nichts {
    padding: var(--space-4);
}

/* Der Konflikt: das vorhandene Bild klein vor dem Satz (Entwurf `platz__konflikt`). */
.platz__konflikt {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

@media (prefers-reduced-motion: reduce) {
    .platz__sprung,
    .platz__treffer-zeile {
        transition: none;
    }
}
</style>
