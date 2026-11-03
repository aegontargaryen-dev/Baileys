import type { AuthenticationCreds, WABrowserDescription } from '../Types/index.js';
import type { BinaryNode } from '../WABinary/index.js';
import type { ILogger } from './logger.js';
export declare enum CompanionWebClientType {
    UNKNOWN = 0,
    CHROME = 1,
    EDGE = 2,
    FIREFOX = 3,
    IE = 4,
    OPERA = 5,
    SAFARI = 6,
    ELECTRON = 7,
    UWP = 8,
    OTHER_WEB_CLIENT = 9
}
export type PairingCodePlatform = {
    id: string;
    display: string;
};
export declare const getCompanionWebClientType: ([os, browserName]: WABrowserDescription) => CompanionWebClientType;
export declare const getCompanionPlatformId: (browser: WABrowserDescription) => string;
export declare const getPairingCodePlatform: ([os, browserName]: WABrowserDescription) => PairingCodePlatform;
export declare const buildPairingQRData: (ref: string, noiseKeyB64: string, identityKeyB64: string, advB64: string, browser: WABrowserDescription) => string;
export type PairingQRRenderer = {
    /** Render the next ref's QR. False once the server's allotment is spent. */
    next(): boolean;
    /** Re-render the QR on screen. Consumes no ref; false if none is shown yet. */
    refresh(): boolean;
};
/**
 * Holds the ref currently on screen so it can be re-rendered.
 *
 * `render` is called with the ref rather than a finished payload so the caller
 * can read the adv secret at render time: a `companion_reg_refresh` rotates it
 * mid-flow, and every QR emitted afterwards has to advertise the new value.
 */
export declare const makePairingQRRenderer: (refs: string[], render: (ref: string) => void) => PairingQRRenderer;
export type CompanionRegRefreshContext = {
    creds: AuthenticationCreds;
    emitCredsUpdate: (update: Partial<AuthenticationCreds>) => void;
    refreshQR: () => void;
    logger: ILogger;
};
export type CompanionRegRefreshOutcome = 'rotated' | 'ignored_malformed' | 'ignored_registered';
/**
 * `<notification type="companion_reg_refresh">` - the server retiring an
 * unpaired companion's registration material.
 *
 * WA Web accepts the stanza with either a `companion_reg_refresh` or a
 * `pair-device-rotate-qr` child, rejects it when neither is present, and
 * answers by regenerating the adv secret key. That key is a quarter of what
 * the pairing QR advertises, so a client that only acks keeps offering a QR
 * built on a secret the server has already retired: the phone scans it,
 * reports a failed link, and no pair-success ever arrives.
 *
 * The ack itself is unchanged - the generic notification path already sends
 * it - so this only adds the rotation and the re-render.
 */
export declare const handleCompanionRegRefresh: (node: BinaryNode, { creds, emitCredsUpdate, refreshQR, logger }: CompanionRegRefreshContext) => CompanionRegRefreshOutcome;
//# sourceMappingURL=companion-reg-client-utils.d.ts.map