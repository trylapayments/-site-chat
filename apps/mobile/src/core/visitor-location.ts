export function visitorCountry(value?: string | null) {
  const code = value?.toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "ZZ") return null;
  let name = code;
  try {
    name = new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    /* Keep server country code if this runtime lacks region names. */
  }
  const flag = String.fromCodePoint(...[...code].map((letter) => 127397 + letter.charCodeAt(0)));
  return { code, name, flag };
}
export function visitorLocation(visitor: { country?: string | null; city?: string | null }) {
  const country = visitorCountry(visitor.country);
  return [visitor.city?.trim(), country && `${country.flag} ${country.name}`]
    .filter(Boolean)
    .join(" · ");
}
