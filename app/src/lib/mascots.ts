import type { ImageSource } from 'expo-image';

// The 24 characters from the design's character sheet (row by row). Each activity gets its own mascot.
const ALL: ImageSource[] = [
  require('../../assets/img/mascots/0.webp'), require('../../assets/img/mascots/1.webp'), require('../../assets/img/mascots/2.webp'),
  require('../../assets/img/mascots/3.webp'), require('../../assets/img/mascots/4.webp'), require('../../assets/img/mascots/5.webp'),
  require('../../assets/img/mascots/6.webp'), require('../../assets/img/mascots/7.webp'), require('../../assets/img/mascots/8.webp'),
  require('../../assets/img/mascots/9.webp'), require('../../assets/img/mascots/10.webp'), require('../../assets/img/mascots/11.webp'),
  require('../../assets/img/mascots/12.webp'), require('../../assets/img/mascots/13.webp'), require('../../assets/img/mascots/14.webp'),
  require('../../assets/img/mascots/15.webp'), require('../../assets/img/mascots/16.webp'), require('../../assets/img/mascots/17.webp'),
  require('../../assets/img/mascots/18.webp'), require('../../assets/img/mascots/19.webp'), require('../../assets/img/mascots/20.webp'),
  require('../../assets/img/mascots/21.webp'), require('../../assets/img/mascots/22.webp'), require('../../assets/img/mascots/23.webp'),
];

// Fixed picks from the design handoff; any other activity gets a stable character based on its id.
const BY_NAME: Record<string, number> = {
  'table tennis': 3, chess: 6, pool: 11, carrom: 10, gaming: 1, quiz: 8, 'quiz night': 8,
  yoga: 7, dance: 2, painting: 5, calligraphy: 9, 'ai class': 1, 'video editing': 4, 'board games': 0, karaoke: 13,
};
export const PANDA = ALL[17];

export const mascot = (activity: { id: number; name: string }) =>
  ALL[BY_NAME[activity.name.toLowerCase()] ?? (activity.id * 7) % ALL.length];
