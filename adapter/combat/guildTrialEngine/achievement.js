// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import Buff from "./buff.js";
import achievementTierDetailMap from "./data/achievementTierDetailMap.json";
import achievementDetailMap from "./data/achievementDetailMap.json";




class Achievement {
    constructor(achievements) {
        this.achievements = achievements;
        this.buffs = [];

        for(const tier of Object.values(achievementTierDetailMap)) {
            let isGetAll = true;
            let detailMap = Object.values(achievementDetailMap).filter((detail) => detail.tierHrid == tier.hrid)
            for(const achievement of Object.values(detailMap)) {
                if(!this.achievements[achievement.hrid] || this.achievements[achievement.hrid] == false) {
                    isGetAll = false;
                    break;
                }
            }
            if(isGetAll) {
                let buff = new Buff(tier.buff);
                this.buffs.push(buff);
            }
        }
    }
}


export default Achievement;
