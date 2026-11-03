import type { USyncQueryProtocol } from '../../Types/USync'
import type { BinaryNode } from '../../WABinary'
import { USyncQuery } from '../../WAUSync/USyncQuery'

const protocol = (name: string, parser: (node: BinaryNode) => unknown): USyncQueryProtocol =>
	({
		name,
		parser,
		getQueryElement: () => null,
		getUserElement: () => null
	}) as unknown as USyncQueryProtocol

const resultNode = (userContent: BinaryNode[]): BinaryNode => ({
	tag: 'iq',
	attrs: { type: 'result' },
	content: [
		{
			tag: 'usync',
			attrs: {},
			content: [
				{
					tag: 'list',
					attrs: {},
					content: [{ tag: 'user', attrs: { jid: '12345@s.whatsapp.net' }, content: userContent }]
				}
			]
		}
	]
})

describe('USyncQuery.parseUSyncQueryResult', () => {
	it('does not let one throwing protocol parser kill the whole result', () => {
		const query = new USyncQuery()
		query.protocols.push(
			protocol('bad', () => {
				throw new Error('malformed protocol node')
			}),
			protocol('good', () => 'parsed')
		)

		const result = query.parseUSyncQueryResult(
			resultNode([
				{ tag: 'bad', attrs: {} },
				{ tag: 'good', attrs: {} }
			])
		)

		expect(result?.list).toHaveLength(1)
		expect(result?.list[0]?.id).toBe('12345@s.whatsapp.net')
		expect(result?.list[0]?.['good']).toBe('parsed')
		expect(result?.list[0]).not.toHaveProperty('bad')
	})

	it('skips content entries without a tag instead of throwing', () => {
		const query = new USyncQuery()
		query.protocols.push(protocol('good', () => 'parsed'))

		const result = query.parseUSyncQueryResult(resultNode([{ attrs: {} } as BinaryNode, { tag: 'good', attrs: {} }]))

		expect(result?.list[0]?.['good']).toBe('parsed')
	})
})
