import { effectPasses, type EffectDef } from './types';

/**
 * Every file in src/effects/ is an effect: adding one is creating one file.
 * Eager glob → the effects are bundled with the app and available synchronously.
 */
const modules = import.meta.glob<{ default: EffectDef }>('../effects/*.ts', { eager: true });

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validate(path: string, def: EffectDef | undefined): string[] {
  const file = path.split('/').pop()!.replace(/\.ts$/, '');
  if (!def) return [`${path}: falta "export default defineEffect({...})"`];
  const problems: string[] = [];
  if (def.id !== file) problems.push(`id "${def.id}" debe coincidir con el archivo "${file}.ts"`);
  if (!def.fragment === !def.passes) problems.push('define "fragment" o "passes" (solo uno)');
  if (effectPasses(def).length === 0) problems.push('no tiene pases');
  for (const p of def.params) {
    if (!IDENT.test(p.key)) problems.push(`parámetro "${p.key}": no es un identificador GLSL válido`);
    if (!(p.min <= p.default && p.default <= p.max))
      problems.push(`parámetro "${p.key}": default ${p.default} fuera de [${p.min}, ${p.max}]`);
    if (p.options && (p.step !== 1 || p.options.length !== p.max - p.min + 1))
      problems.push(`parámetro "${p.key}": options necesita step 1 y una etiqueta por valor`);
  }
  if (new Set(def.params.map((p) => p.key)).size !== def.params.length)
    problems.push('claves de parámetro repetidas');
  return problems.map((m) => `${path}: ${m}`);
}

function load(): EffectDef[] {
  const list: EffectDef[] = [];
  const seen = new Set<string>();
  for (const [path, mod] of Object.entries(modules)) {
    const problems = validate(path, mod.default);
    if (!problems.length && seen.has(mod.default.id)) problems.push(`${path}: id repetido`);
    if (problems.length) {
      // Surface mistakes loudly in dev, skip the broken effect in production.
      console.error(`[efectos] Efecto inválido:\n  ${problems.join('\n  ')}`);
      continue;
    }
    seen.add(mod.default.id);
    list.push(mod.default);
  }
  return list.sort(
    (a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.name.localeCompare(b.name, 'es'),
  );
}

/** All valid effects, in gallery order. */
export const effects: readonly EffectDef[] = load();

const byId = new Map(effects.map((e) => [e.id, e]));

export function getEffect(id: string): EffectDef | undefined {
  return byId.get(id);
}

export function defaultValues(def: EffectDef): number[] {
  return def.params.map((p) => p.default);
}

/** Values keyed by param key, the form that is persisted (robust to params being reordered). */
export function valuesToRecord(def: EffectDef, values: readonly number[]): Record<string, number> {
  return Object.fromEntries(def.params.map((p, i) => [p.key, values[i]]));
}

/** Restores saved values for `def`, tolerating params that were added, removed or re-ranged. */
export function sanitizeValues(
  def: EffectDef,
  saved: Readonly<Record<string, unknown>> | undefined,
): number[] {
  return def.params.map((p) => {
    const v = saved?.[p.key];
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.min(p.max, Math.max(p.min, v))
      : p.default;
  });
}
