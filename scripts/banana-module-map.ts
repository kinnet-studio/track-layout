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
};
