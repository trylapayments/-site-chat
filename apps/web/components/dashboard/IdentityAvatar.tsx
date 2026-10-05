import { cn } from "@/lib/utils";

const tones = [
  "bg-[#e8ede7] text-[#53634f]",
  "bg-[#eee7dc] text-[#7b6245]",
  "bg-[#e7ebec] text-[#4b626b]",
  "bg-[#ece4e0] text-[#865e4f]",
  "bg-[#e9e7e2] text-[#696158]",
];

export function CountryFlag({ code }: { code?: string | null }) {
  const country = code?.toUpperCase();
  if (!country || !/^[A-Z]{2}$/.test(country)) return null;
  return (
    <span
      aria-label={`IP country: ${country}`}
      title={`IP country: ${country}`}
      role="img"
    >
      {String.fromCodePoint(
        ...Array.from(country).map((c) => 127397 + c.charCodeAt(0)),
      )}
    </span>
  );
}

export function IdentityAvatar({
  label,
  country,
  className,
}: {
  label: string;
  country?: string | null;
  className?: string;
}) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`
      : (parts[0]?.slice(0, 2) ?? "?");
  const tone =
    Array.from(label).reduce((sum, c) => sum + c.charCodeAt(0), 0) %
    tones.length;
  return (
    <span
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden="true">{initials.toUpperCase()}</span>
      {country ? (
        <span className="absolute -right-1 -bottom-1 rounded-full bg-white px-0.5 text-sm leading-none">
          <CountryFlag code={country} />
        </span>
      ) : null}
    </span>
  );
}
