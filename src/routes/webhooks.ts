import express, { Router } from "express";
import type { Deps } from "../deps";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { normalizePhone } from "../schemas";
import { twimlMessage, verifyTwilioSignature, type TwilioParams } from "../webhooks/twilio";

export function webhooksRouter({ repos, config }: Deps) {
  const r = Router();
  r.use(express.urlencoded({ extended: false }));

  r.post("/sms/:tenantId", async (req, res) => {
    const params = req.body as TwilioParams;
    const url = config.publicUrl + req.originalUrl;
    if (!verifyTwilioSignature(config.twilioAuthToken, url, params, req.get("x-twilio-signature")))
      throw new ForbiddenError("Invalid Twilio signature");

    const tenant = await repos.tenants.findById(String(req.params.tenantId));
    if (!tenant) throw new NotFoundError("Unknown tenant");

    const phone = normalizePhone(params.From ?? "");
    const message = (params.Body ?? "").trim();
    if (!phone || !message) throw new ValidationError("SMS needs From and Body");

    await repos.leads.create({ tenantId: tenant.id, name: phone, phone, message: message.slice(0, 2000), source: "sms" });
    res
      .type("text/xml")
      .send(twimlMessage(`Thanks! ${tenant.name} got your message and will get back to you shortly.`));
  });

  return r;
}
