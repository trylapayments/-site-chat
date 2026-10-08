import { installDomainSchema } from "./domain";
export function canonicalSite(input: string) {
  const host = input.includes("://") ? new URL(input).hostname : input;
  return installDomainSchema.parse(host).replace(/^www\./, "");
}
