/**
 * Split a string into a list using spaces; double quotes are supported.
 * @param input string
 * @returns string list
 */
export function splitWithQuotes(input: string): string[] {
    const result: string[] = [];
    let currentToken = '';

    let inDoubleQuotes = false;
    let inSingleQuotes = false;
    let isEscaped = false;
    let hasToken = false;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (isEscaped) {
            currentToken += char;
            isEscaped = false;
            hasToken = true;
        } else if (char === '\\') {
            isEscaped = true;
        } else if (char === '"' && !inSingleQuotes) {
            inDoubleQuotes = !inDoubleQuotes;
        } else if (char === "'" && !inDoubleQuotes) {
            inSingleQuotes = !inSingleQuotes;
            hasToken = true;
        } else if (/\s/.test(char) && !inDoubleQuotes && !inSingleQuotes) {
            if (hasToken) {
                result.push(currentToken);
                currentToken = '';
                hasToken = false;
            }
        } else {
            currentToken += char;
            hasToken = true;
        }
    }

    if (isEscaped) {
        currentToken += '\\';
    }

    if (hasToken) {
        result.push(currentToken);
    }

    return result;
}


/**
 * Convert a regular expression in string form to a RegExp object.
 * @param str Regular expression string, such as `/expr/g`
 * @returns RegExp objects, throw an exception on failure.
 */
export function parseRegexString(str: string): RegExp {
    if (typeof str !== 'string' || str[0] !== '/') {
        throw new Error('invalid regex string');
    }

    let i = 1;
    const n = str.length;
    let endSlashPos = -1;

    while (i < n) {
        if (str[i] === '/') {
            let backslashCount = 0;
            let j = i - 1;
            while (j >= 0 && str[j] === '\\') {
                backslashCount++;
                j--;
            }
            if (backslashCount % 2 === 0) {
                endSlashPos = i;
                break;
            }
        }
        i++;
    }

    if (endSlashPos === -1) {
        throw new Error('invalid regex string');
    }

    const pattern = str.substring(1, endSlashPos);
    const flags = str.substring(endSlashPos + 1);

    const validFlags = /^[gimsuyd]*$/;
    if (!validFlags.test(flags)) {
        throw new Error(`unknown flags: ${flags}`);
    }

    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        // @ts-expect-error: 18046
        throw new Error(`invalid regex string: ${e.message}`);
    }
}
