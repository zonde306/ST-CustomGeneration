/**
 * AreaEditor 2.0
 * @github.com/kohunglee/areaEditor
 * @license MIT
 */

interface AreaEditorOptions {
    indentType?: {
        type?: 'space' | 'tab';
        count?: number;
    };
}

export class AreaEditor {
    private elements: HTMLTextAreaElement[];
    private indentType: { type: 'space' | 'tab'; count: number };
    private tabChar: string;
    private tabLength: number;
    private isPreventAuto: boolean = false;
    private readonly isPreventKEY: string[] = ['Backspace', 'Delete', 'Meta', 'Control', 'Ctrl'];
    private beforeEnterScrollTop: number = 0;

    /**
     * @param element - Textarea element or CSS selector
     * @param options - Configuration options
     */
    constructor(element: string | HTMLTextAreaElement, options?: AreaEditorOptions) {
        const rawElements: NodeListOf<HTMLTextAreaElement> | HTMLTextAreaElement[] =
            typeof element === 'string'
                ? document.querySelectorAll<HTMLTextAreaElement>(element)
                : [element];

        this.elements = Array.from(rawElements);
        this.indentType = {
            type: options?.indentType?.type ?? 'space',
            count: options?.indentType?.count ?? 4,
        };

        this.tabChar =
            this.indentType.type === 'tab'
                ? '\t'
                : ' '.repeat(this.indentType.count);
        this.tabLength = this.indentType.count;

        this.init();
    }

    // ------ Initialization ------
    private init(): void {
        for (const textarea of this.elements) {
            if (!textarea) {
                console.error('AreaEditor: Missing element');
                continue;
            }
            if (textarea.tagName !== 'TEXTAREA') {
                console.error('AreaEditor: The element must be a textarea');
                continue;
            }
            this.setupEvents(textarea);
        }
    }

    private setupEvents(textarea: HTMLTextAreaElement): void {
        textarea.addEventListener('keydown', this.onKeyDown);
        textarea.addEventListener('input', this.onInput);
        textarea.addEventListener('paste', this.onPaste);
        textarea.addEventListener('keyup', this.onKeyUp);
    }

    // ------ Event handlers ------
    private onKeyUp = (e: KeyboardEvent): void => {
        if (this.isPreventKEY.includes(e.key)) {
            this.isPreventAuto = false;
        }
    };

    private onPaste = (): void => {
        this.isPreventAuto = true;
    };

    private onInput = (e: Event): void => {
        if (this.isPreventAuto) {
            this.isPreventAuto = false;
            return;
        }

        const target = e.target as HTMLTextAreaElement;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const value = target.value;
        const nextChar = value[start];
        const lastChar = value[start - 1];
        const secondLastChar = value[start - 2];

        // Auto-complete brackets
        const autoPairs: Record<string, string> = {
            '{': '}',
            '[': ']',
            '(': ')',
            '"': '"',
            "'": "'",
            '`': '`',
        };

        if (
            ['{', '(', '[', '"', "'", '`', ']', '}', ')'].includes(lastChar) &&
            start === end
        ) {
            const pairChar = autoPairs[lastChar] || '';
            for (const leftBrace in autoPairs) {
                if (
                    leftBrace === secondLastChar &&
                    autoPairs[leftBrace] === lastChar &&
                    nextChar === lastChar
                ) {
                    // User manually completed the pair -> skip auto-completion
                    target.value = value.substring(0, start) + value.substring(start + 1);
                    target.selectionStart = target.selectionEnd = start;
                    return;
                }
            }
            target.value = value.substring(0, start) + pairChar + value.substring(start);
            target.selectionStart = target.selectionEnd = start;
        }

        // Line break processing
        if (lastChar === '\n') {
            const lineStart = value.lastIndexOf('\n', start - 2) + 1;
            const currentLine = value.substring(lineStart, start - 1);
            const indent = currentLine.match(/^\s*/)?.[0] ?? '';
            const pairs: Record<string, string> = {
                '{': '}',
                '[': ']',
                '(': ')',
                '<': '>',
                '>': '<',
            };
            const trimmedLastChar = currentLine.trim().slice(-1);

            let newText: string;
            if (pairs[trimmedLastChar]) {
                if (nextChar === pairs[trimmedLastChar]) {
                    newText = '\n' + indent + this.tabChar + '\n' + indent;
                } else {
                    newText = '\n' + indent + (trimmedLastChar !== '>' ? this.tabChar : '');
                }
                target.value =
                    value.substring(0, start - 1) +
                    newText +
                    value.substring(end - 1).replace(/\n/, '');
                target.selectionStart = target.selectionEnd =
                    start -
                    1 +
                    indent.length +
                    (trimmedLastChar !== '>' || nextChar === pairs[trimmedLastChar]
                        ? 1 + this.tabLength
                        : 1);
            } else {
                newText = '\n' + indent;
                target.value =
                    value.substring(0, start - 1) +
                    newText +
                    value.substring(end - 1).replace(/\n/, '');
                target.selectionStart = target.selectionEnd = start - 1 + newText.length;
            }

            if (this.beforeEnterScrollTop) {
                target.scrollTop = this.beforeEnterScrollTop;
                this.beforeEnterScrollTop = 0;
            }
        }
    };

    private onKeyDown = (e: KeyboardEvent): void => {
        const target = e.target as HTMLTextAreaElement;
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const value = target.value;

        // Update indent settings in case they were changed externally (kept for compatibility)
        this.tabChar =
            this.indentType.type === 'tab'
                ? '\t'
                : ' '.repeat(this.indentType.count);
        this.tabLength = this.indentType.count;

        if (this.isPreventKEY.includes(e.key)) {
            this.isPreventAuto = true;
        }

        // Handle Tab key
        if (e.key === 'Tab') {
            e.preventDefault();
            if (start === end) {
                // No selection
                target.value = value.substring(0, start) + this.tabChar + value.substring(end);
                target.selectionStart = target.selectionEnd = start + this.tabLength;
                return;
            } else {
                const contentArr = value.split('\n');
                const contentArrOriginal = value.split('\n');
                const startLine = (value.substring(0, start).match(/\n/g) || []).length;
                const endLine = (value.substring(0, end).match(/\n/g) || []).length;

                if (e.shiftKey) {
                    // Remove indentation
                    for (let i = startLine; i <= endLine; i++) {
                        contentArr[i] = this.removeLeadingSpaces(contentArr[i], this.tabLength);
                    }
                    target.value = contentArr.join('\n');
                    const originalLeadingSpaces =
                        contentArrOriginal[startLine].length -
                        contentArrOriginal[startLine].trimStart().length;
                    const moveLength = Math.min(this.tabLength, originalLeadingSpaces);
                    const limitLineNum = this.arrSum(contentArr, startLine);
                    const startPoint =
                        limitLineNum > start - moveLength - startLine
                            ? limitLineNum + startLine
                            : start - moveLength;
                    target.selectionStart = originalLeadingSpaces > 0 ? startPoint : start;
                    target.selectionEnd =
                        end - (contentArrOriginal.join('\n').length - target.value.length);
                } else {
                    // Add indentation
                    for (let i = startLine; i <= endLine; i++) {
                        contentArr[i] = this.tabChar + contentArr[i];
                    }
                    target.value = contentArr.join('\n');
                    target.selectionStart = start + this.tabLength;
                    target.selectionEnd =
                        end + this.tabLength * (startLine === endLine ? 1 : endLine - startLine + 1);
                }
            }
        }

        // Handle Backspace (remove trailing whitespace on current line)
        if (e.key === 'Backspace') {
            const contentArr = value.split('\n');
            const startLine = (value.substring(0, start).match(/\n/g) || []).length;
            if (
                start === end &&
                /^[\s\t]*$/.test(contentArr[startLine]) &&
                contentArr[startLine] !== ''
            ) {
                target.selectionStart = this.arrSum(contentArr, startLine) + startLine;
                target.selectionEnd = start;
            }
        }

        // Record scroll position before Enter
        if (e.key === 'Enter') {
            this.beforeEnterScrollTop = target.scrollTop;
        }
    };

    // ------ Utility methods ------
    private removeLeadingSpaces(str: string, n: number): string {
        const regex = new RegExp(`^([ \\t]{0,${n}})`);
        return str.replace(regex, '');
    }

    private arrSum(arr: string[], n: number, initial: number = 0): number {
        return arr.slice(0, n).reduce((sum, x) => sum + x.length, initial);
    }
}