import { describe, expect, it } from 'vitest';
import {
  BlinkDetector,
  FACE_GUIDE,
  assessFace,
  captureSteps,
  faceWords,
  patchStats,
  placeInCircle,
  poseFromMatrix,
  turnProgress,
  type FaceObservation,
} from './face-guide';

const video = { width: 720, height: 960 };

/** A face centred in the visible square, filling about 55% of it. */
function face(overrides: Partial<FaceObservation> = {}): FaceObservation {
  const width = 0.55;
  const height = width * (720 / 960) * 1.3;
  return {
    faces: 1,
    box: { x: 0.5 - width / 2, y: 0.5 - height / 2, width, height },
    yaw: 0,
    pitch: 0.05,
    roll: 0,
    blink: 0.1,
    nose: { x: 0.5, y: 0.5 },
    ...overrides,
  };
}

const assess = (observation: FaceObservation | null, step: 'front' | 'blink' | 'left' | 'right' = 'front', extra: { luma?: number | null; motion?: number } = {}) =>
  assessFace({ observation, step, video, luma: extra.luma ?? 120, motion: extra.motion ?? 0 });

describe('placeInCircle', () => {
  it('maps a centred face to the circle centre on a portrait frame', () => {
    const place = placeInCircle({ x: 0.25, y: 0.4, width: 0.5, height: 0.2 }, video);
    expect(place.cx).toBeCloseTo(0.5, 5);
    expect(place.cy).toBeCloseTo(0.5, 5);
    expect(place.fill).toBeCloseTo(0.5, 5);
  });

  it('accounts for the cropped sides of a landscape frame', () => {
    // 1280 x 720: only the middle 720 px are visible; a face 360 px wide fills half the circle.
    const place = placeInCircle({ x: (640 - 180) / 1280, y: 0.3, width: 360 / 1280, height: 0.4 }, { width: 1280, height: 720 });
    expect(place.cx).toBeCloseTo(0.5, 5);
    expect(place.fill).toBeCloseTo(0.5, 5);
  });
});

describe('poseFromMatrix', () => {
  const rotationY = (angle: number) => [
    Math.cos(angle), 0, -Math.sin(angle), 0,
    0, 1, 0, 0,
    Math.sin(angle), 0, Math.cos(angle), 0,
    0, 0, -60, 1,
  ];

  it('reads no rotation as facing the camera', () => {
    const pose = poseFromMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -60, 1]);
    expect(pose.yaw).toBeCloseTo(0, 6);
    expect(pose.pitch).toBeCloseTo(0, 6);
    expect(pose.roll).toBeCloseTo(0, 6);
  });

  it('reads a rotation about the vertical axis as yaw, with its sign', () => {
    expect(poseFromMatrix(rotationY(-0.5)).yaw).toBeCloseTo(0.5, 6);
    expect(poseFromMatrix(rotationY(0.3)).yaw).toBeCloseTo(-0.3, 6);
  });
});

describe('assessFace', () => {
  it('asks for a face when there is none, and for one person only', () => {
    expect(assess(null)).toBe('searching');
    expect(assess(face({ faces: 2 }))).toBe('several');
  });

  it('guides the face into the circle at the right distance', () => {
    expect(assess(face({ box: { x: 0.02, y: 0.3, width: 0.4, height: 0.3 } }))).toBe('center');
    expect(assess(face({ box: { x: 0.4, y: 0.44, width: 0.2, height: 0.12 } }))).toBe('closer');
    expect(assess(face({ box: { x: 0.02, y: 0.2, width: 0.96, height: 0.6 } }))).toBe('further');
  });

  it('warns about light, tilt, eyes and movement before a straight photo', () => {
    expect(assess(face(), 'front', { luma: 30 })).toBe('dark');
    expect(assess(face(), 'front', { luma: 240 })).toBe('bright');
    expect(assess(face({ roll: 0.4 }))).toBe('tilt');
    expect(assess(face({ yaw: 0.25 }))).toBe('look_straight');
    expect(assess(face({ blink: 0.8 }))).toBe('eyes');
    expect(assess(face(), 'front', { motion: 0.2 })).toBe('still');
    expect(assess(face(), 'front', { luma: null })).toBe('ok');
    expect(assess(face())).toBe('ok');
  });

  it('accepts a turn only in the asked direction and within the window', () => {
    // Positive yaw = turned to the person's own right.
    expect(assess(face({ yaw: -0.3 }), 'right')).toBe('turn_wrong_way');
    expect(assess(face({ yaw: 0.2 }), 'right')).toBe('turn_more');
    expect(assess(face({ yaw: 0.5 }), 'right')).toBe('ok');
    expect(assess(face({ yaw: 1.2 }), 'right')).toBe('turn_less');
    expect(assess(face({ yaw: -0.5 }), 'left')).toBe('ok');
    expect(assess(face({ yaw: 0.5 }), 'left')).toBe('turn_wrong_way');
  });

  it('keeps the phone limits inside the server limits', () => {
    // Server (Human) yaw reads at least 0.68 x the phone's on turned faces; its turn minimum is 0.2.
    expect(FACE_GUIDE.turnYaw * 0.68).toBeGreaterThan(0.2 * 1.4);
    // Facing the camera: server allows 0.2 and reads at most about 0.92 x.
    expect(FACE_GUIDE.frontYaw * 0.92).toBeLessThan(0.2 * 0.75);
    expect(FACE_GUIDE.maxTurnYaw * 0.92).toBeLessThan(1.1);
  });

  it('allows a turned face more room in the circle', () => {
    const shifted = face({ yaw: 0.5, box: { x: 0.18, y: 0.3, width: 0.36, height: 0.36 } });
    expect(assess(shifted, 'front')).not.toBe('ok');
    expect(assess(shifted, 'right')).toBe('ok');
  });
});

describe('turnProgress', () => {
  it('fills as the head turns the asked way', () => {
    expect(turnProgress(face({ yaw: 0 }), 'left')).toBe(0);
    expect(turnProgress(face({ yaw: -FACE_GUIDE.turnYaw / 2 }), 'left')).toBeCloseTo(0.5, 5);
    expect(turnProgress(face({ yaw: 1 }), 'right')).toBe(1);
    expect(turnProgress(null, 'right')).toBe(0);
  });
});

describe('BlinkDetector', () => {
  const feed = (detector: BlinkDetector, values: number[], start = 0, step = 60) =>
    values.map((value, index) => detector.update(value, start + index * step));

  it('notices open, shut, open', () => {
    const results = feed(new BlinkDetector(), [0.1, 0.1, 0.12, 0.7, 0.8, 0.15, 0.1]);
    expect(results.indexOf(true)).toBe(5);
  });

  it('adapts to eyes that rest higher (glasses)', () => {
    const results = feed(new BlinkDetector(), [0.32, 0.3, 0.33, 0.31, 0.3, 0.5, 0.52, 0.3]);
    expect(results.filter(Boolean)).toHaveLength(0);
    const blink = feed(new BlinkDetector(), [0.32, 0.3, 0.33, 0.31, 0.3, 0.85, 0.9, 0.3]);
    expect(blink.indexOf(true)).toBe(7);
  });

  it('does not count eyes that start shut, or stay shut too long', () => {
    expect(feed(new BlinkDetector(), [0.9, 0.9, 0.1]).some(Boolean)).toBe(false);
    const detector = new BlinkDetector();
    feed(detector, [0.1, 0.1, 0.1, 0.9]);
    expect(detector.update(0.9, 2000)).toBe(false);
    expect(detector.update(0.1, 2060)).toBe(false);
  });
});

describe('patchStats', () => {
  const patch = (fill: (x: number, y: number) => number, size = 16) => {
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const value = fill(x, y);
        data.set([value, value, value, 255], (y * size + x) * 4);
      }
    }
    return patchStats(data, size, size);
  };

  it('measures brightness', () => {
    expect(patch(() => 100).luma).toBeCloseTo(100, 3);
  });

  it('scores detail above flat grey', () => {
    expect(patch(() => 128).sharpness).toBe(0);
    expect(patch((x, y) => ((x + y) % 2 ? 220 : 30)).sharpness).toBeGreaterThan(1000);
  });
});

describe('words and steps', () => {
  it('puts one blink after the first photo', () => {
    expect(captureSteps(['front', 'left'])).toEqual(['front', 'blink', 'left']);
    expect(captureSteps(['front', 'left', 'right'])).toEqual(['front', 'blink', 'left', 'right']);
  });

  it('says what to do', () => {
    expect(faceWords('front', 'closer').detail).toMatch(/closer/);
    expect(faceWords('left', 'turn_wrong_way')).toEqual({ title: 'Turn your head to your left', detail: 'The other way.' });
    expect(faceWords('blink', 'ok').title).toMatch(/blink/i);
    expect(faceWords('right', 'searching').title).toMatch(/can’t see/);
  });
});
