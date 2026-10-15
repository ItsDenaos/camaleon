# Camaleón

Efectos en tiempo real para tu webcam: 26 efectos encadenables (WebGL2), fondos y filtros
de cara con IA (MediaPipe), fotos, fotomatón, GIF, boomerang y vídeo. **Todo se procesa en
el navegador**: nada se sube a ningún servidor. Instalable como app (PWA) y usable sin
conexión.

## Desarrollo

Requiere Node 24.

```bash
npm install
npm run models     # descarga los modelos de IA a public/models (solo si faltan)
npm run dev        # http://localhost:5173
npm run dev:movil  # en la red local con HTTPS, para probar en el móvil
npm run build      # → dist/
npm run preview    # sirve dist/ con los mismos headers que producción (CSP incluida)
```

La arquitectura y las convenciones están en [CLAUDE.md](CLAUDE.md).

## Desplegar en Netlify

El build genera `dist/_headers` (CSP, permisos de cámara/micrófono y caché), así que
cualquiera de estas formas sirve:

**Arrastrar y soltar (lo más rápido)**

```bash
npm run build
```

Arrastra la carpeta `dist/` a <https://app.netlify.com/drop>.

**Desde Git (se redespliega con cada push)**

Sube el repositorio a GitHub/GitLab/Bitbucket y en Netlify: *Add new site → Import an
existing project*. `netlify.toml` ya define el comando (`npm run models && npm run build`),
la carpeta (`dist`) y Node 24.

**Con la CLI de Netlify**

```bash
npx netlify-cli login
npx netlify-cli deploy --prod --dir=dist
```

Netlify sirve por HTTPS, que es obligatorio para usar la cámara.

## Comprobar la PWA

En Chrome o Edge: DevTools → *Application* → *Manifest* y *Service workers*. La interfaz
(~370 KB) queda en caché en la primera visita; el motor de IA (~17 MB) se guarda la primera
vez que usas un efecto de IA. Después funciona sin conexión.
