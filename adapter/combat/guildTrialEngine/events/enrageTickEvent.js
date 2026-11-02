// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class EnrageTickEvent extends CombatEvent {
    static type = "enrageTick";

    constructor(time, encounterTime) {

        super(EnrageTickEvent.type, time);

        this.encounterTime = encounterTime;
    }
}


export default EnrageTickEvent;
