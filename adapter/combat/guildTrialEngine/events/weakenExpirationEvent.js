// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class WeakenExpirationEvent extends CombatEvent {
    static type = "weakenExpiration";
    static maxWeakenStacks = 5;

    constructor(time, currentAmount, source, magnitude) {
        super(WeakenExpirationEvent.type, time);
        const previous = Math.max(0, Number(currentAmount) || 0);
        const sourceMagnitude = Math.max(0, Number(magnitude) || 0);
        this.weakenAmount = Math.max(
            previous,
            Math.min(
                previous + sourceMagnitude,
                sourceMagnitude * WeakenExpirationEvent.maxWeakenStacks,
            ),
        );
        this.source = source;
    }
}


export default WeakenExpirationEvent;
