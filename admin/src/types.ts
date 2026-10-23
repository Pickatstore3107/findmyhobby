// Shapes returned by the API's /admin endpoints.
export type Slot = {
  id: number; activityId: number; zoneId: number; startsAt: string; endsAt: string;
  price: number; capacity: number; bookedSeats: number; hostName: string | null; cancelled: boolean;
};
export type AdminSlot = { slot: Slot; activity: string; zone: string };
export type Booking = {
  ref: string; status: 'pending' | 'confirmed' | 'checked_in' | 'cancelled' | 'no_show' | 'expired';
  seats: number; amount: number; bookedAt: string; name: string; phone: string | null; activity: string; zone: string; startsAt: string;
};
export type Payment = {
  payment: { id: number; bookingId: number | null; method: 'upi' | 'venue' | 'gateway'; amount: number; utr: string | null; status: string; createdAt: string };
  ref: string | null; name: string | null; phone: string | null;
};
export type Activity = { id: number; name: string; categoryId: number; defaultPrice: number; defaultCapacity: number; active: boolean; imageKey: string | null };
export type Catalog = { categories: { id: number; name: string; emoji: string }[]; zones: { id: number; name: string }[]; activities: Activity[] };
export type Revenue = { day: string; collected: string; refunded: string; net: string }[];
