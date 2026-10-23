export type Role = 'member' | 'desk' | 'manager' | 'owner';
export type Me = { id: number; name: string; email: string; role: Role };
const LEVEL: Record<Role, number> = { member: 0, desk: 1, manager: 2, owner: 3 };
export const can = (me: Me, role: Role) => LEVEL[me.role] >= LEVEL[role];
