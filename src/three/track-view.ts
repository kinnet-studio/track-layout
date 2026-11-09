import {
    AmbientLight,
    Box3,
    DirectionalLight,
    Group,
    Light,
    OrthographicCamera,
    PerspectiveCamera,
    Vector3,
    WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { type BoardView, applyTopDownCamera } from './camera.js';
import {
    ORBIT_FOV_DEG,
    ORBIT_MAX_POLAR,
    createGround,
    fitGround,
    groundRect,
    orbitNearFar,
    orbitPoseFrom,
} from './orbit.js';
import type { TrackScene } from './track-scene.js';

/** Thrown by `TrackView3D` when the browser can't give it a WebGL 2 context. */
export class WebGLUnavailableError extends Error {
    constructor(options?: { cause?: unknown }) {
        super('track-layout/three: WebGL 2 is not available', options);
        this.name = 'WebGLUnavailableError';
    }
}

/**
 * The board zoom (px per metre) from which the straight-down view shows the
 * rails and catenary, the same zoom from which 2D's Detailed style draws them.
 */
// It is ZOOM_THRESHOLD_DETAILED_TRACK in src/pixi/track-render-system.ts,
// which src/three can't import; keep the two equal (test/three-orbit.test.ts
// checks).
export const DETAILED_TRACK_ZOOM = 5;

/** The 2D sun angle's default, as `TrackRenderSystem`'s `_sunAngle`. */
const DEFAULT_SUN_ANGLE_DEG = 135;
/** The sun's height above the horizon. */
const SUN_ELEVATION = Math.PI / 4;

/**
 * The light's intensities. three's Lambert shading is
 * `colour × (ambient + sun × cos θ) / π`, and the sun strikes a flat top at
 * `cos θ = sin(SUN_ELEVATION)`. So the ambient light and the sun each give a
 * flat top half of `π`, and a flat top seen straight down shows its base
 * colour, as 2D Detailed does. A face turned away from the sun keeps the
 * ambient half; one turned toward it is up to a fifth brighter.
 */
export const AMBIENT_INTENSITY = Math.PI / 2;
export const SUN_INTENSITY = Math.PI / 2 / Math.sin(SUN_ELEVATION);

/**
 * The unit direction toward the sun, in scene coordinates, for the 2D sun
 * angle `sunAngleDeg`.
 *
 * 2D offsets shadows along world `(cos A, sin A)`, y down, so the sun lies
 * along `−(cos A, sin A)`: in the scene `(x, −y)`, that is `(−cos A, sin A)`.
 * At the default 135° it is up-right on screen. The sun stands 45° above that
 * horizontal direction.
 */
export function sunDirection(sunAngleDeg: number): Vector3 {
    const a = (sunAngleDeg * Math.PI) / 180;
    const across = Math.cos(SUN_ELEVATION);
    return new Vector3(
        -Math.cos(a) * across,
        Math.sin(a) * across,
        Math.sin(SUN_ELEVATION)
    );
}

export type TrackView3DOptions = {
    /**
     * Render on the next animation frame after each change, which is the
     * default. With false, call `renderIfNeeded` yourself, for example from
     * another renderer's ticker so both canvases change in the same frame.
     */
    autoRender?: boolean;
    /** The 2D sun angle in degrees; 135 by default. */
    sunAngleDeg?: number;
};

/**
 * Draws a `TrackScene` on a canvas with WebGL, on demand: only after the
 * scene, the camera or the size changes.
 *
 * It shows the track straight down, lined up with the board camera given to
 * `setTopDown`, or, between `enterOrbit` and `leaveOrbit`, from a perspective
 * camera the user turns with `OrbitControls` on the canvas. While orbiting, a
 * see-through ground plane with a 100 m grid lies at 0 m around the layout.
 *
 * The view adds its lights and the ground to the scene, and takes them out on
 * `dispose`. The scene itself stays the caller's to dispose.
 *
 * Call `resize` before the first render. Until then the view takes its size
 * from the canvas's drawing-buffer pixels (300 × 150 for a new canvas), not
 * its CSS size.
 */
export class TrackView3D {
    private readonly _renderer: WebGLRenderer;
    private readonly _topDownCamera = new OrthographicCamera();
    private readonly _orbitCamera = new PerspectiveCamera(ORBIT_FOV_DEG);
    /** The lights and the ground, added to the scene as one group. */
    private readonly _extras = new Group();
    private readonly _ground = createGround();
    private readonly _autoRender: boolean;
    private readonly _lostListeners = new Set<() => void>();
    private readonly _offSceneChange: () => void;
    /** The last `setTopDown` view; null until the first. */
    private _view: BoardView | null = null;
    /** Set while orbiting. */
    private _controls: OrbitControls | null = null;
    /** Everything drawn while orbiting: the ground and the layout. */
    private _orbitContent = new Box3();
    private _widthCss: number;
    private _heightCss: number;
    private _needsRender = true;
    private _frame: number | null = null;
    private _contextLost = false;
    private _disposed = false;

    /** Whether this browser can give a canvas a WebGL 2 context. */
    static isSupported(): boolean {
        if (typeof document === 'undefined') return false;
        try {
            const gl = document.createElement('canvas').getContext('webgl2');
            if (!gl) return false;
            gl.getExtension('WEBGL_lose_context')?.loseContext();
            return true;
        } catch {
            return false;
        }
    }

    /** @throws WebGLUnavailableError when `canvas` can't get a WebGL 2 context. */
    constructor(
        private readonly _canvas: HTMLCanvasElement,
        private readonly _scene: TrackScene,
        options: TrackView3DOptions = {}
    ) {
        try {
            this._renderer = new WebGLRenderer({
                canvas: _canvas,
                alpha: true,
                antialias: true,
                preserveDrawingBuffer: false,
            });
        } catch (cause) {
            throw new WebGLUnavailableError({ cause });
        }
        this._autoRender = options.autoRender ?? true;
        this._widthCss = _canvas.width;
        this._heightCss = _canvas.height;
        this._orbitCamera.up.set(0, 0, 1);

        const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
        sun.position.copy(
            sunDirection(options.sunAngleDeg ?? DEFAULT_SUN_ANGLE_DEG)
        );
        this._extras.name = 'view';
        this._extras.add(
            new AmbientLight(0xffffff, AMBIENT_INTENSITY),
            sun,
            this._ground
        );
        _scene.scene.add(this._extras);

        _canvas.addEventListener('webglcontextlost', this._onContextLost);
        this._offSceneChange = _scene.onChange(this._onSceneChange);
        this.requestRender();
    }

    get orbiting(): boolean {
        return this._controls !== null;
    }

    /**
     * Follow the board camera. `view` can be the board camera itself: its
     * fields are copied, and the object isn't kept. A view equal to the last
     * one changes nothing, so calling this every frame renders only after
     * the view changes. While orbiting, the view is only recorded:
     * `leaveOrbit` comes back to the newest one.
     */
    setTopDown(view: BoardView): void {
        const last = this._view;
        if (
            last !== null &&
            last.position.x === view.position.x &&
            last.position.y === view.position.y &&
            last.zoomLevel === view.zoomLevel &&
            last.rotation === view.rotation &&
            last.viewPortWidth === view.viewPortWidth &&
            last.viewPortHeight === view.viewPortHeight
        ) {
            return;
        }
        // Field by field: a board camera's fields are getters, which a
        // spread would drop.
        this._view = {
            position: { x: view.position.x, y: view.position.y },
            zoomLevel: view.zoomLevel,
            rotation: view.rotation,
            viewPortWidth: view.viewPortWidth,
            viewPortHeight: view.viewPortHeight,
        };
        applyTopDownCamera(this._topDownCamera, this._view);
        if (!this.orbiting) this.requestRender();
    }

    /**
     * Size the drawing buffer to `widthCss × heightCss` CSS pixels at
     * `pixelRatio`. The canvas's CSS size is left to the caller.
     */
    resize(widthCss: number, heightCss: number, pixelRatio: number): void {
        if (this._disposed) return;
        this._renderer.setPixelRatio(pixelRatio);
        this._renderer.setSize(widthCss, heightCss, false);
        this._widthCss = widthCss;
        this._heightCss = heightCss;
        this._updateAspect();
        this.requestRender();
    }

    /**
     * Switch to the orbit camera, entering over the straight-down view's
     * centre, tilted 45° at the same heading (`orbitPoseFrom`).
     *
     * Left drag or one finger turns it; right drag, Shift+left drag or two
     * fingers pan; the wheel or a pinch zooms.
     *
     * @throws Error if `setTopDown` hasn't been called.
     */
    enterOrbit(): void {
        if (this._disposed || this.orbiting) return;
        if (this._view === null) {
            throw new Error(
                'track-layout/three: call setTopDown before enterOrbit'
            );
        }
        const pose = orbitPoseFrom(this._view);
        const camera = this._orbitCamera;
        camera.up.copy(pose.up);
        camera.position.copy(pose.position);
        this._updateAspect();

        // OrbitControls reads the camera's up when it is built, and turns the
        // camera to the target on `update`.
        const controls = new OrbitControls(camera, this._canvas);
        controls.target.copy(pose.target);
        controls.maxPolarAngle = ORBIT_MAX_POLAR;
        controls.screenSpacePanning = true;
        // Shift+left drag pans: OrbitControls pans when Shift, Ctrl or Meta
        // is held on its rotate button, which is the left one.
        controls.update();
        controls.addEventListener('change', this._onOrbitChange);
        this._controls = controls;

        this._fitGround();
        this._ground.visible = true;
        this.requestRender();
    }

    /** Back to the straight-down view of the newest `setTopDown` view. */
    leaveOrbit(): void {
        const controls = this._controls;
        if (controls === null) return;
        controls.removeEventListener('change', this._onOrbitChange);
        controls.dispose();
        this._controls = null;
        this._ground.visible = false;
        this.requestRender();
    }

    /**
     * Mark the view as needing a render; with `autoRender`, schedule one on
     * the next animation frame.
     */
    requestRender(): void {
        if (this._disposed) return;
        this._needsRender = true;
        if (this._autoRender && this._frame === null && !this._contextLost) {
            this._frame = requestAnimationFrame(() => {
                this._frame = null;
                this.renderIfNeeded();
            });
        }
    }

    /**
     * Render if anything changed since the last render; whether it did. It
     * never renders before the first `setTopDown`, after the context is lost
     * or after `dispose`.
     */
    renderIfNeeded(): boolean {
        if (!this._needsRender || this._contextLost || this._disposed) {
            return false;
        }
        const view = this._view;
        if (view === null) return false;
        this._needsRender = false;
        const orbiting = this.orbiting;
        const camera = orbiting ? this._orbitCamera : this._topDownCamera;
        const materials = this._scene.materials;
        materials.update(camera, this._heightCss);
        materials.setDetailVisible(
            orbiting || view.zoomLevel >= DETAILED_TRACK_ZOOM
        );
        this._renderer.render(this._scene.scene, camera);
        return true;
    }

    /**
     * Calls `listener` once if the WebGL context is lost, for example when
     * the graphics card resets. The view doesn't try to restore it: it stops
     * rendering, and the caller should `dispose` it.
     */
    onContextLost(listener: () => void): () => void {
        this._lostListeners.add(listener);
        return () => {
            this._lostListeners.delete(listener);
        };
    }

    /**
     * Stop rendering, take the lights and ground out of the scene, and free
     * the renderer and its WebGL context. The canvas can't host another view
     * afterwards; give a new view a new canvas.
     */
    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this._cancelFrame();
        this._canvas.removeEventListener(
            'webglcontextlost',
            this._onContextLost
        );
        this._offSceneChange();
        this.leaveOrbit();
        this._lostListeners.clear();
        this._extras.removeFromParent();
        for (const child of this._extras.children) {
            if (child instanceof Light) child.dispose();
        }
        this._ground.geometry.dispose();
        this._ground.material.dispose();
        this._renderer.dispose();
        // Free the context now rather than at garbage collection: browsers
        // allow only a few at once and drop the oldest, which may be another
        // renderer's. A lost context has nothing left to free.
        if (!this._contextLost) this._renderer.forceContextLoss();
    }

    private readonly _onContextLost = (event: Event): void => {
        event.preventDefault();
        if (this._contextLost) return;
        this._contextLost = true;
        this._cancelFrame();
        for (const listener of [...this._lostListeners]) listener();
    };

    private readonly _onSceneChange = (): void => {
        if (this.orbiting) this._fitGround();
        this.requestRender();
    };

    private readonly _onOrbitChange = (): void => {
        this._updateNearFar();
        this.requestRender();
    };

    /** Lay the ground under the layout, and keep near and far around it. */
    private _fitGround(): void {
        const controls = this._controls;
        if (controls === null) return;
        const bounds = this._scene.bounds();
        const rect = groundRect(bounds, controls.target);
        fitGround(this._ground, rect);
        this._orbitContent = new Box3(
            new Vector3(rect.min.x, rect.min.y, 0),
            new Vector3(rect.max.x, rect.max.y, 0)
        ).union(bounds);
        this._updateNearFar();
    }

    private _updateNearFar(): void {
        const controls = this._controls;
        if (controls === null) return;
        const camera = this._orbitCamera;
        const { near, far } = orbitNearFar(
            camera.position,
            controls.target,
            this._orbitContent
        );
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();
    }

    private _updateAspect(): void {
        if (!(this._widthCss > 0 && this._heightCss > 0)) return;
        this._orbitCamera.aspect = this._widthCss / this._heightCss;
        this._orbitCamera.updateProjectionMatrix();
    }

    private _cancelFrame(): void {
        if (this._frame === null) return;
        cancelAnimationFrame(this._frame);
        this._frame = null;
    }
}
