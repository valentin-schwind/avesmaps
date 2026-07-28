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
//   * die Wiki-Zuweisung wandert nur, wenn das Label eine TRÄGT. Ein leeres Feld löscht die der Region
//     nicht (die Abwärtsregel hat genau dieselbe Klausel, und aus demselben Grund: sonst löschte jedes
//     Speichern die Zuweisung, die die Gegenseite von Hand gesetzt hat);
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
function ecosystemRegionWriteBackPayload(label, region, allowedTypes) {
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
	const wikiUrl = String(label?.wikiRegion?.wiki_url || "").trim();
	if (wikiUrl !== "" && wikiUrl !== String(region?.wiki_url || "").trim()) {
		payload.wiki_url = wikiUrl;
		changed = true;
	}

	return changed ? payload : null;
}

// Den Auftrag ausführen und die Geschwister nachziehen. Kein Rücklauf bei einem Fehlschlag: das Label
// IST gespeichert, und ein zurückgerollter Name wäre die schlechtere Antwort als eine Fläche, die
// hinterherhinkt -- dieselbe Haltung wie in der Gegenrichtung (renameLinkedEcosystemLabel).
async function ecosystemPushLabelChangesToRegion(label) {
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
	const payload = ecosystemRegionWriteBackPayload(label, region, vokabular || null);
	if (!payload) {
		return;
	}

	try {
		await postEcosystemEdit("update_region", payload);
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
// @param labelText  der Text des Labels
// @param region     die Regionszeile ({ name, area_count }) oder null für ein Label ohne Fläche
// @param labelCount wie viele Labels die Region insgesamt trägt (dieses eingeschlossen)
function formatEcosystemLabelDeleteConfirmation(labelText, region, labelCount, kaskade) {
	const name = String(labelText || "").trim() || "Dieses Label";
	const kopf = `${name} wirklich löschen?`;
	if (!region || typeof region.name === "undefined") {
		return kopf;                             // kein Landschafts-Label -- die schlichte Rückfrage
	}

	const regionName = String(region.name || "").trim() || "Ohne Namen";
	const count = Number(labelCount) || 0;
	if (count > 1) {
		const rest = count - 1;
		return [kopf, "", `„${regionName}" behält ${rest === 1 ? "1 weiteres Label" : `${rest} weitere Labels`}.`].join("\n");
	}

	// 🔴 Ab hier geht es um das LETZTE Label. Ob die Fläche dann mitgeht, entscheidet der Server
	// (`cascade_enabled`); ist die Kaskade aus, bleibt sie unbeschriftet stehen.
	if (!kaskade) {
		// 🪤 0 heisst „unbekannt", nicht „keines" -- das Label, um das es geht, zählt selbst mit.
		return count <= 0
			? kopf
			: [kopf, "", `Das ist das LETZTE Label von „${regionName}" — die Fläche bleibt bestehen, dann ohne Namen auf der Karte.`].join("\n");
	}

	// 🪤 Unbekannte Zahl bei eingeschalteter Kaskade: die Folge offenlassen statt sie falsch verneinen.
	if (count <= 0) {
		return [kopf, "", `Ist es das letzte Label von „${regionName}", verschwindet die Fläche mit.`].join("\n");
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
