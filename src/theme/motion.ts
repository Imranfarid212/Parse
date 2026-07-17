/**
 * Motion tokens. Kept out of tokens.ts so that file stays a pure design-token
 * module with no animation-library import.
 */
import { Easing } from 'react-native-reanimated';

/**
 * Material's "emphasized" curve — accelerates hard out of the gate, then stops
 * abruptly. For things entering or leaving the screen, where you want the
 * motion to feel decisive rather than to drift into place.
 */
export const EMPHASIZED = Easing.bezier(0.2, 0, 0, 1);

/**
 * The menu push: zero velocity at the start (a deliberate drag through the
 * first third), fast acceleration through the middle, soft settle at the end.
 */
export const EMPHASIZED_SETTLE = Easing.bezier(0.5, 0, 0.2, 1);

export const FOLDER_IN_MS = 520;
export const FOLDER_OUT_MS = 400;
