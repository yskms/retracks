/** purchases.ts / purchases.ios.ts で共有する型定義。 */
export type PurchaseResult =
  | { success: true }
  | { success: false; cancelled: true }
  | { success: false; cancelled: false; errorMessage: string };
