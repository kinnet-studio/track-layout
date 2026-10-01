import type {
    BaseContext,
    CreateStateType,
    EventGuards,
    EventReactions,
    Guard,
    StateMachine,
} from '@ue-too/being';
import { TemplateState, TemplateStateMachine } from '@ue-too/being';
import type { Point } from '@ue-too/math';
import { PointCal } from '@ue-too/math';

import type { TrackGraph } from '../index.js';
import { computePlatformOffset } from '../index.js';
import {
    computeAnchorPoint,
    computeStopPositions,
    sampleSpineEdge,
    validateSpine,
} from '../index.js';
import type { StationManager } from '../index.js';
import type { TrackAlignedPlatformManager } from '../index.js';
import type { SpineEntry } from '../index.js';
import type { SingleSpinePlacementPreview } from './preview.js';
import { buildSpinePath } from './spine-path.js';

// ---------------------------------------------------------------------------
// States & Events
// ---------------------------------------------------------------------------

export const SINGLE_SPINE_PLACEMENT_STATES = [
    'IDLE',
    'PICK_START',
    'PICK_END',
    'DRAW_OUTER',
] as const;

export type SingleSpineStates = CreateStateType<
    typeof SINGLE_SPINE_PLACEMENT_STATES
>;

export type SingleSpineEvents = {
    leftPointerUp: { x: number; y: number };
    pointerMove: { x: number; y: number };
    escapeKey: {};
    startPlacement: { stationId: number };
    endPlacement: {};
};

/**
 * The hint keys the single-spine tool passes to `onHint`, in the order it
 * emits them.
 */
export const SINGLE_SPINE_HINT_KEYS = [
    'hintPickStart',
    'hintPickEnd',
    'hintDrawOuter',
    'hintPlatformCreated',
] as const;

export type SingleSpineHintKey = (typeof SINGLE_SPINE_HINT_KEYS)[number];

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface SingleSpineContext extends BaseContext {
    readonly activeStationId: number | null;
    readonly hasStart: boolean;
    readonly hasEnd: boolean;
    readonly isFinalized: boolean;
    setStation: (stationId: number) => void;
    hoverUpdate: (position: Point) => void;
    pickStart: (position: Point) => boolean;
    updateEnd: (position: Point) => boolean;
    confirmEnd: (position: Point) => boolean;
    addOuterVertex: (position: Point) => boolean;
    isNearClosingAnchor: (position: Point) => boolean;
    finalize: () => void;
    cancel: () => void;
    convert2WorldPosition: (position: Point) => Point;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Snap radius for closing the outer vertex polygon (meters). */
const CLOSING_SNAP_RADIUS = 2;

export class SingleSpinePlacementEngine implements SingleSpineContext {
    private _trackGraph: TrackGraph;
    private _stationManager: StationManager;
    private _platformManager: TrackAlignedPlatformManager;
    private _preview: SingleSpinePlacementPreview;
    private _convertWindowToWorld: (position: Point) => Point;
    private _onHint: (key: SingleSpineHintKey) => void;

    // State
    private _activeStationId: number | null = null;
    private _hasStart = false;
    private _hasEnd = false;
    private _isFinalized = false;

    // Placement data
    private _spine: SpineEntry[] = [];
    private _outerVertices: Point[] = [];
    private _startAnchor: Point | null = null;
    private _endAnchor: Point | null = null;
    private _offset = 0;

    constructor(
        trackGraph: TrackGraph,
        convertWindowToWorld: (position: Point) => Point,
        stationManager: StationManager,
        platformManager: TrackAlignedPlatformManager,
        preview: SingleSpinePlacementPreview,
        onHint?: (key: SingleSpineHintKey) => void
    ) {
        this._trackGraph = trackGraph;
        this._convertWindowToWorld = convertWindowToWorld;
        this._stationManager = stationManager;
        this._platformManager = platformManager;
        this._preview = preview;
        this._onHint = onHint ?? (() => {});
    }

    // -------------------------------------------------------------------------
    // Context properties
    // -------------------------------------------------------------------------

    get activeStationId(): number | null {
        return this._activeStationId;
    }

    get hasStart(): boolean {
        return this._hasStart;
    }

    get hasEnd(): boolean {
        return this._hasEnd;
    }

    get isFinalized(): boolean {
        return this._isFinalized;
    }

    // -------------------------------------------------------------------------
    // Context methods
    // -------------------------------------------------------------------------

    setStation(stationId: number): void {
        this._activeStationId = stationId;
        this._onHint('hintPickStart');
    }

    hoverUpdate(position: Point): void {
        const projection = this._trackGraph.projectPointNearTrack(position, 5);
        if (projection === null) {
            this._preview.hidePreview();
            return;
        }

        const segment = this._trackGraph.getTrackSegmentWithJoints(
            projection.curve
        );
        if (segment === null) {
            this._preview.hidePreview();
            return;
        }

        // Determine which side the cursor is on.
        const { tangent, projectionPoint } = projection;
        const dx = position.x - projectionPoint.x;
        const dy = position.y - projectionPoint.y;
        const cross = tangent.x * dy - tangent.y * dx;
        const side: 1 | -1 = cross >= 0 ? 1 : -1;

        const offset = computePlatformOffset(segment.gauge, segment.bedWidth);
        this._preview.showTrackHighlight(
            projection.curve,
            projection.atT,
            side,
            offset
        );
    }

    pickStart(position: Point): boolean {
        const projection = this._trackGraph.projectPointNearTrack(position, 5);
        if (projection === null) return false;

        const segment = this._trackGraph.getTrackSegmentWithJoints(
            projection.curve
        );
        if (segment === null) return false;

        // Validate that the start point is within reasonable distance of the station.
        if (this._activeStationId !== null) {
            const station = this._stationManager.getStation(
                this._activeStationId
            );
            if (station !== null) {
                const dist = PointCal.distanceBetweenPoints(
                    position,
                    station.position
                );
                if (dist > 500) return false;
            }
        }

        // Determine side from cross product of tangent × (cursor - projectionPoint).
        const { tangent, projectionPoint } = projection;
        const dx = position.x - projectionPoint.x;
        const dy = position.y - projectionPoint.y;
        // cross product z-component: tangent × delta
        const cross = tangent.x * dy - tangent.y * dx;
        const side: 1 | -1 = cross >= 0 ? 1 : -1;

        const offset = computePlatformOffset(segment.gauge, segment.bedWidth);
        this._offset = offset;

        const startEntry: SpineEntry = {
            trackSegment: projection.curve,
            tStart: projection.atT,
            tEnd: projection.atT, // will be updated by confirmEnd
            side,
        };

        this._spine = [startEntry];
        this._outerVertices = [];
        this._hasStart = true;
        this._hasEnd = false;
        this._isFinalized = false;

        // Compute start anchor.
        const curve = this._trackGraph.getTrackSegmentCurve(projection.curve);
        if (curve !== null) {
            this._startAnchor = computeAnchorPoint(
                startEntry,
                'start',
                offset,
                () => curve
            );
        }

        // Show preview with just the start anchor.
        this._updatePlacementPreview();

        this._onHint('hintPickEnd');
        return true;
    }

    updateEnd(position: Point): boolean {
        if (!this._hasStart || this._spine.length === 0) return false;

        const projection = this._trackGraph.projectPointNearTrack(position, 5);
        if (projection === null) {
            this._updatePlacementPreview();
            return false;
        }

        const startEntry = this._spine[0];
        const startSeg = startEntry.trackSegment;
        const startT = startEntry.tStart;
        const side = startEntry.side;

        let tentativeSpine: SpineEntry[];

        if (projection.curve === startSeg) {
            const tEnd = projection.atT;
            if (Math.abs(tEnd - startT) < 1e-6) {
                this._updatePlacementPreview();
                return false;
            }
            tentativeSpine = [
                {
                    trackSegment: startSeg,
                    tStart: startT,
                    tEnd,
                    side,
                },
            ];
        } else {
            const built = buildSpinePath(
                this._trackGraph,
                startSeg,
                startT,
                side,
                projection.curve,
                projection.atT
            );
            if (built === null) {
                this._updatePlacementPreview();
                return false;
            }
            tentativeSpine = built;
        }

        // Compute tentative end anchor at the exact projection point.
        let tentativeEndAnchor: Point | null = null;
        const lastEntry = tentativeSpine[tentativeSpine.length - 1];
        const endCurve = this._trackGraph.getTrackSegmentCurve(
            projection.curve
        );
        if (endCurve !== null) {
            const endPointEntry: SpineEntry = {
                trackSegment: projection.curve,
                tStart: projection.atT,
                tEnd: projection.atT,
                side: lastEntry.side,
            };
            tentativeEndAnchor = computeAnchorPoint(
                endPointEntry,
                'start',
                this._offset,
                () => endCurve
            );
        }

        // Show preview with the tentative spine (without committing state).
        const getCurve = (segmentId: number) => {
            const curve = this._trackGraph.getTrackSegmentCurve(segmentId);
            if (curve === null)
                throw new Error(`Missing curve for segment ${segmentId}`);
            return curve;
        };

        let spinePoints: Point[];
        try {
            spinePoints = sampleSpineEdge(
                tentativeSpine,
                this._offset,
                getCurve
            );
        } catch {
            spinePoints = [];
        }

        this._preview.showPlacementPreview(
            spinePoints,
            this._outerVertices,
            this._startAnchor,
            tentativeEndAnchor
        );

        return true;
    }

    confirmEnd(position: Point): boolean {
        if (!this._hasStart || this._spine.length === 0) return false;

        const projection = this._trackGraph.projectPointNearTrack(position, 5);
        if (projection === null) return false;

        const startEntry = this._spine[0];
        const startSeg = startEntry.trackSegment;
        const startT = startEntry.tStart;
        const side = startEntry.side;

        let finalSpine: SpineEntry[];

        if (projection.curve === startSeg) {
            // Same segment — just update tEnd.
            const tEnd = projection.atT;
            // Ensure tEnd != tStart (minimum length).
            if (Math.abs(tEnd - startT) < 1e-6) return false;
            finalSpine = [
                {
                    trackSegment: startSeg,
                    tStart: startT,
                    tEnd,
                    side,
                },
            ];
        } else {
            // Multi-segment — walk through non-branching joints.
            const built = buildSpinePath(
                this._trackGraph,
                startSeg,
                startT,
                side,
                projection.curve,
                projection.atT
            );
            if (built === null) return false;
            finalSpine = built;
        }

        // Validate the spine.
        const validationResult = validateSpine(
            finalSpine,
            id => {
                const seg = this._trackGraph.getTrackSegmentWithJoints(id);
                if (seg === null) throw new Error(`Missing segment ${id}`);
                return seg;
            },
            id => {
                const joint = this._trackGraph.getJoint(id);
                if (joint === null) throw new Error(`Missing joint ${id}`);
                return joint as { connections: Map<number, number> };
            }
        );

        if (!validationResult.valid) return false;

        this._spine = finalSpine;

        // Compute end anchor at the exact projection point.
        const lastEntry = finalSpine[finalSpine.length - 1];
        const endCurve = this._trackGraph.getTrackSegmentCurve(
            projection.curve
        );
        if (endCurve !== null) {
            const endPointEntry: SpineEntry = {
                trackSegment: projection.curve,
                tStart: projection.atT,
                tEnd: projection.atT,
                side: lastEntry.side,
            };
            this._endAnchor = computeAnchorPoint(
                endPointEntry,
                'start',
                this._offset,
                () => endCurve
            );
        }

        this._hasEnd = true;
        this._updatePlacementPreview();
        this._onHint('hintDrawOuter');
        return true;
    }

    addOuterVertex(position: Point): boolean {
        this._outerVertices.push(position);
        this._updatePlacementPreview();
        return true;
    }

    isNearClosingAnchor(position: Point): boolean {
        if (this._startAnchor === null) return false;
        return (
            PointCal.distanceBetweenPoints(position, this._startAnchor) <=
            CLOSING_SNAP_RADIUS
        );
    }

    finalize(): void {
        if (
            this._activeStationId === null ||
            this._spine.length === 0 ||
            !this._hasStart ||
            !this._hasEnd
        ) {
            this._resetState();
            return;
        }

        const station = this._stationManager.getStation(this._activeStationId);
        if (station === null) {
            this._resetState();
            return;
        }

        const getCurve = (segmentId: number) => {
            const curve = this._trackGraph.getTrackSegmentCurve(segmentId);
            if (curve === null)
                throw new Error(`Missing curve for segment ${segmentId}`);
            return curve;
        };

        const platformId = this._platformManager.createPlatform({
            stationId: this._activeStationId,
            spine: [...this._spine],
            offset: this._offset,
            outerVertices: [...this._outerVertices],
            stopPositions: computeStopPositions(this._spine, getCurve),
        });

        station.trackAlignedPlatforms.push(platformId);

        // When the first platform is added, reposition the station to the
        // spine midpoint so the station label sits on the platform.
        if (
            station.trackAlignedPlatforms.length === 1 &&
            station.platforms.length === 0
        ) {
            const stops = computeStopPositions(this._spine, getCurve);
            if (stops.length > 0) {
                const curve = getCurve(stops[0].trackSegmentId);
                station.position = curve.get(stops[0].tValue);
            }
        }

        // Notify after the station's trackAlignedPlatforms array is updated
        // so subscribers (e.g. debug overlay) see the new platform.
        this._platformManager.notifyChange();

        this._preview.hidePreview();
        this._onHint('hintPlatformCreated');
        this._resetState();
        // Set _isFinalized AFTER _resetState so the guard sees it as true
        // and transitions from DRAW_OUTER → PICK_START.
        this._isFinalized = true;
    }

    cancel(): void {
        this._preview.hidePreview();
        this._resetState();
    }

    setup(): void {}
    cleanup(): void {}

    convert2WorldPosition(position: Point): Point {
        return this._convertWindowToWorld(position);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private _resetState(): void {
        this._hasStart = false;
        this._hasEnd = false;
        this._isFinalized = false;
        this._spine = [];
        this._outerVertices = [];
        this._startAnchor = null;
        this._endAnchor = null;
        this._offset = 0;
    }

    private _updatePlacementPreview(): void {
        if (this._spine.length === 0) return;

        // Sample spine edge points.
        const getCurve = (segmentId: number) => {
            const curve = this._trackGraph.getTrackSegmentCurve(segmentId);
            if (curve === null)
                throw new Error(`Missing curve for segment ${segmentId}`);
            return curve;
        };

        let spinePoints: Point[];
        try {
            spinePoints = sampleSpineEdge(this._spine, this._offset, getCurve);
        } catch {
            spinePoints = [];
        }

        this._preview.showPlacementPreview(
            spinePoints,
            this._outerVertices,
            this._startAnchor,
            this._endAnchor
        );
    }
}

// ---------------------------------------------------------------------------
// State machine states
// ---------------------------------------------------------------------------

class SingleSpineIdleState extends TemplateState<
    SingleSpineEvents,
    SingleSpineContext,
    SingleSpineStates
> {
    protected _eventReactions: EventReactions<
        SingleSpineEvents,
        SingleSpineContext,
        SingleSpineStates
    > = {
        startPlacement: {
            action: (context, event) => {
                context.setStation(event.stationId);
            },
            defaultTargetState: 'PICK_START',
        },
    };
}

class SingleSpinePickStartState extends TemplateState<
    SingleSpineEvents,
    SingleSpineContext,
    SingleSpineStates
> {
    protected _eventReactions: EventReactions<
        SingleSpineEvents,
        SingleSpineContext,
        SingleSpineStates
    > = {
        pointerMove: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.hoverUpdate(worldPos);
            },
            defaultTargetState: 'PICK_START',
        },
        leftPointerUp: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.pickStart(worldPos);
            },
            defaultTargetState: 'PICK_START',
        },
        escapeKey: {
            action: context => context.cancel(),
            defaultTargetState: 'IDLE',
        },
        endPlacement: {
            action: context => context.cancel(),
            defaultTargetState: 'IDLE',
        },
    };

    protected _guards: Guard<SingleSpineContext, string> = {
        started: context => context.hasStart,
    };

    protected _eventGuards: Partial<
        EventGuards<
            SingleSpineEvents,
            SingleSpineStates,
            SingleSpineContext,
            Guard<SingleSpineContext, string>
        >
    > = {
        leftPointerUp: [
            {
                guard: 'started',
                target: 'PICK_END',
            },
        ],
    };
}

class SingleSpinePickEndState extends TemplateState<
    SingleSpineEvents,
    SingleSpineContext,
    SingleSpineStates
> {
    protected _eventReactions: EventReactions<
        SingleSpineEvents,
        SingleSpineContext,
        SingleSpineStates
    > = {
        pointerMove: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.updateEnd(worldPos);
            },
            defaultTargetState: 'PICK_END',
        },
        leftPointerUp: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                context.confirmEnd(worldPos);
            },
            defaultTargetState: 'PICK_START',
        },
        escapeKey: {
            action: context => context.cancel(),
            defaultTargetState: 'PICK_START',
        },
        endPlacement: {
            action: context => context.cancel(),
            defaultTargetState: 'IDLE',
        },
    };

    protected _guards: Guard<SingleSpineContext, string> = {
        confirmed: context => context.hasEnd,
    };

    protected _eventGuards: Partial<
        EventGuards<
            SingleSpineEvents,
            SingleSpineStates,
            SingleSpineContext,
            Guard<SingleSpineContext, string>
        >
    > = {
        leftPointerUp: [
            {
                guard: 'confirmed',
                target: 'DRAW_OUTER',
            },
        ],
    };
}

class SingleSpineDrawOuterState extends TemplateState<
    SingleSpineEvents,
    SingleSpineContext,
    SingleSpineStates
> {
    protected _eventReactions: EventReactions<
        SingleSpineEvents,
        SingleSpineContext,
        SingleSpineStates
    > = {
        leftPointerUp: {
            action: (context, event) => {
                const worldPos = context.convert2WorldPosition({
                    x: event.x,
                    y: event.y,
                });
                if (context.isNearClosingAnchor(worldPos)) {
                    context.finalize();
                } else {
                    context.addOuterVertex(worldPos);
                }
            },
            defaultTargetState: 'DRAW_OUTER',
        },
        escapeKey: {
            action: context => context.cancel(),
            defaultTargetState: 'PICK_START',
        },
        endPlacement: {
            action: context => context.cancel(),
            defaultTargetState: 'IDLE',
        },
    };

    protected _guards: Guard<SingleSpineContext, string> = {
        finalized: context => context.isFinalized,
    };

    protected _eventGuards: Partial<
        EventGuards<
            SingleSpineEvents,
            SingleSpineStates,
            SingleSpineContext,
            Guard<SingleSpineContext, string>
        >
    > = {
        leftPointerUp: [
            {
                guard: 'finalized',
                target: 'PICK_START',
            },
        ],
    };
}

// ---------------------------------------------------------------------------
// State machine type & factory
// ---------------------------------------------------------------------------

export type SingleSpinePlacementStateMachine = StateMachine<
    SingleSpineEvents,
    SingleSpineContext,
    SingleSpineStates
>;

export function createSingleSpinePlacementStateMachine(
    context: SingleSpineContext
): SingleSpinePlacementStateMachine {
    return new TemplateStateMachine<
        SingleSpineEvents,
        SingleSpineContext,
        SingleSpineStates
    >(
        {
            IDLE: new SingleSpineIdleState(),
            PICK_START: new SingleSpinePickStartState(),
            PICK_END: new SingleSpinePickEndState(),
            DRAW_OUTER: new SingleSpineDrawOuterState(),
        },
        'IDLE',
        context
    );
}
