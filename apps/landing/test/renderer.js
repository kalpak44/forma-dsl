/**
 * A renderer that records instead of drawing.
 *
 * `THREE.WebGLRenderer` needs a GPU, which is exactly why `Stage` and `Hero` take one as a
 * parameter. Everything they do that is worth asserting — what is in the scene, where the
 * camera ends up, whether a frame was drawn at all — happens before the draw call, so a
 * counter is all a test needs on the other side of it.
 */

/**
 * @returns {{ frames: number, size: [number, number] | null, pixelRatio: number,
 *   setPixelRatio: Function, setSize: Function, render: Function }} The stand-in.
 */
export function fakeRenderer() {
  return {
    frames: 0,
    size: null,
    pixelRatio: 1,
    setPixelRatio(ratio) { this.pixelRatio = ratio; },
    setSize(width, height) { this.size = [width, height]; },
    render() { this.frames += 1; },
  };
}
