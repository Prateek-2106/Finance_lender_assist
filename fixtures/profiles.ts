// Six synthetic businesses for steps 6–7. Each is a seeded simulation, so the
// same seed always yields the same statement, and every line has a known true
// category to test the classifier against.

export interface Lender {
  name: string; // description prefix, e.g. "ONDECK CAPITAL"
  month: number; // index of the month it funds in
  fundedCents: number;
  dailyPaymentCents: number;
}

export interface Profile {
  key: string;
  name: string;
  industry: string;
  monthsInBusiness: number;
  statedMonthlyRevenueCents: number;
  amountRequestedCents: number;
  useOfFunds: string;
  start: string; // first statement day
  months: number;
  baseMonthlyRevenueCents: number;
  monthMultipliers: number[]; // seasonality / trend, one per month
  volatility: number; // daily revenue noise (std dev as a fraction)
  expenseRatio: number; // planned spend vs planned revenue
  openingBalanceCents: number;
  lenders: Lender[];
  savings: boolean; // sweeps to and from a savings account
  format: "amount" | "debit_credit";
  seed: number;
}

export const PROFILES: Profile[] = [
  {
    key: "steady-bakery",
    name: "Rosa's Bakery",
    industry: "restaurant",
    monthsInBusiness: 84,
    statedMonthlyRevenueCents: 4_500_000,
    amountRequestedCents: 4_000_000,
    useOfFunds: "Second oven and display case",
    start: "2026-04-01",
    months: 6,
    baseMonthlyRevenueCents: 4_500_000,
    monthMultipliers: [0.97, 0.99, 1.0, 1.02, 1.04, 1.06],
    volatility: 0.15,
    expenseRatio: 0.86,
    openingBalanceCents: 3_800_000,
    lenders: [],
    savings: true,
    format: "amount",
    seed: 11,
  },
  {
    key: "seasonal-landscaper",
    name: "Greenline Landscaping",
    industry: "landscaping",
    monthsInBusiness: 60,
    statedMonthlyRevenueCents: 5_500_000,
    amountRequestedCents: 5_000_000,
    useOfFunds: "Winter payroll and a new mower",
    start: "2026-04-01",
    months: 6,
    baseMonthlyRevenueCents: 5_500_000,
    monthMultipliers: [0.6, 1.3, 1.5, 1.45, 1.1, 0.55],
    volatility: 0.25,
    expenseRatio: 0.88,
    openingBalanceCents: 2_200_000,
    lenders: [],
    savings: true,
    format: "debit_credit",
    seed: 22,
  },
  {
    key: "stacked-auto",
    name: "Metro Auto Repair",
    industry: "auto repair",
    monthsInBusiness: 48,
    statedMonthlyRevenueCents: 6_000_000,
    amountRequestedCents: 6_000_000,
    useOfFunds: "Working capital",
    start: "2026-04-01",
    months: 6,
    baseMonthlyRevenueCents: 6_000_000,
    monthMultipliers: [1, 1, 1, 1, 1, 1],
    volatility: 0.2,
    expenseRatio: 0.82,
    openingBalanceCents: 900_000,
    lenders: [
      { name: "ONDECK CAPITAL", month: 0, fundedCents: 5_000_000, dailyPaymentCents: 45_000 },
      { name: "KAPITUS", month: 3, fundedCents: 3_000_000, dailyPaymentCents: 35_000 },
    ],
    savings: false,
    format: "amount",
    seed: 33,
  },
  {
    key: "struggling-salon",
    name: "Bella Salon",
    industry: "salon",
    monthsInBusiness: 30,
    statedMonthlyRevenueCents: 1_800_000,
    amountRequestedCents: 2_000_000,
    useOfFunds: "Catch up on rent",
    start: "2026-04-01",
    months: 6,
    baseMonthlyRevenueCents: 1_500_000,
    monthMultipliers: [1.1, 1.05, 1.0, 0.92, 0.85, 0.8],
    volatility: 0.3,
    expenseRatio: 0.99,
    openingBalanceCents: 150_000,
    lenders: [],
    savings: false,
    format: "debit_credit",
    seed: 44,
  },
  {
    key: "new-food-truck",
    name: "Taco Rueda",
    industry: "food truck",
    monthsInBusiness: 4,
    statedMonthlyRevenueCents: 1_400_000,
    amountRequestedCents: 1_500_000,
    useOfFunds: "Second truck",
    start: "2026-06-01",
    months: 4,
    baseMonthlyRevenueCents: 1_400_000,
    monthMultipliers: [0.8, 1.0, 1.1, 1.15],
    volatility: 0.25,
    expenseRatio: 0.85,
    openingBalanceCents: 500_000,
    lenders: [],
    savings: false,
    format: "amount",
    seed: 55,
  },
  {
    key: "inflated-contractor",
    name: "Summit Contracting",
    industry: "construction",
    monthsInBusiness: 72,
    statedMonthlyRevenueCents: 8_000_000,
    amountRequestedCents: 7_500_000,
    useOfFunds: "Bid on a larger job",
    start: "2026-04-01",
    months: 6,
    baseMonthlyRevenueCents: 3_000_000,
    monthMultipliers: [1, 0.9, 1.1, 1, 0.95, 1.05],
    volatility: 0.35,
    expenseRatio: 0.85,
    openingBalanceCents: 1_500_000,
    lenders: [],
    savings: true,
    format: "amount",
    seed: 66,
  },
];
