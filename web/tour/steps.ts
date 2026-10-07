// What the walkthrough says on each page. Targets are data-tour="…" names on the page's elements.
export type PageId = "home" | "site" | "requests" | "estimates" | "prices" | "funding" | "statistics" | "underwriting";

export interface Step {
  title: string;
  body: string;
  target?: string;
  /** Said instead of `body` when the target isn't on screen (e.g. nothing selected yet). */
  whenMissing?: string;
  /** Clicking the target moves to the next step. */
  advanceOnClick?: boolean;
  /** "button", "row"…: used in "click the outlined …". */
  what?: string;
}

export const TOURS: Record<PageId, Step[]> = {
  home: [
    {
      title: "Run a business, then see what it can borrow",
      body: "Act 1: a plumber runs their business here: website, AI-drafted quotes, invoices, payments, and a dashboard that adds it all up. Act 2: because the platform sees how the business earns, it can make a funding decision from evidence.",
      target: "hero",
    },
    {
      title: "Get your own business to try",
      body: "This makes a made-up plumbing business just for you, with six months of jobs, payments and bank statements. Nothing is real, nobody gets emailed, and no money moves.",
      target: "try",
      advanceOnClick: true,
      what: "button",
    },
    {
      title: "The funding formula, in the open",
      body: "Eight measures from the bank statement, a weighted score, bands, automatic stops and an affordability-capped offer. The full page shows every curve and its sources.",
      target: "formula",
    },
    {
      title: "How it fits together",
      body: "These diagrams show every feature, and who sends what to whom.",
      target: "diagrams",
    },
  ],

  site: [
    {
      title: "The business's own website",
      body: "Every business gets a site at its own address (or its own domain). A customer describes the job here.",
      target: "site-form",
    },
    {
      title: "Send a request",
      body: "Fill it in and press Request a quote. It arrives in the owner's dashboard under Requests, and the customer gets a confirmation email.",
      target: "site-submit",
      advanceOnClick: true,
      what: "button",
    },
  ],

  requests: [
    {
      title: "Where the numbers start",
      body: "Every request from the website or by text message lands here. Returning customers are recognised by their email or phone.",
      target: "leads-table",
    },
    {
      title: "Let AI draft the quote",
      body: "Press Draft estimate on a new request. The AI picks items and quantities from your price list; prices always come from the list, and you check it before the customer sees anything.",
      target: "draft",
      whenMissing: "Every request already has an estimate. Use Estimates to open one.",
      advanceOnClick: true,
      what: "button",
    },
    {
      title: "Already quoted",
      body: "Requests you've quoted show where the estimate stands. Click one to open it.",
      target: "lead-status",
    },
  ],

  estimates: [
    {
      title: "Every quote and where it stands",
      body: "Needs review → draft → sent → accepted → invoiced. Click any row to open it.",
      target: "estimates-table",
      whenMissing: "No estimates yet. Go to Requests and press Draft estimate.",
    },
    {
      title: "The quote",
      body: "Who it's for, the items and the total. Prices come from your price list. While it's a draft you can change quantities and save.",
      target: "estimate-panel",
      whenMissing: "Click any estimate in the list to open it.",
    },
    {
      title: "Move it along",
      body: "Approve it, send it to the customer, mark it accepted, then create the invoice. Each step emails the customer (in a demo the emails are kept under Statistics, not sent).",
      target: "estimate-actions",
      whenMissing: "Open a draft or sent estimate to see the next step for it.",
    },
    {
      title: "Invoice and payment",
      body: "The invoice freezes the customer, items and tax, so later edits never change it. Open the PDF, or record a payment to send a receipt.",
      target: "invoice",
      whenMissing: "Open an invoiced estimate (or create an invoice) to see this part.",
    },
  ],

  prices: [
    {
      title: "Everything you sell",
      body: "Your items and services, at your prices. The AI drafts quotes only from this list and never sets a price itself.",
      target: "price-table",
    },
    {
      title: "Bring your existing list",
      body: "Import a CSV with name and price columns (code, unit and \"sold in parts\" are optional), review it here, then save.",
      target: "price-import",
    },
  ],

  funding: [
    {
      title: "Act 2: the record becomes evidence",
      body: "The work in Act 1 left a trail in the bank account. Here the business asks for working capital, and the decision comes from that trail: how money actually comes in, stays and goes out.",
      target: "funding-table",
    },
    {
      title: "Three answers",
      body: "One application was approved, one declined, and one is waiting for a person. Click one to see what the owner sees.",
      target: "funding-table",
      advanceOnClick: true,
      what: "list",
    },
    {
      title: "The answer, in plain words",
      body: "The offer (amount, total to repay, daily payment, estimated APR), the reasons, what would help next time, and who decided.",
      target: "applicant-card",
      whenMissing: "Click an application in the list to open it.",
    },
    {
      title: "How it was scored",
      body: "Open this to see the score bar: one segment per measure, filled to what it earned, with the reasons citing each measure.",
      target: "how-decided",
      whenMissing: "Open an assessed application to see how it was scored.",
    },
    {
      title: "The formula behind it",
      body: "Every measure, curve, threshold and source, generated from the engine's own settings. A demonstration on synthetic data: no real credit is offered.",
      target: "how-scored",
      whenMissing: "Open an assessed application; the link sits under its answer.",
    },
    {
      title: "Switch sides",
      body: "The waiting application needs an underwriter. Open the console and decide it yourself.",
      target: "uw-link",
      advanceOnClick: true,
      what: "button",
    },
  ],

  statistics: [
    {
      title: "What the work added up to",
      body: "Gross income, the average job, how long customers take to pay, and what's still owed. Nobody typed these in: click any of them to see the invoices and requests behind it.",
      target: "kpis",
    },
    {
      title: "From request to payment",
      body: "How many requests became quotes, how many were accepted, how many got paid, and how many customers came back.",
      target: "funnel",
    },
    {
      title: "Every email",
      body: "Each stage writes an email. Press View on one to read it. In a demo nothing is sent.",
      target: "emails",
    },
    {
      title: "See where the numbers come from",
      body: "Open Requests and win the next job: the AI drafts the quote, you approve it, and these numbers move when it's paid.",
      target: "nav-requests",
      advanceOnClick: true,
      what: "link",
    },
  ],

  underwriting: [
    {
      title: "The lender's side",
      body: "Clear cases are decided by the scorecard. The ones it can't decide come here, to a person. Yours is marked \"Yours\".",
      target: "queue",
    },
    {
      title: "Open a case",
      body: "Click the waiting application.",
      target: "queue-pending",
      whenMissing: "Nothing is waiting right now. Open a recently decided one to see its record.",
      advanceOnClick: true,
      what: "row",
    },
    {
      title: "Why it's here",
      body: "The score, the band, and the rule that sent it to a person, each pointing at the measure (M1–M8) it comes from. \"How is this scored?\" opens every formula.",
      target: "risk",
      whenMissing: "Click a case in the queue to open it.",
    },
    {
      title: "Ask the AI for a memo",
      body: "Claude writes a short summary. Every sentence has to cite a measure, and any number that doesn't match is removed before you see it.",
      target: "memo",
      whenMissing: "Open a case to see the memo button.",
    },
    {
      title: "Decide",
      body: "Approve an amount (watch the daily payment and the share of daily sales it takes) or decline. Your note and your name go to the business.",
      target: "decision",
      whenMissing: "Only waiting cases can be decided. Open the one in Waiting for review.",
    },
  ],
};
