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
