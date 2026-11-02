/** Shared non-stacking buff lifecycle. Sources are isolated and weaker live
 * effects resume when the strongest expires. Explicit replacement is reserved
 * for calculated state such as Curse/Weaken stacks. */
export const buffLifecycle = {
    getBuffStrength(buff) {
        return Math.abs(buff.ratioBoost || 0) + Math.abs(buff.flatBoost || 0);
    },

    selectStrongestBuff(uniqueHrid) {
        this._boostGeneration = (this._boostGeneration || 0) + 1;
        const candidates = this.buffCandidates[uniqueHrid] || [];
        if (candidates.length === 0) {
            delete this.combatBuffs[uniqueHrid];
            return;
        }

        this.combatBuffs[uniqueHrid] = candidates.reduce((strongest, candidate) => {
            const strengthDifference = this.getBuffStrength(candidate) - this.getBuffStrength(strongest);
            if (strengthDifference > 0) {
                return candidate;
            }
            if (strengthDifference === 0 && candidate.startTime >= strongest.startTime) {
                return candidate.candidateId > strongest.candidateId ? candidate : strongest;
            }
            return strongest;
        });
    },

    effectiveBuffChanged(previousBuff, currentBuff) {
        if (!previousBuff || !currentBuff) {
            return previousBuff !== currentBuff;
        }
        return previousBuff.ratioBoost !== currentBuff.ratioBoost
            || previousBuff.flatBoost !== currentBuff.flatBoost;
    },

    addBuffCandidate(buff, currentTime, isPermanent = false) {
        const uniqueHrid = buff.uniqueHrid;
        const previousBuff = this.combatBuffs[uniqueHrid];
        const candidate = {
            ...structuredClone(buff),
            startTime: currentTime,
            isPermanent,
            candidateId: this.nextBuffCandidateId++,
        };

        if (!this.buffCandidates[uniqueHrid]) {
            this.buffCandidates[uniqueHrid] = [];
        }
        this.buffCandidates[uniqueHrid].push(candidate);
        this.selectStrongestBuff(uniqueHrid);

        return this.effectiveBuffChanged(previousBuff, this.combatBuffs[uniqueHrid]);
    },

    addBuffs(buffs, currentTime) {
        let needUpdate = false;
        buffs.forEach((buff) => {
            const effectiveBuffChanged = this.addBuffCandidate(buff, currentTime);
            needUpdate = needUpdate || effectiveBuffChanged;
        });
        if (needUpdate) {
            this.updateCombatDetails();
        }
    },

    addBuff(buff, currentTime) {
        if (this.addBuffCandidate(buff, currentTime)) {
            this.updateCombatDetails();
        }
    },

    replaceBuff(buff, currentTime) {
        const previousBuff = this.combatBuffs[buff.uniqueHrid];
        delete this.buffCandidates[buff.uniqueHrid];
        delete this.combatBuffs[buff.uniqueHrid];
        this.addBuffCandidate(buff, currentTime);
        if (this.effectiveBuffChanged(previousBuff, this.combatBuffs[buff.uniqueHrid])) {
            this.updateCombatDetails();
        }
    },

    removeBuffs(buffs) {
        this._boostGeneration = (this._boostGeneration || 0) + 1;
        let needUpdate = false;
        buffs.forEach((buff) => {
            const uniqueHrid = buff.uniqueHrid;
            const previousBuff = this.combatBuffs[uniqueHrid];
            delete this.buffCandidates[uniqueHrid];
            delete this.combatBuffs[buff.uniqueHrid];
            needUpdate = needUpdate || this.effectiveBuffChanged(previousBuff, undefined);
        });

        if (needUpdate) {
            this.updateCombatDetails();
        }
    },

    removeBuff(buff) {
        this.removeBuffs([buff]);
    },

    addPermanentBuff(buff) {
        if (this.permanentBuffs[buff.typeHrid]) {
            this.permanentBuffs[buff.typeHrid].flatBoost += buff.flatBoost;
            this.permanentBuffs[buff.typeHrid].ratioBoost += buff.ratioBoost;
        } else {
            this.permanentBuffs[buff.typeHrid] = {
                uniqueHrid: buff.uniqueHrid,
                typeHrid: buff.typeHrid,
                flatBoost: buff.flatBoost,
                ratioBoost: buff.ratioBoost,
                duration: buff.duration
            };
        }
    },

    removeExpiredBuffs(currentTime) {
        let needUpdate = false;
        Object.keys(this.buffCandidates).forEach((uniqueHrid) => {
            const previousBuff = this.combatBuffs[uniqueHrid];
            this.buffCandidates[uniqueHrid] = this.buffCandidates[uniqueHrid].filter(
                (buff) => buff.isPermanent || buff.startTime + buff.duration > currentTime
            );
            if (this.buffCandidates[uniqueHrid].length === 0) {
                delete this.buffCandidates[uniqueHrid];
            }
            this.selectStrongestBuff(uniqueHrid);
            needUpdate = needUpdate || this.effectiveBuffChanged(previousBuff, this.combatBuffs[uniqueHrid]);
        });

        if (needUpdate) {
            this.updateCombatDetails();
        }
    },

    clearBuffs() {
        this._boostGeneration = (this._boostGeneration || 0) + 1;
        this.combatBuffs = {};
        this.buffCandidates = {};
        Object.values(this.permanentBuffs).forEach((buff) => {
            this.addBuffCandidate(buff, Number.NEGATIVE_INFINITY, true);
        });
        this.updateCombatDetails();
    },
};

export function installBuffLifecycle(Unit) {
    Object.assign(Unit.prototype, buffLifecycle);
}
