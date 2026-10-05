import { MILL_DIALOGUE_MARK, MILL_WEBSITE_URL } from "@site-chat/shared";
export function MillPoweredBy() {
  return (
    <a
      href={MILL_WEBSITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Powered by Mill"
      className="inline-flex items-center gap-1.5 no-underline"
    >
      <span style={{ color: "#59636f" }}>Powered by</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- shared public brand asset */}
      <img
        src={MILL_DIALOGUE_MARK}
        alt=""
        width={18}
        height={18}
        className="block shrink-0"
      />
      <span
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          color: "#142838",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Mill
      </span>
    </a>
  );
}
