import { handleMultiSimulationMessage } from "../multiWorker.js";
import { createPooledCombatWorker } from "./combatComputePool"
import { getRuntimeCombatGameData } from "../shared/runtimeGameData.js";

/**
 * @typedef {Object} SingleSimulationWorkerPayload
 * @property {"start_simulation"} type
 * @property {string} workerId
 * @property {Array<any>} players
 * @property {{ zoneHrid: string, difficultyTier: number } | null} zone
 * @property {{ labyrinthHrid: string, roomLevel: number, crates: string[] } | null} labyrinth
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 */

/**
 * @typedef {Object} MultiZoneSimulationWorkerPayload
 * @property {"start_simulation_all_zones"} type
 * @property {Array<any>} players
 * @property {Array<{ zoneHrid: string, difficultyTier: number }>} zones
 * @property {number} [parallelWorkerLimit]
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 */

/**
 * @typedef {Object} MultiLabyrinthSimulationWorkerPayload
 * @property {"start_simulation_all_labyrinths"} type
 * @property {Array<any>} players
 * @property {Array<{ labyrinthHrid: string, roomLevel: number, crates: string[] }>} labyrinths
 * @property {number} [parallelWorkerLimit]
 * @property {number} simulationTimeLimit
 * @property {{ mooPass: boolean, comExp: number, comDrop: number, enableHpMpVisualization: boolean }} extra
 */

export class WorkerClient {
    constructor() {
        this.worker = null;
    }

    /**
     * @param {SingleSimulationWorkerPayload} payload
     * @param {{ onProgress?: Function, onResult?: Function, onError?: Function }} handlers
     */
    startSimulation(payload, handlers = {}) {
        this.stopSimulation();

        this.worker = createPooledCombatWorker();
        this.worker.onmessage = (event) => {
            const data = event.data ?? {};

            switch (data.type) {
                case "simulation_progress":
                    handlers.onProgress?.(data);
                    break;
                case "simulation_result":
                    handlers.onResult?.(data.simResult);
                    break;
                case "simulation_error":
                    handlers.onError?.(data.error);
                    break;
                default:
                    break;
            }
        };

        this.worker.onerror = (error) => {
            handlers.onError?.(error?.message || String(error));
        };

        this.worker.postMessage({ ...payload, gameDataEnvelope: getRuntimeCombatGameData() });
    }

    /**
     * @param {MultiZoneSimulationWorkerPayload | MultiLabyrinthSimulationWorkerPayload} payload
     * @param {{ onProgress?: Function, onItemResult?: Function, onBatchResult?: Function, onError?: Function }} handlers
     */
    startMultiSimulation(payload, handlers = {}) {
        this.stopSimulation();

        const controller = new AbortController();
        this.worker = { terminate: () => controller.abort() };
        void handleMultiSimulationMessage({ ...payload, gameDataEnvelope: getRuntimeCombatGameData() }, {
            postMessage(data) {
                if (controller.signal.aborted) return;
                if (data.type === "simulation_progress") handlers.onProgress?.(data);
                else if (data.type === "simulation_item_result") handlers.onItemResult?.(data);
                else if (data.type === "simulation_error") handlers.onError?.(data.error);
                else handlers.onBatchResult?.(data.simResults || [], data.type);
            },
            close() {}
        }, { createWorker: createPooledCombatWorker, signal: controller.signal });
    }

    stopSimulation() {
        if (!this.worker) {
            return;
        }

        this.worker.terminate();
        this.worker = null;
    }
}

const workerClient = new WorkerClient();
export default workerClient;
