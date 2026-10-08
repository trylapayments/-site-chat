import "server-only";
import * as stripe from "./stripe";
import * as chargebee from "./chargebee";
export const usesChargebee = () => Boolean(chargebee.chargebeeSite());
export const billingMode = () =>
  usesChargebee()
    ? process.env.CHARGEBEE_MODE === "live"
      ? "live"
      : "test"
    : stripe.billingMode();
export const billingConfigured = () =>
  usesChargebee()
    ? chargebee.chargebeeConfigured()
    : stripe.billingConfigured();
export const loadBilling = (
  workspaceId: string,
): ReturnType<typeof chargebee.loadChargebeeBilling> =>
  usesChargebee()
    ? chargebee.loadChargebeeBilling(workspaceId)
    : stripe.loadBilling(workspaceId);
export const workspaceCustomer = (workspaceId: string) =>
  usesChargebee()
    ? chargebee.chargebeeCustomer(workspaceId)
    : stripe.workspaceCustomer(workspaceId);
export const ensureCustomer = (
  workspaceId: string,
  name: string,
  email: string,
) =>
  usesChargebee()
    ? chargebee.ensureChargebeeCustomer(workspaceId, name, email)
    : stripe.ensureCustomer(workspaceId, name, email);
export const setDefaultCard = (customer: string, id: string) =>
  usesChargebee()
    ? chargebee.setChargebeeDefaultCard(customer, id)
    : stripe.setDefaultCard(customer, id);
export const removeCard = (customer: string, id: string) =>
  usesChargebee()
    ? chargebee.removeChargebeeCard(customer, id)
    : stripe.removeCard(customer, id);
export const saveBillingDetails = (
  customer: string,
  input: Parameters<typeof stripe.saveBillingDetails>[1],
) =>
  usesChargebee()
    ? chargebee.saveChargebeeDetails(customer, input)
    : stripe.saveBillingDetails(customer, input);
export const downloadInvoice = (
  workspaceId: string,
  customer: string,
  invoiceId: string,
) =>
  usesChargebee()
    ? chargebee.downloadChargebeeInvoice(workspaceId, customer, invoiceId)
    : stripe.downloadInvoice(customer, invoiceId);
