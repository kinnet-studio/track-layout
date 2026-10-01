export class GenericEntityManager<T> {
    private _availableEntities: number[] = [];
    private _maxEntities: number;
    // private _livingEntityCount = 0;
    // private _entities: (T | null)[] = [];

    private _packedEntityData: (T | null)[];
    private _entityNumberToPackedDataIndex: (number | null)[] = [];
    private _packedDataIndexToEntityNumber: (number | null)[] = [];
    private _livingEntitiesIndex: (number | null)[];
    private _liveCount: number = 0;

    constructor(initialCount: number) {
        this._maxEntities = initialCount;
        for (let i = 0; i < this._maxEntities; i++) {
            this._availableEntities.push(i);
            // this._entities.push(null);
        }

        this._packedEntityData = new Array(this._maxEntities);
        this._entityNumberToPackedDataIndex = new Array(this._maxEntities);
        this._packedDataIndexToEntityNumber = new Array(this._maxEntities);
        this._livingEntitiesIndex = new Array(this._maxEntities);
    }

    getLivingEntityCount(): number {
        return this._liveCount;
    }

    getLivingEntitesIndex(): number[] {
        // return this._entities.map((entity, index) => entity !== null ? index : null).filter((index): index is number => index !== null);
        return this._livingEntitiesIndex.filter(
            (entityNumber): entityNumber is number => entityNumber !== null
        );
    }

    getLivingEntitiesWithIndex(): { index: number; entity: T }[] {
        return this.getLivingEntitesIndex().map(
            (entityNumber): { index: number; entity: T } => {
                return {
                    index: entityNumber,
                    entity: this._packedEntityData[
                        this._entityNumberToPackedDataIndex[entityNumber] ?? 0
                    ] as T,
                };
            }
        );
    }

    getLivingEntities(): T[] {
        // return this._entities.filter((entity): entity is T => entity !== null);
        return this._packedEntityData.filter(
            (entity): entity is T => entity !== null
        );
    }

    getEntity(entity: number): T | null {
        if (entity < 0 || entity >= this._maxEntities) {
            return null;
        }

        const packedDataIndex = this._entityNumberToPackedDataIndex[entity];
        if (packedDataIndex == null) {
            return null;
        }

        return this._packedEntityData[packedDataIndex] ?? null;
    }

    createEntity(entity: T): number {
        if (this._liveCount >= this._maxEntities) {
            console.info('Max entities reached, increasing max entities');
            const currentMaxEntities = this._maxEntities;
            this._maxEntities += currentMaxEntities;

            for (let i = currentMaxEntities; i < this._maxEntities; i++) {
                this._availableEntities.push(i);
            }

            const newPackedEntityData = new Array(this._maxEntities);
            const newEntityNumberToPackedDataIndex = new Array(
                this._maxEntities
            );
            const newPackedDataIndexToEntityNumber = new Array(
                this._maxEntities
            );
            const newLivingEntitiesIndex = new Array(this._maxEntities);

            for (let i = 0; i < currentMaxEntities; i++) {
                newPackedEntityData[i] = this._packedEntityData[i];
                newEntityNumberToPackedDataIndex[i] =
                    this._entityNumberToPackedDataIndex[i];
                newPackedDataIndexToEntityNumber[i] =
                    this._packedDataIndexToEntityNumber[i];
                newLivingEntitiesIndex[i] = this._livingEntitiesIndex[i];
            }

            this._packedEntityData = newPackedEntityData;
            this._entityNumberToPackedDataIndex =
                newEntityNumberToPackedDataIndex;
            this._packedDataIndexToEntityNumber =
                newPackedDataIndexToEntityNumber;
            this._livingEntitiesIndex = newLivingEntitiesIndex;
        }

        const entityNumber = this._availableEntities.shift();

        if (entityNumber === undefined) {
            throw new Error('No available entities');
        }

        this._packedEntityData[this._liveCount] = entity;
        this._entityNumberToPackedDataIndex[entityNumber] = this._liveCount;
        this._packedDataIndexToEntityNumber[this._liveCount] = entityNumber;
        this._livingEntitiesIndex[this._liveCount] = entityNumber;

        this._liveCount++;
        return entityNumber;
    }

    /**
     * Creates an entity with a specific entity ID, used for deserialization
     * where entity IDs must be preserved to maintain cross-references.
     *
     * @param entityNumber - The exact entity ID to assign (must be non-negative and available)
     * @param entity - The entity data
     * @throws Error if the entity ID is negative, already in use, or otherwise unavailable
     */
    createEntityWithId(entityNumber: number, entity: T): void {
        if (entityNumber < 0) {
            throw new Error(
                `Entity ID ${entityNumber} is invalid (must be non-negative)`
            );
        }

        while (entityNumber >= this._maxEntities) {
            const currentMaxEntities = this._maxEntities;
            const growth = Math.max(currentMaxEntities, 1);
            this._maxEntities += growth;

            for (let i = currentMaxEntities; i < this._maxEntities; i++) {
                this._availableEntities.push(i);
            }

            const newPackedEntityData = new Array(this._maxEntities);
            const newEntityNumberToPackedDataIndex = new Array(
                this._maxEntities
            );
            const newPackedDataIndexToEntityNumber = new Array(
                this._maxEntities
            );
            const newLivingEntitiesIndex = new Array(this._maxEntities);

            for (let i = 0; i < currentMaxEntities; i++) {
                newPackedEntityData[i] = this._packedEntityData[i];
                newEntityNumberToPackedDataIndex[i] =
                    this._entityNumberToPackedDataIndex[i];
                newPackedDataIndexToEntityNumber[i] =
                    this._packedDataIndexToEntityNumber[i];
                newLivingEntitiesIndex[i] = this._livingEntitiesIndex[i];
            }

            this._packedEntityData = newPackedEntityData;
            this._entityNumberToPackedDataIndex =
                newEntityNumberToPackedDataIndex;
            this._packedDataIndexToEntityNumber =
                newPackedDataIndexToEntityNumber;
            this._livingEntitiesIndex = newLivingEntitiesIndex;
        }

        const availableIndex = this._availableEntities.indexOf(entityNumber);
        if (availableIndex === -1) {
            throw new Error(
                `Entity ID ${entityNumber} is not available (already in use or invalid)`
            );
        }
        this._availableEntities.splice(availableIndex, 1);

        this._packedEntityData[this._liveCount] = entity;
        this._entityNumberToPackedDataIndex[entityNumber] = this._liveCount;
        this._packedDataIndexToEntityNumber[this._liveCount] = entityNumber;
        this._livingEntitiesIndex[this._liveCount] = entityNumber;

        this._liveCount++;
    }

    destroyEntity(entity: number): void {
        if (entity >= this._maxEntities || entity < 0) {
            throw new Error('Invalid entity out of range');
        }

        const packedDataIndex = this._entityNumberToPackedDataIndex[entity];

        if (packedDataIndex == undefined) {
            return;
        }

        const lastEntity =
            this._packedDataIndexToEntityNumber[this._liveCount - 1];

        if (lastEntity == null) {
            return;
        }

        this._packedEntityData[packedDataIndex] =
            this._packedEntityData[this._liveCount - 1];
        this._packedDataIndexToEntityNumber[packedDataIndex] = lastEntity;
        this._entityNumberToPackedDataIndex[lastEntity] = packedDataIndex;
        this._entityNumberToPackedDataIndex[entity] = null;
        this._packedEntityData[this._liveCount - 1] = null;

        this._livingEntitiesIndex[packedDataIndex] =
            this._livingEntitiesIndex[this._liveCount - 1];
        this._livingEntitiesIndex[this._liveCount - 1] = null;

        this._availableEntities.push(entity);
        this._liveCount--;
    }
}
