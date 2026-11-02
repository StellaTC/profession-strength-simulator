// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class StunExpirationEvent extends CombatEvent {
    static type = "stunExpiration";

    constructor(time, source) {
        super(StunExpirationEvent.type, time);

        this.source = source;
    }
}


export default StunExpirationEvent;
