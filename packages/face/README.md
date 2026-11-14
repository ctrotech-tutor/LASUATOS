# @lasuatos/face

The face engine behind LASUATOS face verification: detection, head pose,
passive liveness and a 128-number face signature, in plain JavaScript and
WebAssembly (no native binaries). How it is used and why the limits are what
they are: [docs/FACE_VERIFICATION.md](../../docs/FACE_VERIFICATION.md).

```js
import { createFaceEngine, cosineSimilarity } from '@lasuatos/face';

const engine = createFaceEngine();
await engine.warm();
const result = await engine.analyze(jpegBytes); // { faceCount, face: { yaw, live, real, embedding, … }, portrait }
```

`src/bundle.js` is the entry `apps/api/scripts/bundle-embedded.mjs` builds into
the self-contained `apps/api/dist/face` folder that ships with the deployment.

## Models and licences

| File | Source | Licence |
| --- | --- | --- |
| `models/sface-2021dec.onnx` | [OpenCV Zoo SFace](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) (`face_recognition_sface_2021dec.onnx`), unmodified. sha256 `0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79`, checked at load | Apache-2.0 |
| `models/blazeface.*`, `models/facemesh.*`, `models/antispoof.*`, `models/liveness.*` | [@vladmandic/human](https://github.com/vladmandic/human) 3.3.6 models, unmodified | MIT |

SFace: Zhong, Y. et al., “SFace: Sigmoid-Constrained Hypersphere Loss for
Robust Face Recognition”, IEEE TIP 2021. Copyright the OpenCV Zoo
contributors, licensed under the Apache License 2.0
(<https://www.apache.org/licenses/LICENSE-2.0>).

Runtime libraries (installed from npm, bundled at build): TensorFlow.js 4.22
(Apache-2.0), onnxruntime-web 1.31 (MIT), jpeg-js 0.4 (BSD-3-Clause).

## Test photos

`test/fixtures` holds AI-generated portraits of fictional people, used only to
measure and test matching: `a1`/`a2` are one man (`a3` is `a2` mirrored),
`b1`/`b2` one woman, `c1` a different man.
