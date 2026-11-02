// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
import CombatEvent from "./combatEvent.js";


class EnemyRespawnEvent extends CombatEvent {
    static type = "enemyRespawn";

    constructor(time) {
        super(EnemyRespawnEvent.type, time);
    }
}


export default EnemyRespawnEvent;
