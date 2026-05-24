function scheduleLabelCollisionResolution() {
	if (labelCollisionFrameId !== null) {
		return;
	}

	labelCollisionFrameId = window.requestAnimationFrame(() => {
		labelCollisionFrameId = null;
		resolveLabelCollisions();
	});
}

function rectanglesOverlap(firstRect, secondRect) {
	return firstRect.left < secondRect.right
		&& firstRect.right > secondRect.left
		&& firstRect.top < secondRect.bottom
		&& firstRect.bottom > secondRect.top;
}

function expandRect(rect, padding) {
	return {
		left: rect.left - padding,
		right: rect.right + padding,
		top: rect.top - padding,
		bottom: rect.bottom + padding,
		width: rect.width + padding * 2,
		height: rect.height + padding * 2,
	};
}

function getLocationNameLabelPriority(entry) {
	const priorities = {
		metropole: 100,
		grossstadt: 90,
		stadt: 80,
		kleinstadt: 70,
		dorf: 60,
		gebaeude: 60,
	};
	return priorities[entry.markerEntry?.locationType] || 50;
}

function getLabelOffsetCandidates() {
	return [
		[0, 0],
		[8, 0],
		[-8, 0],
		[0, -8],
		[0, 8],
		[12, -6],
		[-12, -6],
		[12, 6],
		[-12, 6],
	];
}

function setLabelElementOffset(element, offsetX, offsetY) {
	element.style.setProperty("--label-offset-x", `${offsetX}px`);
	element.style.setProperty("--label-offset-y", `${offsetY}px`);
}

function getLocationNameLabelBaseOffset(element) {
	const labelElement = element.querySelector("span");
	const style = labelElement ? window.getComputedStyle(labelElement) : null;
	return {
		x: parseFloat(style?.getPropertyValue("--location-label-offset-x")) || LOCATION_LABEL_GAP,
		y: parseFloat(style?.getPropertyValue("--location-label-offset-y")) || 0,
	};
}

function getLocationNameLabelOffsets(element, labelRect) {
	const baseOffset = getLocationNameLabelBaseOffset(element);
	const labelWidth = labelRect.width;
	const labelHeight = labelRect.height;
	const scaledGap = Math.max(LOCATION_LABEL_GAP, Math.abs(baseOffset.x));
	const smallShift = LOCATION_LABEL_SHIFT_SMALL;
	const verticalCenterOffset = -labelHeight / 2;

	return [
		{ name: "right", dx: baseOffset.x, dy: baseOffset.y },
		{ name: "right-up", dx: baseOffset.x, dy: baseOffset.y - smallShift },
		{ name: "right-down", dx: baseOffset.x, dy: baseOffset.y + smallShift },
		{ name: "top-right", dx: baseOffset.x, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-right", dx: baseOffset.x, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "left", dx: -labelWidth - scaledGap, dy: baseOffset.y },
		{ name: "left-up", dx: -labelWidth - scaledGap, dy: baseOffset.y - smallShift },
		{ name: "left-down", dx: -labelWidth - scaledGap, dy: baseOffset.y + smallShift },
		{ name: "top-left", dx: -labelWidth - scaledGap, dy: baseOffset.y - labelHeight - smallShift },
		{ name: "bottom-left", dx: -labelWidth - scaledGap, dy: baseOffset.y + labelHeight + smallShift },
		{ name: "top", dx: -labelWidth / 2, dy: verticalCenterOffset - labelHeight - smallShift },
		{ name: "bottom", dx: -labelWidth / 2, dy: verticalCenterOffset + labelHeight + smallShift },
	];
}

function applyLocationNameLabelOffset(element, candidate) {
	const baseOffset = getLocationNameLabelBaseOffset(element);
	setLabelElementOffset(element, candidate.dx - baseOffset.x, candidate.dy - baseOffset.y);
}

function getLabelCollisionTarget(element) {
	return element.classList.contains("location-name-label")
		? element.querySelector("span") || element
		: element;
}

function measureLabelRect(element) {
	return getLabelCollisionTarget(element).getBoundingClientRect();
}

function measureLabelCollisionRect(element) {
	const rect = measureLabelRect(element);
	if (rect.width <= 0 || rect.height <= 0) {
		return rect;
	}

	return expandRect(rect, LOCATION_LABEL_COLLISION_PADDING);
}

function getCollisionEntries() {
	const freeLabelEntries = labelMarkers
		.filter((entry) => map.hasLayer(entry.marker))
		.map((entry) => ({
			element: entry.marker.getElement(),
			priority: (Number(entry.label.priority) || 3) * 20 - 5,
			minZoom: Number(entry.label.minZoom) || 0,
		}));
	const locationLabelEntries = locationNameLabels
		.filter((entry) => map.hasLayer(entry.marker))
		.map((entry) => ({
			element: entry.marker.getElement(),
			priority: getLocationNameLabelPriority(entry),
			minZoom: LOCATION_NAME_LABEL_CONFIG[entry.markerEntry?.locationType]?.minZoom || 0,
		}));

	return [...locationLabelEntries, ...freeLabelEntries].filter(({ element }) => element);
}

function resolveLabelCollisions() {
	const visibleEntries = getCollisionEntries();
	const offsetCandidates = getLabelOffsetCandidates();

	visibleEntries.forEach(({ element }) => {
		element.classList.remove("is-colliding");
		setLabelElementOffset(element, 0, 0);
	});

	const acceptedRects = [];
	visibleEntries
		.sort((left, right) => {
			const priorityDiff = right.priority - left.priority;
			return priorityDiff || left.minZoom - right.minZoom;
		})
		.forEach(({ element }) => {
			const locationLabelRect = element.classList.contains("location-name-label")
				? measureLabelRect(element)
				: null;
			const candidates = locationLabelRect
				? getLocationNameLabelOffsets(element, locationLabelRect)
				: offsetCandidates.map(([offsetX, offsetY]) => ({ dx: offsetX, dy: offsetY }));

			for (const candidate of candidates) {
				if (locationLabelRect) {
					applyLocationNameLabelOffset(element, candidate);
				} else {
					setLabelElementOffset(element, candidate.dx, candidate.dy);
				}
				const rect = measureLabelCollisionRect(element);
				if (rect.width <= 0 || rect.height <= 0) {
					return;
				}

				if (!acceptedRects.some((acceptedRect) => rectanglesOverlap(rect, acceptedRect))) {
					acceptedRects.push(rect);
					return;
				}
			}

			element.classList.add("is-colliding");
		});
}

