// Shared by the e2e server and the specs. Kept apart from scripts/e2e-server.ts on purpose:
// importing that file would start a second server inside the test worker.
export const E2E_KEY = "sk_e2e_dashboard_key_0000000000000000";
export const E2E_UW_KEY = "uw_e2e_priya_000000000";
export const E2E_DEMO_UW_KEY = "uw_e2e_demo_public_00";
/** Accounts with this email can open /admin. */
export const E2E_ADMIN_EMAIL = "admin@vendorstreet.test";
