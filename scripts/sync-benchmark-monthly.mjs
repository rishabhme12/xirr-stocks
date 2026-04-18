#!/usr/bin/env node
import { getBenchmarkDataDir, syncAllBenchmarkMonthlyFromYahoo } from "../src/lib/benchmark-monthly.mjs";

await syncAllBenchmarkMonthlyFromYahoo();
console.log(`Benchmark monthly CSVs updated under ${getBenchmarkDataDir()}`);
