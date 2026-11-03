// @ts-ignore
import * as libsignal from 'libsignal'
// @ts-ignore
import { PreKeyWhisperMessage } from 'libsignal/src/protobufs'
import P from 'pino'
import { makeLibSignalRepository } from '../../Signal/libsignal'
import { addTransactionCapability } from '../../Utils/auth-utils'
import { Curve } from '../../Utils/crypto'
import { makeSession } from '../TestUtils/session'

const logger = P({ level: 'silent' }) as never

describe('libsignal pkmsg identity handling', () => {
	it('does not persist the identity key from a pkmsg that fails to decrypt', async () => {
		const { state, clear } = await makeSession()
		try {
			const keys = addTransactionCapability(state.keys, logger, { maxCommitRetries: 1, delayBetweenTriesMs: 10 })
			const repository = makeLibSignalRepository({ creds: state.creds, keys }, logger)

			const senderJid = '12345@s.whatsapp.net'
			const addrStr = new libsignal.ProtocolAddress('12345', 0).toString()
			const attackerIdentityKey = Curve.generateKeyPair().public

			// A forged prekey message: well-formed protobuf carrying the
			// attacker's identity key, but no valid session/MAC behind it.
			const forged = PreKeyWhisperMessage.encode({
				registrationId: 1,
				preKeyId: 1,
				signedPreKeyId: 1,
				baseKey: Curve.generateKeyPair().public,
				identityKey: attackerIdentityKey,
				message: new Uint8Array([1, 2, 3, 4])
			}).finish()
			const ciphertext = Buffer.concat([Buffer.from([0x33]), Buffer.from(forged)])

			await expect(repository.decryptMessage({ jid: senderJid, type: 'pkmsg', ciphertext })).rejects.toThrow()

			const stored = await keys.get('identity-key', [addrStr])
			expect(stored[addrStr] ?? undefined).toBeUndefined()
			repository.close?.()
		} finally {
			await clear()
		}
	})
})
