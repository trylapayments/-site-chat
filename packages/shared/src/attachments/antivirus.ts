/**
 * Antivirus scanning port — stubbed for launch, designed for real scanners later.
 *
 * Production flow:
 *   upload complete → scan(object) → clean | infected | pending
 * Infected objects are deleted and never linked to messages.
 */

export type AntivirusScanStatus = "clean" | "infected" | "skipped" | "pending" | "error";

export type AntivirusScanRequest = {
  workspaceId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  filename: string;
};

export type AntivirusScanResult = {
  status: AntivirusScanStatus;
  engine: string;
  scannedAt: string;
  detail?: string;
};

export interface AntivirusScanner {
  scan(request: AntivirusScanRequest): Promise<AntivirusScanResult>;
}

/**
 * Default stub: marks files as skipped (architecture seam for ClamAV/ICAP/etc.).
 * Treat `skipped` as allow for MVP; `infected` always rejects.
 */
export class StubAntivirusScanner implements AntivirusScanner {
  scan(_request: AntivirusScanRequest): Promise<AntivirusScanResult> {
    return Promise.resolve({
      status: "skipped",
      engine: "stub",
      scannedAt: new Date().toISOString(),
      detail: "Antivirus scanning not configured",
    });
  }
}

export function isAntivirusAllowlisted(result: AntivirusScanResult): boolean {
  return result.status === "clean" || result.status === "skipped";
}
