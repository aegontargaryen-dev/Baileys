import { Boom } from '@hapi/boom';
import { isHostedLidUser, isHostedPnUser, isLidUser, isPnUser, jidNormalizedUser } from '../WABinary/index.js';
/**
 * Resolve status broadcast recipients to LID on LID-migrated accounts.
 * Legacy PN-only accounts keep their existing recipient addressing.
 */
export async function resolveStatusJidList({ statusJidList, meLid, getLIDsForPNs }) {
    const recipients = statusJidList.map(jidNormalizedUser);
    if (!meLid) {
        return [...new Set(recipients)];
    }
    recipients.push(jidNormalizedUser(meLid));
    const pnRecipients = [...new Set(recipients.filter(jid => isPnUser(jid) || isHostedPnUser(jid)))];
    const mappings = pnRecipients.length ? (await getLIDsForPNs(pnRecipients)) || [] : [];
    const lidByPn = new Map(mappings.map(({ pn, lid }) => [jidNormalizedUser(pn), jidNormalizedUser(lid)]));
    const resolved = recipients.map(jid => {
        if (isLidUser(jid) || isHostedLidUser(jid)) {
            return jid;
        }
        if (isPnUser(jid) || isHostedPnUser(jid)) {
            const lid = lidByPn.get(jid);
            if (!lid) {
                throw new Boom(`Could not resolve LID for status recipient ${jid}`, { statusCode: 400 });
            }
            return lid;
        }
        throw new Boom(`Invalid status recipient JID: ${jid}`, { statusCode: 400 });
    });
    return [...new Set(resolved)];
}
//# sourceMappingURL=status-broadcast.js.map