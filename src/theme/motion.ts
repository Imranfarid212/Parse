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

/**
 * Emphasized decelerate — leaves hard and settles slowly. Nearly half the
 * distance is covered in the first tenth of the duration, and the last half of
 * the duration covers only ~6% of it. For a thrown object, where the launch
 * should feel like force and the arrival should feel like it's coming to rest.
 *
 * The mirror of EMPHASIZED, which eases IN (only ~3% covered in the first
 * tenth) and therefore reads as deliberate rather than propelled.
 */
export const EMPHASIZED_DECELERATE = Easing.bezier(0.12, 0.75, 0.25, 1);

export const FOLDER_IN_MS = 520;
export const FOLDER_OUT_MS = 400;

/**
 * The receipt's flight into the folder. Sized so the tail has room: the last
 * fifth of the path is where the card aligns to the sheet and is then drawn
 * magnetically in, and under EMPHASIZED_DECELERATE that fifth occupies most of
 * the clock.
 */
export const FLIGHT_MS = 920;
