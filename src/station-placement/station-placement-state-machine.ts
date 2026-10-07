import {
    BaseContext,
    EventReactions,
    NO_OP,
    TemplateState,
    TemplateStateMachine,
} from '@ue-too/being';
import type { Point } from '@ue-too/math';
import { PointCal } from '@ue-too/math';

import type { TrackGraph } from '../index.js';
import { ELEVATION } from '../index.js';
import { createIslandStation, defaultIslandLayout } from '../index.js';
import type { StationManager } from '../index.js';
import type { StationPlacementPreview } from './preview.js';

// ---------------------------------------------------------------------------
// States & Events
// ---------------------------------------------------------------------------

export type StationPlacementStates =
    'IDLE' | 'HOVER_FOR_START' | 'HOVER_FOR_END';

export type StationPlacementEvents = {
    leftPointerDown: { x: number; y: number };
    leftPointerUp: { x: number; y: number };
    pointerMove: { x: number; y: number };
    escapeKey: {};
    startPlacement: {};
    endPlacement: {};
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface StationPlacementContext extends BaseContext {
    startDrag: (position: Point) => void;
    updateDrag: (position: Point) => void;
    finishDrag: (position: Point) => void;
    cancelPlacement: () => void;
    convert2WorldPosition: (position: Point) => Point;
}

// ---------------------------------------------------------------------------
// Engine (implements context)
// ---------------------------------------------------------------------------

export class StationPlacementEngine implements StationPlacementContext {
    private _trackGraph: TrackGraph;
    private _stationManager: StationManager;
    private _preview: StationPlacementPreview;
    private _getGauge: () => number;
    private _convertWindowToWorld: (position: Point) => Point;

    private _dragStart: Point | null = null;

    constructor(
        trackGraph: TrackGraph,
        convertWindowToWorld: (position: Point) => Point,
        stationManager: StationManager,
        preview: StationPlacementPreview,
        getGauge: () => number
    ) {
        this._trackGraph = trackGraph;
        this._convertWindowToWorld = convertWindowToWorld;
        this._stationManager = stationManager;
        this._preview = preview;
        this._getGauge = getGauge;
    }

    startDrag(position: Point): void {
        this._dragStart = position;
        this._preview.showPreview(
            position,
            { x: 1, y: 0 },
            0.5,
            this._trackSpacing()
        );
    }

    updateDrag(position: Point): void {
        if (this._dragStart === null) return;

        const dx = position.x - this._dragStart.x;
        const dy = position.y - this._dragStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.5) return;

        const direction = { x: dx / dist, y: dy / dist };
        const center = {
            x: (this._dragStart.x + position.x) / 2,
            y: (this._dragStart.y + position.y) / 2,
        };

        this._preview.showPreview(
            center,
            direction,
            dist,
            this._trackSpacing()
        );
    }

    finishDrag(position: Point): void {
        if (this._dragStart === null) return;

        const start = this._dragStart;
        const dx = position.x - start.x;
        const dy = position.y - start.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        this._preview.hidePreview();
        this._dragStart = null;

        if (dist < 2) return; // too short, cancel

        const direction = { x: dx / dist, y: dy / dist };
        const center = {
            x: (start.x + position.x) / 2,
            y: (start.y + position.y) / 2,
        };

        createIslandStation(this._trackGraph, this._stationManager, {
            position: center,
            direction,
            length: dist,
            elevation: ELEVATION.GROUND,
            gauge: this._getGauge(),
        });
    }

    cancelPlacement(): void {
        this._preview.hidePreview();
        this._dragStart = null;
    }

    /** The track spacing createIslandStation's defaults give the current gauge. */
    private _trackSpacing(): number {
        return defaultIslandLayout(this._trackGraph, this._getGauge())
            .trackSpacing;
    }

    setup(): void {}
    cleanup(): void {}

    convert2WorldPosition(position: Point): Point {
        return this._convertWindowToWorld(position);
    }
}

// ---------------------------------------------------------------------------
// State machine states
// ---------------------------------------------------------------------------

class StationPlacementIdleState extends TemplateState<
    StationPlacementEvents,
    StationPlacementContext,
    StationPlacementStates
> {
    protected _eventReactions: EventReactions<
        StationPlacementEvents,
        StationPlacementContext,
        StationPlacementStates
    > = {
        startPlacement: {
            action: NO_OP,
            defaultTargetState: 'HOVER_FOR_START',
        },
    };
}

/** Waiting for the first click to set the start point. */
class StationPlacementHoverForStartState extends TemplateState<
    StationPlacementEvents,
    StationPlacementContext,
    StationPlacementStates
> {
    protected _eventReactions: EventReactions<
        StationPlacementEvents,
        StationPlacementContext,
        StationPlacementStates
    > = {
        leftPointerUp: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.startDrag(worldPos);
            },
            defaultTargetState: 'HOVER_FOR_END',
        },
        endPlacement: {
            action: context => context.cancelPlacement(),
            defaultTargetState: 'IDLE',
        },
        escapeKey: {
            action: context => context.cancelPlacement(),
            defaultTargetState: 'IDLE',
        },
    };
}

/** Start point set; following pointer to show preview. Click to place. */
class StationPlacementHoverForEndState extends TemplateState<
    StationPlacementEvents,
    StationPlacementContext,
    StationPlacementStates
> {
    protected _eventReactions: EventReactions<
        StationPlacementEvents,
        StationPlacementContext,
        StationPlacementStates
    > = {
        pointerMove: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.updateDrag(worldPos);
            },
            defaultTargetState: 'HOVER_FOR_END',
        },
        leftPointerUp: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.finishDrag(worldPos);
            },
            defaultTargetState: 'HOVER_FOR_START',
        },
        escapeKey: {
            action: context => context.cancelPlacement(),
            defaultTargetState: 'HOVER_FOR_START',
        },
        endPlacement: {
            action: context => context.cancelPlacement(),
            defaultTargetState: 'IDLE',
        },
    };
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export class StationPlacementStateMachine extends TemplateStateMachine<
    StationPlacementEvents,
    StationPlacementContext,
    StationPlacementStates
> {
    constructor(context: StationPlacementContext) {
        super(
            {
                IDLE: new StationPlacementIdleState(),
                HOVER_FOR_START: new StationPlacementHoverForStartState(),
                HOVER_FOR_END: new StationPlacementHoverForEndState(),
            },
            'IDLE',
            context
        );
    }
}

/**
 * Creates the island station placement tool's state machine. The context is
 * usually a StationPlacementEngine.
 */
export function createStationPlacementStateMachine(
    context: StationPlacementContext
): StationPlacementStateMachine {
    return new StationPlacementStateMachine(context);
}
