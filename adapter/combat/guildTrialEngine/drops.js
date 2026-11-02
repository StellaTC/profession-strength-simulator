// Derived from StellaTC/milkywayidle-simulation-core @ 8805f411da28d7ad3ab2913a486a6b4e892d67d8.
class Drops {

    constructor(itemHrid, dropRate, minCount, maxCount, difficultyTier) {
        this.itemHrid = itemHrid;
        this.dropRate = dropRate;
        this.minCount = minCount;
        this.maxCount = maxCount;
        this.difficultyTier = difficultyTier;
    }
}


export default Drops;
