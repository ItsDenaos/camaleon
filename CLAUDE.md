# Camaleón — efectos de webcam en el navegador

App web de efectos para webcam (inspirada en webcamtoy.com). **Todo corre en el
navegador; nunca se sube nada a ningún servidor.** No añadir analíticas, CDNs en
tiempo de ejecución ni llamadas de red con datos del usuario. Los modelos de IA y
assets se sirven desde `public/` (mismo origen) para que la PWA funcione offline.

## Comandos

```bash
npm run dev        # servidor de desarrollo (https no necesario: localhost es contexto seguro)
npm run dev:movil  # igual pero en la red local con HTTPS autofirmado, para probar en el móvil
npm run build      # tsc --noEmit + vite build  → dist/
npm run preview    # sirve dist/ con los headers de producción (CSP incluida)
npm run typecheck
npm run models     # descarga los modelos de MediaPipe a public/models (solo si faltan)
```

Al terminar cada fase: `npm run build` sin errores y parar para que el usuario pruebe.

## Stack

- Vite 8 + TypeScript 7 (strict), Preact 11 + `@preact/signals` para la UI.
- WebGL2 con shaders GLSL ES 3.00 propios. Sin librerías 3D.
- MediaPipe Tasks Vision 1.x (Face Landmarker + Image Segmenter), carga diferida.
- `vite-plugin-pwa` 2 (Workbox `generateSW`), despliegue en Netlify.

## Arquitectura

```
src/
  main.tsx              arranque: monta <App/>
  app/
    App.tsx             UI raíz (Preact): barra superior, pantallas, teclado, swipe
    Gallery.tsx         galería: capa DOM transparente que mide las celdas (el GL las pinta)
    EffectsUI.tsx       barra inferior (3 filas), paginador, panel de ajustes, toast
    capture.ts          flujos de captura (foto, fotomatón, GIF, boomerang, vídeo) y
                        acciones de la biblioteca (descargar, compartir, borrar)
    CaptureUI.tsx       obturador, modos, temporizador, cuenta atrás, flash, avisos,
                        hoja «Capturas» y visor
    controller.ts       pegamento UI ↔ cámara/renderer; la UI solo llama a estas funciones
    pwa.ts              registro del service worker (solo en build), actualizar, instalar
    state.ts            estado global con signals (cámara, pila de efectos, ajustes)
    prefs.ts            preferencias en localStorage (cámara, espejo, ajuste, última pila)
    icons.tsx           iconos SVG inline (sin librería de iconos)
  capture/              captura sin UI
    store.ts            IndexedDB: `captures` (metadatos + miniatura) y `blobs` (archivo)
    image.ts            píxeles → canvas/PNG, miniaturas, tira de fotomatón, nombres
    gif.ts / gif.worker.ts  codificación GIF en un Web Worker (gifenc, paleta global)
    recorder.ts         CanvasRecorder (MediaRecorder sobre un canvas 2D) + encodeFrames
  ai/                   IA (MediaPipe), sin UI
    vision.ts           VisionEngine: carga diferida, decide qué modelo corre en cada frame
    face.ts             FaceTracker: landmarks → espacio de cara + suavizado adaptativo
  camera/
    camera.ts           CameraController: getUserMedia, enumeración, cambio de cámara
    errors.ts           traduce errores de getUserMedia a mensajes en español
    source.ts           FrameSource (interfaz) + VideoSource (requestVideoFrameCallback)
    testPattern.ts      fuente sintética animada (modo demo / sin cámara)
  gl/                   utilidades WebGL2 de bajo nivel, sin lógica de app
    context.ts          crea contexto, context lost/restored
    shader.ts           compila/enlaza (begin/finish no bloqueante), errores con nº de línea
    quad.ts             triángulo a pantalla completa (VAO)
    texture.ts          textura de vídeo (subida por frame) + texturas estáticas con mipmaps
    framebuffer.ts      RenderTarget (FBO) + TargetPool (reciclado entre pases y frames)
  render/
    renderer.ts         bucle rAF, sube frame, ejecuta pipeline, dibuja vista o galería
    shaders.ts          pases fijos de entrada (espejo, flip Y) y salida (contain/cover)
    fps.ts              medidor de FPS
  engine/               pipeline de efectos encadenables
    types.ts            EffectDef, EffectParam, EffectPass, EffectLayer, defineEffect
    prelude.ts          cabecera GLSL común + declaración automática de uniformes
    glsl.ts             snippets opcionales: SDF 2D, main() de filtros de cara, borde de máscara
    registry.ts         carga src/effects/*.ts con import.meta.glob, valida y ordena
    compiler.ts         compila y cachea efectos (KHR_parallel_shader_compile)
    pipeline.ts         ejecuta la pila de efectos sobre una textura
  effects/              UN archivo por efecto
  styles.css
vite/mediapipe.ts       plugin: copia el wasm de MediaPipe a public/mediapipe/wasm (gitignored)
vite/headers.ts         CSP y demás headers: genera dist/_headers y los usa `vite preview`
scripts/make-icons.mjs  genera los PNG de icono (sin dependencias) desde el diseño del logo
netlify.toml            build de Netlify para despliegues desde Git/CLI
scripts/fetch-models.mjs  `npm run models`
public/models/          face_landmarker.task + selfie_segmenter.tflite (versionados)
```

### Flujo de un frame

1. `FrameSource` (vídeo de la cámara o patrón de prueba) → `SourceTexture.update()`
   sube el frame solo si hay uno nuevo (`requestVideoFrameCallback` si existe).
2. Pase de entrada: convierte el vídeo (origen arriba-izquierda) a convención GL
   (origen abajo-izquierda) y aplica espejo. Escribe en un FBO a resolución de proceso.
3. Pipeline: cada pase dibuja en un target del `TargetPool` que no sea ni su entrada
   ni la fuente del efecto (ping-pong generalizado: permite multipase + `u_source` y
   pases a otra escala). Las capas aún compilando se saltan ese frame.
4. Pase de salida: dibuja el resultado en el canvas con ajuste `contain`/`cover`.
5. Galería: el MISMO canvas dibuja la cuadrícula en vez de la vista. El pase de
   entrada corre una vez (a ~2× el tamaño de miniatura), la pila base corre una vez a
   tamaño miniatura (modo Apilar) y queda `locked` en el pool, y cada celda aplica su
   capa encima y se dibuja en su rect con esquinas redondeadas.

### Galería: DOM ↔ GL

- `Gallery.tsx` calcula la cuadrícula (≈9 por página: 3×3, 2×4 o 4×2, la que dé
  celdas más grandes con el aspecto de la cámara), y tras cada layout mide los
  `.cell` y llama a `setGalleryCells()`. El controlador normaliza los rects al canvas
  y arma un `GalleryView` para el renderer. El radio de esquina de CSS (`.cell`) y
  `CELL_RADIUS` deben coincidir.
- Nada de animaciones con `transform` en la galería: el GL no las seguiría.
- Modo normal: cada miniatura = ese efecto solo; tocar aplica y cierra.
  Modo Apilar: miniatura = pila actual + ese efecto; tocar añade/quita y no cierra.

### Captura

- Foto/fotomatón: `renderer.grab(w, h)` renderiza el frame actual con la pila a
  resolución de cámara (≤1920 px), independiente de la pantalla, y lo lee con
  `readPixels` (el último pase invierte Y, así que las filas salen en orden de imagen).
- GIF (480 px, 12 fps, 3 s) y boomerang (720 px, 20 fps, 1,6 s): ráfagas de `grab()`
  una por frame renderizado. El GIF se codifica en un worker; el boomerang se monta ida
  y vuelta ×2 en un `CanvasRecorder` (tiempo real, ~4 s).
- Vídeo: `renderer.onFrameDrawn` copia la zona de imagen del canvas WebGL (sin
  letterbox ni UI) al canvas del grabador justo después de cada frame, en la misma
  tarea (el drawing buffer sigue intacto). Máx. 30 fps y 3 min; micrófono opcional.
- `CanvasRecorder` empuja frames con `requestFrame()` (uno por frame dibujado) y solo
  si no existe cae a `captureStream(fps)`. Sin `requestFrame` el MP4 puede salir vacío
  cuando el canvas no se pinta.
- Contenedor: MP4 si `MediaRecorder` lo admite (Safari, Chrome reciente), si no WebM.
- Al ocultarse la pestaña se detiene la grabación y se cancela la ráfaga/cuenta atrás.
- Biblioteca: listar solo lee `captures` (miniaturas); el archivo se carga al abrir el
  visor, y Descargar/Compartir usan ese blob ya cargado para seguir dentro del gesto
  del usuario (Web Share lo exige). Sin IndexedDB, todo queda en memoria de la sesión.

### IA (fase 6)

- Un efecto declara `needs: { segmentation?, face? }`. El controlador calcula qué hace
  falta (pila + celdas visibles de la galería) y `VisionEngine` carga ese modelo la
  primera vez (import dinámico: MediaPipe va en su propio chunk) y solo lo ejecuta
  mientras haga falta. Todo se sirve desde el mismo origen: `BASE_URL + mediapipe/wasm`
  y `BASE_URL + models/`. Delegado GPU con respaldo a CPU.
- Corre en el hilo principal, justo tras subir cada frame (`renderer.onSourceFrame`).
  Con los dos modelos activos se alternan frames; si la media pasa de 22 ms se analiza
  un frame de cada dos. Al cargar se hace una inferencia de calentamiento (la primera
  compila shaders, ~2 s) para que no congele la vista luego.
- Segmentación: la máscara sale al tamaño de la entrada, así que se le pasa el frame
  reducido (lado mayor 256 px). Se suaviza en el tiempo en CPU y se sube como textura
  R8 en orientación de cámara; en GLSL `personMask(uv)` aplica espejo y flip.
  `MASK_EDGE` da `personAlpha(uv, feather)` (1 mientras no hay máscara).
- Caras (hasta 2): `u_faceC`/`u_faceX` = punto medio entre los ojos y vector ojo→ojo en
  espacio `centered()`; `faceIso(i, p)` lleva a «unidades de cara» (ojos en (±0,5, 0),
  isótropo, sigue giro y escala). Puntos clave FP_* (nariz, labio, comisuras, barbilla,
  frente, mejillas) en esas unidades vía `facePoint(i, FP_X)`. Los filtros se dibujan
  con SDF (nítidos a cualquier resolución): definir `vec4 overlay(int face, vec2 q,
  float aa)` (color premultiplicado) y pegar `FACE_OVERLAY_MAIN`.
- Imágenes del usuario: `images: [{ key, label, selects? }]` → `u_<key>` + `u_<key>Set`.
  El controlador recorta la imagen al aspecto de la cámara (cover) y la guarda en
  IndexedDB (`assets`), así que el shader la muestrea con uv directo (fila 0 arriba).
- Unidades de textura del pipeline: 0 entrada, 1 source, 2–4 texturas del efecto,
  5–6 imágenes del usuario, 7 máscara.

### PWA y despliegue (fase 7)

- Precache solo de la interfaz (~370 KB: js, css, html, svg, png). El wasm de MediaPipe
  y los modelos van por runtime caching `CacheFirst` (caché `camaleon-ia`) la primera
  vez que se usan: quien no usa la IA no descarga 17 MB.
- `registerType: 'prompt'`: nunca recarga sola; `UpdateBanner` ofrece «Actualizar»
  (deshabilitado mientras se captura). `beforeinstallprompt` → botón «Instalar app».
- El SW solo se registra en build (`import.meta.env.PROD`); en dev no hay SW.
- Headers: una sola fuente en `vite/headers.ts` → `dist/_headers` (Netlify los aplica
  en Git, CLI y arrastrar-y-soltar) y `preview.headers`. CSP: todo `'self'`, más
  `'wasm-unsafe-eval'` (MediaPipe), `blob:` para imágenes/vídeo/workers y
  `'unsafe-inline'` solo en estilos (atributos style de Preact). Si se añade cualquier
  recurso externo, la CSP lo bloqueará: es intencionado.
- Los iconos PNG salen de `scripts/make-icons.mjs`; si cambia el logo, regenerarlos.

### Convenciones de coordenadas

- Todas las texturas internas (FBOs) usan convención GL: `uv (0,0)` = abajo-izquierda.
- Solo el pase de entrada sabe que el vídeo viene invertido en Y.
- El espejo se aplica en el pase de entrada: lo que se ve es lo que se captura.

## Contrato de un efecto

Agregar un efecto = crear **un solo archivo** en `src/effects/<id>.ts` que exporte
por defecto un `EffectDef`. El registro lo recoge solo con `import.meta.glob`.

```ts
import { defineEffect } from '../engine/types';

export default defineEffect({
  id: 'sepia',                 // kebab-case, único, = nombre del archivo
  name: 'Sepia',               // nombre visible (español)
  order: 20,                   // posición en la galería (opcional)
  params: [
    { key: 'amount', label: 'Intensidad', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  // GLSL ES 3.00 SIN cabecera: el motor antepone el prelude común.
  fragment: /* glsl */ `
    void main() {
      vec4 c = texture(u_input, v_uv);
      vec3 s = vec3(dot(c.rgb, vec3(.393,.769,.189)), dot(c.rgb, vec3(.349,.686,.168)), dot(c.rgb, vec3(.272,.534,.131)));
      outColor = vec4(mix(c.rgb, s, u_amount), c.a);
    }`,
});
```

- Cada parámetro `key` se declara solo como `uniform float u_<key>` (no declararlo).
  Un parámetro con `step: 1` y rango de 1 (p. ej. 0–1) se muestra como interruptor;
  con `options: ['A', 'B', …]` (una etiqueta por entero de `min` a `max`, step 1) se
  muestra como botones segmentados y el shader recibe el índice (`int(u_x + 0.5)`).
  Los enteros (`step: 1`) muestran su valor; el resto, % del rango.
- Prelude común (`src/engine/prelude.ts`): `#version 300 es`, `precision highp`,
  `in vec2 v_uv`, `out vec4 outColor`, `u_input` (salida del pase anterior),
  `u_source` (entrada del efecto antes de su primer pase), `u_resolution` (px del
  destino de ESTE pase), `u_time` (s), `PI`, `TAU` y helpers: `luma()`, `aspect()`,
  `centered(uv)`/`uncentered(p)` (espacio con y∈[-.5,.5] y píxeles cuadrados),
  `hash()`, `noise()`, `rgb2hsv()`, `hsv2rgb()`, `hpx()` (un «píxel de 720p» en uv,
  para desplazamientos independientes de la resolución), `sobel(tex, uv, px)` (bordes
  de luma) y `mirrorRepeat(uv)` (para distorsiones sin bordes duros).
- Ojo con palabras reservadas de GLSL ES como nombres de variable: `active`, `input`,
  `output`, `filter`, `sample`, `common`, `partition`, `half`, `flat`, `smooth`…
  fallan al compilar. Tampoco usar backticks dentro del GLSL (cierran el template).
- El registro valida al cargar (id = archivo, defaults dentro del rango, claves GLSL
  válidas); un efecto inválido o que no compila se omite y se informa en consola.
- **Independiente de la resolución**: la vista previa se procesa al tamaño mostrado y
  las capturas a resolución completa, así que tamaños (píxel, celda ASCII, radio de
  desenfoque…) se expresan relativos a `u_resolution.y`, nunca en px fijos.
- Multipase: `passes: [{ fragment, scale? }, …]` en lugar de `fragment`. `scale`
  (p. ej. 0.5) reduce la resolución de ese pase; quien lo lea lo reescala bilineal.
- Texturas extra (p. ej. atlas de glifos ASCII): `textures: { u_glyphs: () => TexImageSource }`
  se crean una vez con mipmaps; se declaran solas como `uniform sampler2D u_glyphs`.

## Convenciones de código

- TypeScript `strict`; nada de `any` salvo en bordes con APIs del navegador sin tipos.
- Textos de UI en español; identificadores y comentarios de código en inglés.
- La UI (Preact) nunca toca WebGL directamente: habla con `Renderer` por métodos.
  El bucle de render no depende de re-renders de Preact.
- No asignar memoria por frame en el bucle de render (sin objetos/arrays nuevos,
  uniformes en `Float32Array` reutilizados).
- Liberar recursos GL (`dispose()`) y pistas de cámara (`track.stop()`) siempre.
- Shaders: `/* glsl */` antes del template literal; precisión `highp`.
- CSS: variables en `:root`, móvil primero, tema oscuro único.
- `localStorage` solo para preferencias (cámara, espejo, modo, temporizador, micro);
  siempre en try/catch. Las capturas van a IndexedDB.

## Desarrollo y pruebas

- Modo demo («Probar sin cámara», `TestPatternSource`): patrón animado con barras de
  color, rampa de luma, una cara y texto (si el texto se lee al revés, el espejo está activo).
  Sirve para probar efectos sin cámara.
- Los módulos de cámara/GL no se hot-swapean: `controller.ts` recarga la página entera
  al cambiar (evita bucles de render duplicados).
- En desarrollo el renderer termina de compilar todos los efectos en segundo plano:
  cualquier error de shader aparece en la consola al arrancar, con la línea señalada.
- `gifenc` y `@mediapipe/tasks-vision` están en `optimizeDeps.include`: se importan de
  forma diferida y, sin eso, su primer uso en dev re-optimiza y recarga la página.
- MediaPipe escribe sus logs por stderr: «INFO: Created TensorFlow Lite XNNPACK…»
  sale como [error] en la consola pero es informativo.
- Para probar efectos sin cámara ni rAF: importar los módulos del motor desde la consola
  (`/src/engine/...`) y renderizar en un contexto WebGL aparte con un `FrameContext`
  sintético (así se validaron los filtros de cara con landmarks inventados).
- El panel de navegador de Claude no permite registrar service workers (Electron):
  la PWA se prueba en Chrome/Edge con `npm run build && npm run preview`.
- El panel de navegador de Claude limita `requestAnimationFrame` (~30 fps, o lo pausa
  del todo si el panel está oculto: entonces no hay frames ni ráfagas que probar);
  medir rendimiento real en un navegador normal. Sus capturas de pantalla salen
  recortadas en el tamaño de escritorio: usar el preset `mobile` o `tablet`.

## Rendimiento

- Objetivo: 60 fps desktop, 30+ fps móvil gama media.
- Resolución de proceso limitada (≤1280 px en el lado mayor; menos en móvil).
- Canvas a `devicePixelRatio` limitado a 2.
- Miniaturas de galería a baja resolución (~160–240 px) desde el mismo frame.

## Fases

1. [x] Cámara + WebGL (fuente, pase de entrada/salida, errores, selector, espejo, FPS)
2. [x] Motor de efectos + 5 efectos (B/N, pixelado, ASCII, glitch RGB, desenfoque)
3. [x] UI galería con miniaturas en vivo, pila de efectos, sliders
4. [x] Captura: PNG, temporizador, flash, vídeo, GIF, boomerang, fotomatón, galería IndexedDB
5. [x] Resto de efectos: 20 en total (ver `src/effects/`, ordenados por `order`)
6. [x] IA: fondo desenfocado / cambiar fondo (con imagen propia) y filtros de cara
   (gafas, bigote, antifaz, gato)
7. [x] PWA (instalable, offline, aviso de actualización) y despliegue en Netlify

Atajos — vista: Espacio = obturador (también detiene/cancela), ←/→ o deslizar =
cambiar efecto, E = galería, T = temporizador, Esc = cancelar cuenta atrás / cerrar panel.
Galería: ←/→ o deslizar = página, 1–9 = elegir celda, E/Esc = cerrar.
Visor de capturas: ←/→ = anterior/siguiente, Esc = cerrar.
