import type { BadgeVariant } from "./Badge";

export function getStatusBadgeVariant(status: string): BadgeVariant {
  const statusMap: Record<string, BadgeVariant> = {
    Recruiting: "recruiting",
    Locked: "warning",
    Active: "active",
    Completed: "completed",
    Terminated: "terminated",
    EmergencyStop: "error",
  };
  return statusMap[status] || "default";
}

