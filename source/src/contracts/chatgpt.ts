// The owner explicitly approved this destination on 27 October 2026.
export const approvedChatGptOrigin =
  "https://the-ride-online-probe.onrender.com";
export type SubscriptionStatus = {
  state: "disconnected" | "active" | "refreshing" | "reauth_required";
  accessExpiresAt: string | null;
  checkedAt: string | null;
  errorCode: string | null;
};
export type SubscriptionActionState = {
  ok: boolean;
  message: string;
  pairCode?: string;
  pairExpiresAt?: number;
  models?: { slug: string; name: string }[];
};
export const initialSubscriptionState: SubscriptionActionState = {
  ok: false,
  message: "",
};
