// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import Ability from "./ability.js";
import CombatUnit from "./combatUnit.js";
import combatMonsterDetailMap from "./data/combatMonsterDetailMap.json";
import guildTrialMonsterDetailMap from "./data/guildTrialMonsterDetailMap.json";
import Drops from "./drops.js";






const monsterDetailMap = {
    ...combatMonsterDetailMap,
    ...guildTrialMonsterDetailMap,
};

// Guild combat trial balance patch announced on 2026-07-15.  Keep this
// separate from the bundled game-data snapshot so cache/version boundaries
// remain explicit until the upstream data bundle catches up.

const GUILD_TRIAL_MONSTER_PATCH_2026_07_15 = {
    "/monsters/trial_badger": {
        attackInterval: 2700000000,
        maxHitpointsRatio: 344,
        maxManapointsRatio: 344,
        armor: 400,
        waterResistance: 150,
        natureResistance: 150,
        fireResistance: 150,
    },
    "/monsters/trial_chameleon": {
        attackInterval: 2700000000,
        maxHitpointsRatio: 574,
        maxManapointsRatio: 574,
        armor: 225,
        waterResistance: 400,
        natureResistance: 400,
        fireResistance: 400,
    },
    "/monsters/trial_jellyfish": {
        attackInterval: 3000000000,
        maxHitpointsRatio: 519,
        maxManapointsRatio: 519,
        armor: 225,
        waterResistance: 300,
        natureResistance: 175,
        fireResistance: 300,
    },
    "/monsters/trial_hedgehog": { attackInterval: 3000000000 },
    "/monsters/trial_beetle": { attackInterval: 2300000000 },
    "/monsters/trial_dragonfly": { attackInterval: 2700000000 },
    "/monsters/trial_wasp": { attackInterval: 2600000000 },
    "/monsters/trial_firefly": { attackInterval: 3000000000 },
};

class Monster extends CombatUnit {

    difficultyTier = 0;
    
    LabyrinthMonsterBaseRoomLevel = 100; //Base stats are designed for room level 100, and scale proportionally    
    roomLevel = 0;

    constructor(hrid, difficultyTier = 0, roomLevel = 0, options = {}) {
        super();

        this.isPlayer = false;
        this.hrid = hrid;
        this.difficultyTier = difficultyTier;
        this.roomLevel = roomLevel
        this.guildTrialHitpointMultiplier = options.hitpointMultiplier ?? 1;
        this.guildTrialHitpointPercent = options.hitpointPercent ?? null;
        this.guildTrialParticipantCount = Math.max(0, Number(options.participantCount) || 0);
        if (this.roomLevel <= 0) {
            this.roomLevel = this.LabyrinthMonsterBaseRoomLevel;
        }

        let gameMonster = monsterDetailMap[this.hrid];
        if (!gameMonster) {
            throw new Error("No monster found for hrid: " + this.hrid);
        }

        this.enrageTime = gameMonster.enrageTime;

        let labyrinthScaleFactor = this.roomLevel / this.LabyrinthMonsterBaseRoomLevel;
        for (let i = 0; i < gameMonster.abilities.length; i++) {
            if (gameMonster.abilities[i].minDifficultyTier > this.difficultyTier) {
                continue;
            }
            this.abilities[i] = new Ability(gameMonster.abilities[i].abilityHrid, Math.floor(gameMonster.abilities[i].level * labyrinthScaleFactor));
        }
        if(gameMonster.dropTable)
        for (let i = 0; i < gameMonster.dropTable.length; i++) {
            this.dropTable[i] = new Drops(gameMonster.dropTable[i].itemHrid, gameMonster.dropTable[i].dropRate, gameMonster.dropTable[i].minCount, gameMonster.dropTable[i].maxCount, gameMonster.dropTable[i].difficultyTier);
        }
        const rareDropTable = gameMonster.rareDropTable || [];
        for (let i = 0; i < rareDropTable.length; i++) {
            let dropTableItem = (gameMonster.dropTable && i < gameMonster.dropTable.length) ? gameMonster.dropTable[i] : null;
            let difficultyTier = dropTableItem?.difficultyTier ?? rareDropTable[i].minDifficultyTier;

            this.rareDropTable[i] = new Drops(rareDropTable[i].itemHrid, rareDropTable[i].dropRate, rareDropTable[i].minCount, difficultyTier);
        }
    }

    updateCombatDetails() {
        let gameMonster = monsterDetailMap[this.hrid];

        let levelMultiplier = 1.0 + 0.25 * this.difficultyTier;
        let defLevelMultiplier = 1.0 + 0.15 * this.difficultyTier;
        let levelBonus = 20.0 * this.difficultyTier;

        let labyrinthScaleFactor = this.roomLevel / this.LabyrinthMonsterBaseRoomLevel;

        this.staminaLevel = levelMultiplier * (gameMonster.combatDetails.staminaLevel + levelBonus) * labyrinthScaleFactor;
        this.intelligenceLevel = levelMultiplier * (gameMonster.combatDetails.intelligenceLevel + levelBonus) * labyrinthScaleFactor;
        this.attackLevel = levelMultiplier * (gameMonster.combatDetails.attackLevel + levelBonus) * labyrinthScaleFactor;
        this.meleeLevel = levelMultiplier * (gameMonster.combatDetails.meleeLevel + levelBonus) * labyrinthScaleFactor;
        this.defenseLevel = defLevelMultiplier * (gameMonster.combatDetails.defenseLevel + levelBonus) * labyrinthScaleFactor;
        this.rangedLevel = levelMultiplier * (gameMonster.combatDetails.rangedLevel + levelBonus) * labyrinthScaleFactor;
        this.magicLevel = levelMultiplier * (gameMonster.combatDetails.magicLevel + levelBonus) * labyrinthScaleFactor;
        
        let expMultiplier = 1.0 + 0.5 * this.difficultyTier;
        let expBonus = 5.0 * this.difficultyTier;

        this.experience = expMultiplier * (gameMonster.experience + expBonus);

        this.combatDetails.combatStats.combatStyleHrid = gameMonster.combatDetails.combatStats.combatStyleHrids[0];

        for (const [key, value] of Object.entries(gameMonster.combatDetails.combatStats)) {
            this.combatDetails.combatStats[key] = value;
        }

        const guildTrialPatch = GUILD_TRIAL_MONSTER_PATCH_2026_07_15[this.hrid];
        if (guildTrialPatch) {
            Object.assign(this.combatDetails.combatStats, guildTrialPatch);
            // The party-size speed scaling is NOT written here.  Writing it at
            // this point is the original defect: the zero-fill loop below tests
            // the base data entry, and neither trial_chameleon nor trial_swarm
            // declares castSpeed or attackSpeed, so both were reset to 0 a few
            // lines later and the boss acted at about half its intended rate.
            // It is applied after that loop instead -- see below.
        }

        this.combatDetails.combatStats.armor *= labyrinthScaleFactor;
        this.combatDetails.combatStats.waterResistance *= labyrinthScaleFactor;
        this.combatDetails.combatStats.natureResistance *= labyrinthScaleFactor;
        this.combatDetails.combatStats.fireResistance *= labyrinthScaleFactor;

        [
            "stabAccuracy",
            "slashAccuracy",
            "smashAccuracy",
            "rangedAccuracy",
            "magicAccuracy",
            "stabDamage",
            "slashDamage",
            "smashDamage",
            "rangedDamage",
            "magicDamage",
            "defensiveDamage",
            "taskDamage",
            "physicalAmplify",
            "waterAmplify",
            "natureAmplify",
            "fireAmplify",
            "healingAmplify",
            "stabEvasion",
            "slashEvasion",
            "smashEvasion",
            "rangedEvasion",
            "magicEvasion",
            "armor",
            "waterResistance",
            "natureResistance",
            "fireResistance",
            "maxHitpoints",
            "maxManapoints",
            "lifeSteal",
            "hpRegenPer10",
            "mpRegenPer10",
            "physicalThorns",
            "elementalThorns",
            "combatDropRate",
            "combatRareFind",
            "combatDropQuantity",
            "combatExperience",
            "criticalRate",
            "criticalDamage",
            "armorPenetration",
            "waterPenetration",
            "naturePenetration",
            "firePenetration",
            "abilityHaste",
            "tenacity",
            "manaLeech",
            "castSpeed",
            "threat",
            "parry",
            "mayhem",
            "pierce",
            "curse",
            "fury",
            "weaken",
            "ripple",
            "bloom",
            "blaze",
            "attackSpeed",
            "foodHaste",
            "drinkConcentration",
            "autoAttackDamage",
            "abilityDamage",
            "retaliation"
        ].forEach((stat) => {
            if (gameMonster.combatDetails.combatStats[stat] == null) {
                this.combatDetails.combatStats[stat] = 0;
            }
        });

        // Guild-trial party-size speed scaling, applied AFTER the zero-fill
        // reset above and sourced from the BASE entry so the write is idempotent
        // across the many updateCombatDetails() calls in one fight.  Both parts
        // matter: writing it before the reset was the original defect (the reset
        // tests the base entry, which declares neither stat), and reading its own
        // current value made it accumulate to 122 once the reset stopped
        // clobbering it, collapsing the stat interval to ~0.0209s.
        //
        // Verified against a server capture: castSpeed 1.02 and abilityHaste 102
        // at 51 participants, and 2.700 / (1 + 1.02) / (1 + 100/2000) = 1.273s
        // equals the server's own attackInterval.  Yields attackSpeed 1.000 and
        // a 1.285714s stat interval at 50 participants, 1.0100x the server's
        // 1.272984s -- exactly the 50-versus-51 participant difference.
        //
        // baseStats is never touched by labyrinthScaleFactor (that scales
        // this.combatDetails.combatStats), so these reads cannot be NaN; the
        // `|| 0` still covers both undefined and NaN.
        if (guildTrialPatch) {
            const baseStats = gameMonster.combatDetails.combatStats;
            this.combatDetails.combatStats.castSpeed =
                (Number(baseStats.castSpeed) || 0)
                + 0.02 * this.guildTrialParticipantCount;
            this.combatDetails.combatStats.abilityHaste =
                2 * this.guildTrialParticipantCount;
            this.combatDetails.combatStats.attackSpeed =
                (Number(baseStats.attackSpeed) || 0)
                + 0.02 * this.guildTrialParticipantCount;
        }

        if (this.combatDetails.combatStats.attackInterval == 0) {
            this.combatDetails.combatStats.attackInterval = gameMonster.combatDetails.attackInterval;
        }

        super.updateCombatDetails();

        if (this.guildTrialHitpointPercent != null) {
            this.combatDetails.maxHitpoints = Math.floor(
                this.combatDetails.maxHitpoints * this.guildTrialHitpointPercent / 100
            );
        } else if (this.guildTrialHitpointMultiplier !== 1) {
            this.combatDetails.maxHitpoints = Math.floor(
                this.combatDetails.maxHitpoints * this.guildTrialHitpointMultiplier
            );
        }
    }
}


export default Monster;

export { GUILD_TRIAL_MONSTER_PATCH_2026_07_15 };
