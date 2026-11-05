import { jest } from '@jest/globals'
import P from 'pino'
import { LIDMappingStore } from '../../Signal/lid-mapping'
import type { LIDMapping, SignalDataTypeMap, SignalKeyStoreWithTransaction } from '../../Types'

const HOSTED_DEVICE_ID = 99

const mockKeys: jest.Mocked<SignalKeyStoreWithTransaction> = {
	get: jest.fn<SignalKeyStoreWithTransaction['get']>() as any,
	set: jest.fn<SignalKeyStoreWithTransaction['set']>(),
	transaction: jest.fn<SignalKeyStoreWithTransaction['transaction']>(async (work: () => any) => await work()) as any,
	isInTransaction: jest.fn<SignalKeyStoreWithTransaction['isInTransaction']>()
}
const logger = P({ level: 'silent' })

describe('LIDMappingStore', () => {
	const mockPnToLIDFunc = jest.fn<(jids: string[]) => Promise<LIDMapping[] | undefined>>()
	let lidMappingStore: LIDMappingStore

	beforeEach(() => {
		jest.clearAllMocks()
		lidMappingStore = new LIDMappingStore(mockKeys, logger, mockPnToLIDFunc)
	})

	describe('storeLIDPNMappings onMappingStored', () => {
		const pair = { lid: '111@lid', pn: '5511999@s.whatsapp.net' }
		let onMappingStored: jest.Mock<(mapping: LIDMapping) => void>

		beforeEach(() => {
			onMappingStored = jest.fn<(mapping: LIDMapping) => void>()
			lidMappingStore = new LIDMappingStore(mockKeys, logger, mockPnToLIDFunc, onMappingStored)
			// @ts-ignore simulate empty DB
			mockKeys.get.mockResolvedValue({} as SignalDataTypeMap['lid-mapping'])
		})

		it('notifies for a new mapping', async () => {
			await lidMappingStore.storeLIDPNMappings([pair])
			expect(onMappingStored).toHaveBeenCalledTimes(1)
			expect(onMappingStored).toHaveBeenCalledWith(pair)
		})

		it('does not notify again when the same mapping is stored again', async () => {
			await lidMappingStore.storeLIDPNMappings([pair])
			await lidMappingStore.storeLIDPNMappings([pair, pair])
			expect(onMappingStored).toHaveBeenCalledTimes(1)
		})

		it('notifies when the mapping changes value', async () => {
			await lidMappingStore.storeLIDPNMappings([pair])
			await lidMappingStore.storeLIDPNMappings([{ lid: '222@lid', pn: pair.pn }])
			expect(onMappingStored).toHaveBeenCalledTimes(2)
			expect(onMappingStored).toHaveBeenLastCalledWith({ lid: '222@lid', pn: pair.pn })
		})

		it('notifies only once for concurrent duplicate batches', async () => {
			await Promise.all([lidMappingStore.storeLIDPNMappings([pair]), lidMappingStore.storeLIDPNMappings([pair])])
			expect(onMappingStored).toHaveBeenCalledTimes(1)
		})
	})

	describe('getPNForLID', () => {
		it('should correctly map a standard LID with a hosted device ID back to a standard PN with a hosted device', async () => {
			const lidWithHostedDevice = `12345:${HOSTED_DEVICE_ID}@lid`
			const pnUser = '54321'

			// @ts-ignore
			mockKeys.get.mockResolvedValue({ [`12345_reverse`]: pnUser } as SignalDataTypeMap['lid-mapping'])

			const result = await lidMappingStore.getPNForLID(lidWithHostedDevice)
			expect(result).toBe(`${pnUser}:${HOSTED_DEVICE_ID}@s.whatsapp.net`)
		})

		it('should return null if no reverse mapping is found', async () => {
			const lid = 'nonexistent@lid'

			// @ts-ignore
			mockKeys.get.mockResolvedValue({} as SignalDataTypeMap['lid-mapping']) // Simulate not found in DB

			const result = await lidMappingStore.getPNForLID(lid)
			expect(result).toBeNull()
		})
	})
})
