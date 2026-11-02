// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class AwaitCooldownEvent extends CombatEvent {
    static type = "awaitCooldownEvent";

    constructor(time, source) {
        super(AwaitCooldownEvent.type, time);

        this.source = source;
    }
}


export default AwaitCooldownEvent;
