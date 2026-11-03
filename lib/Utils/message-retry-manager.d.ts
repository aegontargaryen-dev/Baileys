import type { proto } from '../../WAProto/index.js';
import type { AnyMessageContent } from '../Types/Message.js';
import type { ILogger } from './logger.js';
export interface RecentMessageKey {
    to: string;
    id: string;
}
export interface RecentMessage {
    message: proto.IMessage;
    timestamp: number;
}
export interface SessionRecreateHistory {
    [jid: string]: number;
}
export interface RetryCounter {
    [messageId: string]: number;
}
export type PendingPhoneRequest = Record<string, ReturnType<typeof setTimeout>>;
export interface RetryStatistics {
    totalRetries: number;
    successfulRetries: number;
    failedRetries: number;
    mediaRetries: number;
    sessionRecreations: number;
    phoneRequests: number;
}
export interface PreparedMessageRetry {
    isCancelled(): boolean;
    finish(): void;
}
/**
 * Coordinates edits/revokes with retry relays independently of whether the
 * optional recent-message payload cache is enabled.
 */
export declare class MessageRetryCoordinator {
    private invalidatedMessages;
    private invalidatedMessageIds;
    private preparedRetries;
    private mutex;
    private key;
    invalidateMessage(to: string, id: string): void;
    isMessageInvalidated(to: string, id: string): boolean;
    prepareRetry(to: string, id: string): PreparedMessageRetry;
    withMessageLock<T>(to: string, id: string, task: () => Promise<T> | T): Promise<T>;
    withMessageLocks<T>(to: string, ids: string[], task: () => Promise<T> | T): Promise<T>;
    clear(): void;
}
export declare enum RetryReason {
    UnknownError = 0,
    SignalErrorNoSession = 1,
    SignalErrorInvalidKey = 2,
    SignalErrorInvalidKeyId = 3,
    /** MAC verification failed - most common cause of decryption failures */
    SignalErrorInvalidMessage = 4,
    SignalErrorInvalidSignature = 5,
    SignalErrorFutureMessage = 6,
    /** Explicit MAC failure - session is definitely out of sync */
    SignalErrorBadMac = 7,
    SignalErrorInvalidSession = 8,
    SignalErrorInvalidMsgKey = 9,
    BadBroadcastEphemeralSetting = 10,
    UnknownCompanionNoPrekey = 11,
    AdvFailure = 12,
    StatusRevokeDelay = 13
}
export declare class MessageRetryManager {
    private logger;
    private coordinator;
    private recentMessagesMap;
    private messageKeyIndex;
    private sessionRecreateHistory;
    private retryCounters;
    private baseKeys;
    private pendingPhoneRequests;
    private readonly maxMsgRetryCount;
    private statistics;
    constructor(logger: ILogger, maxMsgRetryCount: number, coordinator?: MessageRetryCoordinator);
    /**
     * Add a recent message to the cache for retry handling
     */
    addRecentMessage(to: string, id: string, message: proto.IMessage): void;
    /**
     * Get a recent message from the cache
     */
    getRecentMessage(to: string, id: string): RecentMessage | undefined;
    /**
     * Check if a session should be recreated based on retry count, history, and error code.
     * MAC errors (codes 4 and 7) trigger immediate session recreation regardless of timeout.
     */
    shouldRecreateSession(jid: string, hasSession: boolean, errorCode?: RetryReason): {
        reason: string;
        recreate: boolean;
    };
    /**
     * Parse error code from retry receipt's retry node.
     * Returns undefined if no error code is present.
     */
    parseRetryErrorCode(errorAttr: string | undefined): RetryReason | undefined;
    /**
     * Check if an error code indicates a MAC failure
     */
    isMacError(errorCode: RetryReason | undefined): boolean;
    /**
     * Increment retry counter for a message
     */
    incrementRetryCount(messageId: string, to?: string): number;
    /**
     * Get retry count for a message
     */
    getRetryCount(messageId: string, to?: string): number;
    /**
     * Check if message has exceeded maximum retry attempts
     */
    hasExceededMaxRetries(messageId: string, to?: string): boolean;
    /**
     * Mark retry as successful
     */
    markRetrySuccess(messageId: string, to?: string): void;
    /**
     * Mark retry as failed
     */
    markRetryFailed(messageId: string, to?: string): void;
    /**
     * Schedule a phone request with delay
     */
    schedulePhoneRequest(messageId: string, callback: () => void, delay?: number, to?: string): void;
    /**
     * Cancel pending phone request
     */
    cancelPendingPhoneRequest(messageId: string, to?: string): void;
    clear(): void;
    saveBaseKey(addr: string, msgId: string, baseKey: Uint8Array): void;
    hasSameBaseKey(addr: string, msgId: string, baseKey: Uint8Array): boolean;
    deleteBaseKey(addr: string, msgId: string): void;
    private keyToString;
    private retryKey;
    /** Remove one exact destination/message pair from the retry cache. */
    removeRecentMessage(to: string, messageId: string): boolean;
    /** Remove one exact cache entry and mark the message unavailable for retries. */
    invalidateRecentMessage(to: string, messageId: string): boolean;
    isRecentMessageInvalidated(to: string, messageId: string): boolean;
    withRecentMessageLock<T>(to: string, messageId: string, task: () => Promise<T> | T): Promise<T>;
    private removeRecentMessagesById;
}
/**
 * Drop the original message from the retry cache after a local revoke or edit
 * has been relayed successfully.
 *
 * The full destination/message pair is required because callers may provide
 * custom message IDs and reuse the same ID in different chats.
 */
export declare const invalidateRecentMessageForContent: (manager: MessageRetryManager, content: AnyMessageContent) => boolean;
/**
 * Serialize a sendMessage-generated edit/revoke with retries for its target.
 * Coordination is updated only after the caller's relay succeeds; the optional
 * recent-message payload cache is removed when present.
 */
export declare const withMessageRetryInvalidation: <T>(coordinator: MessageRetryCoordinator, manager: MessageRetryManager | null, content: AnyMessageContent, task: () => Promise<T> | T) => Promise<T>;
//# sourceMappingURL=message-retry-manager.d.ts.map