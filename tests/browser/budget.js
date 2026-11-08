import { relative } from "node:path";

// a test waits on the engine's clock for a few seconds at most; test.slow() marks one that cannot
const BUDGET = process.env.CI ? 10_000 : 5_000;

export default class Budget {
  constructor() {
    this.over = [];
    this.tests = 0;
  }

  onTestEnd(test, result) {
    this.tests += result.duration;
    const slow = test.annotations.some((a) => a.type === "slow");
    if (result.status === "passed" && !slow && result.duration > BUDGET)
      this.over.push({ test, result });
  }

  onEnd(result) {
    const seconds = (ms) => Math.round(ms / 1000);
    console.log(
      `wall ${seconds(result.duration)} s, tests ${seconds(this.tests)} s; budget ${seconds(BUDGET)} s a test`,
    );
    for (const { test, result } of this.over) {
      const { file, line } = test.location;
      console.log(
        `  over the budget: ${relative(process.cwd(), file)}:${line} ${test.title}, ${(result.duration / 1000).toFixed(1)} s`,
      );
    }
    if (this.over.length) return { status: "failed" };
  }
}
