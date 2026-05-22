/******************************************************************
 * PriorityQueue (Min-Heap) - Optimierung fuer den Dijkstra-Algorithmus
 ******************************************************************/
class PriorityQueue {
	constructor() {
		this.heap = [];
	}

	enqueue(item, priority) {
		const node = { item, priority };
		this.heap.push(node);
		this._bubbleUp();
	}

	_bubbleUp() {
		let idx = this.heap.length - 1;
		const node = this.heap[idx];
		while (idx > 0) {
			const parentIdx = Math.floor((idx - 1) / 2);
			if (this.heap[parentIdx].priority <= node.priority) break;
			this.heap[idx] = this.heap[parentIdx];
			idx = parentIdx;
		}
		this.heap[idx] = node;
	}

	dequeue() {
		if (this.isEmpty()) return null;
		const min = this.heap[0];
		const lastNode = this.heap.pop();
		if (this.heap.length > 0) {
			this.heap[0] = lastNode;
			this._sinkDown(0);
		}
		return min;
	}

	_sinkDown(idx) {
		const length = this.heap.length;
		const node = this.heap[idx];
		while (true) {
			const leftIdx = 2 * idx + 1,
				rightIdx = 2 * idx + 2;
			let swapIdx = null;
			if (leftIdx < length && this.heap[leftIdx].priority < node.priority) {
				swapIdx = leftIdx;
			}
			if (
				rightIdx < length &&
				((swapIdx === null && this.heap[rightIdx].priority < node.priority) || (swapIdx !== null && this.heap[rightIdx].priority < this.heap[leftIdx].priority))
			) {
				swapIdx = rightIdx;
			}
			if (swapIdx === null) break;
			this.heap[idx] = this.heap[swapIdx];
			idx = swapIdx;
		}
		this.heap[idx] = node;
	}

	isEmpty() {
		return this.heap.length === 0;
	}
}

(function initializeRegionVertexDetachEditing() {
	const REGION_EDIT_VERTEX_DETACH_HIT_TOLERANCE_PX = 14;

	function getRegionVertexDetachHandleId(index) {
		return `outer:${index}`;
	}

	function createRegionDetachHandleIcon(detachPreview = false) {
		const dotAttributes = detachPreview
			? ' style="background:#f0c05a;border-color:#7a5200;box-shadow:0 0 0 3px rgba(240, 192, 90, 0.34);"'
			: "";

		return L.divIcon({
			className: `path-edit-handle-marker region-edit-handle-marker${detachPreview ? " region-edit-handle-marker--detach-preview" : ""}`,
			html: `<span class="path-edit-handle-marker__dot"${dotAttributes}></span>`,
			iconSize: [18, 18],
			iconAnchor: [9, 9],
		});
	}

	function setRegionDetachedVertexHandle(handle, isDetachPreview) {
		if (!handle || handle._regionDetachPreview === isDetachPreview) {
			return;
		}

		handle._regionDetachPreview = isDetachPreview;
		handle.setIcon(createRegionDetachHandleIcon(isDetachPreview));
	}

	function clearRegionEditVertexDetachPreview() {
		if (!activeRegionGeometryEdit?.vertexDetachHandle) {
			return;
		}

		setRegionDetachedVertexHandle(activeRegionGeometryEdit.vertexDetachHandle, false);
		activeRegionGeometryEdit.vertexDetachHandle = null;
		activeRegionGeometryEdit.vertexDetachHandleId = null;
	}

	function findNearestRegionEditHandle(latLng) {
		if (!activeRegionGeometryEdit || !latLng) {
			return null;
		}

		const targetPoint = map.latLngToContainerPoint(latLng);
		let nearest = null;
		activeRegionGeometryEdit.handles.forEach((handle) => {
			const distance = targetPoint.distanceTo(map.latLngToContainerPoint(handle.getLatLng()));
			if (distance <= REGION_EDIT_VERTEX_DETACH_HIT_TOLERANCE_PX && (!nearest || distance < nearest.distance)) {
				nearest = { handle, distance };
			}
		});

		return nearest?.handle || null;
	}

	function updateRegionEditVertexDetachPreviewFromLatLng(latLng) {
		const handle = findNearestRegionEditHandle(latLng);
		if (!handle) {
			clearRegionEditVertexDetachPreview();
			return false;
		}

		if (activeRegionGeometryEdit.vertexDetachHandle && activeRegionGeometryEdit.vertexDetachHandle !== handle) {
			setRegionDetachedVertexHandle(activeRegionGeometryEdit.vertexDetachHandle, false);
		}

		activeRegionGeometryEdit.vertexDetachHandle = handle;
		activeRegionGeometryEdit.vertexDetachHandleId = handle._regionVertexHandleId || null;
		setRegionDetachedVertexHandle(handle, true);
		clearRegionEditEdgeHover();
		return true;
	}

	function shouldDetachRegionVertexDrag(handle) {
		return Boolean(
			activeRegionGeometryEdit
			&& handle
			&& activeRegionGeometryEdit.vertexDetachHandleId
			&& activeRegionGeometryEdit.vertexDetachHandleId === handle._regionVertexHandleId
		);
	}

	window.createRegionHandleIcon = function createRegionHandleIcon() {
		return createRegionDetachHandleIcon(false);
	};

	window.clearRegionGeometryEdit = function clearRegionGeometryEdit() {
		if (!activeRegionGeometryEdit) return;

		clearRegionEditVertexDetachPreview();
		clearRegionEditEdgeHover();
		disableRegionEditEdgeControls();

		if (activeRegionGeometryEdit.regionEntry.source !== "political_territory") {
			void releaseFeatureSoftLock(activeRegionGeometryEdit.regionEntry.publicId);
		}

		activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
		activeRegionGeometryEdit = null;
	};

	window.refreshRegionEditHandles = function refreshRegionEditHandles() {
		if (!activeRegionGeometryEdit) return;
		activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
		activeRegionGeometryEdit.handles = [];
		activeRegionGeometryEdit.vertexDetachHandle = null;
		activeRegionGeometryEdit.vertexDetachHandleId = null;

		getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry).forEach((latLng, index) => {
			const originalLatLng = L.latLng(latLng);
			const handle = L.marker(latLng, {
				icon: createRegionDetachHandleIcon(false),
				pane: "measurementHandlesPane",
				draggable: true,
				keyboard: false,
				bubblingMouseEvents: false,
			}).addTo(map);
			handle._regionVertexHandleId = getRegionVertexDetachHandleId(index);
			handle._regionDetachPreview = false;
			handle._regionDetachDrag = false;

			handle.on("dragstart", () => {
				handle._regionDetachDrag = shouldDetachRegionVertexDrag(handle);
				clearRegionEditVertexDetachPreview();
				clearRegionEditEdgeHover();
			});

			handle.on("drag", (event) => {
				const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
				latLngs[index] = event.target.getLatLng();
				setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
				updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
				clearRegionEditEdgeHover();
			});

			handle.on("dragend", (event) => {
				const shouldDetachVertex = Boolean(event.target._regionDetachDrag);
				event.target._regionDetachDrag = false;

				const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
				const targetLatLng = shouldDetachVertex
					? event.target.getLatLng()
					: findNearestRegionSnapPoint(event.target.getLatLng(), activeRegionGeometryEdit.regionEntry) || event.target.getLatLng();
				latLngs[index] = targetLatLng;
				setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
				const affectedRegions = shouldDetachVertex
					? []
					: applySharedBoundaryVertexMove(activeRegionGeometryEdit.regionEntry, originalLatLng, targetLatLng);
				updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
				refreshRegionEditHandles();
				void saveRegionGeometry(activeRegionGeometryEdit.regionEntry);
				affectedRegions.forEach((region) => {
					void saveRegionGeometry(region);
				});
			});

			handle.on("dblclick", (event) => {
				L.DomEvent.stop(event);
				L.DomEvent.preventDefault(event);
				deleteRegionNode(index);
			});

			const element = handle.getElement?.();
			if (element) {
				L.DomEvent.disableClickPropagation(element);
				L.DomEvent.disableScrollPropagation(element);
				element.addEventListener("dblclick", (event) => {
					event.preventDefault();
					event.stopPropagation();
					deleteRegionNode(index);
				});
			}

			activeRegionGeometryEdit.handles.push(handle);
		});
	};

	window.handleRegionEditMouseMove = function handleRegionEditMouseMove(event) {
		if (!activeRegionGeometryEdit || !event?.originalEvent?.ctrlKey) {
			clearRegionEditVertexDetachPreview();
			clearRegionEditEdgeHover();
			return;
		}

		if (updateRegionEditVertexDetachPreviewFromLatLng(event.latlng)) {
			return;
		}

		clearRegionEditVertexDetachPreview();
		updateRegionEditEdgeHoverFromLatLng(event.latlng);
	};

	window.handleRegionEditMouseOut = function handleRegionEditMouseOut() {
		clearRegionEditVertexDetachPreview();
		clearRegionEditEdgeHover();
	};

	window.handleRegionEditKeyUp = function handleRegionEditKeyUp(event) {
		if (event.key === "Control") {
			clearRegionEditVertexDetachPreview();
			clearRegionEditEdgeHover();
		}
	};

	window.handleRegionEditClick = function handleRegionEditClick(event) {
		if (!activeRegionGeometryEdit || !event?.originalEvent?.ctrlKey) {
			return;
		}

		if (event.latlng && updateRegionEditVertexDetachPreviewFromLatLng(event.latlng)) {
			L.DomEvent.stop(event.originalEvent);
			L.DomEvent.preventDefault(event.originalEvent);
			return;
		}

		if (!activeRegionGeometryEdit.edgeHover && event.latlng) {
			updateRegionEditEdgeHoverFromLatLng(event.latlng);
		}

		if (!activeRegionGeometryEdit.edgeHover) {
			return;
		}

		L.DomEvent.stop(event.originalEvent);
		L.DomEvent.preventDefault(event.originalEvent);

		subdivideRegionEditHoveredEdge(4);
	};
})();
