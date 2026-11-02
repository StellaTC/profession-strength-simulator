import { Heap } from "heap-js";

class EventQueue {
    constructor() {
        this.nextSequence = 0;
        this.minHeap = new Heap((a, b) => a.time - b.time || a.sequence - b.sequence);
    }

    addEvent(event) {
        // Shared CPU/GPU clock: integer microseconds, carried as nanoseconds at the JS API.
        event.time = Math.round(event.time / 1000) * 1000;
        event.sequence = this.nextSequence++;
        this.minHeap.push(event);
    }

    getNextEvent() {
        return this.minHeap.pop();
    }

    containsEventOfType(type) {
        let heapEvents = this.minHeap.toArray();

        return heapEvents.some((event) => event.type == type);
    }

    containsEventOfTypeAndHrid(type, hrid) {
        let heapEvents = this.minHeap.toArray();
        return heapEvents.some((event) => event.type == type && event.hrid == hrid);
    }

    clear() {
        this.nextSequence = 0;
        this.minHeap = new Heap((a, b) => a.time - b.time || a.sequence - b.sequence);
    }

    clearEventsForUnit(unit) {
        this.clearMatching((event) => event.source == unit || event.target == unit);
    }

    clearEventsOfType(type) {
        this.clearMatching((event) => event.type == type);
    }

    clearMatching(fn) {
        let cleared = false;
        let heapEvents = this.minHeap.toArray();

        for (const event of heapEvents) {
            if (fn(event)) {
                this.minHeap.remove(event);
                cleared = true;
            }
        }
        return cleared;
    }

    getMatching(fn) {
        let heapEvents = this.minHeap.toArray(); 
    
        for (const event of heapEvents) {
            if (fn(event)) {
                return event; 
            }
        }
    
        return null; 
    }
}

export default EventQueue;
