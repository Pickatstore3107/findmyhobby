// Shapes returned by the API's /admin endpoints.
export type Slot = {
  id: number; activityId: number; startsAt: string; endsAt: string;
  price: number; capacity: number; bookedSeats: number; hostId: number | null; closed: boolean; cancelled: boolean;
};
export type AdminSlot = { slot: Slot; activity: string; color: string; hostName: string | null };
export type Booking = {
  ref: string; status: 'pending' | 'confirmed' | 'checked_in' | 'cancelled' | 'no_show' | 'expired';
  seats: number; amount: number; bookedAt: string; name: string; phone: string | null; activity: string; category: string; startsAt: string;
};
export type Payment = {
  payment: { id: number; bookingId: number | null; method: 'upi' | 'venue' | 'gateway'; amount: number; utr: string | null; status: string; createdAt: string };
  ref: string | null; name: string | null; phone: string | null;
};
export type Activity = {
  id: number; name: string; categoryId: number; defaultPrice: number; defaultCapacity: number; active: boolean; imageKey: string | null;
  about: string | null; bring: string | null; level: string; durationMin: number; defaultHostId: number | null;
};
export type Category = { id: number; name: string; emoji: string; color: string; sort: number };
export type Host = { id: number; name: string; bio: string | null; active: boolean };
export type Catalog = { categories: Category[]; hosts: Host[]; activities: Activity[]; imageBase: string };
export type Revenue = { day: string; collected: string; refunded: string; net: string }[];
export type Tournament = {
  id: number; title: string; activityId: number; startsAt: string; entryFee: number; maxPlayers: number;
  bannerKey: string | null; status: 'draft' | 'open' | 'closed' | 'live' | 'finished';
};
export type Match = { id: number; round: number; position: number; player1Id: number | null; player2Id: number | null; winnerId: number | null };
export type Bracket = { tournament: Tournament; players: { id: number; name: string }[]; matches: Match[] };
export type AdminUser = { id: number; name: string; email: string; phone: string | null; role: 'member' | 'desk' | 'manager' | 'owner'; blocked: boolean };
export type MemberRecord = {
  user: AdminUser & { joined: string };
  bookings: { ref: string; status: Booking['status']; seats: number; amount: number; activity: string; startsAt: string }[];
  points: { total: number; ledger: { id: number; points: number; reason: string; note: string | null; createdAt: string }[] };
};
// revenue is left out for managers: money figures are owner-only.
type Seats = { capacity: number; booked: number; attended: number; no_shows: number; cancellations: number; revenue?: number };
export type Report = {
  totals: { bookings: number; members: number; repeat_members: number; sessions: number; capacity: number; booked: number;
    attended: number; noShows: number; cancellations: number; revenue?: number };
  byActivity: (Seats & { id: number; activity: string; category: string; sessions: number })[];
  bySession: (Seats & { id: number; activity: string; starts_at: string })[];
  byHour: { hour: number; sessions: number; capacity: number; booked: number }[];
};
