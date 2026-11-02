import Buff from "./buff";
import communityBuffTypeDetailMap from "../combatsimulator/data/communityBuffTypeDetailMap.json";

class CommunityBuff {
    static create(hrid, level) {
        const detail = communityBuffTypeDetailMap?.[hrid];
        if (!detail?.usableInActionTypeMap?.["/action_types/combat"]) {
            return null;
        }
        return new CommunityBuff(hrid, level);
    }

    constructor(hrid, level) {
        const detail = communityBuffTypeDetailMap?.[hrid];
        if (!detail?.usableInActionTypeMap?.["/action_types/combat"]) {
            throw new Error("No combat community buff found for hrid: " + hrid);
        }

        this.hrid = hrid;
        this.level = Math.max(0, Math.floor(Number(level) || 0));
        this.buffs = this.level > 0 && detail.buff
            ? [new Buff(detail.buff, this.level)]
            : [];
    }
}

export default CommunityBuff;
