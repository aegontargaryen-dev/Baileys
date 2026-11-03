import { proto } from '../../WAProto/index.js'
import type { SocketConfig, WAMessage, WAMessageKey, WAMessageUpdate } from '../Types'
import { areJidsSameUser, isHostedLidUser, isHostedPnUser, isLidUser, isPnUser, jidNormalizedUser } from '../WABinary'
import { aesDecryptGCM, hmacSign } from './crypto'
import { toNumber } from './generics'
import type { ILogger } from './logger'
import { normalizeMessageContent } from './messages'

type MessageEditContext = {
	originalSenderJid: string
	originalMsgId: string
	messageSecret: Uint8Array
	editorJid: string
}

type MessageEditLIDMapping = {
	getLIDForPN: (pn: string) => Promise<string | null>
	getPNForLID: (lid: string) => Promise<string | null>
}

type ProcessEncryptedMessageEditOptions = {
	message: WAMessage
	secretEncryptedMessage: proto.Message.ISecretEncryptedMessage
	getMessage: SocketConfig['getMessage']
	lidMapping: MessageEditLIDMapping
	logger: ILogger
	meId: string
	meLid?: string
}

const isUserJid = (jid: string | null | undefined): jid is string =>
	!!jid && !!(isPnUser(jid) || isLidUser(jid) || isHostedPnUser(jid) || isHostedLidUser(jid))

const uniqueNormalizedJids = (jids: Array<string | null | undefined>): string[] => [
	...new Set(jids.filter(isUserJid).map(jidNormalizedUser))
]

const expandAddressingCandidates = async (
	jids: Array<string | null | undefined>,
	lidMapping: MessageEditLIDMapping,
	logger: ILogger
): Promise<string[]> => {
	const candidates = uniqueNormalizedJids(jids)
	for (const jid of [...candidates]) {
		try {
			const alternate =
				isLidUser(jid) || isHostedLidUser(jid) ? await lidMapping.getPNForLID(jid) : await lidMapping.getLIDForPN(jid)
			if (isUserJid(alternate)) {
				const normalized = jidNormalizedUser(alternate)
				if (!candidates.includes(normalized)) {
					candidates.push(normalized)
				}
			}
		} catch (err) {
			logger.debug({ err }, 'failed to resolve alternate addressing for message edit')
		}
	}

	return candidates
}

const getLocalOriginalKey = (messageKey: WAMessageKey, originalMsgId: string): WAMessageKey => ({
	...messageKey,
	id: originalMsgId
})

const isSameUserAny = (a: string[], b: string[]): boolean => a.some(x => b.some(y => x === y || areJidsSameUser(x, y)))

const normalizeMessageSecret = (secret: unknown): Uint8Array | undefined => {
	// Stores backed by JSON may hand the secret back as a base64 string.
	if (typeof secret === 'string') {
		return Buffer.from(secret.replace(/^data:;base64,/, ''), 'base64')
	}

	return secret instanceof Uint8Array ? secret : undefined
}

const getEnvelopeAuthorJids = (message: WAMessage, meId: string, meLid?: string) =>
	message.key.fromMe
		? [meId, meLid]
		: [message.key.participant, message.key.participantAlt, message.key.remoteJid, message.key.remoteJidAlt]

const getOriginalSenderJids = (
	message: WAMessage,
	targetKey: WAMessageKey,
	envelopeAuthorJids: Array<string | null | undefined>
) => {
	if (targetKey.fromMe) {
		return envelopeAuthorJids
	}

	return isUserJid(message.key.remoteJid)
		? [targetKey.remoteJid, ...envelopeAuthorJids]
		: [targetKey.participant, ...envelopeAuthorJids]
}

const decryptWithJidCandidates = (
	secretEncryptedMessage: proto.Message.ISecretEncryptedMessage,
	originalMsgId: string,
	messageSecret: Uint8Array,
	originalSenderCandidates: string[],
	editorCandidates: string[]
): { decoded?: proto.Message; lastError?: unknown } => {
	let lastError: unknown
	for (const originalSenderJid of originalSenderCandidates) {
		for (const editorJid of editorCandidates) {
			try {
				return {
					decoded: decryptMessageEdit(secretEncryptedMessage, {
						originalSenderJid,
						originalMsgId,
						messageSecret,
						editorJid
					})
				}
			} catch (err) {
				lastError = err
			}
		}
	}

	return { lastError }
}

export const isEncryptedMessageEdit = (
	content: proto.IMessage | null | undefined
): content is proto.IMessage & { secretEncryptedMessage: proto.Message.ISecretEncryptedMessage } =>
	content?.secretEncryptedMessage?.secretEncType === proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT

/**
 * MESSAGE_EDIT uses the same single-block HKDF-SHA256 construction as other
 * encrypted add-ons, but binds the edit identities in the info and uses empty AAD.
 */
export const decryptMessageEdit = (
	{ encPayload, encIv }: proto.Message.ISecretEncryptedMessage,
	{ originalSenderJid, originalMsgId, messageSecret, editorJid }: MessageEditContext
): proto.Message => {
	if (messageSecret.byteLength !== 32) {
		throw new Error(`Invalid MESSAGE_EDIT message secret length: expected 32, got ${messageSecret.byteLength}`)
	}

	if (!encPayload?.length) {
		throw new Error('Invalid MESSAGE_EDIT payload: missing encrypted content')
	}

	if (encIv?.length !== 12) {
		throw new Error(`Invalid MESSAGE_EDIT IV length: expected 12, got ${encIv?.length ?? 0}`)
	}

	const info = Buffer.concat([
		Buffer.from(originalMsgId),
		Buffer.from(originalSenderJid),
		Buffer.from(editorJid),
		Buffer.from('Message Edit'),
		new Uint8Array([1])
	])
	const extractedKey = hmacSign(messageSecret, new Uint8Array(32), 'sha256')
	const decryptionKey = hmacSign(info, extractedKey, 'sha256')
	const plaintext = aesDecryptGCM(encPayload, decryptionKey, encIv, new Uint8Array(0))

	return proto.Message.decode(plaintext)
}

export const processEncryptedMessageEdit = async ({
	message,
	secretEncryptedMessage,
	getMessage,
	lidMapping,
	logger,
	meId,
	meLid
}: ProcessEncryptedMessageEditOptions): Promise<WAMessageUpdate | undefined> => {
	const targetKey = secretEncryptedMessage.targetMessageKey
	if (
		secretEncryptedMessage.secretEncType !== proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT ||
		!targetKey?.id ||
		!secretEncryptedMessage.encPayload?.length ||
		secretEncryptedMessage.encIv?.length !== 12
	) {
		logger.warn(
			{
				hasExpectedType:
					secretEncryptedMessage.secretEncType === proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT,
				hasTargetId: !!targetKey?.id,
				hasPayload: !!secretEncryptedMessage.encPayload?.length,
				ivLength: secretEncryptedMessage.encIv?.length
			},
			'invalid encrypted message edit envelope'
		)
		return
	}

	const originalKey = getLocalOriginalKey(message.key, targetKey.id)
	let originalMessage: proto.IMessage | undefined
	try {
		originalMessage = await getMessage(originalKey)
	} catch (err) {
		logger.warn({ err }, 'failed to retrieve the original message for edit decryption')
		return
	}

	const messageSecret = normalizeMessageSecret(
		originalMessage?.messageContextInfo?.messageSecret ||
			normalizeMessageContent(originalMessage)?.messageContextInfo?.messageSecret
	)
	if (!messageSecret || messageSecret.byteLength !== 32) {
		logger.warn(
			{ foundOriginal: !!originalMessage, secretLength: messageSecret?.byteLength },
			'cannot decrypt message edit without the original message secret'
		)
		return
	}

	// The target must name a message in this chat; targetMessageKey is
	// plaintext envelope data, so never let it point at another chat. The
	// key is written from the editor's perspective, so in a 1:1 chat its
	// remoteJid may name us (the editor's counterparty) instead.
	if (targetKey.remoteJid) {
		const allowedChats = uniqueNormalizedJids([message.key.remoteJid, message.key.remoteJidAlt, meId, meLid])
		const targetChat = jidNormalizedUser(targetKey.remoteJid)
		if (targetChat !== jidNormalizedUser(message.key.remoteJid ?? undefined) && !allowedChats.includes(targetChat)) {
			logger.warn({}, 'encrypted message edit targets a different chat, ignoring')
			return
		}
	}

	const envelopeAuthorJids = getEnvelopeAuthorJids(message, meId, meLid)
	const originalSenderJids = getOriginalSenderJids(message, targetKey, envelopeAuthorJids)
	// Claimed original-author identities for the author gate below, in our
	// perspective. targetMessageKey is editor-perspective: fromMe there
	// means "the editor authored the original".
	const originalAuthorJids: Array<string | null | undefined> = isUserJid(message.key.remoteJid)
		? targetKey.fromMe
			? envelopeAuthorJids
			: message.key.fromMe
				? [message.key.remoteJid, message.key.remoteJidAlt]
				: [meId, meLid]
		: targetKey.participant
			? [targetKey.participant]
			: envelopeAuthorJids
	const receivedEditorCandidates = uniqueNormalizedJids(envelopeAuthorJids)
	const receivedOriginalSenderCandidates = uniqueNormalizedJids(originalSenderJids)
	if (!receivedEditorCandidates.length || !receivedOriginalSenderCandidates.length) {
		logger.warn(
			{
				editorCandidateCount: receivedEditorCandidates.length,
				originalSenderCandidateCount: receivedOriginalSenderCandidates.length
			},
			'cannot decrypt message edit without sender addressing'
		)
		return
	}

	// Every recipient of the original knows its messageSecret, so a valid
	// AES-GCM tag alone does not authenticate the editor. Only the original
	// author may edit: the Signal-authenticated envelope author must be the
	// same user (PN/LID-equivalent) as the original sender.
	const receivedOriginalAuthorCandidates = uniqueNormalizedJids(originalAuthorJids)
	let decoded: proto.Message | undefined
	let lastError: unknown
	if (isSameUserAny(receivedOriginalAuthorCandidates, receivedEditorCandidates)) {
		;({ decoded, lastError } = decryptWithJidCandidates(
			secretEncryptedMessage,
			targetKey.id,
			messageSecret,
			receivedOriginalSenderCandidates,
			receivedEditorCandidates
		))
	}

	if (!decoded) {
		const [expandedOriginalSenderCandidates, expandedEditorCandidates, expandedOriginalAuthorCandidates] =
			await Promise.all([
				expandAddressingCandidates(originalSenderJids, lidMapping, logger),
				expandAddressingCandidates(envelopeAuthorJids, lidMapping, logger),
				expandAddressingCandidates(originalAuthorJids, lidMapping, logger)
			])
		if (!isSameUserAny(expandedOriginalAuthorCandidates, expandedEditorCandidates)) {
			logger.warn({}, 'encrypted message edit author is not the original sender, ignoring')
			return
		}

		const retry = decryptWithJidCandidates(
			secretEncryptedMessage,
			targetKey.id,
			messageSecret,
			expandedOriginalSenderCandidates,
			expandedEditorCandidates
		)
		decoded = retry.decoded
		lastError = retry.lastError
	}

	if (!decoded) {
		logger.warn({ err: lastError }, 'failed to decrypt encrypted message edit')
		return
	}

	const protocolMessage = decoded.protocolMessage
	if (
		protocolMessage?.type !== proto.Message.ProtocolMessage.Type.MESSAGE_EDIT ||
		!protocolMessage.editedMessage ||
		(protocolMessage.key?.id && protocolMessage.key.id !== targetKey.id)
	) {
		logger.warn(
			{
				protocolType: protocolMessage?.type,
				hasEditedMessage: !!protocolMessage?.editedMessage,
				hasMatchingTarget: !protocolMessage?.key?.id || protocolMessage.key.id === targetKey.id
			},
			'decrypted message edit contained an invalid protocol message'
		)
		return
	}

	return {
		key: originalKey,
		update: {
			message: {
				editedMessage: {
					message: protocolMessage.editedMessage
				}
			},
			messageTimestamp: protocolMessage.timestampMs
				? Math.floor(toNumber(protocolMessage.timestampMs) / 1000)
				: message.messageTimestamp
		}
	}
}
