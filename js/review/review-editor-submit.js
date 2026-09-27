async function handleLocationEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const payload = attachActiveReviewReportContext(buildLocationEditPayload(formElement));
	if (pendingCrossingConversionPublicId && pendingCrossingConversionPublicId === payload.public_id && !payload.name) {
		payload.name = pendingCrossingConversionName || payload.name;
	}
	const duplicateLocation = findDuplicateLocationByName(payload.name, {
		excludePublicId: payload.public_id || "",
		allowCurrentName: locationEditMarkerEntry?.location?.name || locationEditMarkerEntry?.name || "",
	});
	if (duplicateLocation) {
		// 💣 BEIDE SEITEN LEHNEN AB, und beide muessen den Verweis tragen. Diese Pruefung meldet VOR
		// dem Server (sie sagt ihn exakt vorher, siehe normalizeServerDuplicateLocationName); truege
		// nur der Serverpfad die Kennung, haette derselbe Dialog den Knopf mal und mal nicht -- und
		// das ist schlechter als gar keiner. Hier ist die Kennung ohnehin da: der Eintrag wurde ja
		// gerade gefunden.
		setLocationEditStatusWithBlockingLocation(
			duplicateLocationNameMessage(duplicateLocation.name),
			{ publicId: duplicateLocation.publicId || "", name: duplicateLocation.name }
		);
		return;
	}
	setLocationEditStatus("Ort wird gespeichert...", "pending");
	setLocationEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		const responseFeature = pendingCrossingConversionPublicId === payload.public_id
			? { ...result.feature, name: result.feature?.name || payload.name }
			: result.feature;
		let savedMarkerEntry = locationEditMarkerEntry;
		if (locationEditMarkerEntry) {
			applyFeatureResponseToMarker(locationEditMarkerEntry, responseFeature);
			if (pendingCrossingConversionPublicId === payload.public_id) {
				ensureLocationNameLabel(locationEditMarkerEntry);
				syncLocationNameLabelVisibility();
			}
		} else {
			savedMarkerEntry = addCreatedLocationMarker(responseFeature);
		}
		// Auto-connect the place to its wiki settlement so a save attaches the {{Infobox Siedlung}} data
		// without a manual "Zuweisen". Two paths, in order:
		//  1) By wiki_url (e.g. inherited from a community report): runs when the URL resolves to a
		//     settlement title DIFFERENT from the one currently connected -- a brand-new place OR a
		//     corrected URL on an already-connected one (owner: a changed source must be taken over).
		//     Stays off when the URL already matches; a manual "Verbindung entfernen" clears the wiki_url
		//     field (removeSettlementWiki) so an unrelated later save does not silently re-attach it.
		//  2) By NAME (owner): community reports usually carry only a book source, no wiki link -> path 1
		//     never fires. When a place is freshly created with NO wiki_url and NOTHING connected yet but
		//     its name matches a wiki settlement exactly, connect via the name. The server only matches a
		//     page titled exactly like the place (no fuzzy match), so "Wengenholm 2" stays unconnected.
		// A failed URL attempt is surfaced (not silent) so the editor knows to assign manually; a failed
		// name attempt stays quiet (most places have no same-named wiki page -- that is not an error).
		const connectedWikiTitle = savedMarkerEntry && savedMarkerEntry.location && savedMarkerEntry.location.wikiSettlement
			? String(savedMarkerEntry.location.wikiSettlement.title || "")
			: "";
		const desiredWikiTitle = typeof settlementWikiTitleFromUrl === "function"
			? settlementWikiTitleFromUrl(payload.wiki_url)
			: "";
		const connectPublicId = savedMarkerEntry?.publicId || savedMarkerEntry?.location?.publicId || responseFeature?.public_id || "";
		if (desiredWikiTitle && desiredWikiTitle !== connectedWikiTitle && connectPublicId
			&& typeof autoConnectSettlementWikiByUrl === "function") {
			const connected = await autoConnectSettlementWikiByUrl(connectPublicId, payload.wiki_url, savedMarkerEntry);
			if (!connected) {
				showFeedbackToast?.(`Wiki-Siedlung „${desiredWikiTitle}" konnte nicht automatisch verbunden werden – bitte manuell „Zuweisen".`, "warning");
			}
		} else if (!desiredWikiTitle && !connectedWikiTitle && payload.action === "create_point" && payload.name && connectPublicId
			&& typeof autoConnectSettlementWikiByTitle === "function") {
			await autoConnectSettlementWikiByTitle(connectPublicId, payload.name, savedMarkerEntry);
		}
		// 🔴 Die gemeldeten Quellen werden NICHT mehr still beim Speichern verknuepft (03.09.2026): sie stehen
		// in der Eingabezeile des Quellenkastens (Warteschlange), und der Editor speichert jede selbst. Bei einem
		// neuen Ort landen sie damit im Anlege-Puffer darunter -- demselben Weg wie von Hand eingetragene.
		// Bug #41: sources the editor named while CREATING this place were buffered locally, because
		// there was no public_id yet to attach them to. Now there is one -- replay them through the
		// same add path the community-report sources above use. The place is already saved at this
		// point, so a failure must be said out loud rather than swallowing the source.
		if (connectPublicId && locationEditPendingSourceStore && locationEditPendingSourceStore.count() > 0
			&& typeof linkCommunityReportSource === "function") {
			let linkedAnyPending = false;
			let failedPendingCount = 0;
			for (const suggestion of locationEditPendingSourceStore.toSuggestions()) {
				const linked = await linkCommunityReportSource(connectPublicId, suggestion);
				linkedAnyPending = linkedAnyPending || linked;
				if (!linked) {
					failedPendingCount += 1;
				}
			}
			if (linkedAnyPending && savedMarkerEntry && typeof refreshLocationMarkerPopup === "function") {
				refreshLocationMarkerPopup(savedMarkerEntry);
			}
			if (failedPendingCount > 0) {
				showFeedbackToast?.(
					failedPendingCount === 1
						? "Ort wurde angelegt, aber eine Quelle konnte nicht übernommen werden – bitte im Ort nachtragen."
						: `Ort wurde angelegt, aber ${failedPendingCount} Quellen konnten nicht übernommen werden – bitte im Ort nachtragen.`,
					"warning"
				);
			}
		}
		locationEditPendingSourceStore = null;
		activeReviewReportSourceQueue = [];
		// Change report proposed a new position -> apply it via move_point (update_point does not carry position).
		if (pendingChangeReportMove && payload.action === "update_point" && typeof saveMovedLocationMarker === "function") {
			const changeMove = pendingChangeReportMove;
			pendingChangeReportMove = null;
			await saveMovedLocationMarker(changeMove.markerEntry, changeMove.latlng);
		}
		if ((payload.action === "create_point" || payload.action === "update_point") && activeReviewReportId) {
			await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "location_reports");
			activeReviewReportId = null;
			activeReviewReportSource = null;
			clearReviewReportMarker();
			await loadReviewReports();
		}
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		pendingCrossingConversionPublicId = null;
		pendingCrossingConversionName = "";
		pendingCrossingConversionIsNodix = false;
		setLocationEditSubmitPending(false);
		setLocationEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Ort gespeichert.", "success");
		if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
			void refreshActiveWikiSyncPanelAfterAssignment();
		}
	} catch (error) {
		console.error("Ort konnte nicht gespeichert werden:", error);
		// Die zweite Haelfte des Riegels oben: hat der SERVER die Dublette gefunden (weil jemand
		// anders den Namen inzwischen vergeben hat oder der Client die Zeile nicht kennt -- z. B. eine
		// Kreuzung), kommt die Kennung in `error.duplicateLocation` mit. Bei jedem anderen Fehler ist
		// sie undefined, und setDialogStatusWithBlockingLocation baut dann keinen Knopf.
		setLocationEditStatusWithBlockingLocation(
			error.message || "Ort konnte nicht gespeichert werden.",
			error.duplicateLocation
		);
	} finally {
		setLocationEditSubmitPending(false);
	}
}

async function handlePathEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity() || !pathEditFeature) {
		return;
	}

	// Entwurf 2026-09-14 §3.5: die ganze Strasse speichert ueber die Weg-Ebene, nicht ueber den Abschnitt.
	if (typeof pathEditGruppe !== "undefined" && pathEditGruppe) {
		await handlePathGroupEditSubmit();
		return;
	}

	const payload = buildPathEditPayload(formElement);
	const isAutoNameEnabled = formElement.querySelector("#path-edit-autoname")?.checked === true;
	setPathEditStatus("Weg wird gespeichert...", "pending");
	setPathEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		applyPathFeatureResponse(pathEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		rememberPathEditSettingsFromPayload(payload, { autoname: isAutoNameEnabled });
		setPathEditSubmitPending(false);
		setPathEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Weg gespeichert.", "success");
	} catch (error) {
		console.error("Weg konnte nicht gespeichert werden:", error);
		setPathEditStatus(error.message || "Weg konnte nicht gespeichert werden.", "error");
	} finally {
		setPathEditSubmitPending(false);
	}
}

async function handlePathGroupEditSubmit() {
	const gruppe = pathEditGruppe;
	const rumpf = wpGroupRumpf(gruppe.stand, readPathGruppeEntwurf(), gruppe.pfade.map((pfad) => getPathPublicId(pfad)));
	if (!rumpf) {
		// 🔴 Nachtrag 15.09.2026: „Nichts geändert." landete nur in der Statuszeile des Dialogs, und die
		// liegt unterhalb des sichtbaren Fensterbereichs (gemessen: top 917 bei innerHeight 900) -- der
		// Editor sieht bei "Speichern für N Abschnitte" keine Reaktion, obwohl Wiki-Zuweisung und Quellen
		// im Kasten daneben ohnehin schon sofort geschrieben haben. Der Knopf wirkt dann tot. Jetzt schliesst
		// der Dialog wie nach einem erfolgreichen Speichern (kein Serveraufruf noetig) und sagt es per Toast.
		setPathEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Nichts zu speichern — Wiki-Zuweisungen und Quellen wirken sofort.", "success");
		return;
	}
	// Nachtrag 15.09.2026 §9.5: was der Kasten „Wiki-Weg" per Sync ins Formular geholt hat, reist mit -- der Server liest
	// `wiki_uebernommen` im Sammel-Speichern seit jeher (avesmapsUpdatePathGroupDetails), wpGroupRumpf schickte es nie.
	const uebernommen = typeof getPathWikiUebernommenPayload === "function" ? getPathWikiUebernommenPayload() : [];
	if (uebernommen.length) {
		rumpf.wiki_uebernommen = uebernommen;
	}
	setPathEditStatus(`Wird für ${gruppe.pfade.length} Abschnitte gespeichert …`, "pending");
	setPathEditSubmitPending(true);
	try {
		const result = await submitMapFeatureEdit(rumpf);
		// 💣 KEIN Revisions-Update aus der Antwort: die Antwort traegt keine Features. Hoebe sie den lokalen Stand
		// an, faende der Live-Abgleich danach „nichts Neues", und die Karte zeigte die alten Abschnitte.
		// ⚠️ Laeuft gerade ein Abgleich, kehrt dieser Aufruf sofort zurueck; der naechste Takt (15 s) holt es nach.
		await pollLiveMapUpdates();
		void loadChangeLog();
		setPathEditSubmitPending(false);
		setPathEditDialogOpen(false, { resetForm: true });
		showFeedbackToast(Number(result.written) === 0
			? "Nichts zu ändern — die Abschnitte standen schon so."
			: `${result.written} von ${gruppe.pfade.length} Abschnitten gespeichert.`, "success");
	} catch (error) {
		console.error("Weg konnte nicht gespeichert werden:", error);
		setPathEditStatus(error.message || "Weg konnte nicht gespeichert werden.", "error");
	} finally {
		setPathEditSubmitPending(false);
	}
}

async function handlePowerlineEditFormSubmit(event) {
	event.preventDefault();
	const formElement = getPowerlineEditFormElement();
	if (!formElement || !powerlineEditFeature) {
		return;
	}

	const payload = buildPowerlineEditPayload(formElement);
	if (!payload.public_id || !payload.name) {
		setPowerlineEditStatus("Ein Name für die Kraftlinie fehlt.", "error");
		return;
	}

	setPowerlineEditSubmitPending(true);
	setPowerlineEditStatus("Kraftlinie wird gespeichert...", "pending");
	try {
		const result = await submitMapFeatureEdit(payload);
		applyPowerlineFeatureResponse(powerlineEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditSubmitPending(false);
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie gespeichert.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht gespeichert werden:", error);
		setPowerlineEditStatus(error.message || "Kraftlinie konnte nicht gespeichert werden.", "error");
	} finally {
		setPowerlineEditSubmitPending(false);
	}
}

/**
 * Warum eine Beschriftung nicht gespeichert werden kann -- in Worten, fuer die gemeinsame Statuszeile.
 * ⚠️ `reportValidity()` zeigt seine Blase nur an einem SICHTBAREN Feld; steht das ungueltige in einem
 * anderen Reiter, bliebe es sonst beim wortlosen Nichts.
 */
function avesmapsBeschriftungUngueltigText(formElement) {
	const feld = Array.from(formElement?.elements || []).find((element) => element
		&& element.willValidate && typeof element.checkValidity === "function" && !element.checkValidity());
	if (!feld) {
		return "Bitte die Eingaben prüfen.";
	}
	const beschriftung = String(feld.closest?.("label")?.querySelector?.("span")?.textContent
		|| feld.getAttribute?.("aria-label") || "").trim();
	return (beschriftung ? beschriftung + ": " : "") + String(feld.validationMessage || "ungültiger Wert");
}

/**
 * Im Verbund die Darstellung der neuen Art mitnehmen -- nur für Werte, die niemand angefasst hat.
 *
 * 🔴 DIE REGEL GAB ES SCHON (renameLinkedEcosystemLabel): folgt der Subtyp der Art der Region und
 * WECHSELT er dabei, kommt die Darstellung dieser Art mit (Größe, Ab-Zoom); ein blosses Umbenennen
 * setzt keine Handarbeit zurück. Im Verbund schreibt seit dem 27.09.2026 die Beschriftungs-Hälfte
 * ihre offene Beschriftung selbst -- die Regel muss also auch HIER gelten, sonst behielte ein Wald,
 * der zur Steppe wird, die Größe des Waldes.
 * ⚠️ Nur, wo der Wert im Formular noch der gespeicherte ist: was der Editor im selben Speichern von Hand
 * gestellt hat, gewinnt.
 */
function avesmapsBeschriftungDarstellungZurArt(payload, label) {
	if (!payload || payload.action !== "update_label" || !label || typeof ecosystemLabelStyleFor !== "function") {
		return payload;
	}
	const neu = String(payload.feature_subtype || "");
	if (neu === "" || neu === String(label.labelType || "")) {
		return payload;
	}
	const stil = ecosystemLabelStyleFor(neu);
	if (!stil) {
		return payload;
	}
	if (Number(payload.size) === (Number(label.size) || 18)) {
		payload.size = stil.size;
	}
	if (Number(payload.min_zoom) === Number(label.minZoom ?? 0)) {
		payload.min_zoom = stil.minZoom;
	}
	return payload;
}

/**
 * Das Speichern einer Beschriftung als VORBEREITETER AUFTRAG (27.09.2026) -- das Gegenstück zu
 * `speicherAuftrag` der Fläche (map-features-ecosystem-properties.js).
 *
 * 🔴 `avesmapsBeschriftungSpeicherAuftrag` liest und prüft SYNCHRON, `ausfuehren` schreibt,
 * `abschliessen` schliesst. Der Ablauf des vereinigten Fensters (avesmapsLandschaftDialogSpeichern)
 * bereitet beide Hälften vor, schreibt die Fläche, DANN diese -- und schliesst erst, wenn beides steht.
 * Bis dahin liefen die zwei gleichzeitig: diese Hälfte war meist zuerst fertig, schloss das Fenster und
 * leerte den gemeinsamen Kopf, während die Fläche ihn noch las, und beide schrieben dieselbe
 * Beschriftung mit derselben Revision (der Zweite bekam 409).
 *
 * 🔴 IM VERBUND KEIN RÜCKWEG ZUR REGION: `ecosystemPushLabelChangesToRegion` schreibt Name, Art und
 * Kurvenbeschriftung an die Fläche -- genau das hat die Flächen-Hälfte im selben Ablauf gerade aus
 * demselben Kopf geschrieben. Ein zweiter Schreiber derselben Region wäre das Rennen, das dieser Umbau
 * beseitigt. Ohne Fläche im Fenster (freie Beschriftung, oder ihre Fläche liegt in einer anderen Ebene)
 * bleibt er, wie er war.
 *
 * @param {{formElement: HTMLFormElement, verbund?: boolean}} optionen
 */
function avesmapsBeschriftungSpeicherAuftrag(optionen) {
	const o = optionen || {};
	const formElement = o.formElement instanceof HTMLFormElement ? o.formElement : null;
	const verbund = Boolean(o.verbund);
	if (!formElement) {
		return { fehler: "Das Formular der Beschriftung fehlt." };
	}
	if (!formElement.reportValidity()) {
		return { fehler: avesmapsBeschriftungUngueltigText(formElement) };
	}

	const payload = attachActiveReviewReportContext(buildLabelEditPayload(formElement));
	// 💣 Der Eintrag des KLICKS, nicht der von später: öffnet jemand während des Speicherns eine andere
	// Beschriftung, bekäme sonst sie die Antwort dieses Objekts.
	const editedLabelEntry = labelEditEntry;
	if (verbund) {
		avesmapsBeschriftungDarstellungZurArt(payload, editedLabelEntry?.label);
	}
	const shouldStartMoveAfterSave = pendingLabelMoveAfterEditEntry === editedLabelEntry;
	let savedLabelEntry = editedLabelEntry;

	return {
		name: String(payload.text || ""),
		ausfuehren: async () => {
			pendingLabelMoveAfterEditEntry = null;
			setLabelEditStatus("Label wird gespeichert...", "pending");
			const result = await submitMapFeatureEdit(payload);
			if (editedLabelEntry) {
				applyLabelFeatureResponse(editedLabelEntry, result.feature);
			} else {
				savedLabelEntry = addCreatedLabelFeature(result.feature);
			}
			// 🔴 Die Live-Vorschau der Darstellung entwaffnen: ab hier gilt die Antwort des Servers. Ohne
			// das nähme das Schliessen des Dialogs gleich darauf die eben gespeicherten Werte wieder zurück
			// -- die Rücknahme hängt bewusst an JEDEM Schliessweg (siehe review-labels.js).
			if (typeof commitLabelDisplayPreview === "function") {
				commitLabelDisplayPreview();
			}
			updateRevisionFromEditResponse(result);
			// 🔴 DIE MITGEZOGENEN GESCHWISTER (15.09.2026): hängt dieses Label an einer Fläche und hat sein
			// Speichern die Wiki-Landschaft geändert, schreibt der Server den Artikel an die REGION, und die
			// übrigen Beschriftungen der Fläche folgen (api/_internal/app/landschaft-wiki.php). Sie kommen als
			// `labels` zurück und gehen SOFORT auf die Karte -- derselbe Leser wie bei der Antwort von update_region.
			if (Array.isArray(result?.labels) && result.labels.length > 0 && typeof applyLabelFeaturesLocally === "function") {
				applyLabelFeaturesLocally(result.labels);
			}
			// 🔴 Die Rückrichtung (Owner 2026-07-28): gehört dieses Label zu einer Landschaftsfläche, bekommt
			// die Fläche Name, Art und Wiki-Zuweisung mit -- und ihre übrigen Labels gleich hinterher. Ohne
			// das trug ein umbenanntes Label seinen neuen Namen allein, und das nächste Speichern im
			// Flächendialog machte ihn wieder rückgängig: die Arbeit war weg, ohne Fehlermeldung.
			//
			// 🪤 NACH applyLabelFeatureResponse, damit der gespeicherte Stand weitergereicht wird und nicht
			// der, mit dem der Dialog aufging. Und nur beim ÄNDERN: ein frisch angelegtes Label hat noch
			// keine Fläche, an die es etwas zurückzugeben hätte.
			// 💣 UND NICHT IM VERBUND -- die Fläche hat es im selben Ablauf gerade geschrieben (Kopf oben).
			if (!verbund && payload.action === "update_label" && savedLabelEntry?.label
				&& typeof ecosystemPushLabelChangesToRegion === "function") {
				void ecosystemPushLabelChangesToRegion(savedLabelEntry.label, {
					// 🔴 Ob die Zuweisung in DIESEM Speichern angefasst wurde, weiss nur der Rumpf: der
					// Schlüssel steht genau dann drin (buildLabelEditPayload). Aus dem gespeicherten Stand
					// lässt sich das nicht mehr ablesen -- „kein Nest" sieht nach dem Entfernen genauso aus
					// wie „nie eines gehabt".
					wikiGeaendert: Object.prototype.hasOwnProperty.call(payload, "wiki_region"),
				});
			}
			void loadChangeLog();
			if (payload.action === "create_label" && activeReviewReportId) {
				await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "map_reports");
				activeReviewReportId = null;
				activeReviewReportSource = null;
				clearReviewReportMarker();
				await loadReviewReports();
			}
			return { savedLabelEntry };
		},
		abschliessen: async ({ leise = false } = {}) => {
			// ⚠️ Nur das EIGENE Formular schliessen: wer während des Speicherns mit Escape zugemacht und
			// schon die nächste Beschriftung geöffnet hat, dessen Fenster gehört ihm (dieselbe Regel wie
			// beim `abschliessen` der Fläche). Ein Neuaufbau setzt `labelEditEntry` um.
			if (labelEditEntry === editedLabelEntry) {
				setLabelEditDialogOpen(false, { resetForm: true });
			}
			if (shouldStartMoveAfterSave && savedLabelEntry) {
				setLabelMoveActive(savedLabelEntry, true);
			}
			if (!leise) {
				showFeedbackToast("Label gespeichert.", "success");
			}
			if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
				void refreshActiveWikiSyncPanelAfterAssignment();
			}
		},
		fehlgeschlagen: (error) => {
			console.error("Label konnte nicht gespeichert werden:", error);
			setLabelEditStatus(error?.message || "Label konnte nicht gespeichert werden.", "error");
		},
	};
}

/**
 * Der submit-Zuhörer der Beschriftung.
 *
 * 🔴 IM VEREINIGTEN FENSTER GIBT ER AB -- an den EINEN Ablauf, der beide Hälften nacheinander speichert
 * (avesmapsLandschaftDialogSpeichern). Das gilt auch für Enter im Namensfeld: das gehört per `form=`
 * diesem Formular, und bis zum 27.09.2026 speicherte Enter dort NUR die Beschriftung -- eine offene
 * Wiki-Zuweisung der Fläche ging mit dem Schliessen verloren.
 * ⚠️ Ohne das Fenster (ein Test mit nur diesem Modul) speichert die Beschriftung allein, wie bisher.
 */
async function handleLabelEditFormSubmit(event) {
	event.preventDefault();
	if (typeof avesmapsLandschaftDialogUebernimmtSpeichern === "function"
		&& avesmapsLandschaftDialogUebernimmtSpeichern()
		&& typeof avesmapsLandschaftDialogSpeichern === "function") {
		return avesmapsLandschaftDialogSpeichern();
	}
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	const auftrag = avesmapsBeschriftungSpeicherAuftrag({ formElement, verbund: false });
	if (auftrag.fehler) {
		return undefined;
	}
	try {
		await auftrag.ausfuehren();
	} catch (error) {
		auftrag.fehlgeschlagen(error);
		return undefined;
	}
	return auftrag.abschliessen({ leise: false });
}
