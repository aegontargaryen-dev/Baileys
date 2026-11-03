import type { ILogger } from '../Utils/logger.js';
export declare const BUSINESS_ORDER_MEX_QUERY: {
    readonly queryId: "26593811266898374";
    readonly dataPath: "xwa_checkout_get_order_info";
};
export declare const orderMexVariables: (jid: string, orderId: string, token: string) => {
    request: {
        order: {
            id: string;
            jid: string;
            token: {
                sensitive_string_value: string;
            };
            image_dimensions: {
                width: number;
                height: number;
            };
            direct_connection_encrypted_info: null;
        };
    };
};
type ExecuteMexQuery = (variables: Record<string, unknown>, queryId: string, dataPath: string) => Promise<unknown>;
type FetchMexOrderDetailsOptions = {
    orderId: string;
    token: string;
    requestedJid: string;
    ownJids: readonly (string | undefined)[];
    executeQuery: ExecuteMexQuery;
    logger: ILogger;
};
export declare const resolveOrderMexJid: (requestedJid: string, ownJids: readonly (string | undefined)[]) => string | undefined;
export declare const fetchMexOrderDetails: ({ orderId, token, requestedJid, ownJids, executeQuery, logger }: FetchMexOrderDetailsOptions) => Promise<import("../index.js").OrderDetails>;
export {};
//# sourceMappingURL=business-mex.d.ts.map