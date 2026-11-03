import { LRUCache } from 'lru-cache';
import { jidNormalizedUser } from '../WABinary/index.js';
import { makeKeyedMutex } from './make-mutex.js';
/** Number of sent messages to cache in memory for handling retry receipts */
const RECENT_MESSAGES_SIZE = 512;
const MESSAGE_KEY_SEPARATOR = '\u0000';
/** Timeout for session recreation - 1 hour */
const RECREATE_SESSION_TIMEOUT = 60 * 60 * 1000; // 1 hour in milliseconds
const PHONE_REQUEST_DELAY = 3000;
/**
 * Coordinates edits/revokes with retry relays independently of whether the
 * optional recent-message payload cache is enabled.
 */
export class MessageRetryCoordinator {
    constructor() {
        this.invalidatedMessages = new LRUCache({
            max: RECENT_MESSAGES_SIZE,
            ttl: 5 * 60 * 1000,
            ttlAutopurge: true
        });
        // A message sent to a PN JID may be relayed (and retried) under its LID
        // alias, so an edit/revoke keyed by the app-supplied PN must also cancel
        // retries keyed by the LID form of the same message id.
        this.invalidatedMessageIds = new LRUCache({
            max: RECENT_MESSAGES_SIZE,
            ttl: 5 * 60 * 1000,
            ttlAutopurge: true
        });
        this.preparedRetries = new Map();
        this.mutex = makeKeyedMutex();
    }
    key(to, id) {
        return `${jidNormalizedUser(to)}${MESSAGE_KEY_SEPARATOR}${id}`;
    }
    invalidateMessage(to, id) {
        const key = this.key(to, id);
        this.invalidatedMessages.set(key, true);
        this.invalidatedMessageIds.set(id, true);
        for (const [retryKey, retries] of this.preparedRetries) {
            if (retryKey === key || retryKey.endsWith(`${MESSAGE_KEY_SEPARATOR}${id}`)) {
                for (const retry of retries) {
                    retry.cancelled = true;
                }
            }
        }
    }
    isMessageInvalidated(to, id) {
        return this.invalidatedMessages.has(this.key(to, id)) || this.invalidatedMessageIds.has(id);
    }
    prepareRetry(to, id) {
        const key = this.key(to, id);
        const retry = { cancelled: this.isMessageInvalidated(to, id) };
        const retries = this.preparedRetries.get(key) ?? new Set();
        retries.add(retry);
        this.preparedRetries.set(key, retries);
        let finished = false;
        return {
            isCancelled: () => retry.cancelled,
            finish: () => {
                if (finished)
                    return;
                finished = true;
                retries.delete(retry);
                if (retries.size === 0 && this.preparedRetries.get(key) === retries) {
                    this.preparedRetries.delete(key);
                }
            }
        };
    }
    withMessageLock(to, id, task) {
        // Lock by message id so a PN-keyed edit/revoke serializes with a
        // LID-keyed retry of the same message (see invalidatedMessageIds).
        void to;
        return this.mutex.mutex(id, task);
    }
    withMessageLocks(to, ids, task) {
        const orderedIds = [...new Set(ids)].sort();
        const lockNext = (index) => {
            const id = orderedIds[index];
            return id === undefined ? Promise.resolve().then(task) : this.withMessageLock(to, id, () => lockNext(index + 1));
        };
        return lockNext(0);
    }
    clear() {
        for (const retries of this.preparedRetries.values()) {
            for (const retry of retries) {
                retry.cancelled = true;
            }
        }
        this.invalidatedMessages.clear();
        this.invalidatedMessageIds.clear();
        this.preparedRetries.clear();
    }
}
// Retry reason codes matching WhatsApp Web's Signal error codes.
export var RetryReason;
(function (RetryReason) {
    RetryReason[RetryReason["UnknownError"] = 0] = "UnknownError";
    RetryReason[RetryReason["SignalErrorNoSession"] = 1] = "SignalErrorNoSession";
    RetryReason[RetryReason["SignalErrorInvalidKey"] = 2] = "SignalErrorInvalidKey";
    RetryReason[RetryReason["SignalErrorInvalidKeyId"] = 3] = "SignalErrorInvalidKeyId";
    /** MAC verification failed - most common cause of decryption failures */
    RetryReason[RetryReason["SignalErrorInvalidMessage"] = 4] = "SignalErrorInvalidMessage";
    RetryReason[RetryReason["SignalErrorInvalidSignature"] = 5] = "SignalErrorInvalidSignature";
    RetryReason[RetryReason["SignalErrorFutureMessage"] = 6] = "SignalErrorFutureMessage";
    /** Explicit MAC failure - session is definitely out of sync */
    RetryReason[RetryReason["SignalErrorBadMac"] = 7] = "SignalErrorBadMac";
    RetryReason[RetryReason["SignalErrorInvalidSession"] = 8] = "SignalErrorInvalidSession";
    RetryReason[RetryReason["SignalErrorInvalidMsgKey"] = 9] = "SignalErrorInvalidMsgKey";
    RetryReason[RetryReason["BadBroadcastEphemeralSetting"] = 10] = "BadBroadcastEphemeralSetting";
    RetryReason[RetryReason["UnknownCompanionNoPrekey"] = 11] = "UnknownCompanionNoPrekey";
    RetryReason[RetryReason["AdvFailure"] = 12] = "AdvFailure";
    RetryReason[RetryReason["StatusRevokeDelay"] = 13] = "StatusRevokeDelay";
})(RetryReason || (RetryReason = {}));
/** Error codes that indicate a MAC failure and require immediate session recreation */
const MAC_ERROR_CODES = new Set([RetryReason.SignalErrorInvalidMessage, RetryReason.SignalErrorBadMac]);
export class MessageRetryManager {
    constructor(logger, maxMsgRetryCount, coordinator = new MessageRetryCoordinator()) {
        this.logger = logger;
        this.coordinator = coordinator;
        this.recentMessagesMap = new LRUCache({
            max: RECENT_MESSAGES_SIZE,
            ttl: 5 * 60 * 1000,
            ttlAutopurge: true,
            dispose: (_value, key) => {
                const separatorIndex = key.lastIndexOf(MESSAGE_KEY_SEPARATOR);
                if (separatorIndex > -1) {
                    const messageId = key.slice(separatorIndex + MESSAGE_KEY_SEPARATOR.length);
                    const indexedKeys = this.messageKeyIndex.get(messageId);
                    indexedKeys?.delete(key);
                    if (indexedKeys?.size === 0) {
                        this.messageKeyIndex.delete(messageId);
                    }
                }
            }
        });
        this.messageKeyIndex = new Map();
        this.sessionRecreateHistory = new LRUCache({
            ttl: RECREATE_SESSION_TIMEOUT * 2,
            ttlAutopurge: true
        });
        this.retryCounters = new LRUCache({
            ttl: 15 * 60 * 1000,
            ttlAutopurge: true,
            updateAgeOnGet: true
        }); // 15 minutes TTL
        this.baseKeys = new LRUCache({
            max: 1024,
            ttl: 15 * 60 * 1000,
            ttlAutopurge: true
        });
        this.pendingPhoneRequests = {};
        this.maxMsgRetryCount = 5;
        this.statistics = {
            totalRetries: 0,
            successfulRetries: 0,
            failedRetries: 0,
            mediaRetries: 0,
            sessionRecreations: 0,
            phoneRequests: 0
        };
        this.maxMsgRetryCount = maxMsgRetryCount;
    }
    /**
     * Add a recent message to the cache for retry handling
     */
    addRecentMessage(to, id, message) {
        const key = { to, id };
        const keyStr = this.keyToString(key);
        // Add new message
        this.recentMessagesMap.set(keyStr, {
            message,
            timestamp: Date.now()
        });
        const indexedKeys = this.messageKeyIndex.get(id) ?? new Set();
        indexedKeys.add(keyStr);
        this.messageKeyIndex.set(id, indexedKeys);
        this.logger.debug(`Added message to retry cache: ${to}/${id}`);
    }
    /**
     * Get a recent message from the cache
     */
    getRecentMessage(to, id) {
        const key = { to, id };
        const keyStr = this.keyToString(key);
        return this.recentMessagesMap.get(keyStr);
    }
    /**
     * Check if a session should be recreated based on retry count, history, and error code.
     * MAC errors (codes 4 and 7) trigger immediate session recreation regardless of timeout.
     */
    shouldRecreateSession(jid, hasSession, errorCode) {
        // If we don't have a session, always recreate
        if (!hasSession) {
            this.sessionRecreateHistory.set(jid, Date.now());
            this.statistics.sessionRecreations++;
            return {
                reason: "we don't have a Signal session with them",
                recreate: true
            };
        }
        // IMMEDIATE recreation for MAC errors - session is definitely out of sync
        if (errorCode !== undefined && MAC_ERROR_CODES.has(errorCode)) {
            this.sessionRecreateHistory.set(jid, Date.now());
            this.statistics.sessionRecreations++;
            this.logger.warn({ jid, errorCode: RetryReason[errorCode] }, 'MAC error detected, forcing immediate session recreation');
            return {
                reason: `MAC error (code ${errorCode}: ${RetryReason[errorCode]}), immediate session recreation`,
                recreate: true
            };
        }
        const now = Date.now();
        const prevTime = this.sessionRecreateHistory.get(jid);
        // If no previous recreation or it's been more than an hour
        if (!prevTime || now - prevTime > RECREATE_SESSION_TIMEOUT) {
            this.sessionRecreateHistory.set(jid, now);
            this.statistics.sessionRecreations++;
            return {
                reason: 'retry count > 1 and over an hour since last recreation',
                recreate: true
            };
        }
        return { reason: '', recreate: false };
    }
    /**
     * Parse error code from retry receipt's retry node.
     * Returns undefined if no error code is present.
     */
    parseRetryErrorCode(errorAttr) {
        if (errorAttr === undefined || errorAttr === '') {
            return undefined;
        }
        const code = parseInt(errorAttr, 10);
        if (Number.isNaN(code)) {
            return undefined;
        }
        // Validate it's a known RetryReason
        if (code >= RetryReason.UnknownError && code <= RetryReason.StatusRevokeDelay) {
            return code;
        }
        return RetryReason.UnknownError;
    }
    /**
     * Check if an error code indicates a MAC failure
     */
    isMacError(errorCode) {
        return errorCode !== undefined && MAC_ERROR_CODES.has(errorCode);
    }
    /**
     * Increment retry counter for a message
     */
    incrementRetryCount(messageId, to) {
        const key = this.retryKey(messageId, to);
        this.retryCounters.set(key, (this.retryCounters.get(key) || 0) + 1);
        this.statistics.totalRetries++;
        return this.retryCounters.get(key);
    }
    /**
     * Get retry count for a message
     */
    getRetryCount(messageId, to) {
        return this.retryCounters.get(this.retryKey(messageId, to)) || 0;
    }
    /**
     * Check if message has exceeded maximum retry attempts
     */
    hasExceededMaxRetries(messageId, to) {
        return this.getRetryCount(messageId, to) >= this.maxMsgRetryCount;
    }
    /**
     * Mark retry as successful
     */
    markRetrySuccess(messageId, to) {
        this.statistics.successfulRetries++;
        // Clean up retry counter for successful message
        this.retryCounters.delete(this.retryKey(messageId, to));
        this.cancelPendingPhoneRequest(messageId, to);
        if (to) {
            this.removeRecentMessage(to, messageId);
        }
        else {
            this.removeRecentMessagesById(messageId);
        }
    }
    /**
     * Mark retry as failed
     */
    markRetryFailed(messageId, to) {
        this.statistics.failedRetries++;
        this.retryCounters.delete(this.retryKey(messageId, to));
        this.cancelPendingPhoneRequest(messageId, to);
        if (to) {
            this.removeRecentMessage(to, messageId);
        }
        else {
            this.removeRecentMessagesById(messageId);
        }
    }
    /**
     * Schedule a phone request with delay
     */
    schedulePhoneRequest(messageId, callback, delay = PHONE_REQUEST_DELAY, to) {
        const key = this.retryKey(messageId, to);
        // Cancel any existing request for this message
        this.cancelPendingPhoneRequest(messageId, to);
        this.pendingPhoneRequests[key] = setTimeout(() => {
            delete this.pendingPhoneRequests[key];
            this.statistics.phoneRequests++;
            callback();
        }, delay);
        this.logger.debug(`Scheduled phone request for message ${messageId} with ${delay}ms delay`);
    }
    /**
     * Cancel pending phone request
     */
    cancelPendingPhoneRequest(messageId, to) {
        const key = this.retryKey(messageId, to);
        const timeout = this.pendingPhoneRequests[key];
        if (timeout) {
            clearTimeout(timeout);
            delete this.pendingPhoneRequests[key];
            this.logger.debug(`Cancelled pending phone request for message ${messageId}`);
        }
    }
    clear() {
        this.recentMessagesMap.clear();
        this.messageKeyIndex.clear();
        this.coordinator.clear();
        this.sessionRecreateHistory.clear();
        this.retryCounters.clear();
        this.baseKeys.clear();
        for (const messageId of Object.keys(this.pendingPhoneRequests)) {
            this.cancelPendingPhoneRequest(messageId);
        }
        this.statistics = {
            totalRetries: 0,
            successfulRetries: 0,
            failedRetries: 0,
            mediaRetries: 0,
            sessionRecreations: 0,
            phoneRequests: 0
        };
    }
    saveBaseKey(addr, msgId, baseKey) {
        this.baseKeys.set(`${addr}:${msgId}`, baseKey);
    }
    hasSameBaseKey(addr, msgId, baseKey) {
        const stored = this.baseKeys.get(`${addr}:${msgId}`);
        if (!stored || stored.length !== baseKey.length) {
            return false;
        }
        for (let i = 0; i < stored.length; i++) {
            if (stored[i] !== baseKey[i])
                return false;
        }
        return true;
    }
    deleteBaseKey(addr, msgId) {
        this.baseKeys.delete(`${addr}:${msgId}`);
    }
    keyToString(key) {
        return `${jidNormalizedUser(key.to)}${MESSAGE_KEY_SEPARATOR}${key.id}`;
    }
    retryKey(messageId, to) {
        return to ? this.keyToString({ to, id: messageId }) : messageId;
    }
    /** Remove one exact destination/message pair from the retry cache. */
    removeRecentMessage(to, messageId) {
        const removed = this.recentMessagesMap.delete(this.keyToString({ to, id: messageId }));
        if (removed) {
            return true;
        }
        // Fall back to the id index only when unambiguous: the entry may be
        // cached under the PN/LID alias of `to`, but custom ids can repeat
        // across chats.
        const indexedKeys = this.messageKeyIndex.get(messageId);
        return indexedKeys?.size === 1 ? this.removeRecentMessagesById(messageId) : false;
    }
    /** Remove one exact cache entry and mark the message unavailable for retries. */
    invalidateRecentMessage(to, messageId) {
        const keyStr = this.keyToString({ to, id: messageId });
        this.coordinator.invalidateMessage(to, messageId);
        return this.recentMessagesMap.delete(keyStr);
    }
    isRecentMessageInvalidated(to, messageId) {
        return this.coordinator.isMessageInvalidated(to, messageId);
    }
    withRecentMessageLock(to, messageId, task) {
        return this.coordinator.withMessageLock(to, messageId, task);
    }
    removeRecentMessagesById(messageId) {
        const indexedKeys = this.messageKeyIndex.get(messageId);
        if (!indexedKeys) {
            return false;
        }
        let removed = false;
        for (const keyStr of [...indexedKeys]) {
            removed = this.recentMessagesMap.delete(keyStr) || removed;
        }
        return removed;
    }
}
const retryCacheTargetForContent = (content) => {
    const target = 'delete' in content && content.delete ? content.delete : 'edit' in content ? content.edit : undefined;
    return target?.fromMe === true && target.remoteJid && target.id ? target : undefined;
};
/**
 * Drop the original message from the retry cache after a local revoke or edit
 * has been relayed successfully.
 *
 * The full destination/message pair is required because callers may provide
 * custom message IDs and reuse the same ID in different chats.
 */
export const invalidateRecentMessageForContent = (manager, content) => {
    const target = retryCacheTargetForContent(content);
    if (!target) {
        return false;
    }
    return manager.invalidateRecentMessage(target.remoteJid, target.id);
};
/**
 * Serialize a sendMessage-generated edit/revoke with retries for its target.
 * Coordination is updated only after the caller's relay succeeds; the optional
 * recent-message payload cache is removed when present.
 */
export const withMessageRetryInvalidation = async (coordinator, manager, content, task) => {
    const target = retryCacheTargetForContent(content);
    if (!target) {
        return task();
    }
    return coordinator.withMessageLock(target.remoteJid, target.id, async () => {
        const result = await task();
        coordinator.invalidateMessage(target.remoteJid, target.id);
        manager?.removeRecentMessage(target.remoteJid, target.id);
        return result;
    });
};
//# sourceMappingURL=message-retry-manager.js.map