// What the walkthrough says on each page. Targets are data-tour="…" names on the page's elements.
export type PageId = "home" | "site" | "leads" | "estimates" | "funding" | "insights" | "underwriting";

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
      title: "One platform for a small business",
      body: "A plumber, a bakery or a salon gets a website, quotes, invoices and payments here, and can ask for working capital without filling in a loan form. The funding decision comes from their bank statements.",
      target: "hero",
    },
    {
      title: "Get your own business to try",
      body: "This makes a made-up plumbing business just for you, with six months of customers, jobs and bank statements. Nothing is real and nobody gets emailed.",
      target: "try",
      advanceOnClick: true,
      what: "button",
    },
    {
      title: "Or read how it works first",
      body: "These diagrams show every feature, and who sends what to whom. Each step has a short explanation.",
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
      body: "Fill it in and press Request a quote. It arrives in the owner's dashboard as a lead, and the customer gets a confirmation email.",
      target: "site-submit",
      advanceOnClick: true,
      what: "button",
    },
  ],

  leads: [
    {
      title: "This is your business",
      body: "You're the owner of Maple Street Plumbing. Everything here is made up, so click anything. Press \"What's this page?\" any time to see this again.",
      target: "demo-banner",
    },
    {
      title: "Customers asking for work",
      body: "Every request from the website or by text message lands here. Returning customers are recognised by their email or phone.",
      target: "leads-table",
    },
    {
      title: "Let AI draft the quote",
      body: "Press Draft estimate on a new request. The AI picks items and quantities from your price list; prices always come from the list, and you check it before the customer sees anything.",
      target: "draft",
      whenMissing: "Every lead already has an estimate. Use Estimates on the left to open one.",
      advanceOnClick: true,
      what: "button",
    },
    {
      title: "Already quoted",
      body: "Leads you've quoted show where the estimate stands. Click one to open it.",
      target: "lead-status",
    },
  ],

  estimates: [
    {
      title: "Every quote and where it stands",
      body: "Needs review → draft → sent → accepted → invoiced. Click any row to open it.",
      target: "estimates-table",
      whenMissing: "No estimates yet. Go to Leads and press Draft estimate.",
    },
    {
      title: "The quote",
      body: "Who it's for, the items and the total. Prices come from your price list. While it's a draft you can change quantities and save.",
      target: "estimate-panel",
      whenMissing: "Click any estimate in the list to open it.",
    },
    {
      title: "Move it along",
      body: "Approve it, send it to the customer, mark it accepted, then create the invoice. Each step emails the customer (in a demo the emails are kept under Insights, not sent).",
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

  funding: [
    {
      title: "Working capital, from bank statements",
      body: "The business asks for money and uploads a bank statement. No credit check, no long form: the decision comes from how money actually moves through the account.",
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
      body: "Open this to see each measure: true monthly revenue, steadiness, negative balance days, existing loans and more, with the business's number for each.",
      target: "how-decided",
      whenMissing: "Open an assessed application to see how it was scored.",
    },
    {
      title: "Try your own",
      body: "Start a new application and upload a CSV bank statement (sample files are in the repo under fixtures/statements).",
      target: "new-application",
    },
    {
      title: "Switch sides",
      body: "The waiting application needs an underwriter. Open the console and decide it yourself.",
      target: "uw-link",
      advanceOnClick: true,
      what: "button",
    },
  ],

  insights: [
    {
      title: "What happened after \"paid\"",
      body: "Money in, the average job, how long customers take to pay, and what's still owed.",
      target: "kpis",
    },
    {
      title: "From request to payment",
      body: "How many leads became quotes, how many were accepted, how many got paid, and repeat customers.",
      target: "funnel",
    },
    {
      title: "Every email",
      body: "Each stage writes an email. Press View on one to read it. In a demo nothing is sent.",
      target: "emails",
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
      body: "The score, the band, and the rule that sent it to a person, each pointing at the measure (M1–M8) it comes from.",
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
