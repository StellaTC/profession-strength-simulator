// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import Heap from "heap-js";


const ATTACK_EVENT_TYPES = { abilityCastEndEvent: true, autoAttack: true };

class EventQueue {
    constructor() {
        this.minHeap = new Heap((a, b) => a.time - b.time);
        // source -> number of queued abilityCastEndEvent/autoAttack events.
        // Maintained on every mutation path so hasPendingAttackEvent() can
        // answer without copying and scanning the whole heap.
        this.pendingAttackCounts = new Map();
    }

    __trackAdd(event) {
        if (event && ATTACK_EVENT_TYPES[event.type] && event.source) {
            const current = this.pendingAttackCounts.get(event.source) || 0;
            this.pendingAttackCounts.set(event.source, current + 1);
        }
    }

    __trackRemove(event) {
        if (event && ATTACK_EVENT_TYPES[event.type] && event.source) {
            const current = this.pendingAttackCounts.get(event.source) || 0;
            if (current <= 1) {
                this.pendingAttackCounts.delete(event.source);
            } else {
                this.pendingAttackCounts.set(event.source, current - 1);
            }
        }
    }

    hasPendingAttackEvent(source) {
        return this.pendingAttackCounts.get(source) > 0;
    }

    addEvent(event) {
        this.__trackAdd(event);
        this.minHeap.push(event);
    }

    getNextEvent() {
        const event = this.minHeap.pop();
        this.__trackRemove(event);
        return event;
    }

    containsEventOfType(type) {
        // toArray() copied the whole ~1000-element backing array (heap-js:
        // __spreadArray([], __read(heapArray), false)) before testing anything;
        // __read alone was 6.37% of self time.  This is a pure read with a
        // non-mutating predicate, so scanning the live array visits exactly the
        // same elements in exactly the same order.
        const heapArray = this.minHeap.heapArray;
        for (let i = 0; i < heapArray.length; i++) {
            if (heapArray[i].type == type) {
                return true;
            }
        }
        return false;
    }

    containsEventOfTypeAndHrid(type, hrid) {
        // Same reasoning as containsEventOfType.  Called once per player per
        // death check, so it runs on the hot path even though it is cheap
        // per call -- the copy was the whole cost.
        const heapArray = this.minHeap.heapArray;
        for (let i = 0; i < heapArray.length; i++) {
            const event = heapArray[i];
            if (event.type == type && event.hrid == hrid) {
                return true;
            }
        }
        return false;
    }

    clear() {
        this.minHeap = new Heap((a, b) => a.time - b.time);
        this.pendingAttackCounts = new Map();
    }

    clearEventsForUnit(unit) {
        this.clearMatching((event) => event.source == unit || event.target == unit);
    }

    clearEventsOfType(type) {
        this.clearMatching((event) => event.type == type);
    }

    // Remove the element at a KNOWN index of the min-heap's backing array.
    //
    // This is a verbatim replication of the idx>=0 branch of the bundled
    // heap-js es5 Heap.prototype.remove:
    //
    //     if (this.length > 0) {
    //         var idx = this.heapArray.findIndex(el => fn(el, o));
    //         if (idx >= 0) {
    //             if (idx === 0) { this.pop(); }
    //             else if (idx === this.length - 1) { this.heapArray.pop(); }
    //             else {
    //                 this.heapArray.splice(idx, 1, this.heapArray.pop());
    //                 this._sortNodeUp(idx);
    //                 this._sortNodeDown(idx);
    //             }
    //             return true;
    //         }
    //     }
    //     return false;
    //
    // Only the findIndex is dropped, because the caller already holds the index
    // it would have returned.  `this.length` is a getter over
    // heapArray.length, so the three-way branch below tests the same
    // predicates; the same heap primitives (pop / splice+_sortNodeUp+
    // _sortNodeDown) run in the same order, so the resulting array layout --
    // and therefore the dequeue order of equal-time events, and therefore the
    // Math.random draw sequence -- is unchanged.  Note the middle branch's
    // "last element" test is evaluated against the pre-mutation length, exactly
    // as in remove().  heap-js never reassigns this.heapArray outside init(),
    // so caching the reference is safe.
    //
    // NOTE for future readers: this heap-js build has NO _removeAt method --
    // the logic is inline in remove().  The above is what was replicated.
    __removeAtIndex(idx) {
        const heap = this.minHeap;
        const heapArray = heap.heapArray;
        if (heapArray.length <= 0 || idx < 0 || idx >= heapArray.length) {
            return false;
        }
        if (idx === 0) {
            heap.pop();
        } else if (idx === heapArray.length - 1) {
            heapArray.pop();
        } else {
            heapArray.splice(idx, 1, heapArray.pop());
            heap._sortNodeUp(idx);
            heap._sortNodeDown(idx);
        }
        return true;
    }

    clearMatching(fn) {
        // Phase 1: scan the live backing array WITHOUT mutating it.  The
        // original copied it (toArray() -> __spreadArray([], __read(..)), 6.37%
        // self time in __read alone) only to get a snapshot stable against the
        // remove() calls it interleaved into the same loop.  Deferring all
        // mutation to phase 2 gives the same stability with no copy: phase 1
        // sees exactly the array the snapshot would have contained, in the same
        // order, and every call site's predicate is a pure property comparison,
        // so predicate results cannot depend on when it runs.
        const heapArray = this.minHeap.heapArray;
        let firstIdx = -1;
        let firstEvent = null;
        let extraMatches = null;
        for (let i = 0; i < heapArray.length; i++) {
            const event = heapArray[i];
            if (fn(event)) {
                if (firstIdx < 0) {
                    firstIdx = i;
                    firstEvent = event;
                } else {
                    // Allocated only in the 0.6% multi-match case.
                    if (extraMatches === null) {
                        extraMatches = [];
                    }
                    extraMatches.push(event);
                }
            }
        }

        if (firstIdx < 0) {
            return false;
        }

        // Phase 2.  Removal order is ascending index -- identical to the
        // original, which removed in snapshot order.
        if (extraMatches === null) {
            // 99.4% of 24,030 measured calls land here (0 or 1 match).  We hold
            // the index and nothing has mutated the array since we read it, so
            // remove()'s findIndex would only re-derive it.  Identical result:
            // findIndex uses Heap.defaultIsEqual (a === b) and returns the
            // FIRST identity match, which is what the forward scan above found.
            this.__removeAtIndex(firstIdx);
            this.__trackRemove(firstEvent);
        } else {
            // 2+ matches: after the first removal every recorded index is
            // stale, so findIndex is genuinely needed.  Use the untouched
            // remove() path for all of them, which makes this branch behave
            // exactly like the original code.
            this.minHeap.remove(firstEvent);
            this.__trackRemove(firstEvent);
            for (let i = 0; i < extraMatches.length; i++) {
                this.minHeap.remove(extraMatches[i]);
                this.__trackRemove(extraMatches[i]);
            }
        }
        return true;
    }

    getMatching(fn) {
        // 3.82% self time, and it was paying for a full array copy to return
        // the FIRST match -- often found in the first few slots.  Pure read
        // with a non-mutating predicate, so the live array is safe to scan and
        // front-to-back order matches what toArray() produced (positional
        // copy, not a sort), so the same event is returned.
        const heapArray = this.minHeap.heapArray;
        for (let i = 0; i < heapArray.length; i++) {
            const event = heapArray[i];
            if (fn(event)) {
                return event;
            }
        }
        return null;
    }
}


export default EventQueue;
