import Monster from "./monster";
import guildTrialEncounterDetailMap from "./data/guildTrialEncounterDetailMap.json";

class GuildTrial {
    constructor(encounterHrid, options = {}) {
        const encounter = guildTrialEncounterDetailMap[encounterHrid];
        if (!encounter) {
            throw new Error(`Unknown guild trial encounter: ${encounterHrid}`);
        }

        this.hrid = encounterHrid;
        this.encounter = encounter;
        this.startLevel = options.startLevel ?? 100;
        this.maxLevel = options.maxLevel ?? 300;
        this.levelStep = 10;
        this.participantCount = options.participantCount ?? 1;
        this.currentLevel = this.startLevel;
        this.layersCompleted = 0;
        this.encountersKilled = 1;
        this.buffs = [];
        this.isDungeon = false;
        this.isGuildTrial = true;
        this.endedReason = null;
    }

    getRandomEncounter() {
        this.encountersKilled = this.layersCompleted + 1;
        return this.encounter.monsterHrids.map((hrid) => new Monster(
            hrid,
            0,
            this.currentLevel,
            { participantCount: this.participantCount, hitpointPercent: 100 + this.participantCount }
        ));
    }

    completeLayer() {
        this.layersCompleted += 1;
        if (this.currentLevel >= this.maxLevel) {
            this.endedReason = "max_level_completed";
            return false;
        }
        this.currentLevel = Math.min(this.currentLevel + this.levelStep, this.maxLevel);
        return true;
    }

    get points() {
        return this.layersCompleted > 0
            ? 400 + (this.layersCompleted - 1) * 200
            : 0;
    }
}

export default GuildTrial;
