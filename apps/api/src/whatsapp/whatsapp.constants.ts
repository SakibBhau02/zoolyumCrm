/**
 * WhatsApp Cloud API shared constants + default template catalogue.
 * Templates below are UTILITY (transactional) — submit the same content on
 * Meta for approval before switching a template to live mode. One definition
 * per (name, language); add `bn` rows for Bangla clients.
 */

export const WA_GRAPH_VERSION = "v23.0";
export const WA_PROVIDER_NAME = "WHATSAPP";
export const WA_MAX_TEMPLATE_PARAMS = 10;

export type WaTemplateDef = {
  name: string;
  language: string;
  category: string;
  description: string;
  variables: string[];
  bodyPreview: string;
  buttons?: { type: string; text: string; url?: string }[];
};

export const DEFAULT_WA_TEMPLATES: WaTemplateDef[] = [
  {
    name: "invoice_ready",
    language: "en",
    category: "UTILITY",
    description: "Sent when an invoice is issued. Link button opens the invoice.",
    variables: ["client_name", "invoice_number", "project_name", "amount", "due_date", "invoice_link"],
    bodyPreview:
      "Hello {{1}}, invoice {{2}} for {{3}} of {{4}} is ready. Due {{5}}. View and download it here: {{6}}",
    buttons: [{ type: "URL", text: "View invoice", url: "{{1}}" }],
  },
  {
    name: "payment_due_today",
    language: "en",
    category: "UTILITY",
    description: "Reminder on the due date.",
    variables: ["client_name", "invoice_number", "amount", "invoice_link"],
    bodyPreview: "Hello {{1}}, invoice {{2}} of {{3}} is due today. View it here: {{4}}",
    buttons: [{ type: "URL", text: "View invoice", url: "{{1}}" }],
  },
  {
    name: "payment_overdue",
    language: "en",
    category: "UTILITY",
    description: "Overdue nudge with days count.",
    variables: ["client_name", "invoice_number", "amount", "days_overdue", "invoice_link"],
    bodyPreview:
      "Hello {{1}}, invoice {{2}} of {{3}} is overdue by {{4}} days. Please pay at your earliest convenience: {{5}}",
    buttons: [{ type: "URL", text: "View invoice", url: "{{1}}" }],
  },
  {
    name: "payment_received",
    language: "en",
    category: "UTILITY",
    description: "Receipt confirmation after a payment is recorded.",
    variables: ["client_name", "amount", "invoice_number", "receipt_no", "balance"],
    bodyPreview:
      "Hello {{1}}, we received {{2}} against invoice {{3}}. Receipt: {{4}}. Remaining balance: {{5}}. Thank you!",
  },
  {
    name: "task_assigned",
    language: "en",
    category: "UTILITY",
    description: "Notify a team member of a new/changed task assignment.",
    variables: ["member_name", "task_title", "project_name", "due_date"],
    bodyPreview: "Hello {{1}}, you have been assigned: {{2}} ({{3}}). Due {{4}}.",
  },
  {
    name: "task_update_client",
    language: "en",
    category: "UTILITY",
    description: "Notify the client when a visible task is completed.",
    variables: ["client_name", "task_title", "project_name"],
    bodyPreview: "Hello {{1}}, an update on {{3}}: {{2}} is now complete.",
  },
];

/** Normalize a phone number for WhatsApp (defaults to Bangladesh +880). */
export function toWaNumber(raw?: string | null): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("880") && d.length === 13) return d;
  if (d.startsWith("0") && d.length === 11) return `880${d.slice(1)}`;
  if (d.length === 10) return `880${d}`;
  return d;
}
