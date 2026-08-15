// Shared adminMutate type used by the admin/page.tsx parent and both edit
// modals (SpotEditModal, AdEditModal). The parent's implementation handles
// both 'coupleAds' and 'coupleSpots' via a single API endpoint, so the
// modals can accept the union — no `as any` cast needed at the call site.

export type AdminMutate = (
  collection: 'coupleAds' | 'coupleSpots',
  id: string,
  fields: Record<string, unknown>,
  options?: { delete?: boolean }
) => Promise<void>;
