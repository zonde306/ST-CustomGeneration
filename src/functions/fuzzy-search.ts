import MiniSearch from 'minisearch';
import { SearchHit } from "@/functions/filesystem";

export interface FuzzyOptions {
    /** Indexed document fields. */
    fields: string[];
    /** Per-field score boost. */
    boost?: Record<string, number>;
    /** Length of the returned preview. */
    previewLength?: number;
}

/**
 * Full-text search over a small document set.
 *
 * Kept separate from {@link FSTree.grepSearch}, whose contract is literal
 * line matching: mixing fuzzy ranking into grep would make its results
 * unusable for `edit_file`.
 */
export function fuzzySearch(
    docs: Array<Record<string, any>>,
    query: string,
    topN: number = 25,
    options: FuzzyOptions,
): SearchHit[] {
    const previewLength = options.previewLength ?? 50;

    if (!query?.trim()) {
        return docs.slice(0, topN).map(doc => ({
            path: String(doc.path ?? ''),
            score: 0,
            preview: String(doc.content ?? '').slice(0, previewLength),
        }));
    }

    const index = new MiniSearch({
        fields: options.fields,
        storeFields: ['path', 'content'],
        tokenize: (s) => smartTokenize(s),
        extractField: (doc, field) => {
            const value = doc[field];
            return Array.isArray(value) ? value.join(' ') : value == null ? '' : String(value);
        },
    });

    index.addAll(docs.map((doc, id) => ({ ...doc, id })));

    return index.search(query, {
        combineWith: 'OR',
        fuzzy: true,
        boost: options.boost,
    }).slice(0, topN).map(result => ({
        path: String(result.path ?? ''),
        score: result.score,
        preview: String(result.content ?? '').slice(0, previewLength),
    }));
}

/**
 * Tokenize text into n-grams, keeping emoji sequences intact. CJK has no word
 * boundaries, so bigrams are what make it searchable at all.
 */
export function smartTokenize(text: string, n: number = 2): string[] {
    const tokens: string[] = [];
    let lastIndex = 0;
    const regex = /\p{Extended_Pictographic}(\u200d\p{Extended_Pictographic})*/gu;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const emoji = match[0];
        const start = match.index;
        tokens.push(...ngramTokenize(text.slice(lastIndex, start), n));
        tokens.push(emoji);
        lastIndex = start + emoji.length;
    }

    tokens.push(...ngramTokenize(text.slice(lastIndex), n));
    return tokens;
}

function ngramTokenize(str: string, n: number): string[] {
    if (!str)
        return [];

    const tokens: string[] = [];
    for (const word of str.split(/[\s\u3000]+/)) {
        if (word.length === 0)
            continue;

        if (/^[a-zA-Z0-9]+$/.test(word) && word.length <= 4) {
            tokens.push(word);
            continue;
        }

        for (let i = 0; i <= word.length - n; i++) {
            tokens.push(word.slice(i, i + n));
        }
    }

    return tokens;
}
