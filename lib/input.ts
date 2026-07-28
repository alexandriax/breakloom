export type BufferedControlEdge = {
  pressed: boolean;
  released: boolean;
  nextLatch: boolean;
  nextConsumedPresses: number;
};

/**
 * Resolves a held-button edge together with a monotonic press sequence.
 * The sequence preserves a quick tap even when press and release both occur
 * between rendered simulation frames.
 */
export function readBufferedControlEdge(
  down: boolean,
  wasDown: boolean,
  pressSequence: number,
  consumedPresses: number,
): BufferedControlEdge {
  const bufferedPress = pressSequence > consumedPresses;
  return {
    pressed: bufferedPress || (down && !wasDown),
    released: !down && wasDown,
    nextLatch: down,
    nextConsumedPresses: pressSequence,
  };
}
