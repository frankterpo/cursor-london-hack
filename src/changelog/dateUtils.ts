import { formatInTimeZone } from "date-fns-tz";

function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function formatDateKey(mergedAt: string, timezone: string): string {
  const date = new Date(mergedAt);
  const tzDate = formatInTimeZone(date, timezone, "yyyy-MM-dd");
  const [year, month, day] = tzDate.split("-").map(Number);

  const monthNames = [
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

  const monthName = monthNames[month - 1];
  const suffix = getOrdinalSuffix(day);

  return `${monthName} ${day}${suffix} ${year}`;
}

