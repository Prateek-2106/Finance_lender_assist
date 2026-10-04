import nodemailer from "nodemailer";

type Transport = ReturnType<typeof nodemailer.createTransport>;

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
}

export interface Mailer {
  readonly name: string;
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * MAIL_TRANSPORT = smtp (default outside production; Mailpit at localhost:1025) | ses | none
 * SES uses the ECS task's IAM role, so no email credentials are stored anywhere.
 */
export async function mailerFromEnv(env: NodeJS.ProcessEnv): Promise<Mailer | undefined> {
  const mode = (env.MAIL_TRANSPORT ?? (env.NODE_ENV === "production" ? "none" : "smtp")).toLowerCase();
  const from = env.MAIL_FROM ?? "Mainstreet <no-reply@mainstreet.local>";
  if (mode === "none") return undefined;
  let transport: Transport;
  let name: string;
  if (mode === "ses") {
    const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    transport = nodemailer.createTransport({ SES: { sesClient: new SESv2Client({ region: env.AWS_REGION ?? "us-east-1" }), SendEmailCommand } });
    name = "ses";
  } else {
    const url = env.SMTP_URL ?? "smtp://localhost:1025";
    transport = nodemailer.createTransport(url);
    name = `smtp ${new URL(url).host}`;
  }
  return {
    name,
    async send(e) {
      await transport.sendMail({ from, to: e.to, subject: e.subject, text: e.text, html: e.html, attachments: e.attachments });
    },
  };
}
