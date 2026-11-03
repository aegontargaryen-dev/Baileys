import { proto } from '../../WAProto/index.js';
import type { SocketConfig, WAMessage, WAMessageUpdate } from '../Types/index.js';
import type { ILogger } from './logger.js';
type MessageEditContext = {
    originalSenderJid: string;
    originalMsgId: string;
    messageSecret: Uint8Array;
    editorJid: string;
};
type MessageEditLIDMapping = {
    getLIDForPN: (pn: string) => Promise<string | null>;
    getPNForLID: (lid: string) => Promise<string | null>;
};
type ProcessEncryptedMessageEditOptions = {
    message: WAMessage;
    secretEncryptedMessage: proto.Message.ISecretEncryptedMessage;
    getMessage: SocketConfig['getMessage'];
    lidMapping: MessageEditLIDMapping;
    logger: ILogger;
    meId: string;
    meLid?: string;
};
export declare const isEncryptedMessageEdit: (content: proto.IMessage | null | undefined) => content is proto.IMessage & {
    secretEncryptedMessage: proto.Message.ISecretEncryptedMessage;
};
/**
 * MESSAGE_EDIT uses the same single-block HKDF-SHA256 construction as other
 * encrypted add-ons, but binds the edit identities in the info and uses empty AAD.
 */
export declare const decryptMessageEdit: ({ encPayload, encIv }: proto.Message.ISecretEncryptedMessage, { originalSenderJid, originalMsgId, messageSecret, editorJid }: MessageEditContext) => proto.Message;
export declare const processEncryptedMessageEdit: ({ message, secretEncryptedMessage, getMessage, lidMapping, logger, meId, meLid }: ProcessEncryptedMessageEditOptions) => Promise<WAMessageUpdate | undefined>;
export {};
//# sourceMappingURL=decrypt-message-edit.d.ts.map