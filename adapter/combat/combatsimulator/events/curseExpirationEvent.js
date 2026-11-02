// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class CurseExpirationEvent extends CombatEvent {
    static type = "curseExpiration";
    static maxCurseStacks = 5;

    constructor(time, currentAmount, source, magnitude) {
        super(CurseExpirationEvent.type, time);
        const previous = Math.max(0, Number(currentAmount) || 0);
        const sourceMagnitude = Math.max(0, Number(magnitude) || 0);
        this.curseAmount = Math.max(
            previous,
            Math.min(
                previous + sourceMagnitude,
                sourceMagnitude * CurseExpirationEvent.maxCurseStacks,
            ),
        );
        this.source = source;
    }
}


export default CurseExpirationEvent;
