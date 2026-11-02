// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class AutoAttackEvent extends CombatEvent {
    static type = "autoAttack";

    constructor(time, source) {
        super(AutoAttackEvent.type, time);

        this.source = source;
    }
}


export default AutoAttackEvent;
