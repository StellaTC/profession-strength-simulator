import CombatEvent from "./combatEvent.js";

class StunExpirationEvent extends CombatEvent {
    static type = "stunExpiration";

    constructor(time, source) {
        super(StunExpirationEvent.type, time);

        this.source = source;
    }
}

export default StunExpirationEvent;