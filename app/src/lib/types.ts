// Shapes returned by the API.
export type Activity = { id: number; name: string; categoryId: number; defaultPrice: number; defaultCapacity: number; imageKey: string | null };
export type Category = { id: number; name: string; emoji: string; sort: number };
export type Tournament = {
  id: number; title: string; activityId: number; startsAt: string; entryFee: number; maxPlayers: number;
  status: 'draft' | 'open' | 'closed' | 'live' | 'finished'; players?: number;
};
export type Catalog = {
  categories: Category[]; activities: Activity[]; tournaments: Tournament[];
  payment: { upiId: string; payeeName: string }; imageBase: string;
};
export type Slot = {
  id: number; activityId: number; activity: string; zone: string; startsAt: string; endsAt: string;
  price: number; hostName: string | null; seatsLeft: number; capacity: number;
};
export type MyBooking = {
  ref: string; status: 'pending' | 'confirmed' | 'checked_in' | 'cancelled' | 'no_show' | 'expired';
  seats: number; amount: number; holdUntil: string | null; activityId: number; activity: string; zone: string;
  startsAt: string; endsAt: string; hostName: string | null;
};
export type Match = { id: number; round: number; position: number; player1Id: number | null; player2Id: number | null; winnerId: number | null };
export type Bracket = { tournament: Tournament; players: { id: number; name: string }[]; matches: Match[]; joined: boolean };
