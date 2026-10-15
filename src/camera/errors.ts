export type CameraErrorKind =
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'not-found'
  | 'in-use'
  | 'overconstrained'
  | 'ended'
  | 'webgl'
  | 'unknown';

export interface ErrorInfo {
  kind: CameraErrorKind;
  title: string;
  message: string;
  hint?: string;
  /** Whether retrying the camera can plausibly succeed without user changes elsewhere. */
  retryable: boolean;
  detail?: string;
}

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    readonly cause?: unknown,
  ) {
    super(kind);
    this.name = 'CameraError';
  }
}

const MESSAGES: Record<CameraErrorKind, Omit<ErrorInfo, 'kind' | 'detail'>> = {
  insecure: {
    title: 'Conexión no segura',
    message: 'El navegador solo permite usar la cámara en páginas HTTPS o en localhost.',
    hint: 'Abre la app desde una dirección https:// o desde localhost.',
    retryable: false,
  },
  unsupported: {
    title: 'Navegador no compatible',
    message: 'Este navegador no permite acceder a la cámara.',
    hint: 'Prueba con una versión reciente de Chrome, Edge, Firefox o Safari.',
    retryable: false,
  },
  denied: {
    title: 'Permiso de cámara denegado',
    message: 'El acceso a la cámara está bloqueado para esta página.',
    hint: 'Pulsa el icono del candado o de la cámara en la barra de direcciones, permite la cámara y vuelve a intentarlo. En el móvil, revisa también los permisos del navegador en los ajustes del sistema.',
    retryable: true,
  },
  'not-found': {
    title: 'No se encontró ninguna cámara',
    message: 'No hay ninguna cámara disponible en este dispositivo.',
    hint: 'Conecta una cámara o comprueba que no esté desactivada en los ajustes del sistema.',
    retryable: true,
  },
  'in-use': {
    title: 'La cámara está ocupada',
    message: 'Otra aplicación o pestaña está usando la cámara.',
    hint: 'Cierra Zoom, Teams, OBS u otras pestañas que usen la cámara y vuelve a intentarlo.',
    retryable: true,
  },
  overconstrained: {
    title: 'Cámara no compatible',
    message: 'La cámara seleccionada no admite la configuración solicitada.',
    hint: 'Prueba con otra cámara.',
    retryable: true,
  },
  ended: {
    title: 'La cámara se desconectó',
    message: 'Se perdió la señal de la cámara.',
    hint: 'Comprueba la conexión de la cámara y vuelve a intentarlo.',
    retryable: true,
  },
  webgl: {
    title: 'WebGL2 no disponible',
    message: 'Tu navegador o tarjeta gráfica no admite WebGL2, necesario para los efectos.',
    hint: 'Actualiza el navegador y activa la aceleración por hardware en sus ajustes.',
    retryable: false,
  },
  unknown: {
    title: 'No se pudo iniciar la cámara',
    message: 'Ocurrió un error inesperado al acceder a la cámara.',
    hint: 'Vuelve a intentarlo. Si persiste, recarga la página.',
    retryable: true,
  },
};

/** Maps a getUserMedia DOMException (or anything thrown) to an error kind. */
export function classifyError(err: unknown): CameraErrorKind {
  if (err instanceof CameraError) return err.kind;
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'not-found';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'overconstrained';
    case 'TypeError':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

export function describeError(err: unknown): ErrorInfo {
  const kind = classifyError(err);
  const cause = err instanceof CameraError ? err.cause : err;
  const detail =
    cause instanceof Error ? `${cause.name}: ${cause.message}` : cause ? String(cause) : undefined;
  return { kind, ...MESSAGES[kind], detail };
}

export function errorInfo(kind: CameraErrorKind): ErrorInfo {
  return { kind, ...MESSAGES[kind] };
}
