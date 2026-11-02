// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class AbilityCastEndEvent extends CombatEvent {
    static type = "abilityCastEndEvent";

    constructor(time, source, ability) {
        super(AbilityCastEndEvent.type, time);

        this.source = source;
        this.ability = ability;
    }
}


export default AbilityCastEndEvent;
