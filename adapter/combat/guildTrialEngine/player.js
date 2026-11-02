// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import Ability from "./ability.js";
import CombatUnit from "./combatUnit.js";
import Consumable from "./consumable.js";
import Equipment from "./equipment.js";
import HouseRoom from "./houseRoom.js";
import Achievement from "./achievement.js";







class Player extends CombatUnit {
    equipment = {
        "/equipment_types/head": null,
        "/equipment_types/body": null,
        "/equipment_types/legs": null,
        "/equipment_types/feet": null,
        "/equipment_types/hands": null,
        "/equipment_types/main_hand": null,
        "/equipment_types/two_hand": null,
        "/equipment_types/off_hand": null,
        "/equipment_types/pouch": null,
        "/equipment_types/back": null,
    };

    constructor() {
        super();

        this.isPlayer = true;
        this.hrid = "player";
    }

    static createFromDTO(dto) {
        let player = new Player();

        player.staminaLevel = dto.staminaLevel;
        player.intelligenceLevel = dto.intelligenceLevel;
        player.attackLevel = dto.attackLevel;
        player.meleeLevel = dto.meleeLevel;
        player.defenseLevel = dto.defenseLevel;
        player.rangedLevel = dto.rangedLevel;
        player.magicLevel = dto.magicLevel;

        player.hrid = dto.hrid;

        for (const [key, value] of Object.entries(dto.equipment)) {
            player.equipment[key] = value ? Equipment.createFromDTO(value) : null;
        }

        player.food = dto.food.map((food) => (food ? Consumable.createFromDTO(food) : null));
        player.drinks = dto.drinks.map((drink) => (drink ? Consumable.createFromDTO(drink) : null));
        player.abilities = dto.abilities.map((ability) => (ability ? Ability.createFromDTO(ability) : null));
        Object.entries(dto.houseRooms).forEach(houseRoom => {
            if (houseRoom[1] > 0) {
                player.houseRooms.push(new HouseRoom(houseRoom[0], houseRoom[1]))
            }
        });

        player.achievements = new Achievement(dto.achievements);

        player.debuffOnLevelGap = dto.debuffOnLevelGap;

        return player;
    }

    // Sum of one combat stat across every equipped item.  Invariant for the
    // whole fight: this.equipment is populated once in createFromDTO and never
    // reassigned, and Equipment.getCombatStat reads only static item data and a
    // fixed enhancementLevel.  The reduce runs in the original order so the
    // cached float equals the recomputed one bit for bit.
    __equipmentStatTotal(stat) {
        let cache = this.__equipmentStatCache;
        if (cache === undefined) {
            cache = this.__equipmentStatCache = new Map();
        }
        let total = cache.get(stat);
        if (total === undefined) {
            total = Object.values(this.equipment)
                .filter((equipment) => equipment != null)
                .map((equipment) => equipment.getCombatStat(stat))
                .reduce((prev, cur) => prev + cur, 0);
            cache.set(stat, total);
        }
        return total;
    }

    updateCombatDetails() {
        if (this.equipment["/equipment_types/main_hand"]) {
            this.combatDetails.combatStats.combatStyleHrid =
                this.equipment["/equipment_types/main_hand"].getCombatStyle();
            this.combatDetails.combatStats.damageType = this.equipment["/equipment_types/main_hand"].getDamageType();
            this.combatDetails.combatStats.attackInterval =
                this.equipment["/equipment_types/main_hand"].getCombatStat("attackInterval");
            this.combatDetails.combatStats.primaryTraining = 
                this.equipment["/equipment_types/main_hand"].getPrimaryTraining();
        } else if (this.equipment["/equipment_types/two_hand"]) {
            this.combatDetails.combatStats.combatStyleHrid =
                this.equipment["/equipment_types/two_hand"].getCombatStyle();
            this.combatDetails.combatStats.damageType = this.equipment["/equipment_types/two_hand"].getDamageType();
            this.combatDetails.combatStats.attackInterval =
                this.equipment["/equipment_types/two_hand"].getCombatStat("attackInterval");
            this.combatDetails.combatStats.primaryTraining = 
                this.equipment["/equipment_types/two_hand"].getPrimaryTraining();
        } else {
            this.combatDetails.combatStats.combatStyleHrid = "/combat_styles/smash";
            this.combatDetails.combatStats.damageType = "/damage_types/physical";
            this.combatDetails.combatStats.attackInterval = 3000000000;
            this.combatDetails.combatStats.primaryTraining = "/skills/melee";
        }

        if (this.equipment["/equipment_types/charm"]) {
            this.combatDetails.combatStats.focusTraining = this.equipment["/equipment_types/charm"].getFocusTraining();
        } else {
            this.combatDetails.combatStats.focusTraining = "";
        }

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
            "staminaExperience",
            "intelligenceExperience",
            "attackExperience",
            "defenseExperience",
            "meleeExperience",
            "rangedExperience",
            "magicExperience",
            "retaliation"
        ].forEach((stat) => {
            this.combatDetails.combatStats[stat] = this.__equipmentStatTotal(stat);
        });

        if (this.equipment["/equipment_types/pouch"]) {
            this.combatDetails.combatStats.foodSlots =
                1 + this.equipment["/equipment_types/pouch"].getCombatStat("foodSlots");
            this.combatDetails.combatStats.drinkSlots =
                1 + this.equipment["/equipment_types/pouch"].getCombatStat("drinkSlots");
        } else {
            this.combatDetails.combatStats.foodSlots = 1;
            this.combatDetails.combatStats.drinkSlots = 1;
        }

        super.updateCombatDetails();
    }
}


export default Player;
