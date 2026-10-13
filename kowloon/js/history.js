// Timeline, captions and the vocabulary the city is generated from.

export const FLOOR_H = 2.8;          // metres per storey
export const HEIGHT_CAP = 14;        // Kai Tak's approach path capped the city
export const YEAR_START = 1947.0;
export const YEAR_END = 1996.3;
export const DEMO_START = 1993.22;   // demolition began March 1993
export const DEMO_END = 1994.3;      // last block down by April 1994
export const PARK_OPEN = 1995.95;    // park opened December 1995
export const SITE_KM2 = 0.026;       // ~2.6 hectares

export const ERAS = [
  { from: 1947, to: 1958, name: 'Squatters', zh: '寮屋' },
  { from: 1958, to: 1970, name: 'Concrete', zh: '石屎' },
  { from: 1970, to: 1987, name: 'Peak', zh: '極盛' },
  { from: 1987, to: 1993.2, name: 'Clearance', zh: '清拆' },
  { from: 1993.2, to: 1994.6, name: 'Demolition', zh: '拆卸' },
  { from: 1994.6, to: YEAR_END, name: 'Park', zh: '公園' },
];

// Kept to claims that are well documented; figures are rounded.
export const CAPTIONS = [
  { year: 1947.0, zh: '戰後', text: 'The walls are gone, quarried during the Japanese occupation to extend Kai Tak. Refugees move into the enclave that neither Britain nor China runs.' },
  { year: 1951.5, zh: '寮屋', text: 'Wooden huts and tin roofs spread over the old fort. The yamen, the Qing magistrate’s office, sits in the middle of it all.' },
  { year: 1959.0, zh: '石屎', text: 'Concrete replaces timber. No building code applies here, so every lot rises as far as its owner dares.' },
  { year: 1967.9, zh: '天線', text: 'Free-to-air television arrives. A forest of antennas grows on the roofs.' },
  { year: 1972.0, zh: '十四層', text: 'Jets on the runway 13 approach pass just overhead. The flight path caps the city at about fourteen storeys.' },
  { year: 1976.5, zh: '暗巷', text: 'Upper floors cantilever over the alleys until they nearly touch. Down below, fluorescent tubes burn all day.' },
  { year: 1981.5, zh: '密度', text: 'Around 33,000 people on 2.6 hectares: roughly 1.3 million per square kilometre, among the densest places ever lived in.' },
  { year: 1987.1, zh: '決定', text: 'The Hong Kong and Chinese governments agree that the city will be cleared and demolished.' },
  { year: 1991.0, zh: '遷出', text: 'Residents are compensated and rehoused. The lights go out, floor by floor.' },
  { year: DEMO_START, zh: '拆卸', text: 'Demolition begins.' },
  { year: 1994.25, zh: '平地', text: 'The last block comes down. Only the yamen is kept.' },
  { year: 1995.0, zh: '園林', text: 'A Jiangnan-style garden is laid out over the footprint, with the yamen at its centre.' },
  { year: PARK_OPEN, zh: '公園', text: 'Kowloon Walled City Park opens. Planes still land at Kai Tak, for now.' },
];

export const MODE_NOTES = {
  rooftop: 'The roofs were the open space. Kids played up here, laundry dried, and the jets went over close enough to read the registration.',
  alley: 'Ground level. Water drips from a thousand pipes, wires sag across the gap, and daylight is a rumour.',
  ride: 'IGS 13: fly the beam towards the checkerboard on Kowloon Tsai hill, bank right 47° at about 650 ft, roll out over Kowloon City and land.',
  orbit: '',
};

// Street names from the city itself.
export const STREETS = [
  ['龍津路', 'Lung Chun Road'], ['大井街', 'Tai Tseng Street'], ['老人街', 'Lo Yan Street'],
  ['光明街', 'Kwong Ming Street'], ['西城路', 'Sai Shing Road'], ['龍城路', 'Lung Shing Road'],
  ['城南道', 'Sing Nam Road'], ['東頭村道', 'Tung Tau Tsuen Road'], ['天后廟道', 'Tin Hau Temple Road'],
  ['福壽街', 'Fuk Sau Street'], ['新興街', 'Sun Hing Street'], ['龍津東路', 'Lung Chun East Road'],
];

export const SIGN_WORDS = [
  ['牙科', 'neon'], ['牙醫', 'box'], ['牙科診所', 'neon'], ['鑲牙', 'box'], ['診所', 'box'],
  ['魚蛋', 'neon'], ['麵家', 'neon'], ['冰室', 'neon'], ['酒家', 'neon'], ['士多', 'box'],
  ['大押', 'neon'], ['跌打', 'box'], ['藥房', 'neon'], ['理髮', 'box'], ['麻雀', 'neon'],
  ['金舖', 'neon'], ['鐘錶', 'box'], ['五金', 'box'], ['粥麵', 'neon'], ['涼茶', 'box'],
  ['燒臘', 'neon'], ['車房', 'box'], ['膠花', 'box'], ['裁縫', 'box'], ['西醫', 'neon'],
  ['旅館', 'neon'], ['茶樓', 'neon'], ['米舖', 'box'], ['電器', 'box'], ['影樓', 'neon'],
];

// What a floor might be. Weights shift by height and era in world.js.
export const OCCUPANTS = [
  { k: 'home', w: 70, zh: '住戶', label: (r) => `Home of the ${r.pick(SURNAMES)} family, ${r.int(3, 9)} people in ${r.int(18, 34)} m²` },
  { k: 'dentist', w: 4, zh: '牙科', label: (r) => `Dental clinic of Dr ${r.pick(SURNAMES)}. Unlicensed in Hong Kong, legal enough in here.` },
  { k: 'doctor', w: 3, zh: '診所', label: (r) => `Clinic of Dr ${r.pick(SURNAMES)}, trained in ${r.pick(['Guangzhou', 'Shanghai', 'Fuzhou', 'Shantou'])}.` },
  { k: 'fishball', w: 4, zh: '魚蛋廠', label: (r) => `Fishball factory. Supplies ${r.int(20, 90)} street stalls across Kowloon.` },
  { k: 'noodle', w: 3, zh: '麵廠', label: () => 'Noodle maker. Dough hangs to dry across the corridor.' },
  { k: 'plastics', w: 3, zh: '膠廠', label: (r) => `Plastics workshop: ${r.pick(['flowers', 'toys', 'buttons', 'combs'])} by the sack.` },
  { k: 'metal', w: 2, zh: '五金', label: () => 'Metal workshop. Lathes running until midnight.' },
  { k: 'school', w: 1.2, zh: '學校', label: (r) => `Kindergarten, ${r.int(25, 60)} children in two rooms.` },
  { k: 'temple', w: 0.6, zh: '廟', label: () => 'A small shrine to Tin Hau, incense always burning.' },
  { k: 'church', w: 0.6, zh: '教會', label: () => 'Mission room. Youth club on weeknights.' },
  { k: 'elderly', w: 1, zh: '老人院', label: () => 'Home for the elderly. Mahjong after lunch.' },
  { k: 'mahjong', w: 1.5, zh: '麻雀館', label: () => 'Mahjong parlour. You hear it two floors away.' },
  { k: 'empty', w: 2, zh: '空置', label: () => 'Empty. Water tanks on the roof above leak into it.' },
];

export const SURNAMES = ['Chan', 'Wong', 'Lee', 'Cheung', 'Lau', 'Ng', 'Ho', 'Leung', 'Lam', 'Tsang', 'Yip', 'Kwok', 'Tang', 'Fung', 'Mak', 'Lo', 'Chow', 'Tse', 'Siu', 'Yuen'];
