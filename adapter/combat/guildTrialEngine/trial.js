// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import Monster from "./monster.js";


class Trial {
    constructor(monsterHrids, options = {}) {
        if (!Array.isArray(monsterHrids) || monsterHrids.length === 0) {
            throw new Error("A trial requires at least one monster");
        }
        this.monsterHrids = [...monsterHrids];
        this.startingFloor = Math.max(1, Number(options.startingFloor) || 1);
        this.startLevel = Math.max(100, Number(options.startLevel) || 100);
        this.maxLevel = Math.max(this.startLevel, Number(options.maxLevel) || 300);
        this.levelStep = 10;
        this.participantCount = Math.max(1, Number(options.participantCount) || 1);
        this.hitpointMultiplier = 1 + this.participantCount * 0.01;
        this.reset();
    }

    reset() {
        this.currentFloor = this.startingFloor;
        this.currentLevel = Math.min(
            this.maxLevel,
            this.startLevel + (this.startingFloor - 1) * this.levelStep,
        );
        this.completedFloor = this.startingFloor - 1;
        this.floorStartedAt = 0;
        this.floorResults = [];
        this.failed = false;
        this.failureTime = null;
        this.endedReason = null;
    }

    getNextEncounter(currentTime = 0) {
        this.floorStartedAt = currentTime;
        return this.monsterHrids.map((hrid) => new Monster(
            hrid,
            0,
            this.currentLevel,
            {
                hitpointMultiplier: this.hitpointMultiplier,
                hitpointPercent: 100 + this.participantCount,
                participantCount: this.participantCount,
            },
        ));
    }

    completeCurrentFloor(currentTime) {
        this.floorResults.push({
            floor: this.currentFloor,
            startedAt: this.floorStartedAt,
            completedAt: currentTime,
            duration: currentTime - this.floorStartedAt,
        });
        this.completedFloor = this.currentFloor;
        if (this.currentLevel >= this.maxLevel) {
            this.endedReason = "max_level_completed";
            return false;
        }
        this.currentFloor += 1;
        this.currentLevel = Math.min(this.currentLevel + this.levelStep, this.maxLevel);
        return true;
    }

    fail(currentTime) {
        this.failed = true;
        this.failureTime = currentTime;
        this.endedReason = "party_wiped";
    }

    get points() {
        return this.completedFloor > 0
            ? 400 + (this.completedFloor - 1) * 200
            : 0;
    }
}


export default Trial;
