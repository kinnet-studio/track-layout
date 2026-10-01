/**
 * Where each module moved from banana (b26692b) now lives in track-layout.
 * Keys and values are repo-relative module ids without an extension.
 */
export const MODULE_MAP: Record<string, string> = {
    'src/utils': 'src/shared/entity-manager',
    'src/trains/r-tree': 'src/shared/r-tree',
    'src/trains/tracks/constants': 'src/tracks/constants',
    'src/trains/tracks/gauge-presets': 'src/tracks/gauge-presets',
    'src/trains/tracks/joint-direction-preference-map':
        'src/tracks/joint-direction-preference-map',
    'src/trains/tracks/parallel-spacing': 'src/tracks/parallel-spacing',
    'src/trains/tracks/track': 'src/tracks/track',
    'src/trains/tracks/trackcurve-manager': 'src/tracks/trackcurve-manager',
    'src/trains/tracks/trackjoint-manager': 'src/tracks/trackjoint-manager',
    'src/trains/tracks/types': 'src/tracks/types',
    'src/trains/tracks/utils': 'src/tracks/utils',
    'src/stations/arc-length-resolver': 'src/stations/arc-length-resolver',
    'src/stations/platform-offset': 'src/stations/platform-offset',
    'src/stations/spine-utils': 'src/stations/spine-utils',
    'src/stations/station-factory': 'src/stations/station-factory',
    'src/stations/station-manager': 'src/stations/station-manager',
    'src/stations/stop-position-utils': 'src/stations/stop-position-utils',
    'src/stations/track-aligned-platform-manager':
        'src/stations/track-aligned-platform-manager',
    'src/stations/track-aligned-platform-migration':
        'src/stations/track-aligned-platform-migration',
    'src/stations/track-aligned-platform-types':
        'src/stations/track-aligned-platform-types',
    'src/stations/types': 'src/stations/types',
    'src/trains/tracks/new-joint': 'src/editing/new-joint',
    'src/trains/tracks/duplicate-geometry': 'src/editing/duplicate-geometry',
    'src/trains/input-state-machine/types': 'src/editing/types',
    'src/trains/input-state-machine/curve-engine': 'src/editing/curve-engine',
    'src/trains/input-state-machine/layout-kmt-state-machine':
        'src/editing/layout-kmt-state-machine',
    'src/trains/input-state-machine/joint-direction-state-machine':
        'src/editing/joint-direction-state-machine',
    'src/trains/input-state-machine/duplicate-to-side-engine':
        'src/editing/duplicate-to-side-engine',
    'src/trains/input-state-machine/duplicate-to-side-state-machine':
        'src/editing/duplicate-to-side-state-machine',
    'src/trains/input-state-machine/catenary-layout-engine':
        'src/editing/catenary-layout-engine',
    'src/trains/input-state-machine/catenary-layout-state-machine':
        'src/editing/catenary-layout-state-machine',
};

/**
 * Package specifiers that banana files import, mapped to the track-layout
 * module each one resolves to inside this repo.
 */
export const PACKAGE_MAP: Record<string, string> = {
    'track-layout': 'src/index',
};

/** The package entry point that exposes a track-layout module. */
export function entryPointFor(moduleId: string): string {
    return moduleId.startsWith('src/editing/')
        ? 'track-layout/editing'
        : 'track-layout';
}
