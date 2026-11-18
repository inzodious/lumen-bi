/** Windows time-zone ids, as Fabric's convertFromUtc and T-SQL's AT TIME ZONE take them, mapped to IANA zones. */
export const WINDOWS_ZONES: Record<string, string> = {
  UTC: "UTC",
  "Coordinated Universal Time": "UTC",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "India Standard Time": "Asia/Kolkata",
  "Tokyo Standard Time": "Asia/Tokyo",
  "AUS Eastern Standard Time": "Australia/Sydney",
};

/** The IANA zone for a Windows time-zone id (case-insensitive), or undefined when Parity doesn't know it. */
export function windowsZone(id: string): string | undefined {
  return WINDOWS_ZONES[id] ?? Object.entries(WINDOWS_ZONES).find(([k]) => k.toLowerCase() === id.toLowerCase())?.[1];
}
