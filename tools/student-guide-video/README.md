# Student guide video tooling

Builds the LASUATOS student guide videos (the full walkthrough and the four
short clips) that ship in `apps/web/public/media/` and play on `/start`.

Everything is rendered, not filmed: real screens are captured from the app with
a mocked API and a fake camera, then animated on a 1080×1920 stage
(`scenes.html` + `scenes.js`) and scrubbed frame-by-frame into mp4 with
narration. Re-running the pipeline reproduces the videos exactly.

## Layout

- `capture.mjs` — drives the real app (dev server on :3100) through the student
  journey with Puppeteer and saves phone screenshots to `shots/`.
  - `ONLY=<shot>` limits the sign-up flow to one shot; `FLOWS=signup,scan,typed,attendance,help`
    picks which journeys run.
- `mock-api.mjs` — intercepts `/api/v1/*` in the page and answers as the
  backend (the demo student ODEJOBI Abraham Oluwaseun, 250211184, ECE 100 level;
  one open ECE 101 lecture; check-in always succeeds).
- `fake-media.mjs` — replaces `getUserMedia` with a canvas stream fed by the
  portrait/lecture-hall images in `media/`, so the face-capture overlay and the
  QR scanner see a believable camera. Exposes `window.__feed` for the driver.
- `face-sequence.mjs` — walks the real face-capture overlay through its steps
  (front / blink / left / right) by feeding the right portrait as each prompt
  appears, and takes the mid-step screenshots.
- `browser.mjs` — shared headless Chromium launch (@sparticuz/chromium + NSS
  libraries unpacked to a temp dir).
- `scenes.html` / `scenes.js` — the storyboard. `scenes.js` exposes
  `window.__SEGMENTS` (id + length of each of the 10 segments), `window.__TOTAL`,
  and `window.setTime(t)`, which renders the exact frame at time `t`. All motion
  is a pure function of `t` — no wall-clock timers — so frames can be scrubbed
  in any order.
- `render.mjs` — turns the storyboard into video:
  - `node render.mjs still <segmentIndex> <t>` — one PNG for reviewing the edit.
  - `node render.mjs segment <n>` — one segment as a silent mp4.
  - `node render.mjs full` — the whole film with narration to
    `out/lasuatos-student-guide.mp4`, plus the four clips
    (`clip-a-open-account`, `clip-b-face`, `clip-c-mark`, `clip-d-problems`).
  - 24 fps, libx264 crf 20, AAC 128k, `+faststart`. ffmpeg comes from the Python
    `imageio-ffmpeg` package.
- `audio/01…10.mp3` — the recorded narration, one file per segment; the clip
  boundaries are chosen so no sentence is split.
- `media/` — image assets (AI-generated portraits and lecture hall, the QR
  card). `shots/` — captured app screens used by the storyboard.
  `out/` — render output.

## Rebuilding the videos

```bash
cd tools/student-guide-video
npm install                      # puppeteer-core, @sparticuz/chromium, etc.
pip install imageio-ffmpeg       # provides the ffmpeg binary

# 1. Start the app dev server on :3100 (separate shell):
cd ../../apps/web && npm run dev -- -p 3100

# 2. Capture the app screens (only needed when the app UI changes):
cd ../../tools/student-guide-video
node capture.mjs                 # or FLOWS=scan,typed / ONLY=face …

# 3. Record narration into audio/01..10.mp3 if the script changed.

# 4. Render:
node render.mjs full             # ~30 min; watch out/render.log

# 5. Make the distribution copies (smaller, voice-grade audio):
FF=$(python3 -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
$FF -i out/lasuatos-student-guide.mp4 -c:v libx264 -pix_fmt yuv420p -crf 23 -preset slow \
  -c:a aac -b:a 96k -movflags +faststart out/dist-master.mp4
# clips are cut from the crf20 master with the same crf23 settings (see poster times below)

# 6. Publish into the web app:
cp out/dist-master.mp4                    ../../apps/web/public/media/student-guide.mp4
cp out/dist-student-guide-open-account.mp4 ../../apps/web/public/media/
cp out/dist-student-guide-face.mp4         ../../apps/web/public/media/
cp out/dist-student-guide-mark.mp4         ../../apps/web/public/media/
cp out/dist-student-guide-problems.mp4     ../../apps/web/public/media/
# posters: one frame per video, see "Posters" below
```

## Posters

Poster frames are extracted from the finished videos, so they always match the
footage (`ffmpeg -ss <t> -i <video> -frames:v 1 -q:v 3 poster.jpg`):

- `student-guide-poster.jpg` — master at 4.0 s (the homepage)
- `student-guide-open-account.jpg` — master at 38.8 s (the "Is this you?" card)
- `student-guide-face.jpg` — face clip at 13.5 s (turn-your-head step)
- `student-guide-mark.jpg` — mark clip at 22.0 s (the hall QR)
- `student-guide-problems.jpg` — problems clip at 9.0 s (classmate sign-in)

## Editing notes

- Segment lengths, caption phrase timings and the scene list live in
  `SEGMENTS` at the top of `scenes.js`; the renderer reads the timeline from
  the page, so there is no second copy to keep in sync.
- Never animate with `setTimeout`, CSS transitions or rAF timing — frames are
  produced as fast as screenshots allow, so anything not driven by
  `window.setTime(t)` will freeze or jump.
- The face-capture overlay is driven by feeding portraits whose head pose
  matches each prompt; the "turn left/right" images are intentionally swapped
  (the tracker reports yaw with the unmirrored-camera convention).
