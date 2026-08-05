import { eventSource, event_types } from '@st/scripts/events.js';
import {
    chat,
    chat_metadata,
    name1,
    name2,
    addOneMessage,
    saveChatConditional,
    messageFormatting,
    appendMediaToMessage,
    addCopyToCodeBlocks,
    refreshSwipeButtons,
    substituteParams,
} from '@st/script.js';
import { getMessageTimeStamp } from '@st/scripts/RossAscends-mods.js';
import { Context, registerGlobalContextFactory } from '@/features/context';
import { eventTypes } from '@/utils/events';
import { ContextRole } from '@/utils/defines';
import { settings } from '@/settings';

/**
 * Context bound to the live SillyTavern chat.
 *
 * `Context` was designed for detached, in-memory generations and knows nothing
 * about ST's DOM, chat persistence, or button state. `GlobalContext` layers the
 * "takeover" responsibilities on top:
 * - renders created/updated messages via `addOneMessage` / `messageFormatting`
 * - stamps ST-compatible metadata (`send_date` string format, `extra.api/model`)
 * - emits ST's native `MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED` events
 * - persists the chat with `saveChatConditional`
 * - restores the send button state when a generation finishes
 */
export class GlobalContext extends Context {
    constructor() {
        super({ chat, chat_metadata });
        this.isGlobal = true;
    }

    /** Message metadata in ST's native format. */
    private stampExtra(message: ChatMessage): void {
        if(!message.extra)
            message.extra = {};
        message.extra.api = 'custom';
        message.extra.model = this.getCurrentApi()?.model ?? settings.apis[settings.currentApi]?.model ?? '';
    }

    override async send(content: string, role: ContextRole = 'user', name: string = name1) {
        const mes = substituteParams(this.applyRegex(content, {
            user: role === 'user',
            assistant: role === 'assistant',
            request: true,
            response: false,
        }));

        const message: ChatMessage = {
            is_user: role === 'user',
            is_system: role === 'system',
            mes,
            send_date: getMessageTimeStamp(),
            name,
            extra: {},
        };

        this.chat.push(message);
        const messageId = this.chat.length - 1;

        await eventSource.emit(event_types.MESSAGE_SENT, messageId);
        addOneMessage(message);
        await eventSource.emit(event_types.USER_MESSAGE_RENDERED, messageId);

        await eventSource.emit(eventTypes.MESSAGE_SEND, { messageId, message, context: this });
        await saveChatConditional();
    }

    protected override async recv(
        contents: string[],
        swipe: boolean = false,
        role: ContextRole = 'assistant',
        name: string = name2
    ): Promise<string[]> {
        const swipes = await super.recv(contents, swipe, role, name);
        if(!swipes.length)
            return swipes;

        const messageId = this.chat.length - 1;
        const message = this.chat[messageId];

        // Convert to ST-native timestamps and stamp api/model metadata.
        message.send_date = getMessageTimeStamp();
        if(message.swipe_info) {
            for(const info of message.swipe_info) {
                if(info && info.send_date instanceof Date)
                    info.send_date = getMessageTimeStamp(info.send_date.getTime());
            }
        }
        this.stampExtra(message);

        // ST-native events so other extensions (translate, TTS, regex, ...) can react.
        await eventSource.emit(event_types.MESSAGE_RECEIVED, messageId, swipe ? 'swipe' : 'normal');
        addOneMessage(message, { type: swipe ? 'swipe' : 'normal' });
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, messageId, swipe ? 'swipe' : 'normal');

        refreshSwipeButtons();
        await saveChatConditional();

        return swipes;
    }

    protected override async applyContinuation(swipes: string[]): Promise<void> {
        await super.applyContinuation(swipes);

        const messageId = this.chat.length - 1;
        const message = this.chat[messageId];
        if(!message || !swipes[0])
            return;

        this.stampExtra(message);

        await eventSource.emit(event_types.MESSAGE_RECEIVED, messageId, 'continue');
        this.renderMessageBlock(messageId);
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, messageId, 'continue');

        await saveChatConditional();
    }

    /** Re-renders an existing message block in place (used for continue). */
    private renderMessageBlock(messageId: number): void {
        const message = this.chat[messageId];
        const div = $(`#chat .mes[mesid="${messageId}"]`);
        if(!message || !div.length)
            return;

        div.find('.mes_text').empty().append(messageFormatting(
            message.mes ?? '',
            message.name ?? name2,
            message.is_system ?? false,
            message.is_user ?? false,
            messageId,
            {},
            false,
        ));
        appendMediaToMessage(message, div);
        addCopyToCodeBlocks(div);
    }
}

export function setup() {
    registerGlobalContextFactory(() => new GlobalContext());
}
