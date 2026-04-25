import { chat, getCharacterCardFieldsLazy, CharacterCardFields, getMaxContextSize, parseMesExamples } from '@st/script.js';
import { getWorldInfoPrompt, WIPromptResult, WIGlobalScanData, wi_anchor_position } from '@st/scripts/world-info.js';
import { GENERATION_TYPE_TRIGGERS } from '@st/scripts/constants.js';

export class PromptContext {
    private fields: CharacterCardFields;
    private worldInfo: WIPromptResult | null = null;
    private mesExamplesArray: string[] = [];
    public ready: boolean;

    /**
     * Do not use this directly, use `create` instead.
     */
    constructor() {
        this.fields = getCharacterCardFieldsLazy();
        this.ready = false;
    }

    /**
     * Create and initialize a new PromptContext.
     * @param content Activate WI text list
     * @param type Generation type, used for WI activation
     * @param dryRun Setting it to false will update the stickiness, delay, and cooling states.
     * @param contextSize Context budget size
     * @returns PromptContext instance
     */
    static async create(content: string[], type: string = 'normal', dryRun: boolean = false, contextSize: number = getMaxContextSize()) {
        const getter = new PromptContext();
        await getter.scan(content, type, dryRun, contextSize);
        return getter;
    }

    async scan(content: string[], type: string = 'normal', dryRun: boolean = false, contextSize: number = getMaxContextSize()) {
        const globalScanData: WIGlobalScanData = {
            personaDescription: this.personaDescription,
            characterDescription: this.charDescription,
            characterPersonality: this.charPersonality,
            characterDepthPrompt: this.charDepthPrompt,
            scenario: this.scenario,
            creatorNotes: this.creatorNotes,
            trigger: GENERATION_TYPE_TRIGGERS.includes(type) ? type : 'quiet',
        };

        this.worldInfo = await getWorldInfoPrompt(content, contextSize, dryRun, globalScanData);
        this.ready = true;
    }

    /**
     * 角色描述
     */
    get charDescription(): string {
        return this.fields.description;
    }

    /**
     * 角色设定摘要
     */
    get charPersonality(): string {
        return this.fields.personality;
    }

    /**
     * 情景
     */
    get scenario(): string {
        return this.fields.scenario;
    }

    /**
     * 对话示例
     */
    get chatExamples(): string {
        return this.fields.mesExamples;
    }

    /**
     * 对话示例
     */
    get chatExampleArray(): string[] {
        if (this.mesExamplesArray.length == 0 && this.fields.mesExamples.trim()) {
            this.mesExamplesArray = parseMesExamples(this.fields.mesExamples, false);
        }

        return this.mesExamplesArray;
    }

    /**
     * 用户设定描述
     */
    get personaDescription(): string {
        return this.fields.persona;
    }

    /**
     * 主要提示词
     */
    get mainPrompt(): string {
        return this.fields.system;
    }

    /**
     * 创作者的注释
     */
    get creatorNotes(): string {
        return this.fields.creatorNotes;
    }

    /**
     * 对话
     */
    get chatHistory(): { role: 'user' | 'system' | 'assistant', content: string }[] {
        // Marked as `is_system` are hidden.
        return chat.filter(msg => !msg.is_system).map(msg => ({ role: msg.is_user ? 'user' : 'assistant', content: msg.mes ?? '' }));
    }

    /**
     * 角色备注
     */
    get charDepthPrompt(): string {
        return this.fields.charDepthPrompt;
    }

    /**
     * 后续历史指令
     */
    get charHistoryInstructions(): string {
        return this.fields.jailbreak;
    }

    get worldInfoString(): string {
        if(!this.ready)
            console.warn('worldInfoString called before scan');

        return this.worldInfo?.worldInfoString ?? '';
    }

    /**
     * 角色定义之前
     */
    get worldInfoCharBefore(): string {
        if(!this.ready)
            console.warn('worldInfoCharBefore called before scan');

        return this.worldInfo?.worldInfoBefore ?? '';
    }

    /**
     * 角色定义之后
     */
    get worldInfoCharAfter(): string {
        if(!this.ready)
            console.warn('worldInfoCharAfter called before scan');

        return this.worldInfo?.worldInfoAfter ?? '';
    }

    /**
     * 示例消息之前/之后
     */
    get worldInfoExamples(): { position: typeof wi_anchor_position[keyof typeof wi_anchor_position], content: string }[] {
        if(!this.ready)
            console.warn('worldInfoExamples called before scan');

        return this.worldInfo?.worldInfoExamples ?? [];
    }

    /**
     * 对话的特定深度
     * 注入到 chatHistory 中
     */
    get worldInfoDepth(): { depth: number, entries: string[], role: string | number }[] {
        if(!this.ready)
            console.warn('worldInfoDepth called before scan');

        return this.worldInfo?.worldInfoDepth ?? [];
    }

    /**
     * 锚点
     * 由宏`{{outlet:名字}}`使用
     */
    get worldInfoOutletEntries(): Record<string, string[]> {
        if(!this.ready)
            console.warn('worldInfoOutletEntries called before scan');

        return this.worldInfo?.outletEntries ?? {};
    }

    /**
     * 作者备注之前
     */
    get worldInfoAuthorNoteBefore(): string[] {
        if(!this.ready)
            console.warn('worldInfoAuthorNoteBefore called before scan');

        return this.worldInfo?.anBefore ?? [];
    }

    /**
     * 作者备注之后
     */
    get worldInfoAuthorNoteAfter(): string[] {
        if(!this.ready)
            console.warn('worldInfoAuthorNoteAfter called before scan');

        return this.worldInfo?.anAfter ?? [];
    }

    get lastUserMessage(): string {
        return chat.findLast(msg => msg.is_user)?.mes ?? '';
    }

    get lastSystemMessage(): string {
        return chat.findLast(msg => msg.is_system)?.mes ?? '';
    }

    get lastAssistantMessage(): string {
        return chat.findLast(msg => !msg.is_user && !msg.is_system)?.mes ?? '';
    }
}
