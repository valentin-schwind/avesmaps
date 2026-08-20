/*
 * Landschaften: Reihenfolge und Sperren — die Bedienung (19.08.2026).
 *
 * Entwurf: docs/superpowers/specs/2026-08-19-landschaften-reihenfolge-und-sperren-design.md
 *
 * Hier stecken die drei Wege zu denselben ZWEI Karteneigenschaften einer Region:
 *   - das Untermenü „Reihenfolge und Sperren ▸" im Flächenmenü,
 *   - der Zähler in der Landschaften-Leiste,
 *   - das Fenster mit Suche und Liste.
 * Der vierte Weg — der Haken „Für Klicks gesperrt" — sitzt im Eigenschaften-Dialog und geht über
 * dessen eigene Speicherleiste (map-features-ecosystem-properties.js); er hat hier nichts zu suchen,
 * weil „Abbrechen" dort sonst für einen der beiden Werte wirkungslos wäre.
 *
 * 🔴 „REGION", NICHT „FLÄCHE". Die Nachbarn im Menü heissen „Fläche löschen", „Fläche malen" -- die
 * treffen EINE Teilfläche. Diese Verben treffen alles, was zur Region gehört, auch ihre weiteren
 * Teilflächen und Multipolygone (Owner: „genau alles was ich anklick wird gesperrt. auch multipolys
 * oder mehrere zusammenhängenden flächen einer region"). Der Unterschied gehört ins Wort.
 *
 * 🔴 „VORN"/„HINTEN" HEISST IMMER *GANZ* -- im Menü wie im Fenster. Eine Stufe im einen und „ganz"
 * im anderen wären zwei Bedeutungen für dasselbe Wort; jede Ordnung lässt sich durch wiederholtes
 * Nach-vorn-Holen herstellen.
 *
 * 💣 DIE BEWEGUNG RECHNET DER SERVER (`set_region_stack`). Der Browser kennt nur die Flächen seines
 * BILDAUSSCHNITTS -- der Loader lädt nach bbox. Ein hier gerechnetes „höchster Rang + 10" schöbe die
 * Region hinter jede, die gerade nicht geladen ist, und zwei gleichzeitig drückende Editoren bekämen
 * denselben Rang.
 */
(function initEcosystemStapel() {
	"use strict";

	const GRUPPE = "stapel";
	const AKTION_VORN = "stapel-vorn";
	const AKTION_HINTEN = "stapel-hinten";
	const AKTION_SPERRE = "stapel-sperre";
	const AKTION_FENSTER = "stapel-fenster";

	// Die drei BEARBEITBAREN Ebenen. Klimazonen fehlen mit Absicht: die Ebene wird abgeleitet, nicht
	// gezeichnet (avesmapsClimateAssertNotDerived), und ihre Bänder decken die Karte in voller Breite.
	const EBENEN = [
		{ kind: "derographisch", label: "Derographie" },
		{ kind: "vegetation", label: "Vegetation" },
		{ kind: "topographie", label: "Topographie" },
	];

	let fensterEbene = "";
	let fensterRegionen = [];
	let laeuft = false;

	function tr_(key, deutsch) {
		return typeof tr === "function" ? tr(key, deutsch) : deutsch;
	}

	function sag(text, ton) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(text, ton);
		}
	}

	function darfBedienen() {
		return typeof canOperateEcosystemLayers === "function" && canOperateEcosystemLayers();
	}

	// ---- Zugriff auf den geladenen Bestand ----------------------------------------------------------

	function flaechenDerRegion(regionPublicId) {
		const treffer = [];
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return treffer;
		}
		ecosystemLayers.forEach((layer) => {
			if (layer?._ecosystemArea?.region_public_id === regionPublicId) {
				treffer.push(layer);
			}
		});

		return treffer;
	}

	function flaecheZuId(publicId) {
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return null;
		}

		return ecosystemLayers.get(String(publicId || ""))?._ecosystemArea || null;
	}

	// Wie viele Regionen dieser Ebene sind gesperrt? Gezählt über die REGIONEN, nicht die Flächen --
	// eine Region mit sieben Flächen ist eine Sperre, nicht sieben.
	//
	// ⚠️ Gezählt wird im geladenen Bestand. Eine gesperrte Region ausserhalb des Bildausschnitts fehlt
	// in der Zahl; der Zähler ist ein Hinweis („hier ist etwas gesperrt"), keine Bilanz. Die
	// vollständige Liste holt das Fenster beim Öffnen vom Server.
	function gesperrteRegionen(kind) {
		const gesehen = new Set();
		if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
			return gesehen;
		}
		ecosystemLayers.forEach((layer) => {
			const area = layer?._ecosystemArea;
			if (area && area.is_locked === true && (!kind || String(area.kind) === String(kind))) {
				gesehen.add(String(area.region_public_id || ""));
			}
		});

		return gesehen;
	}

	// ---- Schreiben ----------------------------------------------------------------------------------

	// Den geladenen Bestand nachziehen, damit die Karte sofort stimmt statt erst nach dem Nachladen.
	function merkeAmBestand(regionPublicId, felder) {
		flaechenDerRegion(regionPublicId).forEach((layer) => {
			Object.assign(layer._ecosystemArea, felder);
		});
	}

	async function schiebe(regionPublicId, position) {
		if (laeuft || !regionPublicId) {
			return;
		}
		laeuft = true;
		try {
			const ergebnis = await postEcosystemEdit("set_region_stack", {
				public_id: regionPublicId,
				position,
			});
			merkeAmBestand(regionPublicId, { stack_order: Number(ergebnis?.stack_order) || 0 });
			if (typeof applyEcosystemStackingOrder === "function") {
				applyEcosystemStackingOrder();
			}
			sag(position === "front"
				? tr_("ecosystem.stapel.movedFront", "Region liegt jetzt ganz vorn.")
				: tr_("ecosystem.stapel.movedBack", "Region liegt jetzt ganz hinten."));
		} catch (fehler) {
			sag(fehler?.message || tr_("ecosystem.stapel.moveFailed", "Die Reihenfolge liess sich nicht ändern."), "warning");
		} finally {
			laeuft = false;
		}
	}

	async function sperre(regionPublicId, gesperrt) {
		if (laeuft || !regionPublicId) {
			return;
		}
		laeuft = true;
		try {
			await postEcosystemEdit("update_region", { public_id: regionPublicId, is_locked: gesperrt });
			merkeAmBestand(regionPublicId, { is_locked: gesperrt === true });
			zeichneZaehler();
			sag(gesperrt
				? tr_("ecosystem.stapel.locked", "Region gesperrt — Klicks gehen jetzt hindurch.")
				: tr_("ecosystem.stapel.unlocked", "Region entsperrt."));
		} catch (fehler) {
			sag(fehler?.message || tr_("ecosystem.stapel.lockFailed", "Die Sperre liess sich nicht ändern."), "warning");
		} finally {
			laeuft = false;
		}
	}

	// ---- Das Untermenü im Flächenmenü ---------------------------------------------------------------

	function regionAusMenue(publicId) {
		const area = flaecheZuId(publicId);
		return area ? String(area.region_public_id || "") : "";
	}

	function registriereMenue() {
		const menu = window.AvesmapsEcosystemAreaMenu;
		if (!menu?.addEntry) {
			return;
		}

		menu.addEntry({
			action: AKTION_VORN,
			label: tr_("ecosystem.ctxmenu.stapelFront", "Region in den Vordergrund"),
			group: GRUPPE,
			onClick: (publicId) => void schiebe(regionAusMenue(publicId), "front"),
		});
		menu.addEntry({
			action: AKTION_HINTEN,
			label: tr_("ecosystem.ctxmenu.stapelBack", "Region in den Hintergrund"),
			group: GRUPPE,
			onClick: (publicId) => void schiebe(regionAusMenue(publicId), "back"),
		});
		menu.addEntry({
			action: AKTION_SPERRE,
			label: tr_("ecosystem.ctxmenu.stapelLock", "Region sperren"),
			group: GRUPPE,
			onClick: (publicId) => {
				const area = flaecheZuId(publicId);
				void sperre(String(area?.region_public_id || ""), area?.is_locked !== true);
			},
			// 🔴 EIN Eintrag mit zwei Wörtern. Welches gilt, hängt an der angeklickten Fläche, also
			// wird es beim Öffnen gesetzt und nicht beim Registrieren.
			//
			// ⚠️ Eine gesperrte Region lässt sich normalerweise nicht mehr rechtsklicken — das IST
			// der Sinn. „Region entsperren" sieht man deshalb nur, wenn eine andere Fläche darüber
			// liegt und den Rechtsklick weiterreicht. Der gewöhnliche Weg zurück ist das Fenster,
			// und genau dafür gibt es das Fenster.
			refresh: (knopf, publicId) => {
				knopf.textContent = flaecheZuId(publicId)?.is_locked === true
					? tr_("ecosystem.ctxmenu.stapelUnlock", "Region entsperren")
					: tr_("ecosystem.ctxmenu.stapelLock", "Region sperren");
			},
		});
		menu.addEntry({
			action: AKTION_FENSTER,
			label: tr_("ecosystem.ctxmenu.stapelWindow", "Alle Regionen …"),
			group: GRUPPE,
			onClick: (publicId) => {
				const area = flaecheZuId(publicId);
				void oeffneFenster(String(area?.kind || ""));
			},
		});
	}

	// ---- Der Zähler in der Leiste -------------------------------------------------------------------

	function zaehlerKnopf() {
		return document.getElementById("ecosystem-stapel-open");
	}

	function zeichneZaehler() {
		const knopf = zaehlerKnopf();
		if (!knopf) {
			return;
		}
		if (!darfBedienen()) {
			knopf.hidden = true;
			return;
		}
		const kind = typeof getActiveEcosystemLayerKind === "function" ? getActiveEcosystemLayerKind() : "";
		const anzahl = gesperrteRegionen(kind).size;
		knopf.hidden = false;
		// Bei 0 unauffällig: ein Zähler, der immer leuchtet, sagt nichts mehr.
		knopf.classList.toggle("ecosystem-stapel-open--aktiv", anzahl > 0);
		knopf.textContent = anzahl > 0 ? `🔒 ${anzahl}` : "🔒";
		knopf.title = anzahl > 0
			? `${anzahl} ${anzahl === 1 ? "gesperrte Region" : "gesperrte Regionen"} — Reihenfolge und Sperren öffnen`
			: tr_("ecosystem.stapel.openAria", "Reihenfolge und Sperren");
	}

	// ---- Das Fenster --------------------------------------------------------------------------------

	const el = (id) => document.getElementById(id);

	function schliesseFenster() {
		const overlay = el("ecosystem-stapel-overlay");
		if (overlay) {
			overlay.hidden = true;
		}
	}

	async function oeffneFenster(kind) {
		const overlay = el("ecosystem-stapel-overlay");
		if (!overlay || !darfBedienen()) {
			return;
		}
		const gewaehlt = EBENEN.some((eintrag) => eintrag.kind === kind)
			? kind
			: (typeof getActiveEcosystemLayerKind === "function" && EBENEN.some((e) => e.kind === getActiveEcosystemLayerKind())
				? getActiveEcosystemLayerKind()
				: "vegetation");
		overlay.hidden = false;
		zeichneEbenenKnoepfe();
		await ladeEbene(gewaehlt);
		el("ecosystem-stapel-filter")?.focus();
	}

	function zeichneEbenenKnoepfe() {
		const behaelter = el("ecosystem-stapel-kinds");
		if (!behaelter || behaelter.childElementCount > 0) {
			return;
		}
		EBENEN.forEach((eintrag) => {
			const knopf = document.createElement("button");
			knopf.type = "button";
			knopf.className = "ecosystem-stapel__kind";
			knopf.dataset.stapelKind = eintrag.kind;
			knopf.textContent = tr_(`ecosystem.kind.${eintrag.kind}`, eintrag.label);
			knopf.addEventListener("click", () => void ladeEbene(eintrag.kind));
			behaelter.appendChild(knopf);
		});
	}

	function markiereEbene() {
		el("ecosystem-stapel-kinds")?.querySelectorAll("[data-stapel-kind]").forEach((knopf) => {
			knopf.classList.toggle("ecosystem-stapel__kind--aktiv", knopf.dataset.stapelKind === fensterEbene);
		});
	}

	async function ladeEbene(kind) {
		fensterEbene = String(kind || "");
		markiereEbene();
		const liste = el("ecosystem-stapel-list");
		const fehler = el("ecosystem-stapel-error");
		if (fehler) {
			fehler.hidden = true;
		}
		if (liste) {
			liste.textContent = tr_("ecosystem.stapel.loading", "Wird geladen …");
		}
		try {
			const ergebnis = await postEcosystemEdit("list_regions", { kind: fensterEbene });
			// 🔴 Der Server liefert die Liste bereits in Stapelreihenfolge (stack_order DESC) -- oben
			// liegt vorn. Hier wird NICHT nachsortiert: zwei Sortierungen für dieselbe Liste laufen
			// beim nächsten Umbau auseinander.
			fensterRegionen = Array.isArray(ergebnis?.regions) ? ergebnis.regions : [];
			zeichneListe();
		} catch (ausnahme) {
			fensterRegionen = [];
			if (liste) {
				liste.textContent = "";
			}
			if (fehler) {
				fehler.hidden = false;
				fehler.textContent = ausnahme?.message || tr_("ecosystem.stapel.loadFailed", "Die Regionen liessen sich nicht laden.");
			}
		}
	}

	function sichtbareRegionen() {
		const suche = String(el("ecosystem-stapel-filter")?.value || "").trim().toLowerCase();
		if (suche === "") {
			return fensterRegionen;
		}

		return fensterRegionen.filter((region) => String(region?.name || "").toLowerCase().includes(suche));
	}

	function zeichneListe() {
		const liste = el("ecosystem-stapel-list");
		if (!liste) {
			return;
		}
		liste.textContent = "";
		const sichtbar = sichtbareRegionen();
		if (sichtbar.length === 0) {
			const leer = document.createElement("p");
			leer.className = "ecosystem-import-dialog__empty";
			leer.textContent = fensterRegionen.length === 0
				? tr_("ecosystem.stapel.emptyLayer", "Diese Ebene hat noch keine Region.")
				: tr_("ecosystem.stapel.emptyFilter", "Keine Region passt zu dieser Suche.");
			liste.appendChild(leer);
			zeichneBilanz(0);
			return;
		}

		sichtbar.forEach((region, index) => {
			liste.appendChild(baueZeile(region, index + 1));
		});
		zeichneBilanz(sichtbar.length);
	}

	function baueZeile(region, platz) {
		const zeile = document.createElement("div");
		zeile.className = "ecosystem-stapel__row";
		if (region.is_locked === true) {
			zeile.classList.add("ecosystem-stapel__row--gesperrt");
		}

		const nummer = document.createElement("span");
		nummer.className = "ecosystem-stapel__pos";
		nummer.textContent = String(platz);
		zeile.appendChild(nummer);

		const name = document.createElement("span");
		name.className = "ecosystem-stapel__name";
		name.textContent = region.name || tr_("ecosystem.stapel.unnamed", "(ohne Namen)");
		if (region.is_locked === true) {
			const marke = document.createElement("span");
			marke.className = "ecosystem-stapel__mark";
			marke.textContent = tr_("ecosystem.stapel.lockedMark", "gesperrt");
			name.appendChild(marke);
		}
		zeile.appendChild(name);

		const werkzeuge = document.createElement("span");
		werkzeuge.className = "ecosystem-stapel__tools";
		// ⚠️ Zeilenhandlungen sind NIE die Haupthandlung der Seite (AGENTS.md §12): weich/outline,
		// niemals gefüllt. Bei 777 Regionen multipliziert sich ein Akzentknopf mit der Zeilenzahl --
		// genau der Fehler, der 2026-08-07 in den WikiSync-Listen zurückgebaut wurde.
		werkzeuge.appendChild(baueWerkzeug("⤒", tr_("ecosystem.stapel.toFront", "ganz nach vorn"), async () => {
			await schiebe(region.public_id, "front");
			await ladeEbene(fensterEbene);
		}));
		werkzeuge.appendChild(baueWerkzeug("⤓", tr_("ecosystem.stapel.toBack", "ganz nach hinten"), async () => {
			await schiebe(region.public_id, "back");
			await ladeEbene(fensterEbene);
		}));
		const schloss = baueWerkzeug(
			region.is_locked === true ? "🔒" : "🔓",
			region.is_locked === true
				? tr_("ecosystem.stapel.unlock", "entsperren")
				: tr_("ecosystem.stapel.lock", "sperren"),
			async () => {
				await sperre(region.public_id, region.is_locked !== true);
				await ladeEbene(fensterEbene);
			}
		);
		if (region.is_locked === true) {
			schloss.classList.add("ecosystem-stapel__tool--zu");
		}
		werkzeuge.appendChild(schloss);
		zeile.appendChild(werkzeuge);

		const meta = document.createElement("span");
		meta.className = "ecosystem-stapel__meta";
		const teile = [];
		if (region.region_type) {
			teile.push(String(region.region_type));
		}
		const anzahl = Number(region.area_count) || 0;
		teile.push(anzahl === 1 ? "1 Fläche" : `${anzahl} Flächen`);
		meta.textContent = teile.join(" · ");
		zeile.appendChild(meta);

		return zeile;
	}

	function baueWerkzeug(zeichen, titel, aufKlick) {
		const knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = "ecosystem-stapel__tool";
		knopf.textContent = zeichen;
		knopf.title = titel;
		knopf.setAttribute("aria-label", titel);
		knopf.addEventListener("click", () => void aufKlick());

		return knopf;
	}

	// Die Bilanzzeile trägt nur, was der Filter bewegt (Vorbild js/review/review-list-balance.js).
	function zeichneBilanz(sichtbar) {
		const zeile = el("ecosystem-stapel-balance");
		if (!zeile) {
			return;
		}
		const gesamt = fensterRegionen.length;
		const gesperrt = fensterRegionen.filter((region) => region.is_locked === true).length;
		const teile = [];
		teile.push(sichtbar === gesamt
			? `${gesamt} ${gesamt === 1 ? "Region" : "Regionen"}`
			: `${sichtbar} von ${gesamt} Regionen`);
		if (gesperrt > 0) {
			teile.push(`${gesperrt} gesperrt`);
		}
		zeile.textContent = `${teile.join(" · ")}   ·   oben = vorn`;
	}

	// ---- Verdrahtung --------------------------------------------------------------------------------

	function verdrahte() {
		registriereMenue();

		el("ecosystem-stapel-close")?.addEventListener("click", schliesseFenster);
		el("ecosystem-stapel-done")?.addEventListener("click", schliesseFenster);
		el("ecosystem-stapel-filter")?.addEventListener("input", zeichneListe);
		el("ecosystem-stapel-open")?.addEventListener("click", () => void oeffneFenster(""));
		el("ecosystem-stapel-overlay")?.addEventListener("click", (event) => {
			if (event.target === el("ecosystem-stapel-overlay")) {
				schliesseFenster();
			}
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && el("ecosystem-stapel-overlay")?.hidden === false) {
				schliesseFenster();
			}
		});

		zeichneZaehler();
	}

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", verdrahte, { once: true });
		} else {
			verdrahte();
		}
	}

	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemStapel = {
			oeffne: oeffneFenster,
			zeichneZaehler,
			// Der Eigenschaften-Dialog meldet hierher, wenn sein Haken gespeichert wurde -- damit der
			// Zähler stimmt, ohne dass dieser Datei ein zweiter Schreibweg gehört.
			merkeSperre: (regionPublicId, gesperrt) => {
				merkeAmBestand(regionPublicId, { is_locked: gesperrt === true });
				zeichneZaehler();
			},
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { EBENEN };
	}
})();
