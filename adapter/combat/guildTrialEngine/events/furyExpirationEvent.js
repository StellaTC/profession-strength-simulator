// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class FuryExpirationEvent extends CombatEvent {
    static type = "furyExpiration";

    constructor(time, furyAmount, source) {
        super(FuryExpirationEvent.type, time);
        
        this.furyAmount = furyAmount;
        this.source = source;
    }
}


export default FuryExpirationEvent;
