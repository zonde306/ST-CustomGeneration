import { yaml } from '@st/lib.js';

export function clone<T>(value: T): T {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value)) as T;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeRecord(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        return {};
    }

    return clone(value);
}

export function sanitizeName(name: string, fallback: string): string {
    const normalized = name.trim();
    return normalized.length > 0 ? normalized : fallback;
}

export function parseNullableInt(value: unknown, min: number): number | null {
    const text = String(value ?? '').trim();
    if (!text) {
        return null;
    }

    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return Math.max(min, Math.trunc(parsed));
}

export function parseNumber(value: unknown, fallback: number, min: number, max: number, integer: boolean = false): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    const clamped = clamp(parsed, min, max);
    return integer ? Math.trunc(clamped) : clamped;
}

export function parseYamlRecord(value: unknown): Record<string, unknown> {
    const text = String(value ?? '').trim();
    if (!text) {
        return {};
    }

    const parsed = yaml.parse(text);
    if (!isRecord(parsed)) {
        throw new Error('YAML must be an object mapping.');
    }

    return clone(parsed);
}

export function stringifyYamlRecord(value: Record<string, unknown>): string {
    if (!value || Object.keys(value).length === 0) {
        return '';
    }

    return yaml.stringify(value).trimEnd();
}

export function getPreviewText(content: string): string {
    return content.trim().replace(/\s+/g, ' ').slice(0, 120);
}

export function getErrorMessage(error: unknown, fallback: string = 'Unknown error'): string {
    return error instanceof Error ? error.message : String(error ?? fallback);
}

/**
 * Total size of an embedded file map. Both preset files and card files are
 * capped: they travel inside a settings object or a PNG text chunk, where a
 * large payload slows down everything that loads them.
 */
export const FILE_MAP_SIZE_LIMIT = 256 * 1024;

/**
 * Reject a file name that cannot be addressed as a single path segment.
 * @returns an error message, or `null` when the name is usable.
 */
export function validateFileName(name: string): string | null {
    const trimmed = name.trim();

    if (!trimmed)
        return 'Name is required';
    // `%` is decoded twice by the path router, `#`/`?` truncate it, `/\` split it.
    if (/[/\\%#?]/.test(trimmed))
        return 'Cannot contain / \\ % # ?';
    // Dotfiles are hidden by listDir, so such a file could never be found again.
    if (trimmed.startsWith('.'))
        return 'Cannot start with "."';
    if (trimmed.length > 120)
        return 'Name is too long';

    return null;
}

/**
 * Normalize an untrusted `name -> content` map, dropping unusable names.
 *
 * Used while importing presets and character cards, so it never throws on bad
 * input; oversized content is the one hard failure, because silently truncating
 * a file would corrupt it without telling anyone.
 * @throws when the total size exceeds {@link FILE_MAP_SIZE_LIMIT}.
 */
export function normalizeFileMap(raw: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!isRecord(raw))
        return result;

    let total = 0;

    for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== 'string')
            continue;

        const name = key.trim();
        const problem = validateFileName(name);
        if (problem) {
            console.warn(`[CG] dropping file "${key}": ${problem}`);
            continue;
        }

        total += name.length + value.length;
        if (total > FILE_MAP_SIZE_LIMIT)
            throw new Error(`Files exceed the ${Math.floor(FILE_MAP_SIZE_LIMIT / 1024)} KB limit.`);

        result[name] = value;
    }

    return result;
}

/** Total size of a file map, as counted against {@link FILE_MAP_SIZE_LIMIT}. */
export function fileMapSize(files: Record<string, string>): number {
    return Object.entries(files).reduce((sum, [name, content]) => sum + name.length + content.length, 0);
}
