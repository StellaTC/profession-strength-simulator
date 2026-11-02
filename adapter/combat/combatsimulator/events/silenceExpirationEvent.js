import CombatEvent from "./combatEvent.js";

class SilenceExpirationEvent extends CombatEvent {
    static type = "silenceExpiration";

    constructor(time, source) {
        super(SilenceExpirationEvent.type, time);

        this.source = source;
    }
}

export default SilenceExpirationEvent;