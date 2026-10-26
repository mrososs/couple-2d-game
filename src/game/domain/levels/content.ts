import type { LevelId } from '../../bridge/protocol.ts';
import type { Product, BudgetRules } from '../budget.ts';
import type { BeddingItem, PieceSpec, RoomSpec } from '../nursery.ts';
import type { ObjectiveDef } from '../objectives.ts';
import type { ScheduleSpec, TaskCard } from '../planning.ts';

/**
 * Everything a level says, in Egyptian Arabic, and the data its puzzle runs on. The native screens
 * read the titles, insights and sources from here; the game page reads the rest. Nothing in this
 * file is medical advice: health and safety lines carry their source, and anything the sources do
 * not state outright is listed in `reviewNotes` for an expert to check before release.
 */

export interface SourceRef {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly usedFor: string;
}

export interface Insight {
  readonly title: string;
  readonly body: string;
  readonly emoji: string;
}

export interface LevelContent {
  readonly id: LevelId;
  readonly number: number;
  readonly title: string;
  readonly tagline: string;
  /** The one learning objective, in Arabic and in English for the record. */
  readonly learning: string;
  readonly learningEn: string;
  readonly emoji: string;
  readonly color: string;
  readonly intro: readonly string[];
  readonly objectives: readonly ObjectiveDef[];
  readonly insights: Readonly<Record<string, Insight>>;
  readonly takeaway: { readonly title: string; readonly body: string };
  readonly badge: { readonly name: string; readonly emoji: string };
  readonly sources: readonly SourceRef[];
  readonly disclaimer?: string;
  readonly reviewNotes: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Level 1

export const L1_CARDS: readonly (TaskCard & { readonly x: number; readonly y: number })[] = [
  { id: 'prenatal', title: 'مواعيد متابعة الحمل', icon: 'hospital', load: 2, tags: ['decision'], x: 300, y: 640 },
  { id: 'groceries', title: 'طلبات البيت', icon: 'cart', load: 3, tags: [], x: 1396, y: 196 },
  { id: 'cleaning', title: 'تنضيف البيت', icon: 'broom', load: 4, tags: [], x: 1700, y: 760 },
  { id: 'boxes', title: 'شيل كراتين أوضة البيبي', icon: 'box', load: 2, tags: ['heavy'], x: 1150, y: 330 },
  { id: 'cooking', title: 'تحضير الأكل', icon: 'pot', load: 4, tags: [], x: 1600, y: 196 },
  { id: 'hospital', title: 'اختيار المستشفى والدكتورة', icon: 'heart', load: 2, tags: ['decision'], x: 262, y: 180 },
  { id: 'budget', title: 'ميزانية البيبي', icon: 'money', load: 2, tags: ['decision'], x: 1240, y: 800 },
  { id: 'family', title: 'ترتيب مساعدة العيلة', icon: 'family', load: 2, tags: [], x: 560, y: 600 },
  { id: 'nights', title: 'خطة السهر بالليل', icon: 'moon', load: 3, tags: ['decision'], x: 152, y: 340 },
];

/** Tuesday is the only day the doctor, Mona and Karim all have free. */
export const L1_SCHEDULE: ScheduleSpec = {
  doctorDays: [1, 3, 5],
  wifeFree: [0, 2, 3, 6],
  husbandFree: [3, 5, 6],
};

const LEVEL1: LevelContent = {
  id: 'level01',
  number: 1,
  title: 'قرارنا الكبير الأول',
  tagline: 'نقسّم المسؤوليات سوا قبل ما البيبي ييجي',
  learning: 'التواصل وتقسيم المسؤوليات قبل الأبوة والأمومة',
  learningEn: 'Communication and sharing responsibilities before parenthood',
  emoji: '🗓️',
  color: '#E8735A',
  intro: ['خبر حلو: البيبي الأول جاي! 💛', 'لمّوا كروت المهام من البيت ورتّبوها على لوحة التخطيط'],
  objectives: [
    { id: 'cards', text: 'رتّبوا كروت المهام على اللوحة' },
    { id: 'schedule', text: 'اتفقوا على يوم لميعاد الدكتورة', hidden: true },
    { id: 'review', text: 'راجعوا الخطة سوا قدام اللوحة', hidden: true },
  ],
  insights: {
    shared: { emoji: '🤝', title: 'قرارات بتتاخد سوا', body: 'اختيار الدكتورة والميزانية وخطة السهر قرارات بتخص الاتنين، فبتتاخد سوا.' },
    care: { emoji: '💪', title: 'الشيل التقيل مش عليها لوحدها', body: 'وقت الحمل احتياجات الجسم بتتغير، فالمجهود البدني التقيل بيتوزع بحساب.' },
    balance: { emoji: '⚖️', title: 'حِمل متوازن', body: 'مفيش تقسيم واحد صح. المهم إن الحِمل يريّح الاتنين ويتغير لما الظروف تتغير.' },
    agreedSplit: {
      emoji: '🗣️',
      title: 'تقسيم اتفقتوا عليه',
      body: 'واحد منكم شايل أكتر، واتكلمتوا في ده واتفقتوا. التقسيم المناسب هو اللي يناسب ظروفكم، وبيتراجع لما الظروف تتغير.',
    },
    talk: { emoji: '💬', title: 'اتكلموا قبل ما تقرروا', body: 'كل واحد كان عارف جدوله بس. لقيتوا اليوم المناسب لما شاركتوا المعلومة.' },
    revised: { emoji: '🔁', title: 'التعديل مش غلط', body: 'رجعتوا للخطة وعدّلتوها. ده بالظبط اللي بيحصل في الحياة الحقيقية.' },
  },
  takeaway: {
    title: 'المسؤولية المشتركة بتبدأ دلوقتي',
    body: 'كلام واضح، قرارات بتتاخد سوا، ومرونة لما الظروف تتغير. مفيش خطة كاملة، فيه خطة بتتراجع مع بعض.',
  },
  badge: { name: 'فريق واحد', emoji: '🤝' },
  sources: [
    {
      publisher: 'World Health Organization',
      title: 'WHO recommendations on antenatal care for a positive pregnancy experience (2016)',
      url: 'https://www.who.int/publications/i/item/9789241549912',
      usedFor: 'Antenatal care as a positive experience with social and emotional support.',
    },
  ],
  reviewNotes: [
    'The 70% "most of the load" prompt is an illustrative game rule, the same for both partners, and never fails a plan on its own; it is not a definition of fairness or clinical guidance.',
    'The note that heavy lifting should not fall on the pregnant partner alone is general caution; confirm wording with an obstetric professional.',
  ],
};

// ---------------------------------------------------------------------------------------------
// Level 2

export const L2_RULES: BudgetRules = { budget: 3500, reserveRate: 0.1, minDiapers: 60 };

export const L2_PRODUCTS: readonly (Product & { readonly x: number; readonly y: number })[] = [
  { id: 'diapersS', name: 'حفاضات 24 حتة', art: 'diapers-s', price: 300, units: 24, category: 'diapers', x: 2348, y: 508 },
  { id: 'diapersS2', name: 'حفاضات 24 حتة', art: 'diapers-s', price: 300, units: 24, category: 'diapers', x: 2396, y: 508 },
  { id: 'diapersM', name: 'حفاضات 40 حتة', art: 'diapers-m', price: 520, units: 40, category: 'diapers', x: 2448, y: 508 },
  { id: 'diapersM2', name: 'حفاضات 40 حتة', art: 'diapers-m', price: 520, units: 40, category: 'diapers', x: 2500, y: 508 },
  { id: 'diapersL', name: 'حفاضات 60 حتة', art: 'diapers-l', price: 660, units: 60, category: 'diapers', storeroom: true, x: 2840, y: 150 },
  { id: 'clothes', name: 'طقم هدوم قطن', art: 'clothes', price: 450, category: 'clothes', x: 2360, y: 758 },
  { id: 'bath', name: 'طقم استحمام', art: 'bath', price: 250, category: 'hygiene', x: 2425, y: 758 },
  { id: 'firstAid', name: 'ترمومتر وإسعافات أولية', art: 'firstAid', price: 220, category: 'health', x: 2490, y: 758 },
  { id: 'teddy', name: 'دبدوب كبير', art: 'teddy', price: 300, category: 'extra', note: 'لطيف، بس مش من الأساسيات ومكانه بره سرير النوم', x: 2626, y: 758 },
  { id: 'shoes', name: 'جزمة بيبي شيك', art: 'shoes', price: 280, category: 'extra', note: 'المولود مش هيمشي قبل شهور', x: 2676, y: 758 },
  { id: 'warmer', name: 'سخان مناديل', art: 'warmer', price: 350, category: 'extra', note: 'رفاهية مش ضرورية', x: 2726, y: 758 },
  { id: 'mobile', name: 'لعبة معلقة', art: 'mobileToy', price: 200, category: 'extra', note: 'حلوة، بس ممكن تستنى', x: 2776, y: 758 },
  { id: 'bassinet', name: 'سرير صغير (مهد)', art: 'bassinetBox', price: 850, category: 'sleep', joint: true, x: 2620, y: 930 },
  { id: 'crib', name: 'سرير أطفال', art: 'cribBox', price: 1200, category: 'sleep', heavy: true, joint: true, x: 3030, y: 640 },
];

const LEVEL2: LevelContent = {
  id: 'level02',
  number: 2,
  title: 'تحدي ميزانية البيبي',
  tagline: 'نشتري الأساسيات من غير ما نكسر الميزانية',
  learning: 'الميزانية وترتيب الأولويات والحساب',
  learningEn: 'Budgeting, prioritisation and basic arithmetic',
  emoji: '🛒',
  color: '#2A9D8F',
  intro: ['معاكم 3,500 جنيه لتجهيزات البيبي', 'خلّوا 350 جنيه احتياطي للطوارئ، وغطّوا كل الأساسيات'],
  objectives: [
    { id: 'list', text: 'اقروا قايمة الاحتياجات عند باب الشقة' },
    { id: 'needs', text: 'غطّوا الاحتياجات الأساسية الخمسة', hidden: true },
    { id: 'diapers', text: '60 حفاضة على الأقل', hidden: true },
    { id: 'reserve', text: 'سيبوا 350 جنيه احتياطي', hidden: true },
    { id: 'checkout', text: 'ادفعوا عند الكاشير واحسبوا الباقي', hidden: true },
  ],
  insights: {
    valid: { emoji: '✅', title: 'سلة متوازنة', body: 'غطّيتوا الأساسيات الخمسة وفضل معاكم احتياطي للطوارئ.' },
    unit: { emoji: '🧮', title: 'سعر الحتة أهم من سعر الكيس', body: 'كيس الـ60: 11 جنيه للحفاضة. كيس الـ24: 12.5 جنيه. الأرخص في الكيس مش دايمًا الأوفر.' },
    unitMissed: { emoji: '🧮', title: 'قارنوا سعر الحتة', body: 'كيس الـ60 في المخزن كان أوفر: 11 جنيه للحفاضة بدل 12.5 أو 13.' },
    reserve: { emoji: '🛟', title: 'احتياطي الطوارئ', body: 'الاحتياطي بيحميكم من أول مصروف مش متوقع، زي زيارة دكتور زيادة.' },
    extras: { emoji: '🎀', title: 'حلو بس مش ضروري', body: 'الكماليات ممكن تستنى أو تيجي هدية. الأولوية للأساسيات.' },
    math: { emoji: '💵', title: 'حسبتوا الباقي صح', body: 'الباقي = اللي معاكم − الحساب. الحساب الذهني بيحميكم من الغلط.' },
    teamwork: { emoji: '🤝', title: 'قرار الشراء الكبير سوا', body: 'المشتريات الكبيرة اتاخدت بموافقة الاتنين.' },
  },
  takeaway: {
    title: 'الميزانية خطة، مش حرمان',
    body: 'اعرفوا الأساسيات الأول، قارنوا سعر الوحدة، وسيبوا احتياطي. وبعدها الكماليات لو فضل.',
  },
  badge: { name: 'محاسبين شطار', emoji: '🧮' },
  disclaimer: 'الأسعار في اللعبة توضيحية للتعلم بس، ومش أسعار السوق الحالية.',
  sources: [],
  reviewNotes: ['Prices are invented for the arithmetic and must stay labelled as illustrative.'],
};

// ---------------------------------------------------------------------------------------------
// Level 3

/** The nursery's interior is columns 14-26 and rows 2-8 of the apartment: 13 by 7 cells. */
export const NURSERY_ORIGIN = { col: 14, row: 2 } as const;

export const L3_ROOM: RoomSpec = {
  cols: 13,
  rows: 7,
  doorZone: [
    { col: 5, row: 5 },
    { col: 6, row: 5 },
    { col: 5, row: 6 },
    { col: 6, row: 6 },
  ],
  doorCell: { col: 5, row: 6 },
  windowZone: [1, 2, 3, 4].flatMap((col) => [
    { col, row: 0 },
    { col, row: 1 },
  ]),
};

export const L3_PIECES: readonly (PieceSpec & { readonly x: number; readonly y: number })[] = [
  { id: 'crib', name: 'سرير البيبي', art: 'crib', w: 2, h: 3, heavy: true, anchor: false, reach: true, x: 640, y: 780 },
  { id: 'wardrobe', name: 'دولاب', art: 'kidsWardrobe', w: 3, h: 1, heavy: true, anchor: true, reach: false, x: 1180, y: 700 },
  { id: 'dresser', name: 'تسريحة أدراج', art: 'dresser', w: 2, h: 1, heavy: false, anchor: true, reach: false, x: 470, y: 660 },
  { id: 'changing', name: 'ترابيزة غيار', art: 'changingTable', w: 2, h: 1, heavy: false, anchor: false, reach: true, x: 900, y: 940 },
  { id: 'rocker', name: 'كرسي هزاز', art: 'rockingChair', w: 1, h: 1, heavy: false, anchor: false, reach: false, x: 1340, y: 860 },
  { id: 'shelf', name: 'رف ألعاب', art: 'toyShelf', w: 2, h: 1, heavy: false, anchor: false, reach: false, x: 560, y: 960 },
];

export const L3_BEDDING: readonly BeddingItem[] = [
  { id: 'pillow', name: 'مخدة', art: 'pillow', unsafe: true, why: 'المخدة ممكن تغطي وش البيبي. مكانها بره السرير.' },
  { id: 'bumper', name: 'حواجز محشية', art: 'bumper', unsafe: true, why: 'الحواجز المحشية ممكن البيبي ينحشر فيها أو تكتم نفسه.' },
  { id: 'plush', name: 'لعبة طرية', art: 'plush', unsafe: true, why: 'الألعاب الطرية مكانها بره السرير وقت النوم.' },
  { id: 'quilt', name: 'لحاف تقيل', art: 'quilt', unsafe: true, why: 'اللحاف السايب ممكن يغطي البيبي وهو نايم.' },
  { id: 'sheet', name: 'ملاية مشدودة', art: 'sheet', unsafe: false, why: 'ملاية مشدودة على مرتبة ثابتة ومستوية: دي مكانها جوه السرير.' },
];

const LEVEL3: LevelContent = {
  id: 'level03',
  number: 3,
  title: 'تجهيز أوضة البيبي',
  tagline: 'نرتّب الأوضة سوا ونجهّز نوم آمن',
  learning: 'تنظيم المساحة والتعاون وأساسيات النوم الآمن للرضيع',
  learningEn: 'Space planning, cooperation and basic infant safe-sleep awareness',
  emoji: '🛏️',
  color: '#7BA05B',
  intro: ['العفش وصل! 📦', 'دخّلوه أوضة البيبي ورتّبوه: الحاجات التقيلة محتاجة اتنين'],
  objectives: [
    { id: 'furnish', text: 'دخّلوا العفش ورتّبوه في أوضة البيبي' },
    { id: 'crib', text: 'فضّوا سرير البيبي من أي حاجة سايبة', hidden: true },
    { id: 'inspect', text: 'افحصوا الأوضة سوا جنب السرير', hidden: true },
  ],
  insights: {
    clearCrib: { emoji: '🛏️', title: 'السرير فاضي = نوم آمن', body: 'مرتبة ثابتة ومستوية وملاية مشدودة، ومن غير مخدات أو ألعاب أو حواجز أو بطاطين سايبة.' },
    back: { emoji: '👶', title: 'على ضهره دايمًا', body: 'البيبي بينام على ضهره في كل نومة، بالنهار وبالليل.' },
    window: { emoji: '🪟', title: 'السرير بعيد عن الشباك', body: 'بعيد عن حبال الستاير والتيارات والشمس المباشرة.' },
    anchor: { emoji: '🔩', title: 'ثبّتوا العفش العالي', body: 'الدولاب والأدراج جنب الحيطة عشان تتثبت فيها وما تقعش.' },
    path: { emoji: '🚪', title: 'طريق فاضي', body: 'سيبتوا طريق من الباب للسرير وترابيزة الغيار، مهم بالليل وانتو شايلين البيبي.' },
    teamwork: { emoji: '🤝', title: 'شيلناها سوا', body: 'الحاجات التقيلة اتشالت باتنين، من غير ما حد يتعب لوحده.' },
  },
  takeaway: {
    title: 'نوم آمن من أول ليلة',
    body: 'على ضهره، على مرتبة ثابتة ومستوية بملاية مشدودة، في سرير فاضي، في أوضتكم أو جنبكم في الشهور الأولى.',
  },
  badge: { name: 'أوضة أمان', emoji: '🛡️' },
  disclaimer: 'معلومات توعوية عامة، ومش بديل عن استشارة طبيب الأطفال.',
  sources: [
    {
      publisher: 'UNICEF',
      title: 'Baby sleep (UNICEF Parenting)',
      url: 'https://www.unicef.org/parenting/child-care/baby-sleep',
      usedFor: 'Back to sleep; clear sleep space with no bumpers, toys, pillows or loose bedding; firm flat surface.',
    },
    {
      publisher: 'UNICEF',
      title: 'How to babyproof your home (UNICEF Parenting)',
      url: 'https://www.unicef.org/parenting/safety/how-to-babyproof-your-home',
      usedFor: 'Securing furniture and household hazards.',
    },
    {
      publisher: 'American Academy of Pediatrics',
      title: 'Sleep-Related Infant Deaths: Updated 2022 Recommendations for Reducing Infant Deaths in the Sleep Environment (Moon RY et al., Pediatrics 2022;150(1):e2022057990)',
      url: 'https://publications.aap.org/pediatrics/article/150/1/e2022057990/188304',
      usedFor: 'Supine sleep, firm non-inclined surface, no soft bedding, room sharing without bed sharing.',
    },
    {
      publisher: 'U.S. Consumer Product Safety Commission',
      title: 'Anchor It! campaign',
      url: 'https://www.anchorit.gov/',
      usedFor: 'Anchoring dressers and wardrobes to the wall to prevent tip-overs.',
    },
  ],
  reviewNotes: [
    'Keeping the cot away from the window (cords, drafts, sun) is common safety advice; confirm the source citation with a pediatric reviewer.',
    'Room sharing wording should be reviewed against current Egyptian pediatric practice before release.',
  ],
};

export const LEVELS: readonly LevelContent[] = [LEVEL1, LEVEL2, LEVEL3];

export function levelContent(id: LevelId): LevelContent {
  const level = LEVELS.find((l) => l.id === id);
  if (!level) throw new Error(`Unknown level '${id}'`);
  return level;
}
