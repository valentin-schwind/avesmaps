// Landschaften — die RÜCKRICHTUNG: was am Label geändert wird, erreicht seine Fläche.
//
// 🔴 WARUM ES DAS GIBT. Die Vorwärtsrichtung gab es seit V6: der Flächendialog trägt Name, Art, Nodix
// und Wiki-Landschaft an seine Labels (renameLinkedEcosystemLabel + applyRegionToLabels in
// map-features-ecosystem-properties.js). Die Gegenrichtung gab es NICHT --
// handleLabelEditFormSubmit schrieb ausschliesslich die map_features-Zeile.
//
// Das war nicht bloss eine fehlende Bequemlichkeit, sondern VERLIEREND: wer ein Label umbenannte, hatte
// danach zwei Namen für dieselbe Landschaft, und das nächste Speichern im Flächendialog überschrieb den
// Label-Namen wieder mit dem alten. Die Arbeit war weg, ohne dass irgendwo etwas fehlgeschlagen wäre.
//
// 🔴 DIESELBEN WÄCHTER WIE ABWÄRTS, nur spiegelverkehrt:
//   * nur bei echter Änderung -- ein blosses Öffnen und Speichern schreibt nichts;
//   * die Wiki-Zuweisung wandert NUR, wenn sie in DIESEM Speichern angefasst wurde (`wikiGeaendert`,
//     seit 03.09.2026) -- dann aber in beide Richtungen: zugewiesen/gewechselt an die Fläche,
//     entfernt auch von ihr (leere Adresse = Rücknahme; der Server nimmt daraufhin den
//     Geschwister-Beschriftungen ihre Kopie). Unangefasst sagt das Label über die Fläche NICHTS --
//     die Lücke „Label hat, Fläche nicht" heilt der Server abwärts bei jedem Speichern der Fläche;
//     hier hochzuheilen war der Weg, auf dem eine gerade entfernte Zuweisung zurückkam
//     („Lawaralîr"/„Cronwald", Owner 03.09.2026: das vereinigte Fenster schickt beide Formulare ab);
//   * Grösse, Drehung, Zoom-Band und Priorität reisen NIE mit. Sie gehören dem einzelnen Label -- ein
//     zweites Label existiert gerade deshalb, weil es anders stehen soll.
//
// 💣 EINE ART, DIE DIE EBENE NICHT KENNT, WIRD NICHT GESCHICKT. `avesmapsEcosystemAssertRegionType`
// prüft serverseitig, dass `wald` nur an einer Vegetationsregion landet, und antwortet sonst mit 400.
// Ein Label kann eine ebenenfremde Art tragen (Altbestand, oder die Region hat die Ebene gewechselt --
// der Label-Dialog zeigt sie als „(fremde Art)"). Die ungeprüft weiterzureichen hiesse: ein Label
// speichern, das gespeichert IST, und danach eine Fehlermeldung sehen.

// Der Schreib-Auftrag an die Region, oder null wenn es nichts zu tun gibt.
//
// @param label        das gespeicherte Label ({ text, labelType, wikiRegion })
// @param region       die Regionszeile aus list_regions ({ public_id, name, region_type, wiki_url })
// @param allowedTypes das Art-Vokabular DIESER Ebene ([{ type_key }]), oder null wenn unbekannt
// @param optionen     { wikiGeaendert: true }, wenn die Zuweisung in diesem Speichern angefasst wurde
function ecosystemRegionWriteBackPayload(label, region, allowedTypes, optionen) {
	const publicId = String(region?.public_id || "");
	if (publicId === "") {
		return null;                             // Label ohne Fläche -- es gibt keine Gegenseite
	}

	const payload = { public_id: publicId };
	let changed = false;

	// --- Name ---------------------------------------------------------------------------------------
	// Ein leerer Labeltext kann nicht gemeint sein (das Formular verlangt ihn ohnehin), und er würde die
	// Region namenlos machen.
	const text = String(label?.text || "").trim();
	if (text !== "" && text !== String(region?.name || "").trim()) {
		payload.name = text;
		changed = true;
	}

	// --- Art ----------------------------------------------------------------------------------------
	// 🔴 Der Subtyp des Labels IST der Art-Schlüssel der Region (`wald` ist beides; der V5-Import hat die
	// beiden Vokabulare gleichgesetzt). Keine Übersetzungstabelle -- die wäre die zweite Wahrheit.
	// Einzige Ausnahme: `region` ist beim LABEL der neutrale Subtyp („keine Art"), und der heisst an der
	// Region der leere Wert. Ein Label ohne Subtyp hätte keinen Stil und bliebe ungezeichnet, deshalb
	// gibt es dort keinen leeren Wert.
	const subtype = String(label?.labelType || "");
	const artKey = subtype === "region" ? "" : subtype;
	const bekannt = artKey === ""
		|| !Array.isArray(allowedTypes)
		|| allowedTypes.some((type) => String(type?.type_key || "") === artKey);
	if (bekannt && artKey !== String(region?.region_type || "")) {
		payload.region_type = artKey;
		changed = true;
	}

	// --- Wiki-Landschaft ----------------------------------------------------------------------------
	// 🔴 Es reist die URL, NICHT der Schlüssel: wiki_region_key leitet der Server aus wiki_url ab
	// (AGENTS.md §5). Ein hier gebauter Schlüssel wäre eine zweite Ableitung und bräche jeden Join.
	// 🔴 UND NUR, WENN DIE ZUWEISUNG IN DIESEM SPEICHERN ANGEFASST WURDE (Kopf dieser Datei): dann in
	// beide Richtungen -- eine leere Adresse ist beim Server die Rücknahme, und die nimmt er auch den
	// übrigen Beschriftungen der Fläche (avesmapsEcosystemClearWikiRegionFromLabels). Ob angefasst
	// wurde, weiss nur der Speicher-Rumpf des Labels; aus dem gespeicherten Stand ist „entfernt" von
	// „nie eines gehabt" nicht zu unterscheiden.
	if (optionen?.wikiGeaendert === true) {
		const wikiUrl = String(label?.wikiRegion?.wiki_url || "").trim();
		if (wikiUrl !== String(region?.wiki_url || "").trim()) {
			payload.wiki_url = wikiUrl;
			changed = true;
		}
	}

	// --- Kurvenbeschriftung -------------------------------------------------------------------------
	// 🔴 Sie gehoert der REGION, wird aber auch im Beschriftungsdialog bedient (Entwurf §2). Sie geht
	// ueber DIESE Bruecke und nicht ueber einen eigenen Aufruf daneben: `update_region` ist ohnehin
	// der Schreibweg der Region, und ein zweiter Aufruf machte „Abbrechen“ fuer einen der beiden
	// Werte wirkungslos -- dieselbe Begruendung, mit der die Klick-Sperre im Flaechendialog auf
	// dieser Speicherleiste sitzt.
	// 💣 `null` heisst „nicht angefasst“ und schickt nichts (siehe getLabelCurvePayload).
	const kurve = typeof getLabelCurvePayload === "function" ? getLabelCurvePayload() : null;
	if (kurve) {
		payload.curve_label = kurve.curve_label;
		payload.curve_label_max = kurve.curve_label_max;
		changed = true;
	}

	return changed ? payload : null;
}

// Den Auftrag ausführen und die Geschwister nachziehen. Kein Rücklauf bei einem Fehlschlag: das Label
// IST gespeichert, und ein zurückgerollter Name wäre die schlechtere Antwort als eine Fläche, die
// hinterherhinkt -- dieselbe Haltung wie in der Gegenrichtung (renameLinkedEcosystemLabel).
// @param optionen { wikiGeaendert } -- siehe ecosystemRegionWriteBackPayload
async function ecosystemPushLabelChangesToRegion(label, optionen) {
	if (typeof ecosystemRegionOfLabel !== "function" || typeof postEcosystemEdit !== "function") {
		return;
	}
	// Die Zugehörigkeit steht in beiden Richtungen; ohne geladene Regionslisten weiss der Auflöser nur
	// die halbe Wahrheit, deshalb erst laden.
	if (typeof loadEcosystemRegions === "function" && typeof ECOSYSTEM_KINDS !== "undefined") {
		await Promise.all(ECOSYSTEM_KINDS.map((kind) => loadEcosystemRegions(kind)));
	}

	const region = ecosystemRegionOfLabel(label);
	// 🪤 Eine Region OHNE Namen ist die Notfallantwort des Auflösers ({ public_id }), wenn die Listen
	// nicht geladen sind. Dagegen zu vergleichen hiesse, jedes Feld für geändert zu halten und den
	// Steckbrief der Fläche mit den Werten des Labels zu überschreiben, ohne je gelesen zu haben, was
	// dort stand. Dann lieber nichts tun.
	if (!region || typeof region.name === "undefined") {
		return;
	}

	const vokabular = typeof ecosystemRegionTypesByKind !== "undefined" && ecosystemRegionTypesByKind
		? ecosystemRegionTypesByKind[String(region.kind || "")]
		: null;
	const payload = ecosystemRegionWriteBackPayload(label, region, vokabular || null, optionen);
	if (!payload) {
		return;
	}

	try {
		const antwort = await postEcosystemEdit("update_region", payload);
		// 🔴 Die Beschriftungen, die der Server dabei nachgezogen hat (die Geschwister dieses Labels:
		// Zuweisung geerbt oder Kopie genommen), SOFORT auf die Karte -- in der Form von `update_label`,
		// mit demselben Leser. Der Kartenpayload wird nach einem Speichern nicht neu geholt; ohne das
		// zeigte die Infobox des Geschwisters bis zum nächsten Live-Abgleich den alten Artikel.
		if (typeof applyLabelFeaturesLocally === "function") {
			applyLabelFeaturesLocally(antwort?.labels);
		}
		// Die frisch gespeicherte Kurveneinstellung SOFORT auf die Karte bringen. Der Kartenpayload
		// wird nach einem Speichern nicht neu geholt -- ohne das aendert sich am Bild nichts, und der
		// Editor haelt sein Speichern fuer wirkungslos (gemeldet 23.08.2026).
		if (payload.curve_label !== undefined && typeof avesmapsCurveSettingAufLabelsAnwenden === "function") {
			avesmapsCurveSettingAufLabelsAnwenden(
				String(region.public_id || ""),
				payload.curve_label === true,
				payload.curve_label_max
			);
		}
		// Und die ÜBRIGEN Labels derselben Fläche: seit eine Fläche mehrere tragen darf, wäre ein
		// umbenanntes Label neben zwei alten genau die Uneinigkeit, die hier verschwinden soll. Das
		// gerade gespeicherte wird ausgelassen -- es trägt die neuen Werte schon.
		if (typeof window !== "undefined" && window.AvesmapsEcosystemProperties?.applyToLabels) {
			await window.AvesmapsEcosystemProperties.applyToLabels(
				{ region_public_id: String(region.public_id || "") },
				String(label?.text || ""),
				String(label?.labelType || "region"),
				String(label?.publicId || "")
			);
		}
		// Die gemerkten Regionszeilen tragen jetzt einen alten Namen, und die geladenen Flächen ihren
		// alten `region_name` -- der Schwebezettel läse ihn sonst bis zum nächsten Nachladen falsch.
		if (typeof invalidateEcosystemRegionCache === "function") {
			invalidateEcosystemRegionCache();
		}
		if (typeof scheduleEcosystemAreaReload === "function") {
			scheduleEcosystemAreaReload({ immediate: true });
		}
	} catch (error) {
		console.warn("Die Fläche konnte die Änderung des Labels nicht übernehmen:", error);
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Label gespeichert — die Fläche trägt aber noch den alten Stand.", "warning");
		}
	}
}

// ---- die andere Hälfte: Löschen ---------------------------------------------------------------------
//
// 🔴 SIE NENNT DIE FOLGE, BEVOR SIE EINTRITT (Owner 2026-07-28). Das letzte Label einer Fläche zu
// löschen nimmt die Fläche mit -- und die Rückfrage lautete bis heute schlicht „X wirklich löschen?".
// Das ist die einzige Bremse vor einem serverseitigen Kaskadenlöschen; sie muss sagen, was mitgeht.
//
// 💣 DREI ZUSTÄNDE, NICHT ZWEI (Fälle #80/#81, Thomas 19.08.2026: „Wenn man auf Label löschen geht,
// löscht er auch zu gleich die dazugehörige Ebene"). „Kein Landschafts-Label" ist etwas anderes als
// „gehört zu einer Fläche, deren Zeile gerade nicht geladen ist": `ecosystemRegionOfLabel` liefert im
// zweiten Fall `{ public_id }` OHNE Namen, und `ecosystemRegionsByKind` hält im Normalfall nur die
// AKTIVE Ebene -- ausserhalb des Landschaftsmodus gar nichts. Beides als „nichts geht mit" zu lesen
// hiess: die einzige Bremse vor einem Kaskadenlöschen fiel genau dann weg, wenn der Editor die Ebene
// der Fläche nicht offen hatte. Dieselbe Fehlerklasse wie `null` als `false` zu lesen -- hier kostet
// sie gezeichnete Geometrie. Gewacht von __tests__/ecosystem-label-loeschen-bremse.test.js.
//
// @param labelText  der Text des Labels
// @param region     die Regionszeile ({ name, area_count }), `{ public_id }` wenn nur die
//                   Zugehörigkeit bekannt ist, oder null für ein Label ohne Fläche
// @param labelCount wie viele Labels die Region insgesamt trägt (dieses eingeschlossen)
// @param kaskade    true/false vom Server, null wenn unbekannt
function formatEcosystemLabelDeleteConfirmation(labelText, region, labelCount, kaskade) {
	const name = String(labelText || "").trim() || "Dieses Label";
	const kopf = `${name} wirklich löschen?`;
	const hatZeile = typeof region?.name !== "undefined";
	const regionId = String(region?.public_id || "").trim();
	if (!region || (!hatZeile && regionId === "")) {
		return kopf;                             // kein Landschafts-Label -- die schlichte Rückfrage
	}

	// Leer, solange nur die Kennung bekannt ist. Ein erfundener Platzhalter („Ohne Namen") stünde
	// dann als Regionsname in der Rückfrage, und der Editor suchte auf der Karte nach etwas, das so
	// nicht heisst -- die Sätze unten lassen ihn deshalb weg statt ihn zu raten.
	const regionName = hatZeile ? (String(region.name || "").trim() || "Ohne Namen") : "";
	const count = Number(labelCount) || 0;
	if (count > 1) {
		const rest = count - 1;
		const wieviele = rest === 1 ? "1 weiteres Label" : `${rest} weitere Labels`;
		return [kopf, "", regionName !== ""
			? `„${regionName}" behält ${wieviele}.`
			: `Die Fläche behält ${wieviele}.`].join("\n");
	}

	// 🔴 Ab hier geht es um das LETZTE Label. Ob die Fläche dann mitgeht, entscheidet der Server
	// (`cascade_enabled`); ist die Kaskade aus, bleibt sie unbeschriftet stehen.
	//
	// 💣 NUR ein ausdrückliches `false` beruhigt -- `null` heisst „nie gehört", und genau hier ist das
	// der Normalfall: ein Label löscht man überall, das Flag reist aber mit den Flächen, und die lädt
	// nur die Landschaftsebene.
	if (kaskade === false) {
		// 🪤 0 heisst „unbekannt", nicht „keines" -- das Label, um das es geht, zählt selbst mit.
		if (count <= 0) {
			return kopf;
		}
		return [kopf, "", regionName !== ""
			? `Das ist das LETZTE Label von „${regionName}" — die Fläche bleibt bestehen, dann ohne Namen auf der Karte.`
			: "Das ist das LETZTE Label seiner Fläche — die Fläche bleibt bestehen, dann ohne Namen auf der Karte."].join("\n");
	}

	// 🪤 Unbekannte Zahl bei eingeschalteter Kaskade: die Folge offenlassen statt sie falsch verneinen.
	if (count <= 0) {
		return [kopf, "", regionName !== ""
			? `Ist es das letzte Label von „${regionName}", verschwindet die Fläche mit.`
			: "Ist es das letzte Label seiner Landschaftsfläche, verschwinden die Region und ihre Flächen mit."].join("\n");
	}

	if (regionName === "") {
		return [kopf, "", "Das ist das LETZTE Label seiner Landschaftsfläche — die Region und ihre Flächen verschwinden mit."].join("\n");
	}

	const areas = Number(region.area_count) || 0;
	return [
		kopf,
		"",
		areas > 0
			? `Das ist das LETZTE Label von „${regionName}" — die Region und ${areas === 1 ? "ihre Fläche" : `ihre ${areas} Flächen`} verschwinden mit.`
			: `Das ist das LETZTE Label von „${regionName}" — die Region verschwindet mit.`,
	].join("\n");
}

// Wie viele Labels trägt diese Fläche? Gezählt über die geladenen Labels, denn genau die kennt der
// Client vollständig -- `labelData` hält ALLE Labels der Karte, nicht nur die im Ausschnitt (anders als
// die Flächen-Registry). Die Zugehörigkeit steht seit heute an jedem Label (der Server löst sie auf),
// der Auflöser deckt zusätzlich den Zeiger an der Region ab.
function ecosystemLabelCountOfRegion(regionPublicId) {
	const gesucht = String(regionPublicId || "");
	if (gesucht === "" || typeof labelData === "undefined" || !Array.isArray(labelData)
		|| typeof ecosystemRegionOfLabel !== "function") {
		return 0;
	}

	return labelData.filter((row) => String(ecosystemRegionOfLabel(row)?.public_id || "") === gesucht).length;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { ecosystemRegionWriteBackPayload, formatEcosystemLabelDeleteConfirmation };
}
if (typeof window !== "undefined") {
	window.ecosystemPushLabelChangesToRegion = ecosystemPushLabelChangesToRegion;
}
