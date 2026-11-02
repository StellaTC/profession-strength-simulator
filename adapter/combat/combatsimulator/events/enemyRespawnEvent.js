import CombatEvent from "./combatEvent.js";

class EnemyRespawnEvent extends CombatEvent {
    static type = "enemyRespawn";

    constructor(time) {
        super(EnemyRespawnEvent.type, time);
    }
}

export default EnemyRespawnEvent;
