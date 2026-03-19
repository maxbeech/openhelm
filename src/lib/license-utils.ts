import type { UsageType, EmployeeCount } from "@openhelm/shared";

/** Returns true if this usage type + employee count requires a paid Business license */
export function needsPayment(
  usageType: UsageType,
  employeeCount: EmployeeCount,
): boolean {
  if (usageType !== "business") return false;
  return employeeCount !== "1-3";
}
