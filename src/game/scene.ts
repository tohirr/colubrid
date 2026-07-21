import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  GRID_SIZE,
  CELL,
  WALL_MODE,
  WALL_WARN_SECONDS,
  cellToWorld,
  eatRadiusForScore,
  speedForScore,
  type Cell,
} from "./config";
import {
  createGame,
  queueDirection,
  tick,
  type GameStatus,
} from "./state";
import { attachInput, type MoveIntent } from "./input";
import { attachTouch } from "./touch";
import { AXIS_DIRECTIONS, pickDirection } from "./steering";
import { createViewGizmo } from "./gizmo";
import { playEat, playDeath } from "./audio";

// Our whole 3D world is built once, inside App's mount effect — swapping this
// module's code at runtime would update a function nobody calls again. So we
// accept our own hot updates and answer them with a full page reload.
// (hot.decline() would be the idiomatic way, but the React plugin's refresh
// boundary at App.tsx absorbs the update before the decline is honored.)
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

// How the 3D world talks BACK to React: plain callbacks, fired only when
// the value actually changes. React re-renders the HUD; the canvas never
// re-renders because of React.
export interface SceneEvents {
  onScore: (score: number) => void;
  onStatus: (status: GameStatus) => void;
  onPause: (paused: boolean) => void;
  // Fired the moment the player actually drives the camera themselves
  // (OrbitControls' own "start" event — real mouse/two-finger input, never
  // the automated demo pan below). React uses this to cut the orbit-hint
  // demo short the instant it's served its purpose.
  onOrbitEngaged: () => void;
}

// ...and how React talks INTO the 3D world: the handle initScene returns.
export interface SceneHandle {
  restart: () => void;
  togglePause: () => void;
  setPaused: (paused: boolean) => void;
  setDemoOrbit: (active: boolean) => void;
  dispose: () => void;
}

// Builds the world: renderer, camera, lights, the arena, and the snake.
export function initScene(
  container: HTMLElement,
  events: SceneEvents,
): SceneHandle {
  // 1. The SCENE is the world: a tree of objects (meshes, lights, cameras).
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0e14);

  // Arena span in world units — camera framing and arena visuals all
  // derive from this, so changing GRID_SIZE rescales everything.
  const bounds = GRID_SIZE * CELL;
  // Radians/sec for the onboarding auto-pan — slow enough to read as a
  // deliberate demonstration, not a spin.
  const DEMO_ORBIT_SPEED = 0.35;

  // 2. The CAMERA. Pulled back far enough to frame the whole arena FOR
  //    THE CURRENT SCREEN SHAPE, slightly above the horizon so the floor
  //    grid reads in perspective.
  const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    0.1,
    bounds * 10,
  );

  // PORTRAIT-AWARE FRAMING. `fov` is the VERTICAL field of view; the
  // horizontal one follows from the aspect ratio. Compute the distance
  // that fits the arena vertically and the distance that fits it
  // horizontally, and stand back by whichever is larger — on a tall
  // phone screen the horizontal constraint wins, on a wide monitor the
  // vertical one does.
  const fitDistance = () => {
    const aspect = container.clientWidth / container.clientHeight;
    const fovV = THREE.MathUtils.degToRad(camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
    // Fit the arena's bounding SPHERE, not its front face: the camera
    // orbits freely, so the arena must fit at every rotation — and at a
    // 3/4 view the binding width is the cube's diagonal, not its side.
    // A sphere of radius r fits fully when distance ≥ r / sin(halfFov),
    // measured on whichever axis (vertical/horizontal) is tighter.
    const radius = (bounds / 2) * Math.sqrt(3);
    const halfFov = Math.min(fovV, fovH) / 2;
    return (radius / Math.sin(halfFov)) * 1.02;
  };

  camera.position
    .set(1.1, 0.8, 1.35) // the direction of the classic 3/4 view...
    .normalize()
    .multiplyScalar(fitDistance()); // ...at whatever distance fits
  camera.lookAt(0, 0, 0);

  // 3. The RENDERER draws the scene, from the camera's point of view,
  //    onto a <canvas> element — once per call to render().
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // ORBIT CONTROLS handles the two-finger / mouse-drag camera. The view
  // cube (below) is the one-finger way to do the same thing.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.enablePan = false; // keep the arena centered — orbit + zoom only
  controls.minDistance = bounds * 0.6;
  controls.maxDistance = fitDistance() * 2.2;
  // Keep the camera off the exact poles: looking straight down leaves no
  // usable screen direction for two of the axes, and steering degrades.
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI - 0.15;
  // Touch: ONE finger is reserved for swipe-steering and the view cube,
  // so OrbitControls answers only to TWO fingers — drag rotates, pinch
  // zooms.
  controls.touches.ONE = null as unknown as THREE.TOUCH;
  controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
  // "start" fires only from OrbitControls' own pointer handling — real
  // mouse/two-finger input — never from the automated demo pan (that
  // drives camera.position directly, bypassing these listeners).
  const onControlsStart = () => {
    demoOrbitActive = false;
    events.onOrbitEngaged();
  };
  controls.addEventListener("start", onControlsStart);

  // ---- THE ARENA ----------------------------------------------------
  // A GRID_SIZE³ lattice of cells. Mostly empty space — what we draw are
  // anchors that make that space readable:

  // (a) The shell: just the 12 edges of the arena's outer box.
  // EdgesGeometry extracts them; LineSegments draws lines, not triangles.
  const shellMaterial = new THREE.LineBasicMaterial({ color: 0x4a5872 });
  const shell = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(bounds, bounds, bounds)),
    shellMaterial,
  );
  scene.add(shell);

  // (b) The floor: a grid with one square per cell, sitting on the arena's
  // bottom face. Our strongest depth cue — every object reads against it.
  const floor = new THREE.GridHelper(bounds, GRID_SIZE, 0x334155, 0x1f2735);
  floor.position.y = -bounds / 2;
  scene.add(floor);

  // (c) The identification mark: a short RGB triad (+x red, +y green,
  // +z blue) at the arena's min corner — cell (0,0,0) lives here. The
  // view cube wears the same mark in the same corner, so the two can be
  // matched by eye from any angle.
  const axes = new THREE.AxesHelper(CELL * 2);
  axes.position.set(-bounds / 2, -bounds / 2, -bounds / 2);
  scene.add(axes);

  // (d) WALL PROXIMITY GLOW: one translucent plane per face, invisible
  // until the snake is heading at it with only a reaction-time's worth of
  // steps left. In solid mode it warns — faint yellow ramping up, red
  // once it kills. In portal mode it informs — a soft teal-white on both
  // the wall being approached AND the opposite one, where the snake will
  // re-emerge. The distance derives from the CURRENT speed via
  // WALL_WARN_SECONDS, so a faster game glows proportionally further out.
  const wallGeometry = new THREE.PlaneGeometry(bounds, bounds);
  interface WarnWall {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    axis: "x" | "y" | "z";
    sign: 1 | -1;
    opacity: number; // animated toward `target` each frame
    target: number;
  }
  const warnWalls: WarnWall[] = [];
  {
    const faces: Array<[WarnWall["axis"], WarnWall["sign"], THREE.Euler]> = [
      ["x", 1, new THREE.Euler(0, Math.PI / 2, 0)],
      ["x", -1, new THREE.Euler(0, Math.PI / 2, 0)],
      ["y", 1, new THREE.Euler(Math.PI / 2, 0, 0)],
      ["y", -1, new THREE.Euler(Math.PI / 2, 0, 0)],
      ["z", 1, new THREE.Euler(0, 0, 0)],
      ["z", -1, new THREE.Euler(0, 0, 0)],
    ];
    for (const [axis, sign, rotation] of faces) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide, // visible from inside and outside alike
        depthWrite: false, // never occlude the snake behind it
      });
      const mesh = new THREE.Mesh(wallGeometry, material);
      mesh.rotation.copy(rotation);
      mesh.position.set(
        axis === "x" ? (sign * bounds) / 2 : 0,
        axis === "y" ? (sign * bounds) / 2 : 0,
        axis === "z" ? (sign * bounds) / 2 : 0,
      );
      mesh.visible = false;
      scene.add(mesh);
      warnWalls.push({ mesh, material, axis, sign, opacity: 0, target: 0 });
    }
  }
  // --------------------------------------------------------------------

  // ---- THE SNAKE (rendering side) ------------------------------------
  // The game state owns the truth (an array of cells); these meshes are a
  // disposable picture of it, rebuilt from state every frame. One shared
  // geometry + two shared materials, however long the snake grows.
  // Segments are drawn slightly smaller than a cell so they read as beads.
  const segmentGeometry = new THREE.BoxGeometry(
    CELL * 0.92,
    CELL * 0.92,
    CELL * 0.92,
  );
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0x86efac });
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x16a34a });
  const snakeGroup = new THREE.Group();
  scene.add(snakeGroup);

  // ---- THE FOOD -------------------------------------------------------
  // An octahedron, not a cube — in a world of axis-aligned boxes, a
  // different silhouette is spottable at a glance. `emissive` makes the
  // material glow from within, independent of the lights.
  const food = new THREE.Mesh(
    new THREE.OctahedronGeometry(CELL * 0.45),
    new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xb45309,
      emissiveIntensity: 0.5,
    }),
  );
  scene.add(food);
  // The food is drawn at the size of its EAT ZONE (the beginner ramp makes
  // early food a 3³ target — see eatRadiusForScore), so what you see is
  // honestly what you can hit. Eased so the shrink is a transition, not a
  // pop.
  let foodZoneScale = 1 + 2 * eatRadiusForScore(0);

  // ALIGNMENT PLANES — always on, the only depth cue for the food's
  // position: a translucent plane per axis, spanning the arena
  // wall-to-wall through the food. A plane lights up whenever the head
  // shares that ONE axis's coordinate with the food — the snake is
  // somewhere on the food's layer along that axis.
  const GUIDE_ALIGNED_COLOR = 0x22c55e;
  const makeGuidePlane = (rotation: THREE.Euler) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(bounds, bounds),
      new THREE.MeshBasicMaterial({
        color: GUIDE_ALIGNED_COLOR,
        transparent: true,
        opacity: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.rotation.copy(rotation);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  };
  // Perpendicular to X (spans Y-Z) — lights up when head.x === food.x.
  const planeX = makeGuidePlane(new THREE.Euler(0, Math.PI / 2, 0));
  // Perpendicular to Y (spans X-Z, lies flat like the floor) — head.y === food.y.
  const planeY = makeGuidePlane(new THREE.Euler(-Math.PI / 2, 0, 0));
  // Perpendicular to Z (spans X-Y, the default plane orientation) — head.z === food.z.
  const planeZ = makeGuidePlane(new THREE.Euler(0, 0, 0));
  // ----------------------------------------------------------------------

  let game = createGame();

  // ---- SCREEN-MAPPED STEERING -----------------------------------------
  // A swipe (or arrow key) means "go the way it LOOKS on screen." For each
  // world axis, project the head and head+axis into screen pixels; the
  // difference is that axis's on-screen direction. steering.ts then picks
  // the axis best matching the swipe. Depth-pointing axes project short
  // and can't win — to steer in depth, you rotate the view first (that's
  // the view cube's job).
  const tmpBase = new THREE.Vector3();
  const tmpTip = new THREE.Vector3();
  const projectAxis = (axis: Cell) => {
    const w = renderer.domElement.clientWidth;
    const h = renderer.domElement.clientHeight;
    const head = cellToWorld(game.snake[0]);
    // .project() maps world → NDC (−1..1 both axes, y UP); scale to
    // pixels and flip y to get screen conventions.
    tmpBase.set(head[0], head[1], head[2]).project(camera);
    tmpTip
      .set(head[0] + axis.x, head[1] + axis.y, head[2] + axis.z)
      .project(camera);
    return {
      sx: ((tmpTip.x - tmpBase.x) * w) / 2,
      sy: (-(tmpTip.y - tmpBase.y) * h) / 2,
    };
  };

  const steerBySwipe = (dx: number, dy: number) => {
    const projected = AXIS_DIRECTIONS.map((axis) => ({
      axis,
      ...projectAxis(axis),
    }));
    const dir = pickDirection(dx, dy, projected);
    if (dir) queueDirection(game, dir);
  };

  // Keyboard reuses the same machinery: an arrow key is just a fixed
  // "swipe" in screen space. Space/Shift keep their absolute meaning —
  // a keyboard has enough keys for the luxury.
  const KEY_SWIPES: Record<string, [number, number]> = {
    forward: [0, -1],
    back: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };
  const sendIntent = (intent: MoveIntent) => {
    if (intent === "up") return queueDirection(game, { x: 0, y: 1, z: 0 });
    if (intent === "down") return queueDirection(game, { x: 0, y: -1, z: 0 });
    const [dx, dy] = KEY_SWIPES[intent];
    steerBySwipe(dx, dy);
  };

  // PAUSE is a loop concern, not a game rule: the game state never hears
  // about it — the scene simply stops feeding it ticks. Rendering, the
  // camera, and the gizmo all keep working, so a paused game is also a
  // "free look around" mode.
  let paused = false;
  const setPaused = (next: boolean) => {
    if (paused === next) return;
    paused = next;
    events.onPause(paused);
  };
  const togglePause = () => {
    if (game.status === "dead") return; // nothing meaningful to pause
    setPaused(!paused);
  };

  const restart = () => {
    game = createGame(); // fresh world, same rules
    setPaused(false);
  };

  const detachInput = attachInput(sendIntent, restart, togglePause);
  const detachTouch = attachTouch(renderer.domElement, steerBySwipe, (x, y) =>
    gizmo.containsPoint(x, y),
  );

  // ---- THE VIEW CUBE ---------------------------------------------------
  // One-finger camera control: drag the cube to orbit freely, tap a face
  // to snap the view square onto that axis (animated).
  const gizmo = createViewGizmo(renderer, camera, controls.target);

  // Manual orbiting shared by gizmo drags and snap animation. It moves
  // camera.position directly; OrbitControls recomputes its state from the
  // actual position each update, so the two coexist.
  const spherical = new THREE.Spherical();
  const tmpOffset = new THREE.Vector3();
  // The auto-pan demo (see setDemoOrbit below) also drives the camera
  // through orbitBy, from the animate loop rather than a user gesture.
  let demoOrbitActive = false;
  const orbitBy = (dTheta: number, dPhi: number) => {
    snapAnim = null; // manual control overrides any snap in flight
    tmpOffset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(tmpOffset);
    spherical.theta -= dTheta;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi - dPhi,
      controls.minPolarAngle,
      controls.maxPolarAngle,
    );
    tmpOffset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(tmpOffset);
    camera.lookAt(controls.target);
  };

  // Tap-to-snap: animate theta/phi to face the tapped axis head-on.
  // Interpolating the ANGLES (not positions) keeps the orbit radius fixed
  // and the motion on the orbit sphere.
  let snapAnim: {
    t: number;
    fromTheta: number;
    dTheta: number;
    fromPhi: number;
    dPhi: number;
    radius: number;
  } | null = null;

  const snapToAxis = (normal: THREE.Vector3) => {
    tmpOffset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(tmpOffset);
    const to = new THREE.Spherical().setFromVector3(normal);
    // Not exactly onto the pole for top/bottom — keep a little tilt so
    // the scene stays readable and steering stays unambiguous.
    const toPhi = THREE.MathUtils.clamp(to.phi, 0.35, Math.PI - 0.35);
    // At the poles theta is meaningless — keep the current one.
    const toTheta =
      Math.abs(normal.y) > 0.9 ? spherical.theta : to.theta;
    // Take the short way around the circle.
    const dTheta =
      ((toTheta - spherical.theta + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    snapAnim = {
      t: 0,
      fromTheta: spherical.theta,
      dTheta,
      fromPhi: spherical.phi,
      dPhi: toPhi - spherical.phi,
      radius: tmpOffset.length(),
    };
  };

  // Pointer plumbing for the cube. Registered on WINDOW in the CAPTURE
  // phase so it runs before OrbitControls' own listeners and can claim
  // gizmo-area presses for itself (stopPropagation keeps them from ever
  // reaching OrbitControls).
  let gizmoDrag: { x: number; y: number; travel: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    if (!gizmo.containsPoint(e.clientX, e.clientY)) return;
    e.stopPropagation();
    e.preventDefault();
    gizmoDrag = { x: e.clientX, y: e.clientY, travel: 0 };
    demoOrbitActive = false;
    events.onOrbitEngaged();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!gizmoDrag) return;
    const dx = e.clientX - gizmoDrag.x;
    const dy = e.clientY - gizmoDrag.y;
    gizmoDrag.travel += Math.hypot(dx, dy);
    orbitBy(dx * 0.012, dy * 0.012);
    gizmoDrag.x = e.clientX;
    gizmoDrag.y = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!gizmoDrag) return;
    // Barely moved = a tap → snap to the tapped face or corner.
    if (gizmoDrag.travel < 5) {
      const dir = gizmo.snapDirectionAt(e.clientX, e.clientY);
      if (dir) snapToAxis(dir);
    }
    gizmoDrag = null;
  };
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  // ----------------------------------------------------------------------

  // Dev-only debug handle: poke the live game from the browser console
  // (window.__colubrid). import.meta.env.DEV is false in production builds,
  // so Vite strips this whole block out of the shipped bundle.
  if (import.meta.env.DEV) {
    (window as { __colubrid?: object }).__colubrid = {
      get game() {
        return game;
      },
      scene,
      camera,
      steerBySwipe,
      snapToAxis,
      gizmo,
    };
  }

  // Make the meshes match the state: one cube per segment, head tinted
  // lighter. The pool grows/shrinks as the snake does. Rotation is reset
  // because the death tumble (below) spins segments — a restart must
  // hand back tidy cubes.
  const syncSnake = () => {
    while (snakeGroup.children.length < game.snake.length) {
      snakeGroup.add(new THREE.Mesh(segmentGeometry, bodyMaterial));
    }
    while (snakeGroup.children.length > game.snake.length) {
      snakeGroup.remove(snakeGroup.children[snakeGroup.children.length - 1]);
    }
    game.snake.forEach((cell, i) => {
      const mesh = snakeGroup.children[i] as THREE.Mesh;
      mesh.position.set(...cellToWorld(cell));
      mesh.rotation.set(0, 0, 0);
      mesh.material = i === 0 ? headMaterial : bodyMaterial;
    });
  };

  // ---- TRANSIENT EFFECTS ----------------------------------------------
  // Juice: short-lived visuals that belong to no game state. Each effect
  // is an object that advances itself per frame and reports when it's
  // done; the loop disposes finished ones. The game rules never know.
  interface Effect {
    update(dt: number): boolean; // false = finished
    dispose(): void;
  }
  const effects: Effect[] = [];

  // Eating: the food flares up and dissolves at the spot it was eaten.
  const spawnEatPop = (at: THREE.Vector3) => {
    const material = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(food.geometry, material); // shared geometry
    mesh.position.copy(at);
    scene.add(mesh);
    let age = 0;
    effects.push({
      update(step) {
        age += step;
        const k = age / 0.3; // 0.3s of life
        mesh.scale.setScalar(1 + k * 2.2);
        mesh.rotation.y += step * 4;
        material.opacity = Math.max(0, 0.9 * (1 - k));
        return k < 1;
      },
      dispose() {
        scene.remove(mesh);
        material.dispose(); // geometry is the food's — not ours to free
      },
    });
  };

  // Death: the snake bursts apart — each pooled segment gets a fling
  // velocity and a spin, then gravity does the storytelling. While this
  // plays, syncSnake is suspended (it would snap the cubes back).
  interface TumblingSegment {
    mesh: THREE.Object3D;
    velocity: THREE.Vector3;
    spin: THREE.Vector3;
  }
  let deathTumble: { age: number; segments: TumblingSegment[] } | null = null;
  const startDeathTumble = () => {
    deathTumble = {
      age: 0,
      segments: snakeGroup.children.map((mesh) => ({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          2 + Math.random() * 3,
          (Math.random() - 0.5) * 4,
        ),
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 8,
        ),
      })),
    };
  };
  // ----------------------------------------------------------------------

  // LIGHTS — two-light rig, the workhorse setup for stylized 3D:
  //
  // HemisphereLight is the FILL: directionless light blended from a "sky"
  // color (hitting up-facing surfaces) and a "ground" color (down-facing).
  // Its job is to make sure nothing is ever 100% black.
  const fill = new THREE.HemisphereLight(0xbfd4ff, 0x3a3f4a, 0.5);
  scene.add(fill);

  // DirectionalLight is the KEY: parallel rays, like the sun. Faces angled
  // toward it are bright, faces angled away are dim — that per-face contrast
  // is what makes a shape read as 3D. Its position only defines the ray
  // direction (position → target at the origin); distance doesn't matter.
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(5, 8, 3);
  scene.add(sun);

  // TWO LOOPS, TWO SPEEDS. The render loop runs every frame (~60x/s).
  // The GAME advances only every TICK_SECONDS — we accumulate frame time
  // and step the simulation whenever a full tick's worth has passed.
  // (The `while` matters: after a laggy frame the game catches up instead
  // of slowing down.)
  const timer = new THREE.Timer();
  let unsimulatedTime = 0;
  let lastScore = -1;
  let lastStatus: GameStatus | null = null;
  // Death is announced to React late, so the tumble animation gets its
  // moment before the overlay drops in.
  const DEATH_OVERLAY_DELAY = 0.8;
  let deathNotifyIn: number | null = null;
  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = timer.getDelta();
    if (!paused) {
      unsimulatedTime += dt;
      // Tick length is DYNAMIC now: the game speeds up as the score grows
      // (after a grace period), so we ask config for the current pace
      // instead of using a constant.
      const tickSeconds = 1 / speedForScore(game.score);
      // Browsers stop firing animation frames entirely while the tab is
      // hidden, so the first delta after returning can be minutes long —
      // uncapped, the while-loop below would replay hundreds of ticks in
      // one frame and the snake would die instantly. The cap turns "tab
      // was hidden" into "game was paused."
      unsimulatedTime = Math.min(unsimulatedTime, tickSeconds * 2);
      while (unsimulatedTime >= tickSeconds) {
        unsimulatedTime -= tickSeconds;
        tick(game);
      }
    }

    // Advance a tap-to-snap camera animation, if one is in flight.
    if (snapAnim) {
      snapAnim.t = Math.min(1, snapAnim.t + dt / 0.4);
      const k = 1 - (1 - snapAnim.t) ** 3; // easeOutCubic
      spherical.set(
        snapAnim.radius,
        snapAnim.fromPhi + snapAnim.dPhi * k,
        snapAnim.fromTheta + snapAnim.dTheta * k,
      );
      camera.position
        .copy(controls.target)
        .add(tmpOffset.setFromSpherical(spherical));
      camera.lookAt(controls.target);
      if (snapAnim.t >= 1) snapAnim = null;
    } else if (demoOrbitActive) {
      orbitBy(dt * DEMO_ORBIT_SPEED, 0); // slow onboarding pan
    } else {
      controls.update(); // advances two-finger/mouse damping inertia
    }

    // While the death tumble plays, IT owns the segment meshes and
    // syncSnake stays out; any other time state is the boss. A restart
    // (status back to running) cancels the tumble.
    if (deathTumble && game.status === "running") deathTumble = null;
    if (deathTumble) {
      deathTumble.age += dt;
      if (deathTumble.age < 1.6) {
        for (const seg of deathTumble.segments) {
          seg.velocity.y -= 12 * dt; // gravity
          seg.mesh.position.addScaledVector(seg.velocity, dt);
          seg.mesh.rotation.x += seg.spin.x * dt;
          seg.mesh.rotation.y += seg.spin.y * dt;
          seg.mesh.rotation.z += seg.spin.z * dt;
        }
      }
    } else {
      syncSnake();
    }

    // Advance and prune transient effects.
    for (let i = effects.length - 1; i >= 0; i--) {
      if (!effects[i].update(dt)) {
        effects[i].dispose();
        effects.splice(i, 1);
      }
    }

    // Food: position from state; the bob, spin, and pulse are pure
    // decoration, driven by elapsed time — renderer-side state the game
    // knows nothing about, exactly like the meshes themselves.
    const elapsed = timer.getElapsed();
    const [fx, fy, fz] = cellToWorld(game.food);
    food.position.set(fx, fy + Math.sin(elapsed * 2.5) * 0.12, fz);
    food.rotation.y = elapsed * 1.2;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4);
    const zoneTarget = 1 + 2 * eatRadiusForScore(game.score);
    foodZoneScale += (zoneTarget - foodZoneScale) * Math.min(1, dt * 3);
    food.scale.setScalar((1 + pulse * 0.5) * foodZoneScale);
    (food.material as THREE.MeshStandardMaterial).emissiveIntensity =
      0.4 + pulse * 0.8;

    // Alignment planes — always on, one lights up per axis on a
    // single-coordinate match with the food (see declaration above).
    {
      const head = game.snake[0];
      planeX.position.set(food.position.x, 0, 0);
      planeY.position.set(0, food.position.y, 0);
      planeZ.position.set(0, 0, food.position.z);
      planeX.visible = head.x === game.food.x;
      planeY.visible = head.y === game.food.y;
      planeZ.visible = head.z === game.food.z;
    }

    // Death indicator, minimum viable edition: the arena flushes red.
    // The living shell hints at the wall mode — teal walls teleport.
    const livingShell = WALL_MODE === "portal" ? 0x3e7d82 : 0x4a5872;
    shellMaterial.color.set(game.status === "dead" ? 0xb91c1c : livingShell);

    // Wall proximity: light up the wall the snake is HEADING AT, ramping
    // opacity as the remaining steps shrink. Solid mode warns (yellow →
    // red on impact); portal mode informs (teal-white on the entry wall
    // AND the exit wall opposite it). Opacities ease toward their
    // targets for a soft fade instead of a blink.
    {
      for (const w of warnWalls) w.target = 0;
      const head = game.snake[0];
      const dir = game.direction;
      const axis: "x" | "y" | "z" = dir.x !== 0 ? "x" : dir.y !== 0 ? "y" : "z";
      const sign: 1 | -1 = dir[axis] > 0 ? 1 : -1;
      const steps = sign > 0 ? GRID_SIZE - 1 - head[axis] : head[axis];
      const warnSteps = Math.max(
        2,
        Math.ceil(WALL_WARN_SECONDS * speedForScore(game.score)),
      );
      const facing = warnWalls.find((w) => w.axis === axis && w.sign === sign)!;
      const ramp = 1 - steps / warnSteps;
      if (WALL_MODE === "solid") {
        if (game.status === "dead") {
          if (game.deathCause === "wall") {
            facing.material.color.set(0xef4444);
            facing.target = 0.22;
          }
        } else if (steps <= warnSteps) {
          facing.material.color.set(0xfacc15);
          // Faint on first warning, denser as impact nears — but always
          // translucent enough to see the arena through.
          facing.target = 0.06 + 0.14 * ramp;
        }
      } else if (game.status === "running" && steps <= warnSteps) {
        const exit = warnWalls.find((w) => w.axis === axis && w.sign === -sign)!;
        facing.material.color.set(0xbfe8ec);
        exit.material.color.set(0xbfe8ec);
        // Subtler than the solid-mode warning: nothing bad is about to
        // happen — it just directs the eye to where the snake will be.
        facing.target = 0.03 + 0.09 * ramp;
        exit.target = 0.03 + 0.09 * ramp;
      }
      for (const w of warnWalls) {
        w.opacity += (w.target - w.opacity) * Math.min(1, dt * 10);
        w.material.opacity = w.opacity;
        w.mesh.visible = w.opacity > 0.005;
      }
    }

    // Tell React only when something it displays has changed.
    if (game.score !== lastScore) {
      // Score went UP = something was eaten just now, at the head's cell.
      // (Down means a restart reset it — no celebration for that.)
      if (game.score > lastScore && lastScore >= 0) {
        spawnEatPop(new THREE.Vector3(...cellToWorld(game.snake[0])));
        playEat(game.score);
        // Haptics where supported (Android; iOS browsers ignore it) — a
        // short tap for a bite. `?.` because desktop lacks it entirely.
        navigator.vibrate?.(15);
      }
      lastScore = game.score;
      events.onScore(game.score);
    }
    if (game.status !== lastStatus) {
      lastStatus = game.status;
      if (game.status === "dead") {
        // Kick off the tumble now; tell React later so the animation
        // isn't hidden behind the game-over overlay.
        startDeathTumble();
        playDeath();
        navigator.vibrate?.([60, 40, 90]); // a stumble, not a tap
        deathNotifyIn = DEATH_OVERLAY_DELAY;
      } else {
        deathNotifyIn = null;
        events.onStatus(game.status);
      }
    }
    if (deathNotifyIn !== null) {
      deathNotifyIn -= dt;
      if (deathNotifyIn <= 0) {
        deathNotifyIn = null;
        events.onStatus("dead");
      }
    }

    renderer.render(scene, camera);
    gizmo.render(); // corner viewport, drawn on top
  });

  // Keep the image un-stretched when the window resizes — and reframe:
  // a rotation from landscape to portrait changes which dimension
  // constrains the fit, so the camera re-seats itself at the new fitting
  // distance (keeping its orbit direction).
  const onResize = () => {
    // A hidden or mid-layout container can report 0×0; the math below
    // would turn that into aspect = 0/0 = NaN, and a NaN camera position
    // never recovers (every further operation keeps it NaN). Skip until
    // there's a real size to fit.
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
    const fit = fitDistance();
    controls.maxDistance = fit * 2.2;
    tmpOffset.copy(camera.position).sub(controls.target);
    // Recover if the camera was already poisoned (e.g. a resize that DID
    // slip through at 0×0 before this guard existed): re-seat it on the
    // default 3/4 view instead of normalizing a NaN vector.
    if (!Number.isFinite(tmpOffset.lengthSq()) || tmpOffset.lengthSq() === 0) {
      tmpOffset.set(1.1, 0.8, 1.35);
    }
    tmpOffset.setLength(fit);
    camera.position.copy(controls.target).add(tmpOffset);
    camera.lookAt(controls.target);
  };
  window.addEventListener("resize", onResize);

  const dispose = () => {
    detachInput();
    detachTouch();
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    controls.removeEventListener("start", onControlsStart);
    controls.dispose(); // unhooks its mouse/touch listeners
    gizmo.dispose();
    window.removeEventListener("resize", onResize);
    renderer.setAnimationLoop(null);
    // GPU buffers aren't garbage-collected with the JS objects that own
    // them — walk the scene and free every geometry and material we made.
    // (Shared ones get dispose() called more than once; that's harmless.)
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const m of materials) m.dispose();
      }
    });
    renderer.dispose();
    container.removeChild(renderer.domElement);
  };

  return {
    restart,
    togglePause,
    setPaused,
    setDemoOrbit: (active: boolean) => {
      demoOrbitActive = active;
    },
    dispose,
  };
}
