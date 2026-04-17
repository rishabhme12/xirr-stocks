import { normaliseSymbol } from "./stock-data.mjs";

/** Earliest selectable SIP start month (product rule). */
export const MIN_SIP_START_MONTH = "1990-01";

export function parseEstimatorParams(url) {
  const symbol = normaliseSymbol(url.searchParams.get("symbol") || "");
  const amount = Number(url.searchParams.get("monthlyAmount") || "1");
  const startDate = url.searchParams.get("startDate") || "";
  const endDate = url.searchParams.get("endDate") || "";
  const stillHoldingRaw = (url.searchParams.get("stillHolding") || "true").toLowerCase();
  const purchaseDay = Number(url.searchParams.get("purchaseDay") || "1");
  const amountCurrencyRaw = (url.searchParams.get("amountCurrency") || "usd").toLowerCase();

  if (!symbol) {
    throw new Error("Stock symbol is required.");
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Monthly investment amount must be greater than zero.");
  }

  if (!/^\d{4}-\d{2}$/.test(startDate)) {
    throw new Error("Start date must be in YYYY-MM format.");
  }

  if (startDate < MIN_SIP_START_MONTH) {
    throw new Error(`SIP start month cannot be before ${MIN_SIP_START_MONTH}.`);
  }

  if (endDate && !/^\d{4}-\d{2}$/.test(endDate)) {
    throw new Error("End date must be in YYYY-MM format.");
  }

  if (endDate && endDate < startDate) {
    throw new Error("End date cannot be before the start date.");
  }

  if (endDate && endDate < MIN_SIP_START_MONTH) {
    throw new Error(`SIP end month cannot be before ${MIN_SIP_START_MONTH}.`);
  }

  if (!["true", "false"].includes(stillHoldingRaw)) {
    throw new Error("Still holding must be true or false.");
  }

  if (!Number.isInteger(purchaseDay) || purchaseDay < 1 || purchaseDay > 28) {
    throw new Error("Purchase day must be between 1 and 28.");
  }

  if (!["usd", "inr"].includes(amountCurrencyRaw)) {
    throw new Error("amountCurrency must be usd or inr.");
  }

  return {
    symbol,
    amount,
    amountCurrency: amountCurrencyRaw,
    startDate,
    endDate: endDate || null,
    stillHolding: stillHoldingRaw !== "false",
    purchaseDay,
  };
}
