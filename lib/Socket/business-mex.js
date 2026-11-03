import { Boom } from '@hapi/boom';
import { parseMexOrderDetails } from '../Utils/business-mex.js';
import { areJidsSameUser, isLidUser, isPnUser, jidNormalizedUser } from '../WABinary/index.js';
export const BUSINESS_ORDER_MEX_QUERY = {
    queryId: '26593811266898374',
    dataPath: 'xwa_checkout_get_order_info'
};
export const orderMexVariables = (jid, orderId, token) => ({
    request: {
        order: {
            id: orderId,
            jid,
            token: { sensitive_string_value: token },
            image_dimensions: { width: 100, height: 100 },
            direct_connection_encrypted_info: null
        }
    }
});
export const resolveOrderMexJid = (requestedJid, ownJids) => {
    const requested = jidNormalizedUser(requestedJid);
    if (!requested)
        return undefined;
    const ownAliases = ownJids.map(jidNormalizedUser).filter((jid) => !!jid);
    const ownPn = ownAliases.find(isPnUser);
    const requestedIsOwnLid = isLidUser(requested) && ownAliases.some(ownJid => isLidUser(ownJid) && areJidsSameUser(ownJid, requested));
    return requestedIsOwnLid && ownPn ? ownPn : requested;
};
export const fetchMexOrderDetails = async ({ orderId, token, requestedJid, ownJids, executeQuery, logger }) => {
    if (!orderId?.trim() || !token?.trim()) {
        throw new Boom('Order details require a non-empty orderId and token', { statusCode: 400 });
    }
    // Resolve known local aliases before the single request; MEX failures must never select another JID.
    const jid = resolveOrderMexJid(requestedJid, ownJids);
    if (!jid)
        throw new Boom('Order details require a valid seller JID', { statusCode: 400 });
    const requested = jidNormalizedUser(requestedJid);
    logger.debug({
        queryId: BUSINESS_ORDER_MEX_QUERY.queryId,
        requestedJidType: isLidUser(requested) ? 'lid' : isPnUser(requested) ? 'pn' : 'other',
        resolvedJidType: isLidUser(jid) ? 'lid' : isPnUser(jid) ? 'pn' : 'other',
        usedOwnPnAlias: isLidUser(requested) && isPnUser(jid)
    }, 'querying order details through MEX');
    const result = await executeQuery(orderMexVariables(jid, orderId, token), BUSINESS_ORDER_MEX_QUERY.queryId, BUSINESS_ORDER_MEX_QUERY.dataPath);
    return parseMexOrderDetails(result);
};
//# sourceMappingURL=business-mex.js.map