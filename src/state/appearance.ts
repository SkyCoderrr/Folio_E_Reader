import type { Preset, ReadingStyle, Settings } from '@contract/types';
import { BUILTIN_PRESETS } from '../engine/style/readingStyle';
import schema from '../../contract/settings.schema.json';
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
type Obj = Record<string, unknown>;
export function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** RFC 7396; null removes a key, arrays replace. The backend supplies defaults. */
export function mergePatch<T>(base: T, patch: unknown): T {
  if (!isObject(patch)) return structuredClone(patch) as T;
  const result: Obj = isObject(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result as T;
}
export function prune(value: Obj): Obj {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, v]) => {
      const next = isObject(v) ? prune(v) : v;
      return isObject(next) && !Object.keys(next).length ? [] : [[key, next]];
    }),
  );
}
export function presetsList(settings: Settings): Preset[] {
  return [...BUILTIN_PRESETS, ...settings.presets];
}
export function activePreset(settings: Settings): Preset {
  return presetsList(settings).find((p) => p.id === settings.activePresetId) ?? BUILTIN_PRESETS[0]!;
}
export function effectiveStyle(settings: Settings): ReadingStyle {
  return mergePatch(activePreset(settings).style, settings.styleOverrides);
}
export function atPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (v, key) => (isObject(v) && Object.hasOwn(v, key) ? v[key] : undefined),
      value,
    );
}
export function pathPatch(path: string, value: unknown): Obj {
  return path.split('.').reduceRight<unknown>((v, key) => ({ [key]: v }), value) as Obj;
}
const root = schema as unknown as Obj;
function resolve(node: Obj): Obj {
  return typeof node.$ref === 'string'
    ? ((root.$defs as Obj)[node.$ref.split('/').pop()!] as Obj)
    : node;
}
/** Clamp schema numeric ranges; validate other input before optimistic preview. */
export function clampPatch<T>(patch: T, node: Obj = root): T {
  node = resolve(node);
  if (isObject(patch)) {
    const properties = node.properties as Record<string, Obj> | undefined;
    return Object.fromEntries(
      Object.entries(patch).map(([key, value]) => {
        const child = properties?.[key];
        if (!child) throw new Error(`Unknown setting: ${key}`);
        return [key, clampPatch(value, child)];
      }),
    ) as T;
  }
  if (typeof patch === 'number') {
    if (
      node.type !== 'number' &&
      node.type !== 'integer' &&
      !(Array.isArray(node.enum) && node.enum.every((v) => typeof v === 'number'))
    )
      throw new Error('Invalid numeric input');
    if (!Number.isFinite(patch)) throw new Error('Enter a finite number');
    let n = node.type === 'integer' ? Math.sign(patch) * Math.round(Math.abs(patch)) : patch;
    const alternatives = node.anyOf as Obj[] | undefined;
    const range = alternatives?.find((v) => typeof v.minimum === 'number') ?? node;
    if (range !== node && n <= 0) return 0 as T;
    if (typeof range.minimum === 'number') n = Math.max(range.minimum, n);
    if (typeof range.maximum === 'number') n = Math.min(range.maximum, n);
    if (Array.isArray(node.enum) && node.enum.every((v) => typeof v === 'number')) {
      n = node.enum.reduce((best: number, v: number) =>
        Math.abs(v - n) < Math.abs(best - n) ? v : best,
      );
    }
    return n as T;
  }
  if (patch === null) return patch;
  if (Array.isArray(patch)) return patch.map((v) => clampPatch(v, node.items as Obj)) as T;
  if (Array.isArray(node.enum) && !node.enum.includes(patch)) throw new Error('Invalid option');
  if (typeof patch === 'string') {
    const length = [...patch].length;
    if (
      (typeof node.minLength === 'number' && length < node.minLength) ||
      (typeof node.maxLength === 'number' && length > node.maxLength) ||
      (typeof node.pattern === 'string' && !new RegExp(node.pattern).test(patch))
    )
      throw new Error('Invalid value');
  }
  if (typeof node.type === 'string' && node.type !== typeof patch) throw new Error('Invalid type');
  return patch;
}
