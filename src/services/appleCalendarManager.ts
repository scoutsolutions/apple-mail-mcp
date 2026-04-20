/**
 * Apple Calendar Manager
 *
 * Handles all interactions with Apple Calendar via AppleScript.
 * Read-only operations for now - event creation is deliberately NOT supported
 * because AppleScript-created events don't get Teams/Zoom meeting links.
 * Use the M365 MCP's create_event tool for meetings that need Teams integration.
 *
 * @module services/appleCalendarManager
 */

import { executeAppleScript } from "@/utils/applescript.js";
import type { AppleCalendar, CalendarEvent, CalendarEventDetail, EventAttendee } from "@/types.js";

// =============================================================================
// AppleScript Helpers
// =============================================================================

/**
 * Escapes text for safe embedding in AppleScript string literals.
 */
function escapeForAppleScript(text: string): string {
  if (!text) return "";
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Wraps script body in a `tell application "Calendar"` block.
 */
function buildCalendarScript(body: string): string {
  return `tell application "Calendar"\n${body}\nend tell`;
}

/**
 * Converts an AppleScript date string (e.g. "Monday, April 20, 2026 at 11:00:00 AM")
 * into an ISO 8601 string. Returns the original string on failure.
 */
function appleDateToIso(dateStr: string): string {
  if (!dateStr) return "";
  try {
    // AppleScript output: "Monday, April 20, 2026 at 11:00:00 AM"
    const cleaned = dateStr.replace(/^[A-Za-z]+,\s*/, "").replace(" at ", " ");
    const d = new Date(cleaned);
    if (isNaN(d.getTime())) return dateStr;
    return d.toISOString();
  } catch {
    return dateStr;
  }
}

/**
 * Records separator used in multi-field output.
 * Using a multi-char delimiter reduces collision risk with event content.
 */
const FIELD_SEP = "|||FIELD|||";
const RECORD_SEP = "|||REC|||";

// =============================================================================
// Calendar Manager
// =============================================================================

export class AppleCalendarManager {
  /**
   * List all calendars available in Apple Calendar.
   */
  listCalendars(): AppleCalendar[] {
    const script = buildCalendarScript(`
      set out to ""
      repeat with c in calendars
        set cName to name of c
        set cDesc to ""
        try
          set cDesc to description of c
        end try
        set cWrite to writable of c
        set out to out & cName & "${FIELD_SEP}" & cDesc & "${FIELD_SEP}" & cWrite & "${RECORD_SEP}"
      end repeat
      return out
    `);

    const result = executeAppleScript(script, { timeoutMs: 30000 });

    if (!result.success || !result.output.trim()) return [];

    const calendars: AppleCalendar[] = [];
    const records = result.output.split(RECORD_SEP);
    for (const rec of records) {
      if (!rec.trim()) continue;
      const fields = rec.split(FIELD_SEP);
      if (fields.length < 3) continue;
      calendars.push({
        name: fields[0].trim(),
        description: fields[1].trim() || undefined,
        writable: fields[2].trim() === "true",
      });
    }
    return calendars;
  }

  /**
   * List events in a date range, optionally filtered by calendar name.
   * Times are in local timezone.
   *
   * @param startDate - Start of range (ISO string or natural language)
   * @param endDate - End of range
   * @param calendarName - Optional calendar name filter
   * @param limit - Max results (default 100)
   */
  listEvents(
    startDate: string,
    endDate: string,
    calendarName?: string,
    limit = 100
  ): CalendarEvent[] {
    const startEsc = escapeForAppleScript(startDate);
    const endEsc = escapeForAppleScript(endDate);

    // Build the script based on whether we're targeting a specific calendar
    let script: string;
    if (calendarName) {
      script = buildCalendarScript(`
        set startDate to date "${startEsc}"
        set endDate to date "${endEsc}"
        set out to ""
        set counter to 0
        tell calendar "${escapeForAppleScript(calendarName)}"
          set matching to (every event whose start date is greater than or equal to startDate and start date is less than or equal to endDate)
          repeat with e in matching
            if counter >= ${limit} then exit repeat
            set eId to uid of e
            set eSummary to summary of e
            set eStart to (start date of e) as string
            set eEnd to (end date of e) as string
            set eAllDay to allday event of e
            set eLoc to ""
            try
              set locVal to location of e
              if locVal is not missing value then set eLoc to locVal
            end try
            set out to out & eId & "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & "${escapeForAppleScript(calendarName)}" & "${RECORD_SEP}"
            set counter to counter + 1
          end repeat
        end tell
        return out
      `);
    } else {
      script = buildCalendarScript(`
        set startDate to date "${startEsc}"
        set endDate to date "${endEsc}"
        set out to ""
        set counter to 0
        repeat with c in calendars
          if counter >= ${limit} then exit repeat
          set cName to name of c
          try
            set matching to (every event of c whose start date is greater than or equal to startDate and start date is less than or equal to endDate)
            repeat with e in matching
              if counter >= ${limit} then exit repeat
              set eId to uid of e
              set eSummary to summary of e
              set eStart to (start date of e) as string
              set eEnd to (end date of e) as string
              set eAllDay to allday event of e
              set eLoc to ""
              try
                set eLoc to location of e
              end try
              set out to out & eId & "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & cName & "${RECORD_SEP}"
              set counter to counter + 1
            end repeat
          end try
        end repeat
        return out
      `);
    }

    const result = executeAppleScript(script, { timeoutMs: 120000 });

    if (!result.success || !result.output.trim()) return [];

    const events = this.parseEventList(result.output);
    // Post-filter recurring masters whose start date falls outside the requested range.
    // AppleScript returns the master event's original start date for recurring events,
    // so a weekly meeting that started months ago still matches "this week" queries.
    // Rather than showing it with a misleading date, filter it out.
    return this.filterEventsToRange(events, startDate, endDate);
  }

  /**
   * Search events across all calendars by text match in summary/description/location.
   * Date range filters improve performance significantly.
   */
  searchEvents(query: string, startDate?: string, endDate?: string, limit = 50): CalendarEvent[] {
    const queryEsc = escapeForAppleScript(query.toLowerCase());
    const hasDateRange = startDate && endDate;

    const script = buildCalendarScript(`
      set out to ""
      set counter to 0
      ${hasDateRange ? `set startDate to date "${escapeForAppleScript(startDate!)}"` : ""}
      ${hasDateRange ? `set endDate to date "${escapeForAppleScript(endDate!)}"` : ""}
      repeat with c in calendars
        if counter >= ${limit} then exit repeat
        set cName to name of c
        try
          ${
            hasDateRange
              ? `set candidates to (every event of c whose start date is greater than or equal to startDate and start date is less than or equal to endDate)`
              : `set candidates to every event of c`
          }
          repeat with e in candidates
            if counter >= ${limit} then exit repeat
            set eSummary to summary of e
            set eLoc to ""
            try
              set locVal to location of e
              if locVal is not missing value then set eLoc to locVal
            end try
            set eDesc to ""
            try
              set eDesc to description of e
            end try
            set combined to eSummary & " " & eLoc & " " & eDesc
            if combined contains "${queryEsc}" or (do shell script "echo " & quoted form of combined & " | tr '[:upper:]' '[:lower:]'") contains "${queryEsc}" then
              set eId to uid of e
              set eStart to (start date of e) as string
              set eEnd to (end date of e) as string
              set eAllDay to allday event of e
              set out to out & eId & "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & cName & "${RECORD_SEP}"
              set counter to counter + 1
            end if
          end repeat
        end try
      end repeat
      return out
    `);

    const result = executeAppleScript(script, { timeoutMs: 180000 });

    if (!result.success || !result.output.trim()) return [];

    const events = this.parseEventList(result.output);
    // If a date range was provided, filter out recurring masters outside the range
    if (startDate && endDate) {
      return this.filterEventsToRange(events, startDate, endDate);
    }
    return events;
  }

  /**
   * Get full details for a single event by UID.
   * Searches across all calendars.
   */
  getEvent(uid: string): CalendarEventDetail | null {
    const uidEsc = escapeForAppleScript(uid);

    const script = buildCalendarScript(`
      set out to ""
      repeat with c in calendars
        try
          set matches to (every event of c whose uid is "${uidEsc}")
          if (count of matches) > 0 then
            set e to item 1 of matches
            set eSummary to summary of e
            set eStart to (start date of e) as string
            set eEnd to (end date of e) as string
            set eAllDay to allday event of e
            set eLoc to ""
            try
              set locVal to location of e
              if locVal is not missing value then set eLoc to locVal
            end try
            set eDesc to ""
            try
              set descVal to description of e
              if descVal is not missing value then set eDesc to descVal
            end try
            set eStatus to ""
            try
              set statusVal to status of e
              if statusVal is not missing value then set eStatus to statusVal as string
            end try
            set eUrl to ""
            try
              set urlVal to url of e
              if urlVal is not missing value then set eUrl to urlVal
            end try
            set attOut to ""
            try
              repeat with a in attendees of e
                set aName to ""
                try
                  set nameVal to display name of a
                  if nameVal is not missing value then set aName to nameVal
                end try
                if aName is "" then
                  try
                    set emailVal to email of a
                    if emailVal is not missing value then set aName to emailVal
                  end try
                end if
                set aStatus to ""
                try
                  set pStatus to participation status of a
                  if pStatus is not missing value then set aStatus to pStatus as string
                end try
                set attOut to attOut & aName & ":" & aStatus & ","
              end repeat
            end try
            set out to "${FIELD_SEP}" & eSummary & "${FIELD_SEP}" & eStart & "${FIELD_SEP}" & eEnd & "${FIELD_SEP}" & eAllDay & "${FIELD_SEP}" & eLoc & "${FIELD_SEP}" & eDesc & "${FIELD_SEP}" & (name of c) & "${FIELD_SEP}" & eStatus & "${FIELD_SEP}" & eUrl & "${FIELD_SEP}" & attOut
            exit repeat
          end if
        end try
      end repeat
      return out
    `);

    const result = executeAppleScript(script, { timeoutMs: 120000 });

    if (!result.success || !result.output.trim()) return null;

    // Output is prefixed with FIELD_SEP so split gives us empty first element
    const fields = result.output.split(FIELD_SEP);
    if (fields.length < 11) return null;

    const attendees: EventAttendee[] = [];
    const attRaw = fields[10] || "";
    for (const pair of attRaw.split(",")) {
      if (!pair.trim()) continue;
      const [name, status] = pair.split(":");
      if (name) {
        attendees.push({
          name: name.trim(),
          status: (status || "unknown").trim(),
        });
      }
    }

    return {
      id: uid,
      summary: fields[1].trim(),
      startDate: appleDateToIso(fields[2].trim()),
      endDate: appleDateToIso(fields[3].trim()),
      allDay: fields[4].trim() === "true",
      location: fields[5].trim() || undefined,
      description: fields[6].trim() || undefined,
      calendarName: fields[7].trim(),
      status: fields[8].trim() || undefined,
      url: fields[9].trim() || undefined,
      attendees,
    };
  }

  /**
   * Get today's events across all calendars.
   */
  getToday(): CalendarEvent[] {
    const today = new Date();
    const todayStr = this.formatAppleDate(today);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const tomorrowStr = this.formatAppleDate(tomorrow);
    return this.listEvents(todayStr, tomorrowStr);
  }

  /**
   * Get this week's events (Monday through Sunday) across all calendars.
   */
  getThisWeek(): CalendarEvent[] {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday
    const daysFromMonday = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);
    return this.listEvents(this.formatAppleDate(monday), this.formatAppleDate(nextMonday));
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Filter out events whose start date falls outside the requested range.
   *
   * AppleScript returns the master event's original start date for recurring
   * events, so a weekly meeting that started months ago still matches queries
   * for "this week" (because it has an instance this week, but the date we get
   * back is the master date, not the instance date).
   *
   * This filter drops events whose returned start date is outside the range,
   * which cleanly hides recurring masters-in-the-past at the cost of also
   * hiding their current-week instances. The tradeoff favors clarity over
   * completeness for now.
   *
   * A future enhancement could expand recurrence rules to compute instance
   * dates, but that requires parsing RRULE and handling exceptions - significant
   * work for a non-critical feature.
   *
   * @param events - Events from parseEventList
   * @param startDate - Start of the range (same format as listEvents input)
   * @param endDate - End of the range
   * @returns Events whose start date falls within [startDate, endDate]
   */
  private filterEventsToRange(
    events: CalendarEvent[],
    startDate: string,
    endDate: string
  ): CalendarEvent[] {
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    // If either date is invalid, skip filtering and return all events
    if (isNaN(startMs) || isNaN(endMs)) return events;

    return events.filter((e) => {
      const eventMs = new Date(e.startDate).getTime();
      if (isNaN(eventMs)) return true; // keep events with unparseable dates
      return eventMs >= startMs && eventMs <= endMs;
    });
  }

  /**
   * Format a JS Date as an AppleScript-friendly date string.
   * Example: "April 20, 2026 12:00:00 AM"
   */
  private formatAppleDate(d: Date): string {
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    let hour = d.getHours();
    const min = d.getMinutes().toString().padStart(2, "0");
    const sec = d.getSeconds().toString().padStart(2, "0");
    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12;
    if (hour === 0) hour = 12;
    return `${month} ${day}, ${year} ${hour}:${min}:${sec} ${ampm}`;
  }

  /**
   * Parse FIELD_SEP/RECORD_SEP delimited event output into CalendarEvent[].
   */
  private parseEventList(raw: string): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    const records = raw.split(RECORD_SEP);
    for (const rec of records) {
      if (!rec.trim()) continue;
      const fields = rec.split(FIELD_SEP);
      if (fields.length < 7) continue;
      events.push({
        id: fields[0].trim(),
        summary: fields[1].trim(),
        startDate: appleDateToIso(fields[2].trim()),
        endDate: appleDateToIso(fields[3].trim()),
        allDay: fields[4].trim() === "true",
        location: fields[5].trim() || undefined,
        calendarName: fields[6].trim(),
      });
    }
    return events;
  }
}
