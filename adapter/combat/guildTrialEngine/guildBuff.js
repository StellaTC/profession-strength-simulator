import Buff from "./buff";
import {
    getGuildBuffMaxLevel,
    guildBuffDetailIndex,
} from "../shared/guildBuffs";

class GuildBuff {
    constructor(hrid, level) {
        const detail = guildBuffDetailIndex?.[hrid];
        if (!detail || detail.isCombat !== true) {
            throw new Error("No combat guild buff found for hrid: " + hrid);
        }

        this.hrid = hrid;
        this.level = Math.min(
            Math.max(0, Math.floor(Number(level) || 0)),
            getGuildBuffMaxLevel(hrid)
        );
        this.buffs = this.level > 0
            ? (detail.buffs || []).map((buff) => new Buff(buff, this.level))
            : [];
    }
}

export default GuildBuff;
