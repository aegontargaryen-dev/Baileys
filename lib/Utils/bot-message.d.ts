import { proto } from '../../WAProto/index.js';
import { type BinaryNode } from '../WABinary/index.js';
/**
 * Give a message for a native bot what the bot's reply depends on: a 32-byte
 * messageSecret, which the reply is encrypted with, and the bot's default persona
 * when none is set. Mutates the message, so the copy the app stores (and later
 * returns from getMessage) keeps the secret.
 */
export declare const prepareMessageForBot: (message: proto.IMessage, botJid: string) => void;
/** The `<meta>` and `<bot>` attributes WhatsApp attaches to a native bot's reply. */
export type BotReplyInfo = {
    /** id of the message (our prompt) whose messageSecret the reply is encrypted with */
    targetId?: string;
    /** author of that message; absent for a native @bot, which then means our own LID */
    targetSenderJid?: string;
    /** `first`, `inner`, `last` or `full` while the reply is streamed */
    editType?: string;
    /** id of the reply message an `inner` or `last` edit belongs to */
    editTargetId?: string;
};
export declare const getBotReplyInfo: (stanza: BinaryNode) => BotReplyInfo;
/**
 * Message ids to try when decrypting a bot reply, in order. Streamed `inner` and
 * `last` edits are encrypted with the id of the reply they edit; WhatsApp clients
 * fall back to the stanza's own id once if that fails. `full` uses its own id.
 */
export declare const getBotReplyDecryptionIds: (stanzaId: string, { editType, editTargetId }: BotReplyInfo) => string[];
/**
 * Decrypt the payload of a bot reply (`<enc type="msmsg">`). The key comes from
 * the messageSecret of the prompt the reply answers:
 *   K   = HKDF(HKDF(messageSecret, "Bot Message"), messageId + targetSender + bot)
 *   AAD = messageId \0 bot
 * The plaintext is a Message protobuf with no Signal padding.
 */
export declare const decryptBotReply: ({ messageSecret, messageId, targetSenderJid, botJid, encIv, encPayload }: {
    messageSecret: Uint8Array;
    messageId: string;
    targetSenderJid: string;
    botJid: string;
    encIv: Uint8Array;
    encPayload: Uint8Array;
}) => Buffer<ArrayBuffer>;
/** Decode the `msmsg` envelope and decrypt it, trying each candidate id in turn. */
export declare const decryptBotReplyNode: ({ content, stanzaId, info, messageSecret, targetSenderJid, botJid }: {
    content: Uint8Array;
    stanzaId: string;
    info: BotReplyInfo;
    messageSecret: Uint8Array;
    targetSenderJid: string;
    botJid: string;
}) => Buffer<ArrayBuffer>;
//# sourceMappingURL=bot-message.d.ts.map