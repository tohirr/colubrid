import * as THREE from "three";

// The VIEW CUBE: a miniature of the arena in the corner — near-transparent
// volume, edge lines, and an RGB axis triad in its (0,0,0) corner that
// matches the arena's, so you can always match the two cubes' orientation
// at a glance. Drag it with one finger to orbit the main camera; tap a
// face to snap the view square onto that axis.
//
// It is not a separate canvas — it's a second, tiny scene rendered into a
// scissored viewport of the MAIN renderer, after the main scene each
// frame. Scissoring confines the clear + draw to the corner rectangle.

export interface ViewGizmo {
  render(): void;
  // Is this canvas-space point (CSS px, y down) inside the gizmo's corner?
  containsPoint(x: number, y: number): boolean;
  // Raycast a point against the cube; returns the tapped face's outward
  // normal (the direction the camera should snap to) or null on miss.
  snapDirectionAt(x: number, y: number): THREE.Vector3 | null;
  dispose(): void;
}

const SIZE_PX = 84;
const MARGIN_PX = 18;
const HALF = 0.85; // cube half-extent in gizmo units

export function createViewGizmo(
  renderer: THREE.WebGLRenderer,
  mainCamera: THREE.Camera,
  target: THREE.Vector3,
): ViewGizmo {
  const scene = new THREE.Scene();
  // Orthographic: a gizmo wants no perspective distortion.
  const camera = new THREE.OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);

  // The body: a barely-there volume, like the arena seen from afar.
  // depthWrite off so the ghostly faces never occlude the edge lines.
  const faceMaterial = new THREE.MeshBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2),
    faceMaterial,
  );
  scene.add(cube);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(cube.geometry),
    new THREE.LineBasicMaterial({ color: 0x94a3b8 }),
  );
  cube.add(edges);

  // The identification mark: a short RGB triad (+x red, +y green, +z
  // blue) sprouting from the cube's min corner — the same mark the arena
  // wears at cell (0,0,0). Line the colors up and the two cubes are in
  // the same orientation.
  const axes = new THREE.AxesHelper(0.55);
  axes.position.set(-HALF, -HALF, -HALF);
  cube.add(axes);

  // A floor grid on the bottom face, echoing the arena's — a coarse one;
  // at this size it marks WHICH face is down, not individual cells.
  const grid = new THREE.GridHelper(HALF * 2, 6, 0x7c8aa3, 0x55627a);
  grid.position.y = -HALF;
  cube.add(grid);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const viewDir = new THREE.Vector3();

  // The gizmo's rectangle in canvas CSS coordinates (origin top-left).
  const rect = () => ({
    x: renderer.domElement.clientWidth - SIZE_PX - MARGIN_PX,
    y: renderer.domElement.clientHeight - SIZE_PX - MARGIN_PX,
    size: SIZE_PX,
  });

  return {
    render() {
      // Mirror the main camera's orbit: same direction from the target,
      // fixed distance — so the cube turns exactly as the world appears to.
      viewDir.copy(mainCamera.position).sub(target).normalize();
      camera.position.copy(viewDir).multiplyScalar(4);
      camera.lookAt(0, 0, 0);

      const r = rect();
      const h = renderer.domElement.clientHeight;
      // setViewport/setScissor measure from the BOTTOM-left, unlike DOM.
      const vy = h - r.y - r.size;
      renderer.setViewport(r.x, vy, r.size, r.size);
      renderer.setScissor(r.x, vy, r.size, r.size);
      renderer.setScissorTest(true);
      const auto = renderer.autoClear;
      renderer.autoClear = false; // keep the main scene's pixels...
      renderer.clearDepth(); // ...but start fresh depth so the cube wins
      renderer.render(scene, camera);
      renderer.autoClear = auto;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, renderer.domElement.clientWidth, h);
    },

    containsPoint(x, y) {
      const r = rect();
      return x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size;
    },

    snapDirectionAt(x, y) {
      const r = rect();
      pointer.set(
        ((x - r.x) / r.size) * 2 - 1,
        -(((y - r.y) / r.size) * 2 - 1),
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(cube, false)[0];
      return hit?.face ? hit.face.normal.clone() : null;
    },

    dispose() {
      cube.geometry.dispose();
      faceMaterial.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
      axes.dispose();
      grid.dispose();
    },
  };
}
