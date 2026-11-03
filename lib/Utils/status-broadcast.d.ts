import type { LIDMapping } from '../Types/index.js';
type ResolveStatusJidListOptions = {
    statusJidList: string[];
    meLid?: string;
    getLIDsForPNs: (pns: string[]) => Promise<LIDMapping[] | null>;
};
/**
 * Resolve status broadcast recipients to LID on LID-migrated accounts.
 * Legacy PN-only accounts keep their existing recipient addressing.
 */
export declare function resolveStatusJidList({ statusJidList, meLid, getLIDsForPNs }: ResolveStatusJidListOptions): Promise<string[]>;
export {};
//# sourceMappingURL=status-broadcast.d.ts.map