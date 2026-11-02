// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import Buff from "./buff.js";
import houseRoomDetailMap from "./data/houseRoomDetailMap.json";



class HouseRoom {
    constructor(hrid, level) {
        this.hrid = hrid;
        this.level = level;

        let gameHouseRoom = houseRoomDetailMap[this.hrid];
        if (!gameHouseRoom) {
            throw new Error("No house room found for hrid: " + this.hrid);
        }

        this.buffs = [];
        if (gameHouseRoom.actionBuffs) {
            for (const actionBuff of gameHouseRoom.actionBuffs) {
                let buff = new Buff(actionBuff, level);
                this.buffs.push(buff);
            }
        }
        if (gameHouseRoom.globalBuffs) {
            for (const globalBuff of gameHouseRoom.globalBuffs) {
                let buff = new Buff(globalBuff, level);
                this.buffs.push(buff);
            }
        }
    }
}


export default HouseRoom;
