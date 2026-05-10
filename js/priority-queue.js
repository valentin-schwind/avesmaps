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
